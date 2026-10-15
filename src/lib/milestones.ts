// Hitos de la landing (30_hitos_derivacion_foto.sql). Dirección los prepara
// en Estadísticas con los números del panel, los revisa y los publica; la
// landing muestra la última publicación. Un valor null no se muestra.

export type PublicMilestones = {
  id: string;
  hidden: boolean;
  patients_total: number | null;
  patients_since: string | null; // YYYY-MM-DD
  response_hours: number | null;
  wait_days: number | null;
  waiting_list: number | null;
  month: string | null; // YYYY-MM-01
  month_value: number | null;
  month_label: string | null;
  published_at: string;
  published_by: string | null;
};

export type MilestonesDraft = Omit<PublicMilestones, "id" | "hidden" | "published_at" | "published_by">;

/** Lo que se cuenta en el análisis mensual (Dirección elige uno) */
export const MONTHLY_KINDS = {
  consultas: "consultas atendidas",
  solicitudes: "turnos solicitados",
  ingresos: "pacientes nuevos",
} as const;
export type MonthlyKind = keyof typeof MONTHLY_KINDS;

// Desde cuándo se cuentan los pacientes (apertura del CIMT)
export const PATIENTS_SINCE_DEFAULT = "2025-05-01";
// Compromiso del centro: responder cada solicitud en 48 hs como máximo
export const RESPONSE_HOURS_DEFAULT = 48;

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre"];

/** "2025-05-01" → "mayo de 2025" */
export function monthYear(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

/** Mes anterior al de la fecha dada, como YYYY-MM-01 (el análisis mensual es del mes cerrado) */
export function previousMonth(todayKey: string): string {
  const [y, m] = todayKey.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

/** ¿Hay algo para mostrar en la landing? */
export function hasMilestones(m: PublicMilestones | null): m is PublicMilestones {
  return !!m && !m.hidden && [m.patients_total, m.response_hours, m.wait_days, m.waiting_list, m.month_value]
    .some((v) => v !== null);
}

/** Valida los números antes de publicar; null si está todo bien */
export function milestonesError(d: MilestonesDraft): string | null {
  const nums: [number | null, string, number][] = [
    [d.patients_total, "pacientes", 1_000_000],
    [d.response_hours, "horas de respuesta", 720],
    [d.wait_days, "días de espera", 3650],
    [d.waiting_list, "lista de espera", 1_000_000],
    [d.month_value, "dato del mes", 1_000_000],
  ];
  for (const [v, label, max] of nums) {
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > max)) return `Revisá el número de ${label}`;
  }
  if (d.response_hours === 0) return "Las horas de respuesta tienen que ser al menos 1";
  if (d.month_value !== null && (!d.month || !d.month_label?.trim())) return "Al dato del mes le falta el mes o el texto";
  if ((d.month_label?.length ?? 0) > 80) return "El texto del dato del mes es muy largo";
  if (![d.patients_total, d.response_hours, d.wait_days, d.waiting_list, d.month_value].some((v) => v !== null)) {
    return "Completá al menos un número";
  }
  return null;
}
