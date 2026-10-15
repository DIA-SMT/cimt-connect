import { defineEventHandler, readBody } from "nitro/h3";
import { createAdaptDraft } from "../../lib/aiDrafts";
import { handle, setup } from "../../lib/portal";
import { requireClinical, requireStaffRole } from "../../lib/portalClinical";

// POST /api/portal-staff/ai-draft — "Adaptar con ayuda de IA" (etapa "ai").
//
// Cuerpo: AiDraftRequest (src/lib/aiDraftRules.ts): patient_id, catalog_ids
// (1 a 4, del mismo enfoque), approach, practiced_in_session, quien_acompana,
// contexto, minutos, dificultad, adaptaciones e intereses.
// Respuesta: AiDraftResult { draft_id, draft, flags, sent, demo: false }.
//
// Solo profesionales y Dirección (403). Errores con code:
//   AI_UNAVAILABLE (503)  etapa "ai" apagada, sin clave, sin el script 26,
//                         sin poder revisar los límites o registrar el
//                         pedido, u OpenRouter lo rechazó por la
//                         configuración (400, 401, 402, 403 o 404: sin
//                         reintento y con su propio mensaje)
//   AI_LIMIT (429)        límite por persona o tope del centro por día (el
//                         lugar se reserva antes de llamar al proveedor)
//   AI_FAILED (502)       el modelo no devolvió un borrador que sirva
// La fecha de nacimiento y el diagnóstico del paciente se leen en el
// servidor y nunca se devuelven ni se mandan al proveedor.
export default defineEventHandler((event) => handle(event, async () => {
  const ctx = setup();
  const staff = await requireStaffRole(ctx, event);
  requireClinical(staff);
  const body: unknown = await readBody(event).catch(() => null);
  return createAdaptDraft(ctx, staff, body);
}));
