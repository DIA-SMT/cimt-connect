// Portal de familias — lado del equipo (panel interno).
// Invitar a un adulto responsable y ver el estado de su acceso, y la bandeja
// del portal (pedidos de copia de la historia clínica y avisos de turnos).
// Todas las personas del panel pueden usarlo (la bandeja la ven todos).
// En modo mock usa mockPortal.ts; si no, server/api/portal-staff/* con la
// sesión del panel.

import { supabase } from "@/integrations/supabase/client";
import { CENTER } from "@/lib/center";
import { PORTAL_ENABLED, type ApiResult } from "@/lib/portal";
import type { ClinicalBlock, ClinicalFeature, StaffClinicalDTO } from "@/lib/portalClinicalRules";
import type { StaffInfoDTO, WithdrawReason } from "@/lib/portalInfoRules";
import type { ApptReqRejectReason, ApptReqStaffTarget, ApptReqStatus, StaffApptRequest } from "@/lib/apptRequestRules";
import type { PracticeAction, StaffPracticeDTO } from "@/lib/practiceRules";
import type { AiDraftRequest, AiDraftResult } from "@/lib/aiDraftRules";
import type {
  HcEventKind, HcRejectReason, HcSendAcks, HcStaffTarget, HcStatus, NoticeAction, NoticeResolution,
  StaffHcRequest, StaffInbox, StaffInboxCount,
} from "@/lib/portalRules";

export {
  type HcEvent, type HcEventKind, type HcRejectReason, type HcStaffTarget, type HcStatus, type NoticeAction,
  type NoticeResolution, type StaffHcRequest, type StaffHcDocument, type HcSendAcks, type HcChannel,
  HC_DOC_MAX_BYTES, HC_DOC_MAX_FILES,
  type StaffInbox, type StaffInboxCount, type StaffNotice,
  HC_REJECT_REASONS, HC_TRANSITIONS, NOTICE_ACTIONS,
} from "@/lib/portalRules";

const MOCK = import.meta.env.VITE_USE_MOCK === "true";

export type RelationshipKind = "representante_legal" | "autorizado";

export const RELATIONSHIP_KIND_LABEL: Record<RelationshipKind, string> = {
  representante_legal: "Representante legal (madre, padre o tutor/a)",
  autorizado: "Adulto autorizado (abuela/o, pareja, otro familiar)",
};

export type StaffInviteInput = {
  guardian: { id: string; dni: string | null; full_name: string; phone: string | null };
  // Chicos a vincular, cada uno con la fila de este adulto en su ficha
  children: { id: string; first_name: string; last_name: string; guardian_id: string }[];
  adolescent_consents: string[]; // chicos de 16 o 17 que dieron su conformidad
  relationship_kind: RelationshipKind;
  authorized_by?: string;
  identity_checked_on: string; // AAAA-MM-DD: cuándo se vio el DNI en persona
  in_person: boolean; // la persona está en el centro ahora
  channel: "whatsapp" | "impresa";
  expires_days: number;
  issued_by: string;
};

export type StaffInviteResult = {
  code: string; // "12345 67890", se muestra una sola vez
  raw_code: string;
  purpose: "activacion" | "vincular";
  expires_at: string;
  first_name: string;
  children: string[]; // chicos a cargo
  self?: boolean; // incluye los turnos del propio paciente adulto
  replaced?: boolean; // anuló otro código pendiente de la misma persona
};

// Invitación para el propio paciente adulto (vínculo "titular")
export type StaffInviteSelfInput = {
  patient: { id: string; dni: string | null; first_name: string; last_name: string; phone: string | null };
  identity_checked_on: string;
  in_person: boolean;
  channel: "whatsapp" | "impresa";
  expires_days: number;
  issued_by: string;
};

export type AccessStatus =
  | { state: "sin_dni" }
  | { state: "ninguno"; has_account: boolean }
  | { state: "invitado"; expires_at: string }
  | { state: "vencida" }
  | { state: "bloqueada" }
  | { state: "activo" }
  | { state: "pausado" }
  | { state: "bloqueo_judicial" }; // adulto bloqueado por orden judicial para este paciente

export const INVITE_EXPIRY_DAYS = { whatsapp: 7, impresa: 14 } as const;

