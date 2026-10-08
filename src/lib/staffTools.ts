// Migue en modo equipo: lo que comparten el servidor (server/api/staff-chat.ts)
// y el panel. Sin imports: el servidor lo importa con ruta relativa.
//
// Cómo funciona: el servidor habla con el modelo y le ofrece estas
// herramientas de SOLO LECTURA; cuando el modelo pide una, el panel la corre
// en el navegador con la sesión de quien pregunta (los permisos los aplica la
// base, igual que en el resto del panel) y le devuelve el resultado.
// Decisión del centro: Migue no ve datos clínicos (diagnósticos, notas,
// informes, historias, medicación). Las herramientas no los consultan.

export const STAFF_TOOL_NAMES = ["turnos", "metricas", "solicitudes", "buscar_paciente", "talleres", "profesionales"] as const;
export type StaffToolName = (typeof STAFF_TOOL_NAMES)[number];

const FECHA = { type: "string", description: "Fecha AAAA-MM-DD" };

export const STAFF_TOOLS = [
  {
    type: "function",
    function: {
      name: "turnos",
      description: "Turnos de la agenda entre dos fechas (por defecto, hoy; hasta 14 días). Trae hora, paciente, profesional, modalidad, asistencia y si ya se le avisó (recordatorio).",
      parameters: {
        type: "object",
        properties: {
          desde: { ...FECHA, description: "Primera fecha, AAAA-MM-DD. Por defecto hoy." },
          hasta: { ...FECHA, description: "Última fecha, AAAA-MM-DD. Por defecto igual a desde." },
          profesional: { type: "string", description: "Nombre o parte del nombre del profesional, para filtrar." },
          solo_mios: { type: "boolean", description: "true = solo los turnos del profesional vinculado a quien pregunta." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "metricas",
      description: "Estadísticas del centro en un período: ingresos, solicitudes, prácticas, ausentismo, derivaciones, tiempo de espera, talleres y satisfacción, más la situación actual. Sin datos personales.",
      parameters: {
        type: "object",
        properties: {
          periodo: { type: "string", enum: ["hoy", "esta_semana", "semana_pasada", "este_mes", "mes_pasado", "este_anio", "todo"], description: "Período predefinido. Por defecto este_mes." },
          desde: { ...FECHA, description: "En lugar de periodo: primera fecha AAAA-MM-DD." },
          hasta: { ...FECHA, description: "En lugar de periodo: última fecha AAAA-MM-DD." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "solicitudes",
      description: "Solicitudes de ingreso que llegaron desde el sitio, con su estado, fecha, localidad y taller asignado (sin el motivo de consulta).",
      parameters: {
        type: "object",
        properties: {
          estado: { type: "string", enum: ["en_curso", "nueva", "contactada", "taller", "admitida", "no_corresponde", "todas"], description: "Por defecto en_curso (nueva, contactada o anotada al taller)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_paciente",
      description: "Busca pacientes por nombre, apellido o DNI. Devuelve edad, estado del caso, profesional a cargo, próximos turnos y asistencia. No trae datos clínicos.",
      parameters: {
        type: "object",
        properties: { texto: { type: "string", description: "Nombre, apellido o DNI." } },
        required: ["texto"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "talleres",
      description: "Próximos talleres para familias, con fecha, hora, lugar, cupo y familias anotadas.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "profesionales",
      description: "Profesionales activos del centro, con especialidad, días de atención y duración de sesión.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

// ── Fecha del centro ────────────────────────────────────────────────────────

const TZ = "America/Argentina/Tucuman";

export function centerToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function centerLongDate(now = new Date()): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
}

function centerTime(now = new Date()): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
}

// ── Instrucciones del modo equipo ───────────────────────────────────────────

export const STAFF_ROLE_LABEL: Record<string, string> = {
  direccion: "Dirección", profesional: "Profesional", administracion: "Administración",
};

export function staffSystemPrompt(staff: { role: string; full_name: string | null; email: string; professional_name?: string | null }, now = new Date()): string {
  const who = staff.full_name || staff.email;
  const role = STAFF_ROLE_LABEL[staff.role] ?? staff.role;
  return `Sos Migue, el asistente interno del CIMT (Centro Integral Municipal de Tartamudez) para el equipo, dentro del panel.
Estás hablando con ${who} (rol: ${role}${staff.professional_name ? `, profesional vinculado: ${staff.professional_name}` : ""}).
Hoy es ${centerLongDate(now)} (${centerToday(now)}), son las ${centerTime(now)} en Tucumán.

## Cómo responder
- Español rioplatense, breve y concreto. Para listas, una línea por ítem empezando con "• ". Fechas como dd/mm y horas como 14:30.
- Para cualquier dato del centro (turnos, métricas, solicitudes, pacientes, talleres, profesionales) usá SIEMPRE las herramientas. Nunca inventes números, nombres ni fechas. Si la herramienta no trae el dato, decilo.
- "Hoy", "mañana", "esta semana" se calculan desde la fecha de arriba. "Mañana" en un viernes, si te piden el próximo día de atención, es el lunes.
- Si la respuesta es muy larga (más de 15 ítems), resumí y ofrecé ver el detalle.

## Límites
- No tenés acceso a datos clínicos: diagnósticos, notas de seguimiento, informes, historias clínicas, medicación. Si te los piden, explicá que se consultan en la ficha del paciente (pestaña Pacientes).
- Solo consultás: no das turnos, no cancelás, no marcás asistencia, no modificás ni borrás nada. Si te piden una acción, explicá dónde se hace en el panel.
- Lo que ves es confidencial y es solo para quien pregunta.

## Dónde se hace cada cosa en el panel
- Agenda: dar turnos (clic en un horario libre o "Nuevo turno", con repetición semanal), marcar asistencia (presente asigna número de práctica), cancelar, "Bloquear horario", "Turnos de mañana" con WhatsApp y "Avisado". "Mis turnos" muestra la semana del profesional.
- Solicitudes: estados nueva → contactada → anotada al taller → admitida ("Admitir y crear ficha"); talleres para familias a la derecha.
- Pacientes: ficha completa, "Nuevo paciente", exportar a Excel. En la ficha: adultos responsables (e invitación al portal de familias), historia clínica por área, derivaciones, informes, seguimiento, adjuntos, historial. Los registros clínicos no se borran: se anulan con motivo.
- Estadísticas: períodos, informe semanal para la Gerencia de Datos (PDF o Excel), link de la encuesta.
- Equipo (solo Dirección): profesionales y usuarios, roles, contraseñas, desactivar.`;
}

// ── Mensajes que el panel puede mandar ──────────────────────────────────────

export type StaffToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type StaffApiMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: StaffToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

const MAX_MESSAGES = 30;
const MAX_TEXT = 2000;
const MAX_TOOL_RESULT = 20000;

// Solo usuario, asistente (con pedidos de herramientas conocidas) y resultados
// de herramientas; nada de "system" inyectado. Largo y cantidad acotados.
export function sanitizeStaffMessages(raw: unknown): StaffApiMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffApiMessage[] = [];
  for (const m of raw as Record<string, unknown>[]) {
    if (!m || typeof m !== "object") continue;
    if (m.role === "user" && typeof m.content === "string" && m.content.trim()) {
      out.push({ role: "user", content: m.content.slice(0, MAX_TEXT) });
    } else if (m.role === "assistant") {
      const calls = Array.isArray(m.tool_calls)
        ? (m.tool_calls as Record<string, unknown>[]).flatMap((c) => {
          const fn = c?.function as Record<string, unknown> | undefined;
          const name = String(fn?.name ?? "");
          if (typeof c?.id !== "string" || !(STAFF_TOOL_NAMES as readonly string[]).includes(name)) return [];
          return [{ id: c.id.slice(0, 100), type: "function" as const, function: { name, arguments: String(fn?.arguments ?? "{}").slice(0, 1000) } }];
        })
        : [];
      const content = typeof m.content === "string" ? m.content.slice(0, MAX_TEXT) : "";
      if (calls.length) out.push({ role: "assistant", content, tool_calls: calls });
      else if (content.trim()) out.push({ role: "assistant", content });
    } else if (m.role === "tool" && typeof m.tool_call_id === "string" && typeof m.content === "string") {
      out.push({ role: "tool", tool_call_id: m.tool_call_id.slice(0, 100), content: m.content.slice(0, MAX_TOOL_RESULT) });
    }
  }
  // Recorta desde el principio sin dejar resultados de herramientas huérfanos
  let start = Math.max(0, out.length - MAX_MESSAGES);
  while (start < out.length && out[start].role !== "user") start++;
  return out.slice(start);
}

// ── Respuesta del modelo ────────────────────────────────────────────────────

export type StaffCompletion =
  | { kind: "reply"; reply: string }
  | { kind: "tools"; assistant: StaffApiMessage; calls: { id: string; name: StaffToolName; arguments: string }[] };

export function parseStaffCompletion(data: unknown): StaffCompletion | null {
  const msg = (data as { choices?: { message?: { content?: string | null; tool_calls?: StaffToolCall[] } }[] })?.choices?.[0]?.message;
  if (!msg) return null;
  const calls = (msg.tool_calls ?? [])
    .filter((c) => c?.function && (STAFF_TOOL_NAMES as readonly string[]).includes(c.function.name))
    .map((c) => ({ id: String(c.id), name: c.function.name as StaffToolName, arguments: String(c.function.arguments ?? "{}") }));
  if (calls.length) {
    return {
      kind: "tools",
      assistant: {
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      },
      calls,
    };
  }
  const reply = (msg.content ?? "").trim();
  return reply ? { kind: "reply", reply } : null;
}
