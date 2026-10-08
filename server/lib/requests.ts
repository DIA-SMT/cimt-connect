// Portal — pedidos de copia de la historia clínica y bandeja del equipo.
//
// La familia pide la copia desde el portal; el equipo la prepara, avisa que
// está lista y registra a quién se la entregó (en mano, con DNI). El portal
// solo muestra el estado del pedido: nada de la historia clínica sale de acá.
// La bandeja junta esos pedidos con los avisos de "no vamos a poder ir".

import {
  type HcEvent, type HcEventKind, type HcRejectReason, type HcRequestDTO, type HcRow, type HcStaffTarget,
  type NoticeAction, type NoticeResolution, type Outcome, type ReasonCode, type StaffHcRequest, type StaffNotice,
  HC_DAILY_MAX, HC_REJECT_REASONS, HC_TRANSITIONS, NOTICE_ACTIONS,
  canRequestHc, centerNow, computeHcDto, hcVisible, isNoticeOnTime, isValidDni, normalizeDni,
} from "../../src/lib/portalRules";
import { type Account, type ActiveChild, type Ctx, PortalError, accountLinks } from "./portal";

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const DAY_MS = 24 * 60 * 60 * 1000;
const OFFLINE = "No pudimos conectar. Probá de nuevo.";

// Constancia de cada paso. Si no se puede guardar no se frena el pedido,
// pero queda en el log del servidor.
async function logEvent(ctx: Ctx, requestId: string, kind: HcEventKind, byEmail: string | null) {
  const { error } = await ctx.admin.from("portal_hc_request_events").insert({ request_id: requestId, kind, by_email: byEmail });
  if (error) console.error("[portal] no se pudo guardar la constancia del pedido:", kind);
}

// ── Familia ─────────────────────────────────────────────────────────────────

const HC_FAMILY_COLS = "id, patient_id, account_id, status, created_at, updated_at, ready_at, delivered_at, reject_reason";

// Pacientes de los que esta cuenta puede ver sus pedidos: los vínculos con
// derecho a pedir la copia, aunque ya no den acceso al portal (por ejemplo,
// con el alta cargada). child_page dice si su página se puede abrir.
async function hcPatients(ctx: Ctx, account: Account, children: ActiveChild[]) {
  const links = (await accountLinks(ctx, account)).filter((l) => l.hc_ok && l.patient);
  return links.map((l) => {
    const active = children.find((c) => c.patient_id === l.patient_id);
    return {
      patient_id: l.patient_id,
      display: active?.display ?? l.patient!.first_name,
      self: l.self,
      page: !!active,
    };
  });
}

// Pedidos de esta cuenta (abiertos y cerrados recientes)
export async function hcRequestsFor(ctx: Ctx, account: Account, children: ActiveChild[], onlyPatientId?: string): Promise<HcRequestDTO[]> {
  const patients = (await hcPatients(ctx, account, children))
    .filter((p) => !onlyPatientId || p.patient_id === onlyPatientId);
  if (!patients.length) return [];
  const { data, error } = await ctx.admin.from("portal_hc_requests").select(HC_FAMILY_COLS)
    .eq("account_id", account.id).in("patient_id", patients.map((p) => p.patient_id))
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw new PortalError(503, OFFLINE);
  const now = new Date();
  return ((data ?? []) as HcRow[])
    .filter((r) => hcVisible(r, now))
    .map((r) => computeHcDto(r, patients.find((p) => p.patient_id === r.patient_id)!));
}

