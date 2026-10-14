// Portal — reglas de acceso a la información de salud (etapa A).
// Puras: las usan el servidor (server/lib/portalClinical.ts), el modo mock y
// las pruebas. Sin alias de imports: el servidor importa este archivo con
// ruta relativa.
//
// Regla de base: nada clínico se ve en el portal salvo que TODO esto se
// cumpla para esa cuenta y ese paciente. Lo que no se puede ver se explica a
// la familia con muy pocas respuestas posibles (nunca el motivo real: una
// orden judicial o que el adolescente no dio su conformidad no se revelan).

// ── Etapas que se prenden en el servidor (PORTAL_CLINICAL_FEATURES) ──────────
export const CLINICAL_FEATURES = ["consent", "info", "practice", "ai", "docs", "hc_digital"] as const;
export type ClinicalFeature = (typeof CLINICAL_FEATURES)[number];

export function parseFeatures(raw: string | null | undefined): ClinicalFeature[] {
  const wanted = new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return CLINICAL_FEATURES.filter((f) => wanted.has(f));
}

// Aviso para ver información de salud. Es un borrador hasta que lo apruebe
// el área legal: mientras tanto la etapa "consent" queda apagada en producción.
export const CLINICAL_NOTICE_VERSION = "2026-11-v3";

// Desde esta edad, y hasta los 17, hace falta la conformidad del adolescente
export const ADOLESCENT_FROM = 13;
export const ADULT_FROM = 18;

// "Volvé a poner tu contraseña": para ver información (ventana que se
// renueva con el uso) y para descargar documentos
export const REAUTH_INFO_HOURS = 12;
export const REAUTH_DOWNLOAD_MIN = 15;

export type ClinicalArea = "info" | "practice" | "hc";

// Motivos internos (solo los ve el equipo)
export type ClinicalBlock =
  | "autorizado" // adulto autorizado: ve solo los turnos
  | "bloqueado" // orden judicial
  | "sin_vinculo" // el vínculo no vale hoy (chico de 18, adulto quitado de la ficha…)
  | "no_habilitado" // el profesional todavía no lo prendió para este paciente
  | "pausado" // pausa por indicación profesional o judicial
  | "conformidad_adolescente" // 13 a 17 años sin conformidad (o la retiró)
  | "no_verificado" // falta verificar el vínculo en persona
  | "consentimiento"; // la cuenta no activó la información de salud

export type PortalSettings = {
  info_enabled: boolean;
  practice_enabled: boolean;
  paused_at: string | null;
  adolescent_agreed_on: string | null;
  adolescent_withdrawn_on: string | null;
};

export type ClinicalAccessInput = {
  link_kind: string; // titular | representante_legal | autorizado
  link_valid: boolean; // da acceso al portal hoy (linkValidity)
  hc_ok: boolean; // derecho a pedir la copia del historial (linkValidity)
  age: number | null;
  verified_in_person: boolean;
  parental_checked: boolean; // solo cuenta para representante_legal
  settings: PortalSettings | null;
  clinical_consent: boolean; // la cuenta activó la información de salud (aviso vigente)
  blocked: boolean;
};

// La conformidad del adolescente vale si la dio y no la retiró después
export function adolescentAgreed(s: Pick<PortalSettings, "adolescent_agreed_on" | "adolescent_withdrawn_on"> | null, age: number | null): boolean {
  if (age === null || age < ADOLESCENT_FROM || age >= ADULT_FROM) return true;
  if (!s?.adolescent_agreed_on) return false;
  return !s.adolescent_withdrawn_on || s.adolescent_withdrawn_on < s.adolescent_agreed_on;
}

