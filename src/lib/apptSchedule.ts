// Portal — «Dar turno» desde un pedido de turno (panel → Portal → Pedidos de
// turno): el equipo carga el turno ahí mismo, sin ir a la Agenda, y queda
// enlazado al pedido (la familia ve el día y la hora). Puro: lo usan el panel
// (src/components/admin/portal/PortalApptSchedule.tsx) y las pruebas.
//
// No hay una tabla de días y horarios de atención: se deducen de la agenda de
// cada profesional (sus turnos sin cancelar de las últimas 8 semanas y de las
// próximas 3). Solo se proponen horarios dentro de esas franjas, en los días y
// el horario que pidió la familia, sin pisar otros turnos del profesional, los
// otros turnos del chico (con cualquier profesional) ni bloqueos. La base
// vuelve a revisar superposiciones y bloqueos al guardar (trigger
// appointments_agenda_rules, script 12), pero solo los del mismo profesional.
// Fechas AAAA-MM-DD y horas HH:MM, en la hora del centro.

import {
  AGENDA_END_MIN, AGENDA_START_MIN, type Modality, type ScheduleBlock, blockAffects, fromMinutes, toMinutes,
} from "./agenda";
import { type ApptReqModality, type ApptReqReason, type TimeBand, type Weekday, WEEKDAYS } from "./apptRequestRules";
import { addDaysKey } from "./portalRules";

export type ConsultationType = "primera_vez" | "seguimiento";

// Hacia atrás y hacia adelante: de dónde se sacan los días que atiende y hasta
// cuándo se buscan horarios libres
export const SCHEDULE_HISTORY_DAYS = 56; // 8 semanas
export const SCHEDULE_HORIZON_DAYS = 21; // 3 semanas
export const SCHEDULE_MAX_SLOTS = 6;
// Para hoy, solo desde dentro de una hora (que la familia llegue a enterarse)
export const SCHEDULE_LEAD_MIN = 60;
// Los horarios se proponen en punto y y media (y justo después de otro turno)
export const SCHEDULE_GRID_MIN = 30;
// Como la Agenda: si el profesional no tiene cargada la duración de su sesión
export const SCHEDULE_DEFAULT_MINUTES = 30;
export const SCHEDULE_MIN_MINUTES = 10;
export const SCHEDULE_MAX_MINUTES = 180;

// Horarios que puede elegir la familia, dentro de la franja del centro (7 a 18)
export const BAND_RANGE: Record<TimeBand, { start: number; end: number }> = {
  manana: { start: Math.max(7 * 60, AGENDA_START_MIN), end: 12 * 60 },
  tarde: { start: 12 * 60, end: Math.min(18 * 60, AGENDA_END_MIN) },
  indistinto: { start: AGENDA_START_MIN, end: AGENDA_END_MIN },
};

// ── Lo que se propone al abrir el formulario ────────────────────────────────

// Texto del motivo del turno (lo ve el equipo en la Agenda; la familia no)
const REASON_TEXT: Record<ApptReqReason, string> = {
  continuar: "Seguir con el tratamiento",
  consulta: "Consulta",
  otro: "Otro motivo",
};

export type ScheduleDefaults = {
  modality: Modality;
  consultation_type: ConsultationType;
  reason: string;
  duration: number;
};

// Lo que se propone a partir del pedido: la modalidad que pidió (si le da lo
// mismo, en el centro), seguimiento (ningún motivo del pedido quiere decir
// "primera vez": quien pide desde el portal ya es paciente) y la duración de
// la sesión del profesional
export function scheduleDefaults(
  r: { reason: ApptReqReason; modality: ApptReqModality }, sessionMinutes?: number | null,
): ScheduleDefaults {
  return {
    modality: r.modality === "telemedicina" ? "telemedicina" : "presencial",
    consultation_type: "seguimiento",
    reason: `${REASON_TEXT[r.reason] ?? REASON_TEXT.otro} (pedido por el portal)`,
    duration: sessionDuration(sessionMinutes),
  };
}

export function sessionDuration(sessionMinutes?: number | null): number {
  const n = Number(sessionMinutes);
  return Number.isInteger(n) && n >= SCHEDULE_MIN_MINUTES && n <= SCHEDULE_MAX_MINUTES ? n : SCHEDULE_DEFAULT_MINUTES;
}

