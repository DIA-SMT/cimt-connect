// Pruebas de cómo contactar a cada familia: tipo de teléfono, semáforo de
// autonomía en los recordatorios, dictado por voz y fecha de ingreso.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { acceptsWhatsApp } from "../src/lib/contact";
import { reminderPhoneKind, whatsappLink } from "../src/lib/reminders";
import { appendDictation } from "../src/components/Dictation";
import { computeStats, type StatPatient, type StatsData } from "../src/lib/stats";
import { normalizePatient, type PatientRecord } from "../src/lib/patients";
import type { AgendaAppointment } from "../src/lib/agenda";

describe("tipo de teléfono", () => {
  test("WhatsApp solo si tiene, o si no se sabe (fichas viejas)", () => {
    expect(acceptsWhatsApp("whatsapp")).toBe(true);
    expect(acceptsWhatsApp(null)).toBe(true);
    expect(acceptsWhatsApp("fijo")).toBe(false);
    expect(acceptsWhatsApp("celular")).toBe(false);
  });
});

describe("recordatorios según el teléfono", () => {
  const appt = (patients: Partial<NonNullable<AgendaAppointment["patients"]>>): AgendaAppointment => ({
    id: "a1", patient_id: "p1", professional_id: null, appointment_date: "2026-10-20", appointment_time: "10:00:00",
    duration_minutes: 30, status: "confirmado", consultation_type: "seguimiento", modality: "presencial", reason: "Sesión",
    attendance: null, practice_number: null, practice_registered_at: null,
    patients: { first_name: "Tomás", last_name: "Acosta", dni: "50222333", phone: "3814001122", guardian_phone: "3815556677",
      guardian_name: "Laura Acosta", patient_type: "niño", ...patients },
  });
  test("para un menor cuenta el teléfono del adulto responsable", () => {
    expect(reminderPhoneKind(appt({ phone_kind: "fijo", guardian_phone_kind: "whatsapp" }))).toBe("whatsapp");
    expect(whatsappLink(appt({ phone_kind: "fijo", guardian_phone_kind: "whatsapp" }))).toStartWith("https://wa.me/549381555");
  });
  test("si es fijo o no tiene WhatsApp, no se arma el mensaje (se avisa por llamada)", () => {
    expect(whatsappLink(appt({ guardian_phone_kind: "fijo" }))).toBeNull();
    expect(whatsappLink(appt({ guardian_phone_kind: "celular" }))).toBeNull();
  });
  test("adulto: su propio teléfono; sin dato, como antes", () => {
    expect(reminderPhoneKind(appt({ patient_type: "adulto", phone_kind: "fijo", guardian_phone_kind: "whatsapp" }))).toBe("fijo");
    expect(whatsappLink(appt({ patient_type: "adulto" }))).toStartWith("https://wa.me/549381400");
  });
});

describe("dictado por voz", () => {
  test("el primer dictado arranca con mayúscula; los siguientes se suman con un espacio", () => {
    expect(appendDictation("", "repite sílabas", false)).toBe("Repite sílabas");
    expect(appendDictation("Repite sílabas", "desde hace meses", false)).toBe("Repite sílabas desde hace meses");
  });
  test("en DNI y teléfono quedan solo los números", () => {
    expect(appendDictation("", "30 111 222", true)).toBe("30111222");
    expect(appendDictation("381", " 400-1122", true)).toBe("3814001122");
  });
  test("si no se entendió nada, no cambia el campo", () => {
    expect(appendDictation("Hola", "  ", false)).toBe("Hola");
  });
});

describe("fecha de ingreso", () => {
  test("las fichas viejas toman el día en que se crearon", () => {
    const p = normalizePatient({ created_at: "2026-03-10T15:00:00-03:00", admission_date: null } as unknown as PatientRecord);
    expect(p.admission_date).toBe("2026-03-10");
    const q = normalizePatient({ created_at: "2026-03-10T15:00:00-03:00", admission_date: "2025-06-02" } as unknown as PatientRecord);
    expect(q.admission_date).toBe("2025-06-02");
  });
  test("los ingresos de Estadísticas se cuentan por la fecha de ingreso", () => {
    const pat = (id: string, created: string, admission: string | null): StatPatient => ({
      id, created_at: `${created}T12:00:00-03:00`, admission_date: admission, locality: null, patient_type: "niño",
      case_status: "en_tratamiento", has_health_insurance: null, therapy_modes: [], other_conditions: [], age: 6,
    });
    const data: StatsData = {
      patients: [pat("a", "2026-10-01", "2025-06-02"), pat("b", "2026-10-01", null)],
      referrals: [], appts: [], intake: [], workshops: [], surveys: [], professionals: [],
    };
    expect(computeStats(data, { start: "2026-10-01", end: "2026-10-31" }).admissions.count).toBe(1);
    expect(computeStats(data, { start: "2025-06-01", end: "2025-06-30" }).admissions.count).toBe(1);
  });
});
