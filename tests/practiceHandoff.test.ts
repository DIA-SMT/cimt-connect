import { describe, expect, test } from "bun:test";
import {
  GOAL_MEDAL_TTL_MS, INBOX_STALE_EVENT, UNSAVED_TTL_MS, allowUnsaved, askGoalMedal, changesInbox, dropUnsaved,
  forgetGoalMedal, forgetUnsaved, hasUnsaved, inMyPracticeList, isPanelOwner, isPatientSectionMounted, isSectionMounted,
  keepUnsaved, markInboxStale, onInboxStale, ownerChange, patientSectionMounted, peekGoalMedal, peekUnsaved, practiceBadge,
  practiceBadgeFromCount, practiceCountsFromInbox, practiceCountsFromServer, practiceRiskCount, practiceUrgentFromInbox,
  refreshesPractice, sectionMounted, setPanelOwner, takeGoalMedal, unsavedOwner,
} from "../src/components/admin/portal/practiceHandoff";

// Piezas sin React de la etapa practice del panel: el número de "Prácticas",
// «Dar la medalla» desde la bandeja, los cambios sin guardar que quedan
// aparte al cerrar la ficha y el aviso a la bandeja después de cada acción.

type Row = Parameters<typeof practiceRiskCount>[0][number];

const pending = (risk = 0) => ({ logs: 1, comments: 0, costo: 0, risk, since: "2026-10-10", stale: false });
const row = (kind: Row["kind"], mine: boolean, risk = 0, patient_id = `p-${Math.random()}`): Row => ({ kind, mine, pending: pending(risk), patient_id });

