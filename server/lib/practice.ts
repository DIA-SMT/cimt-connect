// Portal — ejercicios, devoluciones, metas y medallas (etapa B, "practice").
// Reglas, textos y tipos puros en src/lib/practiceRules.ts (los comparten el
// modo mock y las pruebas). La base (script 26) cuida además lo suyo: una
// práctica por ejercicio y por día, las fechas y el límite diario, planes y
// ejercicios congelados al publicarse, notas que no cambian, devoluciones y
// medallas que solo se retiran o se anulan, y nada que se borre.
//
// Familia: solo con la etapa "practice" prendida y si la regla de acceso da
// "ok" para "practice" (vínculo, verificación, consentimiento, habilitado por
// el profesional, sin pausa, conformidad del adolescente). Sin contraseña de
// nuevo: es la práctica de todos los días. Cada id que llega (ejercicio,
// práctica, medalla) se resuelve primero a su paciente: uno ajeno da el mismo
// 404 que uno que no existe.
//
// Equipo: cualquier rol ve la sección (Administración, sin textos clínicos
// ni comentarios: esos campos llegan en null o vacíos); escriben solo
// profesionales y Dirección, con su nombre (como en "Mi información").
//
// Nunca van a los logs del servidor textos clínicos ni comentarios de la
// familia: solo el código del error.
//
// Sin el script 26 (tablas que faltan) las lecturas devuelven vacío: el
// Inicio, la bandeja y la ficha siguen funcionando; las escrituras dan 503.

import {
  type ExerciseDraft, draftApiKey, draftToExerciseInput, editRatio, exerciseFullText,
} from "../../src/lib/aiDraftRules";
import { CATALOG_VERSION, catalogEntry, catalogFor } from "../../src/lib/exerciseCatalog";
import { type ChildClinicalDTO, ADULT_FROM } from "../../src/lib/portalClinicalRules";
import { addDaysKey, ageOn, centerDateOf, centerNow } from "../../src/lib/portalRules";
import {
  type Approach, type CelebrationDTO, type ExerciseSource, type FeedbackDTO, type FeedbackItemDTO,
  type FeedbackWithdrawReason, type GoalDTO, type GoalKind, type GoalRule, type GoalStatus, type LintOverride,
  type MedalDTO, type MedalKind, type MedalsDTO, type MyNoteDTO, type PlanAudience, type PlanCloseReason,
  type PlanStatus, type PlanWithdrawReason, type PracticeActionResult, type PracticeChildDTO, type PracticeDTO,
  type PracticeDay, type PracticeDayDTO, type PracticeErrorCode, type PracticeExerciseDTO,
  type PracticeExerciseItemDTO, type PracticeHomeDTO, type PracticeResult, type PublishCheck,
  type StaffExerciseDTO, type StaffFeedbackDTO, type StaffGoalDTO, type StaffMedalDTO, type StaffNoteDTO,
  type StaffPlanDTO, type StaffPlanVersion, type StaffPracticeDTO, type StaffPracticeGrid,
  type StaffPracticeInboxItem, type StaffPracticePending,
  CONSTANCY_CODES, CONSTANCY_MEDALS, FEEDBACK_WITHDRAW_REASONS, GRID_DAYS, PLAN_WITHDRAW_REASONS, PRACTICE_ACCESS_ACTIONS,
  PRACTICE_BACKDAYS, PRACTICE_DAILY_MAX, PRACTICE_ERROR, PRACTICE_LIMITS, PRACTICE_TEXT, RECENT_MEDALS,
  REVIEW_STALE_DAYS, SCREEN_MODE_BY_AUDIENCE, STAFF_PRACTICE_TEXT,
  approachAgeOk, approachOptions, approachesForDiagnosis, audienceForAge, blockForTitles, centerToday,
  constancyAwards, constancyNext, daysBetween, exerciseTextAlerts, goalProgress, isAdolescent, isDateKey, isUuid,
  onBreak, planSummary, planTextAlerts, practiceDateProblem, practiceDates, practiceSummaryText, publishProblem,
  readersLine, screenMode, uncoveredAlerts, validateFeedback, validateGoal, validateNote, validatePlanDraft, weekKey,
  weekProgress, FLUENCY_TITLE_MESSAGE,
} from "../../src/lib/practiceRules";
import { PROFILE_COLUMNS, profileFromRow, suggestPractice } from "../../src/lib/practiceSuggest";
import { type Account, type ActiveChild, type Ctx, PortalError, activeChildren, missingTable } from "./portal";
import { childrenClinical, features, staffClinical } from "./portalClinical";

// ── Mensajes ────────────────────────────────────────────────────────────────

const OFFLINE = "No pudimos conectar. Probá de nuevo.";
const SAVE_FAILED = "No se pudo guardar. Probá de nuevo.";
const NOT_READY = "Los ejercicios todavía no están disponibles. Probá más tarde.";
const INVALID = "Pedido inválido";
// Familia: lo ajeno y lo que no existe dan lo mismo
const NOT_FOUND = "No encontramos esos ejercicios en tu cuenta.";
const EXERCISE_NOT_FOUND = "No encontramos ese ejercicio en tu cuenta.";
const LOG_NOT_FOUND = "No encontramos esa práctica en tu cuenta.";
const LOG_UNDONE = "Esa práctica se deshizo: anotala de nuevo para contar cómo les fue.";
const CONSENT = "Para ver los ejercicios, primero activá la información de salud.";
const VERIFY = "Para ver los ejercicios, la primera vez tenés que pasar por el centro con tu DNI.";
// Equipo
const PATIENT_NOT_FOUND = "No encontramos ese paciente.";
const AI_DRAFT_GONE = "El borrador de la IA no es de este paciente o ya no se puede usar. Volvé a adaptarlo o usá el original del catálogo.";
const NOT_IN_CATALOG = "Ese ejercicio no está en el catálogo.";
const PAUSED = "El portal de este paciente está en pausa: no se puede publicar.";
const NOTHING_TO_REVIEW = "Todavía no hay prácticas para marcar como vistas. Actualizá la sección.";
const GOAL_HAS_MEDAL = "Esa meta ya tiene su medalla.";
const GOAL_NOT_DRAFT = "Esa meta ya no está en borrador. Actualizá la sección.";
// Como en el modo mock (src/integrations/supabase/mockPortal.ts)
const GOAL_PLAN_CLOSED = "El plan de esa meta ya se cerró. Editala para sumarla al plan de ahora y publicala.";
const GOAL_WITH_DRAFT = "Esa meta sale junto con el plan en borrador. Para publicarla antes, editala y destildá «Publicarla junto con el plan en borrador».";
const ONLY_OWNER = "Solo quien lo publicó o la Dirección lo pueden retirar.";
const ALREADY_WITHDRAWN = "Ya estaba retirada. Actualizá la sección.";
const ALREADY_VOIDED = "Esa medalla ya estaba anulada. Actualizá la sección.";
const BREAK_DATE = "La fecha de vuelta tiene que ser posterior a hoy.";
const GONE_ACCOUNT = "La cuenta ya no existe";
const DIRECCION_LABEL = "Dirección del CIMT";
// "… vio las prácticas el …" si el "Visto" no tiene nombre guardado (nunca
// el de otra persona)
const REVIEWER_FALLBACK = "Tu profesional";
// Motivo con que se anula la medalla de una devolución retirada (lo pone la base)
export const FEEDBACK_WITHDRAWN_VOID_REASON = "devolución retirada";

const DAY_MS = 24 * 60 * 60 * 1000;
// Bandeja: prácticas y comentarios de los últimos 180 días
const INBOX_DAYS = 180;
// Lecturas que se marcan de una vez ("medals_seen", "feedback_seen")
const SEEN_MAX = 50;
// Lugar más alto de un ejercicio en su plan (CHECK del script 26)
const MAX_POSITION = 20;

// Topes de lectura. La API devuelve hasta 1000 filas por pedido y corta sin
// avisar: lo que puede crecer se pide acotado por fecha, de lo más nuevo a
// lo más viejo y con un tope explícito, o ya contado en la base
// (practice_pending, practice_days)
const LIST_MAX = 1000;
const MEDALS_MAX = 500; // por paciente
const FEEDBACK_MAX = 200; // por paciente
const GOALS_MAX = 200; // por paciente
const REPEAT_MAX = 100; // medallas de constancia que se repiten (por paciente)
const NOTES_MAX = 100; // comentarios en la ficha (además, todos los de riesgo sin ver)
const IN_CHUNK = 100; // ids por pedido en .in(…): una URL con cientos de ids se corta

// ── Filas de la base (columnas explícitas) ──────────────────────────────────

type PlanRow = {
  id: string; patient_id: string; version: number; supersedes_id: string | null; status: PlanStatus;
  title: string; goal_text: string | null; audience: PlanAudience; days_per_week: number; review_on: string | null;
  on_break_until: string | null; auto_medals: boolean; professional_id: string | null; author_label: string | null;
  adolescent_ack: boolean; lint_overrides: unknown; created_by_email: string; created_at: string;
  updated_by_email: string | null; updated_at: string; published_at: string | null; published_by_email: string | null;
  closed_at: string | null; closed_by_email: string | null; close_reason: PlanCloseReason | null;
  last_reviewed_at: string | null; last_reviewed_by_email: string | null; last_reviewed_label: string | null;
};
const PLAN_COLS = "id, patient_id, version, supersedes_id, status, title, goal_text, audience, days_per_week, review_on, on_break_until, auto_medals, professional_id, author_label, adolescent_ack, lint_overrides, created_by_email, created_at, updated_by_email, updated_at, published_at, published_by_email, closed_at, closed_by_email, close_reason, last_reviewed_at, last_reviewed_by_email, last_reviewed_label";

type ExRow = {
  id: string; plan_id: string; patient_id: string; exercise_key: string; source: ExerciseSource;
  catalog_id: string | null; catalog_version: string | null; position: number; approach: Approach;
  practiced_in_session: boolean; title: string; para_que: string; pasos: unknown; minutes: number;
  materiales: string | null; for_adult: string | null; si_cuesta: string; with_adult: boolean;
  ai_draft_id: string | null; ai_drafted: boolean; reviewed_at: string | null; reviewed_by_email: string | null;
  edit_ratio: number | string | null; lint_overrides: unknown; removed_at: string | null; removed_by_email: string | null;
};
const EX_COLS = "id, plan_id, patient_id, exercise_key, source, catalog_id, catalog_version, position, approach, practiced_in_session, title, para_que, pasos, minutes, materiales, for_adult, si_cuesta, with_adult, ai_draft_id, ai_drafted, reviewed_at, reviewed_by_email, edit_ratio, lint_overrides, removed_at, removed_by_email";

type LogRow = {
  id: string; patient_id: string; plan_id: string; exercise_id: string; exercise_key: string;
  account_id: string | null; practiced_on: string; created_at: string; voided_at: string | null;
};
const LOG_COLS = "id, patient_id, plan_id, exercise_id, exercise_key, account_id, practiced_on, created_at, voided_at";

type NoteRow = {
  id: string; log_id: string; patient_id: string; account_id: string | null; result: PracticeResult | null;
  comment: string | null; risk_flag: boolean; created_at: string;
};
const NOTE_COLS = "id, log_id, patient_id, account_id, result, comment, risk_flag, created_at";

type FbRow = {
  id: string; patient_id: string; plan_id: string | null; professional_id: string | null; author_label: string;
  body: string; for_adult: string | null; period_start: string | null; period_end: string | null;
  adolescent_ack: boolean; review_note: string | null; sent_at: string; sent_by_email: string;
  withdrawn_at: string | null; withdrawn_by_email: string | null; withdraw_reason: FeedbackWithdrawReason | null;
};
const FB_COLS = "id, patient_id, plan_id, professional_id, author_label, body, for_adult, period_start, period_end, adolescent_ack, review_note, sent_at, sent_by_email, withdrawn_at, withdrawn_by_email, withdraw_reason";

type GoalRow = {
  id: string; patient_id: string; plan_id: string | null; kind: GoalKind; title: string; rule: GoalRule | null;
  medal_title: string | null; agreed_with_patient: boolean; status: GoalStatus; created_by_email: string;
  created_at: string; published_at: string | null; achieved_at: string | null; feedback_id: string | null;
  changed_at: string | null; changed_by_email: string | null; met_notice_dismissed_at: string | null;
};
const GOAL_COLS = "id, patient_id, plan_id, kind, title, rule, medal_title, agreed_with_patient, status, created_by_email, created_at, published_at, achieved_at, feedback_id, changed_at, changed_by_email, met_notice_dismissed_at";

type MedalRow = {
  id: string; patient_id: string; kind: MedalKind; code: string; title: string; period_key: string;
  plan_id: string | null; goal_id: string | null; feedback_id: string | null; message: string | null;
  awarded_at: string; awarded_by_email: string | null; voided_at: string | null; voided_by_email: string | null;
  void_reason: string | null;
};
const MEDAL_COLS = "id, patient_id, kind, code, title, period_key, plan_id, goal_id, feedback_id, message, awarded_at, awarded_by_email, voided_at, voided_by_email, void_reason";

// practice_pending() del script 26: lo que la familia anotó desde el último "Visto"
export type PendingRow = {
  patient_id: string; last_reviewed_at: string | null; on_break_until: string | null;
  logs: number; first_log: string | null; comments: number; costo: number; risk: number; first_note: string | null;
};

type Staff = { user_id: string; email: string; role: string; clinical: boolean };
type Json = Record<string, unknown>;
type DbError = { code?: string; message?: string };
type DbRes = { data: unknown; error: DbError | null };

// ── Utilidades ──────────────────────────────────────────────────────────────

// Lista de filas: una tabla que falta (script 26 sin correr) es una lista
// vacía; cualquier otro error es un corte de conexión
function list<T>(r: DbRes): T[] {
  if (r.error) {
    if (missingTable(r.error)) return [];
    throw new PortalError(503, OFFLINE);
  }
  return (r.data ?? []) as T[];
}

