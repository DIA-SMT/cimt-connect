/**
 * Portal de familias — API simulada para el modo mock (VITE_USE_MOCK=true).
 *
 * Imita lo que van a hacer los endpoints de server/api/portal/* con las mismas
 * reglas y mensajes, para poder probar el portal sin base de datos. Los datos
 * del portal (cuentas, invitaciones, avisos) viven en localStorage: se
 * comparten entre las pestañas del mismo navegador, así una invitación
 * generada en el panel se puede activar abriendo el link en otra pestaña. La
 * sesión de la familia es por pestaña (sessionStorage). No cruza de un
 * navegador o dispositivo a otro: para eso hace falta el servidor real.
 *
 * Hay dos tipos de chicos:
 *   - "demo": familia de ejemplo con turnos propios del portal.
 *   - "agenda": chicos invitados desde el panel (ficha → Adultos responsables →
 *     Invitar al portal). Sus turnos se leen en vivo de la agenda del mock del
 *     panel (mockClient.ts), así lo que cambia el equipo se ve en el portal.
 *     Como el mock del panel se reinicia al recargar, al invitar se guarda una
 *     copia del nombre del chico; el servidor real, en cambio, va a validar
 *     contra la base en cada pedido (fila del responsable activa, mismo DNI,
 *     menor de 18 y sin alta).
 *
 * Datos de demo:
 *   - Laura Gómez · DNI 30111222 · contraseña familia2026
 *     (mamá de Martín, 9 años, y de Valentina, 6). Ya pidió la copia de la
 *     historia clínica de Martín: el pedido está pendiente en la bandeja del panel.
 *   - Jorge Ruiz · DNI 28999888 · contraseña familia2026: papá de Valentina
 *     (representante legal) y adulto autorizado de Martín (pareja de Laura):
 *     ve los turnos de los dos, pero solo puede pedir la copia de la historia
 *     clínica de Valentina. Ya avisó que Valentina no va a un turno (sin
 *     resolver): Laura lo ve como "otro adulto de la familia".
 *   - Invitación 24680 13579 para Carla Paz · DNI 27444555 (mamá de Fernanda, 14)
 *   - Código de contraseña nueva 97531 86420 para Laura
 *
 * Como en la base real, el aviso guarda lo que cargó el equipo solo si es
 * "reprogramado" u "otro": "cancelado" y "justificado" salen del turno
 * (estado cancelado o asistencia "justificado"), "asistio" de la asistencia
 * "presente" y, si alguien del equipo lo resolvió y después se cambió el
 * turno, queda como "otro" (visto).
 *
 * Cada paso de un pedido de copia (pedido, cancelación, cambios del equipo y
 * notas) deja una constancia en el propio pedido (events), como la tabla
 * portal_hc_request_events.
 *
 * En el mock los códigos se guardan en claro. En la base real se guarda solo
 * un HMAC del código.
 */

import { isWeekendKey } from "@/lib/agenda";
import type { ActivationInfo, ApiResult, ChildDTO, ChildPageDTO, MeDTO } from "@/lib/portal";
import {
  type ApptDTO, type HcEventKind, type HcRejectReason, type HcRequestDTO, type HcStaffTarget, type NoticeAction,
  type NoticeResolution, type Outcome, type ReasonCode, type ResponseKind, type StaffHcRequest, type StaffInbox,
  type StaffInboxCount, type StaffNotice,
  CONFIRM_WINDOW_DAYS, HC_DAILY_MAX, HC_OPEN_STATUSES, HC_REJECT_REASONS, HC_TRANSITIONS, NOTICE_ACTIONS,
  PRIVACY_VERSION, REASON_CODES, REASON_TEXT_MAX,
  addDaysKey as addDays, canRequestHc, centerNow, computeApptDto, computeHcDto, hcVisible, isNoticeOnTime,
  isValidDni, normalizeCode, normalizeDni, passwordProblem,
} from "@/lib/portalRules";
import type { AccessStatus, RelationshipKind, StaffInviteInput, StaffInviteResult, StaffInviteSelfInput } from "@/lib/portalStaff";
import { mockSupabase } from "./mockClient";

// ── Modelo ──────────────────────────────────────────────────────────────────

type Account = {
  id: string; dni: string; first_name: string; last_name: string;
  password: string; active: boolean; privacy_version: string | null;
  recovery_requested_at: string | null;
};
type Child = { id: string; first_name: string; last_name: string; source: "demo" | "agenda" };
// "titular": el propio paciente adulto, que usa el portal por su cuenta
type Link = {
  account_id: string; child_id: string;
  relationship_kind: RelationshipKind | "titular"; guardian_id: string | null;
};
type Appt = {
  id: string; child_id: string; date: string; time: string; duration_minutes: number;
  modality: "presencial" | "telemedicina"; professional_name: string | null;
  status: "agendado" | "cancelado";
  attendance: "presente" | "ausente" | "justificado" | null; // la carga el equipo
};
type Response = {
  id: string; appointment_id: string; account_id: string; kind: ResponseKind;
  reason_code: ReasonCode | null; reason_text: string | null; at: string;
  // Lo que cargó el equipo al resolver el aviso. "cancelado" y "justificado"
  // no se guardan acá: salen del turno, como en la base real
  outcome: Extract<Outcome, "reprogramado" | "otro"> | null;
  resolved_at: string | null; resolved_by_email: string | null;
};
// Pedido de copia de la historia clínica (tabla portal_hc_requests). Sus
// constancias (portal_hc_request_events) van en events, de la más vieja a la
// más nueva. updated_at cambia con cada cambio de estado, no con las notas.
type HcRequest = Omit<StaffHcRequest, "patient_name" | "patient_dni" | "still_allowed"> & {
  account_id: string | null; updated_at: string;
};
type Purpose = "activacion" | "recuperacion" | "vincular";
type Invitation = {
  code: string; dni: string; purpose: Purpose;
  first_name: string; last_name: string;
  child_ids: string[];
  guardian_ids: Record<string, string>; // chico → fila de responsable en su ficha
  self_ids?: string[]; // fichas del propio titular (paciente adulto)
  // vínculo de cada chico (una invitación junta chicos de invitaciones anteriores)
  kinds?: Record<string, { kind: RelationshipKind; authorized_by: string | null }>;
  relationship_kind: RelationshipKind | "titular"; authorized_by: string | null;
  account_id: string | null;
  phone: string | null; in_person: boolean; channel: "whatsapp" | "impresa" | null;
  identity_checked_on: string | null; issued_by: string | null;
  created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null;
  failed_attempts: number;
};
type Db = {
  version: number; seeded_on: string;
  accounts: Account[]; children: Child[]; links: Link[]; appts: Appt[];
  responses: Response[]; invitations: Invitation[]; hc_requests: HcRequest[];
  login_failures: Record<string, { count: number; first_at: string }>;
};

const DB_KEY = "cimt-portal-mock-db";
const SESSION_KEY = "cimt-portal-mock-session";
const DB_VERSION = 4;

const INVITATION_MAX_FAILS = 5;
const LOGIN_MAX_FAILS = 10; // por DNI y por hora
const LOGIN_WINDOW_MS = 60 * 60 * 1000;

// ── Datos de demo (fechas relativas a hoy, solo días hábiles) ───────────────

function workday(from: string, n: number): string {
  let d = from;
  let count = 0;
  while (isWeekendKey(d)) d = addDays(d, 1);
  while (count < n) {
    d = addDays(d, 1);
    if (!isWeekendKey(d)) count++;
  }
  return d;
}

function demoInvitation(i: Partial<Invitation> & Pick<Invitation, "code" | "dni" | "purpose" | "first_name" | "last_name">): Invitation {
  const now = Date.now();
  return {
    child_ids: [], guardian_ids: {}, relationship_kind: "representante_legal", authorized_by: null,
    account_id: null, phone: null, in_person: true, channel: null, identity_checked_on: null, issued_by: "demo",
    created_at: new Date(now).toISOString(), expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    used_at: null, revoked_at: null, failed_attempts: 0,
    ...i,
  };
}

