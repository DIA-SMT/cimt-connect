// Portal — ejercicios, devoluciones, metas y medallas (etapa B, "practice").
// Puro: lo usan el servidor (server/lib/portalPractice.ts y los endpoints
// server/api/portal/practice.ts y server/api/portal-staff/practice.ts), el
// modo mock y las pruebas. Sin alias de imports (el servidor lo importa con
// ruta relativa).
//
// Reglas de base (diseño §5):
//   - Se premia practicar, animarse y participar. Nunca la fluidez: no hay
//     medallas de fluidez, ni rachas que se pierdan, ni comparaciones. Una
//     medalla no se pierde nunca (solo la anula un profesional, con motivo).
//   - Una práctica por ejercicio y por día, aunque la anoten dos adultos.
//     Cada adulto cuenta "¿Cómo te fue?" por su lado (notas por cuenta).
//   - Los comentarios de la familia los leen solo los perfiles clínicos y
//     nunca van a la IA.
//   - Las fechas son las del centro (Tucumán). La semana va de lunes a
//     domingo y se identifica por la fecha de su lunes ("2026-12-28").
//   - Los registros y las medallas no se usan para decisiones
//     administrativas (por ejemplo, dar de baja a alguien "por no practicar").
//   - Método Lidcombe: en la v1 no se publica un plan en el portal.
//
// Las familias nunca leen las tablas (script 26): todo pasa por el servidor.

import { type ActivitySpec, MECHANIC_LABEL, mechanicAllowed, validateActivity } from "./activitySpec";
import { activityTexts } from "./activityMechanics";
import { CENTER } from "./center";
import { ADOLESCENT_FROM, ADULT_FROM } from "./portalClinicalRules";
import { REVIEW_NOTE_MAX, cleanText, fitText } from "./portalInfoRules";
import { addDaysKey, centerDateOf, centerNow } from "./portalRules";
import type { PracticeSuggestions } from "./practiceSuggest";

// ── Enfoques ────────────────────────────────────────────────────────────────
// Lista cerrada y compartida (la base la repite en un CHECK). "emociones" no
// se ofrece hasta que lo valide psicología; Lidcombe queda fuera en la v1.

export const APPROACHES = [
  "entorno_familia",
  "habla_facil",
  "tartamudear_facil",
  "animarse",
  "ritmo_y_claridad",
  "escuela_y_lectura",
  "regulacion_y_rutinas",
] as const;
export type Approach = (typeof APPROACHES)[number];

export function isApproach(x: unknown): x is Approach {
  return (APPROACHES as readonly unknown[]).includes(x);
}

export const APPROACH_LABEL: Record<Approach, string> = {
  entorno_familia: "Tiempo en familia (habla tranquila del adulto)",
  habla_facil: "Habla fácil (inicios y contactos suaves)",
  tartamudear_facil: "Tartamudear fácil (sin juzgar)",
  animarse: "Animarse (desafíos de a poco)",
  ritmo_y_claridad: "Ritmo y claridad",
  escuela_y_lectura: "Escuela y lectura (psicopedagogía)",
  regulacion_y_rutinas: "Regulación y rutinas (terapia ocupacional)",
};

// Áreas del centro (la IA recibe el área, nunca el diagnóstico)
export const PRACTICE_AREAS = ["fonoaudiologia", "psicologia", "psicopedagogia", "terapia_ocupacional"] as const;
export type PracticeArea = (typeof PRACTICE_AREAS)[number];

export const APPROACH_AREA: Record<Approach, PracticeArea> = {
  entorno_familia: "fonoaudiologia",
  habla_facil: "fonoaudiologia",
  tartamudear_facil: "fonoaudiologia",
  animarse: "fonoaudiologia",
  ritmo_y_claridad: "fonoaudiologia",
  escuela_y_lectura: "psicopedagogia",
  regulacion_y_rutinas: "terapia_ocupacional",
};

// Matriz de edad (diseño §4.2; propuesta a validar por las fonoaudiólogas).
// needs_session: además hace falta la casilla "Ya lo practicamos en sesión".
export type ApproachRule = { from: number; to: number | null; needs_session: boolean };
export const APPROACH_RULES: Record<Approach, ApproachRule> = {
  entorno_familia: { from: 2, to: null, needs_session: false },
  habla_facil: { from: 6, to: null, needs_session: false },
  tartamudear_facil: { from: 9, to: null, needs_session: true },
  animarse: { from: 9, to: null, needs_session: true },
  ritmo_y_claridad: { from: 9, to: null, needs_session: false },
  escuela_y_lectura: { from: 6, to: 17, needs_session: false },
  regulacion_y_rutinas: { from: 2, to: null, needs_session: false },
};

// ¿El enfoque corresponde a esta edad? (sin mirar la casilla de sesión).
// Sin fecha de nacimiento no se puede saber: false.
export function approachAgeOk(approach: Approach, age: number | null): boolean {
  if (age === null) return false;
  const r = APPROACH_RULES[approach];
  return age >= r.from && (r.to === null || age <= r.to);
}

// Regla completa para publicar: la edad y, si el enfoque lo pide, "Ya lo
// practicamos en sesión"
export function approachAllowed(approach: string, age: number | null, practicedInSession = false): boolean {
  if (!isApproach(approach) || !approachAgeOk(approach, age)) return false;
  return !APPROACH_RULES[approach].needs_session || practicedInSession;
}

// El diagnóstico de la ficha decide qué enfoques se ofrecen. Se usa solo en
// el servidor (y en el mock): nunca sale hacia la IA ni hacia la familia.
export type DiagnosisGroup = "F98.5" | "F98.6" | "evaluacion";
export const DIAGNOSIS_APPROACHES: Record<DiagnosisGroup, readonly Approach[]> = {
  "F98.5": ["entorno_familia", "habla_facil", "tartamudear_facil", "animarse"],
  "F98.6": ["ritmo_y_claridad"],
  evaluacion: ["entorno_familia"],
};
// Otras áreas del centro: se ofrecen para cualquier diagnóstico (con su edad)
export const OTHER_AREA_APPROACHES: readonly Approach[] = ["escuela_y_lectura", "regulacion_y_rutinas"];

// Sin diagnóstico (en evaluación) o con otro código: como "en evaluación"
export function diagnosisGroup(code: string | null): DiagnosisGroup {
  const c = String(code ?? "").trim().toUpperCase();
  return c === "F98.5" || c === "F98.6" ? c : "evaluacion";
}

// Enfoques que corresponden al diagnóstico más los de otras áreas (sin mirar
// la edad), en el orden de APPROACHES
export function approachesForDiagnosis(code: string | null): Approach[] {
  const wanted = new Set<Approach>([...DIAGNOSIS_APPROACHES[diagnosisGroup(code)], ...OTHER_AREA_APPROACHES]);
  return APPROACHES.filter((a) => wanted.has(a));
}

// Lo que el editor del panel ofrece para este paciente
export type ApproachOption = {
  approach: Approach;
  label: string;
  suggested: boolean; // sale del diagnóstico (no de "otras áreas")
  age_ok: boolean; // corresponde a la edad
  needs_session: boolean; // pide "Ya lo practicamos en sesión"
  adult_guide: string; // texto base de "Para el adulto que acompaña"
};

export function approachOptions(code: string | null, age: number | null): ApproachOption[] {
  const suggested = new Set(DIAGNOSIS_APPROACHES[diagnosisGroup(code)]);
  return approachesForDiagnosis(code).map((a) => ({
    approach: a,
    label: APPROACH_LABEL[a],
    suggested: suggested.has(a),
    age_ok: approachAgeOk(a, age),
    needs_session: APPROACH_RULES[a].needs_session,
    adult_guide: APPROACH_ADULT_GUIDE[a],
  }));
}

// "Para el adulto que acompaña": texto base por enfoque, que el profesional
// puede editar en cada ejercicio. No hay un texto único: algunas técnicas
// trabajan directamente el habla y otras no.
export const APPROACH_ADULT_GUIDE: Record<Approach, string> = {
  entorno_familia:
    "Practiquen en un momento tranquilo, sin apuro. Felicitá el esfuerzo. Si un día no se puede, no pasa nada.",
  habla_facil:
    "Hacelo como un juego y probalo vos primero. Felicitá que lo intente, no cómo le salió. La técnica se usa solo durante el ejercicio: el resto del día, que hable como le salga.",
  tartamudear_facil:
    "Este ejercicio ya lo practicaron en sesión. Acompañá con calma y curiosidad: tartamudear a propósito es parte del ejercicio. No corrijas ni completes palabras.",
  animarse:
    "El desafío lo elige quien practica y tiene que ser alcanzable. Lo que vale es animarse, no cómo salió. Si hoy no se animó, no pasa nada: se puede probar otro día.",
  ritmo_y_claridad:
    "Acá sí se trabaja el ritmo: durante el ejercicio está bien recordar las pausas. Fuera de la práctica, no lo corrijas todo el tiempo.",
  escuela_y_lectura:
    "Elijan un momento sin apuro, lejos de la tarea del día. Valorá lo que cuenta más que la forma. Si se cansa, paren.",
  regulacion_y_rutinas:
    "Mantengan la rutina con calma y avisen los cambios con tiempo. Acompañá con tu presencia, sin apurar. Si un día no se puede, se retoma al siguiente.",
};

// Aviso del editor: el método Lidcombe no va al portal en la v1
export const LIDCOMBE_NOTICE =
  "Para familias en tratamiento con el método Lidcombe no se publica un plan en el portal por ahora: el método requiere supervisión semanal en el centro y sus pautas son distintas de las del portal.";

// ── Edad, modo de pantalla y a quién le habla cada texto ────────────────────
// La navegación, la información y las devoluciones le hablan al adulto dueño
// de la cuenta. Solo los pasos de cada ejercicio le hablan a quien practica.

export const PLAN_AUDIENCES = ["infancia", "preadolescencia", "adolescencia", "adultez"] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];
export const PLAN_AUDIENCE_LABEL: Record<PlanAudience, string> = {
  infancia: "Hasta 8 años",
  preadolescencia: "De 9 a 12 años",
  adolescencia: "De 13 a 17 años",
  adultez: "18 años o más",
};

// Modos de las pantallas de práctica: hasta 8 años la tortuga y las caritas,
// de 9 a 12 paso a paso sin dibujos infantiles, desde 13 una lista de pasos
export type ScreenMode = "tortuga" | "pasos" | "lista";
export const TORTUGA_MAX_AGE = 8;
export const PASOS_MAX_AGE = 12;
export const SCREEN_MODE_BY_AUDIENCE: Record<PlanAudience, ScreenMode> = {
  infancia: "tortuga",
  preadolescencia: "pasos",
  adolescencia: "lista",
  adultez: "lista",
};

// Franja por la edad. Sin edad: "preadolescencia" (paso a paso, ni infantil
// ni de lista), aunque en el portal la edad siempre se conoce
export function audienceForAge(age: number | null): PlanAudience {
  if (age === null) return "preadolescencia";
  if (age <= TORTUGA_MAX_AGE) return "infancia";
  if (age <= PASOS_MAX_AGE) return "preadolescencia";
  if (age < ADULT_FROM) return "adolescencia";
  return "adultez";
}

export function screenMode(age: number | null): ScreenMode {
  return SCREEN_MODE_BY_AUDIENCE[audienceForAge(age)];
}

// De 13 a 17: conformidad y casilla "Lo conversé con …"
export function isAdolescent(age: number | null): boolean {
  return age !== null && age >= ADOLESCENT_FROM && age < ADULT_FROM;
}

// La persona de la que se habla (la cuenta siempre es de un adulto).
// audience: por la edad de la persona (no la del plan)
export type PracticeWho = { first_name: string; self: boolean; audience: PlanAudience };

// "Lic. Ana Torres · MP 1234" → "Lic. Ana Torres"
export function authorName(authorLabel: string | null | undefined): string {
  return String(authorLabel ?? "").split(" · ")[0].trim() || "tu profesional";
}

// "Mis ejercicios" / "Ejercicios de Martín"
export function exercisesTitle(w: PracticeWho): string {
  return w.self ? "Mis ejercicios" : `Ejercicios de ${w.first_name}`;
}

// "medalla" hasta los 12; "logro" desde los 13 y para el titular
export function medalWord(w: PracticeWho): "medalla" | "logro" {
  return w.self || w.audience === "adolescencia" || w.audience === "adultez" ? "logro" : "medalla";
}

