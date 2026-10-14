import { defineEventHandler, readBody } from "nitro/h3";
import { PortalError, clearFailures, handle, lockedUntil, registerFailure, requireFamily, setup, withFloor } from "../../lib/portal";
import { markStepUp, requireFeature, verifyAccountPassword } from "../../lib/portalClinical";

// POST /api/portal/reauth { password } → { ok: true }
// "Volvé a poner tu contraseña" antes de ver información de salud o de
// descargar un documento. No abre una sesión nueva: marca la actual.
export default defineEventHandler((event) => handle(event, async () => {
  requireFeature("consent");
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const body = (await readBody(event)) as { password?: unknown } | null;
  return withFloor(1200, async () => {
    const locked = await lockedUntil(ctx, account.dni);
    if (locked) throw new PortalError(429, "Hiciste muchos intentos.", { retry_at: locked });
    if (!(await verifyAccountPassword(ctx, account, String(body?.password ?? "")))) {
      await registerFailure(ctx, account.dni);
      throw new PortalError(400, "La contraseña no es correcta.", { code: "PASSWORD" });
    }
    await clearFailures(ctx, account.dni);
    await markStepUp(ctx, event, account);
    return { ok: true as const };
  });
}));
