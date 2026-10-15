// Portal — pedidos de copia de la historia clínica y bandeja del equipo.
//
// La familia pide la copia desde el portal; el equipo la prepara, avisa que
// está lista y registra a quién se la entregó (en mano, con DNI). El portal
// solo muestra el estado del pedido: nada de la historia clínica sale de acá.
// Con la etapa "hc_digital" (E1) la familia también puede pedir recibirla en
// el portal: los PDF, su envío y la descarga están en server/lib/hcDocuments.ts.
// La bandeja junta esos pedidos con los avisos de "no vamos a poder ir".

import { HC_BUCKET, HC_DIGITAL_BLOCKED_STAFF, hcDocLabel, hcDocPathOk } from "../../src/lib/hcDigitalRules";
import {
  type ClinicalBlock, type PortalSettings, type PublicOutcome, CLINICAL_NOTICE_VERSION, clinicalAccess, publicOutcome,
} from "../../src/lib/portalClinicalRules";
import { verificationCode } from "../../src/lib/portalInfoRules";
import {
  type HcChannel, type HcDigitalBlock, type HcDocumentDTO, type HcEvent, type HcEventKind, type HcRejectReason,
  type HcRequestDTO, type HcRow, type HcStaffTarget, type NoticeAction, type NoticeResolution, type Outcome,
  type ReasonCode, type StaffHcDocument, type StaffHcRequest, type StaffNotice,
  HC_DAILY_MAX, HC_REJECT_REASONS, HC_TRANSITIONS, NOTICE_ACTIONS,
  ageOn, canRequestHc, centerNow, computeHcDto, hcVisible, isNoticeOnTime, isValidDni, normalizeDni,
} from "../../src/lib/portalRules";
import { type Account, type ActiveChild, type Ctx, PortalError, accountLinks, missingTable } from "./portal";
import { digitalReady, e1Columns } from "./portalClinical";

// Viven en portalClinical.ts (con las etapas); se siguen ofreciendo desde acá
export { digitalReady, e1Columns, resetE1Columns } from "./portalClinical";

const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const DAY_MS = 24 * 60 * 60 * 1000;
const OFFLINE = "No pudimos conectar. Probá de nuevo.";

// Constancia de cada paso. Si no se puede guardar no se frena el pedido,
// pero queda en el log del servidor.
export async function logEvent(ctx: Ctx, requestId: string, kind: HcEventKind, byEmail: string | null) {
  const { error } = await ctx.admin.from("portal_hc_request_events").insert({ request_id: requestId, kind, by_email: byEmail });
  if (error) console.error("[portal] no se pudo guardar la constancia del pedido:", kind);
}

// ── Copia digital (E1): columnas, PDF y quién puede recibirla ───────────────
// Las columnas channel, sent_at y sent_by_email (y la tabla de PDF y el
// bucket) las crea el script 25. Se leen siempre que existan, aunque la etapa
// esté apagada: un pedido que ya se envió por el portal sigue mostrando cómo
// y cuándo se envió. Los PDF, la descarga y los pedidos nuevos "en el portal"
// van solo con la etapa prendida y el script corrido (digitalReady). Sin el
// script, todo funciona como antes: la copia se entrega en mano. Si ya se
// corrió el script lo dice e1Columns (en portalClinical.ts).

const E1_FAMILY_COLS = ", channel, sent_at";
const E1_STAFF_COLS = ", channel, sent_at, sent_by_email";

