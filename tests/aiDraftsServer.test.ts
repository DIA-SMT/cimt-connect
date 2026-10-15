// Pruebas del servidor de "Adaptar con ayuda de IA" (etapa D): el pedido a
// OpenRouter (server/lib/openrouter.ts) y el camino completo del endpoint
// (server/lib/aiDrafts.ts) contra una base de prueba en memoria y un fetch
// simulado: quién puede pedir, etapa y clave, validación, límites, plazo y
// reintento, registro en ai_drafts y que nada que identifique al paciente
// viaje ni quede en los logs. También los casos del banco de prueba
// (scripts/ai-eval.ts), sin red. Correr con: bun test
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { aiAvailable, centerDayStart, createAdaptDraft, generateAdaptDraft } from "../server/lib/aiDrafts";
import { OPENROUTER_URL, openrouterBody, openrouterJson } from "../server/lib/openrouter";
import { type Ctx, PortalError } from "../server/lib/portal";
import {
  ADAPTATIONS, AGE_BANDS, AI_ERROR, AI_PROVIDER_PREFS, AI_REQUEST_OPTIONS, AI_TITLE_HEADER, DRAFT_RESPONSE_FORMAT, INTERESTS,
  PROMPT_VERSION, QUIEN_ACOMPANA, type AiDraftRequest, type ExerciseDraft, ageBand, buildAdaptParams, buildAdaptPrompt,
  describeSent, draftCenterKey, mockDraft,
} from "../src/lib/aiDraftRules";
import { CATALOG, CATALOG_VERSION, catalogFor } from "../src/lib/exerciseCatalog";
import { centerNow } from "../src/lib/portalRules";
import { APPROACHES, approachAllowed, normalizeForLint } from "../src/lib/practiceRules";
import { EVAL_CONFIRM_FLAG, buildEvalCases, evalPreflight, evalStrata, reviewSample } from "../scripts/ai-eval";

// ── fetch simulado ──────────────────────────────────────────────────────────

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown>; raw: string };
type Reply = (call: Call, signal: AbortSignal | undefined) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
let calls: Call[] = [];
let replies: Reply[] = [];

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof init?.body === "string" ? init.body : "";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = { url: String(input), headers, body: raw ? JSON.parse(raw) : {}, raw };
    calls.push(call);
    const next = replies.shift();
    if (!next) throw new Error("fetch inesperado");
    return next(call, init?.signal ?? undefined);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const completion = (content: unknown, usage = { prompt_tokens: 1000, completion_tokens: 400, cost: 0.0012 }) =>
  json({
    id: "gen-1", model: "openai/gpt-4o-mini", usage,
    choices: [{ finish_reason: "stop", message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }],
  });
const ok = (content: unknown): Reply => () => completion(content);
const fail = (status: number, body: unknown = { error: { code: status, message: "detalle del proveedor con TEXTO_SECRETO" } }): Reply => () => json(body, status);
// No contesta hasta que se termina el plazo
const hang: Reply = (_c, signal) => new Promise<Response>((_, reject) => {
  signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
});

// ── Logs: se guardan para revisar que no tengan datos ───────────────────────

let logs: string[] = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function captureLogs() {
  logs = [];
  for (const k of ["log", "warn", "error", "info"] as const) {
    console[k] = (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }
}
function restoreLogs() {
  Object.assign(console, realConsole);
}

// ── Base de prueba en memoria ───────────────────────────────────────────────

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null; count?: number | null };

class FakeDb {
  patients: Row[] = [];
  drafts: Row[] = [];
  // chat_rate_limits (script 8): key, bucket ("10m" | "day"), bucket_start, hits
  rateRows: Row[] = [];
  missingDrafts = false;
  insertFails = false;
  patientsOffline = false;
  rateAllowed = true; // lo que contesta chat_rate_limit_hit
  rateError = false; // chat_rate_limit_hit falla siempre
  rpcFailKey: string | null = null; // chat_rate_limit_hit falla solo con esta clave
  rateReadFails = false; // no se puede leer chat_rate_limits
  rpcCalls: { fn: string; args: Row }[] = [];
  patientReads: { via: "admin" | "user"; cols: string; token: string | null }[] = [];

  // Como chat_rate_limit_hit: suma 1 en las dos ventanas de la clave (atómico)
  hit(key: string) {
    for (const bucket of ["10m", "day"]) {
      const row = this.rateRows.find((r) => r.key === key && r.bucket === bucket);
      if (row) row.hits = Number(row.hits) + 1;
      else this.rateRows.push({ key, bucket, bucket_start: new Date().toISOString(), hits: 1 });
    }
  }
}