export async function createHcRequest(ctx: Ctx, account: Account, children: ActiveChild[], patientId: string): Promise<HcRequestDTO> {
  const child = children.find((c) => c.patient_id === patientId);
  if (!child) throw new PortalError(404, "No encontramos a ese chico en tu cuenta.");
  if (!canRequestHc(child.kind)) {
    throw new PortalError(403, "La copia la pueden pedir el propio paciente o su madre, padre o tutor/a. Si necesitás ayuda, llamanos.", { code: "NOT_ALLOWED" });
  }
  const { count, error: cErr } = await ctx.admin.from("portal_hc_requests").select("id", { count: "exact", head: true })
    .eq("account_id", account.id).gte("created_at", new Date(Date.now() - DAY_MS).toISOString());
  if (cErr) throw new PortalError(503, OFFLINE);
  if ((count ?? 0) >= HC_DAILY_MAX) throw new PortalError(429, "Ya hiciste varios pedidos hoy. Si necesitás algo más, llamanos.");

  const { data, error } = await ctx.admin.from("portal_hc_requests").insert({
    patient_id: child.patient_id,
    account_id: account.id,
    link_kind: child.kind,
    requester_name: `${account.first_name} ${account.last_name}`.trim(),
    requester_dni: account.dni,
  }).select(HC_FAMILY_COLS).single();
  if (error?.code === "23505") {
    throw new PortalError(409, "Ya hay un pedido en curso. Te avisamos acá cuando la copia esté lista.", { code: "HC_OPEN" });
  }
  if (error || !data) throw new PortalError(503, "No pudimos guardar tu pedido. Probá de nuevo.");
  await logEvent(ctx, data.id as string, "pedido", null);
  return computeHcDto(data as HcRow, { display: child.display, self: child.self, page: true });
}

export async function cancelHcRequest(ctx: Ctx, account: Account, children: ActiveChild[], id: string): Promise<HcRequestDTO> {
  if (!isUuid(id)) throw new PortalError(404, "No encontramos ese pedido.");
  const { data: row, error: rErr } = await ctx.admin.from("portal_hc_requests").select(HC_FAMILY_COLS).eq("id", id).maybeSingle();
  if (rErr) throw new PortalError(503, OFFLINE);
  const patient = row ? (await hcPatients(ctx, account, children)).find((p) => p.patient_id === row.patient_id) : undefined;
  // Un pedido de otra persona da lo mismo que uno que no existe
  if (!row || row.account_id !== account.id || !patient) throw new PortalError(404, "No encontramos ese pedido.");
  if (row.status !== "pendiente") {
    throw new PortalError(409, row.status === "lista"
      ? "La copia ya está lista. Si ya no la necesitás, avisanos en el centro."
      : "Este pedido ya está cerrado.");
  }
  const now = new Date().toISOString();
  const { data, error } = await ctx.admin.from("portal_hc_requests")
    .update({ status: "cancelada", cancelled_at: now, updated_at: now })
    .eq("id", id).eq("status", "pendiente").select(HC_FAMILY_COLS);
  if (error) throw new PortalError(503, "No pudimos cancelar el pedido. Probá de nuevo.");
  if (!data?.length) throw new PortalError(409, "El equipo ya está resolviendo este pedido. Si ya no lo necesitás, avisanos en el centro.");
  await logEvent(ctx, id, "cancelada", null);
  return computeHcDto(data[0] as HcRow, patient);
}

// ── Equipo: pedidos de copia ────────────────────────────────────────────────

const HC_STAFF_COLS = "id, patient_id, account_id, link_kind, requester_name, requester_dni, status, ready_at, ready_by_email, delivered_at, delivered_by_email, delivered_to_name, delivered_to_dni, rejected_at, rejected_by_email, reject_reason, cancelled_at, staff_notes, created_at, updated_at";

type HcStaffRow = Omit<StaffHcRequest, "patient_name" | "patient_dni" | "still_allowed" | "events"> & { account_id: string | null; updated_at: string };
type NameRow = { id: string; first_name: string; last_name: string; dni?: string | null };

