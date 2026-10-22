// La voz de Azure (es-AR-ElenaNeural, la misma del recorrido del sitio y de
// los podcasts de EnseñIA) para el «Escuchar» del portal y del panel.
//
// Cómo viaja:
//   1. POST /api/portal/voz (familia o equipo con sesión) firma cada texto que
//      se ve en pantalla y devuelve su URL: /api/voz?v=…&t=…&s=…
//   2. GET /api/voz genera el audio con Azure solo si la firma es válida, y lo
//      deja en la caché de Vercel un año: cada texto se genera una sola vez.
// Así nadie puede usar la voz del centro para textos propios, y el cupo
// gratis de Azure (500.000 caracteres por mes) alcanza de sobra.
// Lo que va a Azure es el texto del ejercicio (lo escribe el equipo): nada de
// la familia. Los comentarios de «¿Cómo te fue?» nunca se leen en voz alta.
//
// Sin alias de imports: también lo usa scripts/tour-audio.ts (con Node).

import { createHmac, timingSafeEqual } from "node:crypto";

export const AZURE_DEFAULT_VOICE = "es-AR-ElenaNeural";
// Mono a 48 kbps, como los podcasts
export const AZURE_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// Un poco más pausada que lo normal: se entiende mejor
export const DEFAULT_RATE = "-8%";
// Cambia si cambia la voz o el ritmo: así no se sirve un audio viejo de la caché
export const VOICE_VERSION = "1";

export type AzureConfig = { keys: string[]; region: string; voice: string };

/** Las claves de Azure del entorno (las dos del recurso se aceptan). null: sin voz de Azure */
export function azureConfig(env: Record<string, string | undefined>): AzureConfig | null {
  const keys = [...new Set(["AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY_1", "AZURE_SPEECH_KEY_2"]
    .map((n) => env[n]?.trim())
    .filter((k): k is string => Boolean(k)))];
  const region = env.AZURE_SPEECH_REGION?.trim().toLowerCase();
  if (!keys.length || !region) return null;
  return { keys, region, voice: env.AZURE_SPEECH_VOICE?.trim() || AZURE_DEFAULT_VOICE };
}

const xml = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export const voiceSsml = (text: string, voice: string, rate: string) =>
  `<speak version="1.0" xml:lang="es-AR"><voice name="${voice}"><prosody rate="${rate}">${xml(text)}</prosody></voice></speak>`;

/** El MP3 de un texto. Si Azure rechaza una clave (rotada), prueba la otra */
export async function synthesize(text: string, cfg: AzureConfig, rate = DEFAULT_RATE): Promise<Uint8Array> {
  let last = "";
  for (const key of cfg.keys) {
    const res = await fetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": AZURE_FORMAT,
        "User-Agent": "cimt-voz",
      },
      body: voiceSsml(text, cfg.voice, rate),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    last = `Azure ${res.status}: ${(await res.text().catch(() => "")).slice(0, 150)}`;
    if (res.status !== 401 && res.status !== 403) break;
  }
  throw new Error(last);
}

// ── Firma de los textos ─────────────────────────────────────────────────────

const SIG_LEN = 32;

export function signVoice(pepper: string, text: string): string {
  return createHmac("sha256", pepper).update(`voz:${VOICE_VERSION}:${text}`).digest("hex").slice(0, SIG_LEN);
}

export function verifyVoice(pepper: string, text: string, sig: string): boolean {
  if (sig.length !== SIG_LEN) return false;
  const want = Buffer.from(signVoice(pepper, text));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const voiceUrl = (pepper: string, text: string) =>
  `/api/voz?v=${VOICE_VERSION}&t=${encodeURIComponent(text)}&s=${signVoice(pepper, text)}`;
