// Pruebas del servidor de la etapa B (ejercicios, devoluciones, metas y
// medallas: server/lib/practice.ts) contra una base de prueba en memoria que
// imita lo justo del cliente de Supabase (con el tope de 1000 filas por
// pedido de la API) y las reglas del script 26 que importan acá (una
// práctica por ejercicio y por día, una nota por cuenta, una medalla de
// constancia por período, un borrador y un publicado por paciente, el
// "Visto" en planes cerrados, las funciones de un solo paso y las cuentas de
// la bandeja). La familia (compuerta, ids ajenos, anotar, "¿Cómo te fue?",
// deshacer, devoluciones, medallas), el Inicio («Mis logros» sin plan, qué
// cuenta como algo para ver, la regla de acceso y la barra de abajo), el equipo (Administración
// sin textos, borradores con conflicto, publicar, IA sin revisar,
// devoluciones con metas y medalla, retirar y finalizar (con sus metas),
// la cadena de versiones al publicar, metas de planes cerrados,
// lecturas acotadas con muchas versiones) y la bandeja.
// Correr con: bun test
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { type Account, type ActiveChild, type Ctx, PortalError, activeChildren } from "../server/lib/portal";
import { childrenClinical, requireFeature } from "../server/lib/portalClinical";
import {
  FEEDBACK_WITHDRAWN_VOID_REASON, centerDayStartIso, familyExercise, familyFeedback, familyFeedbackSeen, familyLog,
  familyMedals, familyMedalsSeen, familyNote, familyPractice, familyUndo, pendingOf, practiceHome, practiceHomeFor,
  resetActivitiesProbe,
  staffPractice, staffPracticeAction, staffPracticeCounts, staffPracticeInbox,
} from "../server/lib/practice";
import {
  PRACTICE_NAV_EVENT, announcePracticeNav, practiceHomes, practicePeople,
} from "../src/components/portal/practiceFormat";
import { CLINICAL_NOTICE_VERSION } from "../src/lib/portalClinicalRules";
import { addDaysKey } from "../src/lib/portalRules";
import {
  type ExerciseInput, type PlanDraftInput, type StaffPracticeDTO,
  FLUENCY_TITLE_MESSAGE, PRACTICE_ERROR, PRACTICE_TEXT, STAFF_PRACTICE_TEXT, centerToday, onBreak,
} from "../src/lib/practiceRules";

// ── Base de prueba ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null; count?: number | null };

const dbErr = (message: string, code = "P0001"): Result => ({ data: null, error: { code, message } });
const DUP: DbError = { code: "23505", message: "duplicate key value violates unique constraint" };
// Como la API de Supabase (Max Rows): más de 1000 filas no vienen, sin avisar
const MAX_ROWS = 1000;
// Lo único que se puede cambiar de un plan cerrado (que se publicó): el "Visto"
const REVIEW_COLS = ["last_reviewed_at", "last_reviewed_by_email", "last_reviewed_label", "updated_at", "updated_by_email"];

class FakeDb {
  tables: Record<string, Row[]> = {};
  missing = new Set<string>();
  missingCols = new Set<string>(); // "tabla.columna" que todavía no existe (un script sin correr)
  tick = 0;
  // updated_at distinto en cada cambio (como clock_timestamp() del trigger)
  stamp(): string {
    this.tick += 1;
    return new Date(Date.now() + this.tick).toISOString();
  }
  t(name: string): Row[] {
    return (this.tables[name] ??= []);
  }
}

function defaults(db: FakeDb, table: string): Row {
  const now = new Date().toISOString();
  const base: Row = { id: randomUUID(), created_at: now };
  switch (table) {
    case "exercise_practice_logs": return { ...base, voided_at: null };
    case "exercise_practice_notes": return { ...base, result: null, comment: null, risk_flag: false };
    case "patient_medals": return {
      ...base, period_key: "", plan_id: null, goal_id: null, feedback_id: null, message: null, awarded_at: now,
      awarded_by_email: null, voided_at: null, voided_by_email: null, void_reason: null,
    };
    case "patient_exercise_plans": return {
      ...base, supersedes_id: null, goal_text: null, review_on: null, on_break_until: null, auto_medals: true,
      professional_id: null, author_label: null, adolescent_ack: false, lint_overrides: [], updated_by_email: null,
      updated_at: db.stamp(), published_at: null, published_by_email: null, closed_at: null, closed_by_email: null,
      close_reason: null, last_reviewed_at: null, last_reviewed_by_email: null, last_reviewed_label: null,
    };
    case "patient_exercises": return {
      ...base, exercise_key: randomUUID(), catalog_id: null, catalog_version: null, materiales: null, for_adult: null,
      ai_draft_id: null, ai_drafted: false, reviewed_at: null, reviewed_by_email: null, edit_ratio: null,
      lint_overrides: [], removed_at: null, removed_by_email: null, updated_at: now,
    };
    case "patient_goals": return {
      ...base, plan_id: null, rule: null, medal_title: null, agreed_with_patient: false, updated_at: now, published_at: null,
      published_by_email: null, achieved_at: null, feedback_id: null, changed_at: null, changed_by_email: null,
      met_notice_dismissed_at: null,
    };
    case "patient_practice_feedback": return {
      ...base, sent_at: now, withdrawn_at: null, withdrawn_by_email: null, withdraw_reason: null,
    };
    case "portal_access_log": return { ...base, at: now };
    default: return base;
  }
}

// Lo que cuidan los índices únicos y los triggers del script 26
function beforeInsert(db: FakeDb, table: string, row: Row): DbError | null {
  const rows = db.t(table);
  const dup = (pred: (r: Row) => boolean) => (rows.some(pred) ? DUP : null);
  switch (table) {
    case "exercise_practice_logs":
      return dup((r) => !r.voided_at && r.patient_id === row.patient_id && r.exercise_key === row.exercise_key && r.practiced_on === row.practiced_on);
    case "exercise_practice_notes": {
      const log = db.t("exercise_practice_logs").find((l) => l.id === row.log_id);
      if (!log || log.voided_at) return { code: "P0001", message: "PRACTICE_LOG: esa práctica ya no está" };
      return dup((r) => r.log_id === row.log_id && r.account_id === row.account_id);
    }
    case "patient_medals":
      if (row.kind === "constancia") {
        return dup((r) => r.kind === "constancia" && !r.voided_at && r.patient_id === row.patient_id && r.code === row.code && r.period_key === row.period_key);
      }
      return row.goal_id ? dup((r) => r.kind === "profesional" && !r.voided_at && r.goal_id === row.goal_id) : null;
    case "patient_exercise_plans":
      if (row.status !== "borrador") return { code: "P0001", message: "PRACTICE_PLAN: un plan nuevo empieza como borrador" };
      return dup((r) => r.patient_id === row.patient_id && (r.status === "borrador" || r.version === row.version));
    case "patient_exercises": {
      const plan = db.t("patient_exercise_plans").find((p) => p.id === row.plan_id);
      if (plan?.status !== "borrador") return { code: "P0001", message: "PUBLISHED_FROZEN: los ejercicios de un plan publicado no se editan" };
      if (row.ai_draft_id) {
        const d = db.t("ai_drafts").find((x) => x.id === row.ai_draft_id);
        if (!d || d.patient_id !== row.patient_id) return { code: "P0001", message: "AI_DRAFT: el borrador de IA no es de este paciente" };
        if (d.status === "generado") Object.assign(d, { status: "usado", used_at: new Date().toISOString() });
        row.ai_drafted = true;
      }
      return dup((r) => r.plan_id === row.plan_id && r.exercise_key === row.exercise_key);
    }
    default:
      return null;
  }
}

// practice_plan_open() del script 26: sin plan, publicado, en borrador o una
// versión anterior (supersedes_id) del publicado
function fakePlanOpen(db: FakeDb, planId: unknown): boolean {
  if (!planId) return true;
  const plans = db.t("patient_exercise_plans");
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return false;
  if (plan.status === "publicado" || plan.status === "borrador") return true;
  const seen = new Set<unknown>();
  let p = plans.find((x) => x.patient_id === plan.patient_id && x.status === "publicado");
  while (p && !seen.has(p.id)) {
    if (p.id === planId) return true;
    seen.add(p.id);
    const prev = p.supersedes_id;
    p = plans.find((x) => x.id === prev && x.patient_id === plan.patient_id);
  }
  return false;
}

function beforeUpdate(db: FakeDb, table: string, old: Row, patch: Row): DbError | null {
  // patient_goals_guard: una meta en borrador se publica solo si su plan sigue vigente
  if (table === "patient_goals" && old.status === "borrador" && patch.status === "activa"
      && !fakePlanOpen(db, "plan_id" in patch ? patch.plan_id : old.plan_id)) {
    return { code: "P0001", message: "PRACTICE_GOAL_PLAN: el plan de la meta ya se cerró" };
  }
  // ... y la de un plan en borrador, solo junto con él (practice_publish_plan)
  if (table === "patient_goals" && old.status === "borrador" && patch.status === "activa"
      && db.t("patient_exercise_plans").some((p) => p.id === ("plan_id" in patch ? patch.plan_id : old.plan_id) && p.status === "borrador")) {
    return { code: "P0001", message: "PRACTICE_GOAL_WITH_PLAN: la meta se publica junto con su plan en borrador" };
  }
  if (table === "patient_exercises") {
    const plan = db.t("patient_exercise_plans").find((p) => p.id === old.plan_id);
    if (plan?.status !== "borrador") return { code: "P0001", message: "PUBLISHED_FROZEN: los ejercicios de un plan publicado no se editan" };
  }
  if (table === "patient_exercise_plans" && !["borrador", "publicado"].includes(String(old.status))) {
    const onlyReview = Object.keys(patch).every((k) => REVIEW_COLS.includes(k));
    if (!old.published_at || !onlyReview) return { code: "P0001", message: "PUBLISHED_FROZEN: el plan ya está cerrado" };
  }
  if (table === "patient_medals" && old.voided_at && "voided_at" in patch) return { code: "P0001", message: "PUBLISHED_FROZEN: ya estaba anulado" };
  return null;
}

// Cada cambio de un ejercicio mueve el updated_at de su plan (trigger del script 26)
function bumpPlan(db: FakeDb, planId: unknown) {
  const plan = db.t("patient_exercise_plans").find((p) => p.id === planId);
  if (plan) plan.updated_at = db.stamp();
}

function afterUpdate(db: FakeDb, table: string, row: Row) {
  if (table === "patient_exercise_plans") row.updated_at = db.stamp();
  if (table === "patient_exercises") {
    if (row.ai_draft_id) row.ai_drafted = true;
    bumpPlan(db, row.plan_id);
  }
}

// Orden de Postgres: NULL al final de lo ascendente y al principio de lo descendente
function compare(a: unknown, b: unknown, asc: boolean): number {
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an && bn ? 0 : (an ? 1 : -1) * (asc ? 1 : -1);
  const c = typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  return asc ? c : -c;
}

const clone = <T>(x: T): T => (x === undefined ? x : structuredClone(x));

class FakeQuery implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" = "select";
  private cols: string | null = "*";
  private payload: Row | Row[] = {};
  private mode: "many" | "one" | "maybe" = "many";
  private head = false;
  private max: number | null = null;
  private orders: { c: string; asc: boolean }[] = [];

  constructor(private db: FakeDb, private table: string) {}

  select(cols = "*", opts: { head?: boolean; count?: string } = {}) { this.cols = cols; this.head = !!opts.head; return this; }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = rows; this.cols = null; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; this.cols = null; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, _op: "is", v: null) { this.filters.push((r) => (r[c] ?? null) !== v); return this; }
  gt(c: string, v: string) { this.filters.push((r) => r[c] != null && String(r[c]) > v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => r[c] != null && String(r[c]) >= v); return this; }
  lte(c: string, v: string) { this.filters.push((r) => r[c] != null && String(r[c]) <= v); return this; }
  order(c: string, o: { ascending?: boolean } = {}) { this.orders.push({ c, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = "one"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }

  private run(): Result {
    const t = this.table;
    if (this.db.missing.has(t)) return dbErr(`relation "public.${t}" does not exist`, "42P01");
    if (this.cols && this.cols !== "*" && this.cols.split(",").some((c) => this.db.missingCols.has(`${t}.${c.trim()}`))) {
      return dbErr("column does not exist", "42703");
    }
    const rows = this.db.t(t);
    let out: Row[];
    if (this.op === "insert") {
      out = [];
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const row: Row = { ...defaults(this.db, t), ...clone(p) };
        const err = beforeInsert(this.db, t, row);
        if (err) return { data: null, error: err };
        rows.push(row);
        out.push(row);
        if (t === "patient_exercises") bumpPlan(this.db, row.plan_id);
      }
    } else {
      out = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        for (const r of out) {
          const err = beforeUpdate(this.db, t, r, this.payload as Row);
          if (err) return { data: null, error: err };
        }
        for (const r of out) {
          Object.assign(r, clone(this.payload as Row));
          afterUpdate(this.db, t, r);
        }
      }
    }
    // Sin orden, la base devuelve en el orden en que guardó (las más viejas primero)
    if (this.orders.length) out = [...out].sort((a, b) => this.orders.reduce((s, o) => s || compare(a[o.c], b[o.c], o.asc), 0));
    if (this.head) return { data: null, error: null, count: out.length };
    if (this.op === "select") out = out.slice(0, Math.min(this.max ?? MAX_ROWS, MAX_ROWS));
    else if (this.max !== null) out = out.slice(0, this.max);
    if (this.cols === null) return { data: null, error: null };
    const cols = this.cols === "*" ? [] : this.cols.split(",").map((c) => c.trim());
    const pick = (r: Row) => (cols.length ? Object.fromEntries(cols.map((c) => [c, clone(r[c] ?? null)])) : clone(r));
    if (this.mode === "one") return out.length === 1 ? { data: pick(out[0]), error: null } : dbErr("no rows", "PGRST116");
    if (this.mode === "maybe") return out.length > 1 ? dbErr("multiple rows", "PGRST116") : { data: out.length ? pick(out[0]) : null, error: null };
    return { data: out.map(pick), error: null };
  }
}

