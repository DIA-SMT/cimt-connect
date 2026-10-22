// Pruebas del WAV de «Me grabo» (src/lib/wavEncoder.ts).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { WAV_RATE, downsample, encodeWav, joinChunks, wavDurationMs } from "../src/lib/wavEncoder";

describe("el WAV de la grabación", () => {
  test("de 48 kHz a 16 kHz: un tercio de las muestras, promediadas", () => {
    const out = downsample(new Float32Array([0.3, 0.3, 0.3, -0.6, -0.6, -0.6]), 48_000);
    expect(out).toHaveLength(2);
    expect(Math.round(out[0] * 10) / 10).toBe(0.3);
    expect(Math.round(out[1] * 10) / 10).toBe(-0.6);
  });
  test("la cabecera y la duración", () => {
    const wav = encodeWav(new Float32Array(WAV_RATE)); // un segundo de silencio
    expect(wav.length).toBe(44 + WAV_RATE * 2);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(wavDurationMs(wav)).toBe(1000);
  });
  test("las muestras se recortan a ±1", () => {
    const wav = encodeWav(new Float32Array([2, -2]));
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
  test("lo que no es un WAV de este formato no se acepta", () => {
    expect(wavDurationMs(new Uint8Array(10))).toBeNull();
    const wav = encodeWav(new Float32Array(100));
    new DataView(wav.buffer).setUint32(24, 44_100, true); // otra frecuencia
    expect(wavDurationMs(wav)).toBeNull();
  });
  test("junta los pedazos en orden", () => {
    expect([...joinChunks([new Float32Array([1, 2]), new Float32Array([3])])]).toEqual([1, 2, 3]);
  });
});
