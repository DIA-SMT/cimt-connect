// Pruebas del servidor de los pedidos de turno (server/lib/apptRequests.ts) en
// lo que usa «Dar turno» → «Cargar el turno acá» del panel: el turno recién
// cargado se enlaza al pedido con staffApptUpdate(to: "agendado"), que solo
// acepta un turno de esa misma persona, sin cancelar y de hoy en adelante, y
// solo si el pedido sigue abierto. Contra una base de prueba en memoria que
// imita lo justo del cliente de Supabase.
// Correr con: bun test
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, test } from "bun:test";
import { staffApptUpdate } from "../server/lib/apptRequests";
import { type Ctx, PortalError } from "../server/lib/portal";
import { addDaysKey, centerNow } from "../src/lib/portalRules";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string; message: string } | null };

class FakeQuery implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" = "select";
  private cols: string | null = "*";
  private payload: Row = {};
  private mode: "many" | "maybe" | "one" = "many";

  constructor(private tables: Record<string, Row[]>, private table: string) {}

  select(cols = "*") { this.cols = cols; return this; }
  insert(row: Row) { this.op = "insert"; this.payload = row; this.cols = null; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; this.cols = null; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "one"; return this; }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }

  private run(): Result {
    const rows = (this.tables[this.table] ??= []);
    let out: Row[];
    if (this.op === "insert") {
      out = [{ id: randomUUID(), created_at: new Date().toISOString(), ...this.payload }];
      rows.push(out[0]);
    } else {
      out = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") for (const r of out) Object.assign(r, this.payload);
    }
    if (this.cols === null) return { data: null, error: null };
    const cols = this.cols === "*" ? [] : this.cols.split(",").map((c) => c.trim());
    const pick = (r: Row) => (cols.length ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : { ...r });
    if (this.mode === "maybe") return { data: out.length ? pick(out[0]) : null, error: null };
    if (this.mode === "one") return out.length === 1 ? { data: pick(out[0]), error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    return { data: out.map(pick), error: null };
  }
}

const STAFF = "equipo@cimt.local";
const PATIENT = randomUUID();
const OTHER_PATIENT = randomUUID();
const PRO = randomUUID();
const REQ = randomUUID();
let tables: Record<string, Row[]>;
let ctx: Ctx;

function appt(extra: Row = {}): Row {
  return {
    id: randomUUID(), patient_id: PATIENT, professional_id: PRO, appointment_date: addDaysKey(centerNow().date, 7),
    appointment_time: "15:00:00", status: "confirmado", ...extra,
  };
}

function request(extra: Row = {}): Row {
  const at = new Date(Date.now() - 3_600_000).toISOString();
  return {
    id: REQ, patient_id: PATIENT, account_id: randomUUID(), link_kind: "representante_legal", requester_name: "Jorge Ruiz",
    status: "pendiente", reason: "continuar", days: ["mar", "jue"], band: "tarde", modality: "presencial", note: null,
    appointment_id: null, scheduled_at: null, scheduled_by_email: null, contacted_at: null, contacted_by_email: null,
    rejected_at: null, rejected_by_email: null, reject_reason: null, cancelled_at: null, staff_notes: null,
    created_at: at, updated_at: at, ...extra,
  };
}

async function failure(p: Promise<unknown>): Promise<PortalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PortalError) return e;
    throw e;
  }
  throw new Error("se esperaba un error");
}

beforeEach(() => {
  tables = {
    portal_appt_requests: [request()],
    portal_appt_request_events: [],
    appointments: [],
    patients: [{ id: PATIENT, first_name: "Valentina", last_name: "Ruiz", phone: null, guardian_phone: null }],
    patient_guardians: [],
    portal_guardian_blocks: [],
    professionals: [{ id: PRO, name: "Lic. Paula Díaz" }],
  };
  ctx = { admin: { from: (t: string) => new FakeQuery(tables, t) } } as unknown as Ctx;
});

