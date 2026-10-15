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
  type ApptDTO, type HcChannel, type HcDigitalBlock, type HcRejectReason, type HcRequestDTO, type ReasonCode,
  type ResponseKind,
  centerNow, hcRejectedFresh,
} from "@/lib/portalRules";
import type { ChildClinicalDTO, FamilyClinicalDTO } from "@/lib/portalClinicalRules";
import type { InfoDTO } from "@/lib/portalInfoRules";
import type { ApptRequestDTO, ApptRequestInput } from "@/lib/apptRequestRules";
import type {
  CelebrationDTO, FeedbackDTO, MedalsDTO, PracticeActionResult, PracticeDTO, PracticeExerciseDTO, PracticeLogInput,
  PracticeNoteInput,
} from "@/lib/practiceRules";

export {
  type ChildClinicalDTO, type ClinicalFeature, type FamilyClinicalDTO, type PublicOutcome,
  CLINICAL_NOTICE_VERSION,
} from "@/lib/portalClinicalRules";

export {
  type ApptDTO, type HcChannel, type HcDigitalBlock, type HcDocumentDTO, type HcRejectReason, type HcRequestDTO,
  type HcStatus, type Outcome, type ReasonCode, type ResponseKind,
  HC_CHANNELS, HC_DOC_MAX_BYTES,
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
  // Información de salud: si esta cuenta puede verla (solo con la etapa prendida)
  clinical?: ChildClinicalDTO;
};

export type MeDTO = {
  guardian_first_name: string;
  week: ApptDTO[]; // próximos 7 días, todos los chicos
  children: ChildDTO[];
  requests: HcRequestDTO[]; // pedidos de copia de la historia clínica (abiertos y recientes)
  appt_requests: ApptRequestDTO[]; // pedidos de turno (abiertos y recientes, de todas las personas)
  // Se pueden pedir turnos desde el portal (false si el servidor todavía no
  // los tiene: no hay que invitar a pedirlos)
  can_request_appts: boolean;
  clinical?: FamilyClinicalDTO; // solo con la etapa "consent" prendida
  // Etapa "practice": la medalla nueva que esta cuenta todavía no vio (la de
  // más prioridad, para el aviso destacado del Inicio). null o ausente: ninguna
  celebration?: CelebrationDTO | null;
};

// Página de un chico: sus turnos y la copia de su historia clínica
export type ChildPageDTO = {
  child: { id: string; first_name: string; self?: boolean };
  // El servidor tiene prendida "Mi información" (etapa info): si no, la página
  // de información no la pide y muestra solo la copia del historial
  info_on: boolean;
  appointments: ApptDTO[];
  // digital (etapa E1): si se ofrece recibirla por el portal y, si no se
  // puede, por qué (consent: activar la información de salud; verify: pasar
  // por el centro). Sin la etapa prendida: { offered: false, blocked: null }
  hc: { can_request: boolean; requests: HcRequestDTO[]; digital: { offered: boolean; blocked: HcDigitalBlock | null } };
  // Pedidos de turno de esta persona (de cualquier adulto de la familia).
  // enabled: el servidor tiene los pedidos de turno · can_request: se puede
  // pedir uno ahora (no hay otro abierto)
  turnos: { enabled: boolean; can_request: boolean; requests: ApptRequestDTO[] };
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

// ── Información de salud en el portal (borrador hasta que lo apruebe Legales) ──

export const CLINICAL_NOTICE_POINTS = [
  "Tu profesional puede compartir acá lo que trabajan en el tratamiento, explicado de forma simple, y más adelante documentos, ejercicios, devoluciones y medallas.",
  "Nada aparece hasta que tu profesional lo revisa y lo publica. Lo importante te lo decimos primero en el centro.",
  "Para adaptar ejercicios, el equipo puede usar una herramienta de inteligencia artificial. No le pasamos nada que permita saber quién es la persona, y alguien del equipo revisa todo antes de publicarlo.",
  "Lo que marcás en los ejercicios y tus comentarios los ve solo el equipo profesional del CIMT.",
  "Un adulto autorizado sigue viendo solo los turnos.",
  "Si compartís el celular, tocá «Salir» al terminar: acá hay información de salud.",
  "Podés dejar de verla cuando quieras desde esta misma pantalla. Los turnos siguen funcionando igual.",
];

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
  duplicado: "Cerramos este pedido: ya había otro igual en curso.",
  otro: "No pudimos prepararla. Llamanos para coordinar.",
};

