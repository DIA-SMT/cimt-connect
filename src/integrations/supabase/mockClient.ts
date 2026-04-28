/**
 * Mock Supabase client — simula la API de Supabase usando datos en memoria.
 * Se activa cuando VITE_USE_MOCK=true en .env.local
 *
 * Soporta los métodos que usa la app:
 *   supabase.from(table).select(...).gte().lte().neq().order().eq()
 *   supabase.from(table).insert(data)
 *   supabase.from(table).update(data).eq()
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

    // Column projection (simple: if not "*", pick named columns)
    if (this._selectCols && this._selectCols !== "*") {
      const cols = this._selectCols.split(",").map((c) => c.trim());
      rows = rows.map((r) =>
        Object.fromEntries(cols.map((c) => [c, r[c]]))
      );
    }

    return { data: rows, error: null };
  }
}

// ─── Mock Client ─────────────────────────────────────────────────────────────

export const mockSupabase = {
  from(table: string) {
    return new MockQueryBuilder(table);
  },
  // Stub auth methods so nothing crashes if called
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
};
