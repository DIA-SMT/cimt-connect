// Actividades interactivas: lo que sabe cada mecánica (registro puro).
// Sin alias de imports y sin React: lo usan el servidor, el panel, el portal,
// el mock y las pruebas. Qué componente juega cada mecánica está en
// src/components/activity/registry.tsx.
//
// Sumar una mecánica: su esquema en activitySpec.ts, su entrada en
// MECHANIC_RULES y su componente en el registro del portal.

import {
  type ActivitySpec, type BalloonSpec, type Mechanic, type PoemScheme, type PoemSpec, type ReadingSpec, type RecordingSpec, type RhymeSpec,
  BLANK, MECHANIC_LABEL, POEM_SCHEMES, SCHEME_LINES, SCHEME_PAIRS, SPEC_VERSION,
} from "./activitySpec";
import { DEFAULT_THEME } from "./activityAssets";
import { type RhymeKind, lastWord, rhymeOf } from "./rhymeEs";
import { hardStart, pacePhrase } from "./speechGames";

// Desde qué edad hay versión interactiva (de 2 a 5 años, solo la versión sin
// pantalla: decisión D2 del prompt de actividades)
export const ACTIVITY_MIN_AGE = 6;

// Un aviso para el profesional: nunca bloquea (la rima se mide con una
// aproximación). path: dónde está, para marcarlo en el editor
export type ActivityWarning = { path: string; message: string };

type Rules<S> = {
  // Pasos del juego: cada verso de la poesía, cada tarjeta de la rima
  steps: (s: S) => number;
  // true: un paso queda hecho con solo verlo; false: hay que resolverlo
  autoComplete: boolean;
  // Todos los textos que ve la familia (para el lint, «Lo dejo así» y edit_ratio)
  texts: (s: S) => string[];
  warnings: (s: S) => ActivityWarning[];
};

const cap = (w: string) => `«${w}»`;

function poemWarnings(p: PoemSpec): ActivityWarning[] {
  const out: ActivityWarning[] = [];
  const kind: RhymeKind = p.rima;
  const pairs = SCHEME_PAIRS[p.esquema];
  p.estrofas.forEach((e, i) => {
    for (const [a, b] of pairs) {
      const va = e.versos[a];
      const vb = e.versos[b];
      if (va === undefined || vb === undefined) continue;
      const r = rhymeOf(va, vb, kind);
      const where = `Estrofa ${i + 1}, versos ${a + 1} y ${b + 1}`;
      if (r === "no_rima") out.push({ path: `estrofas.${i}.versos.${b}`, message: `${where}: ${cap(lastWord(va))} y ${cap(lastWord(vb))} no parecen rimar (${kind}).` });
      else if (r === "misma_palabra") out.push({ path: `estrofas.${i}.versos.${b}`, message: `${where}: riman con la misma palabra (${cap(lastWord(va))}). Mejor otra.` });
    }
  });
  return out;
}

function rhymeWarnings(s: RhymeSpec): ActivityWarning[] {
  const out: ActivityWarning[] = [];
  s.tarjetas.forEach((c, i) => {
    const target = lastWord(c.verso);
    const r = rhymeOf(c.verso, c.respuesta, "asonante");
    if (r === "no_rima") out.push({ path: `tarjetas.${i}.respuesta`, message: `Tarjeta ${i + 1}: ${cap(c.respuesta)} no parece rimar con ${cap(target)}.` });
    else if (r === "misma_palabra") out.push({ path: `tarjetas.${i}.respuesta`, message: `Tarjeta ${i + 1}: la respuesta es la misma palabra del primer verso.` });
    c.distractores.forEach((d, j) => {
      if (rhymeOf(c.verso, d, "asonante") === "rima") {
        out.push({ path: `tarjetas.${i}.distractores.${j}`, message: `Tarjeta ${i + 1}: la opción ${cap(d)} también rima con ${cap(target)}: confunde.` });
      }
    });
    if (!c.completar.trim().endsWith(BLANK)) {
      out.push({ path: `tarjetas.${i}.completar`, message: `Tarjeta ${i + 1}: la rima se escucha mejor con el hueco al final del verso.` });
    }
  });
  return out;
}

