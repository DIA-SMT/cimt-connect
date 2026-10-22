// Juegos con la voz (actividades «globo» y «lectura»): las cuentas puras.
// Sin React y sin alias de imports: lo usan los componentes del portal, el
// panel y las pruebas.
//
// Nada de esto graba ni manda audio. El globo mira el volumen de la voz en el
// momento, en el mismo celular, y lo descarta: no queda guardado en ningún
// lado. La tortuga no usa el micrófono.
//
// Como en el resto de la práctica, se premia intentarlo, nunca la fluidez: el
// globo muestra cómo arrancó la voz y siempre felicita (catálogo: «Felicitá
// que lo intente, no cómo le salió»).

// ── Sílabas (aproximación del castellano) ───────────────────────────────────
// Cada grupo de vocales seguidas es una sílaba (diptongo), salvo dos vocales
// fuertes o una débil con tilde (hiato: «le-er», «rí-o», «pa-ís»). Alcanza
// para repartir el tiempo de la tortuga entre las palabras.

const HIATUS = "aeoáéóíú"; // fuertes, y las débiles con tilde

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
  if (!w) return 0;
  let n = 0;
  for (const g of w.match(/[aeiouáéíóúü]+/g) ?? []) {
    n += 1;
    for (let i = 1; i < g.length; i++) if (HIATUS.includes(g[i - 1]) && HIATUS.includes(g[i])) n += 1;
  }
  return Math.max(1, n); // «y», «muy», «hoy»: una
}

// ── Leer con la tortuga ─────────────────────────────────────────────────────

export const READING_PACES = ["muy_lento", "lento", "tranquilo"] as const;
export type ReadingPace = (typeof READING_PACES)[number];
export const PACE_LABEL: Record<ReadingPace, string> = {
  muy_lento: "Muy lento (habla de tortuga)",
  lento: "Lento",
  tranquilo: "Tranquilo",
};
// Sílabas por segundo (al conversar, unas 5 o 6). Propuesta a validar por las
// fonoaudiólogas
export const PACE_SPS: Record<ReadingPace, number> = { muy_lento: 1.5, lento: 2.2, tranquilo: 3 };

// Pausa después de cada palabra (ms): más larga después de una coma o un punto
const GAP_MS = 120;
const COMMA_MS = 450;
const STOP_MS = 800;

export type PacedWord = { text: string; start: number; end: number };

/** Cuándo se ilumina cada palabra de la frase (ms desde que arranca la tortuga) */
export function pacePhrase(frase: string, pace: ReadingPace): { words: PacedWord[]; total: number } {
  const sps = PACE_SPS[pace];
  const words: PacedWord[] = [];
  let t = 0;
  for (const text of frase.split(/\s+/).filter(Boolean)) {
    const dur = Math.round((syllables(text) / sps) * 1000);
    words.push({ text, start: t, end: t + dur });
    t += dur + (/[.!?…]["»”)]*$/.test(text) ? STOP_MS : /[,;:]["»”)]*$/.test(text) ? COMMA_MS : GAP_MS);
  }
  // Sin la pausa después de la última palabra
  const total = words.length ? words[words.length - 1].end : 0;
  return { words, total };
}

/** La palabra que va iluminada a los ms (-1: todavía ninguna; words.length: ya terminó) */
export function wordAt(words: PacedWord[], ms: number): number {
  if (!words.length || ms < 0) return -1;
  if (ms >= words[words.length - 1].end) return words.length;
  let i = 0;
  while (i < words.length - 1 && ms >= words[i + 1].start) i++;
  return i;
}

// ── El globo: el arranque de la voz ─────────────────────────────────────────
// Cada ~16 ms llega el volumen de la voz (RMS, de 0 a 1). Un intento empieza
// cuando la voz pasa el ruido de fondo y termina después de un rato de
// silencio. Del intento se mira solo cómo subió la voz al arrancar: si tardó
// en llegar a su fuerza (como un soplido que crece), fue un arranque suave.

