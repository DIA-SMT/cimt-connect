// Portal — pedidos de turno: la familia pide, el centro asigna.
//
// Un adulto con acceso a los turnos de una persona (titular, representante
// legal o autorizado) cuenta para qué es el turno y qué días y horarios le
// quedan bien. No elige día ni hora: el pedido llega a la bandeja del panel
// (Portal → Pedidos de turno) y el equipo lo agenda en la Agenda (y lo
// enlaza), avisa que la va a llamar o lo rechaza con un motivo. El portal
// solo muestra el estado. Reglas puras en src/lib/apptRequestRules.ts.
//
// Si todavía no se corrió el script 24, las lecturas dan listas vacías (el
// portal y la bandeja siguen andando) y pedir un turno avisa que todavía no
// se puede.

import {
  type ApptReqEvent, type ApptReqEventKind, type ApptReqRejectReason, type ApptReqStaffTarget, type ApptReqStatus,
  type ApptRequestDTO, type ApptRequestRow, type StaffApptRequest, type StaffApptSlot,
  APPT_REQ_DAILY_MAX, APPT_REQ_OPEN, APPT_REQ_REJECT_REASONS, APPT_REQ_TRANSITIONS, APPT_REQ_VISIBLE_DAYS,
  apptReqOpen, apptRequestVisible, computeApptRequestDto, validateApptRequest,
} from "../../src/lib/apptRequestRules";
import { centerNow, normalizeDni } from "../../src/lib/portalRules";
import { type Account, type ActiveChild, type Ctx, PortalError, accountLinks, missingTable } from "./portal";

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const DAY_MS = 24 * 60 * 60 * 1000;
const OFFLINE = "No pudimos conectar. Probá de nuevo.";
const NOT_YET = "Todavía no se pueden pedir turnos desde el portal. Llamanos al centro.";
const STAFF_DAYS = 30; // cerrados que se siguen viendo en la bandeja
const STAFF_NOTES_MAX = 500; // como el CHECK de staff_notes en la base

// Estados cerrados y pasos del equipo, sacados de las reglas (así no se desfasan)
const CLOSED = (Object.keys(APPT_REQ_TRANSITIONS) as ApptReqStatus[]).filter((s) => !apptReqOpen(s));
const TARGETS = [...new Set(Object.values(APPT_REQ_TRANSITIONS).flat())];

// Constancia de cada paso. Si no se puede guardar no se frena el pedido,
// pero queda en el log del servidor.
async function logEvent(ctx: Ctx, requestId: string, kind: ApptReqEventKind, byEmail: string | null) {
  const { error } = await ctx.admin.from("portal_appt_request_events").insert({ request_id: requestId, kind, by_email: byEmail });
  if (error) console.error("[portal] no se pudo guardar la constancia del pedido de turno:", kind);
}

// ── Turnos enlazados ────────────────────────────────────────────────────────
// En la base, un turno está "pendiente" o "confirmado" (los dos son un turno
// agendado para el portal) o "cancelado".

type SlotRow = {
  id: string; patient_id: string; appointment_date: string; appointment_time: string;
  status: string; professional_id: string | null;
};
const SLOT_COLS = "id, patient_id, appointment_date, appointment_time, status, professional_id";

// Turnos enlazados a estos pedidos que siguen en pie: existen, son de la misma
// persona y no se cancelaron. Pedido → turno. (Si se borra un turno, la base
// deja el pedido sin turno enlazado, appointment_id ON DELETE SET NULL, y eso
// no se puede distinguir de un pedido agendado sin enlazar: no se detecta.)
async function linkedSlots(ctx: Ctx, rows: { id: string; patient_id: string; appointment_id: string | null }[]): Promise<Map<string, SlotRow>> {
  const out = new Map<string, SlotRow>();
  const ids = [...new Set(rows.map((r) => r.appointment_id).filter((x): x is string => !!x))];
  if (!ids.length) return out;
  const { data, error } = await ctx.admin.from("appointments").select(SLOT_COLS).in("id", ids);
  if (error) throw new PortalError(503, OFFLINE);
  for (const r of rows) {
    const a = ((data ?? []) as SlotRow[]).find((x) => x.id === r.appointment_id);
    if (a && a.patient_id === r.patient_id && a.status !== "cancelado") out.set(r.id, a);
  }
  return out;
}