function one<T>(r: DbRes): T | null {
  if (r.error) {
    if (missingTable(r.error)) return null;
    throw new PortalError(503, OFFLINE);
  }
  return (r.data ?? null) as T | null;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function chunks<T>(xs: T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// Filas por id, de a IN_CHUNK ids por pedido
async function rowsByIds<T>(ctx: Ctx, table: string, cols: string, ids: string[]): Promise<T[]> {
  const want = uniq(ids);
  if (!want.length) return [];
  const parts = await Promise.all(chunks(want).map(async (part) => list<T>(await ctx.admin.from(table).select(cols).in("id", part))));
  return parts.flat();
}

const nonNull = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const newestFirst = (a: string, b: string) => ms(b) - ms(a);
const oldestFirst = (a: string, b: string) => ms(a) - ms(b);

// El mismo instante escrito igual o distinto ("…+00:00" y "…Z")
function sameInstant(a: unknown, b: string | null): boolean {
  if (typeof a !== "string" || !b) return false;
  return a === b || (Number.isFinite(ms(a)) && ms(a) === ms(b));
}

// Error con los datos que el panel usa para marcar el campo (code, field, index, terms)
type ErrExtra = {
  code?: PracticeErrorCode | "CONSENT" | "VERIFY" | "NOT_AVAILABLE";
  field?: string; index?: number; terms?: string[];
};
function fail(status: number, message: string, extra: ErrExtra = {}): PortalError {
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) as { code?: string };
  return new PortalError(status, message, clean);
}

const conflict = () => fail(409, PRACTICE_ERROR.conflict, { code: "CONFLICT" });

function badInput(r: { error: string; code: PracticeErrorCode; field?: string; index?: number; terms?: string[] }): PortalError {
  return fail(400, r.error, { code: r.code, field: r.field, index: r.index, terms: r.terms });
}

// Errores de la base (prefijos del script 26) como mensajes claros
function dbError(e: DbError, what: string): PortalError {
  const m = e.message ?? "";
  if (e.code === "23505" || /PUBLISH_CONFLICT/.test(m)) return conflict();
  if (/AI_NOT_REVIEWED/.test(m)) return fail(400, PRACTICE_ERROR.ai_not_reviewed, { code: "AI_NOT_REVIEWED" });
  if (/AI_DRAFT/.test(m)) return fail(400, AI_DRAFT_GONE, { code: "INVALID" });
  if (/PRACTICE_PLAN/.test(m)) {
    if (/1 a 8/.test(m)) return fail(400, PRACTICE_ERROR.exercises, { code: "EXERCISES" });
    if (/sesi[oó]n/.test(m)) return fail(400, PRACTICE_ERROR.approach_session, { code: "APPROACH" });
    return conflict();
  }
  // Antes que PRACTICE_GOAL (empiezan igual)
  if (/PRACTICE_GOAL_PLAN/.test(m)) return fail(409, GOAL_PLAN_CLOSED, { code: "CONFLICT" });
  if (/PRACTICE_GOAL_WITH_PLAN/.test(m)) return fail(409, GOAL_WITH_DRAFT, { code: "CONFLICT" });
  if (/PRACTICE_GOAL/.test(m)) return fail(409, PRACTICE_ERROR.goal_not_active, { code: "CONFLICT" });
  if (/PRACTICE_DATE/.test(m)) {
    return fail(400, /todav[ií]a no/.test(m) ? PRACTICE_ERROR.before_publish : PRACTICE_ERROR.date, { code: "DATE" });
  }
  if (/PRACTICE_LIMIT/.test(m)) return fail(429, PRACTICE_ERROR.limit, { code: "LIMIT" });
  if (/PRACTICE_LOG/.test(m)) return fail(409, PRACTICE_ERROR.gone);
  if (/PUBLISHED_FROZEN/.test(m)) return conflict();
  console.error(`[portal] práctica: no se pudo ${what}`, e.code ?? "");
  if (missingTable(e)) return fail(503, NOT_READY);
  return fail(503, SAVE_FAILED);
}

// Comienzo del día del centro como instante (para el límite diario)
export function centerDayStartIso(dateKey: string): string {
  // Argentina está en UTC−3 sin horario de verano; igual se corrige con la hora real del centro
  let t = Date.parse(`${dateKey}T03:00:00.000Z`);
  for (let i = 0; i < 2; i++) {
    const c = centerNow(new Date(t));
    const minutes = Number(c.time.slice(0, 2)) * 60 + Number(c.time.slice(3, 5)) + daysBetween(dateKey, c.date) * 1440;
    if (!minutes) break;
    t -= minutes * 60_000;
  }
  return new Date(t).toISOString();
}

function steps(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [];
}

function overrides(raw: unknown): LintOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((o): o is LintOverride => !!o && typeof o === "object" && Array.isArray((o as LintOverride).terms))
    .map((o) => ({ terms: o.terms.filter((t) => typeof t === "string"), reason: String(o.reason ?? ""), by_email: String(o.by_email ?? ""), at: String(o.at ?? "") }));
}

// "Lo dejo así": se conservan los motivos que siguen cubriendo algún aviso
// y, si quedan avisos sin cubrir y vino un motivo, se suma uno nuevo
function mergeOverrides(prev: unknown, alerts: string[], note: string | null, email: string, at: string): LintOverride[] {
  if (!alerts.length) return [];
  const kept = overrides(prev).filter((o) => o.terms.some((t) => alerts.includes(t)));
  const open = uncoveredAlerts(alerts, kept);
  if (open.length && note) kept.push({ terms: open, reason: note, by_email: email, at });
  return kept;
}

const exTexts = (e: Pick<ExRow, "title" | "para_que" | "pasos" | "materiales" | "for_adult" | "si_cuesta">) => ({
  title: e.title, para_que: e.para_que, pasos: steps(e.pasos), materiales: e.materiales, for_adult: e.for_adult, si_cuesta: e.si_cuesta,
});

const toDay = (l: Pick<LogRow, "practiced_on" | "exercise_key">): PracticeDay => ({ date: l.practiced_on, exercise_key: l.exercise_key });

// Deshacer: quien la anotó, el mismo día en que la anotó
const canUndo = (l: LogRow, accountId: string, today: string) => l.account_id === accountId && centerDateOf(l.created_at) === today;

// ── Lecturas comunes ────────────────────────────────────────────────────────

// Las versiones del plan de un paciente (pocas), de la más nueva a la más vieja
async function plansOf(ctx: Ctx, patientId: string): Promise<PlanRow[]> {
  return list<PlanRow>(await ctx.admin.from("patient_exercise_plans").select(PLAN_COLS).eq("patient_id", patientId)
    .order("version", { ascending: false }).limit(LIST_MAX))
    .sort((a, b) => b.version - a.version);
}

async function publishedPlan(ctx: Ctx, patientId: string): Promise<PlanRow | null> {
  return one<PlanRow>(await ctx.admin.from("patient_exercise_plans").select(PLAN_COLS)
    .eq("patient_id", patientId).eq("status", "publicado").maybeSingle());
}

// Los ejercicios de una versión del plan (hasta 8 activos y los quitados del
// borrador), en orden. Nunca los de todas las versiones juntas: crecen con
// cada versión que se publica.
async function exercisesOfPlan(ctx: Ctx, planId: string): Promise<ExRow[]> {
  return list<ExRow>(await ctx.admin.from("patient_exercises").select(EX_COLS).eq("plan_id", planId)
    .order("position", { ascending: true }).order("created_at", { ascending: true }).limit(LIST_MAX))
    .sort((a, b) => a.position - b.position);
}

// Las versiones de esos ejercicios (por exercise_key) en todos los planes del
// paciente: el primer día en que se publicó cada uno, su título más nuevo y
// el "Lo dejo así" anterior. Solo esas claves, de a IN_CHUNK por pedido y
// con tope; si un pedido llega al tope (claves con muchísimas versiones),
// esas claves se piden de a una (una fila por versión del plan).
type VersionRow = Pick<ExRow, "id" | "plan_id" | "exercise_key" | "title" | "lint_overrides">;
const VERSION_COLS = "id, plan_id, exercise_key, title, lint_overrides";
async function versionsOf(ctx: Ctx, patientId: string, keys: string[]): Promise<VersionRow[]> {
  const read = async (part: string[]) => list<VersionRow>(await ctx.admin.from("patient_exercises").select(VERSION_COLS)
    .eq("patient_id", patientId).in("exercise_key", part).order("created_at", { ascending: false }).limit(LIST_MAX));
  const parts = await Promise.all(chunks(uniq(keys)).map(async (part) => {
    const rows = await read(part);
    if (rows.length < LIST_MAX || part.length === 1) return rows;
    return (await Promise.all(part.map((key) => read([key])))).flat();
  }));
  return parts.flat();
}

// Prácticas vigentes (no deshechas) de esos pacientes desde una fecha (unos
// días: la semana, la grilla), de la más nueva a la más vieja
async function liveLogs(ctx: Ctx, patientIds: string[], from: string): Promise<LogRow[]> {
  if (!patientIds.length) return [];
  return list<LogRow>(await ctx.admin.from("exercise_practice_logs").select(LOG_COLS).in("patient_id", patientIds)
    .is("voided_at", null).gte("practiced_on", from).order("practiced_on", { ascending: false }).limit(LIST_MAX));
}

// Prácticas vigentes de un paciente para las medallas de constancia, de la
// más nueva a la más vieja (hasta LIST_MAX). Alcanza para que el cálculo dé
// lo mismo que con todas: las que se ganan una vez piden a lo sumo 50
// prácticas o 4 semanas con práctica, y las que se repiten miran los días
// que todavía se pueden anotar y la práctica anterior a una vuelta.
async function recentDays(ctx: Ctx, patientId: string): Promise<PracticeDay[]> {
  return list<{ practiced_on: string; exercise_key: string }>(await ctx.admin.from("exercise_practice_logs")
    .select("practiced_on, exercise_key").eq("patient_id", patientId).is("voided_at", null)
    .order("practiced_on", { ascending: false }).limit(LIST_MAX)).map(toDay);
}

const ONCE_CODES = CONSTANCY_MEDALS.filter((m) => !m.repeatable).map((m) => m.code);
const REPEAT_CODES = CONSTANCY_MEDALS.filter((m) => m.repeatable).map((m) => m.code);

// Medallas de constancia ya dadas (también las anuladas: no se vuelven a dar
// solas) que importan para calcular las nuevas: las que se ganan una vez
// (pocas) y las más nuevas de las que se repiten (semana cumplida, ¡de vuelta!)
async function constancyGiven(ctx: Ctx, patientId: string): Promise<{ code: string; period_key: string }[]> {
  const q = () => ctx.admin.from("patient_medals").select("code, period_key").eq("patient_id", patientId).eq("kind", "constancia");
  const [once, repeat] = await Promise.all([
    q().in("code", ONCE_CODES).limit(LIST_MAX),
    q().in("code", REPEAT_CODES).order("period_key", { ascending: false }).limit(REPEAT_MAX),
  ]);
  return [...list<{ code: string; period_key: string }>(once), ...list<{ code: string; period_key: string }>(repeat)];
}

// De a un paciente (las personas de una cuenta son pocas): el tope es por paciente
async function perPatient<T>(patientIds: string[], read: (id: string) => Promise<T[]>): Promise<T[]> {
  return (await Promise.all(uniq(patientIds).map(read))).flat();
}

async function feedbackRows(ctx: Ctx, patientIds: string[]): Promise<FbRow[]> {
  return (await perPatient(patientIds, async (id) => list<FbRow>(await ctx.admin.from("patient_practice_feedback")
    .select(FB_COLS).eq("patient_id", id).order("sent_at", { ascending: false }).limit(FEEDBACK_MAX))))
    .sort((a, b) => newestFirst(a.sent_at, b.sent_at));
}

async function goalRows(ctx: Ctx, patientIds: string[]): Promise<GoalRow[]> {
  return perPatient(patientIds, async (id) => list<GoalRow>(await ctx.admin.from("patient_goals")
    .select(GOAL_COLS).eq("patient_id", id).order("created_at", { ascending: false }).limit(GOALS_MAX)));
}

async function medalRows(ctx: Ctx, patientIds: string[], onlyLive = true): Promise<MedalRow[]> {
  return (await perPatient(patientIds, async (id) => {
    let q = ctx.admin.from("patient_medals").select(MEDAL_COLS).eq("patient_id", id);
    if (onlyLive) q = q.is("voided_at", null);
    return list<MedalRow>(await q.order("awarded_at", { ascending: false }).limit(MEDALS_MAX));
  })).sort((a, b) => newestFirst(a.awarded_at, b.awarded_at));
}

// Qué ya abrió esta cuenta (devoluciones o medallas), de a IN_CHUNK ids
async function seenBy(ctx: Ctx, accountId: string, action: string, ids: string[]): Promise<Set<string>> {
  const want = uniq(ids);
  if (!want.length) return new Set();
  const parts = await Promise.all(chunks(want).map(async (part) => list<{ target_id: string }>(
    await ctx.admin.from("portal_access_log").select("target_id")
      .eq("account_id", accountId).eq("action", action).in("target_id", part).limit(LIST_MAX))));
  return new Set(parts.flat().map((r) => r.target_id));
}

// Lo pendiente desde el último "Visto" (practice_pending, script 26): los
// pacientes con algo pendiente y los de patientIds; con only, solo los de
// patientIds (la ficha: no recorre a los demás pacientes). Sin el script 26: vacío.
async function pendingRows(ctx: Ctx, since: string | null, patientIds: string[], only = false): Promise<PendingRow[]> {
  return list<PendingRow>(await ctx.admin.rpc("practice_pending", { p_since: since, p_patients: patientIds, p_only: only }));
}

// Días con práctica de cada paciente desde una fecha (null: todos), con
// cuántas prácticas hubo cada día (practice_days, script 26)
type DaysRow = { days: string[]; counts: number[] };
async function practiceDays(ctx: Ctx, patientIds: string[], from: string | null): Promise<Map<string, DaysRow>> {
  if (!patientIds.length) return new Map();
  const rows = list<{ patient_id: string; days: string[] | null; counts: number[] | null }>(
    await ctx.admin.rpc("practice_days", { p_patients: uniq(patientIds), p_from: from }));
  return new Map(rows.map((r) => [r.patient_id, { days: r.days ?? [], counts: (r.counts ?? []).map(Number) }]));
}

const asDays = (d: DaysRow | undefined): PracticeDay[] => (d?.days ?? []).map((date) => ({ date, exercise_key: "" }));

// Primer día (del centro) en que se publicó ese ejercicio (por su exercise_key)
async function firstPublishedOn(ctx: Ctx, patientId: string, key: string): Promise<string | null> {
  const rows = await versionsOf(ctx, patientId, [key]);
  if (!rows.length) return null;
  const plans = await rowsByIds<{ id: string; published_at: string | null }>(
    ctx, "patient_exercise_plans", "id, published_at", rows.map((r) => r.plan_id));
  return plans.map((p) => p.published_at).filter(nonNull).map(centerDateOf).sort()[0] ?? null;
}

// first_published_on de cada exercise_key, con los planes y las versiones de esas claves
function firstPublishedMap(plans: PlanRow[], exs: Pick<ExRow, "plan_id" | "exercise_key">[]): Map<string, string> {
  const out = new Map<string, string>();
  const pub = new Map(plans.filter((p) => p.published_at).map((p) => [p.id, centerDateOf(p.published_at!)]));
  for (const e of exs) {
    const d = pub.get(e.plan_id);
    if (!d) continue;
    const prev = out.get(e.exercise_key);
    if (!prev || d < prev) out.set(e.exercise_key, d);
  }
  return out;
}

// ── Familia ─────────────────────────────────────────────────────────────────

type FamilyChild = { patient_id: string; display: string; self: boolean; age: number | null; dto: PracticeChildDTO };