describe("staffApptUpdate: agendado con el turno recién cargado", () => {
  test("enlaza un turno de esta persona, en pie y a futuro: el pedido queda agendado con el día y la hora", async () => {
    const a = appt();
    tables.appointments.push(a);
    const out = await staffApptUpdate(ctx, STAFF, { id: REQ, to: "agendado", appointment_id: a.id });
    expect(out.status).toBe("agendado");
    expect(out.appointment).toEqual({ id: a.id as string, date: a.appointment_date as string, time: "15:00", professional_name: "Lic. Paula Díaz" });
    expect(out.scheduled_by_email).toBe(STAFF);
    expect(tables.portal_appt_requests[0]).toMatchObject({ status: "agendado", appointment_id: a.id });
    expect(tables.portal_appt_request_events).toEqual([expect.objectContaining({ request_id: REQ, kind: "agendado", by_email: STAFF })]);
  });

  test("también un turno de hoy", async () => {
    const a = appt({ appointment_date: centerNow().date });
    tables.appointments.push(a);
    expect((await staffApptUpdate(ctx, STAFF, { id: REQ, to: "agendado", appointment_id: a.id })).appointment?.id).toBe(a.id as string);
  });

  test("no enlaza un turno de otra persona, cancelado, que ya pasó o que no existe (y el pedido no cambia)", async () => {
    const other = appt({ patient_id: OTHER_PATIENT });
    const cancelled = appt({ status: "cancelado" });
    const past = appt({ appointment_date: addDaysKey(centerNow().date, -1) });
    tables.appointments.push(other, cancelled, past);
    for (const appointmentId of [other.id, cancelled.id, past.id, randomUUID(), "no-es-un-id"]) {
      const e = await failure(staffApptUpdate(ctx, STAFF, { id: REQ, to: "agendado", appointment_id: appointmentId }));
      expect(e.status).toBe(400);
    }
    expect(tables.portal_appt_requests[0]).toMatchObject({ status: "pendiente", appointment_id: null });
    expect(tables.portal_appt_request_events).toEqual([]);
  });

  test("volver a enlazar el mismo turno (se cortó la respuesta pero se guardó): no es un error ni un cambio", async () => {
    const a = appt();
    tables.appointments.push(a);
    const first = await staffApptUpdate(ctx, STAFF, { id: REQ, to: "agendado", appointment_id: a.id });
    const again = await staffApptUpdate(ctx, STAFF, { id: REQ, to: "agendado", appointment_id: a.id });
    expect(again.status).toBe("agendado");
    expect(again.appointment?.id).toBe(a.id as string);
    expect(again.scheduled_at).toBe(first.scheduled_at);
    // Una sola constancia
    expect(tables.portal_appt_request_events).toHaveLength(1);
    // Con otro turno (o sin turno), sigue siendo un pedido que cambió mientras tanto
    const b = appt({ appointment_time: "16:00:00" });
    tables.appointments.push(b);
    expect((await failure(staffApptUpdate(ctx, STAFF, { id: REQ, to: "agendado", appointment_id: b.id }))).status).toBe(409);
    expect((await failure(staffApptUpdate(ctx, STAFF, { id: REQ, to: "agendado", appointment_id: null }))).status).toBe(409);
    expect(tables.portal_appt_requests[0].appointment_id).toBe(a.id);
  });

  test("si el pedido ya no está abierto (otra persona lo resolvió o la familia lo canceló): 409", async () => {
    const a = appt();
    tables.appointments.push(a);
    for (const status of ["agendado", "cancelado", "rechazado"]) {
      tables.portal_appt_requests = [request({ status })];
      const e = await failure(staffApptUpdate(ctx, STAFF, { id: REQ, to: "agendado", appointment_id: a.id }));
      expect(e.status).toBe(409);
      expect(tables.portal_appt_requests[0].appointment_id).toBeNull();
    }
  });
});
