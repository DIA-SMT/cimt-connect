import { useEffect, useId, useState } from "react";
import { Check, Lightbulb } from "lucide-react";
import { BLANK, type RhymeSpec } from "@/lib/activitySpec";
import { rhymeOptions } from "@/lib/activityMechanics";
import { ICON_COMPONENT } from "@/components/activity/assets";
import { ListenButton } from "@/components/portal/ListenButton";
import { focusRing } from "@/components/portal/practiceFormat";
import { pillOutline } from "@/components/portal/styles";
import type { MechanicProps } from "@/components/activity/types";

// Completar la rima: un verso, otro con un hueco y de 2 a 4 palabras para
// elegir. Se busca la que suena igual al final; si la elegida no rima, se
// apaga sin marca roja ni sonido y aparece una pista. «Mostrame la que rima»
// la completa siempre: nadie se queda trabado en una tarjeta.

export function RhymePlay(props: MechanicProps<RhymeSpec>) {
  // Una tarjeta nueva empieza de cero (sin las opciones probadas de la anterior)
  return <RhymeCardPlay key={props.state.step} {...props} />;
}

function RhymeCardPlay({ spec, state, dispatch, speech, big, ink }: MechanicProps<RhymeSpec>) {
  const card = spec.tarjetas[state.step];
  const solved = !!state.done[state.step];
  const [tried, setTried] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const options = rhymeOptions(card, state.step);
  // La última palabra del primer verso, como está escrita («Simón», no «simón»)
  const target = card.verso.match(/\p{L}+/gu)?.pop() ?? "";
  const [before, after] = card.completar.split(BLANK);
  const Icon = card.icono ? ICON_COMPONENT[card.icono] : null;
  const hintId = useId();

  useEffect(() => {
    if (solved && !message) setMessage(`¡Rima! «${target}» y «${card.respuesta}».`);
  }, [solved, message, target, card.respuesta]);

  function choose(word: string) {
    if (solved || tried.includes(word)) return;
    speech.stop();
    if (word === card.respuesta) {
      setMessage(`¡Rima! «${target}» y «${word}».`);
      dispatch({ type: "COMPLETAR" });
      return;
    }
    setTried((t) => [...t, word]);
    setMessage(`«${word}» no suena igual que «${target}». Escuchen cómo termina «${target}» y prueben con otra.`);
  }

  function reveal() {
    speech.stop();
    setMessage(`La que rima es «${card.respuesta}»: «${target}» y «${card.respuesta}».`);
    dispatch({ type: "COMPLETAR" });
  }

  const fill = solved ? card.respuesta : "…";
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {Icon && <Icon className={`h-14 w-14 ${ink}`} aria-hidden="true" strokeWidth={1.75} />}
      <div className={`flex flex-col gap-1 leading-snug ${big ? "text-2xl" : "text-xl"}`}>
        <p className="break-words font-semibold">{card.verso}</p>
        <p className="break-words font-semibold">
          {before}
          <span className={`mx-1 inline-block min-w-16 rounded-xl border-b-4 px-2 ${solved ? "border-primary bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]" : "border-dashed border-primary/50"}`}>
            {fill}
          </span>
          {after}
        </p>
      </div>
      <ListenButton speech={speech} texts={[card.verso, `${before} … ${after}`]} label="Escuchar" />
      <div role="group" aria-label="¿Qué palabra rima?" aria-describedby={hintId}
        className="grid w-full grid-cols-2 gap-2">
        {options.map((w) => {
          const off = tried.includes(w);
          const right = solved && w === card.respuesta;
          return (
            <button key={w} type="button" onClick={() => choose(w)} disabled={solved && !right}
              aria-disabled={off || undefined}
              className={`${focusRing} flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 px-3 text-lg font-bold transition-colors ${
                right ? "border-primary bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]"
                  : off ? "border-border/60 bg-muted text-muted-foreground line-through decoration-2"
                  : "border-primary/30 bg-card hover:border-primary hover:bg-[color:var(--primary-soft)] disabled:opacity-50"
              }`}>
              {right && <Check className="h-5 w-5" aria-hidden="true" />}
              {w}
            </button>
          );
        })}
      </div>
      <p id={hintId} role="status" className="min-h-6 text-base font-semibold">{message}</p>
      {!solved && tried.length > 0 && (
        <button type="button" onClick={reveal} className={`${pillOutline} ${focusRing} gap-2`}>
          <Lightbulb className="h-5 w-5" aria-hidden="true" />
          Mostrame la que rima
        </button>
      )}
    </div>
  );
}
