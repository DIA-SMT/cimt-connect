import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Award, Check, ChevronDown, Loader2, Plus, ShieldAlert, Target, TriangleAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectClass } from "../fields";
import { centerDateOf } from "@/lib/portalRules";
import {
  type FeedbackWithdrawReason, type GoalKind, type PracticeAction, type PracticeResult, type StaffFeedbackDTO,
  type StaffGoalDTO, type StaffGridCell, type StaffMedalDTO, type StaffNoteDTO, type StaffPracticeDTO,
  type StaffPracticePending,
  CONSTANCY_MEDAL_NAME, FEEDBACK_CHIPS, FEEDBACK_WITHDRAW_REASONS, FLUENCY_TITLE_MESSAGE, PRACTICE_ERROR, PRACTICE_LIMITS,
  PRO_MEDAL_SUGGESTIONS, RESULT_LABEL_STAFF, STAFF_PRACTICE_TEXT, WEEKDAY_NAME, WEEKDAY_SHORT, WITHDRAW_REASON_LABEL,
  blockForTitles, centerToday, dayIndex, ddmm, feedbackGuide, goalMetLine, goalRuleText, isConstancyCode, isDateKey,
  joinNames, lintPracticeText, onBreak, validateFeedback, validateGoal,
} from "@/lib/practiceRules";
import { type UnsavedPart, forgetUnsaved, keepUnsaved, peekUnsaved } from "./practiceHandoff";

// "Prácticas y devoluciones" y "Metas y medallas" dentro de "Portal del
// paciente" (etapa practice, diseño §3.5 y §3.6). Los arma
// PortalPracticeSection.tsx (que trae los datos y manda las acciones) y la
// bandeja (Portal → Prácticas) usa la misma vista de prácticas.
//   - Prácticas: resumen, grilla de los últimos 14 días con el "¿Cómo te
//     fue?" de cada adulto, comentarios de la familia (los de riesgo en rojo
//     y arriba: "Revisar hoy"), la devolución y las devoluciones anteriores.
//   - Metas y medallas: metas (borrador → activa → lograda | cambiada), avisos
//     de metas cumplidas y el medallero. No hay medalla sin devolución: "Dar
//     la medalla" abre la devolución con la medalla cargada.
// Administración ve estados, no textos (los textos llegan en null). Las reglas
// están en practiceRules.ts y el servidor vuelve a controlar todo. Los
// comentarios de la familia nunca van a la consola ni a la IA.

type SendResult = { ok: true; data: StaffPracticeDTO } | { ok: false; status: number; error: string; code?: string };

export type FollowupProps = {
  data: StaffPracticeDTO;
  busy: boolean;
  /** Manda la acción y, si sale bien, deja `data` con la respuesta (la vista actualizada) */
  send: (body: PracticeAction) => Promise<SendResult>;
  reload: () => Promise<void>;
  /** En la ficha: cambios sin guardar (la devolución a medio escribir). En la bandeja no se pasa */
  onDirty?: (part: UnsavedPart, dirty: boolean) => void;
  /** En la ficha: quién usa el panel (practiceHandoff.unsavedOwner); lo sin guardar queda aparte solo para esa persona */
  owner?: string | null;
};

type UiError = { message: string; stale: boolean }; // stale: otra persona lo cambió (409)
const uiError = (r: { status: number; error: string }): UiError => ({ message: r.error, stale: r.status === 409 });

// La devolución puede abrirse con metas tildadas y una medalla cargada
type Preset = { goalIds: string[]; medal: { title: string; goalId: string | null } | null };

const L = PRACTICE_LIMITS;

type Tone = "ok" | "warn" | "bad" | "info" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-[color:var(--status-available-bg)] text-[oklch(0.42_0.12_150)]",
  warn: "bg-[color:var(--status-pending-bg)] text-[oklch(0.45_0.11_70)]",
  bad: "bg-[color:var(--status-occupied-bg)] text-[oklch(0.48_0.19_25)]",
  info: "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]",
  muted: "bg-muted text-muted-foreground",
};
const PENDING_TEXT = "text-[oklch(0.45_0.11_70)]";
const BAD_TEXT = "text-[oklch(0.48_0.19_25)]";
const ERROR_BOX = "rounded-xl bg-[color:var(--status-occupied-bg)] px-3 py-2 text-sm font-semibold text-[oklch(0.48_0.19_25)]";
const WARN_BOX = "rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm text-[oklch(0.42_0.1_70)]";
const PILL_BTN = "h-8 rounded-full";
const TITLE = "font-display text-2xl text-[color:var(--primary-deep)]";
const REVIEW_NEEDED = "Corregí el texto o tocá «Lo dejo así» y contá por qué.";

// Colores de la grilla ("Me costó" no es rojo: el rojo es solo para riesgo)
const RESULT_DOT: Record<PracticeResult, string> = {
  bien: "bg-[oklch(0.62_0.14_150)]",
  mas_o_menos: "bg-[oklch(0.78_0.14_80)]",
  costo: "bg-[oklch(0.55_0.16_300)]",
};
const RESULT_TONE: Record<PracticeResult, Tone> = { bien: "ok", mas_o_menos: "warn", costo: "info" };

// ── Fechas y textos ─────────────────────────────────────────────────────────

// ISO o AAAA-MM-DD → dd/mm (día del centro)
function day(s: string): string {
  return ddmm(isDateKey(s) ? s : centerDateOf(s));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "5 prácticas nuevas" "1 comentario" "Me costó: 1"
function pendingParts(p: StaffPracticePending): string[] {
  const out: string[] = [];
  if (p.logs) out.push(plural(p.logs, "práctica nueva", "prácticas nuevas"));
  if (p.comments) out.push(plural(p.comments, "comentario", "comentarios"));
  if (p.costo) out.push(`Me costó: ${p.costo}`);
  return out;
}

// Algo sin ver: lo que pone al paciente en Portal → Prácticas
const hasPending = (p: StaffPracticePending) => p.logs + p.comments + p.costo + p.risk > 0;

function goalLabel(g: Pick<StaffGoalDTO, "title" | "kind">): string {
  return g.title ?? (g.kind === "practica" ? "Meta de práctica" : "Meta terapéutica");
}

function medalName(m: StaffMedalDTO): string {
  return m.title ?? (isConstancyCode(m.code) ? CONSTANCY_MEDAL_NAME[m.code] : "Medalla del profesional");
}

// "La vio María el 09/10 · La vio Juan el 10/10"
function readsLine(reads: { name: string; at: string }[]): string | null {
  return reads.length ? reads.map((x) => `La vio ${x.name} el ${day(x.at)}`).join(" · ") : null;
}

// Una medalla del profesional por meta (la base no deja dar otra mientras siga vigente)
function hasProMedal(data: StaffPracticeDTO, goalId: string): boolean {
  return data.medals.some((m) => m.kind === "profesional" && m.goal_id === goalId && !m.voided_at);
}

function progressText(g: StaffGoalDTO): string | null {
  if (g.status !== "activa" || !g.progress) return null;
  const pr = g.progress;
  return pr.met && pr.met_on
    ? `La cumplió el ${day(pr.met_on)}`
    : `Lleva ${pr.days} de ${pr.target} ${pr.target === 1 ? "día" : "días"}`;
}

function lintAll(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    const r = lintPracticeText(t);
    for (const x of [...r.block, ...r.review]) if (!out.includes(x)) out.push(x);
  }
  return out;
}

// ═══ Prácticas y devoluciones ═══════════════════════════════════════════════