describe("número de «Prácticas» (practice_pending + practice_risk)", () => {
  // Lo que cuenta el servidor (server/lib/practice.ts staffPracticeCounts y
  // el mock): filas de MIS pacientes y pacientes que no son míos con
  // comentarios de riesgo sin ver (uno por paciente)
  const serverCount = (items: Row[]) => ({
    practice_pending: items.filter((i) => i.mine).length,
    practice_risk: new Set(items.filter((i) => i.kind === "practicas" && !i.mine && i.pending.risk > 0).map((i) => i.patient_id)).size,
    // Pacientes con comentarios de riesgo sin ver, míos o no
    practice_urgent: new Set(items.filter((i) => i.kind === "practicas" && i.pending.risk > 0).map((i) => i.patient_id)).size,
  });

  const items: Row[] = [
    row("practicas", true, 0, "a"), // mío
    row("meta_cumplida", true, 0, "b"), // mío (meta cumplida)
    row("practicas", true, 2, "c"), // mío, con riesgo: se cuenta una vez
    row("practicas", false, 1, "d"), // de otro (o sin profesional), con riesgo
    row("meta_cumplida", false, 1, "d"), // la meta cumplida de ese mismo paciente no suma
    row("practicas", false, 0, "e"), // de otro, sin riesgo
  ];

  test("la bandeja y el contador dan lo mismo", () => {
    expect(practiceBadge(items)).toBe(4);
    expect(practiceBadgeFromCount(serverCount(items))).toBe(4);
  });

  test("un comentario de riesgo de un paciente que no es mío llega al número", () => {
    const only = [row("practicas", false, 1)];
    expect(practiceBadge(only)).toBe(1);
    expect(practiceBadgeFromCount(serverCount(only))).toBe(1);
    expect(practiceBadge([row("practicas", false)])).toBe(0);
  });

  test("«Mis pacientes» muestra exactamente lo que se cuenta", () => {
    expect(items.filter(inMyPracticeList).length).toBe(practiceBadge(items));
    expect(inMyPracticeList(row("meta_cumplida", false, 3))).toBe(false);
  });

  test("sin la etapa practice o para Administración, 0", () => {
    expect(practiceBadgeFromCount({})).toBe(0);
    expect(practiceBadgeFromCount({ practice_pending: 2 })).toBe(2);
    expect(practiceCountsFromServer({})).toEqual({ practice: 0, practiceRisk: 0, practiceUrgent: false });
    expect(practiceCountsFromInbox([])).toEqual({ practice: 0, practiceRisk: 0, practiceUrgent: false });
  });

  test("practiceRisk: lo mismo que practice_risk (solo pacientes ajenos, uno por paciente)", () => {
    expect(practiceRiskCount(items)).toBe(1);
    expect(practiceRiskCount(items)).toBe(serverCount(items).practice_risk);
    // Mi paciente con riesgo ya está en practice_pending: no cuenta acá
    expect(practiceRiskCount([row("practicas", true, 3)])).toBe(0);
    // El mismo paciente en dos filas cuenta una vez
    expect(practiceRiskCount([row("practicas", false, 1, "x"), row("practicas", false, 2, "x")])).toBe(1);
  });

  test("la bandeja (setCounts) y el contador mandan los mismos números", () => {
    const fromServer = practiceCountsFromServer(serverCount(items));
    expect(fromServer).toEqual({ practice: 4, practiceRisk: 1, practiceUrgent: true });
    expect(practiceCountsFromInbox(items)).toEqual(fromServer);
    expect(practiceCountsFromServer({ practice_pending: 2, practice_risk: 3, practice_urgent: 4 }))
      .toEqual({ practice: 5, practiceRisk: 3, practiceUrgent: true });
    expect(practiceCountsFromServer({ practice_pending: 2 })).toEqual({ practice: 2, practiceRisk: 0, practiceUrgent: false });
  });

  test("practiceUrgent: algún comentario de riesgo sin ver, de mis pacientes o no", () => {
    // Solo mi paciente con riesgo: practiceRisk no lo cuenta (ya está en
    // practice_pending), pero la pestaña igual se marca como urgente
    const mineOnly = [row("practicas", true, 2, "m"), row("meta_cumplida", true, 2, "m"), row("practicas", false, 0, "o")];
    expect(practiceRiskCount(mineOnly)).toBe(0);
    expect(practiceUrgentFromInbox(mineOnly)).toBe(true);
    expect(practiceCountsFromInbox(mineOnly)).toEqual(practiceCountsFromServer(serverCount(mineOnly)));
    expect(practiceCountsFromInbox(mineOnly).practiceUrgent).toBe(true);
    // De otro paciente: también
    const otherOnly = [row("practicas", false, 1, "x")];
    expect(practiceCountsFromInbox(otherOnly)).toEqual({ practice: 1, practiceRisk: 1, practiceUrgent: true });
    expect(practiceCountsFromServer(serverCount(otherOnly)).practiceUrgent).toBe(true);
    // Sin riesgo (aunque haya prácticas nuevas o metas cumplidas): no
    const calm = [row("practicas", true, 0, "a"), row("meta_cumplida", false, 0, "b")];
    expect(practiceUrgentFromInbox(calm)).toBe(false);
    expect(practiceCountsFromInbox(calm)).toEqual(practiceCountsFromServer(serverCount(calm)));
    expect(practiceCountsFromServer({ practice_pending: 3, practice_urgent: 0 }).practiceUrgent).toBe(false);
    // Como el servidor, cuenta la fila de prácticas (la de la meta cumplida del mismo paciente repite su riesgo)
    expect(practiceUrgentFromInbox([row("meta_cumplida", true, 1, "z")])).toBe(false);
  });
});

describe("«Dar la medalla» desde la bandeja", () => {
  test("se toma una sola vez, solo para ese paciente", () => {
    const t = 1_000_000;
    askGoalMedal("pac-1", "meta-1", t);
    expect(peekGoalMedal("pac-2", t + 10)).toBeNull();
    expect(takeGoalMedal("pac-2", t + 10)).toBeNull();
    expect(peekGoalMedal("pac-1", t + 10)).toBe("meta-1");
    expect(peekGoalMedal("pac-1", t + 20)).toBe("meta-1"); // mirar no lo consume
    expect(takeGoalMedal("pac-1", t + 30)).toBe("meta-1");
    expect(takeGoalMedal("pac-1", t + 40)).toBeNull();
    expect(peekGoalMedal("pac-1", t + 40)).toBeNull();
  });

  test("si nadie lo toma en un rato, se olvida", () => {
    const t = 2_000_000;
    askGoalMedal("pac-1", "meta-1", t);
    expect(peekGoalMedal("pac-1", t + GOAL_MEDAL_TTL_MS + 1)).toBeNull();
    expect(takeGoalMedal("pac-1", t + 1)).toBeNull(); // ya se olvidó
  });

  test("un pedido nuevo reemplaza al anterior", () => {
    const t = 3_000_000;
    askGoalMedal("pac-1", "meta-1", t);
    askGoalMedal("pac-3", "meta-9", t + 5);
    expect(peekGoalMedal("pac-1", t + 10)).toBeNull();
    expect(takeGoalMedal("pac-3", t + 10)).toBe("meta-9");
  });

  test("si la ficha de ese paciente se cierra sin tomarlo, no se carga más tarde", () => {
    const t = 4_000_000;
    askGoalMedal("pac-4", "meta-4", t);
    forgetGoalMedal("pac-5"); // otra ficha: no lo toca
    expect(peekGoalMedal("pac-4", t + 10)).toBe("meta-4");
    forgetGoalMedal("pac-4");
    expect(takeGoalMedal("pac-4", t + 20)).toBeNull();
  });

  test("«Portal del paciente» montada (el pedido se olvida solo si no se volvió a montar enseguida)", () => {
    expect(isPatientSectionMounted("pac-6")).toBe(false);
    const first = patientSectionMounted("pac-6");
    const second = patientSectionMounted("pac-6"); // React en modo estricto monta dos veces
    first();
    first(); // llamarlo dos veces no descuenta de más
    expect(isPatientSectionMounted("pac-6")).toBe(true);
    second();
    expect(isPatientSectionMounted("pac-6")).toBe(false);
    expect(isSectionMounted("pac-6")).toBe(false); // son contadores aparte
  });
});

