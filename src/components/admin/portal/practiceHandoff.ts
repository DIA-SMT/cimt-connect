import type { StaffInboxCount, StaffPracticeInboxItem } from "@/lib/portalStaff";

// Piezas sin React de la etapa practice del panel (se prueban en
// tests/practiceHandoff.test.ts):
//   1. El número de "Prácticas" de la pestaña Portal y de la bandeja.
//   2. «Dar la medalla» desde la bandeja: abre la ficha del paciente en
//      «Metas y medallas» con la devolución lista (la ficha es de otra parte
//      del panel, así que el pedido queda acá hasta que la ficha lo toma).
//   3. Cambios sin guardar de «Ejercicios, devoluciones y medallas» (el plan
//      y la devolución) que quedan aparte, en la memoria de esta pestaña,
//      cuando la ficha se cierra o se abre otra: vuelven al abrirla de nuevo.
//      Son de quien usa el panel, que sigue a la sesión (ownerChange).
//   4. La bandeja, al día: lo que se hace en la ficha avisa a la bandeja y al
//      número de la pestaña para que se vuelvan a cargar.
//   5. Cuándo se recarga la práctica en la ficha (refreshesPractice).
// Nada de esto va al servidor ni a localStorage.

// ── 1. Número de "Prácticas" ────────────────────────────────────────────────
// El servidor manda en { action: "count" }:
//   practice_pending: filas de MIS pacientes (prácticas sin revisar y metas
//     cumplidas);
//   practice_risk: pacientes que NO son míos (y por eso no entran en
//     practice_pending) con comentarios de riesgo sin ver;
//   practice_urgent: pacientes con comentarios de riesgo sin ver, míos o no
//     (no suma al número: marca la pestaña).
// El número es la suma de los dos primeros: así nadie se cuenta dos veces y un comentario de
// riesgo de un paciente sin profesional (o de otro) también llega a la
// pestaña. Es lo mismo que muestra "Mis pacientes" en la bandeja.
// practiceRisk (= practice_risk): la bandeja lo cuenta igual que el servidor,
// así los dos dicen siempre lo mismo.
// practiceUrgent marca la pestaña como urgente (como los avisos): hay algún
// comentario de riesgo sin ver, de cualquier paciente (míos o no). El
// servidor lo manda en practice_urgent (pacientes así); la bandeja lo saca de
// su lista (practiceUrgentFromInbox) y con eso marca también el chip
// "Prácticas".

type InboxRow = Pick<StaffPracticeInboxItem, "kind" | "mine" | "pending">;
type InboxRowWithPatient = InboxRow & Pick<StaffPracticeInboxItem, "patient_id">;
// Lo que manda { action: "count" } para la práctica (falta sin la etapa
// practice o para Administración)
type ServerPracticeCount = Pick<StaffInboxCount, "practice_pending" | "practice_risk" | "practice_urgent">;

export type PracticeCounts = { practice: number; practiceRisk: number; practiceUrgent: boolean };

// Filas de "Mis pacientes": las mías y, siempre, las prácticas con comentarios de riesgo
export function inMyPracticeList(i: InboxRow): boolean {
  return i.mine || (i.kind === "practicas" && i.pending.risk > 0);
}

// Con la lista de la bandeja (lo mismo que practiceBadgeFromCount con los números del servidor)
export function practiceBadge(items: InboxRow[]): number {
  return items.filter(inMyPracticeList).length;
}

// Con los números del servidor (faltan sin la etapa practice o para Administración)
export function practiceBadgeFromCount(c: Pick<StaffInboxCount, "practice_pending" | "practice_risk">): number {
  return (c.practice_pending ?? 0) + (c.practice_risk ?? 0);
}

// Como practice_risk del servidor: pacientes que no son míos con comentarios
// de riesgo sin ver, uno por paciente
export function practiceRiskCount(items: InboxRowWithPatient[]): number {
  return new Set(items.filter((i) => !i.mine && i.kind === "practicas" && i.pending.risk > 0).map((i) => i.patient_id)).size;
}

// Como practice_urgent del servidor (> 0): alguna fila de prácticas con
// comentarios de riesgo sin ver, de mis pacientes o no
export function practiceUrgentFromInbox(items: InboxRow[]): boolean {
  return items.some((i) => i.kind === "practicas" && i.pending.risk > 0);
}

// Los números juntos, para que nunca se actualice uno sin los otros
export function practiceCountsFromServer(c: ServerPracticeCount): PracticeCounts {
  return { practice: practiceBadgeFromCount(c), practiceRisk: c.practice_risk ?? 0, practiceUrgent: (c.practice_urgent ?? 0) > 0 };
}

export function practiceCountsFromInbox(items: InboxRowWithPatient[]): PracticeCounts {
  return { practice: practiceBadge(items), practiceRisk: practiceRiskCount(items), practiceUrgent: practiceUrgentFromInbox(items) };
}

