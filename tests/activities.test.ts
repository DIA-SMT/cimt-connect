// Pruebas de las actividades interactivas (fase 1: poesía y rima): la rima en
// español, el contrato, los avisos de cada mecánica, «convertir en poesía
// interactiva» y el motor, que juega cada mecánica de principio a fin.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { rhymeKey, rhymeOf, lastWord } from "../src/lib/rhymeEs";
import { type ActivitySpec, ACTIVITY_LIMITS, BLANK, SPEC_VERSION, readActivity, validateActivity } from "../src/lib/activitySpec";
import {
  ACTIVITY_MIN_AGE, activityAgeOk, activityAutoComplete, activityFullText, activitySteps, activityTexts, activityWarnings,
  emptyActivity, guessScheme, poemFromText,
} from "../src/lib/activityMechanics";
import { type EngineState, engineReduce, initialEngine, restoreEngine } from "../src/lib/activityEngine";

const poem: ActivitySpec = {
  v: SPEC_VERSION, mecanica: "poesia", titulo: "Dinosaurios", tema: "selva", esquema: "AABB", rima: "asonante", palmas: true,
  estrofas: [
    { versos: ["Un dinosaurio grande", "camina por el valle", "come hojas del pino", "y saluda al camino"], icono: "hoja" },
    { versos: ["Tiene una cola larga", "que barre la montaña", "y cuando llega el sol", "se duerme en un rincón"], icono: null },
  ],
};

const rhyme: ActivitySpec = {
  v: SPEC_VERSION, mecanica: "rima", titulo: "Rimas del fútbol", tema: "ciudad",
  tarjetas: [
    { verso: "Patea la pelota", completar: `y la pelota ${BLANK}`, respuesta: "rebota", distractores: ["corre", "salta"], icono: "pelota" },
    { verso: "Mi amigo Ramón", completar: `atajó en el ${BLANK}`, respuesta: "portón", distractores: ["arco"], icono: null },
  ],
};

describe("rima en español", () => {
  test("última palabra, sin signos", () => {
    expect(lastWord("¡Qué lindo es el sol!")).toBe("sol");
    expect(lastWord("   ")).toBe("");
  });

  test("consonante y asonante", () => {
    const pairs: [string, string, "consonante" | "asonante"][] = [
      ["canción", "corazón", "consonante"],
      ["café", "bebé", "consonante"],
      ["queso", "beso", "consonante"],
      ["luz", "cruz", "consonante"],
      ["casa", "caza", "consonante"], // seseo
      ["cielo", "suelo", "consonante"], // diptongo: desde la vocal fuerte
      ["río", "frío", "consonante"], // hiato con tilde
      ["rey", "ley", "consonante"],
      ["hoy", "voy", "consonante"],
      ["pingüino", "camino", "consonante"],
      ["dinosaurio", "canario", "asonante"],
      ["pájaro", "canto", "asonante"], // esdrújula
      ["árbol", "mármol", "asonante"],
      ["valle", "grande", "asonante"],
    ];
    for (const [a, b, kind] of pairs) expect(`${a}/${b}: ${rhymeOf(a, b, kind)}`).toBe(`${a}/${b}: rima`);
  });

  test("lo que no rima", () => {
    expect(rhymeOf("sol", "mar", "asonante")).toBe("no_rima");
    expect(rhymeOf("dinosaurio", "canario", "consonante")).toBe("no_rima");
    expect(rhymeOf("árbol", "mármol", "consonante")).toBe("no_rima");
    expect(rhymeOf("casa", "mesa", "asonante")).toBe("no_rima");
    expect(rhymeOf("el sol", "un sol", "asonante")).toBe("misma_palabra");
    expect(rhymeOf("…", "sol", "asonante")).toBe("sin_palabra");
  });

  test("vocal tónica", () => {
    expect(rhymeKey("canción")?.asonante).toBe("o");
    expect(rhymeKey("mesa")?.asonante).toBe("e-a");
    expect(rhymeKey("ratón")?.consonante).toBe("on");
    expect(rhymeKey("guitarra")?.consonante).toBe("arra");
    expect(rhymeKey("murciélago")?.asonante).toBe("e-o");
  });
});

