import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  type LucideIcon, Award, CalendarCheck, CalendarHeart, Check, ChevronDown, ChevronLeft, Footprints, Medal, RefreshCcw, Route, Star,
  Trophy,
} from "lucide-react";
import { CENTER } from "@/lib/center";
import { type FeedbackItemDTO, type GoalDTO, type MedalDTO, type WeekDTO, capitalize } from "@/lib/portal";
import { type PracticeWho, WEEKDAY_NAME, WEEKDAY_SHORT, authorName, ddmm, feedbackTitle } from "@/lib/practiceRules";
import { TONE_CLASS, card, newChip, pillOutline, pillPrimary } from "./styles";
import { FinishFlag } from "./icons";
import {
  type PracticeFailure, backToMedalsLabel, feedbackIsMessage, focusRing, isoDdmm, isoLongDay, medalTerms,
} from "./practiceFormat";

// Piezas de las pantallas de ejercicios, devoluciones y medallas (etapa B).
// Le hablan al adulto dueño de la cuenta; solo los pasos de cada ejercicio
// le hablan a quien practica. Todo estado se dice con texto: las tiras y los
// íconos son decorativos.

const backClass = "flex min-h-12 items-center gap-1 self-start rounded-full text-base font-bold text-primary";

export function BackToHome() {
  return (
    <Link to="/portal" className={`${backClass} ${focusRing}`}>
      <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Inicio
    </Link>
  );
}

export function BackToExercises({ patientId }: { patientId: string }) {
  return (
    <Link to="/portal/ejercicios/$patientId" params={{ patientId }} className={`${backClass} ${focusRing}`}>
      <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Volver a los ejercicios
    </Link>
  );
}

// A "Mis logros" / "Medallas de Martín" (w: null mientras carga)
export function BackToMedals({ patientId, w }: { patientId: string; w: PracticeWho | null }) {
  return (
    <Link to="/portal/medallas/$patientId" params={{ patientId }} className={`${backClass} ${focusRing}`}>
      <ChevronLeft className="h-5 w-5" aria-hidden="true" /> {w ? backToMedalsLabel(w) : "Volver"}
    </Link>
  );
}

// Lo que no se puede ver (mismos textos que "Mi información"; un solo texto
// neutro para todo lo que no está disponible, sin decir el motivo)
export function PracticeGate({ failure, onRetry, errorText }: {
  failure: PracticeFailure;
  onRetry: () => void;
  errorText: string;
}) {
  switch (failure.kind) {
    case "error":
      return (
        <div className={`${card} flex flex-col gap-3`} role="alert">
          <p className="text-base">{errorText}</p>
          <button type="button" onClick={onRetry} className={`${pillOutline} ${focusRing} min-[420px]:self-start`}>Reintentar</button>
        </div>
      );
    case "consent":
      return (
        <div className={`${card} flex flex-col gap-3`}>
          <p className="text-base">Para ver la información de salud, primero tenés que activarla.</p>
          <Link to="/portal/informacion-salud" className={`${pillPrimary} ${focusRing} min-[420px]:self-start`}>
            Activar la información de salud
          </Link>
        </div>
      );
    case "verify":
      return (
        <div className={`${card} flex flex-col gap-2`}>
          <p className="text-base">{failure.message}</p>
          <p className="text-base">Si sos mamá, papá o tutor/a, traé también la partida o el documento que lo acredite.</p>
          <p className="text-base text-muted-foreground">{CENTER.address} · {CENTER.hoursLong}</p>
        </div>
      );
    case "empty":
      return <p className={`${card} text-base`}>{failure.message}</p>;
  }
}

