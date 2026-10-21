// Pruebas de «Lo último que se hizo» (src/lib/activity.ts): cada fila del
// historial de cambios contada en palabras, sin contenido clínico.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { type AuditRow, dayLabel, describeActivity, localDayKey } from "../src/lib/activity";

const names = {
  patient: (id: string | null) => (id === "p1" ? "Martín Villagra" : null),
  request: (id: string | null) => (id === "r1" ? "Tomás Acosta" : null),
  professional: (id: string | null) => (id === "pro1" ? "Lic. María Elena Rodríguez" : null),
};
const row = (table_name: string, action: string, changes: Record<string, unknown>, extra: Partial<AuditRow> = {}): AuditRow => ({
  id: 1, table_name, record_id: "r1", patient_id: "p1", action, changes, changed_by_email: "lina@smt.gob.ar", changed_at: "2026-10-21T13:00:00Z", ...extra,
});

describe("describeActivity", () => {
  test("solicitudes: llega, se deriva y se admite", () => {
    expect(describeActivity(row("intake_requests", "insert", { first_name: "Tomás", last_name: "Acosta" }, { patient_id: null }), names)?.text)
      .toBe("llegó una solicitud de turno de Tomás Acosta");
    expect(describeActivity(row("intake_requests", "update", { assigned_professional_id: [null, "pro1"] }), names)?.text)
      .toBe("derivó la solicitud de Tomás Acosta a Lic. María Elena Rodríguez");
    expect(describeActivity(row("intake_requests", "update", { status: ["taller", "admitida"] }), names)?.text)
      .toBe("admitió la solicitud de Tomás Acosta");
  });
  test("turnos: se da, asistencia y recordatorio", () => {
    expect(describeActivity(row("appointments", "insert", { appointment_date: "2026-10-22", appointment_time: "10:30:00", professional_id: "pro1" }), names)?.text)
      .toBe("dio un turno a Martín Villagra para el 22/10 a las 10:30 con Lic. María Elena Rodríguez");
    expect(describeActivity(row("appointments", "update", { attendance: [null, "presente"] }), names)?.text).toBe("marcó presente a Martín Villagra");
    expect(describeActivity(row("appointments", "update", { reminder_sent_at: [null, "2026-10-21T13:00:00Z"], reminder_channel: [null, "whatsapp"] }), names)?.text)
      .toBe("le recordó el turno a Martín Villagra por WhatsApp");
    expect(describeActivity(row("appointments", "update", { status: ["confirmado", "cancelado"] }), names)?.text).toBe("canceló el turno de Martín Villagra");
  });
  test("lo clínico se cuenta sin su contenido", () => {
    const a = describeActivity(row("patient_followups", "insert", { note: "Texto clínico privado" }), names);
    expect(a?.text).toBe("escribió una nota de seguimiento de Martín Villagra");
    expect(a?.text.includes("privado")).toBe(false);
    expect(describeActivity(row("patient_reports", "update", { voided_at: [null, "2026-10-21"] }), names)?.text).toBe("anuló un registro de Martín Villagra");
  });
  test("un cambio sin interés no se muestra", () => {
    expect(describeActivity(row("appointments", "update", { practice_registered_at: [null, "x"] }), names)).toBeNull();
  });
});

describe("días", () => {
  test("Hoy, Ayer y el día de la semana", () => {
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const today = localDayKey(now.toISOString());
    expect(dayLabel(now.toISOString(), today)).toBe("Hoy");
    const ayer = new Date(now); ayer.setDate(ayer.getDate() - 1);
    expect(dayLabel(ayer.toISOString(), today)).toBe("Ayer");
  });
});
