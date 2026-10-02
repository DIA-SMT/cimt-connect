// Cálculo de estadísticas (fase 5). Lo usan la pestaña Estadísticas y el
// informe semanal para la Gerencia de Datos, así los números coinciden.
// Relevamiento 38–39: cantidad de pacientes, edades, localidad, tiempo de
// espera, satisfacción, calidad de atención, derivaciones, asistencia.

import {
  CASE_STATUS_LABEL, PATIENT_TYPE_LABEL, THERAPY_MODE_LABEL, todayKey,
  type CaseStatus, type PatientType, type ProfessionalOption, type TherapyMode,
} from "@/lib/patients";
import { INTAKE_STATUS_LABEL, type IntakeStatus } from "@/lib/agenda";

export type StatPatient = {
  id: string;
  created_at: string;
  locality: string | null;
  patient_type: PatientType;
  case_status: CaseStatus;
  has_health_insurance: boolean | null;
  therapy_modes: TherapyMode[] | null;
  other_conditions: string[] | null;
  age: number;
};
export type StatReferral = {
  specialty: string; status: string; registered: boolean; referral_date: string; voided_at: string | null;
};
export type StatAppt = {
  patient_id: string | null; professional_id: string | null; appointment_date: string; status: string;
  modality: string | null; attendance: string | null;
};
export type StatIntake = {
  created_at: string; status: IntakeStatus; workshop_id: string | null; workshop_attended: boolean | null; patient_id: string | null;
};
export type StatWorkshop = { id: string; workshop_date: string; canceled: boolean };
export type StatSurvey = {
  created_at: string; respondent: string; rating_attention: number; rating_communication: number;
  rating_treatment: number; rating_overall: number; would_recommend: boolean; comment: string | null;
};

export type StatsData = {
  patients: StatPatient[];
  referrals: StatReferral[];
  appts: StatAppt[];
  intake: StatIntake[];
  workshops: StatWorkshop[];
  surveys: StatSurvey[];
  professionals: ProfessionalOption[];
};

export type Row = { name: string; value: number };
export type Range = { start: string | null; end: string | null }; // fechas inclusive, null = sin límite

export type ProfessionalRow = { name: string; scheduled: number; present: number; absent: number; justified: number };

export const AGE_RANGES: { label: string; min: number; max: number }[] = [
  { label: "2 a 5 años", min: 2, max: 5 },
  { label: "6 a 12 años", min: 6, max: 12 },
  { label: "13 a 17 años", min: 13, max: 17 },
  { label: "18 a 39 años", min: 18, max: 39 },
  { label: "40 años o más", min: 40, max: 200 },
];

// created_at viene en UTC: se pasa a fecha local (un ingreso a las 22 hs es de ese día)
export function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function inRange(dateKey: string, r: Range): boolean {
  const d = dateKey.slice(0, 10);
  return (!r.start || d >= r.start) && (!r.end || d <= r.end);
}

