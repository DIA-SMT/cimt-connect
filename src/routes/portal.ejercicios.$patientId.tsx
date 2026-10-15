import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Info, Loader2, Medal } from "lucide-react";
import { type PracticeDTO, type PracticeExerciseItemDTO, type ScreenMode, capitalize, portalApi } from "@/lib/portal";
import {
  type PracticeWho, PRACTICE_TEXT, authorName, breakLine, exercisesTitle, practiceButton, reviewedLine, weekLine,
} from "@/lib/practiceRules";
import { Celebration } from "@/components/portal/Celebration";
import { BackToHome, Disclosure, PracticeGate, WeekStrip } from "@/components/portal/PracticeParts";
import {
  type PracticeFailure, announcePlanShown, focusRing, medalsHint, newThingsSr, practiceFailure, seeMedalsLabel, whoOf,
} from "@/components/portal/practiceFormat";
import { PageTitle } from "@/components/portal/ui";
import { TONE_CLASS, card, newChip, pillOutline, pillPrimary, sectionTitle, tileWideLink } from "@/components/portal/styles";

// "Ejercicios de Martín" / "Mis ejercicios" (diseño §2.5): el plan que
// publicó el profesional, la semana (de lunes a domingo, hora del centro) y
// los ejercicios. Las metas, las devoluciones y las medallas están en un solo
// lugar, "Mis logros": acá va solo el acceso.
// No pide la contraseña de nuevo. Lo que no se puede ver se explica con los
// mismos textos que "Mi información" (un solo texto neutro para lo que no está
// disponible). Nunca rachas, cuentas regresivas ni "pendiente".

export const Route = createFileRoute("/portal/ejercicios/$patientId")({
  component: EjerciciosPage,
});

function EjerciciosPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PracticeDTO | null>(null);
  const [failure, setFailure] = useState<PracticeFailure | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // Respuesta de la última carga (si se cambia de persona, lo viejo no pisa lo nuevo)
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setFailure(null);
    setData(null);
    const r = await portalApi.practice(patientId);
    if (n !== seq.current) return;
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: `/portal/ejercicios/${patientId}` }, replace: true });
        return;
      }
      setFailure(practiceFailure(r));
      return;
    }
    setData(r.data);
    // Con un plan publicado, "Ejercicios" en la barra de abajo (también en "Mis logros")
    if (r.data.plan) announcePlanShown();
  }, [patientId, navigate]);

  useEffect(() => { void load(); }, [load]);

  // "Seguir" en la celebración: desaparece y el foco vuelve al título
  function celebrationDone() {
    setData((d) => d && { ...d, celebration: [] });
    pageRef.current?.querySelector("h1")?.focus();
  }

  if (failure || !data) {
    return (
      <div className="flex flex-col gap-4">
        <BackToHome />
        {failure ? (
          <>
            <PageTitle>Ejercicios</PageTitle>
            <PracticeGate failure={failure} onRetry={() => void load()}
              errorText="No pudimos cargar los ejercicios. Probá de nuevo en un rato." />
          </>
        ) : (
          <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
            Cargando…
          </div>
        )}
      </div>
    );
  }

  const w = whoOf(data.child);
  const { plan, week } = data;
  const sub = plan
    ? `Los preparó ${authorName(plan.author_label)}.${plan.goal_text ? ` Para qué: ${plan.goal_text}` : ""}`
    : undefined;

  return (
    <div ref={pageRef} className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <BackToHome />
        <div>
          <PageTitle sub={sub}>{exercisesTitle(w)}</PageTitle>
        </div>
      </div>

      {data.celebration.length > 0 && (
        <Celebration items={data.celebration} place="ejercicios" onClose={celebrationDone} />
      )}

      {data.on_break_until && (
        <p className={`-mt-2 flex items-start gap-2 rounded-2xl px-4 py-3 text-base font-semibold ${TONE_CLASS.info}`}>
          <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{breakLine(data.on_break_until)}</span>
        </p>
      )}

      {!plan && <p className={`${card} text-base`}>{PRACTICE_TEXT.not_available}</p>}

      {/* En la pausa de vacaciones no hay meta de la semana: solo la línea de
          la pausa (como en el Inicio) */}
      {week && !data.on_break_until && <WeekSection week={week} />}

      {plan && data.exercises.length > 0 && (
        <section aria-labelledby="practicar-titulo" className="flex flex-col gap-3">
          <h2 id="practicar-titulo" className={sectionTitle}>Para practicar</h2>
          {data.exercises.map((e) => <ExerciseCard key={e.id} exercise={e} w={w} mode={data.mode} />)}
        </section>
      )}

      {/* Metas, devoluciones y medallas están en un solo lugar ("Mis logros"):
          acá, solo el acceso */}
      {(plan || data.goals.length > 0 || data.last_feedback || data.recent_medals.length > 0) && (
        <MedalsLink data={data} w={w} />
      )}

      {data.adult_guide.length > 0 && (
        <Disclosure title="Para el adulto que acompaña">
          {data.adult_guide.map((t) => <p key={t} className="whitespace-pre-line break-words text-base">{t}</p>)}
        </Disclosure>
      )}

      {data.reviewed && <p className="text-base text-muted-foreground">{reviewedLine(data.reviewed)}</p>}
    </div>
  );
}

