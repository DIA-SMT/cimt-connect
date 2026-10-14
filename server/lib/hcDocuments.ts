// Portal — copia digital de la historia clínica (etapa E1, "hc_digital"):
// los PDF de cada pedido, su envío y la descarga desde el portal.
//
// Equipo (solo profesionales y Dirección; Administración ve los estados):
// sube los PDF (la historia impresa desde la ficha y firmada digitalmente por
// la Dirección), los abre para revisarlos, quita los que no van y envía la
// copia con sus confirmaciones. Familia: solo la cuenta que la pidió la
// descarga, durante 60 días, con la contraseña confirmada en los últimos 15
// minutos y con la información de salud activada.
//
// Los archivos viven en el bucket privado "portal-documents" (script 25), sin
// policies: solo este servidor los toca (service role key) y los abre con
// enlaces que vencen en 60 segundos. Cada apertura queda en
// portal_access_log. Los PDF no se modifican: un sello rompería la firma.
// Con el portal del paciente en pausa ("Pausar todo lo clínico") no se suben,
// no se envían ni se descargan: la copia se entrega en mano.
// Reglas puras en src/lib/hcDigitalRules.ts.

import { createHash, randomUUID } from "node:crypto";
import {
  HC_BUCKET, HC_LINK_SECONDS, PDF_PROBLEM_TEXT,
  cleanAcks, cleanDocName, docUploadProblem, hcDocPath, hcDocPathOk, hcDownloadName, hcDownloadable,
  hcSendAcksProblem, pdfProblem,
} from "../../src/lib/hcDigitalRules";
import { publicOutcome } from "../../src/lib/portalClinicalRules";
import { type HcStatus, type StaffHcRequest, HC_DOC_MAX_FILES, ageOn, centerNow } from "../../src/lib/portalRules";
import { type Account, type Ctx, type H3Event, PortalError } from "./portal";
import { needsReauth, requireClinical } from "./portalClinical";
import {
  type HcStaffRow, PARENTAL_PROOF, digitalReady, hcDigitalAccess, isParentKind, loadStaffHcRow, logEvent, publishedDocs,
  removeObjects, requesterDigitalBlock, staffHcById, staffHcFromRow, sweepOrphans,
} from "./requests";

type Staff = { email: string; clinical: boolean };

const OFFLINE = "No pudimos conectar. Probá de nuevo.";
const GONE = "Ese PDF ya no está. Actualizá la bandeja.";
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

// Con la etapa apagada (o sin el script 25) nada de esto existe (mismo 404
// que cualquier ruta)
async function requireDigital(ctx: Ctx) {
  if (!(await digitalReady(ctx))) throw new PortalError(404, "No disponible.");
}

async function requireStaffDigital(ctx: Ctx, staff: Staff) {
  await requireDigital(ctx);
  requireClinical(staff);
}

type DocRow = {
  id: string; request_id: string; patient_id: string; storage_path: string;
  published_at: string | null; removed_at: string | null;
};
const DOC_COLS = "id, request_id, patient_id, storage_path, published_at, removed_at";

async function loadDoc(ctx: Ctx, id: unknown): Promise<DocRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await ctx.admin.from("portal_hc_documents").select(DOC_COLS).eq("id", id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  return (data as DocRow | null) ?? null;
}

// Solo se suben y se envían PDF a un pedido abierto que pidió recibirla en el portal
const openPortal = (r: Pick<HcStaffRow, "channel" | "status">) =>
  r.channel === "portal" && (r.status === "pendiente" || r.status === "lista");

function requireOpenPortal(r: Pick<HcStaffRow, "channel" | "status">) {
  if (r.channel !== "portal") throw new PortalError(409, "Este pedido es para entregar en mano.");
  if (!openPortal(r)) throw new PortalError(409, "Este pedido ya cambió de estado. Actualizá la bandeja.");
}

// La cuenta que pidió tiene que poder recibirla hoy (y el portal del
// paciente no puede estar en pausa)
async function requireRequesterDigital(ctx: Ctx, r: HcStaffRow) {
  const block = await requesterDigitalBlock(ctx, r);
  if (block) throw new PortalError(409, block, { code: "DIGITAL_BLOCKED" });
}

// PDF del pedido que no se quitaron
async function liveDocCount(ctx: Ctx, requestId: string): Promise<number> {
  const { count, error } = await ctx.admin.from("portal_hc_documents").select("id", { count: "exact", head: true })
    .eq("request_id", requestId).is("removed_at", null);
  if (error) throw new PortalError(503, OFFLINE);
  return count ?? 0;
}

