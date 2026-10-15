// Pruebas del catálogo de ejercicios (borrador a validar por las
// fonoaudiólogas): límites, revisión del texto, reglas de contenido y que
// cada enfoque tenga ejercicios para cada franja de edad que le corresponde.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { CATALOG, CATALOG_VERSION, catalogEntry, catalogFor } from "../src/lib/exerciseCatalog";
import {
  APPROACHES, APPROACH_RULES, PRACTICE_LIMITS as L, SLOW_OK_APPROACHES, lintPracticeText, normalizeForLint,
  validateExerciseInput,
} from "../src/lib/practiceRules";

describe("catálogo", () => {
  test("tamaño, versión e ids", () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(18);
    expect(CATALOG.length).toBeLessThanOrEqual(24);
    expect(CATALOG_VERSION.length).toBeGreaterThan(0);
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
    expect(catalogEntry("ef-tiempo-especial")?.approach).toBe("entorno_familia");
    expect(catalogEntry("no-existe")).toBeNull();
  });

  test("límites de cada campo (los mismos del editor y de la base)", () => {
    for (const e of CATALOG) {
      // Como lo carga el editor al "Elegir del catálogo" (id: la fila, todavía no existe)
      const r = validateExerciseInput({ ...e, id: null, source: "catalogo", catalog_id: e.id, catalog_version: CATALOG_VERSION });
      expect(`${e.id}: ${r.ok ? "ok" : r.error}`).toBe(`${e.id}: ok`);
      expect(e.title.length).toBeLessThanOrEqual(L.title);
      expect(e.para_que.length).toBeLessThanOrEqual(L.para_que);
      expect(e.pasos.length).toBeGreaterThanOrEqual(L.pasos_min);
      expect(e.pasos.length).toBeLessThanOrEqual(L.pasos_max);
      for (const p of e.pasos) expect(p.length).toBeLessThanOrEqual(L.paso);
      expect(e.minutes).toBeGreaterThanOrEqual(L.minutes_min);
      expect(e.minutes).toBeLessThanOrEqual(L.minutes_max);
      expect(e.materiales.length).toBeLessThanOrEqual(L.materiales);
      expect(e.for_adult.length).toBeLessThanOrEqual(L.for_adult);
      expect(e.si_cuesta.length).toBeLessThanOrEqual(L.si_cuesta);
    }
  });

  test("ningún texto bloquea ni tiene alertas (con su enfoque)", () => {
    for (const e of CATALOG) {
      for (const t of [e.title, e.para_que, ...e.pasos, e.materiales, e.for_adult, e.si_cuesta]) {
        const r = lintPracticeText(t, e.approach);
        expect(`${e.id} «${t}»: ${[...r.block, ...r.review].join(", ")}`).toBe(`${e.id} «${t}»: `);
      }
    }
  });

  test("reglas de contenido", () => {
    for (const e of CATALOG) {
      const all = normalizeForLint([e.title, e.para_que, ...e.pasos, e.materiales, e.for_adult, e.si_cuesta].join(" | "));
      // "Si cuesta…" siempre dice que se para y se cuenta en la próxima sesión
      expect(`${e.id}: ${/\bproxima sesion\b/.test(normalizeForLint(e.si_cuesta))}`).toBe(`${e.id}: true`);
      // Sin pantallas
      expect(`${e.id}: ${/\b(tablet|celular|compu|computadora|tele|television|video|videos|youtube|app)\b/.test(normalizeForLint(e.materiales))}`).toBe(`${e.id}: false`);
      // "Despacio" solo en habla fácil y en ritmo y claridad
      if (!SLOW_OK_APPROACHES.includes(e.approach)) expect(`${e.id}: ${/\bdespaci/.test(all)}`).toBe(`${e.id}: false`);
      // Nunca tuteo, emojis ni enlaces
      expect(/\p{Extended_Pictographic}/u.test(all)).toBe(false);
      expect(/https?:|www\./.test(all)).toBe(false);
    }
  });

  test("las edades de cada ejercicio están dentro de las de su enfoque", () => {
    for (const e of CATALOG) {
      const r = APPROACH_RULES[e.approach];
      expect(e.ages.from).toBeGreaterThanOrEqual(r.from);
      if (r.to !== null) expect(e.ages.to ?? 99).toBeLessThanOrEqual(r.to);
      if (e.ages.to !== undefined) expect(e.ages.to).toBeGreaterThanOrEqual(e.ages.from);
    }
  });

  test("cada enfoque tiene ejercicios para cada franja de edad que le corresponde", () => {
    const ages = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 25, 40, 70];
    for (const a of APPROACHES) {
      const r = APPROACH_RULES[a];
      for (const age of ages) {
        if (age < r.from || (r.to !== null && age > r.to)) {
          expect(catalogFor([a], age)).toEqual([]);
          continue;
        }
        expect(`${a} ${age}: ${catalogFor([a], age).length > 0}`).toBe(`${a} ${age}: true`);
      }
    }
  });

  test("catalogFor filtra por enfoques y por edad", () => {
    const got = catalogFor(["entorno_familia", "habla_facil"], 7);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((e) => (e.approach === "entorno_familia" || e.approach === "habla_facil") && e.ages.from <= 7 && (e.ages.to ?? 99) >= 7)).toBe(true);
    expect(catalogFor(["entorno_familia"], null)).toEqual([]);
    expect(catalogFor([], 7)).toEqual([]);
  });
});