// Para un pedido abierto: ¿quien lo hizo sigue pudiendo pedirla hoy? (por
// ejemplo, el chico cumplió 18 o se quitó al adulto de la ficha). El alta no
// cuenta: no quita el derecho a la copia. null si no se puede saber.
async function stillAllowed(ctx: Ctx, rows: HcStaffRow[]): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  const open = rows.filter((r) => r.status === "pendiente" || r.status === "lista");
  const accountIds = [...new Set(open.map((r) => r.account_id).filter((x): x is string => !!x))];
  const { data: accounts, error } = accountIds.length
    ? await ctx.admin.from("portal_accounts").select("id, dni").in("id", accountIds)
    : { data: [] as { id: string; dni: string }[], error: null };
  const links = new Map<string, Awaited<ReturnType<typeof accountLinks>> | null>();
  if (!error) {
    await Promise.all(((accounts ?? []) as { id: string; dni: string }[]).map(async (a) => {
      links.set(a.id, await accountLinks(ctx, a).catch(() => null));
    }));
  }
  for (const r of rows) {
    if (!open.includes(r) || error) { out.set(r.id, null); continue; }
    // Sin cuenta (se borró): nadie puede pedir por ella
    if (!r.account_id || !links.has(r.account_id)) { out.set(r.id, false); continue; }
    const ls = links.get(r.account_id);
    out.set(r.id, ls ? ls.some((l) => l.patient_id === r.patient_id && l.hc_ok) : null);
  }
  return out;
}

async function toStaffHc(ctx: Ctx, rows: HcStaffRow[]): Promise<StaffHcRequest[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: patients, error: pErr }, { data: events, error: eErr }, allowed] = await Promise.all([
    ctx.admin.from("patients").select("id, first_name, last_name, dni").in("id", [...new Set(rows.map((r) => r.patient_id))]),
    ctx.admin.from("portal_hc_request_events").select("request_id, kind, by_email, created_at")
      .in("request_id", ids).order("created_at", { ascending: true }),
    stillAllowed(ctx, rows),
  ]);
  if (pErr || eErr) throw new PortalError(503, OFFLINE);
  return rows.map((r) => {
    const p = ((patients ?? []) as NameRow[]).find((x) => x.id === r.patient_id);
    const { account_id: _a, updated_at: _u, ...rest } = r;
    return {
      ...rest,
      patient_name: p ? `${p.last_name}, ${p.first_name}` : "Paciente",
      patient_dni: p?.dni ?? null,
      still_allowed: allowed.get(r.id) ?? null,
      events: ((events ?? []) as { request_id: string; kind: HcEvent["kind"]; by_email: string | null; created_at: string }[])
        .filter((e) => e.request_id === r.id)
        .map((e) => ({ kind: e.kind, by_email: e.by_email, at: e.created_at })),
    };
  });
}

// Abiertos (los más viejos primero) y cerrados de los últimos 30 días
export async function staffHcList(ctx: Ctx): Promise<StaffHcRequest[]> {
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const [{ data: open, error: oErr }, { data: closed, error: cErr }] = await Promise.all([
    ctx.admin.from("portal_hc_requests").select(HC_STAFF_COLS)
      .in("status", ["pendiente", "lista"]).order("created_at", { ascending: true }),
    ctx.admin.from("portal_hc_requests").select(HC_STAFF_COLS)
      .in("status", ["entregada", "rechazada", "cancelada"]).gte("updated_at", since)
      .order("updated_at", { ascending: false }).limit(100),
  ]);
  if (oErr || cErr) throw new PortalError(503, OFFLINE);
  return toStaffHc(ctx, [...(open ?? []), ...(closed ?? [])] as HcStaffRow[]);
}

export async function staffHcPendingCount(ctx: Ctx): Promise<number> {
  const { count, error } = await ctx.admin.from("portal_hc_requests").select("id", { count: "exact", head: true }).eq("status", "pendiente");
  if (error) throw new PortalError(503, OFFLINE);
  return count ?? 0;
}