// PDF enviados (no quitados) de cada pedido, en el orden en que se subieron
export async function publishedDocs(ctx: Ctx, requestIds: string[]): Promise<Map<string, { id: string }[]>> {
  const out = new Map<string, { id: string }[]>();
  if (!requestIds.length) return out;
  const { data, error } = await ctx.admin.from("portal_hc_documents").select("id, request_id")
    .in("request_id", requestIds).not("published_at", "is", null).is("removed_at", null)
    .order("uploaded_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new PortalError(503, OFFLINE);
  for (const d of (data ?? []) as { id: string; request_id: string }[]) {
    out.set(d.request_id, [...(out.get(d.request_id) ?? []), { id: d.id }]);
  }
  return out;
}

// Lo que ve la familia de los PDF de sus copias enviadas
async function familyDocs(ctx: Ctx, rows: HcRow[]): Promise<Map<string, HcDocumentDTO[]>> {
  const out = new Map<string, HcDocumentDTO[]>();
  const sent = rows.filter((r) => r.status === "enviada").map((r) => r.id);
  if (!sent.length || !(await digitalReady(ctx))) return out;
  for (const [requestId, docs] of await publishedDocs(ctx, sent)) {
    out.set(requestId, docs.map((d, i) => ({ id: d.id, label: hcDocLabel(i, docs.length), code: verificationCode(d.id) })));
  }
  return out;
}

// Los PDF de cada pedido que no se quitaron (para el equipo)
async function staffDocs(ctx: Ctx, requestIds: string[]): Promise<Map<string, StaffHcDocument[]>> {
  const out = new Map<string, StaffHcDocument[]>();
  if (!requestIds.length || !(await digitalReady(ctx))) return out;
  const { data, error } = await ctx.admin.from("portal_hc_documents")
    .select("id, request_id, file_name, size_bytes, sha256, uploaded_by_email, uploaded_at")
    .in("request_id", requestIds).is("removed_at", null)
    .order("uploaded_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new PortalError(503, OFFLINE);
  for (const d of (data ?? []) as (Omit<StaffHcDocument, "code"> & { request_id: string })[]) {
    const { request_id, ...doc } = d;
    out.set(request_id, [...(out.get(request_id) ?? []), { ...doc, code: verificationCode(d.id) }]);
  }
  return out;
}

// Al cerrar un pedido sin enviarlo por el portal (entregada en mano,
// rechazada o cancelada por la familia), los PDF que no se enviaron se marcan
// como quitados y se borran del bucket, junto con las subidas que no llegaron
// a registrarse. Si algo falla no se frena el cierre: queda en el log del
// servidor. Sin el script 25 no hay nada que quitar.
export async function discardDrafts(ctx: Ctx, requestId: string, byEmail: string) {
  const { data, error } = await ctx.admin.from("portal_hc_documents")
    .update({ removed_at: new Date().toISOString(), removed_by_email: byEmail })
    .eq("request_id", requestId).is("published_at", null).is("removed_at", null)
    .select("storage_path");
  if (error) {
    if (!missingTable(error)) console.error("[portal] no se pudieron quitar los PDF de un pedido cerrado");
    return;
  }
  await removeObjects(ctx, ((data ?? []) as { storage_path: string }[]).map((d) => d.storage_path));
  await sweepOrphans(ctx, requestId, { closed: true });
}

// Borra archivos del bucket (lo que quede queda en el log del servidor)
export async function removeObjects(ctx: Ctx, paths: string[]) {
  if (!paths.length) return;
  const { error } = await ctx.admin.storage.from(HC_BUCKET).remove(paths);
  if (error) console.error("[portal] no se pudieron borrar", paths.length, "PDF del almacenamiento");
}

// Lo que dura el enlace para subir un PDF (createSignedUploadUrl)
export const UPLOAD_TOKEN_MS = 2 * 60 * 60 * 1000;

// Archivos sueltos de la carpeta de un pedido (hc/{pedido}/): subidas que no
// llegaron a registrarse (se cortó la conexión, se cerró el panel…) y PDF
// quitados cuyo archivo no se pudo borrar en su momento. Lo que no tiene fila
// en portal_hc_documents se borra recién cuando venció el enlace de subida
// (2 horas), para no pisar una subida en curso; con el pedido cerrado
// (closed) se borra ya: un registro que llegue tarde se rechaza igual. Nunca
// frena nada: si falla, queda en el log del servidor.
export async function sweepOrphans(ctx: Ctx, requestId: string, opts: { closed?: boolean } = {}) {
  try {
    const folder = `hc/${requestId}`;
    const { data: objects, error } = await ctx.admin.storage.from(HC_BUCKET)
      .list(folder, { limit: 1000, sortBy: { column: "created_at", order: "asc" } });
    if (error) {
      console.error("[portal] no se pudo revisar la carpeta de un pedido de copia:", requestId);
      return;
    }
    const files = ((objects ?? []) as { name: string; id: string | null; created_at?: string | null; updated_at?: string | null }[])
      .map((o) => ({ ...o, path: `${folder}/${o.name}` }))
      .filter((o) => o.id && hcDocPathOk(o.path, requestId));
    if (!files.length) return;
    const { data: rows, error: rErr } = await ctx.admin.from("portal_hc_documents")
      .select("storage_path, removed_at").in("storage_path", files.map((f) => f.path));
    if (rErr) {
      if (!missingTable(rErr)) console.error("[portal] no se pudo revisar la carpeta de un pedido de copia:", requestId);
      return;
    }
    const known = new Map(((rows ?? []) as { storage_path: string; removed_at: string | null }[])
      .map((r) => [r.storage_path, r.removed_at]));
    const oldBefore = Date.now() - UPLOAD_TOKEN_MS;
    const loose = files.filter((f) => {
      if (known.has(f.path)) return known.get(f.path) !== null; // quitado: el archivo ya no va
      if (opts.closed) return true;
      const at = Date.parse(f.created_at ?? f.updated_at ?? "");
      return Number.isFinite(at) && at < oldBefore;
    });
    if (loose.length) {
      console.warn("[portal] se borran", loose.length, "archivos sueltos de un pedido de copia:", requestId);
      await removeObjects(ctx, loose.map((f) => f.path));
    }
  } catch {
    console.error("[portal] no se pudo revisar la carpeta de un pedido de copia:", requestId);
  }
}

// ¿Puede esta cuenta recibir la copia de este paciente por el portal? Es la
// regla de la información de salud para el área "hc": vínculo con derecho a
// la copia, verificado en persona (madre, padre o tutor/a: también la
// documentación), la información de salud activada y el portal del paciente
// sin pausa ("Pausar todo lo clínico": con la pausa la copia se entrega en
// mano). La contraseña se pide aparte, al descargar.

type GateLink = { id: string; patient_id: string; kind: string; valid: boolean; hc_ok: boolean };
type LinkChecks = Map<string, { verified: boolean; parental: boolean }>;

// Lo lee el equipo cuando el portal del paciente está en pausa
export const HC_DIGITAL_PAUSED_STAFF = "El portal de este paciente está en pausa: entregala en mano.";

// Configuración del portal de cada paciente (script 22). Para la copia
// digital solo cuenta la pausa. Sin la tabla, ningún paciente está en pausa.
const GATE_SETTINGS_COLS = "patient_id, info_enabled, practice_enabled, paused_at, adolescent_agreed_on, adolescent_withdrawn_on";

async function gateSettings(ctx: Ctx, patientIds: string[]): Promise<Map<string, PortalSettings>> {
  const out = new Map<string, PortalSettings>();
  const ids = [...new Set(patientIds)];
  if (!ids.length) return out;
  const { data, error } = await ctx.admin.from("patient_portal_settings").select(GATE_SETTINGS_COLS).in("patient_id", ids);
  if (error) {
    if (missingTable(error)) return out;
    throw new PortalError(503, OFFLINE);
  }
  for (const s of (data ?? []) as (PortalSettings & { patient_id: string })[]) out.set(s.patient_id, s);
  return out;
}

async function patientSettings(ctx: Ctx, patientId: string): Promise<PortalSettings | null> {
  return (await gateSettings(ctx, [patientId])).get(patientId) ?? null;
}

async function linkChecks(ctx: Ctx, linkIds: string[]): Promise<LinkChecks> {
  const out: LinkChecks = new Map();
  if (!linkIds.length) return out;
  const { data, error } = await ctx.admin.from("portal_links")
    .select("id, verified_in_person_on, parental_checked_on").in("id", linkIds);
  if (error) throw new PortalError(503, OFFLINE);
  for (const l of (data ?? []) as { id: string; verified_in_person_on: string | null; parental_checked_on: string | null }[]) {
    out.set(l.id, { verified: !!l.verified_in_person_on, parental: !!l.parental_checked_on });
  }
  return out;
}

// Cuentas que tienen activada la información de salud: lo último que
// hicieron fue aceptar el aviso vigente (misma regla que portalClinical.ts)
async function activeConsents(ctx: Ctx, accountIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!accountIds.length) return out;
  const { data, error } = await ctx.admin.from("portal_consents").select("account_id, accepted, version, created_at")
    .eq("kind", "informacion_clinica").in("account_id", accountIds).order("created_at", { ascending: false });
  if (error) throw new PortalError(503, OFFLINE);
  const seen = new Set<string>();
  for (const c of (data ?? []) as { account_id: string; accepted: boolean; version: string }[]) {
    if (seen.has(c.account_id)) continue;
    seen.add(c.account_id);
    if (c.accepted && c.version === CLINICAL_NOTICE_VERSION) out.add(c.account_id);
  }
  return out;
}

const GATE_ORDER: PublicOutcome[] = ["ok", "consent", "verify", "not_available"];

export type HcGateResult = { ok: true } | { ok: false; block: ClinicalBlock };

// links: los vínculos de la cuenta con ese paciente; settings: la
// configuración del portal de ese paciente (null si no tiene). Vale el
// vínculo que mejor sale (en el orden de lo que ve la familia).
function gateResult(links: GateLink[], checks: LinkChecks, consent: boolean, settings: PortalSettings | null): HcGateResult {
  let best: HcGateResult | null = null;
  for (const l of links) {
    const c = checks.get(l.id);
    const r = clinicalAccess({
      link_kind: l.kind, link_valid: l.valid, hc_ok: l.hc_ok, age: null,
      verified_in_person: !!c?.verified, parental_checked: !!c?.parental,
      settings, clinical_consent: consent, blocked: false,
    }, "hc");
    if (!best || GATE_ORDER.indexOf(publicOutcome(r)) < GATE_ORDER.indexOf(publicOutcome(best))) best = r;
  }
  return best ?? { ok: false, block: "sin_vinculo" };
}

// Con el motivo interno (solo para el servidor: a la familia nunca le llega).
// settings: la configuración del paciente si ya se leyó (si no, se lee acá)
export async function hcDigitalAccess(
  ctx: Ctx, account: Pick<Account, "id" | "dni">, patientId: string, settings?: PortalSettings | null,
): Promise<HcGateResult> {
  const links = (await accountLinks(ctx, account)).filter((l) => l.patient_id === patientId);
  if (!links.some((l) => l.hc_ok)) return { ok: false, block: "sin_vinculo" };
  const [checks, consents, s] = await Promise.all([
    linkChecks(ctx, links.map((l) => l.id)),
    activeConsents(ctx, [account.id]),
    settings === undefined ? patientSettings(ctx, patientId) : Promise.resolve(settings),
  ]);
  return gateResult(links, checks, consents.has(account.id), s);
}

export async function hcDigitalGate(
  ctx: Ctx, account: Pick<Account, "id" | "dni">, patientId: string, settings?: PortalSettings | null,
): Promise<PublicOutcome> {
  return publicOutcome(await hcDigitalAccess(ctx, account, patientId, settings));
}

// Para la página del chico: si se ofrece recibirla en el portal y, si no se
// puede, por qué (lo que ve la familia: activar, verificar o "no disponible",
// que es también lo que ve con el portal del paciente en pausa)
export async function hcDigitalOffer(ctx: Ctx, account: Account, child: ActiveChild): Promise<{ offered: boolean; blocked: HcDigitalBlock | null }> {
  if (!(await digitalReady(ctx))) return { offered: false, blocked: null };
  if (!canRequestHc(child.kind)) return { offered: true, blocked: "not_available" };
  const gate = await hcDigitalGate(ctx, account, child.patient_id);
  return { offered: true, blocked: gate === "ok" ? null : gate };
}

// Antes de subir o enviar PDF: null si la cuenta que hizo el pedido (activa)
// puede recibirlo hoy por el portal; si no, lo que se le dice al equipo. La
// pausa va primero: con el portal del paciente en pausa la copia se entrega
// en mano, la haya pedido quien la haya pedido.
export async function requesterDigitalBlock(ctx: Ctx, r: { account_id: string | null; patient_id: string }): Promise<string | null> {
  const settings = await patientSettings(ctx, r.patient_id);
  if (settings?.paused_at) return HC_DIGITAL_PAUSED_STAFF;
  if (!r.account_id) return HC_DIGITAL_BLOCKED_STAFF;
  const { data: acc, error } = await ctx.admin.from("portal_accounts").select("id, dni, active").eq("id", r.account_id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!acc?.active) return HC_DIGITAL_BLOCKED_STAFF;
  const gate = await hcDigitalGate(ctx, acc as { id: string; dni: string }, r.patient_id, settings);
  return gate === "ok" ? null : HC_DIGITAL_BLOCKED_STAFF;
}

const DIGITAL_BLOCKED_TEXT: Record<HcDigitalBlock, string> = {
  consent: "Para recibirla en el portal, primero activá la información de salud.",
  verify: "Para recibirla en el portal, primero pasá por el centro con tu DNI para verificar el vínculo. Mientras tanto, podés pedirla para retirar en el centro.",
  not_available: "Por ahora no se puede recibir por el portal. Podés pedirla para retirar en el centro.",
};

// A madre, padre o tutor/a (representante legal), además del DNI se le pide
// lo que acredita el vínculo
export const PARENTAL_PROOF = "Si sos mamá, papá o tutor/a, traé también la partida o el documento que lo acredite.";
export const isParentKind = (kind: string | null | undefined) => kind === "representante_legal";

// Por qué no se puede pedir "en el portal" (409 DIGITAL_BLOCKED)
export function digitalBlockedText(gate: HcDigitalBlock, linkKind: string | null | undefined): string {
  if (gate !== "verify" || !isParentKind(linkKind)) return DIGITAL_BLOCKED_TEXT[gate];
  return "Para recibirla en el portal, primero pasá por el centro con tu DNI para verificar el vínculo. "
    + `${PARENTAL_PROOF} Mientras tanto, podés pedirla para retirar en el centro.`;
}

// ── Familia ─────────────────────────────────────────────────────────────────

// rejected_at y cancelled_at (del script 20) solo sirven para calcular cuándo
// se cerró el pedido (closed_at): a la familia no le llegan como tales
const HC_FAMILY_COLS = "id, patient_id, account_id, status, created_at, updated_at, ready_at, delivered_at, reject_reason, rejected_at, cancelled_at";
const familyCols = async (ctx: Ctx) => ((await e1Columns(ctx)) ? HC_FAMILY_COLS + E1_FAMILY_COLS : HC_FAMILY_COLS);

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

// Pedidos de esta cuenta (abiertos y cerrados recientes). Cuáles se ven
// enteros y cuáles plegados lo decide el portal (splitHcRequests)
export async function hcRequestsFor(ctx: Ctx, account: Account, children: ActiveChild[], onlyPatientId?: string): Promise<HcRequestDTO[]> {
  const patients = (await hcPatients(ctx, account, children))
    .filter((p) => !onlyPatientId || p.patient_id === onlyPatientId);
  if (!patients.length) return [];
  const { data, error } = await ctx.admin.from("portal_hc_requests").select(await familyCols(ctx))
    .eq("account_id", account.id).in("patient_id", patients.map((p) => p.patient_id))
    .order("created_at", { ascending: false }).limit(50);
  if (error) throw new PortalError(503, OFFLINE);
  const now = new Date();
  const rows = ((data ?? []) as unknown as HcRow[]).filter((r) => hcVisible(r, now));
  const docs = await familyDocs(ctx, rows);
  return rows.map((r) => computeHcDto(r, patients.find((p) => p.patient_id === r.patient_id)!, docs.get(r.id) ?? [], now));
}

// channel "portal" (copia digital): solo con la copia digital disponible y si
// la cuenta ya puede recibirla (información de salud activada, vínculo
// verificado y el portal del paciente sin pausa). En mano se puede pedir
// siempre: la copia es un derecho.
export async function createHcRequest(
  ctx: Ctx, account: Account, children: ActiveChild[], patientId: string, channel: HcChannel = "mano",
): Promise<HcRequestDTO> {
  const child = children.find((c) => c.patient_id === patientId);
  if (!child) throw new PortalError(404, "No encontramos a ese chico en tu cuenta.");
  if (!canRequestHc(child.kind)) {
    throw new PortalError(403, "La copia la pueden pedir el propio paciente o su madre, padre o tutor/a. Si necesitás ayuda, llamanos.", { code: "NOT_ALLOWED" });
  }
  if (channel === "portal") {
    const gate = (await digitalReady(ctx)) ? await hcDigitalGate(ctx, account, child.patient_id) : "not_available";
    if (gate !== "ok") throw new PortalError(409, digitalBlockedText(gate, child.kind), { code: "DIGITAL_BLOCKED" });
  }
  const cols = await familyCols(ctx);
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
    // "mano" es el valor por defecto de la columna (y, sin el script 25, no hay columna)
    ...(channel === "portal" ? { channel } : {}),
  }).select(cols).single();
  if (error?.code === "23505") {
    throw new PortalError(409, "Ya hay un pedido en curso. Te avisamos acá cuando la copia esté lista.", { code: "HC_OPEN" });
  }
  if (error || !data) throw new PortalError(503, "No pudimos guardar tu pedido. Probá de nuevo.");
  const row = data as unknown as HcRow;
  await logEvent(ctx, row.id, "pedido", null);
  return computeHcDto(row, { display: child.display, self: child.self, page: true });
}

