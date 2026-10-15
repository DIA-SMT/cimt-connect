// Pruebas de «Dar turno» desde un pedido de turno (src/lib/apptSchedule.ts):
// lo que se propone al abrir el formulario, los avisos de día y horario, la
// revisión antes de guardar y los horarios libres que se sugieren.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import type { ScheduleBlock } from "../src/lib/agenda";
import {
  BAND_RANGE, SCHEDULE_DEFAULT_MINUTES, type ScheduleAppt,
  bandMatches, dayMatches, isWeekendDate, patientClash, scheduleDefaults, scheduleFormError, sessionDuration,
  suggestFreeSlots, weekdayOfKey, workWindows,
} from "../src/lib/apptSchedule";

const PRO = "pro-1";
const OTHER = "pro-2";
const TODAY = "2026-10-14"; // miércoles
const MIN = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const appt = (date: string, time: string, extra: Partial<ScheduleAppt> = {}): ScheduleAppt => ({
  professional_id: PRO, appointment_date: date, appointment_time: `${time}:00`, duration_minutes: 30, status: "confirmado", ...extra,
});
const block = (date: string, extra: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
  id: `b-${date}`, block_date: date, start_time: null, end_time: null, professional_id: PRO, reason: "Congreso", active: true, ...extra,
});

// Atiende los lunes de 8 a 12 y los jueves de 14 a 18 (según sus turnos de la semana pasada)
const HISTORY: ScheduleAppt[] = [
  appt("2026-10-05", "08:00"), appt("2026-10-05", "11:30"),
  appt("2026-10-08", "14:00"), appt("2026-10-08", "17:30"),
];

const base = {
  days: ["lun", "jue"] as const, band: "indistinto" as const, professionalId: PRO, duration: 30,
  appointments: HISTORY, blocks: [] as ScheduleBlock[], today: TODAY, nowMinutes: MIN("10:00"),
};

describe("días y horarios", () => {
  test("weekdayOfKey: lunes a viernes; fin de semana y fechas inválidas, null", () => {
    expect(weekdayOfKey(TODAY)).toBe("mie");
    expect(weekdayOfKey("2026-10-12")).toBe("lun");
    expect(weekdayOfKey("2026-10-16")).toBe("vie");
    expect(weekdayOfKey("2026-10-17")).toBeNull(); // sábado
    expect(weekdayOfKey("2026-10-18")).toBeNull(); // domingo
    expect(weekdayOfKey("2026-02-30")).toBeNull();
    expect(weekdayOfKey("")).toBeNull();
    expect(isWeekendDate("2026-10-17")).toBe(true);
    expect(isWeekendDate("2026-10-16")).toBe(false);
    expect(isWeekendDate("2026-02-30")).toBe(false);
  });

  test("dayMatches: solo los días que pidió la familia", () => {
    expect(dayMatches("2026-10-12", ["lun", "jue"])).toBe(true);
    expect(dayMatches("2026-10-13", ["lun", "jue"])).toBe(false);
    expect(dayMatches("2026-10-17", ["lun", "jue"])).toBe(false);
    expect(dayMatches("", ["lun"])).toBe(false);
  });

  test("bandMatches: el turno entero tiene que caer en el horario pedido", () => {
    expect(bandMatches("07:00", 30, "manana")).toBe(true);
    expect(bandMatches("11:30", 30, "manana")).toBe(true);
    expect(bandMatches("11:45", 30, "manana")).toBe(false); // termina 12:15
    expect(bandMatches("12:00", 40, "tarde")).toBe(true);
    expect(bandMatches("17:30", 40, "tarde")).toBe(false); // termina 18:10
    expect(bandMatches("11:30", 30, "tarde")).toBe(false);
    expect(bandMatches("07:00", 30, "indistinto")).toBe(true);
    expect(bandMatches("17:30", 30, "indistinto")).toBe(true);
    expect(bandMatches("06:30", 30, "indistinto")).toBe(false);
    expect(bandMatches("", 30, "indistinto")).toBe(false);
  });

  test("las franjas son las del pedido, dentro de la franja del centro", () => {
    expect(BAND_RANGE.manana).toEqual({ start: 420, end: 720 });
    expect(BAND_RANGE.tarde).toEqual({ start: 720, end: 1080 });
    expect(BAND_RANGE.indistinto).toEqual({ start: 420, end: 1080 });
  });
});

