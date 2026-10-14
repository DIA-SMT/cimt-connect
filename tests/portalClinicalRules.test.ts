// Pruebas de la regla de acceso a la información de salud (etapa A).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  type ClinicalAccessInput,
  CLINICAL_NOTICE_VERSION, adolescentAgreed, clinicalAccess, parseFeatures, publicOutcome, reauthFresh,
} from "../src/lib/portalClinicalRules";
import { linkValidity } from "../src/lib/portalRules";

const ON = { info_enabled: true, practice_enabled: true, paused_at: null, adolescent_agreed_on: null, adolescent_withdrawn_on: null };

// Todo en orden: madre verificada en el centro, con la información activada
const base: ClinicalAccessInput = {
  link_kind: "representante_legal", link_valid: true, hc_ok: true, age: 8,
  verified_in_person: true, parental_checked: true, settings: ON, clinical_consent: true, blocked: false,
};
const block = (i: Partial<ClinicalAccessInput>, area: "info" | "practice" | "hc" = "info") => {
  const r = clinicalAccess({ ...base, ...i }, area);
  return r.ok ? null : r.block;
};

describe("etapas", () => {
  test("solo se prenden las etapas conocidas", () => {
    expect(parseFeatures("consent, info,xxx")).toEqual(["consent", "info"]);
    expect(parseFeatures("")).toEqual([]);
    expect(parseFeatures(undefined)).toEqual([]);
  });
  test("hay una versión del aviso de información de salud", () => {
    expect(CLINICAL_NOTICE_VERSION.length).toBeGreaterThan(0);
  });
});

describe("quién ve información de salud", () => {
  test("todo en orden: la ve", () => {
    expect(block({})).toBeNull();
    expect(block({}, "practice")).toBeNull();
    expect(block({}, "hc")).toBeNull();
  });
  test("titular adulto verificado: la ve sin documentación parental", () => {
    expect(block({ link_kind: "titular", age: 30, parental_checked: false })).toBeNull();
  });
  test("adulto autorizado: nunca", () => {
    expect(block({ link_kind: "autorizado" })).toBe("autorizado");
    expect(block({ link_kind: "autorizado" }, "hc")).toBe("autorizado");
  });
  test("orden judicial: nunca, ni la copia", () => {
    expect(block({ blocked: true })).toBe("bloqueado");
    expect(block({ blocked: true }, "hc")).toBe("bloqueado");
  });
  test("vínculo que no vale hoy", () => {
    expect(block({ link_valid: false })).toBe("sin_vinculo");
  });
  test("con el alta: no ve información, pero puede recibir la copia", () => {
    expect(block({ link_valid: false, hc_ok: true }, "info")).toBe("sin_vinculo");
    expect(block({ link_valid: false, hc_ok: true }, "hc")).toBeNull();
  });
  test("el profesional todavía no lo prendió", () => {
    expect(block({ settings: null })).toBe("no_habilitado");
    expect(block({ settings: { ...ON, info_enabled: false } })).toBe("no_habilitado");
    expect(block({ settings: { ...ON, practice_enabled: false } }, "practice")).toBe("no_habilitado");
    expect(block({ settings: { ...ON, info_enabled: false } }, "practice")).toBeNull();
  });
  test("la copia digital no depende de que el profesional lo haya prendido", () => {
    expect(block({ settings: null }, "hc")).toBeNull();
  });
  test("pausa por indicación profesional o judicial", () => {
    expect(block({ settings: { ...ON, paused_at: "2026-10-01T10:00:00Z" } })).toBe("pausado");
  });
  test("la pausa también corta la copia digital (en mano se sigue pidiendo aparte)", () => {
    const paused = { ...ON, paused_at: "2026-10-01T10:00:00Z" };
    expect(block({ settings: paused }, "hc")).toBe("pausado");
    expect(block({ settings: paused }, "practice")).toBe("pausado");
    // Aunque el profesional no haya prendido nada, la pausa vale para la copia
    expect(block({ settings: { ...paused, info_enabled: false, practice_enabled: false } }, "hc")).toBe("pausado");
    // Sin pausa (o sin configuración) la copia sigue siendo un derecho
    expect(block({ settings: { ...ON, info_enabled: false, practice_enabled: false } }, "hc")).toBeNull();
    // La pausa se informa antes que lo que le falta a la cuenta
    expect(block({ settings: paused, verified_in_person: false, clinical_consent: false }, "hc")).toBe("pausado");
    // Lo que va antes que la pausa sigue igual
    expect(block({ settings: paused, link_kind: "autorizado" }, "hc")).toBe("autorizado");
    expect(block({ settings: paused, blocked: true }, "hc")).toBe("bloqueado");
    expect(block({ settings: paused, hc_ok: false }, "hc")).toBe("sin_vinculo");
    // Hacia la familia, sin decir por qué
    expect(publicOutcome(clinicalAccess({ ...base, settings: paused }, "hc"))).toBe("not_available");
  });
  test("adolescente sin conformidad", () => {
    expect(block({ age: 14 })).toBe("conformidad_adolescente");
    expect(block({ age: 14, settings: { ...ON, adolescent_agreed_on: "2026-10-01" } })).toBeNull();
    expect(block({ age: 14, settings: { ...ON, adolescent_agreed_on: "2026-10-01", adolescent_withdrawn_on: "2026-10-05" } }))
      .toBe("conformidad_adolescente");
    expect(block({ age: 14 }, "hc")).toBeNull(); // la copia es un derecho
  });
  test("falta verificar en persona", () => {
    expect(block({ verified_in_person: false })).toBe("no_verificado");
    expect(block({ parental_checked: false })).toBe("no_verificado");
    expect(block({ verified_in_person: false }, "hc")).toBe("no_verificado");
  });
  test("la cuenta no activó la información de salud", () => {
    expect(block({ clinical_consent: false })).toBe("consentimiento");
  });
});

