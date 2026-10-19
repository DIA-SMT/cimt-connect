// Pruebas del mock del portal (src/integrations/supabase/mockPortal.ts) en lo
// que tiene que hacer igual que el servidor de la etapa B: el "Visto" con el
// nombre de quien lo marcó, Administración sin el motivo de una medalla
// anulada, metas de un plan retirado, retirar una devolución, medallas que se
// repiten, devoluciones que no se marcan al leerlas, "Visto" después de
// finalizar o retirar el plan, el número de la pestaña con comentarios de
// riesgo de pacientes que no son míos (y practice_urgent, con los míos), el
// orden de los comentarios (los de riesgo sin ver arriba), metas de planes
// cerrados (al retirar una devolución, al finalizar o retirar un plan con
// versiones y al publicarlas), a qué plan reemplaza una versión que se
// publica, «Mis logros» sin plan (Valentina: Inicio, su página, qué cuenta
// como algo para ver y la regla de acceso) y la pausa de vacaciones en la
// página de medallas.
// El mock guarda todo en localStorage y la sesión en sessionStorage: acá van
// en memoria. Las esperas del mock (que imitan la red) se acortan a 0.
// Correr con: bun test
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { practiceHomes, practicePeople } from "../src/components/portal/practiceFormat";
import { centerDateOf } from "../src/lib/portalRules";

type Mock = typeof import("../src/integrations/supabase/mockPortal");
type Client = typeof import("../src/integrations/supabase/mockClient");

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const g = globalThis as unknown as Record<string, unknown>;
const realSetTimeout = globalThis.setTimeout;
const hadWindow = "window" in g;
const local = new MemoryStorage();
const session = new MemoryStorage();
let mock: Mock;
let client: Client;

const DB_KEY = "cimt-portal-mock-db";
const MARTIN = "c-martin";
const GOAL = "c4d81f2b-6e3a-4b7c-8d95-1a2f3e4b5c6d"; // la meta de práctica de la demo
const DEMO_PLAN = "7b2e4c1a-3f5d-4a8e-9c61-2d0f8e5b7a14"; // el plan publicado de la demo (versión 1)
const V2 = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"; // una versión 2 armada en la prueba
const ANA = "Lic. Ana Torres · MP 4521";

type Row = Record<string, unknown> & { id: string };
type DemoDb = Record<string, unknown> & {
  practice_plans: Row[]; practice_logs: Row[]; practice_notes: Row[]; practice_goals: Row[];
  practice_medals: Row[]; practice_feedback: Row[]; access_log: Row[];
};

// La base de la demo, para prepararla o revisarla como lo haría otra pestaña
function readDb(): DemoDb {
  return JSON.parse(local.getItem(DB_KEY) ?? "null") as DemoDb;
}
function writeDb(db: DemoDb) {
  local.setItem(DB_KEY, JSON.stringify(db));
}
const ok = <T>(r: { ok: true; data: T } | { ok: false; status: number; error: string }): T => {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.data;
};

async function asStaff(email: string) {
  await client.mockSupabase.auth.signOut();
  await client.mockSupabase.auth.signInWithPassword({ email, password: "x" });
}

async function staffDo(body: Record<string, unknown>) {
  return mock.staffPracticeAction({ patient_id: MARTIN, ...body } as never, "");
}

beforeAll(async () => {
  // Sin esperas: el mock imita la red con setTimeout
  g.setTimeout = ((fn: (...a: unknown[]) => void, _ms?: number, ...args: unknown[]) => realSetTimeout(fn, 0, ...args)) as never;
  g.window = { localStorage: local, sessionStorage: session };
  mock = await import("../src/integrations/supabase/mockPortal");
  client = await import("../src/integrations/supabase/mockClient");
});

afterAll(() => {
  g.setTimeout = realSetTimeout;
  if (!hadWindow) delete g.window;
});

beforeEach(async () => {
  mock.resetDemo();
  local.clear();
  session.clear();
  await client.mockSupabase.auth.signOut();
  // Laura activa la información de salud: ya ve los ejercicios de Martín
  ok(await mock.login("30111222", "familia2026"));
  ok(await mock.clinicalConsent(true, "familia2026"));
});

describe("mock: devoluciones (no se marcan al leerlas)", () => {
  test("leerlas dos veces deja la marca «Nueva»; feedbackSeen la saca", async () => {
    const first = ok(await mock.practiceFeedback(MARTIN));
    const again = ok(await mock.practiceFeedback(MARTIN));
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items[0].is_new).toBe(true);
    expect(again.items[0].is_new).toBe(true);
    expect(ok(await mock.practice(MARTIN)).feedback_new).toBe(1);

    ok(await mock.practiceFeedbackSeen([first.items[0].id]));
    expect(ok(await mock.practiceFeedback(MARTIN)).items[0].is_new).toBe(false);
    expect(ok(await mock.practice(MARTIN)).feedback_new).toBe(0);
    // Una sola fila por cuenta, aunque se mande dos veces
    ok(await mock.practiceFeedbackSeen([first.items[0].id, first.items[0].id]));
    const reads = readDb().access_log.filter((l) => l.action === "ver_devolucion" && l.target_id === first.items[0].id);
    expect(reads.length).toBe(1);
  });

  test("ids inválidos: 400; ids ajenos o retirados no se registran", async () => {
    const bad = await mock.practiceFeedbackSeen(["", "x".repeat(65)]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.status).toBe(400);
    const tooMany = await mock.practiceFeedbackSeen(Array.from({ length: 51 }, (_, i) => `id-${i}`));
    expect(tooMany.ok).toBe(false);

    // Una devolución retirada no cuenta (ni se ve)
    const db = readDb();
    const f = db.practice_feedback[0];
    f.withdrawn_at = new Date().toISOString();
    writeDb(db);
    ok(await mock.practiceFeedbackSeen([f.id, "no-existe"]));
    expect(readDb().access_log.some((l) => l.action === "ver_devolucion")).toBe(false);
  });
});