class FakeQuery implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" = "select";
  private cols = "*";
  private payload: Row = {};
  private mode: "many" | "one" | "maybe" = "many";
  private withCount = false;
  private max: number | null = null;

  constructor(private db: FakeDb, private table: string, private via: "admin" | "user", private token: string | null) {}

  select(cols = "*", opts: { count?: string } = {}) { this.cols = cols; this.withCount = !!opts.count; return this; }
  insert(row: Row) { this.op = "insert"; this.payload = row; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = "one"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then<A = Result, B = never>(okFn?: ((v: Result) => A | PromiseLike<A>) | null, failFn?: ((e: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return Promise.resolve().then(() => this.run()).then(okFn, failFn);
  }

  private run(): Result {
    if (this.table === "ai_drafts" && this.db.missingDrafts) {
      return { data: null, error: { code: "42P01", message: 'relation "public.ai_drafts" does not exist' } };
    }
    if (this.table === "patients") {
      this.db.patientReads.push({ via: this.via, cols: this.cols, token: this.token });
      if (this.db.patientsOffline) return { data: null, error: { code: "", message: "TypeError: fetch failed" } };
    }
    if (this.table === "chat_rate_limits" && this.db.rateReadFails) return { data: null, error: { code: "57014", message: "canceling statement" } };
    const rows = this.table === "patients" ? this.db.patients
      : this.table === "ai_drafts" ? this.db.drafts
        : this.table === "chat_rate_limits" ? this.db.rateRows : [];
    if (this.op === "insert") {
      if (this.db.insertFails) return { data: null, error: { code: "23514", message: "violates check constraint" } };
      const row: Row = { id: randomUUID(), created_at: new Date().toISOString(), used_at: null, ...this.payload };
      rows.push(row);
      return { data: { id: row.id }, error: null };
    }
    let out = rows.filter((r) => this.filters.every((f) => f(r)));
    const count = out.length;
    if (this.max !== null) out = out.slice(0, this.max);
    const cols = this.cols === "*" ? [] : this.cols.split(",").map((c) => c.trim());
    const pick = (r: Row) => (cols.length ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : { ...r });
    if (this.mode === "maybe") return { data: out.length ? pick(out[0]) : null, error: null };
    if (this.mode === "one") return out.length === 1 ? { data: pick(out[0]), error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    return { data: out.map(pick), error: null, count: this.withCount ? count : null };
  }
}

const PEPPER = "p".repeat(32);
const hmacKey = (s: string) => createHmac("sha256", PEPPER).update(s).digest("hex");
// La clave del contador del tope del centro de hoy (como la arma el servidor)
const centerKey = () => hmacKey(draftCenterKey(centerNow().date));
const centerHits = (db: FakeDb) => db.rateRows.filter((r) => r.key === centerKey() && r.bucket === "day").reduce((n, r) => n + Number(r.hits), 0);

function fakeCtx(db: FakeDb): Ctx {
  const admin = {
    from: (t: string) => new FakeQuery(db, t, "admin", null),
    rpc: async (fn: string, args: Row) => {
      db.rpcCalls.push({ fn, args });
      if (db.rateError || (db.rpcFailKey !== null && args.p_key === db.rpcFailKey)) {
        return { data: null, error: { code: "PGRST202", message: "function not found" } };
      }
      db.hit(String(args.p_key));
      return { data: db.rateAllowed, error: null };
    },
  };
  const asUser = (token: string) => ({ from: (t: string) => new FakeQuery(db, t, "user", token) });
  return { admin, anon: () => admin, asUser, pepper: PEPPER } as unknown as Ctx;
}

// ── Datos ───────────────────────────────────────────────────────────────────

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P_F986 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const P_NO_BIRTH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const year = Number(centerNow().date.slice(0, 4));
const BIRTH = `${year - 7}-01-01`; // 7 años
const STAFF = { user_id: "u-prof-1", email: "prof@cimt.test", token: "token-del-profesional", clinical: true };
const ENV = { PORTAL_CLINICAL_FEATURES: "consent,practice,ai", OPENROUTER_DRAFT_API_KEY: "sk-or-prueba" };

function seed(): FakeDb {
  const db = new FakeDb();
  db.patients = [
    { id: P, first_name: "Martín", last_name: "Pérez", dni: "50111222", birth_date: BIRTH, diagnosis_code: "F98.5" },
    { id: P_F986, first_name: "Lucía", last_name: "Gómez", dni: "50111333", birth_date: `${year - 10}-01-01`, diagnosis_code: "F98.6" },
    { id: P_NO_BIRTH, first_name: "Sofía", last_name: "Ruiz", dni: "50111444", birth_date: null, diagnosis_code: "F98.5" },
  ];
  return db;
}

const REQ: AiDraftRequest = {
  patient_id: P,
  catalog_ids: ["ef-tiempo-especial", "ef-turnos-mesa"],
  approach: "entorno_familia",
  practiced_in_session: false,
  quien_acompana: "adulto_con_chico",
  contexto: ["casa", "juego"],
  minutos: 10,
  dificultad: "igual",
  adaptaciones: ["consignas_cortas"],
  intereses: ["dinosaurios", "futbol"],
};

function built(req: AiDraftRequest = REQ) {
  const r = buildAdaptParams(req, { age: 7, diagnosis_code: "F98.5" });
  if (!r.ok) throw new Error(r.error);
  return r;
}
const goodDraft = (req: AiDraftRequest = REQ): ExerciseDraft => {
  const b = built(req);
  return mockDraft(b.params, b.entries);
};

async function failure(p: Promise<unknown>): Promise<PortalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PortalError) return e;
    throw e;
  }
  throw new Error("se esperaba un error y no lo hubo");
}

beforeEach(() => {
  calls = [];
  replies = [];
  installFetch();
  captureLogs();
});
afterEach(() => {
  restoreLogs();
});
afterAll(() => {
  globalThis.fetch = realFetch;
  restoreLogs();
});

// Nada de esto puede aparecer en lo que viaja ni en los logs
const IDENTIFYING = [P, BIRTH, "F98", "Martín", "Pérez", "50111222", STAFF.email, STAFF.user_id, STAFF.token];

// ── OpenRouter ──────────────────────────────────────────────────────────────

