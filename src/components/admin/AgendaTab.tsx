import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Ban, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Loader2, Phone, Printer, Video,
} from "lucide-react";
import { selectClass } from "./fields";
import { useMine } from "./useMine";
import { ScopeToggle } from "./ScopeToggle";
import { canEditClinical, type Staff } from "@/lib/staff";
import { formatShortDate, todayKey, type ProfessionalOption } from "@/lib/patients";
import {
  AGENDA_END_MIN, AGENDA_START_MIN, ATTENDANCE_LABEL, addDays, agendaErrorMessage, blockAffects,
  fromMinutes, isWeekendKey, longDate, nextWorkday, toMinutes,
  type AgendaAppointment, type Attendance, type Modality, type ScheduleBlock,
} from "@/lib/agenda";

// Pestaña "Agenda" (fase 2): turnos por profesional, varios a la vez, con la
// duración de cada profesional (relevamiento 1–3), asistencia y práctica
// numerada (7, 25, 34), bloqueos por imprevistos (10) y turnos de mañana (6).

type Props = {
  professionals: ProfessionalOption[];
  staff: Staff;
  onOpenPatient: (patientId: string) => void;
};

const PX_PER_MIN = 1.6;
const GRID_HEIGHT = (AGENDA_END_MIN - AGENDA_START_MIN) * PX_PER_MIN;
const HEADER_H = "h-16";
// En computadora la grilla usa el scroll de la página: la fila de profesionales
// queda fija debajo de la barra del sitio (h-16 + borde). En celular la grilla
// se desplaza de costado y la columna de horas queda fija.
const STICKY_TOP = "top-0 lg:top-[65px]";
const UNASSIGNED = "__sin_asignar__";

const APPT_SELECT = "*, patients(first_name, last_name, dni, phone, guardian_phone)";

function firstWorkdayFrom(dateKey: string): string {
  return isWeekendKey(dateKey) ? nextWorkday(dateKey) : dateKey;
}

// Lunes de la semana de una fecha (AAAA-MM-DD)
function mondayOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const offset = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return addDays(dateKey, -offset);
}

const WEEKDAY = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