describe("mock: medallas que se repiten", () => {
  // Una «Semana cumplida» más vieja (de dos semanas antes), sin ver
  function addOlderCopy(): { newest: Row; older: Row } {
    const db = readDb();
    const newest = db.practice_medals.find((m) => m.code === "semana_cumplida")!;
    const older = {
      ...newest, id: "0f0e0d0c-0b0a-4908-8706-050403020100", period_key: `${newest.period_key}-vieja`,
      awarded_at: new Date(Date.parse(String(newest.awarded_at)) - 7 * 86_400_000).toISOString(),
    };
    db.practice_medals.push(older);
    writeDb(db);
    return { newest, older };
  }
  // Las «Semana cumplida» que la celebración todavía ofrece a Laura
  const unseenWeek = async () => {
    const ids = new Set(readDb().practice_medals.filter((m) => m.code === "semana_cumplida").map((m) => m.id));
    return ok(await mock.practice(MARTIN)).celebration.filter((c) => ids.has(c.medal_id));
  };

  test("marcar la tarjeta marca el grupo entero (no vuelve a celebrarse la copia vieja)", async () => {
    const { newest } = addOlderCopy();
    const card = ok(await mock.practiceMedals(MARTIN)).earned.find((m) => m.code === "semana_cumplida")!;
    expect(card.times).toBe(2);
    expect(card.id).toBe(newest.id);
    expect(card.is_new).toBe(true);
    expect((await unseenWeek()).length).toBe(2);

    ok(await mock.practiceMedalsSeen([card.id]));
    expect(ok(await mock.practiceMedals(MARTIN)).earned.find((m) => m.code === "semana_cumplida")!.is_new).toBe(false);
    expect((await unseenWeek()).length).toBe(0);
    const weekIds = readDb().practice_medals.filter((m) => m.code === "semana_cumplida").map((m) => m.id);
    expect(weekIds).not.toContain(ok(await mock.me()).celebration?.medal_id ?? "");
  });

  test("la más nueva vista y una vieja sin ver: la tarjeta sigue «Nueva» y se puede marcar", async () => {
    const { newest, older } = addOlderCopy();
    // La celebración marcó solo la más nueva
    ok(await mock.practiceMedalsSeen([newest.id]));
    // ...que ya marca el grupo; para el caso viejo, se deja una sin ver a mano
    const db = readDb();
    db.access_log = db.access_log.filter((l) => !(l.action === "ver_medalla" && l.target_id === older.id));
    writeDb(db);
    const card = ok(await mock.practiceMedals(MARTIN)).earned.find((m) => m.code === "semana_cumplida")!;
    expect(card.id).toBe(newest.id);
    expect(card.is_new).toBe(true);
    ok(await mock.practiceMedalsSeen([card.id]));
    expect((await unseenWeek()).length).toBe(0);
  });
});