function balloonWarnings(s: BalloonSpec): ActivityWarning[] {
  return s.palabras.flatMap((w, i) => hardStart(w)
    ? [{ path: `palabras.${i}`, message: `Palabra ${i + 1}: ${cap(w)} empieza con un sonido que cuesta más arrancar suave. Para empezar, mejor palabras con vocal (árbol, oso, uva).` }]
    : []);
}

// Una frase que con la tortuga dura más que esto cansa: mejor partirla
const READING_MAX_MS = 20_000;

function readingWarnings(s: ReadingSpec): ActivityWarning[] {
  return s.frases.flatMap((f, i) => {
    const ms = pacePhrase(f, s.ritmo).total;
    return ms > READING_MAX_MS
      ? [{ path: `frases.${i}`, message: `Frase ${i + 1}: con este ritmo dura unos ${Math.round(ms / 1000)} segundos. Mejor partirla en dos.` }]
      : [];
  });
}

// Leer un texto largo en poco tiempo apura: mejor más segundos o menos texto
function recordingWarnings(s: RecordingSpec): ActivityWarning[] {
  if (!s.texto) return [];
  const ms = pacePhrase(s.texto, "tranquilo").total;
  return ms > s.segundos * 1000
    ? [{ path: "texto", message: `Leído tranquilo, el texto dura unos ${Math.round(ms / 1000)} segundos y la grabación ${s.segundos}: subí los segundos o acortalo.` }]
    : [];
}

export const MECHANIC_RULES: { [K in Mechanic]: Rules<Extract<ActivitySpec, { mecanica: K }>> } = {
  poesia: {
    steps: (p) => p.estrofas.reduce((n, e) => n + e.versos.length, 0),
    autoComplete: true,
    texts: (p) => [p.titulo, ...p.estrofas.flatMap((e) => e.versos)],
    warnings: poemWarnings,
  },
  rima: {
    steps: (s) => s.tarjetas.length,
    autoComplete: false,
    texts: (s) => [s.titulo, ...s.tarjetas.flatMap((c) => [c.verso, c.completar.replace(BLANK, c.respuesta), ...c.distractores])],
    warnings: rhymeWarnings,
  },
  // Un paso queda hecho al decir la palabra con el micrófono (o con «Ya la dijimos»)
  globo: {
    steps: (s) => s.palabras.length,
    autoComplete: false,
    texts: (s) => [s.titulo, ...s.palabras],
    warnings: balloonWarnings,
  },
  // Un paso queda hecho cuando la tortuga llega al final de la frase
  lectura: {
    steps: (s) => s.frases.length,
    autoComplete: false,
    texts: (s) => [s.titulo, ...s.frases],
    warnings: readingWarnings,
  },
  // Un solo paso: queda hecho cuando la grabación llega al profesional
  grabacion: {
    steps: () => 1,
    autoComplete: false,
    texts: (s) => [s.titulo, s.consigna, ...(s.texto ? [s.texto] : [])],
    warnings: recordingWarnings,
  },
};

// Las funciones de cada mecánica, sin perder el tipo de la unión
function rules(s: ActivitySpec): Rules<ActivitySpec> {
  return MECHANIC_RULES[s.mecanica] as unknown as Rules<ActivitySpec>;
}

export const activitySteps = (s: ActivitySpec) => rules(s).steps(s);
export const activityAutoComplete = (s: ActivitySpec) => rules(s).autoComplete;
export const activityTexts = (s: ActivitySpec) => rules(s).texts(s);
export const activityWarnings = (s: ActivitySpec) => rules(s).warnings(s);
export const activityFullText = (s: ActivitySpec | null | undefined) => (s ? activityTexts(s).join("\n") : "");

