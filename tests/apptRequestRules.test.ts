// Pruebas de los pedidos de turno (src/lib/apptRequestRules.ts), que usan el
// servidor y el modo mock. Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  APPT_REQ_NOTE_MAX, APPT_REQ_OPEN, APPT_REQ_REJECT_REASONS, APPT_REQ_TRANSITIONS, APPT_REQ_VISIBLE_DAYS,
  apptRequestVisible, computeApptRequestDto, validateApptRequest,
  type ApptReqStatus, type ApptRequestRow,
} from "../src/lib/apptRequestRules";

const STATUSES: ApptReqStatus[] = ["pendiente", "contactar", "agendado", "rechazado", "cancelado"];

describe("validateApptRequest", () => {
  const ok = { reason: "continuar", days: ["lun", "mie"], band: "manana", modality: "presencial", note: "Después de la escuela" };

  test("un pedido completo pasa limpio", () => {
    expect(validateApptRequest(ok)).toEqual({
      ok: true,
      value: { reason: "continuar", days: ["lun", "mie"], band: "manana", modality: "presencial", note: "Después de la escuela" },
    });
  });
  test("pide el motivo, los días, el horario y la modalidad", () => {
    expect(validateApptRequest({ ...ok, reason: undefined })).toEqual({ ok: false, error: "Elegí para qué es el turno." });
    expect(validateApptRequest({ ...ok, reason: "urgente" }).ok).toBe(false);
    expect(validateApptRequest({ ...ok, days: [] })).toEqual({ ok: false, error: "Elegí al menos un día." });
    expect(validateApptRequest({ ...ok, days: "lun" }).ok).toBe(false);
    expect(validateApptRequest({ ...ok, band: "noche" })).toEqual({ ok: false, error: "Elegí el horario." });
    expect(validateApptRequest({ ...ok, modality: undefined })).toEqual({ ok: false, error: "Elegí si es en el centro o por videollamada." });
    expect(validateApptRequest(null).ok).toBe(false);
    expect(validateApptRequest(undefined).ok).toBe(false);
  });
  test("los días quedan sin repetir y en el orden de la semana", () => {
    const r = validateApptRequest({ ...ok, days: ["vie", "lun", "vie", "mar"] });
    expect(r.ok && r.value.days).toEqual(["lun", "mar", "vie"]);
  });
  test("un día que no existe se ignora (y si no queda ninguno, error)", () => {
    const r = validateApptRequest({ ...ok, days: ["sab", "jue", 3, null] });
    expect(r.ok && r.value.days).toEqual(["jue"]);
    expect(validateApptRequest({ ...ok, days: ["sab", "dom"] }).ok).toBe(false);
  });
  test("el comentario: se limpian los espacios, vacío es null y largo es error", () => {
    const trimmed = validateApptRequest({ ...ok, note: "  a la   tarde\n mejor  " });
    expect(trimmed.ok && trimmed.value.note).toBe("a la tarde mejor");
    for (const note of ["", "   ", null, undefined]) {
      const r = validateApptRequest({ ...ok, note });
      expect(r.ok && r.value.note).toBeNull();
    }
    const max = validateApptRequest({ ...ok, note: "x".repeat(APPT_REQ_NOTE_MAX) });
    expect(max.ok && max.value.note).toHaveLength(APPT_REQ_NOTE_MAX);
    const long = validateApptRequest({ ...ok, note: "x".repeat(APPT_REQ_NOTE_MAX + 1) });
    expect(long.ok).toBe(false);
    expect(!long.ok && long.error).toContain(String(APPT_REQ_NOTE_MAX));
  });
});

