// «Escuchar» con la voz de Azure (server/lib/voice.ts): lo que comparten el
// servidor, el portal y las pruebas. Puro y sin alias de imports.

export const VOICE_LIMITS = {
  texts: 30, // textos por pedido de firmas
  chars: 400, // un paso, un verso o una frase: más largo, voz del celular
} as const;

/** El texto como se lee y se firma (espacios juntos). null: vacío o demasiado largo */
export function cleanVoiceText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  return t && t.length <= VOICE_LIMITS.chars ? t : null;
}

export type VoiceUrlsDTO = { available: boolean; urls: (string | null)[] };
