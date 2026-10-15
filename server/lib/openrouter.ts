// OpenRouter — un pedido de chat que devuelve JSON (sin streaming ni
// herramientas). Lo usa la adaptación de ejercicios con IA (etapa D,
// server/lib/aiDrafts.ts) y el banco de prueba (scripts/ai-eval.ts).
//
// Reglas:
//   - NUNCA se registra en los logs el cuerpo del pedido ni el de la
//     respuesta (pueden traer el texto del catálogo, lo pedido o lo que
//     devolvió el modelo). Solo el status HTTP y el código de error.
//   - No se manda el campo "user" de OpenRouter (identificaría a quien pide).
//   - El plazo lo pone quien llama (signal): este módulo no reintenta.

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REFERER = "https://cimt-connect.vercel.app";

export type OpenRouterMessage = { role: "system" | "user" | "assistant"; content: string };

export type OpenRouterJsonRequest = {
  model: string;
  apiKey: string;
  messages: OpenRouterMessage[];
  response_format: unknown; // { type: "json_schema", json_schema: { name, strict, schema } }
  provider?: Record<string, unknown>; // preferencias de proveedor (data_collection, zdr…)
  temperature?: number;
  max_tokens?: number;
  title?: string; // encabezado X-Title (aparece en el panel de OpenRouter)
  signal?: AbortSignal;
};

export type OpenRouterUsage = { tokens_in: number | null; tokens_out: number | null; cost_usd: number | null };

export type OpenRouterErrorCode =
  | "TIMEOUT" // se terminó el plazo (o se canceló)
  | "NETWORK" // no se pudo conectar
  | "HTTP" // respondió con un status de error (ver status)
  | "UPSTREAM" // respondió 200 pero con un error del proveedor adentro
  | "BAD_RESPONSE" // la respuesta no tiene la forma esperada
  | "EMPTY"; // el modelo no devolvió texto (o se negó)

export type OpenRouterResult =
  | { ok: true; status: number; content: string; model: string | null; finish_reason: string | null; usage: OpenRouterUsage }
  | { ok: false; status: number | null; code: OpenRouterErrorCode; retryable: boolean; usage: OpenRouterUsage | null };

// El cuerpo exacto que se manda (sin "user", sin herramientas, sin streaming)
export function openrouterBody(req: OpenRouterJsonRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    response_format: req.response_format,
    stream: false,
  };
  if (req.provider) body.provider = req.provider;
  if (typeof req.temperature === "number") body.temperature = req.temperature;
  if (typeof req.max_tokens === "number") body.max_tokens = req.max_tokens;
  return body;
}

// Un status de error que vale la pena reintentar (si queda plazo)
export function retryableStatus(status: number): boolean {
  return status === 408 || status >= 500;
}

// Código de error de OpenRouter o del proveedor, solo si es corto y sin
// texto libre (lo único que se puede registrar además del status)
function safeCode(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  if (typeof raw === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(raw)) return raw;
  return "-";
}

function logFailure(status: number | null, code: OpenRouterErrorCode, upstreamCode: unknown = null) {
  // Solo status y códigos: nunca el cuerpo
  console.warn("[ia] openrouter:", status ?? "-", code, safeCode(upstreamCode));
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

function usageOf(json: Record<string, unknown>): OpenRouterUsage | null {
  const u = json.usage;
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  return { tokens_in: num(r.prompt_tokens), tokens_out: num(r.completion_tokens), cost_usd: num(r.cost) };
}

// El texto de la respuesta: string, o partes de texto (algunos proveedores)
function contentOf(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const c = (message as Record<string, unknown>).content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    const text = c
      .map((p) => (p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string" ? (p as { text: string }).text : ""))
      .join("");
    return text;
  }
  return null;
}

function aborted(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = err && typeof err === "object" ? (err as { name?: unknown }).name : null;
  return name === "AbortError" || name === "TimeoutError";
}

export async function openrouterJson(req: OpenRouterJsonRequest): Promise<OpenRouterResult> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${req.apiKey}`,
        "HTTP-Referer": REFERER,
        ...(req.title ? { "X-Title": req.title } : {}),
      },
      body: JSON.stringify(openrouterBody(req)),
      signal: req.signal,
    });
  } catch (err) {
    const code: OpenRouterErrorCode = aborted(err, req.signal) ? "TIMEOUT" : "NETWORK";
    logFailure(null, code);
    return { ok: false, status: null, code, retryable: code === "NETWORK", usage: null };
  }

  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(await res.text());
    json = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch (err) {
    if (aborted(err, req.signal)) {
      logFailure(res.status, "TIMEOUT");
      return { ok: false, status: res.status, code: "TIMEOUT", retryable: false, usage: null };
    }
    json = null;
  }

  const upstreamError = json?.error && typeof json.error === "object" ? (json.error as Record<string, unknown>) : null;
  if (!res.ok) {
    logFailure(res.status, "HTTP", upstreamError?.code);
    return { ok: false, status: res.status, code: "HTTP", retryable: retryableStatus(res.status), usage: json ? usageOf(json) : null };
  }
  if (!json) {
    logFailure(res.status, "BAD_RESPONSE");
    return { ok: false, status: res.status, code: "BAD_RESPONSE", retryable: true, usage: null };
  }
  const usage = usageOf(json) ?? { tokens_in: null, tokens_out: null, cost_usd: null };
  if (upstreamError) {
    logFailure(res.status, "UPSTREAM", upstreamError.code);
    return { ok: false, status: res.status, code: "UPSTREAM", retryable: true, usage };
  }

  const choice = Array.isArray(json.choices) ? (json.choices[0] as Record<string, unknown> | undefined) : undefined;
  if (!choice || typeof choice !== "object") {
    logFailure(res.status, "BAD_RESPONSE");
    return { ok: false, status: res.status, code: "BAD_RESPONSE", retryable: true, usage };
  }
  // Error del proveedor dentro de la elección (OpenRouter lo informa así a veces)
  if (choice.error && typeof choice.error === "object") {
    logFailure(res.status, "UPSTREAM", (choice.error as Record<string, unknown>).code);
    return { ok: false, status: res.status, code: "UPSTREAM", retryable: true, usage };
  }
  const content = contentOf(choice.message);
  if (!content || !content.trim()) {
    logFailure(res.status, "EMPTY");
    return { ok: false, status: res.status, code: "EMPTY", retryable: true, usage };
  }
  return {
    ok: true,
    status: res.status,
    content,
    model: typeof json.model === "string" ? json.model : null,
    finish_reason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
    usage,
  };
}