describe("cambios sin guardar que quedan aparte", () => {
  const ANA = "ana@cimt.local";
  const JUAN = "juan@cimt.local";

  test("vuelven para quien los escribió y se olvidan al retomarlos", () => {
    const t = 10_000_000;
    keepUnsaved("p-a", "plan", ANA, { title: "Plan" }, t);
    expect(hasUnsaved("p-a", ANA, t)).toBe(true);
    expect(hasUnsaved("p-a", JUAN, t)).toBe(false);
    expect(peekUnsaved("p-a", "plan", JUAN, t)).toBeNull(); // otra persona no los ve
    expect(peekUnsaved<{ title: string }>("p-a", "plan", ANA, t)).toEqual({ value: { title: "Plan" }, at: t });
    expect(peekUnsaved("p-a", "feedback", ANA, t)).toBeNull();
    forgetUnsaved("p-a", "plan", ANA);
    expect(hasUnsaved("p-a", ANA, t)).toBe(false);
  });

  test("cada persona tiene lo suyo: nadie pisa ni borra lo de otra", () => {
    const t = 11_000_000;
    keepUnsaved("p-f", "feedback", ANA, { body: "De Ana" }, t);
    keepUnsaved("p-f", "feedback", JUAN, { body: "De Juan" }, t + 1);
    expect(peekUnsaved("p-f", "feedback", ANA, t + 2)?.value).toEqual({ body: "De Ana" });
    expect(peekUnsaved("p-f", "feedback", JUAN, t + 2)?.value).toEqual({ body: "De Juan" });
    // Juan retoma (y olvida) lo suyo: lo de Ana sigue
    forgetUnsaved("p-f", "feedback", JUAN);
    expect(hasUnsaved("p-f", JUAN, t + 3)).toBe(false);
    expect(hasUnsaved("p-f", ANA, t + 3)).toBe(true);
    // Juan cierra la sección confirmando que se pierden: lo de Ana sigue
    keepUnsaved("p-f", "plan", JUAN, { a: 1 }, t + 4);
    dropUnsaved("p-f", JUAN, t + 5);
    expect(hasUnsaved("p-f", JUAN, t + 5)).toBe(false);
    expect(peekUnsaved("p-f", "feedback", ANA, t + 5)?.value).toEqual({ body: "De Ana" });
    keepUnsaved("p-f", "plan", ANA, { a: 2 }, t + 6); // a Ana no le cambia nada
    expect(peekUnsaved("p-f", "plan", ANA, t + 6)?.value).toEqual({ a: 2 });
    forgetUnsaved("p-f", "plan", ANA);
    forgetUnsaved("p-f", "feedback", ANA);
    allowUnsaved("p-f", JUAN);
  });

  test("sin saber quién es no queda nada aparte", () => {
    const t = 12_000_000;
    for (const nobody of [null, undefined, ""]) {
      keepUnsaved("p-g", "plan", nobody, { a: 1 }, t);
      expect(hasUnsaved("p-g", nobody, t)).toBe(false);
      expect(peekUnsaved("p-g", "plan", nobody, t)).toBeNull();
    }
    keepUnsaved("p-g", "plan", ANA, { a: 2 }, t);
    forgetUnsaved("p-g", "plan", null); // no borra lo de nadie
    dropUnsaved("p-g", undefined, t);
    expect(peekUnsaved("p-g", "plan", ANA, t)?.value).toEqual({ a: 2 });
    forgetUnsaved("p-g", "plan", ANA);
  });

  test("vencen a las 12 horas", () => {
    const t = 20_000_000;
    expect(UNSAVED_TTL_MS).toBe(12 * 60 * 60 * 1000);
    keepUnsaved("p-b", "feedback", ANA, { body: "Hola" }, t);
    expect(hasUnsaved("p-b", ANA, t + UNSAVED_TTL_MS)).toBe(true);
    expect(hasUnsaved("p-b", ANA, t + UNSAVED_TTL_MS + 1)).toBe(false);
    expect(peekUnsaved("p-b", "feedback", ANA, t + UNSAVED_TTL_MS + 1)).toBeNull();
    expect(peekUnsaved("p-b", "feedback", ANA, t)).toBeNull(); // se borró al vencer
  });

  test("lo vencido de cualquiera se borra al guardar algo nuevo", () => {
    const t = 70_000_000;
    keepUnsaved("p-h", "plan", JUAN, { a: 1 }, t);
    keepUnsaved("p-i", "plan", ANA, { b: 1 }, t + UNSAVED_TTL_MS + 1);
    // Aunque el reloj vuelva atrás, lo de Juan ya no está
    expect(peekUnsaved("p-h", "plan", JUAN, t + 1)).toBeNull();
    forgetUnsaved("p-i", "plan", ANA);
  });

  test("cerrar la sección confirmando que se pierden no deja nada aparte hasta volver a abrirla", () => {
    const t = 130_000_000;
    keepUnsaved("p-c", "plan", ANA, { a: 1 }, t);
    keepUnsaved("p-c", "feedback", ANA, { b: 2 }, t);
    dropUnsaved("p-c", ANA, t);
    expect(hasUnsaved("p-c", ANA, t)).toBe(false);
    keepUnsaved("p-c", "plan", ANA, { a: 3 }, t); // lo que se desmonta después de confirmar
    expect(hasUnsaved("p-c", ANA, t)).toBe(false);
    keepUnsaved("p-d", "plan", ANA, { a: 4 }, t); // otros pacientes no cambian
    expect(hasUnsaved("p-d", ANA, t)).toBe(true);
    keepUnsaved("p-c", "plan", JUAN, { a: 6 }, t); // ni otras personas
    expect(hasUnsaved("p-c", JUAN, t)).toBe(true);
    allowUnsaved("p-c", ANA);
    keepUnsaved("p-c", "plan", ANA, { a: 5 }, t);
    expect(peekUnsaved("p-c", "plan", ANA, t)?.value).toEqual({ a: 5 });
  });

  test("quién lo escribió: el correo de la sesión (o el id del usuario)", () => {
    expect(unsavedOwner({ user: { id: "u-1", email: " Ana@CIMT.local " } })).toBe("ana@cimt.local");
    expect(unsavedOwner({ user: { id: "u-1", email: null } })).toBe("u-1");
    expect(unsavedOwner({ user: { id: "u-1", email: "" } })).toBe("u-1");
    expect(unsavedOwner({ user: null })).toBeNull();
    expect(unsavedOwner(null)).toBeNull();
    expect(unsavedOwner(undefined)).toBeNull();
  });

  test("quién usa el panel sigue a la sesión: solo un cambio de persona cierra la sección", () => {
    // Recién se sabe quién es: no había nada de nadie en pantalla
    expect(ownerChange(undefined, ANA)).toBe("known");
    expect(ownerChange(undefined, null)).toBe("known");
    // Se renovó el token (la misma persona): nada
    expect(ownerChange(ANA, ANA)).toBe("same");
    expect(ownerChange(null, null)).toBe("same");
    // Entró otra persona, se cerró la sesión o se supo quién es después de no tener sesión
    expect(ownerChange(ANA, JUAN)).toBe("switched");
    expect(ownerChange(ANA, null)).toBe("switched");
    expect(ownerChange(null, ANA)).toBe("switched");
    // La sesión de un mismo correo con otras mayúsculas es la misma persona
    expect(ownerChange(unsavedOwner({ user: { email: "Ana@CIMT.local" } }), unsavedOwner({ user: { email: "ana@cimt.local" } }))).toBe("same");
  });

  test("al cambiar quién usa el panel, lo sin guardar de quien estaba no se muestra ni se borra", () => {
    const t = 140_000_000;
    // Ana tenía la sección abierta: al cerrarse por el cambio de sesión, las
    // partes guardan lo suyo con el owner con que se montaron (Ana)
    setPanelOwner(ANA);
    allowUnsaved("p-s", ANA);
    keepUnsaved("p-s", "plan", ANA, { title: "De Ana" }, t);
    expect(ownerChange(ANA, JUAN)).toBe("switched");
    setPanelOwner(JUAN);
    // Juan no lo ve (ni el aviso de la sección cerrada ni al abrirla) y el
    // aviso de "quedaron cambios sin guardar" no es para él
    expect(hasUnsaved("p-s", JUAN, t + 1)).toBe(false);
    expect(peekUnsaved("p-s", "plan", JUAN, t + 1)).toBeNull();
    expect(isPanelOwner(ANA)).toBe(false);
    expect(isPanelOwner(JUAN)).toBe(true);
    // Lo que hace Juan al abrir y cerrar la sección no borra lo de Ana
    forgetUnsaved("p-s", "plan", JUAN);
    dropUnsaved("p-s", JUAN, t + 2);
    allowUnsaved("p-s", JUAN);
    // Ana vuelve a entrar: lo encuentra
    setPanelOwner(ANA);
    expect(isPanelOwner(ANA)).toBe(true);
    expect(hasUnsaved("p-s", ANA, t + 3)).toBe(true);
    expect(peekUnsaved("p-s", "plan", ANA, t + 3)?.value).toEqual({ title: "De Ana" });
    forgetUnsaved("p-s", "plan", ANA);
  });

  test("sin sesión nadie es quien usa el panel", () => {
    setPanelOwner(null);
    expect(isPanelOwner(null)).toBe(false);
    expect(isPanelOwner(undefined)).toBe(false);
    expect(isPanelOwner(ANA)).toBe(false);
    setPanelOwner(undefined);
    expect(isPanelOwner(undefined)).toBe(false);
  });

  test("secciones montadas (el aviso al cerrar no sale si se vuelve a montar enseguida)", () => {
    expect(isSectionMounted("p-e")).toBe(false);
    const first = sectionMounted("p-e");
    const second = sectionMounted("p-e"); // React en modo estricto monta dos veces
    first();
    expect(isSectionMounted("p-e")).toBe(true);
    second();
    expect(isSectionMounted("p-e")).toBe(false);
  });
});

