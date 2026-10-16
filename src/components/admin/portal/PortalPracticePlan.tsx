import { Fragment, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, BookOpen, ChevronDown, Loader2, PenLine, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { selectClass } from "../fields";
import type { ApiResult } from "@/lib/portal";
import { cleanText } from "@/lib/portalInfoRules";
import { addDaysKey, centerDateOf } from "@/lib/portalRules";
import { catalogEntry } from "@/lib/exerciseCatalog";
import {
  type Approach, type CatalogEntry, type ExerciseInput, type ExerciseSource, type PlanAudience, type PlanCloseReason,
  type PlanDraftInput, type PlanWithdrawReason, type ScreenMode,
  APPROACH_ADULT_GUIDE, APPROACH_AREA, APPROACH_LABEL, APPROACH_RULES, LIDCOMBE_NOTICE, PLAN_AUDIENCES, PLAN_AUDIENCE_LABEL,
  PLAN_STATUS_LABEL, PLAN_WITHDRAW_REASONS, PRACTICE_ERROR, PRACTICE_LIMITS, SCREEN_MODE_BY_AUDIENCE, STAFF_PRACTICE_TEXT,
  WITHDRAW_REASON_LABEL, authorName, breakLine, centerToday, ddmm, exerciseTextAlerts, joinNames, onBreak, planSummary,
  planTextAlerts, validatePlanDraft,
} from "@/lib/practiceRules";
import {
  type Adaptacion, type AiAdaptParams, type AiMinutes, type AiSentDescription, type Contexto, type Dificultad,
  type ExerciseDraftItem, type Formato, type Interes, type QuienAcompana,
  ADAPTATIONS, ADAPTATION_LABEL, AI_ERROR, AGE_BAND_LABEL, AI_CATALOG_MAX, AI_INTERESTS_MAX, AI_MINUTES, CONTEXTS, CONTEXT_LABEL,
  DIFFICULTIES, DIFFICULTY_LABEL, FORMATS, FORMAT_HINT, FORMAT_LABEL, INTERESTS, INTEREST_LABEL, QUIEN_ACOMPANA, QUIEN_ACOMPANA_LABEL,
  ageBand, describeSent, draftToExerciseInput, formatAllowed,
} from "@/lib/aiDraftRules";
import type { Why } from "@/lib/practiceSuggest";
import {
  type AiDraftRequest, type AiDraftResult, type DraftFlag, type PracticeAction, type StaffExerciseDTO, type StaffPlanDTO,
  type StaffPracticeDTO, portalStaffApi,
} from "@/lib/portalStaff";
import { type UnsavedPart, forgetUnsaved, keepUnsaved, peekUnsaved } from "./practiceHandoff";

// Vista "Plan de práctica" de "Portal del paciente" (etapas practice y ai).
// El profesional arma el plan con ejercicios del catálogo aprobado, a mano o
// adaptados con ayuda de IA (la IA solo prepara un borrador: nada se publica
// sin «Lo revisé»). Editar lo publicado arma una versión nueva en borrador:
// la familia sigue viendo la publicada hasta que se publica la nueva. Las
// reglas están en practiceRules.ts y aiDraftRules.ts; el servidor
// (server/api/portal-staff/practice.ts y ai-draft.ts) vuelve a controlar todo.
// Administración ve estados, sin los textos.

// ── Contrato con PortalPracticeSection (las tres vistas reciben lo mismo) ──
export type PracticeSent = { ok: true; data: StaffPracticeDTO } | { ok: false; status: number; error: string; code?: string };
export type PracticeSend = (body: PracticeAction) => Promise<PracticeSent>;
export type PracticeViewProps = {
  data: StaffPracticeDTO;
  busy: boolean;
  send: PracticeSend;
  reload: () => Promise<void>;
  /** Cambios sin guardar de cada parte (la sección pregunta antes de cerrarse y avisa al salir de la página) */
  onDirty?: (part: UnsavedPart, dirty: boolean) => void;
  /** Quién usa el panel (practiceHandoff.unsavedOwner): lo sin guardar queda aparte solo para esa persona. Sin owner, no queda nada */
  owner?: string | null;
};

type SendError = { message: string; stale: boolean }; // stale: otra persona lo cambió (409)
type Tone = "ok" | "warn" | "muted" | "ai";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-[color:var(--status-available-bg)] text-[oklch(0.42_0.12_150)]",
  warn: "bg-[color:var(--status-pending-bg)] text-[oklch(0.45_0.11_70)]",
  muted: "bg-muted text-muted-foreground",
  ai: "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]",
};
const PENDING_TEXT = "text-[oklch(0.45_0.11_70)]";
const ERROR_TEXT = "text-[oklch(0.48_0.19_25)]";
const ERROR_BOX = "rounded-xl bg-[color:var(--status-occupied-bg)] px-3 py-2 text-sm font-semibold text-[oklch(0.48_0.19_25)]";
const WARN_BOX = "rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm text-[oklch(0.42_0.1_70)]";
const PILL_BTN = "h-8 rounded-full";
const TITLE = "font-display text-2xl text-[color:var(--primary-deep)]";
const L = PRACTICE_LIMITS;

const MODE_LABEL: Record<ScreenMode, string> = {
  tortuga: "con la tortuga y caritas",
  pasos: "paso a paso",
  lista: "lista de pasos",
};

const CLOSE_REASON_LABEL: Record<PlanCloseReason, string> = {
  ...WITHDRAW_REASON_LABEL,
  reemplazado: "Reemplazado por una versión nueva",
  finalizado: "Finalizado",
  descartado: "Borrador descartado",
};

const SI_CUESTA_BASE = "Si cuesta, paren ahí y prueben otro día. Cuéntenlo en la próxima sesión.";

// ── Fechas y textos ─────────────────────────────────────────────────────────

const two = (n: number) => String(n).padStart(2, "0");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// AAAA-MM-DD → dd/mm (con el año si no es este)
function dk(key: string): string {
  return key.slice(0, 4) === centerToday().slice(0, 4) ? ddmm(key) : `${ddmm(key)}/${key.slice(0, 4)}`;
}

// ISO → dd/mm en la fecha del centro
const dm = (iso: string) => dk(centerDateOf(iso));

