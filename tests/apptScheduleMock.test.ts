// Pruebas del modo mock para «Dar turno» → «Cargar el turno acá» (bandeja
// Portal → Pedidos de turno): el panel guarda el turno con el cliente del mock
// (src/integrations/supabase/mockClient.ts, con las reglas de la agenda) y lo
// enlaza al pedido con staffApptUpdate (src/integrations/supabase/mockPortal.ts).
// Un chico de la demo también ve los turnos de la agenda del mock: el pedido
// queda agendado, la familia ve el día y la hora, y un turno cancelado, de
// otra persona o un pedido que cambió mientras tanto no se enlazan.
// El mock guarda todo en localStorage y la sesión en sessionStorage: acá van
// en memoria. Las esperas del mock (que imitan la red) se acortan a 0.
// Correr con: bun test
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { agendaErrorMessage } from "../src/lib/agenda";
import { addDaysKey, centerNow } from "../src/lib/portalRules";

type Mock = typeof import("../src/integrations/supabase/mockPortal");
type Client = typeof import("../src/integrations/supabase/mockClient");

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const g = globalThis as unknown as Record<string, unknown>;
const realSetTimeout = globalThis.setTimeout;
const hadWindow = "window" in g;
const local = new MemoryStorage();
const session = new MemoryStorage();
let mock: Mock;
let client: Client;

const STAFF = "demo@cimt.local";
const REQ = "pt-demo-2"; // Jorge pidió un turno para Valentina: pendiente
const VALE = "c-valentina";
const MARTIN = "c-martin";
const PRO = "pro-001"; // de la agenda del mock
const PRO_NAME = "Lic. María Elena Rodríguez";

// La agenda del mock no se borra entre pruebas: cada una usa su propio día
// (lejos de los turnos de ejemplo, que son de los próximos días)
const day = (offset: number) => addDaysKey(centerNow().date, offset);

const ok = <T>(r: { ok: true; data: T } | { ok: false; status: number; error: string }): T => {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.data;
};

// Lo mismo que hace el panel al tocar «Dar el turno»
async function insertAppt(patientId: string, date: string, time: string): Promise<string> {
  const { data, error } = await client.mockSupabase.from("appointments").insert({
    patient_id: patientId, professional_id: PRO, appointment_date: date, appointment_time: time, duration_minutes: 30,
    modality: "presencial", consultation_type: "seguimiento", reason: "Seguir con el tratamiento (pedido por el portal)",
    status: "confirmado",
  }).select("id").single();
  if (error) throw new Error(error.message);
  return String((data as { id: string }).id);
}

async function cancelAppt(id: string) {
  const { error } = await client.mockSupabase.from("appointments").update({ status: "cancelado" }).eq("id", id);
  if (error) throw new Error(error.message);
}

async function staffRow() {
  return ok(await mock.staffInbox()).turnos.find((r) => r.id === REQ)!;
}

beforeAll(async () => {
  g.setTimeout = ((fn: (...a: unknown[]) => void, _ms?: number, ...args: unknown[]) => realSetTimeout(fn, 0, ...args)) as never;
  g.window = { localStorage: local, sessionStorage: session };
  mock = await import("../src/integrations/supabase/mockPortal");
  client = await import("../src/integrations/supabase/mockClient");
});

afterAll(() => {
  g.setTimeout = realSetTimeout;
  if (!hadWindow) delete g.window;
});

beforeEach(async () => {
  mock.resetDemo();
  local.clear();
  session.clear();
  await client.mockSupabase.auth.signOut();
  await client.mockSupabase.auth.signInWithPassword({ email: STAFF, password: "x" });
});