// Pedido de copia recién hecho (los defaults de la tabla), con la constancia
// del pedido (by_email null: lo hizo la familia)
function hcRow(r: Pick<HcRequest, "id" | "patient_id" | "account_id" | "link_kind" | "requester_name" | "requester_dni" | "created_at">): HcRequest {
  return {
    status: "pendiente", ready_at: null, ready_by_email: null,
    delivered_at: null, delivered_by_email: null, delivered_to_name: null, delivered_to_dni: null,
    rejected_at: null, rejected_by_email: null, reject_reason: null,
    cancelled_at: null, staff_notes: null, updated_at: r.created_at,
    events: [{ kind: "pedido", by_email: null, at: r.created_at }],
    ...r,
  };
}

// Constancia de un paso del pedido (by_email null: la familia)
function logHcEvent(row: HcRequest, kind: HcEventKind, byEmail: string | null, at = new Date().toISOString()) {
  row.events.push({ kind, by_email: byEmail, at });
}

function seed(): Db {
  const today = centerNow().date;
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const H = 60 * 60 * 1000;
  const d0 = workday(today, 0); // hoy si es hábil, si no el próximo hábil
  const ANA = "Lic. Ana Torres";
  const PAULA = "Lic. Paula Díaz";
  const STAFF = "demo@cimt.local";

  const appts: Appt[] = [
    // Martín hoy: el equipo justificó la falta (asistencia "justificado") por el aviso de Laura
    { id: "t-martin-0", child_id: "c-martin", date: d0, time: "17:30", duration_minutes: 30, modality: "presencial", professional_name: ANA, status: "agendado", attendance: "justificado" },
    { id: "t-martin-1", child_id: "c-martin", date: workday(today, 1), time: "17:30", duration_minutes: 30, modality: "presencial", professional_name: ANA, status: "agendado", attendance: null },
    { id: "t-martin-2", child_id: "c-martin", date: workday(today, 2), time: "17:30", duration_minutes: 30, modality: "presencial", professional_name: ANA, status: "agendado", attendance: null },
    { id: "t-martin-3", child_id: "c-martin", date: workday(today, 7), time: "17:30", duration_minutes: 30, modality: "presencial", professional_name: ANA, status: "agendado", attendance: null },
    { id: "t-martin-4", child_id: "c-martin", date: workday(today, 12), time: "17:30", duration_minutes: 30, modality: "telemedicina", professional_name: ANA, status: "agendado", attendance: null },
    { id: "t-vale-1", child_id: "c-valentina", date: workday(today, 1), time: "10:00", duration_minutes: 30, modality: "presencial", professional_name: PAULA, status: "agendado", attendance: null },
    { id: "t-vale-2", child_id: "c-valentina", date: workday(today, 3), time: "10:00", duration_minutes: 30, modality: "presencial", professional_name: PAULA, status: "cancelado", attendance: null },
    { id: "t-vale-3", child_id: "c-valentina", date: workday(today, 4), time: "10:00", duration_minutes: 30, modality: "presencial", professional_name: PAULA, status: "agendado", attendance: null },
    { id: "t-vale-4", child_id: "c-valentina", date: workday(today, 8), time: "10:00", duration_minutes: 30, modality: "presencial", professional_name: PAULA, status: "agendado", attendance: null },
    { id: "t-fer-1", child_id: "c-fernanda", date: workday(today, 2), time: "15:00", duration_minutes: 40, modality: "presencial", professional_name: "Lic. Sergio Paz", status: "agendado", attendance: null },
    { id: "t-fer-2", child_id: "c-fernanda", date: workday(today, 7), time: "15:00", duration_minutes: 40, modality: "presencial", professional_name: "Lic. Sergio Paz", status: "agendado", attendance: null },
  ];
  const legal = (account_id: string, child_id: string): Link => ({ account_id, child_id, relationship_kind: "representante_legal", guardian_id: null });
  // Adulto autorizado: ve los turnos y avisa, pero no puede pedir la historia clínica
  const authorized = (account_id: string, child_id: string): Link => ({ account_id, child_id, relationship_kind: "autorizado", guardian_id: null });

  return {
    version: DB_VERSION,
    seeded_on: today,
    accounts: [
      { id: "acc-laura", dni: "30111222", first_name: "Laura", last_name: "Gómez", password: "familia2026", active: true, privacy_version: PRIVACY_VERSION, recovery_requested_at: null },
      { id: "acc-jorge", dni: "28999888", first_name: "Jorge", last_name: "Ruiz", password: "familia2026", active: true, privacy_version: PRIVACY_VERSION, recovery_requested_at: null },
    ],
    children: [
      { id: "c-martin", first_name: "Martín", last_name: "Gómez", source: "demo" },
      { id: "c-valentina", first_name: "Valentina", last_name: "Ruiz", source: "demo" },
      { id: "c-fernanda", first_name: "Fernanda", last_name: "Paz", source: "demo" },
    ],
    links: [
      legal("acc-laura", "c-martin"), legal("acc-laura", "c-valentina"),
      legal("acc-jorge", "c-valentina"), authorized("acc-jorge", "c-martin"),
    ],
    appts,
    responses: [
      // Martín hoy: Laura avisó ayer que no van (a tiempo), el equipo justificó la falta
      { id: "r1", appointment_id: "t-martin-0", account_id: "acc-laura", kind: "no_puedo", reason_code: "transporte", reason_text: null, at: iso(20 * H), outcome: null, resolved_at: iso(18 * H), resolved_by_email: STAFF },
      // Martín mañana: Laura confirmó
      { id: "r2", appointment_id: "t-martin-1", account_id: "acc-laura", kind: "confirmo", reason_code: null, reason_text: null, at: iso(3 * H), outcome: null, resolved_at: null, resolved_by_email: null },
      // Valentina mañana: Jorge avisó que no van (sin resolver)
      { id: "r3", appointment_id: "t-vale-1", account_id: "acc-jorge", kind: "no_puedo", reason_code: "trabajo", reason_text: null, at: iso(1 * H), outcome: null, resolved_at: null, resolved_by_email: null },
      // Valentina en 3 días hábiles: Laura avisó y el equipo canceló el turno
      { id: "r4", appointment_id: "t-vale-2", account_id: "acc-laura", kind: "no_puedo", reason_code: "escuela", reason_text: "Acto en la escuela", at: iso(26 * H), outcome: null, resolved_at: iso(25 * H), resolved_by_email: STAFF },
    ],
    invitations: [
      demoInvitation({ code: "2468013579", dni: "27444555", purpose: "activacion", first_name: "Carla", last_name: "Paz", child_ids: ["c-fernanda"] }),
      demoInvitation({ code: "9753186420", dni: "30111222", purpose: "recuperacion", first_name: "Laura", last_name: "Gómez", account_id: "acc-laura" }),
    ],
    hc_requests: [
      // Laura pidió hace 30 horas la copia de la historia clínica de Martín:
      // todavía no se preparó (su única constancia es la del pedido)
      hcRow({
        id: "hc-demo-1", patient_id: "c-martin", account_id: "acc-laura", link_kind: "representante_legal",
        requester_name: "Laura Gómez", requester_dni: "30111222", created_at: iso(30 * H),
      }),
    ],
    login_failures: {},
  };
}

// ── Persistencia ────────────────────────────────────────────────────────────

// Datos compartidos entre pestañas
function storage(): Storage | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

// Sesión de la familia: una por pestaña
function sessionStore(): Storage | null {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
}

let memoryDb: Db | null = null;

function load(): Db {
  const s = storage();
  try {
    const raw = s?.getItem(DB_KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      // Si cambió el día, se regeneran los turnos de demo para que sigan "cerca"
      if (db.version === DB_VERSION && db.seeded_on === centerNow().date) return db;
    }
  } catch { /* datos corruptos: se regeneran */ }
  if (memoryDb && memoryDb.version === DB_VERSION && memoryDb.seeded_on === centerNow().date) return memoryDb;
  const db = seed();
  save(db);
  return db;
}