export async function cancelHcRequest(ctx: Ctx, account: Account, children: ActiveChild[], id: string): Promise<HcRequestDTO> {
  if (!isUuid(id)) throw new PortalError(404, "No encontramos ese pedido.");
  const cols = await familyCols(ctx);
  const { data: found, error: rErr } = await ctx.admin.from("portal_hc_requests").select(cols).eq("id", id).maybeSingle();
  if (rErr) throw new PortalError(503, OFFLINE);
  const row = found as unknown as (HcRow & { account_id: string | null }) | null;
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
    .eq("id", id).eq("status", "pendiente").select(cols);
  if (error) throw new PortalError(503, "No pudimos cancelar el pedido. Probá de nuevo.");
  if (!data?.length) throw new PortalError(409, "El equipo ya está resolviendo este pedido. Si ya no lo necesitás, avisanos en el centro.");
  await logEvent(ctx, id, "cancelada", null);
  // Si el equipo ya había subido PDF para enviarla por el portal, se quitan
  await discardDrafts(ctx, id, "familia");
  return computeHcDto(data[0] as unknown as HcRow, patient);
}

// ── Equipo: pedidos de copia ────────────────────────────────────────────────

const HC_STAFF_COLS = "id, patient_id, account_id, link_kind, requester_name, requester_dni, status, ready_at, ready_by_email, delivered_at, delivered_by_email, delivered_to_name, delivered_to_dni, rejected_at, rejected_by_email, reject_reason, cancelled_at, staff_notes, created_at, updated_at";

