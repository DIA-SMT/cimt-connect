import { createClient } from "@supabase/supabase-js";
import { defineEventHandler, getRequestHeader, readBody, setResponseStatus } from "nitro/h3";
import { STAFF_TOOLS, parseStaffCompletion, sanitizeStaffMessages, staffSystemPrompt } from "../../src/lib/staffTools";

// Migue en modo equipo (solo dentro del panel, con sesión del equipo).
// POST /api/staff-chat { messages } → { reply } | { tool_calls, assistant }
//
// El servidor solo verifica que quien llama sea del equipo y habla con el
// modelo. Las herramientas las corre el panel con la sesión de esa persona,
// así la base aplica los mismos permisos que en el resto del panel. Sin datos
// clínicos (ver src/lib/staffTools.ts).

type Staff = { role: string; full_name: string | null; email: string; professional_id: string | null };

// Límite por persona: cada pregunta puede usar varias vueltas (herramientas)
const LIMIT = 150;
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map<string, { count: number; resetAt: number }>();

function allow(key: string): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= LIMIT;
}

export default defineEventHandler(async (event) => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
  if (!url || !anonKey || !apiKey) {
    setResponseStatus(event, 503);
    return { error: "El asistente del equipo no está configurado en el servidor." };
  }

  // Quién pregunta: sesión del panel y fila activa en el equipo
  const token = getRequestHeader(event, "authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    setResponseStatus(event, 401);
    return { error: "Iniciá sesión en el panel para usar el asistente del equipo." };
  }
  const asUser = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: staff, error: staffError } = await asUser.rpc("current_staff");
  if (staffError || !staff) {
    setResponseStatus(event, 403);
    return { error: "Tu usuario no tiene acceso al asistente del equipo." };
  }
  const me = staff as Staff;
  if (!allow(me.email)) {
    setResponseStatus(event, 429);
    return { error: "Llegaste al límite de consultas por ahora. Probá de nuevo en unos minutos." };
  }

  let professionalName: string | null = null;
  if (me.professional_id) {
    const { data } = await asUser.from("professionals").select("name").eq("id", me.professional_id).maybeSingle();
    professionalName = (data as { name?: string } | null)?.name ?? null;
  }

  const body = (await readBody(event)) as { messages?: unknown } | null;
  const messages = sanitizeStaffMessages(body?.messages);
  if (!messages.length) {
    setResponseStatus(event, 400);
    return { error: "No hay consulta." };
  }

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://cimt-connect.vercel.app",
        "X-Title": "CIMT - Migue equipo",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 800,
        tools: STAFF_TOOLS,
        tool_choice: "auto",
        // Solo proveedores que no guardan los datos para entrenar
        provider: { data_collection: "deny" },
        messages: [{ role: "system", content: staffSystemPrompt({ ...me, professional_name: professionalName }) }, ...messages],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      console.error("[Migue equipo] upstream error:", data);
      setResponseStatus(event, 502);
      return { error: "El asistente no pudo responder. Probá de nuevo en un rato." };
    }
    const result = parseStaffCompletion(data);
    if (!result) return { reply: "No pude armar una respuesta. ¿Me lo preguntás de otra forma?" };
    if (result.kind === "tools") return { tool_calls: result.calls, assistant: result.assistant };
    return { reply: result.reply };
  } catch (err) {
    console.error("[Migue equipo] error:", err);
    setResponseStatus(event, 504);
    return { error: "El asistente tardó demasiado en responder. Probá de nuevo." };
  }
});