function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeStats(data: StatsData, range: Range) {
  const { patients, referrals, appts, intake, workshops, surveys, professionals } = data;

  // ── Situación actual (no depende del período) ──
  const active = patients.filter((p) => p.case_status === "en_evaluacion" || p.case_status === "en_tratamiento").length;
  const liveReferrals = referrals.filter((r) => !r.voided_at);
  const current = {
    total: patients.length,
    active,
    pendingReferrals: liveReferrals.filter((r) => r.status === "pendiente").length,
    unregistered: liveReferrals.filter((r) => !r.registered && r.status !== "cancelada").length,
    byStatus: (Object.keys(CASE_STATUS_LABEL) as CaseStatus[])
      .map((s) => ({ name: CASE_STATUS_LABEL[s], value: patients.filter((p) => p.case_status === s).length })),
    byTherapy: (Object.keys(THERAPY_MODE_LABEL) as TherapyMode[])
      .map((m) => ({ name: THERAPY_MODE_LABEL[m], value: patients.filter((p) => p.therapy_modes?.includes(m)).length })),
  };

  // ── Ingresos (pacientes nuevos) ──
  const newPatients = patients.filter((p) => inRange(localDateKey(p.created_at), range));
  const conditions = new Map<string, number>();
  for (const p of newPatients) for (const c of p.other_conditions ?? []) conditions.set(c, (conditions.get(c) ?? 0) + 1);
  const admissions = {
    count: newPatients.length,
    byMonth: countByMonth(newPatients.map((p) => localDateKey(p.created_at)), range.start),
    byLocality: topN(groupLocalities(newPatients.map((p) => p.locality)), 10),
    byAge: AGE_RANGES.map((r) => ({ name: r.label, value: newPatients.filter((p) => p.age >= r.min && p.age <= r.max).length })),
    byType: (Object.keys(PATIENT_TYPE_LABEL) as PatientType[])
      .map((t) => ({ name: PATIENT_TYPE_LABEL[t], value: newPatients.filter((p) => p.patient_type === t).length })),
    byInsurance: [
      { name: "Con obra social", value: newPatients.filter((p) => p.has_health_insurance === true).length },
      { name: "Sin obra social", value: newPatients.filter((p) => p.has_health_insurance === false).length },
      { name: "Sin dato", value: newPatients.filter((p) => p.has_health_insurance === null).length },
    ],
    byCondition: topN([...conditions.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value), 8),
  };

  // ── Atención: turnos, prácticas y ausentismo ──
  const periodAppts = appts.filter((a) => inRange(a.appointment_date, range));
  const live = periodAppts.filter((a) => a.status !== "cancelado");
  const present = live.filter((a) => a.attendance === "presente").length;
  const absent = live.filter((a) => a.attendance === "ausente").length;
  const justified = live.filter((a) => a.attendance === "justificado").length;
  const proName = new Map(professionals.map((p) => [p.id, p.name]));
  const byPro = new Map<string, ProfessionalRow>();
  for (const a of live) {
    const key = a.professional_id ?? "__none__";
    const row = byPro.get(key) ?? {
      name: a.professional_id ? proName.get(a.professional_id) ?? "Otro profesional" : "Sin profesional",
      scheduled: 0, present: 0, absent: 0, justified: 0,
    };
    row.scheduled++;
    if (a.attendance === "presente") row.present++;
    if (a.attendance === "ausente") row.absent++;
    if (a.attendance === "justificado") row.justified++;
    byPro.set(key, row);
  }
  const attention = {
    scheduled: live.length,
    canceled: periodAppts.length - live.length,
    practices: present, // cada "presente" es una práctica registrada
    absent,
    justified,
    unmarked: live.length - present - absent - justified,
    absenteeism: present + absent > 0 ? Math.round((absent / (present + absent)) * 100) : null,
    telemed: live.filter((a) => a.modality === "telemedicina").length,
    byProfessional: [...byPro.values()].sort((a, b) => b.scheduled - a.scheduled),
  };

  // ── Ingreso: solicitudes, talleres y tiempo de espera ──
  const periodIntake = intake.filter((r) => inRange(localDateKey(r.created_at), range));
  const periodWorkshops = workshops.filter((w) => !w.canceled && inRange(w.workshop_date, range));
  const firstSession = new Map<string, string>();
  for (const a of appts) {
    if (a.attendance !== "presente" || !a.patient_id) continue;
    const prev = firstSession.get(a.patient_id);
    if (!prev || a.appointment_date < prev) firstSession.set(a.patient_id, a.appointment_date);
  }
  // Días desde la solicitud hasta la primera sesión, para quienes tuvieron su
  // primera sesión dentro del período
  const waits = intake.flatMap((r) => {
    const first = r.patient_id ? firstSession.get(r.patient_id) : undefined;
    if (!first || !inRange(first, range)) return [];
    const days = daysBetween(localDateKey(r.created_at), first);
    return days >= 0 ? [days] : [];
  });
  const enrolledIds = new Set(periodWorkshops.map((w) => w.id));
  const enrolled = intake.filter((r) => r.workshop_id && enrolledIds.has(r.workshop_id));
  const intakeStats = {
    received: periodIntake.length,
    byStatus: (Object.keys(INTAKE_STATUS_LABEL) as IntakeStatus[])
      .map((s) => ({ name: INTAKE_STATUS_LABEL[s], value: periodIntake.filter((r) => r.status === s).length })),
    workshops: periodWorkshops.length,
    workshopEnrolled: enrolled.length,
    workshopAttended: enrolled.filter((r) => r.workshop_attended).length,
    waitAvg: avg(waits),
    waitMedian: median(waits),
    waitCount: waits.length,
  };

  // ── Derivaciones ──
  const periodReferrals = liveReferrals.filter((r) => inRange(r.referral_date, range));
  const referralStats = {
    count: periodReferrals.length,
    registered: periodReferrals.filter((r) => r.registered).length,
    bySpecialty: topN(countBy(periodReferrals.map((r) => r.specialty.trim() || "Sin especialidad")), 10),
  };

  // ── Satisfacción (encuesta anónima) ──
  const periodSurveys = surveys.filter((s) => inRange(localDateKey(s.created_at), range));
  const satisfaction = {
    count: periodSurveys.length,
    attention: avg(periodSurveys.map((s) => s.rating_attention)),
    communication: avg(periodSurveys.map((s) => s.rating_communication)),
    treatment: avg(periodSurveys.map((s) => s.rating_treatment)),
    overall: avg(periodSurveys.map((s) => s.rating_overall)),
    recommend: periodSurveys.length ? Math.round((periodSurveys.filter((s) => s.would_recommend).length / periodSurveys.length) * 100) : null,
    comments: periodSurveys.filter((s) => s.comment).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)
      .map((s) => ({ date: localDateKey(s.created_at), text: s.comment!, respondent: s.respondent })),
  };

  return { range, current, admissions, attention, intake: intakeStats, referrals: referralStats, satisfaction };
}

