import { defineEventHandler, readBody } from "nitro/h3";
import { isValidDni, normalizeDni } from "../../../src/lib/portalRules";
import {
  AUTH_BUSY, PortalError, authUnavailable, clearFailures, familyEmail, handle, lockedUntil, registerFailure, setup, withFloor,
} from "../../lib/portal";

// POST /api/portal/login { dni, password } → { first_name, session }
// Mismo mensaje y mismo tiempo de respuesta exista o no la cuenta.
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const body = (await readBody(event)) as { dni?: string; password?: string } | null;
  const dni = normalizeDni(body?.dni ?? "");
  const password = String(body?.password ?? "");

  return withFloor(1200, async () => {
    if (!isValidDni(dni)) throw new PortalError(400, "Revisá tu DNI: tiene que tener entre 6 y 10 números.");
    const locked = await lockedUntil(ctx, dni);
    if (locked) throw new PortalError(429, "Hiciste muchos intentos.", { retry_at: locked });

    const { data: acc } = await ctx.admin.from("portal_accounts")
      .select("id, first_name, active").eq("dni", dni).maybeSingle();

    // Con o sin cuenta se hace el mismo intento contra Auth
    const client = ctx.anon();
    const { data, error } = await client.auth.signInWithPassword({
      email: familyEmail(acc?.id ?? "00000000-0000-0000-0000-000000000000"),
      password: password || "-",
    });
    if (authUnavailable(error)) throw new PortalError(503, AUTH_BUSY);
    if (error || !data.session || !acc || data.user?.app_metadata?.kind !== "family") {
      await registerFailure(ctx, dni);
      throw new PortalError(401, "DNI o contraseña incorrectos.");
    }
    if (!acc.active) {
      await client.auth.signOut();
      throw new PortalError(403, "Tu acceso al portal está pausado. Llamanos al 381 258-4491.", { code: "PAUSED" });
    }
    await clearFailures(ctx, dni);
    await ctx.admin.from("portal_accounts").update({ last_login_at: new Date().toISOString() }).eq("id", acc.id);
    return {
      first_name: acc.first_name as string,
      session: { access_token: data.session.access_token, refresh_token: data.session.refresh_token },
    };
  });
}));
