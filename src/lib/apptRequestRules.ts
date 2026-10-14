// Portal — pedidos de turno: la familia pide, el centro asigna. Puro: lo usan
// el servidor (server/lib/apptRequests.ts), el modo mock y las pruebas. Sin
// alias de imports (el servidor lo importa con ruta relativa).
//
// La familia no elige un horario: cuenta para qué es y qué días y horarios le
// quedan bien. El equipo lo agenda en la Agenda (y lo enlaza al pedido) o la
// llama. El portal muestra el estado del pedido y, si se agendó, el turno.
// Lo puede pedir cualquier adulto con acceso a los turnos de esa persona
// (titular, representante legal o autorizado).

// ── Lo que se elige al pedir ────────────────────────────────────────────────

export const APPT_REQ_REASONS = ["continuar", "consulta", "otro"] as const;
export type ApptReqReason = (typeof APPT_REQ_REASONS)[number];

export const WEEKDAYS = ["lun", "mar", "mie", "jue", "vie"] as const; // el centro atiende de lunes a viernes
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  lun: "Lunes", mar: "Martes", mie: "Miércoles", jue: "Jueves", vie: "Viernes",
};

export const TIME_BANDS = ["manana", "tarde", "indistinto"] as const;
export type TimeBand = (typeof TIME_BANDS)[number];
export const TIME_BAND_LABEL: Record<TimeBand, string> = {
  manana: "Mañana (de 7 a 12 hs)",
  tarde: "Tarde (de 12 a 18 hs)",
  indistinto: "Cualquier horario",
};

export const APPT_REQ_MODALITIES = ["presencial", "telemedicina", "indistinto"] as const;
export type ApptReqModality = (typeof APPT_REQ_MODALITIES)[number];
export const APPT_REQ_MODALITY_LABEL: Record<ApptReqModality, string> = {
  presencial: "En el centro",
  telemedicina: "Por videollamada",
  indistinto: "Cualquiera de las dos",
};

// Comentario opcional: corto y sin datos de salud (eso se habla en el turno)
export const APPT_REQ_NOTE_MAX = 140;
// Pedidos nuevos por cuenta y por día (contra pedidos repetidos por error)
export const APPT_REQ_DAILY_MAX = 3;
// Hasta cuándo la familia sigue viendo un pedido cerrado
export const APPT_REQ_VISIBLE_DAYS = 30;

export type ApptRequestInput = {
  reason: ApptReqReason;
  days: Weekday[]; // al menos uno, en el orden de la semana
  band: TimeBand;
  modality: ApptReqModality;
  note: string | null;
};

// Revisa lo que llega del portal (servidor y mock): devuelve el pedido limpio
// o el mensaje para mostrar. El comentario no se corta: si es largo, error.
export function validateApptRequest(raw: unknown): { ok: true; value: ApptRequestInput } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!(APPT_REQ_REASONS as readonly unknown[]).includes(b.reason)) return { ok: false, error: "Elegí para qué es el turno." };
  const days = Array.isArray(b.days) ? WEEKDAYS.filter((d) => (b.days as unknown[]).includes(d)) : [];
  if (!days.length) return { ok: false, error: "Elegí al menos un día." };
  if (!(TIME_BANDS as readonly unknown[]).includes(b.band)) return { ok: false, error: "Elegí el horario." };
  if (!(APPT_REQ_MODALITIES as readonly unknown[]).includes(b.modality)) return { ok: false, error: "Elegí si es en el centro o por videollamada." };
  const note = String(b.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > APPT_REQ_NOTE_MAX) return { ok: false, error: `El comentario es muy largo: el máximo es ${APPT_REQ_NOTE_MAX} caracteres.` };
  return {
    ok: true,
    value: { reason: b.reason as ApptReqReason, days, band: b.band as TimeBand, modality: b.modality as ApptReqModality, note: note || null },
  };
}

// ── Estados ─────────────────────────────────────────────────────────────────
//   pendiente: recibido, el equipo todavía no lo resolvió
//   contactar: el equipo la va a llamar para coordinar
//   agendado:  se dio el turno (si está enlazado, la familia lo ve en el pedido)
//   rechazado: no se dio turno (con motivo)
//   cancelado: la familia ya no lo necesita

export type ApptReqStatus = "pendiente" | "contactar" | "agendado" | "rechazado" | "cancelado";
export const APPT_REQ_OPEN: readonly ApptReqStatus[] = ["pendiente", "contactar"];
// Los que elige el equipo al decir "No se puede". "bloqueo" lo pone solo el
// servidor: al cargar un bloqueo por orden judicial se cierran los pedidos
// abiertos de ese adulto (nadie lo elige a mano)
export const APPT_REQ_REJECT_REASONS = ["ya_tiene_turnos", "otro"] as const;
export type ApptReqRejectReason = (typeof APPT_REQ_REJECT_REASONS)[number] | "bloqueo";

export function apptReqOpen(status: ApptReqStatus): boolean {
  return (APPT_REQ_OPEN as readonly string[]).includes(status);
}

// ── Lo que ve la familia ────────────────────────────────────────────────────