export async function staffHcUpdate(ctx: Ctx, staffEmail: string, body: {
  id?: unknown; to?: unknown; delivered_to_name?: unknown; delivered_to_dni?: unknown; reject_reason?: unknown;
}): Promise<StaffHcRequest> {
  if (!isUuid(body.id)) throw new PortalError(400, "Pedido inválido");
  const { data: row, error: rErr } = await ctx.admin.from("portal_hc_requests").select(HC_STAFF_COLS).eq("id", body.id).maybeSingle();
  if (rErr) throw new PortalError(503, OFFLINE);
  if (!row) throw new PortalError(404, "No encontramos ese pedido.");
  const current = row as HcStaffRow;
  const to = String(body.to) as HcStaffTarget;
  if (!HC_TRANSITIONS[current.status].includes(to)) {
    throw new PortalError(409, "Este pedido ya cambió de estado. Actualizá la bandeja.");
  }

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (to === "lista") {
    patch = { ready_at: now, ready_by_email: staffEmail };
  } else if (to === "pendiente") {
    // La constancia de que estuvo lista queda en portal_hc_request_events
    patch = { ready_at: null, ready_by_email: null };
  } else if (to === "entregada") {
    const name = String(body.delivered_to_name ?? "").replace(/\s+/g, " ").trim();
    const dni = normalizeDni(String(body.delivered_to_dni ?? ""));
    if (name.length < 3 || name.length > 120) throw new PortalError(400, "Escribí el nombre de quien la retiró.");
    if (!isValidDni(dni)) throw new PortalError(400, "Revisá el DNI de quien la retiró.");
    patch = { delivered_at: now, delivered_by_email: staffEmail, delivered_to_name: name, delivered_to_dni: dni };
  } else {
    if (!(HC_REJECT_REASONS as readonly string[]).includes(String(body.reject_reason))) throw new PortalError(400, "Elegí el motivo.");
    patch = { rejected_at: now, rejected_by_email: staffEmail, reject_reason: body.reject_reason as HcRejectReason };
  }

  // Solo si nadie lo cambió mientras tanto
  const { data, error } = await ctx.admin.from("portal_hc_requests")
    .update({ ...patch, status: to, updated_at: now })
    .eq("id", current.id).eq("status", current.status).select(HC_STAFF_COLS);
  if (error) throw new PortalError(503, "No se pudo guardar. Probá de nuevo.");
  if (!data?.length) throw new PortalError(409, "Otra persona del equipo cambió este pedido. Actualizá la bandeja.");
  await logEvent(ctx, current.id, to, staffEmail);
  return (await toStaffHc(ctx, data as HcStaffRow[]))[0];
}

export async function staffHcNotes(ctx: Ctx, staffEmail: string, body: { id?: unknown; notes?: unknown }) {
  if (!isUuid(body.id)) throw new PortalError(400, "Pedido inválido");
  const notes = String(body.notes ?? "").trim();
  if (notes.length > 500) throw new PortalError(400, "Las notas pueden tener hasta 500 caracteres.");
  const { data, error } = await ctx.admin.from("portal_hc_requests")
    .update({ staff_notes: notes || null }).eq("id", body.id).select("id");
  if (error) throw new PortalError(503, "No se pudieron guardar las notas. Probá de nuevo.");
  if (!data?.length) throw new PortalError(404, "No encontramos ese pedido.");
  await logEvent(ctx, body.id, "nota", staffEmail);
  return { ok: true };
}

// ── Equipo: avisos de "no vamos a poder ir" ────────────────────────────────

type RespRow = {
  id: string; appointment_id: string; account_id: string; kind: string; reason_code: ReasonCode | null;
  reason_text: string | null; created_at: string; outcome: Outcome | null;
  resolved_at: string | null; resolved_by_email: string | null;
};
type ApptRow = {
  id: string; patient_id: string; appointment_date: string; appointment_time: string;
  modality: string | null; status: string; professional_id: string | null; attendance: string | null;
};

const RESP_COLS = "id, appointment_id, account_id, kind, reason_code, reason_text, created_at, outcome, resolved_at, resolved_by_email";
const NOTICE_APPT_COLS = "id, patient_id, appointment_date, appointment_time, modality, status, professional_id, attendance";
const NOTICE_DAYS = 90; // avisos que se miran hacia atrás
const RESOLVED_DAYS = 14; // los resueltos se siguen mostrando un tiempo

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await fetch(ids.slice(i, i + 150));
    if (error) throw new PortalError(503, OFFLINE);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

// Cómo quedó el aviso: lo que cargó el equipo, lo que se deduce del turno
// (cancelado, falta justificada, o vinieron igual) o, si alguien del equipo
// ya lo resolvió y después se cambió el turno, se da por visto
function resolutionOf(r: RespRow, a: ApptRow): NoticeResolution | null {
  if (r.outcome) return r.outcome;
  if (a.status === "cancelado") return "cancelado";
  if (a.attendance === "justificado") return "justificado";
  if (a.attendance === "presente") return "asistio";
  return r.resolved_at ? "otro" : null;
}

