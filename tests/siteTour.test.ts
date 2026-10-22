// Pruebas del recorrido accesible del sitio público (src/lib/siteTour.ts).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  EASY_READ_MAX_WORDS, SITE_TOUR, TEXT_SIZES, audioKey, longSentences, nextTextSize, parseTextSize, spokenText,
} from "../src/lib/siteTour";
import { RECORDED } from "../src/lib/tourAudio.gen";

// Todo el código de src, para buscar los lugares que resalta el recorrido
function sources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true }).map((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.(tsx?|css)$/.test(d.name) ? readFileSync(p, "utf8") : "";
  }).join("\n");
}
const SRC = sources(join(import.meta.dir, "..", "src"));

describe("textos en lectura fácil", () => {
  test(`frases de hasta ${EASY_READ_MAX_WORDS} palabras`, () => {
    for (const s of SITE_TOUR) {
      expect({ id: s.id, long: longSentences(`${s.title}. ${s.text}`) }).toEqual({ id: s.id, long: [] });
    }
  });
  test("pasos con id único, título y texto cortos", () => {
    expect(new Set(SITE_TOUR.map((s) => s.id)).size).toBe(SITE_TOUR.length);
    for (const s of SITE_TOUR) {
      expect(s.title.length).toBeLessThanOrEqual(30);
      expect(s.text.length).toBeLessThanOrEqual(160);
    }
  });
  test("detecta frases largas", () => {
    expect(longSentences("Una frase corta. " + "palabra ".repeat(20).trim() + ".")).toHaveLength(1);
  });
});

describe("cada paso resalta un lugar que existe", () => {
  test("los data-tour del recorrido están en el código", () => {
    for (const s of SITE_TOUR) {
      for (const sel of s.targets ?? []) {
        if (typeof sel !== "string") continue;
        const m = /\[data-tour="([^"]+)"\]/.exec(sel);
        if (m) expect({ sel, found: SRC.includes(`data-tour="${m[1]}"`) || SRC.includes(`"${m[1]}" :`) }).toEqual({ sel, found: true });
        else if (sel.startsWith("#")) expect({ sel, found: SRC.includes(`id="${sel.slice(1)}"`) }).toEqual({ sel, found: true });
      }
    }
  });
  test("el primero y el último no dependen de nada (empieza y termina igual en cualquier pantalla)", () => {
    expect(SITE_TOUR[0].targets).toBeUndefined();
    expect(SITE_TOUR[SITE_TOUR.length - 1].targets?.length).toBeGreaterThan(1);
  });
});

describe("letra y voz", () => {
  test("el tamaño de letra sube y baja sin pasarse", () => {
    expect(nextTextSize(100, 1)).toBe(115);
    expect(nextTextSize(130, 1)).toBe(130);
    expect(nextTextSize(100, -1)).toBe(100);
    expect(nextTextSize(999, 1)).toBe(115); // un valor raro arranca de 100
  });
  test("lo guardado se lee solo si es un tamaño válido", () => {
    expect(parseTextSize("115")).toBe(115);
    expect(parseTextSize("200")).toBe(100);
    expect(parseTextSize(null)).toBe(100);
    expect(TEXT_SIZES[0]).toBe(100);
  });
  test("lo que se lee en voz alta dice en qué paso está", () => {
    expect(spokenText(SITE_TOUR[1], 1, SITE_TOUR.length)).toBe(`Paso 2 de ${SITE_TOUR.length}. ${SITE_TOUR[1].title}. ${SITE_TOUR[1].text}`);
  });
});

describe("voz grabada", () => {
  const DIR = join(import.meta.dir, "..", "public", "audio", "recorrido");
  test("la clave del audio cambia si cambia el texto", () => {
    expect(audioKey("Paso 1 de 8. Hola.")).toBe(audioKey("Paso 1 de 8. Hola."));
    expect(audioKey("Paso 1 de 8. Hola.")).not.toBe(audioKey("Paso 1 de 8. Hola"));
    expect(audioKey("¡Listo!")).toMatch(/^[0-9a-f]{8}$/);
  });
  test("cada paso tiene su audio y está al día (si no: npm run tour:audio)", () => {
    for (const [i, s] of SITE_TOUR.entries()) {
      const file = RECORDED[audioKey(spokenText(s, i, SITE_TOUR.length))];
      expect({ id: s.id, ok: !!file && existsSync(join(DIR, file)) }).toEqual({ id: s.id, ok: true });
    }
  });
  test("no quedan audios de textos viejos", () => {
    const listed = new Set(Object.values(RECORDED));
    for (const f of readdirSync(DIR)) expect({ f, listed: listed.has(f) }).toEqual({ f, listed: true });
  });
});