// La persona es de esta cuenta (no como adulto autorizado) y la regla de
// acceso da "ok" para "practice"
async function familyGate(ctx: Ctx, account: Account, patientId: string, notFound = NOT_FOUND): Promise<FamilyChild> {
  if (!isUuid(patientId)) throw new PortalError(404, notFound);
  const children = await activeChildren(ctx, account);
  const child = children.find((c) => c.patient_id === patientId);
  if (!child || child.kind === "autorizado") throw new PortalError(404, notFound);
  const [clinical, p] = await Promise.all([
    childrenClinical(ctx, account),
    ctx.admin.from("patients").select("birth_date").eq("id", patientId).maybeSingle(),
  ]);
  const outcome = clinical.get(patientId)?.practice ?? "not_available";
  if (outcome === "consent") throw fail(403, CONSENT, { code: "CONSENT" });
  if (outcome === "verify") throw fail(403, VERIFY, { code: "VERIFY" });
  if (outcome !== "ok") throw fail(403, PRACTICE_TEXT.not_available, { code: "NOT_AVAILABLE" });
  if (p.error) throw new PortalError(503, OFFLINE);
  const birth = (p.data as { birth_date: string | null } | null)?.birth_date ?? null;
  const age = birth ? ageOn(birth, centerToday()) : null;
  return {
    patient_id: patientId, display: child.display, self: child.self, age,
    dto: { id: patientId, first_name: child.display, self: child.self, audience: audienceForAge(age) },
  };
}

// medals: las vigentes del paciente. Una lograda lleva la medalla que de
// verdad se dio por ella (no la que se había acordado); sin ninguna, null
function goalDto(g: GoalRow, medals: MedalRow[]): GoalDTO {
  const done = g.status === "lograda";
  const given = done ? medals.find((m) => m.kind === "profesional" && m.goal_id === g.id && !m.voided_at) ?? null : null;
  return {
    id: g.id, kind: g.kind, title: g.title, status: done ? "lograda" : "activa",
    achieved_at: done ? g.achieved_at : null, medal_title: done ? given?.title ?? null : g.medal_title,
  };
}

// Las metas que ve la familia: activas primero (de la más vieja a la más
// nueva) y después las logradas (la última primero). Nunca borradores ni
// "cambiada": al finalizar o retirar un plan, sus metas activas pasan a
// "cambiada" (las logradas quedan con su devolución)
function familyGoals(goals: GoalRow[], medals: MedalRow[]): GoalDTO[] {
  const active = goals.filter((g) => g.status === "activa")
    .sort((a, b) => oldestFirst(a.published_at ?? a.created_at, b.published_at ?? b.created_at));
  const done = goals.filter((g) => g.status === "lograda")
    .sort((a, b) => newestFirst(a.achieved_at ?? a.created_at, b.achieved_at ?? b.created_at));
  return [...active, ...done].map((g) => goalDto(g, medals));
}

function feedbackItem(f: FbRow, medals: MedalRow[], goals: GoalRow[], seen: Set<string>): FeedbackItemDTO {
  const medal = medals.find((m) => m.kind === "profesional" && m.feedback_id === f.id && !m.voided_at) ?? null;
  return {
    id: f.id, author_label: f.author_label, sent_at: f.sent_at, body: f.body, for_adult: f.for_adult,
    medal_title: medal?.title ?? null,
    goals_achieved: goals.filter((g) => g.feedback_id === f.id && g.status === "lograda").map((g) => g.title),
    is_new: !seen.has(f.id),
  };
}

// isNew: en un grupo, si esta cuenta todavía no vio alguna de sus medallas
function medalDto(m: MedalRow, fbs: FbRow[], goals: GoalRow[], seen: Set<string>, times = 1, isNew = !seen.has(m.id)): MedalDTO {
  const pro = m.kind === "profesional";
  return {
    id: m.id, kind: m.kind, code: m.code, title: m.title, awarded_at: m.awarded_at, times,
    by: pro ? fbs.find((f) => f.id === m.feedback_id)?.author_label ?? null : null,
    message: pro ? m.message : null,
    goal_title: pro && m.goal_id ? goals.find((g) => g.id === m.goal_id)?.title ?? null : null,
    is_new: isNew,
  };
}

// Las que se repiten (semana cumplida, ¡de vuelta!) van juntas: "Ganada 4
// veces". El grupo se nombra con la más nueva; medals_seen con su id marca
// todas las de ese paciente y código.
function groupMedals(medals: MedalRow[]): { newest: MedalRow; times: number; ids: string[] }[] {
  const groups = new Map<string, { newest: MedalRow; times: number; ids: string[] }>();
  for (const m of [...medals].sort((a, b) => newestFirst(a.awarded_at, b.awarded_at))) {
    const key = m.kind === "constancia" ? `c:${m.patient_id}:${m.code}` : `p:${m.id}`;
    const g = groups.get(key);
    if (g) {
      g.times++;
      g.ids.push(m.id);
    } else groups.set(key, { newest: m, times: 1, ids: [m.id] });
  }
  return [...groups.values()];
}

// Prioridad de la celebración: la más nueva; a la par, la del profesional y
// después las de constancia más grandes
function celebrationOrder(a: MedalRow, b: MedalRow): number {
  const rank = (m: MedalRow) => (m.kind === "profesional" ? 100 : CONSTANCY_CODES.indexOf(m.code as (typeof CONSTANCY_CODES)[number]));
  return newestFirst(a.awarded_at, b.awarded_at) || rank(b) - rank(a);
}

// Las del profesional se nombran de forma genérica (su título puede ser sensible)
function celebrationOf(m: MedalRow, who: { patient_id: string; display: string; self: boolean; age: number | null }, fbs: FbRow[]): CelebrationDTO {
  const pro = m.kind === "profesional";
  return {
    medal_id: m.id, patient_id: who.patient_id, first_name: who.display, self: who.self,
    audience: audienceForAge(who.age), kind: m.kind,
    title: pro ? null : m.title,
    by: pro ? fbs.find((f) => f.id === m.feedback_id)?.author_label ?? null : null,
  };
}

// Notas de ESTA cuenta sobre esas prácticas
async function myNotes(ctx: Ctx, accountId: string, logIds: string[]): Promise<Map<string, MyNoteDTO>> {
  const out = new Map<string, MyNoteDTO>();
  if (!logIds.length) return out;
  const rows = list<{ log_id: string; result: PracticeResult | null; comment: string | null }>(
    await ctx.admin.from("exercise_practice_notes").select("log_id, result, comment").eq("account_id", accountId).in("log_id", logIds));
  for (const r of rows) out.set(r.log_id, { result: r.result, comment: r.comment });
  return out;
}

// "Lic. … vio las prácticas el …": el nombre con que firmó quien marcó
// "Visto" (se guarda al marcarlo); nunca el de otra persona
function reviewedOf(plan: PlanRow | null): { by: string; on: string } | null {
  if (!plan?.last_reviewed_at) return null;
  return { by: plan.last_reviewed_label?.trim() || REVIEWER_FALLBACK, on: centerDateOf(plan.last_reviewed_at) };
}

// Registra que esta cuenta ya vio esas devoluciones o medallas (las que
// todavía no había visto)
async function insertSeen(ctx: Ctx, accountId: string, action: string, rows: { patient_id: string; id: string }[]) {
  const seen = await seenBy(ctx, accountId, action, rows.map((r) => r.id));
  const fresh = [...new Map(rows.filter((r) => !seen.has(r.id)).map((r) => [r.id, r])).values()];
  if (!fresh.length) return;
  const at = new Date().toISOString();
  const { error } = await ctx.admin.from("portal_access_log")
    .insert(fresh.map((r) => ({ patient_id: r.patient_id, account_id: accountId, action, target_id: r.id, at })));
  if (error) {
    console.error("[portal] práctica: no se pudo registrar una lectura", error.code ?? "");
    throw new PortalError(503, OFFLINE);
  }
}

// ids de "medals_seen" / "feedback_seen": hasta SEEN_MAX, todos válidos
function seenIds(body: Json): string[] {
  if (!Array.isArray(body.ids) || body.ids.length > SEEN_MAX || !body.ids.every(isUuid)) throw new PortalError(400, INVALID);
  return uniq(body.ids as string[]);
}

// GET ?view=plan — "Ejercicios de Martín"
export async function familyPractice(ctx: Ctx, account: Account, patientId: string): Promise<PracticeDTO> {
  const who = await familyGate(ctx, account, patientId);
  const today = centerToday();
  const plan = await publishedPlan(ctx, patientId);
  const [exercises, logs, goals, fbs, medals] = await Promise.all([
    plan ? exercisesOfPlan(ctx, plan.id) : Promise.resolve([] as ExRow[]),
    plan ? liveLogs(ctx, [patientId], weekKey(today)) : Promise.resolve([] as LogRow[]),
    goalRows(ctx, [patientId]),
    feedbackRows(ctx, [patientId]),
    medalRows(ctx, [patientId]),
  ]);
  const active = exercises.filter((e) => !e.removed_at);
  const todays = logs.filter((l) => l.practiced_on === today);
  const liveFb = fbs.filter((f) => !f.withdrawn_at);
  const [notes, fbSeen, medalSeen] = await Promise.all([
    myNotes(ctx, account.id, todays.map((l) => l.id)),
    seenBy(ctx, account.id, PRACTICE_ACCESS_ACTIONS.feedback, liveFb.map((f) => f.id)),
    seenBy(ctx, account.id, PRACTICE_ACCESS_ACTIONS.medal, medals.map((m) => m.id)),
  ]);
  const item = (e: ExRow): PracticeExerciseItemDTO => {
    const log = todays.find((l) => l.exercise_key === e.exercise_key) ?? null;
    return {
      id: e.id, title: e.title, minutes: e.minutes, with_adult: e.with_adult,
      done_today: !!log, log_id: log?.id ?? null, can_undo: !!log && canUndo(log, account.id, today),
      my_note: log ? notes.get(log.id) ?? null : null,
    };
  };
  return {
    child: who.dto,
    mode: plan ? SCREEN_MODE_BY_AUDIENCE[plan.audience] : screenMode(who.age),
    plan: plan ? {
      id: plan.id, title: plan.title, goal_text: plan.goal_text, author_label: plan.author_label ?? "",
      published_at: plan.published_at ?? plan.updated_at, days_per_week: plan.days_per_week,
      total_minutes: planSummary(active, plan.days_per_week, who.age).total_minutes,
    } : null,
    exercises: active.map(item),
    week: plan ? weekProgress(logs.map(toDay), plan.days_per_week, today) : null,
    goals: familyGoals(goals, medals),
    last_feedback: liveFb[0] ? feedbackItem(liveFb[0], medals, goals, fbSeen) : null,
    feedback_new: liveFb.filter((f) => !fbSeen.has(f.id)).length,
    recent_medals: medals.slice(0, RECENT_MEDALS).map((m) => medalDto(m, fbs, goals, medalSeen)),
    reviewed: reviewedOf(plan),
    on_break_until: plan && onBreak(plan.on_break_until, today) ? plan.on_break_until : null,
    adult_guide: uniq(active.map((e) => e.for_adult).filter((x): x is string => !!x)),
    celebration: medals.filter((m) => !medalSeen.has(m.id)).sort(celebrationOrder).map((m) => celebrationOf(m, who, fbs)),
  };
}

// El ejercicio de la versión publicada con esa identidad (exercise_key), si sigue en el plan
async function currentExercise(ctx: Ctx, patientId: string, key: string): Promise<{ plan: PlanRow; ex: ExRow } | null> {
  const plan = await publishedPlan(ctx, patientId);
  if (!plan) return null;
  const ex = one<ExRow>(await ctx.admin.from("patient_exercises").select(EX_COLS)
    .eq("plan_id", plan.id).eq("exercise_key", key).is("removed_at", null).maybeSingle());
  return ex ? { plan, ex } : null;
}

// Un id de ejercicio que llega de la familia: primero su paciente (y si la
// cuenta lo puede ver), después la versión publicada. Un ejercicio de una
// versión anterior que sigue en el plan se resuelve a la versión nueva.
async function resolveExercise(ctx: Ctx, account: Account, exerciseId: unknown) {
  if (!isUuid(exerciseId)) throw new PortalError(404, EXERCISE_NOT_FOUND);
  const row = one<ExRow>(await ctx.admin.from("patient_exercises").select(EX_COLS).eq("id", exerciseId).maybeSingle());
  if (!row) throw new PortalError(404, EXERCISE_NOT_FOUND);
  const who = await familyGate(ctx, account, row.patient_id, EXERCISE_NOT_FOUND);
  const cur = await currentExercise(ctx, row.patient_id, row.exercise_key);
  if (!cur) throw new PortalError(404, PRACTICE_ERROR.gone);
  return { who, ...cur };
}

async function exerciseDto(
  ctx: Ctx, account: Account, who: FamilyChild, plan: PlanRow, ex: ExRow, today: string, first?: string | null,
): Promise<PracticeExerciseDTO> {
  const firstOn = first === undefined ? await firstPublishedOn(ctx, ex.patient_id, ex.exercise_key) : first;
  const from = [weekKey(today), addDaysKey(today, -PRACTICE_BACKDAYS)].sort()[0];
  const logs = await liveLogs(ctx, [ex.patient_id], from);
  const dates = practiceDates(today, firstOn);
  const dayLogs = dates.map((d) => logs.find((l) => l.exercise_key === ex.exercise_key && l.practiced_on === d) ?? null);
  const notes = await myNotes(ctx, account.id, dayLogs.filter(nonNull).map((l) => l.id));
  const labels = ["hoy", "ayer", "anteayer"] as const;
  const days: PracticeDayDTO[] = dates.map((date, i) => {
    const l = dayLogs[i];
    return {
      date,
      label: labels[Math.min(2, Math.max(0, daysBetween(date, today)))],
      log: l ? { id: l.id, mine: l.account_id === account.id, can_undo: canUndo(l, account.id, today), my_note: notes.get(l.id) ?? null } : null,
    };
  });
  return {
    child: who.dto,
    mode: SCREEN_MODE_BY_AUDIENCE[plan.audience],
    plan_id: plan.id,
    author_label: plan.author_label ?? "",
    exercise: {
      id: ex.id, title: ex.title, para_que: ex.para_que, pasos: steps(ex.pasos), minutes: ex.minutes,
      materiales: ex.materiales, for_adult: ex.for_adult, si_cuesta: ex.si_cuesta, with_adult: ex.with_adult,
    },
    today,
    days,
    week: weekProgress(logs.map(toDay), plan.days_per_week, today),
    on_break_until: onBreak(plan.on_break_until, today) ? plan.on_break_until : null,
  };
}

// GET ?view=exercise — la pantalla de práctica
export async function familyExercise(ctx: Ctx, account: Account, exerciseId: string): Promise<PracticeExerciseDTO> {
  const { who, plan, ex } = await resolveExercise(ctx, account, exerciseId);
  return exerciseDto(ctx, account, who, plan, ex, centerToday());
}

