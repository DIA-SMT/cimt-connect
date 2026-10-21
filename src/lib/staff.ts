// Roles del panel. Los permisos reales los aplica la base (scripts 11 y 34);
// acá solo se decide qué mostrar u ocultar en pantalla.
//   - Dirección: control total (equipo de sistemas).
//   - Administración: ve todo, recibe las solicitudes y las deriva.
//   - Profesional: solo sus pacientes, su agenda y las solicitudes derivadas.
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
  direccion: "Control total: todo, más profesionales, usuarios e hitos del sitio",
  profesional: "Solo sus pacientes y su agenda: datos clínicos, evaluaciones, informes y seguimiento",
  administracion: "Recibe y deriva las solicitudes; ve todos los pacientes y la agenda (lo clínico, sin editar)",
};

export const canEditClinical = (role: StaffRole) => role === "direccion" || role === "profesional";
export const isDirector = (role: StaffRole) => role === "direccion";
/** Dirección y Administración ven a todos los pacientes y derivan solicitudes */
export const seesAllPatients = (role: StaffRole) => role === "direccion" || role === "administracion";

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
  | { action: "create"; email: string; password: string; full_name?: string; role: StaffRole; professional_id?: string | null; must_change?: boolean }
  | { action: "set_active"; user_id: string; active: boolean }
  | { action: "set_password"; user_id: string; password: string; must_change?: boolean };

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