type Column = { id: string; title: string; subtitle: string; proId: string; date: string };

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function AgendaTab({ professionals, staff, onOpenPatient }: Props) {
  const [date, setDate] = useState(() => firstWorkdayFrom(todayKey()));
  const [appts, setAppts] = useState<AgendaAppointment[]>([]);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<{ professional_id: string; time: string; date: string } | null>(null);
  const [openApptId, setOpenApptId] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [now, setNow] = useState(nowMinutes);
  const mine = useMine("agenda", staff);

  // Línea de "ahora": se actualiza cada minuto
  useEffect(() => {
    const t = setInterval(() => setNow(nowMinutes()), 60_000);
    return () => clearInterval(t);
  }, []);

  // "Mis turnos" muestra la semana (lunes a viernes) del profesional del usuario
  const weekMode = mine.on && !!mine.professionalId;
  const weekDays = useMemo(() => {
    const monday = mondayOf(date);
    return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
  }, [date]);

  async function load() {
    setLoading(true);
    let qa = supabase.from("appointments").select(APPT_SELECT);
    let qb = supabase.from("schedule_blocks").select("*").eq("active", true);
    if (weekMode) {
      qa = qa.gte("appointment_date", weekDays[0]).lte("appointment_date", weekDays[4]).eq("professional_id", mine.professionalId!);
      qb = qb.gte("block_date", weekDays[0]).lte("block_date", weekDays[4]);
    } else {
      qa = qa.eq("appointment_date", date);
      qb = qb.eq("block_date", date);
    }
    const [a, b] = await Promise.all([qa.order("appointment_time"), qb]);
    if (a.error || b.error) toast.error("No se pudo cargar la agenda");
    setAppts((a.data ?? []) as AgendaAppointment[]);
    setBlocks((b.data ?? []) as ScheduleBlock[]);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date, weekMode]);

  const active = appts.filter((a) => a.status !== "cancelado");
  const canceledCount = appts.length - active.length;
  const myPro = professionals.find((p) => p.id === mine.professionalId);
  const today = todayKey();

  // Día: una columna por profesional. Semana ("Mis turnos"): una columna por día.
  const columns = useMemo<Column[]>(() => {
    if (weekMode) {
      return weekDays.map((d, i) => ({
        id: d, proId: mine.professionalId!, date: d,
        title: `${WEEKDAY[i]} ${formatShortDate(d).slice(0, 5)}`,
        subtitle: d === today ? "Hoy" : "",
      }));
    }
    const cols: Column[] = professionals
      .filter((p) => p.active !== false || active.some((a) => a.professional_id === p.id))
      .sort((a, b) => a.specialty.localeCompare(b.specialty) || a.name.localeCompare(b.name))
      .map((p) => ({ id: p.id, proId: p.id, date, title: p.name, subtitle: `${p.specialty} · ${p.session_minutes ?? 30} min` }));
    if (active.some((a) => !a.professional_id)) {
      cols.push({ id: UNASSIGNED, proId: UNASSIGNED, date, title: "Sin profesional", subtitle: "Pedidos del sitio anterior" });
    }
    return cols;
  }, [professionals, active, weekMode, weekDays, mine.professionalId, date, today]);

  const openAppt = appts.find((a) => a.id === openApptId) ?? null;
  const weekend = !weekMode && isWeekendKey(date);
  const nowInRange = now >= AGENDA_START_MIN && now <= AGENDA_END_MIN;
  const showNow = nowInRange && columns.some((c) => c.date === today);
  const step = weekMode ? 7 : 1;

  function clickColumn(col: Column, e: React.MouseEvent<HTMLDivElement>) {
    if (col.proId === UNASSIGNED) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = AGENDA_START_MIN + Math.floor(y / PX_PER_MIN / 10) * 10;
    setCreating({ professional_id: col.proId, date: col.date, time: fromMinutes(Math.min(min, AGENDA_END_MIN - 10)) });
  }

  return (
    <div className="mt-6 space-y-4">
      {/* Barra */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" aria-label={weekMode ? "Semana anterior" : "Día anterior"} onClick={() => setDate(addDays(date, -step))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
          aria-label="Fecha de la agenda" className="h-10 w-auto" />
        <Button size="icon" variant="outline" aria-label={weekMode ? "Semana siguiente" : "Día siguiente"} onClick={() => setDate(addDays(date, step))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={() => setDate(firstWorkdayFrom(todayKey()))}>Hoy</Button>
        <h2 className="ml-1 font-display text-lg font-bold text-[color:var(--primary-deep)]">
          {weekMode ? (
            <>
              Semana del {formatShortDate(weekDays[0]).slice(0, 5)} al {formatShortDate(weekDays[4]).slice(0, 5)}
              {myPro && <span className="ml-2 text-sm font-medium text-muted-foreground">{myPro.name}</span>}
            </>
          ) : <span className="capitalize">{longDate(date)}</span>}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {mine.available && (
            <ScopeToggle on={mine.on} onChange={mine.setOn} allLabel="Todo el equipo" mineLabel="Mis turnos" />
          )}
          <Button variant="outline" onClick={() => setShowTomorrow(true)}>
            <CalendarClock className="mr-1.5 h-4 w-4" /> Turnos de mañana
          </Button>
          <Button variant="outline" onClick={() => setBlocking(true)}>
            <Ban className="mr-1.5 h-4 w-4" /> Bloquear horario
          </Button>
          <Button onClick={() => setCreating({ professional_id: columns.find((c) => c.proId !== UNASSIGNED)?.proId ?? "", time: "09:00", date })}
            className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            <CalendarPlus className="mr-1.5 h-4 w-4" /> Nuevo turno
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          {active.length} turno{active.length === 1 ? "" : "s"}{weekMode ? " tuyos en la semana" : ""}
          {canceledCount > 0 && ` · ${canceledCount} cancelado${canceledCount === 1 ? "" : "s"}`}
        </span>
        <Legend color="var(--primary-soft)" label="Confirmado" />
        <Legend color="var(--status-pending-bg)" label="Pendiente" />
        <Legend color="var(--status-available-bg)" label="Presente" />
        <Legend color="var(--status-occupied-bg)" label="Ausente" />
        {weekend && <span className="font-semibold text-[color:var(--status-occupied)]">Fin de semana: el centro no atiende</span>}
        {mine.needsLink && (
          <span className="rounded-full bg-[color:var(--status-pending-bg)] px-2 py-0.5 font-semibold text-[color:var(--status-pending)]">
            Para ver solo tus turnos, pedile a la Dirección que vincule tu usuario con tu profesional (pestaña Equipo).
          </span>
        )}
        {blocks.map((b) => (
          <span key={b.id} className="rounded-full bg-muted px-2 py-0.5 font-semibold">
            Bloqueo{weekMode ? ` ${formatShortDate(b.block_date).slice(0, 5)}` : ""}: {b.reason}{b.start_time ? ` (${b.start_time.slice(0, 5)}–${b.end_time?.slice(0, 5)})` : " (todo el día)"}
          </span>
        ))}
      </div>

      {columns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No hay profesionales activos. Cargalos en la pestaña <strong>Equipo</strong> (lo hace la Dirección).
        </div>
      ) : (
        <div className="relative overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)] lg:overflow-visible">
          <div className={`flex min-w-full pb-3 ${weekend ? "opacity-60" : ""}`}>
            {/* Eje de horas */}
            <div className="sticky left-0 z-20 w-16 shrink-0 border-r border-border/60 bg-card">
              <div className={`sticky ${STICKY_TOP} z-30 ${HEADER_H} rounded-tl-2xl border-b border-border/60 bg-card`} />
              <div className="relative" style={{ height: GRID_HEIGHT }}>
                {Array.from({ length: (AGENDA_END_MIN - AGENDA_START_MIN) / 60 + 1 }, (_, i) => {
                  const min = AGENDA_START_MIN + i * 60;
                  return (
                    <div key={min}
                      className={`absolute right-2 text-xs font-medium tabular-nums text-muted-foreground ${i === 0 ? "translate-y-1" : "-translate-y-1/2"}`}
                      style={{ top: (min - AGENDA_START_MIN) * PX_PER_MIN }}>
                      {fromMinutes(min)}
                    </div>
                  );
                })}
                {showNow && (
                  <div className="absolute right-0 z-10 -translate-y-1/2 rounded-l-full bg-[color:var(--status-occupied)] px-1.5 py-px text-[10px] font-bold tabular-nums text-white"
                    style={{ top: (now - AGENDA_START_MIN) * PX_PER_MIN }}>
                    {fromMinutes(now)}
                  </div>
                )}
              </div>
            </div>

            {columns.map((col) => {
              const colAppts = active.filter((a) => (a.professional_id ?? UNASSIGNED) === col.proId && a.appointment_date === col.date);
              const colBlocks = blocks.filter((b) => b.block_date === col.date && (!b.professional_id || b.professional_id === col.proId));
              const colToday = weekMode && col.date === today;
              return (
                <div key={col.id} className="group/col min-w-[11.5rem] flex-1 basis-0 border-r border-border/60 last:border-r-0 lg:min-w-0">
                  <div className={`sticky ${STICKY_TOP} z-10 ${HEADER_H} border-b px-3 py-2 backdrop-blur group-last/col:rounded-tr-2xl ${colToday ? "border-primary/40 bg-[color:var(--primary-soft)]/95" : "border-border/60 bg-card/95"}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-[color:var(--primary-deep)]" title={col.title}>{col.title}</div>
                        <div className={`truncate text-xs ${colToday ? "font-semibold text-primary" : "text-muted-foreground"}`}>{col.subtitle}</div>
                      </div>
                      {colAppts.length > 0 && (
                        <span className="shrink-0 rounded-full bg-[color:var(--primary-soft)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[color:var(--primary-deep)]"
                          title={`${colAppts.length} turno${colAppts.length === 1 ? "" : "s"}`}>
                          {colAppts.length}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={`relative ${col.id === UNASSIGNED ? "bg-muted/30" : "cursor-copy transition-colors hover:bg-primary/[0.03]"}`}
                    style={{ height: GRID_HEIGHT }}
                    onClick={(e) => clickColumn(col, e)}
                    title={col.id === UNASSIGNED ? undefined : "Clic en un horario libre para dar un turno"}>
                    {/* Líneas de cada media hora */}
                    {Array.from({ length: (AGENDA_END_MIN - AGENDA_START_MIN) / 30 }, (_, i) => (
                      <div key={i} className={`absolute inset-x-0 border-t ${i % 2 === 0 ? "border-border/80" : "border-dashed border-border/40"}`}
                        style={{ top: i * 30 * PX_PER_MIN }} />
                    ))}
                    {colBlocks.map((b) => {
                      const start = b.start_time ? toMinutes(b.start_time) : AGENDA_START_MIN;
                      const end = b.end_time ? toMinutes(b.end_time) : AGENDA_END_MIN;
                      return (
                        <div key={b.id} className="absolute inset-x-0 flex items-start justify-center overflow-hidden px-1 pt-1 text-[11px] font-semibold text-muted-foreground"
                          style={{
                            top: (Math.max(start, AGENDA_START_MIN) - AGENDA_START_MIN) * PX_PER_MIN,
                            height: (Math.min(end, AGENDA_END_MIN) - Math.max(start, AGENDA_START_MIN)) * PX_PER_MIN,
                            background: "repeating-linear-gradient(135deg, var(--muted) 0 6px, transparent 6px 12px)",
                          }}>
                          {b.reason}
                        </div>
                      );
                    })}
                    {nowInRange && col.date === today && (
                      <div className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-[color:var(--status-occupied)]"
                        style={{ top: (now - AGENDA_START_MIN) * PX_PER_MIN }} />
                    )}
                    {colAppts.map((a) => (
                      <ApptBlock key={a.id} appt={a} onClick={(e) => { e.stopPropagation(); setOpenApptId(a.id); }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {loading && (
            <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
        </div>
      )}

      {creating && (
        <NewAppointmentDialog
          professionals={professionals}
          initial={creating}
          onClose={() => setCreating(null)}
          onSaved={() => { setCreating(null); load(); }}
        />
      )}
      {openAppt && (
        <AppointmentDialog
          appt={openAppt}
          professional={professionals.find((p) => p.id === openAppt.professional_id)}
          staff={staff}
          onClose={() => setOpenApptId(null)}
          onChanged={() => load()}
          onOpenPatient={(id) => { setOpenApptId(null); onOpenPatient(id); }}
        />
      )}
      {blocking && (
        <BlockDialog professionals={professionals} initialDate={date}
          onClose={() => setBlocking(false)} onSaved={() => load()} />
      )}
      {showTomorrow && (
        <TomorrowDialog professionals={professionals} professionalId={mine.on ? mine.professionalId : null}
          onClose={() => setShowTomorrow(false)} />
      )}
    </div>
  );
}

// ─── Bloque de turno en la grilla ────────────────────────────────────────────

function ApptBlock({ appt: a, onClick }: { appt: AgendaAppointment; onClick: (e: React.MouseEvent) => void }) {
  const start = toMinutes(a.appointment_time);
  const height = Math.max(a.duration_minutes * PX_PER_MIN - 3, 20);
  const compact = height < 44;
  const style = a.attendance === "presente" ? "bg-[color:var(--status-available-bg)] border-l-[color:var(--status-available)]"
    : a.attendance === "ausente" ? "bg-[color:var(--status-occupied-bg)] border-l-[color:var(--status-occupied)]"
    : a.attendance === "justificado" ? "bg-muted border-l-muted-foreground/50"
    : a.status === "pendiente" ? "bg-[color:var(--status-pending-bg)] border-l-[color:var(--status-pending)]"
    : "bg-[color:var(--primary-soft)] border-l-primary";
  const name = a.patients ? `${a.patients.last_name}, ${a.patients.first_name}` : "Sin paciente";
  const time = `${a.appointment_time.slice(0, 5)}–${fromMinutes(start + a.duration_minutes)}`;
  return (
    <button onClick={onClick} title={`${time} · ${name}`}
      className={`absolute inset-x-1.5 z-[6] overflow-hidden rounded-lg border border-black/5 border-l-4 px-2 text-left leading-tight shadow-sm transition hover:z-20 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${compact ? "py-0.5" : "py-1"} ${style}`}
      style={{ top: (start - AGENDA_START_MIN) * PX_PER_MIN + 1.5, height }}>
      {compact ? (
        <div className="flex items-center gap-1.5 truncate text-xs">
          <span className="font-semibold tabular-nums">{a.appointment_time.slice(0, 5)}</span>
          <span className="truncate font-medium">{name}</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 text-[11px] font-semibold tabular-nums text-foreground/70">
            {time}
            {a.modality === "telemedicina" && <Video className="h-3 w-3" aria-label="Telemedicina" />}
            {a.attendance && (
              <span className="ml-auto rounded bg-white/60 px-1 text-[9px] font-bold uppercase tracking-wide">
                {a.attendance === "justificado" ? "just." : a.attendance}
              </span>
            )}
          </div>
          <div className="truncate text-[13px] font-semibold text-foreground">{name}</div>
        </>
      )}
    </button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-3 w-3 rounded-sm border border-border" style={{ backgroundColor: color }} /> {label}
    </span>
  );
}

// ─── Nuevo turno ─────────────────────────────────────────────────────────────

type PatientLite = { id: string; first_name: string; last_name: string; dni: string };

function NewAppointmentDialog({ professionals, initial, onClose, onSaved }: {
  professionals: ProfessionalOption[];
  initial: { professional_id: string; time: string; date: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const activePros = professionals.filter((p) => p.active !== false);
  const [patients, setPatients] = useState<PatientLite[]>([]);
  const [query, setQuery] = useState("");
  const [patient, setPatient] = useState<PatientLite | null>(null);
  const [professionalId, setProfessionalId] = useState(initial.professional_id || activePros[0]?.id || "");
  const pro = professionals.find((p) => p.id === professionalId);
  const [form, setForm] = useState({
    date: initial.date,
    time: initial.time,
    duration: String(pro?.session_minutes ?? 30),
    modality: "presencial" as Modality,
    consultation_type: "seguimiento" as "primera_vez" | "seguimiento",
    reason: "",
    repeat: "1",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("patients").select("id, first_name, last_name, dni").order("last_name")
      .then(({ data }: { data: PatientLite[] | null }) => setPatients(data ?? []));
  }, []);

  function changeProfessional(id: string) {
    setProfessionalId(id);
    const p = professionals.find((x) => x.id === id);
    setForm((f) => ({ ...f, duration: String(p?.session_minutes ?? 30) }));
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return patients.filter((p) => `${p.first_name} ${p.last_name} ${p.dni}`.toLowerCase().includes(q)).slice(0, 6);
  }, [patients, query]);

  async function save() {
    if (!patient) { toast.error("Elegí el paciente"); return; }
    if (!professionalId) { toast.error("Elegí el profesional"); return; }
    const start = toMinutes(form.time);
    const duration = Number(form.duration);
    if (!duration || duration < 10 || duration > 180) { toast.error("Duración inválida"); return; }
    if (start < AGENDA_START_MIN || start + duration > AGENDA_END_MIN) {
      toast.error("El turno tiene que estar entre las 07:00 y las 18:00"); return;
    }
    const repeat = Math.min(Math.max(Number(form.repeat) || 1, 1), 16);
    setSaving(true);
    const failed: string[] = [];
    for (let i = 0; i < repeat; i++) {
      const d = addDays(form.date, i * 7);
      const { error } = await supabase.from("appointments").insert({
        patient_id: patient.id,
        professional_id: professionalId,
        appointment_date: d,
        appointment_time: form.time,
        duration_minutes: duration,
        modality: form.modality,
        consultation_type: form.consultation_type,
        reason: form.reason.trim() || "Sesión",
        status: "confirmado",
      });
      if (error) failed.push(`${formatShortDate(d)}: ${agendaErrorMessage(error.message)}`);
    }
    setSaving(false);
    const ok = repeat - failed.length;
    if (ok > 0) toast.success(ok === 1 ? "Turno agendado" : `${ok} turnos agendados`);
    if (failed.length) toast.error(failed.join(" · "), { duration: 8000 });
    if (ok > 0) onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Nuevo turno</DialogTitle>
          <DialogDescription>El paciente tiene que estar admitido (con ficha).</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="na-patient">Paciente</Label>
          {patient ? (
            <div className="flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm">
              <span><strong>{patient.last_name}, {patient.first_name}</strong> · DNI {patient.dni}</span>
              <Button size="sm" variant="ghost" onClick={() => { setPatient(null); setQuery(""); }}>Cambiar</Button>
            </div>
          ) : (
            <>
              <Input id="na-patient" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o DNI" autoFocus />
              {matches.length > 0 && (
                <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPatient(p)} className="w-full px-3 py-2 text-left text-sm hover:bg-[color:var(--primary-soft)]/50">
                        {p.last_name}, {p.first_name} <span className="text-muted-foreground">· DNI {p.dni}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim() && matches.length === 0 && (
                <p className="text-xs text-muted-foreground">Sin resultados. Si es nuevo, admitilo primero desde Solicitudes o creá la ficha en Pacientes.</p>
              )}
            </>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="na-pro">Profesional</Label>
            <select id="na-pro" value={professionalId} onChange={(e) => changeProfessional(e.target.value)} className={selectClass}>
              {activePros.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na-date">Fecha</Label>
            <Input id="na-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na-time">Hora</Label>
            <Input id="na-time" type="time" step={300} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na-dur">Duración (min)</Label>
            <Input id="na-dur" type="number" min={10} max={180} step={5} value={form.duration}
              onChange={(e) => setForm({ ...form, duration: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na-mod">Modalidad</Label>
            <select id="na-mod" value={form.modality} onChange={(e) => setForm({ ...form, modality: e.target.value as Modality })} className={selectClass}>
              <option value="presencial">Presencial</option>
              <option value="telemedicina">Telemedicina</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na-type">Tipo</Label>
            <select id="na-type" value={form.consultation_type}
              onChange={(e) => setForm({ ...form, consultation_type: e.target.value as "primera_vez" | "seguimiento" })} className={selectClass}>
              <option value="primera_vez">Primera vez / evaluación</option>
              <option value="seguimiento">Seguimiento</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="na-repeat">Repetir cada semana</Label>
            <select id="na-repeat" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })} className={selectClass}>
              <option value="1">No, solo este turno</option>
              {[4, 8, 12, 16].map((n) => <option key={n} value={n}>{n} semanas</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="na-reason">Nota (opcional)</Label>
          <Input id="na-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ej: Evaluación inicial" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Agendar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detalle del turno: asistencia, práctica y nota de la sesión ─────────────

function AppointmentDialog({ appt: a, professional, staff, onClose, onChanged, onOpenPatient }: {
  appt: AgendaAppointment;
  professional?: ProfessionalOption;
  staff: Staff;
  onClose: () => void;
  onChanged: () => void;
  onOpenPatient: (patientId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<{ id: string; note: string; author_email: string | null }[]>([]);
  const [note, setNote] = useState("");
  const clinical = canEditClinical(staff.role);

  useEffect(() => {
    supabase.from("patient_followups").select("id, note, author_email").eq("appointment_id", a.id)
      .then(({ data }: { data: { id: string; note: string; author_email: string | null }[] | null }) => setNotes(data ?? []));
  }, [a.id]);

  async function setAttendance(attendance: Attendance | null) {
    setBusy(true);
    const { error } = await supabase.from("appointments").update({ attendance }).eq("id", a.id);
    setBusy(false);
    if (error) { toast.error("No se pudo registrar la asistencia"); return; }
    toast.success(attendance ? ATTENDANCE_LABEL[attendance] : "Asistencia borrada");
    onChanged();
  }

  async function cancel() {
    if (!window.confirm("¿Cancelar este turno? Queda registrado en el historial.")) return;
    setBusy(true);
    const { error } = await supabase.from("appointments").update({ status: "cancelado" }).eq("id", a.id);
    setBusy(false);
    if (error) { toast.error("No se pudo cancelar"); return; }
    toast.success("Turno cancelado");
    onChanged();
    onClose();
  }

  async function saveNote() {
    if (!a.patient_id || !note.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from("patient_followups").insert({
      patient_id: a.patient_id, appointment_id: a.id, note: note.trim(), note_date: a.appointment_date,
    }).select().single();
    setBusy(false);
    if (error || !data) { toast.error("No se pudo guardar la nota"); return; }
    setNotes((prev) => [...prev, data as { id: string; note: string; author_email: string | null }]);
    setNote("");
    toast.success("Nota de la sesión guardada");
  }

  const p = a.patients;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">
            {p ? `${p.first_name} ${p.last_name}` : "Turno"}
          </DialogTitle>
          <DialogDescription className="capitalize">
            {longDate(a.appointment_date)} · {a.appointment_time.slice(0, 5)} hs · {a.duration_minutes} min
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-xs text-muted-foreground">Profesional</dt><dd className="font-medium">{professional?.name ?? "Sin asignar"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Modalidad</dt><dd className="font-medium">{a.modality === "telemedicina" ? "Telemedicina" : "Presencial"}</dd></div>
          {p && (
            <div><dt className="text-xs text-muted-foreground">Teléfono</dt>
              <dd><a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="font-semibold hover:underline"><Phone className="mr-1 inline h-3.5 w-3.5" />{p.phone}</a></dd></div>
          )}
          <div><dt className="text-xs text-muted-foreground">Tipo</dt><dd className="font-medium">{a.consultation_type === "primera_vez" ? "Primera vez" : "Seguimiento"}</dd></div>
        </dl>
        {a.reason && a.reason !== "Sesión" && <p className="rounded-lg bg-muted/50 p-2 text-sm">{a.reason}</p>}

        {a.status !== "cancelado" && (
          <div className="space-y-2">
            <div className="text-sm font-semibold">Asistencia</div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(ATTENDANCE_LABEL) as Attendance[]).map((k) => (
                <Button key={k} size="sm" variant={a.attendance === k ? "default" : "outline"} disabled={busy}
                  onClick={() => setAttendance(k)}
                  className={a.attendance === k ? "bg-primary text-primary-foreground" : ""}>
                  {ATTENDANCE_LABEL[k]}
                </Button>
              ))}
              {a.attendance && a.attendance !== "presente" && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAttendance(null)}>Borrar</Button>
              )}
            </div>
            {a.practice_number && (
              <p className="rounded-lg bg-[color:var(--status-available-bg)] px-3 py-1.5 text-xs font-semibold text-[color:var(--status-available)]">
                Práctica N° {String(a.practice_number).padStart(6, "0")} registrada
                {a.practice_registered_at && ` el ${new Date(a.practice_registered_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}`}
              </p>
            )}
          </div>
        )}

        {a.attendance === "presente" && a.patient_id && (
          <div className="space-y-2">
            <div className="text-sm font-semibold">Nota de la sesión</div>
            {notes.map((n) => (
              <p key={n.id} className="whitespace-pre-wrap rounded-lg border border-border/60 p-2 text-sm">
                {n.note}{n.author_email && <span className="block text-xs text-muted-foreground">— {n.author_email}</span>}
              </p>
            ))}
            {clinical ? (
              <>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Nota de la sesión"
                  placeholder="Qué se trabajó, cómo estuvo, próximos pasos…" />
                <div className="flex justify-end">
                  <Button size="sm" onClick={saveNote} disabled={busy || !note.trim()}
                    className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">Guardar nota</Button>
                </div>
              </>
            ) : notes.length === 0 && <p className="text-xs text-muted-foreground">La nota la escribe el profesional.</p>}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-3">
          {a.status !== "cancelado" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={cancel} className="text-[color:var(--status-occupied)]">Cancelar turno</Button>
          ) : <span className="text-sm font-semibold text-[color:var(--status-occupied)]">Turno cancelado</span>}
          {a.patient_id && (
            <Button size="sm" variant="outline" onClick={() => onOpenPatient(a.patient_id!)}>Ver ficha</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bloquear horario (imprevistos) ──────────────────────────────────────────

const BLOCK_REASONS = ["Fumigación", "Paro de transporte", "Actividad de terreno", "Feriado / asueto"];

function BlockDialog({ professionals, initialDate, onClose, onSaved }: {
  professionals: ProfessionalOption[];
  initialDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ date: initialDate, allDay: true, start: "07:00", end: "18:00", professional_id: "", reason: BLOCK_REASONS[0], other: "" });
  const [affected, setAffected] = useState<AgendaAppointment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const block: ScheduleBlock = {
    id: "preview", block_date: form.date, active: true,
    start_time: form.allDay ? null : form.start, end_time: form.allDay ? null : form.end,
    professional_id: form.professional_id || null,
    reason: form.reason === "Otro" ? form.other.trim() : form.reason,
  };

  // Turnos que caen dentro del bloqueo (para avisar a los pacientes)
  useEffect(() => {
    let cancelled = false;
    supabase.from("appointments").select(APPT_SELECT).eq("appointment_date", form.date).neq("status", "cancelado")
      .then(({ data }: { data: AgendaAppointment[] | null }) => {
        if (!cancelled) setAffected((data ?? []).filter((a) => blockAffects(block, a)));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, form.allDay, form.start, form.end, form.professional_id]);

  async function save() {
    if (!block.reason) { toast.error("Indicá el motivo"); return; }
    if (!form.allDay && form.start >= form.end) { toast.error("La hora de fin tiene que ser posterior al inicio"); return; }
    setSaving(true);
    const { error } = await supabase.from("schedule_blocks").insert({
      block_date: block.block_date, start_time: block.start_time, end_time: block.end_time,
      professional_id: block.professional_id, reason: block.reason,
    });
    setSaving(false);
    if (error) { toast.error("No se pudo guardar el bloqueo"); return; }
    toast.success("Horario bloqueado");
    setSaved(true);
    onSaved();
  }

  async function cancelAffected() {
    if (!affected?.length || !window.confirm(`¿Cancelar los ${affected.length} turnos afectados?`)) return;
    setSaving(true);
    for (const a of affected) await supabase.from("appointments").update({ status: "cancelado" }).eq("id", a.id);
    setSaving(false);
    toast.success("Turnos cancelados");
    onSaved();
    onClose();
  }

  const proName = new Map(professionals.map((p) => [p.id, p.name]));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Bloquear horario</DialogTitle>
          <DialogDescription>Para imprevistos: no se pueden dar turnos en ese horario.</DialogDescription>
        </DialogHeader>
        {!saved && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="bl-date">Fecha</Label>
                <Input id="bl-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bl-pro">Para</Label>
                <select id="bl-pro" value={form.professional_id} onChange={(e) => setForm({ ...form, professional_id: e.target.value })} className={selectClass}>
                  <option value="">Todo el centro</option>
                  {professionals.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
              Todo el día
            </label>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="bl-start">Desde</Label>
                  <Input id="bl-start" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bl-end">Hasta</Label>
                  <Input id="bl-end" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="bl-reason">Motivo</Label>
              <select id="bl-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={selectClass}>
                {[...BLOCK_REASONS, "Otro"].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {form.reason === "Otro" && (
                <Input value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} placeholder="¿Cuál?" aria-label="Otro motivo" />
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-sm font-semibold">
            {affected === null ? "Buscando turnos afectados…" : `Turnos afectados: ${affected.length}`}
          </div>
          {affected && affected.length > 0 && (
            <>
              <ul className="divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
                {affected.map((a) => (
                  <li key={a.id} className="flex flex-wrap justify-between gap-2 p-2">
                    <span><strong>{a.appointment_time.slice(0, 5)}</strong> {a.patients ? `${a.patients.last_name}, ${a.patients.first_name}` : "—"}
                      <span className="text-muted-foreground"> · {a.professional_id ? proName.get(a.professional_id) : "sin profesional"}</span></span>
                    {a.patients && <a href={`tel:${a.patients.phone.replace(/[^\d+]/g, "")}`} className="font-semibold hover:underline">{a.patients.phone}</a>}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Hay que avisarles. Si querés, después de bloquear podés cancelarlos todos juntos.</p>
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>{saved ? "Cerrar" : "Cancelar"}</Button>
          {saved ? (
            affected && affected.length > 0 && (
              <Button onClick={cancelAffected} disabled={saving} className="bg-[color:var(--status-occupied)] text-white hover:opacity-90">
                Cancelar los {affected.length} turnos
              </Button>
            )
          ) : (
            <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Bloquear
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Turnos de mañana (para los recordatorios) ───────────────────────────────

function TomorrowDialog({ professionals, professionalId, onClose }: {
  professionals: ProfessionalOption[];
  /** Con "Mis turnos": solo los del profesional del usuario */
  professionalId: string | null;
  onClose: () => void;
}) {
  const day = nextWorkday(todayKey());
  const [list, setList] = useState<AgendaAppointment[] | null>(null);
  const proName = new Map(professionals.map((p) => [p.id, p.name]));

  useEffect(() => {
    let q = supabase.from("appointments").select(APPT_SELECT).eq("appointment_date", day).neq("status", "cancelado");
    if (professionalId) q = q.eq("professional_id", professionalId);
    q.order("appointment_time").then(({ data }: { data: AgendaAppointment[] | null }) => setList(data ?? []));
  }, [day, professionalId]);

  function print() {
    if (!list) return;
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const rows = list.map((a) => `<tr><td>${a.appointment_time.slice(0, 5)}</td><td>${esc(a.patients ? `${a.patients.last_name}, ${a.patients.first_name}` : "—")}</td><td>${esc(a.patients?.phone ?? "")}${a.patients?.guardian_phone ? ` / ${esc(a.patients.guardian_phone)}` : ""}</td><td>${esc(a.professional_id ? proName.get(a.professional_id) ?? "" : "")}</td><td>${a.modality === "telemedicina" ? "Telemedicina" : "Presencial"}</td><td style="width:70px"></td></tr>`).join("");
    const w = window.open("", "_blank");
    if (!w) { toast.error("Permití las ventanas emergentes para imprimir"); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Turnos del ${formatShortDate(day)}</title>
      <style>html{color-scheme:light;background:#fff}body{font-family:system-ui,sans-serif;margin:24px;font-size:12pt;color:#1a2b3c}h1{font-size:15pt}table{border-collapse:collapse;width:100%}
      td,th{border:1px solid #ccd;padding:6px;text-align:left}th{background:#eef3f8}</style></head><body>
      <h1>CIMT — Turnos del ${esc(longDate(day))}</h1><table><tr><th>Hora</th><th>Paciente</th><th>Teléfono</th><th>Profesional</th><th>Modalidad</th><th>Avisado</th></tr>${rows}</table>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl capitalize text-[color:var(--primary-deep)]">Turnos del {longDate(day)}</DialogTitle>
          <DialogDescription>
            {professionalId ? "Tus turnos del próximo día hábil." : "Para hacer los recordatorios del día anterior."}
          </DialogDescription>
        </DialogHeader>
        {list === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No hay turnos agendados.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60 text-sm">
            {list.map((a) => (
              <li key={a.id} className="grid gap-1 p-3 sm:grid-cols-[60px_1fr_auto] sm:items-center">
                <strong>{a.appointment_time.slice(0, 5)}</strong>
                <span>
                  {a.patients ? `${a.patients.last_name}, ${a.patients.first_name}` : "—"}
                  <span className="text-muted-foreground"> · {a.professional_id ? proName.get(a.professional_id) : "sin profesional"}{a.modality === "telemedicina" ? " · telemedicina" : ""}</span>
                </span>
                {a.patients && (
                  <a href={`tel:${a.patients.phone.replace(/[^\d+]/g, "")}`} className="font-semibold hover:underline">
                    <Phone className="mr-1 inline h-3.5 w-3.5" />{a.patients.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button onClick={print} disabled={!list?.length} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            <Printer className="mr-1.5 h-4 w-4" /> Imprimir lista
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
