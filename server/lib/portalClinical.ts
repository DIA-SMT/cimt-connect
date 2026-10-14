// Portal — información de salud (etapa A): etapas prendidas, quién puede ver
// qué, "volvé a poner tu contraseña" y lo que ve el equipo en la ficha.
//
// La regla de acceso es pura (src/lib/portalClinicalRules.ts). Acá se juntan
// los datos que necesita: vínculos, verificación en persona, bloqueos,
// configuración por paciente y consentimiento de la cuenta. La copia digital
// de la historia clínica (área "hc", con la pausa del paciente) la arma
// server/lib/requests.ts.
//
// Variables de entorno:
//   PORTAL_CLINICAL_FEATURES  etapas prendidas, separadas por coma (vacío = ninguna;
//                             "hc_digital" necesita también "consent"; sin el script 25
//                             queda apagada sola y no se informa: effectiveFeatures)
//   PORTAL_REAUTH_INFO_HOURS, PORTAL_REAUTH_DOWNLOAD_MIN  (12 y 15 por defecto)
// Antes de prender cualquier etapa hay que correr el script 22.

import {
  type ChildClinicalDTO, type ClinicalArea, type ClinicalFeature, type FamilyClinicalDTO, type PortalSettings,
  type StaffAccessRow, type StaffClinicalDTO, type StaffGuardianRow,
  CLINICAL_NOTICE_VERSION, REAUTH_DOWNLOAD_MIN, REAUTH_INFO_HOURS, ADOLESCENT_FROM, ADULT_FROM,
  clinicalAccess, parseFeatures, publicOutcome, reauthFresh,
} from "../../src/lib/portalClinicalRules";
import { ageOn, centerNow, linkValidity, normalizeDni } from "../../src/lib/portalRules";
import { type Account, type Ctx, type H3Event, PortalError, accountLinks, bearer, missingTable, requireStaff } from "./portal";

const OFFLINE = "No pudimos conectar. Probá de nuevo.";

// ── Etapas ──────────────────────────────────────────────────────────────────

export function features(): ClinicalFeature[] {
  return parseFeatures(process.env.PORTAL_CLINICAL_FEATURES);
}

// Copia digital de la historia clínica (etapa E1): vale solo junto con
// "consent" (la cuenta tiene que haber activado la información de salud).
// Además necesita el script 25: el servidor mira si ya están sus columnas
// (digitalReady) y, mientras no estén, la copia digital queda apagada aunque
// la etapa esté prendida; los pedidos de copia siguen funcionando como antes
// (en mano). Con la etapa apagada, lo que ya se envió por el portal se sigue
// mostrando como enviado.
export function digitalOn(): boolean {
  const f = features();
  return f.includes("hc_digital") && f.includes("consent");
}

// ¿Ya se corrió el script 25 (columnas channel, sent_at y sent_by_email de
// los pedidos, la tabla de PDF y el bucket)? Se pregunta una vez por proceso
// del servidor. Si todavía no estaba, se vuelve a preguntar cada 5 minutos:
// después de correrlo no hace falta reiniciar.
const E1_RECHECK_MS = 5 * 60 * 1000;
let e1Known: { ok: boolean; at: number } | null = null;
let e1Pending: Promise<boolean> | null = null;

async function probeE1(ctx: Ctx): Promise<boolean> {
  const { error } = await ctx.admin.from("portal_hc_requests").select("channel").limit(1);
  // Falta la columna (o la tabla): el script no se corrió. Cualquier otro
  // error es de conexión y no se guarda la respuesta.
  if (error && error.code !== "42703" && error.code !== "PGRST204" && !missingTable(error)) {
    throw new PortalError(503, OFFLINE);
  }
  e1Known = { ok: !error, at: Date.now() };
  return e1Known.ok;
}

