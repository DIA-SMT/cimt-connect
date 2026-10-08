// Portal de familias: reglas puras que comparten el navegador (modo mock) y
// el servidor (server/api/portal/*). Sin imports: el servidor lo importa con
// ruta relativa. Las fechas y horas son las del centro (Tucumán), así el
// servidor, que corre en UTC, calcula igual que el navegador.

export const CENTER_TZ = "America/Argentina/Tucuman";

// "Vamos a ir" se habilita desde N días antes del turno.
export const CONFIRM_WINDOW_DAYS = 3;
// Un aviso de "no vamos a poder ir" es "a tiempo" si llega con al menos este
// número de días de anticipación (el día anterior al turno o antes).
export const NOTICE_MIN_DAYS = 1;

export const PRIVACY_VERSION = "2026-10-v2";
export const REASON_TEXT_MAX = 140;
export const REASON_CODES = ["salud", "escuela", "transporte", "trabajo", "otro"] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
export type ResponseKind = "confirmo" | "no_puedo";
export type Outcome = "cancelado" | "justificado" | "reprogramado" | "otro";

// Lo que la familia ve de un turno (nunca más que esto)
export type ApptDTO = {
  id: string;
  child_id: string;
  child_first_name: string;
  is_self: boolean; // el turno es del propio titular de la cuenta (paciente adulto)
  date: string; // AAAA-MM-DD (hora del centro)
  time: string; // HH:MM
  duration_minutes: number;
  modality: "presencial" | "telemedicina";
  professional_name: string | null;
  state: "agendado" | "cancelado";
  response: {
    kind: ResponseKind;
    reason_code?: ReasonCode; // solo si la respuesta es de esta cuenta
    at: string; // ISO
    by_me: boolean;
    on_time: boolean; // solo tiene sentido para "no_puedo"
  } | null;
  outcome: Outcome | null; // qué hizo el centro con el aviso
  can_confirm: boolean;
  confirm_from: string | null; // AAAA-MM-DD desde cuándo se puede confirmar
  can_decline: boolean;
  is_today: boolean;
  is_past: boolean;
};

// ── Fechas en la hora del centro ────────────────────────────────────────────

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: CENTER_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function centerNow(d: Date = new Date()): { date: string; time: string } {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function centerDateOf(iso: string): string {
  return centerNow(new Date(iso)).date;
}

export function addDaysKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function ageOn(birth: string, today: string): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

// Edad desde la que el paciente puede usar el portal por su cuenta (titular)
export const SELF_ACCESS_AGE = 18;

export function confirmFrom(date: string): string {
  return addDaysKey(date, -CONFIRM_WINDOW_DAYS);
}

export function isNoticeOnTime(noticeIso: string, apptDate: string): boolean {
  return centerDateOf(noticeIso) <= addDaysKey(apptDate, -NOTICE_MIN_DAYS);
}

// ── Validaciones ────────────────────────────────────────────────────────────

export function normalizeDni(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 10);
}

export function isValidDni(dni: string): boolean {
  return /^\d{6,10}$/.test(dni);
}

// Teléfono argentino como 10 dígitos (característica + número, sin 0 ni 15):
// el mismo número al que apunta WhatsApp (ver whatsappNumber en reminders.ts).
// null si no se puede interpretar.
export function arPhone10(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) {
    d = d.slice(2);
    if (d.startsWith("9")) d = d.slice(1);
  }
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 7) d = `381${d}`; // sin característica: San Miguel de Tucumán
  if (d.length === 12) {
    for (const areaLen of [3, 4, 2]) {
      if (d.slice(areaLen, areaLen + 2) === "15") { d = d.slice(0, areaLen) + d.slice(areaLen + 2); break; }
    }
  }
  return d.length === 10 ? d : null;
}

// Mismo teléfono escrito distinto ("3863 15 421234" y "+54 9 3863 421234").
// Un campo puede traer más de un número ("381-4001122 / 381-5556677").
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const list = (s: string | null | undefined) => (s ?? "").split(/[/,;|]|\s+[yo]\s+/i).map((x) => x.trim()).filter(Boolean);
  for (const x of list(a)) {
    for (const y of list(b)) {
      const nx = arPhone10(x), ny = arPhone10(y);
      if (nx && ny) { if (nx === ny) return true; continue; }
      // Si alguno no se puede interpretar, alcanza con los últimos 7 dígitos
      const dx = x.replace(/\D/g, ""), dy = y.replace(/\D/g, "");
      if (dx.length >= 7 && dy.length >= 7 && dx.slice(-7) === dy.slice(-7)) return true;
    }
  }
  return false;
}

export function normalizeCode(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 10);
}

