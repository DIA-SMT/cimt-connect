// Pruebas de los dibujos de las palabras (src/lib/wordPictures.ts).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { pictureFor, picturesIn } from "../src/lib/wordPictures";

describe("el dibujo de cada palabra", () => {
  test("las palabras de la demo del globo tienen dibujo", () => {
    expect(["árbol", "oso", "uva", "elefante", "isla"].map(pictureFor)).toEqual(["🌳", "🐻", "🍇", "🐘", "🏝️"]);
  });
  test("plurales, mayúsculas, signos y sin tilde", () => {
    expect(pictureFor("Uvas")).toBe("🍇");
    expect(pictureFor("flores,")).toBe("🌸");
    expect(pictureFor("peces")).toBe("🐟");
    expect(pictureFor("arboles")).toBe("🌳");
    expect(pictureFor("¡Montaña!")).toBe("⛰️");
  });
  test("la tilde que cambia el sentido", () => {
    expect(pictureFor("papá")).toBe("👨");
    expect(pictureFor("papa")).toBe("🥔");
  });
  test("sin dibujo: null", () => {
    expect(pictureFor("despacito")).toBeNull();
    expect(pictureFor("es")).toBeNull();
    expect(pictureFor("")).toBeNull();
  });
  test("en una frase: en orden, sin repetir y hasta tres", () => {
    expect(picturesIn("La tortuga camina despacito por el campo.")).toEqual(["🐢", "🌾"]);
    expect(picturesIn("sol, sol y más sol")).toEqual(["☀️"]);
    expect(picturesIn("gato perro pez pájaro")).toHaveLength(3);
  });
});