export function e1Columns(ctx: Ctx): Promise<boolean> {
  if (e1Known && (e1Known.ok || Date.now() - e1Known.at < E1_RECHECK_MS)) return Promise.resolve(e1Known.ok);
  e1Pending ??= probeE1(ctx).finally(() => { e1Pending = null; });
  return e1Pending;
}

// Para las pruebas: olvida lo que se sabía del script 25
export function resetE1Columns() {
  e1Known = null;
  e1Pending = null;
}

// La copia digital está disponible: etapa prendida (con "consent") y script 25 corrido
export async function digitalReady(ctx: Ctx): Promise<boolean> {
  return digitalOn() && (await e1Columns(ctx));
}

// Las etapas que se informan al portal y al panel: "hc_digital" solo si la
// copia digital está disponible de verdad (digitalReady). Si no se puede
// saber (sin conexión), no se la nombra: es solo para mostrar u ocultar.
export async function effectiveFeatures(ctx: Ctx): Promise<ClinicalFeature[]> {
  const f = features();
  if (!f.includes("hc_digital") || (await digitalReady(ctx).catch(() => false))) return f;
  return f.filter((x) => x !== "hc_digital");
}

// Con la etapa apagada el endpoint no existe (mismo 404 que cualquier ruta)
export function requireFeature(f: ClinicalFeature) {
  if (!features().includes(f)) throw new PortalError(404, "No disponible.");
}

function reauthLimits() {
  const hours = Number(process.env.PORTAL_REAUTH_INFO_HOURS) || REAUTH_INFO_HOURS;
  const minutes = Number(process.env.PORTAL_REAUTH_DOWNLOAD_MIN) || REAUTH_DOWNLOAD_MIN;
  return { hours, minutes };
}

// ── Equipo: rol ─────────────────────────────────────────────────────────────

export async function requireStaffRole(ctx: Ctx, event: H3Event) {
  const staff = await requireStaff(ctx, event);
  const { data, error } = await ctx.admin.from("admins").select("role").eq("user_id", staff.user_id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  const role = (data?.role as string | undefined) ?? "";
  return { ...staff, role, clinical: role === "direccion" || role === "profesional" };
}

export function requireClinical(staff: { clinical: boolean }) {
  if (!staff.clinical) throw new PortalError(403, "Solo los profesionales y la Dirección pueden hacer esto.");
}

// ── Contraseña de nuevo ─────────────────────────────────────────────────────

// session_id del token de la familia (ya validado por requireFamily)
export function sessionIdOf(event: H3Event): string | null {
  const token = bearer(event);
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { session_id?: unknown };
    return typeof claims.session_id === "string" && /^[0-9a-f-]{36}$/i.test(claims.session_id) ? claims.session_id : null;
  } catch {
    return null;
  }
}

// Confirma la contraseña sin abrir una sesión nueva (función del script 22)
export async function verifyAccountPassword(ctx: Ctx, account: Account, password: string): Promise<boolean> {
  if (!password) return false;
  const { data, error } = await ctx.admin.rpc("portal_verify_password", { p_user: account.user_id, p_password: password });
  if (error) throw new PortalError(503, OFFLINE);
  return data === true;
}

export async function markStepUp(ctx: Ctx, event: H3Event, account: Account) {
  const sessionId = sessionIdOf(event);
  if (!sessionId) throw new PortalError(401, "Tu sesión venció. Volvé a ingresar.");
  const now = new Date().toISOString();
  const { error } = await ctx.admin.from("portal_step_up")
    .upsert({ session_id: sessionId, account_id: account.id, verified_at: now, last_info_at: now });
  if (error) throw new PortalError(503, OFFLINE);
}

