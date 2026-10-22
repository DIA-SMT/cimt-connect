import { useEffect, useState } from "react";
import { Check, Mic, MicOff } from "lucide-react";
import type { BalloonSpec } from "@/lib/activitySpec";
import { onsetMessage, onsetOf } from "@/lib/speechGames";
import { focusRing } from "@/components/portal/practiceFormat";
import { pillOutline, pillPrimary } from "@/components/portal/styles";
import type { MechanicProps } from "@/components/activity/types";
import { useVoiceMeter } from "@/components/activity/useVoiceMeter";

// El globo de la voz suave: una palabra por paso. Con el micrófono (solo en
// este celular, sin grabar), el globo sube con la voz y, al terminar cada
// intento, se ve cómo arrancó: si subió despacito, fue un arranque suave.
// Siempre se felicita el intento. Sin micrófono (o sin permiso) se juega
// igual: dicen la palabra y tocan «Ya la dijimos».

export function BalloonPlay({ spec, state, dispatch, big, ink }: MechanicProps<BalloonSpec>) {
  const word = spec.palabras[state.step];
  const [feedback, setFeedback] = useState<string | null>(null);
  const [curve, setCurve] = useState<number[] | null>(null);
  const meter = useVoiceMeter((levels) => {
    const onset = onsetOf(levels);
    if (!onset) return; // un ruido, no una palabra
    setFeedback(onsetMessage(onset));
    setCurve(levels.slice(0, 50));
    dispatch({ type: "COMPLETAR" });
  });

  // Palabra nueva: sin el mensaje ni la curva de la anterior
  useEffect(() => {
    setFeedback(null);
    setCurve(null);
  }, [state.step]);

  const done = !!state.done[state.step];
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className={`break-words font-display font-bold text-[color:var(--primary-deep)] ${big ? "text-5xl" : "text-4xl"}`}>{word}</p>
      <Balloon level={meter.level} ink={ink} />
      <p aria-live="polite" className="min-h-7 text-lg font-semibold">{feedback ?? ""}</p>
      {curve && <OnsetCurve levels={curve} />}

      {meter.status === "apagado" && (
        <>
          <button type="button" onClick={meter.start} className={`${pillPrimary} ${focusRing} gap-2`}>
            <Mic className="h-5 w-5" aria-hidden="true" /> Usar el micrófono
          </button>
          <p className="text-sm text-muted-foreground">Se usa solo en este celular: no se graba ni se manda nada.</p>
        </>
      )}
      {meter.status === "pidiendo" && <p role="status" className="text-base text-muted-foreground">Esperando el permiso del micrófono…</p>}
      {meter.status === "escuchando" && (
        <>
          <p className="text-base">Decí «{word}» arrancando suave, como si soplaras apenas.</p>
          <button type="button" onClick={meter.stop} className={`${pillOutline} ${focusRing} gap-2`}>
            <MicOff className="h-5 w-5" aria-hidden="true" /> Apagar el micrófono
          </button>
        </>
      )}
      {(meter.status === "sin_permiso" || meter.status === "sin_microfono") && (
        <p className="text-base text-muted-foreground">
          {meter.status === "sin_permiso" ? "El micrófono no tiene permiso." : "Acá no se puede usar el micrófono."} Pueden jugar igual: digan la palabra y toquen «Ya la dijimos».
        </p>
      )}
      {!done && (
        <button type="button" onClick={() => dispatch({ type: "COMPLETAR" })} className={`${pillOutline} ${focusRing} gap-2`}>
          <Check className="h-5 w-5" aria-hidden="true" /> Ya la dijimos
        </button>
      )}
    </div>
  );
}

// El globo sube con la voz (level de 0 a 1). El hilo queda abajo, en la mano
function Balloon({ level, ink }: { level: number; ink: string }) {
  const cy = 120 - level * 85;
  return (
    <svg viewBox="0 0 120 190" className={`h-44 w-28 ${ink}`} aria-hidden="true">
      <path d={`M60 ${cy + 34} Q 52 ${(cy + 34 + 182) / 2} 60 182`} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.6" />
      <ellipse cx="60" cy={cy} rx="30" ry="34" fill="currentColor" opacity="0.85" />
      <path d={`M55 ${cy + 33} L65 ${cy + 33} L60 ${cy + 40} Z`} fill="currentColor" />
      <ellipse cx="50" cy={cy - 12} rx="7" ry="10" fill="white" opacity="0.45" />
    </svg>
  );
}

// «Así arrancó tu voz»: la montañita de la voz al empezar. Si sube despacito,
// fue un arranque suave
function OnsetCurve({ levels }: { levels: number[] }) {
  const max = Math.max(...levels, 1e-6);
  const w = 200;
  const h = 48;
  const points = levels.map((l, i) => `${(i / Math.max(1, levels.length - 1)) * w},${h - (l / max) * (h - 4)}`).join(" ");
  return (
    <figure className="flex flex-col items-center gap-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-52 text-primary" aria-hidden="true">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="text-xs text-muted-foreground">Así arrancó tu voz</figcaption>
    </figure>
  );
}
