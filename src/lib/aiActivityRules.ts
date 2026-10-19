// Actividades interactivas armadas con ayuda de IA (fase 2): lo que se pide,
// lo que se le dice al modelo, el esquema de su respuesta y cómo se vuelve
// una actividad (src/lib/activitySpec.ts). Puro y sin alias de imports: lo
// usan aiDraftRules.ts, el servidor, el modo mock, el banco de prueba y las
// pruebas.
//
// La IA no arma código ni elige la mecánica por su cuenta: el profesional
// elige poesía o rima y la forma (estrofas, esquema, tarjetas); la IA
// escribe el contenido. Lo que devuelve pasa por el mismo contrato que lo
// cargado a mano, y la rima se revisa en el código (rhymeEs.ts): si no
// rima, se pide de nuevo una vez, y si sigue sin rimar llega con avisos
// para que el profesional lo corrija.
//
// Lo único libre que viaja es la idea del profesional («un astronauta que
// junta piezas de su nave»): nunca nombres, números largos, mails ni
// enlaces (ideaProblem lo revisa en el panel y en el servidor). Va dentro
// de <pedido>, como dato.

import { type ActivitySpec, type Mechanic, type PoemScheme, BLANK, MECHANICS, MECHANIC_LABEL, POEM_SCHEMES, SCHEME_LABEL, SCHEME_LINES, SCHEME_PAIRS, SPEC_VERSION, validateActivity } from "./activitySpec";
import { DEFAULT_THEME, ICON_IDS, THEME_IDS, isIconId, isThemeId } from "./activityAssets";
import { RHYME_KINDS, type RhymeKind } from "./rhymeEs";

export const AI_ACTIVITY_LIMITS = {
  idea: 160,
  estrofas_min: 1,
  estrofas_max: 3,
  tarjetas_min: 3,
  tarjetas_max: 6,
  sonidos_max: 3,
} as const;
const AL = AI_ACTIVITY_LIMITS;

// Sonidos que el profesional quiere que aparezcan (lista cerrada)
export const SOUNDS = ["p", "b", "m", "t", "d", "k", "g", "f", "s", "l", "r", "rr", "ch", "y", "n", "j"] as const;
export type Sound = (typeof SOUNDS)[number];
export const SOUND_LABEL: Record<Sound, string> = {
  p: "p (pato)", b: "b (barco)", m: "m (mamá)", t: "t (taza)", d: "d (dedo)", k: "k (casa)", g: "g (gato)", f: "f (foca)",
  s: "s (sol)", l: "l (luna)", r: "r (loro)", rr: "rr (perro)", ch: "ch (chancho)", y: "y (yoyó)", n: "n (nene)", j: "j (jirafa)",
};

// Lo que se pide (va en AiAdaptParams.actividad, tal cual al proveedor)
export type ActivityRequest = {
  mecanica: Mechanic;
  idea: string | null; // la idea del profesional, revisada con ideaProblem
  sonidos: Sound[];
  // poesía
  estrofas: number;
  esquema: PoemScheme;
  rima: RhymeKind;
  palmas: boolean; // no viaja al modelo como pedido de texto: se copia a la actividad
  // rima
  tarjetas: number;
};

export const DEFAULT_ACTIVITY_REQUEST: ActivityRequest = {
  mecanica: "poesia", idea: null, sonidos: [], estrofas: 2, esquema: "AABB", rima: "asonante", palmas: false, tarjetas: 4,
};

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