// ── Familia ─────────────────────────────────────────────────────────────────

const FAMILY_COLS = "id, patient_id, account_id, status, reason, days, band, modality, note, reject_reason, appointment_id, created_at, updated_at";
type FamilyRow = ApptRequestRow & { appointment_id: string | null };

// ¿Ya existe la tabla de pedidos de turno (script 24)? Para una cuenta sin
// personas, que no llega a leerla. Una consulta común de una fila: un conteo
// (head) no sirve, porque sin la tabla no da error (la respuesta no trae cuerpo).
async function apptRequestsReady(ctx: Ctx): Promise<boolean> {
  const { error } = await ctx.admin.from("portal_appt_requests").select("id").limit(1);
  if (missingTable(error)) return false;
  if (error) throw new PortalError(503, OFFLINE);
  return true;
}

// Pedidos de turno de estas personas, los haya hecho el adulto que sea (la
// familia ve uno solo por persona): abiertos y cerrados recientes, los más
// nuevos primero. El comentario solo lo ve quien lo escribió.
// null: la tabla todavía no existe (falta el script 24), también sin personas.
export async function apptRequestsFor(
  ctx: Ctx, account: Account, children: ActiveChild[], onlyPatientId?: string,
): Promise<ApptRequestDTO[] | null> {
  const kids = children.filter((c) => !onlyPatientId || c.patient_id === onlyPatientId);
  if (!kids.length) return (await apptRequestsReady(ctx)) ? [] : null;
  const ids = kids.map((c) => c.patient_id);
  const since = new Date(Date.now() - APPT_REQ_VISIBLE_DAYS * DAY_MS).toISOString();
  const [open, closed] = await Promise.all([
    ctx.admin.from("portal_appt_requests").select(FAMILY_COLS).in("patient_id", ids).in("status", [...APPT_REQ_OPEN]),
    ctx.admin.from("portal_appt_requests").select(FAMILY_COLS).in("patient_id", ids).in("status", CLOSED)
      .gte("updated_at", since).order("updated_at", { ascending: false }).limit(100),
  ]);
  if (missingTable(open.error) || missingTable(closed.error)) return null;
  if (open.error || closed.error) throw new PortalError(503, OFFLINE);
  const now = new Date();
  const rows = ([...(open.data ?? []), ...(closed.data ?? [])] as FamilyRow[])
    .filter((r) => apptRequestVisible(r, now))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const slots = await linkedSlots(ctx, rows.filter((r) => r.status === "agendado"));
  return rows.map((r) => {
    const child = kids.find((c) => c.patient_id === r.patient_id)!;
    const a = slots.get(r.id);
    // Tenía un turno enlazado que ya no está en pie (se canceló o se pasó a
    // otra persona): la familia lo ve y puede pedir otro. Uno borrado no se
    // detecta (la base deja el enlace vacío)
    const apptCancelled = r.status === "agendado" && !!r.appointment_id && !a;
    return computeApptRequestDto(r, { display: child.display, self: child.self }, account.id,
      a ? { id: a.id, date: a.appointment_date, time: String(a.appointment_time).slice(0, 5) } : null, apptCancelled);
  });
}

// Se puede pedir un turno para esta persona: se pueden pedir turnos (la tabla
// existe) y no hay otro pedido abierto, de ningún adulto de la familia
export function canRequestAppt(requests: ApptRequestDTO[] | null, patientId: string): boolean {
  return !!requests && !requests.some((r) => r.patient_id === patientId && apptReqOpen(r.status));
}

