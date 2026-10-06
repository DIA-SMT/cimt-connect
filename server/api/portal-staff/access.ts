import { defineEventHandler, readBody } from "nitro/h3";
import { isValidDni, normalizeDni } from "../../../src/lib/portalRules";
import { type InviteChild, type Invitation, INVITATION_MAX_FAILS, codeHash, validChildren } from "../../lib/invitations";
import { PortalError, accountLinks, formatCode, handle, newCode, requireStaff, setup } from "../../lib/portal";

// POST /api/portal-staff/access — acciones del equipo sobre el portal.
// Cualquier persona activa del panel (todos los roles) puede usarlas.
//
//   { action: "status", guardian_id, patient_id } → estado del acceso de ese
//     adulto para ese chico (para el chip en Adultos responsables)
//   { action: "invite", ... } → genera una invitación y devuelve el código UNA vez
//
// El servidor vuelve a validar contra la base todo lo que el panel ya chequeó.

type InviteBody = {
  action: "invite";
  guardian: { id: string };
  children: { id: string; guardian_id: string }[];
  adolescent_consents?: string[];
  relationship_kind: "representante_legal" | "autorizado";
  authorized_by?: string;
  identity_checked_on: string;
  in_person: boolean;
  channel: "whatsapp" | "impresa";
  expires_days: number;
};
type StatusBody = { action: "status"; guardian_id: string; patient_id: string };

