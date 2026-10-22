import { defineEventHandler, readBody } from "nitro/h3";
import { type VoiceUrlsDTO, VOICE_LIMITS, cleanVoiceText } from "../../../src/lib/voiceRules";
import { PortalError, handle, requireFamily, requireStaff, setup } from "../../lib/portal";
import { azureConfig, voiceUrl } from "../../lib/voice";

// POST /api/portal/voz { texts } → { available, urls } (server/lib/voice.ts)
// Firma los textos que se ven en pantalla para escucharlos con la voz de
// Azure. Solo con sesión: una familia (portal) o alguien del equipo (la
// vista previa del panel). urls[i] es null si el texto está vacío o es muy
// largo (ahí, la voz del celular). available: false sin las claves de Azure.
export default defineEventHandler((event) => handle(event, async (): Promise<VoiceUrlsDTO> => {
  const ctx = setup();
  try {
    await requireFamily(ctx, event);
  } catch (e) {
    if (!(e instanceof PortalError) || e.status !== 401) throw e;
    await requireStaff(ctx, event);
  }
  if (!azureConfig(process.env)) return { available: false, urls: [] };
  const body = (await readBody(event).catch(() => null)) as { texts?: unknown } | null;
  const texts = Array.isArray(body?.texts) ? body.texts.slice(0, VOICE_LIMITS.texts) : [];
  return {
    available: true,
    urls: texts.map((t) => {
      const text = cleanVoiceText(t);
      return text ? voiceUrl(ctx.pepper, text) : null;
    }),
  };
}));