describe("mock: «Dar turno» desde la bandeja", () => {
  test("el turno cargado con el cliente del mock se enlaza y la familia ve el día y la hora", async () => {
    const date = day(40);
    const id = await insertAppt(VALE, date, "15:00");
    // Ya aparece entre sus próximos turnos (la opción «Ya está en la Agenda»)
    const before = await staffRow();
    expect(before.status).toBe("pendiente");
    expect(before.upcoming.some((s) => s.id === id)).toBe(true);

    const linked = ok(await mock.staffApptUpdate({ id: REQ, to: "agendado", appointment_id: id }, STAFF));
    expect(linked.status).toBe("agendado");
    expect(linked.appointment).toEqual({ id, date, time: "15:00", professional_name: PRO_NAME });
    expect(linked.scheduled_by_email).toBe(STAFF);
    expect((await staffRow()).appointment?.id).toBe(id);

    // Jorge (quien lo pidió) lo ve en el pedido y entre los turnos de Valentina
    ok(await mock.login("28999888", "familia2026"));
    const page = ok(await mock.childAppointments(VALE));
    const req = page.turnos.requests.find((r) => r.id === REQ)!;
    expect(req.status).toBe("agendado");
    expect(req.appointment).toEqual({ id, date, time: "15:00" });
    expect(page.appointments.some((a) => a.id === id && a.date === date && a.time === "15:00" && a.state === "agendado")).toBe(true);
  });

  test("un turno de otra persona, cancelado o que no existe no se enlaza (y el pedido sigue pendiente)", async () => {
    const date = day(41);
    const other = await insertAppt(MARTIN, date, "15:00");
    const cancelled = await insertAppt(VALE, date, "16:00");
    await cancelAppt(cancelled);
    for (const appointmentId of [other, cancelled, "no-existe"]) {
      const res = await mock.staffApptUpdate({ id: REQ, to: "agendado", appointment_id: appointmentId }, STAFF);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.status).toBe(400);
    }
    expect((await staffRow()).status).toBe("pendiente");
  });

  test("si la familia canceló el pedido mientras tanto, no se enlaza (409) y el turno se puede cancelar", async () => {
    ok(await mock.login("28999888", "familia2026"));
    ok(await mock.apptRequestCancel(REQ));
    const id = await insertAppt(VALE, day(42), "15:00");
    const res = await mock.staffApptUpdate({ id: REQ, to: "agendado", appointment_id: id }, STAFF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
    expect((await staffRow()).status).toBe("cancelado");

    // «Cancelar ese turno»: la familia lo ve cancelado (no queda un turno suelto en pie)
    await cancelAppt(id);
    const page = ok(await mock.childAppointments(VALE));
    expect(page.appointments.find((a) => a.id === id)?.state).toBe("cancelado");
  });

  test("si después se cancela el turno enlazado, el equipo y la familia lo ven", async () => {
    const id = await insertAppt(VALE, day(43), "15:00");
    ok(await mock.staffApptUpdate({ id: REQ, to: "agendado", appointment_id: id }, STAFF));
    await cancelAppt(id);
    const row = await staffRow();
    expect(row.status).toBe("agendado");
    expect(row.appointment).toBeNull();
    expect(row.appointment_cancelled).toBe(true);
    ok(await mock.login("28999888", "familia2026"));
    const req = ok(await mock.childAppointments(VALE)).turnos.requests.find((r) => r.id === REQ)!;
    expect(req.appointment).toBeNull();
    expect(req.appointment_cancelled).toBe(true);
  });

  test("se cortó la respuesta: el turno se encuentra y volver a enlazarlo no es un error", async () => {
    const date = day(45);
    const id = await insertAppt(VALE, date, "15:00");
    // El reintento del mismo horario choca consigo mismo...
    const retry = await client.mockSupabase.from("appointments").insert({
      patient_id: VALE, professional_id: PRO, appointment_date: date, appointment_time: "15:00", duration_minutes: 30,
      modality: "presencial", consultation_type: "seguimiento", reason: "x", status: "confirmado",
    }).select("id").single();
    expect(retry.error?.message?.startsWith("OVERLAP:")).toBe(true);
    // ...y se encuentra como lo busca el panel (chico, profesional, día y hora, sin cancelar)
    const { data: found, error } = await client.mockSupabase.from("appointments").select("id")
      .eq("patient_id", VALE).eq("professional_id", PRO).eq("appointment_date", date).eq("appointment_time", "15:00")
      .neq("status", "cancelado").limit(1);
    expect(error).toBeNull();
    expect((found as { id: string }[]).map((a) => a.id)).toEqual([id]);

    // Se enlazó pero no llegó la respuesta: volver a enlazarlo devuelve el pedido como quedó
    const first = ok(await mock.staffApptUpdate({ id: REQ, to: "agendado", appointment_id: id }, STAFF));
    const again = ok(await mock.staffApptUpdate({ id: REQ, to: "agendado", appointment_id: id }, STAFF));
    expect(again.appointment?.id).toBe(id);
    expect(again.scheduled_at).toBe(first.scheduled_at);
    expect(again.events?.filter((e) => e.kind === "agendado")).toHaveLength(1);
    // Con otro turno, el pedido ya cambió (409)
    const other = await insertAppt(VALE, date, "16:00");
    const res = await mock.staffApptUpdate({ id: REQ, to: "agendado", appointment_id: other }, STAFF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(409);
    expect((await staffRow()).appointment?.id).toBe(id);
  });

  test("superposición: la agenda del mock rechaza el turno con el mensaje de la base", async () => {
    const date = day(44);
    await insertAppt(MARTIN, date, "15:00");
    const { error } = await client.mockSupabase.from("appointments").insert({
      patient_id: VALE, professional_id: PRO, appointment_date: date, appointment_time: "15:15", duration_minutes: 30,
      modality: "presencial", consultation_type: "seguimiento", reason: "x", status: "confirmado",
    }).select("id").single();
    expect(error).not.toBeNull();
    expect(agendaErrorMessage(error?.message)).toBe("El profesional ya tiene un turno en ese horario");
    expect((await staffRow()).upcoming.some((s) => s.date === date)).toBe(false);
  });
});
