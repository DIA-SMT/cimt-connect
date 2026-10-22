// Actividades interactivas: el contrato (diseño en docs/actividades-fase-0.md).
// Puro y sin alias de imports: lo usan el servidor, el panel, el portal, el
// mock y las pruebas.
//
// Una actividad es DATOS, nunca código: el portal la juega con sus propios
// componentes (src/components/activity/). Se guarda junto al ejercicio del
// plan (patient_exercises.activity, script 33) y queda congelada con la
// versión publicada. Cada mecánica es una variante distinta según
// «mecanica». «v» es la versión del contrato: migrateSpec lleva las viejas a
// la actual antes de validar, así un plan publicado siempre se puede abrir.
//
// Fase 1: «poesia» y «rima», cargadas a mano o armadas con la IA.
// Juegos con la voz (src/lib/speechGames.ts), cargados a mano: «globo»
// (arranque suave con el micrófono, que no graba nada) y «lectura» (leer
// siguiendo a la tortuga, al ritmo que elige el profesional).
// «Me grabo» («grabacion», cargada a mano, con la etapa "recordings"): la
// familia graba lo que pide la consigna y se lo manda al profesional, que la
// escucha con la microevaluación de la IA (src/lib/recordingAnalysis.ts).

import { z } from "zod";
import { DEFAULT_THEME, ICON_IDS, THEME_IDS } from "./activityAssets";
import { RHYME_KINDS } from "./rhymeEs";
import { READING_PACES } from "./speechGames";

export const SPEC_VERSION = 1;

export const MECHANICS = ["poesia", "rima", "globo", "lectura", "grabacion"] as const;
export type Mechanic = (typeof MECHANICS)[number];
// Las que puede armar la IA (los juegos con la voz se cargan a mano)
export const AI_MECHANICS = ["poesia", "rima"] as const satisfies readonly Mechanic[];
export type AiMechanic = (typeof AI_MECHANICS)[number];
export const MECHANIC_LABEL: Record<Mechanic, string> = {
  poesia: "Poesía para leer juntos",
  rima: "Completar la rima",
  globo: "El globo de la voz suave",
  lectura: "Leer con la tortuga",
  grabacion: "Me grabo",
};
export const MECHANIC_HINT: Record<Mechanic, string> = {
  poesia: "La poesía aparece verso por verso, con la voz del celular si se quiere, para decirla en voz alta.",
  rima: "Tarjetas con un verso para completar: se elige la palabra que rima.",
  globo: "Se dice cada palabra arrancando suave, como un soplido: el globo sube con la voz. El micrófono se usa solo en el celular: no se graba nada.",
  lectura: "La tortuga va iluminando la frase palabra por palabra y se lee siguiéndola.",
  grabacion: "Se graba lo que pide la consigna y se le manda al profesional, que la escucha. Grabarse es optativo.",
};

// En qué enfoques del ejercicio se ofrece cada juego (null: en todos).
// Propuesta a validar por las fonoaudiólogas: el arranque suave es una
// técnica de «habla fácil»; leer despacio sirve también para el ritmo y la lectura
export const MECHANIC_APPROACHES: Record<Mechanic, readonly string[] | null> = {
  poesia: null,
  rima: null,
  globo: ["habla_facil"],
  lectura: ["habla_facil", "ritmo_y_claridad", "escuela_y_lectura"],
  // Grabarse sirve para ver cómo va el habla: en las áreas de fonoaudiología
  // y lectura (en «entorno familia» se trabaja con el adulto, no con el chico)
  grabacion: ["habla_facil", "tartamudear_facil", "animarse", "ritmo_y_claridad", "escuela_y_lectura"],
};
export const mechanicAllowed = (m: Mechanic, approach: string) => {
  const list = MECHANIC_APPROACHES[m];
  return list === null || list.includes(approach);
};

// Esquemas de rima de cada estrofa (A con A, B con B). «libre»: sin rima pedida
export const POEM_SCHEMES = ["AA", "AABB", "ABAB", "ABCB", "libre"] as const;
export type PoemScheme = (typeof POEM_SCHEMES)[number];
export const SCHEME_LABEL: Record<PoemScheme, string> = {
  AA: "Pareados (2 versos que riman)",
  AABB: "AABB (1 con 2, 3 con 4)",
  ABAB: "ABAB (1 con 3, 2 con 4)",
  ABCB: "ABCB (2 con 4)",
  libre: "Libre (sin rima pedida)",
};
// Versos por estrofa que pide cada esquema (null: de 2 a 4)
export const SCHEME_LINES: Record<PoemScheme, number | null> = { AA: 2, AABB: 4, ABAB: 4, ABCB: 4, libre: null };
// Qué versos tienen que rimar (índices dentro de la estrofa)
export const SCHEME_PAIRS: Record<PoemScheme, readonly (readonly [number, number])[]> = {
  AA: [[0, 1]],
  AABB: [[0, 1], [2, 3]],
  ABAB: [[0, 2], [1, 3]],
  ABCB: [[1, 3]],
  libre: [],
};