// "Mis logros" / "Medallas de Martín" / "Logros de Fernanda"
export function medalsTitle(w: PracticeWho): string {
  if (w.self) return "Mis logros";
  return medalWord(w) === "logro" ? `Logros de ${w.first_name}` : `Medallas de ${w.first_name}`;
}

// "Mensaje de Lic. Ana Torres para Martín" (hasta 12) / "Devolución de Lic. Ana Torres"
export function feedbackTitle(w: PracticeWho, authorLabel: string): string {
  const who = authorName(authorLabel);
  if (!w.self && (w.audience === "infancia" || w.audience === "preadolescencia")) return `Mensaje de ${who} para ${w.first_name}`;
  return `Devolución de ${who}`;
}

// Botón para empezar: "Practicar con Martín" (modo tortuga) o "Empezar"
export function practiceButton(w: PracticeWho, mode: ScreenMode): string {
  return mode === "tortuga" && !w.self ? `Practicar con ${w.first_name}` : "Empezar";
}

// Botón del final: "Ya lo hicimos" (hasta 12) o "Ya lo hice" (desde 13). Si
// se sabe si el ejercicio es con un acompañante (together, «Con un adulto»),
// manda eso: así coincide con el «¡Terminaron!» / «¡Terminaste!» del juego
export function doneButton(mode: ScreenMode, together?: boolean): string {
  if (together !== undefined) return together ? "Ya lo hicimos" : "Ya lo hice";
  return mode === "lista" ? "Ya lo hice" : "Ya lo hicimos";
}

const daysWord = (n: number) => (n === 1 ? "día" : "días");

// "2 de 3 días". Si se pasó de la meta, "4 días (la meta era 3)": nunca "4 de 3"
function weekCount(week: { count: number; target: number }): string {
  return week.count > week.target
    ? `${week.count} ${daysWord(week.count)} (la meta era ${week.target})`
    : `${week.count} de ${week.target} ${daysWord(week.target)}`;
}

// "esta semana 2 de 3 días" o "esta semana 4 días (la meta era 3)" (fila del
// Inicio, botón Ejercicios y título de la semana). En la pausa de vacaciones
// no se muestra: va breakLine
export function weekLine(week: { count: number; target: number }): string {
  return `esta semana ${weekCount(week)}`;
}

// Confirmación después de "Ya lo hice", leída por los lectores de pantalla.
// week: la semana de hoy (WeekDTO trae "week", su lunes). La cuenta de la
// semana se dice solo si la práctica cae en esta semana y no hay pausa: "Ayer"
// un lunes es de la semana anterior (sumaría "0 días esta semana") y en la
// pausa no se cuenta nada. Entonces va un texto neutro con el día.
export function practiceConfirmation(
  w: PracticeWho,
  mode: ScreenMode,
  week: { count: number; target: number; week?: string },
  opts: { day?: { date: string; label: string }; on_break?: boolean } = {},
): string {
  const child = !w.self && mode !== "lista";
  const otherWeek = !!opts.day && !!week.week && weekKey(opts.day.date) !== week.week;
  if (otherWeek || opts.on_break) {
    const label = opts.day?.label ?? "hoy";
    return child ? `¡Bien hecho, ${w.first_name}! Quedó anotada la práctica de ${label}.` : `Listo, quedó anotada la práctica de ${label}.`;
  }
  if (child) {
    return `¡Bien hecho, ${w.first_name}! Ya ${week.count === 1 ? "va" : "van"} ${week.count} ${daysWord(week.count)} esta semana.`;
  }
  return `Listo, quedó registrado. Esta semana: ${weekCount(week)}.`;
}

// Título de "¿Cómo te fue?": el día solo si no es hoy ("¿Cómo te fue ayer?")
export function howDidItGo(label: string): string {
  return label === "hoy" ? PRACTICE_TEXT.how_did_it_go : `¿Cómo te fue ${label}?`;
}

// Etiqueta del comentario optativo
export function commentLabel(w: PracticeWho, authorLabel: string | null): string {
  if (!w.self && (w.audience === "infancia" || w.audience === "preadolescencia")) {
    return `¿Querés contarle algo a ${authorName(authorLabel)}? (lo escribe el adulto)`;
  }
  return "¿Querés contarle algo a tu profesional? (opcional)";
}

// Desde 13 se suma el aviso de emergencias debajo del comentario
export function showEmergencyHint(w: PracticeWho): boolean {
  return w.self || w.audience === "adolescencia" || w.audience === "adultez";
}

// Textos fijos que ve la familia (el servidor y el mock usan los mismos)
export const PRACTICE_TEXT = {
  // Un solo texto para todo lo que no se puede ver (no revela el motivo)
  not_available: "Todavía no hay ejercicios para ver acá. Si tenés dudas, consultalo con su profesional.",
  // Lo mismo en "Mis logros" y en todas las devoluciones, que se ven también
  // sin plan: no nombra los ejercicios (ni dice el motivo)
  nothing_here: "Todavía no hay nada para ver acá. Si tenés dudas, consultalo con su profesional.",
  goals_note: "Las metas de acá son de práctica y de animarse: no miden cómo habla.",
  pro_goal_medal: "Esta medalla te la da tu profesional cuando lo charlan en el turno.",
  comment_hint: `Lo lee tu profesional antes del próximo turno. No es un chat: si es urgente, llamanos al ${CENTER.phoneDisplay}.`,
  emergency_hint: "Si estás pasando por algo grave o estás en peligro, llamá al 911 o andá a la guardia más cercana.",
  how_did_it_go: "¿Cómo te fue?",
  tell_how: "Contar cómo te fue", // vuelve a abrir "¿Cómo te fue?" de una práctica anotada desde la pantalla
  other_day: "¿Lo hicieron otro día?",
  done_today: "Hecho hoy",
  do_again: "Hacerlo otra vez",
} as const;

// Debajo del título de todas las devoluciones: "mensajes" hasta los 12 (si
// no es el propio titular), como feedbackTitle. Sin nombrar los ejercicios:
// también hay devoluciones sin plan
export function feedbackHeader(message: boolean): string {
  return message ? "Los mensajes los escribe tu profesional." : "Las devoluciones las escribe tu profesional.";
}

// Debajo de las devoluciones (la familia no responde en la v1): "cuando
// marques un ejercicio" solo con un plan publicado
export function feedbackNoReply(hasPlan: boolean): string {
  return hasPlan
    ? "Si querés comentarle algo, hacelo en el próximo turno o cuando marques un ejercicio."
    : "Si querés comentarle algo, hacelo en el próximo turno.";
}

// Intro de la página de medallas
export function medalsIntro(authorLabel: string | null): string {
  return `Se ganan practicando y cumpliendo las metas que acordaron con ${authorName(authorLabel)}. No se pierden nunca.`;
}

// Pausa de vacaciones: on_break_until es la FECHA DE VUELTA (el primer día
// sin pausa). La pausa está vigente mientras hoy sea anterior a esa fecha.
export function onBreak(onBreakUntil: string | null | undefined, today: string): boolean {
  return !!onBreakUntil && today < onBreakUntil;
}

// "Pausa de vacaciones: vuelve el 02/02. No hace falta anotar nada hasta entonces."
export function breakLine(until: string): string {
  return `Pausa de vacaciones: vuelve el ${ddmm(until)}. No hace falta anotar nada hasta entonces.`;
}

// "Lic. Ana Torres vio las prácticas el 12/10."
export function reviewedLine(r: { by: string; on: string }): string {
  return `${authorName(r.by)} vio las prácticas el ${ddmm(r.on)}.`;
}

// ── "¿Cómo te fue?" ─────────────────────────────────────────────────────────
// Pregunta cómo se sintió con el ejercicio, nunca cómo habló.

export const PRACTICE_RESULTS = ["bien", "mas_o_menos", "costo"] as const;
export type PracticeResult = (typeof PRACTICE_RESULTS)[number];

export const RESULT_LABEL_CHILD: Record<PracticeResult, string> = { bien: "Me gustó", mas_o_menos: "Más o menos", costo: "Me costó" };
export const RESULT_LABEL_TEEN: Record<PracticeResult, string> = { bien: "Bien", mas_o_menos: "Más o menos", costo: "Me costó" };
export const RESULT_LABEL_STAFF: Record<PracticeResult, string> = { bien: "Bien", mas_o_menos: "Más o menos", costo: "Me costó" };

// Hasta 12 años (tortuga y pasos): "Me gustó"; desde 13: "Bien"
export function resultLabel(r: PracticeResult, mode: ScreenMode): string {
  return mode === "lista" ? RESULT_LABEL_TEEN[r] : RESULT_LABEL_CHILD[r];
}

// ── Fechas (hora del centro) ────────────────────────────────────────────────
// Las claves de fecha son "AAAA-MM-DD" del centro. La aritmética se hace en
// UTC sobre esas claves, así no hay saltos por horario de verano.