const staffCols = async (ctx: Ctx) => ((await e1Columns(ctx)) ? HC_STAFF_COLS + E1_STAFF_COLS : HC_STAFF_COLS);

// Columnas de la copia digital: sin el script 25 no vienen (se toma "mano")
type E1Fields = "channel" | "sent_at" | "sent_by_email" | "documents" | "digital_ok" | "patient_age";
export type HcStaffRow = Omit<StaffHcRequest, "patient_name" | "patient_dni" | "still_allowed" | "events" | E1Fields> & {
  account_id: string | null; updated_at: string;
  channel?: HcChannel | null; sent_at?: string | null; sent_by_email?: string | null;
};
type NameRow = { id: string; first_name: string; last_name: string; dni?: string | null; birth_date?: string | null };

// Un pedido tal como está en la base (para la bandeja y la copia digital)
export async function loadStaffHcRow(ctx: Ctx, id: string): Promise<HcStaffRow> {
  const { data, error } = await ctx.admin.from("portal_hc_requests").select(await staffCols(ctx)).eq("id", id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!data) throw new PortalError(404, "No encontramos ese pedido.");
  return data as unknown as HcStaffRow;
}

// Lo que ve el panel de un pedido ya leído
export async function staffHcFromRow(ctx: Ctx, row: HcStaffRow): Promise<StaffHcRequest> {
  return (await toStaffHc(ctx, [row]))[0];
}

