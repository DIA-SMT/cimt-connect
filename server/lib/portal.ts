// Portal de familias — piezas comunes de los endpoints (server/api/portal/*
// y server/api/portal-staff/*).
//
// Las familias nunca tocan la base: todo pasa por acá con la service role key
// (que solo vive en el servidor), leyendo columnas explícitas y devolviendo
// solo lo que el portal muestra. Nada clínico sale de acá.
//
// Variables de entorno (nunca con prefijo VITE_):
//   SUPABASE_URL (o VITE_SUPABASE_URL), SUPABASE_PUBLISHABLE_KEY (o la VITE_),
//   SUPABASE_SERVICE_ROLE_KEY y PORTAL_CODE_PEPPER (secreto para los códigos).

import { createHmac, randomInt } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequestHeader, setResponseStatus } from "nitro/h3";
import {
  type ApptDTO, type Outcome, type ReasonCode, type ResponseKind,
  SELF_ACCESS_AGE, addDaysKey, ageOn, centerNow, computeApptDto, normalizeDni,
} from "../../src/lib/portalRules";

export type H3Event = Parameters<typeof setResponseStatus>[0];

// ── Configuración y clientes ────────────────────────────────────────────────

function config() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pepper = process.env.PORTAL_CODE_PEPPER;
  const missing = [
    !url && "SUPABASE_URL", !anonKey && "SUPABASE_PUBLISHABLE_KEY",
    !serviceKey && "SUPABASE_SERVICE_ROLE_KEY", (!pepper || pepper.length < 32) && "PORTAL_CODE_PEPPER (32 caracteres o más)",
  ].filter(Boolean) as string[];
  return { url: url!, anonKey: anonKey!, serviceKey: serviceKey!, pepper: pepper!, missing };
}

export class PortalError extends Error {
  constructor(public status: number, message: string, public extra: { code?: string; retry_at?: string } = {}) {
    super(message);
  }
}

export function setup() {
  const c = config();
  if (c.missing.length) {
    // No se dice qué falta a quien llama; queda en el log del servidor
    console.error("[portal] falta configurar:", c.missing.join(", "));
    throw new PortalError(503, "El portal todavía no está disponible.");
  }
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    admin: createClient(c.url, c.serviceKey, opts), // service role: solo en el servidor
    anon: () => createClient(c.url, c.anonKey, opts), // nuevo por pedido, para iniciar sesión
    pepper: c.pepper,
  };
}
export type Ctx = ReturnType<typeof setup>;

// Envuelve un endpoint: errores con formato { error, code?, retry_at? } y
// sin filtrar detalles de la base (que pueden traer datos personales)
export async function handle<T>(event: H3Event, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PortalError) {
      setResponseStatus(event, err.status);
      return { error: err.message, ...err.extra };
    }
    console.error("[portal] error inesperado:", err instanceof Error ? err.name : "desconocido");
    setResponseStatus(event, 503);
    return { error: "No pudimos conectar. Probá de nuevo." };
  }
}

// Las respuestas que podrían revelar si un DNI tiene cuenta tardan siempre lo mismo
export async function withFloor<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const settle = async () => {
    const rest = ms - (Date.now() - start);
    if (rest > 0) await new Promise((r) => setTimeout(r, rest + randomInt(0, 200)));
  };
  try {
    const result = await fn();
    await settle();
    return result;
  } catch (err) {
    await settle();
    throw err;
  }
}

// ── Códigos, hashes y emails internos ───────────────────────────────────────

export function hmac(ctx: Ctx, value: string): string {
  return createHmac("sha256", ctx.pepper).update(value).digest("hex");
}

export function newCode(): string {
  return Array.from({ length: 10 }, () => String(randomInt(0, 10))).join("");
}

export function formatCode(code: string): string {
  return `${code.slice(0, 5)} ${code.slice(5)}`;
}

// La familia ingresa con DNI; Supabase Auth necesita un email: se usa uno
// interno que no se muestra nunca y al que no se manda nada
export function familyEmail(accountId: string): string {
  return `familia-${accountId}@portal.cimt.invalid`;
}

