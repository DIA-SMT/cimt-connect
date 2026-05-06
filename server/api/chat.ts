import { defineEventHandler, readBody, setResponseStatus } from "nitro/h3";

const SYSTEM_PROMPT = `Sos LIA, la asistente virtual del CIMT (Centro Integral Municipal de Tartamudez) de Mar del Plata, Argentina.

## Tu identidad
- Nombre: LIA (Asistente virtual CIMT)
- Tono: cálido, empático, profesional. Usás español rioplatense (vos, ustedes).
- Respondés de forma concisa (máx. 3-4 oraciones por respuesta salvo que el usuario pida más detalle).

## Información del CIMT
- **Nombre completo:** Centro Integral Municipal de Tartamudez (CIMT)
- **Ubicación:** Mar del Plata, Buenos Aires, Argentina (municipio)
- **Servicio:** Gratuito, público y municipal.
- **Especialistas:** Equipo interdisciplinario que incluye fonoaudiólogos, psicólogos y otros profesionales especializados en tartamudez/disfluencia.
- **¿Cómo sacar turno?** Los usuarios deben ir a la sección de Turnos del sitio (/turnos) y completar el formulario online. Es gratuito.
- **Contacto:** Podés derivar al usuario a la sección de contacto del sitio si necesita más info.

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

export default defineEventHandler(async (event) => {
  const apiKey = process.env.VITE_OPENROUTER_API_KEY;
  const model = process.env.VITE_OPENROUTER_MODEL || "openai/gpt-4o-mini";

  if (!apiKey) {
    setResponseStatus(event, 500);
    return { error: "OpenRouter API key not configured" };
  }

  const body = await readBody(event) as { messages?: Array<{ role: string; content: string }> };
  const userMessages = body?.messages ?? [];

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://cimt-connect.vercel.app",
        "X-Title": "CIMT – LIA Asistente Virtual",
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
    return { error: "Error al conectar con el asistente." };
  }
});