export function isDateKey(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function keyMs(k: string): number {
  const [y, m, d] = k.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Hoy en el centro
export function centerToday(now: Date = new Date()): string {
  return centerNow(now).date;
}

// Lunes = 0 … domingo = 6
export function dayIndex(dateKey: string): number {
  return (new Date(keyMs(dateKey)).getUTCDay() + 6) % 7;
}

// La semana se identifica por la fecha de su lunes (no por el número de
// semana del año: 2026 tiene 53 y el piloto cruza Año Nuevo)
export function weekKey(dateKey: string): string {
  return addDaysKey(dateKey, -dayIndex(dateKey));
}

// Los 7 días (de lunes a domingo) de la semana que contiene la fecha
export function weekDates(dateKey: string): string[] {
  const monday = weekKey(dateKey);
  return Array.from({ length: 7 }, (_, i) => addDaysKey(monday, i));
}

// Días de "from" a "to" (positivo si "to" es posterior)
export function daysBetween(from: string, to: string): number {
  return Math.round((keyMs(to) - keyMs(from)) / 86_400_000);
}

// "2026-10-03" → "03/10"
export function ddmm(dateKey: string): string {
  return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}`;
}

export const WEEKDAY_SHORT = ["L", "M", "M", "J", "V", "S", "D"] as const;
export const WEEKDAY_NAME = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const;

// ── Límites ─────────────────────────────────────────────────────────────────

export const PRACTICE_LIMITS = {
  // Plan
  plan_title: 80,
  plan_goal_text: 300,
  days_per_week_min: 1,
  days_per_week_max: 7,
  days_per_week_default: 3,
  exercises_min: 1, // activos, para publicar
  exercises_max: 8, // activos, para publicar
  exercises_in_draft_max: 12, // con los quitados
  // Ejercicio
  title: 60,
  para_que: 200,
  pasos_min: 2,
  pasos_max: 6,
  paso: 160,
  materiales: 200,
  minutes_min: 1,
  minutes_max: 30,
  for_adult: 300,
  si_cuesta: 200,
  // Notas de la familia
  comment: 280,
  // Devolución
  feedback_min: 10,
  feedback_max: 800,
  feedback_for_adult: 300,
  feedback_goals_max: 10,
  // Metas y medallas
  goal_title: 120,
  goal_days_max: 84,
  goal_weeks_max: 12,
  medal_title: 60,
  medal_message: 280,
  void_reason: 200,
  // "Lo dejo así": motivo para dejar un texto con avisos
  review_note: REVIEW_NOTE_MAX,
} as const;

// Se puede anotar hoy, ayer o anteayer (nunca antes de que se publicara ese ejercicio)
export const PRACTICE_BACKDAYS = 2;
// Registros por cuenta y por día (cuentan también los deshechos)
export const PRACTICE_DAILY_MAX = 40;
// "Avisa si pasa de 15 minutos para un chico de menos de 9 años"
export const CHILD_MINUTES_WARN = 15;
export const CHILD_MINUTES_WARN_UNDER_AGE = 9;
// "¡De vuelta!": pasaron 14 días o más desde la última práctica
export const COMEBACK_GAP_DAYS = 14;
// Bandeja: a los 7 días sin revisión la fila se pone en ámbar (salvo pausa)
export const REVIEW_STALE_DAYS = 7;
// Grilla del panel: últimos 14 días
export const GRID_DAYS = 14;
// Últimas medallas en la página de ejercicios
export const RECENT_MEDALS = 3;

// ── Marca de riesgo en los comentarios ──────────────────────────────────────
// Red de seguridad, NO un clasificador: una lista de palabras clave (sin IA)
// que pone el comentario en rojo y arriba de todo ("Revisar hoy") para que el
// profesional lo lea primero. No detecta todo ni entiende el contexto: puede
// marcar de más (se prefiere eso) y nunca reemplaza la lectura. La calcula el
// servidor al guardar la nota; el comentario nunca va a la IA.

// Texto sin tildes, en minúsculas y con la puntuación como separador (" | "),
// así una frase no se arma con palabras de dos oraciones distintas
export function normalizeForLint(text: string | null | undefined): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,;:!?¡¿()[\]{}"«»“”…\n\r\t]+/g, " | ")
    .replace(/[^a-z0-9%| ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Lo que se pega o se corta sin violencia ("me pegó el sol", "se cortó el pelo")
const NOT_HIT = "(?! (el|un|una) (sol|susto|resfrio|virus|chicle)| (a la|a las|al|en la|en el) (pelota|pelotas|bola|arco|globo|pinata|palo)| (la|las|una|unas|el|los|un|unos) (figurita|figuritas|sticker|stickers|calco|calcos|calcomania|etiqueta|etiquetas|foto|fotos|hoja|hojas|papel|papeles))";
const NOT_HAIRCUT = "(?! (el|la|los|las) (pelo|cabello|flequillo|unas|barba|papas|verdura|verduras|carne))";

const RISK_PATTERNS: RegExp[] = [
  // Autolesión e ideas de muerte
  /\b(me quiero|quiero|queria|quisiera|ganas de|pienso en|piensa en) (morir|morirme|matarme|lastimarme|cortarme|desaparecer)\b/,
  /\bmatarme\b|\bmatarse\b/,
  /\b(me|se) (voy|va) a (matar|morir)\b/,
  /\b(me|se|te) (quiero|quiere|queria|quiso|quisiera) (matar|morir)\b/,
  /\bsuicid\w*/,
  /\bautolesi\w*/,
  /\b(lastimarme|lastimarse|hacerme dano|hacerse dano|me hago dano|se hace dano|me lastimo|se lastima)\b/,
  new RegExp(`\\b(cortarme|cortarse|me corto|se corta|se corto|me corte)\\b${NOT_HAIRCUT}`),
  /\bno (quiero|quiere|queria) (vivir|seguir viviendo)\b/,
  /\b(quitarme|quitarse|sacarme|sacarse) la vida\b/,
  // Violencia
  new RegExp(`\\b(me|te|le|nos|les) (pega|pegan|pego|pegaron|pegue|peguen|pegaba|pegaban)\\b${NOT_HIT}`),
  /\b(me|te|lo|la|le|nos|los|las|les) (golpea|golpean|golpeo|golpearon|golpeaba|golpeaban)\b/,
  /\b(me|le|nos|les|te) (dio|dieron|da|dan|daba|daban) (una paliza|palizas|una pina|pinas|una cachetada|cachetadas|un cachetazo|cachetazos|un chirlo|chirlos|golpes)\b/,
  /\bpaliza\b|\bcachetad\w*|\bcachetazo\w*|\bsopapo\w*/,
  /\bmaltrat\w*/,
  /\bviolencia\b|\bviolent(o|a|os|as)\b/,
  /\bamenaz\w*/,
  /\b(me|le|nos|les|te) (quiere|quieren|quiso|quisieron|va a|van a) (pegar|lastimar|matar|golpear)\b/,
  /\b(me|lo|la|nos|los|las) (encierra|encierran|encerraron|encerraba)\b/,
  // Abuso
  /\babus(o|os|a|an|aron|aba|aban|ador|adora|ivo|iva|ar)\b/,
  /\bviol(o|aron|acion|ada|ado|ar|aba)\b/,
  /\btocamient\w*/,
  /\bacos(o|a|an|aron|ador|adora)\b/,
  /\b(me|le|la|lo) (toca|tocan|toco|tocaron|tocaba|tocaban) (ahi|abajo|las partes|mis partes|sus partes|partes)\b/,
  /\bpartes intimas\b/,
];

// true: el comentario tiene palabras de riesgo (autolesión, violencia o abuso)
export function riskFlag(text: string | null | undefined): boolean {
  const t = normalizeForLint(text);
  return !!t && RISK_PATTERNS.some((re) => re.test(t));
}

// ── Revisión del texto (fluidez) ────────────────────────────────────────────
// Sobre el texto normalizado, con límites de palabra ("procurar" no es
// "curar"; "quitarle presión" no es un castigo).
//   block:  en la salida de la IA invalida el borrador; en los títulos de
//           metas y medallas no deja guardar.
//   review: alerta. En lo que escribe el profesional NUNCA se bloquea: todo
//           (block y review) es una alerta, con "Lo dejo así" y un motivo que
//           se guarda (lint_overrides / review_note).

const BLOCK_PATTERNS: [RegExp, string][] = [
  [/\bsin (tartamude\w*|trabar\w*)\b/, "sin tartamudear / sin trabarse"],
  [/\bhabl\w* (bien|normal|normalmente|correctamente)\b/, "hablar bien"],
  [/\bfluidez (total|perfecta)\b/, "fluidez total"],
  [/\b100 ?%/, "100 %"],
  [/\bcur(a|ar|arse|arlo|arla|acion|ado|ada|ados|adas|an)\b/, "curar"],
  [/\beliminar (la|su|tu) tartamudez\b/, "eliminar la tartamudez"],
  [/\bcastig\w*/, "castigo"],
  [/\bsin postre\b/, "sin postre"],
  [/\b(quitarle|sacarle|quitale|sacale) (el|la|los|las|su|sus) (postre|celular|tele|television|juego|juguete|salida|tablet|play|compu)\w*/, "quitarle cosas"],
  [/\brespira (hondo|profundo) antes\b/, "respirá hondo antes de hablar"],
  [/\bpensa(lo)? antes de hablar\b/, "pensá antes de hablar"],
  [/\bdecilo bien\b/, "decilo bien"],
];

// "más despacio" vale dentro de estos enfoques (bajar la velocidad es parte
// de la técnica); en el resto es una alerta
export const SLOW_OK_APPROACHES: readonly Approach[] = ["habla_facil", "ritmo_y_claridad"];

const REVIEW_PATTERNS: [RegExp, string, readonly Approach[]][] = [
  [/\b(mas )?despaci(o|to|ta)\b/, "más despacio", SLOW_OK_APPROACHES],
  [/\bflu(ido|ida|idez|idamente)\b/, "fluidez", []],
  [/\bsin errores\b/, "sin errores", []],
  [/\bmedicac\w*|\bmedicament\w*/, "medicación", []],
  [/\bdiagnostic\w*/, "diagnóstico", []],
  [/\btartamud(o|a|os|as)\b/, "«tartamudo» (mejor: persona que tartamudea)", []],
  // Tuteo (en el portal se usa vos). Solo formas que no chocan con el voseo
  // sin tildes ("sabés" → "sabes" sí chocaría)
  [/\b(puedes|tienes|haz|quieres|eres|dices|vienes)\b/, "tuteo (usá vos)", []],
];

// Más estricto para títulos de metas y medallas: ahí cualquier mención de
// fluidez o de "trabarse menos" bloquea
const TITLE_BLOCK_PATTERNS: [RegExp, string][] = [
  [/\bflu(ido|ida|idez|idamente)\b/, "fluidez"],
  [/\b(tartamude\w*|trabar\w*) menos\b/, "tartamudear menos"],
  [/\bmenos (tartamudeo|tartamudez|trabas|bloqueos|errores)\b/, "menos tartamudeo"],
  [/\b(cero|ningun|ninguna|sin) (tartamude\w*|trabas?|bloqueos?|errores|equivocarse)\b/, "sin trabas"],
  [/\b(no|nunca) (tartamude\w*|trabar\w*)\b/, "no tartamudear"],
  [/\bhabl\w* (mejor|de corrido|claro|claramente|fluido|perfecto|perfectamente)\b/, "hablar mejor"],
];

export type LintResult = { block: string[]; review: string[] };

export function lintPracticeText(text: string | null | undefined, approach?: Approach): LintResult {
  const t = normalizeForLint(text);
  const block: string[] = [];
  const review: string[] = [];
  if (!t) return { block, review };
  for (const [re, label] of BLOCK_PATTERNS) if (re.test(t) && !block.includes(label)) block.push(label);
  for (const [re, label, exempt] of REVIEW_PATTERNS) {
    if (approach && exempt.includes(approach)) continue;
    if (re.test(t) && !review.includes(label)) review.push(label);
  }
  return { block, review };
}

// Títulos de metas y medallas (del profesional o sugeridos): lo que bloquea.
// Vacío: se puede guardar
export function blockForTitles(text: string | null | undefined): string[] {
  const t = normalizeForLint(text);
  const out = lintPracticeText(text).block;
  for (const [re, label] of TITLE_BLOCK_PATTERNS) if (re.test(t) && !out.includes(label)) out.push(label);
  return out;
}

// Mensaje del bloqueo de un título (diseño §3.6)
export const FLUENCY_TITLE_MESSAGE =
  "Esta meta habla de fluidez. En el portal no medimos ni premiamos la fluidez porque puede sumar presión y ansiedad. Proponé una meta de práctica o de participación: «Leer un cuento en voz alta por semana», «Animarse a atender el teléfono».";

// Textos de un ejercicio (lo que se revisa y lo que mide edit_ratio)
export type ExerciseTexts = {
  title: string;
  para_que: string;
  pasos: string[];
  materiales: string | null;
  for_adult: string | null;
  si_cuesta: string;
  activity?: ActivitySpec | null; // sus textos también se revisan (no cuentan para edit_ratio)
};

// Avisos del texto que escribió el profesional (block y review juntos: en
// su texto nada bloquea). Vacío: no hace falta "Lo dejo así"
export function exerciseTextAlerts(t: ExerciseTexts, approach?: Approach): string[] {
  const parts = [t.title, t.para_que, ...t.pasos, t.materiales ?? "", t.for_adult ?? "", t.si_cuesta, ...(t.activity ? activityTexts(t.activity) : [])];
  return uniq(parts.flatMap((p) => {
    const r = lintPracticeText(p, approach);
    return [...r.block, ...r.review];
  }));
}

// Avisos de los textos del plan (título y "Para qué es")
export function planTextAlerts(p: { title: string; goal_text: string | null }): string[] {
  return uniq([p.title, p.goal_text ?? ""].flatMap((x) => {
    const r = lintPracticeText(x);
    return [...r.block, ...r.review];
  }));
}

// "Lo dejo así": qué avisos se aceptaron, por qué, quién y cuándo
export type LintOverride = { terms: string[]; reason: string; by_email: string; at: string };

// Avisos que todavía no tienen un "Lo dejo así" que los cubra
export function uncoveredAlerts(alerts: string[], overrides: Pick<LintOverride, "terms">[] | null | undefined): string[] {
  const ok = new Set((overrides ?? []).flatMap((o) => o.terms));
  return alerts.filter((a) => !ok.has(a));
}

// ── Medallas ────────────────────────────────────────────────────────────────

export type MedalKind = "constancia" | "profesional";
// Las medallas del profesional van con este código (el nombre está en title)
export const PRO_MEDAL_CODE = "profesional";

export const CONSTANCY_CODES = [
  "primer_paso", "semana_cumplida", "un_mes", "de_vuelta", "practicas_10", "practicas_25", "practicas_50",
] as const;
export type ConstancyCode = (typeof CONSTANCY_CODES)[number];

export function isConstancyCode(x: unknown): x is ConstancyCode {
  return (CONSTANCY_CODES as readonly unknown[]).includes(x);
}

// Automáticas, por constancia (nunca por fluidez). repeatable: se pueden
// ganar más de una vez (period_key distinto)
export const CONSTANCY_MEDALS: readonly { code: ConstancyCode; name: string; repeatable: boolean; rule: string }[] = [
  { code: "primer_paso", name: "Primer paso", repeatable: false, rule: "La primera práctica anotada" },
  { code: "semana_cumplida", name: "Semana cumplida", repeatable: true, rule: "Llegar a los días de práctica de la semana (de lunes a domingo)" },
  { code: "un_mes", name: "Un mes practicando", repeatable: false, rule: "4 semanas con alguna práctica (no hace falta que sean seguidas)" },
  { code: "de_vuelta", name: "¡De vuelta!", repeatable: true, rule: "Volver a practicar cuando pasaron 14 días o más desde la última práctica" },
  { code: "practicas_10", name: "10 prácticas", repeatable: false, rule: "10 prácticas (cada ejercicio cuenta una vez por día)" },
  { code: "practicas_25", name: "25 prácticas", repeatable: false, rule: "25 prácticas (cada ejercicio cuenta una vez por día)" },
  { code: "practicas_50", name: "50 prácticas", repeatable: false, rule: "50 prácticas (cada ejercicio cuenta una vez por día)" },
];

export const CONSTANCY_MEDAL_NAME = Object.fromEntries(CONSTANCY_MEDALS.map((m) => [m.code, m.name])) as Record<ConstancyCode, string>;

// Nombres sugeridos para las medallas del profesional (puede escribir otro:
// pasa por blockForTitles)
export const PRO_MEDAL_SUGGESTIONS = [
  "Meta cumplida",
  "Me animé",
  "Levanté la mano",
  "Hice una llamada",
  "Usé mi técnica",
  "Hablé de la tartamudez con alguien",
  "Gran equipo",
] as const;

// Frases rápidas para la devolución
export const FEEDBACK_CHIPS = [
  "¡Qué buena constancia!",
  "Gracias por contarnos cómo les fue",
  "Lo charlamos en la próxima sesión",
  "Si un día no pueden, no pasa nada: lo importante es retomar",
] as const;

// Una práctica: un ejercicio (por su exercise_key, estable entre versiones
// del plan) en un día del centro
export type PracticeDay = { date: string; exercise_key: string };

export type ConstancyInput = {
  logs: PracticeDay[]; // todas las prácticas vigentes (no deshechas) del paciente, de cualquier plan
  days_per_week: number; // meta semanal del plan publicado
  // TODAS las medallas de constancia ya dadas al paciente, también las
  // anuladas (una anulada no se vuelve a dar sola)
  awarded: { code: string; period_key: string }[];
  today: string; // fecha del centro
  auto_medals?: boolean; // interruptor del plan (por defecto prendido)
  on_break_until?: string | null; // fecha de vuelta de la pausa: antes de ese día no se calcula nada
};

export type ConstancyAward = { code: ConstancyCode; period_key: string; title: string };

// Medallas de constancia NUEVAS (las que corresponden y todavía no se
// dieron). Determinística y sin efectos: la usan el servidor, después de
// anotar una práctica, y el mock. period_key: "" para las que se ganan una
// vez; el lunes de la semana para "semana_cumplida"; el día de la vuelta
// para "de_vuelta".
// "semana_cumplida" y "de_vuelta" se evalúan solo sobre los días que todavía
// se pueden anotar (hoy y los 2 anteriores), así un cambio de la meta
// semanal no da medallas de semanas viejas.
export function constancyAwards(i: ConstancyInput): ConstancyAward[] {
  if (i.auto_medals === false) return [];
  if (onBreak(i.on_break_until, i.today)) return [];
  const logs = i.logs.filter((l) => isDateKey(l.date) && l.date <= i.today);
  if (!logs.length) return [];

  const given = new Set(i.awarded.map((a) => `${a.code}|${a.period_key}`));
  const out: ConstancyAward[] = [];
  const give = (code: ConstancyCode, period = "") => {
    const k = `${code}|${period}`;
    if (given.has(k)) return;
    given.add(k);
    out.push({ code, period_key: period, title: CONSTANCY_MEDAL_NAME[code] });
  };

  const days = uniq(logs.map((l) => l.date)).sort();
  const practices = new Set(logs.map((l) => `${l.date}|${l.exercise_key}`)).size;
  const windowStart = addDaysKey(i.today, -PRACTICE_BACKDAYS);
  const target = clampInt(i.days_per_week, PRACTICE_LIMITS.days_per_week_min, PRACTICE_LIMITS.days_per_week_max, PRACTICE_LIMITS.days_per_week_default);

  give("primer_paso");

  for (const w of uniq([weekKey(windowStart), weekKey(i.today)]).sort()) {
    if (days.filter((d) => weekKey(d) === w).length >= target) give("semana_cumplida", w);
  }

  if (new Set(days.map(weekKey)).size >= 4) give("un_mes");

  // Una vuelta se premia una vez: si ya hay un "¡De vuelta!" posterior a la
  // última práctica antes del hueco, esa vuelta ya está
  const comebacks = [...i.awarded, ...out].filter((a) => a.code === "de_vuelta").map((a) => a.period_key);
  for (let k = 1; k < days.length; k++) {
    const d = days[k];
    const prev = days[k - 1];
    if (d < windowStart || daysBetween(prev, d) < COMEBACK_GAP_DAYS) continue;
    if (comebacks.some((p) => p > prev)) continue;
    give("de_vuelta", d);
    comebacks.push(d);
  }

  for (const n of [10, 25, 50] as const) if (practices >= n) give(`practicas_${n}`);

  const order = (c: ConstancyCode) => CONSTANCY_CODES.indexOf(c);
  return out.sort((a, b) => order(a.code) - order(b.code) || a.period_key.localeCompare(b.period_key));
}

// La semana de hoy (franja L M M J V S D de la página de ejercicios)
export type WeekDayDTO = { date: string; practiced: boolean; today: boolean; future: boolean };
export type WeekDTO = {
  week: string; // lunes "AAAA-MM-DD"
  days: WeekDayDTO[]; // de lunes a domingo
  count: number; // días distintos con práctica
  target: number; // meta del plan
  met: boolean;
};

export function weekProgress(logs: PracticeDay[], target: number, today: string): WeekDTO {
  const practiced = new Set(logs.filter((l) => l.date <= today).map((l) => l.date));
  const days = weekDates(today).map((date) => ({ date, practiced: practiced.has(date), today: date === today, future: date > today }));
  const count = days.filter((d) => d.practiced).length;
  const t = clampInt(target, PRACTICE_LIMITS.days_per_week_min, PRACTICE_LIMITS.days_per_week_max, PRACTICE_LIMITS.days_per_week_default);
  return { week: weekKey(today), days, count, target: t, met: count >= t };
}

// "Para seguir sumando": sin cuentas regresivas ni "se te vence". En la pausa
// de vacaciones, nada (como constancyAwards: no se calcula nada, ni la meta de
// la semana ni lo que falta, así no hay presión para anotar)
export type MedalNextDTO = { code: ConstancyCode; title: string; text: string };

export function constancyNext(i: ConstancyInput): MedalNextDTO[] {
  if (i.auto_medals === false) return [];
  if (onBreak(i.on_break_until, i.today)) return [];
  const logs = i.logs.filter((l) => l.date <= i.today);
  const has = (code: ConstancyCode, period = "") => i.awarded.some((a) => a.code === code && a.period_key === period);
  const out: MedalNextDTO[] = [];
  if (!logs.length) {
    out.push({ code: "primer_paso", title: CONSTANCY_MEDAL_NAME.primer_paso, text: "se gana con la primera práctica" });
    return out;
  }
  const week = weekProgress(logs, i.days_per_week, i.today);
  if (!week.met) {
    out.push({ code: "semana_cumplida", title: CONSTANCY_MEDAL_NAME.semana_cumplida, text: `llevás ${week.count} de ${week.target} ${daysWord(week.target)} esta semana` });
  }
  if (!has("un_mes")) {
    const weeks = new Set(logs.map((l) => weekKey(l.date))).size;
    out.push({ code: "un_mes", title: CONSTANCY_MEDAL_NAME.un_mes, text: `llevás ${Math.min(weeks, 4)} de 4 semanas con práctica` });
  }
  const practices = new Set(logs.map((l) => `${l.date}|${l.exercise_key}`)).size;
  const n = ([10, 25, 50] as const).find((x) => !has(`practicas_${x}`));
  if (n) out.push({ code: `practicas_${n}`, title: CONSTANCY_MEDAL_NAME[`practicas_${n}`], text: `llevás ${Math.min(practices, n)} de ${n} prácticas` });
  return out;
}

// ── Metas ───────────────────────────────────────────────────────────────────
//   practica:    "practicar N días en M semanas". El servidor detecta que se
//                cumplió y solo avisa en la bandeja (la da por lograda el
//                profesional, con una devolución).
//   terapeutica: la valida el profesional en la sesión.
// Estados: borrador · activa · lograda · cambiada. Nunca "no cumplida".

export const GOAL_KINDS = ["practica", "terapeutica"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export const GOAL_STATUSES = ["borrador", "activa", "lograda", "cambiada"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type GoalRule = { dias: number; semanas: number };

export type GoalProgress = {
  days: number; // la mejor cuenta de días distintos dentro de una ventana de M semanas (nunca baja)
  target: number; // N
  weeks: number; // M
  met: boolean;
  met_on: string | null; // primer día en que se cumplió
};

// Progreso de una meta de práctica, desde que se publicó (start, fecha del
// centro). Cualquier ventana de M semanas seguidas sirve: la cuenta nunca
// baja, así no hay nada que "se venza". null para las terapéuticas.
export function goalProgress(
  goal: { kind: GoalKind; rule: GoalRule | null; start: string },
  logs: PracticeDay[],
  today: string,
): GoalProgress | null {
  if (goal.kind !== "practica" || !goal.rule) return null;
  const target = goal.rule.dias;
  const weeks = goal.rule.semanas;
  const span = weeks * 7;
  const days = uniq(logs.map((l) => l.date)).filter((d) => d >= goal.start && d <= today).sort();
  let best = 0;
  let metOn: string | null = null;
  for (let j = 0, i = 0; j < days.length; j++) {
    while (daysBetween(days[i], days[j]) >= span) i++;
    const n = j - i + 1;
    if (n > best) best = n;
    if (!metOn && n >= target) metOn = days[j];
  }
  return { days: best, target, weeks, met: metOn !== null, met_on: metOn };
}

// "Practicar 12 días en 4 semanas"
export function goalRuleText(rule: GoalRule): string {
  return `Practicar ${rule.dias} ${daysWord(rule.dias)} en ${rule.semanas} ${rule.semanas === 1 ? "semana" : "semanas"}`;
}

// ── Plan: estados, motivos y resumen ────────────────────────────────────────
//   borrador → publicado → reemplazado (por una versión nueva) | finalizado | retirado
//   borrador → retirado (descartado)
// Un publicado y un borrador por paciente, como máximo.

export const PLAN_STATUSES = ["borrador", "publicado", "reemplazado", "finalizado", "retirado"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  borrador: "Borrador",
  publicado: "Publicado",
  reemplazado: "Reemplazado",
  finalizado: "Finalizado",
  retirado: "Retirado",
};

// Retirar (el profesional elige el motivo); "descartado" es retirar un borrador
export const PLAN_WITHDRAW_REASONS = ["error", "pedido_familia", "otro"] as const;
export type PlanWithdrawReason = (typeof PLAN_WITHDRAW_REASONS)[number];
export type PlanCloseReason = PlanWithdrawReason | "reemplazado" | "finalizado" | "descartado";

export const FEEDBACK_WITHDRAW_REASONS = ["error", "pedido_familia", "otro"] as const;
export type FeedbackWithdrawReason = (typeof FEEDBACK_WITHDRAW_REASONS)[number];

export const WITHDRAW_REASON_LABEL: Record<PlanWithdrawReason, string> = {
  error: "Tenía un error",
  pedido_familia: "A pedido de la familia",
  otro: "Otro motivo",
};

export const EXERCISE_SOURCES = ["catalogo", "manual", "ia"] as const;
export type ExerciseSource = (typeof EXERCISE_SOURCES)[number];

// "En total: 10 minutos, 4 días por semana." y el aviso para menores de 9
export function planSummary(
  exercises: { minutes: number; removed?: boolean }[],
  daysPerWeek: number,
  age: number | null,
): { total_minutes: number; line: string; warning: string | null } {
  const total = exercises.filter((e) => !e.removed).reduce((s, e) => s + (Number.isFinite(e.minutes) ? e.minutes : 0), 0);
  const line = `En total: ${total} ${total === 1 ? "minuto" : "minutos"}, ${daysPerWeek} ${daysWord(daysPerWeek)} por semana.`;
  const warning = age !== null && age < CHILD_MINUTES_WARN_UNDER_AGE && total > CHILD_MINUTES_WARN
    ? `Son más de ${CHILD_MINUTES_WARN} minutos por día para menos de ${CHILD_MINUTES_WARN_UNDER_AGE} años: pensá si conviene repartirlos.`
    : null;
  return { total_minutes: total, line, warning };
}

// "Desde el 03/10 anotaron 9 prácticas en 6 días. Última: ayer."
export function practiceSummaryText(s: { since: string | null; logs: number; days: number; last: string | null }, today: string): string {
  if (!s.logs || !s.last) return s.since ? `Desde el ${ddmm(s.since)} todavía no anotaron prácticas.` : "Todavía no anotaron prácticas.";
  const ago = daysBetween(s.last, today);
  const last = ago <= 0 ? "hoy" : ago === 1 ? "ayer" : `el ${ddmm(s.last)}`;
  const since = s.since ? `Desde el ${ddmm(s.since)} anotaron` : "Anotaron";
  return `${since} ${s.logs} ${s.logs === 1 ? "práctica" : "prácticas"} en ${s.days} ${daysWord(s.days)}. Última: ${last}.`;
}

// "Lo leen: María López (madre), Juan Pérez (padre) y cualquiera que tenga el
// celular, incluido Juan." (readers: quienes hoy ven la práctica)
export function readersLine(readers: string[], patient: { first_name: string; self: boolean }): string {
  if (patient.self) return `Lo lee ${patient.first_name} en su cuenta y cualquiera que tenga su celular.`;
  if (!readers.length) {
    return `Todavía nadie tiene acceso al portal para ${patient.first_name}. Podés dejar todo listo: lo van a ver cuando activen su cuenta.`;
  }
  return `Lo leen: ${readers.join(", ")} y cualquiera que tenga el celular, incluido ${patient.first_name}.`;
}

// Textos fijos del panel (los mismos en el servidor y en el mock)
export const STAFF_PRACTICE_TEXT = {
  admin_readonly: "Solo los profesionales publican, revisan y dan medallas en el portal.",
  feedback_note: "La ven en el portal apenas la mandás, con tu nombre.",
  ai_review_needed: "Marcá «Lo revisé» en cada ejercicio adaptado con IA",
  ai_banner: "La IA solo prepara un borrador para vos. No se publica nada hasta que lo revises. No mandamos nada que permita saber quién es el paciente: solo lo que elegís acá.",
  goal_needs_feedback: "Una meta se da por lograda con una devolución.",
  goal_met_prompt: "¿Le das la medalla?",
  internal_use: "Las prácticas y las medallas no se usan para decisiones administrativas.",
} as const;

// "Escribí sobre la práctica. Lo que Juan te contó en confianza, conversalo en sesión."
export function feedbackGuide(firstName: string): string {
  return `Escribí sobre la práctica. Lo que ${firstName} te contó en confianza, conversalo en sesión.`;
}

// "Cumplió «Practicar 12 días en 4 semanas». ¿Le das la medalla?"
export function goalMetLine(title: string): string {
  return `Cumplió «${title}». ${STAFF_PRACTICE_TEXT.goal_met_prompt}`;
}

// ── Errores (mismos mensajes en el servidor y en el mock) ───────────────────

export type PracticeErrorCode =
  | "INVALID" // dato mal formado (400)
  | "CONFLICT" // otra persona cambió esto (409)
  | "REVIEW" // avisos del texto sin "Lo dejo así" (400; terms)
  | "TITLE_BLOCK" // título de meta o medalla que habla de fluidez (400; terms)
  | "AI_NOT_REVIEWED" // falta "Lo revisé" en un ejercicio de IA (400)
  | "APPROACH" // enfoque que no corresponde a la edad o al diagnóstico, o sin la casilla de sesión (400)
  | "EXERCISES" // un plan publicado tiene de 1 a 8 ejercicios (400)
  | "ADOLESCENT_ACK" // 13 a 17: falta "Lo conversé con …" (400)
  | "AUTHOR" // sin matrícula o usuario sin vincular (403)
  | "DATE" // fecha de práctica fuera de lo permitido (400)
  | "LIMIT"; // límite diario de registros (429)

export const PRACTICE_ERROR = {
  // Familia
  date: "Se puede anotar hoy, ayer o anteayer.",
  before_publish: "Ese día todavía no tenían este ejercicio.",
  limit: "Llegaste al máximo de anotaciones por hoy. Probá de nuevo mañana.",
  gone: "Este ejercicio ya no está en el plan.",
  undo_only_mine: "Solo se puede deshacer lo que anotaste vos, el mismo día.",
  note_twice: "Ya contaste cómo les fue con esta práctica.",
  note_empty: "Elegí cómo les fue o escribí un comentario.",
  comment_long: `El comentario es muy largo: el máximo es ${PRACTICE_LIMITS.comment} caracteres.`,
  // Equipo (diseño §3.11)
  clinical_only: "Solo los profesionales pueden publicar en el portal.",
  conflict: "Otra persona cambió esto mientras lo editabas. Actualizá para ver la versión nueva.",
  publish_failed: "No se pudo publicar. No se mostró nada en el portal: probá de nuevo.",
  no_license: "Falta tu matrícula. Pedile a la Dirección que la cargue en Equipo.",
  not_linked: "Tu usuario no está vinculado a un profesional: pedile a la Dirección que te vincule en Equipo.",
  ai_not_reviewed: "Marcá «Lo revisé» en cada ejercicio adaptado con IA.",
  exercises: `El plan tiene que tener de ${PRACTICE_LIMITS.exercises_min} a ${PRACTICE_LIMITS.exercises_max} ejercicios.`,
  approach: "Ese enfoque no corresponde a la edad o al diagnóstico del paciente.",
  approach_session: "Para este enfoque marcá «Ya lo practicamos en sesión».",
  adolescent_ack: "Marcá «Lo conversé con …» antes de publicar.",
  review: "El texto tiene frases para revisar. Corregilas o elegí «Lo dejo así» con un motivo.",
  title_block: FLUENCY_TITLE_MESSAGE,
  goal_not_active: "Esa meta ya no está activa.",
  medal_needs_feedback: "Una medalla del profesional siempre va con una devolución.",
  void_reason: "Contá por qué se anula (es solo para errores).",
} as const;

// ── Validaciones (servidor y mock) ──────────────────────────────────────────
// Devuelven el dato limpio o el mensaje para mostrar. Los textos no se
// cortan: si pasan el límite, error (cortarlos podría cambiar lo que dicen).

type Bad = { ok: false; error: string; code: PracticeErrorCode; field?: string; index?: number; terms?: string[] };

export function isUuid(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

const line = (raw: unknown) => String(raw ?? "").replace(/\s+/g, " ").trim();
const optText = (raw: unknown, max: number, what: string): { text: string | null; error: string | null } => {
  const r = fitText(raw, max, what);
  return { text: r.text || null, error: r.error };
};

// Nota de la familia ("¿Cómo te fue?" + comentario). risk lo calcula esta función
export type PracticeNoteValue = { result: PracticeResult | null; comment: string | null; risk: boolean };

export function validateNote(raw: unknown): { ok: true; value: PracticeNoteValue } | Bad {
  const b = (raw ?? {}) as Record<string, unknown>;
  const result = b.result === undefined || b.result === null ? null : b.result;
  if (result !== null && !(PRACTICE_RESULTS as readonly unknown[]).includes(result)) {
    return { ok: false, error: PRACTICE_ERROR.note_empty, code: "INVALID", field: "result" };
  }
  const comment = cleanText(b.comment);
  if (comment.length > PRACTICE_LIMITS.comment) return { ok: false, error: PRACTICE_ERROR.comment_long, code: "INVALID", field: "comment" };
  if (result === null && !comment) return { ok: false, error: PRACTICE_ERROR.note_empty, code: "INVALID" };
  return { ok: true, value: { result: result as PracticeResult | null, comment: comment || null, risk: riskFlag(comment) } };
}

// ¿Se puede anotar esta fecha? firstPublished: día (del centro) en que se
// publicó por primera vez ese exercise_key. null: se puede
export function practiceDateProblem(practicedOn: string, today: string, firstPublished: string | null): string | null {
  if (!isDateKey(practicedOn) || practicedOn > today || practicedOn < addDaysKey(today, -PRACTICE_BACKDAYS)) return PRACTICE_ERROR.date;
  if (firstPublished && practicedOn < firstPublished) return PRACTICE_ERROR.before_publish;
  return null;
}

// Días que se ofrecen para anotar (hoy, ayer, anteayer), sin los anteriores a la publicación
export function practiceDates(today: string, firstPublished: string | null): string[] {
  return [0, 1, 2].map((n) => addDaysKey(today, -n)).filter((d) => !firstPublished || d >= firstPublished);
}

// Un ejercicio del editor del plan
export type ExerciseInput = {
  id: string | null; // fila de este borrador (null: nuevo)
  exercise_key: string | null; // identidad estable entre versiones (null: ejercicio nuevo)
  source: ExerciseSource;
  catalog_id: string | null; // obligatorio en "catalogo" e "ia"
  catalog_version: string | null;
  ai_draft_id: string | null; // obligatorio en "ia" (ai_drafts.id)
  approach: Approach;
  practiced_in_session: boolean; // "Ya lo practicamos en sesión" (tartamudear_facil, animarse)
  title: string;
  para_que: string;
  pasos: string[];
  minutes: number;
  materiales: string | null;
  for_adult: string | null; // "Para el adulto que acompaña" (parte del texto base del enfoque)
  si_cuesta: string;
  with_adult: boolean;
  reviewed: boolean; // "Lo revisé" (obligatorio para publicar un ejercicio de IA)
  removed: boolean; // "Quitar": no se borra, se marca
  review_note: string | null; // "Lo dejo así": motivo para los avisos del texto
  // Actividad para jugar en el celular (etapa "activities"; los pasos son la
  // versión sin pantalla). null: sin actividad
  activity: ActivitySpec | null;
};

export function validateExerciseInput(raw: unknown): { ok: true; value: ExerciseInput } | Bad {
  const b = (raw ?? {}) as Record<string, unknown>;
  const L = PRACTICE_LIMITS;
  const bad = (field: string, error: string): Bad => ({ ok: false, error, code: "INVALID", field });
  if (!isApproach(b.approach)) return bad("approach", "Elegí el enfoque del ejercicio.");
  if (!(EXERCISE_SOURCES as readonly unknown[]).includes(b.source)) return bad("source", "Pedido inválido");
  const source = b.source as ExerciseSource;
  const catalogId = typeof b.catalog_id === "string" && /^[a-z0-9-]{1,40}$/.test(b.catalog_id) ? b.catalog_id : null;
  const catalogVersion = typeof b.catalog_version === "string" && b.catalog_version.length <= 40 ? b.catalog_version : null;
  const aiDraftId = isUuid(b.ai_draft_id) ? b.ai_draft_id : null;
  if (source !== "manual" && !catalogId) return bad("catalog_id", "Falta el ejercicio del catálogo.");
  if (source === "ia" && !aiDraftId) return bad("ai_draft_id", "Falta el borrador de la IA.");
  if (b.id !== null && b.id !== undefined && !isUuid(b.id)) return bad("id", "Pedido inválido");
  if (b.exercise_key !== null && b.exercise_key !== undefined && !isUuid(b.exercise_key)) return bad("exercise_key", "Pedido inválido");

  const title = fitText(line(b.title), L.title, "El título");
  if (!title.text) return bad("title", "Escribí el título del ejercicio.");
  if (title.error) return bad("title", title.error);
  const paraQue = fitText(b.para_que, L.para_que, "«Para qué sirve»");
  if (!paraQue.text) return bad("para_que", "Escribí para qué sirve el ejercicio.");
  if (paraQue.error) return bad("para_que", paraQue.error);
  const pasos = (Array.isArray(b.pasos) ? b.pasos : []).map(line).filter(Boolean);
  if (pasos.length < L.pasos_min || pasos.length > L.pasos_max) return bad("pasos", `«Cómo se hace» tiene que tener de ${L.pasos_min} a ${L.pasos_max} pasos.`);
  const longStep = pasos.findIndex((p) => p.length > L.paso);
  if (longStep >= 0) return bad("pasos", `El paso ${longStep + 1} es muy largo: el máximo es ${L.paso} caracteres.`);
  const minutes = Number(b.minutes);
  if (!Number.isInteger(minutes) || minutes < L.minutes_min || minutes > L.minutes_max) return bad("minutes", `Los minutos van de ${L.minutes_min} a ${L.minutes_max}.`);
  const materiales = optText(b.materiales, L.materiales, "«Materiales»");
  if (materiales.error) return bad("materiales", materiales.error);
  const forAdult = optText(b.for_adult, L.for_adult, "«Para el adulto que acompaña»");
  if (forAdult.error) return bad("for_adult", forAdult.error);
  const siCuesta = fitText(b.si_cuesta, L.si_cuesta, "«Si cuesta…»");
  if (!siCuesta.text) return bad("si_cuesta", "Completá «Si cuesta…» (por ejemplo: que paren y lo cuenten en la próxima sesión).");
  if (siCuesta.error) return bad("si_cuesta", siCuesta.error);
  const note = optText(b.review_note, L.review_note, "El motivo");
  if (note.error) return bad("review_note", note.error);
  let activity: ActivitySpec | null = null;
  if (b.activity !== undefined && b.activity !== null) {
    const a = validateActivity(b.activity);
    if (!a.ok) return bad("activity", `Actividad: ${a.error}`);
    // Cada juego, solo en los enfoques que le corresponden (el globo, en «habla fácil»)
    if (!mechanicAllowed(a.value.mecanica, b.approach)) {
      return bad("activity", `«${MECHANIC_LABEL[a.value.mecanica]}» no corresponde al enfoque «${APPROACH_LABEL[b.approach]}».`);
    }
    activity = a.value;
  }

  return {
    ok: true,
    value: {
      id: isUuid(b.id) ? b.id : null,
      exercise_key: isUuid(b.exercise_key) ? b.exercise_key : null,
      source,
      catalog_id: source === "manual" ? null : catalogId,
      catalog_version: source === "manual" ? null : catalogVersion,
      ai_draft_id: source === "ia" ? aiDraftId : null,
      approach: b.approach,
      practiced_in_session: b.practiced_in_session === true,
      title: title.text,
      para_que: paraQue.text,
      pasos,
      minutes,
      materiales: materiales.text,
      for_adult: forAdult.text,
      si_cuesta: siCuesta.text,
      with_adult: b.with_adult !== false,
      reviewed: b.reviewed === true,
      removed: b.removed === true,
      review_note: note.text,
      activity,
    },
  };
}

// El plan del editor ("Guardar borrador")
export type PlanDraftInput = {
  id: string | null; // borrador que se edita (null: borrador nuevo; si hay uno publicado, es su versión siguiente)
  title: string;
  goal_text: string | null; // "Para qué es" (lo ve la familia)
  audience: PlanAudience; // modo de pantalla
  days_per_week: number; // meta semanal (por defecto 3)
  review_on: string | null; // "Revisar el…" (solo lo ve el equipo)
  auto_medals: boolean; // "Medallas automáticas por constancia" (prendido por defecto)
  review_note: string | null; // "Lo dejo así" para los avisos del título o de "Para qué es"
  exercises: ExerciseInput[]; // en orden (position = índice), con los quitados
};

// Guardar un borrador revisa la forma y los límites. Lo que hace falta para
// PUBLICAR (enfoques, "Lo revisé", "Lo dejo así", cantidad) lo revisa publishProblem
export function validatePlanDraft(raw: unknown): { ok: true; value: PlanDraftInput } | Bad {
  const b = (raw ?? {}) as Record<string, unknown>;
  const L = PRACTICE_LIMITS;
  const bad = (field: string, error: string): Bad => ({ ok: false, error, code: "INVALID", field });
  if (b.id !== null && b.id !== undefined && !isUuid(b.id)) return bad("id", "Pedido inválido");
  const title = fitText(line(b.title), L.plan_title, "El título del plan");
  if (!title.text) return bad("title", "Escribí el título del plan.");
  if (title.error) return bad("title", title.error);
  const goal = optText(b.goal_text, L.plan_goal_text, "«Para qué es»");
  if (goal.error) return bad("goal_text", goal.error);
  if (!(PLAN_AUDIENCES as readonly unknown[]).includes(b.audience)) return bad("audience", "Elegí la edad o el modo de pantalla.");
  const days = Number(b.days_per_week ?? L.days_per_week_default);
  if (!Number.isInteger(days) || days < L.days_per_week_min || days > L.days_per_week_max) return bad("days_per_week", "Los días por semana van de 1 a 7.");
  if (b.review_on !== null && b.review_on !== undefined && b.review_on !== "" && !isDateKey(b.review_on)) return bad("review_on", "La fecha de revisión no es válida.");
  const note = optText(b.review_note, L.review_note, "El motivo");
  if (note.error) return bad("review_note", note.error);
  const list = Array.isArray(b.exercises) ? b.exercises : [];
  if (list.length > L.exercises_in_draft_max) return { ok: false, error: PRACTICE_ERROR.exercises, code: "EXERCISES" };
  const exercises: ExerciseInput[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = validateExerciseInput(list[i]);
    if (!r.ok) return { ...r, index: i };
    exercises.push(r.value);
  }
  const keys = exercises.map((e) => e.exercise_key).filter(Boolean);
  if (new Set(keys).size !== keys.length) return bad("exercises", "Pedido inválido");
  return {
    ok: true,
    value: {
      id: isUuid(b.id) ? b.id : null,
      title: title.text,
      goal_text: goal.text,
      audience: b.audience as PlanAudience,
      days_per_week: days,
      review_on: isDateKey(b.review_on) ? b.review_on : null,
      auto_medals: b.auto_medals !== false,
      review_note: note.text,
      exercises,
    },
  };
}

// Lo que se revisa al PUBLICAR, sobre el borrador tal como quedó guardado
export type PublishCheckExercise = ExerciseTexts & {
  approach: Approach;
  practiced_in_session: boolean;
  ai_drafted: boolean;
  reviewed: boolean; // tiene reviewed_at
  removed: boolean;
  lint_overrides: Pick<LintOverride, "terms">[];
};
export type PublishCheck = {
  title: string;
  goal_text: string | null;
  lint_overrides: Pick<LintOverride, "terms">[];
  exercises: PublishCheckExercise[];
};

// null: se puede publicar. index: ejercicio (entre todos, con los quitados)
export function publishProblem(
  p: PublishCheck,
  ctx: { age: number | null; diagnosis_code: string | null; adolescent_ack: boolean },
): { error: string; code: PracticeErrorCode; index?: number; terms?: string[] } | null {
  const active = p.exercises.map((e, index) => ({ e, index })).filter((x) => !x.e.removed);
  if (active.length < PRACTICE_LIMITS.exercises_min || active.length > PRACTICE_LIMITS.exercises_max) {
    return { error: PRACTICE_ERROR.exercises, code: "EXERCISES" };
  }
  const notReviewed = active.find((x) => x.e.ai_drafted && !x.e.reviewed);
  if (notReviewed) return { error: PRACTICE_ERROR.ai_not_reviewed, code: "AI_NOT_REVIEWED", index: notReviewed.index };
  const offered = new Set(approachesForDiagnosis(ctx.diagnosis_code));
  for (const { e, index } of active) {
    if (!offered.has(e.approach) || !approachAgeOk(e.approach, ctx.age)) return { error: PRACTICE_ERROR.approach, code: "APPROACH", index };
    if (!approachAllowed(e.approach, ctx.age, e.practiced_in_session)) return { error: PRACTICE_ERROR.approach_session, code: "APPROACH", index };
  }
  const planTerms = uncoveredAlerts(planTextAlerts(p), p.lint_overrides);
  if (planTerms.length) return { error: PRACTICE_ERROR.review, code: "REVIEW", terms: planTerms };
  for (const { e, index } of active) {
    const terms = uncoveredAlerts(exerciseTextAlerts(e, e.approach), e.lint_overrides);
    if (terms.length) return { error: PRACTICE_ERROR.review, code: "REVIEW", index, terms };
  }
  if (isAdolescent(ctx.age) && !ctx.adolescent_ack) return { error: PRACTICE_ERROR.adolescent_ack, code: "ADOLESCENT_ACK" };
  return null;
}

// Una meta ("Guardar"; empieza como borrador)
export type GoalInput = {
  id: string | null; // meta en borrador que se edita (null: nueva)
  plan_id: string | null; // si se publica junto con el plan
  kind: GoalKind;
  title: string; // ≤120, pasa por blockForTitles
  rule: GoalRule | null; // solo "practica"
  medal_title: string | null; // la medalla al cumplirla (≤60, pasa por blockForTitles)
  agreed_with_patient: boolean; // "La elegimos junto con …"
};

export function validateGoal(raw: unknown): { ok: true; value: GoalInput } | Bad {
  const b = (raw ?? {}) as Record<string, unknown>;
  const L = PRACTICE_LIMITS;
  const bad = (field: string, error: string): Bad => ({ ok: false, error, code: "INVALID", field });
  if (b.id !== null && b.id !== undefined && !isUuid(b.id)) return bad("id", "Pedido inválido");
  if (b.plan_id !== null && b.plan_id !== undefined && !isUuid(b.plan_id)) return bad("plan_id", "Pedido inválido");
  if (!(GOAL_KINDS as readonly unknown[]).includes(b.kind)) return bad("kind", "Elegí cómo se cumple la meta.");
  const kind = b.kind as GoalKind;
  const title = fitText(line(b.title), L.goal_title, "La meta");
  if (!title.text) return bad("title", "Escribí cuál es la meta.");
  if (title.error) return bad("title", title.error);
  const titleBlock = blockForTitles(title.text);
  if (titleBlock.length) return { ok: false, error: FLUENCY_TITLE_MESSAGE, code: "TITLE_BLOCK", field: "title", terms: titleBlock };
  let rule: GoalRule | null = null;
  if (kind === "practica") {
    const r = (b.rule ?? {}) as Record<string, unknown>;
    const dias = Number(r.dias);
    const semanas = Number(r.semanas);
    if (!Number.isInteger(semanas) || semanas < 1 || semanas > L.goal_weeks_max) return bad("rule", `Las semanas van de 1 a ${L.goal_weeks_max}.`);
    if (!Number.isInteger(dias) || dias < 1 || dias > Math.min(L.goal_days_max, semanas * 7)) return bad("rule", "Los días no entran en esas semanas.");
    rule = { dias, semanas };
  }
  const medal = optText(line(b.medal_title), L.medal_title, "El nombre de la medalla");
  if (medal.error) return bad("medal_title", medal.error);
  const medalBlock = blockForTitles(medal.text);
  if (medalBlock.length) return { ok: false, error: FLUENCY_TITLE_MESSAGE, code: "TITLE_BLOCK", field: "medal_title", terms: medalBlock };
  return {
    ok: true,
    value: {
      id: isUuid(b.id) ? b.id : null,
      plan_id: isUuid(b.plan_id) ? b.plan_id : null,
      kind,
      title: title.text,
      rule,
      medal_title: medal.text,
      agreed_with_patient: b.agreed_with_patient === true,
    },
  };
}

// Una devolución (se publica al enviarla, con el nombre de quien la escribe).
// En la misma operación puede dar metas por logradas y entregar una medalla.
export type FeedbackInput = {
  plan_id: string | null;
  body: string; // 10 a 800
  for_adult: string | null; // "Para el adulto que acompaña" (≤300)
  goal_ids: string[]; // metas activas que se dan por logradas
  medal: { title: string; message: string | null; goal_id: string | null } | null; // "Sumar una medalla"
  adolescent_ack: boolean; // 13 a 17: "Lo conversé con …"
  review_note: string | null; // "Lo dejo así" para los avisos del texto
};

export function validateFeedback(raw: unknown, ctx: { adolescent: boolean }): { ok: true; value: FeedbackInput } | Bad {
  const b = (raw ?? {}) as Record<string, unknown>;
  const L = PRACTICE_LIMITS;
  const bad = (field: string, error: string): Bad => ({ ok: false, error, code: "INVALID", field });
  if (b.plan_id !== null && b.plan_id !== undefined && !isUuid(b.plan_id)) return bad("plan_id", "Pedido inválido");
  const body = fitText(b.body, L.feedback_max, "La devolución");
  if (body.text.length < L.feedback_min) return bad("body", `Escribí la devolución (al menos ${L.feedback_min} caracteres).`);
  if (body.error) return bad("body", body.error);
  const forAdult = optText(b.for_adult, L.feedback_for_adult, "«Para el adulto que acompaña»");
  if (forAdult.error) return bad("for_adult", forAdult.error);
  const goalIds = Array.isArray(b.goal_ids) ? b.goal_ids : [];
  if (goalIds.length > L.feedback_goals_max || !goalIds.every(isUuid)) return bad("goal_ids", "Pedido inválido");
  let medal: FeedbackInput["medal"] = null;
  if (b.medal) {
    const m = b.medal as Record<string, unknown>;
    const title = fitText(line(m.title), L.medal_title, "El nombre de la medalla");
    if (!title.text) return bad("medal", "Escribí el nombre de la medalla.");
    if (title.error) return bad("medal", title.error);
    const block = blockForTitles(title.text);
    if (block.length) return { ok: false, error: FLUENCY_TITLE_MESSAGE, code: "TITLE_BLOCK", field: "medal", terms: block };
    const message = optText(m.message, L.medal_message, "El mensaje de la medalla");
    if (message.error) return bad("medal", message.error);
    if (m.goal_id !== null && m.goal_id !== undefined && !isUuid(m.goal_id)) return bad("medal", "Pedido inválido");
    medal = { title: title.text, message: message.text, goal_id: isUuid(m.goal_id) ? m.goal_id : null };
  }
  const note = optText(b.review_note, L.review_note, "El motivo");
  if (note.error) return bad("review_note", note.error);
  const alerts = uniq([body.text, forAdult.text ?? ""].flatMap((t) => {
    const r = lintPracticeText(t);
    return [...r.block, ...r.review];
  }));
  if (alerts.length && !note.text) return { ok: false, error: PRACTICE_ERROR.review, code: "REVIEW", terms: alerts };
  if (ctx.adolescent && b.adolescent_ack !== true) return { ok: false, error: PRACTICE_ERROR.adolescent_ack, code: "ADOLESCENT_ACK" };
  return {
    ok: true,
    value: {
      plan_id: isUuid(b.plan_id) ? b.plan_id : null,
      body: body.text,
      for_adult: forAdult.text,
      goal_ids: uniq(goalIds as string[]),
      medal,
      adolescent_ack: b.adolescent_ack === true,
      review_note: alerts.length ? note.text : null,
    },
  };
}

// ── Lo que ve la familia ────────────────────────────────────────────────────
// Nunca: emails del equipo, motivos de retiro, lint_overrides, marcas de IA,
// notas de otras cuentas, revisiones internas, review_on ni exercise_key.

export type PracticeChildDTO = { id: string; first_name: string; self: boolean; audience: PlanAudience };

export type PracticePlanDTO = {
  id: string;
  title: string;
  goal_text: string | null; // "Para qué: …"
  author_label: string; // "Lic. Ana Torres · MP 1234"
  published_at: string; // ISO
  days_per_week: number;
  total_minutes: number;
};

// Nota de ESTA cuenta sobre la práctica de un día (nunca las de otros adultos)
export type MyNoteDTO = { result: PracticeResult | null; comment: string | null };

// Un ejercicio en la lista de /portal/ejercicios/$patientId
export type PracticeExerciseItemDTO = {
  id: string; // ejercicio de la versión publicada (para /portal/practicar/$exerciseId)
  title: string;
  minutes: number;
  with_adult: boolean; // "Con un adulto"
  done_today: boolean; // alguien de la familia lo anotó hoy (se mantiene si se publica una versión nueva)
  log_id: string | null; // la práctica de hoy (para contar cómo les fue o deshacer)
  can_undo: boolean; // la anotó esta cuenta, hoy
  my_note: MyNoteDTO | null;
};

export type GoalDTO = {
  id: string;
  kind: GoalKind;
  title: string;
  status: "activa" | "lograda"; // borradores y cambiadas no se muestran
  achieved_at: string | null; // ISO ("¡Lograda! · 10/10")
  // Activa: la medalla al cumplirla (la que se acordó). Lograda: la medalla
  // que de verdad se dio por ella (vigente), o null si no se dio ninguna
  medal_title: string | null;
  // Desde cuándo está en camino (fecha del centro en que se publicó). Solo
  // en la página de logros; optativo para no romper otras vistas
  since?: string | null;
  // Metas de práctica activas: cuántos días se practicó de los que pide
  // (la mejor ventana: nunca baja ni se vence). null en las terapéuticas
  progress?: GoalProgressDTO | null;
};

export type GoalProgressDTO = { days: number; target: number; weeks: number };

// Lo que la página de logros suma a cada meta: desde cuándo y, si es de
// práctica y está activa, el avance (goalProgress). Lo usan el servidor y el mock
export function familyGoalExtras(
  g: { kind: GoalKind; status: string; rule: GoalRule | null; published_at: string | null },
  days: PracticeDay[],
  today: string,
): { since: string | null; progress: GoalProgressDTO | null } {
  const since = g.published_at ? centerDateOf(g.published_at) : null;
  if (g.status !== "activa" || g.kind !== "practica" || !g.rule || !since) return { since, progress: null };
  const p = goalProgress({ kind: g.kind, rule: g.rule, start: since }, days, today);
  return { since, progress: p ? { days: Math.min(p.days, p.target), target: p.target, weeks: p.weeks } : null };
}

// Una medalla (o un grupo: las que se repiten muestran "Ganada 4 veces")
export type MedalDTO = {
  id: string; // la más nueva del grupo
  kind: MedalKind;
  code: string; // ConstancyCode o "profesional"
  title: string;
  awarded_at: string; // ISO, la más nueva
  times: number; // 1 salvo las que se repiten
  by: string | null; // profesional: author_label de la devolución ("Te la dio Lic. Ana Torres")
  message: string | null; // profesional: su frase
  goal_title: string | null; // profesional: la meta cumplida
  is_new: boolean; // esta cuenta todavía no la vio (celebración)
};

// Celebración: una medalla nueva que esta cuenta todavía no vio
export type CelebrationDTO = {
  medal_id: string;
  patient_id: string;
  first_name: string;
  self: boolean;
  audience: PlanAudience; // hasta 8: la tortuga y "¡Medalla nueva!"; desde 9: "Nuevo logro: …"
  kind: MedalKind;
  // null en las del profesional: en el Inicio y en la celebración se nombran
  // de forma genérica ("Medalla nueva de Lic. Ana Torres · Ver"); el nombre
  // se ve en la página de medallas
  title: string | null;
  by: string | null; // profesional: author_label
};

// La devolución, como la ve la familia
export type FeedbackItemDTO = {
  id: string;
  author_label: string;
  sent_at: string; // ISO ("Viernes 10 de octubre")
  body: string;
  for_adult: string | null;
  medal_title: string | null; // "Te dio la medalla «…»"
  goals_achieved: string[]; // títulos de las metas que se dieron por logradas
  // "Nueva": esta cuenta todavía no la vio. Leerla no la marca: la página la
  // marca con { action: "feedback_seen" } después de mostrarla
  is_new: boolean;
};

// /portal/ejercicios/$patientId
export type PracticeDTO = {
  child: PracticeChildDTO;
  mode: ScreenMode; // por la franja del plan publicado (o por la edad, sin plan)
  plan: PracticePlanDTO | null; // null: no hay nada publicado (PRACTICE_TEXT.not_available)
  exercises: PracticeExerciseItemDTO[]; // los activos, en orden
  week: WeekDTO | null; // null sin plan
  goals: GoalDTO[]; // activas y logradas
  last_feedback: FeedbackItemDTO | null;
  feedback_new: number; // devoluciones que esta cuenta no abrió
  recent_medals: MedalDTO[]; // las últimas 3 (times = 1)
  reviewed: { by: string; on: string } | null; // "Lic. … vio las prácticas el …" (by: author_label; on: AAAA-MM-DD)
  on_break_until: string | null; // pausa de vacaciones vigente: fecha de vuelta (AAAA-MM-DD); null sin pausa
  adult_guide: string[]; // "Para el adulto que acompaña": textos distintos de los ejercicios, en orden
  celebration: CelebrationDTO[]; // medallas nuevas para esta cuenta (de esta persona)
};

// Un día que se puede anotar en la página de práctica (hoy, ayer, anteayer)
export type PracticeDayDTO = {
  date: string;
  label: "hoy" | "ayer" | "anteayer";
  log: { id: string; mine: boolean; can_undo: boolean; my_note: MyNoteDTO | null } | null; // null: sin anotar
};

// /portal/practicar/$exerciseId
export type PracticeExerciseDTO = {
  child: PracticeChildDTO;
  mode: ScreenMode;
  plan_id: string;
  author_label: string; // "Lo preparó {profesional}" (Migue no aparece)
  exercise: {
    id: string;
    title: string;
    para_que: string;
    pasos: string[];
    minutes: number;
    materiales: string | null;
    for_adult: string | null;
    si_cuesta: string;
    with_adult: boolean;
    activity: ActivitySpec | null; // para jugar en el celular (solo con la etapa "activities")
  };
  today: string; // fecha del centro
  days: PracticeDayDTO[]; // hoy primero; sin los días anteriores a la publicación del ejercicio
  week: WeekDTO;
  on_break_until: string | null;
};

// Respuesta de anotar, contar cómo les fue o deshacer
export type PracticeActionResult = {
  exercise: PracticeExerciseDTO; // la página actualizada
  log_id: string | null; // el registro creado o tocado (null al deshacer)
  new_medals: CelebrationDTO[]; // medallas que ganó esta práctica (para la celebración)
};

// /portal/devoluciones/$patientId (pedirla no marca nada: la página manda
// "feedback_seen" con las nuevas después de mostrarlas). has_plan: hay un plan
// publicado, o sea ejercicios para marcar (feedbackNoReply)
export type FeedbackDTO = { child: PracticeChildDTO; has_plan: boolean; items: FeedbackItemDTO[] };

// /portal/medallas/$patientId: "Mis logros" / "Medallas de Martín" (las
// devoluciones de esa página se piden aparte, con FeedbackDTO). Se puede ver
// sin plan publicado (null, false y vacío en lo que depende del plan)
export type MedalsDTO = {
  child: PracticeChildDTO;
  author_label: string | null; // del plan publicado (para medalsIntro)
  auto_medals: boolean; // si el plan suma medallas de constancia
  earned: MedalDTO[]; // agrupadas, de la más nueva a la más vieja
  next: MedalNextDTO[]; // "Para seguir sumando" (vacío si auto_medals es false o en la pausa)
  // Metas activas (de la más vieja a la más nueva) y después las logradas (la
  // última primero), como en PracticeDTO: nunca borradores ni "cambiada" (las
  // de un plan finalizado o retirado)
  goals: GoalDTO[];
  // Pausa de vacaciones vigente: fecha de vuelta (AAAA-MM-DD), como en
  // PracticeDTO; la página muestra breakLine en lugar de "Para seguir sumando".
  // Optativo: sin el dato, la página solo deja de mostrar "Para seguir sumando"
  on_break_until?: string | null;
};

// Por persona en /me (ChildClinicalDTO.practice_home), solo si la práctica
// está disponible para esta cuenta y hay algo para ver: un plan publicado o
// alguna devolución vigente (no retirada), medalla vigente (no anulada) o
// meta activa o lograda. Sin nada de eso, null. Cuadraditos "Ejercicios"
// (solo con plan) y "Mis logros" del Inicio, y botón Ejercicios (solo con plan)
export type PracticeHomeDTO = {
  mode: ScreenMode; // el del plan publicado (sin plan, por la edad)
  audience: PlanAudience;
  has_plan: boolean; // hay un plan publicado
  week: { count: number; target: number } | null; // null sin plan
  on_break_until: string | null; // null sin plan
  feedback_new: number;
  medals_new: number;
};

// Lo que manda la familia
export type PracticeLogInput = { exercise_id: string; practiced_on?: string }; // sin fecha: hoy
export type PracticeNoteInput = { log_id: string; result?: PracticeResult | null; comment?: string | null };

// GET /api/portal/practice?view=…&id=…  (id: paciente, salvo en "exercise")
export type PracticeView = "plan" | "exercise" | "feedback" | "medals";
// POST /api/portal/practice
export type PracticeFamilyAction =
  | ({ action: "log" } & PracticeLogInput)
  | ({ action: "note" } & PracticeNoteInput)
  | { action: "undo"; log_id: string }
  | { action: "medals_seen"; ids: string[] }
  | { action: "feedback_seen"; ids: string[] };

// Acciones del registro de accesos (portal_access_log.action)
export const PRACTICE_ACCESS_ACTIONS = { feedback: "ver_devolucion", medal: "ver_medalla" } as const;

// ── Lo que ve el equipo (sección "Portal del paciente" de la ficha) ─────────
// Administración ve estados, no textos: los campos marcados "(null para
// Administración)" llegan en null y las listas de textos, vacías.

export type CatalogEntry = {
  id: string;
  approach: Approach;
  ages: { from: number; to?: number }; // edades en años cumplidos (to incluido)
  title: string;
  para_que: string;
  pasos: string[];
  minutes: number;
  materiales: string;
  for_adult: string;
  si_cuesta: string;
  with_adult: boolean;
};

export type StaffExerciseDTO = {
  id: string;
  exercise_key: string;
  position: number;
  source: ExerciseSource;
  catalog_id: string | null;
  catalog_version: string | null;
  approach: Approach;
  practiced_in_session: boolean;
  title: string;
  para_que: string;
  pasos: string[];
  minutes: number;
  materiales: string | null;
  for_adult: string | null;
  si_cuesta: string;
  with_adult: boolean;
  ai_drafted: boolean; // pastilla "Adaptado con IA"
  ai_draft_id: string | null;
  reviewed_at: string | null; // "Lo revisé"
  reviewed_by_email: string | null;
  edit_ratio: number | null; // 0..1: cuánto se editó el texto de la IA (se calcula al publicar)
  alerts: string[]; // avisos del texto (exerciseTextAlerts; nunca bloquean)
  lint_overrides: LintOverride[];
  removed_at: string | null;
  first_published_on: string | null; // primer día en que se publicó este exercise_key
  activity: ActivitySpec | null; // (null con la etapa "activities" apagada)
};

export type StaffPlanDTO = {
  id: string;
  version: number;
  status: PlanStatus;
  title: string | null; // (null para Administración)
  goal_text: string | null; // (null para Administración)
  audience: PlanAudience;
  mode: ScreenMode;
  days_per_week: number;
  review_on: string | null;
  on_break_until: string | null;
  auto_medals: boolean;
  professional_id: string | null;
  author_label: string | null; // se fija al publicar
  adolescent_ack: boolean;
  supersedes_id: string | null;
  created_by_email: string;
  created_at: string;
  updated_at: string; // se manda como expected_updated_at (si cambió, 409 CONFLICT)
  updated_by_email: string | null;
  published_at: string | null;
  published_by_email: string | null;
  closed_at: string | null;
  closed_by_email: string | null;
  close_reason: PlanCloseReason | null;
  last_reviewed_at: string | null; // "Visto"
  last_reviewed_by_email: string | null;
  lint_overrides: LintOverride[];
  exercises: StaffExerciseDTO[]; // ([] para Administración)
  exercise_count: number; // activos
  total_minutes: number;
  summary_line: string; // planSummary().line
  minutes_warning: string | null; // planSummary().warning
  publish_problem: string | null; // solo borradores: por qué todavía no se puede publicar
};

// Versiones anteriores (historial)
export type StaffPlanVersion = {
  id: string;
  version: number;
  status: PlanStatus;
  author_label: string | null;
  published_at: string | null;
  published_by_email: string | null;
  closed_at: string | null;
  close_reason: PlanCloseReason | null;
};

// Grilla de los últimos 14 días con el "¿Cómo te fue?" de cada adulto
export type StaffGridResult = {
  who: string; // "María López (madre)"
  result: PracticeResult | null;
  comment: boolean; // dejó un comentario
  risk: boolean;
};
export type StaffGridCell = {
  log_id: string;
  logged_by: string | null; // quien la anotó (null si la cuenta ya no existe)
  results: StaffGridResult[]; // ([] para Administración)
};
export type StaffPracticeGrid = {
  dates: string[]; // GRID_DAYS fechas, de la más vieja a hoy
  rows: {
    exercise_key: string;
    title: string | null; // de la versión más nueva (null para Administración)
    current: boolean; // está en el plan publicado
    cells: (StaffGridCell | null)[]; // alineadas con dates; null: sin práctica
  }[];
};

// Comentarios de la familia (los de riesgo primero: "Revisar hoy")
export type StaffNoteDTO = {
  id: string;
  log_id: string;
  practiced_on: string;
  exercise_title: string;
  who: string; // "María López (madre)" o "La cuenta ya no existe"
  result: PracticeResult | null;
  comment: string | null;
  risk: boolean;
  created_at: string;
  is_new: boolean; // posterior al último "Visto" o devolución
  log_undone: boolean; // la práctica se deshizo después (la nota queda)
};

export type StaffGoalDTO = {
  id: string;
  plan_id: string | null;
  kind: GoalKind;
  title: string | null; // (null para Administración)
  rule: GoalRule | null;
  medal_title: string | null; // (null para Administración)
  agreed_with_patient: boolean;
  status: GoalStatus;
  created_at: string;
  created_by_email: string;
  published_at: string | null;
  achieved_at: string | null;
  feedback_id: string | null;
  changed_at: string | null;
  changed_by_email: string | null;
  progress: GoalProgress | null; // "practica" activa
  met_dismissed: boolean; // "Todavía no" en la bandeja
};

export type StaffMedalDTO = {
  id: string;
  kind: MedalKind;
  code: string;
  title: string | null; // profesional: (null para Administración)
  period_key: string;
  plan_id: string | null;
  goal_id: string | null;
  feedback_id: string | null;
  message: string | null; // (null para Administración)
  awarded_at: string;
  awarded_by_email: string | null; // null: automática
  voided_at: string | null;
  voided_by_email: string | null;
  void_reason: string | null;
  seen_by: { name: string; at: string }[]; // quién de la familia la vio
};

export type StaffFeedbackDTO = {
  id: string;
  plan_id: string | null;
  author_label: string;
  body: string | null; // (null para Administración)
  for_adult: string | null; // (null para Administración)
  period_start: string | null;
  period_end: string | null;
  adolescent_ack: boolean;
  review_note: string | null; // (null para Administración)
  sent_at: string;
  sent_by_email: string;
  withdrawn_at: string | null;
  withdrawn_by_email: string | null;
  withdraw_reason: FeedbackWithdrawReason | null;
  reads: { name: string; at: string }[]; // "La vio María el 09/10"
  medal: { id: string; title: string | null } | null;
  goals: { id: string; title: string | null }[];
  can_withdraw: boolean; // quien la mandó o la Dirección, y sigue vigente
};

// Lo nuevo desde el último "Visto" o devolución (lo que pone la fila en la bandeja)
export type StaffPracticePending = {
  logs: number;
  comments: number;
  costo: number; // "Me costó"
  risk: number;
  since: string | null; // AAAA-MM-DD de la práctica pendiente más vieja
  stale: boolean; // 7 días o más sin revisar y sin pausa (ámbar)
};

export type StaffPracticeDTO = {
  // ai: la ayuda de IA está disponible (etapa "ai" y clave). activities: las
  // actividades para jugar en el celular (etapa "activities" y script 33)
  features: { ai: boolean; activities: boolean; recordings: boolean };
  // «Me grabo»: grabaciones sin revisar que todavía tienen audio (0 sin la etapa)
  recordings_to_listen: number;
  can_edit: boolean; // profesional o Dirección
  author: { label: string | null; problem: string | null }; // con qué nombre se publica (como StaffInfoDTO)
  patient: {
    id: string;
    first_name: string;
    self: boolean; // paciente adulto (titular)
    age: number | null;
    audience: PlanAudience; // por la edad (lo que el editor propone para el plan)
    adolescent: boolean; // 13 a 17: "Lo conversé con …"
  };
  approaches: ApproachOption[]; // ([] para Administración)
  // Lo que la ficha sugiere para armar los ejercicios (practiceSuggest.ts);
  // null para Administración. Nunca viaja a la IA: solo lo ve el profesional
  suggestions: PracticeSuggestions | null;
  practice_enabled: boolean; // interruptor del paciente (patient_portal_settings)
  readers: string[]; // quienes hoy ven la práctica: "María López (madre)"
  readers_line: string; // readersLine()
  published: StaffPlanDTO | null;
  draft: StaffPlanDTO | null; // (null para Administración)
  history: StaffPlanVersion[]; // de la más nueva a la más vieja, sin el publicado ni el borrador
  summary: { since: string | null; logs: number; days: number; last: string | null; text: string }; // practiceSummaryText
  grid: StaffPracticeGrid;
  notes: StaffNoteDTO[]; // ([] para Administración)
  pending: StaffPracticePending;
  goals: StaffGoalDTO[];
  goals_met: { goal_id: string; title: string | null; met_on: string }[]; // de práctica, cumplidas y sin dar por logradas
  medals: StaffMedalDTO[]; // de la más nueva a la más vieja
  feedback: StaffFeedbackDTO[]; // de la más nueva a la más vieja
  catalog_version: string;
  catalog: CatalogEntry[] | null; // solo en la respuesta de { action: "catalog" } (catalogFor del paciente)
};

// Bandeja Portal → "Prácticas" (solo perfiles clínicos)
// grabaciones: «Me grabo» (etapa recordings), grabaciones sin revisar con audio
export type StaffPracticeInboxItem = {
  kind: "practicas" | "meta_cumplida" | "grabaciones";
  patient_id: string;
  patient_name: string; // "Apellido, Nombre"
  professional_id: string | null; // profesional a cargo
  mine: boolean; // paciente de quien mira (para "Mis pacientes" y el contador)
  pending: StaffPracticePending; // "5 prácticas nuevas" "1 comentario" "Me costó: 1"
  last_reviewed_at: string | null;
  on_break: boolean;
  goal: { id: string; title: string; met_on: string } | null; // solo "meta_cumplida"
  recordings?: { count: number; since: string } | null; // solo "grabaciones": cuántas y la más vieja
};

// ── Acciones del equipo: POST /api/portal-staff/practice ────────────────────
// Todas devuelven StaffPracticeDTO actualizado. Escriben solo profesional o
// Dirección (Administración: 403); "get" lo puede pedir cualquier rol.

export type PracticeAction =
  | { action: "get"; patient_id: string }
  | { action: "catalog"; patient_id: string } // StaffPracticeDTO con catalog
  | {
      action: "plan_save_draft";
      patient_id: string;
      expected_updated_at: string | null; // updated_at del borrador que se editó (null: borrador nuevo)
      plan: PlanDraftInput;
    }
  | {
      action: "plan_publish";
      patient_id: string;
      plan_id: string; // el borrador
      expected_updated_at: string; // del borrador revisado
      expected_published_id: string | null; // el publicado que se reemplaza (null: no había)
      adolescent_ack?: boolean; // 13 a 17
    }
  | { action: "plan_break"; patient_id: string; plan_id: string; until: string | null } // fecha de vuelta (posterior a hoy); null: termina la pausa
  | { action: "plan_finish"; patient_id: string; plan_id: string }
  | { action: "plan_withdraw"; patient_id: string; plan_id: string; reason: PlanWithdrawReason } // un borrador queda "descartado"
  | { action: "mark_seen"; patient_id: string } // "Visto"
  | { action: "feedback_send"; patient_id: string; feedback: FeedbackInput } // también marca "Visto"
  | { action: "feedback_withdraw"; patient_id: string; feedback_id: string; reason: FeedbackWithdrawReason }
  | { action: "goal_save"; patient_id: string; goal: GoalInput } // crea o edita una meta en borrador
  | { action: "goal_publish"; patient_id: string; goal_id: string; adolescent_ack?: boolean } // "Publicar meta"
  | { action: "goal_change"; patient_id: string; goal_id: string } // activa → cambiada
  | { action: "goal_not_yet"; patient_id: string; goal_id: string } // "Todavía no" (meta cumplida en la bandeja)
  | { action: "medal_void"; patient_id: string; medal_id: string; reason: string }; // solo para errores

// ── Utilidades ──────────────────────────────────────────────────────────────

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// "a, b y c"
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

// Las medallas de una celebración, sin repetir nombres (una cuenta que vuelve
// después de varias semanas tiene varias "Semana cumplida"): "Semana cumplida
// (3 veces) y Primer paso". Las del profesional van sin su nombre (pueden ser
// sensibles): "Una medalla de Lic. Ana Torres", "2 logros de Lic. Ana Torres"
export function celebrationNames(items: { title: string | null; by: string | null }[], word: "medalla" | "logro"): string {
  const groups = new Map<string, { title: string | null; by: string; n: number }>();
  for (const c of items) {
    const by = authorName(c.by);
    const key = c.title !== null ? `t|${c.title}` : `p|${by}`;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { title: c.title, by, n: 1 });
  }
  return joinNames([...groups.values()].map((g, i) => {
    if (g.title !== null) return g.n > 1 ? `${g.title} (${g.n} veces)` : g.title;
    if (g.n > 1) return `${g.n} ${word}s de ${g.by}`;
    const one = word === "logro" ? "un logro" : "una medalla";
    return `${i === 0 ? one.charAt(0).toUpperCase() + one.slice(1) : one} de ${g.by}`;
  }));
}
