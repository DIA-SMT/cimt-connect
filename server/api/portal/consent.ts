import { defineEventHandler, readBody } from "nitro/h3";
import { PortalError, clearFailures, handle, lockedUntil, registerFailure, requireFamily, setup, withFloor } from "../../lib/portal";
import { familyClinical, markStepUp, recordConsent, requireFeature, verifyAccountPassword } from "../../lib/portalClinical";

// POST /api/portal/consent — "información de salud" en el portal
//   { accept: true, password }  activarla (acepta el aviso vigente; pide la contraseña)
//   { accept: false }           dejar de verla (solo para esta cuenta)
// → FamilyClinicalDTO
export default defineEventHandler((event) => handle(event, async () => {
  requireFeature("consent");
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const body = (await readBody(event)) as { accept?: unknown; password?: unknown } | null;

  if (body?.accept === false) {
    await recordConsent(ctx, account.id, false);
    return familyClinical(ctx, account);
  }
  if (body?.accept !== true) throw new PortalError(400, "Pedido inválido");

  // La contraseña confirma que es la persona dueña de la cuenta
  return withFloor(1200, async () => {
    const locked = await lockedUntil(ctx, account.dni);
    if (locked) throw new PortalError(429, "Hiciste muchos intentos.", { retry_at: locked });
    if (!(await verifyAccountPassword(ctx, account, String(body.password ?? "")))) {
      await registerFailure(ctx, account.dni);
      throw new PortalError(400, "La contraseña no es correcta.", { code: "PASSWORD" });
    }
    await clearFailures(ctx, account.dni);
    await recordConsent(ctx, account.id, true);
    await markStepUp(ctx, event, account);
    return familyClinical(ctx, account);
  });
}));