// Medallas de constancia que ganó esta práctica (nunca hace fallar la
// práctica, que ya quedó anotada). Cuentan las prácticas vigentes y las
// medallas de constancia ya dadas, también las anuladas (recentDays y
// constancyGiven traen todo lo que el cálculo mira).
async function awardConstancy(ctx: Ctx, patientId: string, plan: PlanRow, today: string): Promise<MedalRow[]> {
  if (!plan.auto_medals || onBreak(plan.on_break_until, today)) return [];
  try {
    const [logs, given] = await Promise.all([recentDays(ctx, patientId), constancyGiven(ctx, patientId)]);
    const awards = constancyAwards({
      logs, days_per_week: plan.days_per_week, awarded: given, today,
      auto_medals: plan.auto_medals, on_break_until: plan.on_break_until,
    });
    const out: MedalRow[] = [];
    for (const a of awards) {
      const { data, error } = await ctx.admin.from("patient_medals").insert({
        patient_id: patientId, kind: "constancia", code: a.code, title: a.title, period_key: a.period_key, plan_id: plan.id,
      }).select(MEDAL_COLS).single();
      // Otra práctica a la vez ya la dio: no pasa nada
      if (error) {
        if (error.code !== "23505") console.error("[portal] práctica: no se pudo dar una medalla", error.code ?? "");
        continue;
      }
      out.push(data as MedalRow);
    }
    return out;
  } catch {
    console.error("[portal] práctica: no se pudieron calcular las medallas");
    return [];
  }
}

async function liveLogOn(ctx: Ctx, patientId: string, key: string, date: string): Promise<LogRow | null> {
  const rows = list<LogRow>(await ctx.admin.from("exercise_practice_logs").select(LOG_COLS)
    .eq("patient_id", patientId).eq("exercise_key", key).eq("practiced_on", date).is("voided_at", null));
  return rows[0] ?? null;
}

// POST { action: "log" } — "Ya lo hice". Una por ejercicio y por día: si ya
// estaba anotada (por esta cuenta o por otro adulto), devuelve esa.
export async function familyLog(ctx: Ctx, account: Account, body: Json): Promise<PracticeActionResult> {
  const { who, plan, ex } = await resolveExercise(ctx, account, body.exercise_id);
  const today = centerToday();
  const raw = body.practiced_on;
  const practicedOn = raw === undefined || raw === null || raw === "" ? today : String(raw);
  const first = await firstPublishedOn(ctx, ex.patient_id, ex.exercise_key);
  const problem = practiceDateProblem(practicedOn, today, first);
  if (problem) throw fail(400, problem, { code: "DATE" });

  let log = await liveLogOn(ctx, ex.patient_id, ex.exercise_key, practicedOn);
  let fresh = false;
  if (!log) {
    const { count, error } = await ctx.admin.from("exercise_practice_logs").select("id", { count: "exact", head: true })
      .eq("account_id", account.id).gte("created_at", centerDayStartIso(today));
    if (error) throw dbError(error, "anotar la práctica");
    if ((count ?? 0) >= PRACTICE_DAILY_MAX) throw fail(429, PRACTICE_ERROR.limit, { code: "LIMIT" });
    const ins = await ctx.admin.from("exercise_practice_logs").insert({
      patient_id: ex.patient_id, plan_id: plan.id, exercise_id: ex.id, exercise_key: ex.exercise_key,
      account_id: account.id, practiced_on: practicedOn,
    }).select(LOG_COLS).single();
    if (ins.error) {
      // Otro adulto la anotó en el mismo momento: vale la suya
      if (ins.error.code !== "23505") throw dbError(ins.error, "anotar la práctica");
      log = await liveLogOn(ctx, ex.patient_id, ex.exercise_key, practicedOn);
      if (!log) throw conflict();
    } else {
      log = ins.data as LogRow;
      fresh = true;
    }
  }
  const medals = fresh ? await awardConstancy(ctx, ex.patient_id, plan, today) : [];
  return {
    exercise: await exerciseDto(ctx, account, who, plan, ex, today, first),
    log_id: log.id,
    new_medals: medals.sort(celebrationOrder).map((m) => celebrationOf(m, who, [])),
  };
}

async function loadLog(ctx: Ctx, account: Account, logId: unknown): Promise<{ log: LogRow; who: FamilyChild }> {
  if (!isUuid(logId)) throw new PortalError(404, LOG_NOT_FOUND);
  const log = one<LogRow>(await ctx.admin.from("exercise_practice_logs").select(LOG_COLS).eq("id", logId).maybeSingle());
  if (!log) throw new PortalError(404, LOG_NOT_FOUND);
  const who = await familyGate(ctx, account, log.patient_id, LOG_NOT_FOUND);
  return { log, who };
}

// POST { action: "note" } — "¿Cómo te fue?" y el comentario. Una por cuenta
// y por práctica: las notas no cambian (409 si ya la dejó)
export async function familyNote(ctx: Ctx, account: Account, body: Json): Promise<PracticeActionResult> {
  const v = validateNote(body);
  if (!v.ok) throw badInput(v);
  const { log, who } = await loadLog(ctx, account, body.log_id);
  if (log.voided_at) throw fail(409, LOG_UNDONE);
  const cur = await currentExercise(ctx, log.patient_id, log.exercise_key);
  if (!cur) throw new PortalError(404, PRACTICE_ERROR.gone);
  const mine = (await myNotes(ctx, account.id, [log.id])).get(log.id);
  if (mine) throw fail(409, PRACTICE_ERROR.note_twice, { code: "CONFLICT" });
  const { error } = await ctx.admin.from("exercise_practice_notes").insert({
    log_id: log.id, patient_id: log.patient_id, account_id: account.id,
    result: v.value.result, comment: v.value.comment, risk_flag: v.value.risk,
  });
  if (error) {
    if (error.code === "23505") throw fail(409, PRACTICE_ERROR.note_twice, { code: "CONFLICT" });
    if (/PRACTICE_LOG/.test(error.message ?? "")) throw fail(409, LOG_UNDONE);
    throw dbError(error, "guardar cómo les fue");
  }
  return {
    exercise: await exerciseDto(ctx, account, who, cur.plan, cur.ex, centerToday()),
    log_id: log.id,
    new_medals: [],
  };
}

// POST { action: "undo" } — solo lo que anotó esta cuenta, el mismo día.
// Las medallas que ya se ganaron no se pierden.
export async function familyUndo(ctx: Ctx, account: Account, body: Json): Promise<PracticeActionResult> {
  const { log, who } = await loadLog(ctx, account, body.log_id);
  const today = centerToday();
  if (!canUndo(log, account.id, today)) throw fail(403, PRACTICE_ERROR.undo_only_mine);
  const cur = await currentExercise(ctx, log.patient_id, log.exercise_key);
  if (!cur) throw new PortalError(404, PRACTICE_ERROR.gone);
  if (!log.voided_at) {
    const { error } = await ctx.admin.from("exercise_practice_logs").update({ voided_at: new Date().toISOString() })
      .eq("id", log.id).is("voided_at", null);
    if (error) throw dbError(error, "deshacer la práctica");
  }
  return { exercise: await exerciseDto(ctx, account, who, cur.plan, cur.ex, today), log_id: null, new_medals: [] };
}

// GET ?view=feedback — las devoluciones. Solo lee: "Nueva" (is_new) es lo
// que esta cuenta todavía no vio; la página las marca después de mostrarlas
// con { action: "feedback_seen" } (así una segunda carga no las borra)
export async function familyFeedback(ctx: Ctx, account: Account, patientId: string): Promise<FeedbackDTO> {
  const who = await familyGate(ctx, account, patientId);
  const [fbs, medals, goals, plan] = await Promise.all([
    feedbackRows(ctx, [patientId]), medalRows(ctx, [patientId]), goalRows(ctx, [patientId]), publishedPlan(ctx, patientId),
  ]);
  const live = fbs.filter((f) => !f.withdrawn_at);
  const seen = await seenBy(ctx, account.id, PRACTICE_ACCESS_ACTIONS.feedback, live.map((f) => f.id));
  // has_plan: con un plan publicado se puede comentar al marcar un ejercicio
  return { child: who.dto, has_plan: !!plan, items: live.map((f) => feedbackItem(f, medals, goals, seen)) };
}

// POST { action: "feedback_seen", ids } — esta cuenta ya vio esas
// devoluciones. Solo cuentan las vigentes de personas que esta cuenta puede
// ver hoy; las demás se ignoran (sin decir por qué).
export async function familyFeedbackSeen(ctx: Ctx, account: Account, body: Json): Promise<{ ok: true }> {
  const ids = seenIds(body);
  if (!ids.length) return { ok: true };
  const [fbs, clinical] = await Promise.all([
    rowsByIds<{ id: string; patient_id: string; withdrawn_at: string | null }>(ctx, "patient_practice_feedback", "id, patient_id, withdrawn_at", ids),
    childrenClinical(ctx, account),
  ]);
  const ok = fbs.filter((f) => !f.withdrawn_at && clinical.get(f.patient_id)?.practice === "ok");
  await insertSeen(ctx, account.id, PRACTICE_ACCESS_ACTIONS.feedback, ok);
  return { ok: true };
}

// GET ?view=medals — "Medallas de Martín" / "Mis logros": las medallas, "Para
// seguir sumando" y las metas activas y logradas. Se puede ver sin plan
// publicado (lo que se ganó y se logró no se pierde al cerrarse un plan)
export async function familyMedals(ctx: Ctx, account: Account, patientId: string): Promise<MedalsDTO> {
  const who = await familyGate(ctx, account, patientId);
  const today = centerToday();
  const [plan, medals, goals, fbs] = await Promise.all([
    publishedPlan(ctx, patientId),
    medalRows(ctx, [patientId]),
    goalRows(ctx, [patientId]),
    feedbackRows(ctx, [patientId]),
  ]);
  const autoMedals = !!plan && plan.auto_medals;
  const [seen, logs, given] = await Promise.all([
    seenBy(ctx, account.id, PRACTICE_ACCESS_ACTIONS.medal, medals.map((m) => m.id)),
    autoMedals ? recentDays(ctx, patientId) : Promise.resolve([] as PracticeDay[]),
    autoMedals ? constancyGiven(ctx, patientId) : Promise.resolve([]),
  ]);
  return {
    child: who.dto,
    author_label: plan?.author_label ?? null,
    auto_medals: autoMedals,
    // Un grupo es nuevo si esta cuenta no vio alguna de sus medallas
    earned: groupMedals(medals).map((g) => medalDto(g.newest, fbs, goals, seen, g.times, g.ids.some((id) => !seen.has(id)))),
    next: plan && autoMedals ? constancyNext({
      logs, days_per_week: plan.days_per_week, awarded: given, today, auto_medals: true,
      on_break_until: plan.on_break_until,
    }) : [],
    goals: familyGoals(goals, medals),
    // Pausa de vacaciones vigente (la página muestra la vuelta en lugar de "Para seguir sumando")
    on_break_until: plan && onBreak(plan.on_break_until, today) ? plan.on_break_until : null,
  };
}

// POST { action: "medals_seen", ids } — la celebración ya se vio (por
// cuenta). Solo cuentan medallas vigentes de personas que esta cuenta puede
// ver hoy. Las de constancia se ven en grupo ("Semana cumplida ×3"): el id
// de una marca todas las de ese paciente y ese código que esta cuenta no vio.
export async function familyMedalsSeen(ctx: Ctx, account: Account, body: Json): Promise<{ ok: true }> {
  const ids = seenIds(body);
  if (!ids.length) return { ok: true };
  type SeenMedal = { id: string; patient_id: string; kind: MedalKind; code: string; voided_at: string | null };
  const SEEN_COLS = "id, patient_id, kind, code, voided_at";
  const [medals, clinical] = await Promise.all([
    rowsByIds<SeenMedal>(ctx, "patient_medals", SEEN_COLS, ids),
    childrenClinical(ctx, account),
  ]);
  const ok = medals.filter((m) => !m.voided_at && clinical.get(m.patient_id)?.practice === "ok");
  const groups = uniq(ok.filter((m) => m.kind === "constancia").map((m) => `${m.patient_id}|${m.code}`));
  const siblings = await Promise.all(groups.map(async (g) => {
    const [patientId, code] = g.split("|");
    return list<SeenMedal>(await ctx.admin.from("patient_medals").select(SEEN_COLS)
      .eq("patient_id", patientId).eq("kind", "constancia").eq("code", code).is("voided_at", null)
      .order("awarded_at", { ascending: false }).limit(MEDALS_MAX));
  }));
  await insertSeen(ctx, account.id, PRACTICE_ACCESS_ACTIONS.medal, [...ok, ...siblings.flat()]);
  return { ok: true };
}

// Si la persona tiene alguna meta que la familia ve (activa o lograda): una
// fila alcanza (de a un paciente, como el resto de las lecturas por persona)
async function goalsShown(ctx: Ctx, patientIds: string[]): Promise<Set<string>> {
  const rows = await perPatient(patientIds, async (id) => list<{ patient_id: string }>(await ctx.admin.from("patient_goals")
    .select("patient_id").eq("patient_id", id).in("status", ["activa", "lograda"]).limit(1)));
  return new Set(rows.map((r) => r.patient_id));
}

// Para /me: por persona con práctica "ok" (patientIds; quien llama ya pasó la
// regla de acceso: ver practiceHomeFor), lo que muestran los cuadraditos del
// Inicio y el botón Ejercicios, y la medalla nueva de más prioridad para el
// aviso del Inicio (las del profesional, sin su nombre). No muestra contenido
// clínico. null: no hay nada para ver (ni plan publicado, ni devoluciones,
// medallas o metas vigentes). has_plan: hay un plan publicado ("Ejercicios");
// sin plan, "Mis logros" igual se ve si hay algo de lo otro.
export async function practiceHome(
  ctx: Ctx, account: Account, children: ActiveChild[], patientIds: string[],
): Promise<{ home: Map<string, PracticeHomeDTO | null>; celebration: CelebrationDTO | null }> {
  const home = new Map<string, PracticeHomeDTO | null>();
  if (!patientIds.length) return { home, celebration: null };
  const today = centerToday();
  const [plansR, patientsR, logs, fbs, medals, withGoals] = await Promise.all([
    ctx.admin.from("patient_exercise_plans").select(PLAN_COLS).in("patient_id", patientIds).eq("status", "publicado"),
    ctx.admin.from("patients").select("id, birth_date").in("id", patientIds),
    liveLogs(ctx, patientIds, weekKey(today)),
    feedbackRows(ctx, patientIds),
    medalRows(ctx, patientIds),
    goalsShown(ctx, patientIds),
  ]);
  const plans = list<PlanRow>(plansR);
  const patients = list<{ id: string; birth_date: string | null }>(patientsR);
  const liveFb = fbs.filter((f) => !f.withdrawn_at);
  const [fbSeen, medalSeen] = await Promise.all([
    seenBy(ctx, account.id, PRACTICE_ACCESS_ACTIONS.feedback, liveFb.map((f) => f.id)),
    seenBy(ctx, account.id, PRACTICE_ACCESS_ACTIONS.medal, medals.map((m) => m.id)),
  ]);
  const ageOf = (id: string) => {
    const b = patients.find((p) => p.id === id)?.birth_date;
    return b ? ageOn(b, today) : null;
  };
  for (const id of patientIds) {
    const plan = plans.find((p) => p.patient_id === id) ?? null;
    const fb = liveFb.filter((f) => f.patient_id === id);
    // medalRows trae solo las vigentes (sin las anuladas)
    const own = medals.filter((m) => m.patient_id === id);
    if (!plan && !fb.length && !own.length && !withGoals.has(id)) {
      home.set(id, null);
      continue;
    }
    const age = ageOf(id);
    const week = plan ? weekProgress(logs.filter((l) => l.patient_id === id).map(toDay), plan.days_per_week, today) : null;
    home.set(id, {
      mode: plan ? SCREEN_MODE_BY_AUDIENCE[plan.audience] : screenMode(age),
      audience: audienceForAge(age),
      has_plan: !!plan,
      week: week ? { count: week.count, target: week.target } : null,
      on_break_until: plan && onBreak(plan.on_break_until, today) ? plan.on_break_until : null,
      feedback_new: fb.filter((f) => !fbSeen.has(f.id)).length,
      medals_new: own.filter((m) => !medalSeen.has(m.id)).length,
    });
  }
  const top = medals.filter((m) => !medalSeen.has(m.id)).sort(celebrationOrder)[0];
  const child = top ? children.find((c) => c.patient_id === top.patient_id) : undefined;
  const celebration = top && child
    ? celebrationOf(top, { patient_id: child.patient_id, display: child.display, self: child.self, age: ageOf(child.patient_id) }, fbs)
    : null;
  return { home, celebration };
}

