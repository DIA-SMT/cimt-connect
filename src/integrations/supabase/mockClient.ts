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
 * Tablas: professionals, appointments, patients, patient_referrals, patient_followups, patient_reports,
 *         admins, audit_log, intake_requests, workshops, schedule_blocks, satisfaction_surveys
 *
 * Roles en demo: el rol sale del email con el que se ingresa
 *   admin...@  → Administración · pro...@ → Profesional · cualquier otro → Dirección
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
  locality: null,
  therapy_modes: [],
};

// Localidades de ejemplo para que la pestaña Estadísticas muestre algo en demo
const DEMO_LOCALITIES = ["San Miguel de Tucumán", "Yerba Buena", "San Miguel de Tucumán", "Tafí Viejo", "Banda del Río Salí", null];

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
    locality: DEMO_LOCALITIES[patientsByDni.size % DEMO_LOCALITIES.length],
    created_at: a.created_at,
    updated_at: a.created_at,
  });
}

const store: Record<string, Row[]> = {
  professionals: MOCK_PROFESSIONALS.map((p, i) => ({
    ...p, license: String(1000 + i * 137), active: true, show_on_site: false, user_id: null,
    session_minutes: p.specialty.toLowerCase().startsWith("psicolog") ? 40 : 30,
  })) as unknown as Row[],
  patients: [...patientsByDni.values()],
  appointments: MOCK_APPOINTMENTS.map((a) => ({
    id: a.id,
    patient_id: `pat-${a.dni}`,
    consultation_type: a.consultation_type,
    reason: a.reason,
    appointment_date: a.appointment_date,
    appointment_time: a.appointment_time,
    status: a.status,
    modality: "presencial",
    duration_minutes: 60,
    attendance: null,
    practice_number: null,
    practice_registered_at: null,
    professional_id: a.professional_id,
    created_at: a.created_at,
    updated_at: a.updated_at,
  })),
  patient_referrals: [],
  patient_followups: [],
  patient_reports: [],
  admins: [],
  audit_log: [],
  intake_requests: [],
  workshops: [],
  schedule_blocks: [],
  satisfaction_surveys: [],
  social_corner_items: [],
};

// ── Datos de ejemplo de la fase 2: taller, solicitudes y agenda del día ──
function demoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
{
  const nowIso = new Date().toISOString();
  store.workshops.push({
    id: "ws-demo-1", workshop_date: demoDay(9), start_time: "09:00:00", place: "Catamarca 411",
    capacity: 20, notes: null, canceled: false, created_at: nowIso,
  });
  const reqBase = { email: null, preferred_modality: "presencial", workshop_id: null, workshop_attended: null,
    patient_id: null, notes: null, created_at: nowIso, updated_at: nowIso };
  store.intake_requests.push(
    { ...reqBase, id: "req-demo-1", first_name: "Tomás", last_name: "Acosta", dni: "50222333", age: 5,
      patient_type: "niño", phone: "381-4001122", guardian_name: "Laura Acosta (madre)", locality: "Yerba Buena",
      referred_by: "Jardín de infantes", reason: "Repite sílabas al empezar las frases desde hace 4 meses.", status: "nueva" },
    { ...reqBase, id: "req-demo-2", first_name: "Camila", last_name: "Ruiz", dni: "45111999", age: 14,
      patient_type: "adolescente", phone: "381-4556677", guardian_name: "Jorge Ruiz (padre)", locality: "Tafí Viejo",
      referred_by: null, reason: "Bloqueos al leer en voz alta en el colegio, le genera mucha ansiedad.", status: "contactada" },
    { ...reqBase, id: "req-demo-3", first_name: "Martín", last_name: "Sosa", dni: "33444555", age: 38,
      patient_type: "adulto", phone: "381-5998877", guardian_name: null, locality: "San Miguel de Tucumán",
      referred_by: null, reason: "Tartamudeo desde chico, quiero empezar un tratamiento.", status: "taller",
      workshop_id: "ws-demo-1", preferred_modality: "telemedicina" },
  );
  // Agenda de hoy: turnos asignados a profesionales
  const today = demoDay(0);
  const pros = store.professionals;
  const pats = store.patients;
  const demo = [
    { pro: 0, pat: 0, time: "08:00:00" }, { pro: 0, pat: 1, time: "08:40:00" },
    { pro: 1, pat: 2, time: "09:00:00" }, { pro: 1, pat: 3, time: "09:30:00" },
    { pro: 3, pat: 4, time: "10:00:00" },
  ];
  demo.forEach((d, i) => {
    const pro = pros[d.pro % pros.length];
    const pat = pats[d.pat % pats.length];
    if (!pro || !pat) return;
    store.appointments.push({
      id: `appt-agenda-${i}`, patient_id: pat.id, professional_id: pro.id, appointment_date: today,
      appointment_time: d.time, duration_minutes: pro.session_minutes, status: "confirmado",
      consultation_type: "seguimiento", modality: i === 2 ? "telemedicina" : "presencial", reason: "Sesión",
      attendance: i === 0 ? "presente" : null, practice_number: i === 0 ? 1 : null,
      practice_registered_at: i === 0 ? nowIso : null, created_at: nowIso, updated_at: nowIso,
    });
  });
}
let practiceSeq = 2;