// ¿Hace falta volver a poner la contraseña? Para "info" renueva la ventana.
export async function needsReauth(ctx: Ctx, event: H3Event, account: Account, need: "info" | "download"): Promise<boolean> {
  const sessionId = sessionIdOf(event);
  if (!sessionId) return true;
  const { data, error } = await ctx.admin.from("portal_step_up")
    .select("account_id, verified_at, last_info_at").eq("session_id", sessionId).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!data || data.account_id !== account.id) return true;
  const { hours, minutes } = reauthLimits();
  const fresh = reauthFresh(data as { verified_at: string; last_info_at: string | null }, need, new Date(), hours, minutes);
  if (fresh && need === "info") {
    await ctx.admin.from("portal_step_up").update({ last_info_at: new Date().toISOString() }).eq("session_id", sessionId);
  }
  return !fresh;
}

// ── Consentimiento ──────────────────────────────────────────────────────────

type ConsentRow = { accepted: boolean; version: string; channel: string; created_at: string; account_id: string };

async function latestClinicalConsents(ctx: Ctx, accountIds: string[]): Promise<Map<string, ConsentRow>> {
  const out = new Map<string, ConsentRow>();
  if (!accountIds.length) return out;
  const { data, error } = await ctx.admin.from("portal_consents")
    .select("account_id, accepted, version, channel, created_at")
    .eq("kind", "informacion_clinica").in("account_id", accountIds)
    .order("created_at", { ascending: false });
  if (error) throw new PortalError(503, OFFLINE);
  for (const r of (data ?? []) as ConsentRow[]) if (!out.has(r.account_id)) out.set(r.account_id, r);
  return out;
}

// Vale si lo último que hizo la cuenta fue aceptar el aviso vigente
function consentActive(c: ConsentRow | undefined): boolean {
  return !!c && c.accepted && c.version === CLINICAL_NOTICE_VERSION;
}

export async function familyClinical(ctx: Ctx, account: Account): Promise<FamilyClinicalDTO> {
  const [consents, f] = await Promise.all([latestClinicalConsents(ctx, [account.id]), effectiveFeatures(ctx)]);
  const c = consents.get(account.id);
  return {
    features: f,
    consent: { accepted: consentActive(c), version: c?.accepted ? c.version : null, current_version: CLINICAL_NOTICE_VERSION },
  };
}

export async function recordConsent(ctx: Ctx, accountId: string, accepted: boolean, opts: { channel?: "portal" | "papel"; fileId?: string; byEmail?: string } = {}) {
  const { error } = await ctx.admin.from("portal_consents").insert({
    account_id: accountId,
    kind: "informacion_clinica",
    version: CLINICAL_NOTICE_VERSION,
    accepted,
    channel: opts.channel ?? "portal",
    evidence_file_id: opts.fileId ?? null,
    recorded_by_email: opts.byEmail ?? null,
  });
  if (error) throw new PortalError(503, "No pudimos guardar tu respuesta. Probá de nuevo.");
}

// ── Qué ve una cuenta ───────────────────────────────────────────────────────

type SettingsRow = PortalSettings & {
  patient_id: string; pause_reason: string | null; updated_by_email: string | null; updated_at: string | null;
  adolescent_agreed_by_email: string | null;
};
const SETTINGS_COLS = "patient_id, info_enabled, practice_enabled, paused_at, pause_reason, adolescent_agreed_on, adolescent_agreed_by_email, adolescent_withdrawn_on, updated_by_email, updated_at";

async function settingsFor(ctx: Ctx, patientIds: string[]): Promise<Map<string, SettingsRow>> {
  const out = new Map<string, SettingsRow>();
  if (!patientIds.length) return out;
  const { data, error } = await ctx.admin.from("patient_portal_settings").select(SETTINGS_COLS).in("patient_id", patientIds);
  if (error) throw new PortalError(503, OFFLINE);
  for (const r of (data ?? []) as SettingsRow[]) out.set(r.patient_id, r);
  return out;
}