// ── 2. «Dar la medalla» desde la bandeja ────────────────────────────────────
// La bandeja lo pide y abre la ficha; «Portal del paciente» lo toma una vez
// (takeGoalMedal), se abre solo y le pasa la meta a la sección de práctica,
// que abre la devolución de esa meta con su medalla cargada. Si la ficha de
// ese paciente se cierra (o se abre otra) antes de tomarlo, se olvida
// (forgetGoalMedal); si en un rato no lo toma nadie, también.

export const GOAL_MEDAL_TTL_MS = 60_000;

let goalMedalAsk: { patientId: string; goalId: string; at: number } | null = null;

export function askGoalMedal(patientId: string, goalId: string, now = Date.now()): void {
  goalMedalAsk = { patientId, goalId, at: now };
}

function liveAsk(patientId: string, now: number) {
  const a = goalMedalAsk;
  if (!a) return null;
  if (now - a.at > GOAL_MEDAL_TTL_MS || now < a.at) {
    goalMedalAsk = null;
    return null;
  }
  return a.patientId === patientId ? a : null;
}

// Hay un pedido para este paciente (no lo consume)
export function peekGoalMedal(patientId: string, now = Date.now()): string | null {
  return liveAsk(patientId, now)?.goalId ?? null;
}

// La meta del pedido para este paciente, una sola vez
export function takeGoalMedal(patientId: string, now = Date.now()): string | null {
  const a = liveAsk(patientId, now);
  if (a) goalMedalAsk = null;
  return a?.goalId ?? null;
}

// La ficha de este paciente se cerró (o se abrió otra) sin tomar el pedido:
// que no se cargue más tarde. Un pedido para otro paciente no se toca
export function forgetGoalMedal(patientId: string): void {
  if (goalMedalAsk?.patientId === patientId) goalMedalAsk = null;
}

// ── 3. Cambios sin guardar ──────────────────────────────────────────────────
// Cada parte (el editor del plan, la devolución) guarda acá lo suyo al
// desmontarse con cambios y lo retoma al volver a montarse (peekUnsaved en
// el estado inicial, forgetUnsaved al montarse). Todo va por owner: quién
// está usando el panel (unsavedOwner, con la sesión). Cada persona ve, retoma
// y borra solo lo suyo, y nada dura más de UNSAVED_TTL_MS. Sin owner (no se
// pudo saber quién es) no queda nada aparte. Si la persona cerró la sección
// confirmando que se pierden, dropUnsaved borra lo suyo de ese paciente y no
// le deja guardar nada más ahí hasta que vuelva a abrir la sección
// (allowUnsaved).

export type UnsavedPart = "plan" | "feedback";
export const UNSAVED_TTL_MS = 12 * 60 * 60 * 1000;

type SessionLike = { user?: { id?: string | null; email?: string | null } | null } | null | undefined;

// Quién está usando el panel: el correo de la sesión (como issuedBy en
// portalStaffApi) o, si no tiene, el id del usuario. null: sin sesión
export function unsavedOwner(session: SessionLike): string | null {
  const email = session?.user?.email?.trim().toLowerCase();
  if (email) return email;
  const id = session?.user?.id?.trim();
  return id || null;
}

type Owner = string | null | undefined;
type Kept = { value: unknown; at: number };
const unsaved = new Map<string, Kept>();
const dropped = new Map<string, number>(); // owner y paciente → cuándo se cerró confirmando
const PARTS: UnsavedPart[] = ["plan", "feedback"];
const unsavedKey = (owner: string, patientId: string, part: UnsavedPart) => JSON.stringify([owner, patientId, part]);
const droppedKey = (owner: string, patientId: string) => JSON.stringify([owner, patientId]);
const expired = (at: number, now: number) => now - at > UNSAVED_TTL_MS || now < at;

// Lo vencido se borra (de todos): no queda nada guardado más de UNSAVED_TTL_MS
function sweep(now: number): void {
  for (const [k, kept] of unsaved) if (expired(kept.at, now)) unsaved.delete(k);
  for (const [k, at] of dropped) if (expired(at, now)) dropped.delete(k);
}

export function keepUnsaved(patientId: string, part: UnsavedPart, owner: Owner, value: unknown, now = Date.now()): void {
  sweep(now);
  if (!owner || dropped.has(droppedKey(owner, patientId))) return;
  unsaved.set(unsavedKey(owner, patientId, part), { value, at: now });
}

export function peekUnsaved<T>(patientId: string, part: UnsavedPart, owner: Owner, now = Date.now()): { value: T; at: number } | null {
  sweep(now);
  const kept = owner ? unsaved.get(unsavedKey(owner, patientId, part)) : undefined;
  return kept ? { value: kept.value as T, at: kept.at } : null;
}

// Solo lo de esa persona
export function forgetUnsaved(patientId: string, part: UnsavedPart, owner: Owner): void {
  if (owner) unsaved.delete(unsavedKey(owner, patientId, part));
}

export function hasUnsaved(patientId: string, owner: Owner, now = Date.now()): boolean {
  sweep(now);
  return !!owner && PARTS.some((part) => unsaved.has(unsavedKey(owner, patientId, part)));
}

