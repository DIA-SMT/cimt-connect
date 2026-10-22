// Pruebas de Migue en el Portal de familias (src/lib/portalHelp.ts).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  APPT_A_ASK, APPT_A_CALL, COPY_A_CHOOSE, COPY_A_HAND, MIGUE_QUESTIONS, REDACTED, REPORTS_A_CHOOSE, REPORTS_A_HAND,
  REPORTS_INFO, SIGNED_OUT, type HelpContext, portalMigueSystemPrompt, questionsFor, redactPersonal,
} from "../src/lib/portalHelp";
import { CENTER } from "../src/lib/center";

const IN: HelpContext = { ...SIGNED_OUT, signedIn: true };
const ids = (c: HelpContext, path = "/portal") => questionsFor(c, path).map((q) => q.id);
const answer = (id: string, c: HelpContext) => MIGUE_QUESTIONS.find((q) => q.id === id)!.a(c);

describe("lo que se escribe a mano: se borran los datos que identifican", () => {
  test("DNI, con y sin puntos", () => {
    expect(redactPersonal("Mi DNI es 30.111.222")).toBe(`Mi DNI es ${REDACTED}`);
    expect(redactPersonal("dni 30111222 gracias")).toBe(`dni ${REDACTED} gracias`);
  });
  test("teléfonos, CUIL, códigos de 10 números y correos", () => {
    expect(redactPersonal("llamame al 381 258-4491")).toBe(`llamame al ${REDACTED}`);
    expect(redactPersonal("cuil 20-30111222-3")).toBe(`cuil ${REDACTED}`);
    expect(redactPersonal("el código 24680 13579 no anda")).toBe(`el código ${REDACTED} no anda`);
    expect(redactPersonal("escribime a laura.gomez@gmail.com")).toBe(`escribime a ${REDACTED}`);
  });
  test("fechas, horas y números cortos quedan", () => {
    const text = "El turno del 21/10/2026 a las 17:30, somos 3";
    expect(redactPersonal(text)).toBe(text);
  });
});

describe("preguntas cerradas", () => {
  test("ids únicos", () => {
    expect(new Set(MIGUE_QUESTIONS.map((q) => q.id)).size).toBe(MIGUE_QUESTIONS.length);
  });
  test("sin sesión: solo las de entrar, y primero activar la cuenta", () => {
    const out = ids(SIGNED_OUT, "/portal/ingresar");
    expect(out[0]).toBe("activar");
    expect(out).toContain("contrasena");
    expect(out).not.toContain("aviso");
    expect(out).not.toContain("copia");
  });
  test("con sesión no se ofrece activar la cuenta, y en el inicio primero los turnos", () => {
    const home = ids(IN, "/portal");
    expect(home).not.toContain("activar");
    expect(home.slice(0, 3)).toEqual(["aviso", "cancela", "turno"]);
  });
  test("«/portal» es solo el inicio: en «Ayuda» no van primero las de turnos", () => {
    expect(ids(IN, "/portal/ayuda")[0]).toBe("aviso"); // orden de siempre
    expect(ids(IN, "/portal/informacion/c-1").slice(0, 2)).toEqual(["informes", "copia"]);
    expect(ids(IN, "/portal/")).toEqual(ids(IN, "/portal"));
  });
  test("las de las etapas, solo si la cuenta las tiene", () => {
    expect(ids(IN)).not.toContain("salud");
    expect(ids(IN)).not.toContain("medallas");
    expect(ids(IN)).not.toContain("sin-practicar");
    const full = ids({ ...IN, features: ["consent", "info", "practice"], hasPractice: true, hasExercises: true });
    expect(full).toContain("salud");
    expect(full).toContain("medallas");
    expect(full).toContain("sin-practicar");
  });
  test("las respuestas cambian según lo que tiene habilitado la cuenta (igual que «Ayuda»)", () => {
    expect(answer("turno", IN)).toBe(APPT_A_CALL);
    expect(answer("turno", { ...IN, canAskAppt: true })).toBe(APPT_A_ASK);
    expect(answer("informes", IN)).toBe(REPORTS_A_HAND);
    expect(answer("informes", { ...IN, features: ["consent", "hc_digital"] })).toBe(REPORTS_A_CHOOSE);
    expect(answer("informes", { ...IN, features: ["consent", "info"] })).toBe(REPORTS_INFO.a);
    expect(answer("copia", IN)).toBe(COPY_A_HAND);
    expect(answer("copia", { ...IN, features: ["consent", "hc_digital"] })).toBe(COPY_A_CHOOSE);
  });
  test("los botones llevan a pantallas que existen", () => {
    const routes = join(import.meta.dir, "..", "src", "routes");
    for (const q of MIGUE_QUESTIONS) {
      if (!q.link) continue;
      const file = q.link.to === "/portal" ? "portal.index.tsx" : `${q.link.to.slice(1).replace(/\//g, ".")}.tsx`;
      expect({ id: q.id, exists: existsSync(join(routes, file)) }).toEqual({ id: q.id, exists: true });
    }
  });
});

describe("lo que sabe la IA del portal", () => {
  const prompt = portalMigueSystemPrompt();
  test("tiene todas las preguntas cerradas y el teléfono del centro", () => {
    for (const q of MIGUE_QUESTIONS) expect(prompt).toContain(q.q);
    expect(prompt).toContain(CENTER.phoneDisplay);
  });
  test("las respuestas que dependen de la cuenta van con las dos versiones", () => {
    expect(prompt).toContain(APPT_A_ASK);
    expect(prompt).toContain(APPT_A_CALL);
  });
  test("sabe que lo borrado se borró a propósito y no pide datos", () => {
    expect(prompt).toContain(REDACTED);
    expect(prompt).toMatch(/Nunca pidas nombres, DNI/);
  });
});
