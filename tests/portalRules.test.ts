// Pruebas de las reglas puras del portal (src/lib/portalRules.ts), que usan
// el servidor y el modo mock. Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  addDaysKey, ageOn, arPhone10, canRequestHc, centerNow, computeApptDto, computeHcDto, confirmFrom,
  guardianEligibility, hcVisible, isNoticeOnTime, isValidDni, linkValidity, normalizeCode, normalizeDni,
  passwordProblem, samePhone, selfEligibility,
  type ApptInput, type HcRow, type LinkValidityInput,
} from "../src/lib/portalRules";

describe("fechas en la hora del centro", () => {
  test("centerNow pasa de UTC a Tucumán (UTC-3)", () => {
    expect(centerNow(new Date("2026-10-13T02:30:00Z"))).toEqual({ date: "2026-10-12", time: "23:30" });
    expect(centerNow(new Date("2026-10-13T15:05:00Z"))).toEqual({ date: "2026-10-13", time: "12:05" });
  });
  test("addDaysKey cruza meses y años", () => {
    expect(addDaysKey("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
  });
  test("ageOn cuenta el cumpleaños del día", () => {
    expect(ageOn("2008-10-13", "2026-10-13")).toBe(18);
    expect(ageOn("2008-10-14", "2026-10-13")).toBe(17);
  });
  test("confirmar desde 3 días antes", () => {
    expect(confirmFrom("2026-10-20")).toBe("2026-10-17");
  });
  test("un aviso es a tiempo si llega el día anterior o antes", () => {
    expect(isNoticeOnTime("2026-10-19T22:00:00-03:00", "2026-10-20")).toBe(true);
    expect(isNoticeOnTime("2026-10-20T08:00:00-03:00", "2026-10-20")).toBe(false);
  });
});

describe("DNI, códigos y contraseñas", () => {
  test("normaliza DNI con puntos y espacios", () => {
    expect(normalizeDni(" 30.111.222 ")).toBe("30111222");
    expect(isValidDni("30111222")).toBe(true);
    expect(isValidDni("123")).toBe(false);
  });
  test("normaliza el código de invitación", () => {
    expect(normalizeCode("12345 67890")).toBe("1234567890");
  });
  test("contraseña: largo y repetición", () => {
    expect(passwordProblem("abc", "abc", "30111222")).not.toBeNull();
    expect(passwordProblem("abcdefgh", "abcdefgx", "30111222")).toBe("Las contraseñas no coinciden.");
    expect(passwordProblem("abcdefgh", "abcdefgh", "30111222")).toBeNull();
  });
});

describe("teléfonos", () => {
  const cases: [string, string, boolean][] = [
    ["3863 15 421234", "3863 421234", true],
    ["03863-15-421234", "+54 9 3863 421234", true],
    ["381-4001122", "+54 9 381 400-1122", true],
    ["381 15 4001122", "3814001122", true],
    ["4001122", "381-4001122", true],
    ["3814001122", "381-4001122 / 381-5556677", true],
    ["381 5421234", "3865 421234", false],
    ["", "381-4001122", false],
  ];
  for (const [a, b, want] of cases) {
    test(`samePhone(${a} | ${b}) = ${want}`, () => expect(samePhone(a, b)).toBe(want));
  }
  test("arPhone10 saca el 15 con característica de 4 dígitos", () => {
    expect(arPhone10("3863 15 421234")).toBe("3863421234");
  });
});

describe("turnos tal como los ve la familia", () => {
  const now = { date: "2026-10-13", time: "10:00" };
  const base: ApptInput = {
    id: "a1", child_id: "p1", child_first_name: "Martín", date: "2026-10-20", time: "17:30",
    duration_minutes: 30, modality: "presencial", professional_name: "Lic. Ana Torres", cancelled: false,
  };
  test("sin respuesta: se puede avisar, todavía no confirmar", () => {
    const d = computeApptDto(base, null, "acc1", now);
    expect(d.can_decline).toBe(true);
    expect(d.can_confirm).toBe(false);
    expect(d.confirm_from).toBe("2026-10-17");
  });
  test("el motivo solo se muestra a quien avisó", () => {
    const last = { account_id: "acc2", kind: "no_puedo" as const, reason_code: "salud" as const, at: "2026-10-12T10:00:00Z", outcome: null };
    const d = computeApptDto(base, last, "acc1", now);
    expect(d.response?.by_me).toBe(false);
    expect(d.response?.reason_code).toBeUndefined();
  });
  test("una falta justificada en el turno resuelve el aviso", () => {
    const last = { account_id: "acc1", kind: "no_puedo" as const, reason_code: "salud" as const, at: "2026-10-12T10:00:00Z", outcome: null };
    const d = computeApptDto({ ...base, justified: true }, last, "acc1", now);
    expect(d.outcome).toBe("justificado");
    expect(d.can_decline).toBe(false);
  });
  test("un turno que ya pasó no acepta respuestas", () => {
    const d = computeApptDto({ ...base, date: "2026-10-13", time: "09:00" }, null, "acc1", now);
    expect(d.is_past).toBe(true);
    expect(d.can_decline).toBe(false);
  });
});

describe("pedidos de copia del historial", () => {
  const row: HcRow = {
    id: "r1", patient_id: "p1", status: "pendiente", created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T10:00:00Z",
    ready_at: null, delivered_at: null, reject_reason: "otro",
  };
  test("solo el titular y el representante legal pueden pedirla", () => {
    expect(canRequestHc("titular")).toBe(true);
    expect(canRequestHc("representante_legal")).toBe(true);
    expect(canRequestHc("autorizado")).toBe(false);
  });
  test("el motivo de rechazo solo viaja si está rechazado", () => {
    expect(computeHcDto(row, { display: "Martín", self: false }).reject_reason).toBeNull();
    expect(computeHcDto({ ...row, status: "rechazada" }, { display: "Martín", self: false }).reject_reason).toBe("otro");
  });
  test("un pedido cerrado se ve 60 días desde que se cerró", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    expect(hcVisible(row, now)).toBe(true); // abierto: siempre
    const closedLate = { ...row, status: "entregada" as const, updated_at: "2026-10-01T10:00:00Z" };
    expect(hcVisible(closedLate, now)).toBe(true);
    const closedLong = { ...row, status: "entregada" as const, updated_at: "2026-07-01T10:00:00Z" };
    expect(hcVisible(closedLong, now)).toBe(false);
  });
});

describe("vigencia de los vínculos", () => {
  const today = "2026-10-13";
  const minor = { id: "p1", dni: "50111222", birth_date: "2016-05-01", discharge_date: null };
  const teen16 = { id: "p1", dni: "50111222", birth_date: "2010-01-01", discharge_date: null };
  const adult = { id: "p1", dni: "30111222", birth_date: "1990-01-01", discharge_date: null };
  const guardian = { patient_id: "p1", dni: "28999888", active: true };
  const link = (o: Partial<LinkValidityInput>): LinkValidityInput => ({
    kind: "representante_legal", account_dni: "28999888", patient: minor, guardian, adolescent_consent_at: null, ...o,
  });

  test("representante legal de un chico: acceso y derecho a la copia", () => {
    expect(linkValidity(link({}), today)).toEqual({ valid: true, hc_ok: true });
  });
  test("adulto autorizado: acceso, sin derecho a la copia", () => {
    expect(linkValidity(link({ kind: "autorizado" }), today)).toEqual({ valid: true, hc_ok: false });
  });
  test("adulto quitado de la ficha: nada", () => {
    expect(linkValidity(link({ guardian: { ...guardian, active: false } }), today)).toEqual({ valid: false, hc_ok: false });
  });
  test("DNI distinto al de la cuenta: nada", () => {
    expect(linkValidity(link({ account_dni: "11111111" }), today)).toEqual({ valid: false, hc_ok: false });
  });
  test("con el alta: sin acceso, pero el derecho a la copia sigue", () => {
    expect(linkValidity(link({ patient: { ...minor, discharge_date: "2026-10-01" } }), today)).toEqual({ valid: false, hc_ok: true });
  });
  test("16 años sin conformidad: sin acceso, el derecho a la copia sigue", () => {
    expect(linkValidity(link({ patient: teen16 }), today)).toEqual({ valid: false, hc_ok: true });
    expect(linkValidity(link({ patient: teen16, adolescent_consent_at: "2026-09-01T10:00:00Z" }), today)).toEqual({ valid: true, hc_ok: true });
  });
  test("el chico cumplió 18: el adulto pierde todo", () => {
    expect(linkValidity(link({ patient: { ...minor, birth_date: "2008-10-13" } }), today)).toEqual({ valid: false, hc_ok: false });
  });
  test("titular adulto con su DNI", () => {
    expect(linkValidity({ kind: "titular", account_dni: "30111222", patient: adult, guardian: null, adolescent_consent_at: null }, today))
      .toEqual({ valid: true, hc_ok: true });
  });
  test("titular con el alta: sin acceso, con derecho a la copia", () => {
    expect(linkValidity({ kind: "titular", account_dni: "30111222", patient: { ...adult, discharge_date: "2026-10-01" }, guardian: null, adolescent_consent_at: null }, today))
      .toEqual({ valid: false, hc_ok: true });
  });
  test("eligibility: falta la fecha de nacimiento", () => {
    expect(guardianEligibility({ birth_date: null, discharge_date: null }, today).ok).toBe(false);
    expect(selfEligibility({ birth_date: null, discharge_date: null }, today).ok).toBe(false);
  });
});
