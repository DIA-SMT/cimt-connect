// "08:00:00" → "08:00"
export function formatTime(t: string): string {
  return t.slice(0, 5);
}
