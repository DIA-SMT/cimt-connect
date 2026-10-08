// Portal de familias (fase 1): tipos, formato y cliente de la API.
// Diseño: el adulto responsable ve los turnos de sus chicos y avisa si van o
// no. Nunca recibe datos clínicos: la API devuelve solo ApptDTO y compañía.
// Las acciones de la familia son pedidos que el equipo resuelve desde el panel
// (avisos de turnos y pedidos de copia de la historia clínica, que se entrega
// en mano en el centro: el portal solo muestra el estado del pedido).
//
// Dos modos:
//   - mock (VITE_USE_MOCK=true): todo en el navegador (mockPortal.ts).
//   - real (VITE_PORTAL_ENABLED=true): server/api/portal/* contra Supabase.
// Si ninguno está prendido, el portal no aparece y sus pantallas dicen
// "todavía no está disponible".

import { longDate } from "@/lib/agenda";
import { CENTER } from "@/lib/center";
import {
  type ApptDTO, type HcRejectReason, type HcRequestDTO, type ReasonCode, type ResponseKind,
  centerNow,
} from "@/lib/portalRules";

export {
  type ApptDTO, type HcRejectReason, type HcRequestDTO, type HcStatus, type Outcome, type ReasonCode, type ResponseKind,
  CONFIRM_WINDOW_DAYS, NOTICE_MIN_DAYS, PRIVACY_VERSION, REASON_TEXT_MAX,
  confirmFrom, isValidDni, normalizeCode, normalizeDni, passwordProblem,
} from "@/lib/portalRules";

const MOCK = import.meta.env.VITE_USE_MOCK === "true";
export const PORTAL_MOCK = MOCK;
export const PORTAL_ENABLED = MOCK || import.meta.env.VITE_PORTAL_ENABLED === "true";

// ── Tipos que devuelve la API (nada más que esto) ───────────────────────────

export type ChildDTO = {
  id: string;
  first_name: string;
  last_initial: string;
  self: boolean; // es el propio titular de la cuenta (paciente adulto)
  can_request_hc: boolean; // esta cuenta puede pedir copia de su historia clínica
  next: ApptDTO | null; // próximo turno después de esta semana
};

export type MeDTO = {
  guardian_first_name: string;
  week: ApptDTO[]; // próximos 7 días, todos los chicos
  children: ChildDTO[];
  requests: HcRequestDTO[]; // pedidos de copia de la historia clínica (abiertos y recientes)
};

// Página de un chico: sus turnos y la copia de su historia clínica
export type ChildPageDTO = {
  child: { id: string; first_name: string; self?: boolean };
  appointments: ApptDTO[];
  hc: { can_request: boolean; requests: HcRequestDTO[] };
};

export type ActivationInfo = {
  // activacion: cuenta nueva · recuperacion: contraseña nueva ·
  // vincular: suma chicos a una cuenta que ya existe (pide la contraseña actual)
  purpose: "activacion" | "recuperacion" | "vincular";
  guardian_first_name: string;
  children: string[]; // chicos a cargo: "Martín G."
  self: boolean; // incluye los turnos del propio titular (paciente adulto)
  needs: "new_password" | "current_password";
  needs_privacy: boolean;
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string; retry_at?: string };

// Sesión de la familia que devuelve el servidor real al ingresar o activar
export type SessionTokens = { access_token: string; refresh_token: string };

// ── Motivos de "no vamos a poder ir" ────────────────────────────────────────

export const REASONS: { code: ReasonCode; label: string }[] = [
  { code: "salud", label: "Problema de salud" },
  { code: "escuela", label: "Actividad escolar" },
  { code: "transporte", label: "Problema de transporte" },
  { code: "trabajo", label: "Problema de trabajo" },
  { code: "otro", label: "Otro motivo" },
];

// ── Aviso de privacidad (versión a validar con el área legal) ───────────────

export const PRIVACY_POINTS = [
  `El responsable de tus datos es el CIMT (Municipalidad de San Miguel de Tucumán), ${CENTER.address}.`,
  "Usamos tus datos para mostrarte tus turnos o los de los chicos a tu cargo, y recibir tus avisos y pedidos.",
  "El portal no muestra diagnósticos, informes ni el historial del paciente.",
  "Es optativo: si no lo usás, la atención sigue igual.",
  "Solo el equipo del CIMT ve lo que hacés acá. Registramos los ingresos por seguridad.",
  "Podés pedir acceso a tus datos o corregirlos. La copia del historial del paciente se pide acá o en el centro, y se entrega en mano, con DNI.",
];

// ── Formato ─────────────────────────────────────────────────────────────────

