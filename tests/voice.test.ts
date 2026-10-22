// Pruebas de la voz de Azure del «Escuchar» (server/lib/voice.ts y
// src/lib/voiceRules.ts). No llaman a Azure: solo la firma, el SSML y las reglas.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  AZURE_DEFAULT_VOICE, VOICE_VERSION, azureConfig, signVoice, verifyVoice, voiceSsml, voiceUrl,
} from "../server/lib/voice";
import { VOICE_LIMITS, cleanVoiceText } from "../src/lib/voiceRules";

const PEPPER = "una-sal-de-prueba-bastante-larga-para-las-firmas";

describe("la firma de los textos", () => {
  test("solo vale para el mismo texto y la misma sal", () => {
    const sig = signVoice(PEPPER, "Decí la palabra suave.");
    expect(sig).toMatch(/^[0-9a-f]{32}$/);
    expect(verifyVoice(PEPPER, "Decí la palabra suave.", sig)).toBe(true);
    expect(verifyVoice(PEPPER, "Decí la palabra fuerte.", sig)).toBe(false);
    expect(verifyVoice("otra-sal", "Decí la palabra suave.", sig)).toBe(false);
    expect(verifyVoice(PEPPER, "Decí la palabra suave.", sig.slice(0, 10))).toBe(false);
  });
  test("la URL lleva la versión, el texto y su firma", () => {
    const url = voiceUrl(PEPPER, "¿Cómo te fue?");
    const q = new URL(url, "http://x").searchParams;
    expect(url.startsWith("/api/voz?")).toBe(true);
    expect(q.get("v")).toBe(VOICE_VERSION);
    expect(q.get("t")).toBe("¿Cómo te fue?");
    expect(verifyVoice(PEPPER, q.get("t")!, q.get("s")!)).toBe(true);
  });
});

describe("Azure", () => {
  test("sin claves o sin región, no hay voz de Azure", () => {
    expect(azureConfig({})).toBeNull();
    expect(azureConfig({ AZURE_SPEECH_KEY: "k" })).toBeNull();
    expect(azureConfig({ AZURE_SPEECH_REGION: "brazilsouth" })).toBeNull();
  });
  test("acepta las dos claves del recurso, sin repetir, y la voz por defecto", () => {
    expect(azureConfig({ AZURE_SPEECH_KEY_1: "a", AZURE_SPEECH_KEY_2: "b", AZURE_SPEECH_KEY: "a", AZURE_SPEECH_REGION: " BrazilSouth " }))
      .toEqual({ keys: ["a", "b"], region: "brazilsouth", voice: AZURE_DEFAULT_VOICE });
  });
  test("el texto va escapado en el SSML", () => {
    const ssml = voiceSsml(`Tom & "Jerry" <hola>`, AZURE_DEFAULT_VOICE, "-8%");
    expect(ssml).toContain("Tom &amp; &quot;Jerry&quot; &lt;hola&gt;");
    expect(ssml).toContain(`<voice name="${AZURE_DEFAULT_VOICE}">`);
    expect(ssml).toContain(`<prosody rate="-8%">`);
  });
});

describe("qué textos se pueden escuchar", () => {
  test("se limpian los espacios; vacíos o muy largos, no", () => {
    expect(cleanVoiceText("  Paso  1:\n decí  hola ")).toBe("Paso 1: decí hola");
    expect(cleanVoiceText("   ")).toBeNull();
    expect(cleanVoiceText(42)).toBeNull();
    expect(cleanVoiceText("a".repeat(VOICE_LIMITS.chars + 1))).toBeNull();
    expect(cleanVoiceText("a".repeat(VOICE_LIMITS.chars))).not.toBeNull();
  });
});