// Edad en años cumplidos a partir de la fecha de nacimiento (AAAA-MM-DD)
export function ageOn(birth: string, today = new Date()): number {
  const [y, m, d] = birth.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

export function dniWithDots(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function inviteLink(rawCode: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/portal/activar#c=${rawCode}`;
}

// Mensaje de WhatsApp: sin datos clínicos, con aviso antiestafa
export function inviteMessage(r: StaffInviteResult): string {
  const until = new Date(r.expires_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  // Qué va a ver: sus propios turnos, los de sus chicos, o los dos
  const what = [r.self ? "tus turnos" : null, r.children.length ? `los de ${r.children.join(" y ")}` : null]
    .filter(Boolean).join(" y ").replace(/^los de/, "los turnos de");
  const intro = r.purpose === "vincular"
    ? `Hola ${r.first_name}, te escribimos del CIMT. Te mandamos un código para sumar ${what} a tu cuenta del Portal de familias.`
    : `Hola ${r.first_name}, te escribimos del CIMT. Te invitamos al Portal de familias para ver ${what} y avisarnos si ${r.self && !r.children.length ? "podés" : "pueden"} venir.`;
  return [
    intro,
    `Entrá a ${inviteLink(r.raw_code)}`,
    `Tu código: ${r.code} · vence el ${until}. Vas a necesitar tu DNI.`,
    "No le pases este código a nadie: nadie del CIMT te lo va a pedir por teléfono ni por WhatsApp.",
    `Si no esperabas este mensaje, ignoralo o llamanos al ${CENTER.phoneDisplay}.`,
  ].join("\n");
}

const UNAVAILABLE = { ok: false as const, status: 503, error: "El portal todavía no está disponible." };

type MockPortal = typeof import("@/integrations/supabase/mockPortal");
let mockApi: Promise<MockPortal> | null = null;
function mock(): Promise<MockPortal> {
  mockApi ??= import("@/integrations/supabase/mockPortal");
  return mockApi;
}

async function staffCall<T>(body: unknown, path: "access" | "inbox" | "clinical" | "practice" | "ai-draft" = "access"): Promise<ApiResult<T>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/portal-staff/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false, status: res.status,
        error: typeof json.error === "string" ? json.error : "No se pudo conectar con el servidor.",
        code: typeof json.code === "string" ? json.code : undefined,
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 503, error: "No se pudo conectar con el servidor." };
  }
}