describe("scheduleDefaults", () => {
  test("modalidad del pedido; si le da lo mismo, presencial", () => {
    expect(scheduleDefaults({ reason: "continuar", modality: "presencial" }).modality).toBe("presencial");
    expect(scheduleDefaults({ reason: "continuar", modality: "telemedicina" }).modality).toBe("telemedicina");
    expect(scheduleDefaults({ reason: "continuar", modality: "indistinto" }).modality).toBe("presencial");
  });
  test("siempre seguimiento (ningún motivo del pedido es «primera vez») y el motivo dice de dónde vino", () => {
    for (const reason of ["continuar", "consulta", "otro"] as const) {
      const d = scheduleDefaults({ reason, modality: "presencial" });
      expect(d.consultation_type).toBe("seguimiento");
      expect(d.reason).toContain("(pedido por el portal)");
    }
    expect(scheduleDefaults({ reason: "continuar", modality: "presencial" }).reason).toBe("Seguir con el tratamiento (pedido por el portal)");
  });
  test("duración: la de la sesión del profesional, o 30", () => {
    expect(scheduleDefaults({ reason: "consulta", modality: "presencial" }, 40).duration).toBe(40);
    expect(scheduleDefaults({ reason: "consulta", modality: "presencial" }, null).duration).toBe(SCHEDULE_DEFAULT_MINUTES);
    expect(scheduleDefaults({ reason: "consulta", modality: "presencial" }).duration).toBe(30);
    expect(sessionDuration(0)).toBe(30);
    expect(sessionDuration(500)).toBe(30);
    expect(sessionDuration(45)).toBe(45);
  });
});

describe("scheduleFormError", () => {
  const ok = { professionalId: PRO, date: "2026-10-15", time: "14:00", duration: 30 };
  const now = MIN("10:00");
  test("un turno completo, en horario y a futuro pasa", () => {
    expect(scheduleFormError(ok, TODAY, now)).toBeNull();
    expect(scheduleFormError({ ...ok, date: TODAY, time: "10:05" }, TODAY, now)).toBeNull();
    expect(scheduleFormError({ ...ok, time: "17:30", duration: 30 }, TODAY, now)).toBeNull();
  });
  test("pide profesional, fecha, hora y una duración de 10 a 180", () => {
    expect(scheduleFormError({ ...ok, professionalId: "" }, TODAY, now)).toBe("Elegí el profesional.");
    expect(scheduleFormError({ ...ok, date: "" }, TODAY, now)).toBe("Elegí la fecha.");
    expect(scheduleFormError({ ...ok, date: "2026-02-30" }, TODAY, now)).toBe("Elegí la fecha.");
    expect(scheduleFormError({ ...ok, time: "" }, TODAY, now)).toBe("Elegí la hora.");
    expect(scheduleFormError({ ...ok, duration: 5 }, TODAY, now)).toBe("La duración tiene que ser de 10 a 180 minutos.");
    expect(scheduleFormError({ ...ok, duration: 181 }, TODAY, now)).not.toBeNull();
    expect(scheduleFormError({ ...ok, duration: 30.5 }, TODAY, now)).not.toBeNull();
    expect(scheduleFormError({ ...ok, duration: Number.NaN }, TODAY, now)).not.toBeNull();
  });
  test("entre las 07:00 y las 18:00, como la Agenda", () => {
    expect(scheduleFormError({ ...ok, time: "06:30" }, TODAY, now)).toBe("El turno tiene que estar entre las 07:00 y las 18:00.");
    expect(scheduleFormError({ ...ok, time: "17:45", duration: 30 }, TODAY, now)).toBe("El turno tiene que estar entre las 07:00 y las 18:00.");
  });
  test("ni un día que pasó ni, hoy, una hora que pasó", () => {
    expect(scheduleFormError({ ...ok, date: "2026-10-13" }, TODAY, now)).toBe("Esa fecha ya pasó.");
    expect(scheduleFormError({ ...ok, date: TODAY, time: "09:30" }, TODAY, now)).toBe("Esa hora ya pasó.");
    expect(scheduleFormError({ ...ok, date: TODAY, time: "10:00" }, TODAY, now)).toBe("Esa hora ya pasó.");
  });
});

