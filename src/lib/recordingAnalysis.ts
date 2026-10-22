// «Me grabo»: el análisis de una grabación (la microevaluación para el profesional).
// Puro y sin alias de imports: lo usan el servidor, el panel, el modo demo y
// las pruebas.
//
// Decisiones del centro (octubre 2026):
//   - El audio lo reconoce Azure (es-AR, región Brasil) y devuelve cada palabra
//     con su tiempo. De ahí salen las cuentas y las MARCAS: momentos posibles
//     (pausas largas, repeticiones, muletillas, palabras estiradas) para que el
//     profesional escuche ahí. La IA no diagnostica ni decide: marca.
//   - El profesional valida: escucha y cuenta las sílabas tartamudeadas con un
//     botón. El %SS (porcentaje de sílabas tartamudeadas) es el suyo, no el de la IA.
//   - La familia nunca ve estos números: ve que su profesional lo escuchó y su devolución.
//   - Los umbrales son una propuesta a validar por las fonoaudiólogas.

import { syllables } from "./speechGames";

export const ANALYSIS_VERSION = 1;

export type RecognizedWord = { word: string; start: number; dur: number }; // ms

export type MarkKind = "pausa" | "repeticion" | "muletilla" | "prolongacion";
export const MARK_LABEL: Record<MarkKind, string> = {
  pausa: "Pausa larga",
  repeticion: "Posible repetición",
  muletilla: "Muletilla",
  prolongacion: "Palabra estirada",
};

export type Mark = { at: number; dur: number; kind: MarkKind; text: string };

export type RecordingAnalysis = {
  v: typeof ANALYSIS_VERSION;
  text: string; // lo que reconoció Azure (se borra junto con el audio)
  words: number;
  syllables: number;
  speech_ms: number; // de la primera palabra a la última
  spm: number | null; // sílabas por minuto en ese tramo
  marks: Mark[];
  source?: "azure" | "groq"; // quién reconoció el audio
};

// Propuesta a validar por las fonoaudiólogas
export const PAUSE_MS = 1500; // un silencio así entre palabras puede ser un bloqueo
const SLOW_WORD_FACTOR = 2.5; // una palabra que dura 2,5 veces lo esperable
const MS_PER_SYLLABLE = 200; // unas 5 sílabas por segundo al hablar
const MIN_LONG_WORD_MS = 700;

const FILLERS = new Set(["e", "eh", "ehh", "eeh", "em", "emm", "mm", "mmm", "ah", "aa", "aaa"]);
// Palabras cortas de todos los días: no cuentan como un pedazo repetido
const SHORT_WORDS = new Set([
  "a", "o", "u", "y", "e", "al", "el", "la", "lo", "le", "las", "los", "un", "una", "uno", "de", "del", "en", "es",
  "mi", "tu", "su", "se", "me", "te", "no", "si", "sí", "ya", "que", "con", "por", "sin", "ni", "hoy", "muy", "mas",
  "más", "yo", "vos", "él", "ella", "nos", "les", "ay", "va", "voy", "fue", "soy", "son", "dos", "tres", "ok",
]);

const norm = (w: string) => w.toLowerCase().replace(/[^a-záéíóúüñ]/g, "");

// ¿Es un pedazo repetido de la palabra que sigue? «pe pelota» (el comienzo),
// «pepe pelota» (una sílaba repetida pegada, como lo escribe Whisper) o un
// pedazo corto que arranca igual («pc pelota», como lo escribe Azure)
function partOf(t: string, next: string): boolean {
  if (!t || !next) return false;
  if (next.length > t.length && next.startsWith(t) && !SHORT_WORDS.has(t)) return true;
  for (let n = 1; n <= 3 && n < next.length; n++) {
    const p = next.slice(0, n);
    if (t.length > n && t.length % n === 0 && t === p.repeat(t.length / n)) return true;
  }
  return next.length > t.length && t.length <= 3 && !SHORT_WORDS.has(t) && t[0] === next[0];
}

/** Las palabras del resultado «detailed» de Azure (tiempos en ticks de 100 ns). null: no reconoció nada */
export function parseAzureDetailed(raw: unknown): RecognizedWord[] | null {
  const r = raw as { RecognitionStatus?: string; NBest?: { Words?: { Word?: string; Offset?: number; Duration?: number }[] }[] } | null;
  if (!r || r.RecognitionStatus !== "Success") return null;
  const words = r.NBest?.[0]?.Words ?? [];
  const out = words
    .filter((w) => typeof w.Word === "string" && typeof w.Offset === "number" && typeof w.Duration === "number")
    .map((w) => ({ word: String(w.Word), start: Math.round(w.Offset! / 10_000), dur: Math.round(w.Duration! / 10_000) }));
  return out.length ? out : null;
}