function save(db: Db) {
  memoryDb = db;
  try { storage()?.setItem(DB_KEY, JSON.stringify(db)); } catch { /* sin storage: queda en memoria */ }
}

function sessionAccountId(): string | null {
  try { return sessionStore()?.getItem(SESSION_KEY) ?? null; } catch { return null; }
}

function setSession(accountId: string | null) {
  try {
    if (accountId) sessionStore()?.setItem(SESSION_KEY, accountId);
    else sessionStore()?.removeItem(SESSION_KEY);
  } catch { /* nada */ }
}

/** Borra los datos y la sesión de la demo (botón "Reiniciar demo"). */
export function resetDemo() {
  memoryDb = null;
  try { storage()?.removeItem(DB_KEY); sessionStore()?.removeItem(SESSION_KEY); } catch { /* nada */ }
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Las respuestas que podrían revelar si un DNI existe tardan siempre lo mismo
const FLOOR_MS = 700;

async function withFloor<T>(fn: () => T): Promise<T> {
  const start = Date.now();
  const result = fn();
  const rest = FLOOR_MS - (Date.now() - start);
  if (rest > 0) await wait(rest + Math.floor(Math.random() * 150));
  return result;
}

function ok<T>(data: T): ApiResult<T> { return { ok: true, data }; }
function fail<T>(status: number, error: string, extra: { code?: string; retry_at?: string } = {}): ApiResult<T> {
  return { ok: false, status, error, ...extra };
}

const GENERIC_LOGIN = "DNI o contraseña incorrectos.";
const GENERIC_CODE = "El código o el DNI no coinciden, o el código venció. Revisalos o pedí uno nuevo en el centro.";
const SESSION_EXPIRED = "Tu sesión venció. Volvé a ingresar.";

function uid(prefix: string) { return `${prefix}-${Math.random().toString(36).slice(2, 10)}`; }

// 10 dígitos al azar (el servidor real usa crypto.randomInt y guarda solo un HMAC)
function newCode(): string {
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => String(n % 10)).join("");
}

export function formatCode(code: string): string {
  return `${code.slice(0, 5)} ${code.slice(5)}`;
}

function requireAccount(db: Db): Account | null {
  const id = sessionAccountId();
  const acc = id ? db.accounts.find((a) => a.id === id) : undefined;
  if (!acc || !acc.active) { setSession(null); return null; }
  return acc;
}

function childIdsOf(db: Db, accountId: string): string[] {
  return db.links.filter((l) => l.account_id === accountId).map((l) => l.child_id);
}

function linkOf(db: Db, accountId: string, childId: string): Link | undefined {
  return db.links.find((l) => l.account_id === accountId && l.child_id === childId);
}

// ¿Esta cuenta puede pedir la copia de la historia clínica de este chico?
function canRequestHcFor(db: Db, accountId: string, childId: string): boolean {
  const link = linkOf(db, accountId, childId);
  return !!link && canRequestHc(link.relationship_kind);
}

function lastInitial(c: Pick<Child, "last_name">) { return `${c.last_name.charAt(0)}.`; }

function isSelfLink(db: Db, accountId: string, childId: string): boolean {
  return db.links.some((l) => l.account_id === accountId && l.child_id === childId && l.relationship_kind === "titular");
}

function childNames(db: Db, ids: string[]): string[] {
  return ids.map((id) => db.children.find((c) => c.id === id)).filter((c): c is Child => !!c).map((c) => `${c.first_name} ${lastInitial(c)}`);
}

// Turnos de los chicos invitados desde el panel: se leen de la agenda del mock
type Row = Record<string, unknown>;
const ATTENDANCE = ["presente", "ausente", "justificado"] as const;
async function agendaAppts(childIds: string[]): Promise<Appt[]> {
  if (childIds.length === 0) return [];
  const { data: pros } = await mockSupabase.from("professionals").select("*");
  const names = new Map(((pros ?? []) as Row[]).map((p) => [String(p.id), String(p.name)]));
  const out: Appt[] = [];
  for (const childId of childIds) {
    const { data } = await mockSupabase.from("appointments").select("*").eq("patient_id", childId);
    for (const a of (data ?? []) as Row[]) {
      out.push({
        id: String(a.id),
        child_id: childId,
        date: String(a.appointment_date),
        time: String(a.appointment_time).slice(0, 5),
        duration_minutes: Number(a.duration_minutes ?? 30),
        modality: a.modality === "telemedicina" ? "telemedicina" : "presencial",
        professional_name: a.professional_id ? names.get(String(a.professional_id)) ?? null : null,
        status: a.status === "cancelado" ? "cancelado" : "agendado",
        attendance: ATTENDANCE.find((x) => x === a.attendance) ?? null,
      });
    }
  }
  return out;
}

async function apptsFor(db: Db, childIds: string[]): Promise<Appt[]> {
  const agendaIds = childIds.filter((id) => db.children.find((c) => c.id === id)?.source === "agenda");
  return [
    ...db.appts.filter((a) => childIds.includes(a.child_id)),
    ...(await agendaAppts(agendaIds)),
  ];
}

// Nombre del chico tal como lo ve la familia: si dos chicos de la misma cuenta
// se llaman igual, se agrega la inicial del apellido ("Martín V.")
function displayName(db: Db, accountId: string, child: Child): string {
  const twins = childIdsOf(db, accountId)
    .map((id) => db.children.find((c) => c.id === id))
    .filter((c) => c && c.id !== child.id && c.first_name === child.first_name);
  return twins.length ? `${child.first_name} ${lastInitial(child)}` : child.first_name;
}

// La respuesta más nueva de un turno, de cualquier adulto
function newestResponse(db: Db, appointmentId: string): Response | undefined {
  return db.responses
    .filter((r) => r.appointment_id === appointmentId)
    .sort((x, y) => y.at.localeCompare(x.at))[0];
}

function toDto(db: Db, a: Appt, accountId: string): ApptDTO {
  const child = db.children.find((c) => c.id === a.child_id)!;
  const last = newestResponse(db, a.id);
  return computeApptDto(
    {
      id: a.id, child_id: child.id, child_first_name: displayName(db, accountId, child),
      is_self: isSelfLink(db, accountId, child.id),
      date: a.date, time: a.time, duration_minutes: a.duration_minutes,
      modality: a.modality, professional_name: a.professional_name,
      cancelled: a.status === "cancelado",
      // "Justificado" solo se usa para contestar un aviso de la familia
      justified: a.attendance === "justificado",
    },
    last ? { account_id: last.account_id, kind: last.kind, reason_code: last.reason_code, at: last.at, outcome: last.outcome } : null,
    accountId,
  );
}

async function apptsOf(db: Db, accountId: string, childIds: string[], fromDate: string, toDate: string): Promise<ApptDTO[]> {
  return (await apptsFor(db, childIds))
    .filter((a) => a.date >= fromDate && a.date <= toDate)
    .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time))
    .map((a) => toDto(db, a, accountId));
}

// Pacientes de los que esta cuenta puede ver sus pedidos: los vínculos con
// derecho a pedir la copia (en la base, aunque ya no den acceso al portal,
// por ejemplo con el alta). page dice si la página del chico se puede abrir:
// en el mock todo vínculo da acceso, así que siempre se puede.
function hcPatients(db: Db, accountId: string): { patient_id: string; display: string; self: boolean; page: boolean }[] {
  const ids = childIdsOf(db, accountId);
  return db.links
    .filter((l) => l.account_id === accountId && canRequestHc(l.relationship_kind) && db.children.some((c) => c.id === l.child_id))
    .map((l) => {
      const c = db.children.find((x) => x.id === l.child_id)!;
      return {
        patient_id: l.child_id,
        display: displayName(db, accountId, c),
        self: isSelfLink(db, accountId, l.child_id),
        page: ids.includes(l.child_id),
      };
    });
}