// /me: practiceHome solo para las personas que esta cuenta puede ver hoy
// (perChild: childrenClinical) con la práctica en "ok" y que no son de un
// adulto autorizado. Las demás no llevan nada (ni null ni el motivo): la
// familia solo ve el resultado público de la regla de acceso.
export async function practiceHomeFor(
  ctx: Ctx, account: Account, children: ActiveChild[], perChild: Map<string, ChildClinicalDTO>,
): Promise<{ home: Map<string, PracticeHomeDTO | null>; celebration: CelebrationDTO | null }> {
  const ids = children
    .filter((c) => c.kind !== "autorizado" && perChild.get(c.patient_id)?.practice === "ok")
    .map((c) => c.patient_id);
  return practiceHome(ctx, account, children, uniq(ids));
}

// ── Equipo ──────────────────────────────────────────────────────────────────

function clinicalOnly(staff: Staff) {
  if (!staff.clinical) throw fail(403, PRACTICE_ERROR.clinical_only);
}

// Con qué nombre se publica: el profesional vinculado al usuario (con
// matrícula) o, para la Dirección sin profesional vinculado, "Dirección del CIMT"
async function authorOf(ctx: Ctx, staff: Staff): Promise<{ professional_id: string | null; label: string | null; problem: string | null }> {
  if (!staff.clinical) return { professional_id: null, label: null, problem: STAFF_PRACTICE_TEXT.admin_readonly };
  const { data: pro, error } = await ctx.admin.from("professionals")
    .select("id, name, license").eq("user_id", staff.user_id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!pro) {
    if (staff.role === "direccion") return { professional_id: null, label: DIRECCION_LABEL, problem: null };
    return { professional_id: null, label: null, problem: PRACTICE_ERROR.not_linked };
  }
  const license = String(pro.license ?? "").trim();
  if (!license) return { professional_id: pro.id as string, label: null, problem: PRACTICE_ERROR.no_license };
  return { professional_id: pro.id as string, label: `${pro.name} · MP ${license}`, problem: null };
}

async function requireAuthor(ctx: Ctx, staff: Staff) {
  const author = await authorOf(ctx, staff);
  if (author.problem || !author.label) throw fail(403, author.problem ?? PRACTICE_ERROR.not_linked, { code: "AUTHOR" });
  return author as { professional_id: string | null; label: string; problem: null };
}

type PatientRow = { id: string; first_name: string; birth_date: string | null; diagnosis_code: string | null } & Record<string, unknown>;

async function patientOf(ctx: Ctx, patientId: string): Promise<PatientRow & { age: number | null }> {
  // Con lo que hace falta para sugerir los ejercicios (practiceSuggest.ts)
  const { data, error } = await ctx.admin.from("patients")
    .select(`id, first_name, birth_date, diagnosis_code, ${PROFILE_COLUMNS}`).eq("id", patientId).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!data) throw new PortalError(404, PATIENT_NOT_FOUND);
  const p = data as PatientRow;
  return { ...p, age: p.birth_date ? ageOn(p.birth_date, centerToday()) : null };
}

const lastReviewedOf = (plans: PlanRow[]): string | null =>
  plans.map((p) => p.last_reviewed_at).filter(nonNull).sort(newestFirst)[0] ?? null;

// Dónde se guarda el "Visto": el plan publicado o, si ya no hay (finalizado
// o retirado), el último que se publicó. Así lo que quedó sin ver de un plan
// cerrado también se puede marcar como visto. null: nunca se publicó nada.
function reviewTarget(plans: PlanRow[]): PlanRow | null {
  return plans.find((p) => p.status === "publicado")
    ?? plans.filter((p) => p.published_at).sort((a, b) => b.version - a.version)[0]
    ?? null;
}

// Lo nuevo desde el último "Visto" o devolución, a partir de lo que contó la
// base (practice_pending). since: la práctica pendiente más vieja (o el día
// del comentario); stale: 7 días o más y sin pausa. Sin fila: nada pendiente.
// noNotes: Administración (ve cuántas prácticas, no los comentarios)
export function pendingOf(
  row: Pick<PendingRow, "logs" | "first_log" | "comments" | "costo" | "risk" | "first_note"> | null | undefined,
  onBreakNow: boolean, today: string, noNotes = false,
): StaffPracticePending {
  const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const logs = n(row?.logs);
  const notes = noNotes || !row ? null : row;
  const since = [logs ? row?.first_log ?? null : null, notes?.first_note ? centerDateOf(notes.first_note) : null]
    .filter(nonNull).sort()[0] ?? null;
  return {
    logs,
    comments: n(notes?.comments),
    costo: n(notes?.costo),
    risk: n(notes?.risk),
    since,
    stale: !!since && daysBetween(since, today) >= REVIEW_STALE_DAYS && !onBreakNow,
  };
}

function publishCheckOf(p: PlanRow, exs: ExRow[]): PublishCheck {
  return {
    title: p.title, goal_text: p.goal_text, lint_overrides: overrides(p.lint_overrides),
    exercises: exs.map((e) => ({
      ...exTexts(e), approach: e.approach, practiced_in_session: e.practiced_in_session, ai_drafted: e.ai_drafted,
      reviewed: !!e.reviewed_at, removed: !!e.removed_at, lint_overrides: overrides(e.lint_overrides),
    })),
  };
}

function staffExercise(e: ExRow, firstPub: Map<string, string>): StaffExerciseDTO {
  const ratio = e.edit_ratio === null || e.edit_ratio === undefined ? null : Number(e.edit_ratio);
  return {
    id: e.id, exercise_key: e.exercise_key, position: e.position, source: e.source, catalog_id: e.catalog_id,
    catalog_version: e.catalog_version, approach: e.approach, practiced_in_session: e.practiced_in_session,
    title: e.title, para_que: e.para_que, pasos: steps(e.pasos), minutes: e.minutes, materiales: e.materiales,
    for_adult: e.for_adult, si_cuesta: e.si_cuesta, with_adult: e.with_adult, ai_drafted: e.ai_drafted,
    ai_draft_id: e.ai_draft_id, reviewed_at: e.reviewed_at, reviewed_by_email: e.reviewed_by_email,
    edit_ratio: Number.isFinite(ratio) ? ratio : null, alerts: exerciseTextAlerts(exTexts(e), e.approach),
    lint_overrides: overrides(e.lint_overrides), removed_at: e.removed_at,
    first_published_on: firstPub.get(e.exercise_key) ?? null,
  };
}

function staffPlan(
  p: PlanRow, exs: ExRow[], o: { admin: boolean; age: number | null; code: string | null; firstPub: Map<string, string> },
): StaffPlanDTO {
  const mine = exs.filter((e) => e.plan_id === p.id).sort((a, b) => a.position - b.position);
  const active = mine.filter((e) => !e.removed_at);
  const sum = planSummary(active, p.days_per_week, o.age);
  // Lo que falta para publicar ("Lo conversé con …" se pide al publicar)
  const problem = p.status === "borrador"
    ? publishProblem(publishCheckOf(p, mine), { age: o.age, diagnosis_code: o.code, adolescent_ack: true })?.error ?? null
    : null;
  return {
    id: p.id, version: p.version, status: p.status,
    title: o.admin ? null : p.title, goal_text: o.admin ? null : p.goal_text,
    audience: p.audience, mode: SCREEN_MODE_BY_AUDIENCE[p.audience], days_per_week: p.days_per_week,
    review_on: p.review_on, on_break_until: p.on_break_until, auto_medals: p.auto_medals,
    professional_id: p.professional_id, author_label: p.author_label, adolescent_ack: p.adolescent_ack,
    supersedes_id: p.supersedes_id, created_by_email: p.created_by_email, created_at: p.created_at,
    updated_at: p.updated_at, updated_by_email: p.updated_by_email, published_at: p.published_at,
    published_by_email: p.published_by_email, closed_at: p.closed_at, closed_by_email: p.closed_by_email,
    close_reason: p.close_reason, last_reviewed_at: p.last_reviewed_at, last_reviewed_by_email: p.last_reviewed_by_email,
    lint_overrides: o.admin ? [] : overrides(p.lint_overrides),
    exercises: o.admin ? [] : mine.map((e) => staffExercise(e, o.firstPub)),
    exercise_count: active.length, total_minutes: sum.total_minutes, summary_line: sum.line,
    minutes_warning: sum.warning, publish_problem: problem,
  };
}