export async function staffNotices(ctx: Ctx): Promise<StaffNotice[]> {
  const since = new Date(Date.now() - NOTICE_DAYS * DAY_MS).toISOString();
  const { data: resps, error } = await ctx.admin.from("portal_appointment_responses")
    .select(RESP_COLS).gte("created_at", since).order("created_at", { ascending: false }).limit(3000);
  if (error) throw new PortalError(503, OFFLINE);
  // Vale la respuesta más nueva de cada turno (si después confirmaron, ya no es un aviso)
  const newest = new Map<string, RespRow>();
  for (const r of (resps ?? []) as RespRow[]) if (!newest.has(r.appointment_id)) newest.set(r.appointment_id, r);
  const notices = [...newest.values()].filter((r) => r.kind === "no_puedo");
  if (!notices.length) return [];

  const appts = await inChunks<ApptRow>(notices.map((r) => r.appointment_id), (ids) => ctx.admin.from("appointments")
    .select(NOTICE_APPT_COLS).in("id", ids));
  const apptById = new Map(appts.map((a) => [a.id, a]));
  const proIds = [...new Set(appts.map((a) => a.professional_id).filter((x): x is string => !!x))];
  const [patients, pros, accounts] = await Promise.all([
    inChunks<NameRow>([...new Set(appts.map((a) => a.patient_id))], (ids) => ctx.admin.from("patients").select("id, first_name, last_name, dni").in("id", ids)),
    inChunks<{ id: string; name: string }>(proIds, (ids) => ctx.admin.from("professionals").select("id, name").in("id", ids)),
    inChunks<NameRow>([...new Set(notices.map((r) => r.account_id))], (ids) => ctx.admin.from("portal_accounts").select("id, first_name, last_name, dni").in("id", ids)),
  ]);

  const now = centerNow();
  const resolvedSince = Date.now() - RESOLVED_DAYS * DAY_MS;
  const out: StaffNotice[] = [];
  for (const r of notices) {
    const a = apptById.get(r.appointment_id);
    if (!a) continue;
    const resolution = resolutionOf(r, a);
    const time = String(a.appointment_time).slice(0, 5);
    // Los resueltos se ven un tiempo (desde que se resolvieron o, si se
    // deducen del turno, desde el turno)
    if (resolution && Date.parse(r.resolved_at ?? `${a.appointment_date}T${time}:00-03:00`) < resolvedSince) continue;
    const p = patients.find((x) => x.id === a.patient_id);
    const acc = accounts.find((x) => x.id === r.account_id);
    out.push({
      response_id: r.id,
      appointment_id: a.id,
      patient_id: a.patient_id,
      patient_name: p ? `${p.last_name}, ${p.first_name}` : "Paciente",
      date: a.appointment_date,
      time,
      modality: a.modality === "telemedicina" ? "telemedicina" : "presencial",
      professional_name: a.professional_id ? pros.find((x) => x.id === a.professional_id)?.name ?? null : null,
      requester_name: acc ? `${acc.first_name} ${acc.last_name}`.trim() : null,
      is_self: !!acc && !!p && normalizeDni(p.dni ?? "") === acc.dni,
      reason_code: r.reason_code,
      reason_text: r.reason_text,
      at: r.created_at,
      on_time: isNoticeOnTime(r.created_at, a.appointment_date),
      is_past: `${a.appointment_date} ${time}` <= `${now.date} ${now.time}`,
      resolution,
      resolved_at: r.resolved_at,
      resolved_by_email: r.resolved_by_email,
    });
  }
  // Pendientes primero, por fecha del turno; después los resueltos más nuevos
  return out.sort((x, y) => (x.resolution === null) !== (y.resolution === null)
    ? (x.resolution === null ? -1 : 1)
    : x.resolution === null
      ? `${x.date}${x.time}`.localeCompare(`${y.date}${y.time}`)
      : (y.resolved_at ?? y.at).localeCompare(x.resolved_at ?? x.at));
}

