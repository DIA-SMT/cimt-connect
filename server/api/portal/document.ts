import { defineEventHandler, readBody } from "nitro/h3";
import { familyDownload } from "../../lib/hcDocuments";
import { PortalError, handle, requireFamily, setup } from "../../lib/portal";
import { digitalOn } from "../../lib/portalClinical";

// POST /api/portal/document { id } → { url, expires_in, file_name }
// Descarga de un PDF de la copia de la historia clínica enviada por el portal
// (etapa "hc_digital"; apagada o sin el script 24: 404). Solo la cuenta que
// la pidió, dentro de los 60 días. 403 con code CONSENT, VERIFY,
// NOT_AVAILABLE (también con el portal del paciente en pausa: se pide en mano,
// sin decir por qué) o REAUTH (contraseña de los últimos 15 minutos); 410
// EXPIRED. Un documento ajeno da el mismo 404 que uno que no existe. El
// enlace vence en 60 segundos y la descarga queda registrada.
export default defineEventHandler((event) => handle(event, async () => {
  // Corte rápido con la etapa apagada (familyDownload mira también el script 24)
  if (!digitalOn()) throw new PortalError(404, "No disponible.");
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const body = (await readBody(event)) as { id?: unknown } | null;
  return familyDownload(ctx, event, account, body?.id);
}));