// Las funciones de un solo paso y las cuentas del script 26
function rpc(db: FakeDb, name: string, p: Row): Result {
  const now = new Date().toISOString();
  const plans = db.t("patient_exercise_plans");
  // Sin el script 26 tampoco están sus funciones
  if (["exercise_practice_logs", "patient_exercise_plans"].some((t) => db.missing.has(t))) {
    return dbErr(`Could not find the function public.${name} in the schema cache`, "PGRST202");
  }
  if (name === "practice_publish_plan") {
    const plan = plans.find((x) => x.id === p.p_plan);
    if (!plan) return dbErr("PRACTICE_PLAN: el plan no existe");
    if (plan.status !== "borrador") return dbErr("PUBLISH_CONFLICT: el borrador ya no está");
    if (plan.updated_at !== p.p_expected_updated_at) return dbErr("PUBLISH_CONFLICT: otra persona cambió el borrador");
    const live = plans.find((x) => x.patient_id === plan.patient_id && x.status === "publicado");
    if ((live?.id ?? null) !== (p.p_expected ?? null)) return dbErr("PUBLISH_CONFLICT: otra persona publicó una versión nueva");
    const exs = db.t("patient_exercises").filter((e) => e.plan_id === plan.id && !e.removed_at);
    if (exs.some((e) => e.ai_drafted && !e.reviewed_at)) return dbErr("AI_NOT_REVIEWED: falta «Lo revisé»");
    if (exs.length < 1 || exs.length > 8) return dbErr("PRACTICE_PLAN: un plan publicado tiene de 1 a 8 ejercicios");
    for (const [id, ratio] of Object.entries((p.p_edit_ratios ?? {}) as Record<string, number>)) {
      const e = exs.find((x) => x.id === id);
      if (e) e.edit_ratio = Math.round(ratio * 1000) / 1000;
    }
    if (live) Object.assign(live, { status: "reemplazado", closed_at: now, closed_by_email: p.p_email, close_reason: "reemplazado", updated_at: db.stamp() });
    const liveBreak = live && onBreak(live.on_break_until as string | null, centerToday()) ? live.on_break_until : null;
    // supersedes_id: el que de verdad se reemplaza (no el que había al armar el borrador)
    Object.assign(plan, {
      status: "publicado", published_at: now, published_by_email: p.p_email, professional_id: p.p_professional,
      author_label: p.p_author_label, adolescent_ack: !!p.p_adolescent_ack, supersedes_id: live?.id ?? null,
      on_break_until: plan.on_break_until ?? liveBreak,
      last_reviewed_at: plan.last_reviewed_at ?? live?.last_reviewed_at ?? null,
      last_reviewed_by_email: plan.last_reviewed_by_email ?? live?.last_reviewed_by_email ?? null,
      last_reviewed_label: plan.last_reviewed_label ?? live?.last_reviewed_label ?? null, updated_at: db.stamp(),
    });
    for (const g of db.t("patient_goals")) {
      if (g.plan_id === plan.id && g.status === "borrador") Object.assign(g, { status: "activa", published_at: now, published_by_email: p.p_email });
    }
    return { data: plan.id, error: null };
  }
  // practice_withdraw_plan y practice_finish_plan: las dos cierran igual (practice_close_plan)
  if (name === "practice_withdraw_plan" || name === "practice_finish_plan") {
    const finish = name === "practice_finish_plan";
    const reason = finish ? "finalizado" : p.p_reason;
    if (!finish && !["error", "pedido_familia", "otro"].includes(String(reason))) {
      return dbErr("PRACTICE_PLAN: un plan publicado se retira (con motivo) o se finaliza");
    }
    const plan = plans.find((x) => x.id === p.p_plan);
    if (!plan) return dbErr("PRACTICE_PLAN: el plan no existe");
    if (plan.status !== "publicado") return dbErr("PUBLISH_CONFLICT: el plan ya no está publicado");
    Object.assign(plan, {
      status: finish ? "finalizado" : "retirado", closed_at: now, closed_by_email: p.p_email, close_reason: reason,
      updated_by_email: p.p_email, updated_at: db.stamp(),
    });
    // Él y las versiones que reemplazó: sus metas activas y en borrador pasan a "cambiada"
    const chain = new Set<unknown>();
    for (let x: Row | undefined = plan; x && !chain.has(x.id);) {
      chain.add(x.id);
      const prev: unknown = x.supersedes_id;
      x = plans.find((y) => y.id === prev && y.patient_id === plan.patient_id);
    }
    for (const g of db.t("patient_goals")) {
      if (chain.has(g.plan_id) && (g.status === "activa" || g.status === "borrador")) {
        Object.assign(g, { status: "cambiada", changed_at: now, changed_by_email: p.p_email });
      }
    }
    return { data: plan.id, error: null };
  }
  if (name === "practice_withdraw_feedback") {
    const fb = db.t("patient_practice_feedback").find((x) => x.id === p.p_feedback);
    if (!fb) return dbErr("PRACTICE_FEEDBACK: la devolución no existe");
    if (fb.withdrawn_at) return dbErr("PRACTICE_FEEDBACK: ya estaba retirada");
    Object.assign(fb, { withdrawn_at: now, withdrawn_by_email: p.p_email, withdraw_reason: p.p_reason });
    // Vuelven a activas si su plan sigue vigente; si no, quedan "cambiada"
    for (const g of db.t("patient_goals")) {
      if (g.feedback_id !== fb.id || g.status !== "lograda") continue;
      Object.assign(g, fakePlanOpen(db, g.plan_id)
        ? { status: "activa", achieved_at: null, feedback_id: null }
        : { status: "cambiada", achieved_at: null, feedback_id: null, changed_at: now, changed_by_email: p.p_email });
    }
    for (const m of db.t("patient_medals")) {
      if (m.feedback_id === fb.id && m.kind === "profesional" && !m.voided_at) {
        Object.assign(m, { voided_at: now, voided_by_email: p.p_email, void_reason: FEEDBACK_WITHDRAWN_VOID_REASON });
      }
    }
    return { data: fb.id, error: null };
  }
  if (name === "practice_pending") {
    const since = (p.p_since as string | null) ?? null;
    const wanted = (p.p_patients as string[] | null) ?? [];
    const out: Row[] = [];
    for (const pid of [...new Set(plans.filter((x) => x.published_at).map((x) => String(x.patient_id)))]) {
      // p_only: solo los pedidos
      if (p.p_only === true && !wanted.includes(pid)) continue;
      const mine = plans.filter((x) => x.patient_id === pid && x.published_at);
      const reviewed = mine.map((x) => x.last_reviewed_at as string | null).filter((x): x is string => !!x).sort().pop() ?? null;
      const after = (iso: unknown) => (!since || String(iso) >= since) && (!reviewed || String(iso) > reviewed);
      const logs = db.t("exercise_practice_logs").filter((l) => l.patient_id === pid && !l.voided_at && after(l.created_at));
      const notes = db.t("exercise_practice_notes").filter((n) => n.patient_id === pid && (n.comment || n.result === "costo" || n.risk_flag) && after(n.created_at));
      if (!logs.length && !notes.length && !wanted.includes(pid)) continue;
      out.push({
        patient_id: pid, last_reviewed_at: reviewed,
        on_break_until: mine.find((x) => x.status === "publicado")?.on_break_until ?? null,
        logs: logs.length, first_log: logs.map((l) => String(l.practiced_on)).sort()[0] ?? null,
        comments: notes.filter((n) => n.comment).length, costo: notes.filter((n) => n.result === "costo").length,
        risk: notes.filter((n) => n.risk_flag).length, first_note: notes.map((n) => String(n.created_at)).sort()[0] ?? null,
      });
    }
    return { data: out, error: null };
  }
  if (name === "practice_days") {
    const from = (p.p_from as string | null) ?? null;
    const out: Row[] = [];
    for (const pid of (p.p_patients as string[]) ?? []) {
      const per = new Map<string, number>();
      for (const l of db.t("exercise_practice_logs")) {
        if (l.patient_id !== pid || l.voided_at || (from && String(l.practiced_on) < from)) continue;
        per.set(String(l.practiced_on), (per.get(String(l.practiced_on)) ?? 0) + 1);
      }
      const days = [...per.keys()].sort();
      if (days.length) out.push({ patient_id: pid, days, counts: days.map((d) => per.get(d)) });
    }
    return { data: out, error: null };
  }
  if (name === "practice_send_feedback") {
    const goalIds = [...new Set((p.p_goal_ids as string[] | null) ?? [])];
    const goals = db.t("patient_goals").filter((g) => goalIds.includes(String(g.id)) && g.patient_id === p.p_patient && g.status === "activa");
    if (goals.length !== goalIds.length) return dbErr("PRACTICE_GOAL: alguna meta ya no está activa");
    if (p.p_medal_goal && db.t("patient_medals").some((m) => m.kind === "profesional" && !m.voided_at && m.goal_id === p.p_medal_goal)) {
      return { data: null, error: DUP };
    }
    const id = randomUUID();
    db.t("patient_practice_feedback").push({
      ...defaults(db, "patient_practice_feedback"), id, patient_id: p.p_patient, plan_id: p.p_plan,
      professional_id: p.p_professional, author_label: p.p_author_label, body: p.p_body, for_adult: p.p_for_adult,
      period_start: p.p_period_start, period_end: p.p_period_end, adolescent_ack: !!p.p_adolescent_ack,
      review_note: p.p_review_note, sent_by_email: p.p_email,
    });
    for (const g of goals) Object.assign(g, { status: "lograda", achieved_at: now, feedback_id: id });
    if (p.p_medal_title) {
      db.t("patient_medals").push({
        ...defaults(db, "patient_medals"), patient_id: p.p_patient, kind: "profesional", code: "profesional",
        title: p.p_medal_title, plan_id: p.p_plan, goal_id: p.p_medal_goal, feedback_id: id, message: p.p_medal_message,
        awarded_by_email: p.p_email,
      });
    }
    // "Visto" en el publicado o, si no hay, en el último que se publicó
    const target = plans.filter((x) => x.patient_id === p.p_patient && x.published_at)
      .sort((a, b) => Number(b.status === "publicado") - Number(a.status === "publicado") || Number(b.version) - Number(a.version))[0];
    if (target) Object.assign(target, { last_reviewed_at: now, last_reviewed_by_email: p.p_email, last_reviewed_label: p.p_author_label, updated_at: db.stamp() });
    return { data: id, error: null };
  }
  return dbErr(`function ${name} does not exist`, "42883");
}

function fakeCtx(db: FakeDb): Ctx {
  const admin = { from: (t: string) => new FakeQuery(db, t), rpc: async (name: string, p: Row) => rpc(db, name, p) };
  return { admin, anon: () => admin, asUser: () => admin, pepper: "p".repeat(32) } as unknown as Ctx;
}

// ── Datos ───────────────────────────────────────────────────────────────────

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // Martín, 6 años, F98.5 (de la Lic. Torres)
const Q = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // Lucía, de otra familia
const A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // Ana (madre)
const B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // Juan (padre)
const PRO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // Lic. Ana Torres
const PLAN = "11111111-1111-4111-8111-111111111111";
const EX1 = "22222222-2222-4222-8222-222222222222";
const EX2 = "33333333-3333-4333-8333-333333333333";
const EX3 = "44444444-4444-4444-8444-444444444444"; // quitado
const EXQ = "55555555-5555-4555-8555-555555555555"; // de Lucía
const K1 = "66666666-6666-4666-8666-666666666666";
const K2 = "77777777-7777-4777-8777-777777777777";
const K3 = "88888888-8888-4888-8888-888888888888";
const AI = "99999999-9999-4999-8999-999999999999";
const TODAY = "2026-10-14"; // miércoles (la semana empieza el lunes 12)
const NOW = new Date(`${TODAY}T15:00:00.000Z`);
const AUTHOR = "Lic. Ana Torres · MP 1234";
const GRID_LAST = 13; // hoy, en la grilla de 14 días

const ACCOUNT_A: Account = { id: A, user_id: "u-a", dni: "28999888", first_name: "Ana", last_name: "Pérez", active: true };
const ACCOUNT_B: Account = { id: B, user_id: "u-b", dni: "27111222", first_name: "Juan", last_name: "Pérez", active: true };
const PROF = { user_id: "u-pro", email: "ana.torres@cimt.test", role: "profesional", clinical: true };
const PROF2 = { user_id: "u-pro2", email: "otra@cimt.test", role: "profesional", clinical: true }; // sin matrícula
const UNLINKED = { user_id: "u-x", email: "x@cimt.test", role: "profesional", clinical: true };
const DIR = { user_id: "u-dir", email: "dir@cimt.test", role: "direccion", clinical: true };
const ADMIN = { user_id: "u-adm", email: "adm@cimt.test", role: "administracion", clinical: false };

const TEXTS = {
  para_que: "Un rato de juego a solas con un adulto para disfrutar de conversar.",
  pasos: ["Elijan un juego sin pantallas.", "El adulto acompaña y comenta lo que ve con frases cortas."],
  materiales: "Bloques o muñecos.",
  for_adult: "Practiquen en un momento tranquilo, sin apuro.",
  si_cuesta: "Si no tiene ganas, déjenlo para otro día y cuéntenlo en la próxima sesión.",
};

function exRow(id: string, key: string, o: Row = {}): Row {
  return {
    id, plan_id: PLAN, patient_id: P, exercise_key: key, source: "catalogo", catalog_id: "ef-tiempo-especial",
    catalog_version: "2026-10-borrador-1", position: 0, approach: "entorno_familia", practiced_in_session: false,
    title: "Tiempo de juego", ...TEXTS, minutes: 5, with_adult: true, ai_draft_id: null, ai_drafted: false,
    reviewed_at: null, reviewed_by_email: null, edit_ratio: null, lint_overrides: [], removed_at: null, removed_by_email: null,
    created_at: "2026-10-09T12:00:00.000Z", updated_at: "2026-10-09T12:00:00.000Z", ...o,
  };
}

function planRow(o: Row = {}): Row {
  return {
    id: PLAN, patient_id: P, version: 1, supersedes_id: null, status: "publicado", title: "Jugar y conversar",
    goal_text: "Disfrutar de conversar en casa.", audience: "infancia", days_per_week: 3, review_on: "2026-11-10",
    on_break_until: null, auto_medals: true, professional_id: PRO, author_label: AUTHOR, adolescent_ack: false,
    lint_overrides: [], created_by_email: PROF.email, created_at: "2026-10-09T12:00:00.000Z", updated_by_email: PROF.email,
    updated_at: "2026-10-10T13:00:00.000Z", published_at: "2026-10-10T13:00:00.000Z", published_by_email: PROF.email,
    closed_at: null, closed_by_email: null, close_reason: null, last_reviewed_at: null, last_reviewed_by_email: null,
    last_reviewed_label: null, ...o,
  };
}

const link = (id: string, account: string, guardian: string, o: Row = {}): Row => ({
  id, account_id: account, patient_id: P, guardian_id: guardian, relationship_kind: "representante_legal",
  adolescent_consent_at: null, revoked_at: null, verified_in_person_on: "2026-10-01", parental_checked_on: "2026-10-01", ...o,
});
const consent = (account: string): Row => ({
  account_id: account, kind: "informacion_clinica", version: CLINICAL_NOTICE_VERSION, accepted: true, channel: "portal",
  created_at: "2026-10-01T10:00:00.000Z",
});

function seed(o: { birth?: string; enabled?: boolean; plan?: boolean } = {}): FakeDb {
  const db = new FakeDb();
  db.tables = {
    patients: [
      { id: P, first_name: "Martín", last_name: "Pérez", dni: "50111222", birth_date: o.birth ?? "2020-05-01", discharge_date: null, diagnosis_code: "F98.5", professional_id: PRO },
      { id: Q, first_name: "Lucía", last_name: "Gómez", dni: "50999888", birth_date: "2019-03-01", discharge_date: null, diagnosis_code: "F98.5", professional_id: null },
    ],
    patient_guardians: [
      { id: "g-1", patient_id: P, full_name: "Ana Pérez", relationship: "Madre", dni: "28999888", active: true },
      { id: "g-2", patient_id: P, full_name: "Juan Pérez", relationship: "Padre", dni: "27111222", active: true },
    ],
    portal_accounts: [{ ...ACCOUNT_A }, { ...ACCOUNT_B }],
    portal_links: [link("l-1", A, "g-1"), link("l-2", B, "g-2")],
    portal_guardian_blocks: [],
    portal_consents: [consent(A), consent(B)],
    patient_portal_settings: [{
      patient_id: P, info_enabled: false, practice_enabled: o.enabled ?? true, paused_at: null, pause_reason: null,
      adolescent_agreed_on: "2026-10-01", adolescent_agreed_by_email: PROF.email, adolescent_withdrawn_on: null,
      updated_by_email: PROF.email, updated_at: "2026-10-01T10:00:00.000Z",
    }],
    patient_files: [],
    professionals: [
      { id: PRO, name: "Lic. Ana Torres", license: "1234", user_id: PROF.user_id },
      { id: randomUUID(), name: "Lic. Otra", license: "", user_id: PROF2.user_id },
    ],
    admins: [
      { user_id: PROF.user_id, email: PROF.email, role: "profesional", active: true },
      { user_id: DIR.user_id, email: DIR.email, role: "direccion", active: true },
    ],
    portal_access_log: [],
    patient_exercise_plans: o.plan === false ? [] : [planRow()],
    patient_exercises: o.plan === false ? [] : [
      exRow(EX1, K1, { position: 0, title: "Tiempo de juego" }),
      exRow(EX2, K2, { position: 1, title: "Turnos en la mesa", for_adult: "Esperen su turno con calma." }),
      exRow(EX3, K3, { position: 2, title: "Ejercicio quitado", removed_at: "2026-10-09T12:00:00.000Z", removed_by_email: PROF.email }),
    ],
    exercise_practice_logs: [],
    exercise_practice_notes: [],
    patient_practice_feedback: [],
    patient_goals: [],
    patient_medals: [],
    ai_drafts: [],
  };
  // Un plan de Lucía (de otra familia)
  if (o.plan !== false) {
    db.tables.patient_exercise_plans.push(planRow({ id: randomUUID(), patient_id: Q, professional_id: null }));
    db.tables.patient_exercises.push(exRow(EXQ, randomUUID(), { patient_id: Q, plan_id: db.tables.patient_exercise_plans[1].id }));
  }
  return db;
}

const CHILDREN: ActiveChild[] = [{ patient_id: P, first_name: "Martín", last_name: "Pérez", display: "Martín", kind: "representante_legal", self: false }];

async function failure(p: Promise<unknown>): Promise<PortalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PortalError) return e;
    throw e;
  }
  throw new Error("se esperaba un error y no lo hubo");
}

const extra = (e: PortalError) => e.extra as { code?: string; terms?: string[]; index?: number; field?: string };
const addLog = (db: FakeDb, o: Row): Row => {
  const row: Row = {
    id: randomUUID(), patient_id: P, plan_id: PLAN, exercise_id: EX1, exercise_key: K1, account_id: A,
    practiced_on: TODAY, created_at: NOW.toISOString(), voided_at: null, ...o,
  };
  db.tables.exercise_practice_logs.push(row);
  return row;
};
const addMedal = (db: FakeDb, o: Row): Row => {
  const row: Row = { ...defaults(db, "patient_medals"), patient_id: P, kind: "constancia", code: "primer_paso", title: "Primer paso", ...o };
  db.tables.patient_medals.push(row);
  return row;
};

const savedFeatures = process.env.PORTAL_CLINICAL_FEATURES;
beforeEach(() => {
  setSystemTime(NOW);
  resetActivitiesProbe();
  process.env.PORTAL_CLINICAL_FEATURES = "consent,practice";
});
afterAll(() => {
  setSystemTime();
  if (savedFeatures === undefined) delete process.env.PORTAL_CLINICAL_FEATURES;
  else process.env.PORTAL_CLINICAL_FEATURES = savedFeatures;
});

// ── Familia ─────────────────────────────────────────────────────────────────

describe("familia: quién puede ver los ejercicios", () => {
  test("con la etapa apagada el endpoint no existe", () => {
    process.env.PORTAL_CLINICAL_FEATURES = "consent,info";
    expect(() => requireFeature("practice")).toThrow("No disponible.");
    process.env.PORTAL_CLINICAL_FEATURES = "consent,practice";
    expect(() => requireFeature("practice")).not.toThrow();
  });

  test("sin activar la información de salud: CONSENT", async () => {
    const db = seed();
    db.tables.portal_consents = [consent(B)];
    const e = await failure(familyPractice(fakeCtx(db), ACCOUNT_A, P));
    expect(e.status).toBe(403);
    expect(extra(e).code).toBe("CONSENT");
  });

  test("sin verificar el vínculo en persona: VERIFY", async () => {
    const db = seed();
    db.tables.portal_links[0].verified_in_person_on = null;
    const e = await failure(familyPractice(fakeCtx(db), ACCOUNT_A, P));
    expect(extra(e).code).toBe("VERIFY");
  });

  test("sin prender la práctica para el paciente: el texto genérico, sin el motivo", async () => {
    const e = await failure(familyPractice(fakeCtx(seed({ enabled: false })), ACCOUNT_A, P));
    expect(e.status).toBe(403);
    expect(extra(e).code).toBe("NOT_AVAILABLE");
    expect(e.message).toBe(PRACTICE_TEXT.not_available);
  });

  test("un paciente ajeno y un adulto autorizado dan el mismo 404 que uno que no existe", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const foreign = await failure(familyPractice(ctx, ACCOUNT_A, Q));
    const missing = await failure(familyPractice(ctx, ACCOUNT_A, randomUUID()));
    expect(foreign.status).toBe(404);
    expect(foreign.message).toBe(missing.message);
    db.tables.portal_links[1].relationship_kind = "autorizado";
    const auth = await failure(familyPractice(ctx, ACCOUNT_B, P));
    expect(auth.status).toBe(404);
    expect(auth.message).toBe(missing.message);
  });

  test("un ejercicio, una práctica o una medalla ajenos dan el mismo 404 que uno que no existe", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const foreign = await failure(familyExercise(ctx, ACCOUNT_A, EXQ));
    const missing = await failure(familyExercise(ctx, ACCOUNT_A, randomUUID()));
    expect(foreign.status).toBe(404);
    expect(foreign.message).toBe(missing.message);
    const logQ = addLog(db, { patient_id: Q, exercise_id: EXQ, account_id: null });
    const n1 = await failure(familyNote(ctx, ACCOUNT_A, { log_id: logQ.id, result: "bien" }));
    const n2 = await failure(familyNote(ctx, ACCOUNT_A, { log_id: randomUUID(), result: "bien" }));
    expect(n1.status).toBe(404);
    expect(n1.message).toBe(n2.message);
    const log = await failure(familyLog(ctx, ACCOUNT_A, { exercise_id: EXQ }));
    expect(log.status).toBe(404);
    expect(db.tables.exercise_practice_logs).toHaveLength(1);
  });
});

