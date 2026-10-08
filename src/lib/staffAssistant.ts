// Migue en modo equipo, lado panel: corre las herramientas de consulta con la
// sesión de quien pregunta (la base aplica los permisos de su rol) y maneja la
// conversación con server/api/staff-chat.ts. Sin datos clínicos.
// En modo demo no hay IA: responde las preguntas sugeridas con plantillas.

import { supabase } from "@/integrations/supabase/client";
import type { Staff } from "@/lib/staff";
import { CASE_STATUS_LABEL, PATIENT_TYPE_LABEL, type CaseStatus, type PatientType, type ProfessionalOption } from "@/lib/patients";
import { INTAKE_STATUS_LABEL, addDays, nextWorkday, type IntakeStatus } from "@/lib/agenda";
import {
  computeStats, type Range, type StatAppt, type StatIntake, type StatPatient, type StatReferral, type StatSurvey, type StatWorkshop,
} from "@/lib/stats";
import { centerToday, type StaffApiMessage, type StaffToolName } from "@/lib/staffTools";

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";
const MAX_ROUNDS = 5;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Args = Record<string, unknown>;
type ProRow = { id: string; name: string; specialty: string; active: boolean | null; days?: string | null; session_minutes?: number | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const ddmm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const hhmm = (t: string) => t.slice(0, 5);
const validDate = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : null);

async function professionals(): Promise<ProRow[]> {
  const { data } = await supabase.from("professionals").select("id, name, specialty, active, days, session_minutes");
  return (data ?? []) as ProRow[];
}

// ── Períodos ────────────────────────────────────────────────────────────────

function monday(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return addDays(key, -((new Date(y, m - 1, d).getDay() + 6) % 7));
}

function periodRange(args: Args): Range & { label: string } {
  const today = centerToday();
  const desde = validDate(args.desde);
  const hasta = validDate(args.hasta);
  if (desde || hasta) return { start: desde, end: hasta ?? today, label: `del ${ddmm(desde ?? "")} al ${ddmm(hasta ?? today)}` };
  const first = `${today.slice(0, 8)}01`;
  switch (args.periodo) {
    case "hoy": return { start: today, end: today, label: "hoy" };
    case "esta_semana": return { start: monday(today), end: today, label: "esta semana" };
    case "semana_pasada": {
      const m = addDays(monday(today), -7);
      return { start: m, end: addDays(m, 6), label: "la semana pasada" };
    }
    case "mes_pasado": {
      const end = addDays(first, -1);
      return { start: `${end.slice(0, 8)}01`, end, label: "el mes pasado" };
    }
    case "este_anio": return { start: `${today.slice(0, 4)}-01-01`, end: today, label: "este año" };
    case "todo": return { start: null, end: null, label: "desde el inicio" };
    default: return { start: first, end: today, label: "este mes" };
  }
}

// ── Herramientas ────────────────────────────────────────────────────────────

const ATTENDANCE: Record<string, string> = { presente: "presente", ausente: "ausente", justificado: "ausente justificado" };