// Una rechazada va en rojo solo la primera semana (hcRejectedFresh); después,
// el mismo texto en gris, como lo demás ya resuelto
export function hcStatus(r: HcRequestDTO, now: Date = new Date()): { tone: ApptTone; text: string } {
  switch (r.status) {
    case "pendiente": return { tone: "warn", text: "Pedido recibido · la estamos preparando" };
    case "lista": return { tone: "ok", text: "Lista para retirar en el centro" };
    case "entregada": return { tone: "muted", text: `Entregada el ${stampLabel(r.delivered_at ?? r.created_at)}` };
    case "rechazada":
      return {
        tone: hcRejectedFresh(r, now) ? "bad" : "muted",
        text: r.reject_reason ? HC_REJECT_TEXT[r.reject_reason] : "No pudimos prepararla. Llamanos.",
      };
    case "cancelada": return { tone: "muted", text: "Cancelaste el pedido" };
    case "enviada":
      return r.documents.length
        ? { tone: "ok", text: `Lista para descargar hasta el ${stampLabel(r.available_until ?? r.created_at).split(" a las")[0]}` }
        : { tone: "muted", text: "Enviada por el portal: ya no está disponible para descargar" };
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
  // Un cambio (responder un turno, pedir una copia…) deja vieja cualquier /me
  // en curso: el próximo me() pregunta de nuevo
  if ((init.method ?? "GET") !== "GET") meInFlight = null;
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

let meInFlight: Promise<ApiResult<MeDTO>> | null = null;

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
  // Si el marco del portal y la página piden /me a la vez, comparten la misma
  // consulta (no se guarda nada: el próximo pedido vuelve a preguntar)
  me(): Promise<ApiResult<MeDTO>> {
    if (!PORTAL_ENABLED) return Promise.resolve(UNAVAILABLE);
    if (meInFlight) return meInFlight;
    const p: Promise<ApiResult<MeDTO>> = (MOCK ? mock().then((m) => m.me()) : call<MeDTO>("me"))
      .finally(() => { if (meInFlight === p) meInFlight = null; });
    meInFlight = p;
    return p;
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
  // channel: cómo la quiere recibir ("portal" solo con la etapa E1 y si la cuenta puede)
  async hcCreate(patientId: string, channel: HcChannel = "mano"): Promise<ApiResult<HcRequestDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).hcCreate(patientId, channel);
    return call("hc", { method: "POST", body: { action: "create", patient_id: patientId, channel } });
  },
  // Descargar un PDF de la copia enviada por el portal: enlace que vence en
  // 60 segundos (403 code REAUTH: pedir la contraseña; CONSENT, VERIFY)
  async hcDocument(documentId: string): Promise<ApiResult<{ url: string; expires_in: number; file_name: string }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).hcDocument(documentId);
    return call("document", { method: "POST", body: { id: documentId } });
  },
  async hcCancel(id: string): Promise<ApiResult<HcRequestDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).hcCancel(id);
    return call("hc", { method: "POST", body: { action: "cancel", id } });
  },
  // Información de salud: activarla (con la contraseña) o dejar de verla
  async clinicalConsent(accept: boolean, password?: string): Promise<ApiResult<FamilyClinicalDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).clinicalConsent(accept, password);
    return call("consent", { method: "POST", body: accept ? { accept: true, password } : { accept: false } });
  },
  // "Volvé a poner tu contraseña" antes de ver información de salud
  async reauth(password: string): Promise<ApiResult<{ ok: true }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).reauth(password);
    return call("reauth", { method: "POST", body: { password } });
  },
  // Pedir un turno (el centro lo asigna) y cancelar el pedido
  async apptRequestCreate(patientId: string, input: ApptRequestInput): Promise<ApiResult<ApptRequestDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).apptRequestCreate(patientId, input);
    return call("pedido-turno", { method: "POST", body: { action: "create", patient_id: patientId, ...input } });
  },
  async apptRequestCancel(id: string): Promise<ApiResult<ApptRequestDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).apptRequestCancel(id);
    return call("pedido-turno", { method: "POST", body: { action: "cancel", id } });
  },
  // "Mi información": lo que publicó el profesional (403 code REAUTH: pedir la contraseña)
  async info(patientId: string): Promise<ApiResult<InfoDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).info(patientId);
    return call(`info?id=${encodeURIComponent(patientId)}`);
  },
  // ── Ejercicios (etapa practice): GET /api/portal/practice?view=…&id=… y
  // POST /api/portal/practice { action }. Sin contraseña de nuevo. 403 con
  // code CONSENT, VERIFY o NOT_AVAILABLE; un paciente o ejercicio ajeno da
  // el mismo 404 que uno que no existe.
  // "Ejercicios de Martín": plan, ejercicios, semana, metas, última devolución y medallas
  async practice(patientId: string): Promise<ApiResult<PracticeDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practice(patientId);
    return call(`practice?view=plan&id=${encodeURIComponent(patientId)}`);
  },
  // Pantalla de práctica de un ejercicio (del plan publicado)
  async exercise(exerciseId: string): Promise<ApiResult<PracticeExerciseDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practiceExercise(exerciseId);
    return call(`practice?view=exercise&id=${encodeURIComponent(exerciseId)}`);
  },
  // "Ya lo hice": queda anotado en ese momento (uno por ejercicio y por día;
  // si otro adulto ya lo anotó, devuelve ese registro). practiced_on: ayer o
  // anteayer (sin fecha: hoy). 400 code DATE; 429 code LIMIT (40 por día)
  async practiceLog(input: PracticeLogInput): Promise<ApiResult<PracticeActionResult>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practiceLog(input);
    return call("practice", { method: "POST", body: { action: "log", ...input } });
  },
  // "¿Cómo te fue?" y el comentario optativo (una nota por cuenta y por práctica; 409 si ya la dejó)
  async practiceNote(input: PracticeNoteInput): Promise<ApiResult<PracticeActionResult>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practiceNote(input);
    return call("practice", { method: "POST", body: { action: "note", ...input } });
  },
  // Deshacer: solo lo que anotó esta cuenta, el mismo día
  async practiceUndo(logId: string): Promise<ApiResult<PracticeActionResult>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practiceUndo(logId);
    return call("practice", { method: "POST", body: { action: "undo", log_id: logId } });
  },
  // Devoluciones del profesional. Solo lee (is_new: esta cuenta todavía no la
  // vio): la página las marca con feedbackSeen(ids) después de mostrarlas
  async feedback(patientId: string): Promise<ApiResult<FeedbackDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practiceFeedback(patientId);
    return call(`practice?view=feedback&id=${encodeURIComponent(patientId)}`);
  },
  // "Medallas de Martín" / "Mis logros"
  async medals(patientId: string): Promise<ApiResult<MedalsDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practiceMedals(patientId);
    return call(`practice?view=medals&id=${encodeURIComponent(patientId)}`);
  },
  // La celebración ya se vio (por cuenta: si hay dos adultos, cada uno la ve una vez)
  async medalsSeen(ids: string[]): Promise<ApiResult<{ ok: true }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practiceMedalsSeen(ids);
    return call("practice", { method: "POST", body: { action: "medals_seen", ids } });
  },
  // Marca devoluciones como leídas por esta cuenta. La página las pide con
  // feedback() (que ya no marca nada) y las marca después de mostrarlas, así
  // "Nueva" se ve aunque la página se cargue dos veces
  async feedbackSeen(ids: string[]): Promise<ApiResult<{ ok: true }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).practiceFeedbackSeen(ids);
    return call("practice", { method: "POST", body: { action: "feedback_seen", ids } });
  },
};

export type { InfoDTO, InfoReportDTO, InfoSummaryDTO } from "@/lib/portalInfoRules";
export type { ApptRequestDTO, ApptRequestInput } from "@/lib/apptRequestRules";
export type {
  CelebrationDTO, FeedbackDTO, FeedbackItemDTO, GoalDTO, MedalDTO, MedalNextDTO, MedalsDTO, MyNoteDTO,
  PracticeActionResult, PracticeChildDTO, PracticeDTO, PracticeDayDTO, PracticeExerciseDTO, PracticeExerciseItemDTO,
  PracticeHomeDTO, PracticeLogInput, PracticeNoteInput, PracticePlanDTO, PracticeResult, ScreenMode, WeekDTO,
} from "@/lib/practiceRules";
