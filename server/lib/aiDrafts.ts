// Portal — "Adaptar con ayuda de IA" (etapa D, "ai"): borrador de ejercicios
// del catálogo aprobado, para que el profesional lo revise en el editor del
// plan. Reglas puras, prompt y validación en src/lib/aiDraftRules.ts.
//
// La IA no inventa ejercicios: adapta los del catálogo. Lo único que viaja
// al proveedor son listas cerradas (AiAdaptParams) y el texto aprobado del
// catálogo. Del paciente solo se leen acá la fecha de nacimiento y el código
// de diagnóstico, con la sesión de quien pide (rige RLS): la edad se vuelve
// una franja y el diagnóstico decide qué enfoques corresponden. Ninguno de
// los dos sale del servidor ni se devuelve.
//
// Pasos (diseño §4.5): profesional o Dirección → etapa "ai" y clave →
// validación → tope del centro por día (primer filtro, con lo registrado) →
// límite por persona → reserva atómica del lugar en el tope del centro →
// OpenRouter (un solo plazo de 25 s con un reintento si quedan 10 s) →
// validación y lint → registro en ai_drafts (si no se puede registrar, no se
// devuelve el borrador) → respuesta.
//
// Nunca se registra en los logs lo pedido, lo que devolvió el modelo ni nada
// del paciente: solo códigos.
//
// Variables de entorno: PORTAL_CLINICAL_FEATURES (con "ai"),
// OPENROUTER_DRAFT_API_KEY (si no, la de Migue: OPENROUTER_API_KEY o
// VITE_OPENROUTER_API_KEY), OPENROUTER_DRAFT_MODEL (si no,
// openai/gpt-4o-mini; no sigue al modelo de Migue) y AI_DRAFT_DAILY_CAP (150).
// Sin el script 26 (tabla ai_drafts) la ayuda de IA no está disponible.

import {
  type AiAdaptParams, type AiDraftResult, type DraftFlag, type ExerciseDraft,
  AI_ERROR, AI_PROVIDER_PREFS, AI_REQUEST_OPTIONS, AI_RETRY_MIN_MS, AI_TIMEOUT_MS, AI_TITLE_HEADER,
  PROMPT_VERSION, buildAdaptParams, buildAdaptPrompt, describeSent, draftApiKey, draftCenterKey, draftDailyCap, draftModel,
  draftRateKey, draftResponseFormat, lintDraft, parseExerciseDraft,
} from "../../src/lib/aiDraftRules";
import { parseFeatures } from "../../src/lib/portalClinicalRules";
import { ageOn, centerNow } from "../../src/lib/portalRules";
import { type CatalogEntry, isUuid } from "../../src/lib/practiceRules";
import { type OpenRouterUsage, openrouterJson } from "./openrouter";
import { type Ctx, PortalError, hmac, missingTable } from "./portal";
import { requireClinical } from "./portalClinical";

type Env = Record<string, string | undefined>;
type Staff = { user_id: string; email: string; token: string; clinical: boolean };

const OFFLINE = "No pudimos conectar. Probá de nuevo.";

const unavailable = () => new PortalError(503, AI_ERROR.unavailable, { code: "AI_UNAVAILABLE" });
const misconfigured = () => new PortalError(503, AI_ERROR.misconfigured, { code: "AI_UNAVAILABLE" });
const limited = () => new PortalError(429, AI_ERROR.limit, { code: "AI_LIMIT" });
const failed = () => new PortalError(502, AI_ERROR.failed, { code: "AI_FAILED" });

// La ayuda de IA está prendida: etapa "ai" y una clave (para el panel:
// StaffPracticeDTO.features.ai)
export function aiAvailable(env: Env = process.env): boolean {
  return parseFeatures(env.PORTAL_CLINICAL_FEATURES).includes("ai") && !!draftApiKey(env);
}

// Comienzo del día de hoy en el centro (Tucumán), como instante ISO
export function centerDayStart(d: Date = new Date()): string {
  const [h, m] = centerNow(d).time.split(":").map(Number);
  const minute = Math.floor(d.getTime() / 60_000) * 60_000;
  return new Date(minute - (h * 60 + m) * 60_000).toISOString();
}