export type ApptRequestDTO = {
  id: string;
  patient_id: string;
  child_first_name: string;
  is_self: boolean; // el turno es para el propio titular
  mine: boolean; // lo pidió esta cuenta (si no, otro adulto de la familia)
  status: ApptReqStatus;
  reason: ApptReqReason;
  days: Weekday[];
  band: TimeBand;
  modality: ApptReqModality;
  note: string | null; // solo si lo pidió esta cuenta
  created_at: string; // ISO
  updated_at: string;
  // Turno que dio el equipo (si lo enlazó y sigue agendado)
  appointment: { id: string; date: string; time: string } | null;
  // El equipo había enlazado un turno, pero después se canceló (o pasó a
  // otro paciente): la familia puede pedir otro. Un turno borrado de la base
  // no se detecta (el enlace queda vacío)
  appointment_cancelled: boolean;
  reject_reason: ApptReqRejectReason | null;
  can_cancel: boolean; // lo pidió esta cuenta y sigue abierto
};

export type ApptRequestRow = {
  id: string; patient_id: string; account_id: string | null; status: ApptReqStatus;
  reason: ApptReqReason; days: Weekday[]; band: TimeBand; modality: ApptReqModality; note: string | null;
  reject_reason: ApptReqRejectReason | null; created_at: string; updated_at: string;
};

// apptCancelled: el pedido tenía un turno enlazado que ya no está agendado
export function computeApptRequestDto(
  r: ApptRequestRow,
  child: { display: string; self: boolean },
  accountId: string,
  appt: { id: string; date: string; time: string } | null,
  apptCancelled = false,
): ApptRequestDTO {
  const mine = r.account_id === accountId;
  return {
    id: r.id,
    patient_id: r.patient_id,
    child_first_name: child.display,
    is_self: child.self,
    mine,
    status: r.status,
    reason: r.reason,
    days: r.days,
    band: r.band,
    modality: r.modality,
    note: mine ? r.note : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    appointment: r.status === "agendado" ? appt : null,
    appointment_cancelled: r.status === "agendado" && !appt && apptCancelled,
    reject_reason: r.status === "rechazado" ? r.reject_reason : null,
    can_cancel: mine && apptReqOpen(r.status),
  };
}

// Un pedido cerrado se sigue mostrando un tiempo, contado desde que se cerró
export function apptRequestVisible(r: Pick<ApptRequestRow, "status" | "created_at" | "updated_at">, now: Date = new Date()): boolean {
  if (apptReqOpen(r.status)) return true;
  return now.getTime() - Date.parse(r.updated_at ?? r.created_at) < APPT_REQ_VISIBLE_DAYS * 24 * 60 * 60 * 1000;
}

// ── Lo que ve el equipo (bandeja Portal → Pedidos de turno) ─────────────────

export type ApptReqEventKind = "pedido" | "contactar" | "agendado" | "pendiente" | "rechazado" | "cancelado" | "nota";
export type ApptReqEvent = { kind: ApptReqEventKind; by_email: string | null; at: string }; // by_email null: la familia

export type StaffApptSlot = { id: string; date: string; time: string; professional_name: string | null };

export type StaffApptRequest = {
  id: string;
  patient_id: string;
  patient_name: string; // "Apellido, Nombre"
  contact_phones: string[]; // teléfonos de la ficha (paciente y adultos responsables activos)
  link_kind: "titular" | "representante_legal" | "autorizado";
  requester_name: string;
  // ¿Quien pidió sigue teniendo acceso hoy? null: ya no tiene cuenta o el pedido está cerrado
  still_allowed: boolean | null;
  // Quien pidió tiene un bloqueo por orden judicial para este paciente: no
  // hay que contactarlo (ni darle el día y la hora)
  requester_blocked: boolean;
  status: ApptReqStatus;
  reason: ApptReqReason;
  days: Weekday[];
  band: TimeBand;
  modality: ApptReqModality;
  note: string | null;
  created_at: string;
  appointment: StaffApptSlot | null; // el turno enlazado (agendado)
  appointment_cancelled: boolean; // el turno enlazado se canceló: la familia ve «Turno cancelado»
  scheduled_at: string | null;
  scheduled_by_email: string | null;
  contacted_at: string | null;
  contacted_by_email: string | null;
  rejected_at: string | null;
  rejected_by_email: string | null;
  reject_reason: ApptReqRejectReason | null;
  cancelled_at: string | null;
  staff_notes: string | null;
  // Próximos turnos agendados del paciente (para enlazar el que se dio). Solo en pedidos abiertos
  upcoming: StaffApptSlot[];
  events: ApptReqEvent[]; // del más viejo al más nuevo
};

export type ApptReqStaffTarget = "contactar" | "agendado" | "rechazado" | "pendiente";

// Pasos que el equipo puede dar desde cada estado ("pendiente": volver atrás
// si se marcó por error)
export const APPT_REQ_TRANSITIONS: Record<ApptReqStatus, readonly ApptReqStaffTarget[]> = {
  pendiente: ["agendado", "contactar", "rechazado"],
  contactar: ["agendado", "rechazado", "pendiente"],
  agendado: ["pendiente"],
  rechazado: ["pendiente"],
  cancelado: [],
};
