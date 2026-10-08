import { createClient } from "@supabase/supabase-js";
import { defineEventHandler, getRequestHeader, readBody, setResponseStatus } from "nitro/h3";
import { PASSWORD_MIN, PASSWORD_MIN_MESSAGE } from "../../../src/lib/passwords";

// Gestión de usuarios del panel (relevamiento, respuesta 47: la Dirección da de
// alta y de baja a los usuarios). Crear usuarios, cambiar contraseñas y bloquear
// el acceso requiere la service role key de Supabase, que solo vive en el
// servidor (variable SUPABASE_SERVICE_ROLE_KEY en Vercel, nunca con prefijo VITE_).
//
// Cambiar rol, nombre o profesional vinculado lo hace el panel directo contra
// la base (RLS: solo la Dirección), sin pasar por acá.
//
// must_change: al crear o asignar una contraseña, la Dirección puede pedir que
// la persona la cambie al ingresar. Queda en user_metadata.must_change_password
// y el panel la borra cuando la persona guarda su contraseña propia.

type Role = "direccion" | "profesional" | "administracion";
const ROLES: Role[] = ["direccion", "profesional", "administracion"];
const BAN_FOREVER = "876000h"; // ~100 años

type Body =
  | { action: "create"; email: string; password: string; full_name?: string; role: Role; professional_id?: string | null; must_change?: boolean }
  | { action: "set_active"; user_id: string; active: boolean }
  | { action: "set_password"; user_id: string; password: string; must_change?: boolean };

function fail(event: Parameters<typeof setResponseStatus>[0], status: number, error: string) {
  setResponseStatus(event, status);
  return { error };
}

export default defineEventHandler(async (event) => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return fail(event, 503, "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor (Vercel → Settings → Environment Variables).");
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Quién llama: tiene que ser un usuario de Dirección activo
  const token = getRequestHeader(event, "authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return fail(event, 401, "No autenticado");
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return fail(event, 401, "Sesión inválida");

  const { data: callerRow } = await admin
    .from("admins").select("role, active").eq("user_id", caller.user.id).maybeSingle();
  if (!callerRow || !callerRow.active || callerRow.role !== "direccion") {
    return fail(event, 403, "Solo la Dirección puede gestionar usuarios");
  }

  const body = (await readBody(event)) as Body;

  if (body?.action === "create") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = body.role;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(event, 400, "Email inválido");
    if (!ROLES.includes(role)) return fail(event, 400, "Rol inválido");
    if (String(body.password ?? "").length < PASSWORD_MIN) return fail(event, 400, PASSWORD_MIN_MESSAGE);

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { must_change_password: body.must_change !== false },
    });
    if (error || !created.user) {
      const exists = /already|registered|exists/i.test(error?.message ?? "");
      return fail(event, exists ? 409 : 500, exists ? "Ya existe un usuario con ese email" : "No se pudo crear el usuario");
    }

    const { error: rowError } = await admin.from("admins").insert({
      user_id: created.user.id,
      email,
      full_name: body.full_name?.trim() || null,
      role,
    });
    if (rowError) {
      // No dejar un usuario de Auth suelto sin fila en admins
      await admin.auth.admin.deleteUser(created.user.id);
      return fail(event, 500, "No se pudo registrar el usuario en el panel");
    }

    if (body.professional_id) {
      await admin.from("professionals").update({ user_id: created.user.id }).eq("id", body.professional_id);
    }
    return { ok: true, user_id: created.user.id };
  }

  if (body?.action === "set_active") {
    if (body.user_id === caller.user.id && !body.active) {
      return fail(event, 400, "No podés desactivar tu propio usuario");
    }
    const { error } = await admin.from("admins").update({ active: body.active }).eq("user_id", body.user_id);
    if (error) {
      return fail(event, 400, error.message.includes("LAST_DIRECTOR")
        ? "Tiene que quedar al menos un usuario de Dirección activo"
        : "No se pudo actualizar el usuario");
    }
    // Además de sacarle el acceso al panel, se bloquea el inicio de sesión
    await admin.auth.admin.updateUserById(body.user_id, { ban_duration: body.active ? "none" : BAN_FOREVER });
    return { ok: true };
  }

  if (body?.action === "set_password") {
    if (String(body.password ?? "").length < PASSWORD_MIN) return fail(event, 400, PASSWORD_MIN_MESSAGE);
    const { error } = await admin.auth.admin.updateUserById(body.user_id, {
      password: body.password,
      user_metadata: { must_change_password: body.must_change !== false },
    });
    if (error) return fail(event, 500, "No se pudo cambiar la contraseña");
    return { ok: true };
  }

  return fail(event, 400, "Acción inválida");
});
