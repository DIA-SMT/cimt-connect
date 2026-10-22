// «Me grabo»: el audio de la grabación en WAV, mono, 16 kHz, 16 bits: lo que
// Azure reconoce directo, igual en Android y en iPhone (MediaRecorder graba
// en formatos distintos según el celular). Un minuto pesa unos 1,9 MB.
// Puro y sin alias de imports: lo usan el portal y las pruebas.

export const WAV_RATE = 16_000;
export const MAX_RECORDING_SECONDS = 60; // Azure reconoce hasta 60 s de una vez

/** Baja la frecuencia de muestreo promediando (del micrófono, 44,1 o 48 kHz, a 16 kHz) */
export function downsample(input: Float32Array, fromRate: number, toRate = WAV_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j];
    out[i] = to > from ? sum / (to - from) : 0;
  }
  return out;
}

/** WAV PCM de 16 bits, mono */
export function encodeWav(samples: Float32Array, rate = WAV_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // tamaño del bloque fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes por segundo
  view.setUint16(32, 2, true); // bytes por muestra
  view.setUint16(34, 16, true); // bits
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Junta los pedazos que fue dando el micrófono */
export function joinChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Lo que dura un WAV de este formato, en ms (para revisar lo que llega al servidor). null: no es un WAV así */
export function wavDurationMs(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data") return null;
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== WAV_RATE || view.getUint16(34, true) !== 16) return null;
  const data = Math.min(view.getUint32(40, true), bytes.length - 44);
  return Math.round((data / 2 / WAV_RATE) * 1000);
}