async function toolTurnos(args: Args, staff: Staff) {
  const today = centerToday();
  let desde = validDate(args.desde) ?? today;
  let hasta = validDate(args.hasta) ?? desde;
  if (hasta < desde) [desde, hasta] = [hasta, desde];
  if (hasta > addDays(desde, 13)) hasta = addDays(desde, 13);

  const [{ data, error }, pros] = await Promise.all([
    supabase.from("appointments").select("*, patients(first_name, last_name)")
      .gte("appointment_date", desde).lte("appointment_date", hasta)
      .order("appointment_date").order("appointment_time"),
    professionals(),
  ]);
  if (error) return { error: "No se pudieron leer los turnos." };
  const proName = new Map(pros.map((p) => [p.id, p.name]));
  type A = { appointment_date: string; appointment_time: string; duration_minutes: number; status: string; modality: string | null;
    attendance: string | null; professional_id: string | null; reminder_sent_at?: string | null; reminder_channel?: string | null;
    patients: { first_name: string; last_name: string } | null };
  let rows = (data ?? []) as A[];
  if (args.solo_mios === true) {
    if (!staff.professional_id) return { error: "Tu usuario no está vinculado a un profesional." };
    rows = rows.filter((a) => a.professional_id === staff.professional_id);
  }
  if (typeof args.profesional === "string" && args.profesional.trim()) {
    const q = norm(args.profesional);
    rows = rows.filter((a) => a.professional_id && norm(proName.get(a.professional_id) ?? "").includes(q));
  }
  const live = rows.filter((a) => a.status !== "cancelado");
  return {
    desde: ddmm(desde), hasta: ddmm(hasta),
    total: live.length,
    cancelados: rows.length - live.length,
    sin_avisar: live.filter((a) => !a.reminder_sent_at).length,
    turnos: live.slice(0, 80).map((a) => ({
      fecha: ddmm(a.appointment_date),
      hora: hhmm(a.appointment_time),
      duracion_min: a.duration_minutes,
      paciente: a.patients ? `${a.patients.last_name}, ${a.patients.first_name}` : "sin paciente",
      profesional: a.professional_id ? proName.get(a.professional_id) ?? "otro" : "sin profesional",
      modalidad: a.modality === "telemedicina" ? "telemedicina" : "presencial",
      estado: a.status,
      asistencia: a.attendance ? ATTENDANCE[a.attendance] : "sin marcar",
      avisado: a.reminder_sent_at ? `sí (${a.reminder_channel ?? "aviso"})` : "no",
    })),
    recortado: live.length > 80,
  };
}

async function toolMetricas(args: Args) {
  const range = periodRange(args);
  const [p, r, a, i, w, s, pros] = await Promise.all([
    supabase.from("patients").select("id, created_at, locality, patient_type, case_status, has_health_insurance, therapy_modes, other_conditions, age"),
    supabase.from("patient_referrals").select("specialty, status, registered, referral_date, voided_at"),
    supabase.from("appointments").select("patient_id, professional_id, appointment_date, status, modality, attendance"),
    supabase.from("intake_requests").select("created_at, status, workshop_id, workshop_attended, patient_id"),
    supabase.from("workshops").select("id, workshop_date, canceled"),
    supabase.from("satisfaction_surveys").select("*"),
    professionals(),
  ]);
  const st = computeStats({
    patients: (p.data ?? []) as StatPatient[],
    referrals: (r.data ?? []) as StatReferral[],
    appts: (a.data ?? []) as StatAppt[],
    intake: (i.data ?? []) as StatIntake[],
    workshops: (w.data ?? []) as StatWorkshop[],
    surveys: (s.data ?? []) as StatSurvey[],
    professionals: pros as ProfessionalOption[],
  }, range);
  const nonZero = (rows: { name: string; value: number }[]) => rows.filter((x) => x.value > 0);
  return {
    periodo: range.label,
    situacion_actual: {
      pacientes_registrados: st.current.total,
      activos: st.current.active,
      por_estado: nonZero(st.current.byStatus),
      derivaciones_pendientes: st.current.pendingReferrals,
      derivaciones_sin_registrar: st.current.unregistered,
    },
    ingresos: {
      pacientes_nuevos: st.admissions.count,
      por_localidad: st.admissions.byLocality.slice(0, 5),
      por_edad: nonZero(st.admissions.byAge),
      por_tipo: nonZero(st.admissions.byType),
      obra_social: nonZero(st.admissions.byInsurance),
    },
    atencion: {
      turnos_programados: st.attention.scheduled,
      practicas: st.attention.practices,
      ausentes: st.attention.absent,
      justificados: st.attention.justified,
      sin_marcar: st.attention.unmarked,
      ausentismo_pct: st.attention.absenteeism,
      cancelados: st.attention.canceled,
      telemedicina: st.attention.telemed,
      por_profesional: st.attention.byProfessional,
    },
    solicitudes: {
      recibidas: st.intake.received,
      por_estado: nonZero(st.intake.byStatus),
      espera_mediana_dias: st.intake.waitMedian,
      talleres: st.intake.workshops,
      familias_anotadas: st.intake.workshopEnrolled,
      familias_que_asistieron: st.intake.workshopAttended,
    },
    derivaciones: { total: st.referrals.count, registradas: st.referrals.registered, por_especialidad: st.referrals.bySpecialty.slice(0, 5) },
    satisfaccion: {
      encuestas: st.satisfaction.count,
      general: st.satisfaction.overall,
      atencion: st.satisfaction.attention,
      claridad: st.satisfaction.communication,
      trato: st.satisfaction.treatment,
      recomendaria_pct: st.satisfaction.recommend,
    },
  };
}