// Rincón social de ejemplo (el contenido real lo carga 14_rincon_social.sql)
store.social_corner_items.push(
  { id: "sc-1", slug: "yo-y-la-tartamudez", category: "libros", title: "Yo y la tartamudez",
    subtitle: "Libro de la Municipalidad de San Miguel de Tucumán",
    description: "Relatos de familias y de personas con tartamudez que se atienden en el CIMT.",
    link_url: "https://smt.gob.ar/nota/yo-y-la-tartamudez/101", link_label: "Leer en la Biblioteca Digital",
    image_url: null, featured: true, published: true, sort_order: 1 },
  { id: "sc-2", slug: "el-discurso-del-rey", category: "peliculas", title: "El discurso del rey", subtitle: "Película, 2010",
    description: "El rey Jorge VI trabajó su tartamudez junto a su terapeuta para poder hablarle a su país.",
    link_url: "https://es.wikipedia.org/wiki/El_discurso_del_rey", link_label: "Más información",
    image_url: null, featured: false, published: true, sort_order: 10 },
  { id: "sc-3", slug: "emily-blunt", category: "artistas", title: "Emily Blunt", subtitle: "Actriz",
    description: "Tartamudeaba de chica; la actuación la ayudó a ganar confianza para hablar.",
    link_url: "https://es.wikipedia.org/wiki/Emily_Blunt", link_label: "Más información",
    image_url: null, featured: false, published: true, sort_order: 30 },
  { id: "sc-4", slug: "tiger-woods", category: "deportistas", title: "Tiger Woods", subtitle: "Golfista",
    description: "Tartamudeaba de niño y practicaba hablando en voz alta hasta sentirse más seguro.",
    link_url: "https://es.wikipedia.org/wiki/Tiger_Woods", link_label: "Más información",
    image_url: null, featured: false, published: false, sort_order: 40 },
);

// Encuestas de satisfacción de ejemplo (fase 5)
{
  const ago = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  store.satisfaction_surveys.push(
    { id: "sv-1", respondent: "familiar", rating_attention: 5, rating_communication: 4, rating_treatment: 5, rating_overall: 5,
      would_recommend: true, comment: "Muy buena atención, mi hijo va contento a las sesiones.", created_at: ago(1) },
    { id: "sv-2", respondent: "paciente", rating_attention: 4, rating_communication: 4, rating_treatment: 5, rating_overall: 4,
      would_recommend: true, comment: null, created_at: ago(3) },
    { id: "sv-3", respondent: "familiar", rating_attention: 3, rating_communication: 2, rating_treatment: 4, rating_overall: 3,
      would_recommend: true, comment: "Costó conseguir el primer turno, pero el equipo es muy amable.", created_at: ago(9) },
  );
}

// Reglas de agenda (como el trigger appointments_agenda_rules del script 12)
function agendaRuleError(row: Row): string | null {
  if (row.status === "cancelado" || !row.professional_id) return null;
  const toMin = (t: unknown) => { const [h, m] = String(t).slice(0, 5).split(":").map(Number); return h * 60 + m; };
  const start = toMin(row.appointment_time);
  const end = start + Number(row.duration_minutes ?? 60);
  const overlap = store.appointments.some((a) => a.id !== row.id && a.professional_id === row.professional_id
    && a.appointment_date === row.appointment_date && a.status !== "cancelado"
    && toMin(a.appointment_time) < end && toMin(a.appointment_time) + Number(a.duration_minutes ?? 60) > start);
  if (overlap) return "OVERLAP: El profesional ya tiene un turno en ese horario";
  const block = store.schedule_blocks.find((b) => b.active && b.block_date === row.appointment_date
    && (!b.professional_id || b.professional_id === row.professional_id)
    && (!b.start_time || (toMin(b.start_time) < end && toMin(b.end_time) > start)));
  if (block) return `BLOCKED: Ese horario está bloqueado (${block.reason})`;
  return null;
}

