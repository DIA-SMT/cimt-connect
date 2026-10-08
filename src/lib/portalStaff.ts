// Portal de familias — lado del equipo (panel interno).
// Invitar a un adulto responsable y ver el estado de su acceso. Todas las
// personas del panel pueden invitar (relevamiento: la bandeja la ven todos).
// En modo mock usa mockPortal.ts; si no, server/api/portal-staff/access con
// la sesión del panel.

import { supabase } from "@/integrations/supabase/client";
import { CENTER } from "@/lib/center";
import { PORTAL_ENABLED, type ApiResult } from "@/lib/portal";

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
  | { state: "pausado" };

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

async function staffCall<T>(body: unknown): Promise<ApiResult<T>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/portal-staff/access", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: typeof json.error === "string" ? json.error : "No se pudo conectar con el servidor." };
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
    if (MOCK) return (await mock()).staffAccessStatus(guardian.dni, patientId);
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
};