// Orden fijo: el primer motivo que aplica es el que se informa al equipo.
// "hc" (copia digital del historial) es un derecho del paciente: no depende
// de que el profesional haya prendido el portal ni de la conformidad. La
// pausa ("Pausar todo lo clínico": indicación profesional u orden judicial)
// sí corta el canal digital de la copia; pedirla en mano sigue siempre (eso
// no pasa por esta regla).
export function clinicalAccess(i: ClinicalAccessInput, area: ClinicalArea): { ok: true } | { ok: false; block: ClinicalBlock } {
  if (i.link_kind === "autorizado") return { ok: false, block: "autorizado" };
  if (i.blocked) return { ok: false, block: "bloqueado" };
  if (area === "hc" ? !i.hc_ok : !i.link_valid) return { ok: false, block: "sin_vinculo" };
  if (area === "hc") {
    if (i.settings?.paused_at) return { ok: false, block: "pausado" };
  } else {
    const s = i.settings;
    if (!s || !(area === "info" ? s.info_enabled : s.practice_enabled)) return { ok: false, block: "no_habilitado" };
    if (s.paused_at) return { ok: false, block: "pausado" };
    if (!adolescentAgreed(s, i.age)) return { ok: false, block: "conformidad_adolescente" };
  }
  if (!i.verified_in_person || (i.link_kind === "representante_legal" && !i.parental_checked)) {
    return { ok: false, block: "no_verificado" };
  }
  if (!i.clinical_consent) return { ok: false, block: "consentimiento" };
  return { ok: true };
}

// Lo único que sale del servidor hacia la familia
export type PublicOutcome = "ok" | "consent" | "verify" | "not_available";

export function publicOutcome(r: { ok: true } | { ok: false; block: ClinicalBlock }): PublicOutcome {
  if (r.ok) return "ok";
  if (r.block === "consentimiento") return "consent";
  if (r.block === "no_verificado") return "verify";
  return "not_available";
}

// ¿Sigue vigente la contraseña confirmada? Para ver información la ventana
// se renueva con cada uso; para descargar cuenta desde la última confirmación.
export function reauthFresh(
  s: { verified_at: string; last_info_at: string | null } | null,
  need: "info" | "download",
  now: Date = new Date(),
  infoHours = REAUTH_INFO_HOURS,
  downloadMin = REAUTH_DOWNLOAD_MIN,
): boolean {
  if (!s) return false;
  const verified = Date.parse(s.verified_at);
  if (need === "download") return now.getTime() - verified < downloadMin * 60_000;
  const last = Math.max(verified, s.last_info_at ? Date.parse(s.last_info_at) : 0);
  return now.getTime() - last < infoHours * 3_600_000;
}

// ── Lo que ve la familia ──────────────────────────────────────────────────────

export type FamilyClinicalDTO = {
  features: ClinicalFeature[];
  consent: { accepted: boolean; version: string | null; current_version: string };
};

// Por persona vinculada (en /me)
export type ChildClinicalDTO = {
  info: PublicOutcome; practice: PublicOutcome;
  info_new?: number; // publicaciones que esta cuenta todavía no abrió (etapa "info", solo si info = ok)
};

// ── Lo que ve el equipo (sección "Portal del paciente" de la ficha) ─────────

export type StaffAccessRow = {
  link_id: string;
  account_id: string;
  name: string;
  link_kind: string; // titular | representante_legal | autorizado
  relationship: string | null; // "Madre", "Padre"… (de la ficha) o null para el titular
  link_valid: boolean;
  verified_in_person_on: string | null;
  parental_checked_on: string | null;
  consent: { accepted: boolean; version: string; channel: string; at: string } | null;
  info_block: ClinicalBlock | null; // null: lo ve
  practice_block: ClinicalBlock | null;
};

export type StaffGuardianRow = {
  guardian_id: string;
  name: string;
  relationship: string | null;
  dni: string | null;
  block: { id: string; reason: string; created_at: string; created_by_email: string } | null;
};

export type StaffClinicalDTO = {
  features: ClinicalFeature[];
  can_edit: boolean; // Dirección o profesional
  patient: { id: string; first_name: string; age: number | null; discharged: boolean };
  settings: PortalSettings & { updated_by_email: string | null; updated_at: string | null; pause_reason: string | null; adolescent_agreed_by_email: string | null };
  adolescent_required: boolean; // tiene entre 13 y 17
  accesses: StaffAccessRow[];
  guardians: StaffGuardianRow[];
  paper_files: { id: string; file_name: string; created_at: string }[]; // adjuntos "consentimiento" de la ficha
};
