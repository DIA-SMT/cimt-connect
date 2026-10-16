// Pruebas de las sugerencias para armar los ejercicios con la ficha
// (src/lib/practiceSuggest.ts) y de los formatos nuevos de la IA (minijuego y
// poesía o rima). Correr con: bun test
import { describe, expect, test } from "bun:test";
import { profileFromRow, suggestPractice, type PracticeProfile } from "../src/lib/practiceSuggest";
import {
  APPROACH_PROMPT, FORMAT_PROMPT, FORMATS, PROMPT_BANNED_WORDS, buildAdaptParams, buildAdaptPrompt, describeSent,
  formatAllowed, mockDraft, parseExerciseDraft, draftToWire,
} from "../src/lib/aiDraftRules";

const base: PracticeProfile = {
  age: 7, diagnosis_code: "F98.5", other_conditions: [], autonomy: null, school: null,
  stutter_situations: null, avoids_speaking: null, frustration_communicating: null, interests: [],
};
const values = <T>(xs: { value: T }[]) => xs.map((x) => x.value);

describe("el diagnóstico es lo que más pesa", () => {
  test("los enfoques del diagnóstico van antes que los de otras áreas, y dicen por qué", () => {
    const s = suggestPractice({ ...base, school: "Escuela 123", other_conditions: ["TDAH"] });
    const top = values(s.approaches);
    expect(top.slice(0, 2)).toEqual(["habla_facil", "entorno_familia"]);
    expect(top).toContain("escuela_y_lectura");
    expect(top.indexOf("escuela_y_lectura")).toBeGreaterThan(top.indexOf("entorno_familia"));
    expect(s.approaches[0].why).toContain("diagnóstico de la ficha (F98.5)");
  });
  test("de 2 a 5 años se empieza por el entorno", () => {
    expect(values(suggestPractice({ ...base, age: 4 }).approaches)[0]).toBe("entorno_familia");
  });
  test("si evita hablar o se frustra, suben «animarse» y «tartamudear fácil» (si la edad lo permite)", () => {
    // A los 9, «habla fácil» sigue primero (los otros piden práctica en sesión)
    const nine = values(suggestPractice({ ...base, age: 9, avoids_speaking: true }).approaches);
    expect(nine.slice(0, 2)).toEqual(["habla_facil", "animarse"]);
    const s = suggestPractice({ ...base, age: 13, avoids_speaking: true, frustration_communicating: true });
    expect(values(s.approaches).slice(0, 2).sort()).toEqual(["animarse", "tartamudear_facil"]);
    expect(s.approaches.find((a) => a.value === "animarse")?.why).toContain("evita hablar");
    // A los 7 todavía no corresponden: no se sugieren
    expect(values(suggestPractice({ ...base, avoids_speaking: true }).approaches)).not.toContain("animarse");
  });
  test("otro diagnóstico: su enfoque primero", () => {
    expect(values(suggestPractice({ ...base, diagnosis_code: "F98.6", age: 10 }).approaches)[0]).toBe("ritmo_y_claridad");
  });
  test("sin diagnóstico: solo el entorno (más otras áreas) y lo dice", () => {
    const s = suggestPractice({ ...base, diagnosis_code: null });
    expect(s.approaches[0]).toMatchObject({ value: "entorno_familia" });
    expect(s.approaches[0].why).toContain("Todavía sin diagnóstico");
    expect(values(s.approaches)).not.toContain("habla_facil");
  });
});

