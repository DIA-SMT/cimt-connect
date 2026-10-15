// Banco de prueba de "Adaptar con ayuda de IA" (etapa D, diseño §4.6).
//
// Arma 300 pedidos sintéticos o más (AiDraftRequest) que cubren todas las
// combinaciones permitidas de enfoque × franja de edad, y reparte entre ellos
// las adaptaciones, los intereses, quién acompaña, dónde, los minutos y la
// dificultad. Cada pedido pasa por el MISMO camino del servidor:
// buildAdaptParams (lo que viaja) → generateAdaptDraft (server/lib/aiDrafts.ts:
// OpenRouter con el mismo prompt, las mismas preferencias de proveedor, el
// mismo plazo y el mismo reintento, y la revisión con parseExerciseDraft y el
// lint). No usa la base ni datos de pacientes: todo es sintético. Los límites
// por persona y el tope del centro no aplican acá.
//
// NO corre en CI ni en bun test: llama al proveedor con una clave real y
// gasta crédito (unos centavos de dólar por cada 100 con openai/gpt-4o-mini).
// No arranca sin --confirmo-gasto, aunque haya una clave: Bun carga solo el
// .env de la carpeta donde se lo corre, y ahí puede estar la clave de Migue.
// Sin OPENROUTER_DRAFT_API_KEY ni la de Migue (OPENROUTER_API_KEY o
// VITE_OPENROUTER_API_KEY) tampoco arranca. Si
// OpenRouter rechaza el pedido por la configuración (400, 401, 402, 403 o
// 404), se corta sin seguir pidiendo.
//
// Cómo correrlo (desde la raíz del repo):
//
//   PowerShell:
//     $env:Path = "$env:LOCALAPPDATA\Microsoft\WinGet\Links;$env:Path"
//     $env:OPENROUTER_DRAFT_API_KEY = "sk-or-..."            # o la de Migue (OPENROUTER_API_KEY)
//     $env:OPENROUTER_DRAFT_MODEL = "openai/gpt-4o-mini"     # opcional (si no, el de siempre)
//     bun scripts/ai-eval.ts C:\ruta\ai-eval-2026-10-14 --confirmo-gasto --n 300 --concurrency 4 --seed 1
//
//   bash:
//     OPENROUTER_DRAFT_API_KEY=sk-or-... bun scripts/ai-eval.ts /ruta/ai-eval --confirmo-gasto --n 300
//
//   <salida>: escribe <salida>.json (resumen, cada caso con lo que se mandó,
//   los intentos y el borrador, y la muestra para la revisión humana) y
//   <salida>.csv (una fila por caso). Si termina en .json o .csv se usa ese
//   nombre sin la extensión. Conviene dejarlo fuera del repo.
//   --confirmo-gasto  obligatorio: confirma que se va a gastar crédito
//   --n               cantidad de pedidos (300 por defecto; menos de 300 no cumple §4.6)
//   --concurrency     pedidos a la vez (4 por defecto)
//   --seed            semilla de las combinaciones (1 por defecto: mismo banco cada vez)
//
// Condición automática para lanzar (§4.6): todos con un borrador válido
// (esquema) y cero frases bloqueadas por el lint en cualquier intento,
// incluidos los que se salvaron con el reintento. Si no se cumple, sale con
// código 1. Después, la muestra estratificada ("review_sample", unas 60) la
// califican las fonoaudiólogas: adecuado, editable o inservible.
// Repetirlo cuando cambia el modelo, PROMPT_VERSION o CATALOG_VERSION.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ADAPTATIONS, AGE_BANDS, AI_CATALOG_MAX, AI_INTERESTS_MAX, AI_MINUTES, CONTEXTS, DIFFICULTIES, INTERESTS, PROMPT_VERSION,
  type Adaptacion, type AgeBand, type AiDraftRequest, type Contexto, type Interes, type QuienAcompana,
  buildAdaptParams, draftApiKey, draftModel, lintDraft, parseExerciseDraft,
} from "../src/lib/aiDraftRules";
import { CATALOG_VERSION, catalogFor } from "../src/lib/exerciseCatalog";
import { APPROACHES, type Approach, type CatalogEntry, approachAllowed } from "../src/lib/practiceRules";
import { type AdaptGeneration, generateAdaptDraft } from "../server/lib/aiDrafts";

// ── Los casos (sin red: lo usan también las pruebas) ────────────────────────