// Tablas con historial de cambios (como los triggers de 11_roles_equipo_historial.sql)
const AUDITED = new Set(["patients", "appointments", "patient_referrals", "patient_followups", "patient_reports", "intake_requests"]);
let auditSeq = 1;

function audit(table: string, action: "insert" | "update", row: Row, changes: Row) {
  if (!AUDITED.has(table)) return;
  store.audit_log.push({
    id: auditSeq++,
    table_name: table,
    record_id: row.id,
    patient_id: table === "patients" ? row.id : row.patient_id,
    action,
    changes,
    changed_by_email: currentEmail(),
    changed_at: new Date().toISOString(),
  });
}

function staffRole(): string | null {
  const row = store.admins.find((a) => a.user_id === session?.user.id && a.active);
  return (row?.role as string) ?? null;
}

const CLINICAL_PATIENT_FIELDS = [
  "case_status", "professional_id", "main_diagnosis", "other_conditions", "therapy_modes",
  "cud_status", "is_medicated", "medication", "notes",
];
const CLINICAL_TABLES = new Set(["patient_referrals", "patient_followups", "patient_reports"]);

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
    therapy_modes: ["individual", "familia"],
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
  appointments: { status: "pendiente", modality: "presencial", duration_minutes: 60, attendance: null, practice_number: null, practice_registered_at: null },
  intake_requests: { status: "nueva", workshop_id: null, workshop_attended: null, patient_id: null, notes: null },
  workshops: { canceled: false, place: "Catamarca 411", capacity: null, notes: null },
  schedule_blocks: { active: true, start_time: null, end_time: null, professional_id: null },
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

  limit(_n: number) {
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

    // Permisos por rol (mismas reglas que las policies de la base)
    if ((this._insertPayload || this._updatePayload) && CLINICAL_TABLES.has(this._table)
        && !["direccion", "profesional"].includes(staffRole() ?? "")) {
      return { data: null, error: { message: "new row violates row-level security policy", code: "42501" } };
    }

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
      if (this._table === "appointments") {
        const ruleError = agendaRuleError(newRow);
        if (ruleError) return { data: null, error: { message: ruleError } };
      }
      this._store.push(newRow);
      const { id: _id, created_at: _c, updated_at: _u, ...inserted } = newRow;
      audit(this._table, "insert", newRow, inserted);
      return { data: { ...newRow }, error: null };
    }

    // UPDATE
    if (this._updatePayload !== null) {
      const targets = this._store.filter((row) => this._filters.every((f) => f(row)));
      const payload = this._updatePayload;

      if (this._table === "patients" && staffRole() === "administracion") {
        const touchesClinical = targets.some((row) => CLINICAL_PATIENT_FIELDS.some(
          (k) => k in payload && JSON.stringify(payload[k]) !== JSON.stringify(row[k])));
        if (touchesClinical) {
          return { data: null, error: { message: "CLINICAL_ONLY: Solo los profesionales pueden modificar los datos clínicos" } };
        }
      }
      if (this._table === "admins") {
        // Cuántas Direcciones activas quedarían después del cambio
        const remaining = store.admins.filter((a) => {
          const changed = targets.includes(a);
          const role = changed ? (payload.role ?? a.role) : a.role;
          const active = changed ? (payload.active ?? a.active) : a.active;
          return role === "direccion" && active;
        }).length;
        if (remaining === 0) {
          return { data: null, error: { message: "LAST_DIRECTOR: Tiene que quedar al menos un usuario de Dirección activo" } };
        }
      }

      if (this._table === "appointments") {
        for (const row of targets) {
          const ruleError = agendaRuleError({ ...row, ...payload });
          const agendaChanged = ["appointment_date", "appointment_time", "duration_minutes", "professional_id", "status"]
            .some((k) => k in payload && payload[k] !== row[k]);
          if (ruleError && agendaChanged) return { data: null, error: { message: ruleError } };
        }
      }

      for (const row of targets) {
        // Práctica numerada al marcar presente (una sola vez por turno)
        if (this._table === "appointments" && payload.attendance === "presente" && !row.practice_number) {
          Object.assign(payload, { practice_number: practiceSeq++, practice_registered_at: now });
        }
        const changes: Row = {};
        for (const [k, v] of Object.entries(payload)) {
          if (JSON.stringify(row[k]) !== JSON.stringify(v)) changes[k] = [row[k] ?? null, v];
        }
        Object.assign(row, payload, { updated_at: now });
        if (Object.keys(changes).length) audit(this._table, "update", row, changes);
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
  if (fn === "current_staff") {
    const row = store.admins.find((a) => a.user_id === session?.user.id && a.active);
    if (!row) return Promise.resolve({ data: null, error: null });
    const pro = store.professionals.find((p) => p.user_id === row.user_id);
    return Promise.resolve({
      data: { role: row.role, full_name: row.full_name, email: row.email, professional_id: pro?.id ?? null },
      error: null,
    });
  }

  if (fn === "submit_satisfaction_survey") {
    const ratings = [args.p_rating_attention, args.p_rating_communication, args.p_rating_treatment, args.p_rating_overall].map(Number);
    if (!["paciente", "familiar"].includes(String(args.p_respondent)) || ratings.some((r) => !(r >= 1 && r <= 5))
        || typeof args.p_would_recommend !== "boolean") {
      return Promise.resolve({ data: null, error: { message: "INVALID_DATA: Respondé todas las preguntas" } });
    }
    const row: Row = {
      id: `sv-${Date.now()}`, respondent: args.p_respondent, rating_attention: ratings[0], rating_communication: ratings[1],
      rating_treatment: ratings[2], rating_overall: ratings[3], would_recommend: args.p_would_recommend,
      comment: String(args.p_comment ?? "").trim().slice(0, 600) || null, created_at: new Date().toISOString(),
    };
    store.satisfaction_surveys.push(row);
    return Promise.resolve({ data: row.id, error: null });
  }

  if (fn === "get_upcoming_workshops") {
    const today = new Date().toISOString().slice(0, 10);
    const data = store.workshops
      .filter((w) => !w.canceled && String(w.workshop_date) >= today)
      .sort((a, b) => String(a.workshop_date).localeCompare(String(b.workshop_date)))
      .slice(0, 3)
      .map(({ workshop_date, start_time, place }) => ({ workshop_date, start_time, place }));
    return Promise.resolve({ data, error: null });
  }

  if (fn === "submit_intake_request") {
    if (Number(args.p_age) < 2) {
      return Promise.resolve({ data: null, error: { message: "INVALID_AGE: El centro atiende a partir de los 2 años" } });
    }
    if (args.p_patient_type !== "adulto" && !String(args.p_guardian_name ?? "").trim()) {
      return Promise.resolve({ data: null, error: { message: "INVALID_GUARDIAN: Indicá el nombre del adulto responsable" } });
    }
    const open = store.intake_requests.some((r) => r.dni === args.p_dni && ["nueva", "contactada", "taller"].includes(String(r.status)));
    if (open) {
      return Promise.resolve({ data: null, error: { message: "ALREADY_REQUESTED: Ya tenemos una solicitud en curso con ese DNI. El equipo se va a comunicar al teléfono que dejaste." } });
    }
    const nowIso = new Date().toISOString();
    const row: Row = {
      id: `req-${Date.now()}`, first_name: args.p_first_name, last_name: args.p_last_name, dni: args.p_dni,
      age: Number(args.p_age), patient_type: args.p_patient_type, phone: args.p_phone, email: args.p_email ?? null,
      guardian_name: args.p_guardian_name ?? null, locality: args.p_locality ?? null,
      preferred_modality: args.p_preferred_modality ?? "presencial", referred_by: args.p_referred_by ?? null,
      reason: args.p_reason, status: "nueva", workshop_id: null, workshop_attended: null, patient_id: null,
      notes: null, created_at: nowIso, updated_at: nowIso,
    };
    store.intake_requests.push(row);
    return Promise.resolve({ data: row.id, error: null });
  }

  if (fn === "get_public_team") {
    const data = store.professionals
      .filter((p) => p.active && p.show_on_site)
      .map(({ name, specialty, description, photo_url }) => ({ name, specialty, description, photo_url }));
    return Promise.resolve({ data, error: null });
  }

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
    // Mismas validaciones nuevas que 9_modalidad_localidad.sql
    if (Number(args.p_age) < 2) {
      return Promise.resolve({ data: null, error: { message: "INVALID_AGE: El centro atiende a partir de los 2 años" } });
    }
    const time = `${String(args.p_time).slice(0, 5)}:00`;
    const taken = store.appointments.some((a) =>
      a.appointment_date === args.p_date && a.appointment_time === time && a.status !== "cancelado");
    if (taken) {
      return Promise.resolve({ data: null, error: { message: "SLOT_TAKEN: Ese horario ya fue reservado" } });
    }
    const now = new Date().toISOString();

    // Un turno a futuro por DNI (misma regla que 8_limites_abuso.sql)
    const today = now.slice(0, 10);
    const existingPatient = store.patients.find((p) => p.dni === args.p_dni);
    const existing = existingPatient && store.appointments.find((a) =>
      a.patient_id === existingPatient.id && a.status !== "cancelado" && String(a.appointment_date) >= today);
    if (existing) {
      const [y, m, d] = String(existing.appointment_date).split("-");
      return Promise.resolve({ data: null, error: {
        message: `ALREADY_BOOKED: Ya hay un turno a nombre de este DNI para el ${d}/${m}/${y}. Si necesitás cambiarlo, comunicate con el centro.`,
      } });
    }

    // Upsert paciente por DNI (no toca los datos de la ficha)
    const contact = {
      first_name: args.p_first_name, last_name: args.p_last_name, age: args.p_age,
      phone: args.p_phone, email: args.p_email ?? null, patient_type: args.p_patient_type,
      ...(args.p_locality ? { locality: args.p_locality } : {}),
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
      modality: args.p_modality ?? "presencial",
      professional_id: null,
      created_at: now,
      updated_at: now,
    });
    return Promise.resolve({ data: id, error: null });
  }

  return Promise.resolve({ data: null, error: { message: `Mock: función ${fn} no implementada` } });
}

