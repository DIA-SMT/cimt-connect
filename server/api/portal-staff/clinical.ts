import { defineEventHandler, readBody } from "nitro/h3";
import { centerNow, isValidDni, normalizeDni } from "../../../src/lib/portalRules";
import { closeApptRequestsOnBlock } from "../../lib/apptRequests";
import { PortalError, handle, setup } from "../../lib/portal";
import { assertPatient } from "../../lib/staffScope";
import {
  effectiveFeatures, features, recordConsent, requireClinical, requireFeature, requireStaffRole, staffClinical,
} from "../../lib/portalClinical";
import { publishReport, publishSummary, staffInfo, withdrawPublication } from "../../lib/portalInfo";

// POST /api/portal-staff/clinical — sección "Portal del paciente" de la ficha.
//
//   { action: "features" }                                   etapas prendidas (cualquier rol)
//   { action: "get", patient_id }                            "Quién lo ve" y configuración
//   { action: "set", patient_id, info_enabled?, practice_enabled? }   (profesional o Dirección)
//   { action: "pause", patient_id, reason: "indicacion_profesional"|"judicial"|null }   (ídem)
//   { action: "adolescent", patient_id, agreed_on?: "AAAA-MM-DD", withdrawn?: true }   (ídem)
//   { action: "verify_link", patient_id, link_id, in_person_on, parental_on? }   (cualquier rol)
//   { action: "block", patient_id, guardian_id, reason: "orden_judicial"|"otro" }  (cualquier rol)
//   { action: "unblock", patient_id, block_id }                                     (cualquier rol)
//   { action: "consent_paper", patient_id, account_id, file_id }                    (cualquier rol)
//
// "Mi información" (etapa info):
//   { action: "info_get", patient_id }        lo publicado y los informes (Administración: sin textos)
//   { action: "publish_summary", patient_id, expected_id, que_trabajamos, show_code, show_team,
//     acompanar, tips[], discussed_ack, adolescent_ack?, review_note? }             (profesional o Dirección)
//   { action: "publish_report", patient_id, expected_id, report_id, mode: "familia"|"tal_cual",
//     text? | include_progress?, include_evolution?, discussed_ack, adolescent_ack?, review_note? }   (ídem)
//   review_note: por qué se deja un texto con frases sobre fluidez (sin eso, 400 code REVIEW)
//   { action: "withdraw", patient_id, publication_id, reason }   (quien lo publicó o la Dirección)
//
// Cada escritura guarda el email de quien la hizo. Ninguna cambia la ficha.
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const OFFLINE = "No se pudo guardar. Probá de nuevo.";