describe("la ficha completa el resto", () => {
  test("otras condiciones → adaptaciones (la necesidad, con el porqué)", () => {
    const s = suggestPractice({ ...base, other_conditions: ["TDAH", "Hipoacusia"] });
    expect(values(s.adaptaciones)).toEqual(["atencion_breve", "con_movimiento", "apoyo_visual"]);
    expect(s.adaptaciones[2].why).toBe("Hipoacusia en la ficha.");
  });
  test("semáforo rojo: sin lectura y consignas cortas; a los 4 años, sin lectura igual", () => {
    expect(values(suggestPractice({ ...base, autonomy: "rojo" }).adaptaciones)).toEqual(["sin_lectura", "consignas_cortas"]);
    expect(values(suggestPractice({ ...base, age: 4 }).adaptaciones)).toEqual(["sin_lectura"]);
  });
  test("dónde: en casa siempre, y lo que dicen las situaciones de la ficha", () => {
    const s = suggestPractice({ ...base, age: 11, stutter_situations: "Al hablar por teléfono y en el kiosco" });
    expect(values(s.contexto)).toEqual(["casa", "telefono", "salidas"]);
    expect(values(suggestPractice({ ...base, age: 6 }).contexto)).toEqual(["casa", "juego"]);
  });
  test("intereses de la ficha: los válidos y hasta 3", () => {
    const s = suggestPractice({ ...base, interests: ["musica", "inventado", "futbol", "animales", "autos"] });
    expect(s.intereses).toEqual(["futbol", "animales", "musica"]);
  });
  test("formato: a los más chicos, minijuego; a los grandes, el de siempre", () => {
    expect(suggestPractice({ ...base, age: 6 }).formato.value).toBe("minijuego");
    expect(suggestPractice({ ...base, age: 14 }).formato.value).toBe("ejercicio");
  });
  test("la fila de la ficha se lee aunque falten datos", () => {
    const p = profileFromRow({ other_conditions: ["TEA"], autonomy: "violeta", school: "  ", interests: null }, 9, "F98.5");
    expect(p).toMatchObject({ other_conditions: ["TEA"], autonomy: null, school: null, interests: [], age: 9 });
    expect(profileFromRow(null, null, null).other_conditions).toEqual([]);
  });
});

describe("formatos de la IA: minijuego y poesía o rima", () => {
  const REQ = {
    patient_id: "p1", catalog_ids: ["hf-tortuga-suave"], approach: "habla_facil", practiced_in_session: false,
    quien_acompana: "adulto_con_chico", contexto: ["casa"], minutos: 5, dificultad: "igual", adaptaciones: [], intereses: [],
  };
  const patient = { age: 7, diagnosis_code: "F98.5" };

  test("el formato viaja (sin formato: ejercicio) y se valida contra el enfoque", () => {
    const r = buildAdaptParams({ ...REQ, formato: "poesia" }, patient);
    expect(r.ok && r.params.formato).toBe("poesia");
    const old = buildAdaptParams(REQ, patient);
    expect(old.ok && old.params.formato).toBe("ejercicio");
    expect(buildAdaptParams({ ...REQ, formato: "cancion" }, patient).ok).toBe(false);
    expect(formatAllowed("poesia", "animarse")).toBe(false);
    expect(formatAllowed("minijuego", "animarse")).toBe(true);
  });
  test("el prompt suma el bloque del formato, y el resumen de lo enviado lo muestra", () => {
    const r = buildAdaptParams({ ...REQ, formato: "minijuego" }, patient);
    if (!r.ok) throw new Error(r.error);
    expect(buildAdaptPrompt(r.params, r.entries).system).toContain(FORMAT_PROMPT.minijuego);
    expect(describeSent(r.params, r.entries).fields).toContainEqual({ label: "Formato", value: "Minijuego" });
  });
  test("ni los formatos ni los enfoques nombran diagnósticos ni usan palabras bloqueadas", () => {
    const text = [...FORMATS.map((f) => FORMAT_PROMPT[f]), ...Object.values(APPROACH_PROMPT)].join(" ").toLowerCase();
    expect(text).not.toMatch(/tartamudez|\btartamud(o|a|os|as)\b|farfull|disfemia|disfluen|f98/);
    for (const w of PROMPT_BANNED_WORDS) expect(text).not.toContain(w);
  });
  test("el borrador del demo respeta los largos en los tres formatos", () => {
    for (const formato of FORMATS) {
      const r = buildAdaptParams({ ...REQ, formato }, patient);
      if (!r.ok) throw new Error(r.error);
      const parsed = parseExerciseDraft(draftToWire(mockDraft(r.params, r.entries)), r.params.catalogo.ids);
      expect(parsed.ok).toBe(true);
    }
  });
});
