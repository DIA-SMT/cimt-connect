// Pruebas de la norma que se muestra junto a los permisos expresos
// (src/lib/legalBasis.ts). Correr con: bun test
import { describe, expect, test } from "bun:test";
import { CLINICAL_LEGAL_BASIS, RECORDING_LEGAL_BASIS } from "../src/lib/legalBasis";
import { RECORDING_KEEP_DAYS, RECORDING_NOTICE_POINTS } from "../src/lib/recordingRules";

const ALL = [CLINICAL_LEGAL_BASIS, RECORDING_LEGAL_BASIS];
const texts = (b: (typeof ALL)[number]) => [b.summary, b.laws, ...b.more.flatMap((p) => [p.ref, p.text])];

describe("la norma de los permisos", () => {
  test("cada punto cita una norma distinta (es la clave de la lista)", () => {
    for (const b of ALL) expect(new Set(b.more.map((p) => p.ref)).size).toBe(b.more.length);
  });
  test("la información de salud cita las dos leyes a la vista", () => {
    expect(CLINICAL_LEGAL_BASIS.laws).toContain("Ley 25.326");
    expect(CLINICAL_LEGAL_BASIS.laws).toContain("Ley 26.529");
  });
  test("las grabaciones dicen los mismos días que se guardan", () => {
    expect(RECORDING_LEGAL_BASIS.more.some((p) => p.text.includes(`${RECORDING_KEEP_DAYS} días`))).toBe(true);
  });
  test("las grabaciones avisan que se pueden procesar fuera del país, y citan el art. 12", () => {
    expect(RECORDING_NOTICE_POINTS.some((p) => p.includes("fuera de la Argentina"))).toBe(true);
    expect(RECORDING_LEGAL_BASIS.laws).toContain("12");
    expect(RECORDING_LEGAL_BASIS.more.some((p) => p.ref.includes("art. 12"))).toBe(true);
  });
  test("el aviso dice dónde se retira el permiso", () => {
    expect(RECORDING_NOTICE_POINTS.some((p) => p.includes("«Información de salud»"))).toBe(true);
  });
  test("sin servicios internos ni la conformidad del adolescente", () => {
    for (const t of [...ALL.flatMap(texts), ...RECORDING_NOTICE_POINTS]) {
      expect(t).not.toMatch(/azure|groq|openrouter|microsoft/i);
      expect(t).not.toMatch(/conformidad|13 años|adolescente/i);
    }
  });
});
