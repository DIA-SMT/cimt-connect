// Roles del panel (relevamiento, respuestas 12, 14 y 47). Los permisos reales
// los aplica la base (11_roles_equipo_historial.sql); acá solo se decide qué
// mostrar u ocultar en pantalla.
import { supabase } from "@/integrations/supabase/client";

export type StaffRole = "direccion" | "profesional" | "administracion";

export type Staff = {
  role: StaffRole;
  full_name: string | null;
  email: string;
  professional_id: string | null;
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  direccion: "Dirección",
  profesional: "Profesional",
  administracion: "Administración",
};

export const ROLE_DESCRIPTION: Record<StaffRole, string> = {
  direccion: "Todo, más la gestión de profesionales y usuarios",
  profesional: "Turnos y pacientes, más datos clínicos, derivaciones, informes y seguimiento",
  administracion: "Turnos, pacientes (datos de contacto) y asistencia",
};

export const canEditClinical = (role: StaffRole) => role === "direccion" || role === "profesional";
export const isDirector = (role: StaffRole) => role === "direccion";

export type PanelUser = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: StaffRole;
  active: boolean;
  created_at: string;
};

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

type UsersApiBody =
  | { action: "create"; email: string; password: string; full_name?: string; role: StaffRole; professional_id?: string | null }
  | { action: "set_active"; user_id: string; active: boolean }
  | { action: "set_password"; user_id: string; password: string };

// Llama a server/api/admin/users.ts con la sesión actual. En modo demo no hay
// servidor con service role: se simula contra el cliente mock.
export async function usersApi(body: UsersApiBody): Promise<{ ok: true; user_id?: string } | { error: string }> {
  if (USE_MOCK) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (supabase as any).__mockUsersApi(body);
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: "La sesión expiró. Volvé a ingresar." };
  try {
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return res.ok ? json : { error: json?.error ?? `Error ${res.status}` };
  } catch {
    return { error: "No se pudo conectar con el servidor" };
  }
}
