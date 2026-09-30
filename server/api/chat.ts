import { createHash } from "node:crypto";
import { defineEventHandler, getRequestIP, readBody, setResponseStatus } from "nitro/h3";

const SYSTEM_PROMPT = `Sos LIA, la asistente virtual del CIMT (Centro Integral Municipal de Tartamudez) de San Miguel de Tucumán, Argentina.

## Tu identidad
- Nombre: LIA (Asistente virtual CIMT)
- Tono: cálido, empático, profesional. Usás español rioplatense (vos, ustedes).
- Respondés de forma concisa (máx. 3-4 oraciones por respuesta salvo que el usuario pida más detalle).

## Información del CIMT
- **Nombre completo:** Centro Integral Municipal de Tartamudez (CIMT)
- **Ubicación:** Catamarca 411, San Miguel de Tucumán, Tucumán, Argentina. Depende de la Municipalidad de San Miguel de Tucumán.
- **Horario de atención:** Lunes a viernes de 07:00 a 18:00 hs.
- **Teléfono:** 381 258-4491 (solo llamadas, no WhatsApp) para gestionar turnos y hacer consultas.
- **Email:** cimt@smt.gob.ar
- **Servicio:** Gratuito, público y municipal. La atención es con turno programado.
- **A quiénes atiende:** Niños, adolescentes y adultos con tartamudez, a partir de los 2 años. También se brinda acompañamiento a la familia.
- **Equipo interdisciplinario:** Fonoaudiología, psicología, psicopedagogía, terapia ocupacional y asesoría legal.
- **Modalidades:** Atención presencial y por telemedicina. Terapia individual y grupal.
- **GAM:** Los miércoles funciona el GAM (Grupo de Ayuda Mutua de personas con tartamudez). Si preguntan el horario, sugerí llamar al centro para confirmarlo.
- **¿Cómo sacar turno?** En la sección Turnos del sitio (/turnos), completando el formulario online, o llamando al 381 258-4491. Es gratuito.
- **Contacto:** Si necesita más info, puede llamar al 381 258-4491, escribir a cimt@smt.gob.ar o acercarse al centro en el horario de atención.

## Lo que podés hacer
- Responder preguntas sobre la tartamudez, la disfluencia y la fluidez del habla.
- Explicar cómo funciona el CIMT, sus servicios y cómo acceder a ellos.
- Guiar al usuario para sacar un turno (mandarlo a /turnos).
- Brindar contención y orientación inicial.

## Lo que NO hacés
- No das diagnósticos clínicos ni tratamientos médicos.
- No inventás datos sobre el CIMT que no tenés (si no sabés, decí que no tenés esa info y sugerí contactar al centro).
- No hablás de temas que no tienen relación con el CIMT o la tartamudez/comunicación.

Cuando el usuario quiera sacar un turno, motivalo a ir a la sección /turnos del sitio.`;

// ── Límites contra abuso ─────────────────────────────────────────────────────
// Cada mensaje consume crédito de OpenRouter, así que se limita por persona (IP).
// El conteo se guarda en Supabase (supabase/sql_para_copiar/8_limites_abuso.sql)
// para que valga entre todas las instancias de Vercel. Si Supabase no responde,
// se usa un contador en memoria como respaldo.

const MAX_HISTORY = 12;        // mensajes que se mandan al modelo
const MAX_MESSAGE_CHARS = 1000;
const MEMORY_LIMIT = 20;       // respaldo: mensajes cada 10 minutos por instancia
const MEMORY_WINDOW_MS = 10 * 60 * 1000;

const memoryHits = new Map<string, { count: number; resetAt: number }>();

function memoryRateLimitHit(key: string): boolean {
  const now = Date.now();
  const entry = memoryHits.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryHits.set(key, { count: 1, resetAt: now + MEMORY_WINDOW_MS });
    if (memoryHits.size > 5000) {
      for (const [k, v] of memoryHits) if (v.resetAt <= now) memoryHits.delete(k);
    }
    return true;
  }
  entry.count++;
  return entry.count <= MEMORY_LIMIT;
}

async function rateLimitHit(ip: string): Promise<boolean> {
  // Se guarda un hash de la IP, nunca la IP real
  const salt = process.env.RATE_LIMIT_SALT || "cimt-lia";
  const key = createHash("sha256").update(`${salt}:${ip}`).digest("hex");

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (url && anonKey) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/chat_rate_limit_hit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify({ p_key: key }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return (await res.json()) === true;
      console.warn("[LIA] rate limit RPC status:", res.status);
    } catch (err) {
      console.warn("[LIA] rate limit RPC error:", err);
    }
  }
  return memoryRateLimitHit(key);
}

type ChatMessage = { role: "user" | "assistant"; content: string };

// Solo se aceptan mensajes de usuario/asistente (nada de "system" inyectado),
// recortados en largo y cantidad.
function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is ChatMessage =>
      !!m && typeof m === "object" &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" && m.content.trim() !== "")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_HISTORY);
}

export default defineEventHandler(async (event) => {
  const apiKey =
    process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY;
  const model =
    process.env.OPENROUTER_MODEL ||
    process.env.VITE_OPENROUTER_MODEL ||
    "openai/gpt-4o-mini";

  console.log("[LIA] apiKey present:", !!apiKey, "model:", model);

  if (!apiKey) {
    setResponseStatus(event, 500);
    return { error: "OpenRouter API key not configured" };
  }

  const body = await readBody(event) as { messages?: unknown };
  const userMessages = sanitizeMessages(body?.messages);
  if (userMessages.length === 0 || userMessages[userMessages.length - 1].role !== "user") {
    setResponseStatus(event, 400);
    return { error: "Mensaje inválido" };
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) ?? "unknown";
  if (!(await rateLimitHit(ip))) {
    setResponseStatus(event, 429);
    return {
      error: "Llegaste al límite de mensajes por ahora. Probá de nuevo en unos minutos, o escribinos a cimt@smt.gob.ar.",
    };
  }

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://cimt-connect.vercel.app",
        "X-Title": "CIMT - LIA Asistente Virtual",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...userMessages,
        ],
        max_tokens: 400,
        temperature: 0.7,
      }),
    });

    const data = await upstream.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (!upstream.ok) {
      console.error("[LIA] upstream error:", data);
      setResponseStatus(event, upstream.status);
      return { error: data?.error?.message ?? "Upstream error" };
    }

    const reply =
      data.choices?.[0]?.message?.content ??
      "Lo siento, no pude procesar tu consulta. Intentá de nuevo.";

    return { reply };
  } catch (err) {
    console.error("[LIA] server fetch error:", err);
    setResponseStatus(event, 503);
    return {
      error: `Error al conectar con el asistente: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
});