// Pedidos de copia de esta cuenta (abiertos y cerrados recientes)
function hcRequestsFor(db: Db, accountId: string, onlyPatientId?: string): HcRequestDTO[] {
  const patients = hcPatients(db, accountId).filter((p) => !onlyPatientId || p.patient_id === onlyPatientId);
  if (!patients.length) return [];
  const now = new Date();
  return db.hc_requests
    .filter((r) => r.account_id === accountId && patients.some((p) => p.patient_id === r.patient_id))
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .slice(0, 50)
    .filter((r) => hcVisible(r, now))
    .map((r) => computeHcDto(r, patients.find((p) => p.patient_id === r.patient_id)!));
}

// ── Endpoints de la familia ─────────────────────────────────────────────────

export function hasSession(): boolean {
  const db = load();
  return !!requireAccount(db);
}

export async function login(rawDni: string, password: string): Promise<ApiResult<{ first_name: string }>> {
  const dni = normalizeDni(rawDni);
  return withFloor(() => {
    if (!isValidDni(dni)) return fail(400, "Revisá tu DNI: tiene que tener entre 6 y 10 números.");
    const db = load();
    const locked = loginLockedUntil(db, dni);
    if (locked) return fail(429, "Hiciste muchos intentos.", { retry_at: locked });
    const acc = db.accounts.find((a) => a.dni === dni);
    if (!acc || acc.password !== password) {
      registerLoginFailure(db, dni);
      return fail(401, GENERIC_LOGIN);
    }
    if (!acc.active) return fail(403, "Tu acceso al portal está pausado. Llamanos al 381 258-4491.", { code: "PAUSED" });
    delete db.login_failures[dni];
    save(db);
    setSession(acc.id);
    return ok({ first_name: acc.first_name });
  });
}

function loginLockedUntil(db: Db, dni: string): string | null {
  const f = db.login_failures[dni];
  const now = Date.now();
  if (f && now - Date.parse(f.first_at) < LOGIN_WINDOW_MS && f.count >= LOGIN_MAX_FAILS) {
    return new Date(Date.parse(f.first_at) + LOGIN_WINDOW_MS).toISOString();
  }
  return null;
}

function registerLoginFailure(db: Db, dni: string) {
  const now = Date.now();
  const f = db.login_failures[dni];
  const prev = f && now - Date.parse(f.first_at) < LOGIN_WINDOW_MS ? f : { count: 0, first_at: new Date(now).toISOString() };
  db.login_failures[dni] = { count: prev.count + 1, first_at: prev.first_at };
  save(db);
}

export function logout() {
  setSession(null);
}

export async function requestRecovery(rawDni: string): Promise<ApiResult<{ ok: true }>> {
  const dni = normalizeDni(rawDni);
  return withFloor(() => {
    if (!isValidDni(dni)) return fail(400, "Revisá tu DNI: tiene que tener entre 6 y 10 números.");
    const db = load();
    const acc = db.accounts.find((a) => a.dni === dni && a.active);
    if (acc) { acc.recovery_requested_at = new Date().toISOString(); save(db); }
    // Siempre la misma respuesta: no se revela si el DNI tiene cuenta
    return ok({ ok: true as const });
  });
}

function findInvitation(db: Db, dni: string, code: string): { inv: Invitation | null; error: ApiResult<never> | null } {
  const inv = db.invitations.find((i) => i.code === code) ?? null;
  if (!inv) return { inv: null, error: fail(400, GENERIC_CODE) };
  if (inv.used_at || inv.revoked_at || Date.parse(inv.expires_at) < Date.now() || inv.failed_attempts >= INVITATION_MAX_FAILS) {
    return { inv: null, error: fail(400, GENERIC_CODE) };
  }
  if (inv.dni !== dni) {
    inv.failed_attempts += 1;
    save(db);
    return { inv: null, error: fail(400, GENERIC_CODE) };
  }
  return { inv, error: null };
}

export async function activationCheck(rawDni: string, rawCode: string): Promise<ApiResult<ActivationInfo>> {
  const dni = normalizeDni(rawDni);
  const code = normalizeCode(rawCode);
  return withFloor(() => {
    if (!isValidDni(dni) || code.length !== 10) return fail(400, GENERIC_CODE);
    const db = load();
    const { inv, error } = findInvitation(db, dni, code);
    if (!inv) return error!;
    const account = db.accounts.find((a) => a.dni === dni);
    if (inv.purpose === "activacion" && account) {
      return fail(409, "Ya tenés una cuenta con este DNI. Ingresá con tu contraseña.", { code: "ACCOUNT_EXISTS" });
    }
    const ids = inv.purpose === "recuperacion" ? childIdsOf(db, inv.account_id ?? "") : inv.child_ids;
    const selfIds = inv.purpose === "recuperacion"
      ? ids.filter((id) => isSelfLink(db, inv.account_id ?? "", id))
      : inv.self_ids ?? [];
    return ok({
      purpose: inv.purpose,
      guardian_first_name: inv.first_name,
      children: childNames(db, ids.filter((id) => !selfIds.includes(id))),
      self: selfIds.length > 0,
      needs: inv.purpose === "vincular" ? "current_password" : "new_password",
      needs_privacy: inv.purpose === "activacion",
    });
  });
}

export async function activationComplete(input: {
  dni: string; code: string; password: string; password_repeat: string; accept_privacy_version?: string;
}): Promise<ApiResult<{ first_name: string; children: string[]; self: boolean }>> {
  const dni = normalizeDni(input.dni);
  const code = normalizeCode(input.code);
  return withFloor(() => {
    const db = load();
    const { inv, error } = findInvitation(db, dni, code);
    if (!inv) return error!;

    let account: Account;
    let added: string[] = [];
    if (inv.purpose === "vincular") {
      // Suma chicos a una cuenta que ya existe: se confirma con la contraseña actual
      const existing = db.accounts.find((a) => a.dni === dni);
      if (!existing || !existing.active) return fail(400, GENERIC_CODE);
      // Mismo límite que el ingreso: la contraseña no se puede adivinar desde acá
      const locked = loginLockedUntil(db, dni);
      if (locked) return fail(429, "Hiciste muchos intentos.", { retry_at: locked });
      if (existing.password !== input.password) {
        registerLoginFailure(db, dni);
        inv.failed_attempts += 1; // con 5 errores el código deja de servir
        save(db);
        return fail(400, "La contraseña no es correcta.", { code: "PASSWORD" });
      }
      account = existing;
      added = linkChildren(db, account.id, inv);
    } else {
      const problem = passwordProblem(input.password, input.password_repeat, dni);
      if (problem) return fail(400, problem, { code: "PASSWORD" });
      if (inv.purpose === "activacion") {
        if (input.accept_privacy_version !== PRIVACY_VERSION) {
          return fail(400, "Para usar el portal tenés que aceptar el aviso de privacidad.", { code: "PRIVACY" });
        }
        if (db.accounts.some((a) => a.dni === dni)) {
          return fail(409, "Ya tenés una cuenta con este DNI. Ingresá con tu contraseña.", { code: "ACCOUNT_EXISTS" });
        }
        account = {
          id: uid("acc"), dni, first_name: inv.first_name, last_name: inv.last_name,
          password: input.password, active: true, privacy_version: PRIVACY_VERSION, recovery_requested_at: null,
        };
        db.accounts.push(account);
        added = linkChildren(db, account.id, inv);
      } else {
        const existing = db.accounts.find((a) => a.id === inv.account_id);
        if (!existing || !existing.active) return fail(400, GENERIC_CODE);
        existing.password = input.password;
        existing.recovery_requested_at = null;
        account = existing;
      }
    }
    inv.used_at = new Date().toISOString();
    delete db.login_failures[dni];
    save(db);
    setSession(account.id);
    const ids = inv.purpose === "vincular" ? added : childIdsOf(db, account.id);
    const names = ids.filter((id) => !isSelfLink(db, account.id, id))
      .map((id) => db.children.find((c) => c.id === id)?.first_name)
      .filter((n): n is string => !!n);
    return ok({ first_name: account.first_name, children: names, self: ids.some((id) => isSelfLink(db, account.id, id)) });
  });
}

