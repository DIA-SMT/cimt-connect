import { randomUUID } from "node:crypto";
import { defineEventHandler, readBody } from "nitro/h3";
import { PRIVACY_VERSION, isValidDni, normalizeCode, normalizeDni, passwordProblem } from "../../../src/lib/portalRules";
import {
  GENERIC_CODE, INVITATION_MAX_FAILS, claim, countFailure, findInvitation, linkChildren, release, validChildren,
} from "../../lib/invitations";
import {
  AUTH_BUSY, PortalError, authUnavailable, clearFailures, familyEmail, handle, lockedUntil, registerFailure, setup, withFloor,
} from "../../lib/portal";

// POST /api/portal/activation-complete
//   { dni, code, password, password_repeat, accept_privacy_version? }
// → { first_name, children, session }
//
// activacion: crea la cuenta (usuario de Auth marcado como familia) y los vínculos.
// vincular: suma chicos a una cuenta existente; se confirma con la contraseña actual.
// recuperacion: elige una contraseña nueva.
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const body = (await readBody(event)) as {
    dni?: string; code?: string; password?: string; password_repeat?: string; accept_privacy_version?: string;
  } | null;
  const dni = normalizeDni(body?.dni ?? "");
  const code = normalizeCode(body?.code ?? "");
  const password = String(body?.password ?? "");
  const repeat = String(body?.password_repeat ?? "");

  return withFloor(1200, async () => {
    if (!isValidDni(dni)) throw new PortalError(400, GENERIC_CODE);
    const inv = await findInvitation(ctx, dni, code);
    const signIn = async (accountId: string) => {
      const { data, error } = await ctx.anon().auth.signInWithPassword({ email: familyEmail(accountId), password });
      if (authUnavailable(error)) throw new PortalError(503, AUTH_BUSY);
      return error || !data.session ? null : data.session;
    };

    // ── Sumar chicos a una cuenta que ya existe ──
    if (inv.purpose === "vincular") {
      const { data: acc } = await ctx.admin.from("portal_accounts").select("id, first_name, active").eq("dni", dni).maybeSingle();
      if (!acc?.active) throw new PortalError(400, GENERIC_CODE);
      const locked = await lockedUntil(ctx, dni);
      if (locked) throw new PortalError(429, "Hiciste muchos intentos.", { retry_at: locked });
      const session = await signIn(acc.id as string);
      if (!session) {
        await registerFailure(ctx, dni);
        await countFailure(ctx, inv); // con 5 errores el código deja de servir
        const left = INVITATION_MAX_FAILS - inv.failed_attempts - 1;
        throw new PortalError(400, left > 0 ? "La contraseña no es correcta." : GENERIC_CODE, { code: left > 0 ? "PASSWORD" : undefined });
      }
      await claim(ctx, inv);
      const added = await linkChildren(ctx, acc.id as string, inv);
      await clearFailures(ctx, dni);
      return { first_name: acc.first_name, children: added, session: tokens(session) };
    }

    const problem = passwordProblem(password, repeat, dni);
    if (problem) throw new PortalError(400, problem, { code: "PASSWORD" });

    // ── Contraseña nueva ──
    if (inv.purpose === "recuperacion") {
      const { data: acc } = await ctx.admin.from("portal_accounts")
        .select("id, user_id, first_name, active").eq("id", inv.account_id ?? "").maybeSingle();
      if (!acc?.active) throw new PortalError(400, GENERIC_CODE);
      await claim(ctx, inv);
      const { error } = await ctx.admin.auth.admin.updateUserById(acc.user_id as string, { password });
      if (error) { await release(ctx, inv); throw new PortalError(503, "No pudimos guardar la contraseña. Probá de nuevo."); }
      // Pendiente: cerrar las sesiones abiertas en otros dispositivos
      await ctx.admin.from("portal_accounts").update({ recovery_requested_at: null, updated_at: new Date().toISOString() }).eq("id", acc.id);
      await clearFailures(ctx, dni);
      const session = await signIn(acc.id as string);
      if (!session) throw new PortalError(503, "Tu contraseña se guardó. Ingresá con tu DNI y la contraseña nueva.");
      return { first_name: acc.first_name, children: [], session: tokens(session) };
    }

    // ── Cuenta nueva ──
    if (body?.accept_privacy_version !== PRIVACY_VERSION) {
      throw new PortalError(400, "Para usar el portal tenés que aceptar el aviso de privacidad.", { code: "PRIVACY" });
    }
    const { data: existing } = await ctx.admin.from("portal_accounts").select("id").eq("dni", dni).maybeSingle();
    if (existing) throw new PortalError(409, "Ya tenés una cuenta con este DNI. Ingresá con tu contraseña.", { code: "ACCOUNT_EXISTS" });
    if (!(await validChildren(ctx, dni, inv.children)).length) {
      throw new PortalError(400, "Este código ya no sirve. Pedí uno nuevo en el centro.");
    }

    await claim(ctx, inv);
    const accountId = randomUUID();
    const { data: created, error: authError } = await ctx.admin.auth.admin.createUser({
      email: familyEmail(accountId),
      password,
      email_confirm: true,
      app_metadata: { kind: "family" },
    });
    if (authError || !created.user) {
      await release(ctx, inv);
      console.error("[portal] no se pudo crear el usuario de Auth:", authError?.status ?? "", authError?.code ?? "");
      throw new PortalError(503, "No pudimos crear tu cuenta. Probá de nuevo en un rato.");
    }
    const now = new Date().toISOString();
    const { error: rowError } = await ctx.admin.from("portal_accounts").insert({
      id: accountId,
      user_id: created.user.id,
      dni,
      first_name: inv.first_name,
      last_name: inv.last_name,
      privacy_version: PRIVACY_VERSION,
      privacy_accepted_at: now,
      // El teléfono queda verificado solo si la persona estaba en el centro
      verified_phone: inv.in_person ? inv.phone : null,
    });
    if (rowError) {
      // No dejar un usuario de Auth suelto sin cuenta
      await ctx.admin.auth.admin.deleteUser(created.user.id);
      await release(ctx, inv);
      throw new PortalError(503, "No pudimos crear tu cuenta. Probá de nuevo en un rato.");
    }
    const added = await linkChildren(ctx, accountId, inv);
    await clearFailures(ctx, dni);
    const session = await signIn(accountId);
    if (!session) throw new PortalError(503, "Tu cuenta quedó creada. Ingresá con tu DNI y tu contraseña.");
    return { first_name: inv.first_name, children: added, session: tokens(session) };
  });
}));

function tokens(s: { access_token: string; refresh_token: string }) {
  return { access_token: s.access_token, refresh_token: s.refresh_token };
}
