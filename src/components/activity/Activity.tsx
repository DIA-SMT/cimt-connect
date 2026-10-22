import { type ReactNode, useEffect, useId, useReducer, useRef } from "react";
import { ArrowLeft, ArrowRight, Play, RotateCcw, Sparkles } from "lucide-react";
import { type ActivitySpec, MECHANIC_HINT } from "@/lib/activitySpec";
import { activityAutoComplete, activitySteps } from "@/lib/activityMechanics";
import { type EngineEvent, type EngineState, engineReduce, initialEngine, restoreEngine } from "@/lib/activityEngine";
import type { ScreenMode } from "@/lib/practiceRules";
import { THEME_STYLE } from "@/components/activity/assets";
import { MECHANIC_PLAYER, MECHANIC_WORDS } from "@/components/activity/registry";
import type { MechanicProps } from "@/components/activity/types";
import { focusRing } from "@/components/portal/practiceFormat";
import { card, pillOutline, pillPrimary } from "@/components/portal/styles";
import type { Speech } from "@/components/portal/useSpeech";

// Una actividad para jugar en el celular (src/lib/activitySpec.ts). La misma
// pantalla en el portal y en la vista previa del panel: lo que revisa el
// profesional es lo que juega la familia.
//   - Sin tiempos, sin puntajes y sin perder: se puede volver atrás y
//     empezar de nuevo cuando quieran.
//   - Portal: dónde quedaron se guarda en este aparato (storageKey) para
//     «seguir otro día»; nunca va al servidor. Si el almacenamiento no está
//     disponible, se empieza de cero.
//   - Al terminar, finishArea: en el portal, el «Ya lo hicimos» de siempre
//     (terminar el juego no anota nada solo).
//   - together: el ejercicio es con un acompañante («Con un adulto») y los
//     textos van en plural; si no (un adulto o un adolescente que practica
//     solo), en singular.

const STORE_PREFIX = "cimt-actividad-";

function loadSaved(key: string | null, total: number): EngineState | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw ? restoreEngine(JSON.parse(raw), total) : null;
  } catch {
    return null;
  }
}

function saveState(key: string | null, s: EngineState) {
  if (!key) return;
  try {
    if (s.status === "jugando" || s.status === "pausado") localStorage.setItem(STORE_PREFIX + key, JSON.stringify(s));
    else localStorage.removeItem(STORE_PREFIX + key);
  } catch { /* sin almacenamiento: no se recuerda dónde quedaron */ }
}

