import { defineEventHandler, readBody } from "nitro/h3";
import { isValidDni, normalizeDni } from "../../../src/lib/portalRules";
import { PortalError, handle, setup, withFloor } from "../../lib/portal";

// POST /api/portal/recovery { dni } → { ok: true }
// "Olvidé mi contraseña": deja el pedido para que el centro genere un código
// nuevo. Responde siempre lo mismo (no revela si el DNI tiene cuenta).
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const body = (await readBody(event)) as { dni?: string } | null;
  const dni = normalizeDni(body?.dni ?? "");
  return withFloor(1200, async () => {
    if (!isValidDni(dni)) throw new PortalError(400, "Revisá tu DNI: tiene que tener entre 6 y 10 números.");
    await ctx.admin.from("portal_accounts")
      .update({ recovery_requested_at: new Date().toISOString() })
      .eq("dni", dni).eq("active", true);
    return { ok: true };
  });
}));
