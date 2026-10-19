import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type LucideIcon, Info, Loader2, MessageCircleHeart, Sparkles, Target, Trophy } from "lucide-react";
import { type FeedbackDTO, type FeedbackItemDTO, type MedalsDTO, capitalize, portalApi } from "@/lib/portal";
import { PRACTICE_TEXT, breakLine, feedbackNoReply, medalsIntro, medalsTitle } from "@/lib/practiceRules";
import { BackToHome, FeedbackCard, GoalList, MedalNextTile, MedalTile, PracticeGate } from "@/components/portal/PracticeParts";
import {
  type PracticeFailure, feedbackIsMessage, focusRing, logrosFailure, medalTerms, seenBatches, useFeedbackSeen, whoOf,
} from "@/components/portal/practiceFormat";
import { PageTitle } from "@/components/portal/ui";
import { TONE_CLASS } from "@/components/portal/styles";

// "Mis logros" / "Medallas de Martín" / "Logros de Fernanda": todo lo que
// suma en un solo lugar, con un plan publicado o sin él (lo que se ganó y se
// logró no se pierde al cerrarse un plan). Se abre desde el Inicio, desde la
// celebración y desde los ejercicios. Tres partes, en el orden del título y
// de los botones que llevan acá, cada una con su estado vacío:
//   1. Medallas: las ganadas (grilla de 2 columnas con el nombre siempre
//      escrito) y "Para seguir sumando", sin cuentas regresivas ni "se te
//      vence". No se pierden nunca. Las nuevas quedan vistas al abrir la
//      página (así no vuelven a celebrarse).
//   2. Metas: las activas ("En camino") y las logradas (cuándo y, si hubo, la
//      medalla). Son de práctica y de animarse: no miden cómo habla.
//   3. Devoluciones ("Mensajes de tu profesional" hasta los 12): las 2 más
//      nuevas enteras y "Ver todas" con las demás. Si hay alguna nueva, un
//      acceso arriba lleva hasta ellas. Quedan vistas solo las que se
//      mostraron enteras, cuando la sección aparece en pantalla.
// Nada se muestra si la regla de acceso no da "ok" para esta cuenta (el
// servidor contesta igual que en los ejercicios, sin decir el motivo; acá,
// con textos que no nombran los ejercicios: también se ve sin plan).

export const Route = createFileRoute("/portal/medallas/$patientId")({
  component: LogrosPage,
});

// Devoluciones que se muestran enteras (las demás, en "Ver todas")
const FEEDBACK_SHOWN = 2;

type LogrosData = { medals: MedalsDTO; feedback: FeedbackDTO };

function LogrosPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<LogrosData | null>(null);
  const [failure, setFailure] = useState<PracticeFailure | null>(null);
  // Respuesta de la última carga (si se cambia de persona, lo viejo no pisa lo nuevo)
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setFailure(null);
    setData(null);
    const [m, f] = await Promise.all([portalApi.medals(patientId), portalApi.feedback(patientId)]);
    if (n !== seq.current) return;
    const failed = (r: { status: number; code?: string; error: string }) => {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: `/portal/medallas/${patientId}` }, replace: true });
        return;
      }
      setFailure(logrosFailure(r));
    };
    if (!m.ok) return failed(m);
    if (!f.ok) return failed(f);
    setData({ medals: m.data, feedback: f.data });
    // Las medallas nuevas ya se vieron (la marca "Nueva" queda hasta la
    // próxima vez). Una tarjeta agrupada ("Ganada 4 veces") trae el id de la
    // más nueva y es nueva si alguna del grupo no se vio: el servidor marca
    // todo el grupo
    const fresh = m.data.earned.filter((x) => x.is_new).map((x) => x.id);
    for (const ids of seenBatches(fresh)) void portalApi.medalsSeen(ids).catch(() => undefined);
  }, [patientId, navigate]);

  useEffect(() => { void load(); }, [load]);

  // Solo las devoluciones que se ven enteras quedan vistas, cuando su sección
  // (al final de la página) aparece en pantalla
  const shown = useMemo(() => (data ? data.feedback.items.slice(0, FEEDBACK_SHOWN) : null), [data]);
  const feedbackRef = useRef<HTMLElement>(null);
  useFeedbackSeen(useOnScreen(feedbackRef, shown));

  if (failure || !data || !shown) {
    return (
      <div className="flex flex-col gap-4">
        <BackToHome />
        {failure ? (
          <>
            {/* Sin datos no se sabe a quién se le habla: un título que vale para todos */}
            <PageTitle>Metas</PageTitle>
            <PracticeGate failure={failure} onRetry={() => void load()}
              errorText="No pudimos cargar esta página. Probá de nuevo en un rato." />
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

  const { medals, feedback } = data;
  const w = whoOf(medals.child);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <BackToHome />
        <PageTitle>{medalsTitle(w)}</PageTitle>
        <NewFeedbackJump feedback={feedback} />
      </div>
      <SummaryBanner medals={medals} feedback={feedback} />
      {/* En la compu, dos columnas: las medallas a un lado; metas y devoluciones al otro */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <MedalsSection medals={medals} />
        <div className="flex flex-col gap-6">
          <GoalsSection medals={medals} />
          <FeedbackSection feedback={feedback} shown={shown} sectionRef={feedbackRef} />
        </div>
      </div>
    </div>
  );
}

// Resumen de arriba: cuánto se sumó (cuenta lo hecho, nunca lo que falta)
function SummaryBanner({ medals, feedback }: { medals: MedalsDTO; feedback: FeedbackDTO }) {
  const t = medalTerms(whoOf(medals.child));
  const won = medals.earned.reduce((s, m) => s + Math.max(1, m.times), 0);
  const active = medals.goals.filter((g) => g.status !== "lograda").length;
  const done = medals.goals.length - active;
  const message = feedbackIsMessage(whoOf(feedback.child));
  const stats: { icon: LucideIcon; value: number; label: string }[] = [
    { icon: Trophy, value: won, label: won === 1 ? t.a.replace(/^un[a]? /, "") : t.many },
    { icon: Target, value: active, label: active === 1 ? "meta en camino" : "metas en camino" },
    { icon: Sparkles, value: done, label: done === 1 ? "meta lograda" : "metas logradas" },
    { icon: MessageCircleHeart, value: feedback.items.length, label: message ? (feedback.items.length === 1 ? "mensaje" : "mensajes") : (feedback.items.length === 1 ? "devolución" : "devoluciones") },
  ];
  return (
    <section aria-label="Resumen" className="overflow-hidden rounded-3xl bg-linear-to-r from-sky-700 via-indigo-700 to-violet-700 p-5 text-white shadow-[var(--shadow-elegant)] sm:p-6">
      <p className="font-display text-lg font-bold sm:text-xl">Cada práctica suma. ¡A seguir así!</p>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <li key={s.label} className="flex items-center gap-3 rounded-2xl bg-white/15 px-3 py-3">
            <s.icon className="h-6 w-6 shrink-0" aria-hidden="true" />
            <span className="leading-tight">
              <span className="block font-display text-2xl font-extrabold">{s.value}</span>
              <span className="text-sm">{s.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Cada parte en su tarjeta, con un ícono de color para ubicarla de un vistazo
function SectionCard({ id, icon: Icon, tone, title, action, children, sectionRef, titleFocus = false }: {
  id: string; icon: LucideIcon; tone: string; title: string; action?: React.ReactNode; children: React.ReactNode;
  sectionRef?: RefObject<HTMLElement | null>; titleFocus?: boolean;
}) {
  return (
    <section ref={sectionRef} aria-labelledby={id} className="flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/95 p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className={`flex h-11 w-11 items-center justify-center rounded-2xl ${tone}`}>
            <Icon className="h-6 w-6" />
          </span>
          {/* El de devoluciones es destino del acceso de arriba: recibe el foco y no queda debajo del encabezado fijo */}
          <h2 id={id} tabIndex={titleFocus ? -1 : undefined}
            className="scroll-mt-24 font-display text-xl font-bold text-[color:var(--primary-deep)] outline-none">
            {title}
          </h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// shown, recién cuando el elemento aparece en pantalla (null hasta entonces y
// mientras carga). Sin IntersectionObserver, enseguida
function useOnScreen(ref: RefObject<HTMLElement | null>, shown: FeedbackItemDTO[] | null): FeedbackItemDTO[] | null {
  const [onScreen, setOnScreen] = useState<FeedbackItemDTO[] | null>(null);
  useEffect(() => {
    if (!shown) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOnScreen(shown);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      setOnScreen(shown);
      io.disconnect();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, shown]);
  return onScreen === shown ? shown : null;
}

// Las devoluciones van al final: si hay alguna nueva, un acceso arriba lleva
// hasta ellas ("Hay un mensaje nuevo ↓"; sin el número)
function NewFeedbackJump({ feedback }: { feedback: FeedbackDTO }) {
  const fresh = feedback.items.filter((f) => f.is_new).length;
  if (fresh === 0) return null;
  const message = feedbackIsMessage(whoOf(feedback.child));
  const text = message
    ? (fresh === 1 ? "Hay un mensaje nuevo" : "Hay mensajes nuevos")
    : (fresh === 1 ? "Hay una devolución nueva" : "Hay devoluciones nuevas");
  function go() {
    const title = document.getElementById("devoluciones-titulo");
    title?.scrollIntoView({ block: "start" });
    title?.focus({ preventScroll: true });
  }
  return (
    <button type="button" onClick={go}
      className={`-mt-6 inline-flex min-h-12 items-center self-start rounded-full text-base font-bold text-primary underline-offset-2 hover:underline ${focusRing}`}>
      {text}<span aria-hidden="true">&nbsp;↓</span>
    </button>
  );
}

// 3. Devoluciones: las más nuevas enteras y "Ver todas · 1 nueva →" si hay más
function FeedbackSection({ feedback, shown, sectionRef }: {
  feedback: FeedbackDTO; shown: FeedbackDTO["items"]; sectionRef: RefObject<HTMLElement | null>;
}) {
  const w = whoOf(feedback.child);
  const message = feedbackIsMessage(w);
  const rest = feedback.items.slice(shown.length);
  const restNew = rest.filter((f) => f.is_new).length;
  const restNewText = restNew > 0
    ? ` · ${restNew} ${message ? (restNew === 1 ? "nuevo" : "nuevos") : (restNew === 1 ? "nueva" : "nuevas")}`
    : "";
  return (
    <SectionCard id="devoluciones-titulo" icon={MessageCircleHeart} tone="bg-sky-100 text-sky-800" sectionRef={sectionRef} titleFocus
      title={message ? "Mensajes de tu profesional" : "Devoluciones"}
      action={rest.length > 0 && (
        <Link to="/portal/devoluciones/$patientId" params={{ patientId: feedback.child.id }}
          className={`inline-flex min-h-12 items-center rounded-full text-base font-bold text-primary underline-offset-2 hover:underline ${focusRing}`}>
          {message ? "Ver todos" : "Ver todas"}
          <span className="sr-only"> {message ? "los mensajes" : "las devoluciones"}</span>
          {restNewText}&nbsp;→
        </Link>
      )}>
      {shown.length === 0 ? (
        <p className="rounded-2xl bg-muted/70 px-4 py-3 text-base">
          {message
            ? "Todavía no hay mensajes. Cuando tu profesional escriba uno, lo vas a ver acá."
            : "Todavía no hay devoluciones. Cuando tu profesional escriba una, la vas a ver acá."}
        </p>
      ) : (
        <>
          {shown.map((f) => <FeedbackCard key={f.id} item={f} w={w} />)}
          <p className="text-base text-muted-foreground">{feedbackNoReply(feedback.has_plan)}</p>
        </>
      )}
    </SectionCard>
  );
}

// 2. Metas: activas y logradas
function GoalsSection({ medals }: { medals: MedalsDTO }) {
  const w = whoOf(medals.child);
  return (
    <SectionCard id="metas-titulo" icon={Target} tone="bg-emerald-100 text-emerald-800" title="Metas">
      {medals.goals.length === 0 ? (
        <p className="rounded-2xl bg-muted/70 px-4 py-3 text-base">Todavía no hay metas. Cuando las acuerden con tu profesional, las vas a ver acá.</p>
      ) : (
        <>
          <GoalList goals={medals.goals} w={w} />
          <p className="text-base text-muted-foreground">{PRACTICE_TEXT.goals_note}</p>
        </>
      )}
    </SectionCard>
  );
}

// 1. Medallas: las ganadas y "Para seguir sumando" (o la pausa de vacaciones)
function MedalsSection({ medals }: { medals: MedalsDTO }) {
  const w = whoOf(medals.child);
  const t = medalTerms(w);
  const intro = medalsIntro(medals.author_label);
  return (
    <SectionCard id="medallas-titulo" icon={Trophy} tone="bg-amber-100 text-amber-800" title={capitalize(t.many)}>
      {medals.earned.length === 0 ? (
        <p className="rounded-2xl bg-muted/70 px-4 py-3 text-base">Todavía no hay {t.many}. {intro}</p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {medals.earned.map((m) => <MedalTile key={m.id} medal={m} w={w} />)}
          </ul>
          <p className="text-base text-muted-foreground">{intro}</p>
        </>
      )}

      {/* En la pausa de vacaciones no se cuenta nada: la línea de la pausa en
          lugar de "Para seguir sumando" (que llega vacío) */}
      {medals.on_break_until ? (
        <p className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-base font-semibold ${TONE_CLASS.info}`}>
          <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{breakLine(medals.on_break_until)}</span>
        </p>
      ) : medals.next.length > 0 && (
        <div className="mt-2 flex flex-col gap-3">
          <h3 className="font-display text-lg font-bold">Para seguir sumando</h3>
          <ul className="flex flex-col gap-2">
            {medals.next.map((n) => <MedalNextTile key={n.code} code={n.code} title={n.title} text={n.text} />)}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}