export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const staff = await requireStaffRole(ctx, event);
  const body = (await readBody(event)) as Record<string, unknown> | null;
  // "hc_digital" solo si la copia digital está disponible (con "consent" y el script 25)
  if (body?.action === "features") return { features: await effectiveFeatures(ctx) };
  if (!features().length) throw new PortalError(404, "No disponible.");
  if (!isUuid(body?.patient_id)) throw new PortalError(400, "Pedido inválido");
  const patientId = body.patient_id;
  await assertPatient(ctx, staff, patientId); // un profesional, solo sus pacientes
  const today = centerNow().date;
  const now = new Date().toISOString();

  // Guarda la configuración del paciente (crea la fila si no existe)
  async function saveSettings(patch: Record<string, unknown>) {
    const { error } = await ctx.admin.from("patient_portal_settings")
      .upsert({ patient_id: patientId, ...patch, updated_by_email: staff.email, updated_at: now }, { onConflict: "patient_id" });
    if (error) throw new PortalError(503, OFFLINE);
  }

  switch (body.action) {
    case "get":
      return staffClinical(ctx, patientId, staff.clinical);

    case "set": {
      requireClinical(staff);
      const patch: Record<string, unknown> = {};
      if (typeof body.info_enabled === "boolean") patch.info_enabled = body.info_enabled;
      if (typeof body.practice_enabled === "boolean") patch.practice_enabled = body.practice_enabled;
      if (!Object.keys(patch).length) throw new PortalError(400, "Pedido inválido");
      await saveSettings(patch);
      return staffClinical(ctx, patientId, staff.clinical);
    }

    case "pause": {
      requireClinical(staff);
      const reason = body.reason;
      if (reason !== null && reason !== "indicacion_profesional" && reason !== "judicial") throw new PortalError(400, "Elegí el motivo.");
      await saveSettings(reason ? { paused_at: now, pause_reason: reason } : { paused_at: null, pause_reason: null });
      return staffClinical(ctx, patientId, staff.clinical);
    }

    case "adolescent": {
      requireClinical(staff);
      if (body.withdrawn === true) {
        await saveSettings({ adolescent_withdrawn_on: today });
      } else {
        if (!isDate(body.agreed_on) || body.agreed_on > today) throw new PortalError(400, "Indicá la fecha en que dio su conformidad.");
        await saveSettings({ adolescent_agreed_on: body.agreed_on, adolescent_agreed_by_email: staff.email, adolescent_withdrawn_on: null });
      }
      return staffClinical(ctx, patientId, staff.clinical);
    }

    case "info_get":
      requireFeature("info");
      return staffInfo(ctx, staff, patientId);

    case "publish_summary":
      requireFeature("info");
      return publishSummary(ctx, staff, patientId, body);

    case "publish_report":
      requireFeature("info");
      return publishReport(ctx, staff, patientId, body);

    case "withdraw":
      requireFeature("info");
      return withdrawPublication(ctx, staff, patientId, body);

    case "verify_link": {
      if (!isUuid(body.link_id)) throw new PortalError(400, "Pedido inválido");
      if (!isDate(body.in_person_on) || body.in_person_on > today) throw new PortalError(400, "Indicá cuándo se vio el DNI en persona.");
      const parental = body.parental_on;
      if (parental !== undefined && parental !== null && (!isDate(parental) || parental > today)) {
        throw new PortalError(400, "Revisá la fecha de la documentación.");
      }
      const { data: link, error: lErr } = await ctx.admin.from("portal_links")
        .select("id, patient_id, relationship_kind").eq("id", body.link_id).is("revoked_at", null).maybeSingle();
      if (lErr) throw new PortalError(503, OFFLINE);
      if (!link || link.patient_id !== patientId) throw new PortalError(404, "No encontramos ese acceso.");
      const patch: Record<string, unknown> = { verified_in_person_on: body.in_person_on, verified_by_email: staff.email };
      // La documentación de responsabilidad parental solo aplica a madre,
      // padre o tutor/a. Si no viene en el pedido, se conserva la que había.
      if (link.relationship_kind !== "representante_legal") patch.parental_checked_on = null;
      else if (parental !== undefined) patch.parental_checked_on = parental;
      const { error } = await ctx.admin.from("portal_links").update(patch).eq("id", link.id);
      if (error) throw new PortalError(503, OFFLINE);
      return staffClinical(ctx, patientId, staff.clinical);
    }

    case "block": {
      if (!isUuid(body.guardian_id)) throw new PortalError(400, "Pedido inválido");
      if (body.reason !== "orden_judicial" && body.reason !== "otro") throw new PortalError(400, "Elegí el motivo.");
      const { data: g, error: gErr } = await ctx.admin.from("patient_guardians")
        .select("id, patient_id, dni").eq("id", body.guardian_id).maybeSingle();
      if (gErr) throw new PortalError(503, OFFLINE);
      if (!g || g.patient_id !== patientId) throw new PortalError(404, "No encontramos a ese adulto en la ficha.");
      const dni = normalizeDni((g.dni as string | null) ?? "");
      if (!isValidDni(dni)) throw new PortalError(400, "Para bloquearlo hace falta su DNI en la ficha.");
      const { error } = await ctx.admin.from("portal_guardian_blocks").insert({
        patient_id: patientId, guardian_id: g.id, dni, reason: body.reason, created_by_email: staff.email,
      });
      // Si ya estaba bloqueado igual se repasa el corte de abajo (no cambia nada
      // si ya estaba hecho): así "Probá de nuevo" termina lo que un intento
      // anterior no pudo cortar
      const already = error?.code === "23505";
      if (error && !already) throw new PortalError(503, OFFLINE);
      // Se cortan sus accesos al portal para este paciente y sus invitaciones pendientes
      // (por su DNI y por su fila en la ficha)
      const CUT_FAILED = "El bloqueo quedó guardado, pero no se pudieron cortar todos sus accesos. Probá de nuevo o avisá a sistemas.";
      const [{ data: accs, error: accErr }, { data: rowLinks, error: rowErr }] = await Promise.all([
        ctx.admin.from("portal_accounts").select("id").eq("dni", dni),
        // También los ya revocados: sirven para encontrar sus pedidos de turno
        ctx.admin.from("portal_links").select("id, account_id, revoked_at").eq("patient_id", patientId).eq("guardian_id", g.id),
      ]);
      if (accErr || rowErr) throw new PortalError(503, CUT_FAILED);
      const accountIds = ((accs ?? []) as { id: string }[]).map((a) => a.id);
      const rowLinkList = (rowLinks ?? []) as { id: string; account_id: string | null; revoked_at: string | null }[];
      const revoke = { revoked_at: now, revoked_by_email: staff.email, revoke_reason: "bloqueo" };
      if (accountIds.length) {
        const { error: e1 } = await ctx.admin.from("portal_links").update(revoke)
          .eq("patient_id", patientId).in("account_id", accountIds).is("revoked_at", null);
        if (e1) throw new PortalError(503, CUT_FAILED);
      }
      const linkIds = rowLinkList.filter((l) => !l.revoked_at).map((l) => l.id);
      if (linkIds.length) {
        const { error: e2 } = await ctx.admin.from("portal_links").update(revoke).in("id", linkIds).is("revoked_at", null);
        if (e2) throw new PortalError(503, CUT_FAILED);
      }
      const { error: e3 } = await ctx.admin.from("portal_invitations").update({ revoked_at: now })
        .eq("dni", dni).is("used_at", null).is("revoked_at", null);
      if (e3) throw new PortalError(503, CUT_FAILED);
      // Sus pedidos de turno abiertos para este paciente se cierran (no hay que
      // contactarlo). Los pedidos de copia de la historia clínica no se tocan:
      // la copia es un derecho y lo decide el equipo. Repetirlo con el bloqueo
      // ya cargado no cambia nada: los cerrados por el bloqueo no se pueden
      // reabrir mientras siga vigente, y la constancia en las notas no se repite.
      const blockedAccounts = [...new Set([
        ...accountIds, ...rowLinkList.map((l) => l.account_id).filter((x): x is string => !!x),
      ])];
      if (!(await closeApptRequestsOnBlock(ctx, staff.email, patientId, blockedAccounts))) {
        throw new PortalError(503, CUT_FAILED);
      }
      if (already) throw new PortalError(409, "Ese adulto ya está bloqueado.");
      return staffClinical(ctx, patientId, staff.clinical);
    }

    case "unblock": {
      if (!isUuid(body.block_id)) throw new PortalError(400, "Pedido inválido");
      const { data, error } = await ctx.admin.from("portal_guardian_blocks")
        .update({ lifted_at: now, lifted_by_email: staff.email })
        .eq("id", body.block_id).eq("patient_id", patientId).is("lifted_at", null).select("id");
      if (error) throw new PortalError(503, OFFLINE);
      if (!data?.length) throw new PortalError(409, "Ese bloqueo ya no está vigente. Actualizá la ficha.");
      return staffClinical(ctx, patientId, staff.clinical);
    }

    case "consent_paper": {
      if (!isUuid(body.account_id) || !isUuid(body.file_id)) throw new PortalError(400, "Pedido inválido");
      // La cuenta tiene que estar vinculada a este paciente, y el formulario
      // escaneado tiene que estar en los adjuntos de su ficha
      const [{ data: link }, { data: file }] = await Promise.all([
        ctx.admin.from("portal_links").select("id").eq("patient_id", patientId).eq("account_id", body.account_id).is("revoked_at", null).maybeSingle(),
        ctx.admin.from("patient_files").select("id, patient_id, category, voided_at").eq("id", body.file_id).maybeSingle(),
      ]);
      if (!link) throw new PortalError(404, "Esa cuenta no tiene acceso a este paciente.");
      if (!file || file.patient_id !== patientId || file.voided_at || file.category !== "consentimiento") {
        throw new PortalError(400, "Elegí el formulario firmado (adjunto de tipo «Consentimiento informado» de esta ficha).");
      }
      await recordConsent(ctx, body.account_id, true, { channel: "papel", fileId: body.file_id, byEmail: staff.email });
      return staffClinical(ctx, patientId, staff.clinical);
    }

    default:
      throw new PortalError(400, "Acción inválida");
  }
}));