describe("openrouterJson", () => {
  const req = {
    model: "openai/gpt-4o-mini", apiKey: "sk-or-prueba",
    messages: [{ role: "system" as const, content: "reglas" }, { role: "user" as const, content: "pedido" }],
    response_format: DRAFT_RESPONSE_FORMAT, provider: AI_PROVIDER_PREFS,
    temperature: AI_REQUEST_OPTIONS.temperature, max_tokens: AI_REQUEST_OPTIONS.max_tokens, title: AI_TITLE_HEADER,
  };

  test("el cuerpo: sin campo user, sin herramientas, con las preferencias de proveedor y el esquema", () => {
    const body = openrouterBody(req);
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "provider", "response_format", "stream", "temperature"]);
    expect(body).not.toHaveProperty("user");
    expect(body).not.toHaveProperty("tools");
    expect(body.provider).toEqual({ data_collection: "deny", zdr: true, require_parameters: true });
    expect(body.stream).toBe(false);
  });

  test("manda el pedido a OpenRouter con la clave y X-Title, y devuelve el texto y el uso", async () => {
    replies.push(() => completion("{\"a\":1}", { prompt_tokens: 12, completion_tokens: 5, cost: 0.0001 }));
    const r = await openrouterJson(req);
    expect(r).toEqual({ ok: true, status: 200, content: "{\"a\":1}", model: "openai/gpt-4o-mini", finish_reason: "stop", usage: { tokens_in: 12, tokens_out: 5, cost_usd: 0.0001 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OPENROUTER_URL);
    expect(calls[0].headers.authorization).toBe("Bearer sk-or-prueba");
    expect(calls[0].headers["x-title"]).toBe("CIMT - Borradores");
    expect(calls[0].body).not.toHaveProperty("user");
  });

  test("errores: status, error adentro de un 200, sin texto, sin conexión y plazo", async () => {
    replies.push(fail(500));
    expect(await openrouterJson(req)).toMatchObject({ ok: false, status: 500, code: "HTTP", retryable: true });
    replies.push(fail(400));
    expect(await openrouterJson(req)).toMatchObject({ ok: false, status: 400, code: "HTTP", retryable: false });
    replies.push(fail(401));
    expect(await openrouterJson(req)).toMatchObject({ ok: false, status: 401, code: "HTTP", retryable: false });
    replies.push(fail(429));
    expect(await openrouterJson(req)).toMatchObject({ ok: false, status: 429, code: "HTTP", retryable: false });
    replies.push(() => json({ error: { code: 502, message: "TEXTO_SECRETO" } }));
    expect(await openrouterJson(req)).toMatchObject({ ok: false, code: "UPSTREAM", retryable: true });
    replies.push(() => json({ choices: [{ error: { code: 502, message: "TEXTO_SECRETO" }, message: { content: "" } }] }));
    expect(await openrouterJson(req)).toMatchObject({ ok: false, code: "UPSTREAM" });
    replies.push(() => completion(""));
    expect(await openrouterJson(req)).toMatchObject({ ok: false, code: "EMPTY", retryable: true });
    replies.push(() => new Response("<html>TEXTO_SECRETO</html>", { status: 200 }));
    expect(await openrouterJson(req)).toMatchObject({ ok: false, code: "BAD_RESPONSE" });
    replies.push(() => { throw new TypeError("fetch failed"); });
    expect(await openrouterJson(req)).toMatchObject({ ok: false, status: null, code: "NETWORK", retryable: true });
    replies.push(hang);
    expect(await openrouterJson({ ...req, signal: AbortSignal.timeout(20) })).toMatchObject({ ok: false, code: "TIMEOUT", retryable: false });
  });

  test("los logs tienen solo status y código, nunca el cuerpo", async () => {
    replies.push(fail(400, { error: { code: 400, message: "TEXTO_SECRETO", metadata: { raw: "TEXTO_SECRETO" } } }));
    await openrouterJson({ ...req, messages: [{ role: "user", content: "PEDIDO_SECRETO" }] });
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l).not.toContain("TEXTO_SECRETO");
      expect(l).not.toContain("PEDIDO_SECRETO");
      expect(l).not.toContain("sk-or-prueba");
    }
    expect(logs.join("\n")).toContain("400");
  });
});

// ── El camino del endpoint ──────────────────────────────────────────────────