// Edades de ejemplo de cada franja (dos por franja, para cubrir los
// ejercicios del catálogo que empiezan o terminan dentro de una franja)
export const BAND_AGES: Record<AgeBand, readonly number[]> = {
  "2-5": [3, 5],
  "6-8": [6, 8],
  "9-12": [10, 12],
  "13-17": [14, 16],
  "18+": [19, 35],
};

// Un diagnóstico sintético para el que el enfoque corresponde (no viaja: solo
// sirve para que buildAdaptParams lo acepte, como en el servidor)
const DIAGNOSIS_FOR: Record<Approach, string | null> = {
  entorno_familia: "F98.5",
  habla_facil: "F98.5",
  tartamudear_facil: "F98.5",
  animarse: "F98.5",
  ritmo_y_claridad: "F98.6",
  escuela_y_lectura: null, // otras áreas: cualquier diagnóstico (o en evaluación)
  regulacion_y_rutinas: "F98.6",
};

// Quién acompaña, según la franja (lo que tiene sentido en la práctica)
const QUIEN_FOR: Record<AgeBand, readonly QuienAcompana[]> = {
  "2-5": ["adulto_con_chico"],
  "6-8": ["adulto_con_chico", "paciente_con_apoyo"],
  "9-12": ["adulto_con_chico", "paciente_con_apoyo", "paciente_solo"],
  "13-17": ["paciente_con_apoyo", "paciente_solo"],
  "18+": ["paciente_solo", "paciente_con_apoyo"],
};

export type EvalStratum = { approach: Approach; band: AgeBand; ages: number[] };

export type EvalCase = {
  id: string; // "c001"
  stratum: string; // "habla_facil|6-8"
  approach: Approach;
  band: AgeBand;
  age: number; // sintética (no viaja: el servidor la vuelve franja)
  diagnosis_code: string | null; // sintético (no viaja)
  request: AiDraftRequest;
};

// Enfoque × franja permitidos (con "Ya lo practicamos en sesión") que tienen
// al menos un ejercicio del catálogo
export function evalStrata(): EvalStratum[] {
  const out: EvalStratum[] = [];
  for (const approach of APPROACHES) {
    for (const band of AGE_BANDS) {
      const ages = BAND_AGES[band].filter((a) => approachAllowed(approach, a, true) && catalogFor([approach], a).length > 0);
      if (ages.length) out.push({ approach, band, ages });
    }
  }
  return out;
}

// Pseudoaleatorio con semilla (mulberry32): el mismo banco cada vez
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildEvalCases(n = 300, seed = 1): EvalCase[] {
  const strata = evalStrata();
  const rand = rng(seed);
  const pickOne = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const sample = <T>(xs: readonly T[], k: number): T[] => {
    const pool = [...xs];
    const got: T[] = [];
    while (got.length < k && pool.length) got.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    return got;
  };
  // Contadores que rotan: así todas las adaptaciones e intereses aparecen
  let adaptTurn = 0;
  let interestTurn = 0;
  const cases: EvalCase[] = [];
  for (let i = 0; i < n; i++) {
    const st = strata[i % strata.length];
    const round = Math.floor(i / strata.length);
    const age = st.ages[round % st.ages.length];
    const pool: CatalogEntry[] = catalogFor([st.approach], age);
    const r = rand();
    const k = Math.min(pool.length, AI_CATALOG_MAX, r < 0.5 ? 1 : r < 0.8 ? 2 : r < 0.93 ? 3 : 4);
    const catalogIds = sample(pool, Math.max(1, k)).map((e) => e.id);

    // Adaptaciones: ninguna en 1 de cada 4; si no, una que rota y a veces otra
    const adaptaciones = new Set<Adaptacion>();
    if (i % 4 !== 3) {
      adaptaciones.add(ADAPTATIONS[adaptTurn++ % ADAPTATIONS.length]);
      if (rand() < 0.35) adaptaciones.add(pickOne(ADAPTATIONS));
    }
    // Intereses: de 0 a 3, rotando
    const howMany = i % 5 === 4 ? 0 : 1 + Math.floor(rand() * AI_INTERESTS_MAX);
    const intereses = new Set<Interes>();
    for (let j = 0; j < howMany; j++) intereses.add(INTERESTS[interestTurn++ % INTERESTS.length]);
    const contexto = new Set<Contexto>(sample(CONTEXTS, 1 + Math.floor(rand() * 2)));
    const minutes = st.band === "2-5" ? AI_MINUTES.filter((m) => m <= 10) : AI_MINUTES;

    const request: AiDraftRequest = {
      patient_id: "00000000-0000-4000-8000-000000000000", // sintético; no viaja
      catalog_ids: catalogIds,
      approach: st.approach,
      practiced_in_session: true,
      quien_acompana: pickOne(QUIEN_FOR[st.band]),
      contexto: CONTEXTS.filter((c) => contexto.has(c)),
      minutos: pickOne(minutes),
      dificultad: DIFFICULTIES[i % DIFFICULTIES.length],
      adaptaciones: ADAPTATIONS.filter((a) => adaptaciones.has(a)),
      intereses: INTERESTS.filter((x) => intereses.has(x)),
    };
    cases.push({
      id: `c${String(i + 1).padStart(3, "0")}`,
      stratum: `${st.approach}|${st.band}`,
      approach: st.approach,
      band: st.band,
      age,
      diagnosis_code: DIAGNOSIS_FOR[st.approach],
      request,
    });
  }
  return cases;
}