/** Las palabras de Whisper (Groq, verbose_json con tiempos por palabra, en segundos). null: nada */
export function parseWhisperVerbose(raw: unknown): RecognizedWord[] | null {
  const words = (raw as { words?: { word?: string; start?: number; end?: number }[] } | null)?.words ?? [];
  const out = words
    .filter((w) => typeof w.word === "string" && w.word.trim() && typeof w.start === "number" && typeof w.end === "number")
    .map((w) => ({ word: String(w.word).trim(), start: Math.round(w.start! * 1000), dur: Math.max(0, Math.round((w.end! - w.start!) * 1000)) }));
  return out.length ? out : null;
}

export function analyzeWords(words: RecognizedWord[]): RecordingAnalysis {
  const marks: Mark[] = [];
  let total = 0;
  words.forEach((w, i) => {
    const t = norm(w.word);
    const s = syllables(w.word);
    total += s;
    const prev = words[i - 1];
    const next = words[i + 1];
    // Un silencio largo desde la palabra anterior
    if (prev) {
      const gap = w.start - (prev.start + prev.dur);
      if (gap >= PAUSE_MS) marks.push({ at: prev.start + prev.dur, dur: gap, kind: "pausa", text: `${(gap / 1000).toFixed(1)} s` });
    }
    if (FILLERS.has(t)) {
      marks.push({ at: w.start, dur: w.dur, kind: "muletilla", text: w.word });
      return;
    }
    // La misma palabra dos veces seguidas («la la pelota»)
    if (prev && norm(prev.word) === t) {
      marks.push({ at: prev.start, dur: w.start + w.dur - prev.start, kind: "repeticion", text: `${prev.word} ${w.word}` });
      return;
    }
    // Un pedazo de la palabra que sigue («pe pelota», «pepe pelota», «pc pelota»)
    if (next && partOf(t, norm(next.word))) {
      marks.push({ at: w.start, dur: next.start + next.dur - w.start, kind: "repeticion", text: `${w.word} ${next.word}` });
      return;
    }
    // Una palabra que dura mucho más de lo que se espera por sus sílabas
    if (w.dur >= Math.max(MIN_LONG_WORD_MS, s * MS_PER_SYLLABLE * SLOW_WORD_FACTOR)) {
      marks.push({ at: w.start, dur: w.dur, kind: "prolongacion", text: w.word });
    }
  });
  const first = words[0];
  const last = words[words.length - 1];
  const speech = first && last ? last.start + last.dur - first.start : 0;
  return {
    v: ANALYSIS_VERSION,
    text: words.map((w) => w.word).join(" "),
    words: words.length,
    syllables: total,
    speech_ms: speech,
    spm: speech >= 1000 ? Math.round((total / speech) * 60_000) : null,
    marks: marks.sort((a, b) => a.at - b.at),
  };
}

// ── La revisión del profesional ─────────────────────────────────────────────

/** %SS con un decimal (null: sin sílabas para contar) */
export function percentSS(stuttered: number, totalSyllables: number): number | null {
  if (!Number.isFinite(totalSyllables) || totalSyllables <= 0 || !Number.isFinite(stuttered) || stuttered < 0) return null;
  return Math.round((Math.min(stuttered, totalSyllables) / totalSyllables) * 1000) / 10;
}

/** El resumen para el panel: «9 s · 33 sílabas · 210 sílabas/min · 1 pausa larga» */
export function analysisSummary(a: RecordingAnalysis): string {
  const count = (k: MarkKind) => a.marks.filter((m) => m.kind === k).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    `${Math.round(a.speech_ms / 1000)} s hablando`,
    plural(a.syllables, "sílaba", "sílabas"),
    ...(a.spm !== null ? [`${a.spm} sílabas/min`] : []),
  ];
  for (const [k, one, many] of [
    ["pausa", "pausa larga", "pausas largas"],
    ["repeticion", "posible repetición", "posibles repeticiones"],
    ["muletilla", "muletilla", "muletillas"],
    ["prolongacion", "palabra estirada", "palabras estiradas"],
  ] as const) {
    const n = count(k);
    if (n) parts.push(plural(n, one, many));
  }
  return parts.join(" · ");
}