describe("createAdaptDraft: borrador bien armado", () => {
  test("devuelve el borrador, lo que se mandó y el id del registro", async () => {
    const db = seed();
    replies.push(ok(goodDraft()));
    const out = await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    const b = built();

    expect(out.demo).toBe(false);
    expect(out.draft.ejercicios.map((e) => e.catalogo_id)).toEqual(["ef-tiempo-especial", "ef-turnos-mesa"]);
    expect(out.sent).toEqual(describeSent(b.params, b.entries));
    expect(db.drafts).toHaveLength(1);
    expect(out.draft_id).toBe(db.drafts[0].id as string);

    // El registro: exactamente lo que se mandó, quién lo pidió y el resultado
    const row = db.drafts[0];
    expect(row).toMatchObject({
      kind: "adaptacion", patient_id: P, requested_by_email: STAFF.email, model: "openai/gpt-4o-mini",
      prompt_version: PROMPT_VERSION, catalog_version: CATALOG_VERSION, status: "generado", error_code: null,
      tokens_in: 1000, tokens_out: 400, cost_usd: 0.0012,
    });
    expect(row.params).toEqual(b.params);
    expect(row.output).toEqual(out.draft);
    expect(row.flags).toEqual(out.flags);
    expect(typeof row.latency_ms).toBe("number");
  });

  test("al proveedor va solo el prompt de las reglas: sin nada que identifique al paciente ni a quien pide", async () => {
    const db = seed();
    replies.push(ok(goodDraft()));
    await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    expect(calls).toHaveLength(1);
    const { body, raw, headers } = calls[0];
    const b = built();
    const prompt = buildAdaptPrompt(b.params, b.entries);
    expect(body.messages).toEqual([{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }]);
    expect(body).not.toHaveProperty("user");
    expect(body.response_format).toEqual(JSON.parse(JSON.stringify(DRAFT_RESPONSE_FORMAT)));
    expect(body.provider).toEqual({ ...AI_PROVIDER_PREFS });
    expect(body.temperature).toBe(0.4);
    expect(body.max_tokens).toBe(1500);
    expect(headers["x-title"]).toBe(AI_TITLE_HEADER);
    for (const s of IDENTIFYING) expect(raw).not.toContain(s);
    // La franja sí, la edad exacta no
    expect(raw).toContain("6-8");
  });

  test("F98.6 (ritmo y claridad, un enfoque que solo se ofrece para ese diagnóstico): los mensajes no nombran el diagnóstico", async () => {
    const db = seed();
    const req: AiDraftRequest = { ...REQ, patient_id: P_F986, approach: "ritmo_y_claridad", catalog_ids: ["rc-tres-cuadros"] };
    const b = buildAdaptParams(req, { age: 10, diagnosis_code: "F98.6" });
    if (!b.ok) throw new Error(b.error);
    replies.push(ok(mockDraft(b.params, b.entries)));
    const out = await createAdaptDraft(fakeCtx(db), STAFF, req, { env: ENV });
    expect(calls).toHaveLength(1);
    const messages = calls[0].body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    for (const m of messages) {
      const t = normalizeForLint(m.content);
      for (const re of [/\bfarfull\w*/, /\btartamudez\b/, /\btartamud(o|a|os|as)\b/, /\bdiagnostic\w*/, /\bcie\b/]) {
        expect([m.role, re.source, re.test(t)]).toEqual([m.role, re.source, false]);
      }
      // Ningún código CIE-10
      expect([m.role, m.content.match(/\b[A-Za-z]\d{2}(?:\.\d{1,2})?\b/)?.[0] ?? null]).toEqual([m.role, null]);
    }
    // Ni del paciente: nombre, DNI, id ni fecha de nacimiento
    for (const s of [P_F986, "Lucía", "Gómez", "50111333", `${year - 10}-01-01`]) expect(calls[0].raw).not.toContain(s);
    // Lo que queda registrado y lo que ve el profesional, tampoco
    expect(JSON.stringify(db.drafts[0].params)).not.toMatch(/farfull|F98/i);
    expect(out.sent.exact).not.toMatch(/farfull|F98/i);
    expect(db.drafts[0].prompt_version).toBe("adapt-2026-10-v4");
  });

  test("lee del paciente solo la fecha de nacimiento y el diagnóstico, con la sesión de quien pide; no se devuelven", async () => {
    const db = seed();
    replies.push(ok(goodDraft()));
    const out = await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    expect(db.patientReads).toEqual([{ via: "user", cols: "birth_date, diagnosis_code", token: STAFF.token }]);
    const text = JSON.stringify(out);
    for (const s of [BIRTH, "F98", "Martín", "50111222"]) expect(text).not.toContain(s);
  });

  test("el límite por persona y el tope del centro usan claves con hash (no el usuario ni una clave adivinable)", async () => {
    const db = seed();
    replies.push(ok(goodDraft()));
    await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    // Primero la persona, después la reserva del centro
    expect(db.rpcCalls).toEqual([
      { fn: "chat_rate_limit_hit", args: { p_key: hmacKey(`draft:${STAFF.user_id}`) } },
      { fn: "chat_rate_limit_hit", args: { p_key: centerKey() } },
    ]);
    expect(String(db.rpcCalls[0].args.p_key)).not.toContain(STAFF.user_id);
    expect(String(db.rpcCalls[1].args.p_key)).not.toContain("draft-center");
    expect(centerHits(db)).toBe(1);
  });

  test("ejercicios en otro orden: se devuelven en el orden pedido, con las alertas recalculadas", async () => {
    const db = seed();
    const d = goodDraft();
    d.ejercicios.reverse();
    d.ejercicios[0].pasos[0] = "Hablá más despacio mientras arman la torre.";
    replies.push(ok(d));
    const out = await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    expect(out.draft.ejercicios.map((e) => e.catalogo_id)).toEqual(["ef-tiempo-especial", "ef-turnos-mesa"]);
    // "más despacio" estaba en ef-turnos-mesa, que ahora es el segundo
    expect(out.flags).toContainEqual({ exercise: 1, field: "pasos", term: "más despacio" });
  });

  test("nada del borrador ni del paciente queda en los logs", async () => {
    const db = seed();
    replies.push(() => completion("no es json TEXTO_SECRETO"));
    replies.push(ok(goodDraft()));
    await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    const all = logs.join("\n");
    for (const s of [...IDENTIFYING, "TEXTO_SECRETO", "Tiempo especial", "dinosaurios"]) expect(all).not.toContain(s);
  });
});

describe("createAdaptDraft: quién puede y cuándo está disponible", () => {
  test("Administración (sin rol clínico): 403 y no se llama a nadie", async () => {
    const db = seed();
    const e = await failure(createAdaptDraft(fakeCtx(db), { ...STAFF, clinical: false }, REQ, { env: ENV }));
    expect(e.status).toBe(403);
    expect(calls).toHaveLength(0);
    expect(db.patientReads).toHaveLength(0);
  });

  test("sin la etapa \"ai\" o sin clave: 503 AI_UNAVAILABLE, sin leer al paciente", async () => {
    const db = seed();
    for (const env of [
      { ...ENV, PORTAL_CLINICAL_FEATURES: "consent,practice" },
      { PORTAL_CLINICAL_FEATURES: "ai" },
      { PORTAL_CLINICAL_FEATURES: "ai", OPENROUTER_DRAFT_API_KEY: "  " },
    ]) {
      const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env }));
      expect(e.status).toBe(503);
      expect(e.message).toBe(AI_ERROR.unavailable);
      expect(e.extra.code).toBe("AI_UNAVAILABLE");
    }
    expect(calls).toHaveLength(0);
    expect(db.patientReads).toHaveLength(0);
  });

  test("la clave general sirve si no hay una aparte", async () => {
    const db = seed();
    replies.push(ok(goodDraft()));
    await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: { PORTAL_CLINICAL_FEATURES: "ai", OPENROUTER_API_KEY: "sk-or-general" } });
    expect(calls[0].headers.authorization).toBe("Bearer sk-or-general");
  });

  test("el modelo sale de OPENROUTER_DRAFT_MODEL", async () => {
    const db = seed();
    replies.push(ok(goodDraft()));
    await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: { ...ENV, OPENROUTER_DRAFT_MODEL: "anthropic/otro-modelo" } });
    expect(calls[0].body.model).toBe("anthropic/otro-modelo");
    expect(db.drafts[0].model).toBe("anthropic/otro-modelo");
  });

  test("aiAvailable", () => {
    expect(aiAvailable(ENV)).toBe(true);
    expect(aiAvailable({ ...ENV, PORTAL_CLINICAL_FEATURES: "practice" })).toBe(false);
    expect(aiAvailable({ PORTAL_CLINICAL_FEATURES: "ai" })).toBe(false);
  });
});

