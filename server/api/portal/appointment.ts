import { defineEventHandler, getQuery } from "nitro/h3";
import { PortalError, activeChildren, appointmentById, handle, requireFamily, setup } from "../../lib/portal";

// GET /api/portal/appointment?id=<appointment_id> → ApptDTO
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const appt = await appointmentById(ctx, account, await activeChildren(ctx, account), String(getQuery(event).id ?? ""));
  if (!appt) throw new PortalError(404, "No encontramos ese turno en tu cuenta.");
  return appt;
}));