function linkChildren(db: Db, accountId: string, inv: Invitation): string[] {
  const already = new Set(childIdsOf(db, accountId));
  const added: string[] = [];
  for (const child_id of inv.child_ids) {
    if (already.has(child_id)) continue;
    already.add(child_id);
    const self = (inv.self_ids ?? []).includes(child_id);
    const legacyKind = inv.relationship_kind === "titular" ? "representante_legal" : inv.relationship_kind;
    db.links.push({
      account_id: accountId, child_id,
      relationship_kind: self ? "titular" : inv.kinds?.[child_id]?.kind ?? legacyKind,
      guardian_id: self ? null : inv.guardian_ids[child_id] ?? null,
    });
    added.push(child_id);
  }
  return added;
}

export async function me(): Promise<ApiResult<MeDTO>> {
  await wait(350);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const ids = childIdsOf(db, acc.id);
  const today = centerNow().date;
  const weekEnd = addDays(today, 6);
  const week = await apptsOf(db, acc.id, ids, today, weekEnd);
  const children: ChildDTO[] = [];
  for (const id of ids) {
    const c = db.children.find((x) => x.id === id)!;
    const later = (await apptsOf(db, acc.id, [id], addDays(weekEnd, 1), addDays(today, 90)))
      .find((a) => a.state === "agendado") ?? null;
    children.push({
      id, first_name: displayName(db, acc.id, c), last_initial: lastInitial(c), self: isSelfLink(db, acc.id, id),
      can_request_hc: canRequestHcFor(db, acc.id, id), next: later,
    });
  }
  return ok({ guardian_first_name: acc.first_name, week, children, requests: hcRequestsFor(db, acc.id) });
}

export async function childAppointments(patientId: string): Promise<ApiResult<ChildPageDTO>> {
  await wait(300);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  // Un chico ajeno da el mismo error que uno que no existe
  if (!childIdsOf(db, acc.id).includes(patientId)) return fail(404, "No encontramos a ese chico en tu cuenta.");
  const c = db.children.find((x) => x.id === patientId)!;
  const today = centerNow().date;
  return ok({
    child: { id: c.id, first_name: displayName(db, acc.id, c), self: isSelfLink(db, acc.id, c.id) },
    appointments: await apptsOf(db, acc.id, [c.id], today, addDays(today, 90)),
    // Copia de la historia clínica: si esta cuenta puede pedirla y sus pedidos
    hc: { can_request: canRequestHcFor(db, acc.id, c.id), requests: hcRequestsFor(db, acc.id, c.id) },
  });
}

async function findOwnAppt(db: Db, accountId: string, appointmentId: string): Promise<Appt | null> {
  const appts = await apptsFor(db, childIdsOf(db, accountId));
  return appts.find((x) => x.id === appointmentId) ?? null;
}

export async function appointment(appointmentId: string): Promise<ApiResult<ApptDTO>> {
  await wait(250);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const a = await findOwnAppt(db, acc.id, appointmentId);
  if (!a) return fail(404, "No encontramos ese turno en tu cuenta.");
  return ok(toDto(db, a, acc.id));
}

export async function respond(input: {
  appointment_id: string; response: ResponseKind; reason_code?: ReasonCode; reason_text?: string;
}): Promise<ApiResult<ApptDTO>> {
  await wait(450);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const a = await findOwnAppt(db, acc.id, input.appointment_id);
  if (!a) return fail(404, "No encontramos ese turno en tu cuenta.");
  if (input.response !== "confirmo" && input.response !== "no_puedo") return fail(400, "Elegí una respuesta.");
  const dto = toDto(db, a, acc.id);
  if (a.status === "cancelado") return fail(409, "El centro canceló este turno.");
  if (dto.is_past) return fail(409, "Este turno ya pasó. Si no pudieron venir, llamanos.");
  if (!dto.can_decline) return fail(409, "El equipo ya resolvió tu aviso. Si cambió algo, llamanos.");
  if (input.response === "confirmo" && !dto.can_confirm) {
    return fail(400, `Todavía no se puede confirmar este turno: se habilita ${CONFIRM_WINDOW_DAYS} días antes.`);
  }
  let reason_code: ReasonCode | null = null;
  let reason_text: string | null = null;
  if (input.response === "no_puedo") {
    if (!input.reason_code || !(REASON_CODES as readonly string[]).includes(input.reason_code)) return fail(400, "Elegí un motivo.");
    reason_code = input.reason_code;
    const text = (input.reason_text ?? "").replace(/\s+/g, " ").trim();
    if (text.length > REASON_TEXT_MAX) return fail(400, `El comentario puede tener hasta ${REASON_TEXT_MAX} caracteres.`);
    reason_text = text || null;
  }
  db.responses.push({
    id: uid("r"), appointment_id: a.id, account_id: acc.id, kind: input.response,
    reason_code, reason_text, at: new Date().toISOString(),
    outcome: null, resolved_at: null, resolved_by_email: null,
  });
  save(db);
  return ok(toDto(db, a, acc.id));
}

// ── Copia de la historia clínica (familia) ──────────────────────────────────
// La piden el titular o el representante legal; se entrega en mano en el
// centro. En producción: POST /api/portal/hc (server/lib/requests.ts).

const DAY_MS = 24 * 60 * 60 * 1000;
const HC_NOT_FOUND = "No encontramos ese pedido.";

export async function hcCreate(patientId: string): Promise<ApiResult<HcRequestDTO>> {
  await wait(450);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const link = linkOf(db, acc.id, patientId);
  if (!link) return fail(404, "No encontramos a ese chico en tu cuenta.");
  const kind = link.relationship_kind;
  if (!canRequestHc(kind)) {
    return fail(403, "La copia la pueden pedir el propio paciente o su madre, padre o tutor/a. Si necesitás ayuda, llamanos.", { code: "NOT_ALLOWED" });
  }
  const since = Date.now() - DAY_MS;
  if (db.hc_requests.filter((r) => r.account_id === acc.id && Date.parse(r.created_at) >= since).length >= HC_DAILY_MAX) {
    return fail(429, "Ya hiciste varios pedidos hoy. Si necesitás algo más, llamanos.");
  }
  // Un solo pedido abierto por persona y paciente (índice único en la base)
  if (db.hc_requests.some((r) => r.patient_id === patientId && r.requester_dni === acc.dni && HC_OPEN_STATUSES.includes(r.status))) {
    return fail(409, "Ya hay un pedido en curso. Te avisamos acá cuando la copia esté lista.", { code: "HC_OPEN" });
  }
  // El pedido y su constancia (hcRow la agrega, sin email: lo hizo la familia)
  const row = hcRow({
    id: uid("hc"), patient_id: patientId, account_id: acc.id, link_kind: kind,
    requester_name: `${acc.first_name} ${acc.last_name}`.trim(), requester_dni: acc.dni,
    created_at: new Date().toISOString(),
  });
  db.hc_requests.push(row);
  save(db);
  const c = db.children.find((x) => x.id === patientId)!;
  return ok(computeHcDto(row, { display: displayName(db, acc.id, c), self: isSelfLink(db, acc.id, patientId), page: true }));
}

export async function hcCancel(id: string): Promise<ApiResult<HcRequestDTO>> {
  await wait(400);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  if (!validId(id)) return fail(404, HC_NOT_FOUND);
  const row = db.hc_requests.find((r) => r.id === id);
  // Vale para cualquier vínculo con derecho a la copia, aunque ya no dé
  // acceso al portal. Un pedido de otra persona da lo mismo que uno que no existe
  const patient = row ? hcPatients(db, acc.id).find((p) => p.patient_id === row.patient_id) : undefined;
  if (!row || row.account_id !== acc.id || !patient) return fail(404, HC_NOT_FOUND);
  if (row.status !== "pendiente") {
    return fail(409, row.status === "lista"
      ? "La copia ya está lista. Si ya no la necesitás, avisanos en el centro."
      : "Este pedido ya está cerrado.");
  }
  const now = new Date().toISOString();
  row.status = "cancelada";
  row.cancelled_at = now;
  row.updated_at = now;
  logHcEvent(row, "cancelada", null, now);
  save(db);
  return ok(computeHcDto(row, patient));
}