export async function createApptRequest(
  ctx: Ctx, account: Account, children: ActiveChild[], patientId: string, raw: unknown,
): Promise<ApptRequestDTO> {
  const child = children.find((c) => c.patient_id === patientId);
  if (!child) throw new PortalError(404, "No encontramos a ese chico en tu cuenta.");
  const v = validateApptRequest(raw);
  if (!v.ok) throw new PortalError(400, v.error);

  // Sin la tabla, el conteo no da error (la consulta no trae cuerpo): lo
  // atrapa el insert de abajo
  const { count, error: cErr } = await ctx.admin.from("portal_appt_requests").select("id", { count: "exact", head: true })
    .eq("account_id", account.id).gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  if (cErr) throw new PortalError(503, missingTable(cErr) ? NOT_YET : OFFLINE);
  if ((count ?? 0) >= APPT_REQ_DAILY_MAX) throw new PortalError(429, "Ya hiciste varios pedidos hoy. Si necesitás algo más, llamanos.");

  const { data, error } = await ctx.admin.from("portal_appt_requests").insert({
    patient_id: child.patient_id,
    account_id: account.id,
    link_kind: child.kind,
    requester_name: `${account.first_name} ${account.last_name}`.trim(),
    ...v.value,
  }).select(FAMILY_COLS).single();
  if (error?.code === "23505") {
    throw new PortalError(409, child.self
      ? "Ya tenés un pedido de turno en curso. Te avisamos acá cuando lo resolvamos."
      : `Ya hay un pedido de turno en curso para ${child.display}. Te avisamos acá cuando lo resolvamos.`, { code: "APPT_OPEN" });
  }
  if (missingTable(error)) throw new PortalError(503, NOT_YET);
  if (error || !data) throw new PortalError(503, "No pudimos guardar tu pedido. Probá de nuevo.");
  await logEvent(ctx, data.id as string, "pedido", null);
  return computeApptRequestDto(data as FamilyRow, { display: child.display, self: child.self }, account.id, null);
}

export async function cancelApptRequest(ctx: Ctx, account: Account, children: ActiveChild[], id: string): Promise<ApptRequestDTO> {
  if (!isUuid(id)) throw new PortalError(404, "No encontramos ese pedido.");
  const { data: row, error: rErr } = await ctx.admin.from("portal_appt_requests").select(FAMILY_COLS).eq("id", id).maybeSingle();
  if (rErr && !missingTable(rErr)) throw new PortalError(503, OFFLINE);
  const child = row ? children.find((c) => c.patient_id === row.patient_id) : undefined;
  // Un pedido de otro adulto da lo mismo que uno que no existe
  if (!row || row.account_id !== account.id || !child) throw new PortalError(404, "No encontramos ese pedido.");
  if (!apptReqOpen(row.status as ApptReqStatus)) {
    throw new PortalError(409, row.status === "agendado"
      ? "Este pedido ya tiene turno: lo ves en la lista. Si no van a poder ir, avisanos desde el turno."
      : "Este pedido ya está cerrado.");
  }
  // Se puede cancelar mientras siga abierto (aunque el equipo haya avisado que llama)
  const now = new Date().toISOString();
  const { data, error } = await ctx.admin.from("portal_appt_requests")
    .update({ status: "cancelado", cancelled_at: now, updated_at: now })
    .eq("id", id).in("status", [...APPT_REQ_OPEN]).select(FAMILY_COLS);
  if (error) throw new PortalError(503, "No pudimos cancelar el pedido. Probá de nuevo.");
  if (!data?.length) throw new PortalError(409, "El equipo ya resolvió este pedido. Actualizá la página para ver cómo quedó.");
  await logEvent(ctx, id, "cancelado", null);
  return computeApptRequestDto(data[0] as FamilyRow, { display: child.display, self: child.self }, account.id, null);
}

// ── Equipo ──────────────────────────────────────────────────────────────────

const STAFF_COLS = "id, patient_id, account_id, link_kind, requester_name, status, reason, days, band, modality, note, appointment_id, scheduled_at, scheduled_by_email, contacted_at, contacted_by_email, rejected_at, rejected_by_email, reject_reason, cancelled_at, staff_notes, created_at, updated_at";

type StaffRow = Omit<StaffApptRequest,
  "patient_name" | "contact_phones" | "still_allowed" | "requester_blocked" | "appointment" | "appointment_cancelled" | "upcoming" | "events"
> & { account_id: string | null; appointment_id: string | null; updated_at: string };
type PatientRow = { id: string; first_name: string; last_name: string; phone: string | null; guardian_phone: string | null };
type GuardianRow = { id: string; patient_id: string; dni: string | null; phone: string | null; is_primary: boolean; active: boolean };
const GUARDIAN_COLS = "id, patient_id, dni, phone, is_primary, active";
type BlockRow = { patient_id: string; guardian_id: string | null; dni: string };
type EventRow = { request_id: string; kind: ApptReqEventKind; by_email: string | null; created_at: string };