// Muestra estratificada para la revisión humana: rota por los estratos
// (enfoque × franja) hasta juntar "size"
export function reviewSample(cases: EvalCase[], size = 60): string[] {
  const byStratum = new Map<string, EvalCase[]>();
  for (const c of cases) byStratum.set(c.stratum, [...(byStratum.get(c.stratum) ?? []), c]);
  const groups = [...byStratum.values()];
  const out: string[] = [];
  for (let round = 0; out.length < Math.min(size, cases.length); round++) {
    let added = false;
    for (const g of groups) {
      if (out.length >= size) break;
      if (g[round]) {
        out.push(g[round].id);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}

// ── Correr el banco ─────────────────────────────────────────────────────────

type CaseResult = {
  id: string;
  stratum: string;
  approach: Approach;
  band: AgeBand;
  catalog_ids: string[];
  quien_acompana: QuienAcompana;
  contexto: Contexto[];
  minutos: number;
  dificultad: string;
  adaptaciones: Adaptacion[];
  intereses: Interes[];
  ok: boolean;
  error_code: string | null;
  attempts: { code: string | null; status: number | null; ms: number; terms?: string[] }[];
  block_terms: string[]; // frases bloqueadas en cualquier intento (violaciones)
  review_flags: string[]; // alertas del borrador final ("ejercicio:campo:frase")
  latency_ms: number;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  sent: unknown; // AiAdaptParams: exactamente lo que viajó
  draft: unknown; // el borrador (o null)
  in_review_sample: boolean;
};

// Sin esta opción el banco no arranca (gasta crédito real)
export const EVAL_CONFIRM_FLAG = "--confirmo-gasto";

export type EvalArgs = { path: string | null; n: number; concurrency: number; seed: number; confirmed: boolean };

export function parseArgs(argv: string[]): EvalArgs {
  const out: EvalArgs = { path: null, n: 300, concurrency: 4, seed: 1, confirmed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => Number(argv[++i]);
    if (a === "--n") out.n = next();
    else if (a === "--concurrency") out.concurrency = next();
    else if (a === "--seed") out.seed = next();
    else if (a === EVAL_CONFIRM_FLAG) out.confirmed = true;
    else if (!a.startsWith("--") && !out.path) out.path = a;
  }
  if (!Number.isInteger(out.n) || out.n < 1) out.n = 300;
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1) out.concurrency = 4;
  if (!Number.isInteger(out.seed)) out.seed = 1;
  return out;
}

const USAGE = `Uso: bun scripts/ai-eval.ts <salida> ${EVAL_CONFIRM_FLAG} [--n 300] [--concurrency 4] [--seed 1]`;

// Antes de tocar la red: la confirmación, la salida y la clave, en ese orden
// (sin la confirmación no se mira ni la clave). Puro: lo usan las pruebas.
export function evalPreflight(
  argv: string[],
  env: Record<string, string | undefined>,
): { ok: true; args: EvalArgs & { path: string }; apiKey: string; model: string } | { ok: false; exitCode: number; message: string } {
  const args = parseArgs(argv);
  if (!args.confirmed) {
    return {
      ok: false,
      exitCode: 2,
      message: `[ai-eval] No arranca sin ${EVAL_CONFIRM_FLAG}: llama a OpenRouter con una clave real y gasta crédito. ${USAGE}`,
    };
  }
  if (!args.path) return { ok: false, exitCode: 2, message: `[ai-eval] ${USAGE}` };
  const apiKey = draftApiKey(env);
  if (!apiKey) {
    return {
      ok: false,
      exitCode: 1,
      message: "[ai-eval] Falta OPENROUTER_DRAFT_API_KEY (o la de Migue: OPENROUTER_API_KEY / VITE_OPENROUTER_API_KEY). El banco de prueba usa una clave real y no corre sin ella.",
    };
  }
  return { ok: true, args: { ...args, path: args.path }, apiKey, model: draftModel(env) };
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(" ") : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const countBy = (xs: string[]) => xs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x]: (acc[x] ?? 0) + 1 }), {});

