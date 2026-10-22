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
 *     historia clínica de Martín, para retirarla en mano: el pedido está
 *     pendiente en la bandeja del panel. La de Valentina la pidió para
 *     recibirla en el portal y el equipo se la envió hace 3 días (un PDF de
 *     prueba): la puede descargar durante 60 días (ver "Copia digital" abajo).
 *     También pidió un turno para Martín y el equipo se lo dio (enlazó uno de
 *     sus próximos turnos): ve «Te dimos turno» y puede pedir otro.
 *   - Jorge Ruiz · DNI 28999888 · contraseña familia2026: papá de Valentina
 *     (representante legal) y adulto autorizado de Martín (pareja de Laura):
 *     ve los turnos de los dos, pero solo puede pedir la copia de la historia
 *     clínica de Valentina. Ya avisó que Valentina no va a un turno (sin
 *     resolver): Laura lo ve como "otro adulto de la familia".
 *     Pidió un turno para Valentina (martes y jueves a la tarde): está
 *     pendiente en la bandeja del panel (Pedidos de turno). Laura lo ve como
 *     pedido de otro adulto y no puede pedir otro para Valentina hasta que se
 *     resuelva (uno abierto por persona).
 *   - Invitación 24680 13579 para Carla Paz · DNI 27444555 (mamá de Fernanda, 14)
 *   - Código de contraseña nueva 97531 86420 para Laura
 *
 * Información de salud (etapas A, B, C, D y E1, prendidas en la demo:
 * FEATURES = ["consent", "info", "practice", "ai", "hc_digital"]):
 *   - Laura todavía no la activó (se prueba con su contraseña). Sus vínculos
 *     con Martín y Valentina están verificados en persona, con la
 *     documentación de madre.
 *   - Martín y Valentina: el profesional prendió información y ejercicios.
 *     Fernanda (14): información prendida, sin la conformidad de la
 *     adolescente.
 *   - Jorge: su vínculo con Valentina falta verificarlo en persona ("pasá por
 *     el centro"); con Martín es adulto autorizado (solo turnos).
 *   - "Mi información" (etapa C): Martín ya tiene publicado su resumen ("Qué
 *     trabajamos", versión 1 de la Lic. Ana Torres): Laura lo ve apenas activa
 *     la información de salud. Valentina todavía no tiene nada publicado.
 *   Lo del equipo (configuración, verificación, bloqueos, consentimiento en
 *   papel, publicar y retirar en "Mi información") se prueba en la ficha de
 *   un paciente invitado desde el panel. Los informes de la ficha se leen del
 *   mock del panel: en la pestaña del portal no están los que se cargaron en
 *   otra pestaña (se toman como vigentes).
 *
 * Ejercicios, devoluciones, metas y medallas (etapa B, "practice") y ayuda de
 * IA para adaptar ejercicios del catálogo (etapa D, "ai"; en el mock es una
 * plantilla fija: el texto del catálogo, con «Borrador de ejemplo (modo demo,
 * sin IA)», después de una espera corta):
 *   - Martín (9 años, F98.5 en la demo) tiene publicado «Jugar con la voz en
 *     casa» de Lic. Ana Torres · MP 4521, desde el viernes de hace dos
 *     semanas: «Arranque suave» (catálogo), «Turnos en la mesa» (catálogo) y
 *     «Trabas a propósito con palabras de fútbol» (adaptado con IA, revisado y
 *     con «Ya lo practicamos en sesión»), 3 días por semana. Laura anotó
 *     prácticas el sábado de hace dos semanas, el lunes, miércoles y viernes
 *     pasados y anteayer y ayer, si caen en esta semana; el miércoles contó
 *     «Me costó» con un comentario en «Trabas a propósito». Tiene «Primer
 *     paso» (Laura ya la vio) y «Semana cumplida» de la semana pasada (nueva:
 *     es la celebración del Inicio), una devolución de la Lic. Ana Torres del
 *     martes pasado (sin abrir) y una meta de práctica activa («Practicar 10
 *     días en 4 semanas», medalla «Gran equipo»). Lo anotado después de esa
 *     devolución queda en la bandeja del panel (Portal → Prácticas).
 *     Hoy no hay nada anotado: Laura puede practicar apenas activa la
 *     información de salud (hasta entonces, los ejercicios contestan CONSENT).
 *     Si la semana ya tiene dos días, anotar hoy gana «Semana cumplida».
 *   - Valentina (6, en evaluación): ejercicios prendidos y nunca tuvo un plan
 *     publicado (sin «Ejercicios» en el Inicio ni en la barra), pero tiene
 *     logros: dos metas sin plan («Traer un juguete…», activa, y «Elegir un
 *     juego…», lograda) y una devolución del jueves pasado que dio esa meta
 *     por lograda con la medalla «¡Me animé!». Laura ya vio la medalla y
 *     todavía no abrió la devolución: «Medallas» de Valentina, en el Inicio,
 *     dice «Nuevo». Su profesional le puede armar un plan desde el panel.
 *   - Los chicos de la demo no tienen ficha en el panel: la Lic. Ana Torres no
 *     es un usuario del mock, así que en la bandeja cuentan como pacientes de
 *     cualquier perfil clínico ("Mis pacientes" y el número de la pestaña).
 *   - Las medallas de constancia se calculan con constancyAwards (como el
 *     servidor); las sembradas salen de simular las prácticas día por día.
 *
 * Copia digital de la historia clínica (etapa E1, prendida en la demo con
 * "hc_digital", que solo vale si "consent" también está prendida):
 *   - Para descargar la copia de Valentina, Laura primero activa la
 *     información de salud: hasta entonces la descarga contesta CONSENT. Al
 *     activarla (o al volver a poner la contraseña) la descarga queda
 *     habilitada 15 minutos; después contesta REAUTH.
 *   - Jorge puede pedir la copia de Valentina, pero no recibirla en el portal
 *     hasta que verifiquen su vínculo en el centro (se le ofrece, con "verify").
 *   - El equipo sube los PDF desde la bandeja del panel (Dirección o
 *     profesional, en un pedido abierto que se pidió "en el portal" y cuya
 *     cuenta todavía puede recibirla), los revisa y la envía. Para probarlo:
 *     Laura activa la información de salud y pide la de Valentina "en el
 *     portal". Los bytes no van a localStorage (no entran): quedan
 *     en la memoria de la pestaña y, si el navegador lo permite, en IndexedDB
 *     (así se descargan desde otra pestaña). Si no están, "Ver" y la descarga
 *     contestan 410. El PDF de la copia sembrada se arma en el código.
 *   - Con el portal del paciente en pausa ("Pausar todo lo clínico", en la
 *     ficha) la copia digital se corta: no se ofrece "en el portal", no se
 *     suben PDF, no se envía y no se descarga. En mano se sigue pidiendo (la
 *     copia es un derecho).
 *
 * Como en la base real, el aviso guarda lo que cargó el equipo solo si es
 * "reprogramado" u "otro": "cancelado" y "justificado" salen del turno
 * (estado cancelado o asistencia "justificado"), "asistio" de la asistencia
 * "presente" y, si alguien del equipo lo resolvió y después se cambió el
 * turno, queda como "otro" (visto).
 *
 * Cada paso de un pedido de copia o de turno (pedido, cancelación, cambios del
 * equipo y notas) deja una constancia en el propio pedido (events), como las
 * tablas portal_hc_request_events y portal_appt_request_events.
 *
 * Pedidos de turno: la familia no elige el horario, cuenta qué días y en qué
 * horario le queda bien; el equipo lo agenda en la Agenda y lo enlaza al
 * pedido, o la llama. Teléfonos de contacto en la bandeja: los de la ficha
 * del panel (paciente y adultos responsables activos) o, para los chicos de
 * la demo, unos inventados.
 *
 * En el mock los códigos se guardan en claro. En la base real se guarda solo
 * un HMAC del código.
 */

import { isWeekendKey } from "@/lib/agenda";
import {
  type ApptReqEventKind, type ApptReqRejectReason, type ApptReqStaffTarget, type ApptRequestDTO, type ApptRequestInput,
  type StaffApptRequest, type StaffApptSlot, type Weekday,
  APPT_REQ_DAILY_MAX, APPT_REQ_REJECT_REASONS, APPT_REQ_TRANSITIONS, WEEKDAYS,
  apptReqOpen, apptRequestVisible, computeApptRequestDto, validateApptRequest,
} from "@/lib/apptRequestRules";
import { audienceFor, baseExplanation } from "@/lib/diagnosisExplanations";
import {
  HC_DIGITAL_BLOCKED_STAFF, HC_LINK_SECONDS, PDF_PROBLEM_TEXT,
  cleanAcks, cleanDocName, docUploadProblem, hcDocLabel, hcDownloadName, hcDownloadable, hcSendAcksProblem, pdfProblem,
} from "@/lib/hcDigitalRules";
import type { ActivationInfo, ApiResult, ChildDTO, ChildPageDTO, MeDTO } from "@/lib/portal";
import {
  type ChildClinicalDTO, type ClinicalBlock, type ClinicalFeature, type FamilyClinicalDTO, type PortalSettings,
  type StaffAccessRow, type StaffClinicalDTO, type StaffGuardianRow,
  ADOLESCENT_FROM, ADULT_FROM, CLINICAL_NOTICE_VERSION, adolescentAgreed, clinicalAccess, publicOutcome, reauthFresh,
} from "@/lib/portalClinicalRules";
import {
  type InfoDTO, type ReportBody, type StaffInfoDTO, type StaffPublication, type SummaryBody, type WithdrawReason,
  HOME_TIPS, INFO_LIMITS, REVIEW_NOTE_MAX, TRAMITE_CODES, WITHDRAW_REASONS, cleanText, fitText, lintTexts,
  professionalLabel, reportSections,
  verificationCode,
} from "@/lib/portalInfoRules";
import {
  type ApptDTO, type HcChannel, type HcDigitalBlock, type HcDocumentDTO, type HcEventKind, type HcRejectReason,
  type HcRequestDTO, type HcSendAcks, type HcStaffTarget, type NoticeAction, type NoticeResolution, type Outcome,
  type ReasonCode, type ResponseKind, type StaffHcDocument, type StaffHcRequest, type StaffInbox,
  type StaffInboxCount, type StaffNotice,
  CONFIRM_WINDOW_DAYS, HC_CHANNELS, HC_DAILY_MAX, HC_DOC_MAX_FILES, HC_OPEN_STATUSES,
  HC_REJECT_REASONS, HC_TRANSITIONS, NOTICE_ACTIONS, PRIVACY_VERSION, REASON_CODES, REASON_TEXT_MAX,
  addDaysKey as addDays, ageOn, canRequestHc, centerDateOf, centerNow, computeApptDto, computeHcDto,
  hcVisible, isNoticeOnTime, isValidDni, linkValidity, normalizeCode, normalizeDni, passwordProblem,
} from "@/lib/portalRules";
import type {
  AccessStatus, ClinicalAction, InfoAction, RelationshipKind, StaffInviteInput, StaffInviteResult, StaffInviteSelfInput,
} from "@/lib/portalStaff";
import {
  type Approach, type CelebrationDTO, type ExerciseSource, type FeedbackDTO, type FeedbackItemDTO, type FeedbackWithdrawReason,
  type GoalDTO, type GoalKind, type GoalRule, type GoalStatus, type LintOverride, type MedalDTO, type MedalKind,
  type MedalsDTO, type MyNoteDTO, type PlanAudience, type PlanCloseReason, type PlanStatus, type PracticeAction,
  type ConstancyCode, CONSTANCY_CODES,
  type PracticeActionResult, type PracticeChildDTO, type PracticeDTO, type PracticeDay, type PracticeDayDTO,
  type PracticeExerciseDTO, type PracticeHomeDTO, type PracticeLogInput, type PracticeNoteInput, type PracticeResult,
  type PublishCheck, type StaffExerciseDTO, type StaffFeedbackDTO, type StaffGoalDTO, type StaffMedalDTO,
  type StaffNoteDTO, type StaffPlanDTO, type StaffPracticeDTO, type StaffPracticeGrid, type StaffPracticeInboxItem,
  type StaffPracticePending,
  FEEDBACK_WITHDRAW_REASONS, GRID_DAYS, PLAN_WITHDRAW_REASONS, PRACTICE_DAILY_MAX, PRACTICE_ERROR,
  PRACTICE_LIMITS, PRACTICE_TEXT, RECENT_MEDALS, REVIEW_STALE_DAYS, SCREEN_MODE_BY_AUDIENCE,
  FLUENCY_TITLE_MESSAGE, STAFF_PRACTICE_TEXT,
  approachAgeOk, approachOptions, approachesForDiagnosis, audienceForAge, blockForTitles, constancyAwards, constancyNext,
  dayIndex, daysBetween, exerciseTextAlerts, familyGoalExtras, goalProgress, goalRuleText, isAdolescent, isDateKey as validDateKey, onBreak,
  planSummary, planTextAlerts, practiceDateProblem, practiceDates, practiceSummaryText, publishProblem, readersLine,
  uncoveredAlerts, validateFeedback, validateGoal, validateNote, validatePlanDraft, weekKey, weekProgress,
} from "@/lib/practiceRules";
import { profileFromRow, suggestPractice } from "@/lib/practiceSuggest";
import { type ActivitySpec, readActivity } from "@/lib/activitySpec";
import { analyzeWords, parseAzureDetailed } from "@/lib/recordingAnalysis";
import {
  RECORDING_MIN_MS, RECORDING_NOTICE_VERSION, type RecordingsAction, type RecordingsResult, type RecordingStatus,
  type StaffRecordingDTO, deleteAfter, validateReview,
} from "@/lib/recordingRules";
import { wavDurationMs } from "@/lib/wavEncoder";
import { ACTIVITY_MIN_AGE, activityAgeOk } from "@/lib/activityMechanics";
import { CATALOG_VERSION, catalogEntry, catalogFor } from "@/lib/exerciseCatalog";
import {
  type AiAdaptParams, type AiDraftRequest, type AiDraftResult, type DraftFlag, type ExerciseDraft,
  AI_DRAFT_DAILY_CAP_DEFAULT, AI_ERROR, PROMPT_VERSION, buildAdaptParams, describeSent, draftToExerciseInput, editRatio,
  exerciseFullText, mockDraft, parseExerciseDraft,
} from "@/lib/aiDraftRules";
import { mockIsMyPatient, mockSupabase } from "./mockClient";

// ── Modelo ──────────────────────────────────────────────────────────────────

type Account = {
  id: string; dni: string; first_name: string; last_name: string;
  password: string; active: boolean; privacy_version: string | null;
  recovery_requested_at: string | null;
};
// birth_date, discharge_date y dni: de los chicos de la demo, o copia de la
// ficha del panel al invitar (para la vigencia del vínculo, ver patientCard).
// phones: teléfonos de contacto de los chicos de la demo (los invitados desde
// el panel los toman de su ficha)
// diagnosis_code: solo los chicos de la demo (no tienen ficha en el panel): lo
// usa la etapa de ejercicios para los enfoques que se ofrecen (nunca sale
// hacia la familia ni hacia la IA)
type Child = {
  id: string; first_name: string; last_name: string; source: "demo" | "agenda";
  birth_date: string | null; discharge_date: string | null; dni: string | null;
  phones?: string[];
  diagnosis_code?: string | null;
};
// "titular": el propio paciente adulto, que usa el portal por su cuenta.
// verified_*: el equipo vio el DNI en persona; parental_checked_on, la
// documentación de madre, padre o tutor/a (solo representante legal)
type Link = {
  id: string; account_id: string; child_id: string;
  relationship_kind: RelationshipKind | "titular"; guardian_id: string | null;
  adolescent_consent_at: string | null;
  verified_in_person_on: string | null; verified_by_email: string | null; parental_checked_on: string | null;
};
// Información de salud (tablas del script 22)
type Settings = PortalSettings & {
  patient_id: string; pause_reason: "indicacion_profesional" | "judicial" | null;
  adolescent_agreed_by_email: string | null; updated_by_email: string | null; updated_at: string | null;
};
type Consent = {
  id: string; account_id: string; kind: "informacion_clinica"; version: string; accepted: boolean;
  channel: "portal" | "papel"; file_id: string | null; recorded_by_email: string | null; created_at: string;
};
type GuardianBlock = {
  id: string; patient_id: string; guardian_id: string | null; dni: string; reason: "orden_judicial" | "otro";
  created_by_email: string; created_at: string; lifted_at: string | null; lifted_by_email: string | null;
};
// Quién abrió qué (portal_access_log): solo se agregan filas. "descargar":
// la familia bajó un PDF de la copia digital; "equipo_abrir_documento": alguien
// del equipo lo abrió para revisarlo (va con staff_email). "ver_devolucion" y
// "ver_medalla" (etapa B): la cuenta abrió una devolución o ya vio una medalla
// (así cada adulto ve la celebración una vez)
type AccessLog = {
  id: string; patient_id: string; account_id: string | null; staff_email: string | null;
  action: "ver_informacion" | "ver_publicacion" | "descargar" | "equipo_abrir_documento" | "ver_devolucion" | "ver_medalla";
  target_id: string | null; at: string;
};
// Ejercicios (tablas del script 26). Lo publicado no se edita: se arma una
// versión nueva. Los registros, notas, devoluciones y medallas no se borran:
// se deshacen, se retiran o se anulan
type PlanRow = {
  id: string; patient_id: string; version: number; supersedes_id: string | null; status: PlanStatus;
  title: string; goal_text: string | null; audience: PlanAudience; days_per_week: number; review_on: string | null;
  on_break_until: string | null; auto_medals: boolean; professional_id: string | null; author_label: string | null;
  adolescent_ack: boolean; lint_overrides: LintOverride[];
  created_by_email: string; created_at: string; updated_by_email: string | null; updated_at: string;
  published_at: string | null; published_by_email: string | null;
  closed_at: string | null; closed_by_email: string | null; close_reason: PlanCloseReason | null;
  // "Visto": last_reviewed_label es el nombre con que firmaba quien lo marcó
  // (se guarda al marcarlo). Puede ir en un plan ya cerrado (el último publicado)
  last_reviewed_at: string | null; last_reviewed_by_email: string | null;
  last_reviewed_label: string | null;
};
type ExerciseRow = {
  id: string; plan_id: string; patient_id: string; exercise_key: string; source: ExerciseSource;
  catalog_id: string | null; catalog_version: string | null; position: number; approach: Approach;
  practiced_in_session: boolean; title: string; para_que: string; pasos: string[]; minutes: number;
  materiales: string | null; for_adult: string | null; si_cuesta: string; with_adult: boolean;
  ai_draft_id: string | null; ai_drafted: boolean; reviewed_at: string | null; reviewed_by_email: string | null;
  edit_ratio: number | null; lint_overrides: LintOverride[]; removed_at: string | null; removed_by_email: string | null;
  created_at: string; updated_at: string;
  activity?: ActivitySpec | null; // (etapa "activities"; las filas viejas del navegador no la tienen)
};
// "Ya lo hice": uno vigente por ejercicio (exercise_key) y por día
type PracticeLogRow = {
  id: string; patient_id: string; plan_id: string; exercise_id: string; exercise_key: string;
  account_id: string | null; practiced_on: string; created_at: string; voided_at: string | null;
};
// "¿Cómo te fue?" de cada adulto (una nota por cuenta y por práctica)
type PracticeNoteRow = {
  id: string; log_id: string; patient_id: string; account_id: string | null; result: PracticeResult | null;
  comment: string | null; risk_flag: boolean; created_at: string;
};
type FeedbackRow = {
  id: string; patient_id: string; plan_id: string | null; professional_id: string | null; author_label: string;
  body: string; for_adult: string | null; period_start: string | null; period_end: string | null;
  adolescent_ack: boolean; review_note: string | null; ai_draft_id: string | null; ai_drafted: boolean;
  sent_at: string; sent_by_email: string;
  withdrawn_at: string | null; withdrawn_by_email: string | null; withdraw_reason: FeedbackWithdrawReason | null;
};
type GoalRow = {
  id: string; patient_id: string; plan_id: string | null; kind: GoalKind; title: string; rule: GoalRule | null;
  medal_title: string | null; agreed_with_patient: boolean; status: GoalStatus;
  created_by_email: string; created_at: string; updated_at: string;
  published_at: string | null; published_by_email: string | null; achieved_at: string | null; feedback_id: string | null;
  changed_at: string | null; changed_by_email: string | null; met_notice_dismissed_at: string | null;
};
type MedalRow = {
  id: string; patient_id: string; kind: MedalKind; code: string; title: string; period_key: string;
  plan_id: string | null; goal_id: string | null; feedback_id: string | null; message: string | null;
  awarded_at: string; awarded_by_email: string | null;
  voided_at: string | null; voided_by_email: string | null; void_reason: string | null;
};
// Cada pedido de "Adaptar con ayuda de IA" (en el mock, plantillas fijas)
type AiDraftRow = {
  id: string; kind: "adaptacion"; patient_id: string; requested_by_email: string; model: string; prompt_version: string;
  catalog_version: string | null; params: AiAdaptParams; output: ExerciseDraft | null; flags: DraftFlag[];
  status: "generado" | "usado" | "descartado" | "error"; error_code: string | null; latency_ms: number | null;
  used_at: string | null; created_at: string;
};
// "Mi información" (tabla portal_publications del script 23). Lo publicado no
// se edita: se retira (con motivo) y se publica una versión nueva
type Publication = {
  id: string; patient_id: string; kind: "resumen" | "informe"; title: string; body: SummaryBody | ReportBody;
  body_sha256: string; source_report_id: string | null; version: number; supersedes_id: string | null;
  professional_id: string | null; author_label: string; includes_diagnosis: boolean;
  discussed_ack: boolean; adolescent_ack: boolean; review_note: string | null;
  published_at: string; published_by_email: string;
  withdrawn_at: string | null; withdrawn_by_email: string | null; withdraw_reason: WithdrawReason | null;
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
// channel: cómo la pidió recibir (E1); sent_acks: lo que confirmó el
// profesional al enviarla por el portal
type HcRequest = Omit<StaffHcRequest,
  "patient_name" | "patient_dni" | "still_allowed" | "documents" | "digital_ok" | "patient_age"> & {
  account_id: string | null; updated_at: string; sent_acks: HcSendAcks | null;
};
// PDF de una copia digital (tabla portal_hc_documents del script 25). Los
// bytes no se guardan acá (ver docFiles). published_at: cuándo se envió a la
// familia (hasta entonces se puede quitar). demo_pdf: el PDF de prueba de la
// copia sembrada, que se arma en el código (demoPdfText)
type HcDocument = {
  id: string; request_id: string; patient_id: string; file_name: string; size_bytes: number; sha256: string;
  uploaded_by_email: string; uploaded_at: string; published_at: string | null;
  removed_at: string | null; removed_by_email: string | null;
  demo_pdf?: boolean;
};
// Pedido de turno (tabla portal_appt_requests del script 24): la familia pide,
// el equipo agenda. Como el de copia, sus constancias van en events y
// updated_at cambia con cada cambio de estado, no con las notas.
// appointment_id: el turno de la agenda que se enlazó al agendarlo
// (appointment y appointment_cancelled se calculan con él al leer)
type ApptRequest = Omit<StaffApptRequest,
  "patient_name" | "contact_phones" | "still_allowed" | "requester_blocked" | "appointment" | "appointment_cancelled" | "upcoming"> & {
  account_id: string | null; appointment_id: string | null; updated_at: string;
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
  responses: Response[]; invitations: Invitation[]; hc_requests: HcRequest[]; hc_documents: HcDocument[];
  appt_requests: ApptRequest[];
  login_failures: Record<string, { count: number; first_at: string }>;
  settings: Settings[]; consents: Consent[]; blocks: GuardianBlock[];
  publications: Publication[]; access_log: AccessLog[];
  // Etapas B y D (script 26)
  practice_plans: PlanRow[]; practice_exercises: ExerciseRow[]; practice_logs: PracticeLogRow[];
  practice_notes: PracticeNoteRow[]; practice_feedback: FeedbackRow[]; practice_goals: GoalRow[];
  practice_medals: MedalRow[]; ai_drafts: AiDraftRow[];
};

const DB_KEY = "cimt-portal-mock-db";
const SESSION_KEY = "cimt-portal-mock-session";
// "Volvé a poner tu contraseña": va con la sesión de la pestaña (en la base,
// portal_step_up por session_id)
const STEP_UP_KEY = "cimt-portal-mock-step-up";
const DB_VERSION = 15; // 14: el globo y la tortuga en la demo; 15: «Me grabo»

// Etapas de la información de salud prendidas (en el servidor:
// PORTAL_CLINICAL_FEATURES). La demo muestra las etapas A, B, C, D y E1.
const FEATURES: ClinicalFeature[] = ["consent", "info", "practice", "ai", "hc_digital", "activities", "recordings"];
const activitiesOn = () => FEATURES.includes("activities") && FEATURES.includes("practice");

// Copia digital de la historia clínica (E1): solo vale con "consent" también
// prendida (hace falta que la cuenta haya activado la información de salud)
const hcDigitalOn = () => FEATURES.includes("hc_digital") && FEATURES.includes("consent");

// Las etapas que ven la familia y el panel: "hc_digital" solo aparece si la
// copia digital vale (con "consent" también prendida), como digitalReady en
// el servidor (el mock no tiene columnas del script 25 que mirar)
const shownFeatures = (): ClinicalFeature[] => FEATURES.filter((f) => f !== "hc_digital" || hcDigitalOn());

// Modalidades de la ficha tal como las lee la familia (como en server/lib/portalInfo.ts)
const THERAPY_LABEL: Record<string, string> = {
  individual: "Terapia individual",
  grupal: "Terapia grupal",
  gam: "Grupo de ayuda mutua",
  familia: "Acompañamiento familiar",
};

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
// del pedido (by_email null: lo hizo la familia). Si no se dice otra cosa, se
// entrega en mano
function hcRow(
  r: Pick<HcRequest, "id" | "patient_id" | "account_id" | "link_kind" | "requester_name" | "requester_dni" | "created_at">
    & Partial<Pick<HcRequest, "channel">>,
): HcRequest {
  return {
    status: "pendiente", ready_at: null, ready_by_email: null,
    delivered_at: null, delivered_by_email: null, delivered_to_name: null, delivered_to_dni: null,
    rejected_at: null, rejected_by_email: null, reject_reason: null,
    cancelled_at: null, staff_notes: null, updated_at: r.created_at,
    channel: "mano", sent_at: null, sent_by_email: null, sent_acks: null,
    events: [{ kind: "pedido", by_email: null, at: r.created_at }],
    ...r,
  };
}

// Constancia de un paso del pedido (by_email null: la familia)
function logHcEvent(row: HcRequest, kind: HcEventKind, byEmail: string | null, at = new Date().toISOString()) {
  row.events.push({ kind, by_email: byEmail, at });
}

// Pedido de turno recién hecho (los defaults de la tabla), con la constancia
// del pedido (by_email null: lo hizo la familia)
function apptReqRow(r: Pick<ApptRequest,
  "id" | "patient_id" | "account_id" | "link_kind" | "requester_name" | "reason" | "days" | "band" | "modality" | "note" | "created_at">,
): ApptRequest {
  return {
    status: "pendiente", appointment_id: null,
    scheduled_at: null, scheduled_by_email: null, contacted_at: null, contacted_by_email: null,
    rejected_at: null, rejected_by_email: null, reject_reason: null,
    cancelled_at: null, staff_notes: null, updated_at: r.created_at,
    events: [{ kind: "pedido", by_email: null, at: r.created_at }],
    ...r,
  };
}

function logApptEvent(row: ApptRequest, kind: ApptReqEventKind, byEmail: string | null, at = new Date().toISOString()) {
  row.events.push({ kind, by_email: byEmail, at });
}

// Día de la semana de una fecha hábil AAAA-MM-DD ("lun" … "vie")
function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7] ?? "lun";
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
  // El turno que el equipo le dio a Martín por el pedido de turno de Laura
  const martinNext = appts.find((a) => a.id === "t-martin-3")!;
  const martinDay = weekdayOf(martinNext.date);
  // Vínculo verificado en persona hace un mes (con la documentación de
  // madre, padre o tutor/a si es representante legal), o sin verificar
  const seen = addDays(today, -30);
  const link = (id: string, account_id: string, child_id: string, kind: RelationshipKind, verified: boolean): Link => ({
    id, account_id, child_id, relationship_kind: kind, guardian_id: null, adolescent_consent_at: null,
    verified_in_person_on: verified ? seen : null, verified_by_email: verified ? STAFF : null,
    parental_checked_on: verified && kind === "representante_legal" ? seen : null,
  });
  const legal = (id: string, account_id: string, child_id: string, verified: boolean) => link(id, account_id, child_id, "representante_legal", verified);
  // Adulto autorizado: ve los turnos y avisa, pero no puede pedir la historia clínica
  const authorized = (id: string, account_id: string, child_id: string, verified: boolean) => link(id, account_id, child_id, "autorizado", verified);
  // Fecha de nacimiento para tener esa edad hoy (cumplió hace unos 3 meses)
  const born = (years: number) => addDays(`${Number(today.slice(0, 4)) - years}${today.slice(4)}`, -100);
  const settings = (patient_id: string, info_enabled: boolean, practice_enabled: boolean): Settings => ({
    patient_id, info_enabled, practice_enabled, paused_at: null, pause_reason: null,
    adolescent_agreed_on: null, adolescent_agreed_by_email: null, adolescent_withdrawn_on: null,
    updated_by_email: STAFF, updated_at: iso(48 * H),
  });
  // "Mi información" de Martín (9 años): el resumen que publicó su
  // fonoaudióloga hace 3 días, a partir del texto base de tartamudez
  const martinSummary: SummaryBody = {
    que_trabajamos: [
      baseExplanation("F98.5", audienceFor(9), "Martín") ?? "",
      "Estos meses vamos a jugar con la voz y con los turnos para hablar, y a buscar juntos las situaciones en las que Martín se anima más: por ahora, contar lo que pasó en el recreo y hablar de fútbol.",
    ].join("\n\n"),
    tramites: { code: "F98.5", label: TRAMITE_CODES["F98.5"] },
    como_trabajamos: { professional: `${ANA} (Fonoaudiología)`, modes: [THERAPY_LABEL.individual, THERAPY_LABEL.familia] },
    acompanar: {
      text: "Cuando Martín se trabe, esperalo con calma y mirándolo, sin terminar la palabra por él: lo que quiere contar importa más que cómo lo dice. Si algo en la escuela o con sus amigos te preocupa, contanos en el próximo turno.",
      tips: [HOME_TIPS[0], HOME_TIPS[3], HOME_TIPS[5]],
    },
  };

  return {
    version: DB_VERSION,
    seeded_on: today,
    accounts: [
      { id: "acc-laura", dni: "30111222", first_name: "Laura", last_name: "Gómez", password: "familia2026", active: true, privacy_version: PRIVACY_VERSION, recovery_requested_at: null },
      { id: "acc-jorge", dni: "28999888", first_name: "Jorge", last_name: "Ruiz", password: "familia2026", active: true, privacy_version: PRIVACY_VERSION, recovery_requested_at: null },
    ],
    // Teléfonos inventados: Laura 381 555-2041, Jorge 381 555-7316, Carla 381 555-4410
    children: [
      // diagnosis_code: Martín y Fernanda, tartamudez (F98.5); Valentina, en evaluación
      { id: "c-martin", first_name: "Martín", last_name: "Gómez", source: "demo", birth_date: born(9), discharge_date: null, dni: null, phones: ["381 555-2041"], diagnosis_code: "F98.5" },
      { id: "c-valentina", first_name: "Valentina", last_name: "Ruiz", source: "demo", birth_date: born(6), discharge_date: null, dni: null, phones: ["381 555-2041", "381 555-7316"], diagnosis_code: null },
      { id: "c-fernanda", first_name: "Fernanda", last_name: "Paz", source: "demo", birth_date: born(14), discharge_date: null, dni: null, phones: ["381 555-4410"], diagnosis_code: "F98.5" },
    ],
    links: [
      legal("lnk-laura-martin", "acc-laura", "c-martin", true), legal("lnk-laura-vale", "acc-laura", "c-valentina", true),
      // Jorge todavía no pasó por el centro a mostrar su documentación de papá
      legal("lnk-jorge-vale", "acc-jorge", "c-valentina", false), authorized("lnk-jorge-martin", "acc-jorge", "c-martin", true),
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
      // Laura pidió hace 30 horas la copia de la historia clínica de Martín,
      // para retirarla en mano: todavía no se preparó (su única constancia es
      // la del pedido)
      hcRow({
        id: "hc-demo-1", patient_id: "c-martin", account_id: "acc-laura", link_kind: "representante_legal",
        requester_name: "Laura Gómez", requester_dni: "30111222", created_at: iso(30 * H),
      }),
      // La de Valentina la pidió hace 5 días para recibirla en el portal: el
      // equipo subió un PDF y se la envió hace 3 días (la descarga hasta 60
      // días después del envío)
      {
        ...hcRow({
          id: "hc-demo-2", patient_id: "c-valentina", account_id: "acc-laura", link_kind: "representante_legal",
          requester_name: "Laura Gómez", requester_dni: "30111222", created_at: iso(120 * H), channel: "portal",
        }),
        status: "enviada", sent_at: iso(72 * H), sent_by_email: STAFF, updated_at: iso(72 * H),
        sent_acks: { complete: true, no_third_parties: true, signed: true },
        events: [
          { kind: "pedido", by_email: null, at: iso(120 * H) },
          { kind: "documento", by_email: STAFF, at: iso(73 * H) },
          { kind: "enviada", by_email: STAFF, at: iso(72 * H) },
        ],
      },
      // Pedidos viejos de la copia de Martín, cerrados hace más de 30 días:
      // Laura ve el pendiente y estos dos plegados en "Ver pedidos anteriores"
      // (el panel ya no los muestra). Uno lo canceló ella al día siguiente; el
      // otro se lo entregaron en mano
      {
        ...hcRow({
          id: "hc-demo-3", patient_id: "c-martin", account_id: "acc-laura", link_kind: "representante_legal",
          requester_name: "Laura Gómez", requester_dni: "30111222", created_at: iso(48 * 24 * H),
        }),
        status: "cancelada", cancelled_at: iso(47 * 24 * H), updated_at: iso(47 * 24 * H),
        events: [
          { kind: "pedido", by_email: null, at: iso(48 * 24 * H) },
          { kind: "cancelada", by_email: null, at: iso(47 * 24 * H) },
        ],
      },
      {
        ...hcRow({
          id: "hc-demo-4", patient_id: "c-martin", account_id: "acc-laura", link_kind: "representante_legal",
          requester_name: "Laura Gómez", requester_dni: "30111222", created_at: iso(46 * 24 * H),
        }),
        status: "entregada", ready_at: iso(43 * 24 * H), ready_by_email: STAFF,
        delivered_at: iso(40 * 24 * H), delivered_by_email: STAFF, delivered_to_name: "Laura Gómez", delivered_to_dni: "30111222",
        updated_at: iso(40 * 24 * H),
        events: [
          { kind: "pedido", by_email: null, at: iso(46 * 24 * H) },
          { kind: "lista", by_email: STAFF, at: iso(43 * 24 * H) },
          { kind: "entregada", by_email: STAFF, at: iso(40 * 24 * H) },
        ],
      },
    ],
    // El PDF de la copia de Valentina (de prueba: se arma en el código)
    hc_documents: [{
      id: "3f9c2a71-6b4e-4d18-a5c3-7e2b9d0f4c86", request_id: "hc-demo-2", patient_id: "c-valentina",
      file_name: "Historia clinica Valentina Ruiz (firmada).pdf", size_bytes: demoPdfText().length,
      sha256: "", // la demo sembrada no lo guarda: se calcula al mostrarlo (demoPdfSha)
      uploaded_by_email: STAFF, uploaded_at: iso(73 * H), published_at: iso(72 * H),
      removed_at: null, removed_by_email: null, demo_pdf: true,
    }],
    appt_requests: [
      // Laura pidió hace 3 días un turno para Martín y el equipo se lo dio:
      // enlazó el de la semana que viene (Laura lo ve en el pedido). Como ya
      // está resuelto, puede pedir otro
      {
        ...apptReqRow({
          id: "pt-demo-1", patient_id: "c-martin", account_id: "acc-laura", link_kind: "representante_legal",
          requester_name: "Laura Gómez", reason: "continuar", days: WEEKDAYS.filter((w) => w === martinDay || w === "vie"),
          band: "tarde", modality: "presencial", note: "Mejor después de la escuela", created_at: iso(76 * H),
        }),
        status: "agendado", appointment_id: martinNext.id, scheduled_at: iso(50 * H), scheduled_by_email: STAFF, updated_at: iso(50 * H),
        events: [{ kind: "pedido", by_email: null, at: iso(76 * H) }, { kind: "agendado", by_email: STAFF, at: iso(50 * H) }],
      },
      // Jorge pidió hoy un turno para Valentina: está pendiente en la bandeja
      // del panel, y nadie puede pedir otro para ella hasta que se resuelva
      apptReqRow({
        id: "pt-demo-2", patient_id: "c-valentina", account_id: "acc-jorge", link_kind: "representante_legal",
        requester_name: "Jorge Ruiz", reason: "continuar", days: ["mar", "jue"], band: "tarde", modality: "presencial",
        note: "Puede ser después de las 15", created_at: iso(4 * H),
      }),
    ],
    login_failures: {},
    // Información de salud: nadie la activó todavía (Laura la puede probar)
    settings: [
      settings("c-martin", true, true),
      // Ejercicios prendidos, todavía sin plan (la familia ve el estado vacío)
      settings("c-valentina", true, true),
      // Fernanda tiene 14: falta su conformidad (la familia ve "no disponible")
      settings("c-fernanda", true, false),
    ],
    consents: [],
    blocks: [],
    // Martín: su resumen, versión 1 (nadie lo abrió todavía: es "nuevo").
    // Valentina, sin nada publicado
    publications: [{
      id: "5c1e8a42-7d3b-4f9a-b6e0-2a9d4c7f1e38", patient_id: "c-martin", kind: "resumen", title: "Qué trabajamos",
      body: martinSummary,
      body_sha256: "", // la demo sembrada no lo calcula (al publicar, sí)
      source_report_id: null, version: 1, supersedes_id: null, professional_id: null,
      author_label: `${ANA} · MP 4521`, includes_diagnosis: true, discussed_ack: true, adolescent_ack: false,
      review_note: null, published_at: iso(72 * H), published_by_email: STAFF,
      withdrawn_at: null, withdrawn_by_email: null, withdraw_reason: null,
    }],
    ...seedPractice(today, `${ANA} · MP 4521`, STAFF),
  };
}

// ── Ejercicios de la demo (etapas B y D) ────────────────────────────────────
// Martín: un plan publicado con 3 ejercicios del catálogo (uno adaptado con
// IA y revisado), prácticas de Laura en días recientes, una devolución, una
// meta activa y las medallas que salen de simular cada práctica con
// constancyAwards. Fechas relativas a la semana de hoy (hora del centro).

// Modelo que figura en los borradores de IA del mock (plantillas fijas)
const MOCK_AI_MODEL = "demo (sin IA)";

// Ids fijos (los valida isUuid, como en la base)
const DEMO_PLAN_ID = "7b2e4c1a-3f5d-4a8e-9c61-2d0f8e5b7a14";
const DEMO_GOAL_ID = "c4d81f2b-6e3a-4b7c-8d95-1a2f3e4b5c6d";
const DEMO_FEEDBACK_ID = "e9f1a2b3-4c5d-4e6f-8a7b-9c0d1e2f3a4b";
const DEMO_AI_DRAFT_ID = "3a7c9e1b-5d2f-4c8a-b6e4-0f1d2c3b4a59";
// La actividad de la demo (una poesía cargada a mano por la profesional)
const DEMO_POEM: ActivitySpec = {
  v: 1, mecanica: "poesia", titulo: "La tortuga suave", tema: "campo", esquema: "AABB", rima: "asonante", palmas: true,
  estrofas: [
    { versos: ["Una tortuga suave", "camina por la calle,", "saluda a una paloma", "que vuela por la loma."], icono: "tortuga" },
    { versos: ["La voz sale despacito", "como un globo chiquito,", "y cuando sale el sol", "decimos hola los dos."], icono: "sol" },
  ],
};
// Los juegos con la voz (cargados a mano): el globo en «Arranque suave», con
// las palabras del catálogo, y leer con la tortuga en un ejercicio propio
const DEMO_BALLOON: ActivitySpec = {
  v: 1, mecanica: "globo", titulo: "El globo de la voz suave", tema: "cielo",
  palabras: ["árbol", "oso", "uva", "elefante", "isla"],
};
const DEMO_READING: ActivitySpec = {
  v: 1, mecanica: "lectura", titulo: "Leer con la tortuga", tema: "campo", ritmo: "lento",
  frases: ["La tortuga camina despacito por el campo.", "Mira las flores, saluda al sol y sigue su camino.", "Cuando llega al río, toma agua y descansa."],
};
const DEMO_READING_EXERCISE = { id: "4c9e1a5d-7f6b-4d8e-8a2c-5b4f3e2d1c06", key: "8b5d2f7e-4a6c-4e9d-9f0b-3c2a5e7f9d46" } as const;
// «Me grabo»: contar el fin de semana (habla espontánea)
const DEMO_RECORDING: ActivitySpec = {
  v: 1, mecanica: "grabacion", titulo: "Contame tu fin de semana", tema: "ciudad",
  consigna: "Contá en un minuto qué hiciste el fin de semana. Hablá tranquilo, como te salga.", texto: null, segundos: 60,
};
const DEMO_RECORDING_EXERCISE = { id: "5d0f2b6e-8a7c-4e9f-9b3d-6c5a4f3e2d17", key: "9c6e3a8f-5b7d-4fa0-8a1c-4d3b6f8a0e57" } as const;
// Valentina: logros sin plan publicado (una devolución con medalla y dos metas)
const DEMO_VALE = {
  feedback: "5c1d7e3a-9b2f-4e6d-8a4c-1f0b3d5e7a92",
  medal: "6d2e8f4b-0c3a-4f7e-9b5d-2a1c4e6f8b03",
  goal_done: "7e3f9a5c-1d4b-4a8f-8c6e-3b2d5f7a9c14",
  goal_active: "8f4a0b6d-2e5c-4b9a-9d7f-4c3e6a8b0d25",
} as const;
const DEMO_EXERCISES = {
  arranque: { id: "1f6b8d2a-4c3e-4a5b-9d7f-2e1c0b9a8f71", key: "5e2a9c4b-1d3f-4b6a-8c7e-0f9d2b4a6c13", catalog: "hf-arranque-suave" },
  turnos: { id: "2a7c9e3b-5d4f-4b6c-8e0a-3f2d1c0b9a82", key: "6f3b0d5c-2e4a-4c7b-9d8f-1a0e3c5b7d24", catalog: "ef-turnos-mesa" },
  trabas: { id: "3b8d0f4c-6e5a-4c7d-9f1b-4a3e2d1c0b93", key: "7a4c1e6d-3f5b-4d8c-8e9a-2b1f4d6c8e35", catalog: "tf-trabas-proposito" },
} as const;

// Un momento del día del centro (Tucumán es UTC−3 todo el año)
function centerIso(dateKey: string, time: string): string {
  return new Date(`${dateKey}T${time}:00-03:00`).toISOString();
}

type PracticeSeed = Pick<Db, "practice_plans" | "practice_exercises" | "practice_logs" | "practice_notes"
  | "practice_feedback" | "practice_goals" | "practice_medals" | "ai_drafts" | "access_log">;

function seedPractice(today: string, authorLabel: string, staffEmail: string): PracticeSeed {
  const monday = weekKey(today);
  const lastMonday = addDays(monday, -7);
  const createdOn = addDays(lastMonday, -4); // jueves de hace dos semanas: armó el borrador
  const publishedOn = addDays(lastMonday, -3); // viernes: lo publicó
  const created = centerIso(createdOn, "18:00");
  const published = centerIso(publishedOn, "12:30");
  const feedbackAt = centerIso(addDays(lastMonday, 1), "20:30"); // martes pasado
  const out: PracticeSeed = {
    practice_plans: [], practice_exercises: [], practice_logs: [], practice_notes: [], practice_feedback: [],
    practice_goals: [], practice_medals: [], ai_drafts: [], access_log: [],
  };

  // El borrador de IA de «Trabas a propósito» (intereses: fútbol). Del
  // paciente solo viaja la franja de edad (ver aiDraftRules.ts)
  const built = buildAdaptParams({
    patient_id: "c-martin", catalog_ids: [DEMO_EXERCISES.trabas.catalog], approach: "tartamudear_facil",
    practiced_in_session: true, quien_acompana: "adulto_con_chico", contexto: ["casa", "juego"], minutos: 5,
    dificultad: "igual", adaptaciones: [], intereses: ["futbol"],
  }, { age: 9, diagnosis_code: "F98.5" });
  const draft = built.ok ? mockDraft(built.params, built.entries) : null;
  const parsed = draft && built.ok
    ? parseExerciseDraft(draft, built.params.catalogo.ids, built.params.minutos, built.params.enfoque)
    : null;
  if (built.ok && parsed?.ok) {
    out.ai_drafts.push({
      id: DEMO_AI_DRAFT_ID, kind: "adaptacion", patient_id: "c-martin", requested_by_email: staffEmail, model: MOCK_AI_MODEL,
      prompt_version: PROMPT_VERSION, catalog_version: CATALOG_VERSION, params: built.params, output: parsed.draft,
      flags: parsed.flags, status: "usado", error_code: null, latency_ms: 1800,
      used_at: centerIso(createdOn, "18:05"), created_at: centerIso(createdOn, "17:50"),
    });
  }

  out.practice_plans.push({
    id: DEMO_PLAN_ID, patient_id: "c-martin", version: 1, supersedes_id: null, status: "publicado",
    title: "Jugar con la voz en casa",
    goal_text: "Practicar en casa, como un juego, lo que hacemos en las sesiones: arrancar suave, perderle el miedo a las trabas y respetar los turnos para hablar.",
    audience: "preadolescencia", days_per_week: 3, review_on: addDays(publishedOn, 30), on_break_until: null,
    auto_medals: true, professional_id: null, author_label: authorLabel, adolescent_ack: false, lint_overrides: [],
    created_by_email: staffEmail, created_at: created, updated_by_email: staffEmail, updated_at: feedbackAt,
    published_at: published, published_by_email: staffEmail, closed_at: null, closed_by_email: null, close_reason: null,
    // Al mandar la devolución quedó "Visto"
    last_reviewed_at: feedbackAt, last_reviewed_by_email: staffEmail, last_reviewed_label: authorLabel,
  });

  const fromCatalog = (
    ex: (typeof DEMO_EXERCISES)[keyof typeof DEMO_EXERCISES], position: number, approach: Approach,
  ): ExerciseRow | null => {
    const e = catalogEntry(ex.catalog);
    if (!e) return null;
    return {
      id: ex.id, plan_id: DEMO_PLAN_ID, patient_id: "c-martin", exercise_key: ex.key, source: "catalogo",
      catalog_id: e.id, catalog_version: CATALOG_VERSION, position, approach, practiced_in_session: false,
      title: e.title, para_que: e.para_que, pasos: [...e.pasos], minutes: e.minutes, materiales: e.materiales,
      for_adult: e.for_adult, si_cuesta: e.si_cuesta, with_adult: e.with_adult,
      ai_draft_id: null, ai_drafted: false, reviewed_at: null, reviewed_by_email: null, edit_ratio: null,
      lint_overrides: [], removed_at: null, removed_by_email: null, created_at: created, updated_at: created,
    };
  };
  const arranque = fromCatalog(DEMO_EXERCISES.arranque, 0, "habla_facil");
  const turnos = fromCatalog(DEMO_EXERCISES.turnos, 1, "entorno_familia");
  let trabas = fromCatalog(DEMO_EXERCISES.trabas, 2, "tartamudear_facil");
  if (trabas) {
    trabas.practiced_in_session = true;
    const item = parsed?.ok ? parsed.draft.ejercicios[0] : undefined;
    if (item) {
      // Lo que propuso la IA, con lo que cambió la profesional antes de publicarlo
      const proposed = draftToExerciseInput(item, { approach: "tartamudear_facil", practiced_in_session: true, draft_id: DEMO_AI_DRAFT_ID });
      const pasos = [...proposed.pasos];
      pasos[0] = "Elijan juntos 5 palabras de fútbol: pelota, gol, arco, cancha, botín.";
      if (pasos[1]) pasos[1] = "Decí cada palabra repitiendo el primer sonido a propósito, suave y relajado: «pe-pe-pelota».";
      trabas = {
        ...trabas, source: "ia", ai_draft_id: DEMO_AI_DRAFT_ID, ai_drafted: true,
        title: "Trabas a propósito con palabras de fútbol", para_que: proposed.para_que, pasos,
        minutes: proposed.minutes, materiales: proposed.materiales, for_adult: proposed.for_adult,
        si_cuesta: proposed.si_cuesta, with_adult: proposed.with_adult,
        reviewed_at: centerIso(createdOn, "18:20"), reviewed_by_email: staffEmail,
      };
      trabas.edit_ratio = editRatio(exerciseFullText(proposed), exerciseFullText(trabas));
    }
  }
  // Actividades: el globo en «Arranque suave» y la poesía para decir juntos
  // en el de los turnos (la poesía va con cualquier enfoque)
  if (arranque) arranque.activity = DEMO_BALLOON;
  if (turnos) turnos.activity = DEMO_POEM;
  // Leer con la tortuga: un ejercicio escrito a mano por la profesional
  const lectura: ExerciseRow | null = arranque && {
    ...arranque, id: DEMO_READING_EXERCISE.id, exercise_key: DEMO_READING_EXERCISE.key, source: "manual",
    catalog_id: null, catalog_version: null, position: 3,
    title: "Leer despacito con la tortuga",
    para_que: "Practicar leer en voz alta despacio y suave, siguiendo el ritmo de la tortuga.",
    pasos: [
      "Elegí un texto cortito que te guste.",
      "Leelo en voz alta muy despacio, como habla la tortuga.",
      "Si querés, el adulto lee una frase y vos la siguiente.",
    ],
    minutes: 5, materiales: "Un texto corto o un libro de cuentos.",
    si_cuesta: "Si se cansa o se aburre, paren ahí. Cuéntenlo en la próxima sesión.",
    activity: DEMO_READING,
  };
  // Me grabo: también escrito a mano por la profesional
  const grabacion: ExerciseRow | null = arranque && {
    ...arranque, id: DEMO_RECORDING_EXERCISE.id, exercise_key: DEMO_RECORDING_EXERCISE.key, source: "manual",
    catalog_id: null, catalog_version: null, position: 4,
    title: "Contame tu fin de semana",
    para_que: "Grabarte contando algo, para que tu profesional escuche cómo va tu habla en casa.",
    pasos: [
      "Pensá qué hiciste el fin de semana.",
      "Contalo en voz alta, tranquilo, como te salga.",
      "Si querés, el adulto te hace preguntas para ayudarte.",
    ],
    minutes: 5, materiales: null,
    si_cuesta: "Si no tiene ganas de grabarse, no pasa nada: cuéntenlo sin grabar.",
    activity: DEMO_RECORDING,
  };
  for (const e of [arranque, turnos, trabas, lectura, grabacion]) if (e) out.practice_exercises.push(e);

  // Las prácticas que anotó Laura (fecha → ejercicios) y lo que contó
  const { arranque: A, turnos: T, trabas: TF } = DEMO_EXERCISES;
  const days: [string, { id: string; key: string }[]][] = [
    [addDays(lastMonday, -2), [A]],
    [lastMonday, [A, T]],
    [addDays(lastMonday, 2), [A, TF]],
    [addDays(lastMonday, 4), [T]],
  ];
  // Esta semana, si ya empezó: anteayer y ayer (sin llegar a la meta: con
  // dos días, anotar hoy gana «Semana cumplida»)
  const di = dayIndex(today);
  if (di >= 2) days.push([addDays(today, -2), [T]]);
  if (di >= 1) days.push([addDays(today, -1), [A]]);
  const notes: Record<string, { result: PracticeResult; comment: string | null }> = {
    [`${addDays(lastMonday, -2)}|${DEMO_EXERCISES.arranque.key}`]: { result: "bien", comment: null },
    [`${lastMonday}|${DEMO_EXERCISES.turnos.key}`]: {
      result: "bien", comment: "Martín eligió la cuchara de madera y no la quería soltar. ¡Nos reímos mucho!",
    },
    [`${addDays(lastMonday, 2)}|${DEMO_EXERCISES.trabas.key}`]: {
      result: "costo", comment: "Al principio se reía con las trabas a propósito, pero después le dio vergüenza y no quiso seguir.",
    },
    [`${addDays(lastMonday, 4)}|${DEMO_EXERCISES.turnos.key}`]: { result: "mas_o_menos", comment: null },
  };
  const awarded: { code: string; period_key: string }[] = [];
  const logged: PracticeDay[] = [];
  for (const [date, list] of days) {
    list.forEach((ex, i) => {
      const at = centerIso(date, `19:${String(10 + i * 5).padStart(2, "0")}`);
      const id = uuid();
      out.practice_logs.push({
        id, patient_id: "c-martin", plan_id: DEMO_PLAN_ID, exercise_id: ex.id, exercise_key: ex.key,
        account_id: "acc-laura", practiced_on: date, created_at: at, voided_at: null,
      });
      logged.push({ date, exercise_key: ex.key });
      const note = notes[`${date}|${ex.key}`];
      if (note) {
        out.practice_notes.push({
          id: uuid(), log_id: id, patient_id: "c-martin", account_id: "acc-laura", result: note.result,
          comment: note.comment, risk_flag: false, created_at: centerIso(date, `19:${String(12 + i * 5).padStart(2, "0")}`),
        });
      }
    });
    // Como el servidor: después de anotar, las medallas de constancia que corresponden
    for (const a of constancyAwards({ logs: logged, days_per_week: 3, awarded, today: date })) {
      awarded.push(a);
      out.practice_medals.push({
        id: uuid(), patient_id: "c-martin", kind: "constancia", code: a.code, title: a.title, period_key: a.period_key,
        plan_id: DEMO_PLAN_ID, goal_id: null, feedback_id: null, message: null, awarded_at: centerIso(date, "19:30"),
        awarded_by_email: null, voided_at: null, voided_by_email: null, void_reason: null,
      });
    }
  }
  // Laura ya vio «Primer paso» (la «Semana cumplida» es nueva para ella)
  for (const m of out.practice_medals.filter((x) => x.code === "primer_paso")) {
    out.access_log.push({
      id: uid("log"), patient_id: "c-martin", account_id: "acc-laura", staff_email: null, action: "ver_medalla",
      target_id: m.id, at: new Date(Date.parse(m.awarded_at) + 10 * 60 * 1000).toISOString(),
    });
  }

  // La devolución del martes pasado (Laura todavía no la abrió)
  out.practice_feedback.push({
    id: DEMO_FEEDBACK_ID, patient_id: "c-martin", plan_id: DEMO_PLAN_ID, professional_id: null, author_label: authorLabel,
    body: "¡Qué buen comienzo! Ya anotaron las primeras prácticas y me contaron que en los turnos de la mesa la cuchara de madera fue un éxito. Sigan así, como un juego: lo importante es pasarla bien juntos.",
    for_adult: "Si un día no pueden, no pasa nada: lo importante es retomar.",
    period_start: publishedOn, period_end: addDays(lastMonday, 1), adolescent_ack: false, review_note: null,
    ai_draft_id: null, ai_drafted: false, sent_at: feedbackAt, sent_by_email: staffEmail,
    withdrawn_at: null, withdrawn_by_email: null, withdraw_reason: null,
  });

  // La meta de práctica, publicada con el plan
  const rule: GoalRule = { dias: 10, semanas: 4 };
  out.practice_goals.push({
    id: DEMO_GOAL_ID, patient_id: "c-martin", plan_id: DEMO_PLAN_ID, kind: "practica", title: goalRuleText(rule), rule,
    medal_title: "Gran equipo", agreed_with_patient: true, status: "activa", created_by_email: staffEmail,
    created_at: centerIso(createdOn, "18:30"), updated_at: published, published_at: published,
    published_by_email: staffEmail, achieved_at: null, feedback_id: null, changed_at: null, changed_by_email: null,
    met_notice_dismissed_at: null,
  });

  // Valentina (en evaluación): nunca tuvo un plan publicado, pero tiene
  // logros. Dos metas sin plan publicadas hace dos semanas; el jueves pasado
  // la devolución dio por lograda una, con la medalla «¡Me animé!». Laura ya
  // vio la medalla (la celebración del Inicio salió una vez) y todavía no
  // abrió la devolución. Sin plan no hay «Ejercicios»: todo está en «Medallas»
  const valeGoalsAt = centerIso(addDays(lastMonday, -7), "17:00");
  const valeFeedbackAt = centerIso(addDays(lastMonday, 3), "17:45");
  const valeGoal = (id: string, title: string, medal: string, done: boolean): GoalRow => ({
    id, patient_id: "c-valentina", plan_id: null, kind: "terapeutica", title, rule: null, medal_title: medal,
    agreed_with_patient: false, status: done ? "lograda" : "activa", created_by_email: staffEmail,
    created_at: valeGoalsAt, updated_at: done ? valeFeedbackAt : valeGoalsAt, published_at: valeGoalsAt,
    published_by_email: staffEmail, achieved_at: done ? valeFeedbackAt : null, feedback_id: done ? DEMO_VALE.feedback : null,
    changed_at: null, changed_by_email: null, met_notice_dismissed_at: null,
  });
  out.practice_goals.push(
    valeGoal(DEMO_VALE.goal_done, "Elegir un juego y contarnos cómo se juega", "¡Me animé!", true),
    valeGoal(DEMO_VALE.goal_active, "Traer un juguete y contarnos a qué juega", "Gran contadora", false),
  );
  out.practice_feedback.push({
    id: DEMO_VALE.feedback, patient_id: "c-valentina", plan_id: null, professional_id: null, author_label: authorLabel,
    body: "¡Qué lindo fue jugar con vos, Valentina! Elegiste el juego y nos contaste cómo se jugaba. Para la próxima, traé tu juguete preferido y nos contás a qué juegan.",
    for_adult: "Si en casa les pregunta algo, respondan con calma y sin apuro: lo importante es disfrutar de conversar.",
    period_start: null, period_end: centerDateOf(valeFeedbackAt), adolescent_ack: false, review_note: null,
    ai_draft_id: null, ai_drafted: false, sent_at: valeFeedbackAt, sent_by_email: staffEmail,
    withdrawn_at: null, withdrawn_by_email: null, withdraw_reason: null,
  });
  out.practice_medals.push({
    id: DEMO_VALE.medal, patient_id: "c-valentina", kind: "profesional", code: "profesional", title: "¡Me animé!",
    period_key: "", plan_id: null, goal_id: DEMO_VALE.goal_done, feedback_id: DEMO_VALE.feedback,
    message: "¡Qué valiente!", awarded_at: valeFeedbackAt, awarded_by_email: staffEmail,
    voided_at: null, voided_by_email: null, void_reason: null,
  });
  out.access_log.push({
    id: uid("log"), patient_id: "c-valentina", account_id: "acc-laura", staff_email: null, action: "ver_medalla",
    target_id: DEMO_VALE.medal, at: new Date(Date.parse(valeFeedbackAt) + 2 * 60 * 60 * 1000).toISOString(),
  });
  return out;
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
  // Los PDF que se habían subido eran de la base anterior
  forgetDocFiles();
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
    // Sesión nueva (o ninguna): la contraseña confirmada era de la anterior
    sessionStore()?.removeItem(STEP_UP_KEY);
    if (accountId) sessionStore()?.setItem(SESSION_KEY, accountId);
    else sessionStore()?.removeItem(SESSION_KEY);
  } catch { /* nada */ }
}