// ─── Mock Client ─────────────────────────────────────────────────────────────

// Gestión de usuarios en demo (en producción lo hace server/api/admin/users.ts)
function mockUsersApi(body: Row): Promise<{ ok: true; user_id?: string } | { error: string }> {
  if (staffRole() !== "direccion") return Promise.resolve({ error: "Solo la Dirección puede gestionar usuarios" });
  if (body.action === "create") {
    const email = String(body.email).trim().toLowerCase();
    if (store.admins.some((a) => a.email === email)) return Promise.resolve({ error: "Ya existe un usuario con ese email" });
    if (String(body.password ?? "").length < 8) return Promise.resolve({ error: "La contraseña tiene que tener al menos 8 caracteres" });
    const user_id = `mock-user-${Date.now()}`;
    store.admins.push({ user_id, email, full_name: body.full_name ?? null, role: body.role, active: true, created_at: new Date().toISOString() });
    if (body.professional_id) {
      const pro = store.professionals.find((p) => p.id === body.professional_id);
      if (pro) pro.user_id = user_id;
    }
    return Promise.resolve({ ok: true, user_id });
  }
  if (body.action === "set_active") {
    const row = store.admins.find((a) => a.user_id === body.user_id);
    if (row) row.active = body.active;
    return Promise.resolve({ ok: true });
  }
  if (body.action === "set_password") return Promise.resolve({ ok: true });
  return Promise.resolve({ error: "Acción inválida" });
}