export const ACTIVITY_LIMITS = {
  titulo: 60,
  estrofas_max: 4,
  versos_min: 2,
  versos_max: 4,
  verso: 60,
  tarjetas_min: 2,
  tarjetas_max: 8,
  linea: 90,
  palabra: 24,
  distractores_min: 1,
  distractores_max: 3,
  palabras_min: 2,
  palabras_max: 10,
  palabra_voz: 40, // una palabra o una frase corta para el globo
  frases_min: 1,
  frases_max: 8,
  frase: 140,
  consigna: 160,
  texto_grabacion: 600,
  segundos_min: 15,
  segundos_max: 60,
  json: 24_000, // tope del JSON guardado (el mismo CHECK en la base)
} as const;

// El hueco del verso para completar
export const BLANK = "___";

const L = ACTIVITY_LIMITS;
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const text = (max: number, what: string) =>
  z.preprocess(clean, z.string().min(1, `Completá ${what}.`).max(max, `${capital(what)}: el máximo es ${max} caracteres.`));
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const word = z.preprocess(clean, z.string()
  .min(1, "Completá la palabra.")
  .max(L.palabra, `Cada palabra tiene hasta ${L.palabra} caracteres.`)
  .regex(/^[a-záéíóúüñ]+( [a-záéíóúüñ]+)?$/i, "Escribí una o dos palabras, sin signos."));
const icono = z.enum(ICON_IDS).nullable().default(null);

const base = {
  v: z.literal(SPEC_VERSION),
  titulo: text(L.titulo, "el título de la actividad"),
  tema: z.enum(THEME_IDS).default(DEFAULT_THEME),
};

const poemObject = z.object({
  ...base,
  mecanica: z.literal("poesia"),
  esquema: z.enum(POEM_SCHEMES),
  rima: z.enum(RHYME_KINDS).default("asonante"),
  palmas: z.boolean().default(false), // marcar el ritmo con palmas, palabra por palabra
  estrofas: z.array(z.object({
    versos: z.array(text(L.verso, "el verso"))
      .min(L.versos_min, `Cada estrofa tiene de ${L.versos_min} a ${L.versos_max} versos.`)
      .max(L.versos_max, `Cada estrofa tiene de ${L.versos_min} a ${L.versos_max} versos.`),
    icono,
  }).strict()).min(1, "Escribí al menos una estrofa.").max(L.estrofas_max, `La poesía tiene hasta ${L.estrofas_max} estrofas.`),
}).strict();

// Con un esquema de rima, todas las estrofas tienen los versos que pide
function poemLines(p: z.output<typeof poemObject>, ctx: z.RefinementCtx) {
  const n = SCHEME_LINES[p.esquema];
  if (n === null) return;
  p.estrofas.forEach((e, i) => {
    if (e.versos.length !== n) {
      ctx.addIssue({ code: "custom", path: ["estrofas", i, "versos"], message: `Con el esquema ${p.esquema}, cada estrofa tiene ${n} versos (la ${i + 1} tiene ${e.versos.length}).` });
    }
  });
}

export const poemSchema = poemObject.superRefine(poemLines);

export const rhymeCardSchema = z.object({
  verso: text(L.linea, "el primer verso"),
  completar: text(L.linea, "el verso para completar"),
  respuesta: word,
  distractores: z.array(word)
    .min(L.distractores_min, `Cada tarjeta tiene de ${L.distractores_min} a ${L.distractores_max} opciones que no riman.`)
    .max(L.distractores_max, `Cada tarjeta tiene de ${L.distractores_min} a ${L.distractores_max} opciones que no riman.`),
  icono,
}).strict().superRefine((c, ctx) => {
  if (c.completar.split(BLANK).length !== 2) {
    ctx.addIssue({ code: "custom", path: ["completar"], message: `El verso para completar lleva el hueco ${BLANK} una sola vez.` });
  }
  const opts = [c.respuesta, ...c.distractores].map((x) => x.toLowerCase());
  if (new Set(opts).size !== opts.length) {
    ctx.addIssue({ code: "custom", path: ["distractores"], message: "Las opciones no se pueden repetir (ni repetir la respuesta)." });
  }
});

export const rhymeSchema = z.object({
  ...base,
  mecanica: z.literal("rima"),
  tarjetas: z.array(rhymeCardSchema)
    .min(L.tarjetas_min, `Armá de ${L.tarjetas_min} a ${L.tarjetas_max} tarjetas.`)
    .max(L.tarjetas_max, `Armá de ${L.tarjetas_min} a ${L.tarjetas_max} tarjetas.`),
}).strict();

// El globo: una palabra (o una frase corta) por paso
export const balloonSchema = z.object({
  ...base,
  mecanica: z.literal("globo"),
  palabras: z.array(text(L.palabra_voz, "la palabra"))
    .min(L.palabras_min, `Escribí de ${L.palabras_min} a ${L.palabras_max} palabras.`)
    .max(L.palabras_max, `Escribí de ${L.palabras_min} a ${L.palabras_max} palabras.`),
}).strict();