// Por cada persona que la cuenta ve hoy: si puede ver su información y sus
// ejercicios (en la versión reducida que sale hacia la familia)
export async function childrenClinical(ctx: Ctx, account: Account): Promise<Map<string, ChildClinicalDTO>> {
  const out = new Map<string, ChildClinicalDTO>();
  const links = (await accountLinks(ctx, account)).filter((l) => l.valid && l.patient);
  if (!links.length) return out;
  const [{ data: ver, error }, settings, consents] = await Promise.all([
    ctx.admin.from("portal_links").select("id, verified_in_person_on, parental_checked_on").in("id", links.map((l) => l.id)),
    settingsFor(ctx, links.map((l) => l.patient_id)),
    latestClinicalConsents(ctx, [account.id]),
  ]);
  if (error) throw new PortalError(503, OFFLINE);
  const today = centerNow().date;
  const consent = consentActive(consents.get(account.id));
  for (const l of links) {
    const v = ((ver ?? []) as { id: string; verified_in_person_on: string | null; parental_checked_on: string | null }[]).find((x) => x.id === l.id);
    const input = {
      link_kind: l.kind, link_valid: l.valid, hc_ok: l.hc_ok,
      age: l.patient!.birth_date ? ageOn(l.patient!.birth_date, today) : null,
      verified_in_person: !!v?.verified_in_person_on, parental_checked: !!v?.parental_checked_on,
      settings: settings.get(l.patient_id) ?? null, clinical_consent: consent, blocked: false,
    };
    out.set(l.patient_id, {
      info: publicOutcome(clinicalAccess(input, "info")),
      practice: publicOutcome(clinicalAccess(input, "practice")),
    });
  }
  return out;
}

// ── Lo que ve el equipo en la ficha ─────────────────────────────────────────

type LinkRow = {
  id: string; account_id: string; guardian_id: string | null; relationship_kind: string;
  adolescent_consent_at: string | null; verified_in_person_on: string | null; parental_checked_on: string | null;
};
type GuardianRow = { id: string; patient_id: string; full_name: string; relationship: string | null; dni: string | null; active: boolean };

