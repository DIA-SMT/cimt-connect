import { defineEventHandler, getQuery } from "nitro/h3";
import { canRequestHc } from "../../../src/lib/portalRules";
import { apptRequestsFor, canRequestAppt } from "../../lib/apptRequests";
import {
  PortalError, activeChildren, addDaysKey, appointmentsFor, centerNow, handle, requireFamily, setup,
} from "../../lib/portal";
import { features } from "../../lib/portalClinical";
import { hcDigitalOffer, hcRequestsFor } from "../../lib/requests";

// GET /api/portal/child?id=<patient_id> → { child, info_on, appointments, hc, turnos } (turnos de los próximos 90 días)
// info_on: el servidor tiene prendida "Mi información" (etapa "info"); si no,
// la página de información no la pide y muestra solo la copia del historial.
// Un chico ajeno da el mismo 404 que uno que no existe.
// hc.digital (etapa "hc_digital", con el script 25 corrido): offered = se
// ofrece recibir la copia en el portal; blocked = por qué esta cuenta todavía
// no puede ("consent": activar la información de salud, "verify": verificar
// el vínculo en el centro, "not_available": no corresponde, por ejemplo con
// el portal del paciente en pausa; nunca se dice el motivo) o null si puede.
// Pedirla en mano se puede siempre (can_request).
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const id = String(getQuery(event).id ?? "");
  const children = await activeChildren(ctx, account);
  const child = children.find((c) => c.patient_id === id);
  if (!child) throw new PortalError(404, "No encontramos a ese chico en tu cuenta.");
  const today = centerNow().date;
  const [appointments, requests, turnos, digital] = await Promise.all([
    appointmentsFor(ctx, account, [child], today, addDaysKey(today, 90)),
    hcRequestsFor(ctx, account, [child], child.patient_id),
    apptRequestsFor(ctx, account, [child], child.patient_id),
    hcDigitalOffer(ctx, account, child),
  ]);
  return {
    child: { id: child.patient_id, first_name: child.display, self: child.self },
    info_on: features().includes("info"),
    appointments,
    // Copia de la historia clínica: si esta cuenta puede pedirla y sus pedidos
    hc: { can_request: canRequestHc(child.kind), requests, digital },
    // Pedidos de turno de esta persona (de cualquier adulto de la familia).
    // enabled: el servidor tiene los pedidos de turno (null: falta el script 24)
    // · can_request: se puede pedir uno ahora (no hay otro abierto)
    turnos: { enabled: turnos !== null, can_request: canRequestAppt(turnos, child.patient_id), requests: turnos ?? [] },
  };
}));