export function apptDateLabel(a: Pick<ApptDTO, "date" | "time">): string {
  return `${capitalize(longDate(a.date).replace(",", ""))} · ${a.time} hs`;
}

export function shortDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric" });
}

export function stampLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} a las ${time}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function isToday(date: string): boolean {
  return date === centerNow().date;
}

// Estado de un turno tal como lo ve la familia
export type ApptTone = "ok" | "warn" | "bad" | "info" | "muted";

export function apptStatus(a: ApptDTO): { tone: ApptTone; text: string } | null {
  const r = a.response;
  // El aviso de otro adulto nunca se presenta como propio
  const whose = r && !r.by_me ? " de otro adulto de la familia" : "";
  if (a.state === "cancelado") {
    if (r?.kind === "no_puedo" && a.outcome === "reprogramado") {
      return { tone: "info", text: "Te contactamos para otro día" };
    }
    if (r?.kind === "no_puedo" && a.outcome === "cancelado") {
      return { tone: "info", text: r.by_me ? "Cancelamos el turno por tu aviso"
        : a.is_self ? "Cancelamos el turno por el aviso de tu familia" : "Cancelamos el turno por el aviso de otro adulto de la familia" };
    }
    return { tone: "bad", text: "Cancelado por el centro" };
  }
  // Un aviso de "no vamos" (y lo que resolvió el centro) se sigue viendo
  // aunque ya haya pasado la hora del turno
  if (r?.kind === "no_puedo") {
    if (a.is_self) {
      if (a.outcome === "justificado") return { tone: "info", text: "Falta justificada" };
      if (a.outcome === "reprogramado") return { tone: "info", text: "Te contactamos para otro día" };
      if (a.outcome === "otro") return { tone: "info", text: r.by_me ? "Recibimos tu aviso" : "Recibimos el aviso de tu familia" };
      return r.by_me
        ? { tone: "bad", text: "Avisaste que no vas · Recibimos tu aviso" }
        : { tone: "bad", text: `Tu familia avisó que no vas · ${stampLabel(r.at)}` };
    }
    if (a.outcome === "justificado") return { tone: "info", text: "Falta justificada" };
    if (a.outcome === "reprogramado") {
      return { tone: "info", text: whose ? `Por el aviso${whose}, te contactamos para otro día` : "Te contactamos para otro día" };
    }
    if (a.outcome === "otro") return { tone: "info", text: whose ? `Recibimos el aviso${whose}` : "Recibimos tu aviso" };
    return r.by_me
      ? { tone: "bad", text: "Avisaste que no van · Recibimos tu aviso" }
      : { tone: "bad", text: `Otro adulto de la familia avisó que no van · ${stampLabel(r.at)}` };
  }
  if (a.is_past) return { tone: "muted", text: "Este turno ya pasó" };
  if (r?.kind === "confirmo") {
    if (a.is_self) {
      return r.by_me ? { tone: "ok", text: "✓ Avisaste que vas" } : { tone: "ok", text: `Tu familia avisó que vas · ${stampLabel(r.at)}` };
    }
    return r.by_me
      ? { tone: "ok", text: "✓ Avisaste que van" }
      : { tone: "ok", text: `Otro adulto de la familia avisó que van · ${stampLabel(r.at)}` };
  }
  if (a.can_confirm) return { tone: "warn", text: "Sin responder" };
  return null;
}

// Estado de un pedido de copia de la historia clínica tal como lo ve la familia
export const HC_REJECT_TEXT: Record<HcRejectReason, string> = {
  no_habilitado: "No la podemos entregar por este medio. Acercate al centro o llamanos.",
  duplicado: "Ya había un pedido igual en curso.",
  otro: "No pudimos prepararla. Llamanos para coordinar.",
};

export function hcStatus(r: HcRequestDTO): { tone: ApptTone; text: string } {
  switch (r.status) {
    case "pendiente": return { tone: "warn", text: "Pedido recibido · la estamos preparando" };
    case "lista": return { tone: "ok", text: "Lista para retirar en el centro" };
    case "entregada": return { tone: "muted", text: `Entregada el ${stampLabel(r.delivered_at ?? r.created_at)}` };
    case "rechazada": return { tone: "bad", text: r.reject_reason ? HC_REJECT_TEXT[r.reject_reason] : "No pudimos prepararla. Llamanos." };
    case "cancelada": return { tone: "muted", text: "Cancelaste el pedido" };
  }
}

