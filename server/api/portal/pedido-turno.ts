import { defineEventHandler, readBody } from "nitro/h3";
import { PortalError, activeChildren, handle, requireFamily, setup } from "../../lib/portal";
import { cancelApptRequest, createApptRequest } from "../../lib/apptRequests";

// POST /api/portal/pedido-turno — pedidos de turno (el centro asigna día y hora)
//   { action: "create", patient_id, reason, days, band, modality, note } → ApptRequestDTO
//   { action: "cancel", id }                                             → ApptRequestDTO (solo si sigue abierto)
// Lo puede pedir cualquier adulto con acceso a los turnos de esa persona.
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const body = (await readBody(event)) as Record<string, unknown> | null;
  const children = await activeChildren(ctx, account);
  if (body?.action === "create") return createApptRequest(ctx, account, children, String(body.patient_id ?? ""), body);
  if (body?.action === "cancel") return cancelApptRequest(ctx, account, children, String(body.id ?? ""));
  throw new PortalError(400, "Pedido inválido");
}));
