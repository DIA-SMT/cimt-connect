// Graba la voz del recorrido del sitio (src/lib/siteTour.ts) con la voz
// argentina de Azure que usan los podcasts de EnseñIA (es-AR-ElenaNeural).
// El recorrido es fijo: se graba una vez, los MP3 quedan en
// public/audio/recorrido y el sitio los sirve como archivos estáticos (no
// hay llamadas a Azure desde la web ni costo por visita).
//
// Correr con (Node 24):  npm run tour:audio
//   - lee AZURE_SPEECH_KEY (o AZURE_SPEECH_KEY_1 / _2) y AZURE_SPEECH_REGION
//     del .env o del entorno; AZURE_SPEECH_VOICE opcional;
//   - graba solo los pasos cuyo texto cambió (la clave del archivo sale del
//     texto, audioKey); --todo vuelve a grabar todos;
//   - borra los audios de textos viejos y reescribe src/lib/tourAudio.gen.ts,
//     la lista que usa el sitio para saber qué texto tiene audio.
// Son unos 1.000 caracteres: nada al lado del cupo gratis de Azure (500.000
// por mes).

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SITE_TOUR, audioKey, spokenText } from "../src/lib/siteTour.ts";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "public", "audio", "recorrido");
const LIST = join(ROOT, "src", "lib", "tourAudio.gen.ts");
const VOICE = process.env.AZURE_SPEECH_VOICE?.trim() || "es-AR-ElenaNeural";
// Mono a 48 kbps, como los podcasts: unos 30 KB por paso
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
// Algo más pausada que los podcasts (-6 %): el recorrido es en lectura fácil
const RATE = "-10%";

const keys = [...new Set(["AZURE_SPEECH_KEY", "AZURE_SPEECH_KEY_1", "AZURE_SPEECH_KEY_2"]
  .map((n) => process.env[n]?.trim())
  .filter((k): k is string => Boolean(k)))];
const region = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase();
const all = process.argv.includes("--todo");

const xml = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

async function record(text: string): Promise<Uint8Array> {
  const ssml = `<speak version="1.0" xml:lang="es-AR"><voice name="${VOICE}"><prosody rate="${RATE}">${xml(text)}</prosody></voice></speak>`;
  let last = "";
  // Azure da dos claves por recurso: si rechaza una (rotada), se prueba la otra
  for (const key of keys) {
    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": FORMAT,
        "User-Agent": "cimt-recorrido",
      },
      body: ssml,
    });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    last = `Azure ${res.status}: ${(await res.text().catch(() => "")).slice(0, 150)}`;
    if (res.status !== 401 && res.status !== 403) break;
  }
  throw new Error(last);
}

const steps = SITE_TOUR.map((s, i) => {
  const text = spokenText(s, i, SITE_TOUR.length);
  const key = audioKey(text);
  return { text, key, file: `${s.id}-${key}.mp3` };
});

mkdirSync(DIR, { recursive: true });
const pending = steps.filter((s) => all || !existsSync(join(DIR, s.file)));
if (pending.length && (!keys.length || !region)) {
  console.error("Faltan AZURE_SPEECH_KEY y AZURE_SPEECH_REGION (en el .env o en el entorno).");
  process.exit(1);
}
for (const s of pending) {
  const audio = await record(s.text);
  if (audio.byteLength < 2_000) throw new Error(`El audio de ${s.file} salió vacío.`);
  writeFileSync(join(DIR, s.file), audio);
  console.log(`grabado  ${s.file}  «${s.text}»`);
}

for (const f of readdirSync(DIR)) {
  if (f.endsWith(".mp3") && !steps.some((s) => s.file === f)) {
    rmSync(join(DIR, f));
    console.log(`borrado  ${f} (texto viejo)`);
  }
}

const entries = steps.map((s) => `  "${s.key}": "${s.file}",`).join("\n");
writeFileSync(LIST, `// Generado por scripts/tour-audio.ts (npm run tour:audio): no editar a mano.
// Audios grabados del recorrido (public/audio/recorrido), por clave del texto
// que se lee (audioKey en src/lib/siteTour.ts).
export const RECORDED: Record<string, string> = {
${entries}
};
`);
console.log(`${pending.length} grabados, ${steps.length - pending.length} ya estaban.`);