// ── Días y horarios ─────────────────────────────────────────────────────────

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Una fecha AAAA-MM-DD que existe (no "2026-02-30")
function isRealDate(dateKey: string): boolean {
  if (!DATE_KEY.test(dateKey)) return false;
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Día de la semana de una fecha ("lun" … "vie"); null si es fin de semana o
// no es una fecha
export function weekdayOfKey(dateKey: string): Weekday | null {
  if (!isRealDate(dateKey)) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0: domingo
  return dow >= 1 && dow <= 5 ? WEEKDAYS[dow - 1] : null;
}

export function isWeekendDate(dateKey: string): boolean {
  return isRealDate(dateKey) && weekdayOfKey(dateKey) === null;
}

// ¿Es uno de los días que pidió la familia? (para avisar, no para frenar)
export function dayMatches(dateKey: string, days: readonly Weekday[]): boolean {
  const w = weekdayOfKey(dateKey);
  return !!w && days.includes(w);
}

// ¿El turno entero cae en el horario que pidió la familia? (para avisar)
export function bandMatches(time: string, duration: number, band: TimeBand): boolean {
  if (!TIME_KEY.test(time)) return false;
  const start = toMinutes(time);
  const range = BAND_RANGE[band];
  return start >= range.start && start + duration <= range.end;
}

// ── Revisión antes de guardar (como la Agenda) ──────────────────────────────

export type ScheduleForm = { professionalId: string; date: string; time: string; duration: number };

// null si se puede guardar; si no, el mensaje para mostrar
export function scheduleFormError(f: ScheduleForm, today: string, nowMinutes: number): string | null {
  if (!f.professionalId) return "Elegí el profesional.";
  if (!isRealDate(f.date)) return "Elegí la fecha.";
  if (!TIME_KEY.test(f.time)) return "Elegí la hora.";
  if (!Number.isInteger(f.duration) || f.duration < SCHEDULE_MIN_MINUTES || f.duration > SCHEDULE_MAX_MINUTES) {
    return `La duración tiene que ser de ${SCHEDULE_MIN_MINUTES} a ${SCHEDULE_MAX_MINUTES} minutos.`;
  }
  const start = toMinutes(f.time);
  if (start < AGENDA_START_MIN || start + f.duration > AGENDA_END_MIN) {
    return `El turno tiene que estar entre las ${fromMinutes(AGENDA_START_MIN)} y las ${fromMinutes(AGENDA_END_MIN)}.`;
  }
  if (f.date < today) return "Esa fecha ya pasó.";
  if (f.date === today && start <= nowMinutes) return "Esa hora ya pasó.";
  return null;
}

// ── Horarios libres ─────────────────────────────────────────────────────────

// Lo que hace falta de cada turno (la Agenda trae más)
export type ScheduleAppt = {
  professional_id: string | null;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number | null;
  status: string;
};

export type DayWindow = { start: number; end: number }; // minutos desde las 0
export type WorkWindows = Partial<Record<Weekday, DayWindow>>;
export type SlotSuggestion = { date: string; time: string };
export type SuggestReason = "ok" | "no_history" | "no_free";
export type SuggestResult = { slots: SlotSuggestion[]; reason: SuggestReason; windows: WorkWindows };

const apptMinutes = (a: Pick<ScheduleAppt, "duration_minutes">) => {
  const n = Number(a.duration_minutes);
  return n > 0 ? n : SCHEDULE_DEFAULT_MINUTES;
};

// El primer turno sin cancelar de ese día que se superpone con el que se
// quiere dar (para avisar: la base solo frena los del mismo profesional)
export function patientClash(
  date: string, time: string, duration: number, appointments: readonly ScheduleAppt[],
): ScheduleAppt | null {
  if (!TIME_KEY.test(time) || !(duration > 0)) return null;
  const start = toMinutes(time);
  return appointments.find((a) => a.status !== "cancelado" && a.appointment_date === date
    && TIME_KEY.test(String(a.appointment_time))
    && toMinutes(a.appointment_time) < start + duration && toMinutes(a.appointment_time) + apptMinutes(a) > start) ?? null;
}

// Franja en que atiende cada día de la semana, según sus turnos sin cancelar
// entre from y to: del que empieza más temprano al que termina más tarde
export function workWindows(appointments: readonly ScheduleAppt[], professionalId: string, from: string, to: string): WorkWindows {
  const out: WorkWindows = {};
  for (const a of appointments) {
    if (a.professional_id !== professionalId || a.status === "cancelado") continue;
    if (a.appointment_date < from || a.appointment_date > to) continue;
    const w = weekdayOfKey(a.appointment_date);
    if (!w || !TIME_KEY.test(String(a.appointment_time))) continue;
    const start = toMinutes(a.appointment_time);
    const end = start + apptMinutes(a);
    const cur = out[w];
    out[w] = cur ? { start: Math.min(cur.start, start), end: Math.max(cur.end, end) } : { start, end };
  }
  return out;
}

// Horarios libres del profesional en los días y el horario que pidió la
// familia, de hoy (desde dentro de una hora) a horizonDays días:
//   - solo dentro de la franja en que suele atender ese día de la semana
//     (sin turnos en las últimas 8 semanas ni en las próximas 3: no_history);
//   - en punto y y media, al empezar su franja y justo después de cada turno;
//   - sin pisar sus turnos, los otros turnos del chico (patientAppointments,
//     con cualquier profesional: no cuentan para su franja) ni un bloqueo
//     (suyo o de todo el centro).
// Para repartir las opciones entre días: primero el primer horario libre de
// cada día, después el segundo, y así hasta max. Se devuelven en orden.
export function suggestFreeSlots(input: {
  days: readonly Weekday[];
  band: TimeBand;
  professionalId: string;
  duration: number;
  appointments: readonly ScheduleAppt[];
  /** Los turnos del chico (con cualquier profesional): tampoco se pisan */
  patientAppointments?: readonly ScheduleAppt[];
  blocks: readonly ScheduleBlock[];
  today: string;
  nowMinutes: number;
  horizonDays?: number;
  max?: number;
}): SuggestResult {
  const { days, band, professionalId, duration, blocks, today, nowMinutes } = input;
  const horizonDays = input.horizonDays ?? SCHEDULE_HORIZON_DAYS;
  const max = input.max ?? SCHEDULE_MAX_SLOTS;
  const mine = input.appointments.filter((a) => a.professional_id === professionalId && a.status !== "cancelado");
  const patientBusy = (input.patientAppointments ?? []).filter((a) => a.status !== "cancelado");
  const windows = professionalId
    ? workWindows(mine, professionalId, addDaysKey(today, -SCHEDULE_HISTORY_DAYS), addDaysKey(today, horizonDays))
    : {};
  if (!Object.keys(windows).length) return { slots: [], reason: "no_history", windows };
  if (!Number.isInteger(duration) || duration < SCHEDULE_MIN_MINUTES || duration > SCHEDULE_MAX_MINUTES || max <= 0) {
    return { slots: [], reason: "no_free", windows };
  }

  const range = BAND_RANGE[band];
  const perDay: SlotSuggestion[][] = [];
  for (let i = 0; i < horizonDays; i++) {
    const date = addDaysKey(today, i);
    const wd = weekdayOfKey(date);
    const w = wd && days.includes(wd) ? windows[wd] : undefined;
    if (!w) continue;
    let lo = Math.max(range.start, w.start, AGENDA_START_MIN);
    const hi = Math.min(range.end, w.end, AGENDA_END_MIN);
    if (date === today) lo = Math.max(lo, nowMinutes + SCHEDULE_LEAD_MIN);
    if (lo + duration > hi) continue;

    // Los del chico con este mismo profesional quedan dos veces: no importa.
    // Al terminar cada uno también se propone un horario
    const taken = [...mine, ...patientBusy]
      .filter((a) => a.appointment_date === date && TIME_KEY.test(String(a.appointment_time)))
      .map((a) => ({ start: toMinutes(a.appointment_time), end: toMinutes(a.appointment_time) + apptMinutes(a) }));
    const candidates = new Set<number>([w.start, ...taken.map((t) => t.end)]);
    for (let s = Math.ceil(lo / SCHEDULE_GRID_MIN) * SCHEDULE_GRID_MIN; s + duration <= hi; s += SCHEDULE_GRID_MIN) candidates.add(s);

    const free = [...candidates]
      .filter((s) => s >= lo && s + duration <= hi)
      .filter((s) => !taken.some((t) => t.start < s + duration && t.end > s))
      .filter((s) => !blocks.some((b) => blockAffects(b, {
        appointment_date: date, appointment_time: fromMinutes(s), duration_minutes: duration, professional_id: professionalId,
      })))
      .sort((a, b) => a - b);
    if (free.length) perDay.push(free.map((s) => ({ date, time: fromMinutes(s) })));
  }

  const slots: SlotSuggestion[] = [];
  for (let k = 0; slots.length < max; k++) {
    const round = perDay.filter((list) => k < list.length).map((list) => list[k]);
    if (!round.length) break;
    slots.push(...round.slice(0, max - slots.length));
  }
  slots.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  return { slots, reason: slots.length ? "ok" : "no_free", windows };
}