const digits = (phone: string | null | undefined) => String(phone ?? "").replace(/\D/g, "");

// Bloqueos por orden judicial vigentes de estas personas (script 22; sin la
// tabla, ninguno)
async function liveBlocks(ctx: Ctx, patientIds: string[]): Promise<BlockRow[]> {
  const { data, error } = await ctx.admin.from("portal_guardian_blocks")
    .select("patient_id, guardian_id, dni").is("lifted_at", null).in("patient_id", patientIds);
  if (error) {
    if (missingTable(error)) return [];
    throw new PortalError(503, OFFLINE);
  }
  return (data ?? []) as BlockRow[];
}

// Un adulto de la ficha está bloqueado para esa persona por su fila o por su DNI
function guardianBlocked(g: GuardianRow, blocks: BlockRow[]): boolean {
  const dni = normalizeDni(g.dni ?? "");
  return blocks.some((b) => b.patient_id === g.patient_id && (b.guardian_id === g.id || (!!dni && b.dni === dni)));
}

// Pedidos hechos por un adulto que hoy tiene un bloqueo para esa persona. Como
// en blockedPatients(): por el DNI de su cuenta o por la fila de la ficha con
// que se vinculó (aunque ese vínculo ya esté revocado, por ejemplo por el mismo
// bloqueo). También si la fila bloqueada tiene hoy el DNI de la cuenta.
async function blockedRequesters(ctx: Ctx, rows: StaffRow[], blocks: BlockRow[], guardians: GuardianRow[]): Promise<Set<string>> {
  const out = new Set<string>();
  const suspects = rows.filter((r) => !!r.account_id && blocks.some((b) => b.patient_id === r.patient_id));
  if (!suspects.length) return out;
  const accountIds = [...new Set(suspects.map((r) => r.account_id!))];
  const [{ data: accounts, error: aErr }, { data: links, error: lErr }] = await Promise.all([
    ctx.admin.from("portal_accounts").select("id, dni").in("id", accountIds),
    ctx.admin.from("portal_links").select("account_id, patient_id, guardian_id")
      .in("account_id", accountIds).in("patient_id", [...new Set(suspects.map((r) => r.patient_id))]),
  ]);
  if (aErr || lErr) throw new PortalError(503, OFFLINE);
  for (const r of suspects) {
    const acc = ((accounts ?? []) as { id: string; dni: string | null }[]).find((a) => a.id === r.account_id);
    const dni = normalizeDni(acc?.dni ?? "");
    const rowsOfAccount = ((links ?? []) as { account_id: string; patient_id: string; guardian_id: string | null }[])
      .filter((l) => l.account_id === r.account_id && l.patient_id === r.patient_id && !!l.guardian_id)
      .map((l) => l.guardian_id!);
    const hit = blocks.some((b) => {
      if (b.patient_id !== r.patient_id) return false;
      if (dni && b.dni === dni) return true;
      if (!b.guardian_id) return false;
      if (rowsOfAccount.includes(b.guardian_id)) return true;
      const g = guardians.find((x) => x.id === b.guardian_id);
      return !!dni && !!g && normalizeDni(g.dni ?? "") === dni;
    });
    if (hit) out.add(r.id);
  }
  return out;
}

// El mismo control para un solo pedido (al moverlo en la bandeja)
async function requesterBlocked(ctx: Ctx, row: StaffRow): Promise<boolean> {
  if (!row.account_id) return false;
  const blocks = await liveBlocks(ctx, [row.patient_id]);
  if (!blocks.length) return false;
  const { data, error } = await ctx.admin.from("patient_guardians").select(GUARDIAN_COLS).eq("patient_id", row.patient_id);
  if (error) throw new PortalError(503, OFFLINE);
  return (await blockedRequesters(ctx, [row], blocks, (data ?? []) as GuardianRow[])).has(row.id);
}