async function main() {
  const pre = evalPreflight(process.argv.slice(2), process.env);
  if (!pre.ok) {
    console.error(pre.message);
    process.exit(pre.exitCode);
  }
  const { args, apiKey, model } = pre;
  const base = resolve(args.path).replace(/\.(json|csv)$/i, "");
  if (args.n < 300) console.warn(`[ai-eval] Aviso: ${args.n} pedidos (el diseño pide 300 o más para lanzar).`);

  const cases = buildEvalCases(args.n, args.seed);
  const sampleIds = new Set(reviewSample(cases));
  const results: CaseResult[] = new Array(cases.length);
  console.log(`[ai-eval] ${cases.length} pedidos · modelo ${model} · prompt ${PROMPT_VERSION} · catálogo ${CATALOG_VERSION}`);

  let next = 0;
  let done = 0;
  // OpenRouter rechazó el pedido por la configuración: los demás fallarían igual
  const stop: { config: string | null } = { config: null };
  const started = Date.now();
  async function worker() {
    while (next < cases.length && !stop.config) {
      const idx = next++;
      const c = cases[idx];
      const built = buildAdaptParams(c.request, { age: c.age, diagnosis_code: c.diagnosis_code });
      if (!built.ok) throw new Error(`Caso ${c.id} inválido: ${built.error}`);
      let gen: AdaptGeneration;
      try {
        gen = await generateAdaptDraft(built.params, built.entries, { apiKey, model });
      } catch {
        gen = { ok: false, error_code: "EXCEPTION", unavailable: false, model, attempts: [], usage: { tokens_in: null, tokens_out: null, cost_usd: null }, latency_ms: 0 };
      }
      if (!gen.ok && gen.unavailable) {
        stop.config = gen.error_code;
        return;
      }
      // Se vuelve a revisar el borrador final por separado (esquema y lint)
      let ok = gen.ok;
      let errorCode = gen.ok ? null : gen.error_code;
      let reviewFlags: string[] = [];
      if (gen.ok) {
        const again = parseExerciseDraft(gen.draft, built.params.catalogo.ids, built.params.minutos, built.params.enfoque);
        if (!again.ok) {
          ok = false;
          errorCode = `RECHECK_${again.code}`;
        }
        reviewFlags = lintDraft(gen.draft, built.params.enfoque).flags.map((f) => `${f.exercise}:${f.field}:${f.term}`);
      }
      results[idx] = {
        id: c.id,
        stratum: c.stratum,
        approach: c.approach,
        band: c.band,
        catalog_ids: built.params.catalogo.ids,
        quien_acompana: built.params.quien_acompana,
        contexto: built.params.contexto,
        minutos: built.params.minutos,
        dificultad: built.params.dificultad,
        adaptaciones: built.params.adaptaciones,
        intereses: built.params.intereses,
        ok,
        error_code: errorCode,
        attempts: gen.attempts,
        block_terms: [...new Set(gen.attempts.flatMap((a) => (a.code === "LINT_BLOCK" ? a.terms ?? [] : [])))],
        review_flags: reviewFlags,
        latency_ms: Math.round(gen.latency_ms),
        tokens_in: gen.usage.tokens_in,
        tokens_out: gen.usage.tokens_out,
        cost_usd: gen.usage.cost_usd,
        sent: built.params,
        draft: gen.ok ? gen.draft : null,
        in_review_sample: sampleIds.has(c.id),
      };
      done++;
      if (done % 10 === 0 || done === cases.length) {
        const fails = results.filter((x) => x && !x.ok).length;
        console.log(`[ai-eval] ${done}/${cases.length} · fallidos ${fails} · ${Math.round((Date.now() - started) / 1000)} s`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, cases.length) }, () => worker()));
  if (stop.config) {
    console.error(`[ai-eval] OpenRouter rechazó el pedido por la configuración (${stop.config}): se cortó el banco sin informe. Revisá el modelo, la clave y el crédito.`);
    process.exit(1);
  }

  const ok = results.filter((r) => r.ok);
  const blockAttempts = results.flatMap((r) => r.attempts.filter((a) => a.code === "LINT_BLOCK"));
  const latencies = results.map((r) => r.latency_ms);
  const sum = (xs: (number | null)[]) => xs.reduce<number>((acc, x) => acc + (x ?? 0), 0);
  const summary = {
    generated_at: new Date().toISOString(),
    model,
    prompt_version: PROMPT_VERSION,
    catalog_version: CATALOG_VERSION,
    seed: args.seed,
    n: results.length,
    ok: ok.length,
    failed: results.length - ok.length,
    failed_by_code: countBy(results.filter((r) => !r.ok).map((r) => r.error_code ?? "-")),
    retried: results.filter((r) => r.attempts.length > 1).length,
    attempt_codes: countBy(results.flatMap((r) => r.attempts.map((a) => a.code ?? "OK"))),
    lint_block_attempts: blockAttempts.length,
    lint_block_terms: countBy(blockAttempts.flatMap((a) => a.terms ?? [])),
    review_flag_terms: countBy(results.flatMap((r) => r.review_flags.map((f) => f.split(":").slice(2).join(":")))),
    latency_ms: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: Math.max(0, ...latencies) },
    tokens_in: sum(results.map((r) => r.tokens_in)),
    tokens_out: sum(results.map((r) => r.tokens_out)),
    cost_usd: Math.round(sum(results.map((r) => r.cost_usd)) * 1e6) / 1e6,
    coverage: {
      strata: countBy(results.map((r) => r.stratum)),
      adaptaciones: countBy(results.flatMap((r) => r.adaptaciones)),
      intereses: countBy(results.flatMap((r) => r.intereses)),
      quien_acompana: countBy(results.map((r) => r.quien_acompana)),
      minutos: countBy(results.map((r) => String(r.minutos))),
      dificultad: countBy(results.map((r) => r.dificultad)),
    },
    review_sample: [...sampleIds],
    // §4.6: esquema válido en todos y cero frases bloqueadas en cualquier intento
    automatic_pass: results.length >= 300 && ok.length === results.length && blockAttempts.length === 0,
  };

  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify({ summary, cases: results }, null, 2), "utf8");
  const header = [
    "id", "estrato", "enfoque", "franja", "catalogo", "quien_acompana", "contexto", "minutos", "dificultad", "adaptaciones",
    "intereses", "ok", "error", "intentos", "frases_bloqueadas", "alertas", "latencia_ms", "tokens_in", "tokens_out", "costo_usd",
    "muestra_revision", "calificacion", "violaciones_clinicas", "comentario",
  ];
  const rows = results.map((r) => [
    r.id, r.stratum, r.approach, r.band, r.catalog_ids, r.quien_acompana, r.contexto, r.minutos, r.dificultad, r.adaptaciones,
    r.intereses, r.ok ? "si" : "no", r.error_code, r.attempts.map((a) => a.code ?? "OK"), r.block_terms, r.review_flags,
    r.latency_ms, r.tokens_in, r.tokens_out, r.cost_usd, r.in_review_sample ? "si" : "", "", "", "",
  ].map(csvCell).join(","));
  // Con BOM: Excel lo abre con las tildes bien
  writeFileSync(`${base}.csv`, `\uFEFF${[header.join(","), ...rows].join("\r\n")}\r\n`, "utf8");

  console.log(`[ai-eval] Listo: ${ok.length}/${results.length} válidos · ${blockAttempts.length} intentos con frases bloqueadas · US$ ${summary.cost_usd}`);
  console.log(`[ai-eval] Informe: ${base}.json y ${base}.csv`);
  console.log(`[ai-eval] Condición automática para lanzar: ${summary.automatic_pass ? "CUMPLE" : "NO CUMPLE"}`);
  if (!summary.automatic_pass) process.exitCode = 1;
}

// Solo corre si se lo llama directo (las pruebas importan los casos)
if ((import.meta as ImportMeta & { main?: boolean }).main) {
  await main();
}
