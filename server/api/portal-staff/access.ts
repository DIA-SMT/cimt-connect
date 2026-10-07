import { defineEventHandler, readBody } from "nitro/h3";
import { isValidDni, normalizeDni, samePhone } from "../../../src/lib/portalRules";
import { type GuardianKind, type InviteChild, type Invitation, INVITATION_MAX_FAILS, codeHash, validChildren } from "../../lib/invitations";
import { type Ctx, PortalError, accountLinks, formatCode, handle, newCode, requireStaff, setup } from "../../lib/portal";

// POST /api/portal-staff/access — acciones del equipo sobre el portal.
// Cualquier persona activa del panel (todos los roles) puede usarlas.
//
//   { action: "status", patient_id, guardian_id? } → estado del acceso para
//     ese chico: del adulto responsable (guardian_id) o, sin guardian_id, del
//     propio paciente adulto (chips en la ficha)
//   { action: "invite", ... } → invita a un adulto responsable
//   { action: "invite_self", patient_id, ... } → invita al propio paciente adulto
//   Las invitaciones devuelven el código UNA sola vez.
//
// El servidor vuelve a validar contra la base todo lo que el panel ya chequeó.

type Common = {
  identity_checked_on: string;
  in_person: boolean;
  channel: "whatsapp" | "impresa";
  expires_days: number;
};
type InviteBody = Common & {
  action: "invite";
  guardian: { id: string };
  children: { id: string; guardian_id: string }[];
  adolescent_consents?: string[];
  relationship_kind: "representante_legal" | "autorizado";
  authorized_by?: string;
};
type InviteSelfBody = Common & { action: "invite_self"; patient_id: string };
type StatusBody = { action: "status"; patient_id: string; guardian_id?: string };

const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const staff = await requireStaff(ctx, event);
  const body = (await readBody(event)) as InviteBody | InviteSelfBody | StatusBody | null;

  if (body?.action === "status") return status(ctx, body);
  if (body?.action !== "invite" && body?.action !== "invite_self") throw new PortalError(400, "Acción inválida");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.identity_checked_on))) throw new PortalError(400, "Indicá cuándo se vio el DNI en persona.");
  const common = {
    identity_checked_on: body.identity_checked_on,
    in_person: !!body.in_person,
    channel: body.channel === "impresa" ? "impresa" : "whatsapp",
    expires_days: Math.min(30, Math.max(1, Math.round(Number(body.expires_days) || 7))),
  } as const;

  // ── Invitar al propio paciente adulto ──
  if (body.action === "invite_self") {
    if (!isUuid(body.patient_id)) throw new PortalError(400, "Pedido inválido");
    // DNI y teléfono salen de la ficha, no del pedido
    const { data: p } = await ctx.admin.from("patients")
      .select("id, first_name, last_name, dni, phone, guardian_phone").eq("id", body.patient_id).maybeSingle();
    const dni = normalizeDni(p?.dni ?? "");
    if (!p || !isValidDni(dni)) throw new PortalError(400, "Falta el DNI del paciente en la ficha.");
    const requested: InviteChild[] = [{ patient_id: p.id as string, guardian_id: null, self: true }];
    if (!(await validChildren(ctx, dni, requested)).length) {
      throw new PortalError(400, "El paciente tiene que ser mayor de edad, tener la fecha de nacimiento cargada y no tener el alta.");
    }
    // En fichas de cuando era chico, el teléfono suele ser el de la familia:
    // el código le llegaría a otra persona
    if (common.channel === "whatsapp") {
      // También los adultos que se quitaron de la ficha
      const { data: gs, error: gErr } = await ctx.admin.from("patient_guardians").select("phone").eq("patient_id", p.id);
      if (gErr) throw new PortalError(503, "No se pudo revisar el teléfono. Probá de nuevo.");
      const phones = [p.guardian_phone as string | null, ...(gs ?? []).map((g) => g.phone as string | null)];
      if (phones.some((x) => samePhone(p.phone as string | null, x))) {
        throw new PortalError(400, "El teléfono del paciente es el mismo que el de un adulto responsable. Entregá la invitación impresa o corregí el teléfono.");
      }
    }
    return issue(ctx, staff.email, {
      dni, first_name: p.first_name as string, last_name: p.last_name as string, phone: (p.phone as string) ?? null,
      requested, relationship_kind: "titular", authorized_by: null, ...common,
    });
  }

  // ── Invitar a un adulto responsable ──
  if (!isUuid(body.guardian?.id)) throw new PortalError(400, "Pedido inválido");
  if (!Array.isArray(body.children) || !body.children.length || body.children.some((c) => !isUuid(c.id) || !isUuid(c.guardian_id))) {
    throw new PortalError(400, "Elegí al menos un chico.");
  }
  if (!["representante_legal", "autorizado"].includes(body.relationship_kind)) throw new PortalError(400, "Elegí el tipo de vínculo.");
  const authorizedBy = body.relationship_kind === "autorizado" ? String(body.authorized_by ?? "").trim() : null;
  if (body.relationship_kind === "autorizado" && (!authorizedBy || authorizedBy.length < 3)) {
    throw new PortalError(400, "Indicá quién autorizó a este adulto.");
  }
  const { data: guardian } = await ctx.admin.from("patient_guardians")
    .select("id, full_name, dni, phone, active").eq("id", body.guardian.id).maybeSingle();
  const dni = normalizeDni(guardian?.dni ?? "");
  if (!guardian?.active || !isValidDni(dni)) throw new PortalError(400, "Falta el DNI del adulto responsable en la ficha.");

  const consents = new Set(body.adolescent_consents ?? []);
  const requested: InviteChild[] = [...new Map(body.children.map((c) => [c.id, c])).values()]
    .map((c) => ({
      patient_id: c.id, guardian_id: c.guardian_id, consent: consents.has(c.id),
      kind: body.relationship_kind, authorized_by: authorizedBy,
    }));
  if ((await validChildren(ctx, dni, requested)).length !== requested.length) {
    throw new PortalError(400, "Algún chico no cumple los requisitos (fecha de nacimiento, menor de 18, sin alta o conformidad a partir de los 16). Revisá las fichas.");
  }
  const parts = String(guardian.full_name).trim().split(/\s+/);
  return issue(ctx, staff.email, {
    dni, first_name: parts[0], last_name: parts.slice(1).join(" "), phone: (guardian.phone as string) ?? null,
    requested, relationship_kind: body.relationship_kind, authorized_by: authorizedBy, ...common,
  });
}));

