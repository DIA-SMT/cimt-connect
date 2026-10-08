import { defineEventHandler, readBody } from "nitro/h3";
import { PortalError, activeChildren, handle, requireFamily, setup } from "../../lib/portal";
import { cancelHcRequest, createHcRequest } from "../../lib/requests";

// POST /api/portal/hc — pedidos de copia de la historia clínica
//   { action: "create", patient_id } → HcRequestDTO
//   { action: "cancel", id }         → HcRequestDTO (solo si sigue pendiente)
// La copia se entrega en mano en el centro: acá solo viaja el pedido.
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const body = (await readBody(event)) as { action?: string; patient_id?: string; id?: string } | null;
  const children = await activeChildren(ctx, account);
  if (body?.action === "create") return createHcRequest(ctx, account, children, String(body.patient_id ?? ""));
  if (body?.action === "cancel") return cancelHcRequest(ctx, account, children, String(body.id ?? ""));
  throw new PortalError(400, "Pedido inválido");
}));
