import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type LucideIcon, Info, Loader2, MessageCircleHeart, Route as RouteIcon, Trophy } from "lucide-react";
import { FinishFlag } from "@/components/portal/icons";
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

// Lo que se ve abajo: el resumen de arriba funciona como selector. Arranca en
// los logros o, si hay un mensaje nuevo del profesional, en las devoluciones
type View = "logros" | "en_camino" | "logradas" | "devoluciones";

type LogrosData = { medals: MedalsDTO; feedback: FeedbackDTO };

function LogrosPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<LogrosData | null>(null);
  const [failure, setFailure] = useState<PracticeFailure | null>(null);
  // Respuesta de la última carga (si se cambia de persona, lo viejo no pisa lo nuevo)
  const seq = useRef(0);
  const [view, setView] = useState<View | null>(null);

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
  const current: View = view ?? (data?.feedback.items.some((f) => f.is_new) ? "devoluciones" : "logros");
  // Las devoluciones quedan vistas solo cuando se eligió verlas
  useFeedbackSeen(useOnScreen(feedbackRef, current === "devoluciones" ? shown : null));

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
        {current !== "devoluciones" && <NewFeedbackJump feedback={feedback} onGo={() => setView("devoluciones")} />}
      </div>
      <SummaryBanner medals={medals} feedback={feedback} view={current} onView={setView} />
      <div role="tabpanel" id="logros-detalle" aria-labelledby={`resumen-${current}`}>
        {current === "logros" && <MedalsSection medals={medals} />}
        {current === "en_camino" && <GoalsSection medals={medals} which="activa" />}
        {current === "logradas" && <GoalsSection medals={medals} which="lograda" />}
        {current === "devoluciones" && <FeedbackSection feedback={feedback} shown={shown} sectionRef={feedbackRef} />}
      </div>
    </div>
  );
}

// Resumen de arriba: cuánto se sumó (cuenta lo hecho, nunca lo que falta).
// Cada cuadrito es una pestaña: muestra abajo lo que se elige. Con teclado,
// las flechas pasan de una a otra
function SummaryBanner({ medals, feedback, view, onView }: {
  medals: MedalsDTO; feedback: FeedbackDTO; view: View; onView: (v: View) => void;
}) {
  const t = medalTerms(whoOf(medals.child));
  const won = medals.earned.reduce((s, m) => s + Math.max(1, m.times), 0);
  const active = medals.goals.filter((g) => g.status !== "lograda").length;
  const done = medals.goals.length - active;
  const message = feedbackIsMessage(whoOf(feedback.child));
  const freshFb = feedback.items.some((f) => f.is_new);
  const stats: { view: View; icon: LucideIcon; value: number; label: string; fresh?: boolean }[] = [
    { view: "logros", icon: Trophy, value: won, label: won === 1 ? t.a.replace(/^un[a]? /, "") : t.many },
    { view: "en_camino", icon: RouteIcon, value: active, label: active === 1 ? "meta en camino" : "metas en camino" },
    { view: "logradas", icon: FinishFlag, value: done, label: done === 1 ? "meta lograda" : "metas logradas" },
    { view: "devoluciones", icon: MessageCircleHeart, value: feedback.items.length, fresh: freshFb,
      label: message ? (feedback.items.length === 1 ? "mensaje" : "mensajes") : (feedback.items.length === 1 ? "devolución" : "devoluciones") },
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: React.KeyboardEvent, i: number) {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + stats.length) % stats.length;
    onView(stats[next].view);
    refs.current[next]?.focus();
  }
  return (
    <section aria-label="Resumen" className="overflow-hidden rounded-3xl bg-linear-to-r from-sky-700 via-indigo-700 to-violet-700 p-5 text-white shadow-[var(--shadow-elegant)] sm:p-6">
      <p className="font-display text-lg font-bold sm:text-xl">Cada práctica suma. ¡A seguir así!</p>
      <p className="mt-1 text-sm text-white/90">Tocá una opción para ver el detalle.</p>
      <div role="tablist" aria-label="Qué querés ver" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s, i) => {
          const on = view === s.view;
          return (
            <button key={s.view} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`resumen-${s.view}`}
              aria-selected={on} aria-controls="logros-detalle" tabIndex={on ? 0 : -1}
              onClick={() => onView(s.view)} onKeyDown={(e) => onKey(e, i)}
              className={[
                "relative flex min-h-16 items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300",
                on ? "bg-white text-indigo-900 shadow-lg ring-2 ring-white" : "bg-white/15 hover:bg-white/25",
              ].join(" ")}>
              <s.icon className="h-6 w-6 shrink-0" aria-hidden="true" />
              <span className="leading-tight">
                <span className="block font-display text-2xl font-extrabold">{s.value}</span>
                <span className="text-sm font-semibold">{s.label}</span>
              </span>
              {s.fresh && <span className="absolute right-2 top-2 rounded-full bg-amber-300 px-2 py-0.5 text-xs font-bold text-amber-950">Nuevo</span>}
            </button>
          );
        })}
      </div>
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
function NewFeedbackJump({ feedback, onGo }: { feedback: FeedbackDTO; onGo: () => void }) {
  const fresh = feedback.items.filter((f) => f.is_new).length;
  if (fresh === 0) return null;
  const message = feedbackIsMessage(whoOf(feedback.child));
  const text = message
    ? (fresh === 1 ? "Hay un mensaje nuevo" : "Hay mensajes nuevos")
    : (fresh === 1 ? "Hay una devolución nueva" : "Hay devoluciones nuevas");
  // Abre la pestaña de devoluciones y lleva el foco a su título
  function go() {
    onGo();
    requestAnimationFrame(() => {
      const title = document.getElementById("devoluciones-titulo");
      title?.scrollIntoView({ block: "start" });
      title?.focus({ preventScroll: true });
    });
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

// 2. Metas: las que están en camino (con su avance) o las ya logradas
function GoalsSection({ medals, which }: { medals: MedalsDTO; which: "activa" | "lograda" }) {
  const w = whoOf(medals.child);
  const goals = medals.goals.filter((g) => g.status === which);
  const active = which === "activa";
  const empty = medals.goals.length === 0
    ? "Todavía no hay metas. Cuando las acuerden con tu profesional, las vas a ver acá."
    : active ? "Ahora no hay metas en camino. Las nuevas que acuerden con tu profesional van a aparecer acá."
    : "Las metas que se vayan cumpliendo van a quedar guardadas acá.";
  return (
    <SectionCard id="metas-titulo" icon={active ? RouteIcon : FinishFlag}
      tone={active ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"}
      title={active ? "Metas en camino" : "Metas logradas"}>
      {goals.length === 0 ? (
        <p className="rounded-2xl bg-muted/70 px-4 py-3 text-base">{empty}</p>
      ) : (
        <>
          <GoalList goals={goals} w={w} />
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
