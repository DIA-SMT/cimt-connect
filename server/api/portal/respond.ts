import { defineEventHandler, readBody } from "nitro/h3";
import { CONFIRM_WINDOW_DAYS, REASON_CODES, REASON_TEXT_MAX, type ReasonCode } from "../../../src/lib/portalRules";
import { PortalError, activeChildren, appointmentById, handle, requireFamily, setup } from "../../lib/portal";

// POST /api/portal/respond { appointment_id, response, reason_code?, reason_text? } → ApptDTO
// "Vamos a ir" / "No vamos a poder ir". No toca el turno: el equipo lo
// resuelve desde el panel (cancelar o asistencia "justificado").
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const account = await requireFamily(ctx, event);
  const body = (await readBody(event)) as {
    appointment_id?: string; response?: string; reason_code?: string; reason_text?: string;
  } | null;
  const children = await activeChildren(ctx, account);
  const appt = await appointmentById(ctx, account, children, String(body?.appointment_id ?? ""));
  if (!appt) throw new PortalError(404, "No encontramos ese turno en tu cuenta.");

  const kind = body?.response;
  if (kind !== "confirmo" && kind !== "no_puedo") throw new PortalError(400, "Elegí una respuesta.");
  if (appt.state === "cancelado") throw new PortalError(409, "El centro canceló este turno.");
  if (appt.is_past) throw new PortalError(409, "Este turno ya pasó. Si no pudieron venir, llamanos.");
  if (!appt.can_decline) throw new PortalError(409, "El equipo ya resolvió tu aviso. Si cambió algo, llamanos.");
  if (kind === "confirmo" && !appt.can_confirm) {
    throw new PortalError(400, `Todavía no se puede confirmar este turno: se habilita ${CONFIRM_WINDOW_DAYS} días antes.`);
  }

  let reason_code: ReasonCode | null = null;
  let reason_text: string | null = null;
  if (kind === "no_puedo") {
    if (!(REASON_CODES as readonly string[]).includes(String(body?.reason_code))) throw new PortalError(400, "Elegí un motivo.");
    reason_code = body!.reason_code as ReasonCode;
    const text = String(body?.reason_text ?? "").replace(/\s+/g, " ").trim();
    if (text.length > REASON_TEXT_MAX) throw new PortalError(400, `El comentario puede tener hasta ${REASON_TEXT_MAX} caracteres.`);
    reason_text = text || null;
  }

  const { error } = await ctx.admin.from("portal_appointment_responses").insert({
    appointment_id: appt.id, account_id: account.id, kind, reason_code, reason_text,
  });
  if (error) throw new PortalError(503, "No pudimos guardar tu respuesta. Probá de nuevo.");
  return (await appointmentById(ctx, account, children, appt.id))!;
}));
