// Recordatorios de turno (etapa A): WhatsApp con un clic desde el panel.
// El mensaje se abre ya escrito en WhatsApp (web o app) con la cuenta que el
// equipo tenga abierta en ese dispositivo; la persona solo toca "enviar".

import { CENTER } from "@/lib/center";
import { formatShortDate, todayKey } from "@/lib/patients";
import { addDays, fromMinutes, toMinutes, type AgendaAppointment } from "@/lib/agenda";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ReminderChannel = "whatsapp" | "llamada" | "email";

export const REMINDER_CHANNEL_LABEL: Record<ReminderChannel, string> = {
  whatsapp: "WhatsApp",
  llamada: "llamada",
  email: "email",
};

// Número en formato internacional para wa.me (Argentina: 54 9 + característica
// + número, sin 0 ni 15). Devuelve null si no se puede interpretar.
export function whatsappNumber(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) {
    d = d.slice(2);
    if (d.startsWith("9")) d = d.slice(1);
  }
  if (d.startsWith("0")) d = d.slice(1);
  // Sin característica (7 dígitos): se asume San Miguel de Tucumán (381)
  if (d.length === 7) d = `381${d}`;
  // Con el 15 de celular: 381 15 5551234 → 381 5551234
  if (d.length === 12) {
    for (const areaLen of [3, 4, 2]) {
      if (d.slice(areaLen, areaLen + 2) === "15") {
        d = d.slice(0, areaLen) + d.slice(areaLen + 2);
        break;
      }
    }
  }
  return d.length === 10 ? `549${d}` : null;
}

// A quién se le escribe: para menores, al adulto responsable principal
export function reminderPhone(a: AgendaAppointment): string | null {
  const p = a.patients;
  if (!p) return null;
  const minor = p.patient_type !== "adulto";
  return minor ? p.guardian_phone || p.phone : p.phone || p.guardian_phone;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function dayLabel(dateKey: string): string {
  if (dateKey === todayKey()) return "hoy";
  if (dateKey === addDays(todayKey(), 1)) return "mañana";
  const [y, m, d] = dateKey.split("-").map(Number);
  return `el ${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${formatShortDate(dateKey).slice(0, 5)}`;
}

// Mensaje mínimo: sin diagnóstico ni datos clínicos
export function reminderMessage(a: AgendaAppointment, professionalName?: string): string {
  const p = a.patients;
  const minor = p?.patient_type !== "adulto";
  const guardianFirst = p?.guardian_name?.trim().split(/\s+/)[0];
  const greeting = minor && guardianFirst ? `¡Hola, ${guardianFirst}!` : p ? `¡Hola, ${p.first_name}!` : "¡Hola!";
  const who = minor && p ? `el turno de ${p.first_name}` : "tu turno";
  const when = `${dayLabel(a.appointment_date)} a las ${fromMinutes(toMinutes(a.appointment_time))} hs`;
  const where = a.modality === "telemedicina" ? "por telemedicina" : `en ${CENTER.address}`;
  const withPro = professionalName ? ` con ${professionalName}` : "";
  return `${greeting} Te recordamos ${who} en el CIMT (Centro Integral Municipal de Tartamudez) ${when}${withPro}, ${where}. ` +
    `Si no ${minor ? "pueden" : "podés"} asistir, avisanos respondiendo este mensaje o llamando al ${CENTER.phoneDisplay}. ¡Gracias!`;
}

export function whatsappLink(a: AgendaAppointment, professionalName?: string): string | null {
  const number = whatsappNumber(reminderPhone(a));
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(reminderMessage(a, professionalName))}`;
}

// Marca o desmarca el aviso del turno. Devuelve los datos guardados (o null si falló).
export async function setReminder(appointmentId: string, channel: ReminderChannel | null, email: string) {
  const patch = channel
    ? { reminder_sent_at: new Date().toISOString(), reminder_sent_by: email, reminder_channel: channel }
    : { reminder_sent_at: null, reminder_sent_by: null, reminder_channel: null };
  const { error } = await supabase.from("appointments").update(patch).eq("id", appointmentId);
  if (error) {
    toast.error("No se pudo guardar el aviso");
    return null;
  }
  return patch;
}
