import { useEffect, useMemo, useRef, useState } from "react";
import { Play, RotateCcw, Square, Turtle } from "lucide-react";
import type { ReadingSpec } from "@/lib/activitySpec";
import { pacePhrase, wordAt } from "@/lib/speechGames";
import { picturesIn } from "@/lib/wordPictures";
import { focusRing } from "@/components/portal/practiceFormat";
import { pillOutline, pillPrimary } from "@/components/portal/styles";
import type { MechanicProps } from "@/components/activity/types";

// Leer con la tortuga: una frase por paso. Al tocar «Leer con la tortuga»,
// las palabras se iluminan al ritmo que eligió el profesional (sílabas por
// segundo, src/lib/speechGames.ts) y la tortuga camina debajo: se lee
// siguiéndola. Cuando llega al final, el paso queda hecho. Sin micrófono.
// Con «menos animaciones», la tortuga salta de palabra en palabra. Arriba,
// los dibujos de las palabras de la frase que tienen (src/lib/wordPictures.ts).

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ReadingPlay({ spec, state, dispatch, big, ink, together }: MechanicProps<ReadingSpec>) {
  const frase = spec.frases[state.step];
  const { words, total } = useMemo(() => pacePhrase(frase, spec.ritmo), [frase, spec.ritmo]);
  const [ms, setMs] = useState<number | null>(null); // null: la tortuga todavía no salió
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  // Frase nueva: la tortuga vuelve al principio
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    setMs(null);
  }, [state.step]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  function play() {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    setPlaying(true);
    setMs(0);
    const tick = (now: number) => {
      const t = now - t0;
      if (t >= total) {
        setMs(total);
        setPlaying(false);
        dispatch({ type: "COMPLETAR" });
        return;
      }
      setMs(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function stopTurtle() {
    cancelAnimationFrame(raf.current);
    setPlaying(false);
    setMs(null);
  }

  const at = ms === null ? -1 : wordAt(words, ms);
  const finished = ms !== null && ms >= total;
  // Dónde va la tortuga (0 a 1): con «menos animaciones», al principio de cada palabra
  const progress = ms === null || total === 0 ? 0
    : finished ? 1
      : reduced() ? (words[Math.max(0, at)]?.start ?? 0) / total : ms / total;

  const pictures = picturesIn(frase);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {pictures.length > 0 && <p aria-hidden="true" className="flex gap-3 text-5xl">{pictures.map((p) => <span key={p}>{p}</span>)}</p>}
      <p className={`flex flex-wrap justify-center gap-x-2 gap-y-1 leading-snug ${big ? "text-3xl" : "text-2xl"}`}>
        {words.map((w, i) => (
          <span key={i} className={`rounded-lg px-1 transition-colors motion-reduce:transition-none ${
            i === at ? "bg-amber-200 font-bold text-amber-950 dark:bg-amber-400" : i < at ? "font-semibold text-[color:var(--primary-deep)]" : "text-foreground/70"
          }`}>
            {w.text}
          </span>
        ))}
      </p>

      {/* El camino de la tortuga */}
      <div className="relative h-12 w-full" aria-hidden="true">
        <div className="absolute inset-x-4 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
        <div className="absolute left-4 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/50" style={{ width: `calc((100% - 2rem) * ${progress})` }} />
        <Turtle className={`absolute top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 ${ink}`} strokeWidth={1.75}
          style={{ left: `calc(1rem + (100% - 2rem) * ${progress})` }} />
      </div>

      <p aria-live="polite" className="min-h-7 text-lg font-semibold">{finished ? (together ? "¡Llegaron con la tortuga!" : "¡Llegaste con la tortuga!") : ""}</p>

      {playing ? (
        <button type="button" onClick={stopTurtle} className={`${pillOutline} ${focusRing} gap-2`}>
          <Square className="h-5 w-5" aria-hidden="true" /> Parar
        </button>
      ) : (
        <button type="button" onClick={play} className={`${finished ? pillOutline : pillPrimary} ${focusRing} gap-2`}>
          {finished ? <RotateCcw className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
          {finished ? "Otra vez" : "Leer con la tortuga"}
        </button>
      )}
      <p className="text-sm text-muted-foreground">Leé cada palabra cuando se ilumina, siguiendo a la tortuga.</p>
    </div>
  );
}
