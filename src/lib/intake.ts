// Solicitud de turno del sitio (/turnos). Reglas compartidas por el
// formulario, el modo demo y los tests; la base valida lo mismo en
// submit_intake_request (28_turno_menor_consentimiento.sql).
//
// Si la persona que se va a atender es menor de 18, el turno lo pide su
// adulto responsable: primero van sus datos, después los del paciente, y al
// final da el consentimiento informado (queda la fecha y la versión del texto).

import { z } from "zod";
import { CENTER, HOME_PROVINCE, PROVINCES } from "@/lib/center";
import { PHONE_KINDS, type PhoneKind } from "@/lib/contact";

export const ADULT_AGE = 18;

/** Para quién es el turno: la propia persona (18+) o un menor a cargo */
export type IntakeFor = "yo" | "menor";

export const GUARDIAN_RELATIONSHIP_LABEL = {
  madre: "Madre",
  padre: "Padre",
  tutor: "Tutor/a legal",
  otro: "Otro familiar o adulto a cargo",
} as const;
export type GuardianRelationship = keyof typeof GUARDIAN_RELATIONSHIP_LABEL;
const RELATIONSHIPS = Object.keys(GUARDIAN_RELATIONSHIP_LABEL) as [GuardianRelationship, ...GuardianRelationship[]];

// Consentimiento informado del adulto responsable. BORRADOR: lo tiene que
// revisar Legales antes de publicarlo. Si cambia el texto, cambiar también la
// versión (queda guardada en cada solicitud, para saber qué texto se aceptó).
export const CONSENT_VERSION = "2026-10-borrador";
export const CONSENT_TITLE = "Consentimiento informado del adulto responsable";
export const CONSENT_POINTS = [
  `Pido el ingreso de la persona menor de edad de esta solicitud a la ${CENTER.name} (CIMT), de la Municipalidad de San Miguel de Tucumán, y autorizo que el equipo interdisciplinario haga la evaluación inicial.`,
  "Sé que la atención es gratuita y voluntaria. Antes de empezar un tratamiento, el equipo me va a explicar en qué consiste, para qué sirve y qué alternativas hay (Ley 26.529 de Derechos del Paciente). Puedo hacer todas las preguntas que quiera y retirar este consentimiento cuando quiera.",
  "Autorizo que los datos personales y de salud de esta solicitud se usen solo para organizar la atención, de forma confidencial (Ley 25.326 de Protección de Datos Personales). Puedo pedir verlos y corregirlos.",
  "Declaro que los datos son verdaderos y que la persona menor de edad está a mi cargo. El equipo puede pedirme la documentación que lo acredite.",
  "La opinión de la persona menor de edad se va a tener en cuenta según su edad y su madurez.",
] as const;

const DNI_RE = /^\d{6,10}$/;

// Calle y número (o "s/n"): el centro lo necesita para la ficha y para ubicar a la familia
export function addressHasNumber(v: string): boolean {
  return /\d/.test(v) || /(^|[^a-z])s\s*\/\s*n([^a-z]|$)/i.test(v);
}

const base = {
  first_name: z.string().trim().min(2, "Nombre requerido").max(60),
  last_name: z.string().trim().min(2, "Apellido requerido").max(60),
  dni: z.string().trim().regex(DNI_RE, "DNI inválido"),
  phone: z.string().trim().min(6, "Teléfono requerido").max(25),
  // Para saber si se le puede escribir por WhatsApp o hay que llamar (script 31)
  phone_kind: z.enum(PHONE_KINDS as [PhoneKind, ...PhoneKind[]], { errorMap: () => ({ message: "Indicá qué tipo de teléfono es" }) }),
  email: z.string().trim().email("Email inválido").max(120).optional().or(z.literal("")),
  province: z.enum(PROVINCES, { errorMap: () => ({ message: "Elegí la provincia" }) }),
  locality: z.string().trim().min(2, "Indicá la localidad").max(80),
  address: z.string().trim().min(5, "Indicá el domicilio: calle y número").max(150)
    .refine(addressHasNumber, "Indicá el número de la calle (o «s/n» si no tiene)"),
  preferred_modality: z.enum(["presencial", "telemedicina"]),
  referred_by: z.string().trim().max(120),
  reason: z.string().trim().min(5, "Contanos brevemente el motivo").max(800),
};

const adultSchema = z.object({
  for: z.literal("yo"),
  ...base,
  age: z.coerce.number().int()
    .min(ADULT_AGE, `Si tenés menos de ${ADULT_AGE} años, el turno lo pide tu adulto responsable: elegí «Para un/a menor a mi cargo».`)
    .max(120, "Revisá la edad"),
});

const minorSchema = z.object({
  for: z.literal("menor"),
  ...base,
  age: z.coerce.number().int()
    .min(CENTER.minAge, `El centro atiende a partir de los ${CENTER.minAge} años`)
    .max(ADULT_AGE - 1, `Si la persona tiene ${ADULT_AGE} años o más, elegí «Para mí»: el turno lo pide ella.`),
  patient_type: z.enum(["niño", "adolescente"], { errorMap: () => ({ message: "Indicá si es niño/a o adolescente" }) }),
  guardian_first_name: z.string().trim().min(2, "Nombre del adulto responsable requerido").max(40),
  guardian_last_name: z.string().trim().min(2, "Apellido del adulto responsable requerido").max(39),
  guardian_dni: z.string().trim().regex(DNI_RE, "DNI del adulto responsable inválido"),
  guardian_relationship: z.enum(RELATIONSHIPS, { errorMap: () => ({ message: "Indicá el vínculo con la persona que se va a atender" }) }),
  consent: z.literal("on", { errorMap: () => ({ message: "Para pedir el turno tenés que aceptar el consentimiento informado" }) }),
}).refine((d) => d.guardian_dni !== d.dni, {
  message: "El DNI del adulto responsable tiene que ser distinto del de la persona que se va a atender",
  path: ["guardian_dni"],
});