// ── Endpoints del equipo (panel) ────────────────────────────────────────────
// En producción: POST /api/portal-staff/access con el token del equipo. El
// servidor vuelve a validar contra la base todo lo que el panel ya chequeó.

function splitName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/);
  return { first_name: parts[0] ?? full, last_name: parts.slice(1).join(" ") };
}

export async function staffInvite(input: StaffInviteInput): Promise<ApiResult<StaffInviteResult>> {
  await wait(400);
  const dni = normalizeDni(input.guardian.dni ?? "");
  if (!isValidDni(dni)) return fail(400, "Falta el DNI del adulto responsable.");
  if (input.children.length === 0) return fail(400, "Elegí al menos un chico.");
  if (input.relationship_kind === "autorizado" && !input.authorized_by?.trim()) {
    return fail(400, "Indicá quién autorizó a este adulto.");
  }
  const db = load();
  const account = db.accounts.find((a) => a.dni === dni);
  if (account && !account.active) {
    return fail(409, "La cuenta de este adulto está pausada. Reactivala antes de invitar.");
  }
  const linked = new Set(account ? childIdsOf(db, account.id) : []);
  const unique = [...new Map(input.children.map((c) => [c.id, c])).values()];
  const pending = unique.filter((c) => !linked.has(c.id));
  if (pending.length === 0) {
    return fail(409, `${splitName(input.guardian.full_name).first_name} ya tiene acceso a ${input.children.map((c) => c.first_name).join(" y ")} en el portal.`);
  }

  // Copia del nombre de cada chico (ver nota al principio del archivo)
  for (const c of pending) {
    const existing = db.children.find((x) => x.id === c.id);
    if (existing) Object.assign(existing, { first_name: c.first_name, last_name: c.last_name });
    else db.children.push({ id: c.id, first_name: c.first_name, last_name: c.last_name, source: "agenda" });
  }

  // Una invitación nueva reemplaza a las pendientes del mismo DNI, pero
  // conserva sus chicos: un código nuevo nunca le quita acceso a un hermano
  const nowIso = new Date().toISOString();
  const childIds = pending.map((c) => c.id);
  const guardianIds: Record<string, string> = Object.fromEntries(pending.map((c) => [c.id, c.guardian_id]));
  const authorizedBy = input.relationship_kind === "autorizado" ? input.authorized_by!.trim() : null;
  const kinds: NonNullable<Invitation["kinds"]> = Object.fromEntries(pending.map((c) => [c.id, { kind: input.relationship_kind, authorized_by: authorizedBy }]));
  const { selfIds, replaced } = carryPending(db, dni, linked, childIds, guardianIds, kinds, nowIso);

  const code = newCode();
  const purpose: Purpose = account ? "vincular" : "activacion";
  const { first_name, last_name } = splitName(input.guardian.full_name);
  const expires = new Date(Date.now() + input.expires_days * 24 * 60 * 60 * 1000).toISOString();
  db.invitations.push({
    code, dni, purpose, first_name, last_name,
    child_ids: childIds,
    guardian_ids: guardianIds,
    self_ids: selfIds,
    kinds,
    relationship_kind: input.relationship_kind,
    authorized_by: authorizedBy,
    account_id: account?.id ?? null,
    phone: input.guardian.phone, in_person: input.in_person, channel: input.channel,
    identity_checked_on: input.identity_checked_on, issued_by: input.issued_by,
    created_at: nowIso, expires_at: expires, used_at: null, revoked_at: null, failed_attempts: 0,
  });
  save(db);
  return ok({
    code: formatCode(code),
    raw_code: code,
    purpose,
    expires_at: expires,
    first_name,
    children: childIds.filter((id) => !selfIds.includes(id)).map((id) => db.children.find((c) => c.id === id)?.first_name).filter((n): n is string => !!n),
    self: selfIds.length > 0,
    replaced,
  });
}

// Una invitación nueva reemplaza a las pendientes del mismo DNI, pero
// conserva sus chicos (con su vínculo) y la ficha propia, si la había.
// Devuelve los ids del titular y si anuló un código que todavía servía.
function carryPending(
  db: Db, dni: string, linked: Set<string>, childIds: string[], guardianIds: Record<string, string>,
  kinds: NonNullable<Invitation["kinds"]>, nowIso: string, selfIds: string[] = [],
): { selfIds: string[]; replaced: boolean } {
  let replaced = false;
  for (const inv of db.invitations) {
    if (inv.dni !== dni || inv.used_at || inv.revoked_at || inv.purpose === "recuperacion") continue;
    inv.revoked_at = nowIso;
    if (Date.parse(inv.expires_at) < Date.now()) continue;
    if (inv.failed_attempts < INVITATION_MAX_FAILS) replaced = true;
    const legacyKind = inv.relationship_kind === "titular" ? "representante_legal" : inv.relationship_kind;
    for (const id of inv.child_ids) {
      if (linked.has(id) || childIds.includes(id)) continue;
      childIds.push(id);
      if (inv.guardian_ids[id]) guardianIds[id] = inv.guardian_ids[id];
      if ((inv.self_ids ?? []).includes(id)) selfIds.push(id);
      else kinds[id] = inv.kinds?.[id] ?? { kind: legacyKind, authorized_by: inv.authorized_by };
    }
  }
  return { selfIds, replaced };
}

// Invitar al propio paciente adulto (vínculo "titular")
export async function staffInviteSelf(input: StaffInviteSelfInput): Promise<ApiResult<StaffInviteResult>> {
  await wait(400);
  const dni = normalizeDni(input.patient.dni ?? "");
  if (!isValidDni(dni)) return fail(400, "Falta el DNI del paciente en la ficha.");
  const db = load();
  const account = db.accounts.find((a) => a.dni === dni);
  if (account && !account.active) return fail(409, "La cuenta de esta persona está pausada. Reactivala antes de invitar.");
  const linked = new Set(account ? childIdsOf(db, account.id) : []);
  if (linked.has(input.patient.id)) return fail(409, input.patient.first_name + " ya tiene acceso a sus turnos en el portal.");
  const existing = db.children.find((x) => x.id === input.patient.id);
  if (existing) Object.assign(existing, { first_name: input.patient.first_name, last_name: input.patient.last_name });
  else db.children.push({ id: input.patient.id, first_name: input.patient.first_name, last_name: input.patient.last_name, source: "agenda" });
  const nowIso = new Date().toISOString();
  const childIds = [input.patient.id];
  const guardianIds: Record<string, string> = {};
  const kinds: NonNullable<Invitation["kinds"]> = {};
  const { selfIds, replaced } = carryPending(db, dni, linked, childIds, guardianIds, kinds, nowIso, [input.patient.id]);
  const code = newCode();
  const purpose: Purpose = account ? "vincular" : "activacion";
  const expires = new Date(Date.now() + input.expires_days * 24 * 60 * 60 * 1000).toISOString();
  db.invitations.push({
    code, dni, purpose,
    first_name: input.patient.first_name, last_name: input.patient.last_name,
    child_ids: childIds, guardian_ids: guardianIds, self_ids: selfIds, kinds,
    relationship_kind: "titular", authorized_by: null,
    account_id: account?.id ?? null,
    phone: input.patient.phone, in_person: input.in_person, channel: input.channel,
    identity_checked_on: input.identity_checked_on, issued_by: input.issued_by,
    created_at: nowIso, expires_at: expires, used_at: null, revoked_at: null, failed_attempts: 0,
  });
  save(db);
  return ok({
    code: formatCode(code), raw_code: code, purpose, expires_at: expires,
    first_name: input.patient.first_name,
    children: childIds.filter((id) => !selfIds.includes(id)).map((id) => db.children.find((c) => c.id === id)?.first_name).filter((n): n is string => !!n),
    self: true,
    replaced,
  });
}