describe("familia: Ejercicios de Martín", () => {
  test("plan, ejercicios activos en orden, semana y modo tortuga; sin datos internos", async () => {
    const db = seed();
    const dto = await familyPractice(fakeCtx(db), ACCOUNT_A, P);
    expect(dto.child).toEqual({ id: P, first_name: "Martín", self: false, audience: "infancia" });
    expect(dto.mode).toBe("tortuga");
    expect(dto.plan?.author_label).toBe(AUTHOR);
    expect(dto.plan?.total_minutes).toBe(10);
    expect(dto.exercises.map((e) => e.id)).toEqual([EX1, EX2]);
    expect(dto.week?.week).toBe("2026-10-12");
    expect(dto.week?.target).toBe(3);
    expect(dto.adult_guide).toEqual([TEXTS.for_adult, "Esperen su turno con calma."]);
    expect(dto.reviewed).toBeNull();
    const json = JSON.stringify(dto);
    for (const forbidden of ["by_email", "lint_overrides", "exercise_key", "review_on", "risk", "removed"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  test("sin plan publicado: plan null y el modo por la edad", async () => {
    const dto = await familyPractice(fakeCtx(seed({ plan: false })), ACCOUNT_A, P);
    expect(dto.plan).toBeNull();
    expect(dto.week).toBeNull();
    expect(dto.exercises).toEqual([]);
    expect(dto.mode).toBe("tortuga");
  });

  test("sin el script 26 la página no se cae: no hay nada publicado", async () => {
    const db = seed();
    for (const t of ["patient_exercise_plans", "patient_exercises", "exercise_practice_logs", "patient_goals", "patient_practice_feedback", "patient_medals"]) db.missing.add(t);
    const dto = await familyPractice(fakeCtx(db), ACCOUNT_A, P);
    expect(dto.plan).toBeNull();
    expect(dto.celebration).toEqual([]);
  });
});

describe("familia: Ya lo hice", () => {
  test("queda anotada, da «Primer paso» y la semana suma un día", async () => {
    const db = seed();
    const r = await familyLog(fakeCtx(db), ACCOUNT_A, { exercise_id: EX1 });
    expect(db.tables.exercise_practice_logs).toHaveLength(1);
    expect(r.log_id).toBe(db.tables.exercise_practice_logs[0].id as string);
    expect(r.new_medals.map((m) => m.title)).toEqual(["Primer paso"]);
    expect(r.new_medals[0]).toMatchObject({ patient_id: P, first_name: "Martín", kind: "constancia", by: null, audience: "infancia" });
    expect(r.exercise.week.count).toBe(1);
    expect(r.exercise.days.map((d) => d.label)).toEqual(["hoy", "ayer", "anteayer"]);
    expect(r.exercise.days[0].log).toMatchObject({ mine: true, can_undo: true, my_note: null });
    const plan = await familyPractice(fakeCtx(db), ACCOUNT_A, P);
    expect(plan.exercises[0]).toMatchObject({ done_today: true, can_undo: true });
  });

  test("una por ejercicio y por día aunque la anoten dos adultos", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const a = await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1 });
    const b = await familyLog(ctx, ACCOUNT_B, { exercise_id: EX1 });
    expect(b.log_id).toBe(a.log_id!);
    expect(b.new_medals).toEqual([]);
    expect(db.tables.exercise_practice_logs).toHaveLength(1);
    expect(b.exercise.days[0].log).toMatchObject({ mine: false, can_undo: false });
    expect(db.tables.patient_medals).toHaveLength(1);
  });

  test("fechas: hoy, ayer o anteayer, y nunca antes de que se publicara el ejercicio", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    for (const d of ["2026-10-11", "2026-10-15", "14/10/2026"]) {
      const e = await failure(familyLog(ctx, ACCOUNT_A, { exercise_id: EX1, practiced_on: d }));
      expect(e.status).toBe(400);
      expect(extra(e).code).toBe("DATE");
      expect(e.message).toBe(PRACTICE_ERROR.date);
    }
    const ok = await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1, practiced_on: "2026-10-12" });
    expect(ok.exercise.days[2].log).not.toBeNull();
    // Publicado ayer: anteayer todavía no lo tenían
    db.tables.patient_exercise_plans[0].published_at = "2026-10-13T13:00:00.000Z";
    const e = await failure(familyLog(ctx, ACCOUNT_A, { exercise_id: EX2, practiced_on: "2026-10-12" }));
    expect(e.message).toBe(PRACTICE_ERROR.before_publish);
    const page = await familyExercise(ctx, ACCOUNT_A, EX2);
    expect(page.days.map((d) => d.date)).toEqual(["2026-10-14", "2026-10-13"]);
  });

  test("40 anotaciones por cuenta y por día (cuentan las deshechas)", async () => {
    const db = seed();
    for (let i = 0; i < 40; i++) addLog(db, { exercise_key: randomUUID(), voided_at: NOW.toISOString() });
    const e = await failure(familyLog(fakeCtx(db), ACCOUNT_A, { exercise_id: EX1 }));
    expect(e.status).toBe(429);
    expect(extra(e).code).toBe("LIMIT");
    // Las de ayer no cuentan
    for (const l of db.tables.exercise_practice_logs) l.created_at = "2026-10-14T02:59:00.000Z";
    expect(centerDayStartIso(TODAY)).toBe("2026-10-14T03:00:00.000Z");
    await familyLog(fakeCtx(db), ACCOUNT_A, { exercise_id: EX1 });
  });

  test("medallas: no con el interruptor apagado ni en pausa, y una anulada no vuelve sola", async () => {
    const off = seed();
    off.tables.patient_exercise_plans[0].auto_medals = false;
    expect((await familyLog(fakeCtx(off), ACCOUNT_A, { exercise_id: EX1 })).new_medals).toEqual([]);

    const pause = seed();
    pause.tables.patient_exercise_plans[0].on_break_until = "2026-10-20";
    const r = await familyLog(fakeCtx(pause), ACCOUNT_A, { exercise_id: EX1 });
    expect(r.new_medals).toEqual([]);
    expect(r.exercise.on_break_until).toBe("2026-10-20");

    const voided = seed();
    addMedal(voided, { voided_at: "2026-10-12T10:00:00.000Z", voided_by_email: PROF.email, void_reason: "Error de carga" });
    expect((await familyLog(fakeCtx(voided), ACCOUNT_A, { exercise_id: EX1 })).new_medals).toEqual([]);
  });

  test("semana cumplida: con la meta de 2 días, al anotar el segundo día", async () => {
    const db = seed();
    db.tables.patient_exercise_plans[0].days_per_week = 2;
    const ctx = fakeCtx(db);
    await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1, practiced_on: "2026-10-13" });
    const r = await familyLog(ctx, ACCOUNT_A, { exercise_id: EX2 });
    expect(r.new_medals.map((m) => m.title)).toEqual(["Semana cumplida"]);
    expect(db.tables.patient_medals.find((m) => m.code === "semana_cumplida")?.period_key).toBe("2026-10-12");
  });

  test("un ejercicio de una versión anterior se anota en la versión publicada", async () => {
    const db = seed();
    const old = db.tables.patient_exercise_plans[0];
    Object.assign(old, { status: "reemplazado", closed_at: NOW.toISOString(), closed_by_email: PROF.email, close_reason: "reemplazado" });
    const V2 = randomUUID();
    const NEW_EX = randomUUID();
    db.tables.patient_exercise_plans.push(planRow({ id: V2, version: 2, supersedes_id: PLAN, published_at: "2026-10-13T13:00:00.000Z" }));
    db.tables.patient_exercises.push(exRow(NEW_EX, K1, { plan_id: V2 }));
    const r = await familyLog(fakeCtx(db), ACCOUNT_A, { exercise_id: EX1, practiced_on: "2026-10-12" });
    expect(r.exercise.exercise.id).toBe(NEW_EX);
    // El ejercicio se publicó por primera vez el 10/10 (versión 1): el 12 vale
    expect(db.tables.exercise_practice_logs[0]).toMatchObject({ exercise_id: NEW_EX, plan_id: V2, exercise_key: K1 });
  });
});

describe("familia: ¿Cómo te fue? y deshacer", () => {
  test("una nota por cuenta; el riesgo lo calcula el servidor y el comentario no va a los logs", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const { log_id } = await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1 });
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      const comment = "A veces dice que se quiere morir cuando se traba";
      const r = await familyNote(ctx, ACCOUNT_A, { log_id, result: "costo", comment, risk: false });
      expect(r.exercise.days[0].log?.my_note).toEqual({ result: "costo", comment });
      expect(db.tables.exercise_practice_notes[0]).toMatchObject({ account_id: A, risk_flag: true });
      const again = await failure(familyNote(ctx, ACCOUNT_A, { log_id, result: "bien" }));
      expect(again.status).toBe(409);
      expect(again.message).toBe(PRACTICE_ERROR.note_twice);
      // El otro adulto deja la suya y no ve la de Ana
      const b = await familyNote(ctx, ACCOUNT_B, { log_id, result: "bien" });
      expect(b.exercise.days[0].log?.my_note).toEqual({ result: "bien", comment: null });
      expect(JSON.stringify(b)).not.toContain(comment);
      expect(JSON.stringify(errors)).not.toContain(comment);
    } finally {
      console.error = original;
    }
  });

  test("nota vacía o comentario largo: 400", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const { log_id } = await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1 });
    expect((await failure(familyNote(ctx, ACCOUNT_A, { log_id }))).message).toBe(PRACTICE_ERROR.note_empty);
    expect((await failure(familyNote(ctx, ACCOUNT_A, { log_id, comment: "x".repeat(281) }))).message).toBe(PRACTICE_ERROR.comment_long);
  });

  test("deshacer: solo quien la anotó y el mismo día; después se puede anotar de nuevo", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const { log_id } = await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1 });
    const other = await failure(familyUndo(ctx, ACCOUNT_B, { log_id }));
    expect(other.status).toBe(403);
    expect(other.message).toBe(PRACTICE_ERROR.undo_only_mine);
    const r = await familyUndo(ctx, ACCOUNT_A, { log_id });
    expect(r.log_id).toBeNull();
    expect(r.exercise.days[0].log).toBeNull();
    expect(db.tables.exercise_practice_logs[0].voided_at).not.toBeNull();
    // La nota sobre una práctica deshecha no se puede dejar
    expect((await failure(familyNote(ctx, ACCOUNT_A, { log_id, result: "bien" }))).status).toBe(409);
    // De nuevo: otra práctica, y "Primer paso" no se repite
    const again = await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1 });
    expect(again.log_id).not.toBe(log_id);
    expect(again.new_medals).toEqual([]);
    // Una anotada ayer ya no se deshace
    const old = addLog(db, { exercise_id: EX2, exercise_key: K2, practiced_on: "2026-10-13", created_at: "2026-10-13T20:00:00.000Z" });
    expect((await failure(familyUndo(ctx, ACCOUNT_A, { log_id: old.id }))).status).toBe(403);
  });
});

describe("familia: devoluciones y medallas", () => {
  function withFeedback(db: FakeDb) {
    const FB = randomUUID();
    db.tables.patient_practice_feedback.push(
      { ...defaults(db, "patient_practice_feedback"), id: FB, patient_id: P, plan_id: PLAN, professional_id: PRO, author_label: AUTHOR, body: "¡Qué buena constancia!", for_adult: null, period_start: null, period_end: null, adolescent_ack: false, review_note: null, sent_at: "2026-10-13T12:00:00.000Z", sent_by_email: PROF.email },
      { ...defaults(db, "patient_practice_feedback"), patient_id: P, plan_id: PLAN, professional_id: PRO, author_label: AUTHOR, body: "Esta la retiraron.", for_adult: null, period_start: null, period_end: null, adolescent_ack: false, review_note: null, sent_at: "2026-10-12T12:00:00.000Z", sent_by_email: PROF.email, withdrawn_at: "2026-10-12T13:00:00.000Z", withdrawn_by_email: PROF.email, withdraw_reason: "error" },
    );
    return FB;
  }

  test("abrirlas no las marca (dos cargas siguen en «Nueva»); feedback_seen las marca para esta cuenta, no la otra", async () => {
    const db = seed();
    const FB = withFeedback(db);
    const ctx = fakeCtx(db);
    const first = await familyFeedback(ctx, ACCOUNT_A, P);
    expect(first.items.map((i) => [i.id, i.is_new])).toEqual([[FB, true]]);
    expect(first.has_plan).toBe(true);
    // Una segunda carga (StrictMode, "Reintentar") sigue mostrando "Nueva"
    expect((await familyFeedback(ctx, ACCOUNT_A, P)).items[0].is_new).toBe(true);
    expect(db.tables.portal_access_log).toEqual([]);

    await familyFeedbackSeen(ctx, ACCOUNT_A, { ids: [FB] });
    expect(db.tables.portal_access_log).toMatchObject([{ account_id: A, action: "ver_devolucion", target_id: FB, patient_id: P }]);
    expect((await familyFeedback(ctx, ACCOUNT_A, P)).items[0].is_new).toBe(false);
    expect((await familyPractice(ctx, ACCOUNT_A, P)).feedback_new).toBe(0);
    // Marcarla de nuevo no repite el registro
    await familyFeedbackSeen(ctx, ACCOUNT_A, { ids: [FB] });
    expect(db.tables.portal_access_log).toHaveLength(1);
    expect((await familyPractice(ctx, ACCOUNT_B, P)).feedback_new).toBe(1);
  });

  test("feedback_seen ignora las retiradas y las de otra familia; ids inválidos: 400", async () => {
    const db = seed();
    withFeedback(db);
    const withdrawn = db.tables.patient_practice_feedback.find((f) => f.withdrawn_at)!;
    const foreign: Row = { ...defaults(db, "patient_practice_feedback"), patient_id: Q, plan_id: null, professional_id: null, author_label: AUTHOR, body: "Para otra familia.", for_adult: null, period_start: null, period_end: null, adolescent_ack: false, review_note: null, sent_by_email: PROF.email };
    db.tables.patient_practice_feedback.push(foreign);
    const ctx = fakeCtx(db);
    await familyFeedbackSeen(ctx, ACCOUNT_A, { ids: [withdrawn.id, foreign.id, randomUUID()] });
    expect(db.tables.portal_access_log).toEqual([]);
    expect((await failure(familyFeedbackSeen(ctx, ACCOUNT_A, { ids: ["no-es-un-id"] }))).status).toBe(400);
    expect((await failure(familyFeedbackSeen(ctx, ACCOUNT_A, { ids: Array.from({ length: 51 }, () => randomUUID()) }))).status).toBe(400);
    expect((await failure(familyFeedbackSeen(ctx, ACCOUNT_A, {}))).status).toBe(400);
  });

  test("medallas: las que se repiten van juntas, la del profesional con su nombre y una anulada no se ve", async () => {
    const db = seed();
    const FB = withFeedback(db);
    addMedal(db, { awarded_at: "2026-10-10T15:00:00.000Z" });
    addMedal(db, { code: "semana_cumplida", title: "Semana cumplida", period_key: "2026-09-28", awarded_at: "2026-10-01T15:00:00.000Z" });
    addMedal(db, { code: "semana_cumplida", title: "Semana cumplida", period_key: "2026-10-05", awarded_at: "2026-10-08T15:00:00.000Z" });
    addMedal(db, { code: "un_mes", title: "Un mes practicando", voided_at: "2026-10-09T10:00:00.000Z", voided_by_email: PROF.email, void_reason: "Error" });
    const pro = addMedal(db, { kind: "profesional", code: "profesional", title: "Me animé", feedback_id: FB, message: "¡Bien ahí!", awarded_by_email: PROF.email, awarded_at: "2026-10-13T12:00:00.000Z" });
    addLog(db, { practiced_on: "2026-10-13" });
    const dto = await familyMedals(fakeCtx(db), ACCOUNT_A, P);
    expect(dto.earned.map((m) => [m.title, m.times])).toEqual([["Me animé", 1], ["Primer paso", 1], ["Semana cumplida", 2]]);
    expect(dto.earned[0]).toMatchObject({ id: pro.id, by: AUTHOR, message: "¡Bien ahí!", is_new: true });
    expect(dto.author_label).toBe(AUTHOR);
    expect(dto.auto_medals).toBe(true);
    // "Para seguir sumando": la anulada (un mes) no se vuelve a dar sola, así que no se ofrece
    expect(dto.next.map((n) => n.code)).toEqual(["semana_cumplida", "practicas_10"]);
    expect(dto.goals).toEqual([]);
  });

  test("celebración: la del profesional sin su nombre; medals_seen solo marca las de esta cuenta", async () => {
    const db = seed();
    const FB = withFeedback(db);
    const pro = addMedal(db, { kind: "profesional", code: "profesional", title: "Hablé de la tartamudez con alguien", feedback_id: FB, awarded_by_email: PROF.email });
    const theirs = addMedal(db, { patient_id: Q });
    const ctx = fakeCtx(db);
    const dto = await familyPractice(ctx, ACCOUNT_A, P);
    expect(dto.celebration).toEqual([{ medal_id: pro.id as string, patient_id: P, first_name: "Martín", self: false, audience: "infancia", kind: "profesional", title: null, by: AUTHOR }]);
    const home = await practiceHome(ctx, ACCOUNT_A, CHILDREN, [P]);
    expect(home.celebration).toMatchObject({ medal_id: pro.id, title: null, by: AUTHOR });
    expect(home.home.get(P)).toMatchObject({ mode: "tortuga", audience: "infancia", has_plan: true, week: { count: 0, target: 3 }, feedback_new: 1, medals_new: 1 });

    await familyMedalsSeen(ctx, ACCOUNT_A, { ids: [pro.id, theirs.id] });
    expect(db.tables.portal_access_log.map((r) => r.target_id)).toEqual([pro.id]);
    expect((await familyPractice(ctx, ACCOUNT_A, P)).celebration).toEqual([]);
    expect((await familyPractice(ctx, ACCOUNT_B, P)).celebration).toHaveLength(1);
    expect((await practiceHome(ctx, ACCOUNT_A, CHILDREN, [P])).celebration).toBeNull();
    expect((await failure(familyMedalsSeen(ctx, ACCOUNT_A, { ids: ["no-es-un-id"] }))).status).toBe(400);
  });

  test("medallas que se repiten: el id del grupo marca todas las de ese código; el grupo es nuevo si falta ver alguna", async () => {
    const db = seed();
    const older = addMedal(db, { code: "semana_cumplida", title: "Semana cumplida", period_key: "2026-10-05", awarded_at: "2026-10-08T15:00:00.000Z" });
    const newer = addMedal(db, { code: "semana_cumplida", title: "Semana cumplida", period_key: "2026-10-12", awarded_at: "2026-10-14T12:00:00.000Z" });
    const first = addMedal(db, { awarded_at: "2026-10-01T15:00:00.000Z" });
    const ctx = fakeCtx(db);
    // La más nueva ya se vio (en la celebración del Inicio); la de la semana anterior, no
    db.tables.portal_access_log.push({ ...defaults(db, "portal_access_log"), patient_id: P, account_id: A, action: "ver_medalla", target_id: newer.id });
    const before = await familyMedals(ctx, ACCOUNT_A, P);
    expect(before.earned.find((m) => m.code === "semana_cumplida")).toMatchObject({ id: newer.id, times: 2, is_new: true });
    expect((await familyPractice(ctx, ACCOUNT_A, P)).celebration.map((c) => c.medal_id)).toEqual([older.id, first.id]);

    // La página manda el id del grupo (la más nueva): quedan vistas las dos
    await familyMedalsSeen(ctx, ACCOUNT_A, { ids: [newer.id] });
    expect(db.tables.portal_access_log.map((r) => r.target_id).sort()).toEqual([newer.id, older.id].sort());
    const after = await familyMedals(ctx, ACCOUNT_A, P);
    expect(after.earned.find((m) => m.code === "semana_cumplida")?.is_new).toBe(false);
    // Otro código no se toca
    expect(after.earned.find((m) => m.code === "primer_paso")?.is_new).toBe(true);
    expect((await familyPractice(ctx, ACCOUNT_A, P)).celebration.map((c) => c.medal_id)).toEqual([first.id]);
    expect((await practiceHome(ctx, ACCOUNT_A, CHILDREN, [P])).home.get(P)?.medals_new).toBe(1);
    // La otra cuenta no vio nada
    expect((await familyMedals(ctx, ACCOUNT_B, P)).earned.every((m) => m.is_new)).toBe(true);
  });

  test("Inicio: sin plan publicado la fila es null; sin el script 26 tampoco se cae", async () => {
    const none = await practiceHome(fakeCtx(seed({ plan: false })), ACCOUNT_A, CHILDREN, [P]);
    expect(none.home.get(P)).toBeNull();
    const db = seed();
    for (const t of ["patient_exercise_plans", "exercise_practice_logs", "patient_practice_feedback", "patient_medals"]) db.missing.add(t);
    const missing = await practiceHome(fakeCtx(db), ACCOUNT_A, CHILDREN, [P]);
    expect(missing.home.get(P)).toBeNull();
    expect(missing.celebration).toBeNull();
  });

  test("medallas: la pausa de vacaciones vigente viene con su fecha de vuelta", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    expect((await familyMedals(ctx, ACCOUNT_A, P)).on_break_until).toBeNull();
    db.tables.patient_exercise_plans[0].on_break_until = "2026-10-20";
    const paused = await familyMedals(ctx, ACCOUNT_A, P);
    expect(paused.on_break_until).toBe("2026-10-20");
    expect(paused.next).toEqual([]);
    // El día de la vuelta ya no hay pausa
    db.tables.patient_exercise_plans[0].on_break_until = TODAY;
    expect((await familyMedals(ctx, ACCOUNT_A, P)).on_break_until).toBeNull();
    // Sin plan publicado, tampoco
    expect((await familyMedals(fakeCtx(seed({ plan: false })), ACCOUNT_A, P)).on_break_until).toBeNull();
  });
});