async function newestResponseId(ctx: Ctx, appointmentId: string): Promise<string | null> {
  const { data, error } = await ctx.admin.from("portal_appointment_responses")
    .select("id").eq("appointment_id", appointmentId).order("created_at", { ascending: false }).limit(1);
  if (error) throw new PortalError(503, OFFLINE);
  return (data?.[0]?.id as string | undefined) ?? null;
}

export async function staffResolveNotice(ctx: Ctx, staff: { email: string; token: string }, body: { response_id?: unknown; how?: unknown }) {
  if (!isUuid(body.response_id)) throw new PortalError(400, "Pedido inválido");
  const how = String(body.how) as NoticeAction;
  if (!(NOTICE_ACTIONS as readonly string[]).includes(how)) throw new PortalError(400, "Elegí cómo se resolvió.");
  const changesAppt = how === "justificar" || how === "cancelar";

  const { data: r, error: rErr } = await ctx.admin.from("portal_appointment_responses").select(RESP_COLS).eq("id", body.response_id).maybeSingle();
  if (rErr) throw new PortalError(503, OFFLINE);
  if (!r || r.kind !== "no_puedo") throw new PortalError(404, "No encontramos ese aviso.");
  if (await newestResponseId(ctx, r.appointment_id) !== r.id) throw new PortalError(409, "La familia cambió su respuesta. Actualizá la bandeja.");
  const { data: a, error: aErr } = await ctx.admin.from("appointments").select(NOTICE_APPT_COLS).eq("id", r.appointment_id).maybeSingle();
  if (aErr) throw new PortalError(503, OFFLINE);
  if (!a) throw new PortalError(404, "No encontramos el turno de ese aviso.");
  if (resolutionOf(r as RespRow, a as ApptRow)) throw new PortalError(409, "Este aviso ya está resuelto. Actualizá la bandeja.");
  const now = centerNow();
  if (how === "cancelar" && `${a.appointment_date} ${String(a.appointment_time).slice(0, 5)}` <= `${now.date} ${now.time}`) {
    throw new PortalError(409, "El turno ya pasó: no se puede cancelar. Usá «Justificar la falta» o «Tomamos nota».");
  }

  // 1. Se reserva el aviso: si dos personas lo resuelven a la vez, gana una
  const at = new Date().toISOString();
  const { data: claimed, error: cErr } = await ctx.admin.from("portal_appointment_responses").update({
    outcome: how === "reprogramar" ? "reprogramado" : how === "visto" ? "otro" : null,
    resolved_at: at,
    resolved_by_email: staff.email,
  }).eq("id", r.id).is("resolved_at", null).is("outcome", null).select("id");
  if (cErr) throw new PortalError(503, "No se pudo marcar el aviso. Probá de nuevo.");
  if (!claimed?.length) throw new PortalError(409, "Otra persona del equipo ya resolvió este aviso. Actualizá la bandeja.");
  const release = async () => {
    await ctx.admin.from("portal_appointment_responses")
      .update({ outcome: null, resolved_at: null, resolved_by_email: null })
      .eq("id", r.id).eq("resolved_at", at);
  };

  // 2. Si la familia cambió su respuesta mientras tanto, no se toca nada
  if (await newestResponseId(ctx, r.appointment_id) !== r.id) {
    await release();
    throw new PortalError(409, "La familia cambió su respuesta. Actualizá la bandeja.");
  }

  // 3. Justificar o cancelar cambia el turno, con la sesión de quien resuelve
  //    (rige RLS y el historial de la ficha registra su email). Solo si el
  //    turno sigue sin cancelar y sin asistencia (o con "ausente").
  if (changesAppt) {
    const { data, error } = await ctx.asUser(staff.token).from("appointments")
      .update(how === "cancelar" ? { status: "cancelado" } : { attendance: "justificado" })
      .eq("id", a.id).neq("status", "cancelado").or("attendance.is.null,attendance.eq.ausente")
      .select("id");
    if (error || !data?.length) {
      await release();
      throw error
        ? new PortalError(503, "No se pudo actualizar el turno. Probá de nuevo.")
        : new PortalError(409, "El turno cambió (ya tiene asistencia cargada o está cancelado). Actualizá la bandeja.");
    }
  }
  return { ok: true };
}