export function PortalPracticeFollowup({ data, busy, send, reload, onDirty, owner = null }: FollowupProps) {
  const titleId = useId();
  const today = data.grid.dates[data.grid.dates.length - 1] ?? centerToday();
  // Comentarios con palabras de riesgo que nadie revisó: arriba de todo
  const urgent = useMemo(() => data.notes.filter((n) => n.risk && n.is_new && n.comment), [data.notes]);

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-2xl border border-border/60 p-4">
      <h4 id={titleId} className="text-sm font-bold">Prácticas y devoluciones</h4>

      {data.can_edit && urgent.length > 0 && <RiskNotes notes={urgent} />}
      <Summary data={data} today={today} />
      <PracticeGrid data={data} />

      {data.can_edit ? (
        <>
          <Comments notes={data.notes.filter((n) => !urgent.includes(n))} />
          <Block title="Devolución para la familia">
            <FeedbackComposer data={data} busy={busy} send={send} reload={reload} showSeen
              keepAs={onDirty ? "feedback" : undefined} owner={owner} onDirty={onDirty} />
          </Block>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{STAFF_PRACTICE_TEXT.admin_readonly}</p>
      )}

      <FeedbackHistory data={data} busy={busy} send={send} reload={reload} />
      <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">{STAFF_PRACTICE_TEXT.internal_use}</p>
    </section>
  );
}

function Summary({ data, today }: { data: StaffPracticeDTO; today: string }) {
  const plan = data.published;
  const parts = pendingParts(data.pending);
  return (
    <div className="space-y-1 text-sm">
      <p className="font-semibold">{data.summary.text}</p>
      {!plan && (
        <p className="text-muted-foreground">
          No hay un plan publicado en el portal.
          {data.can_edit && hasPending(data.pending) ? " Lo que anotaron antes sigue acá: marcalo como visto para que salga de la bandeja." : ""}
        </p>
      )}
      {parts.length > 0 && (
        <p>
          Sin ver: {parts.join(" · ")}
          {data.pending.since ? ` · desde el ${day(data.pending.since)}` : ""}
        </p>
      )}
      {data.pending.stale && (
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${PENDING_TEXT}`}>
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Pasaron 7 días o más sin revisar las prácticas.
        </p>
      )}
      {plan?.on_break_until && onBreak(plan.on_break_until, today) && (
        <p className={`text-xs font-semibold ${PENDING_TEXT}`}>Pausa de vacaciones: vuelve el {day(plan.on_break_until)}.</p>
      )}
      {plan?.last_reviewed_at && (
        <p className="text-xs text-muted-foreground">
          Último «Visto» el {day(plan.last_reviewed_at)}{plan.last_reviewed_by_email ? ` por ${plan.last_reviewed_by_email}` : ""}.
        </p>
      )}
    </div>
  );
}

// ── Grilla de los últimos 14 días ───────────────────────────────────────────

function cellText(c: StaffGridCell): string {
  const parts = [c.logged_by ? `La anotó ${c.logged_by}` : "Anotada"];
  for (const r of c.results) {
    const res = r.result ? RESULT_LABEL_STAFF[r.result] : "sin «¿Cómo te fue?»";
    const com = r.comment ? (r.risk ? ", con un comentario para revisar hoy" : ", con un comentario") : "";
    parts.push(`${r.who}: ${res}${com}`);
  }
  return `${parts.join(". ")}.`;
}

function PracticeGrid({ data }: { data: StaffPracticeDTO }) {
  const { dates, rows } = data.grid;
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">No hay prácticas anotadas en los últimos 14 días.</p>;
  }
  const today = dates[dates.length - 1];
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">
            Prácticas de los últimos 14 días, por ejercicio y por día, con lo que contó cada adulto en «¿Cómo te fue?»
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sr-only">Ejercicio</th>
              {dates.map((d) => {
                const i = dayIndex(d);
                return (
                  <th key={d} scope="col"
                    className={`w-7 px-0 pb-1 text-center font-medium ${d === today ? "text-[color:var(--primary-deep)]" : "text-muted-foreground"} ${i === 0 ? "border-l border-border/60" : ""}`}>
                    <span aria-hidden="true" className="block leading-tight">{WEEKDAY_SHORT[i]}</span>
                    <span aria-hidden="true" className="block leading-tight">{d.slice(8, 10)}</span>
                    <span className="sr-only">{d === today ? "hoy, " : ""}{WEEKDAY_NAME[i]} {ddmm(d)}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.exercise_key}>
                <th scope="row" className="max-w-[11rem] truncate pr-2 text-left text-xs font-medium sm:max-w-[16rem]"
                  title={r.title ?? undefined}>
                  <span className={r.current ? "" : "text-muted-foreground"}>{r.title ?? `Ejercicio ${idx + 1}`}</span>
                  {!r.current && <span className="text-muted-foreground"> (ya no está en el plan)</span>}
                </th>
                {r.cells.map((c, i) => <GridCell key={dates[i]} cell={c} monday={dayIndex(dates[i]) === 0} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Administración ve solo los días de práctica, sin "¿Cómo te fue?" */}
      <ul aria-hidden="true" className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {data.can_edit ? (
          <>
            {(Object.keys(RESULT_DOT) as PracticeResult[]).map((k) => (
              <li key={k} className="inline-flex items-center gap-1">
                <span className={`h-2 w-2 rounded-full ${RESULT_DOT[k]}`} /> {RESULT_LABEL_STAFF[k]}
              </li>
            ))}
            <li className="inline-flex items-center gap-1"><Check className="h-3 w-3 text-[color:var(--primary-deep)]" /> Anotada, sin contar cómo les fue</li>
            <li className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[color:var(--primary-deep)]" /> Con comentario</li>
            <li className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[oklch(0.6_0.19_25)]" /> Para revisar hoy</li>
          </>
        ) : (
          <li className="inline-flex items-center gap-1"><Check className="h-3 w-3 text-[color:var(--primary-deep)]" /> Anotada</li>
        )}
      </ul>
    </div>
  );
}

function GridCell({ cell, monday }: { cell: StaffGridCell | null; monday: boolean }) {
  const edge = monday ? "border-l border-border/60" : "";
  if (!cell) {
    return (
      <td className={`p-0 ${edge}`}>
        <span className="mx-auto block h-6 w-6 rounded-md bg-muted/50" aria-hidden="true" />
        <span className="sr-only">Sin práctica</span>
      </td>
    );
  }
  const text = cellText(cell);
  const risk = cell.results.some((r) => r.risk);
  const comment = cell.results.some((r) => r.comment);
  return (
    <td className={`p-0 ${edge}`}>
      <span title={text} aria-hidden="true"
        className={`relative mx-auto flex h-6 w-6 flex-wrap content-center items-center justify-center gap-0.5 rounded-md bg-[color:var(--primary-soft)] ${risk ? "ring-2 ring-[oklch(0.6_0.19_25)]" : ""}`}>
        {cell.results.some((r) => r.result)
          ? cell.results.map((r, i) => (
            <span key={i} className={`h-2 w-2 rounded-full ${r.result ? RESULT_DOT[r.result] : "bg-muted-foreground/40"}`} />
          ))
          : <Check className="h-3.5 w-3.5 text-[color:var(--primary-deep)]" />}
        {comment && (
          <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${risk ? "bg-[oklch(0.6_0.19_25)]" : "bg-[color:var(--primary-deep)]"}`} />
        )}
      </span>
      <span className="sr-only">{text}</span>
    </td>
  );
}

// ── Comentarios de la familia ───────────────────────────────────────────────

function RiskNotes({ notes }: { notes: StaffNoteDTO[] }) {
  const id = useId();
  return (
    <div role="region" aria-labelledby={id}
      className="space-y-2 rounded-xl border-l-4 border-l-[oklch(0.6_0.19_25)] bg-[color:var(--status-occupied-bg)] p-3">
      <p id={id} className={`flex items-center gap-2 text-sm font-bold ${BAD_TEXT}`}>
        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" /> Revisar hoy
      </p>
      <p className="text-xs text-foreground/80">
        {notes.length === 1 ? "Este comentario tiene" : "Estos comentarios tienen"} palabras que pueden indicar riesgo
        (autolesión, violencia o abuso). Es una marca automática por palabras clave: puede marcar de más y no reemplaza tu lectura.
      </p>
      <ul className="space-y-1.5">{notes.map((n) => <NoteItem key={n.id} n={n} />)}</ul>
    </div>
  );
}