describe("workWindows", () => {
  test("de cada día de la semana: del turno que empieza antes al que termina más tarde", () => {
    expect(workWindows(HISTORY, PRO, "2026-08-19", "2026-11-04")).toEqual({
      lun: { start: MIN("08:00"), end: MIN("12:00") },
      jue: { start: MIN("14:00"), end: MIN("18:00") },
    });
  });
  test("sin los cancelados, los de otro profesional ni los de fuera del período", () => {
    const list = [
      ...HISTORY,
      appt("2026-10-06", "09:00", { status: "cancelado" }),
      appt("2026-10-07", "09:00", { professional_id: OTHER }),
      appt("2026-08-10", "07:00"), // hace más de 8 semanas
    ];
    expect(Object.keys(workWindows(list, PRO, "2026-08-19", "2026-11-04")).sort()).toEqual(["jue", "lun"]);
  });
});

describe("suggestFreeSlots", () => {
  test("sin turnos en las últimas 8 semanas ni en las próximas 3: no sabemos qué días atiende", () => {
    expect(suggestFreeSlots({ ...base, appointments: [] })).toEqual({ slots: [], reason: "no_history", windows: {} });
    const old = [appt("2026-08-10", "08:00")]; // más de 8 semanas atrás
    expect(suggestFreeSlots({ ...base, appointments: old }).reason).toBe("no_history");
    const cancelled = [appt("2026-10-05", "08:00", { status: "cancelado" })];
    expect(suggestFreeSlots({ ...base, appointments: cancelled }).reason).toBe("no_history");
    const other = [appt("2026-10-05", "08:00", { professional_id: OTHER })];
    expect(suggestFreeSlots({ ...base, appointments: other }).reason).toBe("no_history");
    expect(suggestFreeSlots({ ...base, professionalId: "" }).reason).toBe("no_history");
  });

  test("solo los días pedidos, dentro de la franja en que atiende: el primer horario de cada día", () => {
    const r = suggestFreeSlots(base);
    expect(r.reason).toBe("ok");
    expect(r.slots).toEqual([
      { date: "2026-10-15", time: "14:00" }, { date: "2026-10-19", time: "08:00" },
      { date: "2026-10-22", time: "14:00" }, { date: "2026-10-26", time: "08:00" },
      { date: "2026-10-29", time: "14:00" }, { date: "2026-11-02", time: "08:00" },
    ]);
    for (const s of r.slots) expect(dayMatches(s.date, ["lun", "jue"])).toBe(true);
  });

  test("si hay pocos días, reparte: primero el primer horario de cada día, después el segundo", () => {
    const r = suggestFreeSlots({ ...base, days: ["jue"] });
    expect(r.slots).toEqual([
      { date: "2026-10-15", time: "14:00" }, { date: "2026-10-15", time: "14:30" },
      { date: "2026-10-22", time: "14:00" }, { date: "2026-10-22", time: "14:30" },
      { date: "2026-10-29", time: "14:00" }, { date: "2026-10-29", time: "14:30" },
    ]);
    expect(suggestFreeSlots({ ...base, days: ["jue"], max: 2 }).slots).toEqual([
      { date: "2026-10-15", time: "14:00" }, { date: "2026-10-22", time: "14:00" },
    ]);
  });

  test("el horario pedido recorta la franja; si no queda nada, no_free (con las franjas para explicarlo)", () => {
    const tarde = suggestFreeSlots({ ...base, days: ["lun"], band: "tarde" });
    expect(tarde.slots).toEqual([]);
    expect(tarde.reason).toBe("no_free");
    expect(tarde.windows.lun).toEqual({ start: MIN("08:00"), end: MIN("12:00") });
    // Un día que no atiende
    expect(suggestFreeSlots({ ...base, days: ["mar"] }).reason).toBe("no_free");
    const manana = suggestFreeSlots({ ...base, days: ["lun"], band: "manana", max: 50 });
    expect(manana.slots.every((s) => bandMatches(s.time, 30, "manana"))).toBe(true);
    expect(manana.slots.some((s) => s.time === "11:30")).toBe(true);
  });

  test("la duración tiene que entrar entera en la franja", () => {
    const r = suggestFreeSlots({ ...base, days: ["jue"], duration: 40, max: 50 });
    expect(r.slots.every((s) => MIN(s.time) + 40 <= MIN("18:00"))).toBe(true);
    expect(r.slots.some((s) => s.time === "17:00")).toBe(true);
    expect(r.slots.some((s) => s.time === "17:30")).toBe(false);
    expect(suggestFreeSlots({ ...base, duration: 5 }).reason).toBe("no_free");
  });

  test("no pisa sus turnos y propone el horario justo después de uno (aunque no sea en punto)", () => {
    const busy = [...HISTORY, appt("2026-10-15", "14:00", { duration_minutes: 40 })];
    const r = suggestFreeSlots({ ...base, appointments: busy, days: ["jue"], max: 50 });
    const oct15 = r.slots.filter((s) => s.date === "2026-10-15").map((s) => s.time);
    expect(oct15[0]).toBe("14:40");
    expect(oct15).not.toContain("14:00");
    expect(oct15).not.toContain("14:30");
    expect(oct15).toContain("15:00");
    // Un turno cancelado no ocupa el horario
    const freed = [...HISTORY, appt("2026-10-15", "14:00", { status: "cancelado" })];
    expect(suggestFreeSlots({ ...base, appointments: freed, days: ["jue"] }).slots[0]).toEqual({ date: "2026-10-15", time: "14:00" });
    // Los turnos de otro profesional tampoco
    const others = [...HISTORY, appt("2026-10-15", "14:00", { professional_id: OTHER })];
    expect(suggestFreeSlots({ ...base, appointments: others, days: ["jue"] }).slots[0]).toEqual({ date: "2026-10-15", time: "14:00" });
  });

  test("no pisa los otros turnos del chico (con otro profesional) y propone el horario justo después", () => {
    // El jueves 15 a las 14:00 el chico tiene 40 minutos con otra profesional
    const own = [appt("2026-10-15", "14:00", { professional_id: OTHER, duration_minutes: 40 })];
    const r = suggestFreeSlots({ ...base, days: ["jue"], patientAppointments: own, max: 50 });
    const oct15 = r.slots.filter((s) => s.date === "2026-10-15").map((s) => s.time);
    expect(oct15).not.toContain("14:00");
    expect(oct15).not.toContain("14:30");
    expect(oct15[0]).toBe("14:40");
    expect(oct15).toContain("15:00");
    // Los otros jueves no cambian, ni los días que atiende el profesional
    expect(r.slots).toContainEqual({ date: "2026-10-22", time: "14:00" });
    expect(r.windows).toEqual(suggestFreeSlots({ ...base, days: ["jue"] }).windows);
    // Un turno cancelado del chico no ocupa el horario
    const cancelled = [appt("2026-10-15", "14:00", { professional_id: OTHER, status: "cancelado" })];
    expect(suggestFreeSlots({ ...base, days: ["jue"], patientAppointments: cancelled }).slots[0])
      .toEqual({ date: "2026-10-15", time: "14:00" });
    // Los turnos del chico no dicen qué días atiende el profesional
    expect(suggestFreeSlots({ ...base, appointments: [], patientAppointments: own }).reason).toBe("no_history");
  });

  test("si su franja empieza a una hora que no es en punto, ese horario también se propone", () => {
    const list = [appt("2026-10-05", "08:40"), appt("2026-10-05", "11:20", { duration_minutes: 40 })];
    const r = suggestFreeSlots({ ...base, appointments: list, days: ["lun"], max: 50 });
    const oct19 = r.slots.filter((s) => s.date === "2026-10-19").map((s) => s.time);
    expect(oct19[0]).toBe("08:40");
    expect(oct19).not.toContain("08:30");
    expect(oct19.at(-1)).toBe("11:30"); // termina a las 12:00, el fin de su franja
  });

  test("respeta los bloqueos activos: suyos o de todo el centro, de día completo o por horario", () => {
    const blocks = [
      block("2026-10-15"), // jueves 15, día completo, suyo
      block("2026-10-19", { professional_id: null, start_time: "08:00:00", end_time: "10:00:00" }), // todo el centro, 8 a 10
      block("2026-10-22", { professional_id: OTHER }), // de otro profesional: no cuenta
      block("2026-10-26", { active: false }), // levantado: no cuenta
    ];
    const r = suggestFreeSlots({ ...base, blocks, max: 50 });
    expect(r.slots.some((s) => s.date === "2026-10-15")).toBe(false);
    const oct19 = r.slots.filter((s) => s.date === "2026-10-19").map((s) => s.time);
    expect(oct19[0]).toBe("10:00");
    expect(r.slots.some((s) => s.date === "2026-10-22" && s.time === "14:00")).toBe(true);
    expect(r.slots.some((s) => s.date === "2026-10-26" && s.time === "08:00")).toBe(true);
  });

  test("hoy, solo desde dentro de una hora; nunca días que pasaron", () => {
    // Atiende los miércoles de 8 a 12 (hoy es miércoles)
    const list = [...HISTORY, appt("2026-10-07", "08:00"), appt("2026-10-07", "11:30")];
    const r = suggestFreeSlots({ ...base, appointments: list, days: ["mie"], nowMinutes: MIN("09:10"), max: 50 });
    const today = r.slots.filter((s) => s.date === TODAY).map((s) => s.time);
    expect(today[0]).toBe("10:30");
    expect(r.slots.every((s) => s.date >= TODAY)).toBe(true);
    // Ya no entra ninguno hoy: el primero es el miércoles que viene
    const late = suggestFreeSlots({ ...base, appointments: list, days: ["mie"], nowMinutes: MIN("11:10") });
    expect(late.slots[0]).toEqual({ date: "2026-10-21", time: "08:00" });
  });

  test("los turnos de las próximas semanas también dicen qué días atiende", () => {
    const future = [appt("2026-10-23", "09:00"), appt("2026-10-23", "10:30")]; // viernes
    const r = suggestFreeSlots({ ...base, appointments: future, days: ["vie"] });
    expect(r.reason).toBe("ok");
    expect(r.slots[0]).toEqual({ date: "2026-10-16", time: "09:00" });
    // El 23 quedan libres las 09:30, las 10:00 y no más (atiende hasta las 11:00)
    const oct23 = suggestFreeSlots({ ...base, appointments: future, days: ["vie"], max: 50 }).slots
      .filter((s) => s.date === "2026-10-23").map((s) => s.time);
    expect(oct23).toEqual(["09:30", "10:00"]);
  });

  test("no se pasa del horizonte", () => {
    const r = suggestFreeSlots({ ...base, horizonDays: 7, max: 50 });
    expect(r.slots.every((s) => s.date < "2026-10-21")).toBe(true);
    expect(r.slots.length).toBeGreaterThan(0);
  });
});