describe("la bandeja, al día después de cada acción", () => {
  test("solo las acciones que cambian algo (no al mirar)", () => {
    expect(changesInbox("get")).toBe(false);
    expect(changesInbox("catalog")).toBe(false);
    for (const a of ["mark_seen", "feedback_send", "feedback_withdraw", "goal_publish", "goal_change", "goal_not_yet", "plan_publish", "plan_save_draft", "medal_void"]) {
      expect(changesInbox(a)).toBe(true);
    }
  });

  test("el aviso llega con el paciente y se deja de escuchar", () => {
    const target = new EventTarget();
    const got: (string | null)[] = [];
    const off = onInboxStale((id) => got.push(id), target);
    markInboxStale("pac-1", target);
    target.dispatchEvent(new CustomEvent(INBOX_STALE_EVENT)); // sin paciente
    target.dispatchEvent(new Event("otro-evento"));
    expect(got).toEqual(["pac-1", null]);
    off();
    markInboxStale("pac-2", target);
    expect(got).toEqual(["pac-1", null]);
  });

  test("fuera del navegador no hace nada", () => {
    expect(INBOX_STALE_EVENT).toBe("cimt:portal-inbox-stale");
    expect(() => markInboxStale("pac-1", null)).not.toThrow();
    const off = onInboxStale(() => { throw new Error("no debería llamarse"); }, null);
    expect(() => off()).not.toThrow();
  });
});

describe("cuándo se recarga la práctica en la ficha", () => {
  test("cuando la sección de arriba guarda algo o se trae lo último por un 409", () => {
    expect(refreshesPractice({ ok: true })).toBe(true);
    expect(refreshesPractice({ ok: false, status: 409 })).toBe(true);
  });

  test("no con otros errores (no cambió nada)", () => {
    for (const status of [0, 400, 401, 403, 404, 500, 503]) expect(refreshesPractice({ ok: false, status })).toBe(false);
  });
});
