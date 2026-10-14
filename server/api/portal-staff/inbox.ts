import { defineEventHandler, readBody } from "nitro/h3";
import { staffApptList, staffApptNotes, staffApptPendingCount, staffApptUpdate } from "../../lib/apptRequests";
import { staffOpen, staffRegister, staffRemove, staffSend, staffUploadUrl } from "../../lib/hcDocuments";
import { PortalError, handle, setup } from "../../lib/portal";
import { requireStaffRole } from "../../lib/portalClinical";
import { staffHcList, staffHcNotes, staffHcPendingCount, staffHcUpdate, staffNotices, staffResolveNotice } from "../../lib/requests";

// POST /api/portal-staff/inbox — bandeja del portal en el panel.
// Cualquier persona activa del panel (todos los roles) puede usarla. Los PDF
// de la copia digital, solo profesionales y Dirección (Administración ve los
// estados).
//
//   { action: "list" }  → { hc, notices, turnos } (de paso borra subidas sueltas de pedidos recién cerrados)
//   { action: "count" } → { hc_pending, notices_pending, turnos_pending } (para el número de la pestaña)
//   { action: "hc_update", id, to, delivered_to_name?, delivered_to_dni?, reject_reason? }
//   { action: "hc_notes", id, notes }
//   { action: "appt_update", id, to, appointment_id?, reject_reason? } → StaffApptRequest (pedidos de turno)
//   { action: "appt_notes", id, notes }
//   { action: "notice_resolve", response_id, how }
//
// Copia digital de la historia clínica (etapa "hc_digital"; apagada o sin el
// script 24: 404):
//   { action: "hc_doc_upload_url", request_id, file_name, size_bytes } → { path, token }
//       enlace para subir el PDF al bucket privado (el panel lo sube con uploadToSignedUrl)
//   { action: "hc_doc_register", request_id, path, file_name } → StaffHcRequest
//       revisa el PDF subido (hasta 10 MB, sin contraseña) y guarda su huella;
//       409 si el pedido cambió mientras se subía (el PDF no queda)
//   { action: "hc_doc_remove", document_id } → StaffHcRequest (solo si no se envió)
//   { action: "hc_doc_open", document_id }   → { url } (vence en 60 s; queda registrado quién lo abrió)
//   { action: "hc_send", request_id, acks: { complete, no_third_parties, signed, adolescent? }, document_ids } → StaffHcRequest
//       la familia la descarga desde el portal durante 60 días. document_ids: los PDF que
//       se revisaron; si los del pedido son otros (alguien subió o quitó uno), 409 y no se
//       envía. Se publican solo esos.
// Subir y enviar dan 409 code DIGITAL_BLOCKED si la cuenta que pidió no puede
// recibirla por el portal o si el portal del paciente está en pausa (con el
// texto para el equipo: se entrega en mano).
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const staff = await requireStaffRole(ctx, event);
  const body = (await readBody(event)) as Record<string, unknown> | null;

  switch (body?.action) {
    case "list": {
      const [hc, notices, turnos] = await Promise.all([staffHcList(ctx), staffNotices(ctx, true), staffApptList(ctx)]);
      return { hc, notices, turnos };
    }
    case "count": {
      const [hcPending, notices, turnosPending] = await Promise.all([
        staffHcPendingCount(ctx), staffNotices(ctx), staffApptPendingCount(ctx),
      ]);
      return {
        hc_pending: hcPending,
        notices_pending: notices.filter((n) => n.resolution === null).length,
        turnos_pending: turnosPending,
      };
    }
    case "hc_update":
      return staffHcUpdate(ctx, staff.email, body);
    case "hc_notes":
      return staffHcNotes(ctx, staff.email, body);
    case "hc_doc_upload_url":
      return staffUploadUrl(ctx, staff, body);
    case "hc_doc_register":
      return staffRegister(ctx, staff, body);
    case "hc_doc_remove":
      return staffRemove(ctx, staff, body);
    case "hc_doc_open":
      return staffOpen(ctx, staff, body);
    case "hc_send":
      return staffSend(ctx, staff, body);
    case "appt_update":
      return staffApptUpdate(ctx, staff.email, body);
    case "appt_notes":
      return staffApptNotes(ctx, staff.email, body);
    case "notice_resolve":
      return staffResolveNotice(ctx, staff, body);
    default:
      throw new PortalError(400, "Acción inválida");
  }
}));