describe("computeApptRequestDto (lo que ve la familia)", () => {
  const row: ApptRequestRow = {
    id: "r1", patient_id: "p1", account_id: "acc-1", status: "pendiente",
    reason: "consulta", days: ["mar"], band: "tarde", modality: "telemedicina", note: "Mejor después de las 15",
    reject_reason: "otro", created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-01T10:00:00Z",
  };
  const child = { display: "Martín", self: false };
  const appt = { id: "a1", date: "2026-10-20", time: "15:30" };

  test("quien lo pidió ve su comentario y lo puede cancelar mientras siga abierto", () => {
    const d = computeApptRequestDto(row, child, "acc-1", null);
    expect(d.mine).toBe(true);
    expect(d.note).toBe("Mejor después de las 15");
    expect(d.can_cancel).toBe(true);
    expect(d.child_first_name).toBe("Martín");
    expect(d.is_self).toBe(false);
    expect(computeApptRequestDto({ ...row, status: "contactar" }, child, "acc-1", null).can_cancel).toBe(true);
    expect(computeApptRequestDto({ ...row, status: "agendado" }, child, "acc-1", appt).can_cancel).toBe(false);
  });
  test("otro adulto de la familia ve el pedido, pero no el comentario ni puede cancelarlo", () => {
    const d = computeApptRequestDto(row, child, "acc-2", null);
    expect(d.mine).toBe(false);
    expect(d.note).toBeNull();
    expect(d.can_cancel).toBe(false);
    expect(d.status).toBe("pendiente");
    expect(d.days).toEqual(["mar"]);
  });
  test("el turno solo viaja si está agendado", () => {
    expect(computeApptRequestDto(row, child, "acc-1", appt).appointment).toBeNull();
    expect(computeApptRequestDto({ ...row, status: "agendado" }, child, "acc-1", appt).appointment).toEqual(appt);
    expect(computeApptRequestDto({ ...row, status: "agendado" }, child, "acc-1", null).appointment).toBeNull();
  });
  test("turno cancelado: solo si está agendado, sin turno en pie y el servidor lo marca", () => {
    const agendado = { ...row, status: "agendado" as ApptReqStatus };
    // El equipo había enlazado un turno y después se canceló (o pasó a otra
    // persona). Uno borrado no llega acá: la base deja el enlace vacío
    const d = computeApptRequestDto(agendado, child, "acc-1", null, true);
    expect(d.appointment_cancelled).toBe(true);
    expect(d.appointment).toBeNull();
    expect(d.can_cancel).toBe(false);
    // Otro adulto de la familia también lo ve
    expect(computeApptRequestDto(agendado, child, "acc-2", null, true).appointment_cancelled).toBe(true);
    // Agendado sin turno enlazado (o el servidor no lo marca): no
    expect(computeApptRequestDto(agendado, child, "acc-1", null).appointment_cancelled).toBe(false);
    expect(computeApptRequestDto(agendado, child, "acc-1", null, false).appointment_cancelled).toBe(false);
    // Con el turno en pie, nunca
    const ok = computeApptRequestDto(agendado, child, "acc-1", appt, true);
    expect(ok.appointment_cancelled).toBe(false);
    expect(ok.appointment).toEqual(appt);
    // En cualquier otro estado, nunca
    for (const status of STATUSES.filter((s) => s !== "agendado")) {
      expect(computeApptRequestDto({ ...row, status }, child, "acc-1", null, true).appointment_cancelled).toBe(false);
      expect(computeApptRequestDto({ ...row, status }, child, "acc-1", appt, true).appointment_cancelled).toBe(false);
    }
  });
  test("el motivo de rechazo solo viaja si está rechazado", () => {
    expect(computeApptRequestDto(row, child, "acc-1", null).reject_reason).toBeNull();
    expect(computeApptRequestDto({ ...row, status: "rechazado" }, child, "acc-1", null).reject_reason).toBe("otro");
    expect(computeApptRequestDto({ ...row, status: "cancelado" }, child, "acc-1", null).reject_reason).toBeNull();
  });
  test("cerrado por un bloqueo judicial: viaja el motivo «bloqueo», sin turno ni forma de cancelarlo", () => {
    const blocked = { ...row, status: "rechazado" as ApptReqStatus, reject_reason: "bloqueo" as const };
    for (const acc of ["acc-1", "acc-2"]) {
      const d = computeApptRequestDto(blocked, child, acc, appt, true);
      expect(d.reject_reason).toBe("bloqueo");
      expect(d.appointment).toBeNull();
      expect(d.appointment_cancelled).toBe(false);
      expect(d.can_cancel).toBe(false);
    }
    // Si se vuelve a abrir (el bloqueo se levantó), el motivo ya no viaja
    expect(computeApptRequestDto({ ...blocked, status: "pendiente" }, child, "acc-1", null).reject_reason).toBeNull();
  });
  test("«bloqueo» no es un motivo que elija el equipo", () => {
    expect(APPT_REQ_REJECT_REASONS).toEqual(["ya_tiene_turnos", "otro"]);
    expect((APPT_REQ_REJECT_REASONS as readonly string[]).includes("bloqueo")).toBe(false);
  });
  test("un pedido sin cuenta (se borró) no es de nadie", () => {
    const d = computeApptRequestDto({ ...row, account_id: null }, child, "acc-1", null);
    expect(d.mine).toBe(false);
    expect(d.note).toBeNull();
  });
});

