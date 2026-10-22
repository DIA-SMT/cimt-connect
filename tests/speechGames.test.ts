// Pruebas de los juegos con la voz: el globo y leer con la tortuga
// (src/lib/speechGames.ts y sus mecánicas en activitySpec / activityMechanics).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  FRAME_MS, PACE_SPS, SOFT_RISE_MS, displayLevel, hardStart, newTracker, onsetMessage, onsetOf, pacePhrase, syllables,
  trackVoice, wordAt,
} from "../src/lib/speechGames";
import { AI_MECHANICS, MECHANICS, MECHANIC_APPROACHES, mechanicAllowed, validateActivity } from "../src/lib/activitySpec";
import { activityAutoComplete, activitySteps, activityTexts, activityWarnings, emptyActivity } from "../src/lib/activityMechanics";
import { engineReduce, initialEngine } from "../src/lib/activityEngine";
import { buildActivityRequest } from "../src/lib/aiActivityRules";
import { APPROACHES, validateExerciseInput } from "../src/lib/practiceRules";

describe("sílabas (para repartir el tiempo de la tortuga)", () => {
  test("diptongos, hiatos y casos de una sola", () => {
    const cases: [string, number][] = [
      ["tortuga", 3], ["árbol", 2], ["agua", 2], ["huevo", 2], ["quiero", 2], ["guitarra", 3], ["Paraguay", 3],
      ["leer", 2], ["río", 2], ["país", 2], ["aeropuerto", 5], ["muy", 1], ["y", 1], ["sol,", 1],
    ];
    for (const [w, n] of cases) expect({ w, n: syllables(w) }).toEqual({ w, n });
  });
});

describe("leer con la tortuga", () => {
  test("cada palabra dura según sus sílabas y el ritmo", () => {
    const { words, total } = pacePhrase("La tortuga camina.", "lento");
    expect(words.map((w) => w.text)).toEqual(["La", "tortuga", "camina."]);
    expect(words[0].start).toBe(0);
    expect(words[1].end - words[1].start).toBe(Math.round((3 / PACE_SPS.lento) * 1000));
    expect(total).toBe(words[2].end);
  });
  test("después de una coma, la pausa es más larga", () => {
    const comma = pacePhrase("uno, dos", "lento").words;
    const plain = pacePhrase("uno dos", "lento").words;
    expect(comma[1].start - comma[0].end).toBeGreaterThan(plain[1].start - plain[0].end);
  });
  test("muy lento tarda más que tranquilo", () => {
    expect(pacePhrase("La tortuga camina por el campo", "muy_lento").total)
      .toBeGreaterThan(pacePhrase("La tortuga camina por el campo", "tranquilo").total);
  });
  test("qué palabra va iluminada", () => {
    const { words, total } = pacePhrase("Hola tortuga linda", "lento");
    expect(wordAt(words, -1)).toBe(-1);
    expect(wordAt(words, 0)).toBe(0);
    expect(wordAt(words, words[1].start)).toBe(1);
    expect(wordAt(words, words[2].start + 1)).toBe(2);
    expect(wordAt(words, total)).toBe(words.length);
    expect(wordAt([], 100)).toBe(-1);
  });
});

// Un intento simulado: silencio, la voz (con su arranque) y silencio otra vez
function runAttempt(voice: number[]): number[] | null {
  let t = newTracker();
  let attempt: number[] | null = null;
  for (const l of [...Array(30).fill(0.002), ...voice, ...Array(40).fill(0.002)]) {
    const r = trackVoice(t, l);
    t = r.tracker;
    if (r.attempt) attempt = r.attempt;
  }
  return attempt;
}
const ramp = (frames: number, to = 0.2) => Array.from({ length: frames }, (_, i) => 0.002 + ((to - 0.002) * (i + 1)) / frames);

describe("el globo: cómo arrancó la voz", () => {
  test("un arranque que sube despacito es suave", () => {
    const attempt = runAttempt([...ramp(20), ...Array(30).fill(0.2)]);
    expect(attempt).not.toBeNull();
    const o = onsetOf(attempt!);
    expect(o?.kind).toBe("suave");
    expect(o!.riseMs).toBeGreaterThanOrEqual(SOFT_RISE_MS);
  });
  test("un arranque de golpe es brusco", () => {
    const o = onsetOf(runAttempt(Array(40).fill(0.2))!);
    expect(o?.kind).toBe("brusco");
    expect(o!.riseMs).toBeLessThan(SOFT_RISE_MS);
  });
  test("un ruido cortito no cuenta como intento", () => {
    const attempt = runAttempt(Array(3).fill(0.3));
    expect(attempt).not.toBeNull();
    expect(onsetOf(attempt!)).toBeNull();
  });
  test("el silencio solo no arma ningún intento", () => {
    expect(runAttempt([])).toBeNull();
  });
  test("un intento muy largo se corta solo", () => {
    let t = newTracker();
    let ended = false;
    for (let i = 0; i < 10_000 / FRAME_MS; i++) {
      const r = trackVoice(t, 0.2);
      t = r.tracker;
      if (r.attempt) ended = true;
    }
    expect(ended).toBe(true);
  });
  test("siempre se felicita el intento, sea como sea", () => {
    for (const kind of ["suave", "brusco"] as const) expect(onsetMessage({ kind, riseMs: 0 })).toMatch(/^¡/);
  });
  test("el volumen para dibujar va de 0 a 1", () => {
    expect(displayLevel(0)).toBe(0);
    expect(displayLevel(1)).toBe(1);
    expect(displayLevel(0.01)).toBeGreaterThan(0);
    expect(displayLevel(0.01)).toBeLessThan(displayLevel(0.1));
  });
  test("las palabras que cuestan más arrancar suave", () => {
    for (const w of ["perro", "gato", "vaca", "casa", "queso", "tren"]) expect({ w, hard: hardStart(w) }).toEqual({ w, hard: true });
    for (const w of ["oso", "árbol", "uva", "cielo", "gente", "mamá", "hola"]) expect({ w, hard: hardStart(w) }).toEqual({ w, hard: false });
  });
});

