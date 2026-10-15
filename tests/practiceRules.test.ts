// Pruebas de ejercicios, devoluciones, metas y medallas (etapa B): fechas y
// semanas del centro, medallas de constancia, metas, enfoques por edad y
// diagnóstico, marca de riesgo, revisión del texto y validaciones.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  APPROACHES, APPROACH_ADULT_GUIDE, type Approach, type ConstancyAward, type PracticeDay, PRACTICE_TEXT,
  PRO_MEDAL_SUGGESTIONS, type PublishCheck, type PublishCheckExercise,
  approachAllowed, approachOptions, approachesForDiagnosis, audienceForAge, blockForTitles, breakLine, celebrationNames,
  centerToday, constancyAwards, constancyNext, dayIndex, daysBetween, diagnosisGroup, exerciseTextAlerts, exercisesTitle,
  feedbackHeader, feedbackNoReply, feedbackTitle, goalProgress, howDidItGo, lintPracticeText, medalsTitle, onBreak, planSummary, practiceConfirmation,
  practiceDateProblem, practiceDates, practiceSummaryText, publishProblem, readersLine, riskFlag, screenMode,
  uncoveredAlerts, validateExerciseInput, validateFeedback, validateGoal, validateNote, validatePlanDraft,
  weekDates, weekKey, weekLine, weekProgress,
} from "../src/lib/practiceRules";
import {
  SEEN_BATCH, VERIFY_FALLBACK, logrosFailure, medalsHint, newThingsSr, practiceFailure, seenBatches,
} from "../src/components/portal/practiceFormat";

const day = (date: string, exercise_key = "k1"): PracticeDay => ({ date, exercise_key });