describe("familia: «Mis logros» sin plan (Inicio y barra de abajo)", () => {
  const addFeedback = (db: FakeDb, o: Row = {}): Row => {
    const row: Row = {
      ...defaults(db, "patient_practice_feedback"), patient_id: P, plan_id: null, professional_id: PRO, author_label: AUTHOR,
      body: "¡Qué buena constancia!", for_adult: null, period_start: null, period_end: null, adolescent_ack: false,
      review_note: null, sent_by_email: PROF.email, ...o,
    };
    db.tables.patient_practice_feedback.push(row);
    return row;
  };
  const addGoal = (db: FakeDb, status: string): Row => {
    const row: Row = {
      ...defaults(db, "patient_goals"), patient_id: P, kind: "terapeutica", title: "Contar un chiste en la mesa", status,
      created_by_email: PROF.email, published_at: status === "borrador" ? null : NOW.toISOString(),
      achieved_at: status === "lograda" ? NOW.toISOString() : null,
    };
    db.tables.patient_goals.push(row);
    return row;
  };
  const homeOf = async (db: FakeDb) => (await practiceHome(fakeCtx(db), ACCOUNT_A, CHILDREN, [P])).home.get(P);

  test("una medalla sin plan publicado: «Mis logros» sin «Ejercicios» (has_plan false, sin semana)", async () => {
    const db = seed({ plan: false });
    const medal = addMedal(db, { kind: "profesional", code: "profesional", title: "Me animé", awarded_by_email: PROF.email });
    const ctx = fakeCtx(db);
    const { home, celebration } = await practiceHome(ctx, ACCOUNT_A, CHILDREN, [P]);
    expect(home.get(P)).toEqual({
      mode: "tortuga", audience: "infancia", has_plan: false, week: null, on_break_until: null, feedback_new: 0, medals_new: 1,
    });
    expect(celebration).toMatchObject({ medal_id: medal.id, title: null });
    // La página se ve sin plan: la medalla, sin "Para seguir sumando" ni pausa
    const dto = await familyMedals(ctx, ACCOUNT_A, P);
    expect(dto.earned.map((m) => m.id)).toEqual([medal.id]);
    expect(dto).toMatchObject({ author_label: null, auto_medals: false, next: [], goals: [], on_break_until: null });
    // Vista la medalla, la tarjeta sigue (la medalla no se pierde) y sin "Nuevo"
    await familyMedalsSeen(ctx, ACCOUNT_A, { ids: [medal.id] });
    expect(await homeOf(db)).toMatchObject({ has_plan: false, medals_new: 0 });
  });

  test("con plan publicado: has_plan true y la semana; la pausa solo con plan", async () => {
    const db = seed();
    db.tables.patient_exercise_plans[0].on_break_until = "2026-10-20";
    expect(await homeOf(db)).toEqual({
      mode: "tortuga", audience: "infancia", has_plan: true, week: { count: 0, target: 3 }, on_break_until: "2026-10-20",
      feedback_new: 0, medals_new: 0,
    });
  });

  test("devolución retirada, medalla anulada o metas en borrador o cambiadas solas: null", async () => {
    const at = "2026-10-13T12:00:00.000Z";
    const withdrawn = seed({ plan: false });
    addFeedback(withdrawn, { withdrawn_at: at, withdrawn_by_email: PROF.email, withdraw_reason: "error" });
    expect(await homeOf(withdrawn)).toBeNull();

    const voided = seed({ plan: false });
    addMedal(voided, { voided_at: at, voided_by_email: PROF.email, void_reason: "Error" });
    expect(await homeOf(voided)).toBeNull();

    const hidden = seed({ plan: false });
    addGoal(hidden, "borrador");
    addGoal(hidden, "cambiada");
    expect(await homeOf(hidden)).toBeNull();

    // Todo junto tampoco: no hay nada vigente que ver
    const all = seed({ plan: false });
    addFeedback(all, { withdrawn_at: at, withdrawn_by_email: PROF.email, withdraw_reason: "error" });
    addMedal(all, { voided_at: at, voided_by_email: PROF.email, void_reason: "Error" });
    addGoal(all, "cambiada");
    const r = await practiceHome(fakeCtx(all), ACCOUNT_A, CHILDREN, [P]);
    expect(r.home.get(P)).toBeNull();
    expect(r.celebration).toBeNull();
  });

  test("una devolución vigente o una meta activa o lograda alcanzan (sin plan)", async () => {
    const fb = seed({ plan: false });
    addFeedback(fb);
    expect(await homeOf(fb)).toMatchObject({ has_plan: false, week: null, feedback_new: 1, medals_new: 0 });
    // Su página: sin plan, "cuando marques un ejercicio" no aplica (feedbackNoReply)
    expect(await familyFeedback(fakeCtx(fb), ACCOUNT_A, P)).toMatchObject({ has_plan: false, items: [{ is_new: true }] });
    for (const status of ["activa", "lograda"]) {
      const db = seed({ plan: false });
      addGoal(db, status);
      expect(await homeOf(db)).toMatchObject({ has_plan: false, week: null, feedback_new: 0, medals_new: 0 });
    }
    // Lo de otra persona no cuenta
    const other = seed({ plan: false });
    addFeedback(other, { patient_id: Q });
    addMedal(other, { patient_id: Q });
    expect(await homeOf(other)).toBeNull();
  });

  test("regla de acceso: sin «ok» para esta cuenta no llega nada (ni el motivo)", async () => {
    type Case = { name: string; db: FakeDb; account?: Account };
    const blocked = (name: string, change: (db: FakeDb) => void, o: { birth?: string; enabled?: boolean } = {}): Case => {
      const db = seed({ plan: false, ...o });
      addMedal(db, { kind: "profesional", code: "profesional", title: "Me animé", awarded_by_email: PROF.email });
      addFeedback(db);
      change(db);
      return { name, db };
    };
    const cases: Case[] = [
      blocked("sin activar la información de salud", (db) => { db.tables.portal_consents = [consent(B)]; }),
      blocked("sin verificar el vínculo", (db) => { db.tables.portal_links[0].verified_in_person_on = null; }),
      blocked("sin prender la práctica", () => undefined, { enabled: false }),
      blocked("portal en pausa", (db) => { db.tables.patient_portal_settings[0].paused_at = "2026-10-13T12:00:00.000Z"; }),
      blocked("adulto autorizado", (db) => { db.tables.portal_links[0].relationship_kind = "autorizado"; }),
      blocked("adolescente sin su conformidad", (db) => { db.tables.patient_portal_settings[0].adolescent_agreed_on = null; }, { birth: "2012-03-01" }),
    ];
    for (const c of cases) {
      const ctx = fakeCtx(c.db);
      const perChild = await childrenClinical(ctx, ACCOUNT_A);
      const children = await activeChildren(ctx, ACCOUNT_A);
      const outcome = perChild.get(P)?.practice;
      expect({ case: c.name, ok: outcome === "ok" }).toEqual({ case: c.name, ok: false });
      // Solo uno de los resultados públicos (nunca el bloqueo de verdad)
      expect(["consent", "verify", "not_available", undefined]).toContain(outcome);
      const r = await practiceHomeFor(ctx, ACCOUNT_A, children, perChild);
      expect({ case: c.name, size: r.home.size, celebration: r.celebration }).toEqual({ case: c.name, size: 0, celebration: null });
      // Y las páginas de logros tampoco se abren
      const e = await failure(familyMedals(ctx, ACCOUNT_A, P));
      expect([403, 404]).toContain(e.status);
      expect((await failure(familyFeedback(ctx, ACCOUNT_A, P))).status).toBe(e.status);
    }
    // Sin nada bloqueado, el mismo caso sí llega
    const open = blocked("todo en regla", () => undefined);
    const ctx = fakeCtx(open.db);
    const r = await practiceHomeFor(ctx, ACCOUNT_A, await activeChildren(ctx, ACCOUNT_A), await childrenClinical(ctx, ACCOUNT_A));
    expect(r.home.get(P)).toMatchObject({ has_plan: false, feedback_new: 1, medals_new: 1 });
    expect(r.celebration).toMatchObject({ patient_id: P });
  });

  test("barra de abajo: «Ejercicios» cuenta solo a quien tiene plan; «Mis logros», a todos los que tienen algo", async () => {
    const db = seed();
    // Lucía (para la prueba, de esta cuenta) sin plan y con una medalla
    db.tables.patient_exercise_plans = db.tables.patient_exercise_plans.filter((p) => p.patient_id !== Q);
    addMedal(db, { patient_id: Q });
    const { home } = await practiceHome(fakeCtx(db), ACCOUNT_A, CHILDREN, [P, Q]);
    expect(home.get(P)?.has_plan).toBe(true);
    expect(home.get(Q)).toMatchObject({ has_plan: false, week: null });
    const child = (id: string, practice: "ok" | "consent" = "ok") => ({
      id, first_name: id === P ? "Martín" : "Lucía", last_initial: "P.", self: false, can_request_hc: true, next: null,
      clinical: { info: "not_available" as const, practice, practice_home: home.get(id) ?? null },
    });
    const me = { children: [child(P), child(Q)] };
    expect(practicePeople(me).map((p) => p.child.id)).toEqual([P]);
    expect(practiceHomes(me).map((p) => p.child.id)).toEqual([P, Q]);
    // Sin «ok» no cuenta aunque llegara algo
    expect(practiceHomes({ children: [child(P, "consent")] })).toEqual([]);

    // El aviso a la barra: true solo si alguien tiene plan
    const hadWindow = "window" in globalThis;
    const target = new EventTarget();
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = g.window;
    g.window = target;
    const heard: boolean[] = [];
    target.addEventListener(PRACTICE_NAV_EVENT, (e) => heard.push((e as CustomEvent<boolean>).detail));
    try {
      announcePracticeNav({ children: [child(Q)] });
      announcePracticeNav(me);
    } finally {
      if (hadWindow) g.window = prev;
      else delete g.window;
    }
    expect(heard).toEqual([false, true]);
  });
});

// ── Equipo ──────────────────────────────────────────────────────────────────

function exInput(o: Partial<ExerciseInput> = {}): ExerciseInput {
  return {
    id: null, exercise_key: null, source: "catalogo", catalog_id: "ef-tiempo-especial", catalog_version: null, ai_draft_id: null,
    approach: "entorno_familia", practiced_in_session: false, title: "Tiempo de juego", ...TEXTS, minutes: 5,
    with_adult: true, reviewed: false, removed: false, review_note: null, activity: null, ...o,
  };
}

function planInput(o: Partial<PlanDraftInput> = {}): PlanDraftInput {
  return {
    id: null, title: "Jugar y conversar (versión 2)", goal_text: "Disfrutar de conversar en casa.", audience: "infancia",
    days_per_week: 3, review_on: null, auto_medals: true, review_note: null, exercises: [exInput({ exercise_key: K1 })], ...o,
  };
}

const save = (ctx: Ctx, staff: typeof PROF, plan: PlanDraftInput, expected: string | null = null) =>
  staffPracticeAction(ctx, staff, { action: "plan_save_draft", patient_id: P, expected_updated_at: expected, plan });

const publish = (ctx: Ctx, staff: typeof PROF, dto: StaffPracticeDTO, o: Row = {}) =>
  staffPracticeAction(ctx, staff, {
    action: "plan_publish", patient_id: P, plan_id: dto.draft!.id, expected_updated_at: dto.draft!.updated_at,
    expected_published_id: dto.published?.id ?? null, ...o,
  });