// Storage en demo: las fotos quedan en memoria como object URLs
const mockFiles = new Map<string, string>();
const mockStorage = {
  from(bucket: string) {
    return {
      upload: async (path: string, file: Blob) => {
        mockFiles.set(`${bucket}/${path}`, URL.createObjectURL(file));
        return { data: { path }, error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: mockFiles.get(`${bucket}/${path}`) ?? "" } }),
    };
  },
};

export const mockSupabase = {
  from(table: string) {
    return new MockQueryBuilder(table);
  },
  rpc,
  storage: mockStorage,
  __mockUsersApi: mockUsersApi,
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    signInWithPassword: async ({ email }: { email: string; password: string }) => {
      // El rol de demo sale del email: admin... → Administración, pro... → Profesional
      const lower = email.trim().toLowerCase();
      let row = store.admins.find((a) => a.email === lower);
      if (!row) {
        const role = lower.startsWith("admin") ? "administracion" : lower.startsWith("pro") ? "profesional" : "direccion";
        row = { user_id: `mock-${role}-${store.admins.length}`, email: lower, full_name: null, role, active: true, created_at: new Date().toISOString() };
        store.admins.push(row);
      }
      if (!row.active) return { data: { session: null }, error: { message: "User is banned" } };
      setSession({ user: { id: String(row.user_id), email: lower } }, "SIGNED_IN");
      return { data: { session }, error: null };
    },
    // Recuperación de contraseña: en mock no se manda ningún email
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => ({ data: { user: session?.user ?? null }, error: null }),
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
