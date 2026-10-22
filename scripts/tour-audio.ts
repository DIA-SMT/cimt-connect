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
import { azureConfig, synthesize } from "../server/lib/voice.ts";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "public", "audio", "recorrido");
const LIST = join(ROOT, "src", "lib", "tourAudio.gen.ts");
// Algo más pausada que el «Escuchar» del portal (-8 %): el recorrido es en lectura fácil
const RATE = "-10%";
// La misma voz y las mismas claves que el portal (server/lib/voice.ts)
const azure = azureConfig(process.env);
const all = process.argv.includes("--todo");

const record = (text: string) => synthesize(text, azure!, RATE);

const steps = SITE_TOUR.map((s, i) => {
  const text = spokenText(s, i, SITE_TOUR.length);
  const key = audioKey(text);
  return { text, key, file: `${s.id}-${key}.mp3` };
});

mkdirSync(DIR, { recursive: true });
const pending = steps.filter((s) => all || !existsSync(join(DIR, s.file)));
if (pending.length && !azure) {
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
