import { type Ctx, PortalError, missingTable } from "./portal";

// Qué pacientes ve cada persona del equipo en el servidor del portal (que usa
// la clave de servicio y no pasa por los permisos de la base). Misma regla que
// is_my_patient() del script 34:
//   - Dirección y Administración: todos.
//   - Profesional: los que tiene a cargo, los que tienen un turno (no
//     cancelado) con él y los de solicitudes que le derivaron.

const OFFLINE = "No pudimos conectar. Probá de nuevo.";
const NOT_MINE = "Ese paciente no está a tu cargo.";

type StaffRef = { user_id: string; role?: string };

async function roleOf(ctx: Ctx, staff: StaffRef): Promise<string> {
  if (staff.role !== undefined) return staff.role;
  const { data, error } = await ctx.admin.from("admins").select("role").eq("user_id", staff.user_id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  return (data?.role as string | undefined) ?? "";
}

async function professionalOf(ctx: Ctx, userId: string): Promise<string | null> {
  const { data, error } = await ctx.admin.from("professionals").select("id").eq("user_id", userId).limit(1).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  return (data?.id as string | undefined) ?? null;
}

// Sin el script 34: la misma regla con consultas directas
async function fallbackAmong(ctx: Ctx, professionalId: string, ids: string[]): Promise<Set<string>> {
  const [mine, appts, reqs] = await Promise.all([
    ctx.admin.from("patients").select("id").in("id", ids).eq("professional_id", professionalId),
    ctx.admin.from("appointments").select("patient_id").in("patient_id", ids).eq("professional_id", professionalId).neq("status", "cancelado"),
    ctx.admin.from("intake_requests").select("patient_id").in("patient_id", ids).eq("assigned_professional_id", professionalId),
  ]);
  if (mine.error || appts.error || reqs.error) throw new PortalError(503, OFFLINE);
  const out = new Set<string>();
  for (const r of mine.data ?? []) out.add(r.id as string);
  for (const r of [...(appts.data ?? []), ...(reqs.data ?? [])]) if (r.patient_id) out.add(r.patient_id as string);
  return out;
}

/** De estos pacientes, cuáles ve. null = todos (Dirección y Administración). */
export async function visiblePatients(ctx: Ctx, staff: StaffRef, ids: string[]): Promise<Set<string> | null> {
  const role = await roleOf(ctx, staff);
  if (role === "direccion" || role === "administracion") return null;
  const unique = [...new Set(ids.filter(Boolean))];
  if (role !== "profesional" || !unique.length) return new Set();
  const professionalId = await professionalOf(ctx, staff.user_id);
  if (!professionalId) return new Set();
  const { data, error } = await ctx.admin.rpc("patients_of_professional_among", { p_professional: professionalId, p_patients: unique });
  if (error) {
    if (missingTable(error) || error.code === "PGRST202") return fallbackAmong(ctx, professionalId, unique);
    throw new PortalError(503, OFFLINE);
  }
  return new Set(((data ?? []) as unknown[]).map((v) => (typeof v === "string" ? v : String(Object.values(v as object)[0]))));
}

/** Deja solo las filas de pacientes que ve. */
export async function onlyVisible<T extends { patient_id: string }>(ctx: Ctx, staff: StaffRef, rows: T[]): Promise<T[]> {
  const visible = await visiblePatients(ctx, staff, rows.map((r) => r.patient_id));
  return visible === null ? rows : rows.filter((r) => visible.has(r.patient_id));
}

/** 403 si el paciente no es suyo. */
export async function assertPatient(ctx: Ctx, staff: StaffRef, patientId: unknown): Promise<void> {
  if (typeof patientId !== "string") return; // el endpoint valida el formato y responde 400
  const visible = await visiblePatients(ctx, staff, [patientId]);
  if (visible !== null && !visible.has(patientId)) throw new PortalError(403, NOT_MINE);
}

/** Paciente de una fila de la base (pedido, documento, aviso) y 403 si no es suyo. */
export async function assertRowPatient(ctx: Ctx, staff: StaffRef, table: string, id: unknown, column = "patient_id"): Promise<void> {
  if ((await roleOf(ctx, staff)) !== "profesional") return;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return; // el endpoint responde 400
  const { data, error } = await ctx.admin.from(table).select(column).eq("id", id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  const row = data as Record<string, unknown> | null;
  if (!row) return; // el endpoint responde 404
  let patientId = row[column] as string | null;
  if (column === "appointment_id") {
    const { data: a, error: aErr } = await ctx.admin.from("appointments").select("patient_id").eq("id", patientId ?? "").maybeSingle();
    if (aErr) throw new PortalError(503, OFFLINE);
    patientId = (a?.patient_id as string | undefined) ?? null;
  }
  if (!patientId) throw new PortalError(403, NOT_MINE);
  await assertPatient(ctx, { ...staff, role: "profesional" }, patientId);
}