describe("equipo: lo que ve cada rol", () => {
  test("Administración: estados sin textos clínicos ni comentarios, y no puede escribir", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const log = addLog(db, {});
    db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: log.id, patient_id: P, account_id: A, result: "costo", comment: "Le costó mucho", risk_flag: false, created_at: NOW.toISOString() });
    const VOID_REASON = "Era para Juan, que habló de su tartamudez en clase";
    addMedal(db, { voided_at: "2026-10-12T10:00:00.000Z", voided_by_email: PROF.email, void_reason: VOID_REASON });
    await save(ctx, PROF, planInput());
    expect((await staffPractice(ctx, PROF, P)).medals[0].void_reason).toBe(VOID_REASON);
    const dto = await staffPractice(ctx, ADMIN, P);
    // La anulación se ve como estado, sin el motivo (texto libre)
    expect(dto.medals[0]).toMatchObject({ voided_at: "2026-10-12T10:00:00.000Z", voided_by_email: PROF.email, void_reason: null });
    expect(JSON.stringify(dto)).not.toContain(VOID_REASON);
    expect(dto.can_edit).toBe(false);
    expect(dto.author).toEqual({ label: null, problem: STAFF_PRACTICE_TEXT.admin_readonly });
    expect(dto.published?.title).toBeNull();
    expect(dto.published?.goal_text).toBeNull();
    expect(dto.published?.exercises).toEqual([]);
    expect(dto.published?.exercise_count).toBe(2);
    expect(dto.draft).toBeNull();
    expect(dto.approaches).toEqual([]);
    expect(dto.notes).toEqual([]);
    expect(dto.grid.rows[0].title).toBeNull();
    expect(dto.grid.rows[0].cells[GRID_LAST]).toMatchObject({ logged_by: "Ana Pérez (madre)", results: [] });
    expect(dto.pending).toMatchObject({ logs: 1, comments: 0, costo: 0, risk: 0 });
    expect(JSON.stringify(dto)).not.toContain("Le costó mucho");
    const e = await failure(staffPracticeAction(ctx, ADMIN, { action: "mark_seen", patient_id: P }));
    expect(e.status).toBe(403);
    expect(e.message).toBe(PRACTICE_ERROR.clinical_only);
  });

  test("profesional: grilla de 14 días, comentarios con el riesgo primero, quién lo lee y resumen", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const today = addLog(db, {});
    const yesterday = addLog(db, { exercise_id: EX2, exercise_key: K2, practiced_on: "2026-10-13", account_id: B, created_at: "2026-10-13T20:00:00.000Z" });
    db.tables.exercise_practice_notes.push(
      { id: randomUUID(), log_id: yesterday.id, patient_id: P, account_id: B, result: "bien", comment: "Le gustó", risk_flag: false, created_at: "2026-10-13T20:01:00.000Z" },
      { id: randomUUID(), log_id: today.id, patient_id: P, account_id: A, result: "costo", comment: "Dice que le pegan en el recreo", risk_flag: true, created_at: "2026-10-14T12:00:00.000Z" },
    );
    const dto = await staffPractice(ctx, PROF, P);
    expect(dto.can_edit).toBe(true);
    expect(dto.author).toEqual({ label: AUTHOR, problem: null });
    expect(dto.readers).toEqual(["Ana Pérez (madre)", "Juan Pérez (padre)"]);
    expect(dto.readers_line).toContain("Lo leen: Ana Pérez (madre), Juan Pérez (padre)");
    expect(dto.patient).toMatchObject({ first_name: "Martín", age: 6, self: false, audience: "infancia", adolescent: false });
    expect(dto.approaches.map((a) => a.approach)).toContain("entorno_familia");
    expect(dto.grid.dates).toHaveLength(14);
    expect(dto.grid.dates[13]).toBe(TODAY);
    expect(dto.grid.rows.map((r) => [r.title, r.current])).toEqual([["Tiempo de juego", true], ["Turnos en la mesa", true]]);
    expect(dto.grid.rows[0].cells[13]?.results).toEqual([{ who: "Ana Pérez (madre)", result: "costo", comment: true, risk: true }]);
    expect(dto.grid.rows[1].cells[12]?.logged_by).toBe("Juan Pérez (padre)");
    expect(dto.notes.map((n) => [n.comment, n.risk, n.is_new])).toEqual([["Dice que le pegan en el recreo", true, true], ["Le gustó", false, true]]);
    expect(dto.pending).toMatchObject({ logs: 2, comments: 2, costo: 1, risk: 1, since: "2026-10-13", stale: false });
    expect(dto.summary).toMatchObject({ since: "2026-10-10", logs: 2, days: 2, last: TODAY });
    expect(dto.summary.text).toBe("Desde el 10/10 anotaron 2 prácticas en 2 días. Última: hoy.");
    expect(dto.published?.exercises.find((e) => e.id === EX1)?.first_published_on).toBe("2026-10-10");
    expect(dto.catalog).toBeNull();
    const cat = await staffPracticeAction(ctx, PROF, { action: "catalog", patient_id: P });
    expect(cat.catalog?.every((c) => ["entorno_familia", "habla_facil", "regulacion_y_rutinas", "escuela_y_lectura"].includes(c.approach))).toBe(true);
    expect(cat.catalog?.length).toBeGreaterThan(0);
  });

  test("«Visto»: lo pendiente se vacía y lo nuevo vuelve a contar", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    addLog(db, {});
    const seen = await staffPracticeAction(ctx, PROF, { action: "mark_seen", patient_id: P });
    expect(seen.pending.logs).toBe(0);
    expect(seen.published?.last_reviewed_by_email).toBe(PROF.email);
    setSystemTime(new Date(NOW.getTime() + 60_000));
    addLog(db, { exercise_id: EX2, exercise_key: K2, created_at: new Date().toISOString() });
    expect((await staffPractice(ctx, PROF, P)).pending.logs).toBe(1);
    const family = await familyPractice(ctx, ACCOUNT_A, P);
    expect(family.reviewed).toEqual({ by: AUTHOR, on: TODAY });
    expect(db.tables.patient_exercise_plans[0]).toMatchObject({ last_reviewed_by_email: PROF.email, last_reviewed_label: AUTHOR });
  });

  test("«Visto» firma con el nombre de quien lo marca, nunca con el del autor del plan", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    addLog(db, {});
    // Sin profesional vinculado o sin matrícula: no hay nombre con que firmar
    for (const who of [UNLINKED, PROF2]) {
      const e = await failure(staffPracticeAction(ctx, who, { action: "mark_seen", patient_id: P }));
      expect(e.status).toBe(403);
      expect(extra(e).code).toBe("AUTHOR");
    }
    expect(db.tables.patient_exercise_plans[0].last_reviewed_at).toBeNull();
    // La Dirección sin profesional firma como Dirección (el plan es de la Lic. Torres)
    await staffPracticeAction(ctx, DIR, { action: "mark_seen", patient_id: P });
    expect((await familyPractice(ctx, ACCOUNT_A, P)).reviewed).toEqual({ by: "Dirección del CIMT", on: TODAY });
    // Un "Visto" sin nombre guardado: genérico, nunca el del plan
    Object.assign(db.tables.patient_exercise_plans[0], { last_reviewed_label: null, last_reviewed_by_email: "sin-nombre@cimt.test" });
    const family = await familyPractice(ctx, ACCOUNT_A, P);
    expect(family.reviewed).toEqual({ by: "Tu profesional", on: TODAY });
    expect(JSON.stringify(family.reviewed)).not.toContain("Torres");
  });

  test("lo que quedó sin ver de un plan finalizado o retirado se puede marcar como visto", async () => {
    for (const close of ["plan_finish", "plan_withdraw"] as const) {
      const db = seed();
      const ctx = fakeCtx(db);
      const log = addLog(db, {});
      db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: log.id, patient_id: P, account_id: A, result: null, comment: "Dice que le pegan", risk_flag: true, created_at: NOW.toISOString() });
      setSystemTime(new Date(NOW.getTime() + 60_000));
      const closed = await staffPracticeAction(ctx, PROF, { action: close, patient_id: P, plan_id: PLAN, reason: "otro" });
      expect(closed.published).toBeNull();
      expect(closed.pending).toMatchObject({ logs: 1, risk: 1 });
      expect((await staffPracticeInbox(ctx, PROF)).items.map((i) => i.kind)).toEqual(["practicas"]);
      expect(await staffPracticeCounts(ctx, PROF)).toEqual({ practice_pending: 1, practice_risk: 0, practice_urgent: 1 });

      const seen = await staffPracticeAction(ctx, PROF, { action: "mark_seen", patient_id: P });
      expect(seen.pending).toMatchObject({ logs: 0, comments: 0, risk: 0, since: null });
      expect(seen.history[0]).toMatchObject({ id: PLAN, status: close === "plan_finish" ? "finalizado" : "retirado" });
      expect(db.tables.patient_exercise_plans[0]).toMatchObject({ last_reviewed_by_email: PROF.email, last_reviewed_label: AUTHOR });
      expect((await staffPracticeInbox(ctx, PROF)).items).toEqual([]);
      expect(await staffPracticeCounts(ctx, PROF)).toEqual({ practice_pending: 0, practice_risk: 0, practice_urgent: 0 });
      setSystemTime(NOW);
    }
  });

  test("una devolución después de finalizar también deja todo visto", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    addLog(db, {});
    setSystemTime(new Date(NOW.getTime() + 60_000));
    await staffPracticeAction(ctx, PROF, { action: "plan_finish", patient_id: P, plan_id: PLAN });
    const sent = await staffPracticeAction(ctx, PROF, {
      action: "feedback_send", patient_id: P,
      feedback: { plan_id: null, body: "Gracias por todo lo que practicaron.", for_adult: null, goal_ids: [], medal: null, adolescent_ack: false, review_note: null },
    });
    expect(sent.pending.logs).toBe(0);
    expect((await staffPracticeInbox(ctx, PROF)).items).toEqual([]);
    // Sin ningún plan publicado nunca, no hay nada que marcar
    const none = await failure(staffPracticeAction(fakeCtx(seed({ plan: false })), PROF, { action: "mark_seen", patient_id: P }));
    expect(none.status).toBe(409);
    expect(extra(none).code).toBe("CONFLICT");
    setSystemTime(NOW);
  });
});

describe("equipo: borrador y publicación", () => {
  test("borrador nuevo: versión siguiente, sin pisar a otra persona", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const dto = await save(ctx, PROF, planInput({ exercises: [exInput({ exercise_key: K1 }), exInput({ title: "Uno nuevo" })] }));
    expect(dto.draft).toMatchObject({ version: 2, status: "borrador", supersedes_id: PLAN, exercise_count: 2 });
    expect(dto.draft?.exercises.map((e) => [e.title, e.first_published_on])).toEqual([["Tiempo de juego", "2026-10-10"], ["Uno nuevo", null]]);
    expect(dto.draft?.exercises[0].exercise_key).toBe(K1);
    expect(dto.draft?.publish_problem).toBeNull();
    // Otra persona arranca otro borrador: conflicto
    expect(extra(await failure(save(ctx, DIR, planInput()))).code).toBe("CONFLICT");
    // Con una versión vieja en pantalla: conflicto
    const stale = await failure(save(ctx, PROF, planInput({ id: dto.draft!.id }), "2026-10-01T00:00:00.000Z"));
    expect(stale.status).toBe(409);
    expect(stale.message).toBe(PRACTICE_ERROR.conflict);
    // Con la versión actual: se guarda; lo que no vino queda quitado
    const ok = await save(ctx, PROF, planInput({ id: dto.draft!.id, exercises: [exInput({ id: dto.draft!.exercises[1].id, title: "Uno nuevo, editado" })] }), dto.draft!.updated_at);
    expect(ok.draft?.exercises.map((e) => [e.title, !!e.removed_at])).toEqual([["Uno nuevo, editado", false], ["Tiempo de juego", true]]);
    expect(ok.draft!.updated_at).not.toBe(dto.draft!.updated_at);
    // Y con el updated_at de antes, ya no
    expect((await failure(save(ctx, PROF, planInput({ id: dto.draft!.id }), dto.draft!.updated_at))).status).toBe(409);
  });

  test("validaciones al guardar: forma, enfoque que no corresponde y catálogo", async () => {
    const ctx = fakeCtx(seed());
    const bad = await failure(save(ctx, PROF, planInput({ exercises: [exInput({ pasos: ["uno"] })] })));
    expect(bad.status).toBe(400);
    expect(extra(bad)).toMatchObject({ code: "INVALID", field: "pasos", index: 0 });
    const approach = await failure(save(ctx, PROF, planInput({ exercises: [exInput({ approach: "ritmo_y_claridad" })] })));
    expect(extra(approach)).toMatchObject({ code: "APPROACH", index: 0 });
    const cat = await failure(save(ctx, PROF, planInput({ exercises: [exInput({ catalog_id: "no-existe" })] })));
    expect(extra(cat)).toMatchObject({ code: "INVALID", field: "catalog_id" });
    const key = await failure(save(ctx, PROF, planInput({ exercises: [exInput({ exercise_key: randomUUID() })] })));
    expect(extra(key)).toMatchObject({ field: "exercise_key" });
  });

  test("el texto del profesional nunca bloquea al guardar; para publicar hace falta «Lo dejo así»", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const text = exInput({ exercise_key: K1, para_que: "Para que hable bien en casa." });
    const dto = await save(ctx, PROF, planInput({ exercises: [text] }));
    expect(dto.draft?.exercises[0].alerts).toEqual(["hablar bien"]);
    expect(dto.draft?.publish_problem).toBe(PRACTICE_ERROR.review);
    const e = await failure(publish(ctx, PROF, dto));
    expect(e.status).toBe(400);
    expect(extra(e)).toMatchObject({ code: "REVIEW", index: 0, terms: ["hablar bien"] });
    const noted = await save(ctx, PROF, planInput({ id: dto.draft!.id, exercises: [{ ...text, id: dto.draft!.exercises[0].id, review_note: "Lo pidió la familia con estas palabras" }] }), dto.draft!.updated_at);
    expect(noted.draft?.exercises[0].lint_overrides).toMatchObject([{ terms: ["hablar bien"], reason: "Lo pidió la familia con estas palabras", by_email: PROF.email }]);
    expect(noted.draft?.publish_problem).toBeNull();
  });

  test("publicar: reemplaza la versión anterior y «Hecho hoy» se mantiene", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1 });
    const dto = await save(ctx, PROF, planInput());
    // Con un publicado distinto en pantalla: conflicto
    expect((await failure(publish(ctx, PROF, dto, { expected_published_id: null }))).status).toBe(409);
    const out = await publish(ctx, PROF, dto);
    expect(out.published).toMatchObject({ id: dto.draft!.id, version: 2, status: "publicado", author_label: AUTHOR, supersedes_id: PLAN });
    expect(out.draft).toBeNull();
    expect(out.history).toMatchObject([{ id: PLAN, version: 1, status: "reemplazado" }]);
    const family = await familyPractice(ctx, ACCOUNT_A, P);
    expect(family.plan?.id).toBe(dto.draft!.id);
    expect(family.exercises).toHaveLength(1);
    expect(family.exercises[0]).toMatchObject({ done_today: true, can_undo: true });
    // El mismo borrador no se publica dos veces
    expect((await failure(publish(ctx, PROF, dto))).status).toBe(409);
  });

  test("autoría: sin matrícula o sin vincular no se publica; la Dirección sin profesional firma como Dirección", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const dto = await save(ctx, PROF, planInput());
    const noLicense = await failure(publish(ctx, PROF2, dto));
    expect(noLicense.status).toBe(403);
    expect(extra(noLicense).code).toBe("AUTHOR");
    expect(noLicense.message).toBe(PRACTICE_ERROR.no_license);
    expect((await failure(publish(ctx, UNLINKED, dto))).message).toBe(PRACTICE_ERROR.not_linked);
    const out = await publish(ctx, DIR, dto);
    expect(out.published?.author_label).toBe("Dirección del CIMT");
  });

  test("IA: sin «Lo revisé» no se publica; al publicar se guarda cuánto se editó", async () => {
    const db = seed();
    db.tables.ai_drafts.push({
      id: AI, kind: "adaptacion", patient_id: P, status: "generado", output: {
        intro: "x", nota_para_profesional: "x", alertas: [], ejercicios: [{
          catalogo_id: "ef-tiempo-especial", titulo: "Tiempo de juego", para_que: TEXTS.para_que, pasos: TEXTS.pasos, minutos: 5,
          materiales: ["Bloques o muñecos"], rol_del_adulto: TEXTS.for_adult, si_cuesta: TEXTS.si_cuesta,
          variantes: { mas_facil: "a", mas_dificil: "b" },
        }],
      },
    });
    const ctx = fakeCtx(db);
    const ai = exInput({ source: "ia", ai_draft_id: AI });
    const dto = await save(ctx, PROF, planInput({ exercises: [ai] }));
    expect(dto.draft?.exercises[0]).toMatchObject({ ai_drafted: true, ai_draft_id: AI, reviewed_at: null });
    expect(db.tables.ai_drafts[0].status).toBe("usado");
    const e = await failure(publish(ctx, PROF, dto));
    expect(extra(e).code).toBe("AI_NOT_REVIEWED");
    expect(e.message).toBe(PRACTICE_ERROR.ai_not_reviewed);
    const reviewed = await save(ctx, PROF, planInput({ id: dto.draft!.id, exercises: [{ ...ai, id: dto.draft!.exercises[0].id, reviewed: true }] }), dto.draft!.updated_at);
    expect(reviewed.draft?.exercises[0].reviewed_by_email).toBe(PROF.email);
    const out = await publish(ctx, PROF, reviewed);
    expect(out.published?.exercises[0].edit_ratio).toBe(0);
  });

  test("pausa, finalizar y retirar", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const bad = await failure(staffPracticeAction(ctx, PROF, { action: "plan_break", patient_id: P, plan_id: PLAN, until: TODAY }));
    expect(bad.status).toBe(400);
    const brk = await staffPracticeAction(ctx, PROF, { action: "plan_break", patient_id: P, plan_id: PLAN, until: "2026-11-02" });
    expect(brk.published?.on_break_until).toBe("2026-11-02");
    expect((await familyPractice(ctx, ACCOUNT_A, P)).on_break_until).toBe("2026-11-02");
    // Retirar: solo quien lo publicó o la Dirección
    expect((await failure(staffPracticeAction(ctx, PROF2, { action: "plan_withdraw", patient_id: P, plan_id: PLAN, reason: "error" }))).status).toBe(403);
    const fin = await staffPracticeAction(ctx, PROF, { action: "plan_finish", patient_id: P, plan_id: PLAN });
    expect(fin.published).toBeNull();
    expect(fin.history[0]).toMatchObject({ id: PLAN, status: "finalizado" });
    expect((await familyPractice(ctx, ACCOUNT_A, P)).plan).toBeNull();
    expect((await failure(staffPracticeAction(ctx, PROF, { action: "plan_finish", patient_id: P, plan_id: PLAN }))).status).toBe(409);
    // Un borrador se descarta
    const draft = await save(ctx, PROF, planInput());
    const gone = await staffPracticeAction(ctx, PROF, { action: "plan_withdraw", patient_id: P, plan_id: draft.draft!.id, reason: "otro" });
    expect(gone.draft).toBeNull();
    expect(gone.history.find((h) => h.id === draft.draft!.id)).toMatchObject({ status: "retirado", close_reason: "descartado" });
  });
});