// Estado del acceso al portal para la ficha de un paciente
async function status(ctx: Ctx, body: StatusBody) {
  if (!isUuid(body.patient_id) || (body.guardian_id !== undefined && !isUuid(body.guardian_id))) throw new PortalError(400, "Pedido inválido");
  const self = !body.guardian_id;
  const { data: row } = self
    ? await ctx.admin.from("patients").select("dni").eq("id", body.patient_id).maybeSingle()
    : await ctx.admin.from("patient_guardians").select("dni").eq("id", body.guardian_id!).maybeSingle();
  const dni = normalizeDni(row?.dni ?? "");
  if (!isValidDni(dni)) return { state: "sin_dni" };
  const { data: acc } = await ctx.admin.from("portal_accounts").select("id, active").eq("dni", dni).maybeSingle();
  if (acc) {
    // Solo cuenta un vínculo que hoy vale (si no, se puede volver a invitar)
    const link = (await accountLinks(ctx, { id: acc.id as string, dni }))
      .find((l) => l.patient_id === body.patient_id && l.self === self && l.valid);
    if (link) return { state: acc.active ? "activo" : "pausado" };
  }
  const { data: invs } = await ctx.admin.from("portal_invitations")
    .select("children, expires_at, failed_attempts, created_at")
    .eq("dni", dni).is("used_at", null).is("revoked_at", null).neq("purpose", "recuperacion")
    .order("created_at", { ascending: false });
  const inv = (invs ?? []).find((i) => (i.children as InviteChild[]).some((c) => c.patient_id === body.patient_id && !!c.self === self));
  if (inv) {
    if ((inv.failed_attempts as number) >= INVITATION_MAX_FAILS) return { state: "bloqueada" };
    if (Date.parse(inv.expires_at as string) < Date.now()) return { state: "vencida" };
    return { state: "invitado", expires_at: inv.expires_at };
  }
  return { state: "ninguno", has_account: !!acc };
}