async function canUpload(ctx: Ctx, r: HcStaffRow) {
  requireOpenPortal(r);
  await requireRequesterDigital(ctx, r);
  if ((await liveDocCount(ctx, r.id)) >= HC_DOC_MAX_FILES) {
    throw new PortalError(409, `Un pedido puede tener hasta ${HC_DOC_MAX_FILES} PDF. Quitá alguno para subir otro.`);
  }
}

// ── Equipo ──────────────────────────────────────────────────────────────────

// 1. Enlace para subir un PDF directo al bucket (lo usa el panel con
//    uploadToSignedUrl). Todavía no queda nada registrado. De paso se borran
//    las subidas viejas de este pedido que nunca se registraron.
export async function staffUploadUrl(ctx: Ctx, staff: Staff, body: Record<string, unknown>): Promise<{ path: string; token: string }> {
  await requireStaffDigital(ctx, staff);
  if (!isUuid(body.request_id)) throw new PortalError(400, "Pedido inválido");
  const problem = docUploadProblem(cleanDocName(body.file_name), body.size_bytes);
  if (problem) throw new PortalError(400, problem);
  const r = await loadStaffHcRow(ctx, body.request_id);
  await canUpload(ctx, r);
  await sweepOrphans(ctx, r.id);
  const path = hcDocPath(r.id, randomUUID());
  const { data, error } = await ctx.admin.storage.from(HC_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new PortalError(503, "No se pudo preparar la subida. Probá de nuevo.");
  return { path, token: data.token };
}

const CHANGED_WHILE_UPLOADING = "El pedido cambió mientras subías el archivo. Actualizá la bandeja.";
const NOT_SAVED = "No se pudo guardar el PDF. Probá de nuevo.";

// ¿El archivo ya tiene su fila en portal_hc_documents? null si no se puede saber
async function hasRow(ctx: Ctx, path: string): Promise<boolean | null> {
  try {
    const { data, error } = await ctx.admin.from("portal_hc_documents").select("id").eq("storage_path", path).maybeSingle();
    return error ? null : !!data;
  } catch {
    return null;
  }
}

// 2. Registra el PDF ya subido: lo baja con la service role, revisa que sea
//    un PDF de hasta 10 MB sin contraseña y guarda su huella (sha256). Lo
//    que no pasa se borra del bucket. Un error quiere decir que el PDF no
//    quedó en el pedido.
export async function staffRegister(ctx: Ctx, staff: Staff, body: Record<string, unknown>): Promise<StaffHcRequest> {
  await requireStaffDigital(ctx, staff);
  const requestId = body.request_id;
  if (!isUuid(requestId) || !hcDocPathOk(body.path, requestId)) throw new PortalError(400, "Pedido inválido");
  const path = body.path as string;
  const bucket = ctx.admin.storage.from(HC_BUCKET);
  const discard = () => removeObjects(ctx, [path]);

  // Un reintento de algo que ya quedó registrado: se devuelve el pedido como
  // está. Si no se puede saber, el archivo no se toca (podría ser el de un
  // PDF ya registrado); si quedó suelto, lo borra sweepOrphans más adelante.
  const { data: known, error: kErr } = await ctx.admin.from("portal_hc_documents").select("id").eq("storage_path", path).maybeSingle();
  if (kErr) throw new PortalError(503, OFFLINE);
  if (known) return staffHcById(ctx, requestId);

  // Desde acá, un error antes de guardar la fila borra el archivo, salvo que
  // tenga fila (otro intento a la vez lo registró, o se guardó y la
  // respuesta no llegó). Si no se puede saber, no se toca: si quedó suelto,
  // lo borra sweepOrphans más adelante.
  let r: HcStaffRow;
  let docId: string | null = null; // null: lo registró otro intento a la vez
  try {
    r = await loadStaffHcRow(ctx, requestId);
    await canUpload(ctx, r);

    const { data: blob, error: dErr } = await bucket.download(path);
    if (dErr || !blob) throw new PortalError(400, "No encontramos el archivo subido. Probá de nuevo.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const problem = pdfProblem(bytes);
    if (problem) throw new PortalError(400, PDF_PROBLEM_TEXT[problem], { code: "PDF" });
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    // El mismo PDF dos veces en el pedido. Si es este mismo archivo, ya lo
    // registró otro intento a la vez.
    const { data: dup, error: dupErr } = await ctx.admin.from("portal_hc_documents").select("id, storage_path")
      .eq("request_id", r.id).eq("sha256", sha256).is("removed_at", null);
    if (dupErr) throw new PortalError(503, OFFLINE);
    const dups = (dup ?? []) as { id: string; storage_path: string }[];
    const sameFile = dups.some((d) => d.storage_path === path);
    if (!sameFile && dups.length) throw new PortalError(409, "Ese PDF ya está subido en este pedido.");

    if (!sameFile) {
      const { data: row, error } = await ctx.admin.from("portal_hc_documents").insert({
        request_id: r.id,
        patient_id: r.patient_id,
        storage_path: path,
        file_name: cleanDocName(body.file_name) || "historia-clinica.pdf",
        size_bytes: bytes.length,
        sha256,
        uploaded_by_email: staff.email,
      }).select("id").single();
      if (error?.code !== "23505") {
        if (error || !row) throw new PortalError(503, NOT_SAVED);
        docId = (row as { id: string }).id;
      }
    }
  } catch (err) {
    if ((await hasRow(ctx, path)) === false) await discard();
    throw err instanceof PortalError ? err : new PortalError(503, OFFLINE);
  }
  if (!docId) return staffHcById(ctx, r.id); // ya registrado (dos intentos a la vez)

  // 3. El pedido pudo cerrarse (en mano, rechazado, cancelado o enviado)
  //    mientras se subía el archivo: si ya no está abierto para el portal, el
  //    PDF se quita y se avisa. Si no se puede saber, también se quita (y se
  //    avisa que no se guardó).
  const after = await loadStaffHcRow(ctx, r.id).catch(() => null);
  if (after && openPortal(after)) {
    await logEvent(ctx, r.id, "documento", staff.email);
    return staffHcFromRow(ctx, after);
  }
  const { data: undone, error: uErr } = await ctx.admin.from("portal_hc_documents")
    .update({ removed_at: new Date().toISOString(), removed_by_email: staff.email })
    .eq("id", docId).is("published_at", null).is("removed_at", null).select("id");
  if (uErr) {
    console.error("[portal] no se pudo quitar un PDF subido mientras el pedido cambiaba:", docId);
  } else if (undone?.length) {
    await discard();
  } else {
    // Sin filas: ya lo quitó el cierre del pedido (con su archivo) o salió
    // con la copia enviada. Como el envío publica solo los PDF que se
    // revisaron, lo segundo no debería pasar; si pasó, el PDF quedó.
    const doc = await loadDoc(ctx, docId).catch(() => null);
    if (doc?.published_at && !doc.removed_at) {
      await logEvent(ctx, r.id, "documento", staff.email);
      return staffHcById(ctx, r.id);
    }
  }
  throw after ? new PortalError(409, CHANGED_WHILE_UPLOADING) : new PortalError(503, NOT_SAVED);
}

// Quita un PDF que todavía no se envió (la fila queda como constancia; el
// archivo se borra del bucket, y de paso las subidas viejas sin registrar)
export async function staffRemove(ctx: Ctx, staff: Staff, body: Record<string, unknown>): Promise<StaffHcRequest> {
  await requireStaffDigital(ctx, staff);
  const doc = await loadDoc(ctx, body.document_id);
  if (!doc || doc.removed_at) throw new PortalError(404, GONE);
  if (doc.published_at) throw new PortalError(409, "Ese PDF ya se envió a la familia: no se puede quitar.");
  const { data, error } = await ctx.admin.from("portal_hc_documents")
    .update({ removed_at: new Date().toISOString(), removed_by_email: staff.email })
    .eq("id", doc.id).is("published_at", null).is("removed_at", null).select("id");
  if (error) throw new PortalError(503, "No se pudo quitar el PDF. Probá de nuevo.");
  if (!data?.length) throw new PortalError(409, "Ese PDF cambió mientras tanto. Actualizá la bandeja.");
  await removeObjects(ctx, [doc.storage_path]);
  await logEvent(ctx, doc.request_id, "documento_quitado", staff.email);
  await sweepOrphans(ctx, doc.request_id);
  return staffHcById(ctx, doc.request_id);
}

// Abre un PDF para revisarlo: enlace de 60 segundos. Sin la constancia en
// portal_access_log no se abre.
export async function staffOpen(ctx: Ctx, staff: Staff, body: Record<string, unknown>): Promise<{ url: string }> {
  await requireStaffDigital(ctx, staff);
  const doc = await loadDoc(ctx, body.document_id);
  if (!doc || doc.removed_at) throw new PortalError(404, GONE);
  const { data, error } = await ctx.admin.storage.from(HC_BUCKET).createSignedUrl(doc.storage_path, HC_LINK_SECONDS);
  if (error || !data) throw new PortalError(503, "No se pudo abrir el PDF. Probá de nuevo.");
  const { error: logErr } = await ctx.admin.from("portal_access_log").insert({
    patient_id: doc.patient_id, account_id: null, staff_email: staff.email, action: "equipo_abrir_documento", target_id: doc.id,
  });
  if (logErr) throw new PortalError(503, "No se pudo abrir el PDF. Probá de nuevo.");
  return { url: data.signedUrl };
}

const LIST_CHANGED = "La lista de PDF cambió mientras revisabas. Actualizá y revisala de nuevo.";
const NO_DOCS = "Subí al menos un PDF antes de enviarla.";

// PDF del pedido que no se quitaron (sus id)
async function liveDocIds(ctx: Ctx, requestId: string): Promise<string[]> {
  const { data, error } = await ctx.admin.from("portal_hc_documents").select("id").eq("request_id", requestId).is("removed_at", null);
  if (error) throw new PortalError(503, OFFLINE);
  return ((data ?? []) as { id: string }[]).map((d) => d.id);
}

// Envía la copia por el portal: el pedido pasa a "enviada" y sus PDF quedan
// publicados para la cuenta que la pidió (60 días). document_ids: los PDF
// que quien envía tenía en pantalla y revisó; si los del pedido son otros
// (alguien subió o quitó uno mientras tanto), no se envía. Se publican solo
// esos: un PDF que se registra a la vez queda afuera (y se quita, porque el
// pedido ya no está abierto).
export async function staffSend(ctx: Ctx, staff: Staff, body: Record<string, unknown>): Promise<StaffHcRequest> {
  await requireStaffDigital(ctx, staff);
  if (!isUuid(body.request_id)) throw new PortalError(400, "Pedido inválido");
  const list = body.document_ids;
  if (!Array.isArray(list) || !list.length || !list.every(isUuid)) throw new PortalError(400, "Pedido inválido");
  const ids = new Set(list.map((id) => id.toLowerCase()));
  const r = await loadStaffHcRow(ctx, body.request_id);
  requireOpenPortal(r);
  // Con el portal del paciente en pausa (o si la cuenta ya no puede
  // recibirla) no se envía, aunque estén los PDF y las confirmaciones
  await requireRequesterDigital(ctx, r);

  const { data: p, error: pErr } = await ctx.admin.from("patients").select("birth_date").eq("id", r.patient_id).maybeSingle();
  if (pErr) throw new PortalError(503, OFFLINE);
  const age = p?.birth_date ? ageOn(p.birth_date as string, centerNow().date) : null;
  const problem = hcSendAcksProblem(body.acks, age);
  if (problem) throw new PortalError(400, problem, { code: "ACKS" });
  const live = await liveDocIds(ctx, r.id);
  if (!live.length) throw new PortalError(409, NO_DOCS);
  const same = live.length === ids.size && live.every((id) => ids.has(id.toLowerCase()));
  if (!same) throw new PortalError(409, LIST_CHANGED);

  // 1. El pedido pasa a "enviada", solo si nadie lo cambió mientras tanto
  const now = new Date().toISOString();
  const { data: sent, error: sErr } = await ctx.admin.from("portal_hc_requests")
    .update({ status: "enviada", sent_at: now, sent_by_email: staff.email, sent_acks: cleanAcks(body.acks, age), updated_at: now })
    .eq("id", r.id).eq("status", r.status).eq("channel", "portal").select("id");
  if (sErr) throw new PortalError(503, "No se pudo enviar. Probá de nuevo.");
  if (!sent?.length) throw new PortalError(409, "Otra persona del equipo cambió este pedido. Actualizá la bandeja.");

  // 2. Se publican los PDF revisados (en un solo paso). Si no se puede, o si
  //    alguno se quitó mientras tanto, se deshace todo: el pedido vuelve a
  //    como estaba y no se ve nada en el portal.
  const { data: pub, error: pubErr } = await ctx.admin.from("portal_hc_documents").update({ published_at: now })
    .eq("request_id", r.id).in("id", live).is("removed_at", null).select("id");
  if (pubErr || pub?.length !== live.length) {
    const [{ error: unpubErr }, { error: undoErr }] = await Promise.all([
      ctx.admin.from("portal_hc_documents").update({ published_at: null }).eq("request_id", r.id).eq("published_at", now),
      ctx.admin.from("portal_hc_requests")
        .update({ status: r.status as HcStatus, sent_at: null, sent_by_email: null, sent_acks: null, updated_at: r.updated_at })
        .eq("id", r.id).eq("status", "enviada").eq("sent_at", now),
    ]);
    if (unpubErr || undoErr) console.error("[portal] no se pudo deshacer un envío a medias:", r.id);
    throw pubErr ? new PortalError(503, "No se pudo enviar. Probá de nuevo.") : new PortalError(409, LIST_CHANGED);
  }
  await logEvent(ctx, r.id, "enviada", staff.email);
  // Ya no acepta más PDF: lo que quedó suelto en su carpeta se borra
  await sweepOrphans(ctx, r.id, { closed: true });
  return staffHcById(ctx, r.id);
}

// ── Familia ─────────────────────────────────────────────────────────────────

const NOT_FOUND = "No encontramos ese documento.";

// Para descargarla falta verificar el vínculo en el centro (a madre, padre o
// tutor/a también se le pide lo que lo acredita)
export function verifyDownloadText(linkKind: string | null | undefined): string {
  const base = "Para descargarla, primero tenés que pasar por el centro con tu DNI.";
  return isParentKind(linkKind) ? `${base} ${PARENTAL_PROOF}` : base;
}

// No se puede descargar desde el portal (403 NOT_AVAILABLE), sin decir por
// qué. Con el portal del paciente en pausa la copia en mano sigue; si la
// cuenta ya no tiene derecho a la copia, que llamen.
export const DOWNLOAD_PAUSED = "Por ahora no se puede descargar desde el portal. Si la necesitás, pedila en mano en el centro.";
export const DOWNLOAD_NOT_AVAILABLE = "Esta copia ya no se puede descargar desde tu cuenta. Si la necesitás, llamanos.";

// Descarga de un PDF de la copia enviada: solo la cuenta que la pidió,
// dentro de los 60 días, con la información de salud activada, el vínculo
// verificado y el portal del paciente sin pausa, y con la contraseña
// confirmada en los últimos 15 minutos. Nombre genérico (sin datos del
// paciente) y enlace de 60 segundos.
export async function familyDownload(
  ctx: Ctx, event: H3Event, account: Account, id: unknown,
): Promise<{ url: string; expires_in: number; file_name: string }> {
  await requireDigital(ctx);
  const doc = await loadDoc(ctx, id);
  if (!doc || !doc.published_at || doc.removed_at) throw new PortalError(404, NOT_FOUND);
  const { data: r, error } = await ctx.admin.from("portal_hc_requests")
    .select("id, account_id, patient_id, status, sent_at, link_kind").eq("id", doc.request_id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  // De otra cuenta: lo mismo que si no existiera
  if (!r || r.account_id !== account.id || r.status !== "enviada") throw new PortalError(404, NOT_FOUND);
  const req = r as { id: string; patient_id: string; status: HcStatus; sent_at: string | null; link_kind: string | null };
  if (!hcDownloadable(req) || !req.sent_at) {
    throw new PortalError(410, "Ya pasaron los 60 días para descargarla. Si la necesitás, pedí una copia nueva.", { code: "EXPIRED" });
  }

  const access = await hcDigitalAccess(ctx, account, req.patient_id);
  const gate = publicOutcome(access);
  if (gate === "consent") throw new PortalError(403, "Para descargarla, primero activá la información de salud.", { code: "CONSENT" });
  if (gate === "verify") throw new PortalError(403, verifyDownloadText(req.link_kind), { code: "VERIFY" });
  if (!access.ok) {
    throw new PortalError(403, access.block === "pausado" ? DOWNLOAD_PAUSED : DOWNLOAD_NOT_AVAILABLE, { code: "NOT_AVAILABLE" });
  }
  if (await needsReauth(ctx, event, account, "download")) {
    throw new PortalError(403, "Para descargarla, volvé a poner tu contraseña.", { code: "REAUTH" });
  }

  const docs = (await publishedDocs(ctx, [req.id])).get(req.id) ?? [];
  const index = Math.max(0, docs.findIndex((d) => d.id === doc.id));
  const fileName = hcDownloadName(req.sent_at, index, Math.max(docs.length, 1));
  const { data: signed, error: sErr } = await ctx.admin.storage.from(HC_BUCKET)
    .createSignedUrl(doc.storage_path, HC_LINK_SECONDS, { download: fileName });
  if (sErr || !signed) throw new PortalError(503, "No pudimos preparar la descarga. Probá de nuevo.");
  // Sin la constancia no se descarga
  const { error: logErr } = await ctx.admin.from("portal_access_log").insert({
    patient_id: doc.patient_id, account_id: account.id, action: "descargar", target_id: doc.id,
  });
  if (logErr) throw new PortalError(503, "No pudimos preparar la descarga. Probá de nuevo.");
  return { url: signed.signedUrl, expires_in: HC_LINK_SECONDS, file_name: fileName };
}