export type Stats = ReturnType<typeof computeStats>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function countByMonth(dates: string[], start: string | null): Row[] {
  const today = todayKey();
  const from = start ?? (dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today);
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);
  const rows: Row[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ey, em] = today.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    rows.push({ name: `${MONTHS[m - 1]} ${String(y).slice(2)}`, value: counts.get(`${y}-${String(m).padStart(2, "0")}`) ?? 0 });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return rows;
}

function countBy(values: string[]): Row[] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

// Agrupa localidades escritas distinto ("yerba buena", "Yerba Buena ") bajo la forma más usada
function groupLocalities(values: (string | null)[]): Row[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  let missing = 0;
  for (const raw of values) {
    const v = raw?.trim().replace(/\s+/g, " ");
    if (!v) { missing++; continue; }
    const key = v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const g = groups.get(key) ?? { count: 0, spellings: new Map() };
    g.count++;
    g.spellings.set(v, (g.spellings.get(v) ?? 0) + 1);
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => ({
    name: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
    value: g.count,
  })).sort((a, b) => b.value - a.value);
  if (missing) rows.push({ name: "Sin dato", value: missing });
  return rows;
}

// Las primeras N y el resto sumado en "Otras" ("Sin dato" siempre queda aparte, al final)
function topN(rows: Row[], n: number): Row[] {
  const missing = rows.find((r) => r.name === "Sin dato");
  const rest = rows.filter((r) => r !== missing);
  const out = rest.slice(0, n);
  const others = rest.slice(n).reduce((sum, r) => sum + r.value, 0);
  if (others) out.push({ name: "Otras", value: others });
  if (missing) out.push(missing);
  return out;
}

// ─── Semanas (lunes a domingo) ───────────────────────────────────────────────

export function weekOf(dateKey: string): Range & { start: string; end: string } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const monday = new Date(dt);
  monday.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { start: key(monday), end: key(sunday) };
}

export function fmt1(n: number | null): string {
  return n === null ? "—" : n.toFixed(1).replace(".", ",");
}