// Genera la invitación. Si la persona ya tiene cuenta, el código suma los
// chicos (o su propia ficha) a esa cuenta. Una invitación nueva reemplaza a
// las pendientes del mismo DNI, pero conserva sus chicos.
async function issue(ctx: Ctx, staffEmail: string, o: {
  dni: string; first_name: string; last_name: string; phone: string | null;
  requested: InviteChild[]; relationship_kind: GuardianKind | "titular"; authorized_by: string | null;
  identity_checked_on: string; in_person: boolean; channel: "whatsapp" | "impresa"; expires_days: number;
}) {
  const { data: acc } = await ctx.admin.from("portal_accounts").select("id, active").eq("dni", o.dni).maybeSingle();
  if (acc && !acc.active) throw new PortalError(409, "La cuenta de esta persona está pausada. Reactivala antes de invitar.");
  const links = acc ? await accountLinks(ctx, { id: acc.id as string, dni: o.dni }) : [];
  const has = (c: InviteChild) => links.some((l) => l.valid && l.patient_id === c.patient_id && l.self === !!c.self);
  const children = o.requested.filter((c) => !has(c));
  if (!children.length) {
    throw new PortalError(409, o.requested.some((c) => c.self)
      ? `${o.first_name} ya tiene acceso a sus turnos en el portal.`
      : `${o.first_name} ya tiene acceso a esos chicos en el portal.`);
  }

  const nowIso = new Date().toISOString();
  const { data: pending } = await ctx.admin.from("portal_invitations")
    .select("id, children, expires_at, failed_attempts, relationship_kind, authorized_by")
    .eq("dni", o.dni).is("used_at", null).is("revoked_at", null).neq("purpose", "recuperacion");
  const previous = (pending ?? []) as Pick<Invitation, "id" | "children" | "expires_at" | "failed_attempts" | "relationship_kind" | "authorized_by">[];
  const live = previous.filter((p) => Date.parse(p.expires_at) > Date.now());
  for (const p of live) {
    for (const c of p.children) {
      const same = (x: InviteChild) => x.patient_id === c.patient_id && !!x.self === !!c.self;
      if (has(c) || children.some(same)) continue;
      // Cada chico conserva el vínculo con el que se lo invitó
      const legacyKind = p.relationship_kind === "titular" ? null : p.relationship_kind;
      children.push(c.self || c.kind ? c : { ...c, kind: legacyKind ?? "representante_legal", authorized_by: p.authorized_by });
    }
  }
  const finalValid = await validChildren(ctx, o.dni, children);
  if (!finalValid.length) throw new PortalError(400, "No hay nada para invitar: revisá las fichas.");

  const code = newCode();
  const expiresAt = new Date(Date.now() + o.expires_days * 24 * 60 * 60 * 1000).toISOString();
  const purpose = acc ? "vincular" : "activacion";
  const { error } = await ctx.admin.from("portal_invitations").insert({
    code_hash: codeHash(ctx, code),
    dni: o.dni,
    purpose,
    first_name: o.first_name,
    last_name: o.last_name,
    account_id: acc?.id ?? null,
    children: finalValid.map((v) => v.child),
    relationship_kind: o.relationship_kind,
    authorized_by: o.authorized_by,
    phone: o.phone,
    in_person: o.in_person,
    channel: o.channel,
    identity_checked_on: o.identity_checked_on,
    issued_by_email: staffEmail,
    expires_at: expiresAt,
  });
  if (error) throw new PortalError(503, "No se pudo generar la invitación. Probá de nuevo.");
  // Recién con la nueva guardada se anulan las anteriores
  if (previous.length) {
    await ctx.admin.from("portal_invitations").update({ revoked_at: nowIso }).in("id", previous.map((p) => p.id));
  }

  return {
    code: formatCode(code),
    raw_code: code,
    purpose,
    expires_at: expiresAt,
    first_name: o.first_name,
    children: finalValid.filter((v) => !v.child.self).map((v) => v.patient.first_name),
    self: finalValid.some((v) => v.child.self),
    // Había otro código que todavía servía: ese deja de funcionar
    replaced: live.some((p) => p.failed_attempts < INVITATION_MAX_FAILS),
  };
}