export const portalStaffApi = {
  enabled: PORTAL_ENABLED,
  async invite(input: StaffInviteInput): Promise<ApiResult<StaffInviteResult>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).staffInvite(input);
    // El servidor toma el DNI y el teléfono de la ficha, no de acá
    return staffCall({
      action: "invite",
      guardian: { id: input.guardian.id },
      children: input.children.map((c) => ({ id: c.id, guardian_id: c.guardian_id })),
      adolescent_consents: input.adolescent_consents,
      relationship_kind: input.relationship_kind,
      authorized_by: input.authorized_by,
      identity_checked_on: input.identity_checked_on,
      in_person: input.in_person,
      channel: input.channel,
      expires_days: input.expires_days,
    });
  },
  async accessStatus(guardian: { id: string; dni: string | null }, patientId: string): Promise<AccessStatus | null> {
    if (!PORTAL_ENABLED) return null;
    if (MOCK) return (await mock()).staffAccessStatus(guardian.dni, patientId, false, guardian.id);
    const r = await staffCall<AccessStatus>({ action: "status", guardian_id: guardian.id, patient_id: patientId });
    return r.ok ? r.data : null;
  },
  // Acceso del propio paciente adulto
  async selfAccessStatus(patient: { id: string; dni: string | null }): Promise<AccessStatus | null> {
    if (!PORTAL_ENABLED) return null;
    if (MOCK) return (await mock()).staffAccessStatus(patient.dni, patient.id, true);
    const r = await staffCall<AccessStatus>({ action: "status", patient_id: patient.id });
    return r.ok ? r.data : null;
  },
  async inviteSelf(input: StaffInviteSelfInput): Promise<ApiResult<StaffInviteResult>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).staffInviteSelf(input);
    return staffCall({
      action: "invite_self",
      patient_id: input.patient.id,
      identity_checked_on: input.identity_checked_on,
      in_person: input.in_person,
      channel: input.channel,
      expires_days: input.expires_days,
    });
  },
  // ── Bandeja del portal ──
  async inbox(): Promise<ApiResult<StaffInbox>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).staffInbox();
    return staffCall({ action: "list" }, "inbox");
  },
  async inboxCount(): Promise<StaffInboxCount | null> {
    if (!PORTAL_ENABLED) return null;
    if (MOCK) return (await mock()).staffInboxCount();
    const r = await staffCall<StaffInboxCount>({ action: "count" }, "inbox");
    return r.ok ? r.data : null;
  },
  async hcUpdate(input: {
    id: string; to: HcStaffTarget; delivered_to_name?: string; delivered_to_dni?: string; reject_reason?: HcRejectReason;
  }): Promise<ApiResult<StaffHcRequest>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffHcUpdate(input, issuedBy);
    return staffCall({ action: "hc_update", ...input }, "inbox");
  },
  // ── Copia digital (E1): solo profesionales y Dirección ──
  // Sube un PDF al pedido (pide un enlace de subida al servidor, sube el
  // archivo directo al almacenamiento privado y lo registra: el servidor
  // revisa que sea un PDF de hasta 10 MB y calcula su huella)
  async hcDocUpload(requestId: string, file: File): Promise<ApiResult<StaffHcRequest>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffHcDocUpload(requestId, file, issuedBy);
    const slot = await staffCall<{ path: string; token: string }>(
      { action: "hc_doc_upload_url", request_id: requestId, file_name: file.name, size_bytes: file.size }, "inbox");
    if (!slot.ok) return slot;
    const { error } = await supabase.storage.from(HC_DOCS_BUCKET)
      // cacheControl "0": que el navegador no guarde el PDF (historia clínica) al abrirlo o bajarlo
      .uploadToSignedUrl(slot.data.path, slot.data.token, file, { contentType: "application/pdf", cacheControl: "0" });
    if (error) return { ok: false, status: 503, error: "No se pudo subir el archivo. Probá de nuevo." };
    return staffCall({ action: "hc_doc_register", request_id: requestId, path: slot.data.path, file_name: file.name }, "inbox");
  },
  // Quita un PDF que todavía no se envió
  async hcDocRemove(documentId: string): Promise<ApiResult<StaffHcRequest>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffHcDocRemove(documentId, issuedBy);
    return staffCall({ action: "hc_doc_remove", document_id: documentId }, "inbox");
  },
  // Abre un PDF para revisarlo: enlace que vence en 60 segundos (queda registrado)
  async hcDocOpen(documentId: string): Promise<ApiResult<{ url: string }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffHcDocOpen(documentId, issuedBy);
    return staffCall({ action: "hc_doc_open", document_id: documentId }, "inbox");
  },
  // Envía la copia por el portal (con las confirmaciones del profesional)
  // documentIds: los PDF que quien envía tenía en pantalla y revisó. Si la
  // lista del servidor es otra (alguien subió o quitó uno), responde 409
  async hcSend(requestId: string, acks: HcSendAcks, documentIds: string[]): Promise<ApiResult<StaffHcRequest>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffHcSend(requestId, acks, documentIds, issuedBy);
    return staffCall({ action: "hc_send", request_id: requestId, acks, document_ids: documentIds }, "inbox");
  },
  async hcNotes(id: string, notes: string): Promise<ApiResult<{ ok: true }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    if (MOCK) return (await mock()).staffHcNotes(id, notes);
    return staffCall({ action: "hc_notes", id, notes }, "inbox");
  },
  // Pedidos de turno: agendado (con el turno enlazado, si se eligió), "los
  // llamamos", no se puede (con motivo) o volver a pendiente
  async apptUpdate(input: {
    id: string; to: ApptReqStaffTarget; appointment_id?: string | null; reject_reason?: ApptReqRejectReason;
  }): Promise<ApiResult<StaffApptRequest>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffApptUpdate(input, issuedBy);
    return staffCall({ action: "appt_update", ...input }, "inbox");
  },
  async apptNotes(id: string, notes: string): Promise<ApiResult<{ ok: true }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffApptNotes(id, notes, issuedBy);
    return staffCall({ action: "appt_notes", id, notes }, "inbox");
  },
  async resolveNotice(responseId: string, how: NoticeAction): Promise<ApiResult<{ ok: true }>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffResolveNotice(responseId, how, issuedBy);
    return staffCall({ action: "notice_resolve", response_id: responseId, how }, "inbox");
  },
  // ── Portal del paciente (ficha): información de salud ──
  // null si no se pudo saber (por ejemplo, sin conexión)
  async clinicalFeatures(): Promise<ClinicalFeature[] | null> {
    if (!PORTAL_ENABLED) return [];
    if (MOCK) return (await mock()).staffClinicalFeatures();
    const r = await staffCall<{ features: ClinicalFeature[] }>({ action: "features" }, "clinical");
    return r.ok ? r.data.features : null;
  },
  // Una sola entrada para todas las acciones de la sección (ver
  // server/api/portal-staff/clinical.ts); todas devuelven la sección actualizada
  async clinical(body: ClinicalAction): Promise<ApiResult<StaffClinicalDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffClinicalAction(body, issuedBy);
    return staffCall(body, "clinical");
  },
  // "Mi información" (etapa info): ver, publicar y retirar
  async info(body: InfoAction): Promise<ApiResult<StaffInfoDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffInfoAction(body, issuedBy);
    return staffCall(body, "clinical");
  },
  // Ejercicios, devoluciones, metas y medallas (etapa practice): una sola
  // entrada para todas las acciones (ver server/api/portal-staff/practice.ts y
  // PracticeAction); todas devuelven la vista actualizada. Escriben solo
  // profesionales y Dirección. Errores con code: CONFLICT, REVIEW (terms),
  // TITLE_BLOCK (terms), AI_NOT_REVIEWED, APPROACH, EXERCISES, ADOLESCENT_ACK, AUTHOR
  async practice(body: PracticeAction): Promise<ApiResult<StaffPracticeDTO>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffPracticeAction(body, issuedBy);
    return staffCall(body, "practice");
  },
  // "Adaptar con ayuda de IA" (etapa ai): borrador sobre ejercicios del
  // catálogo (POST /api/portal-staff/ai-draft). Errores con code:
  // AI_UNAVAILABLE (503), AI_LIMIT (429), AI_FAILED (502); ver AI_ERROR
  async aiDraft(params: AiDraftRequest): Promise<ApiResult<AiDraftResult>> {
    if (!PORTAL_ENABLED) return UNAVAILABLE;
    const issuedBy = (await supabase.auth.getSession()).data.session?.user?.email ?? "";
    if (MOCK) return (await mock()).staffAiDraft(params, issuedBy);
    return staffCall(params, "ai-draft");
  },
};

