import { defineEventHandler, readBody } from "nitro/h3";
import { type HcChannel, HC_CHANNELS } from "../../../src/lib/portalRules";
import { PortalError, activeChildren, handle, requireFamily, setup } from "../../lib/portal";
import { cancelHcRequest, createHcRequest } from "../../lib/requests";

// POST /api/portal/hc — pedidos de copia de la historia clínica
//   { action: "create", patient_id, channel? } → HcRequestDTO
//   { action: "cancel", id }                   → HcRequestDTO (solo si sigue pendiente)
// channel: "mano" (por defecto: se entrega en el centro; se puede siempre) o
// "portal" (copia digital, etapa "hc_digital" con el script 25; si la cuenta
// todavía no puede recibirla o el portal del paciente está en pausa, 409 code
// DIGITAL_BLOCKED con el texto para la familia). Acá solo viaja el pedido:
// los PDF se descargan aparte (/api/portal/document).
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const body = (await readBody(event)) as { action?: string; patient_id?: string; id?: string; channel?: unknown } | null;
  const children = await activeChildren(ctx, account);
  if (body?.action === "create") {
    const channel = body.channel ?? "mano";
    if (!(HC_CHANNELS as readonly unknown[]).includes(channel)) throw new PortalError(400, "Pedido inválido");
    return createHcRequest(ctx, account, children, String(body.patient_id ?? ""), channel as HcChannel);
  }
  if (body?.action === "cancel") return cancelHcRequest(ctx, account, children, String(body.id ?? ""));
  throw new PortalError(400, "Pedido inválido");
}));
