import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Frown, Hand, Info, Laugh, Loader2, Meh, MessageCircle, RotateCcw, Smartphone, Square, Timer } from "lucide-react";
import logoTortuga from "@/assets/logo-tortuga.png";
import {
  type CelebrationDTO, type PracticeActionResult, type PracticeDayDTO, type PracticeExerciseDTO, type PracticeResult,
  type ScreenMode, capitalize, portalApi,
} from "@/lib/portal";
import {
  type PracticeWho, PRACTICE_ERROR, PRACTICE_LIMITS, PRACTICE_RESULTS, PRACTICE_TEXT, authorName, breakLine, commentLabel,
  doneButton, howDidItGo, practiceConfirmation, resultLabel, showEmergencyHint,
} from "@/lib/practiceRules";
import { Celebration } from "@/components/portal/Celebration";
import { BackToExercises, BackToHome, Disclosure, PracticeGate } from "@/components/portal/PracticeParts";
import {
  type PracticeFailure, announcePlanShown, focusRing, practiceFailure, whoOf,
} from "@/components/portal/practiceFormat";
import { FormAlert, PageTitle } from "@/components/portal/ui";
import { ListenButton } from "@/components/portal/ListenButton";
import { type Speech, useSpeech } from "@/components/portal/useSpeech";
import { TONE_CLASS, card, choiceClass, pillOutline, pillPrimary, sectionTitle, textareaClass } from "@/components/portal/styles";
import { Activity } from "@/components/activity/Activity";

// Practicar un ejercicio (diseño §2.6). Sin la barra de abajo (la oculta el
// marco del portal en /portal/practicar/*).
//   - Hasta 8 años (tortuga): "Paso 1 de 3" en grande, la tortuga, Anterior /
//     Siguiente y "¡Terminamos!". De 9 a 12 (pasos): lo mismo sin la tortuga.
//     Desde 13 (lista): lista numerada, "Para qué sirve" y un cronómetro
//     optativo (el fin se avisa con texto, sin sonido).
//   - "Escuchar" lee los pasos con una voz del propio aparato (nada sale del
//     celular: solo voces locales; si no hay una en español, no aparece).
//   - "Ya lo hice / Ya lo hicimos" anota la práctica en ese momento (cuenta
//     aunque no se conteste lo que sigue) y después pregunta "¿Cómo te fue?"
//     (cómo se sintió, nunca cómo habló) con un comentario optativo.
//   - "¿Lo hicieron otro día?": ayer o anteayer. Deshacer: solo lo que anotó
//     esta cuenta, el mismo día.
//   - Lo que escribe la familia nunca va a la consola ni a un registro.
//   - Con actividad (etapa "activities"): «Jugar en el celular» o «Sin
//     pantalla» (los pasos). Terminar el juego no anota nada solo: muestra el
//     mismo «Ya lo hice / Ya lo hicimos».

export const Route = createFileRoute("/portal/practicar/$exerciseId")({
  component: PracticarPage,
});

function PracticarPage() {
  const { exerciseId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PracticeExerciseDTO | null>(null);
  const [failure, setFailure] = useState<PracticeFailure | null>(null);
  const seq = useRef(0);
  const here = `/portal/practicar/${exerciseId}`;

  const toLogin = useCallback(() => {
    navigate({ to: "/portal/ingresar", search: { volver: here }, replace: true });
  }, [navigate, here]);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setFailure(null);
    setData(null);
    const r = await portalApi.exercise(exerciseId);
    if (n !== seq.current) return;
    if (!r.ok) {
      if (r.status === 401) toLogin();
      else setFailure(practiceFailure(r, PRACTICE_ERROR.gone));
      return;
    }
    setData(r.data);
    // Solo hay ejercicio de un plan publicado: "Ejercicios" en la barra de
    // abajo cuando se sale de practicar (por ejemplo, a "Ver mis medallas")
    announcePlanShown();
  }, [exerciseId, toLogin]);

  useEffect(() => { void load(); }, [load]);

  if (failure || !data) {
    return (
      <div className="flex flex-col gap-4">
        <BackToHome />
        {failure ? (
          <PracticeGate failure={failure} onRetry={() => void load()}
            errorText="No pudimos cargar el ejercicio. Probá de nuevo en un rato." />
        ) : (
          <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
            Cargando…
          </div>
        )}
      </div>
    );
  }

  return <Practice key={data.exercise.id} initial={data} toLogin={toLogin} />;
}

type Focus = "note" | "flash" | null;