describe("contrato", () => {
  test("una poesía y una rima válidas", () => {
    expect(validateActivity(poem).ok).toBe(true);
    expect(validateActivity(rhyme).ok).toBe(true);
  });

  test("limpia espacios y completa lo que tiene valor por defecto", () => {
    const r = validateActivity({ v: 1, mecanica: "poesia", titulo: "  Sol  ", esquema: "libre", estrofas: [{ versos: [" a  b ", "c"] }] });
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.mecanica !== "poesia") return;
    expect(r.value.titulo).toBe("Sol");
    expect(r.value.tema).toBe("cielo");
    expect(r.value.rima).toBe("asonante");
    expect(r.value.palmas).toBe(false);
    expect(r.value.estrofas[0]).toEqual({ versos: ["a b", "c"], icono: null });
  });

  test("rechaza lo que no corresponde", () => {
    const bad = (x: unknown) => validateActivity(x);
    expect(bad(null).ok).toBe(false);
    expect(bad({ ...poem, v: 2 }).ok).toBe(false);
    expect(bad({ ...poem, mecanica: "aventura" }).ok).toBe(false);
    expect(bad({ ...poem, script: "alert(1)" }).ok).toBe(false); // sin campos de más
    expect(bad({ ...poem, tema: "https://x.com/a.png" }).ok).toBe(false);
    expect(bad({ ...poem, estrofas: [{ versos: ["uno"], icono: null }] }).ok).toBe(false);
    expect(bad({ ...poem, estrofas: [{ versos: ["x".repeat(ACTIVITY_LIMITS.verso + 1), "b"], icono: null }] }).ok).toBe(false);
    expect(bad({ ...poem, estrofas: [{ versos: ["a", "b", "c", "d"], icono: "dinosaurio" }] }).ok).toBe(false);
    expect(bad({ ...poem, estrofas: Array.from({ length: 5 }, () => poem.mecanica === "poesia" && poem.estrofas[0]) }).ok).toBe(false);
  });

  test("con esquema, cada estrofa tiene sus versos", () => {
    const r = validateActivity({ ...poem, estrofas: [{ versos: ["a", "b", "c"], icono: null }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("AABB");
      expect(r.path).toBe("estrofas.0.versos");
    }
    expect(validateActivity({ ...poem, esquema: "libre", estrofas: [{ versos: ["a", "b", "c"], icono: null }] }).ok).toBe(true);
  });

  test("tarjetas de rima: el hueco una vez y opciones sin repetir", () => {
    if (rhyme.mecanica !== "rima") throw new Error();
    const card = rhyme.tarjetas[0];
    const withCard = (c: object) => validateActivity({ ...rhyme, tarjetas: [card, { ...card, ...c }] });
    expect(withCard({ completar: "sin hueco" }).ok).toBe(false);
    expect(withCard({ completar: `${BLANK} y ${BLANK}` }).ok).toBe(false);
    expect(withCard({ distractores: ["Rebota"] }).ok).toBe(false);
    expect(withCard({ distractores: ["corre", "corre"] }).ok).toBe(false);
    expect(withCard({ distractores: [] }).ok).toBe(false);
    expect(withCard({ respuesta: "re-bota" }).ok).toBe(false);
    expect(withCard({ respuesta: "<b>" }).ok).toBe(false);
    expect(validateActivity({ ...rhyme, tarjetas: [card] }).ok).toBe(false);
  });

  test("readActivity: lo que no se puede leer es null", () => {
    expect(readActivity(null)).toBeNull();
    expect(readActivity({ v: 99 })).toBeNull();
    expect(readActivity(poem)?.titulo).toBe("Dinosaurios");
  });
});

describe("mecánicas", () => {
  test("pasos y textos", () => {
    expect(activitySteps(poem)).toBe(8);
    expect(activitySteps(rhyme)).toBe(2);
    expect(activityAutoComplete(poem)).toBe(true);
    expect(activityAutoComplete(rhyme)).toBe(false);
    expect(activityTexts(rhyme)).toContain("y la pelota rebota");
    expect(activityFullText(null)).toBe("");
    expect(activityFullText(poem)).toContain("se duerme en un rincón");
  });

  test("la poesía de ejemplo rima sin avisos", () => {
    expect(activityWarnings(poem)).toEqual([]);
    expect(activityWarnings(rhyme)).toEqual([]);
  });

  test("avisos de la poesía", () => {
    if (poem.mecanica !== "poesia") throw new Error();
    const broken = { ...poem, estrofas: [{ versos: ["Un dinosaurio grande", "camina por el río", "come hojas", "y come hojas"], icono: null }] };
    const w = activityWarnings(broken);
    expect(w.map((x) => x.path)).toEqual(["estrofas.0.versos.1", "estrofas.0.versos.3"]);
    expect(w[0].message).toContain("no parecen rimar");
    expect(w[1].message).toContain("misma palabra");
    expect(activityWarnings({ ...broken, esquema: "libre" })).toEqual([]);
  });

  test("avisos de la rima", () => {
    if (rhyme.mecanica !== "rima") throw new Error();
    const w = activityWarnings({ ...rhyme, tarjetas: [{ ...rhyme.tarjetas[0], respuesta: "salta", distractores: ["gota"], completar: `${BLANK} la pelota` }] });
    expect(w.map((x) => x.path)).toEqual(["tarjetas.0.respuesta", "tarjetas.0.distractores.0", "tarjetas.0.completar"]);
  });

  test("edad mínima", () => {
    expect(ACTIVITY_MIN_AGE).toBe(6);
    expect(activityAgeOk(5)).toBe(false);
    expect(activityAgeOk(6)).toBe(true);
    expect(activityAgeOk(null)).toBe(true);
  });

  test("convertir un texto en poesía interactiva", () => {
    const p = poemFromText("La luna redonda\nmira desde el cielo\n\nla nube la esconde\ncomo un caramelo\n", "  La luna ");
    expect(p.titulo).toBe("La luna");
    expect(p.estrofas.map((e) => e.versos.length)).toEqual([2, 2]);
    expect(p.esquema).toBe("libre"); // «redonda» y «cielo» no riman
    expect(validateActivity(p).ok).toBe(true);
    const aabb = poemFromText("Un dinosaurio grande\ncamina por el valle\ncome hojas del pino\ny saluda al camino", "Dino");
    expect(aabb.esquema).toBe("AABB");
    expect(guessScheme([["el sol", "un gato", "la mesa", "el pato"]])).toBe("ABCB");
    expect(guessScheme([["el sol", "la flor", "un gato", "el pato"]])).toBe("AABB"); // sol y flor: o
    expect(guessScheme([])).toBe("libre");
  });

  test("las actividades vacías piden completar", () => {
    expect(validateActivity(emptyActivity("poesia", "Hola")).ok).toBe(false);
    expect(validateActivity(emptyActivity("rima", "Hola")).ok).toBe(false);
  });
});

describe("motor", () => {
  // Juega una actividad entera como lo haría la familia
  function playThrough(spec: ActivitySpec): EngineState {
    const auto = activityAutoComplete(spec);
    let s = engineReduce(initialEngine(activitySteps(spec)), { type: "EMPEZAR" }, auto);
    for (let guard = 0; guard < 100 && s.status !== "terminado"; guard++) {
      if (!s.done[s.step]) s = engineReduce(s, { type: "COMPLETAR" }, auto);
      s = engineReduce(s, { type: "SIGUIENTE" }, auto);
    }
    return s;
  }

  test("cada mecánica se puede terminar", () => {
    expect(playThrough(poem).status).toBe("terminado");
    expect(playThrough(rhyme).status).toBe("terminado");
  });

  test("en la rima no se avanza sin resolver la tarjeta", () => {
    let s = engineReduce(initialEngine(2), { type: "EMPEZAR" }, false);
    expect(engineReduce(s, { type: "SIGUIENTE" }, false)).toBe(s);
    s = engineReduce(s, { type: "COMPLETAR" }, false);
    s = engineReduce(s, { type: "SIGUIENTE" }, false);
    expect(s.step).toBe(1);
    expect(engineReduce(s, { type: "SIGUIENTE" }, false)).toBe(s); // la última sin resolver: no termina
  });

  test("eventos que no corresponden se ignoran", () => {
    const listo = initialEngine(3);
    for (const type of ["COMPLETAR", "SIGUIENTE", "ANTERIOR", "PAUSAR", "SEGUIR"] as const) {
      expect(engineReduce(listo, { type }, true)).toBe(listo);
    }
    expect(engineReduce(initialEngine(0), { type: "EMPEZAR" }, true).status).toBe("listo");
    const jugando = engineReduce(listo, { type: "EMPEZAR" }, true);
    expect(engineReduce(jugando, { type: "EMPEZAR" }, true)).toBe(jugando);
    expect(engineReduce(jugando, { type: "ANTERIOR" }, true)).toBe(jugando);
  });

  test("pausar, seguir, volver y empezar de nuevo", () => {
    let s = engineReduce(initialEngine(2), { type: "EMPEZAR" }, true);
    s = engineReduce(s, { type: "PAUSAR" }, true);
    expect(engineReduce(s, { type: "SIGUIENTE" }, true)).toBe(s);
    s = engineReduce(s, { type: "SEGUIR" }, true);
    s = engineReduce(engineReduce(s, { type: "SIGUIENTE" }, true), { type: "SIGUIENTE" }, true);
    expect(s.status).toBe("terminado");
    s = engineReduce(s, { type: "ANTERIOR" }, true);
    expect(s).toMatchObject({ status: "jugando", step: 1 });
    expect(engineReduce(s, { type: "REINICIAR" }, true)).toEqual(initialEngine(2));
  });

  test("seguir otro día: solo un estado que coincide", () => {
    const saved = { status: "jugando", step: 1, total: 3, done: [true, true, false] };
    expect(restoreEngine(saved, 3)).toEqual({ status: "pausado", step: 1, total: 3, done: [true, true, false] });
    expect(restoreEngine(saved, 4)).toBeNull();
    expect(restoreEngine({ ...saved, step: 3 }, 3)).toBeNull();
    expect(restoreEngine({ ...saved, status: "terminado" }, 3)).toBeNull();
    expect(restoreEngine({ ...saved, done: [1, 1, 0] }, 3)).toBeNull();
    expect(restoreEngine("x", 3)).toBeNull();
  });
});
