// Ficha interna de pacientes: tipos, etiquetas y exportación.
// Esquema en supabase/sql_para_copiar/7_ficha_pacientes.sql

export type PatientType = "niño" | "adolescente" | "adulto";
export type CaseStatus = "en_evaluacion" | "en_tratamiento" | "derivado" | "alta" | "abandono";
export type CudStatus = "si" | "no" | "en_tramite";
export type ReferralKind = "derivacion" | "interconsulta";
export type ReferralStatus = "pendiente" | "realizada" | "cancelada";
export type TherapyMode = "individual" | "grupal" | "gam" | "familia";

export type PatientRecord = {
  id: string;
  first_name: string;
  last_name: string;
  dni: string;
  age: number;
  phone: string;
  email: string | null;
  patient_type: PatientType;
  notes: string | null;
  case_status: CaseStatus;
  professional_id: string | null;
  referred_by: string | null;
  main_diagnosis: string | null;
  other_conditions: string[];
  cud_status: CudStatus | null;
  is_medicated: boolean;
  medication: string | null;
  has_health_insurance: boolean | null; // null = sin dato
  health_insurance: string | null;       // nombre de la obra social
  school: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  locality: string | null;
  therapy_modes: TherapyMode[];
  created_at: string;
  updated_at: string;
};

export type Referral = {
  id: string;
  patient_id: string;
  kind: ReferralKind;
  specialty: string;
  destination: string | null;
  reason: string | null;
  referral_date: string;
  status: ReferralStatus;
  outcome: string | null;
  registered: boolean; // casilla "interconsulta registrada"
  created_by: string | null;
  created_at: string;
};

export type Followup = {
  id: string;
  patient_id: string;
  note_date: string;
  note: string;
  author_email: string | null;
  created_at: string;
};

export type Report = {
  id: string;
  patient_id: string;
  report_date: string;
  professional_id: string | null;
  diagnosis: string | null;
  progress: string | null;
  therapy_evolution: string | null;
  author_email: string | null;
  created_at: string;
};

export type ProfessionalOption = { id: string; name: string; specialty: string };

// ── Etiquetas ────────────────────────────────────────────────────────────────

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  en_evaluacion: "En evaluación",
  en_tratamiento: "En tratamiento",
  derivado: "Derivado",
  alta: "Alta",
  abandono: "Abandono",
};

// Colores de los badges de estado (variables de styles.css)
export const CASE_STATUS_COLOR: Record<CaseStatus, { bg: string; fg: string }> = {
  en_evaluacion: { bg: "var(--status-pending-bg)", fg: "var(--status-pending)" },
  en_tratamiento: { bg: "var(--status-available-bg)", fg: "var(--status-available)" },
  derivado: { bg: "var(--primary-soft)", fg: "var(--primary-deep)" },
  alta: { bg: "var(--muted)", fg: "var(--muted-foreground)" },
  abandono: { bg: "var(--status-occupied-bg)", fg: "var(--status-occupied)" },
};

export const PATIENT_TYPE_LABEL: Record<PatientType, string> = {
  niño: "Niño/a",
  adolescente: "Adolescente",
  adulto: "Adulto",
};

export const THERAPY_MODE_LABEL: Record<TherapyMode, string> = {
  individual: "Individual",
  grupal: "Grupal",
  gam: "GAM (grupo de ayuda mutua)",
  familia: "Acompañamiento familiar",
};

export const CUD_LABEL: Record<CudStatus, string> = {
  si: "Tiene CUD",
  no: "No tiene",
  en_tramite: "En trámite",
};

export function insuranceLabel(p: Pick<PatientRecord, "has_health_insurance" | "health_insurance">): string {
  if (p.has_health_insurance === true) return p.health_insurance ? `Con obra social (${p.health_insurance})` : "Con obra social";
  if (p.has_health_insurance === false) return "Sin obra social";
  return "Sin dato";
}