// Para un pedido abierto: ¿quien lo hizo sigue teniendo acceso a los turnos
// de esa persona hoy? (por ejemplo, se quitó al adulto de la ficha, se cargó
// el alta o se pausó su cuenta). null si no se puede saber o está cerrado.
async function stillAllowed(ctx: Ctx, rows: StaffRow[]): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const open = rows.filter((r) => apptReqOpen(r.status));
  const accountIds = [...new Set(open.map((r) => r.account_id).filter((x): x is string => !!x))];
  const { data: accounts, error } = accountIds.length
    ? await ctx.admin.from("portal_accounts").select("id, dni, active").in("id", accountIds)
    : { data: [] as { id: string; dni: string; active: boolean }[], error: null };
  const links = new Map<string, Awaited<ReturnType<typeof accountLinks>> | null>();
  const paused = new Set<string>();
  if (!error) {
    await Promise.all(((accounts ?? []) as { id: string; dni: string; active: boolean }[]).map(async (a) => {
      if (!a.active) paused.add(a.id);
      links.set(a.id, a.active ? await accountLinks(ctx, a).catch(() => null) : []);
    }));
  }
  for (const r of rows) {
    if (!apptReqOpen(r.status) || error) { out.set(r.id, null); continue; }
    // Sin cuenta (se borró): ya nadie ve ese pedido
    if (!r.account_id || !links.has(r.account_id) || paused.has(r.account_id)) { out.set(r.id, false); continue; }
    const ls = links.get(r.account_id);
    out.set(r.id, ls ? ls.some((l) => l.patient_id === r.patient_id && l.valid) : null);
  }
  return out;
}

// Teléfonos de la ficha: el del paciente, el del tutor (campo viejo) y los de
// los adultos responsables activos (el contacto principal primero). Sin
// repetidos (comparando solo los números) ni vacíos. Nunca el de un adulto con
// un bloqueo vigente para esa persona, aunque el mismo número esté cargado en
// otro campo de la ficha (no hay que contactarlo).
function phonesOf(p: PatientRow | undefined, guardians: GuardianRow[], blocks: BlockRow[]): string[] {
  const mine = guardians.filter((g) => g.patient_id === p?.id);
  const blocked = mine.filter((g) => guardianBlocked(g, blocks));
  const all = [
    p?.phone, p?.guardian_phone,
    ...mine.filter((g) => g.active && !blocked.includes(g))
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).map((g) => g.phone),
  ];
  const seen = new Set<string>(blocked.map((g) => digits(g.phone)).filter(Boolean));
  const out: string[] = [];
  for (const raw of all) {
    const phone = String(raw ?? "").trim();
    const key = digits(phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(phone);
  }
  return out;
}

// Próximos turnos agendados de cada persona (desde hoy, en la hora del centro):
// para elegir cuál enlazar al marcar "agendado"
async function upcomingSlots(ctx: Ctx, patientIds: string[]): Promise<Map<string, SlotRow[]>> {
  const today = centerNow().date;
  const lists = await Promise.all(patientIds.map(async (id) => {
    const { data, error } = await ctx.admin.from("appointments").select(SLOT_COLS)
      .eq("patient_id", id).neq("status", "cancelado").gte("appointment_date", today)
      .order("appointment_date", { ascending: true }).order("appointment_time", { ascending: true }).limit(10);
    if (error) throw new PortalError(503, OFFLINE);
    return [id, (data ?? []) as SlotRow[]] as const;
  }));
  return new Map(lists);
}

