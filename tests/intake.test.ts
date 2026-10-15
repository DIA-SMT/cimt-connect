// Pruebas de la solicitud de turno del sitio (src/lib/intake.ts): turno para
// uno mismo o para un menor (adulto responsable + consentimiento informado).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  CONSENT_VERSION, intakeGuardianError, localityWithProvince, parseIntake, type IntakeRpcArgs,
} from "../src/lib/intake";

const common = {
  phone: "381 400-1122", email: "", province: "Tucumán", locality: "Yerba Buena",
  address: "Av. Aconquija 1200", preferred_modality: "presencial", referred_by: "", reason: "Repite sílabas al hablar",
};
const adult = { for: "yo", first_name: "Martín", last_name: "Sosa", dni: "33444555", age: "38", ...common };
const minor = {
  for: "menor", guardian_first_name: "Laura", guardian_last_name: "Acosta", guardian_dni: "28111222",
  guardian_relationship: "madre", first_name: "Tomás", last_name: "Acosta", dni: "50222333", age: "5",
  patient_type: "niño", consent: "on", ...common,
};

function errorOf(raw: Record<string, string>): string {
  const r = parseIntake(raw);
  return r.ok ? "" : r.error;
}

describe("turno para uno mismo (18 o más)", () => {
  test("arma los argumentos sin datos de adulto responsable", () => {
    const r = parseIntake(adult);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args).toMatchObject({
      p_first_name: "Martín", p_dni: "33444555", p_age: 38, p_patient_type: "adulto", p_email: null,
      p_province: "Tucumán", p_guardian_name: null, p_guardian_dni: null, p_guardian_consent: false, p_consent_version: null,
    });
  });
  test("con menos de 18 lo manda a pedirlo como menor", () => {
    expect(errorOf({ ...adult, age: "17" })).toContain("adulto responsable");
  });
  test("sin elegir para quién es, no sigue", () => {
    expect(errorOf({ ...adult, for: "" })).toBe("Elegí para quién es el turno");
  });
  test("provincia fuera de la lista", () => {
    expect(errorOf({ ...adult, province: "Atlántida" })).toBe("Elegí la provincia");
  });
  test("domicilio sin número (o s/n)", () => {
    expect(errorOf({ ...adult, address: "Barrio Norte" })).toContain("número de la calle");
    expect(parseIntake({ ...adult, address: "Calle s/n, frente a la plaza" }).ok).toBe(true);
  });
});

describe("turno para un menor: adulto responsable y consentimiento", () => {
  test("une nombre y apellido del adulto y guarda la versión del consentimiento", () => {
    const r = parseIntake(minor);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args).toMatchObject({
      p_first_name: "Tomás", p_age: 5, p_patient_type: "niño",
      p_guardian_name: "Laura Acosta", p_guardian_dni: "28111222", p_guardian_relationship: "madre",
      p_guardian_consent: true, p_consent_version: CONSENT_VERSION,
    });
  });
  test("sin aceptar el consentimiento no se envía", () => {
    expect(errorOf({ ...minor, consent: "" })).toContain("consentimiento informado");
  });
  test("el DNI del adulto tiene que ser distinto del paciente", () => {
    expect(errorOf({ ...minor, guardian_dni: "50222333" })).toContain("distinto");
  });
  test("faltan datos del adulto responsable", () => {
    expect(errorOf({ ...minor, guardian_dni: "12" })).toBe("DNI del adulto responsable inválido");
    expect(errorOf({ ...minor, guardian_relationship: "" })).toContain("vínculo");
    expect(errorOf({ ...minor, guardian_first_name: "" })).toContain("adulto responsable");
  });
  test("edades: desde 2 y hasta 17", () => {
    expect(errorOf({ ...minor, age: "1" })).toContain("a partir de los 2");
    expect(errorOf({ ...minor, age: "18" })).toContain("«Para mí»");
    expect(parseIntake({ ...minor, age: "17", patient_type: "adolescente" }).ok).toBe(true);
  });
  test("un menor no puede ser 'adulto'", () => {
    expect(errorOf({ ...minor, patient_type: "adulto" })).toContain("niño/a o adolescente");
  });
});

describe("reglas de la base (las usa el modo demo)", () => {
  const ok = parseIntake(minor);
  const minorArgs = (ok.ok ? ok.args : {}) as IntakeRpcArgs;
  const adultOk = parseIntake(adult);
  const adultArgs = (adultOk.ok ? adultOk.args : {}) as IntakeRpcArgs;

  test("lo que arma el formulario pasa", () => {
    expect(intakeGuardianError(minorArgs)).toBeNull();
    expect(intakeGuardianError(adultArgs)).toBeNull();
  });
  test("el formulario viejo (sin DNI del adulto ni consentimiento) pide actualizar la página", () => {
    const old = { ...minorArgs, p_guardian_dni: undefined, p_guardian_relationship: undefined, p_guardian_consent: undefined };
    expect(intakeGuardianError(old)).toStartWith("INVALID_GUARDIAN:");
    expect(intakeGuardianError(old)).toContain("actualizá la página");
  });
  test("sin consentimiento o sin versión", () => {
    expect(intakeGuardianError({ ...minorArgs, p_guardian_consent: false })).toStartWith("INVALID_CONSENT:");
    expect(intakeGuardianError({ ...minorArgs, p_consent_version: "" })).toStartWith("INVALID_CONSENT:");
  });
  test("menor de 18 marcado como adulto", () => {
    expect(intakeGuardianError({ ...adultArgs, p_age: 16 })).toStartWith("INVALID_AGE:");
  });
  test("mismo DNI que el paciente", () => {
    expect(intakeGuardianError({ ...minorArgs, p_guardian_dni: minorArgs.p_dni })).toStartWith("INVALID_GUARDIAN_DNI:");
  });
  test("provincia inválida", () => {
    expect(intakeGuardianError({ ...adultArgs, p_province: "Narnia" })).toStartWith("INVALID_PROVINCE:");
  });
});

describe("localidad con provincia (panel y ficha)", () => {
  test("solo agrega la provincia si no es Tucumán", () => {
    expect(localityWithProvince("Yerba Buena", "Tucumán")).toBe("Yerba Buena");
    expect(localityWithProvince("Rosario", "Santa Fe")).toBe("Rosario (Santa Fe)");
    expect(localityWithProvince("Lules", null)).toBe("Lules");
    expect(localityWithProvince(null, "Salta")).toBeNull();
    expect(localityWithProvince("Córdoba", "Córdoba")).toBe("Córdoba");
  });
});
