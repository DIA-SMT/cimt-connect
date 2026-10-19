// Pruebas de la guía paso a paso del panel (src/lib/panelGuide.ts).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PANEL_GUIDES, PANEL_WELCOME, type PanelStep, panelWelcomeKey, stepsFor } from "../src/lib/panelGuide";
import { longSentences } from "../src/lib/siteTour";
import type { StaffRole } from "../src/lib/staff";

function sources(dir: string): string {
  return readdirSync(dir, { withFileTypes: true }).map((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.tsx?$/.test(d.name) ? readFileSync(p, "utf8") : "";
  }).join("\n");
}
const SRC = sources(join(import.meta.dir, "..", "src"));
const ROLES: StaffRole[] = ["direccion", "profesional", "administracion"];
const ALL: [string, PanelStep[]][] = [["bienvenida", PANEL_WELCOME], ...Object.entries(PANEL_GUIDES)];

describe("textos claros", () => {
  test("frases de hasta 22 palabras e ids únicos en cada guía", () => {
    for (const [name, steps] of ALL) {
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      for (const s of steps) expect({ name, id: s.id, long: longSentences(`${s.title}. ${s.text}`, 22) }).toEqual({ name, id: s.id, long: [] });
    }
  });
});

describe("cada rol ve lo suyo", () => {
  test("todas las guías tienen pasos para cada rol, salvo Equipo (solo Dirección)", () => {
    for (const [name, steps] of ALL) {
      for (const role of ROLES) {
        const n = stepsFor(steps, role).length;
        if (name === "equipo" && role !== "direccion") expect(n).toBe(0);
        else expect({ name, role, some: n > 0 }).toEqual({ name, role, some: true });
      }
    }
  });
  test("derivar lo explica a Dirección; al resto le cuenta quién deriva", () => {
    const ids = (role: StaffRole) => stepsFor(PANEL_GUIDES.solicitudes, role).map((s) => s.id);
    expect(ids("direccion")).toContain("derivar");
    expect(ids("direccion")).not.toContain("derivada");
    expect(ids("administracion")).toContain("derivada");
    expect(ids("administracion")).not.toContain("derivar");
  });
  test("la bienvenida solo nombra Equipo para Dirección", () => {
    expect(stepsFor(PANEL_WELCOME, "profesional").map((s) => s.id)).not.toContain("equipo");
    expect(stepsFor(PANEL_WELCOME, "direccion").map((s) => s.id)).toContain("equipo");
  });
});

describe("cada paso resalta un lugar que existe", () => {
  test("los textos de botones y títulos están en el panel, y los data-tour también", () => {
    for (const [name, steps] of ALL) {
      for (const s of steps) {
        for (const t of s.targets ?? []) {
          if (typeof t === "string") {
            const m = /\[data-tour="([^"]+)"\]/.exec(t) ?? /aria-label="([^"]+)"/.exec(t);
            const needle = t.includes("data-tour") ? `data-tour="${m?.[1]}"` : `aria-label="${m?.[1]}"`;
            expect({ name, id: s.id, needle, found: SRC.includes(needle) }).toEqual({ name, id: s.id, needle, found: true });
          } else {
            expect({ name, id: s.id, text: t.text, found: SRC.includes(t.text) }).toEqual({ name, id: s.id, text: t.text, found: true });
          }
        }
      }
    }
  });
});

test("la bienvenida se recuerda por usuario (sin importar mayúsculas)", () => {
  expect(panelWelcomeKey(" Lina@SMT.gob.ar ")).toBe("cimt-panel-guia-vista:lina@smt.gob.ar");
});