function Practice({ initial, toLogin }: { initial: PracticeExerciseDTO; toLogin: () => void }) {
  const [data, setData] = useState(initial);
  const [flash, setFlash] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<CelebrationDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ at: "main" | "other"; text: string } | null>(null);
  // Se anotó hoy desde esta pantalla: el botón del final deja lugar a "Hecho hoy"
  const [loggedToday, setLoggedToday] = useState(false);
  // Prácticas (log_id) anotadas desde esta pantalla: su "¿Cómo te fue?" se
  // puede volver a abrir aunque después se haya anotado otro día
  const [loggedHere, setLoggedHere] = useState<string[]>([]);
  const flashRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<Focus>(null);
  const flashTimer = useRef<number | null>(null);
  const speech = useSpeech();
  // Con actividad: jugarla en el celular o hacer los pasos sin pantalla
  const [way, setWay] = useState<Way>("jugar");

  const w = whoOf(data.child);
  const mode = data.mode;
  const ex = data.exercise;
  const today = data.days.find((d) => d.label === "hoy") ?? null;
  const otherDays = data.days.filter((d) => d.label !== "hoy");
  // El día de la práctica cuyo "¿Cómo te fue?" está abierto
  const noteDay = noteFor ? data.days.find((d) => d.log?.id === noteFor) ?? null : null;

  // El foco va a "¿Cómo te fue?" o a la confirmación (salvo que haya una
  // celebración: la toma ella)
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "note" ? noteRef.current : flashRef.current)?.focus();
  });

  useEffect(() => () => { if (flashTimer.current) window.clearTimeout(flashTimer.current); }, []);

  // La confirmación se lee en voz (role=status): se vacía y se vuelve a
  // escribir, así se anuncia aunque el texto sea el mismo que antes
  function say(text: string) {
    setFlash("");
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(text), 80);
  }

  function failed(r: { status: number; error: string }, at: "main" | "other") {
    if (r.status === 401) {
      toLogin();
      return;
    }
    setError({ at, text: r.status === 404 ? PRACTICE_ERROR.gone : r.error });
  }

  // "Ya lo hice" (sin fecha: hoy) o "Ayer" / "Anteayer"
  async function log(day: PracticeDayDTO | null) {
    if (busy) return;
    speech.stop();
    const at = day && day.label !== "hoy" ? "other" : "main";
    setBusy(day?.date ?? "hoy");
    setError(null);
    const r = await portalApi.practiceLog(day && day.label !== "hoy" ? { exercise_id: ex.id, practiced_on: day.date } : { exercise_id: ex.id });
    setBusy(null);
    if (!r.ok) {
      failed(r, at);
      return;
    }
    applied(r.data);
    if (at === "main") setLoggedToday(true);
    const next = r.data.exercise;
    const logId = r.data.log_id;
    const logged = next.days.find((d) => d.log?.id === logId) ?? day;
    // "Ayer" un lunes cae en la semana anterior y en la pausa no se cuenta
    // nada: ahí la confirmación no dice la cuenta de esta semana
    say(practiceConfirmation(whoOf(next.child), next.mode, next.week, {
      day: logged ? { date: logged.date, label: logged.label } : undefined,
      on_break: !!next.on_break_until,
    }));
    if (logId) setLoggedHere((ids) => (ids.includes(logId) ? ids : [...ids, logId]));
    const needsNote = !!logId && !logged?.log?.my_note;
    setNoteFor(needsNote ? logId : null);
    if (!r.data.new_medals.length) focusNext.current = needsNote ? "note" : "flash";
  }

  // "Contar cómo te fue": vuelve a abrir "¿Cómo te fue?" de una práctica
  // anotada desde esta pantalla (por ejemplo, si después se anotó "Ayer")
  function tell(d: PracticeDayDTO) {
    if (!d.log) return;
    setError(null);
    setNoteFor(d.log.id);
    focusNext.current = "note";
  }

  // La práctica de ese día se anotó desde esta pantalla, esta cuenta todavía
  // no contó cómo le fue y su "¿Cómo te fue?" no está abierto
  const canTell = (d: PracticeDayDTO) =>
    !!d.log && !d.log.my_note && loggedHere.includes(d.log.id) && noteFor !== d.log.id;

  async function undo(day: PracticeDayDTO) {
    if (busy || !day.log) return;
    const logId = day.log.id;
    const at = day.label === "hoy" ? "main" : "other";
    setBusy(`undo-${day.date}`);
    setError(null);
    const r = await portalApi.practiceUndo(logId);
    setBusy(null);
    if (!r.ok) {
      failed(r, at);
      return;
    }
    applied(r.data);
    if (day.label === "hoy") setLoggedToday(false);
    setLoggedHere((ids) => ids.filter((x) => x !== logId));
    if (noteFor === logId) setNoteFor(null);
    say(`Listo: la práctica de ${day.label} ya no está anotada.`);
    focusNext.current = "flash";
  }

  function applied(result: PracticeActionResult) {
    setData(result.exercise);
    if (result.new_medals.length) setCelebration(result.new_medals);
  }

  // "¿Cómo te fue?" enviado (o ya lo había contado: conflict)
  function noteDone(result: PracticeActionResult | null, conflict: string | null) {
    if (result) applied(result);
    // Ya lo había contado (o la práctica ya no está): no se vuelve a ofrecer
    const done = noteFor;
    if (conflict && done) setLoggedHere((ids) => ids.filter((x) => x !== done));
    setNoteFor(null);
    say(conflict ?? "¡Gracias por contarnos!");
    if (!result?.new_medals.length) focusNext.current = "flash";
  }

  function noteSkipped() {
    setNoteFor(null);
    focusNext.current = "flash";
  }

  function celebrationDone() {
    setCelebration([]);
    focusNext.current = noteFor ? "note" : "flash";
  }

  const meta = [`${ex.minutes} ${ex.minutes === 1 ? "minuto" : "minutos"}`, ex.with_adult ? "Con un adulto" : null]
    .filter(Boolean).join(" · ");
  const doneArea = (
    <DoneButton mode={mode} done={loggedToday} busy={busy === "hoy"} onDone={() => void log(today)} />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <BackToExercises patientId={data.child.id} />
        <div>
          <PageTitle sub={`Lo preparó ${authorName(data.author_label)} · ${meta}`}>{ex.title}</PageTitle>
          {today?.log && (
            <div className="-mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${TONE_CLASS.ok}`}>
                <Check className="h-4 w-4" aria-hidden="true" />
                {PRACTICE_TEXT.done_today}
              </span>
              {canTell(today) && <TellButton label={today.label} onTell={() => tell(today)} />}
              {today.log.can_undo && (
                <UndoButton busy={busy === `undo-${today.date}`} label={today.label} onUndo={() => void undo(today)} />
              )}
            </div>
          )}
        </div>
      </div>

      {data.on_break_until && (
        <p className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-base font-semibold ${TONE_CLASS.info}`}>
          <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{breakLine(data.on_break_until)}</span>
        </p>
      )}

      <div className="flex flex-col gap-2">
        <p className="whitespace-pre-line break-words text-base"><b>Para qué sirve:</b> {ex.para_que}</p>
        {ex.materiales && <p className="whitespace-pre-line break-words text-base"><b>Materiales:</b> {ex.materiales}</p>}
      </div>

      {ex.activity && <PlayWay value={way} onChange={(w) => { speech.stop(); setWay(w); }} />}

      {ex.activity && way === "jugar" ? (
        <Activity spec={ex.activity} screenMode={mode} speech={speech} storageKey={ex.id} finishArea={doneArea} />
      ) : mode === "lista" ? (
        <StepList pasos={ex.pasos} title={ex.title} paraQue={ex.para_que} minutes={ex.minutes} speech={speech} doneArea={doneArea} />
      ) : (
        <StepByStep pasos={ex.pasos} mode={mode} speech={speech} doneArea={doneArea} />
      )}

      {error?.at === "main" && <FormAlert>{error.text}</FormAlert>}

      {celebration.length > 0 && <Celebration items={celebration} place="practica" onClose={celebrationDone} />}

      {/* Confirmación (siempre en la página, para que se anuncie al cambiar) */}
      <div ref={flashRef} tabIndex={-1} role="status"
        className={flash ? `${card} flex items-start gap-3 border-2 border-[color:var(--status-available-bg)] outline-none` : "sr-only"}>
        {flash && <Check className="mt-0.5 h-6 w-6 shrink-0 text-[oklch(0.42_0.12_150)]" aria-hidden="true" />}
        <p className="text-lg font-bold">{flash}</p>
      </div>

      {noteFor && (
        <NoteForm key={noteFor} logId={noteFor} dayLabel={noteDay?.label ?? "hoy"} w={w} mode={mode}
          authorLabel={data.author_label} headingRef={noteRef} toLogin={toLogin} onDone={noteDone} onSkip={noteSkipped} />
      )}

      <div className={`${card} flex flex-col gap-1`}>
        <h2 className="font-display text-base font-bold">Si cuesta…</h2>
        <p className="whitespace-pre-line break-words text-base">{ex.si_cuesta}</p>
      </div>

      {ex.for_adult && (
        <Disclosure title="Para el adulto que acompaña">
          <p className="whitespace-pre-line break-words text-base">{ex.for_adult}</p>
        </Disclosure>
      )}

      {otherDays.length > 0 && (
        <OtherDays days={otherDays} busy={busy} onLog={(d) => void log(d)} onUndo={(d) => void undo(d)}
          canTell={canTell} onTell={tell} error={error?.at === "other" ? error.text : null} />
      )}

      <BackToExercises patientId={data.child.id} />
    </div>
  );
}

// ── Jugar en el celular o sin pantalla ───────────────────────────────────

type Way = "jugar" | "sin_pantalla";

// Dos opciones grandes (radio): la actividad o los pasos de siempre
function PlayWay({ value, onChange }: { value: Way; onChange: (w: Way) => void }) {
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
function StepByStep({ pasos, mode, speech, doneArea }: {
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
function StepList({ pasos, title, paraQue, minutes, speech, doneArea }: {
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

// "Ya lo hice / Ya lo hicimos" (o "Hecho hoy" si ya se anotó desde acá)
function DoneButton({ mode, done, busy, onDone }: { mode: ScreenMode; done: boolean; busy: boolean; onDone: () => void }) {
  if (done) {
    return (
      <p className={`inline-flex min-h-12 items-center gap-2 self-center rounded-full px-5 text-base font-bold ${TONE_CLASS.ok}`}>
        <Check className="h-5 w-5" aria-hidden="true" />
        {PRACTICE_TEXT.done_today}
      </p>
    );
  }
  return (
    <button type="button" onClick={onDone} disabled={busy}
      className={`${pillPrimary} ${focusRing} h-14 w-full text-lg min-[420px]:w-auto min-[420px]:self-center min-[420px]:px-8`}>
      {busy ? "Guardando…" : doneButton(mode)}
    </button>
  );
}

// "Contar cómo te fue" (abre "¿Cómo te fue?" de esa práctica)
function TellButton({ label, onTell }: { label: string; onTell: () => void }) {
  return (
    <button type="button" onClick={onTell}
      className={`inline-flex min-h-12 items-center gap-1.5 rounded-full px-3 text-base font-bold text-primary underline-offset-2 hover:underline ${focusRing}`}>
      <MessageCircle className="h-4 w-4" aria-hidden="true" />
      {PRACTICE_TEXT.tell_how}<span className="sr-only"> {label}</span>
    </button>
  );
}

function UndoButton({ busy, label, onUndo }: { busy: boolean; label: string; onUndo: () => void }) {
  return (
    <button type="button" onClick={onUndo} disabled={busy}
      className={`inline-flex min-h-12 items-center gap-1.5 rounded-full px-3 text-base font-bold text-primary underline-offset-2 hover:underline disabled:opacity-50 ${focusRing}`}>
      <RotateCcw className="h-4 w-4" aria-hidden="true" />
      {busy ? "Deshaciendo…" : "Deshacer"}<span className="sr-only"> la práctica de {label}</span>
    </button>
  );
}

// ── "¿Lo hicieron otro día?" ──────────────────────────────────────────────

function OtherDays({ days, busy, onLog, onUndo, canTell, onTell, error }: {
  days: PracticeDayDTO[];
  busy: string | null;
  onLog: (d: PracticeDayDTO) => void;
  onUndo: (d: PracticeDayDTO) => void;
  canTell: (d: PracticeDayDTO) => boolean;
  onTell: (d: PracticeDayDTO) => void;
  error: string | null;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-3`}>
      <h2 id={id} className="font-display text-lg font-bold">{PRACTICE_TEXT.other_day}</h2>
      <ul className="flex flex-col gap-2">
        {days.map((d) => (
          <li key={d.date} className="flex flex-wrap items-center gap-2">
            {d.log ? (
              <>
                <span className={`inline-flex min-h-12 items-center gap-1.5 rounded-full px-4 text-base font-bold ${TONE_CLASS.ok}`}>
                  <Check className="h-5 w-5" aria-hidden="true" />
                  {capitalize(d.label)}: anotado
                </span>
                {canTell(d) && <TellButton label={d.label} onTell={() => onTell(d)} />}
                {d.log.can_undo && (
                  <UndoButton busy={busy === `undo-${d.date}`} label={d.label} onUndo={() => onUndo(d)} />
                )}
              </>
            ) : (
              <button type="button" onClick={() => onLog(d)} disabled={!!busy}
                className={`${pillOutline} ${focusRing} w-full min-[420px]:w-auto`}>
                {busy === d.date ? "Guardando…" : capitalize(d.label)}
                <span className="sr-only">: anotar que lo hicieron {d.label}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      <FormAlert>{error}</FormAlert>
    </section>
  );
}

// ── "¿Cómo te fue?" ───────────────────────────────────────────────────────

// Caritas solo en el modo tortuga (decorativas: el texto siempre está)
const RESULT_FACE = { bien: Laugh, mas_o_menos: Meh, costo: Frown } as const;

function NoteForm({ logId, dayLabel, w, mode, authorLabel, headingRef, toLogin, onDone, onSkip }: {
  logId: string;
  dayLabel: string; // "hoy", "ayer" o "anteayer" (el título lo dice si no es hoy)
  w: PracticeWho;
  mode: ScreenMode;
  authorLabel: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  toLogin: () => void;
  onDone: (result: PracticeActionResult | null, conflict: string | null) => void;
  onSkip: () => void;
}) {
  const id = useId();
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const tortuga = mode === "tortuga";
  const max = PRACTICE_LIMITS.comment;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = comment.trim();
    if (!result && !text) {
      setError(PRACTICE_ERROR.note_empty);
      return;
    }
    if (text.length > max) {
      setError(PRACTICE_ERROR.comment_long);
      return;
    }
    setError(null);
    setSending(true);
    const r = await portalApi.practiceNote({ log_id: logId, result, comment: text || null });
    setSending(false);
    if (!r.ok) {
      if (r.status === 401) toLogin();
      else if (r.status === 409) onDone(null, r.error);
      else setError(r.error);
      return;
    }
    onDone(r.data, null);
  }

  return (
    <form onSubmit={submit} noValidate aria-labelledby={id} className={`${card} flex flex-col gap-4`}>
      <h2 id={id} ref={headingRef} tabIndex={-1} className="font-display text-2xl font-bold outline-none">
        {howDidItGo(dayLabel)}
      </h2>
      <div role="group" aria-labelledby={id} className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        {PRACTICE_RESULTS.map((r) => {
          const on = result === r;
          const Face = RESULT_FACE[r];
          return (
            <button key={r} type="button" aria-pressed={on} onClick={() => setResult(on ? null : r)}
              className={`flex items-center justify-center gap-2 rounded-2xl border-2 px-4 text-lg font-bold transition-colors ${
                tortuga ? "min-h-20 min-[420px]:flex-col" : "min-h-14"} ${
                on ? "border-primary bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]" : "border-border/60 bg-card hover:border-primary/50"
              } ${focusRing}`}>
              {tortuga && <Face className="h-8 w-8 shrink-0" aria-hidden="true" />}
              {resultLabel(r, mode)}
              {on && !tortuga && <Check className="h-5 w-5 shrink-0" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-comentario`} className="text-base font-bold">{commentLabel(w, authorLabel)}</label>
        <textarea id={`${id}-comentario`} value={comment} maxLength={max} rows={3}
          onChange={(e) => { setComment(e.target.value); setError(null); }}
          aria-describedby={`${id}-ayuda`} className={textareaClass} />
        <p aria-hidden="true" className="self-end text-sm tabular-nums text-muted-foreground">{comment.length} / {max}</p>
        <div id={`${id}-ayuda`} className="flex flex-col gap-1.5">
          <p className="text-sm text-muted-foreground">{PRACTICE_TEXT.comment_hint}</p>
          {showEmergencyHint(w) && <p className="text-sm font-semibold">{PRACTICE_TEXT.emergency_hint}</p>}
        </div>
      </div>

      <FormAlert>{error}</FormAlert>

      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <button type="submit" disabled={sending} className={`${pillPrimary} ${focusRing}`}>
          {sending ? "Enviando…" : "Enviar"}
        </button>
        <button type="button" onClick={onSkip} disabled={sending} className={`${pillOutline} ${focusRing}`}>
          Ahora no
        </button>
      </div>
    </form>
  );
}

// ── Cronómetro (desde 13, optativo) ───────────────────────────────────────
// Muestra el tiempo que pasó (no una cuenta regresiva). El fin se avisa con
// texto (role=status), sin sonido ni vibración.

function StopWatch({ minutes }: { minutes: number }) {
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
