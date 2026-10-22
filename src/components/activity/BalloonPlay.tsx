import { useEffect, useRef, useState } from "react";
import { Check, Mic, MicOff, RotateCcw } from "lucide-react";
import type { BalloonSpec } from "@/lib/activitySpec";
import { onsetMessage, onsetOf } from "@/lib/speechGames";
import { pictureFor } from "@/lib/wordPictures";
import { focusRing } from "@/components/portal/practiceFormat";
import { pillOutline, pillPrimary } from "@/components/portal/styles";
import type { MechanicProps } from "@/components/activity/types";
import { useVoiceMeter } from "@/components/activity/useVoiceMeter";

// El globo de la voz suave: una palabra por paso. Con el micrófono (solo en
// este celular, sin grabar), el globo sube con la voz y, al terminar cada
// intento, se ve cómo arrancó: si subió despacito, fue un arranque suave.
// Siempre se felicita el intento. Sin micrófono (o sin permiso) se juega
// igual: dicen la palabra y tocan «Ya la dijimos». Si la palabra tiene
// dibujo (src/lib/wordPictures.ts), el globo lo lleva.

export function BalloonPlay({ spec, state, dispatch, big, ink, together }: MechanicProps<BalloonSpec>) {
  const said = together ? "Ya la dijimos" : "Ya la dije";
  const word = spec.palabras[state.step];
  const [feedback, setFeedback] = useState<string | null>(null);
  const [curve, setCurve] = useState<number[] | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const meter = useVoiceMeter((levels) => {
    const onset = onsetOf(levels);
    if (!onset) return; // un ruido, no una palabra
    setFeedback(onsetMessage(onset, together));
    setCurve(levels.slice(0, 50));
    dispatch({ type: "COMPLETAR" });
  });

  // Palabra nueva: sin el mensaje ni la curva de la anterior
  useEffect(() => {
    setFeedback(null);
    setCurve(null);
  }, [state.step]);

  const done = !!state.done[state.step];
  // «Ya la dije» desaparece al tocarlo: el foco va al mensaje
  function saidIt() {
    setFeedback("¡Listo!");
    dispatch({ type: "COMPLETAR" });
    requestAnimationFrame(() => feedbackRef.current?.focus());
  }
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className={`break-words font-display font-bold text-[color:var(--primary-deep)] ${big ? "text-5xl" : "text-4xl"}`}>{word}</p>
      <Balloon level={meter.level} ink={ink} picture={pictureFor(word)} />
      <p ref={feedbackRef} tabIndex={-1} aria-live="polite" className="min-h-7 text-lg font-semibold outline-none">{feedback ?? ""}</p>
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
          <p className="text-base">
            {together ? `Digan «${word}» arrancando suave, como si soplaran apenas.` : `Decí «${word}» arrancando suave, como si soplaras apenas.`}
          </p>
          <button type="button" onClick={meter.stop} className={`${pillOutline} ${focusRing} gap-2`}>
            <MicOff className="h-5 w-5" aria-hidden="true" /> Apagar el micrófono
          </button>
        </>
      )}
      {(meter.status === "sin_permiso" || meter.status === "sin_microfono" || meter.status === "ocupado") && (
        <>
          <p className="text-base text-muted-foreground">
            {meter.status === "sin_permiso" ? "El micrófono no tiene permiso."
              : meter.status === "ocupado" ? "El micrófono está ocupado (por ejemplo, en una llamada)." : "Acá no se puede usar el micrófono."}{" "}
            {together ? `Pueden jugar igual: digan la palabra y toquen «${said}».` : `Podés jugar igual: decí la palabra y tocá «${said}».`}
          </p>
          {meter.status !== "sin_microfono" && (
            <button type="button" onClick={meter.start} className={`${pillOutline} ${focusRing} gap-2`}>
              <RotateCcw className="h-5 w-5" aria-hidden="true" /> Probar el micrófono de nuevo
            </button>
          )}
        </>
      )}
      {!done && (
        <button type="button" onClick={saidIt} className={`${pillOutline} ${focusRing} gap-2`}>
          <Check className="h-5 w-5" aria-hidden="true" /> {said}
        </button>
      )}
    </div>
  );
}

// El globo sube con la voz (level de 0 a 1), con el dibujo de la palabra
// adentro. El hilo queda abajo, en la mano
function Balloon({ level, ink, picture }: { level: number; ink: string; picture: string | null }) {
  const cy = 120 - level * 85;
  return (
    <svg viewBox="0 0 120 190" className={`h-56 w-36 ${ink}`} aria-hidden="true">
      <path d={`M60 ${cy + 38} Q 52 ${(cy + 38 + 182) / 2} 60 182`} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.6" />
      <ellipse cx="60" cy={cy} rx="34" ry="38" fill="currentColor" opacity="0.85" />
      <path d={`M55 ${cy + 37} L65 ${cy + 37} L60 ${cy + 44} Z`} fill="currentColor" />
      {picture
        ? <text x="60" y={cy + 14} textAnchor="middle" fontSize="40">{picture}</text>
        : <ellipse cx="50" cy={cy - 12} rx="7" ry="10" fill="white" opacity="0.45" />}
    </svg>
  );
}

// «Así arrancó la voz»: la montañita de la voz al empezar. Si sube despacito,
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
      <figcaption className="text-sm text-muted-foreground">Así arrancó la voz</figcaption>
    </figure>
  );
}