describe("equipo: metas, devoluciones y medallas", () => {
  // Una meta de práctica publicada el lunes (las prácticas cuentan desde que se publica)
  async function activeGoal(db: FakeDb, ctx: Ctx, title = "Practicar dos días por semana") {
    const saved = await staffPracticeAction(ctx, PROF, {
      action: "goal_save", patient_id: P,
      goal: { id: null, plan_id: null, kind: "practica", title, rule: { dias: 2, semanas: 1 }, medal_title: "Meta cumplida", agreed_with_patient: true },
    });
    const goal = saved.goals[0];
    expect(goal.status).toBe("borrador");
    expect(saved.goals_met).toEqual([]);
    setSystemTime(new Date("2026-10-12T12:00:00.000Z"));
    const pub = await staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: goal.id });
    setSystemTime(NOW);
    expect(pub.goals[0]).toMatchObject({ status: "activa", published_at: "2026-10-12T12:00:00.000Z" });
    expect(db.tables.patient_goals[0].published_by_email).toBe(PROF.email);
    return goal.id;
  }

  // Una meta terapéutica de ese plan, publicada o en borrador
  async function planGoal(ctx: Ctx, planId: string, title: string, publishIt = true) {
    const dto = await staffPracticeAction(ctx, PROF, {
      action: "goal_save", patient_id: P,
      goal: { id: null, plan_id: planId, kind: "terapeutica", title, rule: null, medal_title: null, agreed_with_patient: false },
    });
    const id = dto.goals.find((g) => g.title === title)!.id;
    if (publishIt) await staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: id });
    return id;
  }

  const sendFeedback = (ctx: Ctx, goalIds: string[]) => staffPracticeAction(ctx, PROF, {
    action: "feedback_send", patient_id: P,
    feedback: { plan_id: null, body: "¡Lo lograron! Gracias por contarnos.", for_adult: null, goal_ids: goalIds, medal: null, adolescent_ack: false, review_note: null },
  });

  test("una meta que habla de fluidez no se guarda", async () => {
    const e = await failure(staffPracticeAction(fakeCtx(seed()), PROF, {
      action: "goal_save", patient_id: P,
      goal: { id: null, plan_id: null, kind: "terapeutica", title: "Hablar fluido en clase", rule: null, medal_title: null, agreed_with_patient: false },
    }));
    expect(e.status).toBe(400);
    expect(e.message).toBe(FLUENCY_TITLE_MESSAGE);
    expect(extra(e)).toMatchObject({ code: "TITLE_BLOCK", field: "title" });
    expect(extra(e).terms).toContain("fluidez");
  });

  test("meta de práctica cumplida: aviso en la bandeja, «Todavía no» y devolución con la medalla", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const goalId = await activeGoal(db, ctx);
    expect((await familyPractice(ctx, ACCOUNT_A, P)).goals).toMatchObject([{ id: goalId, status: "activa", medal_title: "Meta cumplida" }]);
    await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1, practiced_on: "2026-10-13" });
    await familyLog(ctx, ACCOUNT_A, { exercise_id: EX1 });
    const dto = await staffPractice(ctx, PROF, P);
    expect(dto.goals_met).toEqual([{ goal_id: goalId, title: "Practicar dos días por semana", met_on: TODAY }]);
    const inbox = await staffPracticeInbox(ctx, PROF);
    expect(inbox.items.map((i) => i.kind)).toEqual(["practicas", "meta_cumplida"]);
    expect(inbox.items[1]).toMatchObject({ mine: true, goal: { id: goalId, met_on: TODAY } });

    const sent = await staffPracticeAction(ctx, PROF, {
      action: "feedback_send", patient_id: P,
      feedback: { plan_id: null, body: "¡Qué buena constancia! Practicaron dos días.", for_adult: null, goal_ids: [goalId], medal: { title: "Meta cumplida", message: "Lo lograron", goal_id: goalId }, adolescent_ack: false, review_note: null },
    });
    expect(sent.goals[0]).toMatchObject({ id: goalId, status: "lograda", progress: null });
    expect(sent.goals_met).toEqual([]);
    expect(sent.feedback[0]).toMatchObject({ author_label: AUTHOR, medal: { title: "Meta cumplida" }, goals: [{ id: goalId, title: "Practicar dos días por semana" }], can_withdraw: true, period_end: TODAY });
    expect(sent.medals.find((m) => m.kind === "profesional")).toMatchObject({ title: "Meta cumplida", goal_id: goalId, awarded_by_email: PROF.email });
    expect(sent.pending.logs).toBe(0);
    const family = await familyPractice(ctx, ACCOUNT_A, P);
    expect(family.last_feedback).toMatchObject({ medal_title: "Meta cumplida", goals_achieved: ["Practicar dos días por semana"], is_new: true });
    expect(family.reviewed).toEqual({ by: AUTHOR, on: TODAY });
    expect(family.goals).toMatchObject([{ id: goalId, status: "lograda" }]);
    // "Mis logros": la lograda, con cuándo y la medalla que se dio
    const logros = (await familyMedals(ctx, ACCOUNT_A, P)).goals;
    expect(logros).toMatchObject([{ id: goalId, status: "lograda", medal_title: "Meta cumplida" }]);
    expect(logros[0].achieved_at).not.toBeNull();
    // Si se anula la medalla, la meta sigue lograda pero sin medalla
    const given = sent.medals.find((m) => m.kind === "profesional")!;
    await staffPracticeAction(ctx, PROF, { action: "medal_void", patient_id: P, medal_id: given.id, reason: "Se cargó por error" });
    expect((await familyMedals(ctx, ACCOUNT_A, P)).goals).toMatchObject([{ id: goalId, status: "lograda", medal_title: null }]);
    // La misma meta no se da dos veces
    const again = await failure(staffPracticeAction(ctx, PROF, {
      action: "feedback_send", patient_id: P,
      feedback: { plan_id: null, body: "Otra devolución para probar.", for_adult: null, goal_ids: [goalId], medal: null, adolescent_ack: false, review_note: null },
    }));
    expect(again.status).toBe(409);
    expect(again.message).toBe(PRACTICE_ERROR.goal_not_active);
  });

  test("«Todavía no» saca la meta cumplida de la bandeja", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const goalId = await activeGoal(db, ctx);
    addLog(db, { practiced_on: "2026-10-13" });
    addLog(db, {});
    expect((await staffPracticeInbox(ctx, PROF)).items.some((i) => i.kind === "meta_cumplida")).toBe(true);
    const dto = await staffPracticeAction(ctx, PROF, { action: "goal_not_yet", patient_id: P, goal_id: goalId });
    expect(dto.goals[0].met_dismissed).toBe(true);
    expect(dto.goals_met).toEqual([]);
    expect((await staffPracticeInbox(ctx, PROF)).items.some((i) => i.kind === "meta_cumplida")).toBe(false);
  });

  test("13 a 17: la devolución pide «Lo conversé con …»", async () => {
    const db = seed({ birth: "2012-03-01" });
    const e = await failure(staffPracticeAction(fakeCtx(db), PROF, {
      action: "feedback_send", patient_id: P,
      feedback: { plan_id: null, body: "Buen trabajo con la práctica.", for_adult: null, goal_ids: [], medal: null, adolescent_ack: false, review_note: null },
    }));
    expect(extra(e).code).toBe("ADOLESCENT_ACK");
  });

  test("retirar una devolución: quien la mandó o la Dirección; anular una medalla pide motivo", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const sent = await staffPracticeAction(ctx, PROF, {
      action: "feedback_send", patient_id: P,
      feedback: { plan_id: null, body: "Gracias por contarnos cómo les fue.", for_adult: null, goal_ids: [], medal: { title: "Gran equipo", message: null, goal_id: null }, adolescent_ack: false, review_note: null },
    });
    const fb = sent.feedback[0];
    const medal = sent.medals[0];
    const noReason = await failure(staffPracticeAction(ctx, PROF, { action: "medal_void", patient_id: P, medal_id: medal.id, reason: " " }));
    expect(noReason.message).toBe(PRACTICE_ERROR.void_reason);
    const voided = await staffPracticeAction(ctx, PROF, { action: "medal_void", patient_id: P, medal_id: medal.id, reason: "Se cargó por error" });
    expect(voided.medals[0]).toMatchObject({ voided_by_email: PROF.email, void_reason: "Se cargó por error" });
    expect((await familyMedals(ctx, ACCOUNT_A, P)).earned).toEqual([]);
    expect((await failure(staffPracticeAction(ctx, PROF, { action: "medal_void", patient_id: P, medal_id: medal.id, reason: "Otra vez" }))).status).toBe(409);

    expect((await failure(staffPracticeAction(ctx, PROF2, { action: "feedback_withdraw", patient_id: P, feedback_id: fb.id, reason: "error" }))).status).toBe(403);
    const out = await staffPracticeAction(ctx, DIR, { action: "feedback_withdraw", patient_id: P, feedback_id: fb.id, reason: "error" });
    expect(out.feedback[0]).toMatchObject({ withdrawn_by_email: DIR.email, withdraw_reason: "error", can_withdraw: false });
    // La medalla ya estaba anulada: queda con su motivo
    expect(out.medals[0]).toMatchObject({ void_reason: "Se cargó por error" });
    expect((await familyFeedback(ctx, ACCOUNT_A, P)).items).toEqual([]);
    const again = await failure(staffPracticeAction(ctx, DIR, { action: "feedback_withdraw", patient_id: P, feedback_id: fb.id, reason: "error" }));
    expect(again.status).toBe(409);
    expect(again.message).toBe("Ya estaba retirada. Actualizá la sección.");
  });

  test("retirar una devolución deshace lo que la familia veía: metas otra vez activas y su medalla anulada", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const goalId = await activeGoal(db, ctx);
    setSystemTime(new Date(NOW.getTime() + 1000));
    const other = await activeGoal(db, ctx, "Contar cómo les fue");
    const sent = await staffPracticeAction(ctx, PROF, {
      action: "feedback_send", patient_id: P,
      feedback: { plan_id: null, body: "¡Qué buena constancia! Practicaron dos días.", for_adult: null, goal_ids: [goalId], medal: { title: "Meta cumplida", message: null, goal_id: goalId }, adolescent_ack: false, review_note: null },
    });
    expect((await familyPractice(ctx, ACCOUNT_A, P)).goals.find((g) => g.id === goalId)?.status).toBe("lograda");
    const out = await staffPracticeAction(ctx, PROF, { action: "feedback_withdraw", patient_id: P, feedback_id: sent.feedback[0].id, reason: "error" });
    expect(out.goals.find((g) => g.id === goalId)).toMatchObject({ status: "activa", achieved_at: null, feedback_id: null });
    expect(out.goals.find((g) => g.id === other)?.status).toBe("activa");
    expect(out.medals.find((m) => m.kind === "profesional")).toMatchObject({ voided_by_email: PROF.email, void_reason: FEEDBACK_WITHDRAWN_VOID_REASON });
    expect(out.feedback[0].medal).not.toBeNull();
    const family = await familyPractice(ctx, ACCOUNT_A, P);
    expect(family.goals.find((g) => g.id === goalId)).toMatchObject({ status: "activa", achieved_at: null });
    expect(family.last_feedback).toBeNull();
    expect((await familyMedals(ctx, ACCOUNT_A, P)).earned.some((m) => m.kind === "profesional")).toBe(false);
    // La meta se puede volver a dar por lograda, con su medalla, en otra devolución
    const again = await staffPracticeAction(ctx, PROF, {
      action: "feedback_send", patient_id: P,
      feedback: { plan_id: null, body: "Ahora sí: practicaron dos días.", for_adult: null, goal_ids: [goalId], medal: { title: "Meta cumplida", message: null, goal_id: goalId }, adolescent_ack: false, review_note: null },
    });
    expect(again.goals.find((g) => g.id === goalId)?.status).toBe("lograda");
  });

  test("retirar un plan publicado saca sus metas activas; las de otros planes y las logradas siguen", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const loose = await activeGoal(db, ctx, "Practicar en familia");
    const mk = async (title: string) => {
      const dto = await staffPracticeAction(ctx, PROF, {
        action: "goal_save", patient_id: P,
        goal: { id: null, plan_id: PLAN, kind: "terapeutica", title, rule: null, medal_title: null, agreed_with_patient: false },
      });
      const id = dto.goals.find((g) => g.title === title)!.id;
      await staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: id });
      return id;
    };
    const ofPlan = await mk("Animarse a pedir en el kiosco");
    const achieved = await mk("Contar un chiste en la mesa");
    await staffPracticeAction(ctx, PROF, {
      action: "feedback_send", patient_id: P,
      feedback: { plan_id: null, body: "¡Lo lograron! Gracias por contarnos.", for_adult: null, goal_ids: [achieved], medal: null, adolescent_ack: false, review_note: null },
    });
    const before = (await familyPractice(ctx, ACCOUNT_A, P)).goals.map((g) => g.id);
    expect(before).toEqual(expect.arrayContaining([loose, ofPlan, achieved]));

    const out = await staffPracticeAction(ctx, PROF, { action: "plan_withdraw", patient_id: P, plan_id: PLAN, reason: "error" });
    expect(out.published).toBeNull();
    expect(out.goals.find((g) => g.id === ofPlan)).toMatchObject({ status: "cambiada", changed_by_email: PROF.email });
    expect(out.goals.find((g) => g.id === loose)?.status).toBe("activa");
    expect(out.goals.find((g) => g.id === achieved)?.status).toBe("lograda");
    const family = await familyPractice(ctx, ACCOUNT_A, P);
    expect(family.plan).toBeNull();
    expect(family.goals.map((g) => g.id).sort()).toEqual([loose, achieved].sort());
    // "Mis logros": la activa y, después, la lograda (sin medalla: se dio sin ninguna)
    const medalsGoals = (await familyMedals(ctx, ACCOUNT_A, P)).goals;
    expect(medalsGoals.map((g) => [g.id, g.status])).toEqual([[loose, "activa"], [achieved, "lograda"]]);
    expect(medalsGoals[1]).toMatchObject({ medal_title: null });
    expect(medalsGoals[1].achieved_at).not.toBeNull();
    // Ya retirado: otra vez da conflicto
    expect((await failure(staffPracticeAction(ctx, PROF, { action: "plan_withdraw", patient_id: P, plan_id: PLAN, reason: "error" }))).status).toBe(409);
  });

  test("retirar un plan publicado retira también las metas de las versiones que reemplazó y las en borrador", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const loose = await activeGoal(db, ctx, "Practicar en familia");
    const a = await planGoal(ctx, PLAN, "Animarse a pedir en el kiosco");
    const b = await planGoal(ctx, PLAN, "Animarse a atender el teléfono", false);
    const e = await planGoal(ctx, PLAN, "Contar un chiste en la mesa", false);
    const draft = await save(ctx, PROF, planInput());
    const c = await planGoal(ctx, draft.draft!.id, "Leer un cuento en voz alta por semana", false);
    // La versión 2 reemplaza a la 1: sus metas siguen activas y la del borrador se publica con ella
    const v2 = await publish(ctx, PROF, draft);
    const v2Id = v2.published!.id;
    expect(v2.goals.filter((g) => [a, c].includes(g.id)).map((g) => g.status)).toEqual(["activa", "activa"]);
    // Una meta en borrador de la versión 1 se puede publicar mientras su cadena siga publicada
    expect((await staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: e })).goals.find((g) => g.id === e)?.status).toBe("activa");
    const d = await planGoal(ctx, v2Id, "Saludar a la maestra", false);
    const achieved = await planGoal(ctx, v2Id, "Pedir la palabra en clase");
    await sendFeedback(ctx, [achieved]);

    const out = await staffPracticeAction(ctx, PROF, { action: "plan_withdraw", patient_id: P, plan_id: v2Id, reason: "error" });
    for (const id of [a, b, c, d, e]) {
      expect(out.goals.find((g) => g.id === id)).toMatchObject({ status: "cambiada", changed_by_email: PROF.email });
    }
    expect(out.goals.find((g) => g.id === loose)?.status).toBe("activa");
    expect(out.goals.find((g) => g.id === achieved)?.status).toBe("lograda");
    expect((await familyPractice(ctx, ACCOUNT_A, P)).goals.map((g) => g.id).sort()).toEqual([loose, achieved].sort());
  });

  test("retirar una devolución después de retirar su plan: esa meta queda cambiada (no vuelve); la que no tiene plan, sí", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const loose = await activeGoal(db, ctx, "Practicar en familia");
    const ofPlan = await planGoal(ctx, PLAN, "Animarse a pedir en el kiosco");
    const sent = await sendFeedback(ctx, [loose, ofPlan]);
    const withdrawn = await staffPracticeAction(ctx, PROF, { action: "plan_withdraw", patient_id: P, plan_id: PLAN, reason: "error" });
    // Las logradas siguen con su devolución
    expect(withdrawn.goals.find((g) => g.id === ofPlan)?.status).toBe("lograda");

    const out = await staffPracticeAction(ctx, PROF, { action: "feedback_withdraw", patient_id: P, feedback_id: sent.feedback[0].id, reason: "error" });
    expect(out.goals.find((g) => g.id === loose)).toMatchObject({ status: "activa", achieved_at: null, feedback_id: null });
    expect(out.goals.find((g) => g.id === ofPlan)).toMatchObject({ status: "cambiada", achieved_at: null, feedback_id: null, changed_by_email: PROF.email });
    expect(out.feedback[0].goals).toEqual([]);
    const family = await familyPractice(ctx, ACCOUNT_A, P);
    expect(family.goals.map((g) => g.id)).toEqual([loose]);
    expect((await familyMedals(ctx, ACCOUNT_A, P)).goals.map((g) => g.id)).toEqual([loose]);
  });

  test("retirar una devolución: la meta de una versión anterior del plan publicado vuelve; la de un plan finalizado, no", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const ofV1 = await planGoal(ctx, PLAN, "Animarse a pedir en el kiosco");
    const v2 = await publish(ctx, PROF, await save(ctx, PROF, planInput()));
    const v2Id = v2.published!.id;
    const first = await sendFeedback(ctx, [ofV1]);
    const back = await staffPracticeAction(ctx, PROF, { action: "feedback_withdraw", patient_id: P, feedback_id: first.feedback[0].id, reason: "error" });
    expect(back.goals.find((g) => g.id === ofV1)?.status).toBe("activa");

    const ofV2 = await planGoal(ctx, v2Id, "Contar un chiste en la mesa");
    const second = await sendFeedback(ctx, [ofV1, ofV2]);
    await staffPracticeAction(ctx, PROF, { action: "plan_finish", patient_id: P, plan_id: v2Id });
    const live = second.feedback.find((f) => !f.withdrawn_at)!;
    const out = await staffPracticeAction(ctx, PROF, { action: "feedback_withdraw", patient_id: P, feedback_id: live.id, reason: "error" });
    expect(out.goals.filter((g) => g.id === ofV1 || g.id === ofV2).map((g) => g.status)).toEqual(["cambiada", "cambiada"]);
    expect((await familyPractice(ctx, ACCOUNT_A, P)).goals).toEqual([]);
  });

  test("finalizar un plan cierra sus metas como retirarlo: activas y en borrador de su cadena pasan a cambiada; las logradas siguen", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const loose = await activeGoal(db, ctx, "Practicar en familia");
    const a = await planGoal(ctx, PLAN, "Animarse a pedir en el kiosco");
    const b = await planGoal(ctx, PLAN, "Animarse a atender el teléfono", false);
    const v2 = await publish(ctx, PROF, await save(ctx, PROF, planInput()));
    const v2Id = v2.published!.id;
    const c = await planGoal(ctx, v2Id, "Saludar a la maestra");
    const achieved = await planGoal(ctx, v2Id, "Pedir la palabra en clase");
    const sent = await sendFeedback(ctx, [achieved]);
    // Un borrador nuevo (versión 3) con su meta: sigue abierto
    const v3 = await save(ctx, PROF, planInput());
    expect(v3.draft).toMatchObject({ version: 3, supersedes_id: v2Id });
    const ofDraft = await planGoal(ctx, v3.draft!.id, "Leer un cuento en voz alta por semana", false);

    const out = await staffPracticeAction(ctx, PROF, { action: "plan_finish", patient_id: P, plan_id: v2Id });
    expect(out.published).toBeNull();
    expect(out.history.find((h) => h.id === v2Id)).toMatchObject({ status: "finalizado", close_reason: "finalizado" });
    expect(db.tables.patient_exercise_plans.find((p) => p.id === v2Id)).toMatchObject({ closed_by_email: PROF.email, updated_by_email: PROF.email });
    for (const id of [a, b, c]) expect(out.goals.find((g) => g.id === id)).toMatchObject({ status: "cambiada", changed_by_email: PROF.email });
    expect(out.goals.find((g) => g.id === loose)?.status).toBe("activa");
    expect(out.goals.find((g) => g.id === achieved)?.status).toBe("lograda");
    expect(out.goals.find((g) => g.id === ofDraft)?.status).toBe("borrador");
    // La familia ve lo mismo que con un plan retirado: la meta suelta y la lograda
    const family = await familyPractice(ctx, ACCOUNT_A, P);
    expect(family.plan).toBeNull();
    expect(family.goals.map((g) => g.id).sort()).toEqual([loose, achieved].sort());
    expect((await familyMedals(ctx, ACCOUNT_A, P)).goals.map((g) => g.id)).toEqual([loose, achieved]);
    // Ya finalizado: otra vez da conflicto
    expect((await failure(staffPracticeAction(ctx, PROF, { action: "plan_finish", patient_id: P, plan_id: v2Id }))).status).toBe(409);
    // Retirar la devolución no revive la meta del plan finalizado
    const back = await staffPracticeAction(ctx, PROF, { action: "feedback_withdraw", patient_id: P, feedback_id: sent.feedback[0].id, reason: "error" });
    expect(back.goals.find((g) => g.id === achieved)).toMatchObject({ status: "cambiada", achieved_at: null, feedback_id: null });
    expect((await familyPractice(ctx, ACCOUNT_A, P)).goals.map((g) => g.id)).toEqual([loose]);

    // El borrador se publica después sin reemplazar al finalizado: su meta se publica con él y las del finalizado no vuelven
    const v3pub = await publish(ctx, PROF, back);
    expect(v3pub.published).toMatchObject({ id: v3.draft!.id, status: "publicado", supersedes_id: null });
    expect(v3pub.goals.find((g) => g.id === ofDraft)?.status).toBe("activa");
    for (const id of [a, b, c, achieved]) expect(v3pub.goals.find((g) => g.id === id)?.status).toBe("cambiada");
    expect((await familyPractice(ctx, ACCOUNT_A, P)).goals.map((g) => g.id).sort()).toEqual([loose, ofDraft].sort());
  });

  test("un borrador armado sobre un plan que después se cerró no lo reemplaza: ese plan no vuelve a la cadena ni sus metas a valer", async () => {
    for (const close of ["plan_withdraw", "plan_finish"] as const) {
      const db = seed();
      const ctx = fakeCtx(db);
      const ofV1 = await planGoal(ctx, PLAN, "Animarse a pedir en el kiosco");
      const sent = await sendFeedback(ctx, [ofV1]);
      const draft = await save(ctx, PROF, planInput());
      // Al armarse, el borrador iba a reemplazar al publicado
      expect(draft.draft?.supersedes_id).toBe(PLAN);
      const closed = await staffPracticeAction(ctx, PROF, { action: close, patient_id: P, plan_id: PLAN, reason: "error" });
      expect(closed.published).toBeNull();
      expect(closed.goals.find((g) => g.id === ofV1)?.status).toBe("lograda");

      // Se publica sin un plan publicado: no reemplaza a nadie
      const v2 = await publish(ctx, PROF, closed);
      expect(v2.published).toMatchObject({ id: draft.draft!.id, version: 2, status: "publicado", supersedes_id: null });
      expect(v2.history.find((h) => h.id === PLAN)?.status).toBe(close === "plan_finish" ? "finalizado" : "retirado");
      expect(db.tables.patient_exercise_plans.find((p) => p.id === draft.draft!.id)?.supersedes_id).toBeNull();
      // El resumen cuenta desde la versión nueva, no desde el plan cerrado
      expect(v2.summary.since).toBe(TODAY);

      // Retirar la devolución: la meta del plan cerrado no vuelve a estar activa
      const out = await staffPracticeAction(ctx, PROF, { action: "feedback_withdraw", patient_id: P, feedback_id: sent.feedback[0].id, reason: "error" });
      expect(out.goals.find((g) => g.id === ofV1)).toMatchObject({ status: "cambiada", achieved_at: null, feedback_id: null, changed_by_email: PROF.email });
      expect((await familyPractice(ctx, ACCOUNT_A, P)).goals).toEqual([]);
      // Y una meta nueva del plan cerrado no se puede cargar
      const bad = await failure(staffPracticeAction(ctx, PROF, {
        action: "goal_save", patient_id: P,
        goal: { id: null, plan_id: PLAN, kind: "terapeutica", title: "Saludar a la maestra", rule: null, medal_title: null, agreed_with_patient: false },
      }));
      expect(extra(bad)).toMatchObject({ code: "INVALID", field: "plan_id" });
    }
  });

  test("una meta en borrador de un plan que ya se cerró no se publica: se edita para sumarla al plan de ahora", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const CLOSED = "El plan de esa meta ya se cerró. Editala para sumarla al plan de ahora y publicala.";
    // Al finalizar el plan, su meta en borrador queda "cambiada" (como al retirarlo): ya no se publica
    const g = await planGoal(ctx, PLAN, "Animarse a atender el teléfono", false);
    const fin = await staffPracticeAction(ctx, PROF, { action: "plan_finish", patient_id: P, plan_id: PLAN });
    expect(fin.goals.find((x) => x.id === g)).toMatchObject({ status: "cambiada", changed_by_email: PROF.email });
    const e = await failure(staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: g }));
    expect(e.status).toBe(409);
    expect(extra(e).code).toBe("CONFLICT");
    expect(e.message).toBe("Esa meta ya no está en borrador. Actualizá la sección.");

    // Un borrador descartado: su meta sigue en borrador, pero no se publica
    const draft = await save(ctx, PROF, planInput());
    const h = await planGoal(ctx, draft.draft!.id, "Contar un chiste en la mesa", false);
    await staffPracticeAction(ctx, PROF, { action: "plan_withdraw", patient_id: P, plan_id: draft.draft!.id, reason: "otro" });
    const closed = await failure(staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: h }));
    expect(closed.status).toBe(409);
    expect(extra(closed).code).toBe("CONFLICT");
    expect(closed.message).toBe(CLOSED);
    expect(db.tables.patient_goals.find((x) => x.id === h)?.status).toBe("borrador");

    // Sin plan (o con el de ahora) se publica
    await staffPracticeAction(ctx, PROF, {
      action: "goal_save", patient_id: P,
      goal: { id: h, plan_id: null, kind: "terapeutica", title: "Contar un chiste en la mesa", rule: null, medal_title: null, agreed_with_patient: false },
    });
    expect((await staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: h })).goals.find((x) => x.id === h)?.status).toBe("activa");
  });

  test("si el plan se cierra mientras se publica la meta, la base la frena con el mismo aviso", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const g = await planGoal(ctx, PLAN, "Animarse a atender el teléfono", false);
    // Otra persona finaliza el plan justo después de que el servidor lo miró
    const admin = ctx.admin as unknown as { from: (t: string) => unknown };
    const original = admin.from;
    let goalReads = 0;
    admin.from = (t: string) => {
      if (t === "patient_goals" && ++goalReads === 2) {
        Object.assign(db.tables.patient_exercise_plans[0], { status: "finalizado", closed_at: NOW.toISOString(), closed_by_email: DIR.email, close_reason: "finalizado" });
      }
      return original(t);
    };
    const e = await failure(staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: g }));
    admin.from = original;
    expect(e.status).toBe(409);
    expect(e.message).toBe("El plan de esa meta ya se cerró. Editala para sumarla al plan de ahora y publicala.");
    expect(db.tables.patient_goals.find((x) => x.id === g)?.status).toBe("borrador");
  });

  test("la meta de un plan en borrador no se publica sola: sale con el plan, y si se descarta la familia nunca la vio", async () => {
    const WITH_DRAFT = "Esa meta sale junto con el plan en borrador. Para publicarla antes, editala y destildá «Publicarla junto con el plan en borrador».";
    for (const end of ["publicar", "descartar"] as const) {
      const db = seed();
      const ctx = fakeCtx(db);
      const draft = await save(ctx, PROF, planInput());
      const g = await planGoal(ctx, draft.draft!.id, "Contar un chiste en la mesa", false);
      const e = await failure(staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: g }));
      expect(e.status).toBe(409);
      expect(extra(e).code).toBe("CONFLICT");
      expect(e.message).toBe(WITH_DRAFT);
      expect(db.tables.patient_goals.find((x) => x.id === g)?.status).toBe("borrador");
      expect((await familyPractice(ctx, ACCOUNT_A, P)).goals.some((x) => x.id === g)).toBe(false);

      if (end === "publicar") {
        const v2 = await publish(ctx, PROF, await staffPracticeAction(ctx, PROF, { action: "get", patient_id: P }));
        expect(v2.goals.find((x) => x.id === g)?.status).toBe("activa");
        expect((await familyPractice(ctx, ACCOUNT_A, P)).goals.some((x) => x.id === g)).toBe(true);
      } else {
        await staffPracticeAction(ctx, PROF, { action: "plan_withdraw", patient_id: P, plan_id: draft.draft!.id, reason: "otro" });
        expect(db.tables.patient_goals.find((x) => x.id === g)?.status).toBe("borrador");
        expect((await familyPractice(ctx, ACCOUNT_A, P)).goals.some((x) => x.id === g)).toBe(false);
        expect((await familyMedals(ctx, ACCOUNT_A, P)).goals.some((x) => x.id === g)).toBe(false);
      }
    }
  });

  test("la base también frena la meta de un plan en borrador publicada sola", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const draft = await save(ctx, PROF, planInput());
    const g = await planGoal(ctx, draft.draft!.id, "Contar un chiste en la mesa", false);
    // Otra pestaña la carga en el borrador justo después de que el servidor miró los planes
    db.tables.patient_goals.find((x) => x.id === g)!.plan_id = null;
    const admin = ctx.admin as unknown as { from: (t: string) => unknown };
    const original = admin.from;
    let goalReads = 0;
    admin.from = (t: string) => {
      if (t === "patient_goals" && ++goalReads === 2) db.tables.patient_goals.find((x) => x.id === g)!.plan_id = draft.draft!.id;
      return original(t);
    };
    const e = await failure(staffPracticeAction(ctx, PROF, { action: "goal_publish", patient_id: P, goal_id: g }));
    admin.from = original;
    expect(e.status).toBe(409);
    expect(e.message).toContain("junto con el plan en borrador");
    expect(db.tables.patient_goals.find((x) => x.id === g)?.status).toBe("borrador");
  });
});