export async function staffAccessStatus(rawDni: string | null, patientId: string, self = false): Promise<AccessStatus> {
  const dni = normalizeDni(rawDni ?? "");
  if (!isValidDni(dni)) return { state: "sin_dni" };
  const db = load();
  const account = db.accounts.find((a) => a.dni === dni);
  if (account && childIdsOf(db, account.id).includes(patientId) && isSelfLink(db, account.id, patientId) === self) {
    return { state: account.active ? "activo" : "pausado" };
  }
  const inv = db.invitations
    .filter((i) => i.dni === dni && !i.used_at && !i.revoked_at && i.child_ids.includes(patientId)
      && (i.self_ids ?? []).includes(patientId) === self)
    .sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
  if (inv) {
    if (inv.failed_attempts >= INVITATION_MAX_FAILS) return { state: "bloqueada" };
    if (Date.parse(inv.expires_at) < Date.now()) return { state: "vencida" };
    return { state: "invitado", expires_at: inv.expires_at };
  }
  return { state: "ninguno", has_account: !!account };
}

// ── Bandeja del equipo (panel) ──────────────────────────────────────────────
// Pedidos de copia de la historia clínica y avisos de "no vamos a poder ir".
// En producción: POST /api/portal-staff/inbox (server/lib/requests.ts).

const NOTICE_DAYS = 90; // avisos que se miran hacia atrás
const RESOLVED_DAYS = 14; // los resueltos se siguen mostrando un tiempo
const HC_CLOSED_DAYS = 30; // pedidos cerrados que se siguen mostrando

// En la base los ids son UUID; acá alcanza con que haya algo
const validId = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 64;

// Nombre ("Apellido, Nombre") y DNI del paciente como los ve el equipo. Los
// chicos invitados desde el panel se leen de su ficha en la agenda del mock;
// los de la demo no tienen ficha (sin DNI).
async function patientInfo(db: Db, childIds: string[]): Promise<Map<string, { name: string; dni: string | null }>> {
  const out = new Map<string, { name: string; dni: string | null }>();
  for (const id of new Set(childIds)) {
    const c = db.children.find((x) => x.id === id);
    let p: Row | undefined;
    if (c?.source === "agenda") {
      const { data } = await mockSupabase.from("patients").select("*").eq("id", id);
      p = ((data ?? []) as Row[])[0];
    }
    const first = p ? String(p.first_name ?? "") : c?.first_name;
    const last = p ? String(p.last_name ?? "") : c?.last_name;
    out.set(id, {
      name: first !== undefined ? `${last}, ${first}` : "Paciente",
      dni: p?.dni ? String(p.dni) : null,
    });
  }
  return out;
}

// Para un pedido abierto: ¿quien lo hizo sigue pudiendo pedirla hoy? null si
// el pedido está cerrado; false si la cuenta ya no existe o ya no tiene un
// vínculo con derecho a la copia (titular o representante legal). El mock no
// tiene edad ni alta: alcanza con el tipo de vínculo (el alta tampoco cuenta
// en la base: no quita el derecho a la copia).
function stillAllowed(db: Db, r: HcRequest): boolean | null {
  if (!HC_OPEN_STATUSES.includes(r.status)) return null;
  const acc = r.account_id ? db.accounts.find((a) => a.id === r.account_id) : undefined;
  if (!acc) return false;
  return canRequestHcFor(db, acc.id, r.patient_id);
}

async function toStaffHc(db: Db, rows: HcRequest[]): Promise<StaffHcRequest[]> {
  if (!rows.length) return [];
  const info = await patientInfo(db, rows.map((r) => r.patient_id));
  return rows.map((r) => {
    const { account_id: _a, updated_at: _u, events, ...rest } = r;
    const p = info.get(r.patient_id);
    return {
      ...rest,
      patient_name: p?.name ?? "Paciente",
      patient_dni: p?.dni ?? null,
      still_allowed: stillAllowed(db, r),
      events: [...(events ?? [])].sort((x, y) => x.at.localeCompare(y.at)), // del más viejo al más nuevo
    };
  });
}

// Abiertos (los más viejos primero) y cerrados de los últimos 30 días
async function staffHcList(db: Db): Promise<StaffHcRequest[]> {
  const since = Date.now() - HC_CLOSED_DAYS * DAY_MS;
  const isOpen = (r: HcRequest) => HC_OPEN_STATUSES.includes(r.status);
  const open = db.hc_requests.filter(isOpen).sort((x, y) => x.created_at.localeCompare(y.created_at));
  const closed = db.hc_requests
    .filter((r) => !isOpen(r) && Date.parse(r.updated_at) >= since)
    .sort((x, y) => y.updated_at.localeCompare(x.updated_at))
    .slice(0, 100);
  return toStaffHc(db, [...open, ...closed]);
}

// Todos los turnos que conoce el portal: los de la demo y los de los chicos
// invitados desde el panel (agenda del mock)
async function allAppts(db: Db): Promise<Map<string, Appt>> {
  const agendaIds = db.children.filter((c) => c.source === "agenda").map((c) => c.id);
  return new Map([...db.appts, ...(await agendaAppts(agendaIds))].map((a) => [a.id, a]));
}

// Cómo quedó el aviso: lo que cargó el equipo o lo que se deduce del turno
// (cancelado, falta justificada, o vinieron igual). Si el turno no cambió,
// sigue pendiente aunque alguien lo haya intentado resolver: así se puede
// reintentar (igual que el servidor).
function resolutionOf(r: Response, a: Appt): NoticeResolution | null {
  if (r.outcome) return r.outcome;
  if (a.status === "cancelado") return "cancelado";
  if (a.attendance === "justificado") return "justificado";
  if (a.attendance === "presente") return "asistio";
  return null;
}

async function staffNotices(db: Db): Promise<StaffNotice[]> {
  const since = Date.now() - NOTICE_DAYS * DAY_MS;
  // Vale la respuesta más nueva de cada turno (si después confirmaron, ya no es un aviso)
  const newest = new Map<string, Response>();
  const recent = db.responses.filter((r) => Date.parse(r.at) >= since).sort((x, y) => y.at.localeCompare(x.at));
  for (const r of recent) if (!newest.has(r.appointment_id)) newest.set(r.appointment_id, r);
  const notices = [...newest.values()].filter((r) => r.kind === "no_puedo");
  if (!notices.length) return [];

  const appts = await allAppts(db);
  const info = await patientInfo(db, notices.map((r) => appts.get(r.appointment_id)?.child_id).filter((x): x is string => !!x));
  const now = centerNow();
  const resolvedSince = Date.now() - RESOLVED_DAYS * DAY_MS;
  const out: StaffNotice[] = [];
  for (const r of notices) {
    const a = appts.get(r.appointment_id);
    if (!a) continue;
    const resolution = resolutionOf(r, a);
    // Los resueltos se ven un tiempo (desde que se resolvieron o, si se
    // deducen del turno, desde el turno)
    if (resolution && Date.parse(r.resolved_at ?? `${a.date}T${a.time}:00-03:00`) < resolvedSince) continue;
    const acc = db.accounts.find((x) => x.id === r.account_id);
    out.push({
      response_id: r.id,
      appointment_id: a.id,
      patient_id: a.child_id,
      patient_name: info.get(a.child_id)?.name ?? "Paciente",
      date: a.date,
      time: a.time,
      modality: a.modality,
      professional_name: a.professional_name,
      requester_name: acc ? `${acc.first_name} ${acc.last_name}`.trim() : null,
      is_self: !!acc && isSelfLink(db, acc.id, a.child_id),
      reason_code: r.reason_code,
      reason_text: r.reason_text,
      at: r.at,
      on_time: isNoticeOnTime(r.at, a.date),
      is_past: `${a.date} ${a.time}` <= `${now.date} ${now.time}`,
      resolution,
      // La cuenta sigue activa y vinculada, y el turno es de hoy en adelante
      family_sees: a.date >= now.date && !!acc?.active && childIdsOf(db, acc.id).includes(a.child_id),
      resolved_at: r.resolved_at,
      resolved_by_email: r.resolved_by_email,
    });
  }
  // Pendientes primero, por fecha del turno; después los resueltos más nuevos
  return out.sort((x, y) => (x.resolution === null) !== (y.resolution === null)
    ? (x.resolution === null ? -1 : 1)
    : x.resolution === null
      ? `${x.date}${x.time}`.localeCompare(`${y.date}${y.time}`)
      : (y.resolved_at ?? y.at).localeCompare(x.resolved_at ?? x.at));
}

