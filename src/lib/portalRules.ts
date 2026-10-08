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

export const PRIVACY_VERSION = "2026-10-v1";
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