export type {
  ApproachOption, CatalogEntry, ExerciseInput, FeedbackInput, GoalInput, LintOverride, PlanDraftInput, PracticeAction,
  StaffExerciseDTO, StaffFeedbackDTO, StaffGoalDTO, StaffMedalDTO, StaffNoteDTO, StaffPlanDTO, StaffPlanVersion,
  StaffPracticeDTO, StaffPracticeGrid, StaffPracticeInboxItem, StaffPracticePending,
} from "@/lib/practiceRules";
export type { AiDraftRequest, AiDraftResult, AiSentDescription, DraftFlag, ExerciseDraft } from "@/lib/aiDraftRules";

export type InfoAction =
  | { action: "info_get"; patient_id: string }
  | {
      action: "publish_summary"; patient_id: string; expected_id: string | null;
      que_trabajamos: string; show_code: boolean; show_team: boolean; acompanar: string; tips: string[];
      discussed_ack: boolean; adolescent_ack?: boolean; review_note?: string;
    }
  | {
      action: "publish_report"; patient_id: string; expected_id: string | null; report_id: string;
      report_edited_at: string; // StaffReportRow.edited_at del informe que se revisó
      mode: "familia" | "tal_cual"; text?: string; include_progress?: boolean; include_evolution?: boolean;
      discussed_ack: boolean; adolescent_ack?: boolean; review_note?: string; // review_note: ver lintText
    }
  | { action: "withdraw"; patient_id: string; publication_id: string; reason: Exclude<WithdrawReason, "reemplazada"> };

export type { StaffInfoDTO, StaffPublication, StaffReportRow } from "@/lib/portalInfoRules";

export type { StaffApptRequest, StaffApptSlot, ApptReqStatus } from "@/lib/apptRequestRules";

// ── Etiquetas de los pedidos de turno (bandeja) ──
export const APPT_REQ_STATUS_LABEL: Record<ApptReqStatus, string> = {
  pendiente: "Pendiente",
  contactar: "La vamos a llamar",
  agendado: "Agendado",
  rechazado: "No se dio turno",
  cancelado: "Cancelado por la familia",
};

