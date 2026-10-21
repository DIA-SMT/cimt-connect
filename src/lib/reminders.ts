// Recordatorios de turno (etapa A): WhatsApp con un clic desde el panel.
// El mensaje se abre ya escrito en WhatsApp (web o app) con la cuenta que el
// equipo tenga abierta en ese dispositivo; la persona solo toca "enviar".

import { CENTER } from "@/lib/center";
import { acceptsWhatsApp, type PhoneKind } from "@/lib/contact";
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

// Lo que hace falta del turno para avisar (el de la Agenda o uno recién dado)
export type ApptContact = Pick<AgendaAppointment, "patients" | "appointment_date" | "appointment_time" | "modality">;

// A quién se le escribe: para menores, al adulto responsable principal
export function reminderPhone(a: Pick<AgendaAppointment, "patients">): string | null {
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

// Partes del mensaje que comparten el recordatorio y el aviso de turno nuevo
function messageParts(a: ApptContact, professionalName?: string) {
  const p = a.patients;
  const minor = p?.patient_type !== "adulto";
  const guardianFirst = p?.guardian_name?.trim().split(/\s+/)[0];
  return {
    minor,
    greeting: minor && guardianFirst ? `¡Hola, ${guardianFirst}!` : p ? `¡Hola, ${p.first_name}!` : "¡Hola!",
    when: `${dayLabel(a.appointment_date)} a las ${fromMinutes(toMinutes(a.appointment_time))} hs`,
    where: a.modality === "telemedicina" ? "por telemedicina" : `en ${CENTER.address}`,
    withPro: professionalName ? ` con ${professionalName}` : "",
    cancel: `Si no ${minor ? "pueden" : "podés"} asistir, avisanos respondiendo este mensaje o llamando al ${CENTER.phoneDisplay}. ¡Gracias!`,
  };
}

// Mensaje mínimo: sin diagnóstico ni datos clínicos
export function reminderMessage(a: ApptContact, professionalName?: string): string {
  const m = messageParts(a, professionalName);
  const p = a.patients;
  const who = m.minor && p ? `el turno de ${p.first_name}` : "tu turno";
  return `${m.greeting} Te recordamos ${who} en el CIMT (Dirección Centro Integral Municipal de Tartamudez) ${m.when}${m.withPro}, ${m.where}. ` +
    m.cancel;
}

// Aviso al dar un turno (al admitir una derivación o desde la ficha). No es el
// recordatorio: ese se manda igual el día anterior. weekly: cuántas semanas
// seguidas quedó (1 si es uno solo). Sin datos clínicos
export function bookedMessage(
  a: ApptContact & { consultation_type?: "primera_vez" | "seguimiento" },
  professionalName?: string,
  weekly = 1,
): string {
  const m = messageParts(a, professionalName);
  const p = a.patients;
  const first = a.consultation_type === "primera_vez";
  const turno = first ? "el primer turno" : "un turno";
  const who = m.minor && p ? `${turno} de ${p.first_name}` : first ? "tu primer turno" : "tu turno";
  const repeat = weekly > 1 ? ` Queda el mismo día y horario durante ${weekly} semanas.` : "";
  return `${m.greeting} Te escribimos del CIMT (Dirección Centro Integral Municipal de Tartamudez). ` +
    `Ya tenemos ${who}: ${m.when}${m.withPro}, ${m.where}.${repeat} ${m.cancel}`;
}

// El tipo del teléfono al que se le escribe (mismo criterio que reminderPhone)
export function reminderPhoneKind(a: Pick<AgendaAppointment, "patients">): PhoneKind | null {
  const p = a.patients;
  if (!p) return null;
  const minor = p.patient_type !== "adulto";
  const useGuardian = minor ? !!p.guardian_phone : !p.phone && !!p.guardian_phone;
  return (useGuardian ? p.guardian_phone_kind : p.phone_kind) ?? null;
}

export function whatsappLink(a: ApptContact, professionalName?: string, message?: string): string | null {
  // Un fijo o un celular sin WhatsApp no recibe el mensaje: se avisa por llamada
  if (!acceptsWhatsApp(reminderPhoneKind(a))) return null;
  const number = whatsappNumber(reminderPhone(a));
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message ?? reminderMessage(a, professionalName))}`;
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
