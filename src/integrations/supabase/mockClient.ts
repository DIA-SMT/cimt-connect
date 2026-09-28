/**
 * Mock Supabase client — simula la API de Supabase usando datos en memoria.
 * Se activa cuando VITE_USE_MOCK=true en .env.local
 *
 * Soporta los métodos que usa la app:
 *   supabase.from(table).select(...).gte().lte().neq().order().eq().single()
 *   supabase.from(table).insert(data).select().single()
 *   supabase.from(table).update(data).eq()
 *   supabase.rpc("get_booked_slots" | "request_appointment" | "is_admin", args)
 *   supabase.auth.signInWithPassword / signOut (cualquier email/contraseña entra como admin)
 *
 * Tablas: professionals, appointments, patients, patient_referrals, patient_followups, patient_reports
 */

import {
  MOCK_PROFESSIONALS,
  MOCK_APPOINTMENTS,
} from "@/lib/mockData";

type Row = Record<string, unknown>;

// ─── In-memory store (mutations persist during the session) ──────────────────

// Los mocks de turnos traen los datos del paciente "planos": se separan en
// una tabla patients (por DNI) como en la base real.
const PATIENT_DEFAULTS: Row = {
  notes: null,
  case_status: "en_evaluacion",
  professional_id: null,
  referred_by: null,
  main_diagnosis: null,
  other_conditions: [],
  cud_status: null,
  is_medicated: false,
  medication: null,
  has_health_insurance: null,
  health_insurance: null,
  school: null,
  guardian_name: null,
  guardian_phone: null,
};

const patientsByDni = new Map<string, Row>();
for (const a of MOCK_APPOINTMENTS) {
  if (patientsByDni.has(a.dni)) continue;
  patientsByDni.set(a.dni, {
    ...PATIENT_DEFAULTS,
    id: `pat-${a.dni}`,
    first_name: a.first_name,
    last_name: a.last_name,
    dni: a.dni,
    age: a.age,
    phone: a.phone,
    email: a.email,
    patient_type: a.patient_type,
    created_at: a.created_at,
    updated_at: a.created_at,
  });
}

const store: Record<string, Row[]> = {
  professionals: [...MOCK_PROFESSIONALS] as unknown as Row[],
  patients: [...patientsByDni.values()],
  appointments: MOCK_APPOINTMENTS.map((a) => ({
    id: a.id,
    patient_id: `pat-${a.dni}`,
    consultation_type: a.consultation_type,
    reason: a.reason,
    appointment_date: a.appointment_date,
    appointment_time: a.appointment_time,
    status: a.status,
    professional_id: a.professional_id,
    created_at: a.created_at,
    updated_at: a.updated_at,
  })),
  patient_referrals: [],
  patient_followups: [],
  patient_reports: [],
};

// Una ficha de ejemplo con derivación y seguimiento, para ver la pantalla completa
const demo = store.patients.find((p) => p.patient_type === "niño");
if (demo) {
  Object.assign(demo, {
    case_status: "en_tratamiento",
    referred_by: "Escuela (maestra de grado)",
    main_diagnosis: "Tartamudez evolutiva persistente",
    other_conditions: ["TDAH"],
    cud_status: "en_tramite",
    is_medicated: true,
    medication: "Metilfenidato 10 mg/día — indicado por neuropediatría",
    guardian_name: "Madre",
    has_health_insurance: true,
    health_insurance: "Subsidio de Salud",
  });
  store.patient_referrals.push({
    id: "ref-demo-1", patient_id: demo.id, kind: "interconsulta", specialty: "Neuropediatría",
    destination: "Hospital del Niño Jesús", reason: "Evaluar ajuste de medicación",
    referral_date: String(demo.created_at).slice(0, 10), status: "pendiente", outcome: null, registered: false,
    created_by: "demo@cimt.local", created_at: String(demo.created_at),
  });
  store.patient_followups.push({
    id: "fu-demo-1", patient_id: demo.id, note_date: String(demo.created_at).slice(0, 10),
    note: "Primera entrevista con la madre. Se indica evaluación fonoaudiológica.",
    author_email: "demo@cimt.local", created_at: String(demo.created_at),
  });
  store.patient_reports.push({
    id: "rep-demo-1", patient_id: demo.id, report_date: String(demo.created_at).slice(0, 10),
    professional_id: "pro-001", diagnosis: "Tartamudez evolutiva persistente. TDAH asociado.",
    progress: "Mayor fluidez en lectura en voz alta. Disminuyen los bloqueos en situaciones conocidas.",
    therapy_evolution: "Sesiones semanales. Buena adherencia. Se sugiere sostener el abordaje y reevaluar en 3 meses.",
    author_email: "demo@cimt.local", created_at: String(demo.created_at), updated_at: String(demo.created_at),
  });
}

const INSERT_DEFAULTS: Record<string, Row> = {
  appointments: { status: "pendiente" },
  patients: PATIENT_DEFAULTS,
  patient_referrals: { status: "pendiente", outcome: null, destination: null, reason: null, registered: false },
  patient_followups: {},
  patient_reports: { professional_id: null, diagnosis: null, progress: null, therapy_evolution: null },
};

function currentEmail(): string | null {
  return session?.user.email ?? null;
}

// ─── Query builder ───────────────────────────────────────────────────────────