// Marca la sesión de esta pestaña como "contraseña confirmada recién"
function markStepUp(accountId: string) {
  const now = new Date().toISOString();
  try {
    sessionStore()?.setItem(STEP_UP_KEY, JSON.stringify({ account_id: accountId, verified_at: now, last_info_at: now }));
  } catch { /* sin storage: no queda marcada */ }
}

/** Borra los datos y la sesión de la demo (botón "Reiniciar demo"). */
export function resetDemo() {
  memoryDb = null;
  forgetDocFiles();
  try {
    storage()?.removeItem(DB_KEY);
    sessionStore()?.removeItem(SESSION_KEY);
    sessionStore()?.removeItem(STEP_UP_KEY);
  } catch { /* nada */ }
}

// ── PDF de la copia digital (bytes) ─────────────────────────────────────────
// Los bytes no van a localStorage (no entran: hasta 10 MB por archivo). Quedan
// en la memoria de esta pestaña y, si el navegador lo permite, en IndexedDB:
// así los encuentra otra pestaña (el panel sube, el portal descarga) y
// sobreviven a una recarga. Sin ninguno de los dos (ventana privada, otra
// pestaña sin IndexedDB) "Ver" y la descarga contestan 410.

const docFiles = new Map<string, Blob>();
const FILES_DB = "cimt-portal-mock-files";
const FILES_STORE = "files";
let filesDbP: Promise<IDBDatabase | null> | null = null;

function filesDb(): Promise<IDBDatabase | null> {
  filesDbP ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(FILES_DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(FILES_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null); // sin IndexedDB: solo la memoria de la pestaña
    }
  });
  return filesDbP;
}