describe("apptRequestVisible", () => {
  const now = new Date("2026-10-13T10:00:00Z");
  const base = { status: "pendiente" as ApptReqStatus, created_at: "2026-06-01T10:00:00Z", updated_at: "2026-06-01T10:00:00Z" };

  test("un pedido abierto se ve siempre", () => {
    expect(apptRequestVisible(base, now)).toBe(true);
    expect(apptRequestVisible({ ...base, status: "contactar" }, now)).toBe(true);
  });
  test(`un pedido cerrado se ve ${APPT_REQ_VISIBLE_DAYS} días desde que se cerró`, () => {
    for (const status of ["agendado", "rechazado", "cancelado"] as ApptReqStatus[]) {
      expect(apptRequestVisible({ ...base, status, updated_at: "2026-10-01T10:00:00Z" }, now)).toBe(true);
      expect(apptRequestVisible({ ...base, status, updated_at: "2026-09-01T10:00:00Z" }, now)).toBe(false);
    }
    // Justo en el límite ya no se ve
    const edge = new Date(now.getTime() - APPT_REQ_VISIBLE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(apptRequestVisible({ ...base, status: "agendado", updated_at: edge }, now)).toBe(false);
  });
});

describe("APPT_REQ_TRANSITIONS (pasos del equipo)", () => {
  test("hay pasos para cada estado y todos llevan a un estado válido", () => {
    expect(Object.keys(APPT_REQ_TRANSITIONS).sort()).toEqual([...STATUSES].sort());
    for (const targets of Object.values(APPT_REQ_TRANSITIONS)) {
      for (const t of targets) expect(STATUSES).toContain(t);
    }
  });
  test("un pedido cancelado por la familia no se toca", () => {
    expect(APPT_REQ_TRANSITIONS.cancelado).toEqual([]);
  });
  test("el equipo nunca cancela (eso lo hace la familia) y no hay pasos a sí mismo", () => {
    for (const [from, targets] of Object.entries(APPT_REQ_TRANSITIONS)) {
      expect(targets).not.toContain("cancelado" as never);
      expect(targets).not.toContain(from as never);
    }
  });
  test("desde un pedido abierto se puede agendar o rechazar; uno cerrado solo vuelve a pendiente", () => {
    for (const s of APPT_REQ_OPEN) {
      expect(APPT_REQ_TRANSITIONS[s]).toContain("agendado");
      expect(APPT_REQ_TRANSITIONS[s]).toContain("rechazado");
    }
    expect(APPT_REQ_TRANSITIONS.agendado).toEqual(["pendiente"]);
    expect(APPT_REQ_TRANSITIONS.rechazado).toEqual(["pendiente"]);
  });
});