describe("createAdaptDraft: validación", () => {
  test("cuerpo inválido o paciente que no existe", async () => {
    const db = seed();
    expect((await failure(createAdaptDraft(fakeCtx(db), STAFF, null, { env: ENV }))).status).toBe(400);
    expect((await failure(createAdaptDraft(fakeCtx(db), STAFF, [], { env: ENV }))).status).toBe(400);
    expect((await failure(createAdaptDraft(fakeCtx(db), STAFF, { ...REQ, patient_id: "x" }, { env: ENV }))).status).toBe(400);
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, { ...REQ, patient_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, { env: ENV }));
    expect(e.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test("sin conexión al leer el paciente: 503", async () => {
    const db = seed();
    db.patientsOffline = true;
    expect((await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }))).status).toBe(503);
  });

  test("enfoque que no corresponde al diagnóstico, a la edad o sin la casilla de sesión: 400", async () => {
    const db = seed();
    // F98.6: solo ritmo y claridad (y otras áreas)
    let e = await failure(createAdaptDraft(fakeCtx(db), STAFF, { ...REQ, patient_id: P_F986 }, { env: ENV }));
    expect(e.status).toBe(400);
    expect(e.message).toContain("diagnóstico");
    // 7 años: tartamudear fácil es desde los 9
    e = await failure(createAdaptDraft(fakeCtx(db), STAFF, { ...REQ, approach: "tartamudear_facil", catalog_ids: ["tf-trabas-proposito"], practiced_in_session: true }, { env: ENV }));
    expect(e.status).toBe(400);
    // Sin fecha de nacimiento no hay franja
    e = await failure(createAdaptDraft(fakeCtx(db), STAFF, { ...REQ, patient_id: P_NO_BIRTH }, { env: ENV }));
    expect(e.status).toBe(400);
    expect(e.message).toContain("fecha de nacimiento");
    // Un ejercicio de otro enfoque
    e = await failure(createAdaptDraft(fakeCtx(db), STAFF, { ...REQ, catalog_ids: ["hf-tortuga-suave"] }, { env: ENV }));
    expect(e.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.drafts).toHaveLength(0);
  });
});

describe("createAdaptDraft: límites", () => {
  test("límite por persona: 429 AI_LIMIT y no se llama al proveedor", async () => {
    const db = seed();
    db.rateAllowed = false;
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect(e.status).toBe(429);
    expect(e.message).toBe(AI_ERROR.limit);
    expect(e.extra.code).toBe("AI_LIMIT");
    expect(calls).toHaveLength(0);
    expect(db.drafts).toHaveLength(0);
  });

  test("si no se puede revisar el límite, no se pide (503)", async () => {
    const db = seed();
    db.rateError = true;
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect(e.status).toBe(503);
    expect(e.extra.code).toBe("AI_UNAVAILABLE");
    expect(calls).toHaveLength(0);
  });

  test("tope del centro por día (cuentan los de hoy en Tucumán, también los fallidos)", async () => {
    const db = seed();
    const today = centerDayStart();
    db.drafts = [
      { id: randomUUID(), status: "generado", created_at: new Date(Date.parse(today) + 60_000).toISOString() },
      { id: randomUUID(), status: "error", created_at: new Date(Date.parse(today) + 120_000).toISOString() },
      { id: randomUUID(), status: "generado", created_at: new Date(Date.parse(today) - 60_000).toISOString() }, // ayer
    ];
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: { ...ENV, AI_DRAFT_DAILY_CAP: "2" } }));
    expect(e.status).toBe(429);
    expect(e.extra.code).toBe("AI_LIMIT");
    expect(calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);

    replies.push(ok(goodDraft()));
    await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: { ...ENV, AI_DRAFT_DAILY_CAP: "3" } });
    expect(calls).toHaveLength(1);
  });

  test("sin el script 26 (falta ai_drafts): 503 AI_UNAVAILABLE antes de llamar al proveedor", async () => {
    const db = seed();
    db.missingDrafts = true;
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect(e.status).toBe(503);
    expect(e.extra.code).toBe("AI_UNAVAILABLE");
    expect(calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  test("pedidos simultáneos cerca del tope: nunca pasan el tope (el lugar se reserva antes de llamar al proveedor)", async () => {
    const CAP = 5;
    const db = seed();
    // Hoy ya hubo 3 pedidos (registrados y con su reserva): quedan 2 lugares
    const today = Date.parse(centerDayStart());
    for (let i = 0; i < CAP - 2; i++) {
      db.drafts.push({ id: randomUUID(), status: "generado", created_at: new Date(today + (i + 1) * 60_000).toISOString() });
      db.hit(centerKey());
    }
    for (let i = 0; i < 6; i++) replies.push(ok(goodDraft()));
    const env = { ...ENV, AI_DRAFT_DAILY_CAP: String(CAP) };
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => createAdaptDraft(fakeCtx(db), STAFF, REQ, { env })));
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    expect(accepted).toBeLessThanOrEqual(2);
    expect(calls).toHaveLength(accepted);
    expect(db.drafts.length).toBeLessThanOrEqual(CAP);
    for (const r of results) {
      if (r.status === "rejected") expect([(r.reason as PortalError).status, (r.reason as PortalError).extra.code]).toEqual([429, "AI_LIMIT"]);
    }
  });

  test("pedidos simultáneos lejos del tope: pasan todos", async () => {
    const db = seed();
    for (let i = 0; i < 6; i++) replies.push(ok(goodDraft()));
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(calls).toHaveLength(6);
    expect(centerHits(db)).toBe(6);
  });

  test("también cuentan los pedidos que no se pudieron registrar: con tope 2, el tercero no llega al proveedor", async () => {
    const db = seed();
    db.insertFails = true;
    const env = { ...ENV, AI_DRAFT_DAILY_CAP: "2" };
    for (let i = 0; i < 3; i++) replies.push(ok(goodDraft()));
    for (let i = 0; i < 2; i++) {
      // Sin registro no se devuelve el borrador, pero el proveedor ya cobró
      expect((await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env }))).status).toBe(503);
    }
    expect(calls).toHaveLength(2);
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env }));
    expect([e.status, e.extra.code]).toEqual([429, "AI_LIMIT"]);
    expect(calls).toHaveLength(2);
    expect(db.drafts).toHaveLength(0);
  });

  test("si no se puede reservar el lugar o leer el tope del centro, no se pide (503)", async () => {
    let db = seed();
    db.rpcFailKey = centerKey();
    let e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect([e.status, e.extra.code]).toEqual([503, "AI_UNAVAILABLE"]);
    db = seed();
    db.rateReadFails = true;
    e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect([e.status, e.extra.code]).toEqual([503, "AI_UNAVAILABLE"]);
    expect(calls).toHaveLength(0);
    // En el log, solo códigos
    expect(logs.join("\n")).toContain("57014");
    expect(logs.join("\n")).not.toContain(centerKey());
  });

  test("centerDayStart: medianoche de Tucumán (UTC-3)", () => {
    // 02:00 UTC del 14 = 23:00 del 13 en Tucumán
    expect(centerDayStart(new Date("2026-10-14T02:00:00.000Z"))).toBe("2026-10-13T03:00:00.000Z");
    expect(centerDayStart(new Date("2026-10-14T15:42:31.250Z"))).toBe("2026-10-14T03:00:00.000Z");
  });
});