// Una operación sobre el almacén de archivos; null si no se pudo
async function filesStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const idb = await filesDb();
  if (!idb) return null;
  return new Promise((resolve) => {
    try {
      const tx = idb.transaction(FILES_STORE, mode);
      const req = run(tx.objectStore(FILES_STORE));
      tx.oncomplete = () => resolve(req.result ?? null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function keepDocFile(id: string, file: Blob) {
  const blob = new Blob([file], { type: "application/pdf" });
  docFiles.set(id, blob);
  await filesStore("readwrite", (s) => s.put(blob, id));
}

function dropDocFile(id: string) {
  docFiles.delete(id);
  void filesStore("readwrite", (s) => s.delete(id));
}

function forgetDocFiles() {
  docFiles.clear();
  void filesStore("readwrite", (s) => s.clear());
}

// PDF de una página para la copia sembrada de la demo (Helvetica, sin fuentes
// incrustadas). Las letras fuera de ASCII van como códigos de WinAnsiEncoding:
// así todo el archivo es ASCII y su largo es el de sus bytes (lo necesitan
// /Length y la tabla xref)
const DEMO_PDF_LINES: [size: number, y: number, text: string][] = [
  [18, 770, "Historia clínica de prueba — CIMT (demo)"],
  [11, 736, "Paciente de la demo: Valentina Ruiz."],
  [11, 718, "Es un archivo de ejemplo del modo demo: no es una historia clínica real."],
  [11, 700, "En el portal real, cada PDF lleva la firma digital de la Dirección del CIMT."],
];

function pdfString(s: string): string {
  return Array.from(s, (c) => {
    if (c === "(" || c === ")" || c === "\\") return `\\${c}`;
    const code = c === "—" ? 0x97 : c === "–" ? 0x96 : c.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) return c;
    return code <= 0xff ? `\\${code.toString(8).padStart(3, "0")}` : "?";
  }).join("");
}

let demoPdf: string | null = null;
function demoPdfText(): string {
  if (demoPdf) return demoPdf;
  const stream = DEMO_PDF_LINES.map(([size, y, line]) => `BT /F1 ${size} Tf 72 ${y} Td (${pdfString(line)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  demoPdf = out;
  return out;
}

let demoPdfHash: string | null = null;
async function demoPdfSha(): Promise<string> {
  demoPdfHash ??= await sha256Hex(new TextEncoder().encode(demoPdfText()));
  return demoPdfHash;
}

// Los bytes de un PDF: el de prueba se arma; los subidos, de la memoria de la
// pestaña o de IndexedDB. null: se perdieron (ver arriba)
async function docBlob(d: HcDocument): Promise<Blob | null> {
  if (d.demo_pdf) return new Blob([demoPdfText()], { type: "application/pdf" });
  const mem = docFiles.get(d.id);
  if (mem) return mem;
  const stored = await filesStore("readonly", (s) => s.get(d.id));
  if (!(stored instanceof Blob)) return null;
  docFiles.set(d.id, stored);
  return stored;
}

// Enlace al PDF que vence en 60 segundos (como la URL firmada del servidor)
function tempUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), HC_LINK_SECONDS * 1000);
  return url;
}

const DOC_LOST = "El archivo de la demo se perdió al recargar: subilo de nuevo.";

// ── Utilidades ──────────────────────────────────────────────────────────────

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
// Las respuestas que podrían revelar si un DNI existe tardan siempre lo mismo
const FLOOR_MS = 700;

async function withFloor<T>(fn: () => T, floorMs = FLOOR_MS): Promise<T> {
  const start = Date.now();
  const result = fn();
  const rest = floorMs - (Date.now() - start);
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

// UUID v4 como en la base: el código de verificación de lo publicado sale del id
function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Huella de unos bytes (los PDF de la copia digital). Sin crypto.subtle
// (página sin https ni localhost) queda vacía
async function sha256Hex(data: BufferSource): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf), (n) => n.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

// Huella del texto publicado (body_sha256). Vacía sin crypto.subtle: en el
// mock nadie la lee
async function sha256(v: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(v)));
}

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

// Turnos de la agenda del mock (los de los chicos invitados desde el panel y
// los que se dieron desde la bandeja, ver apptsFor)
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

// Los turnos de la demo viven acá; los de los chicos invitados desde el panel,
// en la agenda del mock. Un chico de la demo también puede tener turnos en la
// agenda del mock: los que le da el equipo desde la bandeja («Dar turno» →
// «Cargar el turno acá» los guarda con el cliente del mock, como en producción)
async function apptsFor(db: Db, childIds: string[]): Promise<Appt[]> {
  const known = childIds.filter((id) => db.children.some((c) => c.id === id));
  return [
    ...db.appts.filter((a) => childIds.includes(a.child_id)),
    ...(await agendaAppts(known)),
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

// Pedidos de copia de esta cuenta (abiertos y cerrados recientes). Los de
// una copia enviada por el portal llevan sus PDF (computeHcDto los muestra
// mientras se pueda descargar) y todos, cuándo se cerraron (closed_at, de la
// columna de cada paso, como el servidor)
function hcRequestsFor(db: Db, accountId: string, onlyPatientId?: string): HcRequestDTO[] {
  const patients = hcPatients(db, accountId).filter((p) => !onlyPatientId || p.patient_id === onlyPatientId);
  if (!patients.length) return [];
  const now = new Date();
  return db.hc_requests
    .filter((r) => r.account_id === accountId && patients.some((p) => p.patient_id === r.patient_id))
    .sort((x, y) => y.created_at.localeCompare(x.created_at))
    .slice(0, 50)
    .filter((r) => hcVisible(r, now))
    .map((r) => computeHcDto(r, patients.find((p) => p.patient_id === r.patient_id)!, familyDocs(db, r), now));
}

// Del primero que se subió al último (como el orden del servidor)
const byUpload = (x: HcDocument, y: HcDocument) => x.uploaded_at.localeCompare(y.uploaded_at) || x.id.localeCompare(y.id);

// PDF enviados de un pedido (los que no se quitaron)
function sentDocs(db: Db, requestId: string): HcDocument[] {
  return db.hc_documents.filter((d) => d.request_id === requestId && !!d.published_at && !d.removed_at).sort(byUpload);
}

// Los PDF de una copia enviada, tal como los ve la familia: sin el nombre
// original del archivo (solo lo ve el equipo), con su código de verificación
function familyDocs(db: Db, r: HcRequest): HcDocumentDTO[] {
  if (r.status !== "enviada" || !hcDigitalOn()) return [];
  const docs = sentDocs(db, r.id);
  return docs.map((d, i) => ({ id: d.id, label: hcDocLabel(i, docs.length), code: verificationCode(d.id) }));
}

// Pedidos de turno de estas personas (las que la cuenta ve hoy), hechos por
// cualquier adulto de la familia: abiertos y cerrados recientes, del más nuevo
// al más viejo. Si se agendó, va el turno enlazado mientras siga agendado; si
// el turno enlazado se canceló o se borró, la familia lo ve (y puede pedir otro).
async function apptRequestsFor(db: Db, accountId: string, patientIds: string[]): Promise<ApptRequestDTO[]> {
  if (!patientIds.length) return [];
  const now = new Date();
  const rows = db.appt_requests
    .filter((r) => patientIds.includes(r.patient_id) && apptRequestVisible(r, now))
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  const linked = rows.filter((r) => r.status === "agendado" && r.appointment_id);
  const appts = linked.length ? await apptsFor(db, [...new Set(linked.map((r) => r.patient_id))]) : [];
  return rows.flatMap((r) => {
    const c = db.children.find((x) => x.id === r.patient_id);
    if (!c) return [];
    const a = appts.find((x) => x.id === r.appointment_id && x.child_id === r.patient_id && x.status === "agendado");
    return [computeApptRequestDto(
      r,
      { display: displayName(db, accountId, c), self: isSelfLink(db, accountId, c.id) },
      accountId,
      a ? { id: a.id, date: a.date, time: a.time } : null,
      // Tenía un turno enlazado que ya no está agendado
      !!r.appointment_id && !a,
    )];
  });
}

// ¿Hay un pedido de turno en curso para esta persona? De cualquier adulto: uno
// abierto por persona (como el índice único de la base)
function apptRequestOpenFor(db: Db, patientId: string): boolean {
  return db.appt_requests.some((r) => r.patient_id === patientId && apptReqOpen(r.status));
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
    // Orden judicial: no se vincula (como validChildren en el servidor)
    if (isBlocked(db, inv.dni, child_id, inv.guardian_ids[child_id] ?? null)) continue;
    already.add(child_id);
    const self = (inv.self_ids ?? []).includes(child_id);
    const legacyKind = inv.relationship_kind === "titular" ? "representante_legal" : inv.relationship_kind;
    const birth = db.children.find((c) => c.id === child_id)?.birth_date ?? null;
    db.links.push({
      id: uid("lnk"), account_id: accountId, child_id,
      relationship_kind: self ? "titular" : inv.kinds?.[child_id]?.kind ?? legacyKind,
      guardian_id: self ? null : inv.guardian_ids[child_id] ?? null,
      // Con 16 o 17 el panel solo invita si el chico dio su conformidad
      adolescent_consent_at: !self && birth && ageOn(birth, centerNow().date) >= 16 ? new Date().toISOString() : null,
      // La verificación en persona del vínculo se carga después, en la ficha
      verified_in_person_on: null, verified_by_email: null, parental_checked_on: null,
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
  // clinical (y children[].clinical) solo viajan con la etapa "consent" prendida
  const withClinical = FEATURES.includes("consent");
  const clinical = withClinical ? familyClinical(db, acc.id) : undefined;
  const perChild = withClinical ? await childrenClinical(db, acc) : undefined;
  // Lo nuevo en "Mi información" (etapa "info"), solo de quienes la cuenta puede ver
  if (perChild && FEATURES.includes("info")) {
    const infoOk = [...perChild].filter(([, v]) => v.info === "ok").map(([id]) => id);
    const fresh = await infoNewCounts(db, acc.id, infoOk);
    for (const id of infoOk) perChild.get(id)!.info_new = fresh.get(id) ?? 0;
  }
  // Ejercicios (etapa "practice"), solo de quienes la cuenta puede ver: lo de
  // los cuadraditos "Ejercicios" y "Mis logros" (null si no hay nada para
  // ver) y la medalla nueva de más prioridad para el aviso destacado del Inicio
  let celebration: CelebrationDTO | null | undefined;
  if (perChild && FEATURES.includes("practice")) {
    let best: { m: MedalRow; who: PracticeChildDTO } | null = null;
    for (const [id, v] of perChild) {
      if (v.practice !== "ok") continue;
      const who = await practiceWho(db, acc, id);
      if (!who) continue;
      v.practice_home = practiceHome(db, acc.id, who, today);
      const top = unseenMedals(db, acc.id, id).sort(medalPriority)[0];
      if (top && (!best || medalPriority(top, best.m) < 0)) best = { m: top, who };
    }
    celebration = best ? celebrationOf(db, best.m, best.who) : null;
  }
  const children: ChildDTO[] = [];
  for (const id of ids) {
    const c = db.children.find((x) => x.id === id)!;
    const later = (await apptsOf(db, acc.id, [id], addDays(weekEnd, 1), addDays(today, 90)))
      .find((a) => a.state === "agendado") ?? null;
    children.push({
      id, first_name: displayName(db, acc.id, c), last_initial: lastInitial(c), self: isSelfLink(db, acc.id, id),
      can_request_hc: canRequestHcFor(db, acc.id, id), next: later,
      ...(perChild ? { clinical: perChild.get(id) ?? { info: "not_available", practice: "not_available" } } : {}),
    });
  }
  return ok({
    guardian_first_name: acc.first_name, week, children, requests: hcRequestsFor(db, acc.id),
    appt_requests: await apptRequestsFor(db, acc.id, ids),
    // El mock siempre tiene los pedidos de turno (en el servidor, si ya se corrió el script 24)
    can_request_appts: true,
    ...(clinical ? { clinical } : {}),
    ...(celebration !== undefined ? { celebration } : {}),
  });
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
    // "Mi información" (etapa "info"): si está apagada, la página de
    // información no la pide y muestra solo la copia del historial
    info_on: FEATURES.includes("info"),
    appointments: await apptsOf(db, acc.id, [c.id], today, addDays(today, 90)),
    // Copia de la historia clínica: si esta cuenta puede pedirla, sus pedidos
    // y si se le ofrece recibirla en el portal (E1)
    hc: {
      can_request: canRequestHcFor(db, acc.id, c.id), requests: hcRequestsFor(db, acc.id, c.id),
      digital: await hcDigitalFor(db, acc, c.id),
    },
    // Pedidos de turno de esta persona (de cualquier adulto de la familia). El
    // mock siempre los tiene (enabled); se puede pedir si no hay otro abierto
    turnos: { enabled: true, can_request: !apptRequestOpenFor(db, c.id), requests: await apptRequestsFor(db, acc.id, [c.id]) },
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
// centro o, con la etapa E1, se descarga del portal (si la cuenta pasa la
// regla "hc"). En producción: POST /api/portal/hc (server/lib/requests.ts) y
// POST /api/portal/document.

const DAY_MS = 24 * 60 * 60 * 1000;
const HC_NOT_FOUND = "No encontramos ese pedido.";
const DOC_NOT_FOUND = "No encontramos ese documento.";

// Copia digital: ¿esta cuenta puede recibir hoy la copia de este paciente por
// el portal? Es la regla "hc": vínculo con derecho a la copia, verificado en
// persona (con la documentación de madre, padre o tutor/a si es representante
// legal), información de salud activada y el portal del paciente sin pausa
// (con la configuración real: la pausa corta el canal digital, no la copia en
// mano). No depende de lo que prendió el profesional ni de la conformidad del
// adolescente: la copia es un derecho
async function hcGate(db: Db, acc: Account, patientId: string): Promise<{ ok: true } | { ok: false; block: ClinicalBlock }> {
  const l = linkOf(db, acc.id, patientId);
  if (!l || !acc.active) return { ok: false, block: "sin_vinculo" };
  const v = await linkCheck(db, l, acc, centerNow().date);
  return clinicalAccess({
    link_kind: l.relationship_kind, link_valid: v.valid, hc_ok: v.hc_ok, age: v.age,
    verified_in_person: !!l.verified_in_person_on, parental_checked: !!l.parental_checked_on,
    settings: settingsOf(db, patientId), clinical_consent: consentActive(latestConsent(db, acc.id)),
    blocked: isBlocked(db, acc.dni, patientId, l.guardian_id),
  }, "hc");
}

// ¿Se ofrece recibir la copia en el portal? (como hcDigitalOffer en el
// servidor) Con la etapa E1 prendida se ofrece siempre; blocked dice por qué
// todavía no se puede elegir, con las mismas respuestas que la información de
// salud (nunca el motivo real)
async function hcDigitalFor(db: Db, acc: Account, patientId: string): Promise<{ offered: boolean; blocked: HcDigitalBlock | null }> {
  if (!hcDigitalOn()) return { offered: false, blocked: null };
  if (!canRequestHcFor(db, acc.id, patientId)) return { offered: true, blocked: "not_available" };
  const outcome = publicOutcome(await hcGate(db, acc, patientId));
  return { offered: true, blocked: outcome === "ok" ? null : outcome };
}

// Los mismos textos que server/lib/requests.ts
const DIGITAL_BLOCKED_TEXT: Record<HcDigitalBlock, string> = {
  consent: "Para recibirla en el portal, primero activá la información de salud.",
  verify: "Para recibirla en el portal, primero pasá por el centro con tu DNI para verificar el vínculo. Mientras tanto, podés pedirla para retirar en el centro.",
  not_available: "Por ahora no se puede recibir por el portal. Podés pedirla para retirar en el centro.",
};

// Al representante legal, además del DNI, se le pide lo que acredita el vínculo
const PARENTAL_PROOF = "Si sos mamá, papá o tutor/a, traé también la partida o el documento que lo acredite.";
const isParent = (kind: string | undefined) => kind === "representante_legal";

function digitalBlockedText(gate: HcDigitalBlock, kind: string | undefined): string {
  if (gate !== "verify" || !isParent(kind)) return DIGITAL_BLOCKED_TEXT[gate];
  return "Para recibirla en el portal, primero pasá por el centro con tu DNI para verificar el vínculo. "
    + `${PARENTAL_PROOF} Mientras tanto, podés pedirla para retirar en el centro.`;
}

function verifyDownloadText(kind: string | undefined): string {
  const base = "Para descargarla, primero tenés que pasar por el centro con tu DNI.";
  return isParent(kind) ? `${base} ${PARENTAL_PROOF}` : base;
}

// Descarga con el portal del paciente en pausa (sin decir por qué)
const PAUSED_DOWNLOAD = "Por ahora no se puede descargar desde el portal. Si la necesitás, pedila en mano en el centro.";

// Los PDF que el equipo había subido a un pedido que se cierra sin enviarlo
// (entregada en mano, rechazada o cancelada por la familia: byEmail
// "familia") se quitan. Quien llama guarda la base.
function dropUnsentDocs(db: Db, requestId: string, byEmail: string, at: string) {
  for (const d of db.hc_documents) {
    if (d.request_id !== requestId || d.published_at || d.removed_at) continue;
    d.removed_at = at;
    d.removed_by_email = byEmail;
    dropDocFile(d.id);
  }
}

// channel: "mano" (en el centro) o "portal" (E1: solo si la cuenta ya puede
// recibirla; si no, 409 code DIGITAL_BLOCKED)
export async function hcCreate(patientId: string, channel: HcChannel = "mano"): Promise<ApiResult<HcRequestDTO>> {
  await wait(450);
  const first = load();
  const acc = requireAccount(first);
  if (!acc) return fail(401, SESSION_EXPIRED);
  // Como el servidor, se revisa el valor (no se confía en el tipo)
  const how = HC_CHANNELS.find((x) => x === channel);
  if (!how) return fail(400, "Pedido inválido");
  const link = linkOf(first, acc.id, patientId);
  if (!link) return fail(404, "No encontramos a ese chico en tu cuenta.");
  const kind = link.relationship_kind;
  if (!canRequestHc(kind)) {
    return fail(403, "La copia la pueden pedir el propio paciente o su madre, padre o tutor/a. Si necesitás ayuda, llamanos.", { code: "NOT_ALLOWED" });
  }
  // Con el portal del paciente en pausa, la regla "hc" contesta "no disponible"
  // (en mano se sigue pidiendo)
  if (how === "portal") {
    const gate = hcDigitalOn() ? publicOutcome(await hcGate(first, acc, patientId)) : "not_available";
    if (gate !== "ok") return fail(409, digitalBlockedText(gate, kind), { code: "DIGITAL_BLOCKED" });
  }
  // De acá en adelante, sin esperas y con la base recién leída
  const db = load();
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
    created_at: new Date().toISOString(), channel: how,
  });
  db.hc_requests.push(row);
  save(db);
  const c = db.children.find((x) => x.id === patientId)!;
  return ok(computeHcDto(row, { display: displayName(db, acc.id, c), self: isSelfLink(db, acc.id, patientId), page: true }));
}

// Descargar un PDF de la copia enviada por el portal (como familyDownload en
// server/lib/hcDocuments.ts). Solo la cuenta que la pidió, dentro de los 60
// días desde el envío (410 code EXPIRED), con la regla "hc" (403 code
// CONSENT, VERIFY o NOT_AVAILABLE; con el portal del paciente en pausa,
// NOT_AVAILABLE y que la pida en mano) y la contraseña confirmada en los
// últimos 15 minutos (403 code REAUTH). Enlace de 60 segundos con un nombre
// genérico (nada del paciente); queda registrado (acción "descargar").
export async function hcDocument(documentId: string): Promise<ApiResult<{ url: string; expires_in: number; file_name: string }>> {
  if (!hcDigitalOn()) return fail(404, NOT_AVAILABLE);
  await wait(350);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const doc = validId(documentId) ? db.hc_documents.find((d) => d.id === documentId) : undefined;
  if (!doc || !doc.published_at || doc.removed_at) return fail(404, DOC_NOT_FOUND);
  const row = db.hc_requests.find((r) => r.id === doc.request_id);
  // De otra cuenta: lo mismo que si no existiera
  if (!row || row.account_id !== acc.id || row.status !== "enviada") return fail(404, DOC_NOT_FOUND);
  if (!hcDownloadable(row) || !row.sent_at) {
    return fail(410, "Ya pasaron los 60 días para descargarla. Si la necesitás, pedí una copia nueva.", { code: "EXPIRED" });
  }
  const sentAt = row.sent_at;
  const access = await hcGate(db, acc, row.patient_id);
  const gate = publicOutcome(access);
  if (gate === "consent") return fail(403, "Para descargarla, primero activá la información de salud.", { code: "CONSENT" });
  if (gate === "verify") {
    return fail(403, verifyDownloadText(linkOf(db, acc.id, row.patient_id)?.relationship_kind), { code: "VERIFY" });
  }
  if (!access.ok && access.block === "pausado") return fail(403, PAUSED_DOWNLOAD, { code: "NOT_AVAILABLE" });
  if (gate !== "ok") {
    return fail(403, "Esta copia ya no se puede descargar desde tu cuenta. Si la necesitás, llamanos.", { code: "NOT_AVAILABLE" });
  }
  if (needsReauth(acc.id, "download")) return fail(403, "Para descargarla, volvé a poner tu contraseña.", { code: "REAUTH" });

  const blob = await docBlob(doc);
  if (!blob) return fail(410, DOC_LOST);
  // Se registra sobre la base recién leída (otra pestaña pudo cambiarla)
  const w = load();
  const docs = sentDocs(w, row.id);
  const index = Math.max(0, docs.findIndex((d) => d.id === doc.id));
  logAccess(w, row.patient_id, acc.id, "descargar", doc.id, new Date().toISOString());
  save(w);
  return ok({ url: tempUrl(blob), expires_in: HC_LINK_SECONDS, file_name: hcDownloadName(sentAt, index, Math.max(docs.length, 1)) });
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
  dropUnsentDocs(db, row.id, "familia", now);
  save(db);
  return ok(computeHcDto(row, patient));
}

// ── Pedidos de turno (familia) ──────────────────────────────────────────────
// Lo puede pedir cualquier adulto con acceso a los turnos de esa persona
// (titular, representante legal o autorizado). No es un turno: el equipo lo
// agenda o llama. En producción: POST /api/portal/pedido-turno
// (server/lib/apptRequests.ts).

const APPT_REQ_NOT_FOUND = "No encontramos ese pedido.";

export async function apptRequestCreate(patientId: string, input: ApptRequestInput): Promise<ApiResult<ApptRequestDTO>> {
  await wait(450);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const link = linkOf(db, acc.id, patientId);
  const c = db.children.find((x) => x.id === patientId);
  if (!link || !c) return fail(404, "No encontramos a ese chico en tu cuenta.");
  // Como el servidor, se revisa cada valor (no se confía en el tipo)
  const v = validateApptRequest(input);
  if (!v.ok) return fail(400, v.error);
  const since = Date.now() - DAY_MS;
  if (db.appt_requests.filter((r) => r.account_id === acc.id && Date.parse(r.created_at) >= since).length >= APPT_REQ_DAILY_MAX) {
    return fail(429, "Ya hiciste varios pedidos hoy. Si necesitás algo más, llamanos.");
  }
  const child = { display: displayName(db, acc.id, c), self: isSelfLink(db, acc.id, c.id) };
  if (apptRequestOpenFor(db, patientId)) {
    return fail(409, child.self
      ? "Ya tenés un pedido de turno en curso. Te avisamos acá cuando lo resolvamos."
      : `Ya hay un pedido de turno en curso para ${child.display}. Te avisamos acá cuando lo resolvamos.`, { code: "APPT_OPEN" });
  }
  // El pedido y su constancia (apptReqRow la agrega, sin email: lo hizo la familia)
  const row = apptReqRow({
    id: uid("pt"), patient_id: patientId, account_id: acc.id, link_kind: link.relationship_kind,
    requester_name: `${acc.first_name} ${acc.last_name}`.trim(), ...v.value,
    created_at: new Date().toISOString(),
  });
  db.appt_requests.push(row);
  save(db);
  return ok(computeApptRequestDto(row, child, acc.id, null));
}

export async function apptRequestCancel(id: string): Promise<ApiResult<ApptRequestDTO>> {
  await wait(400);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  if (!validId(id)) return fail(404, APPT_REQ_NOT_FOUND);
  const row = db.appt_requests.find((r) => r.id === id);
  const c = row ? db.children.find((x) => x.id === row.patient_id) : undefined;
  // Solo lo cancela quien lo pidió, mientras siga viendo a esa persona. Un
  // pedido de otro adulto da lo mismo que uno que no existe
  if (!row || !c || row.account_id !== acc.id || !childIdsOf(db, acc.id).includes(row.patient_id)) {
    return fail(404, APPT_REQ_NOT_FOUND);
  }
  if (!apptReqOpen(row.status)) {
    return fail(409, row.status === "agendado"
      ? "Este pedido ya tiene turno: lo ves en la lista. Si no van a poder ir, avisanos desde el turno."
      : "Este pedido ya está cerrado.");
  }
  const now = new Date().toISOString();
  row.status = "cancelado";
  row.cancelled_at = now;
  row.updated_at = now;
  logApptEvent(row, "cancelado", null, now);
  save(db);
  return ok(computeApptRequestDto(row, { display: displayName(db, acc.id, c), self: isSelfLink(db, acc.id, c.id) }, acc.id, null));
}

// ── Información de salud (familia) ──────────────────────────────────────────
// Etapa A: activarla (aviso + contraseña) o dejar de verla, y "volvé a poner
// tu contraseña". Todavía no se muestra nada clínico. En producción:
// server/api/portal/{consent,reauth,me}.ts y server/lib/portalClinical.ts.

const NOT_AVAILABLE = "No disponible.";

// Lo último que hizo la cuenta con el aviso (si dos filas empatan en la
// hora, vale la que se guardó después)
function latestConsent(db: Db, accountId: string): Consent | undefined {
  let out: Consent | undefined;
  for (const c of db.consents) {
    if (c.account_id === accountId && c.kind === "informacion_clinica" && (!out || c.created_at >= out.created_at)) out = c;
  }
  return out;
}

// Vale si lo último que hizo la cuenta fue aceptar el aviso vigente
function consentActive(c: Consent | undefined): boolean {
  return !!c && c.accepted && c.version === CLINICAL_NOTICE_VERSION;
}

function familyClinical(db: Db, accountId: string): FamilyClinicalDTO {
  const c = latestConsent(db, accountId);
  return {
    features: shownFeatures(),
    consent: { accepted: consentActive(c), version: c?.accepted ? c.version : null, current_version: CLINICAL_NOTICE_VERSION },
  };
}

// Solo se agregan filas (como portal_consents). Quien llama guarda la base.
function recordConsent(db: Db, accountId: string, accepted: boolean, opts: { channel?: "portal" | "papel"; fileId?: string; byEmail?: string } = {}) {
  db.consents.push({
    id: uid("cons"), account_id: accountId, kind: "informacion_clinica", version: CLINICAL_NOTICE_VERSION, accepted,
    channel: opts.channel ?? "portal", file_id: opts.fileId ?? null, recorded_by_email: opts.byEmail ?? null,
    created_at: new Date().toISOString(),
  });
}

function settingsOf(db: Db, patientId: string): Settings | null {
  return db.settings.find((s) => s.patient_id === patientId) ?? null;
}

// Orden judicial vigente para esta persona y este paciente: por el DNI con
// que se cargó o por su fila en la ficha (como blockedPatients en el servidor)
function isBlocked(db: Db, dni: string, patientId: string, guardianId?: string | null): boolean {
  return db.blocks.some((b) => b.patient_id === patientId && !b.lifted_at
    && (b.dni === dni || (!!guardianId && b.guardian_id === guardianId)));
}

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

async function panelPatient(id: string): Promise<Row | undefined> {
  const { data } = await mockSupabase.from("patients").select("*").eq("id", id);
  return ((data ?? []) as Row[])[0];
}

// Lo que el portal copia de la ficha del panel para la vigencia del vínculo
function cardCopy(p: Row | undefined): Pick<Child, "dni" | "birth_date" | "discharge_date"> {
  return { dni: text(p?.dni), birth_date: text(p?.birth_date), discharge_date: text(p?.discharge_date) };
}

type Card = { id: string; first_name: string; dni: string | null; birth_date: string | null; discharge_date: string | null };

// Ficha del paciente: la del mock del panel y, lo que ella no tenga, la copia
// que guardó el portal. Los chicos de la demo no tienen ficha en el panel, y
// el mock del panel vive en la memoria de cada pestaña: en la del portal, la
// ficha no trae lo que se cargó en la del panel.
async function patientCard(db: Db, id: string): Promise<Card | null> {
  const c = db.children.find((x) => x.id === id);
  const p = c?.source === "demo" ? undefined : await panelPatient(id);
  if (!p && !c) return null;
  const live = cardCopy(p);
  return {
    id,
    first_name: p ? String(p.first_name ?? "") : c!.first_name,
    dni: live.dni ?? c?.dni ?? null,
    birth_date: live.birth_date ?? c?.birth_date ?? null,
    discharge_date: live.discharge_date ?? c?.discharge_date ?? null,
  };
}

type GuardianInfo = { id: string; patient_id: string; full_name: string; relationship: string | null; dni: string | null; active: boolean };

function toGuardian(r: Row): GuardianInfo {
  return {
    id: String(r.id), patient_id: String(r.patient_id), full_name: String(r.full_name ?? ""),
    relationship: text(r.relationship), dni: text(r.dni), active: r.active !== false,
  };
}

async function guardianRow(id: string): Promise<GuardianInfo | null> {
  const { data } = await mockSupabase.from("patient_guardians").select("*").eq("id", id);
  const r = ((data ?? []) as Row[])[0];
  return r ? toGuardian(r) : null;
}

// Vigencia del vínculo hoy (linkValidity) con lo que el mock puede ver. Si la
// fila del adulto no está en el mock del panel (chicos de la demo, u otra
// pestaña) se toma como activa y con el DNI de la cuenta.
async function linkCheck(db: Db, l: Link, acc: Pick<Account, "dni">, today: string) {
  const card = await patientCard(db, l.child_id);
  const guardian = l.guardian_id ? await guardianRow(l.guardian_id) : null;
  const { valid, hc_ok } = linkValidity({
    kind: l.relationship_kind, account_dni: acc.dni,
    patient: card ? { id: card.id, dni: card.dni, birth_date: card.birth_date, discharge_date: card.discharge_date } : null,
    guardian: guardian ?? { patient_id: l.child_id, dni: acc.dni, active: true },
    adolescent_consent_at: l.adolescent_consent_at,
    blocked: isBlocked(db, acc.dni, l.child_id, l.guardian_id),
  }, today);
  return { card, guardian, valid, hc_ok, age: card?.birth_date ? ageOn(card.birth_date, today) : null };
}

// Por cada persona que la cuenta ve hoy: si puede ver su información y sus
// ejercicios (en la versión reducida que sale hacia la familia)
async function childrenClinical(db: Db, acc: Account): Promise<Map<string, ChildClinicalDTO>> {
  const out = new Map<string, ChildClinicalDTO>();
  const today = centerNow().date;
  const consent = consentActive(latestConsent(db, acc.id));
  for (const l of db.links.filter((x) => x.account_id === acc.id)) {
    const v = await linkCheck(db, l, acc, today);
    if (!v.valid || !v.card) continue;
    const input = {
      link_kind: l.relationship_kind, link_valid: v.valid, hc_ok: v.hc_ok, age: v.age,
      verified_in_person: !!l.verified_in_person_on, parental_checked: !!l.parental_checked_on,
      settings: settingsOf(db, l.child_id), clinical_consent: consent, blocked: false,
    };
    out.set(l.child_id, {
      info: publicOutcome(clinicalAccess(input, "info")),
      practice: publicOutcome(clinicalAccess(input, "practice")),
    });
  }
  return out;
}

// Confirma la contraseña de la cuenta (sin abrir una sesión nueva)
function passwordMatches(acc: Account, password: string | undefined): boolean {
  return !!password && acc.password === password;
}

const PASSWORD_WRONG = "La contraseña no es correcta.";

// { accept: true, password }: activarla (acepta el aviso vigente) ·
// { accept: false }: dejar de verla (solo para esta cuenta)
export async function clinicalConsent(accept: boolean, password?: string): Promise<ApiResult<FamilyClinicalDTO>> {
  if (!FEATURES.includes("consent")) return fail(404, NOT_AVAILABLE);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);

  if (accept === false) {
    await wait(350);
    recordConsent(db, acc.id, false);
    save(db);
    return ok(familyClinical(db, acc.id));
  }
  if (accept !== true) return fail(400, "Pedido inválido");

  // La contraseña confirma que es la persona dueña de la cuenta. Mismo
  // límite de intentos que el ingreso
  return withFloor(() => {
    const locked = loginLockedUntil(db, acc.dni);
    if (locked) return fail(429, "Hiciste muchos intentos.", { retry_at: locked });
    if (!passwordMatches(acc, password)) {
      registerLoginFailure(db, acc.dni);
      return fail(400, PASSWORD_WRONG, { code: "PASSWORD" });
    }
    delete db.login_failures[acc.dni];
    recordConsent(db, acc.id, true);
    save(db);
    markStepUp(acc.id);
    return ok(familyClinical(db, acc.id));
  }, 1200);
}

// "Volvé a poner tu contraseña" antes de ver información de salud o de
// descargar un documento. No abre una sesión nueva: marca la actual.
export async function reauth(password: string): Promise<ApiResult<{ ok: true }>> {
  if (!FEATURES.includes("consent")) return fail(404, NOT_AVAILABLE);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  return withFloor(() => {
    const locked = loginLockedUntil(db, acc.dni);
    if (locked) return fail(429, "Hiciste muchos intentos.", { retry_at: locked });
    if (!passwordMatches(acc, password)) {
      registerLoginFailure(db, acc.dni);
      return fail(400, PASSWORD_WRONG, { code: "PASSWORD" });
    }
    delete db.login_failures[acc.dni];
    save(db);
    markStepUp(acc.id);
    return ok({ ok: true as const });
  }, 1200);
}

// ── Mi información (familia) ────────────────────────────────────────────────
// Etapa C: lo que el profesional publicó para la persona, en lenguaje claro.
// En producción: GET /api/portal/info (familyInfo en server/lib/portalInfo.ts).

const INFO_NOT_FOUND = "No encontramos esa información en tu cuenta.";

// ¿Hace falta volver a poner la contraseña? Como needsReauth en el servidor:
// la marca va con la sesión de la pestaña y, para "info", se renueva con el uso
function needsReauth(accountId: string, need: "info" | "download"): boolean {
  const s = sessionStore();
  try {
    const raw = s?.getItem(STEP_UP_KEY);
    const mark = raw ? (JSON.parse(raw) as { account_id?: string; verified_at: string; last_info_at: string | null }) : null;
    if (!mark || mark.account_id !== accountId) return true;
    const fresh = reauthFresh(mark, need);
    if (fresh && need === "info") s?.setItem(STEP_UP_KEY, JSON.stringify({ ...mark, last_info_at: new Date().toISOString() }));
    return !fresh;
  } catch {
    return true;
  }
}

type PanelReport = {
  id: string; patient_id: string; report_date: string; professional_id: string | null;
  progress: string | null; therapy_evolution: string | null;
  voided_at: string | null; updated_at: string | null; created_at: string;
};

function toReport(r: Row): PanelReport {
  return {
    id: String(r.id), patient_id: String(r.patient_id), report_date: String(r.report_date ?? ""),
    professional_id: text(r.professional_id), progress: text(r.progress), therapy_evolution: text(r.therapy_evolution),
    voided_at: text(r.voided_at), updated_at: text(r.updated_at), created_at: String(r.created_at ?? ""),
  };
}

// Informes de la ficha (mock del panel), del más nuevo al más viejo. Los
// chicos de la demo no tienen ficha. Como el mock del panel vive en la memoria
// de cada pestaña, en la del portal no están los que se cargaron en otra.
async function panelReports(db: Db, patientId: string): Promise<PanelReport[]> {
  if (db.children.find((c) => c.id === patientId)?.source === "demo") return [];
  const { data } = await mockSupabase.from("patient_reports").select("*").eq("patient_id", patientId);
  return ((data ?? []) as Row[]).map(toReport).sort((x, y) => y.report_date.localeCompare(x.report_date));
}

async function panelReport(id: string): Promise<PanelReport | null> {
  const { data } = await mockSupabase.from("patient_reports").select("*").eq("id", id);
  const r = ((data ?? []) as Row[])[0];
  return r ? toReport(r) : null;
}

// Lo que la familia ve hoy de una persona, de lo más nuevo a lo más viejo:
// lo no retirado, salvo los informes que después se anularon en la ficha
async function livePublications(db: Db, patientId: string): Promise<Publication[]> {
  const pubs = db.publications.filter((p) => p.patient_id === patientId && !p.withdrawn_at);
  const gone = pubs.some((p) => p.source_report_id)
    ? new Set((await panelReports(db, patientId)).filter((r) => r.voided_at).map((r) => r.id))
    : new Set<string>();
  return pubs
    .filter((p) => !p.source_report_id || !gone.has(p.source_report_id))
    .sort((x, y) => y.published_at.localeCompare(x.published_at));
}

// Publicaciones que esta cuenta ya abrió alguna vez
function seenBy(db: Db, accountId: string): Set<string> {
  return new Set(db.access_log.flatMap((l) =>
    l.account_id === accountId && l.action === "ver_publicacion" && l.target_id ? [l.target_id] : []));
}

// Solo se agregan filas (como portal_access_log). Quien llama guarda la base.
function logAccess(db: Db, patientId: string, accountId: string, action: AccessLog["action"], targetId: string | null, at: string) {
  db.access_log.push({ id: uid("log"), patient_id: patientId, account_id: accountId, staff_email: null, action, target_id: targetId, at });
}

// Para el Inicio: cuántas publicaciones vigentes no abrió todavía esta cuenta
// (quien llama pasa solo las personas para las que "info" da ok)
async function infoNewCounts(db: Db, accountId: string, patientIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const seen = seenBy(db, accountId);
  for (const id of patientIds) {
    const n = (await livePublications(db, id)).filter((p) => !seen.has(p.id)).length;
    if (n) out.set(id, n);
  }
  return out;
}

// La familia abre "Mi información" de una persona vinculada. 403 con code
// CONSENT, VERIFY, NOT_AVAILABLE o REAUTH, como el servidor
export async function info(patientId: string): Promise<ApiResult<InfoDTO>> {
  if (!FEATURES.includes("info")) return fail(404, NOT_AVAILABLE);
  await wait(350);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const link = linkOf(db, acc.id, patientId);
  const child = db.children.find((c) => c.id === patientId);
  // Solo las personas que la cuenta ve hoy (vínculo vigente). Un paciente
  // ajeno (o de un adulto autorizado) da lo mismo que uno que no existe
  const perChild = await childrenClinical(db, acc);
  if (!link || !child || link.relationship_kind === "autorizado" || !perChild.has(patientId)) return fail(404, INFO_NOT_FOUND);
  const outcome = perChild.get(patientId)?.info ?? "not_available";
  if (outcome === "consent") return fail(403, "Para ver la información de salud, primero activala.", { code: "CONSENT" });
  if (outcome === "verify") {
    return fail(403, "Para ver la información de salud, la primera vez tenés que pasar por el centro con tu DNI.", { code: "VERIFY" });
  }
  if (outcome !== "ok") return fail(403, "Todavía no hay información para ver acá.", { code: "NOT_AVAILABLE" });
  if (needsReauth(acc.id, "info")) {
    return fail(403, "Para ver la información de salud, volvé a poner tu contraseña.", { code: "REAUTH" });
  }

  const pubs = await livePublications(db, patientId);
  // ¿Qué abrió ya esta cuenta? (para marcar lo nuevo y para que el equipo sepa
  // quién lo leyó). La lectura se registra sobre la base recién leída: otra
  // pestaña pudo cambiarla mientras tanto
  const w = load();
  const seen = seenBy(w, acc.id);
  const now = new Date().toISOString();
  logAccess(w, patientId, acc.id, "ver_informacion", null, now);
  for (const p of pubs) if (!seen.has(p.id)) logAccess(w, patientId, acc.id, "ver_publicacion", p.id, now);
  save(w);

  const summary = pubs.find((p) => p.kind === "resumen") ?? null;
  return ok({
    child: { id: patientId, first_name: displayName(db, acc.id, child), self: isSelfLink(db, acc.id, patientId) },
    summary: summary ? {
      ...(summary.body as SummaryBody),
      id: summary.id, author_label: summary.author_label, published_at: summary.published_at,
      version: summary.version, is_new: !seen.has(summary.id), code: verificationCode(summary.id),
    } : null,
    reports: pubs.filter((p) => p.kind === "informe")
      .map((p) => {
        const b = p.body as ReportBody;
        return {
          id: p.id, title: p.title, report_date: b.report_date, author_label: p.author_label,
          published_at: p.published_at, sections: reportSections(b), is_new: !seen.has(p.id), code: verificationCode(p.id),
          written_by: b.mode === "tal_cual" && b.written_by && b.written_by !== p.author_label ? b.written_by : null,
        };
      })
      .sort((a, b) => b.report_date.localeCompare(a.report_date)),
  });
}

// ── Ejercicios, devoluciones y medallas (familia) ───────────────────────────
// Etapa B ("practice"). En producción: GET /api/portal/practice?view=…&id=…
// y POST /api/portal/practice { action } (server/api/portal/practice.ts y
// server/lib/practice.ts). Sin contraseña de nuevo: son parte de la
// práctica diaria. 403 con code CONSENT, VERIFY o NOT_AVAILABLE (nunca el
// motivo real); un paciente, un ejercicio o una práctica ajenos dan el mismo
// 404 que uno que no existe. Lo que ve la familia nunca lleva emails del
// equipo, motivos de retiro, avisos del texto, marcas de IA ni notas de otras
// cuentas. Los comentarios de la familia no se escriben en ningún registro.

const PRACTICE_NOT_FOUND = "No encontramos esos ejercicios en tu cuenta.";
const EXERCISE_NOT_FOUND = "No encontramos ese ejercicio en tu cuenta.";
const LOG_NOT_FOUND = "No encontramos esa práctica en tu cuenta.";
const LOG_UNDONE = "Esa práctica se deshizo: anotala de nuevo para contar cómo les fue.";
const REVIEWER_FALLBACK = "Tu profesional"; // "Tu profesional vio las prácticas el …"
const DAY_LABELS = ["hoy", "ayer", "anteayer"] as const;

// ── Lecturas comunes (familia y equipo) ──

const byPosition = (x: ExerciseRow, y: ExerciseRow) => x.position - y.position || x.created_at.localeCompare(y.created_at);
const newestFirst = <T>(at: (x: T) => string) => (x: T, y: T) => at(y).localeCompare(at(x));

// El plan publicado (uno por paciente, como el índice único de la base)
function livePlan(db: Db, patientId: string): PlanRow | null {
  return db.practice_plans.find((p) => p.patient_id === patientId && p.status === "publicado") ?? null;
}

function draftPlanOf(db: Db, patientId: string): PlanRow | null {
  return db.practice_plans.find((p) => p.patient_id === patientId && p.status === "borrador") ?? null;
}

// Los ejercicios de una versión del plan, en orden (con los quitados)
function planRows(db: Db, planId: string): ExerciseRow[] {
  return db.practice_exercises.filter((e) => e.plan_id === planId).sort(byPosition);
}

function activeRows(db: Db, planId: string): ExerciseRow[] {
  return planRows(db, planId).filter((e) => !e.removed_at);
}

// Las prácticas vigentes (no deshechas) de un paciente, de cualquier plan
function liveLogs(db: Db, patientId: string): PracticeLogRow[] {
  return db.practice_logs.filter((l) => l.patient_id === patientId && !l.voided_at);
}

const asDays = (logs: PracticeLogRow[]): PracticeDay[] => logs.map((l) => ({ date: l.practiced_on, exercise_key: l.exercise_key }));

// La práctica vigente de un ejercicio en un día
function logOn(db: Db, patientId: string, key: string, date: string): PracticeLogRow | null {
  return db.practice_logs.find((l) => l.patient_id === patientId && l.exercise_key === key && l.practiced_on === date && !l.voided_at) ?? null;
}

// Primer día (del centro) en que se publicó ese ejercicio, en cualquier versión
function firstPublishedOn(db: Db, patientId: string, key: string): string | null {
  const dates = db.practice_exercises
    .filter((e) => e.patient_id === patientId && e.exercise_key === key)
    .map((e) => db.practice_plans.find((p) => p.id === e.plan_id)?.published_at)
    .filter((x): x is string => !!x)
    .map(centerDateOf)
    .sort();
  return dates[0] ?? null;
}

// Un ejercicio (de cualquier versión) en el plan publicado de hoy: por su
// identidad, así un enlace viejo sigue andando y "Hecho hoy" se mantiene.
// null: ya no está en el plan
function currentOf(db: Db, patientId: string, key: string): { plan: PlanRow; ex: ExerciseRow } | null {
  const plan = livePlan(db, patientId);
  const ex = plan ? activeRows(db, plan.id).find((e) => e.exercise_key === key) : undefined;
  return plan && ex ? { plan, ex } : null;
}

// Lo que esta cuenta ya abrió o ya vio (devoluciones y medallas)
function seenTargets(db: Db, accountId: string, action: "ver_devolucion" | "ver_medalla"): Set<string> {
  return new Set(db.access_log.flatMap((l) => (l.account_id === accountId && l.action === action && l.target_id ? [l.target_id] : [])));
}

function liveFeedback(db: Db, patientId: string): FeedbackRow[] {
  return db.practice_feedback.filter((f) => f.patient_id === patientId && !f.withdrawn_at).sort(newestFirst((f) => f.sent_at));
}

function liveMedals(db: Db, patientId: string): MedalRow[] {
  return db.practice_medals.filter((m) => m.patient_id === patientId && !m.voided_at).sort(newestFirst((m) => m.awarded_at));
}

// Las que se repiten van juntas ("Ganada 4 veces"): las de constancia, una
// tarjeta por código; las del profesional, cada una la suya
const medalGroupKey = (m: MedalRow) => (m.kind === "constancia" ? `c|${m.code}` : `p|${m.id}`);

// Medallas que esta cuenta todavía no vio
function unseenMedals(db: Db, accountId: string, patientId: string): MedalRow[] {
  const seen = seenTargets(db, accountId, "ver_medalla");
  return liveMedals(db, patientId).filter((m) => !seen.has(m.id));
}

// Con qué nombre la dio el profesional (el de su devolución)
function medalBy(db: Db, m: MedalRow): string | null {
  if (m.kind !== "profesional") return null;
  return db.practice_feedback.find((f) => f.id === m.feedback_id)?.author_label ?? null;
}

// La persona como la ve esta cuenta (con su franja por la edad de hoy)
async function practiceWho(db: Db, acc: Account, patientId: string): Promise<PracticeChildDTO | null> {
  const child = db.children.find((c) => c.id === patientId);
  if (!child) return null;
  const card = await patientCard(db, patientId);
  const age = card?.birth_date ? ageOn(card.birth_date, centerNow().date) : null;
  return { id: patientId, first_name: displayName(db, acc.id, child), self: isSelfLink(db, acc.id, patientId), audience: audienceForAge(age) };
}

// Celebración: las del profesional se nombran de forma genérica (su título
// puede ser sensible: se ve en la página de medallas)
function celebrationOf(db: Db, m: MedalRow, who: PracticeChildDTO): CelebrationDTO {
  return {
    medal_id: m.id, patient_id: m.patient_id, first_name: who.first_name, self: who.self, audience: who.audience,
    kind: m.kind, title: m.kind === "profesional" ? null : m.title, by: medalBy(db, m),
  };
}

// Para celebrar: la más nueva; a la par, la del profesional y después las de
// constancia más grandes (como el servidor)
function medalPriority(x: MedalRow, y: MedalRow): number {
  const rank = (m: MedalRow) => (m.kind === "profesional" ? 100 : CONSTANCY_CODES.indexOf(m.code as ConstancyCode));
  return y.awarded_at.localeCompare(x.awarded_at) || rank(y) - rank(x);
}

function feedbackItem(db: Db, f: FeedbackRow, seen: Set<string>): FeedbackItemDTO {
  const medal = db.practice_medals.find((m) => m.feedback_id === f.id && m.kind === "profesional" && !m.voided_at);
  return {
    id: f.id, author_label: f.author_label, sent_at: f.sent_at, body: f.body, for_adult: f.for_adult,
    medal_title: medal?.title ?? null,
    goals_achieved: db.practice_goals.filter((g) => g.feedback_id === f.id && g.status === "lograda").map((g) => g.title),
    is_new: !seen.has(f.id),
  };
}

// Metas que ve la familia: las activas y las logradas (nunca borradores ni
// cambiadas). Una lograda lleva la medalla que de verdad se dio por ella
// (vigente), no la acordada; sin ninguna, null (como el servidor)
// withProgress: en la página de logros, "En camino desde" y el avance de las
// metas de práctica (como el servidor)
function familyGoals(db: Db, patientId: string, withProgress = false): GoalDTO[] {
  const rows = db.practice_goals.filter((g) => g.patient_id === patientId && (g.status === "activa" || g.status === "lograda"));
  const active = rows.filter((g) => g.status === "activa").sort((x, y) => (x.published_at ?? "").localeCompare(y.published_at ?? ""));
  const done = rows.filter((g) => g.status === "lograda").sort(newestFirst((g) => g.achieved_at ?? ""));
  const medals = liveMedals(db, patientId);
  const days = withProgress ? asDays(liveLogs(db, patientId)) : [];
  const today = centerNow().date;
  return [...active, ...done].map((g) => {
    const lograda = g.status === "lograda";
    const given = lograda ? medals.find((m) => m.kind === "profesional" && m.goal_id === g.id) : undefined;
    return {
      id: g.id, kind: g.kind, title: g.title, status: lograda ? "lograda" : "activa",
      achieved_at: lograda ? g.achieved_at : null, medal_title: lograda ? given?.title ?? null : g.medal_title,
      ...(withProgress ? familyGoalExtras(g, days, today) : {}),
    };
  });
}

// Si la persona tiene algo de la etapa "practice" para ver: plan publicado,
// devolución vigente, medalla vigente o meta activa o lograda
function hasPracticeThings(db: Db, patientId: string): boolean {
  return !!livePlan(db, patientId) || liveFeedback(db, patientId).length > 0 || liveMedals(db, patientId).length > 0
    || db.practice_goals.some((g) => g.patient_id === patientId && (g.status === "activa" || g.status === "lograda"));
}

function medalItem(db: Db, m: MedalRow, times: number, isNew: boolean): MedalDTO {
  return {
    id: m.id, kind: m.kind, code: m.code, title: m.title, awarded_at: m.awarded_at, times, by: medalBy(db, m),
    message: m.kind === "profesional" ? m.message : null,
    goal_title: m.goal_id ? db.practice_goals.find((g) => g.id === m.goal_id)?.title ?? null : null,
    is_new: isNew,
  };
}

const myNote = (db: Db, logId: string, accountId: string): MyNoteDTO | null => {
  const n = db.practice_notes.find((x) => x.log_id === logId && x.account_id === accountId);
  return n ? { result: n.result, comment: n.comment } : null;
};

// Deshacer: solo lo que anotó esta cuenta, el mismo día en que lo anotó
const canUndo = (l: PracticeLogRow, accountId: string, today: string) =>
  !l.voided_at && l.account_id === accountId && centerDateOf(l.created_at) === today;

function weekOf(db: Db, plan: PlanRow, today: string) {
  return weekProgress(asDays(liveLogs(db, plan.patient_id)), plan.days_per_week, today);
}

const breakUntil = (plan: PlanRow | null, today: string) => (plan && onBreak(plan.on_break_until, today) ? plan.on_break_until : null);

// Para el Inicio ("Ejercicios", solo con has_plan, y "Mis logros") y el botón
// Ejercicios (como practiceHome del servidor). null: no hay nada para ver (ni
// plan publicado, ni devoluciones, medallas o metas vigentes). audience: la
// de la persona (por su edad); mode: el del plan (sin plan, por la edad)
function practiceHome(db: Db, accountId: string, who: PracticeChildDTO, today: string): PracticeHomeDTO | null {
  const patientId = who.id;
  if (!hasPracticeThings(db, patientId)) return null;
  const plan = livePlan(db, patientId);
  const week = plan ? weekOf(db, plan, today) : null;
  const seen = seenTargets(db, accountId, "ver_devolucion");
  return {
    mode: SCREEN_MODE_BY_AUDIENCE[plan ? plan.audience : who.audience], audience: who.audience,
    has_plan: !!plan,
    week: week ? { count: week.count, target: week.target } : null,
    on_break_until: breakUntil(plan, today),
    feedback_new: liveFeedback(db, patientId).filter((f) => !seen.has(f.id)).length,
    medals_new: unseenMedals(db, accountId, patientId).length,
  };
}

// ── Puerta de la familia ──

type PracticeFamily = { acc: Account; who: PracticeChildDTO };

// Como clinicalGate("practice") en el servidor: el vínculo vale hoy, no es
// un adulto autorizado y la regla "practice" da ok
async function practiceGate(db: Db, acc: Account, patientId: string): Promise<PracticeFamily | ApiResult<never>> {
  const link = linkOf(db, acc.id, patientId);
  const perChild = await childrenClinical(db, acc);
  const who = await practiceWho(db, acc, patientId);
  if (!link || !who || link.relationship_kind === "autorizado" || !perChild.has(patientId)) return fail(404, PRACTICE_NOT_FOUND);
  const outcome = perChild.get(patientId)?.practice ?? "not_available";
  if (outcome === "consent") return fail(403, "Para ver los ejercicios, primero activá la información de salud.", { code: "CONSENT" });
  if (outcome === "verify") {
    return fail(403, "Para ver los ejercicios, la primera vez tenés que pasar por el centro con tu DNI.", { code: "VERIFY" });
  }
  if (outcome !== "ok") return fail(403, PRACTICE_TEXT.not_available, { code: "NOT_AVAILABLE" });
  return { acc, who };
}

// La sesión y la puerta, a partir del paciente
async function practiceEntry(patientId: unknown): Promise<PracticeFamily | ApiResult<never>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  if (!validId(patientId)) return fail(404, PRACTICE_NOT_FOUND);
  return practiceGate(db, acc, patientId);
}

// ── Lo que ve la familia ──

function practicePage(db: Db, f: PracticeFamily, today: string): PracticeDTO {
  const patientId = f.who.id;
  const plan = livePlan(db, patientId);
  const rows = plan ? activeRows(db, plan.id) : [];
  const seenFeedback = seenTargets(db, f.acc.id, "ver_devolucion");
  const seenMedals = seenTargets(db, f.acc.id, "ver_medalla");
  const feedback = liveFeedback(db, patientId);
  // "Lic. … vio las prácticas el …": el nombre con que firmaba quien marcó
  // "Visto" (guardado al marcarlo). Nunca el de otra persona (ni el autor del
  // plan): si no está, un texto neutro
  const reviewer = plan?.last_reviewed_at ? plan.last_reviewed_label?.trim() || REVIEWER_FALLBACK : null;
  return {
    child: f.who,
    mode: plan ? SCREEN_MODE_BY_AUDIENCE[plan.audience] : SCREEN_MODE_BY_AUDIENCE[f.who.audience],
    plan: plan ? {
      id: plan.id, title: plan.title, goal_text: plan.goal_text, author_label: plan.author_label ?? "",
      published_at: plan.published_at ?? plan.updated_at, days_per_week: plan.days_per_week,
      total_minutes: rows.reduce((s, e) => s + e.minutes, 0),
    } : null,
    exercises: rows.map((e) => {
      const log = logOn(db, patientId, e.exercise_key, today);
      return {
        id: e.id, title: e.title, minutes: e.minutes, with_adult: e.with_adult, done_today: !!log, log_id: log?.id ?? null,
        can_undo: !!log && canUndo(log, f.acc.id, today), my_note: log ? myNote(db, log.id, f.acc.id) : null,
      };
    }),
    week: plan ? weekOf(db, plan, today) : null,
    goals: familyGoals(db, patientId),
    last_feedback: feedback[0] ? feedbackItem(db, feedback[0], seenFeedback) : null,
    feedback_new: feedback.filter((x) => !seenFeedback.has(x.id)).length,
    recent_medals: liveMedals(db, patientId).slice(0, RECENT_MEDALS).map((m) => medalItem(db, m, 1, !seenMedals.has(m.id))),
    reviewed: plan?.last_reviewed_at && reviewer ? { by: reviewer, on: centerDateOf(plan.last_reviewed_at) } : null,
    on_break_until: breakUntil(plan, today),
    adult_guide: [...new Set(rows.map((e) => e.for_adult).filter((x): x is string => !!x))],
    celebration: unseenMedals(db, f.acc.id, patientId).sort(medalPriority).map((m) => celebrationOf(db, m, f.who)),
  };
}

// Como el servidor: «Me grabo» solo con la etapa "recordings"
function familyActivity(raw: unknown) {
  const a = readActivity(raw);
  return a?.mecanica === "grabacion" && !FEATURES.includes("recordings") ? null : a;
}

// Edad de un chico de la demo (para la versión interactiva, desde los 6)
function childAge(db: Db, patientId: string, today: string): number | null {
  const birth = db.children.find((c) => c.id === patientId)?.birth_date ?? null;
  return birth ? ageOn(birth, today) : null;
}

function exercisePage(db: Db, f: PracticeFamily, plan: PlanRow, ex: ExerciseRow, today: string): PracticeExerciseDTO {
  const days: PracticeDayDTO[] = practiceDates(today, firstPublishedOn(db, ex.patient_id, ex.exercise_key)).map((date) => {
    const log = logOn(db, ex.patient_id, ex.exercise_key, date);
    return {
      date,
      label: DAY_LABELS[Math.min(2, Math.max(0, daysBetween(date, today)))],
      log: log ? {
        id: log.id, mine: log.account_id === f.acc.id, can_undo: canUndo(log, f.acc.id, today),
        my_note: myNote(db, log.id, f.acc.id),
      } : null,
    };
  });
  return {
    child: f.who,
    mode: SCREEN_MODE_BY_AUDIENCE[plan.audience],
    plan_id: plan.id,
    author_label: plan.author_label ?? "",
    exercise: {
      id: ex.id, title: ex.title, para_que: ex.para_que, pasos: [...ex.pasos], minutes: ex.minutes,
      materiales: ex.materiales, for_adult: ex.for_adult, si_cuesta: ex.si_cuesta, with_adult: ex.with_adult,
      activity: activitiesOn() && activityAgeOk(childAge(db, ex.patient_id, today)) ? familyActivity(ex.activity ?? null) : null,
    },
    today,
    days,
    week: weekOf(db, plan, today),
    on_break_until: breakUntil(plan, today),
  };
}

// Medallas de constancia nuevas después de anotar (como el servidor): las
// guarda y las devuelve. Quien llama guarda la base.
function awardConstancy(db: Db, plan: PlanRow, today: string, now: string): MedalRow[] {
  const patientId = plan.patient_id;
  const awards = constancyAwards({
    logs: asDays(liveLogs(db, patientId)),
    days_per_week: plan.days_per_week,
    // Todas, también las anuladas: una anulada no se vuelve a dar sola
    awarded: db.practice_medals.filter((m) => m.patient_id === patientId && m.kind === "constancia")
      .map((m) => ({ code: m.code, period_key: m.period_key })),
    today,
    auto_medals: plan.auto_medals,
    on_break_until: plan.on_break_until,
  });
  const rows = awards.map((a): MedalRow => ({
    id: uuid(), patient_id: patientId, kind: "constancia", code: a.code, title: a.title, period_key: a.period_key,
    plan_id: plan.id, goal_id: null, feedback_id: null, message: null, awarded_at: now, awarded_by_email: null,
    voided_at: null, voided_by_email: null, void_reason: null,
  }));
  db.practice_medals.push(...rows);
  return rows;
}

/** "Ejercicios de Martín" (GET practice?view=plan). No marca nada como visto. */
export async function practice(patientId: string): Promise<ApiResult<PracticeDTO>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(350);
  const gate = await practiceEntry(patientId);
  if (!("acc" in gate)) return gate;
  return ok(practicePage(load(), gate, centerNow().date));
}

/** Pantalla de práctica de un ejercicio del plan publicado (GET practice?view=exercise). */
export async function practiceExercise(exerciseId: string): Promise<ApiResult<PracticeExerciseDTO>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(300);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const row = validId(exerciseId) ? db.practice_exercises.find((e) => e.id === exerciseId) : undefined;
  if (!row) return fail(404, EXERCISE_NOT_FOUND);
  const gate = await practiceGate(db, acc, row.patient_id);
  // Un ejercicio de otra persona da lo mismo que uno que no existe
  if (!("acc" in gate)) return gate.ok === false && gate.status === 404 ? fail(404, EXERCISE_NOT_FOUND) : gate;
  const w = load();
  const cur = currentOf(w, row.patient_id, row.exercise_key);
  if (!cur) return fail(404, PRACTICE_ERROR.gone);
  return ok(exercisePage(w, gate, cur.plan, cur.ex, centerNow().date));
}

/**
 * "Ya lo hice": queda anotado en ese momento. Uno por ejercicio y por día: si
 * otro adulto (o esta cuenta) ya lo anotó, devuelve ese registro sin sumar
 * otro. practiced_on: hoy, ayer o anteayer, nunca antes de que se publicara
 * el ejercicio (400 code DATE). 40 registros por cuenta por día (429 code
 * LIMIT; cuentan los deshechos). new_medals: las medallas que ganó esta práctica.
 */
export async function practiceLog(input: PracticeLogInput): Promise<ApiResult<PracticeActionResult>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(400);
  const first = load();
  const acc = requireAccount(first);
  if (!acc) return fail(401, SESSION_EXPIRED);
  // Como el servidor, se revisa cada valor (no se confía en el tipo)
  const b = (input ?? {}) as unknown as Record<string, unknown>;
  const row = validId(b.exercise_id) ? first.practice_exercises.find((e) => e.id === b.exercise_id) : undefined;
  if (!row) return fail(404, EXERCISE_NOT_FOUND);
  const gate = await practiceGate(first, acc, row.patient_id);
  if (!("acc" in gate)) return gate.ok === false && gate.status === 404 ? fail(404, EXERCISE_NOT_FOUND) : gate;

  // De acá en adelante, sin esperas y con la base recién leída
  const db = load();
  const today = centerNow().date;
  const cur = currentOf(db, row.patient_id, row.exercise_key);
  if (!cur) return fail(404, PRACTICE_ERROR.gone);
  const rawDate = b.practiced_on;
  const date = rawDate === undefined || rawDate === null || rawDate === "" ? today : String(rawDate);
  const problem = practiceDateProblem(date, today, firstPublishedOn(db, row.patient_id, row.exercise_key));
  if (problem) return fail(400, problem, { code: "DATE" });
  let log = logOn(db, row.patient_id, row.exercise_key, date);
  let awards: MedalRow[] = [];
  if (!log) {
    const todays = db.practice_logs.filter((l) => l.account_id === acc.id && centerDateOf(l.created_at) === today).length;
    if (todays >= PRACTICE_DAILY_MAX) return fail(429, PRACTICE_ERROR.limit, { code: "LIMIT" });
    const now = new Date().toISOString();
    log = {
      id: uuid(), patient_id: row.patient_id, plan_id: cur.plan.id, exercise_id: cur.ex.id, exercise_key: cur.ex.exercise_key,
      account_id: acc.id, practiced_on: date, created_at: now, voided_at: null,
    };
    db.practice_logs.push(log);
    awards = awardConstancy(db, cur.plan, today, now);
    save(db);
  }
  return ok({
    exercise: exercisePage(db, gate, cur.plan, cur.ex, today),
    log_id: log.id,
    new_medals: awards.sort(medalPriority).map((m) => celebrationOf(db, m, gate.who)),
  });
}

/**
 * "¿Cómo te fue?" y el comentario optativo: una nota por cuenta y por
 * práctica (409 si ya la dejó). Se puede sobre una práctica que anotó otro
 * adulto. La marca de riesgo la calcula validateNote (sin IA).
 */
export async function practiceNote(input: PracticeNoteInput): Promise<ApiResult<PracticeActionResult>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(350);
  const first = load();
  const acc = requireAccount(first);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const b = (input ?? {}) as unknown as Record<string, unknown>;
  const v = validateNote({ result: b.result, comment: b.comment });
  if (!v.ok) return fail(400, v.error, { code: v.code });
  const found = validId(b.log_id) ? first.practice_logs.find((l) => l.id === b.log_id) : undefined;
  if (!found) return fail(404, LOG_NOT_FOUND);
  const gate = await practiceGate(first, acc, found.patient_id);
  if (!("acc" in gate)) return gate.ok === false && gate.status === 404 ? fail(404, LOG_NOT_FOUND) : gate;

  const db = load();
  const today = centerNow().date;
  const log = db.practice_logs.find((l) => l.id === found.id);
  if (!log) return fail(404, LOG_NOT_FOUND);
  if (log.voided_at) return fail(409, LOG_UNDONE);
  const cur = currentOf(db, log.patient_id, log.exercise_key);
  if (!cur) return fail(404, PRACTICE_ERROR.gone);
  if (db.practice_notes.some((n) => n.log_id === log.id && n.account_id === acc.id)) {
    return fail(409, PRACTICE_ERROR.note_twice, { code: "CONFLICT" });
  }
  db.practice_notes.push({
    id: uuid(), log_id: log.id, patient_id: log.patient_id, account_id: acc.id, result: v.value.result,
    comment: v.value.comment, risk_flag: v.value.risk, created_at: new Date().toISOString(),
  });
  save(db);
  return ok({ exercise: exercisePage(db, gate, cur.plan, cur.ex, today), log_id: log.id, new_medals: [] });
}

/** Deshacer: solo lo que anotó esta cuenta, el mismo día. Las medallas ganadas no se pierden. */
export async function practiceUndo(logId: string): Promise<ApiResult<PracticeActionResult>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(350);
  const first = load();
  const acc = requireAccount(first);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const found = validId(logId) ? first.practice_logs.find((l) => l.id === logId) : undefined;
  if (!found) return fail(404, LOG_NOT_FOUND);
  const gate = await practiceGate(first, acc, found.patient_id);
  if (!("acc" in gate)) return gate.ok === false && gate.status === 404 ? fail(404, LOG_NOT_FOUND) : gate;

  const db = load();
  const today = centerNow().date;
  const log = db.practice_logs.find((l) => l.id === found.id);
  if (!log) return fail(404, LOG_NOT_FOUND);
  if (log.account_id !== acc.id || centerDateOf(log.created_at) !== today) return fail(403, PRACTICE_ERROR.undo_only_mine);
  const cur = currentOf(db, log.patient_id, log.exercise_key);
  if (!cur) return fail(404, PRACTICE_ERROR.gone);
  // Deshacer dos veces no hace nada más
  if (!log.voided_at) {
    log.voided_at = new Date().toISOString();
    save(db);
  }
  return ok({ exercise: exercisePage(db, gate, cur.plan, cur.ex, today), log_id: null, new_medals: [] });
}

/**
 * Devoluciones del profesional, de la más nueva a la más vieja. No marca nada
 * como visto (is_new: esta cuenta todavía no la vio): la página las marca
 * después con practiceFeedbackSeen. Así leerla dos veces (React en modo
 * estricto, "Reintentar") no borra la marca "Nueva".
 */
export async function practiceFeedback(patientId: string): Promise<ApiResult<FeedbackDTO>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(300);
  const gate = await practiceEntry(patientId);
  if (!("acc" in gate)) return gate;
  const w = load();
  const seen = seenTargets(w, gate.acc.id, "ver_devolucion");
  return ok({
    child: gate.who, has_plan: !!livePlan(w, gate.who.id), items: liveFeedback(w, gate.who.id).map((f) => feedbackItem(w, f, seen)),
  });
}

// Las personas para las que esta cuenta ve la práctica hoy ("practice" da ok
// y no es un adulto autorizado): solo sobre ellas se marca algo como visto
// (si no, una cuenta podría marcar una devolución o una medalla ajena)
async function practiceAllowed(db: Db, acc: Account): Promise<Set<string>> {
  const perChild = await childrenClinical(db, acc);
  return new Set([...perChild].filter(([id, v]) => v.practice === "ok"
    && linkOf(db, acc.id, id)?.relationship_kind !== "autorizado").map(([id]) => id));
}

// ids de un pedido "…_seen": hasta 50 ids válidos
const seenIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length <= 50 && ids.every(validId);

/** Las devoluciones ya se leyeron (por cuenta). Solo cuentan las vigentes de personas que esta cuenta ve. */
export async function practiceFeedbackSeen(ids: string[]): Promise<ApiResult<{ ok: true }>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(200);
  const first = load();
  const acc = requireAccount(first);
  if (!acc) return fail(401, SESSION_EXPIRED);
  if (!seenIds(ids)) return fail(400, "Pedido inválido");
  const allowed = await practiceAllowed(first, acc);
  // Se registra sobre la base recién leída (otra pestaña pudo cambiarla)
  const w = load();
  const seen = seenTargets(w, acc.id, "ver_devolucion");
  const now = new Date().toISOString();
  for (const id of new Set(ids)) {
    const f = w.practice_feedback.find((x) => x.id === id && !x.withdrawn_at);
    if (!f || !allowed.has(f.patient_id) || seen.has(f.id)) continue;
    logAccess(w, f.patient_id, acc.id, "ver_devolucion", f.id, now);
    seen.add(f.id);
  }
  save(w);
  return ok({ ok: true as const });
}

/**
 * "Medallas de Martín" / "Mis logros": las ganadas (las que se repiten van
 * juntas: "Ganada 4 veces"), "Para seguir sumando" y las metas activas y
 * logradas. Se puede ver sin plan publicado. is_new: esta cuenta todavía no
 * la vio (se marca con practiceMedalsSeen, no al abrir la página).
 */
export async function practiceMedals(patientId: string): Promise<ApiResult<MedalsDTO>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(300);
  const gate = await practiceEntry(patientId);
  if (!("acc" in gate)) return gate;
  const w = load();
  const today = centerNow().date;
  const pid = gate.who.id;
  const plan = livePlan(w, pid);
  const seen = seenTargets(w, gate.acc.id, "ver_medalla");
  const medals = liveMedals(w, pid);
  // Una tarjeta por medalla; las de constancia, una por código (la más nueva
  // y cuántas veces se ganó). Nueva si esta cuenta no vio alguna del grupo
  // (practiceMedalsSeen con el id de la tarjeta marca el grupo entero)
  const groups = new Map<string, MedalRow[]>();
  for (const m of medals) groups.set(medalGroupKey(m), [...(groups.get(medalGroupKey(m)) ?? []), m]);
  const earned = [...groups.values()].map((g) => medalItem(w, g[0], g.length, g.some((m) => !seen.has(m.id))));
  const autoMedals = plan?.auto_medals ?? false;
  const next = plan && autoMedals
    ? constancyNext({
      logs: asDays(liveLogs(w, pid)), days_per_week: plan.days_per_week,
      // Todas, también las anuladas (como el servidor)
      awarded: w.practice_medals.filter((m) => m.patient_id === pid && m.kind === "constancia")
        .map((m) => ({ code: m.code, period_key: m.period_key })),
      today, auto_medals: true, on_break_until: plan.on_break_until,
    })
    : [];
  return ok({
    child: gate.who, author_label: plan?.author_label ?? null, auto_medals: autoMedals, earned, next,
    goals: familyGoals(w, pid, true),
    // La pausa de vacaciones vigente (como en la página de ejercicios): la
    // página la muestra en lugar de "Para seguir sumando"
    on_break_until: breakUntil(plan, today),
  });
}

/**
 * La celebración o las medallas ya se vieron (por cuenta). Cada id marca su
 * grupo entero (las copias más viejas de una que se repite: si no, volverían
 * a celebrarse). Solo cuentan las medallas de personas que esta cuenta ve.
 */
export async function practiceMedalsSeen(ids: string[]): Promise<ApiResult<{ ok: true }>> {
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  await wait(200);
  const first = load();
  const acc = requireAccount(first);
  if (!acc) return fail(401, SESSION_EXPIRED);
  if (!seenIds(ids)) return fail(400, "Pedido inválido");
  const allowed = await practiceAllowed(first, acc);
  const w = load();
  const seen = seenTargets(w, acc.id, "ver_medalla");
  const now = new Date().toISOString();
  for (const id of new Set(ids)) {
    const m = w.practice_medals.find((x) => x.id === id && !x.voided_at);
    if (!m || !allowed.has(m.patient_id)) continue;
    for (const x of liveMedals(w, m.patient_id)) {
      if (medalGroupKey(x) !== medalGroupKey(m) || seen.has(x.id)) continue;
      logAccess(w, x.patient_id, acc.id, "ver_medalla", x.id, now);
      seen.add(x.id);
    }
  }
  save(w);
  return ok({ ok: true as const });
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
  // Orden judicial: no se invita (como access.ts en el servidor)
  if (input.children.some((c) => isBlocked(db, dni, c.id, c.guardian_id))) {
    return fail(409, "Ese adulto tiene un bloqueo por orden judicial para alguno de los chicos elegidos: no se lo puede invitar.");
  }
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

  // Copia del nombre de cada chico y de lo que hace falta para la vigencia
  // del vínculo (ver nota al principio del archivo y patientCard)
  for (const c of pending) {
    const copy = { first_name: c.first_name, last_name: c.last_name, ...cardCopy(await panelPatient(c.id)) };
    const existing = db.children.find((x) => x.id === c.id);
    if (existing) Object.assign(existing, copy);
    else db.children.push({ id: c.id, source: "agenda", ...copy });
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
  const copy = { first_name: input.patient.first_name, last_name: input.patient.last_name, ...cardCopy(await panelPatient(input.patient.id)) };
  copy.dni ??= dni;
  const existing = db.children.find((x) => x.id === input.patient.id);
  if (existing) Object.assign(existing, copy);
  else db.children.push({ id: input.patient.id, source: "agenda", ...copy });
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

export async function staffAccessStatus(rawDni: string | null, patientId: string, self = false, guardianId: string | null = null): Promise<AccessStatus> {
  const dni = normalizeDni(rawDni ?? "");
  if (!isValidDni(dni)) return { state: "sin_dni" };
  const db = load();
  if (isBlocked(db, dni, patientId, guardianId)) return { state: "bloqueo_judicial" };
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
// Pedidos de copia de la historia clínica, pedidos de turno y avisos de "no
// vamos a poder ir". En producción: POST /api/portal-staff/inbox
// (server/lib/requests.ts y server/lib/apptRequests.ts).

const NOTICE_DAYS = 90; // avisos que se miran hacia atrás
const RESOLVED_DAYS = 14; // los resueltos se siguen mostrando un tiempo
const HC_CLOSED_DAYS = 30; // pedidos cerrados que se siguen mostrando
const APPT_REQ_CLOSED_DAYS = 30; // pedidos de turno cerrados que se siguen mostrando
const APPT_REQ_UPCOMING_MAX = 10; // próximos turnos que se ofrecen para enlazar

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

// Copia digital: para un pedido abierto, ¿la cuenta que lo hizo puede
// recibirla hoy por el portal? (cuenta activa y regla "hc", que incluye la
// pausa del portal del paciente). null si el pedido está cerrado, la etapa
// E1 está apagada o la cuenta ya no existe (como requesterStatus en el servidor)
async function requesterGate(db: Db, r: HcRequest): Promise<{ ok: true } | { ok: false; block: ClinicalBlock } | null> {
  if (!hcDigitalOn() || !HC_OPEN_STATUSES.includes(r.status)) return null;
  const acc = r.account_id ? db.accounts.find((a) => a.id === r.account_id) : undefined;
  if (!acc) return null;
  return hcGate(db, acc, r.patient_id); // una cuenta pausada da "sin_vinculo"
}

async function digitalOk(db: Db, r: HcRequest): Promise<boolean | null> {
  const gate = await requesterGate(db, r);
  return gate ? gate.ok : null;
}

// Lo que ve el equipo si el portal del paciente está en pausa
const HC_PAUSED_STAFF = "El portal de este paciente está en pausa: entregala en mano.";

// Para subir y enviar: null si la cuenta que hizo el pedido puede recibirlo
// hoy por el portal; si no, 409 code DIGITAL_BLOCKED con el motivo para el
// equipo. La pausa del paciente va primero, antes de mirar la cuenta, y
// tiene su propio mensaje: con el portal en pausa la copia se entrega en
// mano, la haya pedido quien la haya pedido (como requesterDigitalBlock en
// el servidor)
async function digitalBlockedProblem(db: Db, r: HcRequest): Promise<ApiResult<never> | null> {
  if (settingsOf(db, r.patient_id)?.paused_at) return fail(409, HC_PAUSED_STAFF, { code: "DIGITAL_BLOCKED" });
  const gate = await requesterGate(db, r);
  if (gate?.ok) return null;
  return fail(409, HC_DIGITAL_BLOCKED_STAFF, { code: "DIGITAL_BLOCKED" });
}

// Los PDF de un pedido que no se quitaron (enviados o por enviar), del
// primero que se subió al último. Con la etapa apagada, ninguno
async function staffDocs(db: Db, requestId: string): Promise<StaffHcDocument[]> {
  if (!hcDigitalOn()) return [];
  const docs = db.hc_documents.filter((d) => d.request_id === requestId && !d.removed_at).sort(byUpload);
  const out: StaffHcDocument[] = [];
  for (const d of docs) {
    out.push({
      id: d.id, file_name: d.file_name, size_bytes: d.size_bytes,
      sha256: d.sha256 || (d.demo_pdf ? await demoPdfSha() : ""),
      code: verificationCode(d.id), uploaded_by_email: d.uploaded_by_email, uploaded_at: d.uploaded_at,
    });
  }
  return out;
}

// Edad de cada paciente hoy (de 13 a 17 se suma una casilla al enviar la copia)
async function patientAges(db: Db, patientIds: string[]): Promise<Map<string, number | null>> {
  const today = centerNow().date;
  const out = new Map<string, number | null>();
  for (const id of new Set(patientIds)) {
    const card = await patientCard(db, id);
    out.set(id, card?.birth_date ? ageOn(card.birth_date, today) : null);
  }
  return out;
}

async function toStaffHc(db: Db, rows: HcRequest[]): Promise<StaffHcRequest[]> {
  if (!rows.length) return [];
  const info = await patientInfo(db, rows.map((r) => r.patient_id));
  const ages = await patientAges(db, rows.map((r) => r.patient_id));
  const out: StaffHcRequest[] = [];
  for (const r of rows) {
    const { account_id: _a, updated_at: _u, sent_acks: _s, events, ...rest } = r;
    const p = info.get(r.patient_id);
    out.push({
      ...rest,
      patient_name: p?.name ?? "Paciente",
      patient_dni: p?.dni ?? null,
      still_allowed: stillAllowed(db, r),
      events: [...(events ?? [])].sort((x, y) => x.at.localeCompare(y.at)), // del más viejo al más nuevo
      documents: await staffDocs(db, r.id),
      digital_ok: await digitalOk(db, r),
      patient_age: ages.get(r.patient_id) ?? null,
    });
  }
  return out;
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

// Todos los turnos que conoce el portal: los de la demo y los de la agenda del
// mock (de los chicos invitados desde el panel y los que se dieron desde la
// bandeja, ver apptsFor)
async function allAppts(db: Db): Promise<Map<string, Appt>> {
  return new Map([...db.appts, ...(await agendaAppts(db.children.map((c) => c.id)))].map((a) => [a.id, a]));
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

// ── Pedidos de turno (equipo) ──

const phoneDigits = (phone: unknown) => String(phone ?? "").replace(/\D/g, "");

// Filas de adultos responsables de la ficha de cada paciente invitado desde el
// panel (también las inactivas: un adulto bloqueado puede haber quedado
// inactivo). Los chicos de la demo no tienen ficha en el panel.
async function fichaGuardians(db: Db, patientIds: string[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  for (const id of new Set(patientIds)) {
    if (db.children.find((x) => x.id === id)?.source !== "agenda") { out.set(id, []); continue; }
    const { data } = await mockSupabase.from("patient_guardians").select("*").eq("patient_id", id);
    out.set(id, (data ?? []) as Row[]);
  }
  return out;
}

// Un adulto de la ficha está bloqueado para ese paciente por su fila o por su
// DNI (como guardianBlocked en el servidor)
function guardianRowBlocked(db: Db, g: Row): boolean {
  const dni = normalizeDni(String(g.dni ?? ""));
  return db.blocks.some((b) => b.patient_id === String(g.patient_id) && !b.lifted_at
    && (b.guardian_id === String(g.id) || (!!dni && b.dni === dni)));
}

// Teléfonos de la ficha de cada paciente: el suyo, el del tutor (campo viejo)
// y los de sus adultos responsables activos (el contacto principal primero),
// sin repetidos (comparando solo los números) ni vacíos, como phonesOf en el
// servidor. Nunca el de un adulto con un bloqueo vigente para ese paciente,
// aunque el mismo número esté cargado en otro campo de la ficha. Los chicos
// de la demo no tienen ficha en el panel: van los teléfonos inventados de la demo.
async function contactPhones(db: Db, patientIds: string[], guardians: Map<string, Row[]>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of new Set(patientIds)) {
    const c = db.children.find((x) => x.id === id);
    if (c?.source !== "agenda") { out.set(id, c?.phones ?? []); continue; }
    const p = await panelPatient(id);
    const mine = guardians.get(id) ?? [];
    const blocked = mine.filter((g) => guardianRowBlocked(db, g));
    const active = mine
      .filter((g) => g.active !== false && !blocked.includes(g))
      .sort((x, y) => Number(y.is_primary === true) - Number(x.is_primary === true))
      .map((g) => g.phone);
    const seen = new Set<string>(blocked.map((g) => phoneDigits(g.phone)).filter(Boolean));
    const phones: string[] = [];
    for (const raw of [p?.phone, p?.guardian_phone, ...active]) {
      const phone = String(raw ?? "").trim();
      const key = phoneDigits(phone);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      phones.push(phone);
    }
    out.set(id, phones);
  }
  return out;
}

// ¿Quien hizo el pedido tiene hoy un bloqueo por orden judicial para esa
// persona? Como en el servidor (blockedRequesters): por el DNI de su cuenta,
// por la fila de la ficha con que se vinculó o si la fila bloqueada tiene hoy
// el DNI de la cuenta. El mock quita el vínculo al bloquear (la base lo deja
// revocado), así que la fila del vínculo solo cuenta mientras siga.
function apptRequesterBlocked(db: Db, r: ApptRequest, guardians: Row[]): boolean {
  const blocks = db.blocks.filter((b) => b.patient_id === r.patient_id && !b.lifted_at);
  if (!blocks.length || !r.account_id) return false;
  const dni = db.accounts.find((a) => a.id === r.account_id)?.dni ?? "";
  const linkRows = db.links
    .filter((l) => l.account_id === r.account_id && l.child_id === r.patient_id && !!l.guardian_id)
    .map((l) => l.guardian_id!);
  return blocks.some((b) => {
    if (dni && b.dni === dni) return true;
    if (!b.guardian_id) return false;
    if (linkRows.includes(b.guardian_id)) return true;
    const g = guardians.find((x) => String(x.id) === b.guardian_id);
    return !!dni && !!g && normalizeDni(String(g.dni ?? "")) === dni;
  });
}

// Para un pedido abierto: ¿quien lo hizo sigue viendo los turnos de esa
// persona? null si el pedido está cerrado; false si la cuenta ya no existe,
// está pausada o ya no tiene el vínculo (en el mock todo vínculo da acceso).
function apptStillAllowed(db: Db, r: ApptRequest): boolean | null {
  if (!apptReqOpen(r.status)) return null;
  const acc = r.account_id ? db.accounts.find((a) => a.id === r.account_id) : undefined;
  if (!acc) return false;
  return acc.active && childIdsOf(db, acc.id).includes(r.patient_id);
}

const toSlot = (a: Appt): StaffApptSlot => ({ id: a.id, date: a.date, time: a.time, professional_name: a.professional_name });

// Próximos turnos agendados (de hoy en adelante) de un paciente, en orden
function upcomingOf(appts: Appt[], patientId: string, today: string): Appt[] {
  return appts
    .filter((a) => a.child_id === patientId && a.status === "agendado" && a.date >= today)
    .sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
}

async function toStaffAppt(db: Db, rows: ApptRequest[]): Promise<StaffApptRequest[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.patient_id))];
  const info = await patientInfo(db, ids);
  const guardians = await fichaGuardians(db, ids);
  const phones = await contactPhones(db, ids, guardians);
  const appts = await apptsFor(db, ids);
  const today = centerNow().date;
  return rows.map((r) => {
    const { account_id: _a, appointment_id, updated_at: _u, events, ...rest } = r;
    // El turno enlazado, mientras exista y siga agendado
    const linked = appointment_id
      ? appts.find((a) => a.id === appointment_id && a.child_id === r.patient_id && a.status === "agendado")
      : undefined;
    return {
      ...rest,
      patient_name: info.get(r.patient_id)?.name ?? "Paciente",
      contact_phones: phones.get(r.patient_id) ?? [],
      still_allowed: apptStillAllowed(db, r),
      requester_blocked: apptRequesterBlocked(db, r, guardians.get(r.patient_id) ?? []),
      appointment: linked ? toSlot(linked) : null,
      // Tenía un turno enlazado que ya no está agendado (la familia ve «Turno cancelado»)
      appointment_cancelled: r.status === "agendado" && !!appointment_id && !linked,
      // Para enlazar el turno que se dio: solo en pedidos abiertos
      upcoming: apptReqOpen(r.status) ? upcomingOf(appts, r.patient_id, today).slice(0, APPT_REQ_UPCOMING_MAX).map(toSlot) : [],
      events: [...(events ?? [])].sort((x, y) => x.at.localeCompare(y.at)), // del más viejo al más nuevo
    };
  });
}

// Abiertos (los más nuevos primero) y después los cerrados de los últimos 30
// días (los que se cerraron más recientemente primero), como el servidor
async function staffApptList(db: Db): Promise<StaffApptRequest[]> {
  const since = Date.now() - APPT_REQ_CLOSED_DAYS * DAY_MS;
  const open = db.appt_requests.filter((r) => apptReqOpen(r.status)).sort((x, y) => y.created_at.localeCompare(x.created_at));
  const closed = db.appt_requests
    .filter((r) => !apptReqOpen(r.status) && Date.parse(r.updated_at) >= since)
    .sort((x, y) => y.updated_at.localeCompare(x.updated_at))
    .slice(0, 100);
  return toStaffAppt(db, [...open, ...closed]);
}

// practice (etapa B): chip "Prácticas", solo para perfiles clínicos (para
// Administración, { allowed: false, items: [] }); sin la etapa, no viene
export async function staffInbox(): Promise<ApiResult<StaffInbox>> {
  await wait(350);
  const db = load();
  // Un profesional ve solo lo de sus pacientes (como lib/staffScope.ts del servidor)
  const mine = <T extends { patient_id: string }>(rows: T[]) => rows.filter((r) => mockIsMyPatient(r.patient_id));
  const hc = mine(await staffHcList(db));
  const notices = mine(await staffNotices(db));
  const turnos = mine(await staffApptList(db));
  if (!FEATURES.includes("practice")) return ok({ hc, notices, turnos });
  const staff = await currentStaff("");
  const clinical = staff.ok && staff.clinical;
  return ok({
    hc, notices, turnos,
    practice: { allowed: clinical, items: clinical ? mine(await practiceInboxItems(load(), staff)) : [] },
  });
}

// practice_pending: filas de "Prácticas" de MIS pacientes; practice_risk:
// pacientes que NO son míos con comentarios de riesgo sin ver (así el número
// de la pestaña suma los dos sin contar dos veces a nadie); practice_urgent:
// pacientes con comentarios de riesgo sin ver, míos o no (con alguno, la
// pestaña se marca como urgente). Uno por paciente, como el servidor. Solo
// perfiles clínicos y con la etapa prendida
export async function staffInboxCount(): Promise<StaffInboxCount> {
  await wait(150);
  const db = load();
  const counts: StaffInboxCount = {
    hc_pending: db.hc_requests.filter((r) => r.status === "pendiente" && mockIsMyPatient(r.patient_id)).length,
    notices_pending: (await staffNotices(db)).filter((n) => n.resolution === null && mockIsMyPatient(n.patient_id)).length,
    turnos_pending: db.appt_requests.filter((r) => r.status === "pendiente" && mockIsMyPatient(r.patient_id)).length,
  };
  if (!FEATURES.includes("practice")) return counts;
  const staff = await currentStaff("");
  if (!staff.ok || !staff.clinical) return counts;
  const items = (await practiceInboxItems(load(), staff)).filter((i) => mockIsMyPatient(i.patient_id));
  const risky = items.filter((i) => i.kind === "practicas" && i.pending.risk > 0);
  const patients = (rows: StaffPracticeInboxItem[]) => new Set(rows.map((i) => i.patient_id)).size;
  return {
    ...counts,
    practice_pending: items.filter((i) => i.mine).length,
    practice_risk: patients(risky.filter((i) => !i.mine)),
    practice_urgent: patients(risky),
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
  // Entregada en mano o rechazada: los PDF que no se enviaron se quitan
  if (to === "entregada" || to === "rechazada") dropUnsentDocs(db, row.id, issuedBy, now);
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

// ── Copia digital de la historia clínica (equipo, etapa E1) ──
// El equipo imprime la historia de la ficha a PDF, la Dirección firma cada
// PDF digitalmente (fuera del sistema) y un profesional o la Dirección los
// sube al pedido, los revisa y la envía. Los PDF no se sellan (se rompería la
// firma). Subir, abrir, quitar y enviar: solo profesionales y Dirección
// (Administración ve los estados). Mismas reglas y mensajes que
// server/lib/hcDocuments.ts (POST /api/portal-staff/inbox: hc_doc_upload_url +
// hc_doc_register, hc_doc_remove, hc_doc_open y hc_send).

const HC_CHANGED = "Este pedido ya cambió de estado. Actualizá la bandeja.";
const DOC_GONE = "Ese PDF ya no está. Actualizá la bandeja.";
const NO_DOCS = "Subí al menos un PDF antes de enviarla.";
const DOCS_CHANGED = "La lista de PDF cambió mientras revisabas. Actualizá y revisala de nuevo.";

// Quién del equipo lo hace: con la etapa prendida, Dirección o profesional
async function hcDocStaff(issuedBy: string): Promise<({ ok: true } & Staff) | { ok: false; status: number; error: string }> {
  const staff = await currentStaff(issuedBy);
  if (!staff.ok) return staff;
  if (!hcDigitalOn()) return { ok: false, status: 404, error: NOT_AVAILABLE };
  if (!staff.clinical) return { ok: false, status: 403, error: NOT_CLINICAL };
  return staff;
}

const liveDocs = (db: Db, requestId: string) => db.hc_documents.filter((d) => d.request_id === requestId && !d.removed_at);

// Solo se suben y se envían PDF a un pedido abierto que pidió recibirla en el portal
function openPortalProblem(r: HcRequest): ApiResult<never> | null {
  if (r.channel !== "portal") return fail(409, "Este pedido es para entregar en mano.");
  if (!HC_OPEN_STATUSES.includes(r.status)) return fail(409, HC_CHANGED);
  return null;
}

// Lugar para otro PDF (hasta HC_DOC_MAX_FILES por pedido)
function roomProblem(db: Db, requestId: string): ApiResult<never> | null {
  if (liveDocs(db, requestId).length < HC_DOC_MAX_FILES) return null;
  return fail(409, `Un pedido puede tener hasta ${HC_DOC_MAX_FILES} PDF. Quitá alguno para subir otro.`);
}

// Sube un PDF a un pedido abierto que se pidió "en el portal", si la cuenta
// que lo pidió puede recibirla. Como el servidor: archivo .pdf de hasta 10 MB
// que empiece con "%PDF-" y sin contraseña ni permisos (/Encrypt); se guarda
// su huella. En el mock no hay enlace de subida: es un solo paso
export async function staffHcDocUpload(requestId: string, file: File, issuedBy: string): Promise<ApiResult<StaffHcRequest>> {
  await wait(500);
  const staff = await hcDocStaff(issuedBy);
  if (!staff.ok) return staff;
  if (!validId(requestId) || !(file instanceof Blob)) return fail(400, "Pedido inválido");
  const name = cleanDocName(file.name);
  const early = docUploadProblem(name, file.size);
  if (early) return fail(400, early);
  const first = load();
  const current = first.hc_requests.find((r) => r.id === requestId);
  if (!current) return fail(404, HC_NOT_FOUND);
  const notOpen = openPortalProblem(current);
  if (notOpen) return notOpen;
  const blocked = await digitalBlockedProblem(first, current);
  if (blocked) return blocked;
  const full = roomProblem(first, requestId);
  if (full) return full;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const problem = pdfProblem(bytes);
  if (problem) return fail(400, PDF_PROBLEM_TEXT[problem], { code: "PDF" });
  const hash = await sha256Hex(bytes);

  // De acá en adelante, sin esperas y con la base recién leída: si otra
  // pestaña cambió el pedido mientras tanto, se ve acá
  const db = load();
  const row = db.hc_requests.find((r) => r.id === requestId);
  if (!row) return fail(404, HC_NOT_FOUND);
  const again = openPortalProblem(row) ?? roomProblem(db, requestId);
  if (again) return again;
  if (hash && liveDocs(db, requestId).some((d) => d.sha256 === hash)) return fail(409, "Ese PDF ya está subido en este pedido.");
  const id = uuid(); // el código de verificación sale del id
  const now = new Date().toISOString();
  db.hc_documents.push({
    id, request_id: requestId, patient_id: row.patient_id, file_name: name || "historia-clinica.pdf",
    size_bytes: bytes.length, sha256: hash, uploaded_by_email: staff.email, uploaded_at: now,
    published_at: null, removed_at: null, removed_by_email: null,
  });
  logHcEvent(row, "documento", staff.email, now);
  save(db);
  await keepDocFile(id, file);

  // Como el servidor, se vuelve a mirar el pedido ya registrado el PDF: si
  // mientras tanto se cerró (entregada en mano, rechazada, cancelada) o dejó
  // de ser "en el portal", el PDF se quita y no queda colgado
  const after = load();
  const fresh = after.hc_requests.find((r) => r.id === requestId);
  if (!fresh || fresh.channel !== "portal" || !HC_OPEN_STATUSES.includes(fresh.status)) {
    const doc = after.hc_documents.find((d) => d.id === id);
    if (doc && !doc.removed_at) {
      doc.removed_at = new Date().toISOString();
      doc.removed_by_email = staff.email;
    }
    dropDocFile(id);
    save(after);
    return fail(409, "El pedido cambió mientras subías el archivo. Actualizá la bandeja.");
  }
  return ok((await toStaffHc(after, [fresh]))[0]);
}

// Quita un PDF que todavía no se envió (la fila queda como constancia; el
// archivo se borra)
export async function staffHcDocRemove(documentId: string, issuedBy: string): Promise<ApiResult<StaffHcRequest>> {
  await wait(350);
  const staff = await hcDocStaff(issuedBy);
  if (!staff.ok) return staff;
  const db = load();
  const doc = validId(documentId) ? db.hc_documents.find((d) => d.id === documentId) : undefined;
  const row = doc ? db.hc_requests.find((r) => r.id === doc.request_id) : undefined;
  if (!doc || !row || doc.removed_at) return fail(404, DOC_GONE);
  if (doc.published_at) return fail(409, "Ese PDF ya se envió a la familia: no se puede quitar.");
  const now = new Date().toISOString();
  doc.removed_at = now;
  doc.removed_by_email = staff.email;
  dropDocFile(doc.id);
  logHcEvent(row, "documento_quitado", staff.email, now);
  save(db);
  return ok((await toStaffHc(db, [row]))[0]);
}

// Abre un PDF para revisarlo (enviado o por enviar): enlace de 60 segundos.
// Queda registrado con el email de quien lo abrió ("equipo_abrir_documento")
export async function staffHcDocOpen(documentId: string, issuedBy: string): Promise<ApiResult<{ url: string }>> {
  await wait(300);
  const staff = await hcDocStaff(issuedBy);
  if (!staff.ok) return staff;
  const doc = validId(documentId) ? load().hc_documents.find((d) => d.id === documentId) : undefined;
  if (!doc || doc.removed_at) return fail(404, DOC_GONE);
  const blob = await docBlob(doc);
  if (!blob) return fail(410, DOC_LOST);
  const w = load();
  w.access_log.push({
    id: uid("log"), patient_id: doc.patient_id, account_id: null, staff_email: staff.email,
    action: "equipo_abrir_documento", target_id: doc.id, at: new Date().toISOString(),
  });
  save(w);
  return ok({ url: tempUrl(blob) });
}

// Los PDF del pedido son exactamente los que revisó quien envía (ni uno más
// ni uno menos)
const sameDocs = (docs: HcDocument[], ids: Set<string>) => docs.length === ids.size && docs.every((d) => ids.has(d.id));

// Envía la copia por el portal: pedido abierto que se pidió "en el portal",
// con las confirmaciones del profesional (completa y de este paciente, sin
// datos de otras personas, firmada por la Dirección y, de 13 a 17 años, sin
// lo que contó en confianza), al menos un PDF y la cuenta que lo pidió
// todavía puede recibirla. documentIds: los PDF que quien envía tenía en
// pantalla y revisó; si la lista de ahora es otra (alguien subió o quitó
// uno), 409 y no se envía nada. Se publican solo esos: la familia los
// descarga durante 60 días. Mismo orden que el servidor.
export async function staffHcSend(
  requestId: string, acks: HcSendAcks, documentIds: string[], issuedBy: string,
): Promise<ApiResult<StaffHcRequest>> {
  await wait(500);
  const staff = await hcDocStaff(issuedBy);
  if (!staff.ok) return staff;
  // Como el servidor, se revisa cada valor (no se confía en el tipo)
  if (!validId(requestId) || !Array.isArray(documentIds) || !documentIds.every(validId)) return fail(400, "Pedido inválido");
  const reviewed = new Set(documentIds);
  const first = load();
  const current = first.hc_requests.find((r) => r.id === requestId);
  if (!current) return fail(404, HC_NOT_FOUND);
  const notOpen = openPortalProblem(current);
  if (notOpen) return notOpen;
  // Con el portal del paciente en pausa (o si la cuenta ya no puede
  // recibirla) no se envía, aunque estén los PDF y las confirmaciones
  const blocked = await digitalBlockedProblem(first, current);
  if (blocked) return blocked;
  const card = await patientCard(first, current.patient_id);
  const age = card?.birth_date ? ageOn(card.birth_date, centerNow().date) : null;
  const missing = hcSendAcksProblem(acks, age);
  if (missing) return fail(400, missing, { code: "ACKS" });
  const live = liveDocs(first, requestId);
  if (!live.length) return fail(409, NO_DOCS);
  if (!sameDocs(live, reviewed)) return fail(409, DOCS_CHANGED);

  // De acá en adelante, sin esperas y con la base recién leída
  const db = load();
  const row = db.hc_requests.find((r) => r.id === requestId);
  if (!row || row.status !== current.status || row.channel !== "portal") {
    return fail(409, "Otra persona del equipo cambió este pedido. Actualizá la bandeja.");
  }
  const docs = liveDocs(db, requestId);
  if (!docs.length) return fail(409, NO_DOCS);
  if (!sameDocs(docs, reviewed)) return fail(409, DOCS_CHANGED);
  const now = new Date().toISOString();
  for (const d of docs) if (reviewed.has(d.id)) d.published_at = now;
  row.status = "enviada";
  row.sent_at = now;
  row.sent_by_email = staff.email;
  row.sent_acks = cleanAcks(acks, age);
  row.updated_at = now;
  logHcEvent(row, "enviada", staff.email, now);
  save(db);
  return ok((await toStaffHc(db, [row]))[0]);
}

const APPT_REQ_TARGETS: readonly ApptReqStaffTarget[] = ["agendado", "contactar", "rechazado", "pendiente"];

// Pedido de turno: agendado (con el turno que se dio, si se eligió uno de sus
// próximos turnos), "la vamos a llamar", no se dio turno (con motivo) o volver
// a pendiente (si se marcó por error: queda como recién llegado; lo que se
// había hecho queda en las constancias)
export async function staffApptUpdate(input: {
  id: string; to: ApptReqStaffTarget; appointment_id?: string | null; reject_reason?: ApptReqRejectReason;
}, issuedBy: string): Promise<ApiResult<StaffApptRequest>> {
  await wait(400);
  if (!validId(input.id)) return fail(400, "Pedido inválido");
  const to = String(input.to) as ApptReqStaffTarget;
  if (!APPT_REQ_TARGETS.includes(to)) return fail(400, "Pedido inválido");
  const first = load().appt_requests.find((r) => r.id === input.id);
  if (!first) return fail(404, APPT_REQ_NOT_FOUND);

  // El turno que se dio (opcional): de esta persona, sin cancelar y de hoy en
  // adelante. Los de la agenda del mock se leen antes de tocar el pedido
  let appointmentId: string | null = null;
  if (to === "agendado" && input.appointment_id != null && input.appointment_id !== "") {
    const upcoming = validId(input.appointment_id)
      ? upcomingOf(await apptsFor(load(), [first.patient_id]), first.patient_id, centerNow().date)
      : [];
    if (!upcoming.some((a) => a.id === input.appointment_id)) {
      return fail(400, "Ese turno no es de esta persona, está cancelado o ya pasó. Elegí otro de la lista.");
    }
    appointmentId = input.appointment_id;
  }
  let reason: ApptReqRejectReason | null = null;
  if (to === "rechazado") {
    // Solo los que elige el equipo: "bloqueo" lo pone el bloqueo por orden judicial
    reason = APPT_REQ_REJECT_REASONS.find((x) => x === input.reject_reason) ?? null;
    if (!reason) return fail(400, "Elegí el motivo.");
  }
  // Para ver si quien lo pidió tiene un bloqueo (al dejarlo abierto): la ficha
  // del panel se lee antes de tocar el pedido
  const guardians = apptReqOpen(to)
    ? (await fichaGuardians(load(), [first.patient_id])).get(first.patient_id) ?? []
    : [];

  // De acá en adelante, sin esperas y con la base recién leída: si otra
  // pestaña lo cambió mientras tanto, se ve en el estado
  const db = load();
  const row = db.appt_requests.find((r) => r.id === input.id);
  if (!row) return fail(404, APPT_REQ_NOT_FOUND);
  // Ya quedó agendado con este mismo turno (se guardó pero no llegó la
  // respuesta y el panel lo vuelve a enlazar): no es un cambio, como en el servidor
  if (to === "agendado" && row.status === "agendado" && !!input.appointment_id && row.appointment_id === input.appointment_id) {
    return ok((await toStaffAppt(db, [row]))[0]);
  }
  if (!APPT_REQ_TRANSITIONS[row.status].includes(to)) return fail(409, "Este pedido cambió mientras tanto. Actualizá la bandeja.");
  // Si quien lo pidió tiene un bloqueo por orden judicial, el pedido solo se
  // puede cerrar (agendar o «No se puede», sin avisarle): no se reabre ni se
  // marca para llamarlo, como en el servidor
  if (apptReqOpen(to) && apptRequesterBlocked(db, row, guardians)) {
    return fail(409, apptReqOpen(row.status)
      ? "Quien lo pidió tiene un bloqueo por orden judicial: no lo contactes. Resolvé el pedido sin avisarle."
      : "Quien lo pidió tiene un bloqueo por orden judicial: este pedido no se puede reabrir.");
  }
  // Volver a abrir uno cerrado cuando la familia ya hizo otro pedido (índice
  // único de la base: uno abierto por persona)
  if (!apptReqOpen(row.status) && apptRequestOpenFor(db, row.patient_id)) {
    return fail(409, "Esta persona ya tiene otro pedido de turno abierto. Resolvé ese.");
  }
  const now = new Date().toISOString();
  let patch: Partial<ApptRequest>;
  if (to === "agendado") {
    patch = { appointment_id: appointmentId, scheduled_at: now, scheduled_by_email: issuedBy };
  } else if (to === "contactar") {
    patch = { contacted_at: now, contacted_by_email: issuedBy };
  } else if (to === "rechazado") {
    patch = { rejected_at: now, rejected_by_email: issuedBy, reject_reason: reason };
  } else {
    patch = {
      appointment_id: null, reject_reason: null,
      scheduled_at: null, scheduled_by_email: null, contacted_at: null, contacted_by_email: null,
      rejected_at: null, rejected_by_email: null,
    };
  }
  Object.assign(row, patch, { status: to, updated_at: now });
  logApptEvent(row, to, issuedBy, now);
  save(db);
  return ok((await toStaffAppt(db, [row]))[0]);
}

// Las notas no cambian updated_at, pero dejan constancia de quién las editó
export async function staffApptNotes(id: string, notes: string, issuedBy?: string): Promise<ApiResult<{ ok: true }>> {
  await wait(300);
  if (!validId(id)) return fail(400, "Pedido inválido");
  const value = String(notes ?? "").trim();
  if (value.length > 500) return fail(400, "Las notas pueden tener hasta 500 caracteres.");
  const by = issuedBy || (await mockSupabase.auth.getSession()).data.session?.user?.email || "demo@cimt.local";
  const db = load();
  const row = db.appt_requests.find((r) => r.id === id);
  if (!row) return fail(404, APPT_REQ_NOT_FOUND);
  row.staff_notes = value || null;
  logApptEvent(row, "nota", by);
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

// ── Portal del paciente en la ficha (equipo) ────────────────────────────────
// "Quién lo ve" y la configuración de la información de salud de un
// paciente. Ninguna acción toca datos clínicos. En producción:
// POST /api/portal-staff/clinical (server/api/portal-staff/clinical.ts y
// staffClinical en server/lib/portalClinical.ts).

const SAVE_FAILED = "No se pudo guardar. Probá de nuevo.";
const NOT_CLINICAL = "Solo los profesionales y la Dirección pueden hacer esto.";
const isDateKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

const EMPTY_SETTINGS: Omit<Settings, "patient_id"> = {
  info_enabled: false, practice_enabled: false, paused_at: null, pause_reason: null,
  adolescent_agreed_on: null, adolescent_agreed_by_email: null, adolescent_withdrawn_on: null,
  updated_by_email: null, updated_at: null,
};

/** Etapas prendidas (las puede consultar cualquier rol). */
export async function staffClinicalFeatures(): Promise<ClinicalFeature[]> {
  await wait(100);
  return shownFeatures();
}

// Quién del equipo hace el pedido (sesión del mock del panel) y si puede
// cambiar la configuración: Dirección o profesional. professional_id: el
// profesional vinculado a su usuario (en la demo, los usuarios pro…@)
type Staff = { email: string; role: string; clinical: boolean; professional_id: string | null };
async function currentStaff(issuedBy: string): Promise<
  ({ ok: true } & Staff) | { ok: false; status: number; error: string }
> {
  const { data: { session } } = await mockSupabase.auth.getSession();
  if (!session) return { ok: false, status: 401, error: "No autenticado" };
  const { data } = await mockSupabase.rpc("current_staff");
  const row = data as { role?: unknown; email?: unknown; professional_id?: unknown } | null;
  if (!row) return { ok: false, status: 403, error: "Solo el equipo del CIMT puede hacer esto" };
  const role = String(row.role ?? "");
  return {
    ok: true, email: issuedBy || text(row.email) || session.user.email, role,
    clinical: role === "direccion" || role === "profesional", professional_id: text(row.professional_id),
  };
}

// Lo que ve el equipo en la ficha
async function staffClinical(db: Db, patientId: string, canEdit: boolean): Promise<ApiResult<StaffClinicalDTO>> {
  const card = await patientCard(db, patientId);
  if (!card) return fail(404, "No encontramos ese paciente.");

  // La copia del portal se pone al día con la ficha del panel (ver patientCard)
  const child = db.children.find((c) => c.id === patientId && c.source === "agenda");
  if (child) {
    const p = await panelPatient(patientId);
    if (p && text(p.birth_date)) { Object.assign(child, cardCopy(p)); save(db); }
  }

  const { data: gData } = await mockSupabase.from("patient_guardians").select("*").eq("patient_id", patientId);
  const { data: fData } = await mockSupabase.from("patient_files").select("*")
    .eq("patient_id", patientId).eq("category", "consentimiento").order("created_at", { ascending: false });
  const guardianRows = ((gData ?? []) as Row[]).map(toGuardian);
  const blocks = db.blocks.filter((b) => b.patient_id === patientId && !b.lifted_at);
  const today = centerNow().date;
  const age = card.birth_date ? ageOn(card.birth_date, today) : null;
  const s = settingsOf(db, patientId);

  const accesses: StaffAccessRow[] = [];
  for (const l of db.links.filter((x) => x.child_id === patientId)) {
    const acc = db.accounts.find((a) => a.id === l.account_id);
    if (!acc) continue;
    const v = await linkCheck(db, l, acc, today);
    const c = latestConsent(db, acc.id);
    const input = {
      link_kind: l.relationship_kind, link_valid: v.valid && acc.active, hc_ok: v.hc_ok, age,
      verified_in_person: !!l.verified_in_person_on, parental_checked: !!l.parental_checked_on,
      settings: s, clinical_consent: consentActive(c), blocked: isBlocked(db, acc.dni, patientId, l.guardian_id),
    };
    const info = clinicalAccess(input, "info");
    const practice = clinicalAccess(input, "practice");
    accesses.push({
      link_id: l.id,
      account_id: acc.id,
      name: `${acc.first_name} ${acc.last_name}`.trim(),
      link_kind: l.relationship_kind,
      relationship: v.guardian?.relationship ?? null,
      link_valid: v.valid && acc.active,
      verified_in_person_on: l.verified_in_person_on,
      parental_checked_on: l.parental_checked_on,
      consent: c ? { accepted: c.accepted, version: c.version, channel: c.channel, at: c.created_at } : null,
      info_block: info.ok ? null : info.block,
      practice_block: practice.ok ? null : practice.block,
    });
  }

  const guardians: StaffGuardianRow[] = guardianRows
    .filter((g) => g.active || blocks.some((b) => b.guardian_id === g.id))
    .map((g) => {
      const b = blocks.find((x) => x.guardian_id === g.id || (!!g.dni && x.dni === normalizeDni(g.dni)));
      return {
        guardian_id: g.id, name: g.full_name, relationship: g.relationship, dni: g.dni,
        block: b ? { id: b.id, reason: b.reason, created_at: b.created_at, created_by_email: b.created_by_email } : null,
      };
    });

  return ok({
    features: shownFeatures(),
    can_edit: canEdit,
    patient: { id: card.id, first_name: card.first_name, age, discharged: !!card.discharge_date && card.discharge_date <= today },
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
    guardians,
    paper_files: ((fData ?? []) as Row[])
      .filter((f) => !f.voided_at)
      .map((f) => ({ id: String(f.id), file_name: String(f.file_name ?? ""), created_at: String(f.created_at ?? "") })),
  });
}

// Nota interna de los pedidos de turno que se cierran al bloquear a quien los hizo
const BLOCK_CLOSED_NOTE = "Cerrado por bloqueo judicial";

// Agrega la constancia a las notas sin pasarse de los 500 caracteres (se
// acortan las notas anteriores, no la constancia). Si ya la tiene (un bloqueo
// anterior), quedan como estaban: no se repite. Como withBlockNote en el servidor
function withBlockNote(prev: string | null): string {
  const trimmed = (prev ?? "").trim();
  if (trimmed.split("\n").some((line) => line.trim() === BLOCK_CLOSED_NOTE)) return trimmed;
  const old = [...trimmed];
  if (!old.length) return BLOCK_CLOSED_NOTE;
  const room = 500 - BLOCK_CLOSED_NOTE.length - 1; // el salto de línea
  const kept = old.length > room ? `${old.slice(0, room - 1).join("").trimEnd()}…` : old.join("");
  return `${kept}\n${BLOCK_CLOSED_NOTE}`;
}

// Todas las acciones de la sección. Cada escritura guarda el email de quien
// la hizo; todas devuelven la sección actualizada.
//   get · set, pause, adolescent (profesional o Dirección) ·
//   verify_link, block, unblock, consent_paper (cualquier rol)
export async function staffClinicalAction(body: ClinicalAction, issuedBy: string): Promise<ApiResult<StaffClinicalDTO>> {
  await wait(350);
  const staff = await currentStaff(issuedBy);
  if (!staff.ok) return staff;
  const { email, clinical } = staff;
  // Como el servidor, se revisa cada valor (no se confía en el tipo)
  const b = body as unknown as Record<string, unknown>;
  if (!FEATURES.length) return fail(404, NOT_AVAILABLE);
  const patientId = b.patient_id;
  if (!validId(patientId)) return fail(400, "Pedido inválido");
  const today = centerNow().date;
  const now = new Date().toISOString();
  const db = load();

  // Guarda la configuración del paciente (crea la fila si no existe). Como la
  // clave foránea de la base, el paciente tiene que existir
  async function saveSettings(patch: Partial<Settings>): Promise<boolean> {
    if (!(await patientCard(db, patientId as string))) return false;
    let s = settingsOf(db, patientId as string);
    if (!s) {
      s = { ...EMPTY_SETTINGS, patient_id: patientId as string };
      db.settings.push(s);
    }
    Object.assign(s, patch, { updated_by_email: email, updated_at: now });
    save(db);
    return true;
  }

  switch (b.action) {
    case "get":
      return staffClinical(db, patientId, clinical);

    case "set": {
      if (!clinical) return fail(403, NOT_CLINICAL);
      const patch: Partial<Settings> = {};
      if (typeof b.info_enabled === "boolean") patch.info_enabled = b.info_enabled;
      if (typeof b.practice_enabled === "boolean") patch.practice_enabled = b.practice_enabled;
      if (!Object.keys(patch).length) return fail(400, "Pedido inválido");
      if (!(await saveSettings(patch))) return fail(503, SAVE_FAILED);
      return staffClinical(db, patientId, clinical);
    }

    case "pause": {
      if (!clinical) return fail(403, NOT_CLINICAL);
      const reason = b.reason;
      if (reason !== null && reason !== "indicacion_profesional" && reason !== "judicial") return fail(400, "Elegí el motivo.");
      const saved = await saveSettings(reason ? { paused_at: now, pause_reason: reason } : { paused_at: null, pause_reason: null });
      if (!saved) return fail(503, SAVE_FAILED);
      return staffClinical(db, patientId, clinical);
    }

    case "adolescent": {
      if (!clinical) return fail(403, NOT_CLINICAL);
      let patch: Partial<Settings>;
      if (b.withdrawn === true) {
        patch = { adolescent_withdrawn_on: today };
      } else {
        const agreedOn = b.agreed_on;
        if (!isDateKey(agreedOn) || agreedOn > today) return fail(400, "Indicá la fecha en que dio su conformidad.");
        patch = { adolescent_agreed_on: agreedOn, adolescent_agreed_by_email: email, adolescent_withdrawn_on: null };
      }
      if (!(await saveSettings(patch))) return fail(503, SAVE_FAILED);
      return staffClinical(db, patientId, clinical);
    }

    case "verify_link": {
      const linkId = b.link_id;
      if (!validId(linkId)) return fail(400, "Pedido inválido");
      const inPerson = b.in_person_on;
      if (!isDateKey(inPerson) || inPerson > today) return fail(400, "Indicá cuándo se vio el DNI en persona.");
      const parental = b.parental_on ?? null;
      const parentalOn = isDateKey(parental) && parental <= today ? parental : null;
      if (parental !== null && !parentalOn) return fail(400, "Revisá la fecha de la documentación.");
      const link = db.links.find((l) => l.id === linkId);
      if (!link || link.child_id !== patientId) return fail(404, "No encontramos ese acceso.");
      link.verified_in_person_on = inPerson;
      link.verified_by_email = email;
      // La documentación de responsabilidad parental solo aplica a madre,
      // padre o tutor/a. Si no viene en el pedido, se conserva la que había.
      if (link.relationship_kind !== "representante_legal") link.parental_checked_on = null;
      else if (b.parental_on !== undefined) link.parental_checked_on = parentalOn;
      save(db);
      return staffClinical(db, patientId, clinical);
    }

    case "block": {
      const guardianId = b.guardian_id;
      if (!validId(guardianId)) return fail(400, "Pedido inválido");
      const reason = b.reason;
      if (reason !== "orden_judicial" && reason !== "otro") return fail(400, "Elegí el motivo.");
      const g = await guardianRow(guardianId);
      if (!g || g.patient_id !== patientId) return fail(404, "No encontramos a ese adulto en la ficha.");
      const dni = normalizeDni(g.dni ?? "");
      if (!isValidDni(dni)) return fail(400, "Para bloquearlo hace falta su DNI en la ficha.");
      // Un solo bloqueo vigente por persona y paciente (índice único en la base).
      // Si ya estaba bloqueado igual se repasa el corte de abajo (no cambia nada
      // si ya estaba hecho), como el servidor, y después se avisa
      const already = isBlocked(db, dni, patientId);
      if (!already) {
        db.blocks.push({
          id: uid("blk"), patient_id: patientId, guardian_id: g.id, dni, reason, created_by_email: email,
          created_at: now, lifted_at: null, lifted_by_email: null,
        });
      }
      // Se cortan sus accesos al portal para este paciente (por su DNI y por su
      // fila en la ficha) y sus invitaciones pendientes. En la base el vínculo
      // queda revocado (motivo "bloqueo"); el mock no guarda vínculos
      // revocados: se quita
      const accountIds = new Set([
        ...db.accounts.filter((a) => a.dni === dni).map((a) => a.id),
        ...db.links.filter((l) => l.child_id === patientId && l.guardian_id === g.id).map((l) => l.account_id),
      ]);
      db.links = db.links.filter((l) => !(l.child_id === patientId && accountIds.has(l.account_id)));
      for (const inv of db.invitations) {
        if (inv.dni === dni && !inv.used_at && !inv.revoked_at) inv.revoked_at = now;
      }
      // Sus pedidos de turno abiertos para este paciente se cierran sin turno
      // (no hay que contactarlo), con el motivo "bloqueo" y la constancia en las
      // notas. Mientras siga el bloqueo no se pueden reabrir (staffApptUpdate)
      for (const r of db.appt_requests) {
        if (r.patient_id !== patientId || !r.account_id || !accountIds.has(r.account_id) || !apptReqOpen(r.status)) continue;
        r.status = "rechazado";
        r.reject_reason = "bloqueo";
        r.rejected_at = now;
        r.rejected_by_email = email;
        r.staff_notes = withBlockNote(r.staff_notes);
        r.updated_at = now;
        logApptEvent(r, "rechazado", email, now);
      }
      save(db);
      if (already) return fail(409, "Ese adulto ya está bloqueado.");
      return staffClinical(db, patientId, clinical);
    }

    case "unblock": {
      const blockId = b.block_id;
      if (!validId(blockId)) return fail(400, "Pedido inválido");
      const block = db.blocks.find((x) => x.id === blockId && x.patient_id === patientId && !x.lifted_at);
      if (!block) return fail(409, "Ese bloqueo ya no está vigente. Actualizá la ficha.");
      block.lifted_at = now;
      block.lifted_by_email = email;
      save(db);
      return staffClinical(db, patientId, clinical);
    }

    case "consent_paper": {
      const accountId = b.account_id;
      const fileId = b.file_id;
      if (!validId(accountId) || !validId(fileId)) return fail(400, "Pedido inválido");
      // La cuenta tiene que estar vinculada a este paciente, y el formulario
      // escaneado tiene que estar en los adjuntos de su ficha
      const link = db.links.find((l) => l.child_id === patientId && l.account_id === accountId);
      const { data: fData } = await mockSupabase.from("patient_files").select("*").eq("id", fileId);
      const file = ((fData ?? []) as Row[])[0];
      if (!link) return fail(404, "Esa cuenta no tiene acceso a este paciente.");
      if (!file || file.patient_id !== patientId || file.voided_at || file.category !== "consentimiento") {
        return fail(400, "Elegí el formulario firmado (adjunto de tipo «Consentimiento informado» de esta ficha).");
      }
      recordConsent(db, accountId, true, { channel: "papel", fileId, byEmail: email });
      save(db);
      return staffClinical(db, patientId, clinical);
    }

    default:
      return fail(400, "Acción inválida");
  }
}

// ── "Mi información" en la ficha (equipo) ───────────────────────────────────
// Etapa C: profesionales y Dirección publican y retiran; Administración ve
// solo los estados (sin textos). Lo publicado no se edita: se retira y se
// publica una versión nueva. En producción: POST /api/portal-staff/clinical
// (staffInfo, publishSummary, publishReport y withdrawPublication en
// server/lib/portalInfo.ts).

async function panelProfessionals(): Promise<Map<string, Row>> {
  const { data } = await mockSupabase.from("professionals").select("*");
  return new Map(((data ?? []) as Row[]).map((p) => [String(p.id), p]));
}

type Author = { professional_id: string | null; label: string | null; problem: string | null };

// Con qué nombre se publica: el profesional vinculado al usuario (con
// matrícula) o, para la Dirección sin profesional vinculado, "Dirección del CIMT"
function authorOf(staff: Staff, pros: Map<string, Row>): Author {
  if (!staff.clinical) return { professional_id: null, label: null, problem: "Solo los profesionales y la Dirección publican en el portal." };
  const pro = staff.professional_id ? pros.get(staff.professional_id) : undefined;
  if (!pro) {
    if (staff.role === "direccion") return { professional_id: null, label: "Dirección del CIMT", problem: null };
    return { professional_id: null, label: null, problem: "Tu usuario no está vinculado a un profesional: pedile a la Dirección que te vincule en Equipo." };
  }
  const license = String(pro.license ?? "").trim();
  if (!license) return { professional_id: String(pro.id), label: null, problem: "Falta tu matrícula. Pedile a la Dirección que la cargue en Equipo." };
  return { professional_id: String(pro.id), label: `${String(pro.name ?? "")} · MP ${license}`, problem: null };
}

type InfoPatient = {
  id: string; first_name: string; birth_date: string | null;
  diagnosis_code: string | null; professional_id: string | null; therapy_modes: string[];
};

// Lo que "Mi información" toma de la ficha (ver patientCard). Los chicos de
// la demo no tienen ficha en el panel: van sin diagnóstico ni profesional
async function infoPatient(db: Db, id: string): Promise<InfoPatient | null> {
  const card = await patientCard(db, id);
  if (!card) return null;
  const p = db.children.find((c) => c.id === id)?.source === "demo" ? undefined : await panelPatient(id);
  const modes = p?.therapy_modes;
  return {
    id, first_name: card.first_name, birth_date: card.birth_date,
    diagnosis_code: text(p?.diagnosis_code), professional_id: text(p?.professional_id),
    therapy_modes: Array.isArray(modes) ? modes.map(String) : [],
  };
}

// Quién de la familia abrió cada publicación (la primera vez de cada uno)
function readsFor(db: Db, pubIds: string[]): Map<string, { name: string; at: string }[]> {
  const out = new Map<string, { name: string; at: string }[]>();
  const rows = db.access_log
    .filter((l) => l.action === "ver_publicacion" && !!l.target_id && pubIds.includes(l.target_id))
    .sort((x, y) => x.at.localeCompare(y.at));
  for (const r of rows) {
    const target = r.target_id ?? "";
    const a = db.accounts.find((x) => x.id === r.account_id);
    const name = a ? `${a.first_name} ${a.last_name}`.trim() : "Una cuenta que ya no existe";
    const list = out.get(target) ?? [];
    if (!list.some((x) => x.name === name)) list.push({ name, at: r.at });
    out.set(target, list);
  }
  return out;
}

// Lo que ve el equipo: lo publicado (con su historial) y los informes de la ficha
async function staffInfo(db: Db, staff: Staff, patientId: string): Promise<ApiResult<StaffInfoDTO>> {
  const p = await infoPatient(db, patientId);
  if (!p) return fail(404, "No encontramos ese paciente.");
  const access = await staffClinical(db, patientId, staff.clinical);
  if (!access.ok) return access;
  const allReports = await panelReports(db, patientId);
  const reportRows = allReports.filter((r) => !r.voided_at);
  const voidedIds = new Set(allReports.filter((r) => r.voided_at).map((r) => r.id));
  const pros = await panelProfessionals();
  const proName = (id: string | null) => (id ? text(pros.get(id)?.name) : null);
  const proLabel = (id: string | null) => {
    const pro = id ? pros.get(id) : undefined;
    return pro ? professionalLabel({ name: String(pro.name ?? ""), specialty: text(pro.specialty) }) : null;
  };
  const author = authorOf(staff, pros);
  const pubRows = db.publications
    .filter((x) => x.patient_id === patientId)
    .sort((x, y) => y.published_at.localeCompare(x.published_at));
  const reads = readsFor(db, pubRows.map((x) => x.id));

  const toStaff = (r: Publication): StaffPublication => ({
    id: r.id, kind: r.kind, title: r.title,
    body: staff.clinical ? r.body : null, // Administración no ve los textos
    version: r.version, author_label: r.author_label, published_at: r.published_at,
    published_by_email: r.published_by_email, withdrawn_at: r.withdrawn_at, withdrawn_by_email: r.withdrawn_by_email,
    withdraw_reason: r.withdraw_reason, source_report_id: r.source_report_id, reads: reads.get(r.id) ?? [],
    source_voided: !!r.source_report_id && voidedIds.has(r.source_report_id),
    code: verificationCode(r.id),
    review_note: staff.clinical ? r.review_note : null,
  });
  const liveSummary = pubRows.find((r) => r.kind === "resumen" && !r.withdrawn_at);

  return ok({
    can_publish: staff.clinical,
    author: { label: author.label, problem: author.problem },
    patient: {
      id: p.id, first_name: p.first_name, age: p.birth_date ? ageOn(p.birth_date, centerNow().date) : null,
      diagnosis_code: p.diagnosis_code,
      professional_name: proName(p.professional_id),
      professional_label: proLabel(p.professional_id),
      modes: p.therapy_modes.map((m) => THERAPY_LABEL[m] ?? m),
    },
    info_enabled: access.data.settings.info_enabled,
    readers: access.data.accesses.filter((a) => a.info_block === null).map((a) => a.name),
    summary: liveSummary ? toStaff(liveSummary) : null,
    history: pubRows.map(toStaff),
    reports: reportRows.map((r) => {
      const live = pubRows.find((x) => x.kind === "informe" && x.source_report_id === r.id && !x.withdrawn_at) ?? null;
      const edited = r.updated_at ?? r.created_at;
      return {
        id: r.id, report_date: r.report_date, edited_at: edited, professional_name: proName(r.professional_id),
        // Solo para perfiles clínicos (Administración no ve textos)
        progress: staff.clinical ? r.progress : null,
        therapy_evolution: staff.clinical ? r.therapy_evolution : null,
        live: live ? toStaff(live) : null,
        changed_after: !!live && !!edited && edited > live.published_at,
      };
    }),
  });
}

// Reglas comunes antes de publicar: ya se conversó en consulta, "Mi
// información" prendida, sin pausa y, de 13 a 17 años, la conformidad del
// adolescente y su casilla
function checkCanPublish(db: Db, patientId: string, birthDate: string | null, body: Record<string, unknown>): ApiResult<true> {
  if (body.discussed_ack !== true) return fail(400, "Confirmá que ya lo conversaste en consulta.");
  const s = settingsOf(db, patientId);
  if (!s?.info_enabled) return fail(409, "Primero prendé «Mostrar «Mi información» en el portal» en Habilitación.");
  if (s.paused_at) return fail(409, "El portal de este paciente está en pausa: no se puede publicar.");
  const age = birthDate ? ageOn(birthDate, centerNow().date) : null;
  if (age !== null && age >= ADOLESCENT_FROM && age < ADULT_FROM) {
    if (!adolescentAgreed(s, age)) return fail(409, "Falta registrar la conformidad del adolescente (en esta misma sección).");
    if (body.adolescent_ack !== true) return fail(400, "Confirmá que lo conversaste con el adolescente.");
  }
  return ok(true as const);
}

// Frases sobre fluidez o "curar" en lo que se publica: no se bloquea, pero
// el profesional tiene que contar por qué lo deja así (queda guardado)
function reviewNote(texts: string[], body: Record<string, unknown>): ApiResult<string | null> {
  const found = lintTexts(texts);
  if (!found.length) return ok(null);
  const note = cleanText(body.review_note, REVIEW_NOTE_MAX);
  if (note.length < 3) {
    return fail(400, `El texto dice «${found.join("», «")}»: corregilo o contá por qué lo dejás así.`, { code: "REVIEW" });
  }
  return ok(note);
}

// Retira la versión vigente (si hay) y guarda la nueva en un solo paso, como
// la función portal_publish del script 23. expected: la versión vigente que el
// profesional tenía en pantalla; si cambió, no se pisa. Devuelve el id nuevo.
async function publishVersion(staff: Staff, expected: unknown, row: Pick<Publication,
  "patient_id" | "kind" | "title" | "body" | "source_report_id" | "includes_diagnosis" | "adolescent_ack" | "review_note">,
): Promise<ApiResult<string>> {
  if (expected !== null && expected !== undefined && !validId(expected)) return fail(400, "Pedido inválido");
  const author = authorOf(staff, await panelProfessionals());
  if (author.problem || !author.label) return fail(403, author.problem ?? "No se pudo identificar al autor.");
  const bodySha = await sha256(row.body);

  // De acá en adelante, sin esperas y con la base recién leída: si otra
  // pestaña publicó mientras tanto, se ve en la comparación con expected
  const db = load();
  const same = (p: Publication) => p.patient_id === row.patient_id && p.kind === row.kind
    && (row.kind === "resumen" || p.source_report_id === row.source_report_id);
  const live = db.publications.find((p) => same(p) && !p.withdrawn_at) ?? null;
  if ((live?.id ?? null) !== (expected ?? null)) {
    return fail(409, "Otra persona publicó una versión nueva mientras editabas. Actualizá la sección para verla.");
  }
  const version = Math.max(0, ...db.publications.filter(same).map((p) => p.version)) + 1;
  const now = new Date().toISOString();
  if (live) {
    live.withdrawn_at = now;
    live.withdrawn_by_email = staff.email;
    live.withdraw_reason = "reemplazada";
  }
  const id = uuid();
  db.publications.push({
    ...row, id, title: row.title.slice(0, INFO_LIMITS.title), body_sha256: bodySha, version,
    supersedes_id: live?.id ?? null, professional_id: author.professional_id, author_label: author.label,
    discussed_ack: true, published_at: now, published_by_email: staff.email,
    withdrawn_at: null, withdrawn_by_email: null, withdraw_reason: null,
  });
  save(db);
  return ok(id);
}

// Las acciones de "Mi información"; todas devuelven la sección actualizada.
//   info_get (cualquier rol; Administración sin textos) ·
//   publish_summary, publish_report (profesional o Dirección) ·
//   withdraw (quien lo publicó o la Dirección)
export async function staffInfoAction(body: InfoAction, issuedBy: string): Promise<ApiResult<StaffInfoDTO>> {
  await wait(350);
  const staff = await currentStaff(issuedBy);
  if (!staff.ok) return staff;
  // Como el servidor, se revisa cada valor (no se confía en el tipo)
  const b = body as unknown as Record<string, unknown>;
  if (!FEATURES.length) return fail(404, NOT_AVAILABLE);
  const patientId = b.patient_id;
  if (!validId(patientId)) return fail(400, "Pedido inválido");
  if (!FEATURES.includes("info")) return fail(404, NOT_AVAILABLE);
  const db = load();

  switch (b.action) {
    case "info_get":
      return staffInfo(db, staff, patientId);

    case "publish_summary": {
      if (!staff.clinical) return fail(403, NOT_CLINICAL);
      const p = await infoPatient(db, patientId);
      const can = checkCanPublish(db, patientId, p?.birth_date ?? null, b);
      if (!can.ok) return can;
      const fitQue = fitText(b.que_trabajamos, INFO_LIMITS.que_trabajamos, "«¿Qué trabajamos en el CIMT?»");
      if (fitQue.error) return fail(400, fitQue.error);
      const que = fitQue.text;
      if (que.length < 20) return fail(400, "Escribí qué trabajan en el CIMT (al menos unas palabras).");
      if (!p) return fail(404, "No encontramos ese paciente.");
      const code = p.diagnosis_code;
      const tramites = b.show_code === true && code && TRAMITE_CODES[code] ? { code, label: TRAMITE_CODES[code] } : null;
      let como: SummaryBody["como_trabajamos"] = null;
      if (b.show_team === true) {
        const pro = p.professional_id ? (await panelProfessionals()).get(p.professional_id) : undefined;
        como = {
          professional: pro ? professionalLabel({ name: String(pro.name ?? ""), specialty: text(pro.specialty) }) : null,
          modes: p.therapy_modes.map((m) => THERAPY_LABEL[m] ?? m),
        };
      }
      const tips = Array.isArray(b.tips)
        ? (b.tips as unknown[]).filter((t): t is string => typeof t === "string" && (HOME_TIPS as readonly string[]).includes(t))
        : [];
      const fitAcomp = fitText(b.acompanar, INFO_LIMITS.acompanar, "«Cómo acompañar en casa»");
      if (fitAcomp.error) return fail(400, fitAcomp.error);
      const summary: SummaryBody = {
        que_trabajamos: que,
        tramites,
        como_trabajamos: como,
        acompanar: { text: fitAcomp.text, tips: [...new Set(tips)] },
      };
      const review = reviewNote([summary.que_trabajamos, summary.acompanar.text], b);
      if (!review.ok) return review;
      const published = await publishVersion(staff, b.expected_id, {
        patient_id: patientId, kind: "resumen", title: "Qué trabajamos", body: summary,
        source_report_id: null, includes_diagnosis: true, adolescent_ack: b.adolescent_ack === true,
        review_note: review.data,
      });
      if (!published.ok) return published;
      return staffInfo(load(), staff, patientId);
    }

    case "publish_report": {
      if (!staff.clinical) return fail(403, NOT_CLINICAL);
      if (!validId(b.report_id)) return fail(400, "Pedido inválido");
      const p = await infoPatient(db, patientId);
      const can = checkCanPublish(db, patientId, p?.birth_date ?? null, b);
      if (!can.ok) return can;
      const r = await panelReport(b.report_id);
      if (!r || r.patient_id !== patientId) return fail(404, "No encontramos ese informe.");
      if (r.voided_at) return fail(409, "El informe está anulado en la ficha: no se puede publicar.");
      // Se publica lo que el profesional revisó (ver server/lib/portalInfo.ts)
      if (b.report_edited_at !== (r.updated_at ?? r.created_at)) {
        return fail(409, "El informe cambió en la ficha mientras lo revisabas. Actualizá la sección para ver el texto nuevo.");
      }
      let report: ReportBody;
      if (b.mode === "familia") {
        const fitFamily = fitText(b.text, INFO_LIMITS.report_text, "La versión para la familia");
        if (fitFamily.error) return fail(400, fitFamily.error);
        const familyText = fitFamily.text;
        if (familyText.length < 20) return fail(400, "Escribí la versión para la familia (al menos unas palabras).");
        report = { mode: "familia", report_date: r.report_date, text: familyText };
      } else if (b.mode === "tal_cual") {
        // Tal cual solo se publican Progreso y Evolución: el Diagnóstico de un
        // informe está escrito para el equipo y nunca va tal cual
        const fitProgress = b.include_progress === true
          ? fitText(r.progress, INFO_LIMITS.report_text, "El Progreso del informe (para publicarlo tal cual)") : null;
        const fitEvolution = b.include_evolution === true
          ? fitText(r.therapy_evolution, INFO_LIMITS.report_text, "La Evolución del informe (para publicarla tal cual)") : null;
        const tooLong = fitProgress?.error ?? fitEvolution?.error;
        if (tooLong) return fail(400, tooLong);
        const progress = fitProgress?.text || null;
        const evolution = fitEvolution?.text || null;
        if (!progress && !evolution) return fail(400, "Elegí al menos una sección con texto (Progreso o Evolución).");
        // Quién lo escribió en la ficha: si no es quien lo publica, la familia ve los dos
        const writer = r.professional_id ? (await panelProfessionals()).get(r.professional_id) : undefined;
        const license = String(writer?.license ?? "").trim();
        report = {
          mode: "tal_cual", report_date: r.report_date, progress, therapy_evolution: evolution,
          written_by: writer ? `${String(writer.name ?? "")}${license ? ` · MP ${license}` : ""}` : null,
        };
      } else {
        return fail(400, "Elegí cómo publicarlo.");
      }
      const review = reviewNote(reportSections(report).map((x) => x.text), b);
      if (!review.ok) return review;
      const [y, m, d] = r.report_date.split("-");
      const published = await publishVersion(staff, b.expected_id, {
        patient_id: patientId, kind: "informe", title: `Informe del ${d}/${m}/${y}`, body: report,
        source_report_id: r.id, includes_diagnosis: false, adolescent_ack: b.adolescent_ack === true,
        review_note: review.data,
      });
      if (!published.ok) return published;
      return staffInfo(load(), staff, patientId);
    }

    case "withdraw": {
      if (!staff.clinical) return fail(403, NOT_CLINICAL);
      if (!validId(b.publication_id)) return fail(400, "Pedido inválido");
      const reason = String(b.reason) as WithdrawReason;
      if (!(WITHDRAW_REASONS as readonly string[]).includes(reason)) return fail(400, "Elegí el motivo.");
      const pub = db.publications.find((x) => x.id === b.publication_id);
      if (!pub || pub.patient_id !== patientId) return fail(404, "No encontramos esa publicación.");
      if (pub.withdrawn_at) return fail(409, "Ya estaba retirada. Actualizá la sección.");
      // Cada profesional retira lo suyo; la Dirección, cualquier cosa
      if (staff.role !== "direccion" && pub.published_by_email !== staff.email) {
        return fail(403, "Solo quien lo publicó o la Dirección lo pueden retirar.");
      }
      pub.withdrawn_at = new Date().toISOString();
      pub.withdrawn_by_email = staff.email;
      pub.withdraw_reason = reason;
      save(db);
      return staffInfo(db, staff, patientId);
    }

    default:
      return fail(400, "Acción inválida");
  }
}

// ── Ejercicios, devoluciones, metas y medallas en la ficha (equipo) ─────────
// Etapa B: profesionales y Dirección arman y publican el plan, ven las
// prácticas y los comentarios, mandan devoluciones, publican metas y dan o
// anulan medallas. Administración ve estados y días de práctica, sin textos
// (ni comentarios, ni devoluciones, ni borradores). Mismos validadores,
// reglas y mensajes que server/lib/practice.ts (POST
// /api/portal-staff/practice). Como las funciones del script 26, publicar un
// plan y mandar una devolución (con metas logradas y medalla) son un solo paso.

const PATIENT_NOT_FOUND = "No encontramos ese paciente.";
const NOT_IN_CATALOG = "Ese ejercicio no está en el catálogo.";
const AI_DRAFT_GONE = "El borrador de la IA no es de este paciente o ya no se puede usar. Volvé a adaptarlo o usá el original del catálogo.";
const PRACTICE_PAUSED = "El portal de este paciente está en pausa: no se puede publicar.";
// Como en el servidor (server/lib/practice.ts)
const ACTIVITY_AGE = `Las actividades para jugar en el celular son desde los ${ACTIVITY_MIN_AGE} años. Quitala: los pasos quedan como siempre.`;
const NOTHING_TO_REVIEW = "Todavía no hay prácticas para marcar como vistas. Actualizá la sección.";
const GOAL_HAS_MEDAL = "Esa meta ya tiene su medalla.";
const GOAL_NOT_DRAFT = "Esa meta ya no está en borrador. Actualizá la sección.";
const GOAL_PLAN_CLOSED = "El plan de esa meta ya se cerró. Editala para sumarla al plan de ahora y publicala.";
const GOAL_WITH_DRAFT = "Esa meta sale junto con el plan en borrador. Para publicarla antes, editala y destildá «Publicarla junto con el plan en borrador».";
const ONLY_OWNER = "Solo quien lo publicó o la Dirección lo pueden retirar.";
const ALREADY_WITHDRAWN = "Ya estaba retirada. Actualizá la sección.";
const ALREADY_VOIDED = "Esa medalla ya estaba anulada. Actualizá la sección.";
const BREAK_DATE = "La fecha de vuelta tiene que ser posterior a hoy.";
const FEEDBACK_WITHDRAWN_VOID = "devolución retirada"; // motivo de la medalla que se anula con su devolución
const GONE_ACCOUNT = "La cuenta ya no existe";
const INBOX_DAYS = 180; // bandeja: prácticas y comentarios de los últimos 180 días

const PRACTICE_ACTIONS: readonly unknown[] = [
  "get", "catalog", "plan_save_draft", "plan_publish", "plan_break", "plan_finish", "plan_withdraw", "mark_seen",
  "feedback_send", "feedback_withdraw", "goal_save", "goal_publish", "goal_change", "goal_not_yet", "medal_void",
] satisfies PracticeAction["action"][];

// Lo que la etapa toma de la ficha: la del panel o, para los chicos de la
// demo (sin ficha en el panel), la copia del portal con su diagnóstico de demo
type PracticePatient = {
  id: string; first_name: string; age: number | null; diagnosis_code: string | null;
  professional_id: string | null; demo: boolean;
  row: Row | null; // la ficha del panel (para sugerir los ejercicios); null en la demo
};

async function practicePatient(db: Db, id: string): Promise<PracticePatient | null> {
  const card = await patientCard(db, id);
  if (!card) return null;
  const child = db.children.find((c) => c.id === id);
  const demo = child?.source === "demo";
  const p = demo ? undefined : await panelPatient(id);
  return {
    id, first_name: card.first_name, age: card.birth_date ? ageOn(card.birth_date, centerNow().date) : null,
    diagnosis_code: demo ? child?.diagnosis_code ?? null : text(p?.diagnosis_code),
    professional_id: demo ? null : text(p?.professional_id), demo,
    row: p ?? null,
  };
}

// ¿Es paciente de quien mira? (el profesional de la ficha). Los chicos de la
// demo cuentan para cualquier perfil clínico: su profesional (Lic. Ana
// Torres) no es un usuario del mock
function isMine(staff: Staff, p: PracticePatient): boolean {
  if (!staff.clinical) return false;
  if (p.demo) return true;
  return !!staff.professional_id && p.professional_id === staff.professional_id;
}

function publishCheckOf(db: Db, plan: PlanRow): PublishCheck {
  return {
    title: plan.title, goal_text: plan.goal_text, lint_overrides: plan.lint_overrides,
    exercises: planRows(db, plan.id).map((e) => ({
      title: e.title, para_que: e.para_que, pasos: e.pasos, materiales: e.materiales, for_adult: e.for_adult,
      si_cuesta: e.si_cuesta, approach: e.approach, practiced_in_session: e.practiced_in_session,
      activity: activitiesOn() ? e.activity ?? null : null,
      ai_drafted: e.ai_drafted, reviewed: !!e.reviewed_at, removed: !!e.removed_at, lint_overrides: e.lint_overrides,
    })),
  };
}

// Los textos que se revisan: la actividad, solo con la etapa prendida
const mockTexts = (e: ExerciseRow) => ({ ...e, activity: activitiesOn() ? e.activity ?? null : null });

function staffExercise(db: Db, e: ExerciseRow): StaffExerciseDTO {
  return {
    id: e.id, exercise_key: e.exercise_key, position: e.position, source: e.source, catalog_id: e.catalog_id,
    catalog_version: e.catalog_version, approach: e.approach, practiced_in_session: e.practiced_in_session,
    title: e.title, para_que: e.para_que, pasos: [...e.pasos], minutes: e.minutes, materiales: e.materiales,
    for_adult: e.for_adult, si_cuesta: e.si_cuesta, with_adult: e.with_adult, ai_drafted: e.ai_drafted,
    ai_draft_id: e.ai_draft_id, reviewed_at: e.reviewed_at, reviewed_by_email: e.reviewed_by_email,
    edit_ratio: e.edit_ratio, alerts: exerciseTextAlerts(mockTexts(e), e.approach), lint_overrides: e.lint_overrides,
    removed_at: e.removed_at, first_published_on: firstPublishedOn(db, e.patient_id, e.exercise_key),
    activity: activitiesOn() ? e.activity ?? null : null,
  };
}

// publish_problem (solo borradores): lo que dice publishProblem ("Lo
// conversé con …" se pide al publicar)
function staffPlan(db: Db, plan: PlanRow, admin: boolean, p: PracticePatient): StaffPlanDTO {
  const rows = planRows(db, plan.id);
  const active = rows.filter((e) => !e.removed_at);
  const sum = planSummary(active.map((e) => ({ minutes: e.minutes })), plan.days_per_week, p.age);
  const problem = plan.status === "borrador"
    ? publishProblem(publishCheckOf(db, plan), { age: p.age, diagnosis_code: p.diagnosis_code, adolescent_ack: true })?.error ?? null
    : null;
  return {
    id: plan.id, version: plan.version, status: plan.status,
    title: admin ? null : plan.title, goal_text: admin ? null : plan.goal_text,
    audience: plan.audience, mode: SCREEN_MODE_BY_AUDIENCE[plan.audience], days_per_week: plan.days_per_week,
    review_on: plan.review_on, on_break_until: plan.on_break_until, auto_medals: plan.auto_medals,
    professional_id: plan.professional_id, author_label: plan.author_label, adolescent_ack: plan.adolescent_ack,
    supersedes_id: plan.supersedes_id, created_by_email: plan.created_by_email, created_at: plan.created_at,
    updated_at: plan.updated_at, updated_by_email: plan.updated_by_email,
    published_at: plan.published_at, published_by_email: plan.published_by_email,
    closed_at: plan.closed_at, closed_by_email: plan.closed_by_email, close_reason: plan.close_reason,
    last_reviewed_at: plan.last_reviewed_at, last_reviewed_by_email: plan.last_reviewed_by_email,
    lint_overrides: admin ? [] : plan.lint_overrides,
    exercises: admin ? [] : rows.map((e) => staffExercise(db, e)),
    exercise_count: active.length, total_minutes: sum.total_minutes, summary_line: sum.line,
    minutes_warning: sum.warning, publish_problem: problem,
  };
}

// "María López (madre)"
const withRelation = (name: string, relationship: string | null) =>
  (relationship?.trim() ? `${name} (${relationship.trim().toLowerCase()})` : name);

function whoOf(db: Db, accountId: string | null, relations: Map<string, string | null>): string | null {
  const a = accountId ? db.accounts.find((x) => x.id === accountId) : undefined;
  return a ? withRelation(`${a.first_name} ${a.last_name}`.trim(), relations.get(a.id) ?? null) : null;
}

// El título de la versión más nueva de un ejercicio
function latestTitle(db: Db, patientId: string, key: string): string | null {
  const version = (planId: string) => db.practice_plans.find((x) => x.id === planId)?.version ?? 0;
  return db.practice_exercises
    .filter((e) => e.patient_id === patientId && e.exercise_key === key)
    .sort((x, y) => version(y.plan_id) - version(x.plan_id))[0]?.title ?? null;
}

// El último "Visto" o devolución, de cualquier versión del plan
function lastReviewedOf(db: Db, patientId: string): string | null {
  return db.practice_plans.filter((x) => x.patient_id === patientId && x.last_reviewed_at)
    .map((x) => x.last_reviewed_at ?? "").sort().pop() ?? null;
}

// Grilla de los últimos 14 días: los ejercicios del plan publicado (en su
// orden) y después los que tuvieron prácticas en esos días aunque ya no estén
function staffGrid(
  db: Db, patientId: string, plan: PlanRow | null, admin: boolean, relations: Map<string, string | null>, today: string,
): StaffPracticeGrid {
  const dates = Array.from({ length: GRID_DAYS }, (_, i) => addDays(today, i - (GRID_DAYS - 1)));
  const logs = liveLogs(db, patientId).filter((l) => l.practiced_on >= dates[0] && l.practiced_on <= today);
  const current = plan ? activeRows(db, plan.id).map((e) => e.exercise_key) : [];
  const others = [...new Set([...logs].sort((x, y) => y.practiced_on.localeCompare(x.practiced_on))
    .map((l) => l.exercise_key).filter((k) => !current.includes(k)))];
  return {
    dates,
    rows: [...current, ...others].map((key) => ({
      exercise_key: key,
      title: admin ? null : latestTitle(db, patientId, key),
      current: current.includes(key),
      cells: dates.map((date) => {
        const l = logs.find((x) => x.exercise_key === key && x.practiced_on === date);
        if (!l) return null;
        return {
          log_id: l.id,
          logged_by: whoOf(db, l.account_id, relations),
          results: admin
            ? []
            : db.practice_notes.filter((n) => n.log_id === l.id)
              .sort((x, y) => x.created_at.localeCompare(y.created_at))
              .map((n) => ({ who: whoOf(db, n.account_id, relations) ?? GONE_ACCOUNT, result: n.result, comment: !!n.comment, risk: n.risk_flag })),
        };
      }),
    })),
  };
}

// Comentarios y "¿Cómo te fue?" de la familia: los de riesgo sin ver arriba
// de todo ("Revisar hoy"); después, del más nuevo al más viejo (los de riesgo
// ya vistos, en su fecha, como el servidor)
function staffNotes(db: Db, patientId: string, reviewedAt: string | null, relations: Map<string, string | null>): StaffNoteDTO[] {
  return db.practice_notes
    .filter((n) => n.patient_id === patientId)
    .map((n) => {
      const log = db.practice_logs.find((l) => l.id === n.log_id);
      const title = log
        ? db.practice_exercises.find((e) => e.id === log.exercise_id)?.title ?? latestTitle(db, patientId, log.exercise_key)
        : null;
      return {
        id: n.id, log_id: n.log_id, practiced_on: log?.practiced_on ?? centerDateOf(n.created_at),
        exercise_title: title ?? "", who: whoOf(db, n.account_id, relations) ?? GONE_ACCOUNT,
        result: n.result, comment: n.comment, risk: n.risk_flag, created_at: n.created_at,
        is_new: !reviewedAt || n.created_at > reviewedAt, log_undone: !!log?.voided_at,
      };
    })
    .sort((x, y) => Number(y.risk && y.is_new) - Number(x.risk && x.is_new) || y.created_at.localeCompare(x.created_at));
}

// Lo nuevo desde el último "Visto" o devolución (lo que pone la fila en la
// bandeja). Las notas cuentan si tienen comentario, "Me costó" o palabras de
// riesgo; since: la práctica pendiente más vieja (o el día del comentario)
function practicePending(
  db: Db, patientId: string, today: string, withNotes: boolean, from: string | null = null,
): StaffPracticePending {
  const reviewed = lastReviewedOf(db, patientId);
  const live = livePlan(db, patientId);
  const after = (iso: string) => (!reviewed || iso > reviewed) && (!from || iso >= from);
  const logs = liveLogs(db, patientId).filter((l) => after(l.created_at));
  const notes = withNotes
    ? db.practice_notes.filter((n) => n.patient_id === patientId && after(n.created_at)
      && (!!n.comment || n.result === "costo" || n.risk_flag))
    : [];
  const since = [...logs.map((l) => l.practiced_on), ...notes.map((n) => centerDateOf(n.created_at))].sort()[0] ?? null;
  return {
    logs: logs.length,
    comments: notes.filter((n) => !!n.comment).length,
    costo: notes.filter((n) => n.result === "costo").length,
    risk: notes.filter((n) => n.risk_flag).length,
    since,
    stale: !!since && daysBetween(since, today) >= REVIEW_STALE_DAYS && !(live && onBreak(live.on_break_until, today)),
  };
}

function staffGoals(db: Db, patientId: string, admin: boolean, today: string): StaffGoalDTO[] {
  const days = asDays(liveLogs(db, patientId));
  return db.practice_goals
    .filter((g) => g.patient_id === patientId)
    .sort(newestFirst((g) => g.created_at))
    .map((g) => ({
      id: g.id, plan_id: g.plan_id, kind: g.kind, title: admin ? null : g.title, rule: g.rule,
      medal_title: admin ? null : g.medal_title, agreed_with_patient: g.agreed_with_patient, status: g.status,
      created_at: g.created_at, created_by_email: g.created_by_email, published_at: g.published_at,
      achieved_at: g.achieved_at, feedback_id: g.feedback_id, changed_at: g.changed_at, changed_by_email: g.changed_by_email,
      progress: g.kind === "practica" && g.status === "activa" && g.rule && g.published_at
        ? goalProgress({ kind: g.kind, rule: g.rule, start: centerDateOf(g.published_at) }, days, today)
        : null,
      met_dismissed: !!g.met_notice_dismissed_at,
    }));
}

// Metas de práctica cumplidas que todavía no se dieron por logradas (ni se
// marcaron "Todavía no")
function goalsMet(goals: StaffGoalDTO[]): { goal_id: string; title: string | null; met_on: string }[] {
  return goals.flatMap((g) => (g.status === "activa" && g.progress?.met && g.progress.met_on && !g.met_dismissed
    ? [{ goal_id: g.id, title: g.title, met_on: g.progress.met_on }]
    : []));
}

// Quién de la familia abrió o vio algo (la primera vez de cada cuenta)
function familyReads(db: Db, action: AccessLog["action"], targetId: string): { name: string; at: string }[] {
  const out: { name: string; at: string }[] = [];
  const rows = db.access_log.filter((l) => l.action === action && l.target_id === targetId).sort((x, y) => x.at.localeCompare(y.at));
  for (const r of rows) {
    const a = db.accounts.find((x) => x.id === r.account_id);
    const name = a ? `${a.first_name} ${a.last_name}`.trim() : "Una cuenta que ya no existe";
    if (!out.some((x) => x.name === name)) out.push({ name, at: r.at });
  }
  return out;
}

// Una cadena de versiones, de la más nueva a la más vieja: el plan y los que
// fue reemplazando (supersedes_id)
function lineageOf(db: Db, plan: PlanRow | null): PlanRow[] {
  const out: PlanRow[] = [];
  for (let p: PlanRow | undefined = plan ?? undefined; p && !out.includes(p);) {
    out.push(p);
    const prevId: string | null = p.supersedes_id;
    p = prevId ? db.practice_plans.find((x) => x.id === prevId) : undefined;
  }
  return out;
}

// "Desde el 03/10…": desde la primera publicación de esta cadena de versiones
function practiceSince(db: Db, plan: PlanRow | null): string | null {
  return lineageOf(db, plan).flatMap((p) => (p.published_at ? [centerDateOf(p.published_at)] : [])).sort()[0] ?? null;
}

// ¿Sigue abierto el plan de una meta? Una meta sin plan, sí. Con plan: si es
// el borrador, el publicado o una versión que el publicado reemplazó (esa
// cadena sigue en el portal). Uno finalizado, retirado o descartado, no
function goalPlanOpen(db: Db, g: GoalRow): boolean {
  if (!g.plan_id) return true;
  const plan = db.practice_plans.find((x) => x.id === g.plan_id && x.patient_id === g.patient_id);
  if (!plan) return false;
  if (plan.status === "borrador" || plan.status === "publicado") return true;
  return lineageOf(db, livePlan(db, g.patient_id)).some((x) => x.id === plan.id);
}

// Un plan que se cierra (finalizado o retirado) se lleva las metas de su
// cadena de versiones (él y las que reemplazó: las de las versiones
// anteriores seguían activas). Las activas y las en borrador quedan
// "cambiada"; las logradas siguen (las dio una devolución). Como
// practice_withdraw_plan y practice_finish_plan del script 26
function retireChainGoals(db: Db, plan: PlanRow, email: string, now: string): void {
  const chain = new Set(lineageOf(db, plan).map((x) => x.id));
  for (const g of db.practice_goals) {
    if (g.patient_id !== plan.patient_id || !g.plan_id || !chain.has(g.plan_id)) continue;
    if (g.status !== "activa" && g.status !== "borrador") continue;
    Object.assign(g, { status: "cambiada", changed_at: now, changed_by_email: email, updated_at: now });
  }
}

// Lo que ve el equipo (la vista se arma con la base recién leída)
async function staffPractice(staff: Staff, patientId: string, withCatalog = false): Promise<ApiResult<StaffPracticeDTO>> {
  const first = load();
  const p = await practicePatient(first, patientId);
  if (!p) return fail(404, PATIENT_NOT_FOUND);
  const access = await staffClinical(first, patientId, staff.clinical);
  if (!access.ok) return access;
  const author = authorOf(staff, await panelProfessionals());
  const db = load();
  const today = centerNow().date;
  const admin = !staff.clinical;
  // La relación de cada cuenta con el paciente, de su fila en la ficha
  const relations = new Map(access.data.accesses.map((a) => [a.account_id, a.relationship]));
  const readers = access.data.accesses.filter((a) => a.practice_block === null).map((a) => withRelation(a.name, a.relationship));
  const self = p.age !== null && p.age >= ADULT_FROM;
  const plan = livePlan(db, patientId);
  const draft = draftPlanOf(db, patientId);
  const since = practiceSince(db, plan);
  const counted = liveLogs(db, patientId).filter((l) => !since || l.practiced_on >= since);
  const dates = [...new Set(counted.map((l) => l.practiced_on))].sort();
  const summary = { since, logs: counted.length, days: dates.length, last: dates[dates.length - 1] ?? null };
  const goals = staffGoals(db, patientId, admin, today);
  const profMedal = (feedbackId: string) => db.practice_medals.find((m) => m.feedback_id === feedbackId && m.kind === "profesional");

  return ok({
    // En el mock la ayuda de IA no necesita clave (son plantillas fijas)
    features: { ai: FEATURES.includes("ai"), activities: activitiesOn(), recordings: activitiesOn() && FEATURES.includes("recordings") },
    can_edit: staff.clinical,
    author: { label: author.label, problem: admin ? STAFF_PRACTICE_TEXT.admin_readonly : author.problem },
    patient: {
      id: p.id, first_name: p.first_name, self, age: p.age, audience: audienceForAge(p.age), adolescent: isAdolescent(p.age),
    },
    approaches: admin ? [] : approachOptions(p.diagnosis_code, p.age),
    suggestions: admin ? null : suggestPractice(profileFromRow(p.row, p.age, p.diagnosis_code)),
    practice_enabled: access.data.settings.practice_enabled,
    readers,
    readers_line: readersLine(readers, { first_name: p.first_name, self }),
    published: plan ? staffPlan(db, plan, admin, p) : null,
    draft: draft && !admin ? staffPlan(db, draft, admin, p) : null,
    history: db.practice_plans
      .filter((x) => x.patient_id === patientId && x.status !== "publicado" && x.status !== "borrador")
      .sort((x, y) => y.version - x.version)
      .map((x) => ({
        id: x.id, version: x.version, status: x.status, author_label: x.author_label, published_at: x.published_at,
        published_by_email: x.published_by_email, closed_at: x.closed_at, close_reason: x.close_reason,
      })),
    summary: { ...summary, text: practiceSummaryText(summary, today) },
    grid: staffGrid(db, patientId, plan, admin, relations, today),
    notes: admin ? [] : staffNotes(db, patientId, lastReviewedOf(db, patientId), relations),
    // Administración ve cuántas prácticas, no los comentarios ni cómo les fue
    pending: practicePending(db, patientId, today, !admin),
    goals,
    goals_met: goalsMet(goals),
    medals: db.practice_medals
      .filter((m) => m.patient_id === patientId)
      .sort(newestFirst((m) => m.awarded_at))
      .map((m): StaffMedalDTO => ({
        id: m.id, kind: m.kind, code: m.code, title: admin && m.kind === "profesional" ? null : m.title,
        period_key: m.period_key, plan_id: m.plan_id, goal_id: m.goal_id, feedback_id: m.feedback_id,
        message: admin ? null : m.message, awarded_at: m.awarded_at, awarded_by_email: m.awarded_by_email,
        // El motivo es texto libre (puede nombrar algo clínico): Administración
        // ve que está anulada, no por qué
        voided_at: m.voided_at, voided_by_email: m.voided_by_email, void_reason: admin ? null : m.void_reason,
        seen_by: familyReads(db, "ver_medalla", m.id),
      })),
    feedback: db.practice_feedback
      .filter((f) => f.patient_id === patientId)
      .sort(newestFirst((f) => f.sent_at))
      .map((f): StaffFeedbackDTO => {
        const medal = profMedal(f.id);
        return {
          id: f.id, plan_id: f.plan_id, author_label: f.author_label,
          body: admin ? null : f.body, for_adult: admin ? null : f.for_adult,
          period_start: f.period_start, period_end: f.period_end, adolescent_ack: f.adolescent_ack,
          review_note: admin ? null : f.review_note, sent_at: f.sent_at, sent_by_email: f.sent_by_email,
          withdrawn_at: f.withdrawn_at, withdrawn_by_email: f.withdrawn_by_email, withdraw_reason: f.withdraw_reason,
          reads: familyReads(db, "ver_devolucion", f.id),
          medal: medal ? { id: medal.id, title: admin ? null : medal.title } : null,
          goals: db.practice_goals.filter((g) => g.feedback_id === f.id).map((g) => ({ id: g.id, title: admin ? null : g.title })),
          can_withdraw: staff.clinical && !f.withdrawn_at && (staff.role === "direccion" || f.sent_by_email === staff.email),
        };
      }),
    catalog_version: CATALOG_VERSION,
    catalog: withCatalog && !admin ? catalogFor(approachesForDiagnosis(p.diagnosis_code), p.age) : null,
  });
}

// Un instante posterior a prev (updated_at se usa para no pisar a otra persona)
function stamp(prev?: string | null): string {
  const now = new Date().toISOString();
  return prev && now <= prev ? new Date(Date.parse(prev) + 1).toISOString() : now;
}

// "Lo dejo así": se conservan los motivos que siguen cubriendo algún aviso y,
// si quedan avisos sin cubrir y vino un motivo, se suma uno nuevo (como el servidor)
function mergeOverrides(prev: LintOverride[] | undefined, alerts: string[], note: string | null, email: string, at: string): LintOverride[] {
  if (!alerts.length) return [];
  const kept = (prev ?? []).filter((o) => o.terms.some((t) => alerts.includes(t)));
  const open = uncoveredAlerts(alerts, kept);
  if (open.length && note) kept.push({ terms: open, reason: note, by_email: email, at });
  return kept;
}

// Cuánto se editó el texto que propuso la IA (se guarda al publicar)
function aiEditRatio(db: Db, e: ExerciseRow): number | null {
  const d = e.ai_draft_id ? db.ai_drafts.find((x) => x.id === e.ai_draft_id) : undefined;
  const item = d?.output?.ejercicios.find((x) => x.catalogo_id === e.catalog_id);
  if (!d || !item) return e.edit_ratio;
  const proposed = draftToExerciseInput(item, { approach: e.approach, practiced_in_session: e.practiced_in_session, draft_id: d.id }, readActivity(d.output?.actividad ?? null));
  return editRatio(exerciseFullText(proposed), exerciseFullText(mockTexts(e)));
}

// Procedencia de la IA (como el trigger del script 26): un borrador de este
// paciente, de adaptación y que todavía se puede usar
const aiDraftUsable = (db: Db, patientId: string, id: string) => {
  const d = db.ai_drafts.find((x) => x.id === id);
  return !!d && d.patient_id === patientId && d.kind === "adaptacion" && (d.status === "generado" || d.status === "usado");
};

const conflict = () => fail<true>(409, PRACTICE_ERROR.conflict, { code: "CONFLICT" });
const invalid = () => fail<true>(400, "Pedido inválido", { code: "INVALID" });

// Cada acción, sobre la base recién leída y sin esperas. Valida todo antes
// de tocar nada: si devuelve un error, la base queda como estaba
function applyPracticeAction(
  db: Db, staff: Staff, author: Author, p: PracticePatient, b: Record<string, unknown>, today: string,
): ApiResult<true> {
  const email = staff.email;
  const plans = db.practice_plans.filter((x) => x.patient_id === p.id);
  const live = plans.find((x) => x.status === "publicado") ?? null;
  // Dónde queda el "Visto": en el plan publicado o, si ya no hay (se
  // finalizó o se retiró), en el último que se publicó. Así lo que la
  // familia anotó antes de cerrarlo se puede dar por visto
  const reviewPlan = live ?? plans.filter((x) => !!x.published_at).sort((x, y) => y.version - x.version)[0] ?? null;
  const requireAuthor = () => (author.problem || !author.label
    ? fail<true>(403, author.problem ?? PRACTICE_ERROR.not_linked, { code: "AUTHOR" })
    : null);
  // Un plan de este paciente por su id (400 si no es un id; 409 si no es de él)
  const planOf = (id: unknown): PlanRow | ApiResult<true> => {
    if (!validId(id)) return invalid();
    return plans.find((x) => x.id === id) ?? conflict();
  };
  const goalOf = (id: unknown): GoalRow | ApiResult<true> => {
    if (!validId(id)) return invalid();
    return db.practice_goals.find((g) => g.id === id && g.patient_id === p.id) ?? fail<true>(404, "No encontramos esa meta.");
  };
  const isRow = <T extends object>(x: T | ApiResult<true>): x is T => !("ok" in x);

  switch (b.action) {
    // "Guardar borrador": crea el borrador (versión siguiente del publicado,
    // si hay) o lo actualiza si nadie lo cambió mientras tanto. Nunca bloquea
    // por el texto del profesional: los avisos quedan en "alerts" y
    // "publish_problem" hasta que se corrijan o tengan "Lo dejo así"
    case "plan_save_draft": {
      const v = validatePlanDraft(b.plan);
      if (!v.ok) return fail(400, v.error, { code: v.code });
      const input = v.value;
      // Con las actividades apagadas, la actividad no se toca
      if (!activitiesOn()) for (const e of input.exercises) e.activity = null;
      const expected = b.expected_updated_at ?? null;
      if (expected !== null && typeof expected !== "string") return invalid();
      // Enfoques que nunca se podrían publicar para este paciente (la casilla
      // de sesión se pide al publicar)
      const offered = new Set(approachesForDiagnosis(p.diagnosis_code));
      for (const e of input.exercises) {
        if (e.source !== "manual" && !catalogEntry(e.catalog_id ?? "")) return fail(400, NOT_IN_CATALOG, { code: "INVALID" });
        if (e.removed) continue;
        if (!offered.has(e.approach) || !approachAgeOk(e.approach, p.age)) return fail(400, PRACTICE_ERROR.approach, { code: "APPROACH" });
        if (activitiesOn() && e.activity && !activityAgeOk(p.age)) return fail(400, ACTIVITY_AGE, { code: "INVALID" });
      }
      const draft = plans.find((x) => x.status === "borrador") ?? null;
      if (input.id ? !draft || draft.id !== input.id || draft.updated_at !== expected : !!draft) return conflict();
      const draftRows = input.id && draft ? planRows(db, draft.id) : [];
      const exs = db.practice_exercises.filter((e) => e.patient_id === p.id);
      const keys = new Set(exs.map((e) => e.exercise_key));
      const version = (planId: string) => plans.find((x) => x.id === planId)?.version ?? 0;
      const latestOfKey = (key: string) => exs.filter((e) => e.exercise_key === key).sort((x, y) => version(y.plan_id) - version(x.plan_id))[0];
      const prepared: { e: (typeof input.exercises)[number]; row: ExerciseRow | undefined }[] = [];
      for (const e of input.exercises) {
        let row = input.id && e.id ? draftRows.find((r) => r.id === e.id) : undefined;
        // Una fila que ya no es de este borrador: alguien lo cambió
        if (input.id && e.id && !row) return conflict();
        if (e.exercise_key) {
          if (!keys.has(e.exercise_key)) return invalid();
          if (row && row.exercise_key !== e.exercise_key) return invalid();
          row ??= draftRows.find((r) => r.exercise_key === e.exercise_key);
        }
        if (row && prepared.some((x) => x.row === row)) return invalid();
        // El borrador de IA: solo si es nuevo para la fila (como el trigger)
        if (e.ai_draft_id && e.ai_draft_id !== row?.ai_draft_id && !aiDraftUsable(db, p.id, e.ai_draft_id)) {
          return fail(400, AI_DRAFT_GONE, { code: "INVALID" });
        }
        prepared.push({ e, row });
      }

      const now = stamp(draft?.updated_at);
      const planFields = {
        title: input.title, goal_text: input.goal_text, audience: input.audience, days_per_week: input.days_per_week,
        review_on: input.review_on, auto_medals: input.auto_medals,
        lint_overrides: mergeOverrides((draft ?? live)?.lint_overrides, planTextAlerts(input), input.review_note, email, now),
        updated_by_email: email, updated_at: now,
      };
      let target: PlanRow;
      if (draft && input.id) {
        target = Object.assign(draft, planFields);
      } else {
        target = {
          id: uuid(), patient_id: p.id, version: Math.max(0, ...plans.map((x) => x.version)) + 1,
          supersedes_id: live?.id ?? null, status: "borrador", ...planFields, on_break_until: null,
          professional_id: null, author_label: null, adolescent_ack: false,
          created_by_email: email, created_at: now,
          published_at: null, published_by_email: null, closed_at: null, closed_by_email: null, close_reason: null,
          last_reviewed_at: null, last_reviewed_by_email: null, last_reviewed_label: null,
        };
        db.practice_plans.push(target);
      }
      const touched = new Set<string>();
      prepared.forEach(({ e, row }, position) => {
        const prev = row ?? (e.exercise_key ? latestOfKey(e.exercise_key) : undefined);
        const fields = {
          source: e.source, catalog_id: e.catalog_id,
          catalog_version: e.source === "manual" ? null : e.catalog_version ?? CATALOG_VERSION,
          approach: e.approach, practiced_in_session: e.practiced_in_session, title: e.title, para_que: e.para_que,
          pasos: [...e.pasos], minutes: e.minutes, materiales: e.materiales, for_adult: e.for_adult,
          si_cuesta: e.si_cuesta, with_adult: e.with_adult, position,
          lint_overrides: mergeOverrides(prev?.lint_overrides, exerciseTextAlerts(e, e.approach), e.review_note, email, now),
          reviewed_at: e.reviewed ? row?.reviewed_at ?? now : null,
          reviewed_by_email: e.reviewed ? row?.reviewed_by_email ?? email : null,
          removed_at: e.removed ? row?.removed_at ?? now : null,
          removed_by_email: e.removed ? row?.removed_by_email ?? email : null,
          updated_at: now,
          ...(activitiesOn() ? { activity: e.activity } : {}),
        };
        // Procedencia de la IA (como el trigger): el borrador queda como
        // usado y el ejercicio, como adaptado con IA para siempre
        const draftId = e.ai_draft_id ?? row?.ai_draft_id ?? null;
        if (e.ai_draft_id && e.ai_draft_id !== row?.ai_draft_id) {
          const d = db.ai_drafts.find((x) => x.id === e.ai_draft_id);
          if (d && d.status === "generado") Object.assign(d, { status: "usado", used_at: now });
        }
        if (row) {
          Object.assign(row, fields, { ai_draft_id: draftId, ai_drafted: row.ai_drafted || !!e.ai_draft_id });
          touched.add(row.id);
        } else {
          db.practice_exercises.push({
            id: uuid(), plan_id: target.id, patient_id: p.id, exercise_key: e.exercise_key ?? uuid(), ...fields,
            ai_draft_id: e.ai_draft_id, ai_drafted: !!e.ai_draft_id, edit_ratio: null, created_at: now,
          });
        }
      });
      // Lo que estaba en el borrador y ya no vino queda quitado (no se borra)
      for (const r of draftRows) {
        if (touched.has(r.id) || r.removed_at) continue;
        Object.assign(r, { removed_at: now, removed_by_email: email, updated_at: now });
      }
      return ok(true as const);
    }

    // Publicar el borrador: reemplaza el publicado (si había), copia el
    // "Visto" y publica las metas en borrador del plan (practice_publish_plan)
    case "plan_publish": {
      if (!validId(b.plan_id) || typeof b.expected_updated_at !== "string") return invalid();
      const expectedPublished = b.expected_published_id ?? null;
      if (expectedPublished !== null && !validId(expectedPublished)) return invalid();
      const noAuthor = requireAuthor();
      if (noAuthor) return noAuthor;
      if (settingsOf(db, p.id)?.paused_at) return fail(409, PRACTICE_PAUSED);
      const draft = plans.find((x) => x.id === b.plan_id);
      if (!draft || draft.status !== "borrador" || draft.updated_at !== b.expected_updated_at) return conflict();
      if ((live?.id ?? null) !== expectedPublished) return conflict();
      const adolescent = isAdolescent(p.age);
      const ack = adolescent && b.adolescent_ack === true;
      const problem = publishProblem(publishCheckOf(db, draft), {
        age: p.age, diagnosis_code: p.diagnosis_code, adolescent_ack: !adolescent || ack,
      });
      if (problem) return fail(400, problem.error, { code: problem.code });
      const now = stamp(draft.updated_at);
      // Cuánto se editó el texto de la IA (si casi nunca se edita, puede ser
      // que se esté aprobando sin leer)
      for (const e of planRows(db, draft.id)) if (!e.removed_at && e.ai_drafted) e.edit_ratio = aiEditRatio(db, e);
      // La pausa de vacaciones del plan que se reemplaza sigue en la versión nueva
      const keepBreak = live && !draft.on_break_until && onBreak(live.on_break_until, today) ? live.on_break_until : draft.on_break_until;
      if (live) {
        Object.assign(live, {
          status: "reemplazado", closed_at: now, closed_by_email: email, close_reason: "reemplazado",
          updated_at: now, updated_by_email: email,
        });
      }
      // supersedes_id: el plan que de verdad reemplaza (el publicado ahora). El
      // borrador pudo armarse sobre una versión que después se finalizó o se
      // retiró: esa ya no es parte de la cadena (sus metas no vuelven a valer)
      Object.assign(draft, {
        status: "publicado", published_at: now, published_by_email: email, professional_id: author.professional_id,
        author_label: author.label, adolescent_ack: ack, supersedes_id: live?.id ?? null,
        on_break_until: keepBreak,
        last_reviewed_at: draft.last_reviewed_at ?? live?.last_reviewed_at ?? null,
        last_reviewed_by_email: draft.last_reviewed_by_email ?? live?.last_reviewed_by_email ?? null,
        last_reviewed_label: draft.last_reviewed_label ?? live?.last_reviewed_label ?? null,
        updated_at: now, updated_by_email: email,
      });
      for (const g of db.practice_goals) {
        if (g.plan_id === draft.id && g.status === "borrador") {
          Object.assign(g, { status: "activa", published_at: now, published_by_email: email, updated_at: now });
        }
      }
      return ok(true as const);
    }

    // Pausa de vacaciones: until es la fecha de vuelta (posterior a hoy); null la termina
    case "plan_break": {
      const plan = planOf(b.plan_id);
      if (!isRow(plan)) return plan;
      if (plan.status !== "publicado") return conflict();
      const raw = b.until;
      let until: string | null = null;
      if (raw !== null && raw !== undefined) {
        if (!validDateKey(raw) || raw <= today) return fail(400, BREAK_DATE, { code: "INVALID" });
        until = raw;
      }
      Object.assign(plan, { on_break_until: until, updated_at: stamp(plan.updated_at), updated_by_email: email });
      return ok(true as const);
    }

    // Finalizar: como al retirarlo, con él terminan las metas de su cadena de
    // versiones (él y las que reemplazó): las activas y las en borrador quedan
    // "cambiada" (la familia deja de verlas y ya no se podrían publicar). Las
    // logradas siguen: las dio una devolución
    case "plan_finish": {
      const plan = planOf(b.plan_id);
      if (!isRow(plan)) return plan;
      if (plan.status !== "publicado") return conflict();
      const now = stamp(plan.updated_at);
      Object.assign(plan, {
        status: "finalizado", closed_at: now, closed_by_email: email, close_reason: "finalizado",
        updated_at: now, updated_by_email: email,
      });
      retireChainGoals(db, plan, email, now);
      return ok(true as const);
    }

    // Un borrador se descarta; lo publicado lo retira quien lo publicó o la Dirección
    case "plan_withdraw": {
      const plan = planOf(b.plan_id);
      if (!isRow(plan)) return plan;
      const now = stamp(plan.updated_at);
      if (plan.status === "borrador") {
        Object.assign(plan, {
          status: "retirado", closed_at: now, closed_by_email: email, close_reason: "descartado",
          updated_at: now, updated_by_email: email,
        });
        return ok(true as const);
      }
      if (plan.status !== "publicado") return conflict();
      const reason = PLAN_WITHDRAW_REASONS.find((x) => x === b.reason);
      if (!reason) return fail(400, "Elegí el motivo.", { code: "INVALID" });
      if (staff.role !== "direccion" && plan.published_by_email !== email) return fail(403, ONLY_OWNER);
      Object.assign(plan, {
        status: "retirado", closed_at: now, closed_by_email: email, close_reason: reason, updated_at: now, updated_by_email: email,
      });
      // Con él se retiran las metas de toda su cadena (las de las versiones que
      // reemplazó seguían activas), como al finalizarlo
      retireChainGoals(db, plan, email, now);
      return ok(true as const);
    }

    // "Visto": la familia lee "Lic. … vio las prácticas el …" con el nombre
    // de quien lo marcó (por eso hace falta que publique con su nombre). Con
    // el plan finalizado o retirado, saca lo pendiente de la bandeja
    case "mark_seen": {
      const noAuthor = requireAuthor();
      if (noAuthor) return noAuthor;
      if (!reviewPlan) return fail(409, NOTHING_TO_REVIEW, { code: "CONFLICT" });
      const now = stamp(reviewPlan.updated_at);
      Object.assign(reviewPlan, {
        last_reviewed_at: now, last_reviewed_by_email: email, last_reviewed_label: author.label,
        updated_at: now, updated_by_email: email,
      });
      return ok(true as const);
    }

    // La devolución, las metas que se dan por logradas, la medalla y el
    // "Visto", en un solo paso (practice_send_feedback)
    case "feedback_send": {
      const noAuthor = requireAuthor();
      if (noAuthor) return noAuthor;
      const v = validateFeedback(b.feedback, { adolescent: isAdolescent(p.age) });
      if (!v.ok) return fail(400, v.error, { code: v.code });
      const f = v.value;
      if (f.plan_id && !plans.some((x) => x.id === f.plan_id)) return invalid();
      const planId = f.plan_id ?? live?.id ?? null;
      const goals = f.goal_ids.map((id) => db.practice_goals.find((g) => g.id === id && g.patient_id === p.id));
      if (goals.some((g) => !g || g.status !== "activa")) return fail(409, PRACTICE_ERROR.goal_not_active, { code: "CONFLICT" });
      const medalGoal = f.medal?.goal_id ?? null;
      if (medalGoal) {
        if (!db.practice_goals.some((g) => g.id === medalGoal && g.patient_id === p.id)) return invalid();
        if (db.practice_medals.some((m) => m.kind === "profesional" && m.goal_id === medalGoal && !m.voided_at)) {
          return fail(409, GOAL_HAS_MEDAL, { code: "CONFLICT" });
        }
      }
      const reviewed = lastReviewedOf(db, p.id);
      const now = stamp(reviewPlan?.updated_at);
      const id = uuid();
      db.practice_feedback.push({
        id, patient_id: p.id, plan_id: planId, professional_id: author.professional_id, author_label: author.label ?? "",
        body: f.body, for_adult: f.for_adult,
        period_start: reviewed ? centerDateOf(reviewed) : live?.published_at ? centerDateOf(live.published_at) : null,
        period_end: today, adolescent_ack: f.adolescent_ack, review_note: f.review_note, ai_draft_id: null,
        ai_drafted: false, sent_at: now, sent_by_email: email, withdrawn_at: null, withdrawn_by_email: null,
        withdraw_reason: null,
      });
      for (const g of goals) if (g) Object.assign(g, { status: "lograda", achieved_at: now, feedback_id: id, updated_at: now });
      if (f.medal) {
        db.practice_medals.push({
          id: uuid(), patient_id: p.id, kind: "profesional", code: "profesional", title: f.medal.title, period_key: "",
          plan_id: planId, goal_id: medalGoal, feedback_id: id, message: f.medal.message, awarded_at: now,
          awarded_by_email: email, voided_at: null, voided_by_email: null, void_reason: null,
        });
      }
      // También es "Visto" (en el plan publicado o, si ya no hay, en el último)
      if (reviewPlan) {
        Object.assign(reviewPlan, {
          last_reviewed_at: now, last_reviewed_by_email: email, last_reviewed_label: author.label,
          updated_at: now, updated_by_email: email,
        });
      }
      return ok(true as const);
    }

    // Cada profesional retira las suyas; la Dirección, cualquiera. En el mismo
    // paso, lo que la devolución dio deja de valer: las metas que dio por
    // logradas vuelven a activas (o quedan "cambiada" si su plan ya se cerró)
    // y su medalla queda anulada
    case "feedback_withdraw": {
      if (!validId(b.feedback_id)) return invalid();
      const reason = FEEDBACK_WITHDRAW_REASONS.find((x) => x === b.reason);
      if (!reason) return fail(400, "Elegí el motivo.", { code: "INVALID" });
      const f = db.practice_feedback.find((x) => x.id === b.feedback_id && x.patient_id === p.id);
      if (!f) return fail(404, "No encontramos esa devolución.");
      if (f.withdrawn_at) return fail(409, ALREADY_WITHDRAWN, { code: "CONFLICT" });
      if (staff.role !== "direccion" && f.sent_by_email !== email) return fail(403, ONLY_OWNER);
      const now = new Date().toISOString();
      Object.assign(f, { withdrawn_at: now, withdrawn_by_email: email, withdraw_reason: reason });
      for (const g of db.practice_goals) {
        if (g.feedback_id !== f.id || g.status !== "lograda") continue;
        // Una meta de un plan finalizado o retirado no vuelve a verse
        Object.assign(g, goalPlanOpen(db, g)
          ? { status: "activa", achieved_at: null, feedback_id: null, updated_at: now }
          : { status: "cambiada", achieved_at: null, feedback_id: null, changed_at: now, changed_by_email: email, updated_at: now });
      }
      for (const m of db.practice_medals) {
        if (m.feedback_id !== f.id || m.kind !== "profesional" || m.voided_at) continue;
        Object.assign(m, { voided_at: now, voided_by_email: email, void_reason: FEEDBACK_WITHDRAWN_VOID });
      }
      return ok(true as const);
    }

    // Crea o edita una meta en borrador (nada se ve en el portal por guardarla)
    case "goal_save": {
      const v = validateGoal(b.goal);
      if (!v.ok) return fail(400, v.error, { code: v.code });
      const g = v.value;
      if (g.plan_id && !plans.some((x) => x.id === g.plan_id && (x.status === "borrador" || x.status === "publicado"))) {
        return invalid();
      }
      const now = new Date().toISOString();
      const fields = {
        plan_id: g.plan_id, kind: g.kind, title: g.title, rule: g.rule, medal_title: g.medal_title,
        agreed_with_patient: g.agreed_with_patient, updated_at: now,
      };
      if (g.id) {
        const row = db.practice_goals.find((x) => x.id === g.id && x.patient_id === p.id && x.status === "borrador");
        if (!row) return fail(409, GOAL_NOT_DRAFT, { code: "CONFLICT" });
        Object.assign(row, fields);
      } else {
        db.practice_goals.push({
          id: uuid(), patient_id: p.id, ...fields, status: "borrador", created_by_email: email, created_at: now,
          published_at: null, published_by_email: null, achieved_at: null, feedback_id: null,
          changed_at: null, changed_by_email: null, met_notice_dismissed_at: null,
        });
      }
      return ok(true as const);
    }

    // "Publicar meta" (también se publican junto con el plan)
    case "goal_publish": {
      const g = goalOf(b.goal_id);
      if (!isRow(g)) return g;
      if (g.status !== "borrador") return fail(409, GOAL_NOT_DRAFT, { code: "CONFLICT" });
      // Una meta de un plan ya cerrado (finalizado, retirado o descartado) no se publica
      if (!goalPlanOpen(db, g)) return fail(409, GOAL_PLAN_CLOSED, { code: "CONFLICT" });
      // La de un plan en borrador sale junto con él (si se descarta, no quedó a la vista)
      if (db.practice_plans.some((x) => x.id === g.plan_id && x.status === "borrador")) {
        return fail(409, GOAL_WITH_DRAFT, { code: "CONFLICT" });
      }
      const terms = [...new Set([...blockForTitles(g.title), ...blockForTitles(g.medal_title)])];
      if (terms.length) return fail(400, FLUENCY_TITLE_MESSAGE, { code: "TITLE_BLOCK" });
      if (isAdolescent(p.age) && b.adolescent_ack !== true) return fail(400, PRACTICE_ERROR.adolescent_ack, { code: "ADOLESCENT_ACK" });
      const now = new Date().toISOString();
      Object.assign(g, { status: "activa", published_at: now, published_by_email: email, updated_at: now });
      return ok(true as const);
    }

    // Una meta activa que ya no va: queda "cambiada" (nunca "no cumplida")
    case "goal_change": {
      const g = goalOf(b.goal_id);
      if (!isRow(g)) return g;
      if (g.status !== "activa") return fail(409, PRACTICE_ERROR.goal_not_active, { code: "CONFLICT" });
      const now = new Date().toISOString();
      Object.assign(g, { status: "cambiada", changed_at: now, changed_by_email: email, updated_at: now });
      return ok(true as const);
    }

    // "Todavía no" en la bandeja (meta de práctica cumplida)
    case "goal_not_yet": {
      const g = goalOf(b.goal_id);
      if (!isRow(g)) return g;
      if (g.status !== "activa" || g.kind !== "practica") return fail(409, PRACTICE_ERROR.goal_not_active, { code: "CONFLICT" });
      const now = new Date().toISOString();
      Object.assign(g, { met_notice_dismissed_at: now, updated_at: now });
      return ok(true as const);
    }

    // Anular una medalla (solo para errores, con motivo). No se borra
    case "medal_void": {
      if (!validId(b.medal_id)) return invalid();
      const reason = String(b.reason ?? "").replace(/\s+/g, " ").trim();
      if (reason.length < 3) return fail(400, PRACTICE_ERROR.void_reason, { code: "INVALID" });
      if (reason.length > PRACTICE_LIMITS.void_reason) {
        return fail(400, `El motivo es muy largo: el máximo es ${PRACTICE_LIMITS.void_reason} caracteres.`, { code: "INVALID" });
      }
      const m = db.practice_medals.find((x) => x.id === b.medal_id && x.patient_id === p.id);
      if (!m) return fail(404, "No encontramos esa medalla.");
      if (m.voided_at) return fail(409, ALREADY_VOIDED, { code: "CONFLICT" });
      Object.assign(m, { voided_at: new Date().toISOString(), voided_by_email: email, void_reason: reason });
      return ok(true as const);
    }

    default:
      return fail(400, "Acción inválida");
  }
}

/**
 * Todas las acciones de la vista (POST /api/portal-staff/practice); todas
 * devuelven la vista actualizada. "get" lo puede pedir cualquier rol
 * (Administración, sin textos); el resto, solo profesionales y Dirección
 * (403). Errores con code: CONFLICT, REVIEW, TITLE_BLOCK, AI_NOT_REVIEWED,
 * APPROACH, EXERCISES, ADOLESCENT_ACK, AUTHOR, INVALID (como el servidor).
 */
export async function staffPracticeAction(body: PracticeAction, issuedBy: string): Promise<ApiResult<StaffPracticeDTO>> {
  await wait(350);
  if (!FEATURES.includes("practice")) return fail(404, NOT_AVAILABLE);
  const staff = await currentStaff(issuedBy);
  if (!staff.ok) return staff;
  // Como el servidor, se revisa cada valor (no se confía en el tipo)
  const b = (body ?? {}) as unknown as Record<string, unknown>;
  const patientId = b.patient_id;
  if (!validId(patientId)) return fail(400, "Pedido inválido");
  if (!PRACTICE_ACTIONS.includes(b.action)) return fail(400, "Acción inválida");
  if (b.action === "get") return staffPractice(staff, patientId);
  if (!staff.clinical) return fail(403, PRACTICE_ERROR.clinical_only);
  if (b.action === "catalog") return staffPractice(staff, patientId, true);
  const p = await practicePatient(load(), patientId);
  if (!p) return fail(404, PATIENT_NOT_FOUND);
  const author = authorOf(staff, await panelProfessionals());

  // De acá en adelante, sin esperas y con la base recién leída: si otra
  // pestaña cambió algo mientras tanto, se ve en las comparaciones
  const db = load();
  const done = applyPracticeAction(db, staff, author, p, b, centerNow().date);
  if (!done.ok) return done;
  save(db);
  return staffPractice(staff, patientId);
}

// ── Bandeja: Portal → "Prácticas" (solo perfiles clínicos) ──

// Una fila por paciente con prácticas o comentarios sin ver (los de riesgo
// primero; después, lo pendiente más viejo) y, al final, una por cada meta de
// práctica cumplida que todavía no se dio por lograda
async function practiceInboxItems(db: Db, staff: Staff): Promise<StaffPracticeInboxItem[]> {
  const today = centerNow().date;
  const cutoff = new Date(Date.now() - INBOX_DAYS * DAY_MS).toISOString();
  const ids = [...new Set([
    ...db.practice_plans.filter((x) => x.status !== "borrador").map((x) => x.patient_id),
    ...db.practice_goals.filter((g) => g.status === "activa" && g.kind === "practica" && !g.met_notice_dismissed_at).map((g) => g.patient_id),
  ])];
  if (!ids.length) return [];
  const names = await patientInfo(db, ids);
  const practiceRows: StaffPracticeInboxItem[] = [];
  const goalRows: StaffPracticeInboxItem[] = [];
  for (const id of ids) {
    const p = await practicePatient(db, id);
    if (!p) continue;
    const plan = livePlan(db, id);
    const pending = practicePending(db, id, today, true, cutoff);
    const base = {
      patient_id: id, patient_name: names.get(id)?.name ?? "Paciente", professional_id: p.professional_id,
      mine: isMine(staff, p), pending, last_reviewed_at: lastReviewedOf(db, id),
      on_break: !!plan && onBreak(plan.on_break_until, today),
    };
    if (pending.logs || pending.comments || pending.costo || pending.risk) practiceRows.push({ kind: "practicas", ...base, goal: null });
    for (const g of goalsMet(staffGoals(db, id, false, today))) {
      goalRows.push({ kind: "meta_cumplida", ...base, goal: { id: g.goal_id, title: g.title ?? "", met_on: g.met_on } });
    }
  }
  practiceRows.sort((x, y) => Number(y.pending.risk > 0) - Number(x.pending.risk > 0)
    || (x.pending.since ?? "").localeCompare(y.pending.since ?? ""));
  goalRows.sort((x, y) => (x.goal?.met_on ?? "").localeCompare(y.goal?.met_on ?? ""));
  return [...practiceRows, ...goalRows];
}

// ── "Adaptar con ayuda de IA" (equipo, etapa D) ─────────────────────────────
// En producción: POST /api/portal-staff/ai-draft (server/lib/aiDrafts.ts y
// server/lib/openrouter.ts). El mock no llama a ninguna IA: devuelve el texto
// del catálogo como plantilla (mockDraft, con «Borrador de ejemplo (modo
// demo, sin IA)»), después de una espera corta. Mismas validaciones, límites
// y mensajes; queda registrado en ai_drafts (lo que se mandaría, nunca datos
// que identifiquen al paciente).

const AI_PERSON_WINDOW_MAX = 20; // por persona cada 10 minutos (script 8)
const AI_PERSON_WINDOW_MS = 10 * 60 * 1000;
const AI_PERSON_DAILY_MAX = 100; // por persona por día

export async function staffAiDraft(req: AiDraftRequest, issuedBy: string): Promise<ApiResult<AiDraftResult>> {
  await wait(300);
  const staff = await currentStaff(issuedBy);
  if (!staff.ok) return staff;
  if (!staff.clinical) return fail(403, NOT_CLINICAL);
  if (!FEATURES.includes("ai")) return fail(503, AI_ERROR.unavailable, { code: "AI_UNAVAILABLE" });
  // Como el servidor, se revisa cada valor (no se confía en el tipo)
  const b = req && typeof req === "object" && !Array.isArray(req) ? (req as unknown as Record<string, unknown>) : null;
  if (!b || !validId(b.patient_id)) return fail(400, "Pedido inválido");
  const p = await practicePatient(load(), b.patient_id);
  if (!p) return fail(404, PATIENT_NOT_FOUND);
  // La edad y el diagnóstico se leen acá y no viajan: solo la franja y el enfoque
  const built = buildAdaptParams(b, { age: p.age, diagnosis_code: p.diagnosis_code });
  if (!built.ok) return fail(400, built.error);
  if (built.params.actividad && !activitiesOn()) return fail(400, "Los juegos para el celular no están disponibles.");

  // Tope del centro por día y límite por persona (cuentan también los que
  // salieron con error)
  const started = Date.now();
  const before = load().ai_drafts;
  const mine = before.filter((d) => d.requested_by_email === staff.email);
  const today = centerNow().date;
  if (before.filter((d) => centerDateOf(d.created_at) === today).length >= AI_DRAFT_DAILY_CAP_DEFAULT
    || mine.filter((d) => started - Date.parse(d.created_at) < AI_PERSON_WINDOW_MS).length >= AI_PERSON_WINDOW_MAX
    || mine.filter((d) => started - Date.parse(d.created_at) < DAY_MS).length >= AI_PERSON_DAILY_MAX) {
    return fail(429, AI_ERROR.limit, { code: "AI_LIMIT" });
  }

  // "Preparando una propuesta…" (con la IA real tarda de 10 a 25 segundos)
  await wait(1500 + Math.floor(Math.random() * 700));
  const parsed = parseExerciseDraft(
    mockDraft(built.params, built.entries), built.params.catalogo.ids, built.params.minutos, built.params.enfoque,
    built.params.actividad ?? null,
  );

  // Se registra el pedido antes de devolver el borrador (con la base recién leída)
  const db = load();
  const id = uuid();
  db.ai_drafts.push({
    id, kind: "adaptacion", patient_id: p.id, requested_by_email: staff.email, model: MOCK_AI_MODEL,
    prompt_version: PROMPT_VERSION, catalog_version: built.params.catalogo.version, params: built.params,
    output: parsed.ok ? parsed.draft : null, flags: parsed.ok ? parsed.flags : [],
    status: parsed.ok ? "generado" : "error", error_code: parsed.ok ? null : parsed.code,
    latency_ms: Date.now() - started, used_at: null, created_at: new Date().toISOString(),
  });
  save(db);
  if (!parsed.ok) return fail(502, AI_ERROR.failed, { code: "AI_FAILED" });
  return ok({ draft_id: id, draft: parsed.draft, flags: parsed.flags, sent: describeSent(built.params, built.entries), demo: true });
}

// ── «Me grabo» (etapa recordings) ───────────────────────────────────────────
// En la demo, las grabaciones viven en la memoria de esta pestaña (el audio no
// entra en el almacenamiento del navegador): al recargar quedan solo las de
// ejemplo. La demo no reconoce voz: cada grabación nueva lleva el análisis de
// ejemplo (lo que devolvió Azure para el audio de /demo/me-grabo-demo.wav, una
// voz sintética: «Hoy fui a la plaza con mi mamá… la pe pe pelota… eh…»).

const recordingsOn = () => FEATURES.includes("practice") && FEATURES.includes("activities") && FEATURES.includes("recordings");

const DEMO_AZURE = {
  RecognitionStatus: "Success",
  NBest: [{
    Words: ([
      ["hoy", 0.21, 0.21], ["fui", 0.43, 0.25], ["a", 0.69, 0.05], ["la", 0.75, 0.11], ["plaza", 0.87, 0.31],
      ["con", 1.19, 0.18], ["mi", 1.38, 0.1], ["mam", 1.49, 0.28], ["jugamos", 4.42, 0.6], ["a", 5.03, 0.04],
      ["la", 5.08, 0.11], ["pc", 5.2, 0.26], ["pelota", 5.47, 0.36], ["y", 5.84, 0.05], ["después", 5.9, 0.47],
      ["e", 6.38, 0.41], ["comimos", 6.8, 0.51], ["un", 7.32, 0.07], ["helado", 7.4, 0.39],
    ] as const).map(([Word, st, d]) => ({ Word, Offset: Math.round(st * 1e7), Duration: Math.round(d * 1e7) })),
  }],
};
const demoAnalysis = () => ({ ...analyzeWords(parseAzureDetailed(DEMO_AZURE)!), source: "azure" as const });

type MockRecording = Omit<StaffRecordingDTO, "exercise_title" | "consigna" | "texto" | "audio"> & {
  patient_id: string; exercise_id: string; account_id: string | null; url: string;
};
const recordingConsents = new Map<string, boolean>();
const demoCreated = new Date(Date.now() - 2 * 86_400_000).toISOString();
const EXAMPLE_RECORDING_ID = "6e1a3c7f-9b8d-4fa0-8c2e-7d6b5a4f3e28";
const mockRecordings: MockRecording[] = [{
  id: EXAMPLE_RECORDING_ID, patient_id: "c-martin", exercise_id: DEMO_RECORDING_EXERCISE.id, account_id: "acc-laura",
  url: "/demo/me-grabo-demo.wav", created_at: demoCreated, duration_ms: 8_550, status: "lista", analysis: demoAnalysis(),
  review: null, reviewed_at: null, reviewed_by_email: null, delete_after: deleteAfter(demoCreated),
}];

export async function recordingConsent(): Promise<ApiResult<{ accepted: boolean; version: string }>> {
  if (!recordingsOn()) return fail(404, NOT_AVAILABLE);
  const acc = requireAccount(load());
  if (!acc) return fail(401, SESSION_EXPIRED);
  return ok({ accepted: recordingConsents.get(acc.id) === true, version: RECORDING_NOTICE_VERSION });
}

export async function recordingAccept(accept: boolean): Promise<ApiResult<{ accepted: boolean; version: string }>> {
  if (!recordingsOn()) return fail(404, NOT_AVAILABLE);
  await wait(300);
  const acc = requireAccount(load());
  if (!acc) return fail(401, SESSION_EXPIRED);
  recordingConsents.set(acc.id, accept === true);
  return ok({ accepted: accept === true, version: RECORDING_NOTICE_VERSION });
}

export async function recordingUpload(exerciseId: string, wav: Uint8Array): Promise<ApiResult<{ id: string; status: RecordingStatus }>> {
  if (!recordingsOn()) return fail(404, NOT_AVAILABLE);
  await wait(900);
  const db = load();
  const acc = requireAccount(db);
  if (!acc) return fail(401, SESSION_EXPIRED);
  const row = validId(exerciseId) ? db.practice_exercises.find((e) => e.id === exerciseId) : undefined;
  if (!row) return fail(404, EXERCISE_NOT_FOUND);
  const gate = await practiceGate(db, acc, row.patient_id);
  if (!("acc" in gate)) return gate.ok === false && gate.status === 404 ? fail(404, EXERCISE_NOT_FOUND) : gate;
  const cur = currentOf(load(), row.patient_id, row.exercise_key);
  const act = cur ? readActivity(cur.ex.activity ?? null) : null;
  if (!cur || !act || act.mecanica !== "grabacion") return fail(404, "Este ejercicio no pide una grabación.");
  if (recordingConsents.get(acc.id) !== true) return fail(403, "Para mandar grabaciones, primero aceptá el permiso.", { code: "RECORDING_CONSENT" });
  const ms = wavDurationMs(wav);
  if (ms === null || ms < RECORDING_MIN_MS) return fail(400, "No pudimos leer la grabación. Probá grabar de nuevo.");
  if (ms > act.segundos * 1000 + 1500) return fail(400, `La grabación dura hasta ${act.segundos} segundos.`);
  const created = new Date().toISOString();
  const id = crypto.randomUUID();
  mockRecordings.unshift({
    id, patient_id: row.patient_id, exercise_id: cur.ex.id, account_id: acc.id,
    url: URL.createObjectURL(new Blob([wav as BlobPart], { type: "audio/wav" })),
    created_at: created, duration_ms: ms, status: "lista", analysis: demoAnalysis(),
    review: null, reviewed_at: null, reviewed_by_email: null, delete_after: deleteAfter(created),
  });
  return ok({ id, status: "lista" as RecordingStatus });
}

export async function staffRecordings(body: RecordingsAction): Promise<ApiResult<RecordingsResult>> {
  await wait(300);
  if (!recordingsOn()) return fail(404, NOT_AVAILABLE);
  const staff = await currentStaff("");
  if (!staff.ok) return staff;
  if (!staff.clinical) return fail(403, "Solo los profesionales y la Dirección pueden hacer esto.");
  const b = (body ?? {}) as unknown as Record<string, unknown>;
  if (b.action === "list") {
    if (!validId(b.patient_id)) return fail(400, "Pedido inválido");
    if (!mockIsMyPatient(String(b.patient_id))) return fail(403, "Ese paciente no está a tu cargo.");
    const db = load();
    // Los pacientes del panel de la demo no son los del portal: uno sin
    // grabaciones propias muestra la de ejemplo, para ver cómo se revisa
    const own = mockRecordings.filter((r) => r.patient_id === b.patient_id);
    const shown = own.length ? own : mockRecordings.filter((r) => r.id === EXAMPLE_RECORDING_ID);
    const items: StaffRecordingDTO[] = shown.map((r) => {
      const ex = db.practice_exercises.find((e) => e.id === r.exercise_id);
      const act = ex ? readActivity(ex.activity ?? null) : null;
      const rec = act?.mecanica === "grabacion" ? act : null;
      const { patient_id: _p, exercise_id: _e, account_id: _a, url: _u, ...dto } = r;
      return { ...dto, exercise_title: ex?.title ?? "Ejercicio", consigna: rec?.consigna ?? null, texto: rec?.texto ?? null, audio: true };
    });
    return ok({ items });
  }
  const rec = mockRecordings.find((r) => r.id === b.id);
  if (!rec) return fail(404, "No encontramos esa grabación.");
  if (rec.id !== EXAMPLE_RECORDING_ID && !mockIsMyPatient(rec.patient_id)) return fail(403, "Ese paciente no está a tu cargo.");
  if (b.action === "audio") return ok({ url: rec.url });
  if (b.action === "review") {
    const v = validateReview(b);
    if (!v.ok) return fail(400, v.error);
    Object.assign(rec, { review: v.value, status: "revisada", reviewed_at: new Date().toISOString(), reviewed_by_email: staff.email });
    return ok({ ok: true as const });
  }
  if (b.action === "reanalyze") return ok({ status: rec.status });
  return fail(400, "Pedido inválido");
}
