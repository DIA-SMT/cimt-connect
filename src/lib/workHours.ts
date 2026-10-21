// Horario de atención semanal de cada profesional (professionals.weekly_hours,
// script 36): qué días atiende y en qué franjas, hasta dos por día.
//   { "lun": [{ "start": "08:00", "end": "12:00" }, { "start": "14:00", "end": "18:00" }], "mie": [...] }
// Sin cargar (null) la agenda funciona como siempre. Fuera del horario la
// agenda lo muestra en gris y avisa al dar un turno, pero no lo impide.
// Mismas reglas que valid_weekly_hours() en la base.

import { AGENDA_END_MIN, AGENDA_START_MIN, fromMinutes, toMinutes } from "./agenda";
import { type Weekday, WEEKDAYS } from "./apptRequestRules";

export type HourRange = { start: string; end: string };
export type WeeklyHours = Partial<Record<Weekday, HourRange[]>>;
export type HourWindow = { start: number; end: number }; // minutos desde las 0

export const MAX_RANGES_PER_DAY = 2;

export const WEEKDAY_NAME: Record<Weekday, string> = {
  lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes",
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lo que viene de la base, validado. null si no hay horario cargado (o no sirve). */
export function parseWeeklyHours(raw: unknown): WeeklyHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: WeeklyHours = {};
  for (const d of WEEKDAYS) {
    const v = (raw as Record<string, unknown>)[d];
    if (!Array.isArray(v) || !v.length) continue;
    const ranges = v
      .filter((r): r is HourRange => !!r && typeof r === "object"
        && typeof (r as HourRange).start === "string" && typeof (r as HourRange).end === "string")
      .map((r) => ({ start: r.start, end: r.end }));
    if (ranges.length) out[d] = ranges;
  }
  return Object.keys(out).length && !hoursProblem(out) ? out : null;
}

/** Qué está mal (en castellano), o null si el horario sirve. */
export function hoursProblem(h: WeeklyHours): string | null {
  for (const d of WEEKDAYS) {
    const ranges = h[d];
    if (!ranges?.length) continue;
    if (ranges.length > MAX_RANGES_PER_DAY) return `${WEEKDAY_NAME[d]}: hasta ${MAX_RANGES_PER_DAY} franjas por día.`;
    const win = ranges.map((r) => {
      if (!TIME.test(r.start) || !TIME.test(r.end)) return null;
      return { start: toMinutes(r.start), end: toMinutes(r.end) };
    });
    if (win.some((w) => !w)) return `${WEEKDAY_NAME[d]}: revisá los horarios.`;
    for (const w of win as HourWindow[]) {
      if (w.start >= w.end) return `${WEEKDAY_NAME[d]}: la hora de fin tiene que ser después de la de inicio.`;
      if (w.start < AGENDA_START_MIN || w.end > AGENDA_END_MIN) {
        return `${WEEKDAY_NAME[d]}: el centro atiende de ${fromMinutes(AGENDA_START_MIN)} a ${fromMinutes(AGENDA_END_MIN)}.`;
      }
    }
    const sorted = [...(win as HourWindow[])].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end) return `${WEEKDAY_NAME[d]}: las franjas se superponen.`;
    }
  }
  return null;
}

/** Franjas en minutos, ordenadas, por día de la semana. */
export function hoursWindows(h: WeeklyHours): Partial<Record<Weekday, HourWindow[]>> {
  const out: Partial<Record<Weekday, HourWindow[]>> = {};
  for (const d of WEEKDAYS) {
    const r = h[d];
    if (r?.length) out[d] = r.map((x) => ({ start: toMinutes(x.start), end: toMinutes(x.end) })).sort((a, b) => a.start - b.start);
  }
  return out;
}

/** Horas en que NO atiende ese día, dentro de la agenda (para pintarlas en gris). */
export function closedWindows(h: WeeklyHours, day: Weekday): HourWindow[] {
  const open = hoursWindows(h)[day] ?? [];
  const out: HourWindow[] = [];
  let cursor = AGENDA_START_MIN;
  for (const w of open) {
    if (w.start > cursor) out.push({ start: cursor, end: w.start });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < AGENDA_END_MIN) out.push({ start: cursor, end: AGENDA_END_MIN });
  return out;
}

/** ¿El turno entra en su horario? null si no tiene horario cargado. */
export function withinHours(h: WeeklyHours | null, day: Weekday | null, time: string, duration: number): boolean | null {
  if (!h) return null;
  if (!day || !TIME.test(time)) return false;
  const s = toMinutes(time);
  const e = s + (duration > 0 ? duration : 0);
  return (hoursWindows(h)[day] ?? []).some((w) => s >= w.start && e <= w.end);
}

const short = (t: string) => (t.endsWith(":00") ? String(Number(t.slice(0, 2))) : t.replace(/^0/, ""));

/** "Lunes y miércoles de 8 a 12 · Viernes de 8 a 12 y de 14 a 18" */
export function hoursSummary(h: WeeklyHours | null): string {
  if (!h) return "";
  const groups: { days: Weekday[]; text: string }[] = [];
  for (const d of WEEKDAYS) {
    const r = h[d];
    if (!r?.length) continue;
    const text = [...r].sort((a, b) => a.start.localeCompare(b.start))
      .map((x) => `de ${short(x.start)} a ${short(x.end)}`).join(" y ");
    const g = groups.find((x) => x.text === text);
    if (g) g.days.push(d); else groups.push({ days: [d], text });
  }
  return groups.map((g) => {
    const names = g.days.map((d, i) => (i === 0 ? WEEKDAY_NAME[d] : WEEKDAY_NAME[d].toLowerCase()));
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : names[0];
    return `${list} ${g.text}`;
  }).join(" · ");
}