// Disclosure ("Para el adulto que acompaña")
export function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-muted px-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={open ? id : undefined}
        className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl text-left text-base font-bold text-[color:var(--primary-deep)] ${focusRing}`}>
        {title}
        <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && <div id={id} className="flex flex-col gap-3 pb-4">{children}</div>}
    </div>
  );
}

// La semana de lunes a domingo: la tira es solo visual (aria-hidden) y al
// lado va la misma información en una lista para lectores de pantalla. Un día
// sin práctica es "·": nunca en rojo ni "pendiente"
export function WeekStrip({ week }: { week: WeekDTO }) {
  return (
    <>
      <ol aria-hidden="true" className="grid grid-cols-7 gap-1.5">
        {week.days.map((d, i) => (
          <li key={d.date}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 ${
              d.today ? "border-primary bg-[color:var(--primary-soft)]" : "border-border/60 bg-card"}`}>
            <span className="text-sm font-bold text-muted-foreground">{WEEKDAY_SHORT[i]}</span>
            {d.practiced ? (
              <Check className="h-5 w-5 text-[oklch(0.42_0.12_150)]" strokeWidth={3} />
            ) : d.today ? (
              <span className="text-sm font-bold text-[color:var(--primary-deep)]">hoy</span>
            ) : (
              <span className="text-lg font-bold leading-5 text-muted-foreground">·</span>
            )}
          </li>
        ))}
      </ol>
      <ul className="sr-only">
        {week.days.map((d, i) => (
          <li key={d.date}>
            {WEEKDAY_NAME[i]}{d.today ? " (hoy)" : ""}: {d.practiced ? "con práctica" : d.future ? "todavía no llegó" : "sin práctica"}
          </li>
        ))}
      </ul>
    </>
  );
}