describe("createAdaptDraft: reintento, plazo y errores", () => {
  test("JSON inválido y después bien: un reintento, con el uso sumado", async () => {
    const db = seed();
    replies.push(ok("{\"intro\": "));
    replies.push(ok(goodDraft()));
    const out = await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    expect(calls).toHaveLength(2);
    expect(out.draft.ejercicios).toHaveLength(2);
    expect(db.drafts[0]).toMatchObject({ status: "generado", tokens_in: 2000, tokens_out: 800, cost_usd: 0.0024 });
  });

  test("frases bloqueadas por el lint: se reintenta", async () => {
    const db = seed();
    const bad = goodDraft();
    bad.ejercicios[0].pasos[1] = "Que hable sin trabarse durante el juego.";
    replies.push(ok(bad));
    replies.push(ok(goodDraft()));
    const out = await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(out.draft)).not.toContain("sin trabarse");
  });

  test("negar una palabra bloqueada («no es un castigo») también bloquea: los dos pedidos llevan la regla y, si vuelve a pasar, AI_FAILED con LINT_BLOCK", async () => {
    const db = seed();
    const denial = goodDraft();
    denial.ejercicios[0].rol_del_adulto = "Esto no es un castigo: es un rato de juego juntos.";
    replies.push(ok(denial));
    replies.push(ok(denial));
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect([e.status, e.extra.code]).toEqual([502, "AI_FAILED"]);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const [system] = c.body.messages as { role: string; content: string }[];
      expect(system.role).toBe("system");
      expect(system.content).toContain("No uses las palabras «castigo», «cura»");
      expect(system.content).toContain("ni siquiera para negarlas");
    }
    expect(db.drafts[0]).toMatchObject({ status: "error", error_code: "LINT_BLOCK", prompt_version: PROMPT_VERSION, output: null, flags: [] });
    expect(PROMPT_VERSION).toBe("adapt-2026-10-v4");
    // El motivo queda en los intentos (las frases que bloquearon), no en los logs
    replies.push(ok(denial));
    replies.push(ok(goodDraft()));
    const b = built();
    const gen = await generateAdaptDraft(b.params, b.entries, { apiKey: "k", model: "m" });
    expect(gen.ok).toBe(true);
    expect(gen.attempts.map((a) => [a.code, a.terms ?? null])).toEqual([["LINT_BLOCK", ["castigo"]], [null, null]]);
    expect(logs.join("\n")).not.toContain("castigo");
  });

  test("falta un ejercicio pedido: se reintenta; si vuelve a faltar, AI_FAILED con CATALOG", async () => {
    const db = seed();
    const partial = goodDraft();
    partial.ejercicios = partial.ejercicios.slice(0, 1);
    replies.push(ok(partial));
    replies.push(ok(partial));
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect(e.status).toBe(502);
    expect(e.extra.code).toBe("AI_FAILED");
    expect(calls).toHaveLength(2);
    expect(db.drafts[0]).toMatchObject({ status: "error", error_code: "CATALOG", output: null, flags: [] });
  });

  test("dos respuestas inválidas: 502 AI_FAILED, con el error registrado y sin borrador", async () => {
    const db = seed();
    replies.push(ok("no es json"));
    replies.push(ok({ intro: "", ejercicios: [], nota_para_profesional: "", alertas: [] }));
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect(e.status).toBe(502);
    expect(e.message).toBe(AI_ERROR.failed);
    expect(e.extra.code).toBe("AI_FAILED");
    expect(calls).toHaveLength(2);
    expect(db.drafts).toHaveLength(1);
    expect(db.drafts[0]).toMatchObject({ status: "error", error_code: "SCHEMA", output: null, flags: [] });
    expect(db.drafts[0].params).toEqual(built().params);
  });

  test("falla del proveedor (500) y después bien: se reintenta", async () => {
    const db = seed();
    replies.push(fail(500));
    replies.push(ok(goodDraft()));
    await createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV });
    expect(calls).toHaveLength(2);
    expect(db.drafts[0].status).toBe("generado");
  });

  test("mal configurada (modelo inválido 400, clave 401, sin crédito 402, sin permiso 403, sin proveedor 404): 503 AI_UNAVAILABLE con su mensaje, sin reintento", async () => {
    for (const status of [400, 401, 402, 403, 404]) {
      const db = seed();
      calls = [];
      logs = [];
      replies.push(fail(status));
      replies.push(ok(goodDraft())); // no se tiene que usar
      const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
      expect([status, e.status, e.extra.code]).toEqual([status, 503, "AI_UNAVAILABLE"]);
      expect(e.message).toBe(AI_ERROR.misconfigured);
      expect(calls).toHaveLength(1);
      expect(db.drafts[0]).toMatchObject({ status: "error", error_code: `HTTP_${status}` });
      // En el log: el status y qué revisar, nunca el cuerpo
      const all = logs.join("\n");
      expect(all).toContain(`HTTP ${status}`);
      expect(all).not.toContain("TEXTO_SECRETO");
      replies = [];
    }
  });

  test("400 (modelo inválido): el log dice qué variable revisar", async () => {
    const db = seed();
    replies.push(fail(400, { error: { code: 400, message: "TEXTO_SECRETO is not a valid model ID" } }));
    await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: { ...ENV, OPENROUTER_DRAFT_MODEL: "openai/no-existe" } }));
    const all = logs.join("\n");
    expect(all).toContain("OPENROUTER_DRAFT_MODEL");
    expect(all).not.toContain("TEXTO_SECRETO");
    expect(calls).toHaveLength(1);
  });

  test("límite del proveedor (429): AI_FAILED sin reintento", async () => {
    const db = seed();
    replies.push(fail(429));
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect(e.status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  test("se terminó el plazo: AI_FAILED con TIMEOUT y sin reintento", async () => {
    const db = seed();
    replies.push(hang);
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV, budgetMs: 30, retryMinMs: 10 }));
    expect(e.status).toBe(502);
    expect(e.extra.code).toBe("AI_FAILED");
    expect(calls).toHaveLength(1);
    expect(db.drafts[0]).toMatchObject({ status: "error", error_code: "TIMEOUT" });
  });

  test("no se reintenta si quedan menos de AI_RETRY_MIN_MS", async () => {
    const db = seed();
    // Reloj simulado: la primera respuesta tarda 16 s de los 25
    let clock = 0;
    replies.push(() => {
      clock += 16_000;
      return completion("no es json");
    });
    replies.push(ok(goodDraft()));
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV, now: () => clock }));
    expect(e.status).toBe(502);
    expect(calls).toHaveLength(1);
    expect(db.drafts[0]).toMatchObject({ status: "error", error_code: "INVALID_JSON", latency_ms: 16_000 });
  });

  test("con 15 s o menos usados sí se reintenta", async () => {
    let clock = 0;
    replies.push(() => {
      clock += 15_000;
      return completion("no es json");
    });
    replies.push(ok(goodDraft()));
    const b = built();
    const gen = await generateAdaptDraft(b.params, b.entries, { apiKey: "k", model: "m", now: () => clock });
    expect(gen.ok).toBe(true);
    expect(gen.attempts.map((a) => a.code)).toEqual(["INVALID_JSON", null]);
  });

  test("si no se puede registrar el pedido, no se devuelve el borrador (503)", async () => {
    const db = seed();
    db.insertFails = true;
    replies.push(ok(goodDraft()));
    const e = await failure(createAdaptDraft(fakeCtx(db), STAFF, REQ, { env: ENV }));
    expect(e.status).toBe(503);
    expect(e.extra.code).toBe("AI_UNAVAILABLE");
    expect(logs.join("\n")).toContain("23514");
  });
});