export const FRAME_MS = 16;
const MIN_VOICE = 0.012; // por debajo, silencio aunque el ruido de fondo sea bajísimo
const NOISE_FACTOR = 3; // la voz tiene que pasar 3 veces el ruido de fondo
const PRE_FRAMES = 6; // lo que había justo antes de pasar el umbral (ahí empieza la subida)
const END_SILENCE_MS = 350;
const MAX_ATTEMPT_MS = 6000;
const MIN_ATTEMPT_MS = 150; // más corto: un golpe o un ruido, no una palabra
/** Desde cuánto se considera suave (ms en ir del 10 % al 80 % de la fuerza). Propuesta a validar */
export const SOFT_RISE_MS = 120;
const ONSET_WINDOW_MS = 800; // la fuerza del arranque se mide en el primer tramo

export type VoiceTracker = {
  speaking: boolean;
  noise: number; // ruido de fondo estimado
  recent: number[]; // los últimos niveles en silencio
  levels: number[]; // el intento en curso
  quiet: number; // frames seguidos por debajo del umbral
};

export const newTracker = (): VoiceTracker => ({ speaking: false, noise: MIN_VOICE / NOISE_FACTOR, recent: [], levels: [], quiet: 0 });

export const voiceThreshold = (t: VoiceTracker) => Math.max(MIN_VOICE, t.noise * NOISE_FACTOR);

/** Suma un nivel. Si con él termina un intento, lo devuelve (los niveles desde un poco antes del arranque) */
export function trackVoice(t: VoiceTracker, level: number): { tracker: VoiceTracker; attempt: number[] | null } {
  const th = voiceThreshold(t);
  if (!t.speaking) {
    if (level >= th) {
      return { tracker: { ...t, speaking: true, levels: [...t.recent, level], quiet: 0, recent: [] }, attempt: null };
    }
    // En silencio, el ruido de fondo se ajusta despacio
    const noise = t.noise * 0.95 + level * 0.05;
    return { tracker: { ...t, noise, recent: [...t.recent, level].slice(-PRE_FRAMES) }, attempt: null };
  }
  const levels = [...t.levels, level];
  const quiet = level < th ? t.quiet + 1 : 0;
  const ended = quiet * FRAME_MS >= END_SILENCE_MS || levels.length * FRAME_MS >= MAX_ATTEMPT_MS;
  if (!ended) return { tracker: { ...t, levels, quiet }, attempt: null };
  const attempt = levels.slice(0, levels.length - quiet);
  return { tracker: { ...t, speaking: false, levels: [], quiet: 0, recent: [] }, attempt };
}

export type Onset = { kind: "suave" | "brusco"; riseMs: number };

/** Cómo arrancó la voz en un intento (null: muy corto o sin voz: no cuenta como intento) */
export function onsetOf(levels: number[]): Onset | null {
  const voiced = levels.filter((l) => l >= MIN_VOICE).length;
  if (voiced * FRAME_MS < MIN_ATTEMPT_MS) return null;
  const window = levels.slice(0, Math.ceil(ONSET_WINDOW_MS / FRAME_MS));
  const peak = Math.max(...window);
  if (peak < MIN_VOICE) return null;
  const from = window.findIndex((l) => l >= peak * 0.1);
  const to = window.findIndex((l) => l >= peak * 0.8);
  const riseMs = Math.max(0, to - from) * FRAME_MS;
  return { kind: riseMs >= SOFT_RISE_MS ? "suave" : "brusco", riseMs };
}

/** Lo que se le dice después de cada intento: siempre algo bueno */
export function onsetMessage(o: Onset): string {
  return o.kind === "suave"
    ? "¡Qué arranque suave! El globo subió despacito."
    : "¡Bien ahí! La próxima, probá empezar como si soplaras apenas.";
}

/** El volumen para dibujar (0 a 1): en decibeles, así se ve también la voz bajita */
export function displayLevel(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 50));
}

// ── Avisos para el profesional (nunca bloquean) ─────────────────────────────

// Con estos sonidos (p, b/v, t, d, k, g) el arranque suave cuesta más. «ce»,
// «ci», «ge» y «gi» no: suenan como s y j
const HARD_START = /^(?:[pbvtdkq]|c(?![eéií])|g(?![eéií]))/i;

export const hardStart = (word: string) => HARD_START.test(word.trim());