describe("equipo: publicar lo que se revisó", () => {
  test("si un ejercicio del borrador cambia entre la revisión y la publicación, no se publica", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const dto = await save(ctx, PROF, planInput());
    const exId = dto.draft!.exercises[0].id;
    // Otra persona guarda el mismo borrador mientras se publica (después de que el servidor lo revisó)
    const admin = ctx.admin as unknown as { rpc: (name: string, p: Row) => Promise<Result> };
    const original = admin.rpc;
    admin.rpc = async (name, p) => {
      if (name === "practice_publish_plan") {
        await (ctx.admin.from("patient_exercises").update({ para_que: "Para que hable bien en casa." }).eq("id", exId) as unknown as Promise<Result>);
      }
      return original(name, p);
    };
    const e = await failure(publish(ctx, PROF, dto));
    expect(e.status).toBe(409);
    expect(extra(e).code).toBe("CONFLICT");
    expect(db.tables.patient_exercise_plans.find((p) => p.id === dto.draft!.id)?.status).toBe("borrador");
    admin.rpc = original;
    // Con el borrador actualizado se revisa de nuevo: el texto nuevo pide «Lo dejo así»
    const fresh = await staffPractice(ctx, PROF, P);
    expect(fresh.draft?.publish_problem).toBe(PRACTICE_ERROR.review);
    expect(extra(await failure(publish(ctx, PROF, fresh))).code).toBe("REVIEW");
  });

  test("la pausa de vacaciones del plan que se reemplaza pasa a la versión nueva", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    await staffPracticeAction(ctx, PROF, { action: "plan_break", patient_id: P, plan_id: PLAN, until: "2026-11-02" });
    const dto = await save(ctx, PROF, planInput());
    const out = await publish(ctx, PROF, dto);
    expect(out.published).toMatchObject({ id: dto.draft!.id, on_break_until: "2026-11-02" });
  });
});

describe("equipo: lecturas acotadas de la ficha", () => {
  test("lo pendiente se pide solo para ese paciente (p_only); la bandeja, para todos", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    addLog(db, {});
    addLog(db, { patient_id: Q, plan_id: db.tables.patient_exercise_plans[1].id, exercise_id: EXQ, exercise_key: "q-key", account_id: null });
    const calls: { params: Row; rows: unknown[] }[] = [];
    const admin = ctx.admin as unknown as { rpc: (name: string, p: Row) => Promise<Result> };
    const original = admin.rpc;
    admin.rpc = async (name, p) => {
      const r = await original(name, p);
      if (name === "practice_pending") calls.push({ params: p, rows: ((r.data as Row[] | null) ?? []).map((x) => x.patient_id) });
      return r;
    };
    const dto = await staffPractice(ctx, PROF, P);
    expect(dto.pending.logs).toBe(1);
    expect(calls).toEqual([{ params: { p_since: null, p_patients: [P], p_only: true }, rows: [P] }]);
    calls.length = 0;
    await staffPracticeInbox(ctx, PROF);
    expect(calls).toHaveLength(1);
    expect(calls[0].params.p_only).toBe(false);
    expect([...calls[0].rows].sort()).toEqual([P, Q].sort());
    admin.rpc = original;
  });

  // 120 versiones de 10 ejercicios (1200 filas, más que el tope de 1000 de
  // la API): la primera se publicó el 01/01 y la vigente, el 30/04
  function manyVersions(db: FakeDb, n = 120) {
    const KEYS = Array.from({ length: 10 }, () => randomUUID());
    db.tables.patient_exercise_plans = db.tables.patient_exercise_plans.filter((p) => p.patient_id !== P);
    db.tables.patient_exercises = db.tables.patient_exercises.filter((e) => e.patient_id !== P);
    let prev: string | null = null;
    for (let v = 1; v <= n; v++) {
      const id = randomUUID();
      const at = new Date(Date.parse("2026-01-01T13:00:00.000Z") + (v - 1) * 86_400_000).toISOString();
      const last = v === n;
      db.tables.patient_exercise_plans.push(planRow({
        id, version: v, supersedes_id: prev, status: last ? "publicado" : "reemplazado", created_at: at, updated_at: at,
        published_at: at, closed_at: last ? null : at, closed_by_email: last ? null : PROF.email, close_reason: last ? null : "reemplazado",
      }));
      KEYS.forEach((k, i) => db.tables.patient_exercises.push(
        exRow(randomUUID(), k, { plan_id: id, position: i, title: `Ejercicio ${i + 1} (v${v})`, created_at: at, updated_at: at })));
      prev = id;
    }
    return { KEYS, live: prev! };
  }

  test("con muchas versiones, la ficha lee el plan vigente y las versiones de lo que muestra", async () => {
    const db = seed();
    const { KEYS, live } = manyVersions(db);
    expect(db.tables.patient_exercises.filter((e) => e.patient_id === P).length).toBeGreaterThan(1000);
    const ctx = fakeCtx(db);
    const liveEx = db.tables.patient_exercises.filter((e) => e.plan_id === live);
    addLog(db, { plan_id: live, exercise_id: liveEx[0].id, exercise_key: KEYS[0] });
    const dto = await staffPractice(ctx, PROF, P);
    expect(dto.published?.id).toBe(live);
    expect(dto.published?.exercises.map((e) => e.title)).toEqual(KEYS.map((_, i) => `Ejercicio ${i + 1} (v120)`));
    expect(dto.published?.exercises.map((e) => e.first_published_on)).toEqual(KEYS.map(() => "2026-01-01"));
    expect(dto.summary.since).toBe("2026-01-01");
    expect(dto.grid.rows[0]).toMatchObject({ exercise_key: KEYS[0], title: "Ejercicio 1 (v120)", current: true });
    expect(dto.grid.rows[0].cells[GRID_LAST]).not.toBeNull();
    // La familia puede anotar anteayer: el ejercicio se publicó por primera vez en enero
    const r = await familyLog(ctx, ACCOUNT_A, { exercise_id: liveEx[1].id, practiced_on: "2026-10-12" });
    expect(r.exercise.days.map((d) => d.date)).toEqual([TODAY, "2026-10-13", "2026-10-12"]);
    expect(r.exercise.days[2].log).not.toBeNull();
  });

  test("con muchas versiones, un borrador nuevo conserva el «Lo dejo así» de la última y su primer día", async () => {
    const db = seed();
    const { KEYS, live } = manyVersions(db);
    const latest = db.tables.patient_exercises.find((e) => e.plan_id === live && e.exercise_key === KEYS[9])!;
    Object.assign(latest, {
      para_que: "Para que hable bien en casa.",
      lint_overrides: [{ terms: ["hablar bien"], reason: "Lo pidió la familia", by_email: PROF.email, at: "2026-04-30T13:00:00.000Z" }],
    });
    const ctx = fakeCtx(db);
    const dto = await save(ctx, PROF, planInput({ exercises: [exInput({ exercise_key: KEYS[9], para_que: "Para que hable bien en casa." })] }));
    expect(dto.draft).toMatchObject({ version: 121, supersedes_id: live, publish_problem: null });
    expect(dto.draft?.exercises[0]).toMatchObject({ exercise_key: KEYS[9], first_published_on: "2026-01-01" });
    expect(dto.draft?.exercises[0].lint_overrides).toMatchObject([{ terms: ["hablar bien"], reason: "Lo pidió la familia" }]);
    // La identidad de un ejercicio de otro paciente no vale
    const foreignKey = db.tables.patient_exercises.find((e) => e.patient_id === Q)!.exercise_key as string;
    const other = await failure(save(ctx, PROF, planInput({ id: dto.draft!.id, exercises: [exInput({ exercise_key: foreignKey })] }), dto.draft!.updated_at));
    expect(extra(other)).toMatchObject({ code: "INVALID", field: "exercise_key" });
  });
});