const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const staff = await requireStaff(ctx, event);
  const body = (await readBody(event)) as InviteBody | StatusBody | null;

  // ── Estado del acceso ──
  if (body?.action === "status") {
    if (!isUuid(body.guardian_id) || !isUuid(body.patient_id)) throw new PortalError(400, "Pedido inválido");
    const { data: g } = await ctx.admin.from("patient_guardians").select("dni").eq("id", body.guardian_id).maybeSingle();
    const dni = normalizeDni(g?.dni ?? "");
    if (!isValidDni(dni)) return { state: "sin_dni" };
    const { data: acc } = await ctx.admin.from("portal_accounts").select("id, active").eq("dni", dni).maybeSingle();
    if (acc) {
      // Solo cuenta un vínculo que hoy vale (si no, se puede volver a invitar)
      const link = (await accountLinks(ctx, { id: acc.id as string, dni })).find((l) => l.patient_id === body.patient_id && l.valid);
      if (link) return { state: acc.active ? "activo" : "pausado" };
    }
    const { data: invs } = await ctx.admin.from("portal_invitations")
      .select("children, expires_at, failed_attempts, created_at")
      .eq("dni", dni).is("used_at", null).is("revoked_at", null).neq("purpose", "recuperacion")
      .order("created_at", { ascending: false });
    const inv = (invs ?? []).find((i) => (i.children as InviteChild[]).some((c) => c.patient_id === body.patient_id));
    if (inv) {
      if ((inv.failed_attempts as number) >= INVITATION_MAX_FAILS) return { state: "bloqueada" };
      if (Date.parse(inv.expires_at as string) < Date.now()) return { state: "vencida" };
      return { state: "invitado", expires_at: inv.expires_at };
    }
    return { state: "ninguno", has_account: !!acc };
  }

  // ── Invitar ──
  if (body?.action !== "invite") throw new PortalError(400, "Acción inválida");
  if (!isUuid(body.guardian?.id)) throw new PortalError(400, "Pedido inválido");
  if (!Array.isArray(body.children) || !body.children.length || body.children.some((c) => !isUuid(c.id) || !isUuid(c.guardian_id))) {
    throw new PortalError(400, "Elegí al menos un chico.");
  }
  if (!["representante_legal", "autorizado"].includes(body.relationship_kind)) throw new PortalError(400, "Elegí el tipo de vínculo.");
  const authorizedBy = body.relationship_kind === "autorizado" ? String(body.authorized_by ?? "").trim() : null;
  if (body.relationship_kind === "autorizado" && (!authorizedBy || authorizedBy.length < 3)) {
    throw new PortalError(400, "Indicá quién autorizó a este adulto.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.identity_checked_on))) throw new PortalError(400, "Indicá cuándo se vio el DNI en persona.");
  const expiresDays = Math.min(30, Math.max(1, Math.round(Number(body.expires_days) || 7)));
  const channel = body.channel === "impresa" ? "impresa" : "whatsapp";

  // El DNI y el teléfono salen de la ficha, no del pedido
  const { data: guardian } = await ctx.admin.from("patient_guardians")
    .select("id, full_name, dni, phone, active").eq("id", body.guardian.id).maybeSingle();
  const dni = normalizeDni(guardian?.dni ?? "");
  if (!guardian?.active || !isValidDni(dni)) throw new PortalError(400, "Falta el DNI del adulto responsable en la ficha.");

  const consents = new Set(body.adolescent_consents ?? []);
  const requested: InviteChild[] = [...new Map(body.children.map((c) => [c.id, c])).values()]
    .map((c) => ({ patient_id: c.id, guardian_id: c.guardian_id, consent: consents.has(c.id) }));
  const valid = await validChildren(ctx, dni, requested);
  if (valid.length !== requested.length) {
    throw new PortalError(400, "Algún chico no cumple los requisitos (fecha de nacimiento, menor de 18, sin alta o conformidad a partir de los 16). Revisá las fichas.");
  }

  const { data: acc } = await ctx.admin.from("portal_accounts").select("id, active").eq("dni", dni).maybeSingle();
  if (acc && !acc.active) throw new PortalError(409, "La cuenta de este adulto está pausada. Reactivala antes de invitar.");
  // Chicos con un vínculo que hoy vale; los que dejaron de valer se pueden reinvitar
  const links = acc ? await accountLinks(ctx, { id: acc.id as string, dni }) : [];
  const linked = new Set(links.filter((l) => l.valid).map((l) => l.patient_id));
  const children: InviteChild[] = requested.filter((c) => !linked.has(c.patient_id));
  const firstName = String(guardian.full_name).trim().split(/\s+/)[0];
  if (!children.length) {
    throw new PortalError(409, `${firstName} ya tiene acceso a ${valid.map((v) => v.patient.first_name).join(" y ")} en el portal.`);
  }

  // Una invitación nueva reemplaza a las pendientes del mismo DNI, pero
  // conserva sus chicos: un código nuevo nunca le quita acceso a un hermano
  const nowIso = new Date().toISOString();
  const { data: pending } = await ctx.admin.from("portal_invitations")
    .select("id, children, expires_at").eq("dni", dni).is("used_at", null).is("revoked_at", null).neq("purpose", "recuperacion");
  const previous = (pending ?? []) as Pick<Invitation, "id" | "children" | "expires_at">[];
  for (const p of previous) {
    if (Date.parse(p.expires_at) <= Date.now()) continue;
    for (const c of p.children) {
      if (!linked.has(c.patient_id) && !children.some((x) => x.patient_id === c.patient_id)) children.push(c);
    }
  }
  const finalValid = await validChildren(ctx, dni, children);

  const code = newCode();
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();
  const parts = String(guardian.full_name).trim().split(/\s+/);
  const { error } = await ctx.admin.from("portal_invitations").insert({
    code_hash: codeHash(ctx, code),
    dni,
    purpose: acc ? "vincular" : "activacion",
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
    account_id: acc?.id ?? null,
    children: finalValid.map((v) => v.child),
    relationship_kind: body.relationship_kind,
    authorized_by: authorizedBy,
    phone: guardian.phone,
    in_person: !!body.in_person,
    channel,
    identity_checked_on: body.identity_checked_on,
    issued_by_email: staff.email,
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
    purpose: acc ? "vincular" : "activacion",
    expires_at: expiresAt,
    first_name: parts[0],
    children: finalValid.map((v) => v.patient.first_name),
  };
}));
