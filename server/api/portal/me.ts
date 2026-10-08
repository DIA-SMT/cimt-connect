import { defineEventHandler } from "nitro/h3";
import { canRequestHc } from "../../../src/lib/portalRules";
import { activeChildren, addDaysKey, appointmentsFor, centerNow, handle, requireFamily, setup } from "../../lib/portal";
import { hcRequestsFor } from "../../lib/requests";

// GET /api/portal/me → { guardian_first_name, week, children, requests }
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const children = await activeChildren(ctx, account);
  const today = centerNow().date;
  const weekEnd = addDaysKey(today, 6);
  const [all, requests] = await Promise.all([
    appointmentsFor(ctx, account, children, today, addDaysKey(today, 90)),
    hcRequestsFor(ctx, account, children),
  ]);
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
    })),
    requests,
  };
}));