function NoteItem({ n }: { n: StaffNoteDTO }) {
  return (
    <li className={`space-y-0.5 rounded-lg p-2.5 ${n.risk ? "bg-background ring-1 ring-[oklch(0.6_0.19_25)]/50" : "bg-[color:var(--primary-soft)]/50"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{n.who}</span>
        <span>{n.exercise_title} · {day(n.practiced_on)}</span>
        {n.result && <Pill tone={RESULT_TONE[n.result]}>{RESULT_LABEL_STAFF[n.result]}</Pill>}
        {n.risk && <Pill tone="bad">Revisar hoy</Pill>}
        {n.is_new && !n.risk && <Pill tone="info">Nuevo</Pill>}
        {n.log_undone && <span>(después deshicieron la práctica)</span>}
      </div>
      {n.comment && (
        <p className={`whitespace-pre-line text-sm ${n.risk ? `font-semibold ${BAD_TEXT}` : ""}`}>«{n.comment}»</p>
      )}
    </li>
  );
}

const COMMENTS_SHOWN = 5;

function Comments({ notes }: { notes: StaffNoteDTO[] }) {
  const [all, setAll] = useState(false);
  // Solo los que tienen comentario (los "¿Cómo te fue?" ya están en la grilla):
  // los de riesgo y los nuevos primero, después los más recientes
  const list = useMemo(() => notes.filter((n) => n.comment).sort((a, b) =>
    Number(b.risk) - Number(a.risk) || Number(b.is_new) - Number(a.is_new) || b.created_at.localeCompare(a.created_at)), [notes]);
  const shown = all ? list : list.slice(0, COMMENTS_SHOWN);
  return (
    <Block title="Comentarios de la familia">
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay comentarios de la familia.</p>
      ) : (
        <>
          <ul className="space-y-1.5">{shown.map((n) => <NoteItem key={n.id} n={n} />)}</ul>
          {list.length > COMMENTS_SHOWN && (
            <Button type="button" size="sm" variant="ghost" className="-ml-2 h-8 gap-1.5 px-2" aria-expanded={all}
              onClick={() => setAll((v) => !v)}>
              <ChevronDown className={`h-4 w-4 transition-transform ${all ? "rotate-180" : ""}`} aria-hidden="true" />
              {all ? "Ver menos" : `Ver todos (${list.length})`}
            </Button>
          )}
        </>
      )}
    </Block>
  );
}

// ── Devolución ──────────────────────────────────────────────────────────────

// Lo que queda aparte (practiceHandoff) si la ficha se cierra con la devolución a medio escribir
type ComposerKept = {
  body: string; forAdult: string; goalIds: string[]; medalOn: boolean; medalTitle: string; medalGoal: string;
  medalMsg: string; ack: boolean; keep: boolean; note: string;
};

function FeedbackComposer({ data, busy, send, reload, preset, showSeen = false, keepAs, owner = null, onDirty, onDone, onCancel }: {
  data: StaffPracticeDTO;
  busy: boolean;
  send: FollowupProps["send"];
  reload: FollowupProps["reload"];
  preset?: Preset;
  showSeen?: boolean; // "Marcar como visto" (en la vista de prácticas)
  keepAs?: UnsavedPart; // en la ficha: avisa si hay texto sin enviar y, si la ficha se cierra, lo deja aparte
  owner?: string | null; // para quién queda aparte (sin owner, no queda nada)
  onDirty?: FollowupProps["onDirty"];
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const p = data.patient;
  const active = data.goals.filter((g) => g.status === "activa");
  const [kept] = useState(() => (keepAs ? peekUnsaved<ComposerKept>(p.id, keepAs, owner)?.value ?? null : null));
  const [body, setBody] = useState(kept?.body ?? "");
  const [forAdult, setForAdult] = useState(kept?.forAdult ?? "");
  const [goalIds, setGoalIds] = useState<string[]>(() => (kept?.goalIds ?? preset?.goalIds ?? []).filter((id) => active.some((g) => g.id === id)));
  const [medalOn, setMedalOn] = useState(kept ? kept.medalOn : !!preset?.medal);
  const [medalTitle, setMedalTitle] = useState(kept?.medalTitle ?? preset?.medal?.title ?? "");
  const [medalGoal, setMedalGoal] = useState(() =>
    kept ? (active.some((g) => g.id === kept.medalGoal) ? kept.medalGoal : "") : preset?.medal?.goalId ?? "");
  const [medalMsg, setMedalMsg] = useState(kept?.medalMsg ?? "");
  const [ack, setAck] = useState(kept?.ack ?? false);
  const [keep, setKeep] = useState(kept?.keep ?? false);
  const [note, setNote] = useState(kept?.note ?? "");
  const [error, setError] = useState<UiError | null>(null);
  const [acting, setActing] = useState<"send" | "seen" | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const adultRef = useRef<HTMLTextAreaElement>(null);
  const bodyTouched = useRef(false);
  const bodyId = useId();
  const guideId = useId();
  const adultId = useId();
  const medalId = useId();
  const medalBlockId = useId();
  const medalGoalId = useId();
  const medalMsgId = useId();

  const alerts = useMemo(() => lintAll([body, forAdult]), [body, forAdult]);
  const medalBlock = medalOn ? blockForTitles(medalTitle) : [];
  // Metas por las que se puede dar la medalla: las activas sin otra medalla vigente
  const medalGoals = active.filter((g) => !hasProMedal(data, g.id));
  const locked = busy || !!acting;
  const missingAck = p.adolescent && !ack;
  // "Marcar como visto": con el plan publicado (la familia ve que revisaste) y
  // también si el plan ya se finalizó o se retiró pero quedan prácticas sin
  // ver (así salen de Portal → Prácticas)
  const canSeen = showSeen && (!!data.published || hasPending(data.pending));

  // Texto sin enviar: la sección pregunta antes de cerrarse; si la ficha se
  // cierra o se abre otra, queda aparte y vuelve al abrir de nuevo la sección
  const typed = !!(body.trim() || forAdult.trim() || medalMsg.trim() || goalIds.length || (medalOn && medalTitle.trim()));
  const snapshot = useRef({ typed, value: { body, forAdult, goalIds, medalOn, medalTitle, medalGoal, medalMsg, ack, keep, note } });
  snapshot.current = { typed, value: { body, forAdult, goalIds, medalOn, medalTitle, medalGoal, medalMsg, ack, keep, note } };

  useEffect(() => {
    if (!keepAs) return;
    onDirty?.(keepAs, typed);
    return () => onDirty?.(keepAs, false);
  }, [keepAs, typed, onDirty]);

  useEffect(() => {
    if (!keepAs) return;
    const id = p.id;
    forgetUnsaved(id, keepAs, owner);
    return () => {
      if (snapshot.current.typed) keepUnsaved(id, keepAs, owner, snapshot.current.value);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearError = () => setError(null);

  // Las frases rápidas se insertan donde está el cursor (o al final)
  function insertChip(text: string) {
    clearError();
    const el = bodyRef.current;
    const start = bodyTouched.current && el ? el.selectionStart : body.length;
    const end = bodyTouched.current && el ? el.selectionEnd : body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const head = `${before}${before && !/\s$/.test(before) ? " " : ""}${text}`;
    const next = `${head}${after && !/^\s/.test(after) ? " " : ""}${after}`;
    if (next.length > L.feedback_max) {
      setError({ message: `No entra: la devolución puede tener hasta ${L.feedback_max} caracteres.`, stale: false });
      return;
    }
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(head.length, head.length);
    });
  }

  function toggleGoal(id: string, on: boolean) {
    clearError();
    setGoalIds((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  }

  function fix() {
    (lintAll([body]).length ? bodyRef : adultRef).current?.focus();
  }

  function reset() {
    setBody("");
    setForAdult("");
    setGoalIds([]);
    setMedalOn(false);
    setMedalTitle("");
    setMedalGoal("");
    setMedalMsg("");
    setAck(false);
    setKeep(false);
    setNote("");
    bodyTouched.current = false;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    clearError();
    if (alerts.length && (!keep || note.trim().length < 3)) { setError({ message: REVIEW_NEEDED, stale: false }); return; }
    const v = validateFeedback({
      plan_id: data.published?.id ?? null,
      body,
      for_adult: forAdult,
      goal_ids: goalIds,
      medal: medalOn ? { title: medalTitle, message: medalMsg, goal_id: medalGoal || null } : null,
      adolescent_ack: ack,
      review_note: alerts.length ? note : null,
    }, { adolescent: p.adolescent });
    if (!v.ok) {
      setError({ message: v.error, stale: false });
      if (v.field === "body") bodyRef.current?.focus();
      if (v.field === "for_adult") adultRef.current?.focus();
      return;
    }
    setActing("send");
    const r = await send({ action: "feedback_send", patient_id: p.id, feedback: v.value });
    setActing(null);
    if (!r.ok) { setError(uiError(r)); return; }
    const who = r.data.readers.length
      ? `La ven en el portal: ${joinNames(r.data.readers)}.`
      : "Se va a ver cuando alguien active el portal.";
    toast.success(`Devolución enviada${v.value.medal ? `, con la medalla «${v.value.medal.title}»` : ""}. ${who}`);
    reset();
    onDone?.();
  }

  async function markSeen() {
    if (locked) return;
    clearError();
    setActing("seen");
    const r = await send({ action: "mark_seen", patient_id: p.id });
    setActing(null);
    if (!r.ok) { setError(uiError(r)); return; }
    toast.success(r.data.published
      ? "Marcado como visto. En el portal la familia ve que revisaste las prácticas."
      : "Marcado como visto. Ya no aparece en Portal → Prácticas.");
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Devolución para la familia">
      {/* Quién la lee: siempre arriba */}
      <p className="flex gap-2 rounded-xl bg-[color:var(--primary-soft)] px-3 py-2 text-sm">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--primary-deep)]" aria-hidden="true" />
        <span>{data.readers_line}</span>
      </p>
      {!data.practice_enabled && (
        <p className={WARN_BOX}>
          Los ejercicios todavía no están prendidos en el portal para {p.first_name}: la familia no va a ver la devolución
          hasta que se prendan.
        </p>
      )}
      {data.author.problem ? (
        <p role="alert" className={ERROR_BOX}>{data.author.problem}</p>
      ) : data.author.label && (
        <p className="text-xs text-muted-foreground">
          Se envía como: <span className="font-semibold text-foreground">{data.author.label}</span>
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={bodyId}>Devolución</Label>
        <p id={guideId} className="text-xs text-muted-foreground">{feedbackGuide(p.first_name)}</p>
        <div role="group" aria-label="Frases rápidas (se suman al texto)" className="flex flex-wrap gap-1.5">
          {FEEDBACK_CHIPS.map((c) => (
            <button key={c} type="button" onClick={() => insertChip(c)}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-left text-xs font-semibold text-muted-foreground transition-colors hover:bg-[color:var(--primary-soft)]">
              <Plus className="h-3 w-3 shrink-0" aria-hidden="true" /> {c}
            </button>
          ))}
        </div>
        <Textarea id={bodyId} ref={bodyRef} rows={5} maxLength={L.feedback_max} value={body} aria-describedby={guideId}
          onFocus={() => { bodyTouched.current = true; }}
          onChange={(e) => { clearError(); setBody(e.target.value); }} />
        <Counter n={body.length} max={L.feedback_max} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={adultId}>
          Para el adulto que acompaña <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Textarea id={adultId} ref={adultRef} rows={2} maxLength={L.feedback_for_adult} value={forAdult}
          onChange={(e) => { clearError(); setForAdult(e.target.value); }} />
        <Counter n={forAdult.length} max={L.feedback_for_adult} />
      </div>

      {active.length > 0 && (
        <fieldset className="space-y-1.5 rounded-xl border border-border/60 p-3">
          <legend className="px-1 text-sm font-semibold">
            Marcar metas como logradas <span className="font-normal text-muted-foreground">(opcional)</span>
          </legend>
          {active.map((g) => {
            const pr = progressText(g);
            return (
              <label key={g.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={goalIds.includes(g.id)}
                  onChange={(e) => toggleGoal(g.id, e.target.checked)} />
                <span>
                  {goalLabel(g)}
                  {(g.rule || pr) && (
                    <span className="block text-xs text-muted-foreground">
                      {[g.rule ? goalRuleText(g.rule) : null, pr].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="space-y-2 rounded-xl border border-border/60 p-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={medalOn} onChange={(e) => { clearError(); setMedalOn(e.target.checked); }} />
          <Award className="h-4 w-4 shrink-0 text-[color:var(--primary-deep)]" aria-hidden="true" />
          Sumar una medalla <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        {medalOn && (
          <div className="space-y-2 pl-6">
            <MedalTitleField id={medalId} blockId={medalBlockId} value={medalTitle} block={medalBlock}
              onChange={(v) => { clearError(); setMedalTitle(v); }} />
            {medalGoals.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor={medalGoalId}>Por la meta <span className="font-normal text-muted-foreground">(opcional)</span></Label>
                <select id={medalGoalId} value={medalGoal} className={selectClass}
                  onChange={(e) => { clearError(); setMedalGoal(e.target.value); }}>
                  <option value="">Ninguna en especial</option>
                  {medalGoals.map((g) => <option key={g.id} value={g.id}>{goalLabel(g)}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={medalMsgId}>Mensaje <span className="font-normal text-muted-foreground">(opcional)</span></Label>
              <Textarea id={medalMsgId} rows={2} maxLength={L.medal_message} value={medalMsg}
                onChange={(e) => { clearError(); setMedalMsg(e.target.value); }} />
              <Counter n={medalMsg.length} max={L.medal_message} />
            </div>
            <p className="text-xs text-muted-foreground">
              Se la das con esta devolución: la familia la ve en su página de medallas, con tu nombre.
            </p>
          </div>
        )}
      </div>

      <FluencyReview phrases={alerts} keep={keep} note={note} onFix={fix}
        onKeep={() => setKeep(true)} onNote={(v) => { clearError(); setNote(v); }} />

      {p.adolescent && (
        <label className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm">
          <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => { clearError(); setAck(e.target.checked); }} />
          Lo conversé con {p.first_name}{p.age !== null ? ` (${p.age} años)` : ""}
        </label>
      )}

      <p className="text-xs text-muted-foreground">{STAFF_PRACTICE_TEXT.feedback_note}</p>
      <ErrorBox error={error} onReload={() => { clearError(); void reload(); }} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" className={PILL_BTN} disabled={!!acting} onClick={onCancel}>Cancelar</Button>
        )}
        {canSeen && (
          <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={locked} onClick={markSeen}
            aria-busy={acting === "seen"}>
            {acting === "seen" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Marcar como visto
          </Button>
        )}
        <Button type="submit" size="sm" className={PILL_BTN} aria-busy={acting === "send"}
          disabled={locked || !!data.author.problem || missingAck || medalBlock.length > 0}>
          {acting === "send" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Enviar devolución
        </Button>
      </div>
    </form>
  );
}

// ── Devoluciones anteriores ─────────────────────────────────────────────────

const FEEDBACK_SHOWN = 3;

function FeedbackHistory({ data, busy, send, reload }: FollowupProps) {
  const [all, setAll] = useState(false);
  const [withdraw, setWithdraw] = useState<StaffFeedbackDTO | null>(null);
  const list = data.feedback;
  const shown = all ? list : list.slice(0, FEEDBACK_SHOWN);
  return (
    <Block title={`Devoluciones anteriores${list.length ? ` (${list.length})` : ""}`}>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay devoluciones.</p>
      ) : (
        <>
          <ul className="divide-y divide-border/60">
            {shown.map((f) => (
              <FeedbackItem key={f.id} f={f} canWithdraw={data.can_edit && f.can_withdraw && !f.withdrawn_at} busy={busy}
                onWithdraw={() => setWithdraw(f)} />
            ))}
          </ul>
          {list.length > FEEDBACK_SHOWN && (
            <Button type="button" size="sm" variant="ghost" className="-ml-2 h-8 gap-1.5 px-2" aria-expanded={all}
              onClick={() => setAll((v) => !v)}>
              <ChevronDown className={`h-4 w-4 transition-transform ${all ? "rotate-180" : ""}`} aria-hidden="true" />
              {all ? "Ver menos" : `Ver todas (${list.length})`}
            </Button>
          )}
        </>
      )}
      {withdraw && (
        <WithdrawFeedbackDialog data={data} item={withdraw} busy={busy} send={send}
          onClose={() => setWithdraw(null)} onReload={() => { setWithdraw(null); void reload(); }} />
      )}
    </Block>
  );
}

function FeedbackItem({ f, canWithdraw, busy, onWithdraw }: {
  f: StaffFeedbackDTO; canWithdraw: boolean; busy: boolean; onWithdraw: () => void;
}) {
  const reads = readsLine(f.reads);
  return (
    <li className="space-y-1 py-3 text-sm first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">{day(f.sent_at)} · {f.author_label}</span>
        {f.withdrawn_at && <Pill tone="muted">Retirada</Pill>}
        {f.medal && <Pill tone="info">Medalla{f.medal.title ? ` «${f.medal.title}»` : ""}</Pill>}
        {f.goals.map((g) => <Pill key={g.id} tone="ok">Meta lograda{g.title ? `: «${g.title}»` : ""}</Pill>)}
      </div>
      {f.body !== null && (
        <p className={`whitespace-pre-line ${f.withdrawn_at ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>{f.body}</p>
      )}
      {f.for_adult && (
        <p className="whitespace-pre-line text-xs">
          <span className="font-semibold">Para el adulto que acompaña:</span> {f.for_adult}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{reads ?? "Todavía nadie de la familia la abrió"}</p>
      {f.withdrawn_at && (
        <p className="text-xs text-muted-foreground">
          Retirada el {day(f.withdrawn_at)}{f.withdrawn_by_email ? ` por ${f.withdrawn_by_email}` : ""}
          {f.withdraw_reason ? `: ${WITHDRAW_REASON_LABEL[f.withdraw_reason]}` : ""}
        </p>
      )}
      {f.review_note && <p className={`text-xs ${PENDING_TEXT}`}>Se mandó con aviso del texto: {f.review_note}</p>}
      {canWithdraw && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={busy} onClick={onWithdraw}>
            Retirar
          </Button>
        </div>
      )}
    </li>
  );
}

function WithdrawFeedbackDialog({ data, item, busy, send, onClose, onReload }: {
  data: StaffPracticeDTO; item: StaffFeedbackDTO; busy: boolean; send: FollowupProps["send"];
  onClose: () => void; onReload: () => void;
}) {
  const [reason, setReason] = useState<FeedbackWithdrawReason | "">("");
  const [error, setError] = useState<UiError | null>(null);
  const [acting, setActing] = useState(false);
  const reasonId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (acting || busy) return;
    setError(null);
    if (!reason) { setError({ message: "Elegí el motivo.", stale: false }); return; }
    setActing(true);
    const r = await send({ action: "feedback_withdraw", patient_id: data.patient.id, feedback_id: item.id, reason });
    setActing(false);
    if (!r.ok) { setError(uiError(r)); return; }
    toast.success("Se retiró la devolución del portal.");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !acting) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Retirar la devolución</DialogTitle>
          <DialogDescription>Del {day(item.sent_at)} · {item.author_label}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Motivo</Label>
            <select id={reasonId} value={reason} className={selectClass}
              onChange={(e) => { setError(null); setReason(e.target.value as FeedbackWithdrawReason | ""); }}>
              <option value="">Elegí el motivo</option>
              {FEEDBACK_WITHDRAW_REASONS.map((k) => <option key={k} value={k}>{WITHDRAW_REASON_LABEL[k]}</option>)}
            </select>
          </div>
          <p className="text-sm">Deja de verse en el portal. Queda guardada acá, con tu usuario, la fecha y el motivo.</p>
          {item.medal && (
            <p className="text-xs text-muted-foreground">
              Si la medalla que se dio con esta devolución también fue un error, retirala en «Metas y medallas».
            </p>
          )}
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={acting} onClose={onClose} submit="Retirar" destructive disabled={busy} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ═══ Metas y medallas ═══════════════════════════════════════════════════════

type GoalForm = {
  id: string | null; // meta en borrador que se edita
  kind: GoalKind;
  title: string;
  dias: string;
  semanas: string;
  medal: string;
  agreed: boolean;
  withPlan: boolean; // se publica junto con el plan en borrador
};

const GOAL_STATUS_TONE: Record<StaffGoalDTO["status"], Tone> = { borrador: "muted", activa: "info", lograda: "ok", cambiada: "muted" };
const GOAL_STATUS_ORDER: Record<StaffGoalDTO["status"], number> = { activa: 0, borrador: 1, lograda: 2, cambiada: 3 };

function goalStatusLabel(g: StaffGoalDTO): string {
  switch (g.status) {
    case "borrador": return "Borrador";
    case "activa": return "Activa";
    case "lograda": return g.achieved_at ? `Lograda el ${day(g.achieved_at)}` : "Lograda";
    case "cambiada": return "Cambiada";
  }
}

function emptyGoal(): GoalForm {
  return { id: null, kind: "practica", title: "", dias: "12", semanas: "4", medal: "", agreed: false, withPlan: false };
}

// keepId: editar el mismo borrador; si no, una meta nueva con esos datos
function goalFormFrom(g: StaffGoalDTO, draftPlanId: string | null, keepId: boolean): GoalForm {
  return {
    id: keepId ? g.id : null,
    kind: g.kind,
    title: g.title ?? "",
    dias: String(g.rule?.dias ?? 12),
    semanas: String(g.rule?.semanas ?? 4),
    medal: g.medal_title ?? "",
    agreed: g.agreed_with_patient,
    withPlan: keepId && !!draftPlanId && g.plan_id === draftPlanId,
  };
}

type GoalDialog =
  | { kind: "publish"; goal: StaffGoalDTO }
  | { kind: "change"; goal: StaffGoalDTO }
  | { kind: "void"; medal: StaffMedalDTO }
  | null;

export function PortalPracticeGoals({ data, busy, send, reload, medalAsk }: FollowupProps & {
  /** «Dar la medalla» desde la bandeja: abre la devolución de esa meta con la medalla (una vez por cada n) */
  medalAsk?: { goalId: string; n: number } | null;
}) {
  const titleId = useId();
  const medalsId = useId();
  const p = data.patient;
  const canEdit = data.can_edit;
  const [form, setForm] = useState<GoalForm | null>(null);
  const [formSeq, setFormSeq] = useState(0);
  const [composer, setComposer] = useState<(Preset & { n: number }) | null>(null);
  const [dialog, setDialog] = useState<GoalDialog>(null);
  const [acting, setActing] = useState<string | null>(null); // "Todavía no" de esa meta
  const [rowError, setRowError] = useState<{ id: string; error: UiError } | null>(null);
  const seq = useRef(0);

  const goals = useMemo(() => [...data.goals].sort((a, b) =>
    GOAL_STATUS_ORDER[a.status] - GOAL_STATUS_ORDER[b.status] || b.created_at.localeCompare(a.created_at)), [data.goals]);
  const liveMedals = data.medals.filter((m) => !m.voided_at);
  const locked = busy || !!acting;

  function openForm(f: GoalForm) {
    setForm(f);
    setFormSeq((n) => n + 1);
  }

  // "Dar la medalla" / "Marcar lograda": la devolución con la meta tildada y la medalla cargada
  function giveMedal(goalId: string) {
    const g = data.goals.find((x) => x.id === goalId);
    const medal = hasProMedal(data, goalId) ? null : { title: g?.medal_title ?? PRO_MEDAL_SUGGESTIONS[0], goalId };
    setComposer({ n: ++seq.current, goalIds: g?.status === "activa" ? [goalId] : [], medal });
  }

  // Lo que pidió la bandeja: si la meta ya no está activa (otra persona la dio
  // por lograda o la cambió), se avisa y queda la vista de metas
  const askDone = useRef<number | null>(null);
  useEffect(() => {
    if (!medalAsk || askDone.current === medalAsk.n) return;
    askDone.current = medalAsk.n;
    if (!canEdit) return;
    const g = data.goals.find((x) => x.id === medalAsk.goalId);
    if (!g || g.status !== "activa") {
      toast.info("Esa meta ya no está activa: otra persona la dio por lograda o la cambió. Fijate en «Metas y medallas».");
      return;
    }
    giveMedal(g.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medalAsk]);

  async function notYet(goalId: string) {
    if (locked) return;
    setRowError(null);
    setActing(goalId);
    const r = await send({ action: "goal_not_yet", patient_id: p.id, goal_id: goalId });
    setActing(null);
    if (!r.ok) { setRowError({ id: goalId, error: uiError(r) }); return; }
    toast.success("Listo. La meta sigue activa: la podés dar por lograda cuando quieras.");
  }

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-2xl border border-border/60 p-4">
      <div>
        <h4 id={titleId} className="text-sm font-bold">Metas y medallas</h4>
        <p className="text-xs text-muted-foreground">
          Metas de práctica y de animarse, nunca de fluidez. Una medalla no se pierde nunca.
        </p>
      </div>
      {!canEdit && <p className="text-xs text-muted-foreground">{STAFF_PRACTICE_TEXT.admin_readonly}</p>}

      {/* Metas de práctica cumplidas: el servidor solo avisa, la da por lograda el profesional */}
      {canEdit && data.goals_met.map((gm) => (
        <div key={gm.goal_id} role="region" aria-label="Meta cumplida"
          className="space-y-2 rounded-xl border-l-4 border-l-[oklch(0.62_0.14_150)] bg-[color:var(--status-available-bg)] p-3">
          <p className="flex gap-2 text-sm font-semibold">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.42_0.12_150)]" aria-hidden="true" />
            {goalMetLine(gm.title ?? "la meta")}
          </p>
          <p className="text-xs text-foreground/80">La cumplió el {day(gm.met_on)}. {STAFF_PRACTICE_TEXT.goal_needs_feedback}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className={PILL_BTN} disabled={locked} onClick={() => giveMedal(gm.goal_id)}>
              <Award className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Dar la medalla
            </Button>
            <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={locked}
              aria-busy={acting === gm.goal_id} onClick={() => notYet(gm.goal_id)}>
              {acting === gm.goal_id && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Todavía no
            </Button>
          </div>
          {rowError?.id === gm.goal_id && (
            <ErrorBox error={rowError.error} onReload={() => { setRowError(null); void reload(); }} />
          )}
        </div>
      ))}

      <Block title="Metas" aside={canEdit && !form && (
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={() => openForm(emptyGoal())}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Nueva meta
        </Button>
      )}>
        {form && (
          <GoalEditor key={formSeq} data={data} initial={form} busy={busy} send={send} reload={reload}
            onClose={() => setForm(null)} />
        )}
        {goals.length === 0 ? (
          !form && <p className="text-sm text-muted-foreground">Todavía no hay metas.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {goals.map((g) => (
              <GoalItem key={g.id} g={g} data={data} canEdit={canEdit} busy={locked}
                onPublish={() => setDialog({ kind: "publish", goal: g })}
                onEdit={() => openForm(goalFormFrom(g, data.draft?.id ?? null, true))}
                onAchieved={() => giveMedal(g.id)}
                onChange={() => setDialog({ kind: "change", goal: g })} />
            ))}
          </ul>
        )}
      </Block>

      <div role="group" aria-labelledby={medalsId} className="space-y-3 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h5 id={medalsId} className="text-sm font-semibold">Medallas de {p.first_name} ({liveMedals.length})</h5>
          {canEdit && (
            <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={locked}
              onClick={() => setComposer({ n: ++seq.current, goalIds: [], medal: { title: "", goalId: null } })}>
              <Award className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Dar una medalla especial
            </Button>
          )}
        </div>
        {data.medals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no tiene medallas.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {data.medals.map((m) => (
              <MedalItem key={m.id} m={m} data={data} canVoid={canEdit && !m.voided_at} busy={locked}
                onVoid={() => setDialog({ kind: "void", medal: m })} />
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Retirar una medalla es solo para errores: deja de verse en el portal y queda guardado acá, con el motivo.
        </p>
      </div>

      {composer && (
        <Dialog open onOpenChange={(o) => { if (!o && !busy) setComposer(null); }}>
          <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle className={TITLE}>{composer.goalIds.length ? "Dar la meta por lograda" : "Dar una medalla"}</DialogTitle>
              <DialogDescription>
                {composer.goalIds.length ? `${STAFF_PRACTICE_TEXT.goal_needs_feedback} ` : ""}{PRACTICE_ERROR.medal_needs_feedback}
              </DialogDescription>
            </DialogHeader>
            <FeedbackComposer key={composer.n} data={data} busy={busy} send={send} reload={reload} preset={composer}
              onDone={() => setComposer(null)} onCancel={() => setComposer(null)} />
          </DialogContent>
        </Dialog>
      )}
      {dialog?.kind === "publish" && (
        <PublishGoalDialog data={data} goal={dialog.goal} busy={busy} send={send}
          onClose={() => setDialog(null)} onReload={() => { setDialog(null); void reload(); }} />
      )}
      {dialog?.kind === "change" && (
        <ChangeGoalDialog data={data} goal={dialog.goal} busy={busy} send={send}
          onClose={() => setDialog(null)} onReload={() => { setDialog(null); void reload(); }}
          onChanged={(g) => { setDialog(null); openForm(goalFormFrom(g, null, false)); }} />
      )}
      {dialog?.kind === "void" && (
        <VoidMedalDialog data={data} medal={dialog.medal} busy={busy} send={send}
          onClose={() => setDialog(null)} onReload={() => { setDialog(null); void reload(); }} />
      )}
    </section>
  );
}

function GoalItem({ g, data, canEdit, busy, onPublish, onEdit, onAchieved, onChange }: {
  g: StaffGoalDTO; data: StaffPracticeDTO; canEdit: boolean; busy: boolean;
  onPublish: () => void; onEdit: () => void; onAchieved: () => void; onChange: () => void;
}) {
  const pr = progressText(g);
  const withPlan = g.status === "borrador" && !!g.plan_id && g.plan_id === data.draft?.id;
  return (
    <li className="space-y-1 py-3 text-sm first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={GOAL_STATUS_TONE[g.status]}>{goalStatusLabel(g)}</Pill>
        <span className={`font-semibold ${g.status === "cambiada" ? "text-muted-foreground" : ""}`}>{goalLabel(g)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {[g.rule ? goalRuleText(g.rule) : "La valida el profesional en la sesión", pr].filter(Boolean).join(" · ")}
      </p>
      {(g.medal_title || g.agreed_with_patient) && (
        <p className="text-xs">
          {[
            g.medal_title ? `Medalla al cumplirla: «${g.medal_title}»` : null,
            g.agreed_with_patient ? `La eligieron junto con ${data.patient.first_name}` : null,
          ].filter(Boolean).join(" · ")}
        </p>
      )}
      {withPlan && <p className="text-xs text-muted-foreground">Se publica junto con el plan en borrador.</p>}
      {g.status === "cambiada" && g.changed_at && (
        <p className="text-xs text-muted-foreground">
          Cambiada el {day(g.changed_at)}{g.changed_by_email ? ` por ${g.changed_by_email}` : ""}. En el portal no aparece como «no cumplida».
        </p>
      )}
      {canEdit && (g.status === "borrador" || g.status === "activa") && (
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {g.status === "borrador" ? (
            <>
              <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={busy} onClick={onEdit}>Editar</Button>
              {/* La del borrador sale junto con el plan */}
              {!withPlan && <Button type="button" size="sm" className={PILL_BTN} disabled={busy} onClick={onPublish}>Publicar meta</Button>}
            </>
          ) : (
            <>
              <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={busy} onClick={onChange}>Cambiar</Button>
              <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={onAchieved}>
                Marcar lograda
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function GoalEditor({ data, initial, busy, send, reload, onClose }: {
  data: StaffPracticeDTO; initial: GoalForm; busy: boolean; send: FollowupProps["send"]; reload: FollowupProps["reload"];
  onClose: () => void;
}) {
  const p = data.patient;
  const [f, setF] = useState<GoalForm>(initial);
  const [error, setError] = useState<UiError | null>(null);
  const [acting, setActing] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const titleBlockId = useId();
  const kindName = useId();
  const diasId = useId();
  const semanasId = useId();
  const medalId = useId();
  const medalBlockId = useId();

  const set = (patch: Partial<GoalForm>) => { setError(null); setF((x) => ({ ...x, ...patch })); };
  const titleBlock = blockForTitles(f.title);
  const medalBlock = blockForTitles(f.medal);
  const semanas = Number(f.semanas);
  const maxDias = Number.isInteger(semanas) && semanas > 0 ? Math.min(L.goal_days_max, semanas * 7) : L.goal_days_max;
  const draftPlan = data.draft;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (acting || busy) return;
    setError(null);
    const v = validateGoal({
      id: f.id,
      plan_id: f.withPlan && draftPlan ? draftPlan.id : data.published?.id ?? null,
      kind: f.kind,
      title: f.title,
      rule: f.kind === "practica" ? { dias: Number(f.dias), semanas: Number(f.semanas) } : null,
      medal_title: f.medal,
      agreed_with_patient: f.agreed,
    });
    if (!v.ok) {
      // El bloqueo de fluidez ya se ve debajo del campo
      if (v.code !== "TITLE_BLOCK") setError({ message: v.error, stale: false });
      if (v.field === "title") titleRef.current?.focus();
      return;
    }
    setActing(true);
    const r = await send({ action: "goal_save", patient_id: p.id, goal: v.value });
    setActing(false);
    if (!r.ok) { setError(uiError(r)); return; }
    toast.success(f.withPlan && draftPlan
      ? "Meta guardada. Se publica junto con el plan."
      : "Meta guardada como borrador. Todavía no se ve en el portal: publicala con «Publicar meta».");
    onClose();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-muted/40 p-3" aria-label={f.id ? "Editar la meta" : "Nueva meta"}>
      <div className="space-y-1.5">
        <Label htmlFor={titleId}>¿Cuál es la meta?</Label>
        <Input id={titleId} ref={titleRef} value={f.title} maxLength={L.goal_title} autoFocus className="bg-background"
          placeholder="Ej.: Animarse a pedir algo en el kiosco" aria-invalid={titleBlock.length > 0}
          aria-describedby={titleBlock.length ? titleBlockId : undefined} onChange={(e) => set({ title: e.target.value })} />
        <Counter n={f.title.length} max={L.goal_title} />
        {titleBlock.length > 0 && <p id={titleBlockId} role="alert" className={ERROR_BOX}>{FLUENCY_TITLE_MESSAGE}</p>}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">¿Cómo se cumple?</legend>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name={kindName} className="mt-1" checked={f.kind === "practica"} onChange={() => set({ kind: "practica" })} />
            <span>Con la práctica en casa <span className="text-muted-foreground">(te avisamos para que confirmes)</span></span>
          </label>
          {f.kind === "practica" && (
            <div className="flex flex-wrap items-center gap-2 pl-6 text-sm">
              <Label htmlFor={diasId} className="font-normal">practicar</Label>
              <Input id={diasId} type="number" inputMode="numeric" min={1} max={maxDias} value={f.dias}
                className="h-8 w-16 bg-background" onChange={(e) => set({ dias: e.target.value })} />
              <Label htmlFor={semanasId} className="font-normal">días en</Label>
              <Input id={semanasId} type="number" inputMode="numeric" min={1} max={L.goal_weeks_max} value={f.semanas}
                className="h-8 w-16 bg-background" onChange={(e) => set({ semanas: e.target.value })} />
              <span>semanas</span>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name={kindName} className="mt-1" checked={f.kind === "terapeutica"} onChange={() => set({ kind: "terapeutica" })} />
            La valido yo en la sesión
          </label>
        </div>
      </fieldset>

      <MedalTitleField id={medalId} blockId={medalBlockId} value={f.medal} block={medalBlock} optional
        label="Medalla al cumplirla" onChange={(v) => set({ medal: v })} />

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={f.agreed} onChange={(e) => set({ agreed: e.target.checked })} />
        La elegimos junto con {p.first_name}
      </label>
      {draftPlan && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={f.withPlan} onChange={(e) => set({ withPlan: e.target.checked })} />
          Publicarla junto con el plan en borrador
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        La meta empieza como borrador: no se ve en el portal hasta que la publiques, con el plan o con «Publicar meta».
      </p>

      <ErrorBox error={error} onReload={() => { setError(null); void reload(); }} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className={PILL_BTN} disabled={acting} onClick={onClose}>Cancelar</Button>
        <Button type="submit" size="sm" className={PILL_BTN} disabled={acting || busy || titleBlock.length > 0 || medalBlock.length > 0}
          aria-busy={acting}>
          {acting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {f.id ? "Guardar cambios" : "Guardar meta"}
        </Button>
      </div>
    </form>
  );
}

function MedalItem({ m, data, canVoid, busy, onVoid }: {
  m: StaffMedalDTO; data: StaffPracticeDTO; canVoid: boolean; busy: boolean; onVoid: () => void;
}) {
  const goal = m.goal_id ? data.goals.find((g) => g.id === m.goal_id) : undefined;
  const period = m.period_key
    ? m.code === "semana_cumplida" ? `semana del ${day(m.period_key)}` : m.code === "de_vuelta" ? `volvió el ${day(m.period_key)}` : null
    : null;
  const seen = readsLine(m.seen_by);
  return (
    <li className={`space-y-1 py-3 text-sm first:pt-0 last:pb-0 ${m.voided_at ? "text-muted-foreground" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Award className={`h-4 w-4 shrink-0 ${m.voided_at ? "" : "text-[color:var(--primary-deep)]"}`} aria-hidden="true" />
        <span className={`font-semibold ${m.voided_at ? "line-through" : ""}`}>{medalName(m)}</span>
        <Pill tone={m.kind === "profesional" ? "info" : "muted"}>{m.kind === "profesional" ? "Del profesional" : "Por constancia"}</Pill>
        {m.voided_at && <Pill tone="bad">Anulada</Pill>}
        <span className="ml-auto text-xs text-muted-foreground">{day(m.awarded_at)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {[
          period,
          m.awarded_by_email ? `La dio ${m.awarded_by_email}` : "Automática",
          goal ? `por la meta «${goalLabel(goal)}»` : null,
        ].filter(Boolean).join(" · ")}
      </p>
      {m.message && <p className="whitespace-pre-line">«{m.message}»</p>}
      {!m.voided_at && <p className="text-xs text-muted-foreground">{seen ?? "Todavía nadie de la familia la vio"}</p>}
      {m.voided_at && (
        <p className="text-xs">
          Anulada el {day(m.voided_at)}{m.voided_by_email ? ` por ${m.voided_by_email}` : ""}{m.void_reason ? `: ${m.void_reason}` : ""}
        </p>
      )}
      {canVoid && (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={busy} onClick={onVoid}>Retirar</Button>
        </div>
      )}
    </li>
  );
}

function PublishGoalDialog({ data, goal, busy, send, onClose, onReload }: {
  data: StaffPracticeDTO; goal: StaffGoalDTO; busy: boolean; send: FollowupProps["send"];
  onClose: () => void; onReload: () => void;
}) {
  const p = data.patient;
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [acting, setActing] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (acting || busy || (p.adolescent && !ack)) return;
    setError(null);
    setActing(true);
    const r = await send({ action: "goal_publish", patient_id: p.id, goal_id: goal.id, ...(p.adolescent ? { adolescent_ack: ack } : {}) });
    setActing(false);
    if (!r.ok) { setError(uiError(r)); return; }
    toast.success(r.data.readers.length
      ? `Meta publicada. La ven en el portal: ${joinNames(r.data.readers)}.`
      : "Meta publicada. Se va a ver cuando alguien active el portal.");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !acting) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>¿Publicar la meta?</DialogTitle>
          <DialogDescription>«{goalLabel(goal)}»{goal.rule ? ` · ${goalRuleText(goal.rule)}` : ""}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="flex gap-2 rounded-xl bg-[color:var(--primary-soft)] px-3 py-2 text-sm">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--primary-deep)]" aria-hidden="true" />
            <span>{data.readers_line}</span>
          </p>
          {goal.kind === "practica" && (
            <p className="text-xs text-muted-foreground">
              Cuando se cumpla te avisamos en Portal → Prácticas: la das por lograda vos, con una devolución.
            </p>
          )}
          {p.adolescent && (
            <label className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Lo conversé con {p.first_name}{p.age !== null ? ` (${p.age} años)` : ""}
            </label>
          )}
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={acting} onClose={onClose} submit="Publicar meta" disabled={busy || (p.adolescent && !ack)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeGoalDialog({ data, goal, busy, send, onClose, onReload, onChanged }: {
  data: StaffPracticeDTO; goal: StaffGoalDTO; busy: boolean; send: FollowupProps["send"];
  onClose: () => void; onReload: () => void; onChanged: (g: StaffGoalDTO) => void;
}) {
  const [error, setError] = useState<UiError | null>(null);
  const [acting, setActing] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (acting || busy) return;
    setError(null);
    setActing(true);
    const r = await send({ action: "goal_change", patient_id: data.patient.id, goal_id: goal.id });
    setActing(false);
    if (!r.ok) { setError(uiError(r)); return; }
    toast.success("La meta quedó como «Cambiada». Armá la nueva y publicala cuando esté lista.");
    onChanged(goal);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !acting) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>¿Cambiar la meta?</DialogTitle>
          <DialogDescription>«{goalLabel(goal)}»</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm">
            Deja de estar activa en el portal y nunca aparece como «no cumplida». Después te dejamos una meta nueva con
            estos datos para que la ajustes y la publiques.
          </p>
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={acting} onClose={onClose} submit="Cambiar la meta" disabled={busy} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidMedalDialog({ data, medal, busy, send, onClose, onReload }: {
  data: StaffPracticeDTO; medal: StaffMedalDTO; busy: boolean; send: FollowupProps["send"];
  onClose: () => void; onReload: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<UiError | null>(null);
  const [acting, setActing] = useState(false);
  const reasonId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (acting || busy) return;
    setError(null);
    const clean = reason.replace(/\s+/g, " ").trim();
    if (clean.length < 3) { setError({ message: PRACTICE_ERROR.void_reason, stale: false }); return; }
    setActing(true);
    const r = await send({ action: "medal_void", patient_id: data.patient.id, medal_id: medal.id, reason: clean });
    setActing(false);
    if (!r.ok) { setError(uiError(r)); return; }
    toast.success("Se retiró la medalla del portal.");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !acting) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Retirar la medalla</DialogTitle>
          <DialogDescription>«{medalName(medal)}» · {day(medal.awarded_at)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className={WARN_BOX}>
            Es solo para errores (por ejemplo, una práctica anotada por equivocación). Una medalla bien ganada no se pierde nunca.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>¿Por qué se anula?</Label>
            <Textarea id={reasonId} rows={2} maxLength={L.void_reason} value={reason} autoFocus
              onChange={(e) => { setError(null); setReason(e.target.value); }} />
            <Counter n={reason.length} max={L.void_reason} />
          </div>
          <p className="text-sm">Deja de verse en el portal. Queda guardada acá, con tu usuario, la fecha y el motivo.</p>
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={acting} onClose={onClose} submit="Retirar" destructive disabled={busy} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function Block({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-3 border-t border-border/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 id={id} className="text-sm font-semibold">{title}</h5>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}>{children}</span>;
}

function Counter({ n, max }: { n: number; max: number }) {
  return <p className={`text-right text-xs ${n >= max ? PENDING_TEXT : "text-muted-foreground"}`}>{n}/{max}</p>;
}

// Nombre de una medalla del profesional: sugeridos o uno propio (sin fluidez)
function MedalTitleField({ id, blockId, value, block, label = "Nombre de la medalla", optional = false, onChange }: {
  id: string; blockId: string; value: string; block: string[]; label?: string; optional?: boolean; onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}{optional && <span className="font-normal text-muted-foreground"> (opcional)</span>}
      </Label>
      <div role="group" aria-label="Nombres sugeridos" className="flex flex-wrap gap-1.5">
        {PRO_MEDAL_SUGGESTIONS.map((s) => {
          const on = value === s;
          return (
            <button key={s} type="button" aria-pressed={on} onClick={() => onChange(on ? "" : s)} className={[
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-left text-xs font-semibold transition-colors",
              on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
            ].join(" ")}>
              {on && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
              {s}
            </button>
          );
        })}
      </div>
      <Input id={id} value={value} maxLength={L.medal_title} className="bg-background" placeholder="O escribí otro nombre"
        aria-invalid={block.length > 0} aria-describedby={block.length ? blockId : undefined}
        onChange={(e) => onChange(e.target.value)} />
      {block.length > 0 && <p id={blockId} role="alert" className={ERROR_BOX}>{FLUENCY_TITLE_MESSAGE}</p>}
    </div>
  );
}

// Avisos del texto: no bloquean, pero para dejarlo hay que contar por qué
function FluencyReview({ phrases, keep, note, onFix, onKeep, onNote }: {
  phrases: string[]; keep: boolean; note: string; onFix: () => void; onKeep: () => void; onNote: (v: string) => void;
}) {
  const noteId = useId();
  if (!phrases.length) return null;
  return (
    <div className="space-y-2 rounded-xl bg-[color:var(--status-pending-bg)] p-3 text-sm text-[oklch(0.42_0.1_70)]">
      <p className="flex gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          El texto dice «{phrases.join("», «")}». En el portal no prometemos ni medimos fluidez: puede sumar presión.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={onFix}>Corregirlo</Button>
        {!keep && <Button type="button" size="sm" variant="ghost" className={PILL_BTN} onClick={onKeep}>Lo dejo así</Button>}
      </div>
      {keep && (
        <div className="space-y-1.5">
          <Label htmlFor={noteId} className="text-foreground">¿Por qué lo dejás así?</Label>
          <Input id={noteId} value={note} maxLength={L.review_note} autoFocus className="bg-background"
            placeholder="Ej.: es la palabra que usa la familia" onChange={(e) => onNote(e.target.value)} />
          <p className="text-xs">Queda guardado con la devolución. La familia no lo ve.</p>
        </div>
      )}
    </div>
  );
}

function ErrorBox({ error, onReload }: { error: UiError | null; onReload: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className={`${ERROR_BOX} flex flex-wrap items-center justify-between gap-2`}>
      <span>{error.message}</span>
      {error.stale && (
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={onReload}>Actualizar</Button>
      )}
    </div>
  );
}

function DialogButtons({ busy, onClose, submit, disabled, destructive }: {
  busy: boolean; onClose: () => void; submit: string; disabled?: boolean; destructive?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || disabled} className="rounded-full"
        aria-busy={busy}>
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {submit}
      </Button>
    </div>
  );
}