function hm(iso: string): string {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

const line = (s: string) => s.replace(/\s+/g, " ").trim();

// Pedido a la IA: una falla inesperada se muestra como "no disponible" (armar el plan nunca depende del proveedor)
function requestDraft(req: AiDraftRequest): Promise<ApiResult<AiDraftResult>> {
  return portalStaffApi.aiDraft(req).catch(() => ({ ok: false as const, status: 503, error: AI_ERROR.unavailable }));
}

// "Plan de práctica · Lic. Ana Torres · publicado el 03/10 · 3 ejercicios, 4 días por semana, 10 min · Revisar el 03/11"
function planLine(p: StaffPlanDTO): string {
  const parts = ["Plan de práctica"];
  if (p.author_label) parts.push(authorName(p.author_label));
  if (p.published_at) parts.push(`publicado el ${dm(p.published_at)}`);
  parts.push(`${p.exercise_count} ${plural(p.exercise_count, "ejercicio", "ejercicios")}, ${p.days_per_week} ${plural(p.days_per_week, "día", "días")} por semana, ${p.total_minutes} min`);
  if (p.review_on) parts.push(`Revisar el ${dk(p.review_on)}`);
  return parts.join(" · ");
}

// ── Formulario del editor ───────────────────────────────────────────────────

// Lo que vino con la propuesta de la IA (solo vive en esta pantalla)
type AiExtras = { batch: string; flags: DraftFlag[]; variantes: ExerciseDraftItem["variantes"] };

type ExForm = {
  uid: string; // clave local (React)
  id: string | null; // fila de este borrador (null: todavía no se guardó)
  exercise_key: string | null; // identidad entre versiones (null: ejercicio nuevo)
  source: ExerciseSource;
  catalog_id: string | null;
  catalog_version: string | null;
  ai_draft_id: string | null;
  ai_locked: boolean; // fila guardada que quedó adaptada con IA (la base no la desmarca)
  approach: Approach;
  practiced_in_session: boolean;
  title: string;
  para_que: string;
  pasos: string[];
  minutes: string;
  materiales: string;
  for_adult: string;
  si_cuesta: string;
  with_adult: boolean;
  reviewed: boolean; // "Lo revisé"
  removed: boolean; // "Quitar": no se borra, se marca
  keep: boolean; // "Lo dejo así"
  note: string; // su motivo
  ai: AiExtras | null;
};

type PlanForm = {
  id: string | null; // borrador guardado (null: todavía no se guardó)
  base: string | null; // updated_at del borrador del que partió (expected_updated_at)
  seed: string; // lo guardado (o de lo que partió), para saber si hay cambios
  title: string;
  goal_text: string;
  audience: PlanAudience;
  days: number;
  review_on: string;
  auto_medals: boolean;
  keep: boolean;
  note: string;
  exercises: ExForm[];
};

let uidSeq = 0;
const newUid = () => `ej-${++uidSeq}`;

const aiDrafted = (e: ExForm) => e.source === "ia" || e.ai_locked;
const noteOk = (keep: boolean, note: string) => keep && cleanText(note).length >= 3;

function exTexts(e: ExForm) {
  return { title: e.title, para_que: e.para_que, pasos: e.pasos, materiales: e.materiales || null, for_adult: e.for_adult || null, si_cuesta: e.si_cuesta };
}
const exAlerts = (e: ExForm) => exerciseTextAlerts(exTexts(e), e.approach);
const planAlerts = (f: PlanForm) => planTextAlerts({ title: f.title, goal_text: f.goal_text || null });

function toExerciseInput(e: ExForm): ExerciseInput {
  return {
    id: e.id,
    exercise_key: e.exercise_key,
    source: e.source,
    catalog_id: e.catalog_id,
    catalog_version: e.catalog_version,
    ai_draft_id: e.ai_draft_id,
    approach: e.approach,
    practiced_in_session: e.practiced_in_session && APPROACH_RULES[e.approach].needs_session,
    title: e.title,
    para_que: e.para_que,
    pasos: e.pasos,
    minutes: Number(e.minutes),
    materiales: e.materiales.trim() ? e.materiales : null,
    for_adult: e.for_adult.trim() ? e.for_adult : null,
    si_cuesta: e.si_cuesta,
    with_adult: e.with_adult,
    reviewed: e.reviewed && aiDrafted(e),
    removed: e.removed,
    review_note: e.keep && exAlerts(e).length ? e.note : null,
  };
}

function toInput(f: PlanForm): PlanDraftInput {
  return {
    id: f.id,
    title: f.title,
    goal_text: f.goal_text.trim() ? f.goal_text : null,
    audience: f.audience,
    days_per_week: f.days,
    review_on: f.review_on || null,
    auto_medals: f.auto_medals,
    review_note: f.keep && planAlerts(f).length ? f.note : null,
    exercises: f.exercises.map(toExerciseInput),
  };
}

// Forma comparable (los textos limpios, como los guarda el servidor)
function canon(f: PlanForm): string {
  const i = toInput(f);
  const t = (s: string | null) => (s === null ? null : cleanText(s) || null);
  return JSON.stringify({
    ...i, title: line(i.title), goal_text: t(i.goal_text), review_note: t(i.review_note),
    exercises: i.exercises.map((e) => ({
      ...e, title: line(e.title), para_que: t(e.para_que), pasos: e.pasos.map(line).filter(Boolean),
      materiales: t(e.materiales), for_adult: t(e.for_adult), si_cuesta: t(e.si_cuesta), review_note: t(e.review_note),
    })),
  });
}

const isDirty = (f: PlanForm) => canon(f) !== f.seed;

// keepRow: es una fila de este borrador (si no, se copia a una versión nueva)
function fromDto(e: StaffExerciseDTO, keepRow: boolean): ExForm {
  const last = e.lint_overrides[e.lint_overrides.length - 1];
  return {
    uid: newUid(),
    id: keepRow ? e.id : null,
    exercise_key: e.exercise_key,
    source: e.source,
    catalog_id: e.catalog_id,
    catalog_version: e.catalog_version,
    ai_draft_id: e.ai_draft_id,
    ai_locked: keepRow && e.ai_drafted,
    approach: e.approach,
    practiced_in_session: e.practiced_in_session,
    title: e.title,
    para_que: e.para_que,
    pasos: [...e.pasos],
    minutes: String(e.minutes),
    materiales: e.materiales ?? "",
    for_adult: e.for_adult ?? "",
    si_cuesta: e.si_cuesta,
    with_adult: e.with_adult,
    reviewed: !!e.reviewed_at,
    removed: keepRow && !!e.removed_at,
    keep: !!last,
    note: last?.reason ?? "",
    ai: null,
  };
}

// asDraft: el borrador guardado; si no, una versión nueva a partir del publicado
function fromPlan(p: StaffPlanDTO, asDraft: boolean): PlanForm {
  const last = p.lint_overrides[p.lint_overrides.length - 1];
  const f: PlanForm = {
    id: asDraft ? p.id : null,
    base: asDraft ? p.updated_at : null,
    seed: "",
    title: p.title ?? "",
    goal_text: p.goal_text ?? "",
    audience: p.audience,
    days: p.days_per_week,
    review_on: p.review_on ?? "",
    auto_medals: p.auto_medals,
    keep: !!last,
    note: last?.reason ?? "",
    exercises: (asDraft ? p.exercises : p.exercises.filter((e) => !e.removed_at)).map((e) => fromDto(e, asDraft)),
  };
  f.seed = canon(f);
  return f;
}

function emptyForm(data: StaffPracticeDTO): PlanForm {
  const f: PlanForm = {
    id: null, base: null, seed: "", title: "", goal_text: "", audience: data.patient.audience,
    days: L.days_per_week_default, review_on: "", auto_medals: true, keep: false, note: "", exercises: [],
  };
  f.seed = canon(f);
  return f;
}

// De dónde arranca el editor: el borrador guardado, una versión nueva del publicado o un plan vacío
function startForm(data: StaffPracticeDTO): PlanForm {
  if (data.draft) return fromPlan(data.draft, true);
  if (data.published) return fromPlan(data.published, false);
  return emptyForm(data);
}

// Después de guardar: las tarjetas conservan su clave y lo que vino de la IA
function carry(next: PlanForm, prev: PlanForm): PlanForm {
  if (next.exercises.length !== prev.exercises.length) return next;
  return { ...next, exercises: next.exercises.map((e, i) => ({ ...e, uid: prev.exercises[i].uid, ai: prev.exercises[i].ai })) };
}

function blankCard(): Omit<ExForm, "source" | "approach" | "title" | "para_que" | "pasos" | "minutes" | "materiales" | "for_adult" | "si_cuesta" | "with_adult"> {
  return {
    uid: newUid(), id: null, exercise_key: null, catalog_id: null, catalog_version: null, ai_draft_id: null, ai_locked: false,
    practiced_in_session: false, reviewed: false, removed: false, keep: false, note: "", ai: null,
  };
}

function catalogCard(entry: CatalogEntry, version: string): ExForm {
  return {
    ...blankCard(),
    source: "catalogo",
    catalog_id: entry.id,
    catalog_version: version,
    approach: entry.approach,
    title: entry.title,
    para_que: entry.para_que,
    pasos: [...entry.pasos],
    minutes: String(entry.minutes),
    materiales: entry.materiales,
    for_adult: entry.for_adult,
    si_cuesta: entry.si_cuesta,
    with_adult: entry.with_adult,
  };
}

// Enfoque para un ejercicio a mano: el primero sugerido que corresponde a la edad
function defaultApproach(data: StaffPracticeDTO): Approach {
  const ok = data.approaches.filter((o) => o.age_ok);
  return (ok.find((o) => o.suggested) ?? ok[0] ?? data.approaches[0])?.approach ?? "entorno_familia";
}

function manualCard(data: StaffPracticeDTO): ExForm {
  const approach = defaultApproach(data);
  return {
    ...blankCard(),
    source: "manual",
    approach,
    title: "",
    para_que: "",
    pasos: ["", ""],
    minutes: "5",
    materiales: "",
    for_adult: APPROACH_ADULT_GUIDE[approach],
    si_cuesta: SI_CUESTA_BASE,
    with_adult: !data.patient.self,
  };
}

function aiCard(item: ExerciseDraftItem, index: number, req: AiDraftRequest, res: AiDraftResult, batch: string): ExForm {
  const input = draftToExerciseInput(item, { approach: req.approach, practiced_in_session: req.practiced_in_session, draft_id: res.draft_id });
  return {
    ...blankCard(),
    source: input.source,
    catalog_id: input.catalog_id,
    catalog_version: input.catalog_version,
    ai_draft_id: input.ai_draft_id,
    approach: input.approach,
    practiced_in_session: input.practiced_in_session,
    title: input.title,
    para_que: input.para_que,
    pasos: [...input.pasos],
    minutes: String(input.minutes),
    materiales: input.materiales ?? "",
    for_adult: input.for_adult ?? "",
    si_cuesta: input.si_cuesta,
    with_adult: input.with_adult,
    ai: { batch, flags: res.flags.filter((f) => f.exercise === index), variantes: item.variantes },
  };
}

// Lo que todavía impide publicar (lo mismo que revisa el servidor, sin el diagnóstico: los enfoques ofrecidos ya lo tienen en cuenta)
function publishBlock(f: PlanForm, data: StaffPracticeDTO): { message: string; uid?: string } | null {
  const active = f.exercises.filter((e) => !e.removed);
  if (active.length < L.exercises_min || active.length > L.exercises_max) return { message: PRACTICE_ERROR.exercises };
  const pending = active.find((e) => aiDrafted(e) && !e.reviewed);
  if (pending) return { message: PRACTICE_ERROR.ai_not_reviewed, uid: pending.uid };
  const options = new Map(data.approaches.map((o) => [o.approach, o]));
  for (const e of active) {
    const o = options.get(e.approach);
    if (!o || !o.age_ok) return { message: PRACTICE_ERROR.approach, uid: e.uid };
    if (o.needs_session && !e.practiced_in_session) return { message: PRACTICE_ERROR.approach_session, uid: e.uid };
  }
  if (planAlerts(f).length && !noteOk(f.keep, f.note)) return { message: PRACTICE_ERROR.review };
  const unreviewed = active.find((e) => exAlerts(e).length > 0 && !noteOk(e.keep, e.note));
  if (unreviewed) return { message: PRACTICE_ERROR.review, uid: unreviewed.uid };
  return null;
}

// ── Vista ───────────────────────────────────────────────────────────────────

export function PortalPracticePlan(props: PracticeViewProps) {
  if (!props.data.can_edit) return <ReadOnlyPlan data={props.data} />;
  return <PlanEditorView {...props} />;
}

type Batch = { key: string; req: AiDraftRequest; result: AiDraftResult };
type DialogState = { kind: "catalog" } | { kind: "ai"; ids: string[] } | { kind: "publish" } | { kind: "break" } | { kind: "withdraw" } | null;
type FormError = { message: string; uid?: string };

const draftKeyOf = (d: StaffPlanDTO | null) => (d ? `${d.id}|${d.updated_at}` : null);

// Lo que queda aparte (practiceHandoff) si la ficha se cierra o se abre otra
// con cambios sin guardar: vuelve tal cual al abrir de nuevo la sección
type PlanKept = { form: PlanForm; batches: Batch[]; seenKey: string | null; openCards: string[] };

const batchNumber = (key: string) => Number(key.replace(/^ia-/, "")) || 0;

function PlanEditorView({ data, busy, send, reload, onDirty, owner = null }: PracticeViewProps) {
  const p = data.patient;
  const published = data.published;
  const serverDraft = data.draft;
  const draftKey = draftKeyOf(serverDraft);
  const [kept] = useState(() => peekUnsaved<PlanKept>(p.id, "plan", owner));
  const [form, setForm] = useState<PlanForm | null>(() => (kept ? kept.value.form : serverDraft ? fromPlan(serverDraft, true) : null));
  // Lo retomado conserva de qué borrador partió: si cambió mientras tanto, se avisa (ver "newer")
  const [seenKey, setSeenKey] = useState<string | null>(kept ? kept.value.seenKey : draftKey);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(data.catalog);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [batches, setBatches] = useState<Batch[]>(() => kept?.value.batches ?? []);
  const [aiRunning, setAiRunning] = useState<string | null>(null); // propuesta o tarjeta que se está rehaciendo
  const [aiError, setAiError] = useState<{ at: string; message: string } | null>(null);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [error, setError] = useState<SendError | null>(null);
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set(kept?.value.openCards ?? []));
  const [restoredAt, setRestoredAt] = useState<string | null>(() => (kept ? new Date(kept.at).toISOString() : null));
  const pendingOwn = useRef(false); // una acción propia en camino: lo que vuelve no es "de otra persona"
  const formRef = useRef(form);
  const batchSeq = useRef(Math.max(0, ...(kept?.value.batches ?? []).map((b) => batchNumber(b.key))));
  const alive = useRef(true);
  formRef.current = form;
  const keepRef = useRef<Omit<PlanKept, "form"> & { form: PlanForm | null }>({ form, batches, seenKey, openCards: [] });
  keepRef.current = { form, batches, seenKey, openCards: [...openCards] };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Cambió el borrador guardado (otra persona, otra pestaña o una recarga):
  // si no había cambios sin guardar, el editor pasa a lo guardado; si los
  // había, no se pisa nada y se avisa (ver "newer")
  if (draftKey !== seenKey && !pendingOwn.current) {
    setSeenKey(draftKey);
    if (!form || !isDirty(form)) setForm(serverDraft ? fromPlan(serverDraft, true) : null);
  }
  const newer = !!form && !pendingOwn.current
    && (form.id ? serverDraft?.id !== form.id || serverDraft?.updated_at !== form.base : !!serverDraft);

  const dirty = !!form && isDirty(form);
  const activeCount = form ? form.exercises.filter((e) => !e.removed).length : 0;

  // Cambios sin guardar: la sección pregunta antes de cerrarse y avisa al salir de la página
  useEffect(() => {
    onDirty?.("plan", dirty);
    return () => onDirty?.("plan", false);
  }, [dirty, onDirty]);

  // Si la ficha se cierra (o se abre otra) con cambios sin guardar, quedan
  // aparte en esta pestaña (solo para owner) y vuelven al abrir de nuevo la
  // sección. Al montarse, lo que había quedado aparte ya está en pantalla
  useEffect(() => {
    const id = p.id;
    forgetUnsaved(id, "plan", owner);
    return () => {
      const k = keepRef.current;
      if (k.form && isDirty(k.form)) keepUnsaved(id, "plan", owner, { ...k, form: k.form } satisfies PlanKept);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiPending = !!form && form.exercises.some((e) => !e.removed && aiDrafted(e) && !e.reviewed);
  const base = form ?? startForm(data);
  const room = Math.max(0, Math.min(
    L.exercises_in_draft_max - base.exercises.length,
    L.exercises_max - base.exercises.filter((e) => !e.removed).length,
  ));
  const inPlan = new Set(base.exercises.filter((e) => !e.removed && e.catalog_id).map((e) => e.catalog_id as string));
  const publishedKeys = new Set(published?.exercises.map((e) => e.exercise_key) ?? []);

  // ── Cambios en el formulario ──
  const setPlan = (patch: Partial<PlanForm>) => { setFormError(null); setForm((f) => (f ? { ...f, ...patch } : f)); };
  const updateEx = (uid: string, patch: Partial<ExForm>) => {
    setFormError(null);
    setForm((f) => (f ? { ...f, exercises: f.exercises.map((e) => (e.uid === uid ? { ...e, ...patch } : e)) } : f));
  };
  const toggleCard = (uid: string) => setOpenCards((s) => {
    const next = new Set(s);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });
  const openCard = (uid: string) => setOpenCards((s) => new Set(s).add(uid));

  function move(uid: string, dir: -1 | 1) {
    setForm((f) => {
      if (!f) return f;
      const i = f.exercises.findIndex((e) => e.uid === uid);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= f.exercises.length) return f;
      const list = [...f.exercises];
      [list[i], list[j]] = [list[j], list[i]];
      return { ...f, exercises: list };
    });
  }

  // Quitar: lo que ya tiene historia (guardado o publicado) se marca; lo nuevo se saca
  function removeEx(uid: string) {
    setFormError(null);
    setForm((f) => {
      if (!f) return f;
      return {
        ...f,
        exercises: f.exercises.flatMap((e) => {
          if (e.uid !== uid) return [e];
          if (e.id || e.exercise_key) return [{ ...e, removed: !e.removed }];
          return [];
        }),
      };
    });
  }

  function addCards(cards: ExForm[]): boolean {
    const f = formRef.current ?? startForm(data);
    const active = f.exercises.filter((e) => !e.removed).length;
    if (f.exercises.length + cards.length > L.exercises_in_draft_max || active + cards.length > L.exercises_max) {
      toast.error(PRACTICE_ERROR.exercises);
      return false;
    }
    const next = { ...f, exercises: [...f.exercises, ...cards] };
    formRef.current = next;
    setForm(next);
    setFormError(null);
    setOpenCards((s) => new Set([...s, ...cards.map((c) => c.uid)]));
    return true;
  }

  async function ensureCatalog(): Promise<CatalogEntry[] | null> {
    if (catalog) return catalog;
    setCatalogLoading(true);
    setCatalogError(null);
    const r = await send({ action: "catalog", patient_id: p.id });
    if (!alive.current) return null;
    setCatalogLoading(false);
    if (!r.ok) { setCatalogError(r.error); return null; }
    const list = r.data.catalog ?? [];
    setCatalog(list);
    return list;
  }

  async function openCatalog() {
    if (await ensureCatalog()) setDialog({ kind: "catalog" });
  }

  async function openAi(ids: string[] = []) {
    if (await ensureCatalog()) setDialog({ kind: "ai", ids });
  }

  function addFromCatalog(entries: CatalogEntry[]) {
    if (!addCards(entries.map((e) => catalogCard(e, data.catalog_version)))) return;
    setDialog(null);
    toast.success(entries.length === 1 ? `Se sumó «${entries[0].title}» al borrador.` : `Se sumaron ${entries.length} ejercicios al borrador.`);
  }

  function addManual() {
    const card = manualCard(data);
    if (addCards([card])) toast.success("Se sumó un ejercicio nuevo al borrador: completalo.");
  }

  // ── IA ──
  function addBatch(req: AiDraftRequest, result: AiDraftResult): string {
    const key = `ia-${++batchSeq.current}`;
    setBatches((b) => [...b, { key, req, result }]);
    return key;
  }

  function onAiResult(req: AiDraftRequest, res: AiDraftResult) {
    const key = addBatch(req, res);
    const cards = res.draft.ejercicios.map((item, i) => aiCard(item, i, req, res, key));
    if (!addCards(cards)) return;
    setDialog(null);
    toast.success("Propuesta lista. Revisá cada ejercicio y marcá «Lo revisé».");
  }

  async function runAi(at: string, req: AiDraftRequest): Promise<AiDraftResult | null> {
    setAiRunning(at);
    setAiError(null);
    const r = await requestDraft({ ...req, patient_id: p.id });
    if (!alive.current) return null;
    setAiRunning(null);
    if (!r.ok) { setAiError({ at, message: r.error }); return null; }
    return r.data;
  }

  // Reemplaza el texto de una tarjeta por el de la IA (conserva la fila y su identidad)
  function replaceWithAi(old: ExForm, res: AiDraftResult, req: AiDraftRequest, batch: string): ExForm {
    const i = res.draft.ejercicios.findIndex((x) => x.catalogo_id === old.catalog_id);
    if (i < 0) return old;
    const card = aiCard(res.draft.ejercicios[i], i, req, res, batch);
    return { ...card, uid: old.uid, id: old.id, exercise_key: old.exercise_key, ai_locked: old.ai_locked };
  }

  // "Otra versión": se vuelven a pedir los ejercicios de la propuesta que siguen en el plan
  async function otherVersion(b: Batch) {
    const cards = formRef.current?.exercises.filter((e) => e.ai?.batch === b.key && !e.removed && e.catalog_id) ?? [];
    const ids = [...new Set(cards.map((c) => c.catalog_id as string))];
    if (!ids.length) return;
    const req = { ...b.req, catalog_ids: ids };
    const res = await runAi(b.key, req);
    if (!res) return;
    const key = addBatch(req, res);
    setForm((f) => (f ? { ...f, exercises: f.exercises.map((e) => (e.ai?.batch === b.key && !e.removed ? replaceWithAi(e, res, req, key) : e)) } : f));
    toast.success("Llegó otra versión: revisala y marcá «Lo revisé».");
  }

  async function redoCard(e: ExForm) {
    const b = batches.find((x) => x.key === e.ai?.batch);
    if (!b || !e.catalog_id) return;
    const req = { ...b.req, catalog_ids: [e.catalog_id] };
    const res = await runAi(e.uid, req);
    if (!res) return;
    const key = addBatch(req, res);
    setForm((f) => (f ? { ...f, exercises: f.exercises.map((x) => (x.uid === e.uid ? replaceWithAi(x, res, req, key) : x)) } : f));
  }

  function discardBatch(b: Batch) {
    setFormError(null);
    setForm((f) => (f ? {
      ...f,
      exercises: f.exercises.flatMap((e) => {
        if (e.ai?.batch !== b.key) return [e];
        return e.id || e.exercise_key ? [{ ...e, removed: true }] : [];
      }),
    } : f));
  }

  // "Usar el original del catálogo": vuelve al texto aprobado. Una fila ya
  // guardada como adaptada con IA queda marcada (la base no la desmarca) y
  // sigue pidiendo «Lo revisé»
  function restoreOriginal(e: ExForm) {
    const entry = (e.catalog_id && (catalog?.find((c) => c.id === e.catalog_id) ?? catalogEntry(e.catalog_id))) || null;
    if (!entry) { toast.error("Ese ejercicio ya no está en el catálogo."); return; }
    updateEx(e.uid, {
      ...(e.ai_locked ? {} : { source: "catalogo" as const, ai_draft_id: null, catalog_version: data.catalog_version }),
      title: entry.title, para_que: entry.para_que, pasos: [...entry.pasos], minutes: String(entry.minutes),
      materiales: entry.materiales, for_adult: entry.for_adult, si_cuesta: entry.si_cuesta, with_adult: entry.with_adult,
      reviewed: false, keep: false, note: "", ai: null,
    });
  }

  // ── Guardar, publicar, descartar ──
  function showFormError(err: FormError) {
    setFormError(err);
    if (err.uid) openCard(err.uid);
  }

  async function save(): Promise<StaffPlanDTO | null> {
    const f = formRef.current;
    if (!f) return null;
    setFormError(null);
    setError(null);
    const v = validatePlanDraft(toInput(f));
    if (!v.ok) {
      const uid = v.index !== undefined ? f.exercises[v.index]?.uid : undefined;
      showFormError({ message: v.index !== undefined ? `Ejercicio ${v.index + 1}: ${v.error}` : v.error, uid });
      return null;
    }
    pendingOwn.current = true;
    const r = await send({ action: "plan_save_draft", patient_id: p.id, expected_updated_at: f.base, plan: v.value });
    pendingOwn.current = false;
    if (!alive.current) return null;
    if (!r.ok) { setError({ message: r.error, stale: r.status === 409 }); return null; }
    const d = r.data.draft;
    setSeenKey(draftKeyOf(d));
    setForm(d ? carry(fromPlan(d, true), formRef.current ?? f) : null);
    setRestoredAt(null);
    return d;
  }

  async function onSave() {
    const d = await save();
    if (d) toast.success(published ? "Borrador guardado. La familia sigue viendo el plan publicado." : "Borrador guardado. Todavía no se ve en el portal.");
  }

  async function askPublish() {
    const f = formRef.current;
    if (!f) return;
    setFormError(null);
    setError(null);
    const problem = publishBlock(f, data);
    if (problem) { showFormError(problem); return; }
    let d: StaffPlanDTO | null = serverDraft && f.id === serverDraft.id ? serverDraft : null;
    if (!d || isDirty(f)) d = await save();
    if (!d) return;
    if (d.publish_problem) { setFormError({ message: d.publish_problem }); return; }
    setDialog({ kind: "publish" });
  }

  async function publish(ack: boolean): Promise<PracticeSent> {
    const d = data.draft;
    if (!d) return { ok: false, status: 409, error: PRACTICE_ERROR.conflict };
    pendingOwn.current = true;
    const r = await send({
      action: "plan_publish", patient_id: p.id, plan_id: d.id, expected_updated_at: d.updated_at,
      expected_published_id: data.published?.id ?? null,
      ...(p.adolescent ? { adolescent_ack: ack } : {}),
    });
    pendingOwn.current = false;
    if (!alive.current || !r.ok) return r;
    setSeenKey(draftKeyOf(r.data.draft));
    setForm(r.data.draft ? fromPlan(r.data.draft, true) : null);
    setBatches([]);
    setRestoredAt(null);
    setDialog(null);
    toast.success(r.data.readers.length
      ? `Plan publicado. ${joinNames(r.data.readers)} ${r.data.readers.length === 1 ? "lo ve" : "lo ven"} en el portal.`
      : "Plan publicado. Se va a ver cuando alguien active el portal.");
    return r;
  }

  async function discardDraft(): Promise<boolean> {
    const f = formRef.current;
    if (!f) return true;
    if (!f.id) { setForm(null); setBatches([]); setFormError(null); setRestoredAt(null); return true; }
    pendingOwn.current = true;
    const r = await send({ action: "plan_withdraw", patient_id: p.id, plan_id: f.id, reason: "otro" });
    pendingOwn.current = false;
    if (!alive.current) return false;
    if (!r.ok) { setError({ message: r.error, stale: r.status === 409 }); return false; }
    setSeenKey(draftKeyOf(r.data.draft));
    setForm(r.data.draft ? fromPlan(r.data.draft, true) : null);
    setBatches([]);
    setFormError(null);
    setRestoredAt(null);
    toast.success("Se descartó el borrador.");
    return true;
  }

  // Volver a lo guardado (sin los cambios de esta pantalla)
  function loadSaved() {
    setError(null);
    setFormError(null);
    setRestoredAt(null);
    setForm(serverDraft ? fromPlan(serverDraft, true) : null);
    setSeenKey(draftKey);
  }

  // "Actualizar" después de un conflicto: se cierra todo y se trae lo último
  function reloadFresh() {
    setError(null);
    setFormError(null);
    setDialog(null);
    setForm(null);
    setRestoredAt(null);
    setSeenKey("\u0000"); // fuerza a tomar lo que llegue
    void reload();
  }

  // "Actualizar" después de un 409 en el plan publicado (pausa, finalizar,
  // retirar): se trae lo último sin tocar lo que se está editando (si el
  // borrador cambió, el editor avisa como siempre)
  function reloadView() {
    setDialog(null);
    void reload();
  }

  const visibleBatches = batches.filter((b) => form?.exercises.some((e) => e.ai?.batch === b.key && !e.removed));
  const summary = form ? planSummary(form.exercises.map((e) => ({ minutes: Number(e.minutes) || 0, removed: e.removed })), form.days, p.age) : null;

  return (
    <div className="space-y-4">
      {data.author.problem ? (
        <p role="alert" className={ERROR_BOX}>{data.author.problem}</p>
      ) : data.author.label && (
        <p className="text-xs text-muted-foreground">
          Se publica como: <span className="font-semibold text-foreground">{data.author.label}</span>
        </p>
      )}
      {!data.practice_enabled && (
        <p className={WARN_BOX}>
          La familia todavía no ve los ejercicios: prendé «Mostrar ejercicios, devoluciones y medallas» (arriba). Podés dejar el plan listo.
        </p>
      )}
      {p.age === null && (
        <p className={WARN_BOX}>Falta la fecha de nacimiento en la ficha: sin la edad no se puede saber qué ejercicios corresponden.</p>
      )}

      <PublishedBlock data={data} busy={busy} send={send} editing={!!form}
        onEdit={() => { setForm(startForm(data)); setFormError(null); setError(null); }}
        onDialog={(kind) => setDialog({ kind })} onReload={reloadView} />

      {!form && (
        <AddButtons data={data} busy={busy} catalogLoading={catalogLoading} catalogError={catalogError}
          onCatalog={() => void openCatalog()} onAi={() => void openAi()} onManual={addManual} />
      )}

      {form && (
        <Block title={form.id ? `Borrador${serverDraft?.id === form.id ? ` v${serverDraft.version}` : ""}` : published ? "Versión nueva" : "Plan nuevo"}
          aside={(
            <div className="flex flex-wrap gap-1.5">
              {!form.id ? <Pill tone="warn">Sin guardar</Pill> : dirty ? <Pill tone="warn">Cambios sin guardar</Pill> : <Pill tone="ok">Guardado</Pill>}
              {published && <Pill tone="muted">La familia ve el publicado</Pill>}
            </div>
          )}>
          {newer && (
            <NewerNotice form={form} serverDraft={serverDraft} onLoad={loadSaved} onClose={() => { setForm(null); setSeenKey(draftKey); }} />
          )}
          {restoredAt && dirty && (
            <div role="status" className={`${WARN_BOX} space-y-2`}>
              <p>
                Recuperamos los cambios que no habías guardado (de las {hm(restoredAt)}, cuando se cerró la ficha). Todavía no
                están guardados: tocá «Guardar borrador».
              </p>
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy}
                  onClick={() => { setBatches([]); loadSaved(); }}>
                  Descartarlos
                </Button>
              </div>
            </div>
          )}

          <fieldset disabled={busy} className="min-w-0 space-y-4">
            <legend className="sr-only">Datos del plan</legend>
            <PlanFields form={form} data={data} onChange={setPlan} />

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Ejercicios ({activeCount} de {L.exercises_max} como máximo)</p>
              </div>
              {visibleBatches.map((b) => (
                <AiBatchBox key={b.key} batch={b}
                  cards={form.exercises.filter((e) => e.ai?.batch === b.key && !e.removed).length}
                  running={aiRunning === b.key} error={aiError?.at === b.key ? aiError.message : null}
                  onOther={() => void otherVersion(b)} onDiscard={() => discardBatch(b)} />
              ))}
              {form.exercises.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay ejercicios. Sumalos del catálogo, con ayuda de IA o a mano.</p>
              ) : (
                <ol className="space-y-2">
                  {form.exercises.map((e, i) => (
                    <ExerciseCard key={e.uid} ex={e} index={i} count={form.exercises.length} data={data} catalog={catalog}
                      open={openCards.has(e.uid)} highlighted={formError?.uid === e.uid}
                      isNew={!!published && !publishedKeys.has(e.exercise_key ?? "")}
                      canRedo={!!e.ai && batches.some((b) => b.key === e.ai?.batch)}
                      running={aiRunning === e.uid} aiError={aiError?.at === e.uid ? aiError.message : null}
                      onToggle={() => toggleCard(e.uid)} onChange={(patch) => updateEx(e.uid, patch)}
                      onMove={(dir) => move(e.uid, dir)} onRemove={() => removeEx(e.uid)}
                      onRedo={() => void redoCard(e)} onOriginal={() => restoreOriginal(e)} />
                  ))}
                </ol>
              )}
              <AddButtons data={data} busy={busy} catalogLoading={catalogLoading} catalogError={catalogError} disabled={room === 0}
                onCatalog={() => void openCatalog()} onAi={() => void openAi()} onManual={addManual} />
              {room === 0 && <p className="text-xs text-muted-foreground">{PRACTICE_ERROR.exercises}</p>}
            </div>

            {summary && (
              <div className="space-y-2 border-t border-border/60 pt-3">
                <p className="text-sm font-semibold">{summary.line}</p>
                {summary.warning && <p className={WARN_BOX}>{summary.warning}</p>}
              </div>
            )}
            <PlanGoals data={data} planId={form.id} />
          </fieldset>

          {formError && <p role="alert" className={ERROR_BOX}>{formError.message}</p>}
          <ErrorBox error={error} onReload={reloadFresh} />
          {aiPending && (
            <p role="status" className={`flex items-center gap-1.5 text-sm font-semibold ${PENDING_TEXT}`}>
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" /> {STAFF_PRACTICE_TEXT.ai_review_needed}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <DiscardButton form={form} dirty={dirty} busy={busy} hasPublished={!!published}
              onDiscard={discardDraft} onUndo={loadSaved} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy || newer || (!!form.id && !dirty)}
                onClick={() => void onSave()}>
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Guardar borrador
              </Button>
              <Button type="button" size="sm" className={PILL_BTN}
                disabled={busy || newer || aiPending || activeCount === 0 || !!data.author.problem}
                onClick={() => void askPublish()}>
                Publicar
              </Button>
            </div>
          </div>
          {published && <p className="text-xs text-muted-foreground">La familia sigue viendo el plan publicado hasta que publiques esta versión.</p>}
        </Block>
      )}

      <p className="rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">{LIDCOMBE_NOTICE}</p>

      <History history={data.history} />

      {dialog?.kind === "catalog" && catalog && (
        <CatalogDialog data={data} catalog={catalog} inPlan={inPlan} room={room}
          onAdd={addFromCatalog} onAdapt={(ids) => setDialog({ kind: "ai", ids })} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "ai" && catalog && (
        <AiDialog data={data} catalog={catalog} initialIds={dialog.ids} inPlan={inPlan} room={room}
          onResult={onAiResult} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "publish" && (
        <PublishDialog data={data} busy={busy} onPublish={publish} onClose={() => setDialog(null)} onReload={reloadFresh} />
      )}
      {dialog?.kind === "break" && published && (
        <BreakDialog data={data} plan={published} busy={busy} send={send} onClose={() => setDialog(null)} onReload={reloadView} />
      )}
      {dialog?.kind === "withdraw" && published && (
        <WithdrawDialog data={data} plan={published} busy={busy} send={send} onClose={() => setDialog(null)} onReload={reloadView} />
      )}
    </div>
  );
}

// ── Partes ──────────────────────────────────────────────────────────────────

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
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}>{children}</span>;
}

function AiPill() {
  return <Pill tone="ai"><Sparkles className="h-3 w-3" aria-hidden="true" /> Adaptado con IA</Pill>;
}

function Counter({ n, max }: { n: number; max: number }) {
  return <p className={`text-right text-xs ${n >= max ? PENDING_TEXT : "text-muted-foreground"}`}>{n}/{max}</p>;
}

function ErrorBox({ error, onReload }: { error: SendError | null; onReload: () => void }) {
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

// Botón que pide confirmación en la misma página (sin window.confirm)
function ConfirmButton({ label, question, confirmLabel, disabled, destructive = true, onConfirm }: {
  label: string; question: string; confirmLabel: string; disabled: boolean; destructive?: boolean; onConfirm: () => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (asking) cancelRef.current?.focus(); }, [asking]);

  if (!asking) {
    return (
      <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={label} className="space-y-2 rounded-xl bg-muted p-3 text-sm">
      <p>{question}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setAsking(false)}>
          Cancelar
        </Button>
        <Button type="button" size="sm" variant={destructive ? "destructive" : "default"} disabled={disabled}
          onClick={async () => { if (await onConfirm()) setAsking(false); }}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

function AddButtons({ data, busy, disabled = false, catalogLoading, catalogError, onCatalog, onAi, onManual }: {
  data: StaffPracticeDTO; busy: boolean; disabled?: boolean; catalogLoading: boolean; catalogError: string | null;
  onCatalog: () => void; onAi: () => void; onManual: () => void;
}) {
  const off = busy || disabled || catalogLoading;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={off} onClick={onCatalog}>
          {catalogLoading
            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            : <BookOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          Elegir del catálogo
        </Button>
        {data.features.ai && (
          <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={off} onClick={onAi}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Adaptar con ayuda de IA
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy || disabled} onClick={onManual}>
          <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Escribir uno a mano
        </Button>
      </div>
      {catalogError && <p role="alert" className={ERROR_BOX}>{catalogError}</p>}
    </div>
  );
}

// Plan vigente (lo que ve la familia) y sus acciones. Si otra persona lo
// cambió (409), el error trae «Actualizar»
function PublishedBlock({ data, busy, send, editing, onEdit, onDialog, onReload }: {
  data: StaffPracticeDTO; busy: boolean; send: PracticeSend; editing: boolean;
  onEdit: () => void; onDialog: (kind: "break" | "withdraw") => void; onReload: () => void;
}) {
  const pub = data.published;
  const today = centerToday();
  const breakOn = !!pub && onBreak(pub.on_break_until, today);
  const [error, setError] = useState<SendError | null>(null);

  async function endBreak(): Promise<boolean> {
    if (!pub) return true;
    setError(null);
    const r = await send({ action: "plan_break", patient_id: data.patient.id, plan_id: pub.id, until: null });
    if (!r.ok) { setError({ message: r.error, stale: r.status === 409 }); return false; }
    toast.success("Terminó la pausa de vacaciones.");
    return true;
  }

  async function finish(): Promise<boolean> {
    if (!pub) return true;
    setError(null);
    const r = await send({ action: "plan_finish", patient_id: data.patient.id, plan_id: pub.id });
    if (!r.ok) { setError({ message: r.error, stale: r.status === 409 }); return false; }
    toast.success("Plan finalizado. La familia ya no ve los ejercicios.");
    return true;
  }

  return (
    <Block title="Plan vigente" aside={pub ? (
      <div className="flex flex-wrap gap-1.5">
        <Pill tone="ok">Publicado el {pub.published_at ? dm(pub.published_at) : "—"} (v{pub.version})</Pill>
        {breakOn && <Pill tone="warn">En pausa</Pill>}
      </div>
    ) : <Pill tone="muted">Sin publicar</Pill>}>
      {!pub ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay un plan publicado para {data.patient.first_name}.
          {data.draft ? " El borrador de abajo no se ve en el portal hasta que lo publiques." : ""}
        </p>
      ) : (
        <>
          {pub.title && <p className="text-sm font-semibold">{pub.title}</p>}
          <p className="text-sm">{planLine(pub)}</p>
          {pub.goal_text && <p className="text-xs text-muted-foreground">Para qué: {pub.goal_text}</p>}
          {breakOn && pub.on_break_until && (
            <p className={WARN_BOX}>En pausa de vacaciones. La familia ve: «{breakLine(pub.on_break_until)}»</p>
          )}
          {pub.minutes_warning && <p className={WARN_BOX}>{pub.minutes_warning}</p>}
          {pub.exercises.filter((e) => !e.removed_at).length > 0 && (
            <ol className="divide-y divide-border/60 rounded-xl border border-border/60">
              {pub.exercises.filter((e) => !e.removed_at).map((e, i) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{i + 1}. {e.title}</span>
                    <span className="text-xs text-muted-foreground"> · {e.minutes} min · {APPROACH_LABEL[e.approach]}</span>
                  </span>
                  {e.ai_drafted && <AiPill />}
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-start gap-2 pt-1">
            {!editing && (
              <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={onEdit}>
                <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {data.draft ? `Abrir el borrador (v${data.draft.version})` : "Editar"}
              </Button>
            )}
            {breakOn ? (
              <ConfirmButton label="Terminar la pausa" destructive={false} disabled={busy} confirmLabel="Sí, terminarla"
                question="¿Terminar la pausa de vacaciones? La familia vuelve a ver la semana de práctica desde hoy."
                onConfirm={endBreak} />
            ) : (
              <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={() => onDialog("break")}>
                Pausa de vacaciones
              </Button>
            )}
            <ConfirmButton label="Finalizar" disabled={busy} confirmLabel="Sí, finalizar"
              question={`¿Finalizar el plan de práctica de ${data.patient.first_name}? La familia deja de ver los ejercicios. Lo que anotaron, las devoluciones y las medallas quedan.`}
              onConfirm={finish} />
            <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={busy} onClick={() => onDialog("withdraw")}>
              Retirar del portal
            </Button>
          </div>
        </>
      )}
      {!pub && data.draft && !editing && (
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={onEdit}>
          <PenLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Abrir el borrador (v{data.draft.version})
        </Button>
      )}
      <ErrorBox error={error} onReload={() => { setError(null); onReload(); }} />
    </Block>
  );
}

// Mientras se editaba, el borrador guardado cambió
function NewerNotice({ form, serverDraft, onLoad, onClose }: {
  form: PlanForm; serverDraft: StaffPlanDTO | null; onLoad: () => void; onClose: () => void;
}) {
  let text: string;
  let action: React.ReactNode;
  if (form.id && serverDraft?.id === form.id) {
    text = `Mientras editabas, se guardaron otros cambios en este borrador${serverDraft.updated_by_email ? ` (${serverDraft.updated_by_email}, a las ${hm(serverDraft.updated_at)})` : ""}. Para no pisarlos, cargá lo guardado y volvé a hacer tus cambios.`;
    action = <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={onLoad}>Cargar lo guardado</Button>;
  } else if (form.id) {
    text = "Mientras editabas, este borrador se publicó o se descartó.";
    action = serverDraft
      ? <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={onLoad}>Abrir el borrador nuevo</Button>
      : <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={onClose}>Cerrar el editor</Button>;
  } else {
    text = "Mientras armabas este plan, se guardó otro borrador (solo puede haber uno). Cargalo y sumá ahí tus cambios.";
    action = <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={onLoad}>Cargar ese borrador</Button>;
  }
  return (
    <div role="status" className={`${WARN_BOX} space-y-2`}>
      <p>{text}</p>
      <div className="flex justify-end">{action}</div>
    </div>
  );
}

function DiscardButton({ form, dirty, busy, hasPublished, onDiscard, onUndo }: {
  form: PlanForm; dirty: boolean; busy: boolean; hasPublished: boolean; onDiscard: () => Promise<boolean>; onUndo: () => void;
}) {
  if (!form.id) {
    return (
      <ConfirmButton label={hasPublished ? "Cancelar la versión nueva" : "Cancelar"} disabled={busy} confirmLabel="Sí, descartar"
        question="¿Descartar lo que armaste? No se guardó nada." onConfirm={onDiscard} />
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {dirty && (
        <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={busy} onClick={onUndo}>
          Deshacer los cambios
        </Button>
      )}
      <ConfirmButton label="Descartar el borrador" disabled={busy} confirmLabel="Sí, descartar"
        question={hasPublished ? "¿Descartar este borrador? La familia sigue viendo el plan publicado." : "¿Descartar este borrador? No se publicó nada."}
        onConfirm={onDiscard} />
    </div>
  );
}

// Datos del plan
function PlanFields({ form, data, onChange }: { form: PlanForm; data: StaffPracticeDTO; onChange: (patch: Partial<PlanForm>) => void }) {
  const p = data.patient;
  const titleId = useId();
  const goalId = useId();
  const audienceId = useId();
  const daysId = useId();
  const reviewId = useId();
  const medalsId = useId();
  const alerts = planAlerts(form);
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={titleId}>Título del plan</Label>
        <Input id={titleId} value={form.title} maxLength={L.plan_title} placeholder="Ej.: Ejercicios para casa"
          onChange={(e) => onChange({ title: e.target.value })} />
        <Counter n={form.title.length} max={L.plan_title} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={goalId}>Para qué es <span className="font-normal text-muted-foreground">(opcional)</span></Label>
        <Textarea id={goalId} rows={2} value={form.goal_text} maxLength={L.plan_goal_text}
          placeholder="Lo ve la familia arriba de los ejercicios" onChange={(e) => onChange({ goal_text: e.target.value })} />
        <Counter n={form.goal_text.length} max={L.plan_goal_text} />
      </div>
      <ReviewBox alerts={alerts} keep={form.keep} note={form.note} saveHint="Queda guardado con el plan. La familia no lo ve."
        onKeep={() => onChange({ keep: true })} onNote={(note) => onChange({ note })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={audienceId}>Edad o modo de pantalla</Label>
          <select id={audienceId} className={selectClass} value={form.audience}
            onChange={(e) => onChange({ audience: e.target.value as PlanAudience })}>
            {PLAN_AUDIENCES.map((a) => (
              <option key={a} value={a}>{PLAN_AUDIENCE_LABEL[a]} · {MODE_LABEL[SCREEN_MODE_BY_AUDIENCE[a]]}</option>
            ))}
          </select>
          {form.audience !== p.audience && (
            <p className="text-xs text-muted-foreground">
              Por la edad{p.age !== null ? ` (${p.age} años)` : ""} corresponde «{PLAN_AUDIENCE_LABEL[p.audience]}».
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={daysId}>Días por semana</Label>
          <select id={daysId} className={selectClass} value={form.days} onChange={(e) => onChange({ days: Number(e.target.value) })}>
            {Array.from({ length: L.days_per_week_max - L.days_per_week_min + 1 }, (_, i) => i + L.days_per_week_min).map((n) => (
              <option key={n} value={n}>{n} {plural(n, "día", "días")}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Es la meta de la semana (de lunes a domingo).</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={reviewId}>Revisar el… <span className="font-normal text-muted-foreground">(opcional)</span></Label>
          <Input id={reviewId} type="date" value={form.review_on} className="h-10"
            onChange={(e) => onChange({ review_on: e.target.value })} />
          <p className="text-xs text-muted-foreground">Solo lo ve el equipo.</p>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={medalsId} className="leading-snug">Medallas automáticas por constancia</Label>
            <Switch id={medalsId} checked={form.auto_medals} onCheckedChange={(v) => onChange({ auto_medals: v })} />
          </div>
          <p className="text-xs text-muted-foreground">Por practicar, nunca por cómo habla. No se pierden.</p>
        </div>
      </div>
    </div>
  );
}

// Metas en borrador de este plan (se arman en «Metas y medallas» y se publican con el plan)
function PlanGoals({ data, planId }: { data: StaffPracticeDTO; planId: string | null }) {
  const goals = planId ? data.goals.filter((g) => g.plan_id === planId && g.status === "borrador") : [];
  return (
    <p className="text-xs text-muted-foreground">
      {goals.length
        ? `Con el plan se publican estas metas: ${goals.map((g) => `«${g.title ?? "Meta"}»`).join(", ")}.`
        : "Las metas del plan se arman en «Metas y medallas» y se publican junto con el plan."}
    </p>
  );
}

// Avisos del texto: no bloquean, pero para dejarlos hay que contar por qué
function ReviewBox({ alerts, keep, note, saveHint, onKeep, onNote }: {
  alerts: string[]; keep: boolean; note: string; saveHint: string; onKeep: () => void; onNote: (v: string) => void;
}) {
  const noteId = useId();
  const [justKept, setJustKept] = useState(false);
  if (!alerts.length) return null;
  return (
    <div className="space-y-2 rounded-xl bg-[color:var(--status-pending-bg)] p-3 text-sm text-[oklch(0.42_0.1_70)]">
      <p className="flex gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          El texto dice «{alerts.join("», «")}». En el portal no prometemos ni medimos fluidez (puede sumar presión) y le hablamos de vos a la familia.
        </span>
      </p>
      {!keep ? (
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-xs">Corregilo en el campo o</span>
          <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={() => { setJustKept(true); onKeep(); }}>
            Lo dejo así
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={noteId} className="text-foreground">¿Por qué lo dejás así?</Label>
          <Input id={noteId} value={note} maxLength={L.review_note} autoFocus={justKept} className="bg-background"
            placeholder="Ej.: dentro de este ejercicio sí va más despacio" onChange={(e) => onNote(e.target.value)} />
          <p className="text-xs">{saveHint}</p>
        </div>
      )}
    </div>
  );
}

// Alertas que marcó la IA en un campo
function FlagLine({ flags }: { flags: DraftFlag[] }) {
  if (!flags.length) return null;
  return (
    <p className={`flex gap-1.5 text-xs ${PENDING_TEXT}`}>
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>La IA marcó para revisar: «{[...new Set(flags.map((f) => f.term))].join("», «")}»</span>
    </p>
  );
}

// ── Tarjeta de un ejercicio ─────────────────────────────────────────────────

function ExerciseCard({
  ex, index, count, data, catalog, open, highlighted, isNew, canRedo, running, aiError,
  onToggle, onChange, onMove, onRemove, onRedo, onOriginal,
}: {
  ex: ExForm; index: number; count: number; data: StaffPracticeDTO; catalog: CatalogEntry[] | null; open: boolean;
  highlighted: boolean; isNew: boolean; canRedo: boolean; running: boolean; aiError: string | null;
  onToggle: () => void; onChange: (patch: Partial<ExForm>) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
  onRedo: () => void; onOriginal: () => void;
}) {
  const bodyId = useId();
  const ids = { title: useId(), para: useId(), min: useId(), mat: useId(), adult: useId(), cuesta: useId(), approach: useId() };
  const options = data.approaches;
  const opt = options.find((o) => o.approach === ex.approach);
  const alerts = exAlerts(ex);
  const aiEx = aiDrafted(ex);
  const needsReview = aiEx && !ex.reviewed && !ex.removed;
  const uncovered = alerts.length > 0 && !noteOk(ex.keep, ex.note);
  const approachBad = !opt || !opt.age_ok;
  const sessionMissing = !!opt?.needs_session && !ex.practiced_in_session;
  const flagsFor = (field: string) => ex.ai?.flags.filter((f) => f.field === field) ?? [];
  const entry = ex.catalog_id ? (catalog?.find((c) => c.id === ex.catalog_id) ?? catalogEntry(ex.catalog_id)) : null;
  const baseGuide = APPROACH_ADULT_GUIDE[ex.approach];
  const fixedApproach = ex.source !== "manual"; // del catálogo: el enfoque es el del ejercicio
  const removeLabel = ex.removed ? "Volver a ponerlo" : aiEx && !ex.id && !ex.exercise_key ? "Descartar" : "Quitar";

  function setApproach(a: Approach) {
    const patch: Partial<ExForm> = { approach: a };
    // Si el texto para el adulto era el base del enfoque anterior, pasa al del nuevo
    if (!ex.for_adult.trim() || cleanText(ex.for_adult) === APPROACH_ADULT_GUIDE[ex.approach]) patch.for_adult = APPROACH_ADULT_GUIDE[a];
    if (!APPROACH_RULES[a].needs_session) patch.practiced_in_session = false;
    onChange(patch);
  }

  const setStep = (i: number, v: string) => onChange({ pasos: ex.pasos.map((s, j) => (j === i ? v : s)) });

  return (
    <li className={[
      "rounded-2xl border p-3",
      highlighted ? "border-[oklch(0.6_0.19_25)] ring-2 ring-[oklch(0.6_0.19_25)]/30" : "border-border/60",
      ex.removed ? "bg-muted/40" : "",
    ].join(" ")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" onClick={onToggle} aria-expanded={open && !ex.removed} aria-controls={bodyId} disabled={ex.removed}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 transition-transform ${open && !ex.removed ? "rotate-180" : ""} ${ex.removed ? "opacity-0" : ""}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className={`block text-sm font-semibold ${ex.removed ? "text-muted-foreground line-through" : ""}`}>
              {index + 1}. {ex.title.trim() || "Ejercicio sin título"}
            </span>
            <span className="block text-xs text-muted-foreground">
              {ex.minutes || "?"} min · {APPROACH_LABEL[ex.approach]}{ex.with_adult ? " · Con un adulto" : ""}
            </span>
          </span>
        </button>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {aiEx ? <AiPill /> : ex.source === "catalogo" ? <Pill tone="muted">Del catálogo</Pill> : <Pill tone="muted">Escrito a mano</Pill>}
          {ex.removed && <Pill tone="muted">Quitado</Pill>}
          {!ex.removed && isNew && <Pill tone="muted">Nuevo</Pill>}
          {needsReview && <Pill tone="warn">Falta «Lo revisé»</Pill>}
          {!ex.removed && uncovered && <Pill tone="warn">Revisar el texto</Pill>}
          {!ex.removed && (approachBad || sessionMissing) && <Pill tone="warn">Revisar el enfoque</Pill>}
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" disabled={index === 0}
            aria-label={`Subir el ejercicio ${index + 1}`} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" disabled={index === count - 1}
            aria-label={`Bajar el ejercicio ${index + 1}`} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" size="sm" variant="ghost" className={PILL_BTN} onClick={onRemove}>
            {!ex.removed && <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
            {removeLabel}
          </Button>
        </div>
      </div>

      {ex.removed && <p className="mt-1 pl-6 text-xs text-muted-foreground">La familia no lo ve en esta versión. No se borra: queda en el historial.</p>}

      {open && !ex.removed && (
        <div id={bodyId} className="mt-3 space-y-3 pl-1">
          {aiEx && (
            <div className="space-y-2 rounded-xl bg-[color:var(--primary-soft)]/40 p-3 text-sm">
              {entry && <p className="text-xs text-muted-foreground">Adaptado de «{entry.title}», del catálogo.</p>}
              {ex.ai && (
                <div className="space-y-0.5 text-xs">
                  <p className="font-semibold">Variantes que sugiere la IA (no se publican):</p>
                  <p>Más fácil: {ex.ai.variantes.mas_facil}</p>
                  <p>Más difícil: {ex.ai.variantes.mas_dificil}</p>
                </div>
              )}
              {running && (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Preparando una propuesta…
                </p>
              )}
              {aiError && <p role="alert" className={ERROR_BOX}>{aiError}</p>}
              <div className="flex flex-wrap gap-2">
                {canRedo && (
                  <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={running} onClick={onRedo}>
                    Rehacer este ejercicio
                  </Button>
                )}
                {entry && (
                  <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={running} onClick={onOriginal}>
                    Usar el original del catálogo
                  </Button>
                )}
              </div>
              <label className={`flex items-start gap-2 rounded-lg bg-background p-2 font-semibold ${needsReview ? PENDING_TEXT : ""}`}>
                <input type="checkbox" className="mt-0.5" checked={ex.reviewed} onChange={(e) => onChange({ reviewed: e.target.checked })} />
                <span>
                  Lo revisé
                  <span className="block text-xs font-normal text-muted-foreground">
                    Leí y corregí este ejercicio. Sin esto no se puede publicar.
                  </span>
                </span>
              </label>
            </div>
          )}
          {!aiEx && ex.source === "catalogo" && entry && (
            <p className="text-xs text-muted-foreground">Del catálogo: «{entry.title}». Podés ajustar el texto para {data.patient.first_name}.</p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={ids.title}>Título</Label>
            <Input id={ids.title} value={ex.title} maxLength={L.title} onChange={(e) => onChange({ title: e.target.value })} />
            <FlagLine flags={flagsFor("titulo")} />
            <Counter n={ex.title.length} max={L.title} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.para}>Para qué sirve</Label>
            <Textarea id={ids.para} rows={2} value={ex.para_que} maxLength={L.para_que} onChange={(e) => onChange({ para_que: e.target.value })} />
            <FlagLine flags={flagsFor("para_que")} />
            <Counter n={ex.para_que.length} max={L.para_que} />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Cómo se hace <span className="font-normal text-muted-foreground">(de {L.pasos_min} a {L.pasos_max} pasos)</span></legend>
            <ol className="space-y-2">
              {ex.pasos.map((s, i) => (
                <li key={i} className="space-y-0.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 w-5 shrink-0 text-right text-xs font-semibold text-muted-foreground" aria-hidden="true">{i + 1}.</span>
                    <Textarea rows={2} value={s} maxLength={L.paso} aria-label={`Paso ${i + 1}`} className="min-h-0"
                      onChange={(e) => setStep(i, e.target.value)} />
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-full" disabled={ex.pasos.length <= L.pasos_min}
                      aria-label={`Quitar el paso ${i + 1}`} onClick={() => onChange({ pasos: ex.pasos.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  <Counter n={s.length} max={L.paso} />
                </li>
              ))}
            </ol>
            <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={ex.pasos.length >= L.pasos_max}
              onClick={() => onChange({ pasos: [...ex.pasos, ""] })}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Sumar un paso
            </Button>
            <FlagLine flags={flagsFor("pasos")} />
          </fieldset>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor={ids.min}>Minutos</Label>
              <Input id={ids.min} type="number" inputMode="numeric" min={L.minutes_min} max={L.minutes_max} value={ex.minutes} className="h-10 w-24"
                onChange={(e) => onChange({ minutes: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={ex.with_adult} onChange={(e) => onChange({ with_adult: e.target.checked })} />
              Se hace con un adulto
            </label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.mat}>Materiales <span className="font-normal text-muted-foreground">(opcional)</span></Label>
            <Input id={ids.mat} value={ex.materiales} maxLength={L.materiales} placeholder="Cosas de cualquier casa, sin pantallas"
              onChange={(e) => onChange({ materiales: e.target.value })} />
            <FlagLine flags={flagsFor("materiales")} />
            <Counter n={ex.materiales.length} max={L.materiales} />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Label htmlFor={ids.adult}>Para el adulto que acompaña</Label>
              {cleanText(ex.for_adult) !== baseGuide && (
                <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={() => onChange({ for_adult: baseGuide })}>
                  Usar el texto base del enfoque
                </Button>
              )}
            </div>
            <Textarea id={ids.adult} rows={3} value={ex.for_adult} maxLength={L.for_adult} onChange={(e) => onChange({ for_adult: e.target.value })} />
            <FlagLine flags={flagsFor("rol_del_adulto")} />
            <Counter n={ex.for_adult.length} max={L.for_adult} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.cuesta}>Si cuesta…</Label>
            <Textarea id={ids.cuesta} rows={2} value={ex.si_cuesta} maxLength={L.si_cuesta} onChange={(e) => onChange({ si_cuesta: e.target.value })} />
            <FlagLine flags={flagsFor("si_cuesta")} />
            <Counter n={ex.si_cuesta.length} max={L.si_cuesta} />
          </div>
          <FlagLine flags={flagsFor("variantes")} />
          <div className="space-y-1.5">
            <Label htmlFor={ids.approach}>Enfoque</Label>
            <select id={ids.approach} className={selectClass} value={ex.approach} disabled={fixedApproach}
              onChange={(e) => setApproach(e.target.value as Approach)}>
              {options.map((o) => (
                <option key={o.approach} value={o.approach} disabled={!o.age_ok}>
                  {o.label}{o.suggested ? "" : " · otra área"}{o.age_ok ? "" : " (no corresponde a la edad)"}
                </option>
              ))}
              {!opt && <option value={ex.approach} disabled>{APPROACH_LABEL[ex.approach]} (no corresponde)</option>}
            </select>
            {fixedApproach && <p className="text-xs text-muted-foreground">Es el enfoque del ejercicio del catálogo.</p>}
            {approachBad && <p className={`text-xs font-semibold ${ERROR_TEXT}`}>{PRACTICE_ERROR.approach}</p>}
            {opt?.needs_session && (
              <label className={`flex items-start gap-2 text-sm ${sessionMissing ? `font-semibold ${PENDING_TEXT}` : ""}`}>
                <input type="checkbox" className="mt-0.5" checked={ex.practiced_in_session}
                  onChange={(e) => onChange({ practiced_in_session: e.target.checked })} />
                Ya lo practicamos en sesión
              </label>
            )}
          </div>
          <ReviewBox alerts={alerts} keep={ex.keep} note={ex.note} saveHint="Queda guardado con el ejercicio. La familia no lo ve."
            onKeep={() => onChange({ keep: true })} onNote={(note) => onChange({ note })} />
        </div>
      )}
    </li>
  );
}

// ── Propuesta de la IA ──────────────────────────────────────────────────────

function AiBatchBox({ batch, cards, running, error, onOther, onDiscard }: {
  batch: Batch; cards: number; running: boolean; error: string | null; onOther: () => void; onDiscard: () => void;
}) {
  const r = batch.result;
  const d = r.draft;
  return (
    <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> Propuesta de la IA · {cards} {plural(cards, "ejercicio", "ejercicios")}
        </p>
        {r.demo && <Pill tone="muted">Modo demo</Pill>}
      </div>
      {d.intro && <p className="text-xs text-muted-foreground">{d.intro}</p>}
      {d.nota_para_profesional && (
        <div className="rounded-xl border border-border/60 bg-background p-3 text-xs">
          <p className="font-semibold">Nota para vos (no se publica)</p>
          <p className="whitespace-pre-line">{d.nota_para_profesional}</p>
        </div>
      )}
      {d.alertas.length > 0 && (
        <div className={WARN_BOX}>
          <p className="font-semibold">La IA sugiere revisar:</p>
          <ul className="list-disc pl-5">{d.alertas.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
      <SentDetails sent={r.sent} title="Esto es lo que se mandó a la IA" />
      {running && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Preparando una propuesta…
        </p>
      )}
      {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={running} onClick={onOther}>Otra versión</Button>
        <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={running} onClick={onDiscard}>Descartar</Button>
      </div>
    </div>
  );
}

// "Esto es lo que se manda a la IA"
function SentDetails({ sent, title }: { sent: AiSentDescription; title: string }) {
  return (
    <details className="rounded-xl bg-muted/60 p-3 text-xs">
      <summary className="cursor-pointer font-semibold">{title}</summary>
      <div className="mt-2 space-y-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {sent.fields.map((f) => (
            <Fragment key={f.label}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd>{f.value}</dd>
            </Fragment>
          ))}
        </dl>
        <p>
          <span className="font-semibold">Texto aprobado del catálogo de:</span> {sent.catalog.map((c) => `«${c.title}»`).join(", ")}
        </p>
        <p>{sent.rules}</p>
        <div>
          <p className="font-semibold">Nunca se manda:</p>
          <ul className="list-disc pl-5">{sent.never.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
        <details>
          <summary className="cursor-pointer">Ver el mensaje tal cual</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background p-2 text-[11px]">{sent.exact}</pre>
        </details>
      </div>
    </details>
  );
}

// ── Historial ───────────────────────────────────────────────────────────────

function History({ history }: { history: StaffPracticeDTO["history"] }) {
  const [open, setOpen] = useState(false);
  if (!history.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border/60 pt-3">
      <CollapsibleTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="-ml-2 h-8 gap-1.5 px-2 font-semibold">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          Versiones anteriores ({history.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 divide-y divide-border/60">
          {history.map((h) => (
            <li key={h.id} className="space-y-0.5 py-2.5 text-xs first:pt-0 last:pb-0">
              <p className="text-sm">
                <span className="font-semibold">v{h.version} · {PLAN_STATUS_LABEL[h.status]}</span>
                {h.published_at && <> · publicada el {dm(h.published_at)}{h.published_by_email ? ` por ${h.published_by_email}` : ""}</>}
              </p>
              {h.author_label && <p className="text-muted-foreground">{h.author_label}</p>}
              {h.closed_at && (
                <p className="text-muted-foreground">
                  Cerrada el {dm(h.closed_at)}{h.close_reason ? `: ${CLOSE_REASON_LABEL[h.close_reason]}` : ""}
                </p>
              )}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Administración: estados, sin los textos ─────────────────────────────────

function ReadOnlyPlan({ data }: { data: StaffPracticeDTO }) {
  const pub = data.published;
  const breakOn = !!pub && onBreak(pub.on_break_until, centerToday());
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{STAFF_PRACTICE_TEXT.admin_readonly}</p>
      {!data.practice_enabled && (
        <p className="text-xs text-muted-foreground">Los ejercicios no están prendidos en el portal para este paciente.</p>
      )}
      {pub ? (
        <div className="space-y-1 text-sm">
          <p className="font-semibold">
            Plan publicado{pub.published_at ? ` el ${dm(pub.published_at)}` : ""} (v{pub.version})
          </p>
          {pub.author_label && <p className="text-xs">{pub.author_label}</p>}
          <p className="text-xs text-muted-foreground">
            {pub.exercise_count} {plural(pub.exercise_count, "ejercicio", "ejercicios")}, {pub.days_per_week} {plural(pub.days_per_week, "día", "días")} por semana
            {breakOn && pub.on_break_until ? ` · En pausa de vacaciones hasta el ${dk(pub.on_break_until)}` : ""}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Todavía no hay un plan publicado.</p>
      )}
      <History history={data.history} />
    </div>
  );
}

// ── Diálogos ────────────────────────────────────────────────────────────────

function DialogButtons({ busy, onClose, submit, disabled, destructive }: {
  busy: boolean; onClose: () => void; submit: string; disabled?: boolean; destructive?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || disabled} className="rounded-full">
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {submit}
      </Button>
    </div>
  );
}

// Elegir del catálogo: solo los ejercicios que corresponden a este paciente
function CatalogDialog({ data, catalog, inPlan, room, onAdd, onAdapt, onClose }: {
  data: StaffPracticeDTO; catalog: CatalogEntry[]; inPlan: Set<string>; room: number;
  onAdd: (entries: CatalogEntry[]) => void; onAdapt: (ids: string[]) => void; onClose: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  const groups = data.approaches
    .map((o) => ({ o, entries: catalog.filter((c) => c.approach === o.approach) }))
    .filter((g) => g.entries.length > 0);
  const chosen = sel.map((id) => catalog.find((c) => c.id === id)).filter((c): c is CatalogEntry => !!c);
  const sameApproach = chosen.length > 0 && chosen.every((c) => c.approach === chosen[0].approach);
  const canAdapt = data.features.ai && sameApproach && chosen.length <= AI_CATALOG_MAX;

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < room ? [...s, id] : s));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Elegir del catálogo</DialogTitle>
          <DialogDescription>
            Solo los ejercicios del catálogo aprobado que corresponden al diagnóstico y a la edad de {data.patient.first_name}.
            Después podés ajustar el texto.
          </DialogDescription>
        </DialogHeader>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay ejercicios del catálogo para {data.patient.first_name}. Podés escribir uno a mano.
          </p>
        ) : (
          <div className="space-y-4">
            {room === 0 && <p className={WARN_BOX}>{PRACTICE_ERROR.exercises}</p>}
            {groups.map(({ o, entries }) => (
              <fieldset key={o.approach} className="space-y-2">
                <legend className="text-sm font-semibold">
                  {o.label}
                  {o.needs_session && <span className="font-normal text-muted-foreground"> · pide «Ya lo practicamos en sesión»</span>}
                </legend>
                <ul className="space-y-2">
                  {entries.map((c) => {
                    const already = inPlan.has(c.id);
                    const checked = sel.includes(c.id);
                    return (
                      <li key={c.id} className={`rounded-xl border p-3 text-sm ${checked ? "border-primary" : "border-border/60"}`}>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" className="mt-1" checked={checked} disabled={already || (!checked && sel.length >= room)}
                            onChange={() => toggle(c.id)} />
                          <span className="min-w-0 space-y-0.5">
                            <span className="block font-semibold">{c.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {c.minutes} min · {c.with_adult ? "Con un adulto" : "Por su cuenta"} · {c.ages.to !== undefined ? `De ${c.ages.from} a ${c.ages.to} años` : `Desde ${c.ages.from} años`}
                              {already ? " · Ya está en el plan" : ""}
                            </span>
                            <span className="block">{c.para_que}</span>
                          </span>
                        </label>
                        <details className="mt-1 pl-6 text-xs">
                          <summary className="cursor-pointer text-muted-foreground">Ver los pasos</summary>
                          <ol className="mt-1 list-decimal space-y-0.5 pl-4">{c.pasos.map((s, i) => <li key={i}>{s}</li>)}</ol>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
          {data.features.ai && chosen.length > 0 && !canAdapt && (
            <p className="mr-auto text-xs text-muted-foreground">Para adaptar con IA elegí de 1 a {AI_CATALOG_MAX} del mismo enfoque.</p>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          {data.features.ai && (
            <Button type="button" variant="outline" className="rounded-full" disabled={!canAdapt} onClick={() => onAdapt(sel)}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Adaptar con ayuda de IA
            </Button>
          )}
          <Button type="button" className="rounded-full" disabled={chosen.length === 0} onClick={() => onAdd(chosen)}>
            Sumar al plan{chosen.length ? ` (${chosen.length})` : ""}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// "Sugerido por la ficha": cada sugerencia con su porqué (solo para el profesional)
function SuggestedWhy<T extends string>({ items, labels }: { items?: Why<T>[]; labels: Record<T, string> }) {
  if (!items?.length) return null;
  return (
    <ul className="space-y-0.5 text-xs text-emerald-800">
      {items.map((x) => <li key={x.value}>Sugerido por la ficha · <strong>{labels[x.value]}</strong>: {x.why}</li>)}
    </ul>
  );
}

function ToggleChips<T extends string>({ label, options, labels, value, max, onChange }: {
  label: string; options: readonly T[]; labels: Record<T, string>; value: T[]; max?: number; onChange: (v: T[]) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        const full = max !== undefined && !on && value.length >= max;
        return (
          <button key={o} type="button" aria-pressed={on} disabled={full}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={[
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
              on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
            ].join(" ")}>
            {labels[o]}
          </button>
        );
      })}
    </div>
  );
}

function defaultQuien(p: StaffPracticeDTO["patient"]): QuienAcompana {
  if (p.self) return "paciente_solo";
  if (p.age !== null && p.age >= 13) return "paciente_con_apoyo";
  return "adulto_con_chico";
}

// "Adaptar con ayuda de IA": campos cerrados; del paciente solo viaja la franja de edad
function AiDialog({ data, catalog, initialIds, inPlan, room, onResult, onClose }: {
  data: StaffPracticeDTO; catalog: CatalogEntry[]; initialIds: string[]; inPlan: Set<string>; room: number;
  onResult: (req: AiDraftRequest, res: AiDraftResult) => void; onClose: () => void;
}) {
  const p = data.patient;
  const band = ageBand(p.age);
  // Lo que sugiere la ficha (diagnóstico, edad, condiciones, semáforo, intereses)
  const sug = data.suggestions;
  const rank = (a: Approach) => {
    const i = sug?.approaches.findIndex((x) => x.value === a) ?? -1;
    return i < 0 ? 99 : i;
  };
  const usable = data.approaches.filter((o) => o.age_ok && catalog.some((c) => c.approach === o.approach))
    .sort((a, b) => rank(a.approach) - rank(b.approach));
  const first = catalog.find((c) => c.id === initialIds[0]);
  const startApproach = first?.approach ?? usable[0]?.approach ?? null;
  const max = Math.min(AI_CATALOG_MAX, room);
  const [approach, setApproachState] = useState<Approach | null>(startApproach);
  const [session, setSession] = useState(false);
  const [ids, setIds] = useState<string[]>(() =>
    initialIds.filter((id) => catalog.find((c) => c.id === id)?.approach === startApproach).slice(0, max));
  const [quien, setQuien] = useState<QuienAcompana>(defaultQuien(p));
  const [contexto, setContexto] = useState<Contexto[]>(() => sug?.contexto.map((x) => x.value) ?? ["casa"]);
  const [minutos, setMinutos] = useState<AiMinutes>(p.age !== null && p.age <= 5 ? 5 : 10);
  const [dificultad, setDificultad] = useState<Dificultad>("igual");
  const [adaptaciones, setAdaptaciones] = useState<Adaptacion[]>(() => sug?.adaptaciones.map((x) => x.value) ?? []);
  const [intereses, setIntereses] = useState<Interes[]>(() => sug?.intereses ?? []);
  const [formato, setFormato] = useState<Formato>(() =>
    sug && startApproach && formatAllowed(sug.formato.value, startApproach) ? sug.formato.value : "ejercicio");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const approachId = useId();
  const minId = useId();
  const quienName = useId();
  const difName = useId();
  const formatName = useId();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const opt = data.approaches.find((o) => o.approach === approach);
  const entries = ids.map((id) => catalog.find((c) => c.id === id)).filter((c): c is CatalogEntry => !!c);
  const forApproach = approach ? catalog.filter((c) => c.approach === approach) : [];

  function setApproach(a: Approach) {
    setApproachState(a);
    setIds([]);
    setSession(false);
    setError(null);
    if (!formatAllowed(formato, a)) setFormato("ejercicio");
  }
  const approachWhy = approach ? sug?.approaches.find((x) => x.value === approach)?.why : undefined;

  const problem = !band ? "Falta la fecha de nacimiento en la ficha."
    : !approach ? "Elegí el enfoque."
    : max === 0 ? PRACTICE_ERROR.exercises
    : !entries.length ? `Elegí de 1 a ${max} ejercicios del catálogo.`
    : opt?.needs_session && !session ? PRACTICE_ERROR.approach_session
    : null;

  // Lo que se manda, armado con las mismas reglas que el servidor (buildAdaptParams)
  const params: AiAdaptParams | null = band && approach && entries.length ? {
    catalogo: { ids, version: data.catalog_version },
    franja_edad: band,
    area: APPROACH_AREA[approach],
    enfoque: approach,
    quien_acompana: quien,
    contexto: CONTEXTS.filter((c) => contexto.includes(c)),
    minutos,
    dificultad,
    adaptaciones: ADAPTATIONS.filter((a) => adaptaciones.includes(a)),
    intereses: INTERESTS.filter((i) => intereses.includes(i)),
    formato,
  } : null;
  const preview = params ? describeSent(params, entries) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (problem || !approach || !params) { setError(problem ?? "Completá los datos."); return; }
    const req: AiDraftRequest = {
      patient_id: p.id, catalog_ids: ids, approach, practiced_in_session: session, quien_acompana: quien,
      contexto: params.contexto, minutos, dificultad, adaptaciones: params.adaptaciones, intereses: params.intereses,
      formato,
    };
    setRunning(true);
    const r = await requestDraft(req);
    if (!alive.current) return;
    setRunning(false);
    if (!r.ok) { setError(r.error); return; }
    onResult(req, r.data);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Adaptar con ayuda de IA</DialogTitle>
          <DialogDescription>
            La IA adapta ejercicios del catálogo aprobado: no inventa ejercicios nuevos.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <p className="flex gap-2 rounded-xl bg-[color:var(--primary-soft)] px-3 py-2 text-sm text-[color:var(--primary-deep)]">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{STAFF_PRACTICE_TEXT.ai_banner}</span>
          </p>
          {sug && (
            <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
              <strong>Armado con la ficha de {p.first_name}:</strong> el diagnóstico decide el enfoque recomendado, y la edad,
              las otras condiciones, el semáforo, la escuela y los intereses completan el resto. Revisalo y cambiá lo que quieras.
              La ficha no se manda a la IA: solo lo que elegís acá.
            </p>
          )}

          <fieldset disabled={running} className="min-w-0 space-y-4">
            <legend className="sr-only">Qué se pide</legend>
            <p className="text-sm">
              <span className="text-muted-foreground">Franja de edad: </span>
              {band ? <span className="font-semibold">{AGE_BAND_LABEL[band]}</span> : <span className={`font-semibold ${ERROR_TEXT}`}>falta la fecha de nacimiento en la ficha</span>}
              <span className="text-xs text-muted-foreground"> (sale de la ficha; no se cambia acá)</span>
            </p>

            <div className="space-y-1.5">
              <Label htmlFor={approachId}>Enfoque</Label>
              {usable.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay ejercicios del catálogo para adaptar para {p.first_name}.</p>
              ) : (
                <select id={approachId} className={selectClass} value={approach ?? ""} onChange={(e) => setApproach(e.target.value as Approach)}>
                  {!approach && <option value="">Elegí el enfoque</option>}
                  {usable.map((o, i) => (
                    <option key={o.approach} value={o.approach}>{i === 0 && sug ? `★ ${o.label} (recomendado)` : o.label}</option>
                  ))}
                </select>
              )}
              {approachWhy && <p className="text-xs text-emerald-800">Por qué: {approachWhy}</p>}
              {opt?.needs_session && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={session} onChange={(e) => setSession(e.target.checked)} />
                  Ya lo practicamos en sesión
                </label>
              )}
            </div>

            {approach && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  Ejercicios del catálogo <span className="font-normal text-muted-foreground">(de 1 a {max})</span>
                </legend>
                {max === 0 && <p className={WARN_BOX}>{PRACTICE_ERROR.exercises}</p>}
                <ul className="space-y-1.5">
                  {forApproach.map((c) => {
                    const checked = ids.includes(c.id);
                    return (
                      <li key={c.id}>
                        <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" className="mt-0.5" checked={checked} disabled={!checked && ids.length >= max}
                            onChange={() => setIds((s) => (checked ? s.filter((x) => x !== c.id) : [...s, c.id]))} />
                          <span>
                            <span className="font-semibold">{c.title}</span>
                            <span className="text-xs text-muted-foreground"> · {c.minutes} min{inPlan.has(c.id) ? " · ya está en el plan" : ""}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            )}

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Quién acompaña</legend>
              {QUIEN_ACOMPANA.map((q) => (
                <label key={q} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={quienName} value={q} checked={quien === q} onChange={() => setQuien(q)} />
                  {QUIEN_ACOMPANA_LABEL[q]}
                </label>
              ))}
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Formato</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {FORMATS.map((f) => {
                  const allowed = !approach || formatAllowed(f, approach);
                  return (
                    <label key={f} className={`flex cursor-pointer flex-col gap-0.5 rounded-xl border-2 p-2.5 text-sm ${formato === f ? "border-primary bg-[color:var(--primary-soft)]" : "border-border"} ${allowed ? "" : "cursor-not-allowed opacity-50"}`}>
                      <span className="flex items-center gap-2 font-semibold">
                        <input type="radio" name={formatName} value={f} checked={formato === f} disabled={!allowed} onChange={() => setFormato(f)} />
                        {FORMAT_LABEL[f]}
                      </span>
                      <span className="text-xs text-muted-foreground">{allowed ? FORMAT_HINT[f] : "No va con este enfoque."}</span>
                    </label>
                  );
                })}
              </div>
              {sug && sug.formato.value === formato && formato !== "ejercicio" && <p className="text-xs text-emerald-800">Por qué: {sug.formato.why}</p>}
            </fieldset>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Dónde</p>
              <ToggleChips label="Dónde" options={CONTEXTS} labels={CONTEXT_LABEL} value={contexto} onChange={setContexto} />
              <SuggestedWhy items={sug?.contexto.filter((x) => x.value !== "casa")} labels={CONTEXT_LABEL} />
            </div>

            <div className="flex flex-wrap gap-6">
              <div className="space-y-1.5">
                <Label htmlFor={minId}>Minutos</Label>
                <select id={minId} className={`${selectClass} w-28`} value={minutos} onChange={(e) => setMinutos(Number(e.target.value) as AiMinutes)}>
                  {AI_MINUTES.map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Dificultad</legend>
                <div className="flex flex-wrap gap-3">
                  {DIFFICULTIES.map((d) => (
                    <label key={d} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={difName} value={d} checked={dificultad === d} onChange={() => setDificultad(d)} />
                      {DIFFICULTY_LABEL[d]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Adaptaciones</p>
              <ToggleChips label="Adaptaciones" options={ADAPTATIONS} labels={ADAPTATION_LABEL} value={adaptaciones} onChange={setAdaptaciones} />
              <SuggestedWhy items={sug?.adaptaciones} labels={ADAPTATION_LABEL} />
              <p className="text-xs text-muted-foreground">Se manda la necesidad, nunca la condición de la ficha.</p>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Intereses <span className="font-normal text-muted-foreground">(hasta {AI_INTERESTS_MAX})</span></p>
              <ToggleChips label="Intereses" options={INTERESTS} labels={INTEREST_LABEL} value={intereses} max={AI_INTERESTS_MAX} onChange={setIntereses} />
              {sug && sug.intereses.length === 0 && (
                <p className="text-xs text-muted-foreground">Cargá los intereses en la ficha (Datos personales) y se van a sugerir solos.</p>
              )}
            </div>
          </fieldset>

          {preview && <SentDetails sent={preview} title="Esto es lo que se manda a la IA" />}

          {running && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Preparando una propuesta… Puede tardar hasta 25 segundos.
            </p>
          )}
          {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
          {!running && problem && entries.length > 0 && <p className={`text-xs ${PENDING_TEXT}`}>{problem}</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{running ? "Cancelar (se descarta)" : "Cancelar"}</Button>
            <Button type="submit" className="rounded-full" disabled={running || !!problem}>
              {running && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Armar borrador
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PublishDialog({ data, busy, onPublish, onClose, onReload }: {
  data: StaffPracticeDTO; busy: boolean; onPublish: (ack: boolean) => Promise<PracticeSent>; onClose: () => void; onReload: () => void;
}) {
  const p = data.patient;
  const d = data.draft;
  const pub = data.published;
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<SendError | null>(null);
  const goals = d ? data.goals.filter((g) => g.plan_id === d.id && g.status === "borrador") : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (p.adolescent && !ack) return;
    const r = await onPublish(ack);
    if (!r.ok) setError({ message: r.error, stale: r.status === 409 });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>¿Publicar el plan de práctica de {p.first_name}?</DialogTitle>
          <DialogDescription>Queda así en el portal hasta que publiques una versión nueva, lo finalices o lo retires.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5 text-sm">
            <p>{data.readers_line}</p>
            <p>Desde hoy pueden anotar sus prácticas; las vas a ver en Portal → Prácticas.</p>
            {pub?.published_at && <p>Reemplaza el plan publicado el {dm(pub.published_at)}. Lo que ya anotaron se mantiene.</p>}
            {d && <p className="font-semibold">{d.summary_line}</p>}
            {goals.length > 0 && <p>También se publican estas metas: {goals.map((g) => `«${g.title ?? "Meta"}»`).join(", ")}.</p>}
            {data.author.label && <p className="text-xs text-muted-foreground">Se publica como: {data.author.label}</p>}
          </div>
          {d?.minutes_warning && <p className={WARN_BOX}>{d.minutes_warning}</p>}
          {!data.practice_enabled && (
            <p className={WARN_BOX}>Todavía no está prendido «Mostrar ejercicios, devoluciones y medallas»: la familia lo va a ver cuando lo prendas.</p>
          )}
          {!d && <p role="alert" className={ERROR_BOX}>{PRACTICE_ERROR.conflict}</p>}
          {p.adolescent && (
            <label className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              Lo conversé con {p.first_name}{p.age !== null ? ` (${p.age} años)` : ""}
            </label>
          )}
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={busy} onClose={onClose} submit="Publicar" disabled={!d || (p.adolescent && !ack)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BreakDialog({ data, plan, busy, send, onClose, onReload }: {
  data: StaffPracticeDTO; plan: StaffPlanDTO; busy: boolean; send: PracticeSend; onClose: () => void; onReload: () => void;
}) {
  const today = centerToday();
  const [until, setUntil] = useState(addDaysKey(today, 14));
  const [error, setError] = useState<SendError | null>(null);
  const dateId = useId();
  const valid = !!until && until > today;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!valid) { setError({ message: "Elegí la fecha de vuelta (después de hoy).", stale: false }); return; }
    const r = await send({ action: "plan_break", patient_id: data.patient.id, plan_id: plan.id, until });
    if (!r.ok) { setError({ message: r.error, stale: r.status === 409 }); return; }
    toast.success(`Pausa de vacaciones hasta el ${dk(until)}.`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Pausa de vacaciones</DialogTitle>
          <DialogDescription>El plan sigue publicado. Mientras dure la pausa no hace falta anotar nada.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={dateId}>Vuelven a practicar el</Label>
            <Input id={dateId} type="date" min={addDaysKey(today, 1)} value={until} className="h-10 w-auto"
              onChange={(e) => { setError(null); setUntil(e.target.value); }} />
          </div>
          {valid && <p className="text-sm">La familia ve: «{breakLine(until)}»</p>}
          <p className="text-xs text-muted-foreground">
            Durante la pausa no se calculan medallas ni avisos, y no se pierde nada. La bandeja no la marca como atrasada.
          </p>
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={busy} onClose={onClose} submit="Pausar" disabled={!valid} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({ data, plan, busy, send, onClose, onReload }: {
  data: StaffPracticeDTO; plan: StaffPlanDTO; busy: boolean; send: PracticeSend; onClose: () => void; onReload: () => void;
}) {
  const [reason, setReason] = useState<PlanWithdrawReason | "">("");
  const [error, setError] = useState<SendError | null>(null);
  const reasonId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason) { setError({ message: "Elegí el motivo.", stale: false }); return; }
    const r = await send({ action: "plan_withdraw", patient_id: data.patient.id, plan_id: plan.id, reason });
    if (!r.ok) { setError({ message: r.error, stale: r.status === 409 }); return; }
    toast.success("Se retiró el plan del portal.");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Retirar el plan del portal</DialogTitle>
          <DialogDescription>
            {plan.title ?? "Plan de práctica"} · v{plan.version}{plan.published_at ? `, publicado el ${dm(plan.published_at)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Motivo</Label>
            <select id={reasonId} value={reason} className={selectClass}
              onChange={(e) => { setError(null); setReason(e.target.value as PlanWithdrawReason | ""); }}>
              <option value="">Elegí el motivo</option>
              {PLAN_WITHDRAW_REASONS.map((k) => <option key={k} value={k}>{WITHDRAW_REASON_LABEL[k]}</option>)}
            </select>
          </div>
          <p className="text-sm">
            La familia deja de ver los ejercicios. Lo que anotaron, las devoluciones y las medallas quedan. Queda guardado acá, con tu usuario, la fecha y el motivo.
          </p>
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={busy} onClose={onClose} submit="Retirar" destructive />
        </form>
      </DialogContent>
    </Dialog>
  );
}