describe("mock: equipo", () => {
  test("«Visto» de la Dirección: la familia ve ese nombre, nunca el del autor del plan", async () => {
    await asStaff("direccion@cimt.test");
    ok(await staffDo({ action: "mark_seen" }));
    const page = ok(await mock.practice(MARTIN));
    expect(page.reviewed?.by).toBe("Dirección del CIMT");
    expect(page.reviewed?.by).not.toBe(ANA);
  });

  test("«Visto» sin poder firmar (profesional sin matrícula): 403 AUTHOR y no cambia nada", async () => {
    await asStaff("pro.sin.matricula@cimt.test");
    const staffRow = ok(await staffDo({ action: "get" }));
    // Sin matrícula en Equipo
    const { data } = await client.mockSupabase.rpc("current_staff");
    const proId = (data as { professional_id: string | null } | null)?.professional_id;
    if (proId) await client.mockSupabase.from("professionals").update({ license: null }).eq("id", proId);
    const before = readDb().practice_plans.find((p) => p.status === "publicado")!.last_reviewed_at;
    const r = await staffDo({ action: "mark_seen" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect((r as { code?: string }).code).toBe("AUTHOR");
    }
    expect(readDb().practice_plans.find((p) => p.status === "publicado")!.last_reviewed_at).toBe(before);
    expect(staffRow.can_edit).toBe(true);
    // La familia sigue viendo a quien sí lo marcó (la devolución de la Lic. Ana Torres)
    expect(ok(await mock.practice(MARTIN)).reviewed?.by).toBe(ANA);
  });

  test("retirar la devolución: la meta vuelve a activa y su medalla queda anulada", async () => {
    await asStaff("direccion@cimt.test");
    const sent = ok(await staffDo({
      action: "feedback_send",
      feedback: {
        plan_id: null, body: "¡Muy bien! Cumplieron la meta de práctica.", for_adult: null, goal_ids: [GOAL],
        medal: { title: "Gran equipo", message: "¡Felicitaciones!", goal_id: GOAL }, adolescent_ack: false, review_note: null,
      },
    }));
    const fb = sent.feedback[0];
    expect(sent.goals.find((x) => x.id === GOAL)?.status).toBe("lograda");
    expect(ok(await mock.practice(MARTIN)).goals.find((x) => x.id === GOAL)?.status).toBe("lograda");

    const after = ok(await staffDo({ action: "feedback_withdraw", feedback_id: fb.id, reason: "error" }));
    const goal = after.goals.find((x) => x.id === GOAL)!;
    expect(goal.status).toBe("activa");
    expect(goal.achieved_at).toBeNull();
    expect(goal.feedback_id).toBeNull();
    const medal = after.medals.find((m) => m.feedback_id === fb.id)!;
    expect(medal.voided_at).not.toBeNull();
    expect(medal.void_reason).toBe("devolución retirada");

    // La familia: la meta vuelve a estar activa y la medalla ya no está
    const page = ok(await mock.practice(MARTIN));
    expect(page.goals.find((x) => x.id === GOAL)?.status).toBe("activa");
    expect(ok(await mock.practiceMedals(MARTIN)).earned.some((m) => m.kind === "profesional")).toBe(false);
    // Y se puede volver a dar (con su medalla) en una devolución nueva
    const again = ok(await staffDo({
      action: "feedback_send",
      feedback: {
        plan_id: null, body: "Ahora sí: cumplieron la meta de práctica.", for_adult: null, goal_ids: [GOAL],
        medal: { title: "Gran equipo", message: null, goal_id: GOAL }, adolescent_ack: false, review_note: null,
      },
    }));
    expect(again.goals.find((x) => x.id === GOAL)?.status).toBe("lograda");
  });

  test("Administración ve que una medalla está anulada, no el motivo", async () => {
    await asStaff("direccion@cimt.test");
    const medal = ok(await staffDo({ action: "get" })).medals[0];
    const voided = ok(await staffDo({ action: "medal_void", medal_id: medal.id, reason: "Era para otro paciente" }));
    expect(voided.medals.find((m) => m.id === medal.id)?.void_reason).toBe("Era para otro paciente");

    await asStaff("admin@cimt.test");
    const admin = ok(await staffDo({ action: "get" })).medals.find((m) => m.id === medal.id)!;
    expect(admin.voided_at).not.toBeNull();
    expect(admin.void_reason).toBeNull();
  });

  // Laura anota una práctica hoy (queda pendiente para el equipo)
  async function logToday() {
    const ex = ok(await mock.practice(MARTIN)).exercises[0];
    ok(await mock.practiceLog({ exercise_id: ex.id }));
  }
  const martinRow = async () => ok(await mock.staffInbox()).practice?.items
    .find((i) => i.kind === "practicas" && i.patient_id === MARTIN);

  test("plan finalizado: lo pendiente se puede dar por «Visto» y sale de la bandeja", async () => {
    await logToday();
    await asStaff("direccion@cimt.test");
    const dto = ok(await staffDo({ action: "get" }));
    expect(dto.pending.logs).toBeGreaterThan(0);
    const closed = ok(await staffDo({ action: "plan_finish", plan_id: dto.published!.id }));
    expect(closed.published).toBeNull();
    expect(closed.pending.logs).toBeGreaterThan(0);
    expect(await martinRow()).toBeDefined();

    const seen = ok(await staffDo({ action: "mark_seen" }));
    expect(seen.pending.logs).toBe(0);
    expect(seen.pending.since).toBeNull();
    expect(await martinRow()).toBeUndefined();
  });

  test("plan retirado: una devolución también da lo pendiente por visto", async () => {
    await logToday();
    await asStaff("direccion@cimt.test");
    const dto = ok(await staffDo({ action: "get" }));
    ok(await staffDo({ action: "plan_withdraw", plan_id: dto.published!.id, reason: "pedido_familia" }));
    expect(await martinRow()).toBeDefined();
    const sent = ok(await staffDo({
      action: "feedback_send",
      feedback: {
        plan_id: null, body: "Gracias por contarnos cómo les fue estas semanas.", for_adult: null, goal_ids: [],
        medal: null, adolescent_ack: false, review_note: null,
      },
    }));
    expect(sent.pending.logs).toBe(0);
    expect(await martinRow()).toBeUndefined();
  });

  test("número de la pestaña: practice_risk cuenta pacientes que no son míos con comentarios de riesgo", async () => {
    // Un paciente del panel con su profesional a cargo (no es de la Dirección)
    const { data: pros } = await client.mockSupabase.from("professionals").select("*");
    const { data: pats } = await client.mockSupabase.from("patients").select("*");
    const other = String((pats as Row[])[0].id);
    await client.mockSupabase.from("patients").update({ professional_id: (pros as Row[])[0].id }).eq("id", other);

    const db = readDb();
    const now = new Date().toISOString();
    const demo = db.practice_plans.find((p) => p.patient_id === MARTIN)!;
    const planId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    db.practice_plans.push({
      ...demo, id: planId, patient_id: other, version: 1, supersedes_id: null,
      last_reviewed_at: null, last_reviewed_by_email: null, last_reviewed_label: null,
    });
    const log = (patient: string, id: string) => ({
      id, patient_id: patient, plan_id: planId, exercise_id: "e", exercise_key: "k", account_id: null,
      practiced_on: now.slice(0, 10), created_at: now, voided_at: null,
    });
    const note = (patient: string, logId: string) => ({
      id: `n-${logId}`, log_id: logId, patient_id: patient, account_id: null, result: "costo",
      comment: "Comentario de prueba", risk_flag: true, created_at: now,
    });
    db.practice_logs.push(log(other, "l-otro"));
    db.practice_notes.push(note(other, "l-otro"), note(MARTIN, db.practice_logs.find((l) => l.patient_id === MARTIN)!.id));
    writeDb(db);

    await asStaff("direccion@cimt.test");
    const items = ok(await mock.staffInbox()).practice!.items.filter((i) => i.kind === "practicas");
    expect(items.find((i) => i.patient_id === other)?.mine).toBe(false);
    expect(items.find((i) => i.patient_id === MARTIN)?.mine).toBe(true); // los chicos de la demo son de todos
    const counts = await mock.staffInboxCount();
    expect(counts.practice_risk).toBe(1); // el otro; Martín ya está en practice_pending
    expect(counts.practice_pending).toBe(items.filter((i) => i.mine).length);
    // practice_urgent: todos los pacientes con riesgo sin ver, también los míos
    expect(counts.practice_urgent).toBe(2);

    // Administración: sin números de prácticas
    await asStaff("admin@cimt.test");
    const admin = await mock.staffInboxCount();
    expect(admin.practice_risk).toBeUndefined();
    expect(admin.practice_pending).toBeUndefined();
    expect(admin.practice_urgent).toBeUndefined();
  });

  // Un comentario de Laura sobre la práctica más nueva de Martín (devuelve su id)
  function addMartinNote(id: string, createdAt: string, risk: boolean) {
    const db = readDb();
    const log = [...db.practice_logs].filter((l) => l.patient_id === MARTIN)
      .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))[0];
    db.practice_notes.push({
      id, log_id: log.id, patient_id: MARTIN, account_id: null, result: risk ? "costo" : "bien",
      comment: risk ? "Comentario de prueba con riesgo" : "Comentario de prueba", risk_flag: risk, created_at: createdAt,
    });
    writeDb(db);
    return id;
  }

  test("número de la pestaña: un comentario de riesgo de MI paciente marca practice_urgent (no practice_risk)", async () => {
    await asStaff("direccion@cimt.test");
    const before = await mock.staffInboxCount();
    expect(before.practice_urgent).toBe(0);
    expect(before.practice_risk).toBe(0);

    addMartinNote("n-riesgo-mio", new Date().toISOString(), true);
    const counts = await mock.staffInboxCount();
    expect(counts.practice_risk).toBe(0); // Martín es mío: ya cuenta en practice_pending
    expect(counts.practice_urgent).toBe(1);
    expect(counts.practice_pending).toBeGreaterThan(0);

    // «Visto»: el comentario ya no es urgente
    ok(await staffDo({ action: "mark_seen" }));
    expect((await mock.staffInboxCount()).practice_urgent).toBe(0);
  });

  test("comentarios: los de riesgo sin ver arriba; después, del más nuevo al más viejo (como el servidor)", async () => {
    const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
    // El último «Visto», hace dos días
    const db = readDb();
    for (const p of db.practice_plans) if (p.patient_id === MARTIN) p.last_reviewed_at = null;
    db.practice_plans.find((p) => p.id === DEMO_PLAN)!.last_reviewed_at = at(48);
    writeDb(db);
    const seenRisk = addMartinNote("n-riesgo-visto", at(72), true);
    const newRisk = addMartinNote("n-riesgo-nuevo", at(24), true);
    const newPlain = addMartinNote("n-nuevo", at(1), false);

    await asStaff("direccion@cimt.test");
    const notes = ok(await staffDo({ action: "get" })).notes;
    const ids = notes.map((n) => n.id);
    expect(notes[0].id).toBe(newRisk);
    expect(notes[0].is_new).toBe(true);
    expect(notes.find((n) => n.id === seenRisk)).toMatchObject({ risk: true, is_new: false });
    // El de riesgo ya visto va en su fecha: después del comentario nuevo sin riesgo
    expect(ids.indexOf(newPlain)).toBeLessThan(ids.indexOf(seenRisk));
    const rest = notes.slice(1).map((n) => n.created_at);
    expect(rest).toEqual([...rest].sort().reverse());
  });

  test("la plantilla de IA de la demo pasa el validador (sembrada y pedida de nuevo)", async () => {
    expect((readDb() as unknown as { practice_exercises: Row[] }).practice_exercises.some((e) => e.ai_drafted)).toBe(true);
    await asStaff("direccion@cimt.test");
    const r = ok(await mock.staffAiDraft({
      patient_id: MARTIN, catalog_ids: ["tf-trabas-proposito"], approach: "tartamudear_facil", practiced_in_session: true,
      quien_acompana: "adulto_con_chico", contexto: ["casa", "juego"], minutos: 5, dificultad: "igual", adaptaciones: [],
      intereses: ["futbol"],
    } as never, ""));
    expect(r.demo).toBe(true);
    expect(r.draft.ejercicios.length).toBe(1);
  });

  test("con el juego para el celular, la demo arma tarjetas de rima que riman", async () => {
    await asStaff("direccion@cimt.test");
    const r = ok(await mock.staffAiDraft({
      patient_id: MARTIN, catalog_ids: ["ef-turnos-mesa"], approach: "entorno_familia", practiced_in_session: false,
      quien_acompana: "adulto_con_chico", contexto: ["casa"], minutos: 10, dificultad: "igual", adaptaciones: [],
      intereses: ["futbol"], formato: "poesia", actividad: { mecanica: "rima", tarjetas: 5, idea: "un partido de fútbol" },
    } as never, ""));
    expect(r.draft.actividad).toMatchObject({ mecanica: "rima" });
    expect(r.draft.actividad?.mecanica === "rima" && r.draft.actividad.tarjetas.length).toBe(5);
    expect(r.flags.filter((f) => f.field === "actividad")).toEqual([]);
    expect(r.sent.fields.find((f) => f.label === "Idea")?.value).toBe("un partido de fútbol");
  });

  test("retirar el plan publicado: sus metas activas dejan de verse en el portal", async () => {
    await asStaff("direccion@cimt.test");
    const dto = ok(await staffDo({ action: "get" }));
    const after = ok(await staffDo({ action: "plan_withdraw", plan_id: dto.published!.id, reason: "error" }));
    expect(after.published).toBeNull();
    expect(after.goals.find((x) => x.id === GOAL)?.status).toBe("cambiada");
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
    expect(ok(await mock.practiceMedals(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
  });
});

describe("mock: metas de planes cerrados", () => {
  const code = (r: unknown) => (r as { code?: string }).code;

  // Una devolución que da por lograda la meta de la demo (sin medalla)
  async function achieveGoal() {
    const sent = ok(await staffDo({
      action: "feedback_send",
      feedback: {
        plan_id: null, body: "¡Muy bien! Cumplieron la meta de práctica.", for_adult: null, goal_ids: [GOAL],
        medal: null, adolescent_ack: false, review_note: null,
      },
    }));
    expect(sent.goals.find((x) => x.id === GOAL)?.status).toBe("lograda");
    return sent.feedback[0].id;
  }

  // Una versión 2 de la demo, como la dejan plan_save_draft (publish: false)
  // o plan_publish (publish: true; la versión 1 queda "reemplazado")
  function addV2(publish: boolean) {
    const db = readDb();
    const v1 = db.practice_plans.find((p) => p.id === DEMO_PLAN)!;
    const now = new Date().toISOString();
    if (publish) {
      Object.assign(v1, {
        status: "reemplazado", closed_at: now, closed_by_email: "direccion@cimt.test", close_reason: "reemplazado", updated_at: now,
      });
    }
    db.practice_plans.push({
      ...v1, id: V2, version: 2, supersedes_id: DEMO_PLAN, status: publish ? "publicado" : "borrador",
      published_at: publish ? now : null, published_by_email: publish ? "direccion@cimt.test" : null,
      closed_at: null, closed_by_email: null, close_reason: null, updated_at: now,
    });
    writeDb(db);
  }

  // Una meta nueva en borrador del plan planId (devuelve su id)
  async function draftGoal(planId: string, title: string) {
    const saved = ok(await staffDo({
      action: "goal_save",
      goal: { plan_id: planId, kind: "terapeutica", title, rule: null, medal_title: null, agreed_with_patient: false },
    }));
    const g = saved.goals.find((x) => x.title === title)!;
    expect(g.status).toBe("borrador");
    return g.id;
  }

  test("retirar la devolución con el plan finalizado: la meta queda «cambiada» y no vuelve al portal", async () => {
    await asStaff("direccion@cimt.test");
    const fb = await achieveGoal();
    ok(await staffDo({ action: "plan_finish", plan_id: DEMO_PLAN }));

    const after = ok(await staffDo({ action: "feedback_withdraw", feedback_id: fb, reason: "error" }));
    const goal = after.goals.find((x) => x.id === GOAL)!;
    expect(goal.status).toBe("cambiada");
    expect(goal.changed_at).not.toBeNull();
    expect(goal.changed_by_email).toBe("direccion@cimt.test");
    expect(goal.achieved_at).toBeNull();
    expect(goal.feedback_id).toBeNull();
    expect(after.feedback.find((f) => f.id === fb)?.goals).toEqual([]);
    expect(after.goals_met.some((x) => x.goal_id === GOAL)).toBe(false);
    // La familia no la ve ni activa ni lograda
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
    expect(ok(await mock.practiceMedals(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
  });

  test("retirar la devolución con el plan retirado: la meta tampoco vuelve", async () => {
    await asStaff("direccion@cimt.test");
    const fb = await achieveGoal();
    // La meta lograda sigue lograda al retirar el plan (la dio la devolución)
    const withdrawn = ok(await staffDo({ action: "plan_withdraw", plan_id: DEMO_PLAN, reason: "error" }));
    expect(withdrawn.goals.find((x) => x.id === GOAL)?.status).toBe("lograda");
    const after = ok(await staffDo({ action: "feedback_withdraw", feedback_id: fb, reason: "error" }));
    expect(after.goals.find((x) => x.id === GOAL)?.status).toBe("cambiada");
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
  });

  test("con una versión nueva publicada, la meta de la versión anterior vuelve a activa", async () => {
    addV2(true);
    await asStaff("direccion@cimt.test");
    const fb = await achieveGoal();
    const after = ok(await staffDo({ action: "feedback_withdraw", feedback_id: fb, reason: "error" }));
    const goal = after.goals.find((x) => x.id === GOAL)!;
    expect(goal.status).toBe("activa");
    expect(goal.changed_at).toBeNull();
    expect(ok(await mock.practice(MARTIN)).goals.find((x) => x.id === GOAL)?.status).toBe("activa");
  });

  test("retirar el plan retira las metas activas de las versiones que reemplazó", async () => {
    addV2(true);
    await asStaff("direccion@cimt.test");
    // La meta de la demo es de la versión 1 y sigue activa con la versión 2
    const before = ok(await staffDo({ action: "get" }));
    expect(before.published?.id).toBe(V2);
    expect(before.goals.find((x) => x.id === GOAL)?.status).toBe("activa");
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(true);

    const after = ok(await staffDo({ action: "plan_withdraw", plan_id: V2, reason: "error" }));
    expect(after.published).toBeNull();
    const goal = after.goals.find((x) => x.id === GOAL)!;
    expect(goal.status).toBe("cambiada");
    expect(goal.changed_by_email).toBe("direccion@cimt.test");
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
    expect(ok(await mock.practiceMedals(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
  });

  test("retirar el plan retira sus metas en borrador; las del borrador nuevo siguen (salen con él)", async () => {
    await asStaff("direccion@cimt.test");
    const ofLive = await draftGoal(DEMO_PLAN, "Contar en la sesión cómo fue la semana");
    addV2(false);
    const ofDraft = await draftGoal(V2, "Pedir algo en el kiosco");

    const after = ok(await staffDo({ action: "plan_withdraw", plan_id: DEMO_PLAN, reason: "pedido_familia" }));
    expect(after.goals.find((x) => x.id === ofLive)?.status).toBe("cambiada");
    expect(after.goals.find((x) => x.id === ofDraft)?.status).toBe("borrador");
    expect(after.draft?.id).toBe(V2);
    // La retirada ya no se publica; la del borrador nuevo sale junto con el plan, no sola
    for (const id of [ofLive, ofDraft]) {
      const r = await staffDo({ action: "goal_publish", goal_id: id, adolescent_ack: true });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(409);
    }
    expect(readDb().practice_goals.find((x) => x.id === ofDraft)?.status).toBe("borrador");
  });

  test("la meta de un borrador no se publica sola: sale con el plan, y si se descarta nunca se vio", async () => {
    await asStaff("direccion@cimt.test");
    const draft = await saveDraftFromPublished();
    const ofDraft = await draftGoal(draft.id, "Pedir algo en el kiosco");
    const r = await staffDo({ action: "goal_publish", goal_id: ofDraft, adolescent_ack: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(code(r)).toBe("CONFLICT");
      expect(r.error).toContain("junto con el plan en borrador");
    }
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === ofDraft)).toBe(false);

    // Al publicar el plan, sale con él
    const pub = ok(await publishDraft(draft, DEMO_PLAN));
    expect(pub.goals.find((x) => x.id === ofDraft)?.status).toBe("activa");
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === ofDraft)).toBe(true);
  });

  test("descartar un borrador con una meta suya: la familia no la ve", async () => {
    await asStaff("direccion@cimt.test");
    const draft = await saveDraftFromPublished();
    const ofDraft = await draftGoal(draft.id, "Pedir algo en el kiosco");
    expect((await staffDo({ action: "goal_publish", goal_id: ofDraft, adolescent_ack: true })).ok).toBe(false);
    ok(await staffDo({ action: "plan_withdraw", plan_id: draft.id }));
    expect(readDb().practice_goals.find((x) => x.id === ofDraft)?.status).toBe("borrador");
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === ofDraft)).toBe(false);
    expect(ok(await mock.practiceMedals(MARTIN)).goals.some((x) => x.id === ofDraft)).toBe(false);
  });

  test("publicar una meta de un plan finalizado o descartado: 409 CONFLICT y no cambia nada", async () => {
    await asStaff("direccion@cimt.test");
    const ofLive = await draftGoal(DEMO_PLAN, "Contar en la sesión cómo fue la semana");
    addV2(false);
    const ofDraft = await draftGoal(V2, "Pedir algo en el kiosco");
    // Al finalizarlo, su meta en borrador queda «cambiada»; la del borrador
    // nuevo (que no es de su cadena) sigue en borrador
    ok(await staffDo({ action: "plan_finish", plan_id: DEMO_PLAN }));
    ok(await staffDo({ action: "plan_withdraw", plan_id: V2 })); // un borrador se descarta sin motivo

    for (const [id, status] of [[ofLive, "cambiada"], [ofDraft, "borrador"]] as const) {
      const r = await staffDo({ action: "goal_publish", goal_id: id, adolescent_ack: true });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(409);
        expect(code(r)).toBe("CONFLICT");
      }
      expect(readDb().practice_goals.find((x) => x.id === id)?.status).toBe(status);
    }
    // Editada para el plan de ahora (sin plan publicado: sin plan), se publica
    ok(await staffDo({
      action: "goal_save",
      goal: {
        id: ofDraft, plan_id: null, kind: "terapeutica", title: "Pedir algo en el kiosco", rule: null,
        medal_title: null, agreed_with_patient: false,
      },
    }));
    const published = ok(await staffDo({ action: "goal_publish", goal_id: ofDraft, adolescent_ack: true }));
    expect(published.goals.find((x) => x.id === ofDraft)?.status).toBe("activa");
  });

  test("finalizar el plan: sus metas activas y en borrador quedan «cambiada»; las logradas siguen", async () => {
    await asStaff("direccion@cimt.test");
    const active = await draftGoal(DEMO_PLAN, "Contar en la sesión cómo fue la semana");
    ok(await staffDo({ action: "goal_publish", goal_id: active, adolescent_ack: true }));
    const fb = await achieveGoal();
    const draft = await draftGoal(DEMO_PLAN, "Pedir algo en el kiosco");

    const after = ok(await staffDo({ action: "plan_finish", plan_id: DEMO_PLAN }));
    expect(after.published).toBeNull();
    const goal = (id: string) => after.goals.find((x) => x.id === id);
    for (const id of [active, draft]) {
      expect(goal(id)).toMatchObject({ status: "cambiada", changed_by_email: "direccion@cimt.test" });
      expect(goal(id)?.changed_at).not.toBeNull();
    }
    expect(goal(GOAL)).toMatchObject({ status: "lograda", feedback_id: fb });
    // La familia ve la lograda (la dio una devolución), no la que estaba activa
    const family = ok(await mock.practice(MARTIN)).goals;
    expect(family.some((x) => x.id === active)).toBe(false);
    expect(family.find((x) => x.id === GOAL)?.status).toBe("lograda");
    expect(ok(await mock.practiceMedals(MARTIN)).goals.some((x) => x.id === active)).toBe(false);
    // Las que se cambiaron ya no se publican ni se dan por logradas
    const r = await staffDo({ action: "goal_publish", goal_id: draft, adolescent_ack: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  test("finalizar el plan finaliza también las metas de las versiones que reemplazó", async () => {
    addV2(true);
    await asStaff("direccion@cimt.test");
    // La meta de la demo es de la versión 1 y sigue activa con la versión 2
    const ofV2 = await draftGoal(V2, "Pedir algo en el kiosco");
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(true);

    const after = ok(await staffDo({ action: "plan_finish", plan_id: V2 }));
    expect(after.goals.find((x) => x.id === GOAL)?.status).toBe("cambiada");
    expect(after.goals.find((x) => x.id === ofV2)?.status).toBe("cambiada");
    expect(after.goals_met.some((x) => x.goal_id === GOAL)).toBe(false);
    expect(ok(await mock.practice(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
    expect(ok(await mock.practiceMedals(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
  });

  // La versión siguiente del plan publicado, guardada como la guarda el editor
  // (con los ejercicios del catálogo, que no piden «Lo revisé»)
  async function saveDraftFromPublished() {
    const pub = ok(await staffDo({ action: "get" })).published!;
    const exercises = pub.exercises.filter((e) => e.source === "catalogo" && !e.removed_at).map((e) => ({
      id: null, exercise_key: e.exercise_key, source: e.source, catalog_id: e.catalog_id, catalog_version: e.catalog_version,
      ai_draft_id: null, approach: e.approach, practiced_in_session: e.practiced_in_session, title: e.title,
      para_que: e.para_que, pasos: e.pasos, minutes: e.minutes, materiales: e.materiales, for_adult: e.for_adult,
      si_cuesta: e.si_cuesta, with_adult: e.with_adult, reviewed: false, removed: false, review_note: null,
    }));
    const saved = ok(await staffDo({
      action: "plan_save_draft", expected_updated_at: null,
      plan: {
        id: null, title: pub.title, goal_text: pub.goal_text, audience: pub.audience, days_per_week: pub.days_per_week,
        review_on: null, auto_medals: pub.auto_medals, review_note: null, exercises,
      },
    }));
    expect(saved.draft?.publish_problem).toBeNull();
    return saved.draft!;
  }

  const publishDraft = (draft: { id: string; updated_at: string }, expectedPublished: string | null) => staffDo({
    action: "plan_publish", plan_id: draft.id, expected_updated_at: draft.updated_at, expected_published_id: expectedPublished,
  });

  test("publicar la versión siguiente: reemplaza al publicado (supersedes_id) y la meta de antes sigue", async () => {
    await asStaff("direccion@cimt.test");
    const draft = await saveDraftFromPublished();
    const pub = ok(await publishDraft(draft, DEMO_PLAN));
    expect(pub.published?.id).toBe(draft.id);
    expect(pub.published?.supersedes_id).toBe(DEMO_PLAN);
    expect(pub.history.find((h) => h.id === DEMO_PLAN)?.status).toBe("reemplazado");
    expect(pub.goals.find((x) => x.id === GOAL)?.status).toBe("activa");
    // "Desde el …": desde la primera versión de la cadena
    const v1 = readDb().practice_plans.find((p) => p.id === DEMO_PLAN)!;
    expect(pub.summary.since).toBe(centerDateOf(String(v1.published_at)));
  });

  test("publicar un borrador armado sobre un plan que después se finalizó: no lo reemplaza", async () => {
    await asStaff("direccion@cimt.test");
    const fb = await achieveGoal();
    const draft = await saveDraftFromPublished();
    const ofDraft = await draftGoal(draft.id, "Pedir algo en el kiosco");
    // Al guardarlo, el borrador es la versión siguiente del publicado
    expect(readDb().practice_plans.find((p) => p.id === draft.id)?.supersedes_id).toBe(DEMO_PLAN);

    ok(await staffDo({ action: "plan_finish", plan_id: DEMO_PLAN }));
    // La meta del borrador nuevo no es de la cadena del finalizado: sigue en borrador
    expect(readDb().practice_goals.find((x) => x.id === ofDraft)?.status).toBe("borrador");
    // Con la versión 1 finalizada ya no hay publicado: el borrador no reemplaza a nadie
    const stale = await publishDraft(draft, DEMO_PLAN);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);

    const pub = ok(await publishDraft(draft, null));
    expect(pub.published?.id).toBe(draft.id);
    expect(pub.published?.supersedes_id).toBeNull();
    expect(readDb().practice_plans.find((p) => p.id === draft.id)?.supersedes_id).toBeNull();
    expect(pub.history.find((h) => h.id === DEMO_PLAN)?.status).toBe("finalizado");
    expect(pub.goals.find((x) => x.id === ofDraft)?.status).toBe("activa");
    // "Desde el …": desde que se publicó esta versión (la finalizada no cuenta)
    expect(pub.summary.since).toBe(centerDateOf(pub.published!.published_at!));
    // La meta lograda del plan finalizado: al retirar su devolución no vuelve
    // (la versión nueva no la reemplazó)
    const after = ok(await staffDo({ action: "feedback_withdraw", feedback_id: fb, reason: "error" }));
    expect(after.goals.find((x) => x.id === GOAL)?.status).toBe("cambiada");
    expect(ok(await mock.practiceMedals(MARTIN)).goals.some((x) => x.id === GOAL)).toBe(false);
  });
});

describe("mock: «Mis logros» sin plan (Valentina)", () => {
  const VALE = "c-valentina";
  const valeHome = async () => ok(await mock.me()).children.find((c) => c.id === VALE)?.clinical?.practice_home;

  test("Inicio: Valentina tiene logros sin plan (has_plan false) y no cuenta para «Ejercicios»", async () => {
    const me = ok(await mock.me());
    const vale = me.children.find((c) => c.id === VALE)!;
    expect(vale.clinical?.practice).toBe("ok");
    expect(vale.clinical?.practice_home).toEqual({
      mode: "tortuga", audience: "infancia", has_plan: false, week: null, on_break_until: null, feedback_new: 1, medals_new: 0,
    });
    const martin = me.children.find((c) => c.id === MARTIN)!.clinical?.practice_home;
    expect(martin?.has_plan).toBe(true);
    expect(martin?.week).not.toBeNull();
    expect(practicePeople(me).map((p) => p.child.id)).toEqual([MARTIN]);
    expect(practiceHomes(me).map((p) => p.child.id).sort()).toEqual([MARTIN, VALE].sort());
    // La celebración del Inicio sigue siendo la de Martín (Laura ya vio la de Valentina)
    expect(me.celebration?.patient_id).toBe(MARTIN);
  });

  test("su página: metas activas y logradas (con la medalla que se dio), la medalla y la devolución", async () => {
    const medals = ok(await mock.practiceMedals(VALE));
    expect(medals.goals.map((g) => [g.status, g.medal_title])).toEqual([["activa", "Gran contadora"], ["lograda", "¡Me animé!"]]);
    expect(medals.goals[0].achieved_at).toBeNull();
    expect(medals.goals[1].achieved_at).not.toBeNull();
    expect(medals.earned.map((m) => [m.title, m.is_new])).toEqual([["¡Me animé!", false]]);
    expect(medals).toMatchObject({ author_label: null, auto_medals: false, next: [], on_break_until: null });
    const fb = ok(await mock.practiceFeedback(VALE));
    expect(fb.items).toHaveLength(1);
    // Sin plan, "cuando marques un ejercicio" no aplica (feedbackNoReply); Martín sí tiene plan
    expect(fb.has_plan).toBe(false);
    expect(ok(await mock.practiceFeedback(MARTIN)).has_plan).toBe(true);
    expect(fb.items[0]).toMatchObject({ is_new: true, medal_title: "¡Me animé!", goals_achieved: ["Elegir un juego y contarnos cómo se juega"] });
    // Ejercicios: sin plan (el texto de siempre)
    expect(ok(await mock.practice(VALE)).plan).toBeNull();
    // Leída la devolución, «Nuevo» se va pero la tarjeta sigue
    ok(await mock.practiceFeedbackSeen([fb.items[0].id]));
    expect(await valeHome()).toMatchObject({ has_plan: false, feedback_new: 0, medals_new: 0 });
  });

  test("sin nada vigente (devolución retirada, medalla anulada, metas cambiadas o en borrador): null", async () => {
    const now = new Date().toISOString();
    const db = readDb();
    const fb = db.practice_feedback.find((f) => f.patient_id === VALE)!;
    const medal = db.practice_medals.find((m) => m.patient_id === VALE)!;
    const goals = db.practice_goals.filter((g) => g.patient_id === VALE);
    fb.withdrawn_at = now;
    medal.voided_at = now;
    goals[0].status = "cambiada";
    goals[1].status = "borrador";
    writeDb(db);
    expect(await valeHome()).toBeNull();
    expect((ok(await mock.me()).children.find((c) => c.id === VALE)?.clinical?.practice)).toBe("ok");

    // Cualquiera de las cosas vigentes alcanza
    const only = async (change: (d: DemoDb) => void) => {
      const d = readDb();
      change(d);
      writeDb(d);
      const home = await valeHome();
      // Y se vuelve a dejar sin nada
      const back = readDb();
      Object.assign(back.practice_feedback.find((f) => f.id === fb.id)!, { withdrawn_at: now });
      Object.assign(back.practice_medals.find((m) => m.id === medal.id)!, { voided_at: now });
      for (const g of back.practice_goals.filter((x) => x.patient_id === VALE)) g.status = "cambiada";
      writeDb(back);
      return home;
    };
    expect(await only((d) => { d.practice_feedback.find((f) => f.id === fb.id)!.withdrawn_at = null; })).toMatchObject({ has_plan: false, feedback_new: 1 });
    expect(await only((d) => { d.practice_medals.find((m) => m.id === medal.id)!.voided_at = null; })).toMatchObject({ has_plan: false, medals_new: 0 });
    expect(await only((d) => { d.practice_goals.find((g) => g.id === goals[0].id)!.status = "activa"; })).toMatchObject({ has_plan: false });
    expect(await only((d) => { d.practice_goals.find((g) => g.id === goals[0].id)!.status = "lograda"; })).toMatchObject({ has_plan: false });
    expect(await valeHome()).toBeNull();
  });

  test("regla de acceso: sin activar la información de salud o sin verificar el vínculo, nada", async () => {
    // Laura deja de ver la información de salud
    ok(await mock.clinicalConsent(false));
    const laura = ok(await mock.me());
    for (const c of laura.children) {
      expect(c.clinical?.practice).toBe("consent");
      expect(c.clinical?.practice_home).toBeUndefined();
    }
    expect(laura.celebration ?? null).toBeNull();
    expect(practiceHomes(laura)).toEqual([]);
    const blocked = await mock.practiceMedals(VALE);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(403);

    // Jorge: vínculo con Valentina sin verificar; con Martín, adulto autorizado
    ok(await mock.login("28999888", "familia2026"));
    ok(await mock.clinicalConsent(true, "familia2026"));
    const jorge = ok(await mock.me());
    expect(jorge.children.find((c) => c.id === VALE)?.clinical?.practice).toBe("verify");
    expect(jorge.children.find((c) => c.id === MARTIN)?.clinical?.practice).toBe("not_available");
    expect(jorge.children.every((c) => c.clinical?.practice_home === undefined)).toBe(true);
    expect(practiceHomes(jorge)).toEqual([]);
    const medals = await mock.practiceMedals(VALE);
    const feedback = await mock.practiceFeedback(VALE);
    expect(medals.ok || feedback.ok).toBe(false);
    if (!medals.ok) expect((medals as { code?: string }).code).toBe("VERIFY");
    const martin = await mock.practiceMedals(MARTIN);
    expect(martin.ok).toBe(false);
    if (!martin.ok) expect(martin.status).toBe(404);
  });
});

describe("mock: pausa de vacaciones en las medallas", () => {
  test("practiceMedals trae la fecha de vuelta mientras dura la pausa (y sin «Para seguir sumando»)", async () => {
    const before = ok(await mock.practiceMedals(MARTIN));
    expect(before.on_break_until).toBeNull();

    // Dentro de dos semanas (lejos del cambio de día del centro)
    const until = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    await asStaff("direccion@cimt.test");
    ok(await staffDo({ action: "plan_break", plan_id: DEMO_PLAN, until }));
    const onBreak = ok(await mock.practiceMedals(MARTIN));
    expect(onBreak.on_break_until).toBe(until);
    expect(onBreak.next).toEqual([]);
    expect(ok(await mock.practice(MARTIN)).on_break_until).toBe(until);

    ok(await staffDo({ action: "plan_break", plan_id: DEMO_PLAN, until: null }));
    expect(ok(await mock.practiceMedals(MARTIN)).on_break_until).toBeNull();
  });

  test("una pausa que ya terminó no se muestra", async () => {
    const db = readDb();
    db.practice_plans.find((p) => p.id === DEMO_PLAN)!.on_break_until = "2020-01-01";
    writeDb(db);
    expect(ok(await mock.practiceMedals(MARTIN)).on_break_until).toBeNull();
  });
});