// ¿Se puede ofrecer la versión interactiva a esta edad? (sin edad: sí; el
// panel ya pide la fecha de nacimiento para casi todo)
export const activityAgeOk = (age: number | null) => age === null || age >= ACTIVITY_MIN_AGE;

// ── Para empezar a cargar a mano ────────────────────────────────────────────

export function emptyActivity(m: Mechanic, titulo: string): ActivitySpec {
  const t = titulo.trim().slice(0, 60) || (m === "rima" ? "Rimas para completar" : MECHANIC_LABEL[m]);
  if (m === "globo") return { v: SPEC_VERSION, mecanica: "globo", titulo: t, tema: DEFAULT_THEME, palabras: ["", "", ""] };
  if (m === "lectura") return { v: SPEC_VERSION, mecanica: "lectura", titulo: t, tema: DEFAULT_THEME, ritmo: "lento", frases: [""] };
  if (m === "grabacion") return { v: SPEC_VERSION, mecanica: "grabacion", titulo: t, tema: DEFAULT_THEME, consigna: "", texto: null, segundos: 60 };
  if (m === "poesia") {
    return { v: SPEC_VERSION, mecanica: "poesia", titulo: t, tema: DEFAULT_THEME, esquema: "AABB", rima: "asonante", palmas: false,
      estrofas: [{ versos: ["", "", "", ""], icono: null }] };
  }
  return { v: SPEC_VERSION, mecanica: "rima", titulo: t, tema: DEFAULT_THEME,
    tarjetas: [0, 1].map(() => ({ verso: "", completar: `${BLANK}`, respuesta: "", distractores: ["", ""], icono: null })) };
}

// «Convertir en poesía interactiva»: un texto pegado o escrito (estrofas
// separadas por una línea en blanco, un verso por renglón) pasa a estrofas y
// versos. El esquema es el primero que cumple todas las estrofas (los riman
// de verdad, con la rima asonante); si ninguno, «libre». Lo que no entra en
// los límites lo marca después la validación, con el mensaje de cada caso.
export function poemFromText(raw: string, titulo: string): PoemSpec {
  const estrofas = String(raw ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)
    .map((block) => block.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean))
    .filter((versos) => versos.length > 0)
    .map((versos) => ({ versos, icono: null }));
  const esquema = guessScheme(estrofas.map((e) => e.versos));
  return { v: SPEC_VERSION, mecanica: "poesia", titulo: titulo.trim().slice(0, 60) || "Poesía", tema: DEFAULT_THEME,
    esquema, rima: "asonante", palmas: false, estrofas };
}

export function guessScheme(estrofas: string[][]): PoemScheme {
  if (!estrofas.length) return "libre";
  for (const s of POEM_SCHEMES) {
    const n = SCHEME_LINES[s];
    if (n === null) continue;
    const fits = estrofas.every((v) => v.length === n && SCHEME_PAIRS[s].every(([a, b]) => rhymeOf(v[a], v[b], "asonante") === "rima"));
    if (fits) return s;
  }
  return "libre";
}

// El verso número step de la poesía (contando todos) → estrofa y verso
// dentro de ella (los pasos del motor son los versos)
export function poemPlace(p: PoemSpec, step: number): { estrofa: number; verso: number } {
  let left = Math.max(0, step);
  for (let i = 0; i < p.estrofas.length; i++) {
    const n = p.estrofas[i].versos.length;
    if (left < n) return { estrofa: i, verso: left };
    left -= n;
  }
  const last = Math.max(0, p.estrofas.length - 1);
  return { estrofa: last, verso: Math.max(0, (p.estrofas[last]?.versos.length ?? 1) - 1) };
}

// Las opciones de una tarjeta de rima, mezcladas siempre igual para esa
// tarjeta (no cambian de lugar al volver a la tarjeta ni al recargar)
export function rhymeOptions(card: { respuesta: string; distractores: string[] }, seed: number): string[] {
  const opts = [card.respuesta, ...card.distractores];
  let h = 2166136261 ^ seed;
  for (const ch of opts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [...opts];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