// ── Generación (sin base: la usa también el banco de prueba) ────────────────

export type AdaptAttempt = {
  code: string | null; // null: salió bien; si no, el motivo (TIMEOUT, HTTP_502, INVALID_JSON, LINT_BLOCK…)
  status: number | null; // status HTTP de OpenRouter
  ms: number;
  terms?: string[]; // LINT_BLOCK: las frases que bloquearon
};

type GenBase = { model: string; attempts: AdaptAttempt[]; usage: OpenRouterUsage; latency_ms: number };
export type AdaptGeneration =
  | (GenBase & { ok: true; draft: ExerciseDraft; flags: DraftFlag[] })
  // unavailable: la IA está mal configurada (modelo o pedido inválido, clave,
  // crédito o ningún proveedor que cumpla las preferencias): 503 en vez de 502
  | (GenBase & { ok: false; error_code: string; unavailable: boolean });

export type AdaptOptions = {
  apiKey: string;
  model: string;
  budgetMs?: number; // plazo total (AI_TIMEOUT_MS)
  retryMinMs?: number; // se reintenta si queda al menos esto (AI_RETRY_MIN_MS)
  now?: () => number; // reloj (para las pruebas)
};

// Status de OpenRouter que dicen que la IA está mal configurada: no tiene
// sentido "Probá de nuevo" ni reintentar (el cuerpo lo arma entero el
// servidor, así que el mismo pedido vuelve a fallar igual). Qué revisar en
// cada caso (va al log del servidor, sin nada del pedido ni de la respuesta).
const CONFIG_HINT: Record<number, string> = {
  400: "pedido inválido: revisá OPENROUTER_DRAFT_MODEL (que el modelo exista y acepte json_schema) o el esquema por pedido (draftJsonSchema)",
  401: "clave inválida: revisá OPENROUTER_DRAFT_API_KEY / OPENROUTER_API_KEY / VITE_OPENROUTER_API_KEY",
  402: "sin crédito en OpenRouter",
  403: "la clave no tiene permiso para este pedido",
  404: "ningún proveedor del modelo cumple las preferencias (zdr, data_collection, json_schema)",
};
const isConfigStatus = (status: number | null): status is number => status !== null && Object.hasOwn(CONFIG_HINT, status);

function addUsage(total: OpenRouterUsage, u: OpenRouterUsage | null) {
  if (!u) return;
  if (u.tokens_in !== null) total.tokens_in = (total.tokens_in ?? 0) + u.tokens_in;
  if (u.tokens_out !== null) total.tokens_out = (total.tokens_out ?? 0) + u.tokens_out;
  if (u.cost_usd !== null) total.cost_usd = (total.cost_usd ?? 0) + u.cost_usd;
}

// Un ejercicio por cada id pedido, en el orden pedido. Con el esquema por
// pedido (draftResponseFormat) lo obliga el proveedor y parseExerciseDraft
// ya lo devuelve así; esto queda por si llega la forma de antes (una lista
// con catalogo_id): si están todos pero en otro orden, se ordenan y se
// recalculan las alertas.
function completeDraft(draft: ExerciseDraft, flags: DraftFlag[], params: AiAdaptParams): { draft: ExerciseDraft; flags: DraftFlag[] } | null {
  const ids = params.catalogo.ids;
  if (draft.ejercicios.length !== ids.length) return null;
  if (draft.ejercicios.every((e, i) => e.catalogo_id === ids[i])) return { draft, flags };
  const ordered = ids.map((id) => draft.ejercicios.find((e) => e.catalogo_id === id));
  if (ordered.some((e) => !e)) return null;
  const out = { ...draft, ejercicios: ordered as ExerciseDraft["ejercicios"] };
  return { draft: out, flags: lintDraft(out, params.enfoque).flags };
}

