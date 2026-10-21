import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { ScheduleBlock } from "@/lib/agenda";
import { toMinutes } from "@/lib/agenda";
import { WEEKDAYS, WEEKDAY_LABEL } from "@/lib/apptRequestRules";
import {
  type ScheduleAppt, type SlotSuggestion, SCHEDULE_HISTORY_DAYS, SCHEDULE_HORIZON_DAYS, SCHEDULE_MAX_MINUTES,
  SCHEDULE_MIN_MINUTES, suggestFreeSlots, weekdayOfKey,
} from "@/lib/apptSchedule";
import { addDaysKey, centerNow } from "@/lib/portalRules";
import type { ProfessionalOption } from "@/lib/patients";
import { hoursWindows, parseWeeklyHours } from "@/lib/workHours";

// «Horarios libres» de un profesional en las próximas 3 semanas, para dar un
// turno con un toque (Nuevo turno: al admitir una derivación, desde la ficha o
// desde la Agenda). Misma cuenta que Portal → Pedidos de turno (suggestFreeSlots),
// sin días ni franja pedidos: cualquier día que atienda. No pisa sus turnos, los
// otros turnos del paciente ni los bloqueos.

const APPT_COLS = "id, professional_id, appointment_date, appointment_time, duration_minutes, status";

// "Jue 15/10 · 14:00" (el botón) y "Jueves 15/10 a las 14:00" (lectores de pantalla)
function slotText(s: SlotSuggestion): { short: string; long: string } {
  const w = weekdayOfKey(s.date);
  const day = w ? WEEKDAY_LABEL[w] : "";
  const ddmm = `${s.date.slice(8, 10)}/${s.date.slice(5, 7)}`;
  return { short: `${day.slice(0, 3)} ${ddmm} · ${s.time}`, long: `${day} ${ddmm} a las ${s.time}` };
}

export function FreeSlots({ professional, patientId, duration, date, time, onPick }: {
  professional: ProfessionalOption | undefined;
  patientId: string | null;
  duration: number;
  date: string;
  time: string;
  onPick: (s: SlotSuggestion) => void;
}) {
  const id = useId();
  const proId = professional?.id ?? "";
  const [agenda, setAgenda] = useState<{ proId: string; appts: ScheduleAppt[] } | null>(null);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [patientAppts, setPatientAppts] = useState<ScheduleAppt[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Bloqueos (de todos: los hay de todo el centro) y los turnos del paciente
  useEffect(() => {
    const today = centerNow().date;
    void supabase.from("schedule_blocks").select("*").eq("active", true)
      .gte("block_date", today).lte("block_date", addDaysKey(today, SCHEDULE_HORIZON_DAYS))
      .then(({ data, error }: { data: ScheduleBlock[] | null; error: unknown }) => { if (!error) setBlocks(data ?? []); });
  }, []);
  useEffect(() => {
    if (!patientId) { setPatientAppts([]); return; }
    void supabase.from("appointments").select(APPT_COLS).eq("patient_id", patientId).neq("status", "cancelado")
      .gte("appointment_date", centerNow().date)
      .then(({ data, error }: { data: ScheduleAppt[] | null; error: unknown }) => { if (!error) setPatientAppts(data ?? []); });
  }, [patientId]);

  // Su agenda: 8 semanas atrás (para saber qué días atiende) y 3 adelante.
  // Si mientras tanto se eligió otro profesional, vale esa carga
  const seq = useRef(0);
  const load = useCallback(async (pid: string) => {
    const n = ++seq.current;
    setLoading(true);
    setFailed(false);
    const today = centerNow().date;
    const { data, error } = await supabase.from("appointments").select(APPT_COLS)
      .eq("professional_id", pid).neq("status", "cancelado")
      .gte("appointment_date", addDaysKey(today, -SCHEDULE_HISTORY_DAYS))
      .lte("appointment_date", addDaysKey(today, SCHEDULE_HORIZON_DAYS));
    if (seq.current !== n) return;
    setLoading(false);
    if (error) { setFailed(true); setAgenda(null); return; }
    setAgenda({ proId: pid, appts: (data ?? []) as ScheduleAppt[] });
  }, []);
  useEffect(() => {
    if (proId) void load(proId);
    else { seq.current++; setAgenda(null); }
  }, [proId, load]);

  const now = centerNow();
  const durationOk = Number.isInteger(duration) && duration >= SCHEDULE_MIN_MINUTES && duration <= SCHEDULE_MAX_MINUTES;
  const suggest = useMemo(() => {
    if (!agenda || agenda.proId !== proId || !durationOk) return null;
    const hours = parseWeeklyHours(professional?.weekly_hours);
    return suggestFreeSlots({
      days: WEEKDAYS, band: "indistinto", professionalId: proId, duration,
      appointments: agenda.appts, patientAppointments: patientAppts, blocks, today: now.date, nowMinutes: toMinutes(now.time),
      hours: hours ? hoursWindows(hours) : null,
    });
  }, [agenda, proId, durationOk, duration, patientAppts, blocks, now.date, now.time, professional?.weekly_hours]);

  if (!proId) return null;
  return (
    <div className="space-y-1.5 sm:col-span-2">
      <p id={id} className="text-sm font-semibold">Horarios libres de {professional?.name ?? "este profesional"}</p>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Buscando horarios libres…
        </p>
      ) : failed ? (
        <p className="text-xs text-muted-foreground">
          No se pudieron buscar horarios libres: elegí día y hora a mano.{" "}
          <Button type="button" size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => void load(proId)}>
            Probar de nuevo
          </Button>
        </p>
      ) : !durationOk ? (
        <p className="text-xs text-muted-foreground">Revisá la duración para ver los horarios libres.</p>
      ) : suggest?.reason === "no_history" ? (
        <p className="text-xs text-muted-foreground">Todavía no sabemos qué días atiende (no tiene horario cargado ni turnos): elegí día y hora a mano.</p>
      ) : suggest?.reason === "no_free" ? (
        <p className="text-xs text-muted-foreground">No encontramos horarios libres en las próximas 3 semanas: elegí día y hora a mano.</p>
      ) : suggest ? (
        <>
          <div role="group" aria-labelledby={id} className="flex flex-wrap gap-1.5">
            {suggest.slots.map((s) => {
              const label = slotText(s);
              const active = s.date === date && s.time === time;
              return (
                <button key={`${s.date} ${s.time}`} type="button" onClick={() => onPick(s)} aria-pressed={active}
                  className={[
                    "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/60 bg-muted text-foreground hover:bg-[color:var(--primary-soft)]",
                  ].join(" ")}>
                  {label.short}<span className="sr-only"> ({label.long})</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Cuando suele atender. Tocá uno para usarlo.</p>
        </>
      ) : null}
    </div>
  );
}