// La versión publicada y las que reemplazó (para "Desde el … anotaron …")
function lineage(published: PlanRow, plans: PlanRow[]): PlanRow[] {
  const out: PlanRow[] = [];
  const seen = new Set<string>();
  for (let p: PlanRow | undefined = published; p && !seen.has(p.id); p = plans.find((x) => x.id === p!.supersedes_id)) {
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

// Comentarios de la familia para la ficha: los NOTES_MAX más nuevos y,
// además, todos los de riesgo sin ver (que nunca quedan afuera)
async function staffNotes(ctx: Ctx, patientId: string, lastReviewed: string | null): Promise<NoteRow[]> {
  let risky = ctx.admin.from("exercise_practice_notes").select(NOTE_COLS).eq("patient_id", patientId).eq("risk_flag", true);
  if (lastReviewed) risky = risky.gt("created_at", lastReviewed);
  const [recent, risk] = await Promise.all([
    ctx.admin.from("exercise_practice_notes").select(NOTE_COLS).eq("patient_id", patientId)
      .order("created_at", { ascending: false }).limit(NOTES_MAX),
    risky.order("created_at", { ascending: false }).limit(LIST_MAX),
  ]);
  return [...new Map([...list<NoteRow>(recent), ...list<NoteRow>(risk)].map((n) => [n.id, n])).values()];
}

// Notas de esas prácticas (las de la grilla), de a IN_CHUNK
async function notesOfLogs(ctx: Ctx, logIds: string[]): Promise<NoteRow[]> {
  const parts = await Promise.all(chunks(uniq(logIds)).map(async (part) => list<NoteRow>(
    await ctx.admin.from("exercise_practice_notes").select(NOTE_COLS).in("log_id", part).limit(LIST_MAX))));
  return parts.flat();
}

// La sección "Portal del paciente" → ejercicios (StaffPracticeDTO).
// Administración: sin textos clínicos ni comentarios. Lo que crece con el
// uso se lee acotado: la grilla (14 días), los comentarios (los más nuevos
// y todos los de riesgo sin ver), las lecturas de la familia (las más
// nuevas), los ejercicios (los del publicado y del borrador, y de los que
// se muestran, sus otras versiones); lo pendiente, el resumen y el
// progreso de las metas los cuenta la base.
export async function staffPractice(ctx: Ctx, staff: Staff, patientId: string, opts: { catalog?: boolean } = {}): Promise<StaffPracticeDTO> {
  const admin = !staff.clinical;
  const today = centerToday();
  const dates = Array.from({ length: GRID_DAYS }, (_, i) => addDaysKey(today, i - GRID_DAYS + 1));
  const [patient, access, author, plans, gridR, fbs, goals, medals, readsR, linksR, guardiansR] = await Promise.all([
    patientOf(ctx, patientId),
    staffClinical(ctx, patientId, staff.clinical),
    authorOf(ctx, staff),
    plansOf(ctx, patientId),
    liveLogs(ctx, [patientId], dates[0]),
    feedbackRows(ctx, [patientId]),
    goalRows(ctx, [patientId]),
    medalRows(ctx, [patientId], false),
    ctx.admin.from("portal_access_log").select("action, target_id, account_id, at").eq("patient_id", patientId)
      .in("action", [PRACTICE_ACCESS_ACTIONS.feedback, PRACTICE_ACCESS_ACTIONS.medal])
      .order("at", { ascending: false }).limit(LIST_MAX),
    ctx.admin.from("portal_links").select("account_id, guardian_id, relationship_kind").eq("patient_id", patientId),
    ctx.admin.from("patient_guardians").select("id, relationship").eq("patient_id", patientId),
  ]);
  const lastReviewed = lastReviewedOf(plans);
  const published = plans.find((p) => p.status === "publicado") ?? null;
  const draft = plans.find((p) => p.status === "borrador") ?? null;

  // Resumen desde la primera publicación del plan vigente (sin plan: todo) y
  // progreso de las metas de práctica activas desde que se publicaron
  const since = published
    ? lineage(published, plans).map((p) => p.published_at).filter(nonNull).map(centerDateOf).sort()[0] ?? null
    : null;
  const goalStarts = goals.filter((g) => g.kind === "practica" && g.status === "activa" && g.rule && g.published_at)
    .map((g) => centerDateOf(g.published_at!));
  const daysFrom = since ? [since, ...goalStarts].sort()[0] : null;

  const gridLogs = gridR.filter((l) => l.practiced_on <= today);
  const [pendingR, daysR, listed, gridNotes, publishedExs, draftExs] = await Promise.all([
    // Solo este paciente (no recorre lo pendiente de los demás)
    pendingRows(ctx, null, [patientId], true),
    practiceDays(ctx, [patientId], daysFrom),
    admin ? Promise.resolve([] as NoteRow[]) : staffNotes(ctx, patientId, lastReviewed),
    admin ? Promise.resolve([] as NoteRow[]) : notesOfLogs(ctx, gridLogs.map((l) => l.id)),
    // Los ejercicios del publicado y del borrador (Administración no ve el borrador)
    published ? exercisesOfPlan(ctx, published.id) : Promise.resolve([] as ExRow[]),
    draft && !admin ? exercisesOfPlan(ctx, draft.id) : Promise.resolve([] as ExRow[]),
  ]);
  const exs = [...publishedExs, ...draftExs];
  const notes = [...new Map([...listed, ...gridNotes].map((n) => [n.id, n])).values()];
  const gridIds = new Set(gridLogs.map((l) => l.id));
  const reads = list<{ action: string; target_id: string | null; account_id: string | null; at: string }>(readsR)
    .sort((a, b) => oldestFirst(a.at, b.at));
  const links = list<{ account_id: string | null; guardian_id: string | null; relationship_kind: string }>(linksR);
  const guardians = list<{ id: string; relationship: string | null }>(guardiansR);

  // Las prácticas de los comentarios que no están en la grilla (más viejas o
  // deshechas) y los nombres de la familia: "María López (madre)"
  const accIds = uniq([...gridLogs.map((l) => l.account_id), ...notes.map((n) => n.account_id), ...reads.map((r) => r.account_id)].filter(nonNull));
  const [otherLogs, accs] = await Promise.all([
    rowsByIds<LogRow>(ctx, "exercise_practice_logs", LOG_COLS, listed.map((n) => n.log_id).filter((id) => !gridIds.has(id))),
    rowsByIds<{ id: string; first_name: string; last_name: string }>(ctx, "portal_accounts", "id, first_name, last_name", accIds),
  ]);
  // Las otras versiones de los ejercicios que se muestran (el plan, el
  // borrador, la grilla y los comentarios): el primer día en que se publicó
  // cada uno y su título más nuevo. Administración no ve ni ejercicios ni títulos.
  const versions = admin ? [] : await versionsOf(ctx, patientId, [...exs, ...gridLogs, ...otherLogs].map((x) => x.exercise_key));
  const nameOf = (id: string | null) => {
    const a = id ? accs.find((x) => x.id === id) : undefined;
    return a ? `${a.first_name} ${a.last_name}`.trim() : null;
  };
  const whoOf = (id: string | null) => {
    const name = nameOf(id);
    if (!name) return null;
    const link = links.find((l) => l.account_id === id && l.guardian_id);
    const rel = link ? guardians.find((g) => g.id === link.guardian_id)?.relationship?.trim() : null;
    return rel ? `${name} (${rel.toLowerCase()})` : name;
  };
  const readsOf = (action: string, id: string) => {
    const out: { name: string; at: string }[] = [];
    for (const r of reads) {
      if (r.action !== action || r.target_id !== id) continue;
      const name = nameOf(r.account_id) ?? "Una cuenta que ya no existe";
      if (!out.some((x) => x.name === name)) out.push({ name, at: r.at });
    }
    return out;
  };

  const { age } = patient;
  const code = patient.diagnosis_code;
  const self = age !== null && age >= ADULT_FROM;
  const firstPub = firstPublishedMap(plans, versions);
  const planOpts = { admin, age, code, firstPub };
  const breakNow = !!published && onBreak(published.on_break_until, today);

  // Títulos: los de la versión más nueva de cada ejercicio
  const versionOf = new Map(plans.map((p) => [p.id, p.version]));
  const titleOf = (key: string) => versions.filter((e) => e.exercise_key === key)
    .sort((a, b) => (versionOf.get(b.plan_id) ?? 0) - (versionOf.get(a.plan_id) ?? 0))[0]?.title ?? null;

  // Grilla de los últimos 14 días
  const inWindow = gridLogs;
  const currentKeys = published
    ? exs.filter((e) => e.plan_id === published.id && !e.removed_at).sort((a, b) => a.position - b.position).map((e) => e.exercise_key)
    : [];
  const otherKeys = uniq([...inWindow].sort((a, b) => b.practiced_on.localeCompare(a.practiced_on))
    .map((l) => l.exercise_key).filter((k) => !currentKeys.includes(k)));
  const grid: StaffPracticeGrid = {
    dates,
    rows: [...currentKeys, ...otherKeys].map((key) => ({
      exercise_key: key,
      title: admin ? null : titleOf(key),
      current: currentKeys.includes(key),
      cells: dates.map((d) => {
        const l = inWindow.find((x) => x.exercise_key === key && x.practiced_on === d);
        if (!l) return null;
        return {
          log_id: l.id,
          logged_by: whoOf(l.account_id),
          results: admin ? [] : notes.filter((n) => n.log_id === l.id).sort((a, b) => oldestFirst(a.created_at, b.created_at))
            .map((n) => ({ who: whoOf(n.account_id) ?? GONE_ACCOUNT, result: n.result, comment: !!n.comment, risk: n.risk_flag })),
        };
      }),
    })),
  };

  // Comentarios de la familia: los de riesgo sin revisar primero ("Revisar
  // hoy"), después del más nuevo al más viejo
  const logById = new Map([...gridLogs, ...otherLogs].map((l) => [l.id, l]));
  const exById = new Map<string, { title: string }>([...versions, ...exs].map((e) => [e.id, e]));
  const notesOut: StaffNoteDTO[] = admin ? [] : listed.map((n) => {
    const l = logById.get(n.log_id);
    return {
      id: n.id, log_id: n.log_id,
      practiced_on: l?.practiced_on ?? centerDateOf(n.created_at),
      exercise_title: (l ? exById.get(l.exercise_id)?.title ?? titleOf(l.exercise_key) : null) ?? "",
      who: whoOf(n.account_id) ?? GONE_ACCOUNT,
      result: n.result, comment: n.comment, risk: n.risk_flag, created_at: n.created_at,
      is_new: !lastReviewed || ms(n.created_at) > ms(lastReviewed),
      log_undone: !!l?.voided_at,
    };
  }).sort((a, b) => Number(b.risk && b.is_new) - Number(a.risk && a.is_new) || newestFirst(a.created_at, b.created_at));

  // Administración ve cuántas prácticas, no los comentarios ni cómo les fue
  const pending = pendingOf(pendingR.find((r) => r.patient_id === patientId), breakNow, today, admin);

  // Resumen (desde la primera publicación del plan vigente)
  const practiced = daysR.get(patientId) ?? { days: [], counts: [] };
  const counted = practiced.days.map((d, i) => ({ d, n: practiced.counts[i] ?? 0 })).filter((x) => !since || x.d >= since);
  const summaryBase = {
    since, logs: counted.reduce((s, x) => s + x.n, 0), days: counted.length, last: counted[counted.length - 1]?.d ?? null,
  };

  // Metas, con el progreso de las de práctica activas
  const liveDays = asDays(practiced);
  const goalsOut: StaffGoalDTO[] = [...goals].sort((a, b) => newestFirst(a.created_at, b.created_at)).map((g) => ({
    id: g.id, plan_id: g.plan_id, kind: g.kind,
    title: admin ? null : g.title, rule: g.rule, medal_title: admin ? null : g.medal_title,
    agreed_with_patient: g.agreed_with_patient, status: g.status, created_at: g.created_at,
    created_by_email: g.created_by_email, published_at: g.published_at, achieved_at: g.achieved_at,
    feedback_id: g.feedback_id, changed_at: g.changed_at, changed_by_email: g.changed_by_email,
    progress: g.kind === "practica" && g.status === "activa" && g.rule && g.published_at
      ? goalProgress({ kind: g.kind, rule: g.rule, start: centerDateOf(g.published_at) }, liveDays, today)
      : null,
    met_dismissed: !!g.met_notice_dismissed_at,
  }));

  const medalsOut: StaffMedalDTO[] = medals.map((m) => ({
    id: m.id, kind: m.kind, code: m.code,
    title: admin && m.kind === "profesional" ? null : m.title,
    period_key: m.period_key, plan_id: m.plan_id, goal_id: m.goal_id, feedback_id: m.feedback_id,
    message: admin ? null : m.message, awarded_at: m.awarded_at, awarded_by_email: m.awarded_by_email,
    // El motivo es texto libre (puede nombrar algo clínico): Administración ve que se anuló, no por qué
    voided_at: m.voided_at, voided_by_email: m.voided_by_email, void_reason: admin ? null : m.void_reason,
    seen_by: readsOf(PRACTICE_ACCESS_ACTIONS.medal, m.id),
  }));

  const feedbackOut: StaffFeedbackDTO[] = fbs.map((f) => {
    const medal = medals.find((m) => m.kind === "profesional" && m.feedback_id === f.id) ?? null;
    return {
      id: f.id, plan_id: f.plan_id, author_label: f.author_label,
      body: admin ? null : f.body, for_adult: admin ? null : f.for_adult,
      period_start: f.period_start, period_end: f.period_end, adolescent_ack: f.adolescent_ack,
      review_note: admin ? null : f.review_note, sent_at: f.sent_at, sent_by_email: f.sent_by_email,
      withdrawn_at: f.withdrawn_at, withdrawn_by_email: f.withdrawn_by_email, withdraw_reason: f.withdraw_reason,
      reads: readsOf(PRACTICE_ACCESS_ACTIONS.feedback, f.id),
      medal: medal ? { id: medal.id, title: admin ? null : medal.title } : null,
      goals: goals.filter((g) => g.feedback_id === f.id).map((g) => ({ id: g.id, title: admin ? null : g.title })),
      can_withdraw: staff.clinical && !f.withdrawn_at && (staff.role === "direccion" || f.sent_by_email === staff.email),
    };
  });

  const readers = access.accesses.filter((a) => a.practice_block === null)
    .map((a) => (a.relationship ? `${a.name} (${a.relationship.trim().toLowerCase()})` : a.name));

  return {
    features: { ai: features().includes("ai") && !!draftApiKey(process.env) },
    can_edit: staff.clinical,
    author: { label: author.label, problem: author.problem },
    patient: {
      id: patient.id, first_name: patient.first_name, self, age, audience: audienceForAge(age), adolescent: isAdolescent(age),
    },
    approaches: admin ? [] : approachOptions(code, age),
    suggestions: admin ? null : suggestPractice(profileFromRow(patient, age, code)),
    practice_enabled: access.settings.practice_enabled,
    readers,
    readers_line: readersLine(readers, { first_name: patient.first_name, self }),
    published: published ? staffPlan(published, exs, planOpts) : null,
    draft: draft && !admin ? staffPlan(draft, exs, planOpts) : null,
    history: plans.filter((p) => p.status !== "publicado" && p.status !== "borrador").map((p): StaffPlanVersion => ({
      id: p.id, version: p.version, status: p.status, author_label: p.author_label, published_at: p.published_at,
      published_by_email: p.published_by_email, closed_at: p.closed_at, close_reason: p.close_reason,
    })),
    summary: { ...summaryBase, text: practiceSummaryText(summaryBase, today) },
    grid,
    notes: notesOut,
    pending,
    goals: goalsOut,
    goals_met: goalsOut.filter((g) => g.status === "activa" && g.progress?.met && g.progress.met_on && !g.met_dismissed)
      .map((g) => ({ goal_id: g.id, title: g.title, met_on: g.progress!.met_on! })),
    medals: medalsOut,
    feedback: feedbackOut,
    catalog_version: CATALOG_VERSION,
    catalog: opts.catalog && !admin ? catalogFor(approachesForDiagnosis(code), age) : null,
  };
}

// ── Equipo: escrituras ──────────────────────────────────────────────────────

// "Guardar borrador": crea el borrador (versión siguiente del publicado, si
// hay) o lo actualiza si nadie lo cambió mientras tanto (expected_updated_at).
// Nunca bloquea por el texto del profesional: los avisos quedan en
// "alerts" y "publish_problem" hasta que se corrijan o tengan "Lo dejo así".
async function saveDraft(ctx: Ctx, staff: Staff, patientId: string, body: Json) {
  clinicalOnly(staff);
  const v = validatePlanDraft(body.plan);
  if (!v.ok) throw badInput(v);
  const input = v.value;
  const expected = body.expected_updated_at ?? null;
  if (expected !== null && typeof expected !== "string") throw new PortalError(400, INVALID);
  const patient = await patientOf(ctx, patientId);
  // Enfoques que nunca se podrían publicar para este paciente (la casilla de
  // sesión se pide al publicar)
  const offered = new Set(approachesForDiagnosis(patient.diagnosis_code));
  for (let i = 0; i < input.exercises.length; i++) {
    const e = input.exercises[i];
    if (e.source !== "manual" && !catalogEntry(e.catalog_id ?? "")) throw fail(400, NOT_IN_CATALOG, { code: "INVALID", field: "catalog_id", index: i });
    if (e.removed) continue;
    if (!offered.has(e.approach) || !approachAgeOk(e.approach, patient.age)) {
      throw fail(400, PRACTICE_ERROR.approach, { code: "APPROACH", field: "approach", index: i });
    }
  }

  // Los ejercicios del borrador que se edita (se usan después de confirmar
  // que es el borrador de este paciente) y las versiones de los que vuelven
  // de otra versión (exercise_key): que sean de este paciente y su "Lo dejo así"
  const [plans, editedRows, versions] = await Promise.all([
    plansOf(ctx, patientId),
    input.id ? exercisesOfPlan(ctx, input.id) : Promise.resolve([] as ExRow[]),
    versionsOf(ctx, patientId, input.exercises.map((e) => e.exercise_key).filter(nonNull)),
  ]);
  const draft = plans.find((p) => p.status === "borrador") ?? null;
  const published = plans.find((p) => p.status === "publicado") ?? null;
  const now = new Date().toISOString();
  const planFields = {
    title: input.title, goal_text: input.goal_text, audience: input.audience, days_per_week: input.days_per_week,
    review_on: input.review_on, auto_medals: input.auto_medals,
    lint_overrides: mergeOverrides((draft ?? published)?.lint_overrides, planTextAlerts(input), input.review_note, staff.email, now),
    updated_by_email: staff.email,
  };

  let planId: string;
  if (input.id) {
    if (!draft || draft.id !== input.id || !sameInstant(expected, draft.updated_at)) throw conflict();
    const r = await ctx.admin.from("patient_exercise_plans").update({ ...planFields, updated_at: now })
      .eq("id", draft.id).eq("status", "borrador").eq("updated_at", draft.updated_at).select("id");
    if (r.error) throw dbError(r.error, "guardar el borrador");
    if (!(r.data as unknown[] | null)?.length) throw conflict();
    planId = draft.id;
  } else {
    // Ya hay un borrador (lo empezó otra persona): no se pisa
    if (draft) throw conflict();
    const r = await ctx.admin.from("patient_exercise_plans").insert({
      patient_id: patientId, version: Math.max(0, ...plans.map((p) => p.version)) + 1,
      supersedes_id: published?.id ?? null, status: "borrador", ...planFields, created_by_email: staff.email,
    }).select("id").single();
    if (r.error) throw dbError(r.error, "guardar el borrador");
    planId = (r.data as { id: string }).id;
  }

  const draftRows = input.id ? editedRows.filter((e) => e.plan_id === planId) : [];
  const patientKeys = new Set(versions.map((e) => e.exercise_key));
  const versionOf = new Map(plans.map((p) => [p.id, p.version]));
  const latestOfKey = (key: string) => versions.filter((e) => e.exercise_key === key)
    .sort((a, b) => (versionOf.get(b.plan_id) ?? 0) - (versionOf.get(a.plan_id) ?? 0))[0];
  const touched = new Set<string>();
  for (let i = 0; i < input.exercises.length; i++) {
    const e = input.exercises[i];
    let row = input.id && e.id ? draftRows.find((r) => r.id === e.id) : undefined;
    // Una fila que ya no es de este borrador: alguien lo cambió
    if (input.id && e.id && !row) throw conflict();
    if (e.exercise_key) {
      if (!patientKeys.has(e.exercise_key)) throw fail(400, INVALID, { code: "INVALID", field: "exercise_key", index: i });
      if (row && row.exercise_key !== e.exercise_key) throw fail(400, INVALID, { code: "INVALID", field: "exercise_key", index: i });
      row ??= draftRows.find((r) => r.exercise_key === e.exercise_key);
    }
    if (row && touched.has(row.id)) throw fail(400, INVALID, { code: "INVALID", field: "exercises", index: i });
    const prev = row ?? (e.exercise_key ? latestOfKey(e.exercise_key) : undefined);
    const fields: Json = {
      source: e.source, catalog_id: e.catalog_id,
      catalog_version: e.source === "manual" ? null : e.catalog_version ?? CATALOG_VERSION,
      approach: e.approach, practiced_in_session: e.practiced_in_session, title: e.title, para_que: e.para_que,
      pasos: e.pasos, minutes: e.minutes, materiales: e.materiales, for_adult: e.for_adult, si_cuesta: e.si_cuesta,
      with_adult: e.with_adult, position: i,
      lint_overrides: mergeOverrides(prev?.lint_overrides, exerciseTextAlerts(e, e.approach), e.review_note, staff.email, now),
      reviewed_at: e.reviewed ? row?.reviewed_at ?? now : null,
      reviewed_by_email: e.reviewed ? row?.reviewed_by_email ?? staff.email : null,
      removed_at: e.removed ? row?.removed_at ?? now : null,
      removed_by_email: e.removed ? row?.removed_by_email ?? staff.email : null,
      ...(e.ai_draft_id ? { ai_draft_id: e.ai_draft_id } : {}),
    };
    if (row) {
      touched.add(row.id);
      const r = await ctx.admin.from("patient_exercises").update(fields).eq("id", row.id);
      if (r.error) throw dbError(r.error, "guardar un ejercicio");
    } else {
      const r = await ctx.admin.from("patient_exercises").insert({
        plan_id: planId, patient_id: patientId, ...(e.exercise_key ? { exercise_key: e.exercise_key } : {}), ...fields,
      });
      if (r.error) throw dbError(r.error, "guardar un ejercicio");
    }
  }
  // Lo que estaba en el borrador y ya no vino queda quitado (no se borra), después de los que vinieron
  let next = input.exercises.length;
  for (const r of draftRows) {
    if (touched.has(r.id)) continue;
    const patch: Json = { position: Math.min(MAX_POSITION, next++) };
    if (!r.removed_at) Object.assign(patch, { removed_at: now, removed_by_email: staff.email });
    const u = await ctx.admin.from("patient_exercises").update(patch).eq("id", r.id);
    if (u.error) throw dbError(u.error, "guardar un ejercicio");
  }
}

// Cuánto se editó el texto de la IA en cada ejercicio adaptado ({ id: 0..1 });
// practice_publish_plan lo guarda al publicar, en el mismo paso
async function editRatios(ctx: Ctx, rows: ExRow[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const ai = rows.filter((e) => !e.removed_at && e.ai_drafted && e.ai_draft_id);
  if (!ai.length) return out;
  const drafts = await rowsByIds<{ id: string; output: ExerciseDraft | null }>(ctx, "ai_drafts", "id, output", ai.map((e) => e.ai_draft_id!));
  for (const e of ai) {
    const d = drafts.find((x) => x.id === e.ai_draft_id);
    const items = Array.isArray(d?.output?.ejercicios) ? d!.output!.ejercicios : [];
    const item = items.find((x) => x && x.catalogo_id === e.catalog_id);
    if (!d || !item) continue;
    const before = exerciseFullText(draftToExerciseInput(item, { approach: e.approach, practiced_in_session: e.practiced_in_session, draft_id: d.id }));
    out[e.id] = editRatio(before, exerciseFullText(exTexts(e)));
  }
  return out;
}

async function publishPlan(ctx: Ctx, staff: Staff, patientId: string, body: Json) {
  clinicalOnly(staff);
  if (!isUuid(body.plan_id) || typeof body.expected_updated_at !== "string") throw new PortalError(400, INVALID);
  const expectedPublished = body.expected_published_id ?? null;
  if (expectedPublished !== null && !isUuid(expectedPublished)) throw new PortalError(400, INVALID);
  const author = await requireAuthor(ctx, staff);
  // Los ejercicios del borrador se leen junto con los planes (se usan
  // después de confirmar que es el borrador de este paciente)
  const [patient, settingsR, plans, exs] = await Promise.all([
    patientOf(ctx, patientId),
    ctx.admin.from("patient_portal_settings").select("paused_at").eq("patient_id", patientId).maybeSingle(),
    plansOf(ctx, patientId),
    exercisesOfPlan(ctx, body.plan_id),
  ]);
  if (one<{ paused_at: string | null }>(settingsR)?.paused_at) throw fail(409, PAUSED);
  const draft = plans.find((p) => p.id === body.plan_id);
  if (!draft || draft.status !== "borrador" || !sameInstant(body.expected_updated_at, draft.updated_at)) throw conflict();
  const published = plans.find((p) => p.status === "publicado") ?? null;
  if ((published?.id ?? null) !== expectedPublished) throw conflict();

  const mine = exs.filter((e) => e.plan_id === draft.id).sort((a, b) => a.position - b.position);
  const adolescent = isAdolescent(patient.age);
  const ack = adolescent && body.adolescent_ack === true;
  const problem = publishProblem(publishCheckOf(draft, mine), {
    age: patient.age, diagnosis_code: patient.diagnosis_code, adolescent_ack: !adolescent || ack,
  });
  if (problem) throw fail(400, problem.error, { code: problem.code, index: problem.index, terms: problem.terms });

  // Se publica exactamente lo que se revisó: la base vuelve a mirar, con el
  // plan tomado, que el borrador (y sus ejercicios, que mueven su
  // updated_at) siga igual. La pausa de vacaciones del plan que se reemplaza
  // pasa a la versión nueva en el mismo paso, y supersedes_id queda en el
  // que de verdad se reemplaza (el publicado ahora o ninguno; no el que había
  // al armar el borrador, que pudo finalizarse o retirarse después).
  const { error } = await ctx.admin.rpc("practice_publish_plan", {
    p_plan: draft.id, p_expected: expectedPublished, p_expected_updated_at: draft.updated_at,
    p_edit_ratios: await editRatios(ctx, mine), p_professional: author.professional_id,
    p_author_label: author.label, p_adolescent_ack: ack, p_email: staff.email,
  });
  if (error) {
    const e = dbError(error, "publicar el plan");
    throw e.status === 503 ? fail(503, PRACTICE_ERROR.publish_failed) : e;
  }
}

function planOfPatient(plans: PlanRow[], id: unknown): PlanRow {
  if (!isUuid(id)) throw new PortalError(400, INVALID);
  const p = plans.find((x) => x.id === id);
  if (!p) throw conflict();
  return p;
}

// Cambia un plan publicado (la pausa), solo si sigue publicado. Finalizar y
// retirar van por practice_finish_plan y practice_withdraw_plan (con sus metas)
async function updatePublished(ctx: Ctx, planId: string, patch: Json) {
  const r = await ctx.admin.from("patient_exercise_plans").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", planId).eq("status", "publicado").select("id");
  if (r.error) throw dbError(r.error, "cambiar el plan");
  if (!(r.data as unknown[] | null)?.length) throw conflict();
}

async function sendFeedback(ctx: Ctx, staff: Staff, patientId: string, body: Json) {
  clinicalOnly(staff);
  const author = await requireAuthor(ctx, staff);
  const patient = await patientOf(ctx, patientId);
  const v = validateFeedback(body.feedback, { adolescent: isAdolescent(patient.age) });
  if (!v.ok) throw badInput(v);
  const f = v.value;
  const medalGoal = f.medal?.goal_id ?? null;
  const [plans, goals, goalMedals] = await Promise.all([
    plansOf(ctx, patientId),
    // Las metas elegidas y la de la medalla (por id: no dependen de cuántas haya)
    rowsByIds<GoalRow>(ctx, "patient_goals", GOAL_COLS, [...f.goal_ids, ...(medalGoal ? [medalGoal] : [])])
      .then((gs) => gs.filter((g) => g.patient_id === patientId)),
    medalGoal
      ? ctx.admin.from("patient_medals").select("id").eq("kind", "profesional").eq("goal_id", medalGoal).is("voided_at", null).limit(1)
        .then((r) => list<{ id: string }>(r))
      : Promise.resolve([]),
  ]);
  const published = plans.find((p) => p.status === "publicado") ?? null;
  if (f.plan_id && !plans.some((p) => p.id === f.plan_id)) throw fail(400, INVALID, { code: "INVALID", field: "plan_id" });
  const planId = f.plan_id ?? published?.id ?? null;
  for (const id of f.goal_ids) {
    const g = goals.find((x) => x.id === id);
    if (!g || g.status !== "activa") throw fail(409, PRACTICE_ERROR.goal_not_active, { code: "CONFLICT", field: "goal_ids" });
  }
  if (medalGoal) {
    if (!goals.some((g) => g.id === medalGoal)) throw fail(400, INVALID, { code: "INVALID", field: "medal" });
    if (goalMedals.length) throw fail(409, GOAL_HAS_MEDAL, { code: "CONFLICT", field: "medal" });
  }
  const lastReviewed = lastReviewedOf(plans);
  const periodStart = lastReviewed ? centerDateOf(lastReviewed) : published?.published_at ? centerDateOf(published.published_at) : null;
  const { error } = await ctx.admin.rpc("practice_send_feedback", {
    p_patient: patientId, p_plan: planId, p_professional: author.professional_id, p_author_label: author.label,
    p_body: f.body, p_for_adult: f.for_adult, p_period_start: periodStart, p_period_end: centerToday(),
    p_adolescent_ack: f.adolescent_ack, p_review_note: f.review_note, p_goal_ids: f.goal_ids,
    p_medal_title: f.medal?.title ?? null, p_medal_message: f.medal?.message ?? null, p_medal_goal: medalGoal,
    p_email: staff.email,
  });
  if (error) {
    if (error.code === "23505") throw fail(409, GOAL_HAS_MEDAL, { code: "CONFLICT", field: "medal" });
    throw dbError(error, "mandar la devolución");
  }
}

async function withdrawFeedback(ctx: Ctx, staff: Staff, patientId: string, body: Json) {
  clinicalOnly(staff);
  if (!isUuid(body.feedback_id)) throw new PortalError(400, INVALID);
  const reason = body.reason as FeedbackWithdrawReason;
  if (!(FEEDBACK_WITHDRAW_REASONS as readonly unknown[]).includes(reason)) throw fail(400, "Elegí el motivo.", { code: "INVALID", field: "reason" });
  const fb = one<FbRow>(await ctx.admin.from("patient_practice_feedback").select(FB_COLS).eq("id", body.feedback_id).maybeSingle());
  if (!fb || fb.patient_id !== patientId) throw new PortalError(404, "No encontramos esa devolución.");
  if (fb.withdrawn_at) throw fail(409, ALREADY_WITHDRAWN, { code: "CONFLICT" });
  // Cada profesional retira las suyas; la Dirección, cualquiera
  if (staff.role !== "direccion" && fb.sent_by_email !== staff.email) throw fail(403, ONLY_OWNER);
  // En un solo paso se deshace lo que la familia veía por ella: las metas que
  // dio por logradas vuelven a activas si su plan sigue vigente (o no tienen
  // plan) y si no quedan "cambiada"; su medalla queda anulada
  const { error } = await ctx.admin.rpc("practice_withdraw_feedback", { p_feedback: fb.id, p_reason: reason, p_email: staff.email });
  if (error) {
    if (/PRACTICE_FEEDBACK/.test(error.message ?? "")) throw fail(409, ALREADY_WITHDRAWN, { code: "CONFLICT" });
    throw dbError(error, "retirar la devolución");
  }
}

async function saveGoal(ctx: Ctx, staff: Staff, patientId: string, body: Json) {
  clinicalOnly(staff);
  const v = validateGoal(body.goal);
  if (!v.ok) throw badInput(v);
  const g = v.value;
  if (g.plan_id) {
    const plan = one<{ patient_id: string; status: PlanStatus }>(await ctx.admin.from("patient_exercise_plans")
      .select("patient_id, status").eq("id", g.plan_id).maybeSingle());
    if (!plan || plan.patient_id !== patientId || (plan.status !== "borrador" && plan.status !== "publicado")) {
      throw fail(400, INVALID, { code: "INVALID", field: "plan_id" });
    }
  }
  const fields = {
    plan_id: g.plan_id, kind: g.kind, title: g.title, rule: g.rule, medal_title: g.medal_title,
    agreed_with_patient: g.agreed_with_patient, updated_at: new Date().toISOString(),
  };
  if (g.id) {
    const r = await ctx.admin.from("patient_goals").update(fields)
      .eq("id", g.id).eq("patient_id", patientId).eq("status", "borrador").select("id");
    if (r.error) throw dbError(r.error, "guardar la meta");
    if (!(r.data as unknown[] | null)?.length) throw fail(409, GOAL_NOT_DRAFT, { code: "CONFLICT" });
  } else {
    const { error } = await ctx.admin.from("patient_goals")
      .insert({ patient_id: patientId, ...fields, status: "borrador", created_by_email: staff.email });
    if (error) throw dbError(error, "guardar la meta");
  }
}

async function goalOf(ctx: Ctx, patientId: string, id: unknown): Promise<GoalRow> {
  if (!isUuid(id)) throw new PortalError(400, INVALID);
  const g = one<GoalRow>(await ctx.admin.from("patient_goals").select(GOAL_COLS).eq("id", id).maybeSingle());
  if (!g || g.patient_id !== patientId) throw new PortalError(404, "No encontramos esa meta.");
  return g;
}

// Cambia una meta solo si sigue en el estado esperado
async function updateGoal(ctx: Ctx, id: string, from: GoalStatus, patch: Json, gone: string) {
  const r = await ctx.admin.from("patient_goals").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", from).select("id");
  if (r.error) throw dbError(r.error, "cambiar la meta");
  if (!(r.data as unknown[] | null)?.length) throw fail(409, gone, { code: "CONFLICT" });
}

// Si el plan de una meta sigue vigente: sin plan, publicado, en borrador o
// una versión anterior del publicado (las metas de las versiones que
// reemplazó siguen activas). En esa cadena solo hay versiones reemplazadas:
// al publicar, supersedes_id es el plan que de verdad se reemplaza, nunca
// uno finalizado o retirado (practice_publish_plan). Lo mismo que
// practice_plan_open() del script 26 y goalPlanOpen() del modo mock.
function planOpen(plans: PlanRow[], planId: string | null): boolean {
  if (!planId) return true;
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return false;
  if (plan.status === "publicado" || plan.status === "borrador") return true;
  const live = plans.find((p) => p.status === "publicado");
  return !!live && lineage(live, plans).some((p) => p.id === planId);
}

async function publishGoal(ctx: Ctx, staff: Staff, patientId: string, body: Json) {
  clinicalOnly(staff);
  const [g, plans] = await Promise.all([goalOf(ctx, patientId, body.goal_id), plansOf(ctx, patientId)]);
  if (g.status !== "borrador") throw fail(409, GOAL_NOT_DRAFT, { code: "CONFLICT" });
  // Una meta de un plan que ya se cerró no se publica: se edita para sumarla
  // al plan de ahora (la base también lo cuida). Al finalizar o retirar un
  // plan sus metas en borrador ya quedan "cambiada"; acá llegan las de un
  // borrador descartado o las de un plan que se cerró mientras tanto.
  if (!planOpen(plans, g.plan_id)) throw fail(409, GOAL_PLAN_CLOSED, { code: "CONFLICT" });
  // La de un plan en borrador sale junto con él: sola, la familia la vería
  // aunque después el borrador se descarte (la base también lo cuida)
  if (plans.some((p) => p.id === g.plan_id && p.status === "borrador")) throw fail(409, GOAL_WITH_DRAFT, { code: "CONFLICT" });
  const terms = uniq([...blockForTitles(g.title), ...blockForTitles(g.medal_title)]);
  if (terms.length) throw fail(400, FLUENCY_TITLE_MESSAGE, { code: "TITLE_BLOCK", terms });
  const patient = await patientOf(ctx, patientId);
  if (isAdolescent(patient.age) && body.adolescent_ack !== true) throw fail(400, PRACTICE_ERROR.adolescent_ack, { code: "ADOLESCENT_ACK" });
  await updateGoal(ctx, g.id, "borrador", { status: "activa", published_at: new Date().toISOString(), published_by_email: staff.email }, GOAL_NOT_DRAFT);
}

async function voidMedal(ctx: Ctx, staff: Staff, patientId: string, body: Json) {
  clinicalOnly(staff);
  if (!isUuid(body.medal_id)) throw new PortalError(400, INVALID);
  const reason = String(body.reason ?? "").replace(/\s+/g, " ").trim();
  if (reason.length < 3) throw fail(400, PRACTICE_ERROR.void_reason, { code: "INVALID", field: "reason" });
  if (reason.length > PRACTICE_LIMITS.void_reason) {
    throw fail(400, `El motivo es muy largo: el máximo es ${PRACTICE_LIMITS.void_reason} caracteres.`, { code: "INVALID", field: "reason" });
  }
  const m = one<MedalRow>(await ctx.admin.from("patient_medals").select(MEDAL_COLS).eq("id", body.medal_id).maybeSingle());
  if (!m || m.patient_id !== patientId) throw new PortalError(404, "No encontramos esa medalla.");
  if (m.voided_at) throw fail(409, ALREADY_VOIDED, { code: "CONFLICT" });
  const r = await ctx.admin.from("patient_medals")
    .update({ voided_at: new Date().toISOString(), voided_by_email: staff.email, void_reason: reason })
    .eq("id", m.id).is("voided_at", null).select("id");
  if (r.error) throw dbError(r.error, "anular la medalla");
  if (!(r.data as unknown[] | null)?.length) throw fail(409, ALREADY_VOIDED, { code: "CONFLICT" });
}

// POST /api/portal-staff/practice: una sola entrada (PracticeAction). Todas
// devuelven la sección actualizada. "get" lo puede pedir cualquier rol; el
// resto, solo profesionales y Dirección.
export async function staffPracticeAction(ctx: Ctx, staff: Staff, body: Json): Promise<StaffPracticeDTO> {
  if (!isUuid(body.patient_id)) throw new PortalError(400, INVALID);
  const patientId = body.patient_id;
  const now = () => new Date().toISOString();
  switch (body.action) {
    case "get":
      return staffPractice(ctx, staff, patientId);

    case "catalog":
      clinicalOnly(staff);
      return staffPractice(ctx, staff, patientId, { catalog: true });

    case "plan_save_draft":
      await saveDraft(ctx, staff, patientId, body);
      break;

    case "plan_publish":
      await publishPlan(ctx, staff, patientId, body);
      break;

    case "plan_break": {
      clinicalOnly(staff);
      const plan = planOfPatient(await plansOf(ctx, patientId), body.plan_id);
      if (plan.status !== "publicado") throw conflict();
      let until: string | null = null;
      if (body.until !== null && body.until !== undefined) {
        if (!isDateKey(body.until) || body.until <= centerToday()) throw fail(400, BREAK_DATE, { code: "INVALID", field: "until" });
        until = body.until;
      }
      await updatePublished(ctx, plan.id, { on_break_until: until, updated_by_email: staff.email });
      break;
    }

    // Finalizar cierra como retirar (practice_finish_plan y
    // practice_withdraw_plan comparten practice_close_plan): en un solo paso,
    // las metas activas y en borrador de su cadena de versiones (él y las que
    // reemplazó) pasan a "cambiada"; las logradas quedan con su devolución.
    // Así la familia deja de verlas y retirar una devolución no las revive.
    case "plan_finish": {
      clinicalOnly(staff);
      const plan = planOfPatient(await plansOf(ctx, patientId), body.plan_id);
      if (plan.status !== "publicado") throw conflict();
      const { error } = await ctx.admin.rpc("practice_finish_plan", { p_plan: plan.id, p_email: staff.email });
      if (error) throw dbError(error, "finalizar el plan");
      break;
    }

    case "plan_withdraw": {
      clinicalOnly(staff);
      const plan = planOfPatient(await plansOf(ctx, patientId), body.plan_id);
      const reason = body.reason as PlanWithdrawReason;
      if (plan.status === "borrador") {
        // Un borrador se descarta (no se borra)
        const r = await ctx.admin.from("patient_exercise_plans").update({
          status: "retirado", closed_at: now(), closed_by_email: staff.email, close_reason: "descartado",
          updated_by_email: staff.email, updated_at: now(),
        }).eq("id", plan.id).eq("status", "borrador").select("id");
        if (r.error) throw dbError(r.error, "descartar el borrador");
        if (!(r.data as unknown[] | null)?.length) throw conflict();
        break;
      }
      if (plan.status !== "publicado") throw conflict();
      if (!(PLAN_WITHDRAW_REASONS as readonly unknown[]).includes(reason)) throw fail(400, "Elegí el motivo.", { code: "INVALID", field: "reason" });
      if (staff.role !== "direccion" && plan.published_by_email !== staff.email) throw fail(403, ONLY_OWNER);
      // Deja de verse en un solo paso junto con las metas de su cadena de
      // versiones (él y las que reemplazó): las activas y las en borrador
      // pasan a "cambiada"; las logradas quedan con su devolución (como al finalizarlo)
      const { error } = await ctx.admin.rpc("practice_withdraw_plan", { p_plan: plan.id, p_reason: reason, p_email: staff.email });
      if (error) throw dbError(error, "retirar el plan");
      break;
    }

    // "Visto", con el nombre con que firma quien lo marca. Va en el plan
    // publicado o, si ya se finalizó o se retiró, en el último publicado: lo
    // que quedó sin ver también se puede dar por visto.
    case "mark_seen": {
      clinicalOnly(staff);
      const author = await requireAuthor(ctx, staff);
      const target = reviewTarget(await plansOf(ctx, patientId));
      if (!target) throw fail(409, NOTHING_TO_REVIEW, { code: "CONFLICT" });
      const r = await ctx.admin.from("patient_exercise_plans").update({
        last_reviewed_at: now(), last_reviewed_by_email: staff.email, last_reviewed_label: author.label,
        updated_by_email: staff.email, updated_at: now(),
      }).eq("id", target.id).eq("status", target.status).select("id");
      if (r.error) throw dbError(r.error, "marcar como visto");
      if (!(r.data as unknown[] | null)?.length) throw conflict();
      break;
    }

    case "feedback_send":
      await sendFeedback(ctx, staff, patientId, body);
      break;

    case "feedback_withdraw":
      await withdrawFeedback(ctx, staff, patientId, body);
      break;

    case "goal_save":
      await saveGoal(ctx, staff, patientId, body);
      break;

    case "goal_publish":
      await publishGoal(ctx, staff, patientId, body);
      break;

    case "goal_change": {
      clinicalOnly(staff);
      const g = await goalOf(ctx, patientId, body.goal_id);
      if (g.status !== "activa") throw fail(409, PRACTICE_ERROR.goal_not_active, { code: "CONFLICT" });
      await updateGoal(ctx, g.id, "activa", { status: "cambiada", changed_at: now(), changed_by_email: staff.email }, PRACTICE_ERROR.goal_not_active);
      break;
    }

    case "goal_not_yet": {
      clinicalOnly(staff);
      const g = await goalOf(ctx, patientId, body.goal_id);
      if (g.status !== "activa" || g.kind !== "practica") throw fail(409, PRACTICE_ERROR.goal_not_active, { code: "CONFLICT" });
      await updateGoal(ctx, g.id, "activa", { met_notice_dismissed_at: now() }, PRACTICE_ERROR.goal_not_active);
      break;
    }

    case "medal_void":
      await voidMedal(ctx, staff, patientId, body);
      break;

    default:
      throw new PortalError(400, "Acción inválida");
  }
  return staffPractice(ctx, staff, patientId);
}

// ── Bandeja Portal → "Prácticas" (solo perfiles clínicos) ───────────────────

// Lo pendiente lo cuenta la base (practice_pending: una fila por paciente),
// así ninguna práctica nueva ni ningún comentario de riesgo queda afuera por
// el tope de filas de la API. Las metas cumplidas, con los días con práctica
// de cada paciente (practice_days).
async function inboxItems(ctx: Ctx, staff: Staff): Promise<StaffPracticeInboxItem[]> {
  const today = centerToday();
  const cutoff = new Date(Date.now() - INBOX_DAYS * DAY_MS).toISOString();
  const [goalsR, proR] = await Promise.all([
    ctx.admin.from("patient_goals").select("id, patient_id, kind, title, rule, published_at")
      .eq("status", "activa").eq("kind", "practica").is("met_notice_dismissed_at", null)
      .order("published_at", { ascending: true }).limit(LIST_MAX),
    ctx.admin.from("professionals").select("id").eq("user_id", staff.user_id).limit(1),
  ]);
  const goals = list<Pick<GoalRow, "id" | "patient_id" | "kind" | "title" | "rule" | "published_at">>(goalsR)
    .filter((g) => g.rule && g.published_at);
  const myPro = list<{ id: string }>(proR)[0]?.id ?? null;

  // Prácticas de los pacientes con metas de práctica activas, desde que se publicó la más vieja
  const goalPatients = uniq(goals.map((g) => g.patient_id));
  const goalStart = goals.map((g) => centerDateOf(g.published_at!)).sort()[0] ?? null;
  const [pending, days] = await Promise.all([
    pendingRows(ctx, cutoff, goalPatients),
    practiceDays(ctx, goalPatients, goalStart),
  ]);

  type Entry = { pending: StaffPracticePending; last_reviewed_at: string | null; on_break: boolean };
  const entryOf = (id: string): Entry => {
    const row = pending.find((r) => r.patient_id === id);
    const brk = onBreak(row?.on_break_until, today);
    return { pending: pendingOf(row, brk, today), last_reviewed_at: row?.last_reviewed_at ?? null, on_break: brk };
  };

  const met = goals.flatMap((g) => {
    const progress = goalProgress({ kind: g.kind, rule: g.rule, start: centerDateOf(g.published_at!) }, asDays(days.get(g.patient_id)), today);
    return progress?.met && progress.met_on ? [{ goal: g, met_on: progress.met_on }] : [];
  });
  const withPractice = uniq(pending.filter((r) => Number(r.logs) || Number(r.comments) || Number(r.costo) || Number(r.risk))
    .map((r) => r.patient_id));
  const ids = uniq([...withPractice, ...met.map((m) => m.goal.patient_id)]);
  if (!ids.length) return [];
  const patients = await rowsByIds<{ id: string; first_name: string; last_name: string; professional_id: string | null }>(
    ctx, "patients", "id, first_name, last_name, professional_id", ids);
  const base = (id: string) => {
    const p = patients.find((x) => x.id === id);
    return {
      patient_id: id,
      patient_name: p ? `${p.last_name}, ${p.first_name}` : "Paciente",
      professional_id: p?.professional_id ?? null,
      mine: !!myPro && p?.professional_id === myPro,
      ...entryOf(id),
    };
  };
  const practiceRows: StaffPracticeInboxItem[] = withPractice
    .filter((id) => patients.some((p) => p.id === id))
    .map((id) => ({ kind: "practicas", ...base(id), goal: null }));
  const goalRowsOut: StaffPracticeInboxItem[] = met
    .filter((m) => patients.some((p) => p.id === m.goal.patient_id))
    .map((m) => ({ kind: "meta_cumplida", ...base(m.goal.patient_id), goal: { id: m.goal.id, title: m.goal.title, met_on: m.met_on } }));
  // Los comentarios con palabras de riesgo, arriba de todo; después lo más viejo
  practiceRows.sort((a, b) => Number(b.pending.risk > 0) - Number(a.pending.risk > 0)
    || (a.pending.since ?? "").localeCompare(b.pending.since ?? ""));
  goalRowsOut.sort((a, b) => a.goal!.met_on.localeCompare(b.goal!.met_on));
  return [...practiceRows, ...goalRowsOut];
}

// { action: "list" } de la bandeja. Administración: { allowed: false, items: [] }
export async function staffPracticeInbox(ctx: Ctx, staff: Staff): Promise<{ allowed: boolean; items: StaffPracticeInboxItem[] }> {
  if (!staff.clinical) return { allowed: false, items: [] };
  return { allowed: true, items: await inboxItems(ctx, staff) };
}

// { action: "count" } (número de la pestaña). Todo sale de las mismas filas
// que muestra la bandeja a quien mira (inboxItems):
//   practice_pending: filas de "Prácticas" de MIS pacientes (prácticas sin
//     ver y metas cumplidas; profesional a cargo = el vinculado a quien mira)
//   practice_risk: pacientes que NO son míos (no están en practice_pending)
//     con comentarios de riesgo sin ver, uno por paciente. Se puede sumar a
//     practice_pending sin contar dos veces al mismo paciente: el número de
//     la pestaña es practice_pending + practice_risk. No incluye el riesgo
//     de MIS pacientes (esos ya cuentan en practice_pending).
//   practice_urgent: pacientes con comentarios de riesgo sin ver, sean míos o
//     no, uno por paciente (lo que la bandeja pone arriba de todo). Es lo que
//     marca la pestaña como urgente: con un riesgo de un paciente mío,
//     practice_risk da 0 pero practice_urgent no. No se suma al número (ya
//     está contado en practice_pending o en practice_risk).
type StaffPracticeCounts = { practice_pending: number; practice_risk: number; practice_urgent: number };
export async function staffPracticeCounts(ctx: Ctx, staff: Staff): Promise<StaffPracticeCounts> {
  const items = await inboxItems(ctx, staff);
  const risky = items.filter((i) => i.kind === "practicas" && i.pending.risk > 0);
  return {
    practice_pending: items.filter((i) => i.mine).length,
    practice_risk: uniq(risky.filter((i) => !i.mine).map((i) => i.patient_id)).length,
    practice_urgent: uniq(risky.map((i) => i.patient_id)).length,
  };
}