const BALLOON = { v: 1, mecanica: "globo", titulo: "Globo", tema: "cielo", palabras: ["árbol", "perro"] };
const READING = { v: 1, mecanica: "lectura", titulo: "Tortuga", tema: "campo", frases: ["La tortuga camina."] };

describe("las actividades nuevas", () => {
  test("se validan y completan lo que falta (ritmo lento)", () => {
    const b = validateActivity(BALLOON);
    expect(b.ok).toBe(true);
    const r = validateActivity(READING);
    expect(r.ok && r.value.mecanica === "lectura" && r.value.ritmo).toBe("lento");
  });
  test("los límites, con el lugar del problema", () => {
    const one = validateActivity({ ...BALLOON, palabras: ["oso"] });
    expect(one.ok).toBe(false);
    const empty = validateActivity({ ...BALLOON, palabras: ["oso", "  "] });
    expect(!empty.ok && empty.error.startsWith("Palabra 2:")).toBe(true);
    const long = validateActivity({ ...READING, frases: ["x".repeat(141)] });
    expect(!long.ok && long.error.startsWith("Frase 1:")).toBe(true);
    expect(validateActivity({ ...READING, ritmo: "rapidisimo" }).ok).toBe(false);
  });
  test("vacías no se pueden guardar hasta completarlas", () => {
    expect(validateActivity(emptyActivity("globo", "Hola")).ok).toBe(false);
    expect(validateActivity(emptyActivity("lectura", "Hola")).ok).toBe(false);
  });
  test("pasos, textos (para la revisión) y avisos", () => {
    const b = validateActivity(BALLOON);
    if (!b.ok) throw new Error(b.error);
    expect(activitySteps(b.value)).toBe(2);
    expect(activityAutoComplete(b.value)).toBe(false);
    expect(activityTexts(b.value)).toEqual(["Globo", "árbol", "perro"]);
    expect(activityWarnings(b.value).map((w) => w.path)).toEqual(["palabras.1"]); // «perro» cuesta más
    const long = validateActivity({ ...READING, ritmo: "muy_lento", frases: ["Una frase bastante larga para leer siguiendo a la tortuga por todo el campo verde."] });
    if (!long.ok) throw new Error(long.error);
    expect(activityWarnings(long.value).map((w) => w.path)).toEqual(["frases.0"]);
  });
  test("cada paso se hace al intentarlo, no solo con verlo", () => {
    let s = engineReduce(initialEngine(2), { type: "EMPEZAR" }, false);
    expect(engineReduce(s, { type: "SIGUIENTE" }, false).step).toBe(0); // todavía no lo dijeron
    s = engineReduce(s, { type: "COMPLETAR" }, false);
    expect(engineReduce(s, { type: "SIGUIENTE" }, false).step).toBe(1);
  });
});

describe("en qué enfoques y quién las arma", () => {
  test("el globo, solo en habla fácil; la tortuga, también en ritmo y lectura; la poesía, en todos", () => {
    expect(mechanicAllowed("globo", "habla_facil")).toBe(true);
    expect(mechanicAllowed("globo", "entorno_familia")).toBe(false);
    expect(mechanicAllowed("lectura", "ritmo_y_claridad")).toBe(true);
    expect(mechanicAllowed("lectura", "tartamudear_facil")).toBe(false);
    expect(mechanicAllowed("poesia", "tartamudear_facil")).toBe(true);
  });
  test("los enfoques nombrados existen", () => {
    for (const m of MECHANICS) for (const a of MECHANIC_APPROACHES[m] ?? []) expect((APPROACHES as readonly string[]).includes(a)).toBe(true);
  });
  test("la IA arma solo poesía y rima: los juegos con la voz se cargan a mano", () => {
    expect([...AI_MECHANICS]).toEqual(["poesia", "rima"]);
    expect(buildActivityRequest({ mecanica: "globo" }).ok).toBe(false);
    expect(buildActivityRequest({ mecanica: "lectura" }).ok).toBe(false);
  });
  test("el servidor rechaza un juego que no va con el enfoque del ejercicio", () => {
    const exercise = (approach: string) => ({
      approach, source: "manual", title: "Arranque suave", para_que: "Practicar el arranque suave.",
      pasos: ["Decí cada palabra suave.", "Después armá una frase."], minutes: 5,
      si_cuesta: "Si cuesta, paren y cuéntenlo en la sesión.", activity: BALLOON,
    });
    expect(validateExerciseInput(exercise("habla_facil")).ok).toBe(true);
    const bad = validateExerciseInput(exercise("entorno_familia"));
    expect(!bad.ok && bad.field).toBe("activity");
  });
});
