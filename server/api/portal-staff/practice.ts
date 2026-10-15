import { defineEventHandler, readBody } from "nitro/h3";
import { handle, setup } from "../../lib/portal";
import { requireFeature, requireStaffRole } from "../../lib/portalClinical";
import { staffPracticeAction } from "../../lib/practice";

// POST /api/portal-staff/practice — ejercicios, devoluciones, metas y
// medallas en la sección "Portal del paciente" (etapa "practice"; apagada:
// 404). Una sola entrada (PracticeAction, src/lib/practiceRules.ts); todas
// devuelven StaffPracticeDTO actualizado.
//
//   { action: "get", patient_id }                                   cualquier rol (Administración: sin textos)
//   { action: "catalog", patient_id }                               con el catálogo que corresponde al paciente
//   { action: "plan_save_draft", patient_id, expected_updated_at, plan }
//   { action: "plan_publish", patient_id, plan_id, expected_updated_at, expected_published_id, adolescent_ack? }
//   { action: "plan_break", patient_id, plan_id, until }            fecha de vuelta (null: termina la pausa)
//   { action: "plan_finish" | "plan_withdraw", patient_id, plan_id, reason? }
//                                                                   retirar un publicado también saca las metas activas y
//                                                                   en borrador de él y de las versiones que reemplazó
//   { action: "mark_seen", patient_id }                             "Visto", con el nombre de quien lo marca (403 code
//                                                                   AUTHOR si falta); también con el plan ya cerrado
//   { action: "feedback_send", patient_id, feedback }               también marca "Visto"
//   { action: "feedback_withdraw", patient_id, feedback_id, reason } sus metas logradas vuelven a activas (o quedan
//                                                                   "cambiada" si su plan ya se cerró) y su medalla
//                                                                   queda anulada ("devolución retirada")
//   { action: "goal_save" | "goal_publish" | "goal_change" | "goal_not_yet", patient_id, … }
//                                                                   goal_publish: 409 si el plan de la meta ya se cerró
//   { action: "medal_void", patient_id, medal_id, reason }
//
// Escriben solo profesionales y Dirección (403), con su nombre y matrícula o
// "Dirección del CIMT" (403 code AUTHOR si falta). Errores con code: CONFLICT
// (409: otra persona cambió esto), REVIEW y TITLE_BLOCK (con terms),
// AI_NOT_REVIEWED, APPROACH, EXERCISES, ADOLESCENT_ACK, INVALID (con field e
// index cuando corresponde).
export default defineEventHandler((event) => handle(event, async () => {
  requireFeature("practice");
  const ctx = setup();
  const staff = await requireStaffRole(ctx, event);
  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>;
  return staffPracticeAction(ctx, staff, body);
}));