describe("fechas y semanas (hora del centro)", () => {
  test("la semana se identifica por su lunes, también al cruzar Año Nuevo", () => {
    expect(weekKey("2026-12-28")).toBe("2026-12-28"); // lunes
    expect(weekKey("2026-12-31")).toBe("2026-12-28");
    expect(weekKey("2027-01-03")).toBe("2026-12-28"); // domingo
    expect(weekKey("2027-01-04")).toBe("2027-01-04");
    expect(weekKey("2026-10-14")).toBe("2026-10-12");
    expect(weekDates("2027-01-01")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
    expect(dayIndex("2026-10-12")).toBe(0);
    expect(dayIndex("2026-10-18")).toBe(6);
  });
  test("hoy del centro: Tucumán es UTC−3 todo el año (sin horario de verano)", () => {
    expect(centerToday(new Date("2027-01-01T02:59:00Z"))).toBe("2026-12-31");
    expect(centerToday(new Date("2027-01-01T03:00:00Z"))).toBe("2027-01-01");
    expect(centerToday(new Date("2026-07-01T02:59:00Z"))).toBe("2026-06-30");
    expect(centerToday(new Date("2026-07-01T03:00:00Z"))).toBe("2026-07-01");
  });
  test("días entre fechas", () => {
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-01", "2026-10-15")).toBe(14);
    expect(daysBetween("2026-10-15", "2026-10-01")).toBe(-14);
  });
  test("fechas que se pueden anotar: hoy, ayer y anteayer, nunca antes de publicar", () => {
    expect(practiceDateProblem("2026-10-14", "2026-10-14", "2026-10-01")).toBeNull();
    expect(practiceDateProblem("2026-10-12", "2026-10-14", "2026-10-01")).toBeNull();
    expect(practiceDateProblem("2026-10-11", "2026-10-14", "2026-10-01")).not.toBeNull();
    expect(practiceDateProblem("2026-10-15", "2026-10-14", "2026-10-01")).not.toBeNull();
    expect(practiceDateProblem("2026-10-13", "2026-10-14", "2026-10-14")).toBe("Ese día todavía no tenían este ejercicio.");
    expect(practiceDateProblem("2026-02-30", "2026-10-14", null)).not.toBeNull();
    expect(practiceDates("2026-10-14", "2026-10-13")).toEqual(["2026-10-14", "2026-10-13"]);
    expect(practiceDates("2026-10-14", null)).toEqual(["2026-10-14", "2026-10-13", "2026-10-12"]);
  });
  test("pausa de vacaciones: la fecha guardada es la de vuelta", () => {
    expect(onBreak("2027-02-02", "2027-02-01")).toBe(true);
    expect(onBreak("2027-02-02", "2027-02-02")).toBe(false);
    expect(onBreak(null, "2027-02-01")).toBe(false);
    expect(breakLine("2027-02-02")).toBe("Pausa de vacaciones: vuelve el 02/02. No hace falta anotar nada hasta entonces.");
  });
});

// Simula el uso real: después de cada práctica el servidor llama a
// constancyAwards y guarda lo nuevo
function simulate(dates: (string | PracticeDay)[], daysPerWeek = 3): ConstancyAward[] {
  const logs: PracticeDay[] = [];
  const awarded: ConstancyAward[] = [];
  for (const d of dates) {
    const log = typeof d === "string" ? day(d) : d;
    logs.push(log);
    awarded.push(...constancyAwards({ logs, days_per_week: daysPerWeek, awarded, today: log.date }));
  }
  return awarded;
}
const codes = (a: ConstancyAward[]) => a.map((x) => (x.period_key ? `${x.code}@${x.period_key}` : x.code));

describe("constancyAwards (medallas de constancia)", () => {
  test("primera práctica: «Primer paso»", () => {
    expect(constancyAwards({ logs: [day("2026-10-14")], days_per_week: 3, awarded: [], today: "2026-10-14" }))
      .toEqual([{ code: "primer_paso", period_key: "", title: "Primer paso" }]);
  });
  test("semana cumplida: días distintos de lunes a domingo", () => {
    const got = constancyAwards({
      logs: [day("2026-10-12"), day("2026-10-13"), day("2026-10-13", "k2"), day("2026-10-14")],
      days_per_week: 3, awarded: [{ code: "primer_paso", period_key: "" }], today: "2026-10-14",
    });
    expect(codes(got)).toEqual(["semana_cumplida@2026-10-12"]);
    // Dos ejercicios el mismo día cuentan como un día
    expect(constancyAwards({
      logs: [day("2026-10-12"), day("2026-10-12", "k2"), day("2026-10-13")],
      days_per_week: 3, awarded: [{ code: "primer_paso", period_key: "" }], today: "2026-10-13",
    })).toEqual([]);
  });
  test("se repite una vez por semana (también a fin de año)", () => {
    const got = simulate(["2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28", "2026-12-31", "2027-01-02"]);
    expect(codes(got).filter((c) => c.startsWith("semana"))).toEqual(["semana_cumplida@2026-12-21", "semana_cumplida@2026-12-28"]);
  });
  test("un mes: 4 semanas con alguna práctica, no hace falta que sean seguidas", () => {
    const got = simulate(["2026-09-09", "2026-09-21", "2026-10-02", "2026-10-12"], 3);
    expect(codes(got)).toContain("un_mes");
    expect(codes(simulate(["2026-09-09", "2026-09-21", "2026-10-02"], 3))).not.toContain("un_mes");
  });
  test("¡De vuelta!: después de 14 días o más sin practicar, una vez por vuelta", () => {
    expect(codes(simulate(["2026-10-01", "2026-10-15"]))).toContain("de_vuelta@2026-10-15");
    expect(codes(simulate(["2026-10-01", "2026-10-14"])).some((c) => c.startsWith("de_vuelta"))).toBe(false);
    // Anotar "ayer" después de la vuelta no da otra medalla
    const first = simulate(["2026-10-01", "2026-10-16"]);
    const again = constancyAwards({
      logs: [day("2026-10-01"), day("2026-10-16"), day("2026-10-15")], days_per_week: 3, awarded: first, today: "2026-10-16",
    });
    expect(codes(again).some((c) => c.startsWith("de_vuelta"))).toBe(false);
    // Una segunda vuelta, más adelante, sí
    expect(codes(simulate(["2026-10-01", "2026-10-15", "2026-11-02"])).filter((c) => c.startsWith("de_vuelta")))
      .toEqual(["de_vuelta@2026-10-15", "de_vuelta@2026-11-02"]);
  });
  test("10, 25 y 50 prácticas: días-ejercicio distintos", () => {
    const logs: PracticeDay[] = [];
    for (let d = 1; d <= 5; d++) for (const k of ["a", "b"]) logs.push(day(`2026-10-0${d}`, k));
    logs.push(day("2026-10-05", "a")); // repetida: no suma
    const got = constancyAwards({ logs, days_per_week: 7, awarded: [{ code: "primer_paso", period_key: "" }], today: "2026-10-05" });
    expect(codes(got)).toEqual(["practicas_10"]);
    const many: PracticeDay[] = [];
    for (let d = 1; d <= 25; d++) for (const k of ["a", "b"]) many.push(day(`2026-10-${String(d).padStart(2, "0")}`, k));
    const all = codes(constancyAwards({ logs: many, days_per_week: 7, awarded: [], today: "2026-10-25" }));
    expect(all).toContain("practicas_10");
    expect(all).toContain("practicas_25");
    expect(all).toContain("practicas_50");
  });
  test("no repite lo que ya se dio (tampoco las anuladas)", () => {
    expect(constancyAwards({
      logs: [day("2026-10-12"), day("2026-10-13"), day("2026-10-14")], days_per_week: 3,
      awarded: [{ code: "primer_paso", period_key: "" }, { code: "semana_cumplida", period_key: "2026-10-12" }],
      today: "2026-10-14",
    })).toEqual([]);
  });
  test("apagadas en el plan o en pausa: no calcula nada", () => {
    const base = { logs: [day("2026-10-14")], days_per_week: 3, awarded: [], today: "2026-10-14" };
    expect(constancyAwards({ ...base, auto_medals: false })).toEqual([]);
    expect(constancyAwards({ ...base, on_break_until: "2026-10-20" })).toEqual([]);
    expect(codes(constancyAwards({ ...base, on_break_until: "2026-10-14" }))).toEqual(["primer_paso"]);
  });
  test("las fechas futuras no cuentan y el resultado es estable", () => {
    expect(constancyAwards({ logs: [day("2026-10-20")], days_per_week: 3, awarded: [], today: "2026-10-14" })).toEqual([]);
    const input = { logs: [day("2026-10-12"), day("2026-10-13"), day("2026-10-14")], days_per_week: 3, awarded: [], today: "2026-10-14" };
    expect(constancyAwards(input)).toEqual(constancyAwards(input));
    expect(codes(constancyAwards(input))).toEqual(["primer_paso", "semana_cumplida@2026-10-12"]);
  });
  test("«Para seguir sumando»: sin cuentas regresivas", () => {
    const next = constancyNext({ logs: [day("2026-10-12"), day("2026-10-13")], days_per_week: 3, awarded: [], today: "2026-10-14" });
    expect(next.map((n) => n.code)).toEqual(["semana_cumplida", "un_mes", "practicas_10"]);
    expect(next[0].text).toBe("llevás 2 de 3 días esta semana");
    expect(constancyNext({ logs: [], days_per_week: 3, awarded: [], today: "2026-10-14", auto_medals: false })).toEqual([]);
  });
  test("«Para seguir sumando» en la pausa: nada (ni «llevás 0 de 3 días esta semana»)", () => {
    const base = { logs: [day("2026-10-06")], days_per_week: 3, awarded: [], today: "2026-10-14" };
    expect(constancyNext({ ...base, on_break_until: "2026-10-20" })).toEqual([]);
    expect(constancyNext({ ...base, logs: [], on_break_until: "2026-10-20" })).toEqual([]);
    // El día de la vuelta ya no hay pausa
    expect(constancyNext({ ...base, on_break_until: "2026-10-14" }).map((n) => n.code)).toEqual(["semana_cumplida", "un_mes", "practicas_10"]);
    expect(constancyNext({ ...base, on_break_until: "2026-10-14" })[0].text).toBe("llevás 0 de 3 días esta semana");
  });
  test("la semana de hoy", () => {
    const w = weekProgress([day("2026-10-12"), day("2026-10-12", "k2"), day("2026-10-14")], 3, "2026-10-14");
    expect(w.week).toBe("2026-10-12");
    expect(w.count).toBe(2);
    expect(w.met).toBe(false);
    expect(w.days.map((d) => d.practiced)).toEqual([true, false, true, false, false, false, false]);
    expect(w.days[2].today).toBe(true);
    expect(w.days[3].future).toBe(true);
  });
});

describe("goalProgress (metas de práctica)", () => {
  const goal = { kind: "practica" as const, rule: { dias: 3, semanas: 1 }, start: "2026-10-01" };
  test("N días dentro de cualquier ventana de M semanas, desde que se publicó", () => {
    const p = goalProgress(goal, [day("2026-09-30"), day("2026-10-01"), day("2026-10-05"), day("2026-10-09")], "2026-10-09");
    expect(p).toEqual({ days: 2, target: 3, weeks: 1, met: false, met_on: null });
    const met = goalProgress(goal, [day("2026-10-01"), day("2026-10-05"), day("2026-10-07"), day("2026-10-09")], "2026-10-20");
    expect(met?.met).toBe(true);
    expect(met?.met_on).toBe("2026-10-07");
  });
  test("la cuenta nunca baja con el paso del tiempo", () => {
    const logs = [day("2026-10-01"), day("2026-10-02")];
    expect(goalProgress(goal, logs, "2026-10-02")?.days).toBe(2);
    expect(goalProgress(goal, logs, "2026-12-31")?.days).toBe(2);
  });
  test("las terapéuticas no tienen progreso automático", () => {
    expect(goalProgress({ kind: "terapeutica", rule: null, start: "2026-10-01" }, [day("2026-10-01")], "2026-10-02")).toBeNull();
  });
});

describe("enfoques por edad y por diagnóstico", () => {
  test("matriz de edades", () => {
    const cases: [Approach, number, boolean, boolean][] = [
      ["entorno_familia", 2, false, true],
      ["entorno_familia", 40, false, true],
      ["habla_facil", 5, false, false],
      ["habla_facil", 6, false, true],
      ["tartamudear_facil", 8, true, false],
      ["tartamudear_facil", 9, false, false], // falta "Ya lo practicamos en sesión"
      ["tartamudear_facil", 9, true, true],
      ["animarse", 15, false, false],
      ["animarse", 15, true, true],
      ["ritmo_y_claridad", 8, false, false],
      ["ritmo_y_claridad", 9, false, true],
      ["escuela_y_lectura", 5, false, false],
      ["escuela_y_lectura", 6, false, true],
      ["escuela_y_lectura", 17, false, true],
      ["escuela_y_lectura", 18, false, false],
      ["regulacion_y_rutinas", 2, false, true],
    ];
    for (const [a, age, session, ok] of cases) expect(`${a} ${age} ${session}: ${approachAllowed(a, age, session)}`).toBe(`${a} ${age} ${session}: ${ok}`);
    expect(approachAllowed("entorno_familia", null)).toBe(false);
    expect(approachAllowed("lidcombe", 4)).toBe(false);
    expect(approachAllowed("emociones", 10)).toBe(false);
  });
  test("el diagnóstico decide los enfoques (más los de otras áreas)", () => {
    expect(approachesForDiagnosis("F98.5")).toEqual(["entorno_familia", "habla_facil", "tartamudear_facil", "animarse", "escuela_y_lectura", "regulacion_y_rutinas"]);
    expect(approachesForDiagnosis(" f98.6 ")).toEqual(["ritmo_y_claridad", "escuela_y_lectura", "regulacion_y_rutinas"]);
    expect(approachesForDiagnosis(null)).toEqual(["entorno_familia", "escuela_y_lectura", "regulacion_y_rutinas"]);
    expect(approachesForDiagnosis("F84.0")).toEqual(approachesForDiagnosis(null));
    expect(diagnosisGroup("F84.0")).toBe("evaluacion");
  });
  test("opciones del editor: sugeridos por el diagnóstico y edad", () => {
    const opts = approachOptions("F98.5", 7);
    expect(opts.find((o) => o.approach === "habla_facil")).toMatchObject({ suggested: true, age_ok: true, needs_session: false });
    expect(opts.find((o) => o.approach === "animarse")).toMatchObject({ suggested: true, age_ok: false, needs_session: true });
    expect(opts.find((o) => o.approach === "escuela_y_lectura")).toMatchObject({ suggested: false, age_ok: true });
  });
  test("textos base para el adulto: sin frases que bloqueen", () => {
    for (const a of APPROACHES) expect(lintPracticeText(APPROACH_ADULT_GUIDE[a], a)).toEqual({ block: [], review: [] });
  });
});

describe("modos de pantalla y títulos", () => {
  test("tres modos por edad", () => {
    expect([3, 8, 9, 12, 13, 17, 40].map(screenMode)).toEqual(["tortuga", "tortuga", "pasos", "pasos", "lista", "lista", "lista"]);
    expect(audienceForAge(null)).toBe("preadolescencia");
  });
  test("a quién se nombra", () => {
    const martin = { first_name: "Martín", self: false, audience: audienceForAge(7) };
    const fer = { first_name: "Fernanda", self: false, audience: audienceForAge(14) };
    const laura = { first_name: "Laura", self: true, audience: audienceForAge(40) };
    expect(exercisesTitle(martin)).toBe("Ejercicios de Martín");
    expect(exercisesTitle(laura)).toBe("Mis ejercicios");
    expect(medalsTitle(martin)).toBe("Medallas de Martín");
    expect(medalsTitle(fer)).toBe("Logros de Fernanda");
    expect(medalsTitle(laura)).toBe("Mis logros");
    expect(feedbackTitle(martin, "Lic. Ana Torres · MP 1234")).toBe("Mensaje de Lic. Ana Torres para Martín");
    expect(feedbackTitle(fer, "Lic. Ana Torres · MP 1234")).toBe("Devolución de Lic. Ana Torres");
    expect(practiceConfirmation(martin, "tortuga", { count: 2, target: 3 })).toBe("¡Bien hecho, Martín! Ya van 2 días esta semana.");
    expect(practiceConfirmation(laura, "lista", { count: 2, target: 3 })).toBe("Listo, quedó registrado. Esta semana: 2 de 3 días.");
  });
  test("la semana: nunca «4 de 3 días» si se pasan de la meta", () => {
    expect(weekLine({ count: 0, target: 3 })).toBe("esta semana 0 de 3 días");
    expect(weekLine({ count: 1, target: 1 })).toBe("esta semana 1 de 1 día");
    expect(weekLine({ count: 3, target: 3 })).toBe("esta semana 3 de 3 días");
    expect(weekLine({ count: 4, target: 3 })).toBe("esta semana 4 días (la meta era 3)");
    expect(weekLine({ count: 2, target: 1 })).toBe("esta semana 2 días (la meta era 1)");
    const laura = { first_name: "Laura", self: true, audience: audienceForAge(40) };
    const martin = { first_name: "Martín", self: false, audience: audienceForAge(7) };
    expect(practiceConfirmation(laura, "lista", { count: 4, target: 3 })).toBe("Listo, quedó registrado. Esta semana: 4 días (la meta era 3).");
    expect(practiceConfirmation(martin, "tortuga", { count: 4, target: 3 })).toBe("¡Bien hecho, Martín! Ya van 4 días esta semana.");
  });
  test("confirmación de «Ayer» en la semana anterior o en la pausa: sin la cuenta de esta semana", () => {
    const laura = { first_name: "Laura", self: true, audience: audienceForAge(40) };
    const martin = { first_name: "Martín", self: false, audience: audienceForAge(7) };
    const fer = { first_name: "Fernanda", self: false, audience: audienceForAge(14) };
    // Lunes 12/10: "Ayer" es el domingo 11/10, de la semana anterior
    const monday = weekProgress([], 3, "2026-10-12");
    const sunday = { date: "2026-10-11", label: "ayer" };
    expect(practiceConfirmation(martin, "tortuga", monday, { day: sunday })).toBe("¡Bien hecho, Martín! Quedó anotada la práctica de ayer.");
    expect(practiceConfirmation(martin, "pasos", monday, { day: sunday })).toBe("¡Bien hecho, Martín! Quedó anotada la práctica de ayer.");
    expect(practiceConfirmation(fer, "lista", monday, { day: sunday })).toBe("Listo, quedó anotada la práctica de ayer.");
    expect(practiceConfirmation(laura, "lista", monday, { day: { date: "2026-10-10", label: "anteayer" } }))
      .toBe("Listo, quedó anotada la práctica de anteayer.");
    // Miércoles 14/10: "Ayer" es de esta semana y cuenta
    const wednesday = weekProgress([day("2026-10-13")], 3, "2026-10-14");
    expect(practiceConfirmation(laura, "lista", wednesday, { day: { date: "2026-10-13", label: "ayer" } }))
      .toBe("Listo, quedó registrado. Esta semana: 1 de 3 días.");
    expect(practiceConfirmation(martin, "tortuga", wednesday, { day: { date: "2026-10-13", label: "ayer" } }))
      .toBe("¡Bien hecho, Martín! Ya va 1 día esta semana.");
    // Hoy, en la pausa de vacaciones: no se cuenta nada
    const today = { date: "2026-10-14", label: "hoy" };
    expect(practiceConfirmation(laura, "lista", wednesday, { day: today, on_break: true })).toBe("Listo, quedó anotada la práctica de hoy.");
    expect(practiceConfirmation(martin, "tortuga", wednesday, { on_break: true })).toBe("¡Bien hecho, Martín! Quedó anotada la práctica de hoy.");
  });
  test("«¿Cómo te fue?» dice el día si no es hoy", () => {
    expect(howDidItGo("hoy")).toBe("¿Cómo te fue?");
    expect(howDidItGo("ayer")).toBe("¿Cómo te fue ayer?");
    expect(howDidItGo("anteayer")).toBe("¿Cómo te fue anteayer?");
  });
  test("celebración con varias medallas: sin repetir nombres", () => {
    const sc = { title: "Semana cumplida", by: null };
    const pp = { title: "Primer paso", by: null };
    const pro = { title: null, by: "Lic. Ana Torres · MP 1234" };
    expect(celebrationNames([sc, sc, sc, pp], "medalla")).toBe("Semana cumplida (3 veces) y Primer paso");
    expect(celebrationNames([pp, sc], "logro")).toBe("Primer paso y Semana cumplida");
    expect(celebrationNames([sc, sc], "logro")).toBe("Semana cumplida (2 veces)");
    expect(celebrationNames([pro, sc], "medalla")).toBe("Una medalla de Lic. Ana Torres y Semana cumplida");
    expect(celebrationNames([sc, pro], "logro")).toBe("Semana cumplida y un logro de Lic. Ana Torres");
    expect(celebrationNames([pro, pro, sc], "medalla")).toBe("2 medallas de Lic. Ana Torres y Semana cumplida");
    expect(celebrationNames([pro, pro], "logro")).toBe("2 logros de Lic. Ana Torres");
    expect(celebrationNames([], "medalla")).toBe("");
  });
  test("«…_seen»: de a 50 ids por pedido y sin repetir", () => {
    expect(SEEN_BATCH).toBe(50);
    expect(seenBatches([])).toEqual([]);
    expect(seenBatches(["a", "b", "a", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(seenBatches(Array.from({ length: 51 }, (_, i) => `id-${i}`)).map((b) => b.length)).toEqual([50, 1]);
  });
  test("«Mis logros»: lo nuevo para el lector de pantalla, en plural sin el número", () => {
    const martin = { first_name: "Martín", self: false, audience: audienceForAge(9) };
    const fer = { first_name: "Fernanda", self: false, audience: audienceForAge(14) };
    const laura = { first_name: "Laura", self: true, audience: audienceForAge(40) };
    expect(newThingsSr(martin, 0, 0)).toBe("");
    expect(newThingsSr(martin, 1, 1)).toBe(", hay un mensaje nuevo y una medalla nueva");
    expect(newThingsSr(martin, 3, 0)).toBe(", hay mensajes nuevos");
    expect(newThingsSr(martin, 0, 3)).toBe(", hay medallas nuevas");
    expect(newThingsSr(fer, 2, 2)).toBe(", hay devoluciones nuevas y logros nuevos");
    expect(newThingsSr(laura, 1, 0)).toBe(", hay una devolución nueva");
    expect(newThingsSr(laura, 0, 1)).toBe(", hay un logro nuevo");
    expect(newThingsSr(laura, 3, 3)).toBe(", hay devoluciones nuevas y logros nuevos");
    // En el orden de la página
    expect(medalsHint(martin)).toBe("Medallas, metas y mensajes");
    expect(medalsHint(laura)).toBe("Logros, metas y devoluciones");
  });
  test("devoluciones: «mensajes» hasta los 12 y sin nombrar los ejercicios si no hay plan", () => {
    expect(feedbackHeader(true)).toBe("Los mensajes los escribe tu profesional.");
    expect(feedbackHeader(false)).toBe("Las devoluciones las escribe tu profesional.");
    expect(feedbackNoReply(true)).toContain("cuando marques un ejercicio");
    expect(feedbackNoReply(false)).toBe("Si querés comentarle algo, hacelo en el próximo turno.");
    for (const t of [feedbackHeader(true), feedbackHeader(false), feedbackNoReply(false), PRACTICE_TEXT.nothing_here]) {
      expect(t).not.toMatch(/ejercicio/i);
    }
  });
  test("«Mis logros» y las devoluciones sin acceso: textos neutros que no dicen el motivo ni nombran los ejercicios", () => {
    const empty = { kind: "empty", message: PRACTICE_TEXT.nothing_here };
    expect(logrosFailure({ status: 404, error: "x" })).toEqual(empty);
    expect(logrosFailure({ status: 403, code: "NOT_AVAILABLE", error: PRACTICE_TEXT.not_available })).toEqual(empty);
    expect(logrosFailure({ status: 403, code: "VERIFY", error: "Para ver los ejercicios, la primera vez tenés que pasar por el centro con tu DNI." }))
      .toEqual({ kind: "verify", message: VERIFY_FALLBACK });
    expect(logrosFailure({ status: 403, code: "CONSENT", error: "x" })).toEqual({ kind: "consent" });
    expect(logrosFailure({ status: 500, error: "x" })).toEqual({ kind: "error" });
    // Los ejercicios siguen con su texto
    expect(practiceFailure({ status: 403, code: "NOT_AVAILABLE", error: "" })).toEqual({ kind: "empty", message: PRACTICE_TEXT.not_available });
  });
});

describe("riskFlag (red de seguridad, no un clasificador)", () => {
  test("marca autolesión, violencia y abuso", () => {
    for (const t of [
      "Me dijo que se quiere morir",
      "dice que se quiere matar",
      "Hoy dijo «quiero matarme»",
      "Se corta los brazos",
      "En la escuela le pegan",
      "Mi papá me pegó ayer",
      "Lo golpean en el recreo",
      "Le dieron una paliza",
      "Me amenazan por WhatsApp",
      "Un tío abusó de ella",
      "Le tocan las partes",
      "Hay mucha violencia en casa",
      "Habló de suicidio",
    ]) expect(`${t}: ${riskFlag(t)}`).toBe(`${t}: true`);
  });
  test("no marca frases comunes que se parecen", () => {
    for (const t of [
      "Procurar practicar todos los días",
      "Me pegó el sol en la plaza y estaba cansado",
      "Pegamos figuritas en el álbum",
      "Le pegué las figuritas al cuaderno",
      "Le pega a la pelota muy fuerte",
      "Ahora me toca a mí",
      "Se cortó el pelo y estaba contento",
      "Se dio un golpe jugando, nada grave",
      "Nos matamos de risa con la tortuga",
      "Le costó pero lo hizo",
      "La abuela practicó con él",
      "",
    ]) expect(`${t}: ${riskFlag(t)}`).toBe(`${t}: false`);
    expect(riskFlag(null)).toBe(false);
  });
});

describe("revisión del texto (fluidez)", () => {
  test("bloquea las frases de la lista, con límites de palabra", () => {
    expect(lintPracticeText("Que pueda hablar bien en clase").block).toEqual(["hablar bien"]);
    expect(lintPracticeText("Hablar sin trabarse").block).toEqual(["sin tartamudear / sin trabarse"]);
    expect(lintPracticeText("Fluidez 100%").block).toEqual(["100 %"]);
    expect(lintPracticeText("Esto lo va a curar").block).toEqual(["curar"]);
    expect(lintPracticeText("Si no practica, castigo").block).toEqual(["castigo"]);
    expect(lintPracticeText("Quitarle el celular si no lo hace").block).toEqual(["quitarle cosas"]);
    expect(lintPracticeText("Respirá hondo antes de hablar").block).toEqual(["respirá hondo antes de hablar"]);
    expect(lintPracticeText("Pensá antes de hablar").block).toEqual(["pensá antes de hablar"]);
  });
  test("no marca lo que se parece pero no es", () => {
    expect(lintPracticeText("Procurar practicar con curiosidad")).toEqual({ block: [], review: [] });
    expect(lintPracticeText("Quitarle presión al momento de hablar")).toEqual({ block: [], review: [] });
    expect(lintPracticeText("Hablá. Bien hecho por animarte")).toEqual({ block: [], review: [] });
    expect(lintPracticeText("Podés hacerlo cuando quieras")).toEqual({ block: [], review: [] });
    expect(lintPracticeText("Hablemos de la tartamudez sin vergüenza")).toEqual({ block: [], review: [] });
  });
  test("«más despacio» es una alerta, salvo en habla fácil y en ritmo y claridad", () => {
    expect(lintPracticeText("Hablá más despacio").review).toEqual(["más despacio"]);
    expect(lintPracticeText("Hablá más despacio", "habla_facil").review).toEqual([]);
    expect(lintPracticeText("Hablá más despacio", "ritmo_y_claridad").review).toEqual([]);
    expect(lintPracticeText("Hablá más despacio", "animarse").review).toEqual(["más despacio"]);
  });
  test("otras alertas: tuteo, diagnóstico, «tartamudo»", () => {
    expect(lintPracticeText("Puedes hacerlo").review).toEqual(["tuteo (usá vos)"]);
    expect(lintPracticeText("Por su diagnóstico").review).toEqual(["diagnóstico"]);
    expect(lintPracticeText("El tartamudo de la clase").review).toEqual(["«tartamudo» (mejor: persona que tartamudea)"]);
  });
  test("títulos de metas y medallas: más estricto", () => {
    expect(blockForTitles("Hablar sin trabarse")).toContain("sin tartamudear / sin trabarse");
    expect(blockForTitles("Tartamudear menos en clase")).toContain("tartamudear menos");
    expect(blockForTitles("Más fluidez al leer")).toContain("fluidez");
    expect(blockForTitles("Hablar mejor")).toContain("hablar mejor");
    expect(blockForTitles("Animarse a pedir en el kiosco")).toEqual([]);
    for (const s of PRO_MEDAL_SUGGESTIONS) expect(`${s}: ${blockForTitles(s).length}`).toBe(`${s}: 0`);
  });
  test("en el texto del profesional todo es alerta, con «Lo dejo así»", () => {
    const t = { title: "Hablar bien", para_que: "Para hablar más despacio", pasos: ["Uno", "Dos"], materiales: null, for_adult: null, si_cuesta: "Paren" };
    expect(exerciseTextAlerts(t, "entorno_familia")).toEqual(["hablar bien", "más despacio"]);
    expect(uncoveredAlerts(["hablar bien", "más despacio"], [{ terms: ["hablar bien"] }])).toEqual(["más despacio"]);
  });
});

// Un ejercicio válido del editor
const exercise = (over: Record<string, unknown> = {}) => ({
  id: null, exercise_key: null, source: "manual", catalog_id: null, catalog_version: null, ai_draft_id: null,
  approach: "entorno_familia", practiced_in_session: false, title: "Tiempo especial", para_que: "Jugar juntos sin apuro",
  pasos: ["Elijan un juego", "Jueguen 10 minutos"], minutes: 10, materiales: "", for_adult: "Acompañá", si_cuesta: "Paren y cuéntenlo en la próxima sesión.",
  with_adult: true, reviewed: false, removed: false, review_note: "", ...over,
});

describe("validaciones", () => {
  test("nota de la familia: resultado o comentario, y riesgo calculado", () => {
    expect(validateNote({ result: "bien" })).toEqual({ ok: true, value: { result: "bien", comment: null, risk: false } });
    const r = validateNote({ comment: "  En la escuela le pegan  " });
    expect(r.ok && r.value).toEqual({ result: null, comment: "En la escuela le pegan", risk: true });
    expect(validateNote({}).ok).toBe(false);
    expect(validateNote({ result: "excelente" }).ok).toBe(false);
    expect(validateNote({ comment: "x".repeat(281) }).ok).toBe(false);
  });
  test("ejercicio: límites sin cortar el texto", () => {
    const ok = validateExerciseInput(exercise());
    expect(ok.ok && ok.value.materiales).toBeNull();
    expect(validateExerciseInput(exercise({ title: "x".repeat(61) })).ok).toBe(false);
    expect(validateExerciseInput(exercise({ pasos: ["Solo uno"] })).ok).toBe(false);
    expect(validateExerciseInput(exercise({ pasos: ["a", "b", "c", "d", "e", "f", "g"] })).ok).toBe(false);
    expect(validateExerciseInput(exercise({ pasos: ["a", "x".repeat(161)] })).ok).toBe(false);
    expect(validateExerciseInput(exercise({ minutes: 31 })).ok).toBe(false);
    expect(validateExerciseInput(exercise({ si_cuesta: "" })).ok).toBe(false);
    expect(validateExerciseInput(exercise({ approach: "lidcombe" })).ok).toBe(false);
    expect(validateExerciseInput(exercise({ source: "catalogo" })).ok).toBe(false); // falta catalog_id
    expect(validateExerciseInput(exercise({ source: "ia", catalog_id: "ef-tiempo-especial" })).ok).toBe(false); // falta ai_draft_id
  });
  test("borrador del plan", () => {
    const r = validatePlanDraft({ title: "Plan de Martín", audience: "infancia", days_per_week: 3, exercises: [exercise()] });
    expect(r.ok && r.value.auto_medals).toBe(true);
    expect(validatePlanDraft({ title: "Plan", audience: "bebes", exercises: [] }).ok).toBe(false);
    expect(validatePlanDraft({ title: "Plan", audience: "infancia", days_per_week: 8, exercises: [] }).ok).toBe(false);
    const bad = validatePlanDraft({ title: "Plan", audience: "infancia", exercises: [exercise(), exercise({ minutes: 0 })] });
    expect(!bad.ok && bad.index).toBe(1);
  });
  test("meta: el título no puede hablar de fluidez", () => {
    expect(validateGoal({ kind: "practica", title: "Practicar 12 días en 4 semanas", rule: { dias: 12, semanas: 4 } }).ok).toBe(true);
    const bad = validateGoal({ kind: "terapeutica", title: "Hablar sin trabarse en clase" });
    expect(!bad.ok && bad.code).toBe("TITLE_BLOCK");
    expect(validateGoal({ kind: "practica", title: "Practicar", rule: { dias: 30, semanas: 4 } }).ok).toBe(false);
    const medal = validateGoal({ kind: "terapeutica", title: "Animarse a pedir", medal_title: "Cero trabas" });
    expect(!medal.ok && medal.code).toBe("TITLE_BLOCK");
  });
  test("devolución: largo, alertas con «Lo dejo así» y conformidad de 13 a 17", () => {
    expect(validateFeedback({ body: "Muy bien" }, { adolescent: false }).ok).toBe(false); // menos de 10
    const review = validateFeedback({ body: "Qué bien que habló sin trabarse" }, { adolescent: false });
    expect(!review.ok && review.code).toBe("REVIEW");
    expect(validateFeedback({ body: "Qué bien que habló sin trabarse", review_note: "Lo pidió la familia" }, { adolescent: false }).ok).toBe(true);
    const teen = validateFeedback({ body: "¡Qué buena constancia esta semana!" }, { adolescent: true });
    expect(!teen.ok && teen.code).toBe("ADOLESCENT_ACK");
    const medal = validateFeedback({ body: "¡Qué buena constancia esta semana!", medal: { title: "Hablar perfecto" } }, { adolescent: false });
    expect(!medal.ok && medal.code).toBe("TITLE_BLOCK");
    const ok = validateFeedback({ body: "¡Qué buena constancia esta semana!", medal: { title: "Me animé" }, goal_ids: [] }, { adolescent: false });
    expect(ok.ok && ok.value.medal).toEqual({ title: "Me animé", message: null, goal_id: null });
  });
});

describe("publishProblem (lo que se revisa al publicar)", () => {
  const ex = (over: Partial<PublishCheckExercise> = {}): PublishCheckExercise => ({
    title: "Tiempo especial", para_que: "Jugar juntos", pasos: ["Uno", "Dos"], materiales: null, for_adult: null, si_cuesta: "Paren.",
    approach: "entorno_familia", practiced_in_session: false, ai_drafted: false, reviewed: false, removed: false, lint_overrides: [],
    ...over,
  });
  const plan = (exercises: PublishCheckExercise[], over: Partial<PublishCheck> = {}): PublishCheck => ({
    title: "Plan", goal_text: null, lint_overrides: [], exercises, ...over,
  });
  const ctx = { age: 7, diagnosis_code: "F98.5", adolescent_ack: false };
  test("se puede publicar", () => {
    expect(publishProblem(plan([ex()]), ctx)).toBeNull();
  });
  test("de 1 a 8 ejercicios activos", () => {
    expect(publishProblem(plan([ex({ removed: true })]), ctx)?.code).toBe("EXERCISES");
    expect(publishProblem(plan(Array.from({ length: 9 }, () => ex())), ctx)?.code).toBe("EXERCISES");
  });
  test("falta «Lo revisé» en un ejercicio de IA", () => {
    expect(publishProblem(plan([ex(), ex({ ai_drafted: true })]), ctx)).toMatchObject({ code: "AI_NOT_REVIEWED", index: 1 });
    expect(publishProblem(plan([ex({ ai_drafted: true, reviewed: true })]), ctx)).toBeNull();
  });
  test("enfoque fuera del diagnóstico, de la edad o sin la casilla de sesión", () => {
    expect(publishProblem(plan([ex({ approach: "ritmo_y_claridad" })]), { ...ctx, age: 10 })?.code).toBe("APPROACH");
    expect(publishProblem(plan([ex({ approach: "animarse" })]), ctx)?.code).toBe("APPROACH");
    expect(publishProblem(plan([ex({ approach: "animarse" })]), { ...ctx, age: 10 })?.error).toContain("Ya lo practicamos en sesión");
    expect(publishProblem(plan([ex({ approach: "animarse", practiced_in_session: true })]), { ...ctx, age: 10 })).toBeNull();
  });
  test("alertas del texto sin «Lo dejo así»", () => {
    const withAlert = ex({ para_que: "Para hablar más despacio" });
    expect(publishProblem(plan([withAlert]), ctx)).toMatchObject({ code: "REVIEW", terms: ["más despacio"] });
    expect(publishProblem(plan([{ ...withAlert, lint_overrides: [{ terms: ["más despacio"] }] }]), ctx)).toBeNull();
    expect(publishProblem(plan([ex()], { title: "Plan para hablar bien" }), ctx)?.code).toBe("REVIEW");
  });
  test("de 13 a 17 hace falta «Lo conversé con …»", () => {
    expect(publishProblem(plan([ex()]), { ...ctx, age: 14 })?.code).toBe("ADOLESCENT_ACK");
    expect(publishProblem(plan([ex()]), { ...ctx, age: 14, adolescent_ack: true })).toBeNull();
  });
});

describe("textos del panel", () => {
  test("resumen del plan y aviso para menores de 9", () => {
    expect(planSummary([{ minutes: 10 }, { minutes: 5, removed: true }], 4, 10)).toEqual({ total_minutes: 10, line: "En total: 10 minutos, 4 días por semana.", warning: null });
    expect(planSummary([{ minutes: 10 }, { minutes: 10 }], 3, 7).warning).not.toBeNull();
  });
  test("resumen de prácticas", () => {
    expect(practiceSummaryText({ since: "2026-10-03", logs: 9, days: 6, last: "2026-10-13" }, "2026-10-14"))
      .toBe("Desde el 03/10 anotaron 9 prácticas en 6 días. Última: ayer.");
    expect(practiceSummaryText({ since: null, logs: 0, days: 0, last: null }, "2026-10-14")).toBe("Todavía no anotaron prácticas.");
  });
  test("quién lo lee", () => {
    expect(readersLine(["María López (madre)", "Juan Pérez (padre)"], { first_name: "Juan", self: false }))
      .toBe("Lo leen: María López (madre), Juan Pérez (padre) y cualquiera que tenga el celular, incluido Juan.");
    expect(readersLine([], { first_name: "Juan", self: false })).toContain("Todavía nadie tiene acceso");
  });
});