async function toolSolicitudes(args: Args) {
  const [{ data, error }, { data: ws }] = await Promise.all([
    supabase.from("intake_requests").select("first_name, last_name, age, patient_type, status, created_at, locality, preferred_modality, workshop_id, workshop_attended"),
    supabase.from("workshops").select("id, workshop_date"),
  ]);
  if (error) return { error: "No se pudieron leer las solicitudes." };
  const wDate = new Map(((ws ?? []) as { id: string; workshop_date: string }[]).map((w) => [w.id, w.workshop_date]));
  const estado = typeof args.estado === "string" ? args.estado : "en_curso";
  type R = { first_name: string; last_name: string; age: number; patient_type: PatientType; status: IntakeStatus; created_at: string;
    locality: string | null; preferred_modality: string | null; workshop_id: string | null; workshop_attended: boolean | null };
  const rows = ((data ?? []) as R[])
    .filter((r) => estado === "todas" ? true : estado === "en_curso" ? ["nueva", "contactada", "taller"].includes(r.status) : r.status === estado)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return {
    filtro: estado,
    total: rows.length,
    solicitudes: rows.slice(0, 60).map((r) => ({
      nombre: `${r.last_name}, ${r.first_name}`,
      edad: r.age,
      tipo: PATIENT_TYPE_LABEL[r.patient_type] ?? r.patient_type,
      estado: INTAKE_STATUS_LABEL[r.status] ?? r.status,
      recibida: ddmm(r.created_at.slice(0, 10)),
      localidad: r.locality ?? "sin dato",
      modalidad_preferida: r.preferred_modality ?? "sin dato",
      taller: r.workshop_id && wDate.get(r.workshop_id) ? `${ddmm(wDate.get(r.workshop_id)!)}${r.workshop_attended ? " (asistió)" : ""}` : "sin taller",
    })),
    recortado: rows.length > 60,
  };
}

async function toolBuscarPaciente(args: Args) {
  const texto = typeof args.texto === "string" ? args.texto.trim() : "";
  if (texto.length < 2) return { error: "Decime un nombre, apellido o DNI." };
  const [{ data, error }, pros] = await Promise.all([
    supabase.from("patients").select("id, first_name, last_name, dni, age, patient_type, case_status, professional_id, locality, has_health_insurance, discharge_date"),
    professionals(),
  ]);
  if (error) return { error: "No se pudieron leer los pacientes." };
  type P = { id: string; first_name: string; last_name: string; dni: string; age: number; patient_type: PatientType; case_status: CaseStatus;
    professional_id: string | null; locality: string | null; has_health_insurance: boolean | null; discharge_date: string | null };
  const q = norm(texto);
  const digits = texto.replace(/\D/g, "");
  const matches = ((data ?? []) as P[]).filter((p) =>
    (digits.length >= 6 && p.dni.includes(digits)) || norm(`${p.first_name} ${p.last_name}`).includes(q) || norm(`${p.last_name} ${p.first_name}`).includes(q));
  const proName = new Map(pros.map((p) => [p.id, p.name]));
  const today = centerToday();
  const found = await Promise.all(matches.slice(0, 5).map(async (p) => {
    const { data: ap } = await supabase.from("appointments").select("appointment_date, appointment_time, status, attendance, professional_id").eq("patient_id", p.id);
    const appts = (ap ?? []) as { appointment_date: string; appointment_time: string; status: string; attendance: string | null; professional_id: string | null }[];
    const live = appts.filter((a) => a.status !== "cancelado");
    const next = live.filter((a) => a.appointment_date >= today).sort((a, b) => (a.appointment_date + a.appointment_time).localeCompare(b.appointment_date + b.appointment_time));
    const present = live.filter((a) => a.attendance === "presente").length;
    const absent = live.filter((a) => a.attendance === "ausente").length;
    return {
      nombre: `${p.last_name}, ${p.first_name}`,
      edad: p.age,
      tipo: PATIENT_TYPE_LABEL[p.patient_type] ?? p.patient_type,
      estado_del_caso: CASE_STATUS_LABEL[p.case_status] ?? p.case_status,
      profesional_a_cargo: p.professional_id ? proName.get(p.professional_id) ?? "otro" : "sin asignar",
      localidad: p.locality ?? "sin dato",
      obra_social: p.has_health_insurance === true ? "con obra social" : p.has_health_insurance === false ? "sin obra social" : "sin dato",
      alta: p.discharge_date ? ddmm(p.discharge_date) : null,
      proximos_turnos: next.slice(0, 3).map((a) => `${ddmm(a.appointment_date)} ${hhmm(a.appointment_time)} con ${a.professional_id ? proName.get(a.professional_id) ?? "otro" : "sin profesional"}`),
      asistencia: { presentes: present, ausentes: absent, justificados: live.filter((a) => a.attendance === "justificado").length,
        porcentaje: present + absent > 0 ? Math.round((present / (present + absent)) * 100) : null },
    };
  }));
  return { coincidencias: matches.length, pacientes: found, recortado: matches.length > 5 };
}