export function Activity({ spec, screenMode, speech, storageKey = null, finishArea = null, together = true }: {
  spec: ActivitySpec;
  screenMode: ScreenMode;
  speech: Speech;
  storageKey?: string | null; // portal: el ejercicio (null en la vista previa)
  finishArea?: ReactNode;
  together?: boolean;
}) {
  const total = activitySteps(spec);
  const auto = activityAutoComplete(spec);
  const [state, dispatch] = useReducer(
    (s: EngineState, e: EngineEvent) => engineReduce(s, e, auto),
    null,
    () => loadSaved(storageKey, total) ?? initialEngine(total),
  );
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const theme = THEME_STYLE[spec.tema];
  const ThemeIcon = theme.icon;
  const words = MECHANIC_WORDS[spec.mecanica];
  const big = screenMode === "tortuga";

  useEffect(() => { saveState(storageKey, state); }, [storageKey, state]);

  // Al cambiar de paso o de pantalla, el foco va al título (como los pasos)
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    headingRef.current?.focus();
  }, [state.step, state.status]);

  function send(e: EngineEvent) {
    speech.stop();
    if (e.type !== "COMPLETAR") moved.current = true;
    dispatch(e);
  }

  const band = (
    <div className={`-mx-5 -mt-5 mb-1 flex items-center gap-3 self-stretch rounded-t-3xl px-5 py-3 text-left ${theme.band}`}>
      <ThemeIcon className={`h-7 w-7 shrink-0 ${theme.ink}`} aria-hidden="true" />
      <p className={`min-w-0 flex-1 break-words font-display text-lg font-bold ${theme.ink}`}>{spec.titulo}</p>
    </div>
  );

  if (state.status === "listo" || state.status === "pausado") {
    const resume = state.status === "pausado";
    return (
      <section aria-labelledby={headingId} className={`${card} flex flex-col items-center gap-4 text-center`}>
        {band}
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold text-[color:var(--primary-deep)] outline-none">
          {resume ? (together ? "¿Siguen donde quedaron?" : "¿Seguís donde quedaste?") : (words.start ?? "¡A jugar!")}
        </h2>
        <p className="text-lg leading-snug">
          {resume ? `${together ? "Quedaron" : "Quedaste"} en: ${words.step.toLowerCase()} ${state.step + 1} de ${state.total}.` : MECHANIC_HINT[spec.mecanica]}
        </p>
        <div className="flex w-full flex-col gap-2 min-[420px]:flex-row min-[420px]:justify-center">
          <button type="button" onClick={() => send({ type: resume ? "SEGUIR" : "EMPEZAR" })} className={`${pillPrimary} ${focusRing} gap-2`}>
            <Play className="h-5 w-5" aria-hidden="true" />
            {resume ? "Seguir" : "Empezar"}
          </button>
          {resume && (
            <button type="button" onClick={() => send({ type: "REINICIAR" })} className={`${pillOutline} ${focusRing} gap-2`}>
              <RotateCcw className="h-5 w-5" aria-hidden="true" />
              Empezar de nuevo
            </button>
          )}
        </div>
      </section>
    );
  }

  if (state.status === "terminado") {
    return (
      <section aria-labelledby={headingId} className={`${card} flex flex-col items-center gap-4 text-center`}>
        {band}
        <Sparkles className={`h-12 w-12 ${theme.ink}`} aria-hidden="true" />
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold text-[color:var(--primary-deep)] outline-none">
          {together ? "¡Terminaron!" : "¡Terminaste!"}
        </h2>
        <p className="text-lg">{together ? "Llegaron" : "Llegaste"} hasta el final de «{spec.titulo}».</p>
        {finishArea && <div className="flex w-full flex-col items-center gap-3">{finishArea}</div>}
        <div className="flex w-full flex-col gap-2 min-[420px]:flex-row min-[420px]:justify-center">
          <button type="button" onClick={() => send({ type: "ANTERIOR" })} className={`${pillOutline} ${focusRing} gap-2`}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            Volver a mirar
          </button>
          <button type="button" onClick={() => send({ type: "REINICIAR" })} className={`${pillOutline} ${focusRing} gap-2`}>
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
            {words.again ?? "Jugar otra vez"}
          </button>
        </div>
      </section>
    );
  }

  const Player = MECHANIC_PLAYER[spec.mecanica] as unknown as (p: MechanicProps<ActivitySpec>) => ReactNode;
  const last = state.step === state.total - 1;
  const canGo = !!state.done[state.step];
  const progress = Math.round(((state.step + (canGo ? 1 : 0)) / state.total) * 100);
  return (
    <section aria-labelledby={headingId} className={`${card} flex flex-col gap-4`}>
      {band}
      <div className="flex flex-col gap-1.5">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-center font-display text-xl font-bold text-[color:var(--primary-deep)] outline-none">
          {words.step} {state.step + 1} de {state.total}
        </h2>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <Player spec={spec} state={state} dispatch={send} speech={speech} big={big} ink={theme.ink} exerciseId={storageKey} together={together} />
      {!canGo && words.locked[together ? 1 : 0] && <p className="text-center text-sm text-muted-foreground">{words.locked[together ? 1 : 0]}</p>}
      <div className="grid w-full grid-cols-2 gap-2">
        <button type="button" onClick={() => send({ type: "ANTERIOR" })} disabled={state.step === 0} className={`${pillOutline} ${focusRing} gap-1`}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          Anterior
        </button>
        <button type="button" onClick={() => send({ type: "SIGUIENTE" })} disabled={!canGo} className={`${pillPrimary} ${focusRing} gap-1`}>
          {last ? "Terminar" : "Siguiente"}
          <ArrowRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
