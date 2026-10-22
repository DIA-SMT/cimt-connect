// «Me grabo»: las reglas que comparten el servidor (server/lib/recordings.ts),
// el portal, el panel, el modo demo y las pruebas. Puro y sin alias de imports.
//
// Decisiones del centro (octubre 2026):
//   - La grabación la pide el profesional (actividad «grabacion») y la manda
//     la familia. La escucha solo el equipo profesional del paciente
//     (Dirección y su profesional; Administración, no).
//   - Azure (es-AR, región Brasil) la reconoce y marca momentos para escuchar
//     (src/lib/recordingAnalysis.ts); el profesional valida con su conteo (%SS).
//   - El audio se borra a los 90 días; quedan los números del profesional.
//   - Hace falta un permiso propio de la cuenta (portal_consents, «grabaciones»),
//     además del de la información de salud. Grabarse es optativo.

import { type RecordingAnalysis, percentSS } from "./recordingAnalysis";

// v2: sin nombres de servicios (son internos)
export const RECORDING_NOTICE_VERSION = "2026-10-v2";
export const RECORDING_NOTICE_POINTS = [
  "La grabación la escucha solo el equipo profesional del CIMT que atiende al paciente.",
  "Para ayudar al profesional, un sistema de reconocimiento de voz la pasa a texto y marca momentos para escuchar. No decide nada: lo revisa el profesional.",
  "El audio se borra solo a los 90 días. Quedan las anotaciones del profesional.",
  "Grabarse es optativo: el ejercicio se puede hacer igual sin grabar.",
  "Si cambiás de idea, avisanos y dejamos de usar tus grabaciones.",
] as const;

export const RECORDING_KEEP_DAYS = 90;
export const RECORDING_DAILY_MAX = 10; // por cuenta y por día
export const RECORDING_MIN_MS = 1000;
// 60 s de WAV a 16 kHz, 16 bits, mono (con un segundo de margen)
export const RECORDING_MAX_BYTES = 44 + 2 * 16_000 * 61;
export const RECORDING_BUCKET = "practice-recordings";

export type RecordingStatus = "analizando" | "lista" | "error" | "revisada";
export const RECORDING_STATUS_LABEL: Record<RecordingStatus, string> = {
  analizando: "Analizando",
  lista: "Para escuchar",
  error: "Sin análisis",
  revisada: "Revisada",
};

export type RecordingReview = { stuttered: number; syllables: number; pss: number | null; note: string | null };

export type StaffRecordingDTO = {
  id: string;
  created_at: string;
  exercise_title: string;
  consigna: string | null;
  texto: string | null;
  duration_ms: number;
  status: RecordingStatus;
  analysis: RecordingAnalysis | null;
  review: RecordingReview | null;
  reviewed_at: string | null;
  reviewed_by_email: string | null;
  audio: boolean; // false: el audio ya se borró (pasaron los 90 días)
  delete_after: string;
};

export const REVIEW_NOTE_MAX = 600;

/** La revisión que manda el profesional: conteo de sílabas tartamudeadas y total */
export function validateReview(raw: unknown): { ok: true; value: RecordingReview } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const stuttered = Number(b.stuttered);
  const syllables = Number(b.syllables);
  if (!Number.isInteger(syllables) || syllables < 1 || syllables > 5000) return { ok: false, error: "Revisá el total de sílabas." };
  if (!Number.isInteger(stuttered) || stuttered < 0 || stuttered > syllables) return { ok: false, error: "Las sílabas tartamudeadas van de 0 al total." };
  const note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim() : "";
  if (note.length > REVIEW_NOTE_MAX) return { ok: false, error: `La nota tiene hasta ${REVIEW_NOTE_MAX} caracteres.` };
  return { ok: true, value: { stuttered, syllables, pss: percentSS(stuttered, syllables), note: note || null } };
}

/** Cuándo se borra el audio de una grabación hecha en ese momento */
export function deleteAfter(createdIso: string, days = RECORDING_KEEP_DAYS): string {
  return new Date(new Date(createdIso).getTime() + days * 86_400_000).toISOString();
}

/** Lo que queda del análisis cuando se borra el audio: los números, sin el texto de lo que se dijo */
export function stripAnalysis(a: RecordingAnalysis | null): RecordingAnalysis | null {
  return a ? { ...a, text: "", marks: a.marks.map((m) => ({ ...m, text: "" })) } : null;
}

// Lo que manda el panel (server/api/portal-staff/recordings.ts) y lo que vuelve
export type RecordingsAction =
  | { action: "list"; patient_id: string }
  | { action: "audio"; id: string }
  | { action: "review"; id: string; stuttered: number; syllables: number; note: string | null }
  | { action: "reanalyze"; id: string };
export type RecordingsResult = { items?: StaffRecordingDTO[]; url?: string; ok?: true; status?: RecordingStatus };