// Pide el borrador a OpenRouter y lo revisa. Un solo plazo para todo
// (AI_TIMEOUT_MS); si la respuesta no sirve (JSON inválido, fuera del
// esquema, ejercicios que no se pidieron, frases bloqueadas) o el proveedor
// falló un momento, se reintenta una vez si quedan AI_RETRY_MIN_MS o más.
// El esquema de la respuesta se arma con los ids pedidos (el mismo en los
// dos intentos): el proveedor obliga a traer un ejercicio por cada uno.
export async function generateAdaptDraft(params: AiAdaptParams, entries: CatalogEntry[], opts: AdaptOptions): Promise<AdaptGeneration> {
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? AI_TIMEOUT_MS;
  const retryMin = opts.retryMinMs ?? AI_RETRY_MIN_MS;
  const { system, user } = buildAdaptPrompt(params, entries);
  const start = now();
  const attempts: AdaptAttempt[] = [];
  const usage: OpenRouterUsage = { tokens_in: null, tokens_out: null, cost_usd: null };
  const base = () => ({ model: opts.model, attempts, usage, latency_ms: Math.max(0, now() - start) });
  let responseFormat: ReturnType<typeof draftResponseFormat>;
  try {
    responseFormat = draftResponseFormat(params.catalogo.ids);
  } catch {
    // Ids que no sirven como claves del esquema (con el catálogo no pasa: lo
    // revisan las pruebas). Reintentar no sirve: no se llama al proveedor
    console.error("[ia] los ids pedidos no sirven para armar el esquema de la respuesta");
    return { ...base(), ok: false, error_code: "SCHEMA_IDS", unavailable: true };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  let errorCode = "FAILED";
  let config = false;
  try {
    for (let i = 0; i < 2; i++) {
      if (i > 0 && budget - (now() - start) < retryMin) break;
      const t0 = now();
      const r = await openrouterJson({
        model: opts.model,
        apiKey: opts.apiKey,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: responseFormat,
        provider: AI_PROVIDER_PREFS,
        temperature: AI_REQUEST_OPTIONS.temperature,
        max_tokens: AI_REQUEST_OPTIONS.max_tokens,
        title: AI_TITLE_HEADER,
        signal: controller.signal,
      });
      addUsage(usage, r.usage);
      if (!r.ok) {
        errorCode = r.code === "HTTP" && r.status !== null ? `HTTP_${r.status}` : r.code;
        config = r.code === "HTTP" && isConfigStatus(r.status);
        attempts.push({ code: errorCode, status: r.status, ms: now() - t0 });
        if (config) {
          // Solo el status y qué revisar: nunca el cuerpo
          console.error(`[ia] OpenRouter rechazó el pedido por configuración (HTTP ${r.status}): ${CONFIG_HINT[r.status as number]}`);
          break;
        }
        if (!r.retryable) break;
        continue;
      }
      config = false;
      const parsed = parseExerciseDraft(r.content, params.catalogo.ids, params.minutos, params.enfoque);
      if (!parsed.ok) {
        errorCode = parsed.code;
        attempts.push({ code: parsed.code, status: r.status, ms: now() - t0, ...(parsed.terms ? { terms: parsed.terms } : {}) });
        continue;
      }
      const complete = completeDraft(parsed.draft, parsed.flags, params);
      if (!complete) {
        errorCode = "CATALOG";
        attempts.push({ code: "CATALOG", status: r.status, ms: now() - t0 });
        continue;
      }
      attempts.push({ code: null, status: r.status, ms: now() - t0 });
      return { ...base(), ok: true, draft: complete.draft, flags: complete.flags };
    }
  } finally {
    clearTimeout(timer);
  }
  if (!config) {
    // Por qué falló cada intento (código, status, tiempo y cuántas frases se
    // bloquearon): nunca el texto del modelo, ni las frases, ni lo que se mandó
    const why = attempts.map((a) => `${a.code ?? "OK"}${a.status ? `/${a.status}` : ""} ${a.ms}ms${a.terms?.length ? ` (${a.terms.length} bloqueada${a.terms.length === 1 ? "" : "s"})` : ""}`);
    console.error(`[ia] no se pudo armar el borrador (${opts.model}, ${Math.round(now() - start)}ms): ${why.join(" · ") || errorCode}`);
  }
  return { ...base(), ok: false, error_code: errorCode, unavailable: config };
}

// ── El pedido del panel ─────────────────────────────────────────────────────

// Solo la fecha de nacimiento y el código de diagnóstico, con la sesión de
// quien pide (rige RLS). No salen de acá.
async function patientForDraft(ctx: Ctx, staff: Staff, patientId: string): Promise<{ age: number | null; diagnosis_code: string | null }> {
  const { data, error } = await ctx.asUser(staff.token).from("patients")
    .select("birth_date, diagnosis_code").eq("id", patientId).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!data) throw new PortalError(404, "No encontramos ese paciente.");
  const birth = (data.birth_date as string | null) ?? null;
  return {
    age: birth ? ageOn(birth, centerNow().date) : null,
    diagnosis_code: (data.diagnosis_code as string | null) ?? null,
  };
}

