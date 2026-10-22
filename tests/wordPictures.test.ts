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

describe("palabras que confunden", () => {
  test("la tilde y la ñ cambian la palabra", () => {
    expect(pictureFor("bebé")).toBe("👶");
    expect(pictureFor("bebés")).toBe("👶");
    expect(pictureFor("bebe")).toBeNull(); // del verbo beber
    expect(pictureFor("río")).toBe("🏞️");
    expect(pictureFor("ríos")).toBe("🏞️");
    expect(picturesIn("Se rió mucho")).toEqual([]);
    expect(pictureFor("araña")).toBe("🕷️");
    expect(pictureFor("moño")).toBeNull(); // no es «mono»
    expect(pictureFor("campaña")).toBeNull(); // no es «campana»
    expect(pictureFor("¡Montaña!")).toBe("⛰️");
  });
  test("las que suelen ser otra cosa no llevan dibujo", () => {
    expect(picturesIn("dado que llovía")).toEqual([]);
    expect(pictureFor("arco")).toBeNull();
    expect(picturesIn("el arco iris")).toEqual([]);
  });
  test("en una frase, con mayúscula y no al principio, es un nombre", () => {
    expect(picturesIn("Hoy jugué con Sol y con Pancho en la plaza")).toEqual([]);
    expect(picturesIn("Sol sale temprano")).toEqual(["☀️"]); // primera palabra: puede ser el sol
    expect(pictureFor("Luna")).toBe("🌙"); // sola, en el globo
    expect(picturesIn("Mirá la luna y el sol")).toEqual(["🌙", "☀️"]);
  });
});