export const REFERRAL_KIND_LABEL: Record<ReferralKind, string> = {
  derivacion: "Derivación",
  interconsulta: "Interconsulta",
};

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  pendiente: "Pendiente",
  realizada: "Realizada",
  cancelada: "Cancelada",
};

// Sugerencias rápidas; también se puede escribir cualquier otra
export const CONDITION_OPTIONS = [
  "TEA",
  "TDAH",
  "Discapacidad intelectual",
  "Síndrome de Down",
  "Parálisis cerebral",
  "Hipoacusia",
  "Retraso del lenguaje",
  "Trastorno de ansiedad",
  "Epilepsia",
] as const;

export const SPECIALTY_OPTIONS = [
  "Neurología",
  "Neuropediatría",
  "Psiquiatría",
  "Psicología",
  "Psicopedagogía",
  "Fonoaudiología",
  "Terapia ocupacional",
  "Otorrinolaringología",
  "Pediatría",
  "Trabajo social",
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

// Filas viejas o recién creadas pueden traer null en las columnas agregadas después
export function normalizePatient(p: PatientRecord): PatientRecord {
  return {
    ...p,
    other_conditions: p.other_conditions ?? [],
    therapy_modes: p.therapy_modes ?? [],
    is_medicated: !!p.is_medicated,
    has_health_insurance: p.has_health_insurance ?? null,
    locality: p.locality ?? null,
  };
}

export function fullName(p: Pick<PatientRecord, "first_name" | "last_name">): string {
  return `${p.last_name}, ${p.first_name}`;
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatShortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Resumen por paciente que se muestra en la planilla y se exporta
export type PatientStats = {
  pendingReferrals: number;
  unregisteredReferrals: number;
  totalReferrals: number;
  lastFollowup?: string;
  lastReport?: string;
};

// ── Exportación a Excel (CSV con ; y BOM para que Excel en español lo abra bien) ──

export function exportPatientsCsv(
  patients: PatientRecord[],
  professionals: ProfessionalOption[],
  stats: Map<string, PatientStats>,
) {
  const proName = new Map(professionals.map((p) => [p.id, p.name]));
  const header = [
    "Apellido", "Nombre", "DNI", "Edad", "Tipo", "Teléfono", "Email", "Localidad",
    "Tutor/responsable", "Tel. tutor", "Escolaridad", "¿Obra social?", "Obra social",
    "Estado", "Profesional a cargo", "Terapia", "Derivado por", "Diagnóstico / motivo",
    "Otras condiciones", "CUD", "Medicado", "Medicación",
    "Derivaciones pendientes", "Interconsultas registradas", "Último informe", "Último seguimiento", "Notas",
  ];
  const rows = patients.map((p) => {
    const st = stats.get(p.id);
    return [
      p.last_name, p.first_name, p.dni, p.age, PATIENT_TYPE_LABEL[p.patient_type], p.phone, p.email, p.locality,
      p.guardian_name, p.guardian_phone, p.school,
      p.has_health_insurance === null ? "" : p.has_health_insurance ? "Con obra social" : "Sin obra social",
      p.has_health_insurance ? p.health_insurance : "",
      CASE_STATUS_LABEL[p.case_status], p.professional_id ? proName.get(p.professional_id) : "",
      p.therapy_modes.map((m) => THERAPY_MODE_LABEL[m]).join(", "),
      p.referred_by, p.main_diagnosis,
      p.other_conditions.join(", "), p.cud_status ? CUD_LABEL[p.cud_status] : "",
      p.is_medicated ? "Sí" : "No", p.medication,
      st?.pendingReferrals ?? 0,
      st?.totalReferrals ? `${st.totalReferrals - st.unregisteredReferrals} de ${st.totalReferrals}` : "",
      st?.lastReport ? formatShortDate(st.lastReport) : "",
      st?.lastFollowup ? formatShortDate(st.lastFollowup) : "",
      p.notes,
    ];
  });

  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(escape).join(";")).join("\r\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pacientes-cimt-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
