// Pruebas de «Me grabo»: la actividad, las reglas de las grabaciones y quién
// las reconoce (src/lib/recordingRules.ts, server/lib/recordings.ts).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { mechanicAllowed, validateActivity } from "../src/lib/activitySpec";
import { activitySteps, activityTexts, activityWarnings, emptyActivity } from "../src/lib/activityMechanics";
import { analyzeWords } from "../src/lib/recordingAnalysis";
import { RECORDING_KEEP_DAYS, deleteAfter, stripAnalysis, validateReview } from "../src/lib/recordingRules";
import { CLINICAL_FEATURES, parseFeatures } from "../src/lib/portalClinicalRules";
import { sttOrder } from "../server/lib/recordings";

const REC = { v: 1, mecanica: "grabacion", titulo: "Contame", tema: "ciudad", consigna: "Contá qué hiciste el fin de semana." };

describe("la actividad «Me grabo»", () => {
  test("se valida, con habla libre y 60 segundos por defecto", () => {
    const r = validateActivity(REC);
    expect(r.ok && r.value.mecanica === "grabacion" && [r.value.texto, r.value.segundos]).toEqual([null, 60]);
  });
  test("con texto para leer y los segundos en su rango", () => {
    expect(validateActivity({ ...REC, texto: "La tortuga camina.", segundos: 30 }).ok).toBe(true);
    expect(validateActivity({ ...REC, segundos: 90 }).ok).toBe(false);
    expect(validateActivity({ ...REC, segundos: 5 }).ok).toBe(false);
    expect(validateActivity({ ...REC, consigna: "" }).ok).toBe(false);
  });
  test("un solo paso; sus textos pasan por la revisión", () => {
    const r = validateActivity({ ...REC, texto: "Hola, ¿cómo estás?" });
    if (!r.ok) throw new Error(r.error);
    expect(activitySteps(r.value)).toBe(1);
    expect(activityTexts(r.value)).toEqual(["Contame", REC.consigna, "Hola, ¿cómo estás?"]);
  });
  test("avisa si el texto no entra en los segundos", () => {
    const r = validateActivity({ ...REC, texto: "palabra ".repeat(60).trim(), segundos: 15 });
    if (!r.ok) throw new Error(r.error);
    expect(activityWarnings(r.value).map((w) => w.path)).toEqual(["texto"]);
  });
  test("vacía no se puede guardar", () => {
    expect(validateActivity(emptyActivity("grabacion", "Hola")).ok).toBe(false);
  });
  test("en los enfoques de habla y lectura; no en «entorno familia»", () => {
    expect(mechanicAllowed("grabacion", "habla_facil")).toBe(true);
    expect(mechanicAllowed("grabacion", "tartamudear_facil")).toBe(true);
    expect(mechanicAllowed("grabacion", "entorno_familia")).toBe(false);
    expect(mechanicAllowed("grabacion", "regulacion_y_rutinas")).toBe(false);
  });
  test("la etapa «recordings» existe", () => {
    expect(CLINICAL_FEATURES).toContain("recordings");
    expect(parseFeatures("practice,activities,recordings")).toContain("recordings");
  });
});

describe("la revisión del profesional", () => {
  test("el %SS sale de su conteo", () => {
    expect(validateReview({ stuttered: 3, syllables: 60, note: "  bien  " })).toEqual({
      ok: true, value: { stuttered: 3, syllables: 60, pss: 5, note: "bien" },
    });
  });
  test("conteos imposibles no se guardan", () => {
    expect(validateReview({ stuttered: 10, syllables: 5 }).ok).toBe(false);
    expect(validateReview({ stuttered: -1, syllables: 5 }).ok).toBe(false);
    expect(validateReview({ stuttered: 1, syllables: 0 }).ok).toBe(false);
    expect(validateReview({ stuttered: 1.5, syllables: 10 }).ok).toBe(false);
    expect(validateReview({ stuttered: 1, syllables: 10, note: "x".repeat(601) }).ok).toBe(false);
  });
});

describe("los 90 días", () => {
  test("cuándo se borra el audio", () => {
    expect(deleteAfter("2026-10-01T12:00:00.000Z")).toBe(new Date(Date.UTC(2026, 9, 1 + RECORDING_KEEP_DAYS, 12)).toISOString());
  });
  test("al borrar el audio se va lo que se dijo; quedan los números", () => {
    const a = analyzeWords([{ word: "la", start: 0, dur: 150 }, { word: "la", start: 200, dur: 150 }, { word: "pelota", start: 400, dur: 400 }]);
    const s = stripAnalysis(a)!;
    expect(s.text).toBe("");
    expect(s.marks.every((m) => m.text === "")).toBe(true);
    expect([s.syllables, s.spm, s.marks.length]).toEqual([a.syllables, a.spm, a.marks.length]);
    expect(stripAnalysis(null)).toBeNull();
  });
});

describe("quién reconoce la grabación (uno es respaldo del otro)", () => {
  const AZ = { AZURE_SPEECH_KEY_1: "a", AZURE_SPEECH_REGION: "brazilsouth" };
  const GQ = { GROQ_API_KEY: "g" };
  test("por defecto, Azure y después Groq", () => {
    expect(sttOrder({ ...AZ, ...GQ })).toEqual(["azure", "groq"]);
  });
  test("PORTAL_STT cambia el orden", () => {
    expect(sttOrder({ ...AZ, ...GQ, PORTAL_STT: "groq,azure" })).toEqual(["groq", "azure"]);
  });
  test("solo los que tienen claves", () => {
    expect(sttOrder(AZ)).toEqual(["azure"]);
    expect(sttOrder(GQ)).toEqual(["groq"]);
    expect(sttOrder({})).toEqual([]);
    expect(sttOrder({ ...GQ, PORTAL_STT: "nada" })).toEqual(["groq"]);
  });
});