// Tope del centro, primer filtro: borradores registrados hoy (con error o sin
// error, todos cuestan). Es barato y no gasta el límite por persona cuando el
// tope ya se alcanzó, pero no alcanza solo (dos pedidos a la vez pasan los
// dos): el que manda es reserveDailySlot. Sin la tabla (script 26 sin
// correr), la IA no está disponible.
async function checkDailyCap(ctx: Ctx, env: Env, now: Date) {
  const { count, error } = await ctx.admin.from("ai_drafts")
    .select("id", { count: "exact" }).gte("created_at", centerDayStart(now)).limit(1);
  if (error) {
    if (missingTable(error)) throw unavailable();
    throw new PortalError(503, OFFLINE);
  }
  if ((count ?? 0) >= draftDailyCap(env)) throw limited();
}

// Tope del centro, la reserva (atómica). Antes de llamar al proveedor, cada
// pedido suma 1 al contador del centro de hoy (chat_rate_limit_hit, script 8:
// un UPSERT ... RETURNING con bloqueo de la fila) y después lee el total, que
// ya incluye su reserva. Si el total pasa el tope, no se pide. Cada pedido
// que pasa vio al menos su propia reserva y las de todos los que la hicieron
// antes, así que, aunque lleguen muchos a la vez, a lo sumo
// AI_DRAFT_DAILY_CAP pedidos por día del centro llegan al proveedor (y cada
// uno hace como máximo 2 llamadas, por el reintento). Lo que queda:
//   - cerca del tope, pedidos simultáneos pueden quedar todos rechazados
//     aunque sobrara algún lugar (cada rechazo también suma);
//   - el lugar reservado no se devuelve si después el pedido falla (también
//     cuentan los que no se pudieron registrar en ai_drafts).
// Se ignora el sí/no de chat_rate_limit_hit: sus límites son los de una
// persona (20 cada 10 minutos y 100 por día). La clave lleva hmac: la función
// es pública y, sin el hash, cualquiera podría gastar el cupo del centro. El
// contador "day" de la función va por día UTC; la clave ya es del día de
// Tucumán, así que se suman sus filas "day" (a lo sumo dos).
async function reserveDailySlot(ctx: Ctx, env: Env, now: Date) {
  const key = hmac(ctx, draftCenterKey(centerNow(now).date));
  const hit = await ctx.admin.rpc("chat_rate_limit_hit", { p_key: key });
  if (hit.error) {
    console.error("[ia] no se pudo reservar el lugar en el tope del centro:", hit.error.code || "-");
    throw unavailable();
  }
  const { data, error } = await ctx.admin.from("chat_rate_limits").select("hits").eq("key", key).eq("bucket", "day");
  if (error || !Array.isArray(data)) {
    console.error("[ia] no se pudo leer el tope del centro:", error?.code || "-");
    throw unavailable();
  }
  const total = (data as { hits: unknown }[]).reduce((n, r) => n + (Number(r.hits) || 0), 0);
  // Sin la reserva a la vista no se pide (no se sabría si hay lugar)
  if (total < 1) {
    console.error("[ia] el tope del centro no registró la reserva");
    throw unavailable();
  }
  if (total > draftDailyCap(env)) throw limited();
}

