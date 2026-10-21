import { describe, expect, test } from "bun:test";
import { bookedMessage, reminderMessage, whatsappLink } from "../src/lib/reminders";

const child = {
  first_name: "Martín", last_name: "Pérez", dni: "50111222", phone: "3815551234",
  guardian_phone: "381 555-9876", guardian_name: "Laura Gómez", patient_type: "nino",
  phone_kind: "whatsapp" as const, guardian_phone_kind: "whatsapp" as const,
};
const appt = { appointment_date: "2026-11-02", appointment_time: "10:00:00", modality: "presencial" as const, patients: child };

describe("aviso de turno nuevo", () => {
  test("primer turno de un chico: le escribe al adulto, con día, hora y profesional, sin datos clínicos", () => {
    const m = bookedMessage({ ...appt, consultation_type: "primera_vez" }, "Lic. Ana Torres");
    expect(m).toContain("¡Hola, Laura!");
    expect(m).toContain("Ya tenemos el primer turno de Martín");
    expect(m).toContain("a las 10:00 hs con Lic. Ana Torres");
    expect(m).toContain("Si no pueden asistir");
    expect(m).not.toContain("recordamos");
  });
  test("varias semanas y telemedicina; un adulto lo recibe a su nombre", () => {
    const adult = { ...appt, modality: "telemedicina" as const, consultation_type: "seguimiento" as const,
      patients: { ...child, patient_type: "adulto", guardian_name: null } };
    const m = bookedMessage(adult, undefined, 4);
    expect(m).toContain("¡Hola, Martín!");
    expect(m).toContain("Ya tenemos tu turno");
    expect(m).toContain("por telemedicina");
    expect(m).toContain("durante 4 semanas");
  });
  test("el link de WhatsApp lleva el mensaje que se le pasa; sin WhatsApp, no hay link", () => {
    const link = whatsappLink(appt, undefined, "hola");
    expect(link).toBe("https://wa.me/5493815559876?text=hola");
    expect(whatsappLink({ ...appt, patients: { ...child, guardian_phone_kind: "fijo" } })).toBeNull();
    expect(whatsappLink(appt)).toContain(encodeURIComponent(reminderMessage(appt)));
  });
});