describe("bandeja: Prácticas", () => {
  test("solo perfiles clínicos; mis pacientes y comentarios de riesgo", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const log = addLog(db, {});
    db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: log.id, patient_id: P, account_id: A, result: "costo", comment: "Dice que le pegan", risk_flag: true, created_at: NOW.toISOString() });
    expect(await staffPracticeInbox(ctx, ADMIN)).toEqual({ allowed: false, items: [] });
    const inbox = await staffPracticeInbox(ctx, PROF);
    expect(inbox.allowed).toBe(true);
    expect(inbox.items).toMatchObject([{
      kind: "practicas", patient_id: P, patient_name: "Pérez, Martín", professional_id: PRO, mine: true,
      pending: { logs: 1, comments: 1, costo: 1, risk: 1, since: TODAY, stale: false }, on_break: false, goal: null,
    }]);
    // Mi paciente ya cuenta en practice_pending: practice_risk no lo repite,
    // pero practice_urgent sí lo tiene (la pestaña se marca como urgente)
    expect(await staffPracticeCounts(ctx, PROF)).toEqual({ practice_pending: 1, practice_risk: 0, practice_urgent: 1 });
    // Para otra profesional no es "mío", pero el riesgo cuenta igual
    expect(await staffPracticeCounts(ctx, DIR)).toEqual({ practice_pending: 0, practice_risk: 1, practice_urgent: 1 });
  });

  test("practice_risk: pacientes ajenos con riesgo sin ver, uno por paciente aunque tenga varias filas o comentarios", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    // Lucía (sin profesional a cargo): dos comentarios de riesgo y una meta cumplida
    const QPLAN = db.tables.patient_exercise_plans[1].id;
    for (const [i, day] of ["2026-10-13", TODAY].entries()) {
      const l = addLog(db, { patient_id: Q, plan_id: QPLAN, exercise_id: EXQ, exercise_key: "q-key", practiced_on: day, account_id: null, created_at: `${day}T1${i}:00:00.000Z` });
      db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: l.id, patient_id: Q, account_id: null, result: null, comment: "Dice que no quiere vivir", risk_flag: true, created_at: `${day}T1${i}:01:00.000Z` });
    }
    db.tables.patient_goals.push({ ...defaults(db, "patient_goals"), patient_id: Q, kind: "practica", title: "Dos días", rule: { dias: 2, semanas: 1 }, status: "activa", created_by_email: PROF.email, published_at: "2026-10-12T12:00:00.000Z", published_by_email: PROF.email });
    // Martín (mío para la Lic. Torres): una práctica sin riesgo
    addLog(db, {});
    const items = (await staffPracticeInbox(ctx, PROF)).items;
    expect(items.map((i) => [i.patient_id, i.kind, i.mine])).toEqual([[Q, "practicas", false], [P, "practicas", true], [Q, "meta_cumplida", false]]);
    expect(items[0].pending.risk).toBe(2);
    expect(await staffPracticeCounts(ctx, PROF)).toEqual({ practice_pending: 1, practice_risk: 1, practice_urgent: 1 });
    expect(await staffPracticeCounts(ctx, DIR)).toEqual({ practice_pending: 0, practice_risk: 1, practice_urgent: 1 });
  });

  test("practice_urgent: pacientes con riesgo sin ver, míos o no, uno por paciente; no se suma al número", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    const QPLAN = db.tables.patient_exercise_plans[1].id;
    // Lucía (ajena): dos comentarios de riesgo en dos prácticas, y una meta cumplida (otra fila de la bandeja)
    for (const [i, day] of ["2026-10-13", TODAY].entries()) {
      const l = addLog(db, { patient_id: Q, plan_id: QPLAN, exercise_id: EXQ, exercise_key: "q-key", practiced_on: day, account_id: null, created_at: `${day}T1${i}:00:00.000Z` });
      db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: l.id, patient_id: Q, account_id: null, result: null, comment: "Dice que no quiere vivir", risk_flag: true, created_at: `${day}T1${i}:01:00.000Z` });
    }
    db.tables.patient_goals.push({ ...defaults(db, "patient_goals"), patient_id: Q, kind: "practica", title: "Dos días", rule: { dias: 2, semanas: 1 }, status: "activa", created_by_email: PROF.email, published_at: "2026-10-12T12:00:00.000Z", published_by_email: PROF.email });
    // Martín (mío para la Lic. Torres): un comentario de riesgo
    const log = addLog(db, {});
    db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: log.id, patient_id: P, account_id: A, result: null, comment: "Dice que le pegan", risk_flag: true, created_at: NOW.toISOString() });
    const items = (await staffPracticeInbox(ctx, PROF)).items;
    expect(items.filter((i) => i.pending.risk > 0 && i.kind === "practicas").map((i) => i.patient_id).sort()).toEqual([P, Q].sort());
    const mine = await staffPracticeCounts(ctx, PROF);
    expect(mine).toEqual({ practice_pending: 1, practice_risk: 1, practice_urgent: 2 });
    // El número de la pestaña sigue siendo practice_pending + practice_risk (una vez cada paciente)
    expect(mine.practice_pending + mine.practice_risk).toBe(2);
    expect(await staffPracticeCounts(ctx, DIR)).toEqual({ practice_pending: 0, practice_risk: 2, practice_urgent: 2 });

    // Con lo de Martín visto, queda solo Lucía
    await staffPracticeAction(ctx, PROF, { action: "mark_seen", patient_id: P });
    expect(await staffPracticeCounts(ctx, PROF)).toEqual({ practice_pending: 0, practice_risk: 1, practice_urgent: 1 });
    // Sin riesgo sin ver de nadie, nada urgente aunque haya filas
    await staffPracticeAction(ctx, PROF, { action: "mark_seen", patient_id: Q });
    const calm = await staffPracticeCounts(ctx, PROF);
    expect(calm.practice_urgent).toBe(0);
    expect((await staffPracticeInbox(ctx, PROF)).items.map((i) => [i.patient_id, i.kind])).toEqual([[Q, "meta_cumplida"]]);
    expect(calm).toEqual({ practice_pending: 0, practice_risk: 0, practice_urgent: 0 });
  });

  test("a los 7 días sin revisar se pone en ámbar, salvo en pausa", async () => {
    const db = seed();
    addLog(db, { practiced_on: "2026-10-07", created_at: "2026-10-07T15:00:00.000Z" });
    const [item] = (await staffPracticeInbox(fakeCtx(db), PROF)).items;
    expect(item.pending).toMatchObject({ since: "2026-10-07", stale: true });
    db.tables.patient_exercise_plans[0].on_break_until = "2026-10-20";
    const [paused] = (await staffPracticeInbox(fakeCtx(db), PROF)).items;
    expect(paused).toMatchObject({ on_break: true, pending: { stale: false } });
  });

  test("sin el script 26: vacía y sin errores", async () => {
    const db = seed();
    for (const t of ["patient_exercise_plans", "exercise_practice_logs", "exercise_practice_notes", "patient_goals"]) db.missing.add(t);
    expect(await staffPracticeInbox(fakeCtx(db), PROF)).toEqual({ allowed: true, items: [] });
    expect(await staffPracticeCounts(fakeCtx(db), PROF)).toEqual({ practice_pending: 0, practice_risk: 0, practice_urgent: 0 });
  });

  test("pendingOf: desde lo que contó la base; since es lo más viejo y Administración no ve los comentarios", () => {
    const row = { logs: 1, first_log: "2026-10-13", comments: 1, costo: 0, risk: 0, first_note: "2026-10-12T15:02:00.000Z" };
    expect(pendingOf(row, false, TODAY)).toEqual({ logs: 1, comments: 1, costo: 0, risk: 0, since: "2026-10-12", stale: false });
    expect(pendingOf(row, false, "2026-10-19")).toMatchObject({ stale: true });
    expect(pendingOf(row, true, "2026-10-19")).toMatchObject({ stale: false });
    expect(pendingOf(row, false, TODAY, true)).toEqual({ logs: 1, comments: 0, costo: 0, risk: 0, since: "2026-10-13", stale: false });
    expect(pendingOf({ ...row, logs: 0, first_log: null }, false, TODAY, true)).toEqual({ logs: 0, comments: 0, costo: 0, risk: 0, since: null, stale: false });
    expect(pendingOf(undefined, false, TODAY)).toEqual({ logs: 0, comments: 0, costo: 0, risk: 0, since: null, stale: false });
  });

  test("tope de 1000 filas: la bandeja y la ficha no pierden lo más nuevo ni los comentarios de riesgo", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    // 1200 prácticas viejas (todas antes del último "Visto") y 150 comentarios viejos
    for (let i = 0; i < 1200; i++) {
      const day = addDaysKey("2026-09-30", -Math.floor(i / 8));
      addLog(db, { exercise_key: `old-${i % 8}`, practiced_on: day, created_at: `${day}T15:00:00.000Z` });
    }
    const oldLogs = db.tables.exercise_practice_logs.slice(0, 150);
    for (const l of oldLogs) {
      db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: l.id, patient_id: P, account_id: A, result: "bien", comment: "Bien", risk_flag: false, created_at: `${l.practiced_on}T15:01:00.000Z` });
    }
    Object.assign(db.tables.patient_exercise_plans[0], { last_reviewed_at: "2026-10-01T00:00:00.000Z", last_reviewed_by_email: PROF.email, last_reviewed_label: AUTHOR });
    // Lo nuevo: una práctica de hoy con un comentario de riesgo, y 120 comentarios comunes más nuevos
    const fresh = addLog(db, {});
    const RISK = "Dice que le pegan en el recreo";
    db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: fresh.id, patient_id: P, account_id: A, result: "costo", comment: RISK, risk_flag: true, created_at: "2026-10-14T12:00:00.000Z" });
    for (let i = 0; i < 120; i++) {
      db.tables.exercise_practice_notes.push({ id: randomUUID(), log_id: fresh.id, patient_id: P, account_id: B, result: "bien", comment: null, risk_flag: false, created_at: `2026-10-14T13:${String(i % 60).padStart(2, "0")}:${String(Math.floor(i / 60)).padStart(2, "0")}.000Z` });
    }
    const [item] = (await staffPracticeInbox(ctx, PROF)).items;
    expect(item.pending).toMatchObject({ logs: 1, comments: 1, costo: 1, risk: 1, since: TODAY });
    const dto = await staffPractice(ctx, PROF, P);
    expect(dto.pending).toMatchObject({ logs: 1, risk: 1 });
    expect(dto.notes[0]).toMatchObject({ comment: RISK, risk: true, is_new: true });
    expect(dto.grid.rows.find((r) => r.exercise_key === K1)?.cells[GRID_LAST]?.log_id).toBe(fresh.id);
    // El resumen cuenta todo lo que se anotó desde que se publicó el plan (10/10): solo lo de hoy
    expect(dto.summary).toMatchObject({ since: "2026-10-10", logs: 1, days: 1, last: TODAY });
    // Las medallas de constancia ven lo más nuevo: la práctica de hoy suma a la semana
    const medals = await familyMedals(ctx, ACCOUNT_A, P);
    expect(medals.next.find((n) => n.code === "semana_cumplida")?.text).toContain("llevás 1 de 3");
  });
});

// ── Actividades para jugar en el celular (etapa "activities", script 33) ────

describe("actividades: poesía y rima en el plan", () => {
  const POEM = {
    v: 1, mecanica: "poesia", titulo: "Dinosaurios", tema: "selva", esquema: "AABB", rima: "asonante", palmas: false,
    estrofas: [{ versos: ["Un dinosaurio grande", "camina por el valle", "come hojas del pino", "y saluda al camino"], icono: null }],
  } as const;
  const withPoem = (o: Partial<ExerciseInput> = {}) =>
    planInput({ exercises: [exInput({ exercise_key: K1, activity: POEM as unknown as ExerciseInput["activity"], ...o })] });
  const on = () => { process.env.PORTAL_CLINICAL_FEATURES = "consent,practice,activities"; };

  test("prendida: se guarda, se publica y la familia la recibe con los pasos de siempre", async () => {
    on();
    const db = seed();
    const ctx = fakeCtx(db);
    const dto = await save(ctx, PROF, withPoem());
    expect(dto.features.activities).toBe(true);
    expect(dto.draft?.exercises[0].activity).toMatchObject({ mecanica: "poesia", titulo: "Dinosaurios", estrofas: [{ icono: null }] });
    const out = await publish(ctx, PROF, dto);
    const ex = out.published!.exercises[0];
    expect(ex.activity?.mecanica).toBe("poesia");
    const page = await familyExercise(ctx, ACCOUNT_A, ex.id);
    expect(page.exercise.activity?.titulo).toBe("Dinosaurios");
    expect(page.exercise.pasos.length).toBeGreaterThanOrEqual(2);
  });

  test("una actividad mal armada no se guarda; sus textos pasan por la revisión", async () => {
    on();
    const ctx = fakeCtx(seed());
    const bad = await failure(save(ctx, PROF, withPoem({ activity: { ...POEM, estrofas: [{ versos: ["uno"], icono: null }] } as unknown as ExerciseInput["activity"] })));
    expect(bad.status).toBe(400);
    expect(extra(bad)).toMatchObject({ code: "INVALID", field: "activity", index: 0 });
    expect(bad.message).toContain("Estrofa 1");
    const lint = { ...POEM, estrofas: [{ versos: ["Vamos a hablar bien", "y a jugar también", "come hojas del pino", "y saluda al camino"], icono: null }] };
    const dto = await save(ctx, PROF, withPoem({ activity: lint as unknown as ExerciseInput["activity"] }));
    expect(dto.draft?.exercises[0].alerts).toContain("hablar bien");
    expect(dto.draft?.publish_problem).toBe(PRACTICE_ERROR.review);
  });

  test("hasta los 5 años no hay versión interactiva", async () => {
    on();
    const ctx = fakeCtx(seed({ birth: "2021-05-01" }));
    const e = await failure(save(ctx, PROF, withPoem()));
    expect(e.status).toBe(400);
    expect(extra(e)).toMatchObject({ field: "activity", index: 0 });
    // Sin actividad, el mismo ejercicio se guarda
    expect((await save(ctx, PROF, planInput())).draft).not.toBeNull();
  });

  test("apagada: no se lee ni se escribe la columna", async () => {
    const db = seed();
    db.missingCols.add("patient_exercises.activity");
    const ctx = fakeCtx(db);
    const dto = await save(ctx, PROF, withPoem());
    expect(dto.features.activities).toBe(false);
    expect(dto.draft?.exercises[0].activity).toBeNull();
    expect(db.tables.patient_exercises.every((r) => r.activity === undefined)).toBe(true);
    expect((await familyExercise(ctx, ACCOUNT_A, EX1)).exercise.activity).toBeNull();
  });

  test("prendida sin el script 33: queda apagada sin caerse", async () => {
    on();
    const db = seed();
    db.missingCols.add("patient_exercises.activity");
    const ctx = fakeCtx(db);
    const dto = await save(ctx, PROF, withPoem());
    expect(dto.features.activities).toBe(false);
    expect(dto.draft?.exercises[0].activity).toBeNull();
    expect((await familyExercise(ctx, ACCOUNT_A, EX1)).exercise.activity).toBeNull();
  });
});
