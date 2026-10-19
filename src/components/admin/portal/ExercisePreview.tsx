import { useState } from "react";
import type { ActivitySpec } from "@/lib/activitySpec";
import type { ScreenMode } from "@/lib/practiceRules";
import { Activity } from "@/components/activity/Activity";
import { Disclosure } from "@/components/portal/PracticeParts";
import { type Way, PlayWay, StepByStep, StepList } from "@/components/portal/PracticeSteps";
import { card } from "@/components/portal/styles";
import { useSpeech } from "@/components/portal/useSpeech";

// «Así lo ve la familia»: la pantalla de práctica del portal, con los mismos
// componentes (los pasos de a uno o en lista, y el juego si hay), dentro de
// un marco de celular. Sirve para cualquier ejercicio del plan y para la
// propuesta de la IA antes de sumarla. No anota nada: en lugar de «Ya lo
// hice» dice qué va a ver la familia.

export type PreviewExercise = {
  title: string;
  para_que: string;
  pasos: string[];
  minutes: number;
  materiales: string | null;
  for_adult: string | null;
  si_cuesta: string;
  with_adult: boolean;
  activity: ActivitySpec | null;
};

const DONE_NOTE = <p className="text-center text-sm text-muted-foreground">Acá la familia toca «Ya lo hice» para anotar la práctica.</p>;

export function ExercisePreview({ ex, screenMode }: { ex: PreviewExercise; screenMode: ScreenMode }) {
  const speech = useSpeech();
  const [way, setWay] = useState<Way>("jugar");
  const pasos = ex.pasos.map((p) => p.trim()).filter(Boolean);
  const meta = [`${ex.minutes} ${ex.minutes === 1 ? "minuto" : "minutos"}`, ex.with_adult ? "Con un adulto" : null].filter(Boolean).join(" · ");
  // Cada cambio del texto vuelve a empezar la vista previa
  const key = JSON.stringify([pasos, ex.activity]);
  return (
    <div className="mx-auto w-full max-w-[380px] rounded-[2rem] border-4 border-foreground/10 bg-background p-3">
      <div className="flex flex-col gap-4">
        <div>
          <p className="font-hand text-3xl leading-tight text-[color:var(--primary-deep)]">{ex.title.trim() || "Sin título"}</p>
          <p className="text-sm text-muted-foreground">{meta}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="whitespace-pre-line break-words text-base"><b>Para qué sirve:</b> {ex.para_que}</p>
          {ex.materiales && <p className="whitespace-pre-line break-words text-base"><b>Materiales:</b> {ex.materiales}</p>}
        </div>
        {ex.activity && <PlayWay value={way} onChange={(w) => { speech.stop(); setWay(w); }} />}
        {ex.activity && way === "jugar" ? (
          <Activity key={key} spec={ex.activity} screenMode={screenMode} speech={speech} finishArea={DONE_NOTE} />
        ) : pasos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay pasos.</p>
        ) : screenMode === "lista" ? (
          <StepList key={key} pasos={pasos} title={ex.title} paraQue={ex.para_que} minutes={ex.minutes} speech={speech} doneArea={DONE_NOTE} />
        ) : (
          <StepByStep key={key} pasos={pasos} mode={screenMode} speech={speech} doneArea={DONE_NOTE} />
        )}
        <div className={`${card} flex flex-col gap-1`}>
          <p className="font-display text-base font-bold">Si cuesta…</p>
          <p className="whitespace-pre-line break-words text-base">{ex.si_cuesta}</p>
        </div>
        {ex.for_adult && (
          <Disclosure title="Para el adulto que acompaña">
            <p className="whitespace-pre-line break-words text-base">{ex.for_adult}</p>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