// Supabase Auth limita los ingresos por IP y todos salen de este servidor:
// si Auth rechaza por límite o por falla propia, no es una contraseña
// equivocada y no se cuenta como intento
export function authUnavailable(error: { status?: number; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.status === 429 || (error.status ?? 0) >= 500 || error.code === "over_request_rate_limit";
}

export const AUTH_BUSY = "Hay muchos ingresos en este momento. Probá de nuevo en unos minutos.";

// ── Límite de intentos (por DNI, guardado como hash) ────────────────────────

export const LOGIN_MAX_FAILS = 10;
const LOGIN_WINDOW_MS = 60 * 60 * 1000;

export async function lockedUntil(ctx: Ctx, dni: string): Promise<string | null> {
  const { data } = await ctx.admin.from("portal_login_attempts")
    .select("count, window_start").eq("key", hmac(ctx, `login:${dni}`)).maybeSingle();
  if (!data) return null;
  const start = Date.parse(data.window_start as string);
  if (Date.now() - start < LOGIN_WINDOW_MS && (data.count as number) >= LOGIN_MAX_FAILS) {
    return new Date(start + LOGIN_WINDOW_MS).toISOString();
  }
  return null;
}

export async function registerFailure(ctx: Ctx, dni: string) {
  const key = hmac(ctx, `login:${dni}`);
  const { data } = await ctx.admin.from("portal_login_attempts").select("count, window_start").eq("key", key).maybeSingle();
  const fresh = !data || Date.now() - Date.parse(data.window_start as string) >= LOGIN_WINDOW_MS;
  await ctx.admin.from("portal_login_attempts").upsert({
    key,
    count: fresh ? 1 : (data!.count as number) + 1,
    window_start: fresh ? new Date().toISOString() : data!.window_start,
  });
}

export async function clearFailures(ctx: Ctx, dni: string) {
  await ctx.admin.from("portal_login_attempts").delete().eq("key", hmac(ctx, `login:${dni}`));
}

// ── Quién llama ─────────────────────────────────────────────────────────────

function bearer(event: H3Event): string | null {
  return getRequestHeader(event, "authorization")?.replace(/^Bearer\s+/i, "") || null;
}

export type Account = { id: string; user_id: string; dni: string; first_name: string; last_name: string; active: boolean };

// Familia con sesión: token válido de Supabase Auth, usuario marcado como
// familia por el servidor (app_metadata, que el usuario no puede cambiar) y
// cuenta activa
export async function requireFamily(ctx: Ctx, event: H3Event): Promise<Account> {
  const token = bearer(event);
  if (!token) throw new PortalError(401, "Tu sesión venció. Volvé a ingresar.");
  const { data, error } = await ctx.admin.auth.getUser(token);
  if (error || !data.user || data.user.app_metadata?.kind !== "family") {
    throw new PortalError(401, "Tu sesión venció. Volvé a ingresar.");
  }
  const { data: acc } = await ctx.admin.from("portal_accounts")
    .select("id, user_id, dni, first_name, last_name, active").eq("user_id", data.user.id).maybeSingle();
  if (!acc) throw new PortalError(401, "Tu sesión venció. Volvé a ingresar.");
  if (!acc.active) throw new PortalError(403, "Tu acceso al portal está pausado. Llamanos al 381 258-4491.", { code: "PAUSED" });
  return acc as Account;
}

// Persona del equipo: sesión del panel y fila activa en admins (cualquier rol)
export async function requireStaff(ctx: Ctx, event: H3Event): Promise<{ user_id: string; email: string }> {
  const token = bearer(event);
  if (!token) throw new PortalError(401, "No autenticado");
  const { data, error } = await ctx.admin.auth.getUser(token);
  if (error || !data.user) throw new PortalError(401, "Sesión inválida");
  const { data: row } = await ctx.admin.from("admins").select("active, email").eq("user_id", data.user.id).maybeSingle();
  if (!row?.active) throw new PortalError(403, "Solo el equipo del CIMT puede hacer esto");
  return { user_id: data.user.id, email: (row.email as string) ?? data.user.email ?? "" };
}

// ── Qué chicos ve una cuenta ────────────────────────────────────────────────

type PatientRow = { id: string; first_name: string; last_name: string; dni?: string | null; birth_date: string | null; discharge_date: string | null };
type GuardianRow = { id: string; patient_id: string; dni: string | null; active: boolean };

// Menor a cargo de un adulto responsable
export function eligibility(p: PatientRow, today = centerNow().date): { ok: boolean; age: number | null; problem: string | null } {
  if (!p.birth_date) return { ok: false, age: null, problem: "Falta la fecha de nacimiento del chico" };
  const age = ageOn(p.birth_date, today);
  if (age >= SELF_ACCESS_AGE) return { ok: false, age, problem: "Es mayor de edad" };
  if (p.discharge_date && p.discharge_date <= today) return { ok: false, age, problem: "Tiene el alta cargada" };
  return { ok: true, age, problem: null };
}

// Paciente adulto que usa el portal por su cuenta (vínculo "titular")
export function selfEligibility(p: PatientRow, today = centerNow().date): { ok: boolean; age: number | null; problem: string | null } {
  if (!p.birth_date) return { ok: false, age: null, problem: "Falta la fecha de nacimiento del paciente" };
  const age = ageOn(p.birth_date, today);
  if (age < SELF_ACCESS_AGE) return { ok: false, age, problem: "Es menor de edad: entra por su adulto responsable" };
  if (p.discharge_date && p.discharge_date <= today) return { ok: false, age, problem: "Tiene el alta cargada" };
  return { ok: true, age, problem: null };
}

export type ActiveChild = { patient_id: string; first_name: string; last_name: string; display: string; kind: string; self: boolean };

// Un vínculo vale si: no fue revocado, la fila del adulto en la ficha del
// chico sigue activa y con el mismo DNI que la cuenta, el chico es menor
// (fecha de nacimiento cargada), no tiene el alta y, si tiene 16 o 17, hay
// conformidad registrada. Se revisa en cada pedido.
// Todos los vínculos no revocados de una cuenta, cada uno con si vale hoy.
// Lo usan el portal (solo los vigentes) y el panel (estado del acceso e
// invitaciones), así los dos ven lo mismo.
export async function accountLinks(ctx: Ctx, account: Pick<Account, "id" | "dni">) {
  const { data: links } = await ctx.admin.from("portal_links")
    .select("id, patient_id, guardian_id, relationship_kind, adolescent_consent_at")
    .eq("account_id", account.id).is("revoked_at", null);
  if (!links?.length) return [];
  const guardianIds = links.map((l) => l.guardian_id).filter((x): x is string => !!x);
  const [{ data: guardians }, { data: patients }] = await Promise.all([
    guardianIds.length
      ? ctx.admin.from("patient_guardians").select("id, patient_id, dni, active").in("id", guardianIds)
      : Promise.resolve({ data: [] as GuardianRow[] }),
    ctx.admin.from("patients").select("id, first_name, last_name, dni, birth_date, discharge_date").in("id", links.map((l) => l.patient_id)),
  ]);
  const today = centerNow().date;
  return links.map((l) => {
    const p = (patients as PatientRow[] | null)?.find((x) => x.id === l.patient_id) ?? null;
    const self = l.relationship_kind === "titular";
    let valid: boolean;
    if (self) {
      // Titular: la cuenta es del propio paciente (mismo DNI), mayor de edad y sin alta
      valid = !!p && normalizeDni(p.dni ?? "") === account.dni && selfEligibility(p, today).ok;
    } else {
      const g = (guardians as GuardianRow[] | null)?.find((x) => x.id === l.guardian_id);
      valid = !!g && !!p && g.active && g.patient_id === p.id && normalizeDni(g.dni ?? "") === account.dni;
      if (valid && p) {
        const el = eligibility(p, today);
        valid = el.ok && !((el.age ?? 0) >= 16 && !l.adolescent_consent_at);
      }
    }
    return { id: l.id as string, patient_id: l.patient_id as string, kind: l.relationship_kind as string, self, patient: p, valid };
  });
}

export async function activeChildren(ctx: Ctx, account: Account): Promise<ActiveChild[]> {
  const out: ActiveChild[] = (await accountLinks(ctx, account))
    .filter((l) => l.valid && l.patient)
    .map((l) => ({ patient_id: l.patient_id, first_name: l.patient!.first_name, last_name: l.patient!.last_name, display: l.patient!.first_name, kind: l.kind, self: l.self }));
  // Dos chicos con el mismo nombre: se agrega la inicial del apellido
  for (const c of out) {
    if (out.some((o) => o !== c && o.first_name === c.first_name)) c.display = `${c.first_name} ${c.last_name.charAt(0)}.`;
  }
  return out;
}

// ── Turnos ──────────────────────────────────────────────────────────────────

type ApptRow = {
  id: string; patient_id: string; appointment_date: string; appointment_time: string;
  duration_minutes: number | null; modality: string | null; status: string;
  professional_id: string | null; attendance: string | null;
};
type RespRow = { appointment_id: string; account_id: string; kind: ResponseKind; reason_code: ReasonCode | null; created_at: string; outcome: Outcome | null };

const APPT_COLS = "id, patient_id, appointment_date, appointment_time, duration_minutes, modality, status, professional_id, attendance";

async function toDtos(ctx: Ctx, account: Account, children: ActiveChild[], rows: ApptRow[]): Promise<ApptDTO[]> {
  if (!rows.length) return [];
  const proIds = [...new Set(rows.map((r) => r.professional_id).filter((x): x is string => !!x))];
  const [{ data: pros }, { data: resps }] = await Promise.all([
    proIds.length ? ctx.admin.from("professionals").select("id, name").in("id", proIds) : Promise.resolve({ data: [] }),
    ctx.admin.from("portal_appointment_responses")
      .select("appointment_id, account_id, kind, reason_code, created_at, outcome")
      .in("appointment_id", rows.map((r) => r.id)).order("created_at", { ascending: false }),
  ]);
  const proName = new Map(((pros ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const now = centerNow();
  return rows
    .sort((a, b) => `${a.appointment_date}${a.appointment_time}`.localeCompare(`${b.appointment_date}${b.appointment_time}`))
    .map((r) => {
      const child = children.find((c) => c.patient_id === r.patient_id)!;
      const last = ((resps ?? []) as RespRow[]).find((x) => x.appointment_id === r.id) ?? null;
      return computeApptDto(
        {
          id: r.id, child_id: r.patient_id, child_first_name: child.display, is_self: child.self,
          date: r.appointment_date, time: String(r.appointment_time).slice(0, 5),
          duration_minutes: r.duration_minutes ?? 30,
          modality: r.modality === "telemedicina" ? "telemedicina" : "presencial",
          professional_name: r.professional_id ? proName.get(r.professional_id) ?? null : null,
          cancelled: r.status === "cancelado",
          // "Justificado" solo se usa para contestar un aviso de la familia
          justified: r.attendance === "justificado",
        },
        last ? { account_id: last.account_id, kind: last.kind, reason_code: last.reason_code, at: last.created_at, outcome: last.outcome } : null,
        account.id,
        now,
      );
    });
}

export async function appointmentsFor(ctx: Ctx, account: Account, children: ActiveChild[], from: string, to: string): Promise<ApptDTO[]> {
  if (!children.length) return [];
  const { data } = await ctx.admin.from("appointments").select(APPT_COLS)
    .in("patient_id", children.map((c) => c.patient_id))
    .gte("appointment_date", from).lte("appointment_date", to);
  return toDtos(ctx, account, children, (data ?? []) as ApptRow[]);
}

export async function appointmentById(ctx: Ctx, account: Account, children: ActiveChild[], id: string): Promise<ApptDTO | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !children.length) return null;
  const { data } = await ctx.admin.from("appointments").select(APPT_COLS).eq("id", id).maybeSingle();
  if (!data || !children.some((c) => c.patient_id === (data as ApptRow).patient_id)) return null;
  return (await toDtos(ctx, account, children, [data as ApptRow]))[0] ?? null;
}

export { addDaysKey, centerNow };