async function toolTalleres() {
  const today = centerToday();
  const [{ data, error }, { data: intake }] = await Promise.all([
    supabase.from("workshops").select("id, workshop_date, start_time, place, capacity, canceled").gte("workshop_date", today).order("workshop_date"),
    supabase.from("intake_requests").select("workshop_id"),
  ]);
  if (error) return { error: "No se pudieron leer los talleres." };
  const count = new Map<string, number>();
  for (const r of (intake ?? []) as { workshop_id: string | null }[]) if (r.workshop_id) count.set(r.workshop_id, (count.get(r.workshop_id) ?? 0) + 1);
  const rows = ((data ?? []) as { id: string; workshop_date: string; start_time: string; place: string; capacity: number | null; canceled: boolean }[])
    .filter((w) => !w.canceled);
  return {
    talleres: rows.map((w) => ({ fecha: ddmm(w.workshop_date), hora: hhmm(w.start_time ?? ""), lugar: w.place, cupo: w.capacity, anotadas: count.get(w.id) ?? 0 })),
  };
}

async function toolProfesionales() {
  const pros = (await professionals()).filter((p) => p.active !== false);
  return { profesionales: pros.map((p) => ({ nombre: p.name, especialidad: p.specialty, dias: p.days ?? "sin dato", sesion_min: p.session_minutes ?? null })) };
}

export async function runStaffTool(name: StaffToolName, args: Args, staff: Staff): Promise<unknown> {
  try {
    switch (name) {
      case "turnos": return await toolTurnos(args, staff);
      case "metricas": return await toolMetricas(args);
      case "solicitudes": return await toolSolicitudes(args);
      case "buscar_paciente": return await toolBuscarPaciente(args);
      case "talleres": return await toolTalleres();
      case "profesionales": return await toolProfesionales();
    }
  } catch (err) {
    console.error("[Migue equipo] herramienta", name, err);
    return { error: "No se pudo consultar ese dato." };
  }
}

// ── Conversación ────────────────────────────────────────────────────────────

export class StaffChatError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

/** Manda la conversación (solo textos de usuario y Migue) y resuelve las herramientas que pida el modelo. */
export async function askStaffMigue(history: { role: "user" | "assistant"; content: string }[], staff: Staff): Promise<string> {
  if (USE_MOCK) return mockAnswer(history[history.length - 1]?.content ?? "", staff);

  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new StaffChatError("Tu sesión venció. Volvé a ingresar al panel.", 401);

  const messages: StaffApiMessage[] = history.map((m) => ({ role: m.role, content: m.content }));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch("/api/staff-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new StaffChatError(data?.error ?? "El asistente no pudo responder.", res.status);
    if (typeof data.reply === "string") return data.reply;
    if (!Array.isArray(data.tool_calls) || !data.assistant) break;
    messages.push(data.assistant as StaffApiMessage);
    for (const call of data.tool_calls as { id: string; name: StaffToolName; arguments: string }[]) {
      let args: Args = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { /* argumentos inválidos: se usan los valores por defecto */ }
      const result = await runStaffTool(call.name, args, staff);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 19000) });
    }
  }
  return "No llegué a una respuesta con esos datos. ¿Me lo preguntás de otra forma?";
}