export function retryLabel(retryAt?: string): string {
  if (!retryAt) return "en un rato";
  const t = new Date(retryAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `después de las ${t}`;
}

// ── Cliente de la API ───────────────────────────────────────────────────────

type MockApi = typeof import("@/integrations/supabase/mockPortal");
let mockApi: Promise<MockApi> | null = null;
function mock(): Promise<MockApi> {
  mockApi ??= import("@/integrations/supabase/mockPortal");
  return mockApi;
}

async function sessionClient() {
  return (await import("@/integrations/supabase/portalClient")).portalClient();
}

const UNAVAILABLE = { ok: false as const, status: 503, error: "El portal todavía no está disponible." };
const OFFLINE = { ok: false as const, status: 503, error: "No pudimos conectar. Probá de nuevo." };

// Llama a un endpoint del portal con la sesión de la familia. Si el token
// venció, lo renueva una vez; si la sesión ya no sirve, la cierra.
async function call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; auth?: boolean } = {}): Promise<ApiResult<T>> {
  const client = await sessionClient();
  const send = async (token: string | null) => fetch(`/api/portal/${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  try {
    const token = init.auth === false ? null : (await client.auth.getSession()).data.session?.access_token ?? null;
    let res = await send(token);
    if (res.status === 401 && token) {
      const { data } = await client.auth.refreshSession();
      if (data.session) res = await send(data.session.access_token);
      if (res.status === 401) await client.auth.signOut({ scope: "local" });
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false, status: res.status,
        error: typeof json.error === "string" ? json.error : "No pudimos conectar. Probá de nuevo.",
        code: typeof json.code === "string" ? json.code : undefined,
        retry_at: typeof json.retry_at === "string" ? json.retry_at : undefined,
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return OFFLINE;
  }
}

// Guarda la sesión que devuelve el servidor al ingresar o activar
async function keepSession<T extends { session?: SessionTokens }>(r: ApiResult<T>): Promise<ApiResult<T>> {
  if (!r.ok || !r.data.session) return r;
  const client = await sessionClient();
  const { error } = await client.auth.setSession(r.data.session);
  if (error) return OFFLINE;
  return r;
}

export const portalApi = {
  async hasSession(): Promise<boolean> {
    if (!PORTAL_ENABLED) return false;
    if (MOCK) return (await mock()).hasSession();
    const client = await sessionClient();
    return !!(await client.auth.getSession()).data.session;
  },
  async login(dni: string, password: string): Promise<ApiResult<{ first_name: string }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).login(dni, password);
    return keepSession(await call<{ first_name: string; session: SessionTokens }>("login", { method: "POST", body: { dni, password }, auth: false }));
  },
  async logout(): Promise<void> {
    if (!PORTAL_ENABLED) return;
    if (MOCK) { (await mock()).logout(); return; }
    // Cierra la sesión también en Supabase Auth (revoca el refresh token)
    const client = await sessionClient();
    await client.auth.signOut().catch(() => client.auth.signOut({ scope: "local" }));
  },
  async requestRecovery(dni: string): Promise<ApiResult<{ ok: true }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).requestRecovery(dni);
    return call("recovery", { method: "POST", body: { dni }, auth: false });
  },
  async activationCheck(dni: string, code: string): Promise<ApiResult<ActivationInfo>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).activationCheck(dni, code);
    return call("activation-check", { method: "POST", body: { dni, code }, auth: false });
  },
  async activationComplete(input: {
    dni: string; code: string; password: string; password_repeat: string; accept_privacy_version?: string;
  }): Promise<ApiResult<{ first_name: string; children: string[]; self?: boolean }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).activationComplete(input);
    return keepSession(await call<{ first_name: string; children: string[]; self?: boolean; session: SessionTokens }>("activation-complete", { method: "POST", body: input, auth: false }));
  },
  async me(): Promise<ApiResult<MeDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).me();
    return call("me");
  },
  async childAppointments(patientId: string): Promise<ApiResult<ChildPageDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).childAppointments(patientId);
    return call(`child?id=${encodeURIComponent(patientId)}`);
  },
  async appointment(appointmentId: string): Promise<ApiResult<ApptDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).appointment(appointmentId);
    return call(`appointment?id=${encodeURIComponent(appointmentId)}`);
  },
  async respond(input: {
    appointment_id: string; response: ResponseKind; reason_code?: ReasonCode; reason_text?: string;
  }): Promise<ApiResult<ApptDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).respond(input);
    return call("respond", { method: "POST", body: input });
  },
  // Pedido de copia de la historia clínica (se entrega en mano en el centro)
  async hcCreate(patientId: string): Promise<ApiResult<HcRequestDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).hcCreate(patientId);
    return call("hc", { method: "POST", body: { action: "create", patient_id: patientId } });
  },
  async hcCancel(id: string): Promise<ApiResult<HcRequestDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).hcCancel(id);
    return call("hc", { method: "POST", body: { action: "cancel", id } });
  },
};