export async function staffClinical(ctx: Ctx, patientId: string, canEdit: boolean): Promise<StaffClinicalDTO> {
  const { data: p, error: pErr } = await ctx.admin.from("patients")
    .select("id, first_name, dni, birth_date, discharge_date").eq("id", patientId).maybeSingle();
  if (pErr) throw new PortalError(503, OFFLINE);
  if (!p) throw new PortalError(404, "No encontramos ese paciente.");

  const [links, guardians, blocks, files, settingsMap] = await Promise.all([
    ctx.admin.from("portal_links")
      .select("id, account_id, guardian_id, relationship_kind, adolescent_consent_at, verified_in_person_on, parental_checked_on")
      .eq("patient_id", patientId).is("revoked_at", null),
    ctx.admin.from("patient_guardians").select("id, patient_id, full_name, relationship, dni, active").eq("patient_id", patientId),
    ctx.admin.from("portal_guardian_blocks").select("id, guardian_id, dni, reason, created_at, created_by_email")
      .eq("patient_id", patientId).is("lifted_at", null),
    ctx.admin.from("patient_files").select("id, file_name, created_at")
      .eq("patient_id", patientId).eq("category", "consentimiento").is("voided_at", null).order("created_at", { ascending: false }),
    settingsFor(ctx, [patientId]),
  ]);
  if (links.error || guardians.error || blocks.error || files.error) throw new PortalError(503, OFFLINE);

  const linkRows = (links.data ?? []) as LinkRow[];
  const guardianRows = (guardians.data ?? []) as GuardianRow[];
  const blockRows = (blocks.data ?? []) as { id: string; guardian_id: string | null; dni: string; reason: string; created_at: string; created_by_email: string }[];
  const { data: accounts, error: aErr } = linkRows.length
    ? await ctx.admin.from("portal_accounts").select("id, dni, first_name, last_name, active").in("id", [...new Set(linkRows.map((l) => l.account_id))])
    : { data: [] as { id: string; dni: string; first_name: string; last_name: string; active: boolean }[], error: null };
  if (aErr) throw new PortalError(503, OFFLINE);
  const consents = await latestClinicalConsents(ctx, linkRows.map((l) => l.account_id));

  const today = centerNow().date;
  const age = p.birth_date ? ageOn(p.birth_date as string, today) : null;
  const s = settingsMap.get(patientId) ?? null;
  const patient = { id: p.id as string, dni: (p.dni as string | null) ?? null, birth_date: (p.birth_date as string | null) ?? null, discharge_date: (p.discharge_date as string | null) ?? null };

  const accesses: StaffAccessRow[] = [];
  for (const l of linkRows) {
    const acc = (accounts ?? []).find((a) => a.id === l.account_id);
    if (!acc) continue;
    const g = guardianRows.find((x) => x.id === l.guardian_id) ?? null;
    const blocked = blockRows.some((b) => b.dni === acc.dni || (!!l.guardian_id && b.guardian_id === l.guardian_id));
    const { valid, hc_ok } = linkValidity({
      kind: l.relationship_kind, account_dni: acc.dni, patient,
      guardian: g ? { patient_id: g.patient_id, dni: g.dni, active: g.active } : null,
      adolescent_consent_at: l.adolescent_consent_at, blocked,
    }, today);
    const c = consents.get(acc.id);
    const input = {
      link_kind: l.relationship_kind, link_valid: valid && acc.active, hc_ok, age,
      verified_in_person: !!l.verified_in_person_on, parental_checked: !!l.parental_checked_on,
      settings: s, clinical_consent: consentActive(c), blocked,
    };
    const info = clinicalAccess(input, "info");
    const practice = clinicalAccess(input, "practice");
    accesses.push({
      link_id: l.id,
      account_id: acc.id,
      name: `${acc.first_name} ${acc.last_name}`.trim(),
      link_kind: l.relationship_kind,
      relationship: g?.relationship ?? null,
      link_valid: valid && acc.active,
      verified_in_person_on: l.verified_in_person_on,
      parental_checked_on: l.parental_checked_on,
      consent: c ? { accepted: c.accepted, version: c.version, channel: c.channel, at: c.created_at } : null,
      info_block: info.ok ? null : info.block,
      practice_block: practice.ok ? null : practice.block,
    });
  }

  const guardiansOut: StaffGuardianRow[] = guardianRows
    .filter((g) => g.active || blockRows.some((b) => b.guardian_id === g.id))
    .map((g) => {
      const b = blockRows.find((x) => x.guardian_id === g.id || (!!g.dni && x.dni === normalizeDni(g.dni)));
      return {
        guardian_id: g.id, name: g.full_name, relationship: g.relationship, dni: g.dni,
        block: b ? { id: b.id, reason: b.reason, created_at: b.created_at, created_by_email: b.created_by_email } : null,
      };
    });

  return {
    features: await effectiveFeatures(ctx),
    can_edit: canEdit,
    patient: { id: patient.id, first_name: p.first_name as string, age, discharged: !!patient.discharge_date && patient.discharge_date <= today },
    settings: {
      info_enabled: s?.info_enabled ?? false,
      practice_enabled: s?.practice_enabled ?? false,
      paused_at: s?.paused_at ?? null,
      pause_reason: s?.pause_reason ?? null,
      adolescent_agreed_on: s?.adolescent_agreed_on ?? null,
      adolescent_agreed_by_email: s?.adolescent_agreed_by_email ?? null,
      adolescent_withdrawn_on: s?.adolescent_withdrawn_on ?? null,
      updated_by_email: s?.updated_by_email ?? null,
      updated_at: s?.updated_at ?? null,
    },
    adolescent_required: age !== null && age >= ADOLESCENT_FROM && age < ADULT_FROM,
    accesses,
    guardians: guardiansOut,
    paper_files: ((files.data ?? []) as { id: string; file_name: string; created_at: string }[]),
  };
}

export type { ClinicalArea };