describe("lo que sale hacia la familia", () => {
  test("nunca el motivo real", () => {
    expect(publicOutcome({ ok: true })).toBe("ok");
    expect(publicOutcome({ ok: false, block: "consentimiento" })).toBe("consent");
    expect(publicOutcome({ ok: false, block: "no_verificado" })).toBe("verify");
    for (const b of ["autorizado", "bloqueado", "sin_vinculo", "no_habilitado", "pausado", "conformidad_adolescente"] as const) {
      expect(publicOutcome({ ok: false, block: b })).toBe("not_available");
    }
  });
});

describe("conformidad del adolescente", () => {
  test("solo hace falta de 13 a 17", () => {
    expect(adolescentAgreed(null, 12)).toBe(true);
    expect(adolescentAgreed(null, 13)).toBe(false);
    expect(adolescentAgreed(null, 18)).toBe(true);
    expect(adolescentAgreed(null, null)).toBe(true);
  });
  test("si la retiró y después la volvió a dar, vale", () => {
    expect(adolescentAgreed({ adolescent_agreed_on: "2026-10-10", adolescent_withdrawn_on: "2026-10-05" }, 15)).toBe(true);
  });
});

describe("volver a poner la contraseña", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  test("para ver información: 12 horas desde el último uso", () => {
    expect(reauthFresh({ verified_at: "2026-10-13T08:00:00Z", last_info_at: null }, "info", now)).toBe(true);
    expect(reauthFresh({ verified_at: "2026-10-12T20:00:00Z", last_info_at: null }, "info", now)).toBe(false);
    expect(reauthFresh({ verified_at: "2026-10-12T20:00:00Z", last_info_at: "2026-10-13T11:00:00Z" }, "info", now)).toBe(true);
  });
  test("para descargar: 15 minutos desde la contraseña", () => {
    expect(reauthFresh({ verified_at: "2026-10-13T11:50:00Z", last_info_at: "2026-10-13T11:59:00Z" }, "download", now)).toBe(true);
    expect(reauthFresh({ verified_at: "2026-10-13T11:40:00Z", last_info_at: "2026-10-13T11:59:00Z" }, "download", now)).toBe(false);
  });
  test("sin contraseña confirmada en esta sesión: hay que ponerla", () => {
    expect(reauthFresh(null, "info", now)).toBe(false);
  });
});

describe("bloqueo judicial en el vínculo", () => {
  test("un adulto bloqueado pierde todo, también los turnos", () => {
    const l = {
      kind: "representante_legal", account_dni: "28999888",
      patient: { id: "p1", dni: "50111222", birth_date: "2016-05-01", discharge_date: null },
      guardian: { patient_id: "p1", dni: "28999888", active: true }, adolescent_consent_at: null,
    };
    expect(linkValidity(l, "2026-10-13")).toEqual({ valid: true, hc_ok: true });
    expect(linkValidity({ ...l, blocked: true }, "2026-10-13")).toEqual({ valid: false, hc_ok: false });
  });
});
