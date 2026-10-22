import { defineEventHandler, readBody } from "nitro/h3";
import { PortalError, handle, setup } from "../../lib/portal";
import { requireClinical, requireStaffRole } from "../../lib/portalClinical";
import {
  requireRecordings, staffRecordingAudio, staffRecordingConsents, staffRecordingReanalyze, staffRecordingReview, staffRecordings,
} from "../../lib/recordings";
import { assertPatient, assertRowPatient } from "../../lib/staffScope";

// «Me grabo» en el panel (etapas "practice", "activities" y "recordings").
// Solo perfiles clínicos (Dirección y profesionales; un profesional, solo sus
// pacientes): Administración no escucha grabaciones.
//   { action: "list", patient_id }                          → { items: StaffRecordingDTO[], consents: StaffRecordingConsent[] }
//   { action: "audio", id }                                 → { url } (firmada, 5 minutos; queda registrado quién la abrió)
//   { action: "review", id, stuttered, syllables, note }    → { ok }
//   { action: "reanalyze", id }                             → { status }
export default defineEventHandler((event) => handle(event, async () => {
  requireRecordings();
  const ctx = setup();
  const staff = await requireStaffRole(ctx, event);
  requireClinical(staff);
  const body = ((await readBody(event).catch(() => null)) ?? {}) as Record<string, unknown>;
  if (body.action === "list") {
    if (typeof body.patient_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.patient_id)) throw new PortalError(400, "Pedido inválido");
    await assertPatient(ctx, staff, body.patient_id);
    const [items, consents] = await Promise.all([staffRecordings(ctx, body.patient_id), staffRecordingConsents(ctx, body.patient_id)]);
    return { items, consents };
  }
  await assertRowPatient(ctx, staff, "practice_recordings", body.id);
  if (body.action === "audio") return staffRecordingAudio(ctx, staff, body.id);
  if (body.action === "review") return staffRecordingReview(ctx, staff, body.id, body);
  if (body.action === "reanalyze") return staffRecordingReanalyze(ctx, body.id);
  throw new PortalError(400, "Pedido inválido");
}));