export function dropUnsaved(patientId: string, owner: Owner, now = Date.now()): void {
  if (!owner) return;
  for (const part of PARTS) forgetUnsaved(patientId, part, owner);
  dropped.set(droppedKey(owner, patientId), now);
}

export function allowUnsaved(patientId: string, owner: Owner): void {
  if (owner) dropped.delete(droppedKey(owner, patientId));
}

// owner sigue a la sesión: «Portal del paciente» escucha los cambios de
// sesión (otra persona entra en esta pestaña o en otra, se cierra la sesión)
// y con ownerChange decide qué hacer:
//   "same": nada (por ejemplo, se renovó el token);
//   "known": recién se supo quién es (todavía no se mostró nada de nadie);
//   "switched": cambió quién usa el panel: la sección se cierra y empieza de
//     cero. Lo sin guardar de quien estaba queda aparte para esa persona (las
//     partes lo guardan al desmontarse con el owner con que se montaron) y
//     nadie más lo ve ni lo borra.
export type OwnerChange = "same" | "known" | "switched";

export function ownerChange(prev: Owner, next: string | null): OwnerChange {
  if (prev === next) return "same";
  return prev === undefined ? "known" : "switched";
}

// Quién usa el panel ahora (lo anota «Portal del paciente» al seguir la
// sesión). El aviso de "quedaron cambios sin guardar" al cerrar la ficha es
// solo para quien los dejó, y mientras siga siendo quien usa el panel
let panelOwner: Owner;

export function setPanelOwner(owner: Owner): void {
  panelOwner = owner;
}

export function isPanelOwner(owner: Owner): boolean {
  return !!owner && owner === panelOwner;
}

// Cuántas veces está montada cada cosa por paciente: al desmontarse, lo que
// se hace "al cerrar" se hace solo si no se volvió a montar enseguida (React
// en modo estricto, o la misma ficha que se vuelve a dibujar)
function mountCounter() {
  const mounted = new Map<string, number>();
  return {
    mount(patientId: string): () => void {
      mounted.set(patientId, (mounted.get(patientId) ?? 0) + 1);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const n = (mounted.get(patientId) ?? 1) - 1;
        if (n > 0) mounted.set(patientId, n);
        else mounted.delete(patientId);
      };
    },
    has: (patientId: string): boolean => (mounted.get(patientId) ?? 0) > 0,
  };
}

// Secciones de práctica: el aviso de "quedaron cambios sin guardar"
const practiceSections = mountCounter();
export const sectionMounted = practiceSections.mount;
export const isSectionMounted = practiceSections.has;

// «Portal del paciente» en la ficha: al cerrarse, forgetGoalMedal
const patientSections = mountCounter();
export const patientSectionMounted = patientSections.mount;
export const isPatientSectionMounted = patientSections.has;

// ── 4. La bandeja, al día ───────────────────────────────────────────────────
// La sección de práctica de la ficha avisa con un evento de window después de
// cada acción que sale bien (no al mirar: "get" y "catalog"); la bandeja se
// vuelve a cargar y el número de la pestaña también. Solo lleva el id del
// paciente.

export const INBOX_STALE_EVENT = "cimt:portal-inbox-stale";
export type InboxStaleDetail = { patientId: string };

const READ_ONLY_ACTIONS: ReadonlySet<string> = new Set(["get", "catalog"]);

export function changesInbox(action: string): boolean {
  return !READ_ONLY_ACTIONS.has(action);
}

const pageTarget = (): EventTarget | null => (typeof window === "undefined" ? null : window);

export function markInboxStale(patientId: string, target: EventTarget | null = pageTarget()): void {
  target?.dispatchEvent(new CustomEvent<InboxStaleDetail>(INBOX_STALE_EVENT, { detail: { patientId } }));
}

// Devuelve cómo dejar de escuchar. patientId: null si el evento no lo trae
export function onInboxStale(cb: (patientId: string | null) => void, target: EventTarget | null = pageTarget()): () => void {
  if (!target) return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<Partial<InboxStaleDetail> | null>).detail;
    cb(typeof detail?.patientId === "string" ? detail.patientId : null);
  };
  target.addEventListener(INBOX_STALE_EVENT, handler);
  return () => target.removeEventListener(INBOX_STALE_EVENT, handler);
}

// ── 5. Cuándo se recarga la práctica en la ficha ────────────────────────────
// «Ejercicios, devoluciones y medallas» se carga sola al montarse (al abrir
// «Portal del paciente»). Después se vuelve a cargar (refreshKey, un
// contador) solo cuando la sección de arriba guarda algo o cuando, por un
// 409, se trae lo último: «quién lo ve» y la habilitación pueden haber
// cambiado. Volver a cargar la sección de arriba (al abrirla o con "Probá de
// nuevo") no la recarga: si no, al abrir de nuevo se cargaría dos veces.

export function refreshesPractice(r: { ok: boolean; status?: number }): boolean {
  return r.ok || r.status === 409;
}
