import { defineEventHandler, getQuery } from "nitro/h3";
import { handle, requireFamily, setup } from "../../lib/portal";
import { requireFeature } from "../../lib/portalClinical";
import { familyInfo } from "../../lib/portalInfo";

// GET /api/portal/info?id=<patient_id> → InfoDTO ("Mi información")
// Lo que el profesional publicó para esa persona. 403 con code CONSENT,
// VERIFY, NOT_AVAILABLE o REAUTH (volver a poner la contraseña). Un paciente
// ajeno da el mismo 404 que uno que no existe.
export default defineEventHandler((event) => handle(event, async () => {
  requireFeature("info");
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  return familyInfo(ctx, event, account, String(getQuery(event).id ?? ""));
}));
