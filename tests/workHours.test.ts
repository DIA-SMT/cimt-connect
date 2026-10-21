// Pruebas del horario de atención de cada profesional (src/lib/workHours.ts,
// script 36) y de su uso en las sugerencias de «Dar turno».
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import { suggestFreeSlots } from "../src/lib/apptSchedule";
import {
  closedWindows, hoursProblem, hoursSummary, hoursWindows, parseWeeklyHours, withinHours, type WeeklyHours,
} from "../src/lib/workHours";

const SPLIT: WeeklyHours = {
  lun: [{ start: "14:00", end: "18:00" }, { start: "08:00", end: "12:00" }],
  mie: [{ start: "08:00", end: "12:00" }],
};
const MIN = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

describe("reglas del horario", () => {
  test("hasta dos franjas por día, de 07:00 a 18:00, sin superponerse", () => {
    expect(hoursProblem(SPLIT)).toBeNull();
    expect(hoursProblem({ lun: [{ start: "12:00", end: "08:00" }] })).toContain("después");
    expect(hoursProblem({ lun: [{ start: "06:00", end: "08:00" }] })).toContain("07:00 a 18:00");
    expect(hoursProblem({ lun: [{ start: "08:00", end: "12:00" }, { start: "11:00", end: "13:00" }] })).toContain("superponen");
    expect(hoursProblem({ lun: [{ start: "08:00", end: "09:00" }, { start: "10:00", end: "11:00" }, { start: "12:00", end: "13:00" }] })).toContain("hasta 2");
  });
  test("parseWeeklyHours: lo que viene de la base; sin horario o roto, null", () => {
    expect(parseWeeklyHours(null)).toBeNull();
    expect(parseWeeklyHours({})).toBeNull();
    expect(parseWeeklyHours({ lun: [{ start: "12:00", end: "08:00" }] })).toBeNull();
    expect(parseWeeklyHours({ ...SPLIT, sab: [{ start: "08:00", end: "12:00" }] })).toEqual(SPLIT);
  });
  test("franjas ordenadas y horas en gris", () => {
    expect(hoursWindows(SPLIT).lun).toEqual([{ start: MIN("08:00"), end: MIN("12:00") }, { start: MIN("14:00"), end: MIN("18:00") }]);
    expect(closedWindows(SPLIT, "lun")).toEqual([
      { start: MIN("07:00"), end: MIN("08:00") }, { start: MIN("12:00"), end: MIN("14:00") },
    ]);
    expect(closedWindows(SPLIT, "mar")).toEqual([{ start: MIN("07:00"), end: MIN("18:00") }]);
  });
  test("withinHours: dentro, fuera y sin horario", () => {
    expect(withinHours(SPLIT, "lun", "08:00", 30)).toBe(true);
    expect(withinHours(SPLIT, "lun", "11:45", 30)).toBe(false); // se pasa de las 12
    expect(withinHours(SPLIT, "mar", "09:00", 30)).toBe(false);
    expect(withinHours(null, "lun", "09:00", 30)).toBeNull();
  });
  test("hoursSummary agrupa los días con el mismo horario", () => {
    expect(hoursSummary({ lun: [{ start: "08:00", end: "12:00" }], mie: [{ start: "08:00", end: "12:00" }], vie: [{ start: "14:30", end: "18:00" }] }))
      .toBe("Lunes y miércoles de 8 a 12 · Viernes de 14:30 a 18");
    expect(hoursSummary(SPLIT)).toBe("Lunes de 8 a 12 y de 14 a 18 · Miércoles de 8 a 12");
  });
});

describe("«Dar turno» con horario cargado", () => {
  const base = {
    days: ["lun"] as const, band: "indistinto" as const, professionalId: "pro-1", duration: 30,
    appointments: [], blocks: [], today: "2026-10-14", nowMinutes: MIN("10:00"),
  };
  test("sin turnos previos igual sugiere, solo dentro de sus franjas", () => {
    const r = suggestFreeSlots({ ...base, hours: hoursWindows(SPLIT), max: 20 });
    expect(r.reason).toBe("ok");
    expect(r.slots.length).toBeGreaterThan(0);
    for (const s of r.slots) expect(withinHours(SPLIT, "lun", s.time, 30)).toBe(true);
    expect(r.slots.some((s) => s.time === "12:30")).toBe(false); // el corte del mediodía
  });
  test("sin horario cargado, como antes: no sabemos qué días atiende", () => {
    expect(suggestFreeSlots({ ...base, hours: null }).reason).toBe("no_history");
  });
});