export async function staffHcById(ctx: Ctx, id: string): Promise<StaffHcRequest> {
  return staffHcFromRow(ctx, await loadStaffHcRow(ctx, id));
}

type Requester = { still_allowed: boolean | null; digital_ok: boolean | null };

// Para un pedido abierto: ¿quien lo hizo sigue pudiendo pedirla hoy? (por
// ejemplo, el chico cumplió 18 o se quitó al adulto de la ficha). El alta no
// cuenta: no quita el derecho a la copia. Y, con la copia digital, ¿puede
// recibirla por el portal? (cuenta activa, información de salud activada,
// vínculo verificado y el portal del paciente sin pausa). null si no se puede
// saber (o no hay cuenta).
async function requesterStatus(ctx: Ctx, rows: HcStaffRow[]): Promise<Map<string, Requester>> {
  const out = new Map<string, Requester>();
  const open = rows.filter((r) => r.status === "pendiente" || r.status === "lista");
  const accountIds = [...new Set(open.map((r) => r.account_id).filter((x): x is string => !!x))];
  const { data: accounts, error } = accountIds.length
    ? await ctx.admin.from("portal_accounts").select("id, dni, active").in("id", accountIds)
    : { data: [] as { id: string; dni: string; active: boolean }[], error: null };
  const accountRows = (accounts ?? []) as { id: string; dni: string; active: boolean }[];
  const links = new Map<string, GateLink[] | null>();
  if (!error) {
    await Promise.all(accountRows.map(async (a) => {
      links.set(a.id, await accountLinks(ctx, a).catch(() => null));
    }));
  }
  // Copia digital: verificación de los vínculos, consentimiento de cada
  // cuenta y pausa de cada paciente
  let digital = !error && (await digitalReady(ctx).catch(() => false));
  let checks: LinkChecks = new Map();
  let consents = new Set<string>();
  let settings = new Map<string, PortalSettings>();
  if (digital) {
    const linkIds = [...links.values()].flatMap((ls) => ls ?? [])
      .filter((l) => open.some((r) => r.patient_id === l.patient_id)).map((l) => l.id);
    try {
      [checks, consents, settings] = await Promise.all([
        linkChecks(ctx, linkIds), activeConsents(ctx, [...links.keys()]), gateSettings(ctx, open.map((r) => r.patient_id)),
      ]);
    } catch {
      digital = false;
    }
  }
  for (const r of rows) {
    if (!open.includes(r) || error) { out.set(r.id, { still_allowed: null, digital_ok: null }); continue; }
    // Sin cuenta (se borró): nadie puede pedir por ella
    if (!r.account_id || !links.has(r.account_id)) { out.set(r.id, { still_allowed: false, digital_ok: null }); continue; }
    const ls = links.get(r.account_id);
    if (!ls) { out.set(r.id, { still_allowed: null, digital_ok: null }); continue; }
    const mine = ls.filter((l) => l.patient_id === r.patient_id);
    const active = accountRows.find((a) => a.id === r.account_id)?.active === true;
    out.set(r.id, {
      still_allowed: mine.some((l) => l.hc_ok),
      digital_ok: digital
        ? active && gateResult(mine, checks, consents.has(r.account_id), settings.get(r.patient_id) ?? null).ok
        : null,
    });
  }
  return out;
}