const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "password", "contraseña", "contrasena", "qwertyui",
  "11111111", "00000000", "87654321", "abcdefgh", "iloveyou", "tucuman1", "argentina",
]);

export function passwordProblem(password: string, repeat: string, dni: string): string | null {
  if (password.length < 8) return "La contraseña tiene que tener al menos 8 caracteres.";
  if (password.length > 72) return "La contraseña puede tener hasta 72 caracteres.";
  if (dni && password.includes(dni)) return "Elegí una contraseña que no incluya tu DNI.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "Esa contraseña es muy fácil de adivinar.";
  if (password !== repeat) return "Las contraseñas no coinciden.";
  return null;
}

// ── El turno tal como lo ve la familia ──────────────────────────────────────

export type ApptInput = {
  id: string; child_id: string; child_first_name: string; is_self?: boolean;
  date: string; time: string; duration_minutes: number;
  modality: "presencial" | "telemedicina"; professional_name: string | null;
  cancelled: boolean;
  justified?: boolean; // el equipo cargó asistencia "justificado"
};

export type ResponseInput = {
  account_id: string; kind: ResponseKind; reason_code: ReasonCode | null;
  at: string; outcome: Outcome | null;
};

export function computeApptDto(
  a: ApptInput,
  last: ResponseInput | null, // la respuesta más nueva de cualquier adulto
  accountId: string,
  now = centerNow(),
): ApptDTO {
  const isPast = `${a.date} ${a.time}` <= `${now.date} ${now.time}`;
  const byMe = last?.account_id === accountId;
  // Qué hizo el centro con un "no vamos": lo que cargó el equipo, o lo que se
  // deduce del turno (cancelado o falta justificada)
  const outcome: Outcome | null = last?.kind === "no_puedo"
    ? (last.outcome ?? (a.cancelled ? "cancelado" : a.justified ? "justificado" : null))
    : null;
  const resolved = outcome !== null;
  const inWindow = now.date >= confirmFrom(a.date);
  return {
    id: a.id,
    child_id: a.child_id,
    child_first_name: a.child_first_name,
    is_self: !!a.is_self,
    date: a.date,
    time: a.time,
    duration_minutes: a.duration_minutes,
    modality: a.modality,
    professional_name: a.professional_name,
    state: a.cancelled ? "cancelado" : "agendado",
    response: last ? {
      kind: last.kind,
      ...(byMe && last.reason_code ? { reason_code: last.reason_code } : {}),
      at: last.at,
      by_me: byMe,
      on_time: isNoticeOnTime(last.at, a.date),
    } : null,
    outcome,
    can_confirm: !a.cancelled && !isPast && inWindow && !resolved,
    confirm_from: !a.cancelled && !isPast && !inWindow ? confirmFrom(a.date) : null,
    can_decline: !a.cancelled && !isPast && !resolved,
    is_today: a.date === now.date,
    is_past: isPast,
  };
}

// ── Pedidos de copia de la historia clínica ─────────────────────────────────
// La pueden pedir el propio paciente adulto (titular) y su representante
// legal (madre, padre o tutor/a). Un adulto "autorizado" no (Ley 26.529,
// art. 19). La copia se prepara en el centro y se entrega en mano, con DNI:
// el portal solo lleva el pedido y su estado, nunca la historia clínica.

export const HC_REQUEST_KINDS = ["titular", "representante_legal"] as const;
export type HcLinkKind = (typeof HC_REQUEST_KINDS)[number];

export function canRequestHc(linkKind: string): linkKind is HcLinkKind {
  return (HC_REQUEST_KINDS as readonly string[]).includes(linkKind);
}

export type HcStatus = "pendiente" | "lista" | "entregada" | "rechazada" | "cancelada";
export const HC_OPEN_STATUSES: readonly HcStatus[] = ["pendiente", "lista"];
export const HC_REJECT_REASONS = ["no_habilitado", "duplicado", "otro"] as const;
export type HcRejectReason = (typeof HC_REJECT_REASONS)[number];
// Pedidos nuevos por cuenta y por día (contra pedidos repetidos por error)
export const HC_DAILY_MAX = 3;
// Hasta cuándo la familia sigue viendo un pedido cerrado
export const HC_VISIBLE_DAYS = 60;

// Lo que la familia ve de un pedido (nunca más que esto)
export type HcRequestDTO = {
  id: string;
  patient_id: string;
  child_first_name: string;
  is_self: boolean; // la copia es de la propia historia clínica del titular
  status: HcStatus;
  created_at: string; // ISO
  ready_at: string | null;
  delivered_at: string | null;
  reject_reason: HcRejectReason | null;
  can_cancel: boolean;
  // Si se puede abrir la página del chico (deja de poder, por ejemplo, con
  // el alta cargada; el pedido se sigue viendo igual)
  child_page: boolean;
};