// ── Modo demo: respuestas con plantillas (sin IA) ───────────────────────────

async function mockAnswer(text: string, staff: Staff): Promise<string> {
  const t = norm(text);
  const demo = "(Modo demo: sin IA, respondo las preguntas sugeridas.)\n\n";
  const lines = (rows: string[]) => rows.map((r) => `• ${r}`).join("\n");

  if (t.includes("taller")) {
    const r = await toolTalleres();
    if ("error" in r) return r.error as string;
    return demo + (r.talleres.length
      ? `**Próximos talleres**\n${lines(r.talleres.map((w) => `${w.fecha} ${w.hora} hs · ${w.lugar} · ${w.anotadas} anotada(s)${w.cupo ? ` de ${w.cupo}` : ""}`))}`
      : "No hay talleres próximos cargados. Se cargan en Solicitudes → Talleres para familias.");
  }
  if (t.includes("solicitud")) {
    const r = await toolSolicitudes({ estado: "en_curso" });
    if ("error" in r) return r.error as string;
    return demo + `**Solicitudes en curso: ${r.total}**\n${lines(r.solicitudes.slice(0, 10).map((s) => `${s.nombre} · ${s.estado} · recibida ${s.recibida}${s.taller !== "sin taller" ? ` · taller ${s.taller}` : ""}`))}`;
  }
  if (t.includes("ingres") || t.includes("metric") || t.includes("estadistic")) {
    const r = await toolMetricas({ periodo: "este_mes" });
    return demo + `**Este mes**\n${lines([
      `Pacientes nuevos: ${r.ingresos.pacientes_nuevos}`,
      `Solicitudes recibidas: ${r.solicitudes.recibidas}`,
      `Prácticas: ${r.atencion.practicas} de ${r.atencion.turnos_programados} turnos`,
      `Ausentismo: ${r.atencion.ausentismo_pct ?? "—"}%`,
      `Pacientes activos hoy: ${r.situacion_actual.activos} de ${r.situacion_actual.pacientes_registrados}`,
    ])}`;
  }
  if (t.includes("manana") || t.includes("avisar")) {
    const day = nextWorkday(centerToday());
    const r = await toolTurnos({ desde: day }, staff);
    if ("error" in r) return r.error as string;
    const pending = r.turnos.filter((x) => x.avisado === "no");
    return demo + `**Turnos del ${r.desde}: ${r.total}** · faltan avisar ${pending.length}\n${lines(pending.map((x) => `${x.hora} ${x.paciente} · ${x.profesional}`)) || "Están todos avisados."}`;
  }
  if (t.includes("semana")) {
    const r = await toolTurnos({ desde: monday(centerToday()), hasta: addDays(monday(centerToday()), 4), solo_mios: !!staff.professional_id }, staff);
    if ("error" in r) return r.error as string;
    return demo + `**Turnos de la semana${staff.professional_id ? " (tuyos)" : ""}: ${r.total}**\n${lines(r.turnos.map((x) => `${x.fecha} ${x.hora} ${x.paciente} · ${x.profesional}`))}`;
  }
  if (t.includes("turno") || t.includes("hoy")) {
    const r = await toolTurnos({}, staff);
    if ("error" in r) return r.error as string;
    return demo + `**Turnos de hoy (${r.desde}): ${r.total}**\n${lines(r.turnos.map((x) => `${x.hora} ${x.paciente} · ${x.profesional} · ${x.asistencia}`)) || "No hay turnos hoy."}`;
  }
  return demo + "Probá con alguna de las preguntas sugeridas. La conversación libre funciona en el sitio publicado, donde Migue usa la IA.";
}
