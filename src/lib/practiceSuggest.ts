// Sugerencias para armar los ejercicios con lo que dice la ficha del paciente.
// Puro: lo usan el servidor (server/lib/practice.ts), el modo mock y las
// pruebas. Sin alias de imports (el servidor lo importa con ruta relativa).
//
// El diagnóstico es lo que más pesa: decide qué enfoques corresponden y en qué
// orden se recomiendan. Después suman la edad, otras condiciones, el semáforo
// de autonomía, la escuela, las situaciones donde aparece más, si evita hablar
// o se frustra, y los intereses.
//
// Todo esto se queda en el panel: el profesional ve la sugerencia y el porqué
// («why») y decide. A la IA solo viajan las listas cerradas que el profesional
// confirma (enfoque, adaptaciones, contexto, intereses, formato), nunca la
// ficha ni el porqué. BORRADOR de las reglas: lo revisan las fonoaudiólogas.

import {
  type Adaptacion, type Contexto, type Formato, type Interes, FORMATS, INTERESTS, AI_INTERESTS_MAX, formatAllowed,
} from "./aiDraftRules";
import {
  type Approach, approachAgeOk, approachesForDiagnosis, diagnosisGroup, DIAGNOSIS_APPROACHES,
} from "./practiceRules";

/** Lo que el servidor lee de la ficha para sugerir (nunca sale del panel) */
export type PracticeProfile = {
  age: number | null;
  diagnosis_code: string | null;
  other_conditions: string[];
  autonomy: "verde" | "amarillo" | "rojo" | null;
  school: string | null;
  stutter_situations: string | null;
  avoids_speaking: boolean | null;
  frustration_communicating: boolean | null;
  interests: string[];
};

export type Why<T> = { value: T; why: string };

export type PracticeSuggestions = {
  /** Enfoques para la edad, del más recomendado al menos */
  approaches: Why<Approach>[];
  adaptaciones: Why<Adaptacion>[];
  contexto: Why<Contexto>[];
  intereses: Interes[];
  formato: Why<Formato>;
};

const norm = (s: string | null | undefined) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const hasCondition = (p: PracticeProfile, ...names: string[]) =>
  p.other_conditions.some((c) => names.some((n) => norm(c).includes(norm(n))));

const conditionNames = (p: PracticeProfile, ...names: string[]) =>
  p.other_conditions.filter((c) => names.some((n) => norm(c).includes(norm(n)))).join(", ");

// Agrega sin repetir: si ya estaba, suma el motivo
function add<T>(list: Why<T>[], value: T, why: string) {
  const prev = list.find((x) => x.value === value);
  if (prev) { if (!prev.why.includes(why)) prev.why = `${prev.why} ${why}`; } else list.push({ value, why });
}