// ── Banco de prueba (sin red) ───────────────────────────────────────────────

describe("scripts/ai-eval.ts: los casos", () => {
  const cases = buildEvalCases(300, 1);

  test("300 pedidos válidos, todos con lo que acepta el servidor", () => {
    expect(cases).toHaveLength(300);
    for (const c of cases) {
      const r = buildAdaptParams(c.request, { age: c.age, diagnosis_code: c.diagnosis_code });
      expect(r.ok).toBe(true);
      expect(ageBand(c.age)).toBe(c.band);
    }
  });

  test("cubren todas las combinaciones permitidas de enfoque × franja, las adaptaciones y los intereses", () => {
    // Cada enfoque, en todas las franjas en que está permitido para alguna
    // edad y tiene ejercicios del catálogo (y en ninguna otra)
    const BAND_RANGE: Record<(typeof AGE_BANDS)[number], [number, number]> = {
      "2-5": [2, 5], "6-8": [6, 8], "9-12": [9, 12], "13-17": [13, 17], "18+": [18, 60],
    };
    const inCases = new Set(cases.map((c) => c.stratum));
    for (const a of APPROACHES) {
      for (const band of AGE_BANDS) {
        const [from, to] = BAND_RANGE[band];
        const ages = Array.from({ length: to - from + 1 }, (_, i) => from + i);
        const possible = ages.some((age) => approachAllowed(a, age, true) && catalogFor([a], age).length > 0);
        expect([`${a}|${band}`, inCases.has(`${a}|${band}`)]).toEqual([`${a}|${band}`, possible]);
      }
    }
    expect(inCases.size).toBe(evalStrata().length);
    // Todos los ejercicios del catálogo aparecen en algún pedido
    const used = new Set(cases.flatMap((c) => c.request.catalog_ids));
    expect(CATALOG.filter((e) => !used.has(e.id)).map((e) => e.id)).toEqual([]);
    const adapt = new Set(cases.flatMap((c) => c.request.adaptaciones));
    expect([...ADAPTATIONS].every((x) => adapt.has(x))).toBe(true);
    const interests = new Set(cases.flatMap((c) => c.request.intereses));
    expect([...INTERESTS].every((x) => interests.has(x))).toBe(true);
    const quien = new Set(cases.map((c) => c.request.quien_acompana));
    expect([...QUIEN_ACOMPANA].every((x) => quien.has(x))).toBe(true);
    // Hay pedidos sin adaptaciones y sin intereses, y con varios ejercicios
    expect(cases.some((c) => !c.request.adaptaciones.length)).toBe(true);
    expect(cases.some((c) => !c.request.intereses.length)).toBe(true);
    expect(cases.some((c) => c.request.catalog_ids.length > 1)).toBe(true);
  });

  test("la misma semilla da el mismo banco; la muestra para revisar es estratificada", () => {
    expect(buildEvalCases(300, 1)).toEqual(cases);
    const sample = reviewSample(cases);
    expect(sample).toHaveLength(60);
    expect(new Set(sample).size).toBe(60);
    const strataInSample = new Set(cases.filter((c) => sample.includes(c.id)).map((c) => c.stratum));
    expect(strataInSample.size).toBe(evalStrata().length);
  });

});