// Leer con la tortuga: una frase por paso, al ritmo elegido
export const readingSchema = z.object({
  ...base,
  mecanica: z.literal("lectura"),
  ritmo: z.enum(READING_PACES).default("lento"),
  frases: z.array(text(L.frase, "la frase"))
    .min(L.frases_min, `Escribí de ${L.frases_min} a ${L.frases_max} frases.`)
    .max(L.frases_max, `Escribí de ${L.frases_min} a ${L.frases_max} frases.`),
}).strict();

// Me grabo: la consigna, el texto para leer (si es de lectura) y cuánto puede durar
export const recordingSchema = z.object({
  ...base,
  mecanica: z.literal("grabacion"),
  consigna: text(L.consigna, "la consigna"),
  texto: z.preprocess((v) => (clean(v) ? v : null), text(L.texto_grabacion, "el texto para leer").nullable()).default(null),
  segundos: z.number().int().min(L.segundos_min, `La grabación dura de ${L.segundos_min} a ${L.segundos_max} segundos.`)
    .max(L.segundos_max, `La grabación dura de ${L.segundos_min} a ${L.segundos_max} segundos.`).default(60),
}).strict();

// La unión necesita los objetos sin refinar: la regla de los versos por
// estrofa se corre después, sobre la unión
export const activitySchema = z.discriminatedUnion("mecanica", [poemObject, rhymeSchema, balloonSchema, readingSchema, recordingSchema]).superRefine((a, ctx) => {
  if (a.mecanica === "poesia") poemLines(a, ctx);
});

export type PoemSpec = z.output<typeof poemObject>;
export type RhymeCard = z.output<typeof rhymeCardSchema>;
export type RhymeSpec = z.output<typeof rhymeSchema>;
export type BalloonSpec = z.output<typeof balloonSchema>;
export type ReadingSpec = z.output<typeof readingSchema>;
export type RecordingSpec = z.output<typeof recordingSchema>;
export type ActivitySpec = PoemSpec | RhymeSpec | BalloonSpec | ReadingSpec | RecordingSpec;

// Lleva una versión vieja del contrato a la actual. null: no se reconoce
export function migrateSpec(raw: unknown): unknown | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = (raw as { v?: unknown }).v;
  if (v === SPEC_VERSION) return raw;
  return null; // todavía no hay versiones anteriores
}

export type ActivityProblem = { error: string; path: string };

// Dónde está un problema, para el mensaje: «Estrofa 2, verso 3», «Tarjeta 1»
export function activityPlace(path: string): string {
  const p = path.split(".");
  if (p[0] === "estrofas" && p[1] !== undefined) {
    const verse = p[2] === "versos" && p[3] !== undefined ? `, verso ${Number(p[3]) + 1}` : "";
    return `Estrofa ${Number(p[1]) + 1}${verse}`;
  }
  if (p[0] === "tarjetas" && p[1] !== undefined) return `Tarjeta ${Number(p[1]) + 1}`;
  if (p[0] === "palabras" && p[1] !== undefined) return `Palabra ${Number(p[1]) + 1}`;
  if (p[0] === "frases" && p[1] !== undefined) return `Frase ${Number(p[1]) + 1}`;
  return "";
}

// Los mensajes que Zod pone solo (los del esquema ya están en castellano)
const spanishErrors: z.ZodErrorMap = (issue, ctx) => {
  if (issue.code === "invalid_union_discriminator") return { message: "Ese tipo de actividad no existe." };
  if (issue.code === "invalid_enum_value") return { message: "Elegí una de las opciones de la lista." };
  if (issue.code === "unrecognized_keys") return { message: "La actividad tiene datos que no corresponden." };
  if (issue.code === "invalid_type" || issue.code === "invalid_literal") return { message: "La actividad tiene un dato que no corresponde." };
  return { message: ctx.defaultError };
};

// Valida una actividad (la que manda el panel o la que viene de la base)
export function validateActivity(raw: unknown): { ok: true; value: ActivitySpec } | ({ ok: false } & ActivityProblem) {
  const migrated = migrateSpec(raw);
  if (migrated === null) return { ok: false, error: "La actividad no tiene un formato que conozcamos.", path: "" };
  const r = activitySchema.safeParse(migrated, { errorMap: spanishErrors });
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue ? issue.path.join(".") : "";
    const place = activityPlace(path);
    const message = issue?.message ?? "La actividad no es válida.";
    return { ok: false, error: place ? `${place}: ${message}` : message, path };
  }
  if (JSON.stringify(r.data).length > L.json) return { ok: false, error: "La actividad es demasiado larga.", path: "" };
  return { ok: true, value: r.data as ActivitySpec };
}

// Lo que se guardó, para mostrar: si no se puede leer, null (la familia ve
// los pasos de siempre y el panel avisa)
export function readActivity(raw: unknown): ActivitySpec | null {
  if (raw === null || raw === undefined) return null;
  const r = validateActivity(raw);
  return r.ok ? r.value : null;
}
