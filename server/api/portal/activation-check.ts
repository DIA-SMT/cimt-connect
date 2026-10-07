import { defineEventHandler, readBody } from "nitro/h3";
import { isValidDni, normalizeCode, normalizeDni } from "../../../src/lib/portalRules";
import { GENERIC_CODE, findInvitation, shortName, validChildren } from "../../lib/invitations";
import { type Account, PortalError, activeChildren, handle, setup, withFloor } from "../../lib/portal";

// POST /api/portal/activation-check { dni, code }
// → { purpose, guardian_first_name, children, needs, needs_privacy }
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const body = (await readBody(event)) as { dni?: string; code?: string } | null;
  const dni = normalizeDni(body?.dni ?? "");
  const code = normalizeCode(body?.code ?? "");

  return withFloor(1200, async () => {
    if (!isValidDni(dni)) throw new PortalError(400, GENERIC_CODE);
    const inv = await findInvitation(ctx, dni, code);

    const { data: acc } = await ctx.admin.from("portal_accounts")
      .select("id, user_id, dni, first_name, last_name, active").eq("dni", dni).maybeSingle();
    if (inv.purpose === "activacion" && acc) {
      throw new PortalError(409, "Ya tenés una cuenta con este DNI. Ingresá con tu contraseña.", { code: "ACCOUNT_EXISTS" });
    }

    // Chicos a cargo por nombre; el propio titular va aparte ("tus turnos")
    let children: string[];
    let self: boolean;
    if (inv.purpose === "recuperacion") {
      const active = acc ? await activeChildren(ctx, acc as Account) : [];
      children = active.filter((c) => !c.self).map((c) => `${c.first_name} ${c.last_name.charAt(0)}.`);
      self = active.some((c) => c.self);
    } else {
      const valid = await validChildren(ctx, dni, inv.children);
      if (!valid.length) throw new PortalError(400, "Este código ya no sirve. Pedí uno nuevo en el centro.");
      children = valid.filter((v) => !v.child.self).map((v) => shortName(v.patient));
      self = valid.some((v) => v.child.self);
    }
    return {
      purpose: inv.purpose,
      guardian_first_name: inv.first_name,
      children,
      self,
      needs: inv.purpose === "vincular" ? "current_password" : "new_password",
      needs_privacy: inv.purpose === "activacion",
    };
  });
}));
