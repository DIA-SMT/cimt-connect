// Pruebas de la microevaluación de una grabación (src/lib/recordingAnalysis.ts).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { analysisSummary, analyzeWords, parseAzureDetailed, parseWhisperVerbose, percentSS } from "../src/lib/recordingAnalysis";

// Lo que devolvió Azure (es-AR, octubre 2026) para «Hoy fui a la plaza con mi
// mamá. [pausa] Jugamos a la pe pe pelota y después, eh, comimos un helado.»
const AZURE = {
  RecognitionStatus: "Success",
  NBest: [{
    Lexical: "hoy fui a la plaza con mi mam jugamos a la pc pelota y después e comimos un helado",
    Words: ([
      ["hoy", 0.21, 0.21], ["fui", 0.43, 0.25], ["a", 0.69, 0.05], ["la", 0.75, 0.11], ["plaza", 0.87, 0.31],
      ["con", 1.19, 0.18], ["mi", 1.38, 0.1], ["mam", 1.49, 0.28], ["jugamos", 4.42, 0.6], ["a", 5.03, 0.04],
      ["la", 5.08, 0.11], ["pc", 5.2, 0.26], ["pelota", 5.47, 0.36], ["y", 5.84, 0.05], ["después", 5.9, 0.47],
      ["e", 6.38, 0.41], ["comimos", 6.8, 0.51], ["un", 7.32, 0.07], ["helado", 7.4, 0.39],
    ] as const).map(([Word, s, d]) => ({ Word, Offset: Math.round(s * 1e7), Duration: Math.round(d * 1e7) })),
  }],
};

describe("lo que devuelve Azure", () => {
  test("las palabras con su tiempo en ms", () => {
    const words = parseAzureDetailed(AZURE)!;
    expect(words).toHaveLength(19);
    expect(words[0]).toEqual({ word: "hoy", start: 210, dur: 210 });
  });
  test("sin reconocer nada: null", () => {
    expect(parseAzureDetailed({ RecognitionStatus: "NoMatch" })).toBeNull();
    expect(parseAzureDetailed({ RecognitionStatus: "Success", NBest: [{ Words: [] }] })).toBeNull();
    expect(parseAzureDetailed(null)).toBeNull();
  });
});

describe("las marcas para que escuche el profesional", () => {
  const a = analyzeWords(parseAzureDetailed(AZURE)!);
  test("la pausa larga, la repetición y la muletilla, en orden", () => {
    expect(a.marks.map((m) => [m.kind, m.text])).toEqual([
      ["pausa", "2.6 s"],
      ["repeticion", "pc pelota"],
      ["muletilla", "e"],
    ]);
    expect(a.marks[0].at).toBe(1770); // donde termina «mam»
  });
  test("las cuentas: palabras, sílabas y velocidad", () => {
    expect(a.words).toBe(19);
    expect(a.speech_ms).toBe(7790 - 210);
    expect(a.spm).toBe(Math.round((a.syllables / a.speech_ms) * 60_000));
    expect(analysisSummary(a)).toContain("1 pausa larga");
    expect(analysisSummary(a)).toContain("1 posible repetición");
  });
  test("la misma palabra dos veces y una palabra muy estirada", () => {
    const m = analyzeWords([
      { word: "la", start: 0, dur: 150 }, { word: "la", start: 200, dur: 150 }, { word: "pelota", start: 400, dur: 400 },
      { word: "sol", start: 900, dur: 1200 },
    ]).marks;
    expect(m.map((x) => x.kind)).toEqual(["repeticion", "prolongacion"]);
  });
  test("las palabras cortas de siempre no son repeticiones", () => {
    const m = analyzeWords([
      { word: "con", start: 0, dur: 150 }, { word: "casa", start: 200, dur: 300 },
      { word: "un", start: 600, dur: 100 }, { word: "uno", start: 800, dur: 300 },
    ]).marks;
    expect(m).toEqual([]);
  });
  test("muy corto: sin velocidad", () => {
    expect(analyzeWords([{ word: "hola", start: 0, dur: 400 }]).spm).toBeNull();
  });
});

// Lo mismo, reconocido por Groq (Whisper, verbose_json; tiempos en segundos)
const GROQ = {
  text: "Hoy fui a la plaza con mi mam. Jugamos a la pepe pelota y después, eh, comimos un helado.",
  words: ([
    ["Hoy", 0.1, 0.32], ["fui", 0.32, 0.54], ["a", 0.54, 0.68], ["la", 0.68, 0.82], ["plaza", 0.82, 1.06], ["con", 1.06, 1.28],
    ["mi", 1.28, 1.5], ["mam.", 1.5, 1.66], ["Jugamos", 4.46, 4.9], ["a", 4.9, 5.04], ["la", 5.04, 5.22], ["pepe", 5.22, 5.36],
    ["pelota", 5.36, 5.7], ["y", 5.7, 5.82], ["después,", 5.82, 6.32], ["eh,", 6.32, 6.62], ["comimos", 6.62, 7.12], ["un", 7.12, 7.34],
    ["helado.", 7.34, 7.7],
  ] as const).map(([word, start, end]) => ({ word, start, end })),
};

describe("lo que devuelve Groq", () => {
  test("las mismas marcas: la pausa, «pepe pelota» y el «eh»", () => {
    const a = analyzeWords(parseWhisperVerbose(GROQ)!);
    expect(a.marks.map((m) => m.kind)).toEqual(["pausa", "repeticion", "muletilla"]);
    expect(a.marks[1].text).toBe("pepe pelota");
  });
  test("sin palabras: null", () => {
    expect(parseWhisperVerbose({ text: "" })).toBeNull();
  });
  test("«pe pelota» y la sílaba repetida, sí; una palabra que empieza igual, no", () => {
    const kinds = (a: string, b: string) => analyzeWords([{ word: a, start: 0, dur: 200 }, { word: b, start: 300, dur: 300 }]).marks.map((m) => m.kind);
    expect(kinds("pe", "pelota")).toEqual(["repeticion"]);
    expect(kinds("bobo", "bote")).toEqual(["repeticion"]);
    expect(kinds("para", "pared")).toEqual([]);
  });
});

describe("el %SS del profesional", () => {
  test("con un decimal y sin pasarse", () => {
    expect(percentSS(3, 100)).toBe(3);
    expect(percentSS(1, 3)).toBe(33.3);
    expect(percentSS(9, 5)).toBe(100);
    expect(percentSS(0, 0)).toBeNull();
    expect(percentSS(-1, 10)).toBeNull();
  });
});