export type HcRow = {
  id: string; patient_id: string; status: HcStatus; created_at: string; updated_at: string;
  ready_at: string | null; delivered_at: string | null; reject_reason: HcRejectReason | null;
};

export function computeHcDto(r: HcRow, child: { display: string; self: boolean; page?: boolean }): HcRequestDTO {
  return {
    id: r.id,
    patient_id: r.patient_id,
    child_first_name: child.display,
    is_self: child.self,
    status: r.status,
    created_at: r.created_at,
    ready_at: r.ready_at,
    delivered_at: r.delivered_at,
    reject_reason: r.status === "rechazada" ? r.reject_reason : null,
    can_cancel: r.status === "pendiente",
    child_page: child.page ?? true,
  };
}

// Un pedido cerrado se sigue mostrando un tiempo, contado desde que se cerró
export function hcVisible(r: Pick<HcRow, "status" | "created_at" | "updated_at">, now: Date = new Date()): boolean {
  if ((HC_OPEN_STATUSES as readonly string[]).includes(r.status)) return true;
  return now.getTime() - Date.parse(r.updated_at ?? r.created_at) < HC_VISIBLE_DAYS * 24 * 60 * 60 * 1000;
}

// Constancia de cada paso de un pedido (solo la ve el equipo)
export type HcEventKind = "pedido" | "lista" | "pendiente" | "entregada" | "rechazada" | "cancelada" | "nota";
export type HcEvent = { kind: HcEventKind; by_email: string | null; at: string }; // by_email null: la familia

// ── Bandeja del equipo (panel) ──────────────────────────────────────────────
// Pedidos de copia de la historia clínica y avisos de "no vamos a poder ir".
// Solo la ve el equipo: acá sí van nombres, DNI y el comentario de la familia.

export type StaffHcRequest = {
  id: string;
  patient_id: string;
  patient_name: string; // "Apellido, Nombre"
  patient_dni: string | null;
  link_kind: HcLinkKind;
  requester_name: string;
  requester_dni: string;
  // ¿Quien pidió sigue habilitado hoy? null: ya no tiene cuenta o el pedido está cerrado
  still_allowed: boolean | null;
  status: HcStatus;
  created_at: string;
  ready_at: string | null;
  ready_by_email: string | null;
  delivered_at: string | null;
  delivered_by_email: string | null;
  delivered_to_name: string | null;
  delivered_to_dni: string | null;
  rejected_at: string | null;
  rejected_by_email: string | null;
  reject_reason: HcRejectReason | null;
  cancelled_at: string | null;
  staff_notes: string | null;
  events: HcEvent[]; // del más viejo al más nuevo
};

export type HcStaffTarget = "pendiente" | "lista" | "entregada" | "rechazada";

// Pasos que el equipo puede dar desde cada estado
export const HC_TRANSITIONS: Record<HcStatus, readonly HcStaffTarget[]> = {
  pendiente: ["lista", "entregada", "rechazada"],
  lista: ["entregada", "rechazada", "pendiente"],
  entregada: [],
  rechazada: [],
  cancelada: [],
};

// Cómo resuelve el equipo un aviso de "no vamos a poder ir"
//   justificar: asistencia "justificado" en el turno → "Falta justificada"
//   cancelar:   cancela el turno → "Cancelamos el turno por tu aviso"
//   reprogramar: se los contacta para otro día → "Te contactamos para otro día"
//   visto:      solo se toma nota → "Recibimos tu aviso"
export const NOTICE_ACTIONS = ["justificar", "cancelar", "reprogramar", "visto"] as const;
export type NoticeAction = (typeof NOTICE_ACTIONS)[number];

// Cómo quedó un aviso: lo que hizo el equipo, o "asistio" si el turno tiene
// asistencia "presente" (avisaron que no venían, pero vinieron)
export type NoticeResolution = Outcome | "asistio";

export type StaffNotice = {
  response_id: string;
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  date: string;
  time: string;
  modality: "presencial" | "telemedicina";
  professional_name: string | null;
  requester_name: string | null; // null si la cuenta ya no existe
  is_self: boolean; // avisó el propio paciente adulto
  reason_code: ReasonCode | null;
  reason_text: string | null;
  at: string;
  on_time: boolean;
  is_past: boolean;
  resolution: NoticeResolution | null; // null: pendiente
  resolved_at: string | null;
  resolved_by_email: string | null;
};

export type StaffInbox = { hc: StaffHcRequest[]; notices: StaffNotice[] };
export type StaffInboxCount = { hc_pending: number; notices_pending: number };