export async function staffInbox(): Promise<ApiResult<StaffInbox>> {
  await wait(350);
  const db = load();
  const hc = await staffHcList(db);
  const notices = await staffNotices(db);
  return ok({ hc, notices });
}

export async function staffInboxCount(): Promise<StaffInboxCount> {
  await wait(150);
  const db = load();
  return {
    hc_pending: db.hc_requests.filter((r) => r.status === "pendiente").length,
    notices_pending: (await staffNotices(db)).filter((n) => n.resolution === null).length,
  };
}

export async function staffHcUpdate(input: {
  id: string; to: HcStaffTarget; delivered_to_name?: string; delivered_to_dni?: string; reject_reason?: HcRejectReason;
}, issuedBy: string): Promise<ApiResult<StaffHcRequest>> {
  await wait(400);
  if (!validId(input.id)) return fail(400, "Pedido inválido");
  const db = load();
  const row = db.hc_requests.find((r) => r.id === input.id);
  if (!row) return fail(404, HC_NOT_FOUND);
  const to = String(input.to) as HcStaffTarget;
  if (!HC_TRANSITIONS[row.status].includes(to)) return fail(409, "Este pedido ya cambió de estado. Actualizá la bandeja.");

  const now = new Date().toISOString();
  let patch: Partial<HcRequest>;
  if (to === "lista") {
    patch = { ready_at: now, ready_by_email: issuedBy };
  } else if (to === "pendiente") {
    patch = { ready_at: null, ready_by_email: null };
  } else if (to === "entregada") {
    const name = String(input.delivered_to_name ?? "").replace(/\s+/g, " ").trim();
    const dni = normalizeDni(String(input.delivered_to_dni ?? ""));
    if (name.length < 3 || name.length > 120) return fail(400, "Escribí el nombre de quien la retiró.");
    if (!isValidDni(dni)) return fail(400, "Revisá el DNI de quien la retiró.");
    patch = { delivered_at: now, delivered_by_email: issuedBy, delivered_to_name: name, delivered_to_dni: dni };
  } else {
    const reason = HC_REJECT_REASONS.find((x) => x === input.reject_reason);
    if (!reason) return fail(400, "Elegí el motivo.");
    patch = { rejected_at: now, rejected_by_email: issuedBy, reject_reason: reason };
  }
  Object.assign(row, patch, { status: to, updated_at: now });
  logHcEvent(row, to, issuedBy, now);
  save(db);
  return ok((await toStaffHc(db, [row]))[0]);
}

// Las notas no cambian updated_at, pero dejan constancia de quién las editó.
// portalStaffApi.hcNotes no pasa el email: se toma de la sesión del panel (mock)
export async function staffHcNotes(id: string, notes: string, issuedBy?: string): Promise<ApiResult<{ ok: true }>> {
  await wait(300);
  if (!validId(id)) return fail(400, "Pedido inválido");
  const text = String(notes ?? "").trim();
  if (text.length > 500) return fail(400, "Las notas pueden tener hasta 500 caracteres.");
  const by = issuedBy || (await mockSupabase.auth.getSession()).data.session?.user?.email || "demo@cimt.local";
  const db = load();
  const row = db.hc_requests.find((r) => r.id === id);
  if (!row) return fail(404, HC_NOT_FOUND);
  row.staff_notes = text || null;
  logHcEvent(row, "nota", by);
  save(db);
  return ok({ ok: true as const });
}

// Justificar o cancelar cambia el turno, solo si sigue sin cancelar y sin
// asistencia (o con "ausente"). Los turnos de la demo viven acá; los de los
// chicos invitados, en la agenda del mock (como lo haría el panel).
// "changed": el turno ya no está para tocarlo (o ya no existe).
async function changeApptForNotice(appointmentId: string, how: "justificar" | "cancelar"): Promise<"ok" | "changed" | "error"> {
  const untouched = (x: { status?: unknown; attendance?: unknown }) =>
    x.status !== "cancelado" && (x.attendance == null || x.attendance === "ausente");
  const db = load();
  const demo = db.appts.find((x) => x.id === appointmentId);
  if (demo) {
    if (!untouched(demo)) return "changed";
    if (how === "cancelar") demo.status = "cancelado";
    else demo.attendance = "justificado";
    save(db);
    return "ok";
  }
  const { data, error: rErr } = await mockSupabase.from("appointments").select("*").eq("id", appointmentId);
  if (rErr) return "error";
  const row = ((data ?? []) as Row[])[0];
  if (!row || !untouched(row)) return "changed";
  const { error } = await mockSupabase.from("appointments")
    .update(how === "cancelar" ? { status: "cancelado" } : { attendance: "justificado" })
    .eq("id", appointmentId).neq("status", "cancelado");
  return error ? "error" : "ok";
}

export async function staffResolveNotice(responseId: string, how: NoticeAction, issuedBy: string): Promise<ApiResult<{ ok: true }>> {
  await wait(400);
  if (!validId(responseId)) return fail(400, "Pedido inválido");
  if (!(NOTICE_ACTIONS as readonly string[]).includes(String(how))) return fail(400, "Elegí cómo se resolvió.");
  const db = load();
  const r = db.responses.find((x) => x.id === responseId);
  if (!r || r.kind !== "no_puedo") return fail(404, "No encontramos ese aviso.");
  if (newestResponse(db, r.appointment_id)?.id !== r.id) return fail(409, "La familia cambió su respuesta. Actualizá la bandeja.");
  const a = (await allAppts(db)).get(r.appointment_id);
  if (!a) return fail(404, "No encontramos el turno de ese aviso.");
  if (resolutionOf(r, a)) return fail(409, "Este aviso ya está resuelto. Actualizá la bandeja.");
  const now = centerNow();
  if (how === "cancelar" && `${a.date} ${a.time}` <= `${now.date} ${now.time}`) {
    return fail(409, "El turno ya pasó: no se puede cancelar. Usá «Justificar la falta» o «Tomamos nota».");
  }

  // 1. Se reserva el aviso (con los datos de ahora, que otra pestaña pudo
  //    cambiar mientras se leía la agenda): si dos personas lo resuelven a la
  //    vez, gana una
  const at = new Date().toISOString();
  const claimDb = load();
  const claimed = claimDb.responses.find((x) => x.id === r.id);
  // Se compara con lo que se leyó: un intento anterior que no llegó a
  // cambiar el turno se puede reintentar
  if (!claimed || claimed.resolved_at !== r.resolved_at || claimed.outcome !== null) {
    return fail(409, "Otra persona del equipo ya resolvió este aviso. Actualizá la bandeja.");
  }
  claimed.outcome = how === "reprogramar" ? "reprogramado" : how === "visto" ? "otro" : null;
  claimed.resolved_at = at;
  claimed.resolved_by_email = issuedBy;
  save(claimDb);
  const release = () => {
    const d = load();
    const x = d.responses.find((y) => y.id === r.id);
    if (x && x.resolved_at === at) {
      Object.assign(x, { outcome: null, resolved_at: null, resolved_by_email: null });
      save(d);
    }
  };

  // 2. Si la familia cambió su respuesta mientras tanto, no se toca nada
  if (newestResponse(load(), r.appointment_id)?.id !== r.id) {
    release();
    return fail(409, "La familia cambió su respuesta. Actualizá la bandeja.");
  }

  // 3. Justificar o cancelar cambia el turno
  if (how === "justificar" || how === "cancelar") {
    const changed = await changeApptForNotice(a.id, how);
    if (changed !== "ok") {
      release();
      return changed === "error"
        ? fail(503, "No se pudo actualizar el turno. Probá de nuevo.")
        : fail(409, "El turno cambió (ya tiene asistencia cargada o está cancelado). Actualizá la bandeja.");
    }
  }
  return ok({ ok: true as const });
}
