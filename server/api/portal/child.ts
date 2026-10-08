import { defineEventHandler, getQuery } from "nitro/h3";
import { canRequestHc } from "../../../src/lib/portalRules";
import {
  PortalError, activeChildren, addDaysKey, appointmentsFor, centerNow, handle, requireFamily, setup,
} from "../../lib/portal";
import { hcRequestsFor } from "../../lib/requests";

// GET /api/portal/child?id=<patient_id> → { child, appointments, hc } (turnos de los próximos 90 días)
// Un chico ajeno da el mismo 404 que uno que no existe.
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const id = String(getQuery(event).id ?? "");
  const children = await activeChildren(ctx, account);
  const child = children.find((c) => c.patient_id === id);
  if (!child) throw new PortalError(404, "No encontramos a ese chico en tu cuenta.");
  const today = centerNow().date;
  const [appointments, requests] = await Promise.all([
    appointmentsFor(ctx, account, [child], today, addDaysKey(today, 90)),
    hcRequestsFor(ctx, account, [child], child.patient_id),
  ]);
  return {
    child: { id: child.patient_id, first_name: child.display, self: child.self },
    appointments,
    // Copia de la historia clínica: si esta cuenta puede pedirla y sus pedidos
    hc: { can_request: canRequestHc(child.kind), requests },
  };
}));