// Límite por persona, guardado en la base (20 cada 10 minutos y 100 por día,
// script 8): la clave es un hash del usuario. Si no se puede revisar, no se pide.
async function checkRateLimit(ctx: Ctx, userId: string) {
  const { data, error } = await ctx.admin.rpc("chat_rate_limit_hit", { p_key: hmac(ctx, draftRateKey(userId)) });
  if (error) {
    console.error("[ia] no se pudo revisar el límite de borradores:", error.code || "-");
    throw unavailable();
  }
  if (data !== true) throw limited();
}

// Registro en ai_drafts (solo se agregan filas). null si no se pudo
async function recordDraft(ctx: Ctx, staff: Staff, patientId: string, params: AiAdaptParams, gen: AdaptGeneration): Promise<string | null> {
  const int = (n: number | null) => (n === null ? null : Math.round(n));
  const { data, error } = await ctx.admin.from("ai_drafts").insert({
    kind: "adaptacion",
    patient_id: patientId, // nunca se manda al proveedor
    requested_by_email: staff.email,
    model: gen.model,
    prompt_version: PROMPT_VERSION,
    catalog_version: params.catalogo.version,
    params, // exactamente lo que se mandó (listas cerradas)
    output: gen.ok ? gen.draft : null,
    flags: gen.ok ? gen.flags : [],
    status: gen.ok ? "generado" : "error",
    error_code: gen.ok ? null : gen.error_code,
    tokens_in: int(gen.usage.tokens_in),
    tokens_out: int(gen.usage.tokens_out),
    cost_usd: gen.usage.cost_usd === null ? null : Math.round(gen.usage.cost_usd * 1e6) / 1e6,
    latency_ms: Math.round(gen.latency_ms),
  }).select("id").single();
  if (error || !data) {
    console.error("[ia] no se pudo registrar el borrador:", error?.code || "-");
    return null;
  }
  return (data as { id: string }).id;
}

export type CreateDraftOptions = Omit<AdaptOptions, "apiKey" | "model"> & { env?: Env };

// POST /api/portal-staff/ai-draft (cuerpo: AiDraftRequest)
export async function createAdaptDraft(ctx: Ctx, staff: Staff, raw: unknown, opts: CreateDraftOptions = {}): Promise<AiDraftResult> {
  const env = opts.env ?? process.env;
  requireClinical(staff);
  const apiKey = draftApiKey(env);
  if (!parseFeatures(env.PORTAL_CLINICAL_FEATURES).includes("ai") || !apiKey) throw unavailable();

  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!body || !isUuid(body.patient_id)) throw new PortalError(400, "Pedido inválido");
  const patientId = body.patient_id;
  const built = buildAdaptParams(body, await patientForDraft(ctx, staff, patientId));
  if (!built.ok) throw new PortalError(400, built.error);

  // El límite por persona va antes de la reserva: quien llegó a su límite no
  // gasta lugares del centro
  const today = new Date();
  await checkDailyCap(ctx, env, today);
  await checkRateLimit(ctx, staff.user_id);
  await reserveDailySlot(ctx, env, today);

  const gen = await generateAdaptDraft(built.params, built.entries, {
    apiKey, model: draftModel(env), budgetMs: opts.budgetMs, retryMinMs: opts.retryMinMs, now: opts.now,
  });
  const draftId = await recordDraft(ctx, staff, patientId, built.params, gen);
  if (!gen.ok) throw gen.unavailable ? misconfigured() : failed();
  // Sin registro no hay borrador (no se podría publicar ni auditar)
  if (!draftId) throw unavailable();
  return {
    draft_id: draftId,
    draft: gen.draft,
    flags: gen.flags,
    sent: describeSent(built.params, built.entries),
    demo: false,
  };
}
