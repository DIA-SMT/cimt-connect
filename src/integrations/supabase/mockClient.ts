/**
 * Mock Supabase client — simula la API de Supabase usando datos en memoria.
 * Se activa cuando VITE_USE_MOCK=true en .env.local
 *
 * Soporta los métodos que usa la app:
 *   supabase.from(table).select(...).gte().lte().neq().order().eq()
 *   supabase.from(table).insert(data)
 *   supabase.from(table).update(data).eq()
 *   supabase.rpc("get_booked_slots" | "request_appointment" | "is_admin", args)
 *   supabase.auth.signInWithPassword / signOut (cualquier email/contraseña entra como admin)
 */

import {
  MOCK_PROFESSIONALS,
  MOCK_APPOINTMENTS,
  type MockAppointment,
  type MockProfessional,
} from "@/lib/mockData";

// In-memory store (mutations persist during the session)
let appointments = [...MOCK_APPOINTMENTS];
const professionals = [...MOCK_PROFESSIONALS];

type Row = Record<string, unknown>;

// ─── Query builder ───────────────────────────────────────────────────────────

class MockQueryBuilder {
  private _table: string;
  private _data: Row[];
  private _filters: Array<(row: Row) => boolean> = [];
  private _orders: Array<{ key: string; asc: boolean }> = [];
  private _selectCols: string | null = null;
  private _insertPayload: Row | null = null;
  private _updatePayload: Row | null = null;

  constructor(table: string) {
    this._table = table;
    this._data = this._getStore();
  }

  private _getStore(): Row[] {
    if (this._table === "professionals") return professionals as unknown as Row[];
    if (this._table === "appointments") return appointments as unknown as Row[];
    return [];
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  select(cols?: string) {
    this._selectCols = cols ?? "*";
    return this;
  }

  gte(col: string, value: string) {
    this._filters.push((row) => String(row[col]) >= value);
    return this;
  }

  lte(col: string, value: string) {
    this._filters.push((row) => String(row[col]) <= value);
    return this;
  }

  neq(col: string, value: unknown) {
    this._filters.push((row) => row[col] !== value);
    return this;
  }

  eq(col: string, value: unknown) {
    this._filters.push((row) => row[col] === value);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this._orders.push({ key: col, asc: opts?.ascending !== false });
    return this;
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  insert(payload: Row) {
    this._insertPayload = payload;
    return this;
  }

  update(payload: Row) {
    this._updatePayload = payload;
    return this;
  }

  // ── Execution (thenable) ──────────────────────────────────────────────────

  then(
    resolve: (result: { data: Row[] | Row | null; error: null }) => void,
    _reject?: never
  ) {
    const result = this._execute();
    resolve(result);
  }

  // Supabase returns a promise-like — we implement the await interface
  private _execute(): { data: Row[] | Row | null; error: null } {
    // INSERT
    if (this._insertPayload !== null) {
      const newRow: Row = {
        id: `mock-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "pendiente",
        ...this._insertPayload,
      };
      if (this._table === "appointments") {
        appointments.push(newRow as unknown as MockAppointment);
      }
      return { data: newRow, error: null };
    }

    // UPDATE
    if (this._updatePayload !== null) {
      if (this._table === "appointments") {
        appointments = appointments.map((a) => {
          const row = a as unknown as Row;
          const passes = this._filters.every((f) => f(row));
          if (passes) return { ...a, ...this._updatePayload, updated_at: new Date().toISOString() } as unknown as MockAppointment;
          return a;
        });
      }
      return { data: null, error: null };
    }

    // SELECT
    let rows = [...this._getStore()];

    // Apply filters
    for (const f of this._filters) {
      rows = rows.filter(f);
    }

    // Apply ordering
    for (const { key, asc } of this._orders) {
      rows.sort((a, b) => {
        const av = String(a[key] ?? "");
        const bv = String(b[key] ?? "");
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }

    // Los mocks guardan los datos del paciente "planos" en el turno;
    // el panel admin espera el join appointments → patients.
    if (this._table === "appointments" && this._selectCols?.includes("patients(")) {
      rows = rows.map((r) => ({
        ...r,
        patients: {
          first_name: r.first_name, last_name: r.last_name, dni: r.dni, age: r.age,
          phone: r.phone, email: r.email, patient_type: r.patient_type,
        },
      }));
    }

    // Column projection (simple: if not "*", pick named columns)
    if (this._selectCols && !this._selectCols.includes("*")) {
      const cols = this._selectCols.split(",").map((c) => c.trim());
      rows = rows.map((r) =>
        Object.fromEntries(cols.map((c) => [c, r[c]]))
      );
    }

    return { data: rows, error: null };
  }
}

// ─── Mock Client ─────────────────────────────────────────────────────────────

type MockSession = { user: { id: string; email: string } } | null;
let session: MockSession = null;
const authListeners = new Set<(event: string, session: MockSession) => void>();

function setSession(next: MockSession, event: string) {
  session = next;
  authListeners.forEach((cb) => cb(event, session));
}

function rpc(fn: string, args: Row = {}) {
  if (fn === "is_admin") {
    return Promise.resolve({ data: session !== null, error: null });
  }

  if (fn === "get_booked_slots") {
    const data = appointments
      .filter((a) =>
        a.appointment_date >= String(args.p_start) &&
        a.appointment_date <= String(args.p_end) &&
        a.status !== "cancelado")
      .map(({ appointment_date, appointment_time, status }) => ({ appointment_date, appointment_time, status }));
    return Promise.resolve({ data, error: null });
  }

  if (fn === "request_appointment") {
    const time = `${String(args.p_time).slice(0, 5)}:00`;
    const taken = appointments.some((a) =>
      a.appointment_date === args.p_date && a.appointment_time === time && a.status !== "cancelado");
    if (taken) {
      return Promise.resolve({ data: null, error: { message: "SLOT_TAKEN: Ese horario ya fue reservado" } });
    }
    const id = `mock-${Date.now()}`;
    const now = new Date().toISOString();
    appointments.push({
      id,
      first_name: String(args.p_first_name),
      last_name: String(args.p_last_name),
      dni: String(args.p_dni),
      age: Number(args.p_age),
      phone: String(args.p_phone),
      email: (args.p_email as string | null) ?? null,
      patient_type: args.p_patient_type as MockAppointment["patient_type"],
      consultation_type: args.p_consultation_type as MockAppointment["consultation_type"],
      reason: String(args.p_reason),
      appointment_date: String(args.p_date),
      appointment_time: time,
      status: "pendiente",
      professional_id: null,
      created_at: now,
      updated_at: now,
    } as MockAppointment);
    return Promise.resolve({ data: id, error: null });
  }

  return Promise.resolve({ data: null, error: { message: `Mock: función ${fn} no implementada` } });
}

export const mockSupabase = {
  from(table: string) {
    return new MockQueryBuilder(table);
  },
  rpc,
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    signInWithPassword: async ({ email }: { email: string; password: string }) => {
      setSession({ user: { id: "mock-admin", email } }, "SIGNED_IN");
      return { data: { session }, error: null };
    },
    signOut: async () => {
      setSession(null, "SIGNED_OUT");
      return { error: null };
    },
    onAuthStateChange: (cb: (event: string, session: MockSession) => void) => {
      authListeners.add(cb);
      return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
    },
  },
};
