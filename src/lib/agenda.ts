// Fase 2: circuito de ingreso y agenda por profesional.
// Esquema en supabase/sql_para_copiar/12_circuito_turnos.sql

import type { PatientType } from "@/lib/patients";

export type IntakeStatus = "nueva" | "contactada" | "taller" | "admitida" | "no_corresponde";
export type Attendance = "presente" | "ausente" | "justificado";
export type Modality = "presencial" | "telemedicina";

export type IntakeRequest = {
  id: string;
  first_name: string;
  last_name: string;
  dni: string;
  age: number;
  patient_type: PatientType;
  phone: string;
  email: string | null;
  guardian_name: string | null;
  locality: string | null;
  preferred_modality: Modality;
  referred_by: string | null;
  reason: string;
  status: IntakeStatus;
  workshop_id: string | null;
  workshop_attended: boolean | null;
  patient_id: string | null;
  notes: string | null;
  created_at: string;
};

export type Workshop = {
  id: string;
  workshop_date: string;
  start_time: string;
  place: string;
  capacity: number | null;
  notes: string | null;
  canceled: boolean;
};

export type ScheduleBlock = {
  id: string;
  block_date: string;
  start_time: string | null;
  end_time: string | null;
  professional_id: string | null;
  reason: string;
  active: boolean;
};

export type AgendaAppointment = {
  id: string;
  patient_id: string | null;
  professional_id: string | null;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  status: "pendiente" | "confirmado" | "cancelado";
  consultation_type: "primera_vez" | "seguimiento";
  modality: Modality | null;
  reason: string;
  attendance: Attendance | null;
  practice_number: number | null;
  practice_registered_at: string | null;
  patients: { first_name: string; last_name: string; dni: string; phone: string; guardian_phone: string | null } | null;
};

export const INTAKE_STATUS_LABEL: Record<IntakeStatus, string> = {
  nueva: "Nueva",
  contactada: "Contactada",
  taller: "Anotada al taller",
  admitida: "Admitida",
  no_corresponde: "No corresponde",
};

export const INTAKE_STATUS_COLOR: Record<IntakeStatus, { bg: string; fg: string }> = {
  nueva: { bg: "var(--status-pending-bg)", fg: "var(--status-pending)" },
  contactada: { bg: "var(--primary-soft)", fg: "var(--primary-deep)" },
  taller: { bg: "var(--primary-soft)", fg: "var(--primary-deep)" },
  admitida: { bg: "var(--status-available-bg)", fg: "var(--status-available)" },
  no_corresponde: { bg: "var(--muted)", fg: "var(--muted-foreground)" },
};

export const ATTENDANCE_LABEL: Record<Attendance, string> = {
  presente: "Presente",
  ausente: "Ausente",
  justificado: "Ausente justificado",
};

// Franja de atención del centro (respuesta: lunes a viernes de 07 a 18 hs)
export const AGENDA_START_MIN = 7 * 60;
export const AGENDA_END_MIN = 18 * 60;

export function toMinutes(time: string): number {
  const [h, m] = time.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function isWeekendKey(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  return dow === 0 || dow === 6;
}

// Próximo día hábil (para "Turnos de mañana": el viernes muestra el lunes)
export function nextWorkday(dateKey: string): string {
  let next = addDays(dateKey, 1);
  while (isWeekendKey(next)) next = addDays(next, 1);
  return next;
}

export function longDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}

// Un bloqueo afecta a un turno si es del mismo día, del mismo profesional (o de
// todo el centro) y se superpone en horario (o es de día completo)
export function blockAffects(b: ScheduleBlock, a: Pick<AgendaAppointment, "appointment_date" | "appointment_time" | "duration_minutes" | "professional_id">): boolean {
  if (!b.active || b.block_date !== a.appointment_date) return false;
  if (b.professional_id && b.professional_id !== a.professional_id) return false;
  if (!b.start_time || !b.end_time) return true;
  const start = toMinutes(a.appointment_time);
  return toMinutes(b.start_time) < start + a.duration_minutes && toMinutes(b.end_time) > start;
}

// Los errores de las reglas de agenda vienen como "CODIGO: mensaje"
export function agendaErrorMessage(message: string | undefined): string {
  const code = message?.split(":")[0];
  if (code === "OVERLAP" || code === "BLOCKED") return message!.slice(code.length + 1).trim();
  return "No se pudo guardar el turno";
}
