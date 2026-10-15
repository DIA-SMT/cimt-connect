// Pruebas de los hitos de la landing (src/lib/milestones.ts) y de las
// estadísticas de solicitudes de turno que los alimentan (src/lib/stats.ts).
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  hasMilestones, milestonesError, monthYear, previousMonth,
  type MilestonesDraft, type PublicMilestones,
} from "../src/lib/milestones";
import { computeStats, milestonesDraftFrom, type StatIntake, type StatsData } from "../src/lib/stats";

const draft: MilestonesDraft = {
  patients_total: 432, patients_since: "2025-05-01", response_hours: 48, wait_days: 12, waiting_list: 3,
  month: "2026-09-01", month_value: 118, month_label: "consultas atendidas",
};

describe("fechas de los hitos", () => {
  test("mes y año en castellano", () => {
    expect(monthYear("2025-05-01")).toBe("mayo de 2025");
  });
  test("el análisis mensual es del mes cerrado anterior (cruza el año)", () => {
    expect(previousMonth("2026-10-15")).toBe("2026-09-01");
    expect(previousMonth("2027-01-03")).toBe("2026-12-01");
  });
});

describe("validación antes de publicar", () => {
  test("una propuesta completa pasa", () => {
    expect(milestonesError(draft)).toBeNull();
  });
  test("números negativos o con coma no", () => {
    expect(milestonesError({ ...draft, patients_total: -1 })).toContain("pacientes");
    expect(milestonesError({ ...draft, wait_days: 2.5 })).toContain("días de espera");
  });
  test("el dato del mes necesita mes y texto", () => {
    expect(milestonesError({ ...draft, month_label: " " })).toContain("dato del mes");
    expect(milestonesError({ ...draft, month: null })).toContain("dato del mes");
  });
  test("sin ningún número no se publica", () => {
    expect(milestonesError({
      ...draft, patients_total: null, response_hours: null, wait_days: null, waiting_list: null, month_value: null,
    })).toBe("Completá al menos un número");
  });
  test("cero horas de respuesta no tiene sentido", () => {
    expect(milestonesError({ ...draft, response_hours: 0 })).toContain("al menos 1");
  });
});

describe("qué muestra la landing", () => {
  const row = (extra: Partial<PublicMilestones>): PublicMilestones => ({
    ...draft, id: "x", hidden: false, published_at: "2026-10-15T12:00:00Z", published_by: null, ...extra,
  });
  test("nada publicado o publicación oculta: no muestra hitos", () => {
    expect(hasMilestones(null)).toBe(false);
    expect(hasMilestones(row({ hidden: true }))).toBe(false);
  });
  test("con al menos un número, sí", () => {
    expect(hasMilestones(row({}))).toBe(true);
    expect(hasMilestones(row({
      patients_total: null, response_hours: null, wait_days: null, waiting_list: null, month_value: null,
    }))).toBe(false);
  });
});

// ── Estadísticas de solicitudes ──
const iso = (date: string, hour = 12) => `${date}T${String(hour).padStart(2, "0")}:00:00-03:00`;
const req = (date: string, extra: Partial<StatIntake> = {}): StatIntake => ({
  created_at: iso(date), status: "contactada", workshop_id: null, workshop_attended: null, patient_id: null,
  age: 6, province: "Tucumán", locality: "Yerba Buena", preferred_modality: "presencial", referred_by: null,
  first_contact_at: null, ...extra,
});
const base: StatsData = { patients: [], referrals: [], appts: [], intake: [], workshops: [], surveys: [], professionals: [] };

describe("solicitudes de turno en Estadísticas", () => {
  const intake = [
    req("2026-09-02", { first_contact_at: iso("2026-09-03", 12) }), // 24 hs
    req("2026-09-05", { first_contact_at: iso("2026-09-08", 12), province: "Salta", locality: "Salta", preferred_modality: "telemedicina" }), // 72 hs
    req("2026-09-10", { status: "nueva", age: 30, locality: "yerba buena " }), // vencida, sin contacto
    req("2026-09-20", { status: "admitida" }),
  ];
  const s = computeStats({ ...base, intake }, { start: "2026-09-01", end: "2026-09-30" });

  test("cuenta por provincia, localidad (agrupando cómo se escribió), edad y modalidad", () => {
    expect(s.intake.received).toBe(4);
    expect(s.intake.byProvince).toEqual([{ name: "Tucumán", value: 3 }, { name: "Salta", value: 1 }]);
    expect(s.intake.byLocality[0]).toEqual({ name: "Yerba Buena", value: 3 });
    expect(s.intake.byAge.find((a) => a.name === "18 a 39 años")?.value).toBe(1);
    expect(s.intake.byModality).toEqual([{ name: "Presencial", value: 3 }, { name: "Telemedicina", value: 1 }]);
  });
  test("tiempo de respuesta y cumplimiento de las 48 hs (las vencidas sin contacto cuentan)", () => {
    expect(s.intake.responseCount).toBe(2);
    expect(s.intake.responseMedianHours).toBe(48);
    expect(s.intake.responseOverdue).toBe(1);
    expect(s.intake.responseOnTimePct).toBe(33); // 1 a tiempo de 3
  });
  test("la lista de espera son las solicitudes en curso (no depende del período)", () => {
    expect(s.current.waitingList).toBe(3);
  });
});

describe("propuesta de hitos con los números del panel", () => {
  const data: StatsData = {
    ...base,
    patients: [{ id: "p1", created_at: iso("2026-09-04"), locality: null, patient_type: "niño", case_status: "en_tratamiento",
      has_health_insurance: null, therapy_modes: [], other_conditions: [], age: 6 }],
    appts: [
      { patient_id: "p1", professional_id: null, appointment_date: "2026-09-15", status: "confirmado", modality: "presencial", attendance: "presente" },
      { patient_id: "p1", professional_id: null, appointment_date: "2026-10-02", status: "confirmado", modality: "presencial", attendance: "presente" },
    ],
    intake: [req("2026-09-01", { patient_id: "p1", status: "admitida" }), req("2026-10-01", { status: "nueva" })],
  };
  test("toma el mes cerrado anterior y el dato elegido", () => {
    const d = milestonesDraftFrom(data, "2026-10-15", "consultas");
    expect(d).toMatchObject({
      patients_total: 1, patients_since: "2025-05-01", response_hours: 48, waiting_list: 1,
      month: "2026-09-01", month_value: 1, month_label: "consultas atendidas",
      wait_days: 14, // del 1/9 a la primera sesión el 15/9
    });
    expect(milestonesDraftFrom(data, "2026-10-15", "solicitudes").month_value).toBe(1);
    expect(milestonesDraftFrom(data, "2026-10-15", "ingresos").month_value).toBe(1);
  });
});
