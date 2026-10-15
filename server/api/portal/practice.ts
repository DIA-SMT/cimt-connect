import { defineEventHandler, getQuery, readBody } from "nitro/h3";
import { PortalError, handle, requireFamily, setup } from "../../lib/portal";
import { requireFeature } from "../../lib/portalClinical";
import {
  familyExercise, familyFeedback, familyFeedbackSeen, familyLog, familyMedals, familyMedalsSeen, familyNote, familyPractice,
  familyUndo,
} from "../../lib/practice";

// Ejercicios, devoluciones, metas y medallas (etapa "practice"; apagada: 404).
// Sin contraseña de nuevo. 403 con code CONSENT, VERIFY o NOT_AVAILABLE; un
// paciente, ejercicio, práctica o medalla ajenos dan el mismo 404 que uno
// que no existe.
//
// GET /api/portal/practice?view=…&id=…
//   view=plan&id=<paciente>       → PracticeDTO ("Ejercicios de Martín")
//   view=exercise&id=<ejercicio>  → PracticeExerciseDTO (pantalla de práctica)
//   view=feedback&id=<paciente>   → FeedbackDTO (solo lee: is_new = esta cuenta todavía no la vio)
//   view=medals&id=<paciente>     → MedalsDTO
//
// POST /api/portal/practice
//   { action: "log", exercise_id, practiced_on? }   → PracticeActionResult ("Ya lo hice"; uno por
//       ejercicio y por día: si otro adulto ya lo anotó, devuelve ese. 400 code DATE, 429 code LIMIT)
//   { action: "note", log_id, result?, comment? }   → PracticeActionResult (una por cuenta: 409 si ya la dejó)
//   { action: "undo", log_id }                      → PracticeActionResult (lo de esta cuenta, el mismo día)
//   { action: "medals_seen", ids }                  → { ok: true } (hasta 50; el id de una medalla de
//       constancia marca todas las de ese paciente y ese código: se ven en grupo)
//   { action: "feedback_seen", ids }                → { ok: true } (hasta 50: las devoluciones que la
//       página ya mostró; las retiradas o ajenas se ignoran)
export default defineEventHandler((event) => handle(event, async () => {
  requireFeature("practice");
  const ctx = setup();
  const account = await requireFamily(ctx, event);

  if (event.req.method === "GET") {
    const q = getQuery(event);
    const id = String(q.id ?? "");
    switch (q.view) {
      case "plan": return familyPractice(ctx, account, id);
      case "exercise": return familyExercise(ctx, account, id);
      case "feedback": return familyFeedback(ctx, account, id);
      case "medals": return familyMedals(ctx, account, id);
      default: throw new PortalError(400, "Pedido inválido");
    }
  }

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>;
  switch (body.action) {
    case "log": return familyLog(ctx, account, body);
    case "note": return familyNote(ctx, account, body);
    case "undo": return familyUndo(ctx, account, body);
    case "medals_seen": return familyMedalsSeen(ctx, account, body);
    case "feedback_seen": return familyFeedbackSeen(ctx, account, body);
    default: throw new PortalError(400, "Pedido inválido");
  }
}));
