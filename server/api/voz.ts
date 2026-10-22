import { defineEventHandler, getQuery, setResponseStatus } from "nitro/h3";
import { cleanVoiceText } from "../../src/lib/voiceRules";
import { azureConfig, synthesize, verifyVoice } from "../lib/voice";

// GET /api/voz?v=…&t=…&s=… → el MP3 del texto con la voz de Azure
// (server/lib/voice.ts). Solo textos firmados por POST /api/portal/voz. El
// audio queda en la caché de Vercel (s-maxage) y del celular un año: cada
// texto se genera una sola vez. Los errores no se guardan en la caché.
export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const text = cleanVoiceText(q.t);
  const sig = typeof q.s === "string" ? q.s : "";
  const pepper = process.env.PORTAL_CODE_PEPPER;
  const cfg = azureConfig(process.env);
  // Los errores, sin caché (el audio, en cambio, se guarda un año)
  const fail = (status: number, error: string) => {
    event.res.headers.set("Cache-Control", "no-store");
    setResponseStatus(event, status);
    return { error };
  };
  if (!pepper || !cfg) return fail(503, "La voz no está disponible.");
  if (!text || !verifyVoice(pepper, text, sig)) return fail(403, "Pedido inválido");
  try {
    const audio = await synthesize(text, cfg);
    if (audio.byteLength < 1_000) throw new Error("audio vacío");
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (e) {
    // Sin el texto en el log
    console.error("[voz] Azure:", e instanceof Error ? e.message.slice(0, 80) : "error");
    return fail(503, "La voz no está disponible.");
  }
});