async function toStaffHc(ctx: Ctx, rows: HcStaffRow[]): Promise<StaffHcRequest[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: patients, error: pErr }, { data: events, error: eErr }, requester, docs] = await Promise.all([
    ctx.admin.from("patients").select("id, first_name, last_name, dni, birth_date").in("id", [...new Set(rows.map((r) => r.patient_id))]),
    ctx.admin.from("portal_hc_request_events").select("request_id, kind, by_email, created_at")
      .in("request_id", ids).order("created_at", { ascending: true }),
    requesterStatus(ctx, rows),
    staffDocs(ctx, ids),
  ]);
  if (pErr || eErr) throw new PortalError(503, OFFLINE);
  const today = centerNow().date;
  return rows.map((r) => {
    const p = ((patients ?? []) as NameRow[]).find((x) => x.id === r.patient_id);
    const { account_id: _a, updated_at: _u, channel, sent_at, sent_by_email, ...rest } = r;
    const who = requester.get(r.id);
    return {
      ...rest,
      patient_name: p ? `${p.last_name}, ${p.first_name}` : "Paciente",
      patient_dni: p?.dni ?? null,
      still_allowed: who?.still_allowed ?? null,
      events: ((events ?? []) as { request_id: string; kind: HcEvent["kind"]; by_email: string | null; created_at: string }[])
        .filter((e) => e.request_id === r.id)
        .map((e) => ({ kind: e.kind, by_email: e.by_email, at: e.created_at })),
      channel: channel ?? "mano",
      sent_at: sent_at ?? null,
      sent_by_email: sent_by_email ?? null,
      documents: docs.get(r.id) ?? [],
      digital_ok: who?.digital_ok ?? null,
      patient_age: p?.birth_date ? ageOn(p.birth_date, today) : null,
    };
  });
}

