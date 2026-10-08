// Portal de familias — invitaciones (las genera el equipo, las canjea la familia).
// El código nunca se guarda: solo HMAC(PORTAL_CODE_PEPPER, código).

import { normalizeDni } from "../../src/lib/portalRules";
import { type Ctx, PortalError, eligibility, hmac, selfEligibility } from "./portal";

export const INVITATION_MAX_FAILS = 5;
export const GENERIC_CODE = "El código o el DNI no coinciden, o el código venció. Revisalos o pedí uno nuevo en el centro.";

export type GuardianKind = "representante_legal" | "autorizado";
// self: el propio paciente adulto (vínculo "titular", sin adulto responsable).
// kind/authorized_by van por chico: una invitación nueva junta los chicos de
// las pendientes, que pueden tener otro tipo de vínculo.
export type InviteChild = {
  patient_id: string; guardian_id: string | null; consent?: boolean; self?: boolean;
  kind?: GuardianKind; authorized_by?: string | null;
};
export type Invitation = {
  id: string; dni: string; purpose: "activacion" | "vincular" | "recuperacion";
  first_name: string; last_name: string; account_id: string | null;
  children: InviteChild[]; relationship_kind: GuardianKind | "titular" | null;
  authorized_by: string | null; phone: string | null; in_person: boolean;
  issued_by_email: string | null; expires_at: string; used_at: string | null; revoked_at: string | null;
  failed_attempts: number;
};

const INV_COLS = "id, dni, purpose, first_name, last_name, account_id, children, relationship_kind, authorized_by, phone, in_person, issued_by_email, expires_at, used_at, revoked_at, failed_attempts";

export function codeHash(ctx: Ctx, code: string) {
  return hmac(ctx, `code:${code}`);
}

export function usable(inv: Pick<Invitation, "used_at" | "revoked_at" | "expires_at" | "failed_attempts">): boolean {
  return !inv.used_at && !inv.revoked_at && Date.parse(inv.expires_at) > Date.now() && inv.failed_attempts < INVITATION_MAX_FAILS;
}

// Busca la invitación por código y DNI. Cada DNI equivocado suma un intento;
// con 5 el código deja de servir. Siempre el mismo mensaje de error.
export async function findInvitation(ctx: Ctx, dni: string, code: string): Promise<Invitation> {
  if (!/^\d{10}$/.test(code)) throw new PortalError(400, GENERIC_CODE);
  const { data } = await ctx.admin.from("portal_invitations").select(INV_COLS).eq("code_hash", codeHash(ctx, code)).maybeSingle();
  const inv = data as Invitation | null;
  if (!inv || !usable(inv)) throw new PortalError(400, GENERIC_CODE);
  if (inv.dni !== dni) {
    await countFailure(ctx, inv);
    throw new PortalError(400, GENERIC_CODE);
  }
  return inv;
}

export async function countFailure(ctx: Ctx, inv: Invitation) {
  await ctx.admin.from("portal_invitations").update({ failed_attempts: inv.failed_attempts + 1 }).eq("id", inv.id);
}

// Reserva el código antes de tocar Auth (dos pedidos a la vez no lo usan dos veces)
export async function claim(ctx: Ctx, inv: Invitation) {
  const { data } = await ctx.admin.from("portal_invitations")
    .update({ used_at: new Date().toISOString() }).eq("id", inv.id).is("used_at", null).select("id");
  if (!data?.length) throw new PortalError(400, GENERIC_CODE);
}

export async function release(ctx: Ctx, inv: Invitation) {
  await ctx.admin.from("portal_invitations").update({ used_at: null }).eq("id", inv.id);
}

type PatientRow = { id: string; first_name: string; last_name: string; dni: string | null; birth_date: string | null; discharge_date: string | null };
type GuardianRow = { id: string; patient_id: string; dni: string | null; active: boolean };

