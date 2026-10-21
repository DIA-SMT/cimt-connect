// «Lo último que se hizo» en el Resumen del panel: cada fila del historial de
// cambios (audit_log, script 11) contada en palabras simples. Solo dice QUÉ se
// hizo y a quién, nunca el contenido clínico (notas, diagnósticos, informes).
// Funciones puras: las datos de nombres los arma la pestaña Resumen.

export type AuditRow = {
  id: number | string;
  table_name: string;
  record_id: string | null;
  patient_id: string | null;
  action: "insert" | "update" | string;
  changes: Record<string, unknown> | null;
  changed_by_email: string | null;
  changed_at: string;
};

export type ActivityKind = "solicitud" | "turno" | "asistencia" | "aviso" | "ficha" | "clinico" | "anulado";

export type ActivityNames = {
  /** "Martín Villagra" (o null si no se conoce) */
  patient: (id: string | null) => string | null;
  /** Nombre de la persona de la solicitud */
  request: (id: string | null) => string | null;
  /** "Lic. María Elena Rodríguez" */
  professional: (id: string | null) => string | null;
};

export type Activity = { kind: ActivityKind; text: string };

const STATUS_TEXT: Record<string, string> = {
  contactada: "marcó como contactada",
  taller: "anotó al taller",
  admitida: "admitió",
  no_corresponde: "cerró (no corresponde)",
  nueva: "volvió a «nueva»",
};
const ATTENDANCE_TEXT: Record<string, string> = {
  presente: "marcó presente a",
  ausente: "marcó ausente a",
  justificado: "justificó la falta de",
};

type Change = [unknown, unknown];
const changed = (c: Record<string, unknown> | null, k: string): Change | null =>
  c && Array.isArray(c[k]) && (c[k] as unknown[]).length === 2 ? (c[k] as Change) : null;

const ddmm = (key: unknown) => {
  const s = String(key ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : "";
};
const hhmm = (t: unknown) => String(t ?? "").slice(0, 5);

/** La frase (sin quién ni cuándo: eso lo pone la pestaña). null = no se muestra. */
export function describeActivity(row: AuditRow, names: ActivityNames): Activity | null {
  const c = row.changes ?? {};
  const ins = row.action === "insert";
  const who = names.patient(row.patient_id) ?? "un paciente";
  const voided = changed(c, "voided_at");
  if (voided && voided[1]) return { kind: "anulado", text: `anuló un registro de ${who}` };

  switch (row.table_name) {
    case "intake_requests": {
      const person = ins ? [c.first_name, c.last_name].filter(Boolean).join(" ") || "una persona" : names.request(row.record_id) ?? "una persona";
      if (ins) return { kind: "solicitud", text: `llegó una solicitud de turno de ${person}` };
      const assigned = changed(c, "assigned_professional_id");
      if (assigned) {
        return assigned[1]
          ? { kind: "solicitud", text: `derivó la solicitud de ${person} a ${names.professional(String(assigned[1])) ?? "un profesional"}` }
          : { kind: "solicitud", text: `quitó la derivación de la solicitud de ${person}` };
      }
      const st = changed(c, "status");
      if (st && STATUS_TEXT[String(st[1])]) return { kind: "solicitud", text: `${STATUS_TEXT[String(st[1])]} la solicitud de ${person}` };
      if (changed(c, "workshop_attended")) return { kind: "solicitud", text: `marcó la asistencia al taller de ${person}` };
      if (changed(c, "notes")) return { kind: "solicitud", text: `dejó una nota en la solicitud de ${person}` };
      return null;
    }
    case "appointments": {
      if (ins) {
        const pro = names.professional(c.professional_id ? String(c.professional_id) : null);
        return { kind: "turno", text: `dio un turno a ${who} para el ${ddmm(c.appointment_date)} a las ${hhmm(c.appointment_time)}${pro ? ` con ${pro}` : ""}` };
      }
      const st = changed(c, "status");
      if (st && st[1] === "cancelado") return { kind: "turno", text: `canceló el turno de ${who}` };
      const att = changed(c, "attendance");
      if (att && att[1] && ATTENDANCE_TEXT[String(att[1])]) return { kind: "asistencia", text: `${ATTENDANCE_TEXT[String(att[1])]} ${who}` };
      const rem = changed(c, "reminder_sent_at");
      if (rem) {
        if (!rem[1]) return { kind: "aviso", text: `desmarcó el recordatorio de ${who}` };
        const ch = changed(c, "reminder_channel")?.[1];
        return { kind: "aviso", text: `le recordó el turno a ${who}${ch === "whatsapp" ? " por WhatsApp" : ch === "llamada" ? " por teléfono" : ""}` };
      }
      if (changed(c, "appointment_date") || changed(c, "appointment_time")) return { kind: "turno", text: `cambió el turno de ${who}` };
      return null;
    }
    case "patients":
      if (ins) return { kind: "ficha", text: `creó la ficha de ${who}` };
      if (changed(c, "case_status")) return { kind: "ficha", text: `cambió el estado del caso de ${who}` };
      if (changed(c, "professional_id")) return { kind: "ficha", text: `cambió el profesional a cargo de ${who}` };
      if (changed(c, "photo_path")) return { kind: "ficha", text: `actualizó la foto de ${who}` };
      return { kind: "ficha", text: `actualizó la ficha de ${who}` };
    case "patient_guardians":
      return ins
        ? { kind: "ficha", text: `agregó un adulto responsable a ${who}` }
        : { kind: "ficha", text: `editó un adulto responsable de ${who}` };
    case "patient_followups":
      return ins ? { kind: "clinico", text: `escribió una nota de seguimiento de ${who}` } : null;
    case "patient_reports":
      return { kind: "clinico", text: ins ? `cargó un informe de ${who}` : `editó un informe de ${who}` };
    case "patient_referrals": {
      if (ins) return { kind: "clinico", text: `cargó una ${c.kind === "interconsulta" ? "interconsulta" : "derivación"} de ${who}` };
      const reg = changed(c, "registered");
      if (reg && reg[1]) return { kind: "clinico", text: `registró una derivación de ${who}` };
      if (changed(c, "outcome")) return { kind: "clinico", text: `cargó la respuesta de una derivación de ${who}` };
      return { kind: "clinico", text: `actualizó una derivación de ${who}` };
    }
    case "clinical_forms": {
      const st = changed(c, "status");
      if (ins) return { kind: "clinico", text: `empezó una evaluación por área de ${who}` };
      if (st && st[1] === "completa") return { kind: "clinico", text: `completó una evaluación por área de ${who}` };
      return null;
    }
    case "patient_files":
      return ins ? { kind: "ficha", text: `subió un adjunto a la ficha de ${who}` } : null;
    default:
      return null;
  }
}

/** Día local (no el de UTC) de un registro: lo de las 22 hs queda en su día. */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Hoy", "Ayer" o "martes 14/10", según el día del registro. */
export function dayLabel(iso: string, todayKey: string): string {
  const key = localDayKey(iso);
  if (key === todayKey) return "Hoy";
  const t = new Date(`${todayKey}T12:00:00`);
  t.setDate(t.getDate() - 1);
  const y = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  if (key === y) return "Ayer";
  const d = new Date(`${key}T12:00:00`);
  return `${d.toLocaleDateString("es-AR", { weekday: "long" })} ${key.slice(8, 10)}/${key.slice(5, 7)}`;
}