// Abiertos (los más viejos primero) y cerrados de los últimos 30 días
export async function staffHcList(ctx: Ctx): Promise<StaffHcRequest[]> {
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const cols = await staffCols(ctx);
  const [{ data: open, error: oErr }, { data: closed, error: cErr }] = await Promise.all([
    ctx.admin.from("portal_hc_requests").select(cols)
      .in("status", ["pendiente", "lista"]).order("created_at", { ascending: true }),
    ctx.admin.from("portal_hc_requests").select(cols)
      .in("status", ["entregada", "enviada", "rechazada", "cancelada"]).gte("updated_at", since)
      .order("updated_at", { ascending: false }).limit(100),
  ]);
  if (oErr || cErr) throw new PortalError(503, OFFLINE);
  const closedRows = (closed ?? []) as unknown as HcStaffRow[];
  // De paso se revisan las carpetas de algunos pedidos recién cerrados (no
  // frena ni hace fallar la bandeja)
  const [list] = await Promise.all([
    toStaffHc(ctx, [...((open ?? []) as unknown as HcStaffRow[]), ...closedRows]),
    sweepLateUploads(ctx, closedRows),
  ]);
  return list;
}

// Cuánto después del cierre puede llegar una subida (el enlace, con margen),
// cuántos pedidos cerrados se revisan por vez y cuándo se revisó cada uno
const LATE_UPLOAD_MS = UPLOAD_TOKEN_MS + 30 * 60 * 1000;
const LATE_SWEEP_PER_LIST = 3;
const lateSwept = new Map<string, number>();