// "Esta semana 2 de 3 días" (o "4 días (la meta era 3)"): tira de lunes a
// domingo (visual) y su lista
function WeekSection({ week }: { week: NonNullable<PracticeDTO["week"]> }) {
  return (
    <section aria-labelledby="semana-titulo" className="flex flex-col gap-3">
      <h2 id="semana-titulo" className="font-display text-lg font-bold">{capitalize(weekLine(week))}</h2>
      <WeekStrip week={week} />
    </section>
  );
}

// Un ejercicio: "5 minutos · Con un adulto", "Hecho hoy" y el botón para
// empezar ("Practicar con Martín" en modo tortuga, "Empezar" o "Hacerlo otra
// vez", que no suma otro registro)
function ExerciseCard({ exercise: e, w, mode }: { exercise: PracticeExerciseItemDTO; w: PracticeWho; mode: ScreenMode }) {
  const id = useId();
  const meta = [`${e.minutes} ${e.minutes === 1 ? "minuto" : "minutos"}`, e.with_adult ? "Con un adulto" : null].filter(Boolean).join(" · ");
  return (
    <article aria-labelledby={id} className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-col gap-1">
        <h3 id={id} className="font-display text-lg font-bold leading-snug">{e.title}</h3>
        <p className="text-base text-muted-foreground">{meta}</p>
      </div>
      {e.done_today && (
        <span className={`inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-sm font-bold ${TONE_CLASS.ok}`}>
          <Check className="h-4 w-4" aria-hidden="true" />
          {PRACTICE_TEXT.done_today}
        </span>
      )}
      <Link to="/portal/practicar/$exerciseId" params={{ exerciseId: e.id }}
        className={`${e.done_today ? pillOutline : pillPrimary} ${focusRing} h-auto min-h-12 py-2 text-center min-[420px]:self-start`}>
        {e.done_today ? PRACTICE_TEXT.do_again : practiceButton(w, mode)}
        <span className="sr-only">: {e.title}</span>
      </Link>
    </article>
  );
}

// "Ver mis logros" / "Ver las medallas de Martín": metas, medallas y
// devoluciones, en "Mis logros". "Nuevo" si hay una devolución o una medalla
// que esta cuenta todavía no vio (las medallas sin ver son las de la celebración)
function MedalsLink({ data, w }: { data: PracticeDTO; w: PracticeWho }) {
  const freshSr = newThingsSr(w, data.feedback_new, data.celebration.length);
  return (
    <Link to="/portal/medallas/$patientId" params={{ patientId: data.child.id }} className={`${tileWideLink} ${focusRing}`}>
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm">
        <Medal className="h-6 w-6" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words text-base font-bold leading-snug">
          {seeMedalsLabel(w)}
          {freshSr && <span className="sr-only">{freshSr}</span>}
        </span>
        <span className="text-sm leading-snug opacity-80">{medalsHint(w)}</span>
      </span>
      {freshSr && <span aria-hidden="true" className={newChip}>Nuevo</span>}
      <span aria-hidden="true" className="shrink-0">→</span>
    </Link>
  );
}
