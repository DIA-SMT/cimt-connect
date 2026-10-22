import { defineEventHandler, getQuery, readBody } from "nitro/h3";
import { RECORDING_MAX_BYTES } from "../../../src/lib/recordingRules";
import { PortalError, handle, requireFamily, setup } from "../../lib/portal";
import { familyRecordingAccept, familyRecordingConsent, familyUpload, requireRecordings } from "../../lib/recordings";

// «Me grabo» (etapas "practice", "activities" y "recordings"; apagadas: 404).
//   GET  /api/portal/grabacion                      → { accepted, version }: el permiso de grabaciones de la cuenta
//   POST /api/portal/grabacion?action=consent { accept } → lo mismo, después de guardar la respuesta
//   POST /api/portal/grabacion?ejercicio=<id>       (cuerpo: el WAV) → { id, status }
// Errores con code: RECORDING_CONSENT (403: falta el permiso), LIMIT (429),
// CONSENT / VERIFY / NOT_AVAILABLE como en los ejercicios.
export default defineEventHandler((event) => handle(event, async () => {
  requireRecordings();
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  if (event.req.method === "GET") return familyRecordingConsent(ctx, account);
  const q = getQuery(event);
  if (q.action === "consent") {
    const body = (await readBody(event).catch(() => null)) as { accept?: unknown } | null;
    return familyRecordingAccept(ctx, account, body?.accept === true);
  }
  if (Number(event.req.headers.get("content-length") ?? 0) > RECORDING_MAX_BYTES) {
    throw new PortalError(413, "La grabación es demasiado larga.");
  }
  const wav = new Uint8Array(await event.req.arrayBuffer());
  return familyUpload(ctx, account, q.ejercicio, wav);
}));