// Metas: "En camino" o "¡Lograda! · 10/10" (nunca "no cumplida") y, si hay,
// la medalla: la acordada ("La medalla al cumplirla: «…»") o, en las
// logradas, la que se dio ("Con la medalla «…»")
export function GoalList({ goals, w }: { goals: GoalDTO[]; w: PracticeWho }) {
  const t = medalTerms(w);
  return (
    <ul className="flex flex-col gap-2.5">
      {goals.map((g) => {
        const done = g.status === "lograda";
        const medal = g.medal_title
          ? done ? `Con ${t.the} «${g.medal_title}»` : `${capitalize(t.the)} al cumplirla: «${g.medal_title}»`
          : null;
        return (
          <li key={g.id} className={`flex min-h-12 items-start gap-3 rounded-2xl border-2 p-3.5 ${
            done ? "border-emerald-200 bg-emerald-50" : "border-sky-200 bg-white"}`}>
            <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              done ? "bg-emerald-600 text-white" : "bg-sky-100 text-sky-800"}`}>
              {done ? <FinishFlag className="h-5 w-5" /> : <Route className="h-5 w-5" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 break-words text-base font-semibold">{g.title}</span>
                <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-sm font-bold ${done ? TONE_CLASS.ok : TONE_CLASS.info}`}>
                  {done ? `¡Lograda!${g.achieved_at ? ` · ${isoDdmm(g.achieved_at)}` : ""}` : "En camino"}
                </span>
              </div>
              {!done && g.since && <span className="text-sm text-muted-foreground">En camino desde el {ddmm(g.since)}</span>}
              {!done && g.progress && <GoalProgressBar progress={g.progress} />}
              {medal && <span className="break-words text-sm text-muted-foreground">{medal}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Avance de una meta de práctica: cuenta los días hechos (la mejor ventana,
// nunca baja). Si ya están todos, lo celebra; la meta la cierra el profesional
function GoalProgressBar({ progress }: { progress: NonNullable<GoalDTO["progress"]> }) {
  const { days, target, weeks } = progress;
  const full = days >= target;
  const pct = target > 0 ? Math.round((days / target) * 100) : 0;
  const span = weeks === 1 ? "en una semana" : `en ${weeks} semanas`;
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={days}
        aria-label={`${days} de ${target} días de práctica`}
        className="h-3 w-full overflow-hidden rounded-full bg-sky-100">
        <div className={`h-full rounded-full ${full ? "bg-emerald-500" : "bg-linear-to-r from-sky-500 to-indigo-500"}`}
          style={{ width: `${Math.max(pct, days > 0 ? 6 : 0)}%` }} />
      </div>
      <span className="text-sm font-semibold">
        {full ? `¡Ya están los ${target} días! Tu profesional la va a revisar.` : `${days} de ${target} días de práctica (${span})`}
      </span>
    </div>
  );
}

// Una devolución del profesional, tal como la lee la familia (texto plano)
export function FeedbackCard({ item, w, level = 3 }: { item: FeedbackItemDTO; w: PracticeWho; level?: 2 | 3 }) {
  const id = useId();
  const t = medalTerms(w);
  const H = level === 2 ? "h2" : "h3";
  return (
    <article aria-labelledby={id} className={`${card} flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <H id={id} className="font-display text-lg font-bold leading-snug">{feedbackTitle(w, item.author_label)}</H>
          <p className="text-base text-muted-foreground">{isoLongDay(item.sent_at)}</p>
        </div>
        {/* "Nuevo" si se llama mensaje (hasta 12), "Nueva" si es una devolución */}
        {item.is_new && <span className={`${newChip} mt-0.5`}>{feedbackIsMessage(w) ? "Nuevo" : "Nueva"}</span>}
      </div>
      <p className="whitespace-pre-line break-words text-base">{item.body}</p>
      {item.for_adult && (
        <p className="whitespace-pre-line break-words rounded-2xl bg-muted px-4 py-3 text-base">
          <b>Para el adulto que acompaña:</b> {item.for_adult}
        </p>
      )}
      {item.medal_title && (
        <p className="flex items-start gap-2 text-base font-semibold">
          <Award className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span>Te dio {t.the} «{item.medal_title}»</span>
        </p>
      )}
      {item.goals_achieved.length > 0 && (
        <ul className="flex flex-col gap-1">
          {item.goals_achieved.map((g) => (
            <li key={g} className="flex items-start gap-2 text-base">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-[oklch(0.42_0.12_150)]" aria-hidden="true" />
              <span>Meta lograda: «{g}»</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// Cómo se ve cada medalla: un ícono y su color (el nombre siempre va
// escrito; el color es solo decoración). Las de prácticas van de bronce a
// oro. Las clases van completas: Tailwind no ve clases armadas por partes.
type MedalLook = { icon: LucideIcon; disc: string; ribbon: string; tile: string; text: string };
const MEDAL_LOOK: Record<string, MedalLook> = {
  primer_paso: { icon: Footprints, disc: "from-emerald-400 to-emerald-700", ribbon: "bg-emerald-600", tile: "border-emerald-200 bg-emerald-50", text: "text-emerald-950" },
  semana_cumplida: { icon: CalendarCheck, disc: "from-sky-400 to-sky-700", ribbon: "bg-sky-600", tile: "border-sky-200 bg-sky-50", text: "text-sky-950" },
  un_mes: { icon: CalendarHeart, disc: "from-violet-400 to-violet-700", ribbon: "bg-violet-600", tile: "border-violet-200 bg-violet-50", text: "text-violet-950" },
  de_vuelta: { icon: RefreshCcw, disc: "from-teal-400 to-teal-700", ribbon: "bg-teal-600", tile: "border-teal-200 bg-teal-50", text: "text-teal-950" },
  practicas_10: { icon: Star, disc: "from-orange-400 to-orange-700", ribbon: "bg-orange-600", tile: "border-orange-200 bg-orange-50", text: "text-orange-950" },
  practicas_25: { icon: Star, disc: "from-slate-300 to-slate-600", ribbon: "bg-slate-500", tile: "border-slate-200 bg-slate-50", text: "text-slate-900" },
  practicas_50: { icon: Trophy, disc: "from-yellow-300 to-amber-600", ribbon: "bg-amber-500", tile: "border-amber-200 bg-amber-50", text: "text-amber-950" },
  profesional: { icon: Award, disc: "from-rose-400 to-fuchsia-700", ribbon: "bg-fuchsia-600", tile: "border-fuchsia-200 bg-fuchsia-50", text: "text-fuchsia-950" },
};
const DEFAULT_LOOK: MedalLook = {
  icon: Medal, disc: "from-sky-400 to-blue-700", ribbon: "bg-blue-600", tile: "border-sky-200 bg-sky-50", text: "text-sky-950",
};
const lookOf = (code: string) => MEDAL_LOOK[code] ?? DEFAULT_LOOK;

// La medalla dibujada: un disco de color con borde blanco y dos cintas.
// locked: la que todavía no se ganó (gris y con línea punteada)
export function MedalIcon({ code, className = "h-7 w-7", size = "md", locked = false }: {
  code: string; className?: string; size?: "sm" | "md" | "lg"; locked?: boolean;
}) {
  const look = lookOf(code);
  const Icon = look.icon;
  const box = size === "lg" ? "h-20 w-20" : size === "sm" ? "h-11 w-11" : "h-16 w-16";
  return (
    <span aria-hidden="true" className={`relative inline-flex shrink-0 justify-center ${size === "sm" ? "pb-1.5" : "pb-5"}`}>
      {!locked && size !== "sm" && (
        <>
          <span className={`absolute bottom-0 left-1/2 h-10 w-4 -translate-x-[100%] rotate-[14deg] rounded-b-sm ${look.ribbon}`} />
          <span className={`absolute bottom-0 left-1/2 h-10 w-4 translate-x-[0%] -rotate-[14deg] rounded-b-sm ${look.ribbon}`} />
        </>
      )}
      <span className={[
        "relative flex items-center justify-center rounded-full",
        box,
        locked
          ? "border-2 border-dashed border-slate-300 bg-slate-100 text-slate-400"
          : `bg-linear-to-br ${look.disc} text-white shadow-lg ring-4 ring-white`,
      ].join(" ")}>
        <Icon className={className} strokeWidth={2.25} />
      </span>
    </span>
  );
}

// Una medalla en la grilla: "Ganada el 10/10", "Ganada 4 veces" o "Te la dio
// Lic. Ana Torres" con su frase. Cada una con su color
export function MedalTile({ medal, w }: { medal: MedalDTO; w: PracticeWho }) {
  const t = medalTerms(w);
  const look = lookOf(medal.code);
  const pro = medal.kind === "profesional";
  const line = pro && medal.by
    ? `${t.gaveYou} ${authorName(medal.by)}`
    : medal.times > 1 ? `${t.won} ${medal.times} veces` : `${t.won} el ${isoDdmm(medal.awarded_at)}`;
  return (
    <li className={`relative flex min-w-0 flex-col items-center gap-2 rounded-3xl border-2 px-3 pb-4 pt-5 text-center shadow-sm ${look.tile} ${look.text}`}>
      {medal.is_new && <span className={`${newChip} absolute right-2 top-2`}>{t.fresh}</span>}
      <MedalIcon code={medal.code} size="lg" className="h-9 w-9" />
      <span className="break-words font-display text-base font-bold leading-snug">{medal.title}</span>
      {medal.times > 1 && !pro && (
        <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-sm font-extrabold">× {medal.times}</span>
      )}
      <span className="text-sm leading-snug">{line}</span>
      {pro && medal.message && <span className="break-words text-sm italic leading-snug">«{medal.message}»</span>}
      {pro && medal.goal_title && <span className="break-words text-sm leading-snug">Meta: «{medal.goal_title}»</span>}
    </li>
  );
}

// "Para seguir sumando": la medalla que viene, en gris, con lo que falta.
// Si el texto dice "llevás 3 de 5", una barrita muestra cuánto se practicó
// (cuenta lo hecho, nunca lo que falta para que se venza nada)
export function MedalNextTile({ code, title, text }: { code: string; title: string; text: string }) {
  const m = /(\d+) de (\d+)/.exec(text);
  const done = m ? Math.min(Number(m[1]), Number(m[2])) : null;
  const total = m ? Number(m[2]) : null;
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-2xl border border-dashed border-border bg-card/80 p-3">
      <MedalIcon code={code} size="sm" locked className="h-5 w-5" />
      <div className="min-w-0 flex-1">
        <p className="text-base"><b>{title}</b> · {text}</p>
        {done !== null && total ? (
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className={`h-full rounded-full bg-linear-to-r ${lookOf(code).disc}`} style={{ width: `${Math.round((done / total) * 100)}%` }} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
