// Pruebas de "Mi información" (etapa C): revisión del texto, limpieza,
// secciones de un informe y textos base por diagnóstico.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  INFO_LIMITS, TRAMITE_CODES, cleanText, fitText, lintText, lintTexts, professionalLabel, reportSections, verificationCode,
} from "../src/lib/portalInfoRules";
import { audienceFor, baseExplanation, hasBaseFor } from "../src/lib/diagnosisExplanations";

describe("lintText (avisos al profesional)", () => {
  test("marca frases que ponen el foco en la fluidez o en curar", () => {
    expect(lintText("Queremos que hable bien y sin trabarse")).toEqual(["hablar bien", "sin trabarse"]);
    expect(lintText("Buscamos más fluidez")).toEqual(["fluidez"]);
    expect(lintText("La tartamudez no se cura")).toEqual(["curar"]);
    expect(lintText("Que pueda hablar normal")).toEqual(["normal"]);
  });
  test("no marca un texto centrado en la comunicación", () => {
    expect(lintText("Trabajamos para que se anime a hablar en clase y disfrute comunicarse.")).toEqual([]);
    // Palabras que se parecen pero no son
    expect(lintText("Está en el curso de 3er grado y procura participar")).toEqual([]);
  });
  test("cada aviso aparece una sola vez", () => {
    expect(lintText("fluido, fluida, fluidez")).toEqual(["fluidez"]);
  });
});

describe("cleanText", () => {
  test("colapsa espacios y respeta los saltos de línea (máximo uno en blanco)", () => {
    expect(cleanText("  hola   mundo \r\n\r\n\r\n\r\nchau\t\tya  ", 100)).toBe("hola mundo\n\nchau ya");
  });
  test("corta en el límite y tolera valores raros", () => {
    expect(cleanText("x".repeat(2000), INFO_LIMITS.que_trabajamos)).toHaveLength(INFO_LIMITS.que_trabajamos);
    expect(cleanText(null, 10)).toBe("");
    expect(cleanText(undefined, 10)).toBe("");
    expect(cleanText(42, 10)).toBe("42");
  });
});

describe("reportSections", () => {
  test("versión para la familia: un solo bloque sin título", () => {
    expect(reportSections({ mode: "familia", report_date: "2026-10-01", text: "Vamos muy bien" }))
      .toEqual([{ label: "", text: "Vamos muy bien" }]);
  });
  test("tal cual: solo las secciones elegidas y con texto", () => {
    expect(reportSections({ mode: "tal_cual", report_date: "2026-10-01", progress: "P", therapy_evolution: null }))
      .toEqual([{ label: "Progreso", text: "P" }]);
    expect(reportSections({ mode: "tal_cual", report_date: "2026-10-01", progress: "P", therapy_evolution: "E" }))
      .toHaveLength(2);
  });
});

describe("fitText, lintTexts y professionalLabel", () => {
  test("fitText no corta: si pasa el límite devuelve el error", () => {
    expect(fitText("  hola  ", 10, "El texto")).toEqual({ text: "hola", error: null });
    const long = fitText("x".repeat(11), 10, "El texto");
    expect(long.text).toHaveLength(11);
    expect(long.error).toBe("El texto es muy largo: el máximo es 10 caracteres.");
  });
  test("lintTexts revisa el texto limpio (como el servidor)", () => {
    expect(lintText("ya habla  bien")).toEqual([]); // sin limpiar no se ve
    expect(lintTexts(["ya habla  bien", "sin\ttrabarse", "nada"])).toEqual(["hablar bien", "sin trabarse"]);
  });
  test("professionalLabel: nombre y especialidad", () => {
    expect(professionalLabel({ name: "Lic. Ana Torres", specialty: "Fonoaudiología" })).toBe("Lic. Ana Torres (Fonoaudiología)");
    expect(professionalLabel({ name: "Lic. Ana Torres", specialty: null })).toBe("Lic. Ana Torres");
    expect(professionalLabel(null)).toBeNull();
  });
});

describe("verificationCode", () => {
  test("10 dígitos en dos grupos, siempre igual para el mismo id", () => {
    const id = "3f2c9a1e-7b44-4c1d-9e0a-5d6f7a8b9c0d";
    expect(verificationCode(id)).toMatch(/^\d{5} \d{5}$/);
    expect(verificationCode(id)).toBe(verificationCode(id));
    expect(verificationCode(id)).not.toBe(verificationCode("00000000-0000-4000-8000-000000000001"));
    expect(verificationCode("00000000-0000-4000-8000-000000000001")).toBe("00000 00000");
  });
});

describe("textos base por diagnóstico", () => {
  test("público según la edad", () => {
    expect(audienceFor(null)).toBe("infancia");
    expect(audienceFor(7)).toBe("infancia");
    expect(audienceFor(12)).toBe("infancia");
    expect(audienceFor(13)).toBe("adolescencia");
    expect(audienceFor(17)).toBe("adolescencia");
    expect(audienceFor(18)).toBe("adultez");
  });
  test("pone el nombre y no deja marcas sin reemplazar", () => {
    const t = baseExplanation("F98.5", "infancia", "Juana")!;
    expect(t).toContain("Juana");
    expect(t).not.toContain("{nombre}");
  });
  test("sin diagnóstico: texto de evaluación; código desconocido: nada", () => {
    expect(baseExplanation(null, "adultez", "Ana")).toContain("evaluación");
    expect(baseExplanation("F80.0", "infancia", "Ana")).toBeNull();
    expect(hasBaseFor(null)).toBe(true);
    expect(hasBaseFor("F98.6")).toBe(true);
    expect(hasBaseFor("F80.0")).toBe(false);
  });
  test("los textos base no disparan los avisos de fluidez", () => {
    for (const code of [...Object.keys(TRAMITE_CODES), null]) {
      for (const a of ["infancia", "adolescencia", "adultez"] as const) {
        expect(lintText(baseExplanation(code, a, "Ana")!)).toEqual([]);
      }
    }
  });
});
