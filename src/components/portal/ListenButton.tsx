import { Square, Volume2 } from "lucide-react";
import { focusRing } from "@/components/portal/practiceFormat";
import { pillOutline } from "@/components/portal/styles";
import type { Speech } from "@/components/portal/useSpeech";

// "Escuchar" / "Detener" (se esconde si el aparato no tiene una voz en español)
export function ListenButton({ speech, texts, label = "Escuchar", className = "" }: {
  speech: Speech;
  texts: string[];
  label?: string;
  className?: string;
}) {
  if (!speech.available) return null;
  return (
    <button type="button" onClick={() => (speech.speaking ? speech.stop() : speech.speak(texts))}
      className={`${pillOutline} ${focusRing} gap-2 self-center ${className}`}>
      {speech.speaking ? <Square className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
      {speech.speaking ? "Detener" : label}
    </button>
  );
}
