// Pruebas de las reglas puras del portal (src/lib/portalRules.ts), que usan
// el servidor y el modo mock. Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  HC_NOTICE_DAYS, HC_RECENT_CLOSED_DAYS,
  addDaysKey, ageOn, arPhone10, canRequestHc, centerNow, computeApptDto, computeHcDto, confirmFrom,
  guardianEligibility, hcClosedAt, hcIsOpen, hcRejectNotices, hcRejectedFresh, hcVisible, isNoticeOnTime, isValidDni,
  linkValidity, normalizeCode, normalizeDni, passwordProblem, samePhone, selfEligibility, splitHcRequests,
  type ApptInput, type HcRequestDTO, type HcRow, type LinkValidityInput,
} from "../src/lib/portalRules";
import { HC_REJECT_TEXT, hcStatus } from "../src/lib/portal";

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

describe("pedidos de copia cerrados: que no se acumulen", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = new Date("2026-10-15T15:00:00.000Z");
  const ago = (days: number, ms = 0) => new Date(NOW.getTime() - days * DAY - ms).toISOString();
  const row: HcRow = {
    id: "r1", patient_id: "p1", status: "pendiente", created_at: ago(20), updated_at: ago(20),
    ready_at: null, delivered_at: null, reject_reason: null, channel: "mano", sent_at: null,
    rejected_at: null, cancelled_at: null,
  };
  const doc = { id: "d1", label: "Historia clínica", code: "ABCD-1234" };
  // Un pedido tal como le llega a la familia
  let n = 0;
  const dto = (o: Partial<HcRequestDTO> = {}): HcRequestDTO => ({
    id: `q${++n}`, patient_id: "p1", child_first_name: "Martín", is_self: false, status: "pendiente",
    created_at: ago(40), ready_at: null, delivered_at: null, reject_reason: null, can_cancel: false, child_page: true,
    channel: "mano", sent_at: null, available_until: null, documents: [], closed_at: null, ...o,
  });
  const closedAgo = (status: HcRequestDTO["status"], days: number, o: Partial<HcRequestDTO> = {}) =>
    dto({ status, created_at: ago(days + 2), closed_at: ago(days), ...o });
  const ids = (list: HcRequestDTO[]) => list.map((r) => r.id);

  test("hcClosedAt: abierto, null; cerrado, la columna del paso que lo cerró", () => {
    expect(hcClosedAt(row)).toBeNull();
    expect(hcClosedAt({ ...row, status: "lista" })).toBeNull();
    expect(hcClosedAt({ ...row, status: "entregada", delivered_at: ago(9) })).toBe(ago(9));
    expect(hcClosedAt({ ...row, status: "enviada", sent_at: ago(8) })).toBe(ago(8));
    expect(hcClosedAt({ ...row, status: "rechazada", rejected_at: ago(7) })).toBe(ago(7));
    expect(hcClosedAt({ ...row, status: "cancelada", cancelled_at: ago(6) })).toBe(ago(6));
  });

  test("hcClosedAt: un cambio posterior (updated_at más nuevo) no mueve el cierre", () => {
    expect(hcClosedAt({ ...row, status: "rechazada", rejected_at: ago(10), updated_at: ago(1) })).toBe(ago(10));
  });

  test("hcClosedAt: sin la columna (pedido viejo o sin leerla), updated_at", () => {
    expect(hcClosedAt({ ...row, status: "rechazada", rejected_at: undefined, updated_at: ago(3) })).toBe(ago(3));
    expect(hcClosedAt({ ...row, status: "cancelada", cancelled_at: null, updated_at: ago(4) })).toBe(ago(4));
  });

  test("computeHcDto lleva closed_at, pero no rejected_at ni cancelled_at", () => {
    const d = computeHcDto({ ...row, status: "rechazada", reject_reason: "otro", rejected_at: ago(2), updated_at: ago(1) },
      { display: "Martín", self: false }, [], NOW);
    expect(d.closed_at).toBe(ago(2));
    expect(d).not.toHaveProperty("rejected_at");
    expect(d).not.toHaveProperty("cancelled_at");
    expect(d).not.toHaveProperty("updated_at");
    expect(computeHcDto(row, { display: "Martín", self: false }, [], NOW).closed_at).toBeNull();
  });

  test("hcIsOpen: pendiente, lista y enviada mientras se puede descargar", () => {
    expect(hcIsOpen(dto({ status: "pendiente" }))).toBe(true);
    expect(hcIsOpen(dto({ status: "lista" }))).toBe(true);
    const sent = dto({ status: "enviada", sent_at: ago(10), closed_at: ago(10), available_until: ago(-50), documents: [doc] });
    expect(hcIsOpen(sent)).toBe(true);
    // Con documentos manda el servidor, aunque el reloj del teléfono ya pasó la fecha
    expect(hcIsOpen({ ...sent, available_until: ago(0, 1) })).toBe(true);
    // Sin descarga (venció en el servidor, o la copia digital apagada): cerrada
    expect(hcIsOpen({ ...sent, documents: [] })).toBe(false);
    for (const status of ["entregada", "rechazada", "cancelada"] as const) expect(hcIsOpen(dto({ status }))).toBe(false);
  });

  test("enviada al borde de vencer: con documentos sigue a la vista (como el aviso del inicio)", () => {
    // Enviada hace casi 60 días; el teléfono adelantado ya pasó la fecha
    const sent = dto({ status: "enviada", sent_at: ago(59), closed_at: ago(59), available_until: ago(0, 1), documents: [doc] });
    const delivered = closedAgo("entregada", 5);
    const out = splitHcRequests([delivered, sent], NOW);
    expect(ids(out.current)).toEqual([sent.id, delivered.id]);
    expect(out.older).toEqual([]);
  });

  test("hcRejectedFresh: hasta 7 días justos desde el rechazo", () => {
    expect(HC_NOTICE_DAYS).toBe(7);
    expect(hcRejectedFresh(closedAgo("rechazada", 0), NOW)).toBe(true);
    expect(hcRejectedFresh(closedAgo("rechazada", 7), NOW)).toBe(true);
    expect(hcRejectedFresh(closedAgo("rechazada", 7, { closed_at: ago(7, 1) }), NOW)).toBe(false);
    expect(hcRejectedFresh(closedAgo("entregada", 1), NOW)).toBe(false);
    // Sin closed_at cuenta desde el pedido
    expect(hcRejectedFresh(dto({ status: "rechazada", created_at: ago(8), closed_at: null }), NOW)).toBe(false);
  });

  test("rechazada en gris (pasada la semana): el texto sigue diciendo que se cerró", () => {
    const dup = closedAgo("rechazada", 10, { reject_reason: "duplicado" });
    const st = hcStatus(dup, NOW);
    expect(st.tone).toBe("muted");
    expect(st.text).toBe(HC_REJECT_TEXT.duplicado);
    expect(st.text).toContain("Cerramos este pedido");
    // El mismo texto que en rojo
    expect(hcStatus(dup, new Date(Date.parse(dup.closed_at!) + DAY))).toEqual({ tone: "bad", text: st.text });
  });

  test("aviso del inicio: el rechazo más nuevo de cada persona, con su página y de la última semana", () => {
    const fresh = closedAgo("rechazada", 3, { patient_id: "a" });
    expect(ids(hcRejectNotices([fresh], NOW))).toEqual([fresh.id]);
    expect(hcRejectNotices([closedAgo("rechazada", 8, { patient_id: "a" })], NOW)).toEqual([]);
    expect(hcRejectNotices([{ ...fresh, child_page: false }], NOW)).toEqual([]);
    // Después pidió otra: el rechazo ya no se avisa
    const again = dto({ patient_id: "a", status: "pendiente", created_at: ago(1) });
    expect(hcRejectNotices([again, fresh], NOW)).toEqual([]);
  });

  test("aviso del inicio con varias personas: cada una por su cuenta, del más nuevo al más viejo", () => {
    const a = closedAgo("rechazada", 5, { patient_id: "a", created_at: ago(6) });
    const b = closedAgo("rechazada", 1, { patient_id: "b", created_at: ago(2) });
    const stale = closedAgo("rechazada", 9, { patient_id: "c" });
    const cOld = closedAgo("rechazada", 2, { patient_id: "d", created_at: ago(4) });
    const cNew = dto({ patient_id: "d", status: "lista", created_at: ago(1) });
    expect(ids(hcRejectNotices([a, stale, cOld, b, cNew], NOW))).toEqual([b.id, a.id]);
  });

  test("una persona: abiertos arriba; de los cerrados, solo el más nuevo y de los últimos 30 días", () => {
    const open = dto({ status: "pendiente", created_at: ago(1) });
    const newest = closedAgo("rechazada", 12);
    const mid = closedAgo("entregada", 20);
    const old = closedAgo("cancelada", 45);
    const out = splitHcRequests([old, newest, open, mid], NOW);
    expect(ids(out.current)).toEqual([open.id, newest.id]);
    expect(ids(out.older)).toEqual([mid.id, old.id]);
  });

  test("el cerrado más nuevo se ve entero hasta 30 días justos", () => {
    expect(HC_RECENT_CLOSED_DAYS).toBe(30);
    const edge = closedAgo("entregada", 30);
    expect(ids(splitHcRequests([edge], NOW).current)).toEqual([edge.id]);
    const past = closedAgo("entregada", 30, { closed_at: ago(30, 1) });
    const out = splitHcRequests([past], NOW);
    expect(out.current).toEqual([]);
    expect(ids(out.older)).toEqual([past.id]);
  });

  test("lo que se ve entero va por cuándo se cerró, no por cuándo se pidió", () => {
    // Pedido antes, pero cerrado después
    const late = closedAgo("rechazada", 2, { created_at: ago(25) });
    const early = closedAgo("cancelada", 5, { created_at: ago(6) });
    const out = splitHcRequests([early, late], NOW);
    expect(ids(out.current)).toEqual([late.id]);
    expect(ids(out.older)).toEqual([early.id]);
  });

  test("enviada: abierta mientras se descarga; vencida, cuenta como cerrada desde el envío", () => {
    const sentOpen = dto({ status: "enviada", sent_at: ago(10), closed_at: ago(10), available_until: ago(-50), documents: [doc] });
    const rejected = closedAgo("rechazada", 3);
    let out = splitHcRequests([rejected, sentOpen], NOW);
    expect(ids(out.current)).toEqual([sentOpen.id, rejected.id]);
    expect(out.older).toEqual([]);

    // Vencida (sin descarga): compite con los cerrados por cuándo se envió
    const sentGone = dto({ status: "enviada", sent_at: ago(10), closed_at: ago(10), available_until: ago(-50), documents: [] });
    out = splitHcRequests([sentGone, rejected], NOW);
    expect(ids(out.current)).toEqual([rejected.id]);
    expect(ids(out.older)).toEqual([sentGone.id]);
  });

  test("varias personas («Tus pedidos»): el cerrado más nuevo de cada una", () => {
    const a1 = closedAgo("rechazada", 5, { patient_id: "a" });
    const a2 = closedAgo("entregada", 10, { patient_id: "a" });
    const b1 = closedAgo("entregada", 20, { patient_id: "b" });
    const b2 = closedAgo("cancelada", 40, { patient_id: "b" });
    const c1 = closedAgo("entregada", 35, { patient_id: "c" }); // el más nuevo de c, pero de hace más de 30 días
    const bOpen = dto({ patient_id: "b", status: "lista", created_at: ago(1) });
    const out = splitHcRequests([b2, a2, c1, bOpen, a1, b1], NOW);
    expect(ids(out.current)).toEqual([bOpen.id, a1.id, b1.id]);
    expect(ids(out.older)).toEqual([a2.id, c1.id, b2.id]);
  });

  test("keep: lo que ya se vio entero con la página abierta no salta al plegado", () => {
    // A: enviada hace 50 días, para descargar (a la vista). B: entregada hace
    // 20, el cerrado más nuevo. Se apaga la copia digital y A llega sin documentos
    const a = dto({ status: "enviada", sent_at: ago(50), closed_at: ago(50), available_until: ago(-10), documents: [doc] });
    const b = closedAgo("entregada", 20);
    const before = splitHcRequests([a, b], NOW);
    expect(ids(before.current)).toEqual([a.id, b.id]);
    const gone = { ...a, documents: [] };
    // Sin keep, A se plegaría
    expect(ids(splitHcRequests([gone, b], NOW).older)).toEqual([gone.id]);
    // Con keep, A y B siguen enteras
    const keep = new Set(ids(before.current));
    const out = splitHcRequests([gone, b], NOW, keep);
    expect(ids(out.current)).toEqual([b.id, gone.id]);
    expect(out.older).toEqual([]);
  });

  test("keep: ocupa el lugar del cerrado más nuevo; lo que estaba plegado sigue plegado", () => {
    // Se veía entero al entrar (30 días justos); con la página abierta, pasó el día 30
    const shown = closedAgo("rechazada", 31);
    const folded = closedAgo("cancelada", 45);
    const out = splitHcRequests([folded, shown], NOW, new Set([shown.id]));
    expect(ids(out.current)).toEqual([shown.id]);
    expect(ids(out.older)).toEqual([folded.id]);
    // Un id de otro pedido (o de uno que ya no llega) no cambia nada
    expect(splitHcRequests([folded], NOW, new Set(["otro"])).current).toEqual([]);
  });

  test("los abiertos quedan en el orden en que llegan; sin pedidos, nada", () => {
    const x = dto({ status: "lista" });
    const y = dto({ status: "pendiente" });
    expect(ids(splitHcRequests([x, y], NOW).current)).toEqual([x.id, y.id]);
    expect(ids(splitHcRequests([y, x], NOW).current)).toEqual([y.id, x.id]);
    expect(splitHcRequests([], NOW)).toEqual({ current: [], older: [] });
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
