import { defineEventHandler } from "nitro/h3";
import { canRequestHc } from "../../../src/lib/portalRules";
import { apptRequestsFor } from "../../lib/apptRequests";
import { activeChildren, addDaysKey, appointmentsFor, centerNow, handle, requireFamily, setup } from "../../lib/portal";
import { childrenClinical, familyClinical, features } from "../../lib/portalClinical";
import { infoNewCounts } from "../../lib/portalInfo";
import { hcRequestsFor } from "../../lib/requests";

// GET /api/portal/me → { guardian_first_name, week, children, requests, appt_requests, can_request_appts, clinical? }
// appt_requests: pedidos de turno de todas sus personas, los haya hecho el adulto que sea.
// can_request_appts: se pueden pedir turnos desde el portal (false: no invitar a pedirlos).
// clinical (y children[].clinical) solo viajan con la etapa "consent" prendida;
// children[].clinical.info_new (lo nuevo en "Mi información"), con la etapa "info".
// clinical.features nombra "hc_digital" solo si la copia digital está
// disponible de verdad (con el script 25 corrido): familyClinical lo averigua.
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const children = await activeChildren(ctx, account);
  const today = centerNow().date;
  const weekEnd = addDaysKey(today, 6);
  const withClinical = features().includes("consent");
  const [all, requests, apptRequests, clinical, perChild] = await Promise.all([
    appointmentsFor(ctx, account, children, today, addDaysKey(today, 90)),
    hcRequestsFor(ctx, account, children),
    apptRequestsFor(ctx, account, children),
    withClinical ? familyClinical(ctx, account) : Promise.resolve(undefined),
    withClinical ? childrenClinical(ctx, account) : Promise.resolve(undefined),
  ]);
  // Lo nuevo en "Mi información", solo de quienes la cuenta puede ver
  const infoOk = perChild && features().includes("info")
    ? [...perChild].filter(([, v]) => v.info === "ok").map(([id]) => id)
    : [];
  const fresh = infoOk.length ? await infoNewCounts(ctx, account, infoOk) : new Map<string, number>();
  for (const id of infoOk) perChild!.get(id)!.info_new = fresh.get(id) ?? 0;
  return {
    guardian_first_name: account.first_name,
    week: all.filter((a) => a.date <= weekEnd),
    children: children.map((c) => ({
      id: c.patient_id,
      first_name: c.display,
      last_initial: `${c.last_name.charAt(0)}.`,
      self: c.self,
      can_request_hc: canRequestHc(c.kind),
      next: all.find((a) => a.child_id === c.patient_id && a.date > weekEnd && a.state === "agendado") ?? null,
      ...(perChild ? { clinical: perChild.get(c.patient_id) ?? { info: "not_available", practice: "not_available" } } : {}),
    })),
    requests,
    appt_requests: apptRequests ?? [],
    // null: el servidor todavía no tiene los pedidos de turno (falta el script
    // 23). apptRequestsFor se fija aunque la cuenta no tenga personas vinculadas
    can_request_appts: apptRequests !== null,
    ...(clinical ? { clinical } : {}),
  };
}));