/** Argumentos de la RPC submit_intake_request */
export type IntakeRpcArgs = {
  p_first_name: string;
  p_last_name: string;
  p_dni: string;
  p_age: number;
  p_patient_type: "niño" | "adolescente" | "adulto";
  p_phone: string;
  p_email: string | null;
  p_guardian_name: string | null;
  p_locality: string;
  p_preferred_modality: "presencial" | "telemedicina";
  p_referred_by: string | null;
  p_reason: string;
  p_address: string;
  p_province: string;
  p_guardian_dni: string | null;
  p_guardian_relationship: GuardianRelationship | null;
  p_guardian_consent: boolean;
  p_consent_version: string | null;
  p_phone_kind: PhoneKind;
};

/** Valida lo que cargó la persona y lo convierte en los argumentos de la RPC */
export function parseIntake(raw: Record<string, string>): { ok: true; args: IntakeRpcArgs } | { ok: false; error: string } {
  const schema = raw.for === "menor" ? minorSchema : raw.for === "yo" ? adultSchema : null;
  if (!schema) return { ok: false, error: "Elegí para quién es el turno" };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos" };
  const d = parsed.data;
  const common = {
    p_first_name: d.first_name,
    p_last_name: d.last_name,
    p_dni: d.dni,
    p_age: d.age,
    p_phone: d.phone,
    p_email: d.email || null,
    p_locality: d.locality,
    p_preferred_modality: d.preferred_modality,
    p_referred_by: d.referred_by || null,
    p_reason: d.reason,
    p_address: d.address,
    p_province: d.province,
    p_phone_kind: d.phone_kind,
  };
  if (d.for === "yo") {
    return {
      ok: true,
      args: {
        ...common, p_patient_type: "adulto", p_guardian_name: null, p_guardian_dni: null,
        p_guardian_relationship: null, p_guardian_consent: false, p_consent_version: null,
      },
    };
  }
  return {
    ok: true,
    args: {
      ...common,
      p_patient_type: d.patient_type,
      p_guardian_name: `${d.guardian_first_name} ${d.guardian_last_name}`,
      p_guardian_dni: d.guardian_dni,
      p_guardian_relationship: d.guardian_relationship,
      p_guardian_consent: true,
      p_consent_version: CONSENT_VERSION,
    },
  };
}

/**
 * Las reglas que agrega la base para menores (mismo código de error que
 * submit_intake_request). La usa el modo demo; null si está todo bien.
 */
export function intakeGuardianError(a: Partial<Record<keyof IntakeRpcArgs, unknown>>): string | null {
  const age = Number(a.p_age);
  const minor = age < ADULT_AGE || a.p_patient_type !== "adulto";
  if (a.p_province != null && !(PROVINCES as readonly string[]).includes(String(a.p_province))) {
    return "INVALID_PROVINCE: Elegí la provincia";
  }
  if (a.p_phone_kind != null && !(PHONE_KINDS as string[]).includes(String(a.p_phone_kind))) {
    return "INVALID_PHONE: Indicá qué tipo de teléfono es";
  }
  if (!minor) return null;
  if (a.p_patient_type === "adulto") {
    return `INVALID_AGE: Si la persona tiene menos de ${ADULT_AGE} años, el turno lo pide su adulto responsable`;
  }
  const name = String(a.p_guardian_name ?? "").trim();
  if (name.length < 3 || name.length > 80 || !RELATIONSHIPS.includes(a.p_guardian_relationship as GuardianRelationship)) {
    return "INVALID_GUARDIAN: Completá los datos del adulto responsable (si no ves esos campos, actualizá la página)";
  }
  const gDni = String(a.p_guardian_dni ?? "").trim();
  if (!DNI_RE.test(gDni)) return "INVALID_GUARDIAN_DNI: DNI del adulto responsable inválido";
  if (gDni === String(a.p_dni ?? "").trim()) {
    return "INVALID_GUARDIAN_DNI: El DNI del adulto responsable tiene que ser distinto del de la persona que se va a atender";
  }
  if (a.p_guardian_consent !== true || !String(a.p_consent_version ?? "").trim()) {
    return "INVALID_CONSENT: Para pedir un turno para un menor, el adulto responsable tiene que dar su consentimiento informado";
  }
  return null;
}

/** "Yerba Buena" o "Rosario (Santa Fe)": la provincia solo si no es Tucumán (ni repite la localidad) */
export function localityWithProvince(locality: string | null, province: string | null | undefined): string | null {
  if (!locality) return locality;
  const same = province?.toLocaleLowerCase("es") === locality.trim().toLocaleLowerCase("es");
  return province && province !== HOME_PROVINCE && !same ? `${locality} (${province})` : locality;
}
