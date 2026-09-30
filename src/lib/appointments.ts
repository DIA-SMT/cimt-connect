// Turnos de 1 hora; el centro atiende de 07 a 18 hs (el último turno arranca a las 17).
// Tienen que coincidir con la lista de request_appointment() en 9_modalidad_localidad.sql.
export const TIME_SLOTS = [
  "07:00", "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00", "17:00",
] as const;

export type SlotStatus = "available" | "pending" | "occupied";

export function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatTime(t: string): string {
  return t.slice(0, 5);
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}