// ¿La idea trae algo que no tiene que salir del centro? null: se puede mandar
export function ideaProblem(raw: unknown): string | null {
  const idea = clean(raw);
  if (!idea) return null;
  if (idea.length > AL.idea) return `La idea tiene hasta ${AL.idea} caracteres.`;
  if (/\d{3,}/.test(idea)) return "Escribí la idea sin números largos (ni DNI, ni teléfonos, ni fechas).";
  if (/\S+@\S+|https?:\/\/|www\./i.test(idea)) return "Escribí la idea sin mails ni enlaces.";
  // Una mayúscula en medio de una oración suele ser un nombre propio
  for (const sentence of idea.split(/[.!?¡¿\n]+/)) {
    const words = sentence.trim().replace(/^[«"'(]+/, "").split(" ").filter(Boolean);
    const name = words.slice(1).map((w) => w.replace(/^[«"'(]+/, "")).find((w) => /^\p{Lu}/u.test(w));
    if (name) {
      return `Parece que hay un nombre propio («${name.replace(/[^\p{L}]/gu, "")}»). Escribí la idea sin nombres: para lugares o personajes, en minúscula («un viaje a marte»).`;
    }
  }
  return null;
}

const oneOf = <T extends string>(list: readonly T[], raw: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(raw) ? (raw as T) : fallback;
const intIn = (raw: unknown, min: number, max: number, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

// Valida lo que manda el panel (AiDraftRequest.actividad)
export function buildActivityRequest(raw: unknown): { ok: true; value: ActivityRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Pedido inválido" };
  const b = raw as Record<string, unknown>;
  if (!(MECHANICS as readonly unknown[]).includes(b.mecanica)) return { ok: false, error: "Elegí qué juego armar." };
  const problem = ideaProblem(b.idea);
  if (problem) return { ok: false, error: problem };
  const sonidos = SOUNDS.filter((s) => Array.isArray(b.sonidos) && b.sonidos.includes(s));
  if (sonidos.length > AL.sonidos_max) return { ok: false, error: `Elegí hasta ${AL.sonidos_max} sonidos.` };
  const d = DEFAULT_ACTIVITY_REQUEST;
  return {
    ok: true,
    value: {
      mecanica: b.mecanica as Mechanic,
      idea: clean(b.idea) || null,
      sonidos,
      estrofas: intIn(b.estrofas, AL.estrofas_min, AL.estrofas_max, d.estrofas),
      esquema: oneOf(POEM_SCHEMES, b.esquema, d.esquema),
      rima: oneOf(RHYME_KINDS, b.rima, d.rima),
      palmas: b.palmas === true,
      tarjetas: intIn(b.tarjetas, AL.tarjetas_min, AL.tarjetas_max, d.tarjetas),
    },
  };
}

// Versos por estrofa (con esquema libre, 4)
export const versesFor = (r: Pick<ActivityRequest, "esquema">) => SCHEME_LINES[r.esquema] ?? 4;

// ── El prompt ───────────────────────────────────────────────────────────────

const quoted = (xs: readonly string[]) => xs.join(", ");

function pairsText(s: PoemScheme): string {
  const pairs = SCHEME_PAIRS[s];
  return pairs.map(([a, b]) => `${a + 1} con ${b + 1}`).join(" y ");
}

const RHYME_KIND_PROMPT: Record<RhymeKind, string> = {
  asonante: "rima asonante (coinciden las vocales desde la sílaba fuerte de la última palabra: «pelota» y «rebota», «casa» y «mañana»)",
  consonante: "rima consonante (coinciden todos los sonidos desde la sílaba fuerte de la última palabra: «canción» y «corazón»)",
};

// Las reglas de la actividad (reemplazan el bloque del formato «poesía o rima»)
export function activityPrompt(r: ActivityRequest): string {
  const sounds = r.sonidos.length
    ? ` Usá con naturalidad algunas palabras con los sonidos ${quoted(r.sonidos.map((s) => `«${s}»`))}, repartidas y sin juntarlas: nada de trabalenguas.`
    : "";
  const common = [
    "Tema: la idea de <pedido>.actividad.idea si hay; si no, algo cercano a los intereses o al enfoque.",
    `«titulo» de la actividad: hasta 60 caracteres, con gracia. «tema»: uno de ${quoted(THEME_IDS)}.`,
    `«icono»: uno de ${quoted(ICON_IDS)}, o null si ninguno va.`,
    "Los «pasos» del ejercicio son la versión sin pantalla de la misma actividad (cómo hacerla en casa, en voz alta y juntos). No copies la actividad entera en los pasos.",
  ];
  if (r.mecanica === "poesia") {
    const n = versesFor(r);
    const rhyme = r.esquema === "libre"
      ? "sin rima obligatoria, con un ritmo tranquilo"
      : `con esquema ${r.esquema} (riman los versos ${pairsText(r.esquema)} de cada estrofa), ${RHYME_KIND_PROMPT[r.rima]}`;
    return [
      `Además del ejercicio, armá «actividad»: una poesía original para leer juntos en el celular, verso por verso. ${r.estrofas} ${r.estrofas === 1 ? "estrofa" : "estrofas"} de ${n} versos, ${rhyme}.`,
      "Cada verso, hasta 60 caracteres, con palabras simples y conocidas para la franja de edad. Que cuente algo con sentido de principio a fin. Las rimas tienen que salir naturales: nada de palabras inventadas, versos sin sentido para forzar la rima, ni la misma palabra para rimar dos veces." + sounds,
      ...common,
    ].join(" ");
  }
  return [
    `Además del ejercicio, armá «actividad»: un juego de ${r.tarjetas} tarjetas para completar la rima.`,
    `En cada tarjeta: «verso» es un verso completo. «completar» es el verso que sigue y termina con ${BLANK} (tres guiones bajos) en lugar de su última palabra. «respuesta» es esa palabra: una sola palabra común que rima con la última palabra de «verso» (por lo menos en las vocales desde la sílaba fuerte, como «pelota» y «rebota») y que completa el sentido. «distractores»: 2 palabras comunes, de la misma clase que la respuesta, que NO riman con la última palabra de «verso».`,
    "Versos de hasta 90 caracteres, con palabras simples y conocidas para la franja de edad. Cada tarjeta, con una rima distinta." + sounds,
    ...common,
  ].join(" ");
}

// ── El esquema de la respuesta (modo strict: sin largos ni enums; los revisa activityFromWire) ──

const ICONO = { type: ["string", "null"] } as const;

export function activityJsonSchema(r: Pick<ActivityRequest, "mecanica">) {
  if (r.mecanica === "poesia") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["titulo", "tema", "estrofas"],
      properties: {
        titulo: { type: "string" },
        tema: { type: "string" },
        estrofas: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["versos", "icono"],
            properties: { versos: { type: "array", items: { type: "string" } }, icono: ICONO },
          },
        },
      },
    } as const;
  }
  return {
    type: "object",
    additionalProperties: false,
    required: ["titulo", "tema", "tarjetas"],
    properties: {
      titulo: { type: "string" },
      tema: { type: "string" },
      tarjetas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["verso", "completar", "respuesta", "distractores", "icono"],
          properties: {
            verso: { type: "string" },
            completar: { type: "string" },
            respuesta: { type: "string" },
            distractores: { type: "array", items: { type: "string" } },
            icono: ICONO,
          },
        },
      },
    },
  } as const;
}

// ── De la respuesta a la actividad ──────────────────────────────────────────

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
// Un dibujo o un tema que no está en el catálogo no se inventa: queda sin
// dibujo o con el tema de siempre
const icon = (v: unknown) => (isIconId(v) ? v : null);

// La actividad que armó el modelo, con lo que pidió el profesional (esquema,
// tipo de rima, palmas). La cantidad de estrofas, de versos y de tarjetas
// tiene que ser la pedida.
export function activityFromWire(raw: unknown, r: ActivityRequest): { ok: true; spec: ActivitySpec } | { ok: false; error: string } {
  const w = rec(raw);
  const base = { v: SPEC_VERSION, titulo: w.titulo, tema: isThemeId(w.tema) ? w.tema : DEFAULT_THEME };
  let candidate: unknown;
  if (r.mecanica === "poesia") {
    const estrofas = arr(w.estrofas).map((e) => ({ versos: arr(rec(e).versos), icono: icon(rec(e).icono) }));
    const n = versesFor(r);
    if (estrofas.length !== r.estrofas || estrofas.some((e) => e.versos.length !== n)) {
      return { ok: false, error: `La poesía no tiene ${r.estrofas} estrofas de ${n} versos.` };
    }
    candidate = { ...base, mecanica: "poesia", esquema: r.esquema, rima: r.rima, palmas: r.palmas, estrofas };
  } else {
    const tarjetas = arr(w.tarjetas).map((t) => {
      const c = rec(t);
      return { verso: c.verso, completar: c.completar, respuesta: c.respuesta, distractores: arr(c.distractores), icono: icon(c.icono) };
    });
    if (tarjetas.length !== r.tarjetas) return { ok: false, error: `El juego no tiene ${r.tarjetas} tarjetas.` };
    candidate = { ...base, mecanica: "rima", tarjetas };
  }
  const v = validateActivity(candidate);
  return v.ok ? { ok: true, spec: v.value } : { ok: false, error: v.error };
}

// ── En palabras (para «Esto es lo que se manda a la IA») ────────────────────

export function describeActivityRequest(r: ActivityRequest): string {
  const shape = r.mecanica === "poesia"
    ? `${r.estrofas} ${r.estrofas === 1 ? "estrofa" : "estrofas"} de ${versesFor(r)} versos, ${SCHEME_LABEL[r.esquema].toLowerCase()}${r.esquema === "libre" ? "" : `, rima ${r.rima}`}`
    : `${r.tarjetas} tarjetas`;
  const sounds = r.sonidos.length ? ` · sonidos: ${r.sonidos.join(", ")}` : "";
  return `${MECHANIC_LABEL[r.mecanica]} (${shape})${sounds}`;
}

// ── Modo demo (sin IA) ──────────────────────────────────────────────────────

const DEMO_STANZAS: string[][] = [
  ["Un cohete chiquito", "despega despacito,", "saluda a la luna", "que brilla en la cuna."],
  ["Pasa por una estrella", "redonda, grande y bella,", "y vuelve a su casita", "con una sonrisita."],
  ["Mañana otro viaje", "con poco equipaje,", "y un cuento para contar", "cuando vuelva a aterrizar."],
];

const DEMO_CARDS = [
  { verso: "Patea la pelota", completar: `y la pelota ${BLANK}`, respuesta: "rebota", distractores: ["corre", "salta"], icono: "pelota" as const },
  { verso: "Mi gato Ramón", completar: `duerme en el ${BLANK}`, respuesta: "sillón", distractores: ["piso", "techo"], icono: "gato" as const },
  { verso: "La luna redonda", completar: `se mira en la ${BLANK}`, respuesta: "onda", distractores: ["calle", "mesa"], icono: "luna" as const },
  { verso: "Un sapo en el lago", completar: `toma un ${BLANK}`, respuesta: "trago", distractores: ["jugo", "mate"], icono: null },
  { verso: "Vuela la paloma", completar: `por arriba de la ${BLANK}`, respuesta: "loma", distractores: ["casa", "plaza"], icono: "pajaro" as const },
  { verso: "Salta el conejo", completar: `y se mira en el ${BLANK}`, respuesta: "espejo", distractores: ["agua", "vidrio"], icono: "conejo" as const },
];

// Una actividad fija (sin IA) con la forma pedida: siempre pasa activityFromWire
export function mockActivityWire(r: ActivityRequest): Record<string, unknown> {
  if (r.mecanica === "poesia") {
    const n = versesFor(r);
    return {
      titulo: "Viaje a la luna",
      tema: "espacio",
      estrofas: DEMO_STANZAS.slice(0, r.estrofas).map((versos, i) => ({
        versos: n === 2 ? versos.slice(0, 2) : versos,
        icono: i === 0 ? "cohete" : "estrella",
      })),
    };
  }
  return { titulo: "Rimas para completar", tema: "campo", tarjetas: DEMO_CARDS.slice(0, r.tarjetas) };
}