async function toStaff(ctx: Ctx, rows: StaffRow[]): Promise<StaffApptRequest[]> {
  if (!rows.length) return [];
  const patientIds = [...new Set(rows.map((r) => r.patient_id))];
  const openPatients = [...new Set(rows.filter((r) => apptReqOpen(r.status)).map((r) => r.patient_id))];
  const [
    { data: patients, error: pErr }, { data: guardianData, error: gErr }, { data: events, error: eErr },
    linked, upcoming, allowed, blocks,
  ] = await Promise.all([
    ctx.admin.from("patients").select("id, first_name, last_name, phone, guardian_phone").in("id", patientIds),
    // También los inactivos: un adulto bloqueado puede haber quedado inactivo
    // en la ficha y su número no se tiene que ofrecer igual
    ctx.admin.from("patient_guardians").select(GUARDIAN_COLS).in("patient_id", patientIds),
    ctx.admin.from("portal_appt_request_events").select("request_id, kind, by_email, created_at")
      .in("request_id", rows.map((r) => r.id)).order("created_at", { ascending: true }),
    linkedSlots(ctx, rows),
    upcomingSlots(ctx, openPatients),
    stillAllowed(ctx, rows),
    liveBlocks(ctx, patientIds),
  ]);
  if (pErr || gErr || eErr) throw new PortalError(503, OFFLINE);
  const guardians = (guardianData ?? []) as GuardianRow[];
  const blockedReq = blocks.length ? await blockedRequesters(ctx, rows, blocks, guardians) : new Set<string>();

  const proIds = [...new Set([...linked.values(), ...[...upcoming.values()].flat()]
    .map((a) => a.professional_id).filter((x): x is string => !!x))];
  const { data: pros, error: prErr } = proIds.length
    ? await ctx.admin.from("professionals").select("id, name").in("id", proIds)
    : { data: [] as { id: string; name: string }[], error: null };
  if (prErr) throw new PortalError(503, OFFLINE);
  const proName = new Map(((pros ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const slot = (a: SlotRow): StaffApptSlot => ({
    id: a.id,
    date: a.appointment_date,
    time: String(a.appointment_time).slice(0, 5),
    professional_name: a.professional_id ? proName.get(a.professional_id) ?? null : null,
  });

  return rows.map((r) => {
    const p = ((patients ?? []) as PatientRow[]).find((x) => x.id === r.patient_id);
    const a = linked.get(r.id);
    const { account_id: _a, appointment_id: _ap, updated_at: _u, ...rest } = r;
    return {
      ...rest,
      patient_name: p ? `${p.last_name}, ${p.first_name}` : "Paciente",
      contact_phones: phonesOf(p, guardians, blocks),
      still_allowed: allowed.get(r.id) ?? null,
      requester_blocked: blockedReq.has(r.id),
      // Si el turno enlazado se canceló o pasó a otra persona, no se muestra y
      // la familia ve «Turno cancelado» (como en apptRequestsFor). Uno borrado
      // no se detecta: la base deja el enlace vacío
      appointment: a ? slot(a) : null,
      appointment_cancelled: r.status === "agendado" && !!r.appointment_id && !a,
      upcoming: apptReqOpen(r.status) ? (upcoming.get(r.patient_id) ?? []).map(slot) : [],
      events: ((events ?? []) as EventRow[])
        .filter((e) => e.request_id === r.id)
        .map((e): ApptReqEvent => ({ kind: e.kind, by_email: e.by_email, at: e.created_at })),
    };
  });
}

// Abiertos (los más nuevos primero) y después los cerrados de los últimos 30
// días (los que se cerraron más recientemente primero)
export async function staffApptList(ctx: Ctx): Promise<StaffApptRequest[]> {
  const since = new Date(Date.now() - STAFF_DAYS * DAY_MS).toISOString();
  const [open, closed] = await Promise.all([
    ctx.admin.from("portal_appt_requests").select(STAFF_COLS)
      .in("status", [...APPT_REQ_OPEN]).order("created_at", { ascending: false }),
    ctx.admin.from("portal_appt_requests").select(STAFF_COLS)
      .in("status", CLOSED).gte("updated_at", since)
      .order("updated_at", { ascending: false }).limit(100),
  ]);
  if (missingTable(open.error) || missingTable(closed.error)) return [];
  if (open.error || closed.error) throw new PortalError(503, OFFLINE);
  return toStaff(ctx, [...(open.data ?? []), ...(closed.data ?? [])] as StaffRow[]);
}

// Para el número de la pestaña cuentan solo los pendientes: los marcados
// "La vamos a llamar" ya tienen a alguien del equipo ocupándose
export async function staffApptPendingCount(ctx: Ctx): Promise<number> {
  const { count, error } = await ctx.admin.from("portal_appt_requests").select("id", { count: "exact", head: true }).eq("status", "pendiente");
  if (error) {
    if (missingTable(error)) return 0;
    throw new PortalError(503, OFFLINE);
  }
  return count ?? 0;
}

export async function staffApptUpdate(ctx: Ctx, staffEmail: string, body: {
  id?: unknown; to?: unknown; appointment_id?: unknown; reject_reason?: unknown;
}): Promise<StaffApptRequest> {
  if (!isUuid(body.id)) throw new PortalError(400, "Pedido inválido");
  const to = String(body.to) as ApptReqStaffTarget;
  if (!TARGETS.includes(to)) throw new PortalError(400, "Pedido inválido");
  const { data: row, error: rErr } = await ctx.admin.from("portal_appt_requests").select(STAFF_COLS).eq("id", body.id).maybeSingle();
  if (rErr) throw new PortalError(503, OFFLINE);
  if (!row) throw new PortalError(404, "No encontramos ese pedido.");
  const current = row as StaffRow;
  // Ya quedó agendado con este mismo turno (por ejemplo, se guardó pero no
  // llegó la respuesta y el panel lo vuelve a enlazar): no es un cambio
  if (to === "agendado" && current.status === "agendado" && isUuid(body.appointment_id)
    && current.appointment_id === body.appointment_id) {
    return (await toStaff(ctx, [current]))[0];
  }
  if (!APPT_REQ_TRANSITIONS[current.status].includes(to)) {
    throw new PortalError(409, "Este pedido cambió mientras tanto. Actualizá la bandeja.");
  }
  // Si quien lo pidió tiene hoy un bloqueo por orden judicial para esta
  // persona, el pedido solo se puede cerrar (agendar o «No se puede», sin
  // avisarle): no se reabre ni se marca para llamarlo. Así un pedido cerrado
  // por el bloqueo no vuelve a la bandeja
  if (apptReqOpen(to) && (await requesterBlocked(ctx, current))) {
    throw new PortalError(409, apptReqOpen(current.status)
      ? "Quien lo pidió tiene un bloqueo por orden judicial: no lo contactes. Resolvé el pedido sin avisarle."
      : "Quien lo pidió tiene un bloqueo por orden judicial: este pedido no se puede reabrir.");
  }

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (to === "agendado") {
    // El turno que se dio (opcional): de esta persona, sin cancelar y de hoy en adelante
    let appointmentId: string | null = null;
    if (body.appointment_id != null && body.appointment_id !== "") {
      const bad = new PortalError(400, "Ese turno no es de esta persona, está cancelado o ya pasó. Elegí otro de la lista.");
      if (!isUuid(body.appointment_id)) throw bad;
      const { data: a, error: aErr } = await ctx.admin.from("appointments").select(SLOT_COLS).eq("id", body.appointment_id).maybeSingle();
      if (aErr) throw new PortalError(503, OFFLINE);
      const appt = a as SlotRow | null;
      if (!appt || appt.patient_id !== current.patient_id || appt.status === "cancelado" || appt.appointment_date < centerNow().date) throw bad;
      appointmentId = appt.id;
    }
    patch = { appointment_id: appointmentId, scheduled_at: now, scheduled_by_email: staffEmail };
  } else if (to === "contactar") {
    patch = { contacted_at: now, contacted_by_email: staffEmail };
  } else if (to === "rechazado") {
    // Solo los motivos que elige el equipo: "bloqueo" lo pone el servidor al
    // cargar un bloqueo por orden judicial (closeApptRequestsOnBlock)
    if (!(APPT_REQ_REJECT_REASONS as readonly unknown[]).includes(body.reject_reason)) throw new PortalError(400, "Elegí el motivo.");
    patch = { rejected_at: now, rejected_by_email: staffEmail, reject_reason: body.reject_reason as ApptReqRejectReason };
  } else {
    // Volver a pendiente (se marcó por error): queda como recién llegado. La
    // constancia de lo que se había hecho queda en portal_appt_request_events
    patch = {
      appointment_id: null, reject_reason: null,
      scheduled_at: null, scheduled_by_email: null, contacted_at: null, contacted_by_email: null,
      rejected_at: null, rejected_by_email: null,
    };
  }

  // Solo si nadie lo cambió mientras tanto (otra persona del equipo o la familia)
  const { data, error } = await ctx.admin.from("portal_appt_requests")
    .update({ ...patch, status: to, updated_at: now })
    .eq("id", current.id).eq("status", current.status).select(STAFF_COLS);
  // Volver a abrir uno cerrado cuando la familia ya hizo otro pedido
  if (error?.code === "23505") {
    throw new PortalError(409, "Esta persona ya tiene otro pedido de turno abierto. Resolvé ese.");
  }
  if (error) throw new PortalError(503, "No se pudo guardar. Probá de nuevo.");
  if (!data?.length) throw new PortalError(409, "Este pedido cambió mientras tanto. Actualizá la bandeja.");
  await logEvent(ctx, current.id, to, staffEmail);
  return (await toStaff(ctx, data as StaffRow[]))[0];
}

export async function staffApptNotes(ctx: Ctx, staffEmail: string, body: { id?: unknown; notes?: unknown }) {
  if (!isUuid(body.id)) throw new PortalError(400, "Pedido inválido");
  const notes = String(body.notes ?? "").trim();
  if (notes.length > STAFF_NOTES_MAX) throw new PortalError(400, `Las notas pueden tener hasta ${STAFF_NOTES_MAX} caracteres.`);
  // No cambia updated_at: una nota no alarga lo que la familia ve un pedido cerrado
  const { data, error } = await ctx.admin.from("portal_appt_requests")
    .update({ staff_notes: notes || null }).eq("id", body.id).select("id");
  if (error) throw new PortalError(503, "No se pudieron guardar las notas. Probá de nuevo.");
  if (!data?.length) throw new PortalError(404, "No encontramos ese pedido.");
  await logEvent(ctx, body.id, "nota", staffEmail);
  return { ok: true as const };
}

// ── Bloqueo por orden judicial ──────────────────────────────────────────────

const BLOCK_NOTE = "Cerrado por bloqueo judicial";

// Agrega la constancia a las notas del equipo sin pasarse del máximo (si no
// entra, se acortan las notas anteriores). Se cuentan caracteres como la base.
// Si ya la tiene (un intento anterior), quedan como estaban: no se repite.
function withBlockNote(prev: string | null): string {
  const trimmed = (prev ?? "").trim();
  if (trimmed.split("\n").some((line) => line.trim() === BLOCK_NOTE)) return trimmed;
  const old = [...trimmed];
  if (!old.length) return BLOCK_NOTE;
  const room = STAFF_NOTES_MAX - BLOCK_NOTE.length - 1; // el salto de línea
  const kept = old.length > room ? `${old.slice(0, room - 1).join("").trimEnd()}…` : old.join("");
  return `${kept}\n${BLOCK_NOTE}`;
}

// Al bloquear a un adulto para un paciente se cierran sus pedidos de turno
// abiertos para ese paciente (accountIds: sus cuentas, por DNI o por su fila
// en la ficha): rechazados con motivo "bloqueo" y la constancia en las notas.
// No hay que contactarlo ni darle el día y la hora, y mientras el bloqueo siga
// vigente el equipo no los puede reabrir (staffApptUpdate). Sin la tabla (falta
// el script 24) no hay nada que cerrar. false: no se pudo cerrar alguno (la
// constancia en el historial no frena: si falla, queda en el log).
export async function closeApptRequestsOnBlock(ctx: Ctx, staffEmail: string, patientId: string, accountIds: string[]): Promise<boolean> {
  if (!accountIds.length) return true;
  const { data: open, error } = await ctx.admin.from("portal_appt_requests").select("id, staff_notes")
    .eq("patient_id", patientId).in("account_id", accountIds).in("status", [...APPT_REQ_OPEN]);
  if (error) return missingTable(error);
  const now = new Date().toISOString();
  const reason: ApptReqRejectReason = "bloqueo";
  for (const r of (open ?? []) as { id: string; staff_notes: string | null }[]) {
    // Solo si sigue abierto (si alguien del equipo lo resolvió recién, queda como está)
    const { data, error: uErr } = await ctx.admin.from("portal_appt_requests").update({
      status: "rechazado", reject_reason: reason, rejected_at: now, rejected_by_email: staffEmail,
      staff_notes: withBlockNote(r.staff_notes), updated_at: now,
    }).eq("id", r.id).in("status", [...APPT_REQ_OPEN]).select("id");
    if (uErr) return false;
    if (!data?.length) continue;
    await logEvent(ctx, r.id, "rechazado", staffEmail);
  }
  return true;
}