describe("scripts/ai-eval.ts: no gasta crédito sin confirmación", () => {
  // Sin process.env: lo que Bun haya cargado del .env no cambia nada
  test("evalPreflight: sin --confirmo-gasto no arranca aunque haya clave; después pide la salida y la clave", () => {
    const KEY = { OPENROUTER_DRAFT_API_KEY: "sk-or-falsa" };
    let r = evalPreflight(["salida"], KEY);
    expect(r).toMatchObject({ ok: false, exitCode: 2 });
    expect(r.ok ? "" : r.message).toContain(EVAL_CONFIRM_FLAG);
    r = evalPreflight(["salida", "--n", "300"], { OPENROUTER_API_KEY: "sk-or-falsa" });
    expect(r).toMatchObject({ ok: false, exitCode: 2 });
    r = evalPreflight([EVAL_CONFIRM_FLAG], KEY);
    expect(r).toMatchObject({ ok: false, exitCode: 2 });
    r = evalPreflight(["salida", EVAL_CONFIRM_FLAG], {});
    expect(r).toMatchObject({ ok: false, exitCode: 1 });
    expect(r.ok ? "" : r.message).toContain("OPENROUTER_DRAFT_API_KEY");
    r = evalPreflight(["salida", EVAL_CONFIRM_FLAG, "--n", "12", "--seed", "3"], { ...KEY, OPENROUTER_DRAFT_MODEL: "x/m" });
    expect(r).toEqual({
      ok: true, apiKey: "sk-or-falsa", model: "x/m",
      args: { path: "salida", n: 12, concurrency: 4, seed: 3, confirmed: true },
    });
  });

  test("el script de verdad: no arranca sin la confirmación ni sin clave, no escribe el informe y no toca la red", () => {
    const script = resolve(import.meta.dir, "..", "scripts", "ai-eval.ts");
    // Carpeta vacía y --no-env-file: el hijo no carga ningún .env (el del
    // repo puede tener OPENROUTER_API_KEY)
    const dir = mkdtempSync(join(tmpdir(), "cimt-ai-eval-"));
    try {
      // Y por las dudas, sin red: si el hijo llamara a fetch, sale con 97
      const guard = join(dir, "sin-red.js");
      writeFileSync(guard, 'globalThis.fetch = () => { process.stderr.write("[sin-red] fetch bloqueado\\n"); process.exit(97); };\n');
      const base: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/^(VITE_)?OPENROUTER_/.test(k)) base[k] = v;
      const run = (cmd: string[], extra: Record<string, string> = {}) => {
        const r = Bun.spawnSync({
          cmd: [process.execPath, "--no-env-file", "--preload", guard, ...cmd],
          cwd: dir,
          env: { ...base, OPENROUTER_API_KEY: "", VITE_OPENROUTER_API_KEY: "", OPENROUTER_DRAFT_API_KEY: "", ...extra },
          stdout: "pipe",
          stderr: "pipe",
        });
        return { code: r.exitCode, err: r.stderr.toString() };
      };
      // La guarda funciona
      expect(run(["-e", "await fetch('http://127.0.0.1:9/')"]).code).toBe(97);

      const out = join(dir, "informe");
      // Con una clave (falsa) pero sin confirmar
      let r = run([script, out], { OPENROUTER_DRAFT_API_KEY: "sk-or-falsa" });
      expect(r.code).toBe(2);
      expect(r.err).toContain(EVAL_CONFIRM_FLAG);
      expect(r.err).not.toContain("[sin-red]");
      // Confirmado, pero sin clave
      r = run([script, out, EVAL_CONFIRM_FLAG]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("OPENROUTER_DRAFT_API_KEY");
      expect(r.err).not.toContain("[sin-red]");
      expect(existsSync(`${out}.json`)).toBe(false);
      expect(existsSync(`${out}.csv`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