class MockQueryBuilder {
  private _table: string;
  private _filters: Array<(row: Row) => boolean> = [];
  private _orders: Array<{ key: string; asc: boolean }> = [];
  private _selectCols: string | null = null;
  private _insertPayload: Row | null = null;
  private _updatePayload: Row | null = null;
  private _single = false;

  constructor(table: string) {
    this._table = table;
  }

  private get _store(): Row[] {
    return (store[this._table] ??= []);
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

  single() {
    this._single = true;
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
    resolve: (result: { data: Row[] | Row | null; error: { message: string; code?: string } | null }) => void,
    _reject?: never
  ) {
    resolve(this._execute());
  }

  // Supabase returns a promise-like — we implement the await interface
  private _execute(): { data: Row[] | Row | null; error: { message: string; code?: string } | null } {
    const now = new Date().toISOString();

    // INSERT
    if (this._insertPayload !== null) {
      if (this._table === "patients" && this._store.some((p) => p.dni === this._insertPayload!.dni)) {
        return { data: null, error: { message: "duplicate key", code: "23505" } };
      }
      const newRow: Row = {
        id: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        created_at: now,
        updated_at: now,
        ...INSERT_DEFAULTS[this._table],
        ...(this._table === "patient_referrals" ? { created_by: currentEmail() } : {}),
        ...(["patient_followups", "patient_reports"].includes(this._table) ? { author_email: currentEmail() } : {}),
        ...this._insertPayload,
      };
      this._store.push(newRow);
      return { data: { ...newRow }, error: null };
    }

    // UPDATE
    if (this._updatePayload !== null) {
      for (const row of this._store) {
        if (this._filters.every((f) => f(row))) Object.assign(row, this._updatePayload, { updated_at: now });
      }
      return { data: null, error: null };
    }

    // SELECT
    let rows = this._store.filter((r) => this._filters.every((f) => f(r))).map((r) => ({ ...r }));

    // Ordering: el primer order() es la clave principal
    rows.sort((a, b) => {
      for (const { key, asc } of this._orders) {
        const cmp = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
        if (cmp !== 0) return asc ? cmp : -cmp;
      }
      return 0;
    });

    // Join appointments → patients
    if (this._table === "appointments" && this._selectCols?.includes("patients(")) {
      rows = rows.map((r) => ({ ...r, patients: store.patients.find((p) => p.id === r.patient_id) ?? null }));
    }

    // Column projection (simple: if not "*", pick named columns)
    if (this._selectCols && !this._selectCols.includes("*")) {
      const cols = this._selectCols.split(",").map((c) => c.trim());
      rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    }

    if (this._single) {
      return rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { message: "No rows", code: "PGRST116" } };
    }
    return { data: rows, error: null };
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

type MockSession = { user: { id: string; email: string } } | null;
let session: MockSession = null;
const authListeners = new Set<(event: string, session: MockSession) => void>();

function setSession(next: MockSession, event: string) {
  session = next;
  authListeners.forEach((cb) => cb(event, session));
}

// ─── RPCs ────────────────────────────────────────────────────────────────────

function rpc(fn: string, args: Row = {}) {
  if (fn === "is_admin") {
    return Promise.resolve({ data: session !== null, error: null });
  }

  if (fn === "get_booked_slots") {
    const data = store.appointments
      .filter((a) =>
        String(a.appointment_date) >= String(args.p_start) &&
        String(a.appointment_date) <= String(args.p_end) &&
        a.status !== "cancelado")
      .map(({ appointment_date, appointment_time, status }) => ({ appointment_date, appointment_time, status }));
    return Promise.resolve({ data, error: null });
  }

  if (fn === "request_appointment") {
    const time = `${String(args.p_time).slice(0, 5)}:00`;
    const taken = store.appointments.some((a) =>
      a.appointment_date === args.p_date && a.appointment_time === time && a.status !== "cancelado");
    if (taken) {
      return Promise.resolve({ data: null, error: { message: "SLOT_TAKEN: Ese horario ya fue reservado" } });
    }
    const now = new Date().toISOString();

    // Upsert paciente por DNI (no toca los datos de la ficha)
    const contact = {
      first_name: args.p_first_name, last_name: args.p_last_name, age: args.p_age,
      phone: args.p_phone, email: args.p_email ?? null, patient_type: args.p_patient_type,
    };
    let patient = store.patients.find((p) => p.dni === args.p_dni);
    if (patient) {
      Object.assign(patient, contact, { updated_at: now });
    } else {
      patient = { ...PATIENT_DEFAULTS, ...contact, id: `pat-${args.p_dni}`, dni: args.p_dni, created_at: now, updated_at: now };
      store.patients.push(patient);
    }

    const id = `mock-${Date.now()}`;
    store.appointments.push({
      id,
      patient_id: patient.id,
      consultation_type: args.p_consultation_type,
      reason: args.p_reason,
      appointment_date: args.p_date,
      appointment_time: time,
      status: "pendiente",
      professional_id: null,
      created_at: now,
      updated_at: now,
    });
    return Promise.resolve({ data: id, error: null });
  }

  return Promise.resolve({ data: null, error: { message: `Mock: función ${fn} no implementada` } });
}

// ─── Mock Client ─────────────────────────────────────────────────────────────

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