export function suggestPractice(p: PracticeProfile): PracticeSuggestions {
  const age = p.age;
  const group = diagnosisGroup(p.diagnosis_code);
  const code = String(p.diagnosis_code ?? "").trim().toUpperCase();
  const byDiagnosis = new Set<Approach>(DIAGNOSIS_APPROACHES[group]);
  const offered = approachesForDiagnosis(p.diagnosis_code).filter((a) => approachAgeOk(a, age));

  // ── Enfoques: puntaje (el diagnóstico pesa más que todo lo demás) ──
  const score = new Map<Approach, number>();
  const why = new Map<Approach, string[]>();
  const give = (a: Approach, points: number, reason: string) => {
    if (!offered.includes(a)) return;
    score.set(a, (score.get(a) ?? 0) + points);
    why.set(a, [...(why.get(a) ?? []), reason]);
  };
  const dx = group === "evaluacion"
    ? "Todavía sin diagnóstico en la ficha: se empieza por el entorno."
    : `Corresponde al diagnóstico de la ficha (${code}).`;
  for (const a of offered) if (byDiagnosis.has(a)) give(a, 100, dx);

  if (group === "F98.5" && age !== null) {
    if (age <= 5) give("entorno_familia", 30, "Entre 2 y 5 años, el trabajo empieza por el adulto y el entorno.");
    if (age >= 6 && age <= 12) give("habla_facil", 20, "A esta edad se practican inicios suaves jugando.");
    if (age <= 8) give("entorno_familia", 10, "La familia sostiene la práctica en casa.");
  }
  if (p.avoids_speaking) give("animarse", 15, "La ficha dice que evita hablar en algunas situaciones.");
  if (p.frustration_communicating) give("tartamudear_facil", 15, "La ficha dice que se frustra o angustia al comunicarse.");
  if (p.school && age !== null && age >= 6 && age <= 17) give("escuela_y_lectura", 15, "Va a la escuela (dato de la ficha).");
  if (hasCondition(p, "TEA", "TDAH")) {
    give("regulacion_y_rutinas", 15, `La ficha registra ${conditionNames(p, "TEA", "TDAH")}: ayudan las rutinas previsibles.`);
  }
  const approaches = [...offered]
    .sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || offered.indexOf(a) - offered.indexOf(b))
    .map((a) => ({ value: a, why: (why.get(a) ?? ["Otra área del centro, disponible para esta edad."]).join(" ") }));

  // ── Adaptaciones: la necesidad, nunca la condición, es lo que viaja ──
  const adaptaciones: Why<Adaptacion>[] = [];
  if (age !== null && age <= 5) add(adaptaciones, "sin_lectura", "A esta edad todavía no lee.");
  if (hasCondition(p, "TDAH")) {
    add(adaptaciones, "atencion_breve", "TDAH en la ficha.");
    add(adaptaciones, "con_movimiento", "TDAH en la ficha.");
  }
  if (hasCondition(p, "TEA")) {
    add(adaptaciones, "apoyo_visual", "TEA en la ficha.");
    add(adaptaciones, "consignas_cortas", "TEA en la ficha.");
  }
  if (hasCondition(p, "Discapacidad intelectual", "Síndrome de Down")) {
    const names = conditionNames(p, "Discapacidad intelectual", "Síndrome de Down");
    add(adaptaciones, "consignas_cortas", `${names} en la ficha.`);
    add(adaptaciones, "apoyo_visual", `${names} en la ficha.`);
  }
  if (hasCondition(p, "Hipoacusia")) add(adaptaciones, "apoyo_visual", "Hipoacusia en la ficha.");
  if (hasCondition(p, "Retraso del lenguaje")) add(adaptaciones, "consignas_cortas", "Retraso del lenguaje en la ficha.");
  if (p.autonomy === "rojo") {
    add(adaptaciones, "sin_lectura", "Semáforo rojo: quien acompaña no maneja la lectoescritura.");
    add(adaptaciones, "consignas_cortas", "Semáforo rojo.");
  } else if (p.autonomy === "amarillo") {
    add(adaptaciones, "consignas_cortas", "Semáforo amarillo: necesita ayuda con las consignas.");
  }

  // ── Dónde: en casa siempre; el resto, según la ficha ──
  const contexto: Why<Contexto>[] = [{ value: "casa", why: "La práctica es en casa." }];
  if (age !== null && age <= 8) add(contexto, "juego", "A esta edad se aprende jugando.");
  const sit = norm(p.stutter_situations);
  if (/telefon|celular|llamad/.test(sit)) add(contexto, "telefono", "Aparece más al hablar por teléfono (ficha).");
  if (/kiosco|negocio|compr|plaza|calle|salid|almacen|super/.test(sit)) add(contexto, "salidas", "Aparece más en salidas o comercios (ficha).");
  if (/escuel|colegio|clase|maestr|profe|leer|lectura/.test(sit)) add(contexto, "escuela", "Aparece más en la escuela (ficha).");
  else if (p.school && age !== null && age >= 6 && age <= 17 && p.avoids_speaking) {
    add(contexto, "escuela", "Va a la escuela y evita hablar en algunas situaciones.");
  }
  if (/jug|juego/.test(sit)) add(contexto, "juego", "Aparece más cuando juega (ficha).");

  // ── Intereses de la ficha (los primeros) ──
  const intereses = INTERESTS.filter((i) => p.interests.includes(i)).slice(0, AI_INTERESTS_MAX);

  // ── Formato: a los más chicos, como juego ──
  const top = approaches[0]?.value ?? null;
  const formato: Why<Formato> = age !== null && age <= 8 && top && formatAllowed("minijuego", top)
    ? { value: "minijuego", why: "Hasta los 8 años se engancha más si es un juego." }
    : { value: FORMATS[0], why: "Formato de siempre: pasos claros para practicar." };

  return { approaches, adaptaciones, contexto, intereses, formato };
}


// La fila de la ficha (lo que se lee de patients) como perfil. Lo usan el
// servidor y el mock con la misma regla; lo que falte queda vacío.
export function profileFromRow(
  row: Record<string, unknown> | null | undefined,
  age: number | null,
  diagnosis_code: string | null,
): PracticeProfile {
  const r = row ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const autonomy = r.autonomy === "verde" || r.autonomy === "amarillo" || r.autonomy === "rojo" ? r.autonomy : null;
  return {
    age,
    diagnosis_code,
    other_conditions: list(r.other_conditions),
    autonomy,
    school: str(r.school),
    stutter_situations: str(r.stutter_situations),
    avoids_speaking: bool(r.avoids_speaking),
    frustration_communicating: bool(r.frustration_communicating),
    interests: list(r.interests),
  };
}

// Columnas de patients que hacen falta (el servidor las pide así)
export const PROFILE_COLUMNS = "other_conditions, autonomy, school, stutter_situations, avoids_speaking, frustration_communicating, interests";