export const APPT_REQ_REJECT_LABEL: Record<ApptReqRejectReason, { label: string; family: string }> = {
  ya_tiene_turnos: { label: "Ya tiene turnos asignados", family: "La familia ve «Ya tiene turnos asignados: los ves en la lista»." },
  otro: { label: "Otro motivo (se lo explicamos por teléfono)", family: "La familia ve «No pudimos darte turno: te llamamos para explicarte»." },
  bloqueo: { label: "Cerrado por bloqueo judicial", family: "Los otros adultos de la familia ven «Este pedido se cerró sin turno»." },
};

export const WITHDRAW_LABEL: Record<WithdrawReason, string> = {
  reemplazada: "Reemplazada por una versión nueva",
  error: "Tenía un error",
  pedido_familia: "A pedido de la familia",
  otro: "Otro motivo",
};

export type ClinicalAction =
  | { action: "get"; patient_id: string }
  | { action: "set"; patient_id: string; info_enabled?: boolean; practice_enabled?: boolean }
  | { action: "pause"; patient_id: string; reason: "indicacion_profesional" | "judicial" | null }
  | { action: "adolescent"; patient_id: string; agreed_on?: string; withdrawn?: true }
  | { action: "verify_link"; patient_id: string; link_id: string; in_person_on: string; parental_on?: string | null }
  | { action: "block"; patient_id: string; guardian_id: string; reason: "orden_judicial" | "otro" }
  | { action: "unblock"; patient_id: string; block_id: string }
  | { action: "consent_paper"; patient_id: string; account_id: string; file_id: string };

export type { ClinicalBlock, ClinicalFeature, StaffClinicalDTO, StaffAccessRow, StaffGuardianRow } from "@/lib/portalClinicalRules";

// Por qué una cuenta todavía no ve la información de salud (lo ve solo el equipo)
export const CLINICAL_BLOCK_LABEL: Record<ClinicalBlock, string> = {
  autorizado: "Adulto autorizado: solo ve los turnos",
  bloqueado: "Bloqueado por orden judicial",
  sin_vinculo: "Su acceso no vale hoy (por ejemplo, cumplió 18 o tiene el alta)",
  no_habilitado: "Todavía no está prendido para este paciente",
  pausado: "En pausa",
  conformidad_adolescente: "Falta la conformidad del adolescente",
  no_verificado: "Falta verificar el vínculo en persona",
  consentimiento: "Todavía no activó la información de salud",
};

// ── Etiquetas de la bandeja ──
export const HC_STATUS_LABEL: Record<HcStatus, string> = {
  pendiente: "Pendiente",
  lista: "Lista para retirar",
  entregada: "Entregada",
  rechazada: "Rechazada",
  cancelada: "Cancelada por la familia",
  enviada: "Enviada por el portal",
};

// Almacenamiento privado de las copias digitales (solo lo usa el servidor;
// el panel sube con un enlace de un solo uso que da el servidor)
export const HC_DOCS_BUCKET = "portal-documents";

export const HC_REJECT_LABEL: Record<HcRejectReason, string> = {
  no_habilitado: "Quien la pidió no está habilitado",
  duplicado: "Pedido repetido",
  otro: "Otro motivo (se lo explicamos por teléfono)",
};

export const NOTICE_ACTION_LABEL: Record<NoticeAction, { label: string; family: string }> = {
  justificar: { label: "Justificar la falta", family: "La familia ve «Falta justificada»." },
  cancelar: { label: "Cancelar el turno", family: "La familia ve «Cancelamos el turno por tu aviso»." },
  reprogramar: { label: "Los contactamos para otro día", family: "La familia ve «Te contactamos para otro día». El turno se reprograma desde la agenda." },
  visto: { label: "Tomamos nota", family: "La familia ve «Recibimos tu aviso». El turno no cambia." },
};

export const RESOLUTION_LABEL: Record<NoticeResolution, string> = {
  justificado: "Falta justificada",
  cancelado: "Turno cancelado",
  reprogramado: "Se los contacta para otro día",
  otro: "Tomamos nota",
  asistio: "Vinieron igual (asistencia presente)",
};

// Constancia de cada paso de un pedido de copia
export const HC_EVENT_LABEL: Record<HcEventKind, string> = {
  pedido: "Pedido desde el portal",
  lista: "Marcada lista para retirar",
  pendiente: "Volvió a pendiente",
  entregada: "Entregada",
  rechazada: "Rechazada",
  cancelada: "Cancelado por la familia",
  nota: "Notas internas editadas",
  documento: "PDF subido",
  documento_quitado: "PDF quitado",
  enviada: "Enviada por el portal",
};
