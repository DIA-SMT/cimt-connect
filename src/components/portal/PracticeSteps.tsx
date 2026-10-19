import { useEffect, useId, useRef, useState } from "react";
import { Hand, Smartphone, Square, Timer } from "lucide-react";
import logoTortuga from "@/assets/logo-tortuga.png";
import type { ScreenMode } from "@/lib/practiceRules";
import { ListenButton } from "@/components/portal/ListenButton";
import { focusRing } from "@/components/portal/practiceFormat";
import { card, choiceClass, pillOutline, pillPrimary, sectionTitle } from "@/components/portal/styles";
import type { Speech } from "@/components/portal/useSpeech";

// Las partes de la pantalla de práctica que se ven igual en el portal y en la
// vista previa del panel («Así lo ve la familia»): elegir jugar o sin
// pantalla, los pasos (de a uno o en lista) y el cronómetro.

// ── Jugar en el celular o sin pantalla ───────────────────────────────────

export type Way = "jugar" | "sin_pantalla";

// Dos opciones grandes (radio): la actividad o los pasos de siempre
export function PlayWay({ value, onChange }: { value: Way; onChange: (w: Way) => void }) {
  const name = useId();
  const options: { id: Way; label: string; icon: typeof Smartphone }[] = [
    { id: "jugar", label: "Jugar en el celular", icon: Smartphone },
    { id: "sin_pantalla", label: "Sin pantalla", icon: Hand },
  ];
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="sr-only">Cómo lo hacen</legend>
      {options.map(({ id, label, icon: Icon }) => (
        <label key={id} className={`${choiceClass(value === id, true)} justify-center text-center`}>
          <input type="radio" name={name} value={id} checked={value === id} onChange={() => onChange(id)} className="sr-only" />
          <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

// ── Pasos ─────────────────────────────────────────────────────────────────

// Hasta 12 años: de a un paso. En cada paso el foco va al título ("Paso 2 de 3")
export function StepByStep({ pasos, mode, speech, doneArea }: {
  pasos: string[];
  mode: ScreenMode;
  speech: Speech;
  doneArea: React.ReactNode;
}) {
  const id = useId();
  const n = pasos.length;
  const [step, setStep] = useState(0); // n: "¡Terminamos!"
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const tortuga = mode === "tortuga";
  const end = step >= n;

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    titleRef.current?.focus();
  }, [step]);

  function go(to: number) {
    speech.stop();
    moved.current = true;
    setStep(Math.max(0, Math.min(n, to)));
  }

  const title = end ? "¡Terminamos!" : `Paso ${step + 1} de ${n}`;
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col items-center gap-5 text-center`}>
      {tortuga && (
        <img key={step} src={logoTortuga} alt="" width={80} height={80}
          className="h-20 w-20 object-contain motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-500" />
      )}
      <h2 id={id} ref={titleRef} tabIndex={-1}
        className={`font-display font-bold leading-tight text-[color:var(--primary-deep)] outline-none ${tortuga ? "text-4xl" : "text-3xl"}`}>
        {title}
      </h2>
      {!end && (
        <p className={`whitespace-pre-line break-words ${tortuga ? "text-2xl font-semibold leading-snug" : "text-xl leading-snug"}`}>
          {pasos[step]}
        </p>
      )}
      <ListenButton speech={speech} texts={end ? [title] : [`${title}.`, pasos[step]]} />
      {end ? (
        <div className="flex w-full flex-col items-center gap-3">
          {doneArea}
          <button type="button" onClick={() => go(n - 1)} className={`${pillOutline} ${focusRing} w-full min-[420px]:w-auto`}>
            Anterior
          </button>
        </div>
      ) : (
        <div className="grid w-full grid-cols-2 gap-2">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className={`${pillOutline} ${focusRing}`}>
            Anterior
          </button>
          <button type="button" onClick={() => go(step + 1)} className={`${pillPrimary} ${focusRing}`}>
            Siguiente
          </button>
        </div>
      )}
    </section>
  );
}

// Desde 13: lista numerada y cronómetro optativo
export function StepList({ pasos, title, paraQue, minutes, speech, doneArea }: {
  pasos: string[];
  title: string;
  paraQue: string;
  minutes: number;
  speech: Speech;
  doneArea: React.ReactNode;
}) {
  const id = useId();
  return (
    <>
      <section aria-labelledby={id} className={`${card} flex flex-col gap-4`}>
        <h2 id={id} className={sectionTitle}>Cómo se hace</h2>
        <ol className="flex list-decimal flex-col gap-3 pl-6 text-lg leading-snug marker:font-bold marker:text-primary">
          {pasos.map((p, i) => <li key={i} className="whitespace-pre-line break-words pl-1">{p}</li>)}
        </ol>
        <ListenButton speech={speech}
          texts={[`${title}.`, `Para qué sirve: ${paraQue}`, ...pasos.map((p, i) => `Paso ${i + 1}. ${p}`)]} />
      </section>
      <StopWatch minutes={minutes} />
      <div className="flex flex-col">{doneArea}</div>
    </>
  );
}

// ── Cronómetro (desde 13, optativo) ───────────────────────────────────────
// Muestra el tiempo que pasó (no una cuenta regresiva). El fin se avisa con
// texto (role=status), sin sonido ni vibración.

export function StopWatch({ minutes }: { minutes: number }) {
  const id = useId();
  const total = minutes * 60;
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [ended, setEnded] = useState(false);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const s = Math.min(total, Math.floor((Date.now() - startedAt.current) / 1000));
      setElapsed(s);
      if (s >= total) {
        setRunning(false);
        setEnded(true);
      }
    };
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [running, total]);

  function toggle() {
    if (running) {
      setRunning(false);
      return;
    }
    const from = ended ? 0 : elapsed;
    if (ended) setElapsed(0);
    setEnded(false);
    startedAt.current = Date.now() - from * 1000;
    setRunning(true);
  }

  function restart() {
    setElapsed(0);
    setEnded(false);
    setRunning(false);
  }

  const words = `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  const paused = !running && !ended && elapsed > 0;
  const label = running ? "Pausar" : paused ? "Seguir" : `Empezar ${words}`;
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-3`}>
      <h2 id={id} className={sectionTitle}>Cronómetro (si querés)</h2>
      <p role="timer" className="font-display text-3xl font-bold tabular-nums">
        {clock(elapsed)} <span className="text-base font-normal text-muted-foreground">de {clock(total)}</span>
      </p>
      <p role="status" className={ended ? "text-base font-semibold" : "sr-only"}>
        {ended ? (minutes === 1 ? "Listo: pasó 1 minuto." : `Listo: pasaron los ${words}.`) : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={toggle} className={`${running ? pillOutline : pillPrimary} ${focusRing} gap-2`}>
          {running ? <Square className="h-4 w-4" aria-hidden="true" /> : <Timer className="h-5 w-5" aria-hidden="true" />}
          {label}
        </button>
        {paused && (
          <button type="button" onClick={restart} className={`${pillOutline} ${focusRing}`}>Volver a empezar</button>
        )}
      </div>
    </section>
  );
}
