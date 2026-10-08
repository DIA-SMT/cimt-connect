import { defineEventHandler, readBody } from "nitro/h3";
import { PortalError, handle, requireStaff, setup } from "../../lib/portal";
import { staffHcList, staffHcNotes, staffHcPendingCount, staffHcUpdate, staffNotices, staffResolveNotice } from "../../lib/requests";

// POST /api/portal-staff/inbox — bandeja del portal en el panel.
// Cualquier persona activa del panel (todos los roles) puede usarla.
//
//   { action: "list" }  → { hc, notices }
//   { action: "count" } → { hc_pending, notices_pending } (para el número de la pestaña)
//   { action: "hc_update", id, to, delivered_to_name?, delivered_to_dni?, reject_reason? }
//   { action: "hc_notes", id, notes }
//   { action: "notice_resolve", response_id, how }
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const staff = await requireStaff(ctx, event);
  const body = (await readBody(event)) as Record<string, unknown> | null;

  switch (body?.action) {
    case "list": {
      const [hc, notices] = await Promise.all([staffHcList(ctx), staffNotices(ctx)]);
      return { hc, notices };
    }
    case "count": {
      const [hcPending, notices] = await Promise.all([staffHcPendingCount(ctx), staffNotices(ctx)]);
      return { hc_pending: hcPending, notices_pending: notices.filter((n) => n.resolution === null).length };
    }
    case "hc_update":
      return staffHcUpdate(ctx, staff.email, body);
    case "hc_notes":
      return staffHcNotes(ctx, staff.email, body);
    case "notice_resolve":
      return staffResolveNotice(ctx, staff, body);
    default:
      throw new PortalError(400, "Acción inválida");
  }
}));