describe("patientClash", () => {
  // El martes 20 a las 15:00, 40 minutos con otra profesional; a las 17:00, uno cancelado
  const own = [
    appt("2026-10-20", "15:00", { professional_id: OTHER, duration_minutes: 40 }),
    appt("2026-10-20", "17:00", { status: "cancelado" }),
  ];
  test("el primer turno sin cancelar de ese día que se superpone con el que se quiere dar", () => {
    expect(patientClash("2026-10-20", "15:00", 30, own)).toBe(own[0]);
    expect(patientClash("2026-10-20", "14:45", 30, own)).toBe(own[0]); // termina 15:15
    expect(patientClash("2026-10-20", "15:30", 30, own)).toBe(own[0]); // el otro termina 15:40
  });
  test("justo antes, justo después, un cancelado u otro día no se superponen", () => {
    expect(patientClash("2026-10-20", "14:30", 30, own)).toBeNull();
    expect(patientClash("2026-10-20", "15:40", 30, own)).toBeNull();
    expect(patientClash("2026-10-20", "17:00", 30, own)).toBeNull();
    expect(patientClash("2026-10-21", "15:00", 30, own)).toBeNull();
    expect(patientClash("2026-10-20", "", 30, own)).toBeNull();
    expect(patientClash("2026-10-20", "15:00", 30, [])).toBeNull();
  });
});