// Revalida cada chico contra la ficha: la fila del adulto sigue activa, es de
// ese chico y tiene el mismo DNI; el chico es menor, sin alta y, con 16 o 17
// años, con conformidad registrada. El titular (paciente adulto) tiene que
// tener el mismo DNI que la cuenta, ser mayor de edad y no tener el alta.
export async function validChildren(ctx: Ctx, dni: string, children: InviteChild[]) {
  if (!children.length) return [];
  const guardianIds = children.map((c) => c.guardian_id).filter((x): x is string => !!x);
  const [{ data: guardians }, { data: patients }] = await Promise.all([
    guardianIds.length
      ? ctx.admin.from("patient_guardians").select("id, patient_id, dni, active").in("id", guardianIds)
      : Promise.resolve({ data: [] as GuardianRow[] }),
    ctx.admin.from("patients").select("id, first_name, last_name, dni, birth_date, discharge_date").in("id", children.map((c) => c.patient_id)),
  ]);
  const out: { child: InviteChild; patient: PatientRow; age: number }[] = [];
  for (const c of children) {
    const p0 = (patients as PatientRow[] | null)?.find((x) => x.id === c.patient_id);
    if (c.self) {
      if (!p0 || normalizeDni(p0.dni ?? "") !== dni) continue;
      const el = selfEligibility(p0);
      if (el.ok && el.age !== null) out.push({ child: c, patient: p0, age: el.age });
      continue;
    }
    const g = (guardians as GuardianRow[] | null)?.find((x) => x.id === c.guardian_id);
    const p = (patients as PatientRow[] | null)?.find((x) => x.id === c.patient_id);
    if (!g || !p || !g.active || g.patient_id !== p.id || normalizeDni(g.dni ?? "") !== dni) continue;
    const el = eligibility(p);
    if (!el.ok || el.age === null) continue;
    if (el.age >= 16 && !c.consent) continue;
    out.push({ child: c, patient: p, age: el.age });
  }
  return out;
}

export function shortName(p: { first_name: string; last_name: string }) {
  return `${p.first_name} ${p.last_name.charAt(0)}.`;
}

// Crea los vínculos que falten. Si ya hay uno (por ejemplo, el chico cumplió
// 16 y faltaba su conformidad, o cambió la fila del adulto), lo actualiza.
export async function linkChildren(ctx: Ctx, accountId: string, inv: Invitation) {
  const valid = await validChildren(ctx, inv.dni, inv.children);
  const { data: existing } = await ctx.admin.from("portal_links")
    .select("id, patient_id").eq("account_id", accountId).is("revoked_at", null);
  const current = new Map((existing ?? []).map((l) => [l.patient_id as string, l.id as string]));
  const done = new Set<string>();
  const added: string[] = [];
  let addedSelf = false;
  for (const v of valid) {
    if (done.has(v.patient.id)) continue;
    done.add(v.patient.id);
    const linkId = current.get(v.patient.id);
    const self = !!v.child.self;
    // Invitaciones anteriores a este cambio no traen el vínculo por chico
    const legacyKind = inv.relationship_kind === "titular" ? null : inv.relationship_kind;
    const kind = v.child.kind ?? legacyKind ?? "representante_legal";
    const fields = {
      guardian_id: self ? null : v.child.guardian_id,
      relationship_kind: self ? "titular" : kind,
      authorized_by: self || kind !== "autorizado" ? null : v.child.kind ? v.child.authorized_by ?? null : inv.authorized_by,
      adolescent_consent_at: !self && v.age >= 16 ? new Date().toISOString() : null,
    };
    if (linkId) {
      const { error } = await ctx.admin.from("portal_links").update(fields).eq("id", linkId);
      if (!error) { if (self) addedSelf = true; else added.push(v.patient.first_name); }
      continue;
    }
    const { error } = await ctx.admin.from("portal_links").insert({
      account_id: accountId,
      patient_id: v.patient.id,
      ...fields,
      created_by_email: inv.issued_by_email,
    });
    if (!error) { if (self) addedSelf = true; else added.push(v.patient.first_name); }
  }
  // Nombres de los chicos a cargo sumados, y si se sumó el propio titular
  return { children: added, self: addedSelf };
}