// Subidas que llegan tarde a un pedido ya cerrado: un enlace de subida
// pedido antes del cierre sirve 2 horas, y si el panel no llega a registrar
// el PDF, el archivo queda suelto en la carpeta del pedido. Con cada bandeja
// se revisan unos pocos pedidos "en el portal" cerrados en las últimas 2
// horas y media (primero los que hace más que no se revisan). Nunca falla:
// sweepOrphans no tira errores, y si algo falla igual se ignora.
async function sweepLateUploads(ctx: Ctx, closed: HcStaffRow[]) {
  try {
    const now = Date.now();
    for (const [id, at] of lateSwept) if (now - at > LATE_UPLOAD_MS) lateSwept.delete(id);
    const picks = closed
      .filter((r) => r.channel === "portal" && now - Date.parse(r.updated_at) <= LATE_UPLOAD_MS)
      .sort((a, b) => (lateSwept.get(a.id) ?? 0) - (lateSwept.get(b.id) ?? 0))
      .slice(0, LATE_SWEEP_PER_LIST);
    for (const r of picks) lateSwept.set(r.id, now);
    await Promise.all(picks.map((r) => sweepOrphans(ctx, r.id, { closed: true })));
  } catch {
    console.error("[portal] no se pudieron revisar las carpetas de los pedidos cerrados");
  }
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
  const current = await loadStaffHcRow(ctx, body.id);
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
    .eq("id", current.id).eq("status", current.status).select(await staffCols(ctx));
  if (error) throw new PortalError(503, "No se pudo guardar. Probá de nuevo.");
  if (!data?.length) throw new PortalError(409, "Otra persona del equipo cambió este pedido. Actualizá la bandeja.");
  await logEvent(ctx, current.id, to, staffEmail);
  // Cerrado sin enviarlo por el portal: los PDF que se habían subido se quitan
  if (to === "entregada" || to === "rechazada") await discardDrafts(ctx, current.id, staffEmail);
  return (await toStaffHc(ctx, data as unknown as HcStaffRow[]))[0];
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

// Cómo quedó el aviso: lo que cargó el equipo o lo que se deduce del turno
// (cancelado, falta justificada, o vinieron igual). Si el turno no cambió,
// sigue pendiente aunque alguien lo haya intentado resolver (por ejemplo, se
// cortó la conexión antes de cambiar el turno): así se puede reintentar.
function resolutionOf(r: RespRow, a: ApptRow): NoticeResolution | null {
  if (r.outcome) return r.outcome;
  if (a.status === "cancelado") return "cancelado";
  if (a.attendance === "justificado") return "justificado";
  if (a.attendance === "presente") return "asistio";
  return null;
}

// withVisibility: calcula si la familia todavía ve cada turno pendiente
// (consulta los vínculos de cada cuenta; el número de la pestaña no lo necesita)
export async function staffNotices(ctx: Ctx, withVisibility = false): Promise<StaffNotice[]> {
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
    inChunks<NameRow & { active: boolean }>([...new Set(notices.map((r) => r.account_id))], (ids) => ctx.admin.from("portal_accounts").select("id, first_name, last_name, dni, active").in("id", ids)),
  ]);

  const now = centerNow();
  // ¿La cuenta que avisó todavía ve a ese paciente en el portal?
  const visible = new Map<string, Set<string>>(); // cuenta → pacientes que ve
  if (withVisibility) {
    const pendingAccounts = new Set(notices
      .filter((r) => { const a = apptById.get(r.appointment_id); return a && !resolutionOf(r, a); })
      .map((r) => r.account_id));
    await Promise.all(accounts.filter((acc) => acc.active && pendingAccounts.has(acc.id)).map(async (acc) => {
      const links = await accountLinks(ctx, { id: acc.id, dni: acc.dni ?? "" });
      visible.set(acc.id, new Set(links.filter((l) => l.valid).map((l) => l.patient_id)));
    }));
  }
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
      family_sees: a.appointment_date >= now.date && !!visible.get(r.account_id)?.has(a.patient_id),
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

  // 1. Se reserva el aviso: si dos personas lo resuelven a la vez, gana una.
  //    Se compara con lo que se leyó, así un intento anterior que no llegó a
  //    cambiar el turno (y por eso sigue pendiente) se puede reintentar.
  const at = new Date().toISOString();
  let claim = ctx.admin.from("portal_appointment_responses").update({
    outcome: how === "reprogramar" ? "reprogramado" : how === "visto" ? "otro" : null,
    resolved_at: at,
    resolved_by_email: staff.email,
  }).eq("id", r.id).is("outcome", null);
  claim = r.resolved_at ? claim.eq("resolved_at", r.resolved_at) : claim.is("resolved_at", null);
  const { data: claimed, error: cErr } = await claim.select("id");
  if (cErr) throw new PortalError(503, "No se pudo marcar el aviso. Probá de nuevo.");
  if (!claimed?.length) throw new PortalError(409, "Otra persona del equipo ya resolvió este aviso. Actualizá la bandeja.");
  // Si no se pudo cambiar el turno, se deshace la reserva. Aunque esto falle,
  // el aviso sigue pendiente (el turno no cambió) y se puede reintentar.
  const release = async () => {
    const { error } = await ctx.admin.from("portal_appointment_responses")
      .update({ outcome: null, resolved_at: null, resolved_by_email: null })
      .eq("id", r.id).eq("resolved_at", at);
    if (error) console.error("[portal] no se pudo deshacer la reserva de un aviso");
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
