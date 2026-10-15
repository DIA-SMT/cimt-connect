import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass } from "../fields";
import type { ProfessionalOption } from "@/lib/patients";
import {
  AGENDA_END_MIN, AGENDA_START_MIN, type Modality, type ScheduleBlock, agendaErrorMessage, fromMinutes, toMinutes,
} from "@/lib/agenda";
import {
  type StaffApptRequest, APPT_REQ_MODALITY_LABEL, TIME_BAND_LABEL, WEEKDAYS, WEEKDAY_LABEL,
} from "@/lib/apptRequestRules";
import {
  type ConsultationType, type ScheduleAppt, type SlotSuggestion, type WorkWindows,
  SCHEDULE_HISTORY_DAYS, SCHEDULE_HORIZON_DAYS, SCHEDULE_MAX_MINUTES, SCHEDULE_MIN_MINUTES,
  bandMatches, dayMatches, isWeekendDate, patientClash, scheduleDefaults, scheduleFormError, sessionDuration,
  suggestFreeSlots, weekdayOfKey,
} from "@/lib/apptSchedule";
import { addDaysKey, centerNow } from "@/lib/portalRules";
import { APPT_REQ_STATUS_LABEL } from "@/lib/portalStaff";

// «Dar turno» → «Cargar el turno acá» (diálogo del pedido de turno en Portal →
// Pedidos de turno): el equipo carga el turno sin ir a la Agenda y, en un solo
// paso, queda en la Agenda, enlazado al pedido y el pedido agendado (la
// familia ve el día y la hora en el portal; no se le manda ningún mensaje).
//
// El turno se guarda como en la Agenda (con la sesión del equipo: la base
// revisa superposiciones y bloqueos) y después se enlaza al pedido con el
// mismo paso que «Ya está en la Agenda» (el servidor revisa que el turno sea
// de esta persona, esté en pie y no haya pasado). Si se guardó pero no se pudo
// enlazar (por ejemplo, la familia canceló el pedido o alguien más lo resolvió
// mientras tanto), el diálogo no se cierra solo: se puede cancelar ese turno,
// dejarlo así o, si el pedido sigue abierto, volver a enlazarlo.
//
// Si se cortó la respuesta, lo que se guardó se busca antes de mostrar un
// error: el turno (por el chico, el profesional, el día y la hora) y el enlace
// (cómo quedó el pedido). Un turno que ya está enlazado nunca se ofrece cancelar.
//
// Para elegir día y hora se sugieren horarios libres del profesional según su
// agenda (src/lib/apptSchedule.ts): no hay una tabla de horarios de atención.

export type LinkOutcome = { ok: true } | { ok: false; msg: string; stale: boolean };

type Props = {
  request: StaffApptRequest;
  /** El pedido todavía se puede agendar (con lo último que se cargó de la bandeja) */
  allowed: boolean;
  /** Enlaza el turno al pedido y lo marca agendado (el aviso de "listo" lo da la bandeja) */
  onLink: (appointmentId: string) => Promise<LinkOutcome>;
  /** Vuelve a cargar la bandeja y devuelve cómo quedó el pedido (null: no se pudo saber) */
  onCheck: () => Promise<StaffApptRequest | null>;
  /** Quedó enlazado aunque no llegó la respuesta: el aviso de "listo" (como al
      enlazarlo) y cerrar el diálogo. fresh: el pedido como quedó */
  onLinked: (fresh: StaffApptRequest) => void;
  /** Terminó (con o sin turno): cerrar el diálogo y actualizar la bandeja */
  onDone: () => void;
  onCancel: () => void;
  /** Hay algo en curso o un turno sin enlazar: el diálogo no se puede cerrar */
  onLockChange: (locked: boolean) => void;
};

// Turno que quedó en la Agenda sin enlazar al pedido. stale: el pedido cambió
// mientras tanto (la bandeja ya se actualizó: se dice cómo quedó)
type Orphan = { id: string; date: string; time: string; msg: string; stale: boolean };
// De dónde salió el profesional que se propone
type Suggested = { id: string; from: "ficha" | "turno" };

const PRO_COLS = "id, name, specialty, license, active, session_minutes";
const APPT_COLS = "id, professional_id, appointment_date, appointment_time, duration_minutes, status";
const TEXT_WARN = "text-[oklch(0.45_0.11_70)]";
const TEXT_BAD = "text-[oklch(0.5_0.19_25)]";
const PRIMARY_BTN = "bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]";
const OFFLINE = "No pudimos conectar.";

// El pedido ya quedó agendado con ese turno (aunque no haya llegado la respuesta)
const linkedTo = (req: StaffApptRequest, appointmentId: string) =>
  req.status === "agendado" && req.appointment?.id === appointmentId;

// "Jue 15/10 · 14:00" (el botón), "Jueves 15/10 a las 14:00" (después, para
// lectores de pantalla) y "jueves 15/10, 14:00" (dentro de una frase)
function slotText(s: { date: string; time: string }): { short: string; long: string; inline: string } {
  const w = weekdayOfKey(s.date);
  const day = w ? WEEKDAY_LABEL[w] : "";
  const ddmm = `${s.date.slice(8, 10)}/${s.date.slice(5, 7)}`;
  return {
    short: `${day.slice(0, 3)} ${ddmm} · ${s.time}`,
    long: `${day} ${ddmm} a las ${s.time}`,
    inline: `${day.toLowerCase()} ${ddmm}, ${s.time}`.trim(),
  };
}

// "lunes de 08:00 a 12:00, jueves de 14:00 a 18:00"
function windowsText(windows: WorkWindows): string {
  return WEEKDAYS.filter((d) => windows[d])
    .map((d) => `${WEEKDAY_LABEL[d].toLowerCase()} de ${fromMinutes(windows[d]!.start)} a ${fromMinutes(windows[d]!.end)}`)
    .join(", ");
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function PortalApptSchedule({ request: r, allowed, onLink, onCheck, onLinked, onDone, onCancel, onLockChange }: Props) {
  const id = useId();
  const [defaults] = useState(() => scheduleDefaults(r));
  const [pros, setPros] = useState<ProfessionalOption[] | null>(null);
  const [prosError, setProsError] = useState(false);
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  // Los próximos turnos del chico (con cualquier profesional): no se pisan
  const [patientAppts, setPatientAppts] = useState<ScheduleAppt[]>([]);
  const [professionalId, setProfessionalId] = useState("");
  const proTouched = useRef(false); // ya eligió uno a mano: no se le cambia
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(String(defaults.duration));
  const [modality, setModality] = useState<Modality>(defaults.modality);
  const [consultationType, setConsultationType] = useState<ConsultationType>(defaults.consultation_type);
  const [reason, setReason] = useState(defaults.reason);
  // Turnos del profesional elegido (de 8 semanas atrás a 3 adelante), para sugerir horarios
  const [agenda, setAgenda] = useState<{ proId: string; appts: ScheduleAppt[] } | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [agendaError, setAgendaError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [orphan, setOrphan] = useState<Orphan | null>(null);
  const [orphanBusy, setOrphanBusy] = useState<"cancel" | "retry" | null>(null);
  const [orphanError, setOrphanError] = useState<string | null>(null);
  // Ya se avisó que quedó enlazado y se cerró (no se repite)
  const finished = useRef(false);

  const locked = busy || !!orphan || !!orphanBusy;
  useEffect(() => { onLockChange(locked); }, [locked, onLockChange]);
  useEffect(() => () => onLockChange(false), [onLockChange]);

  const activePros = useMemo(() => (pros ?? []).filter((p) => p.active !== false), [pros]);
  const pro = activePros.find((p) => p.id === professionalId);

  // Bloqueos de hoy a 3 semanas (de todos los profesionales: los hay de todo el centro)
  const loadBlocks = useCallback(async () => {
    const today = centerNow().date;
    const { data, error: bErr } = await supabase.from("schedule_blocks").select("*").eq("active", true)
      .gte("block_date", today).lte("block_date", addDaysKey(today, SCHEDULE_HORIZON_DAYS));
    if (!bErr) setBlocks((data ?? []) as ScheduleBlock[]);
  }, []);

  // Sus turnos de hoy en adelante (sin tope: también para un día elegido a mano)
  const loadPatientAppts = useCallback(async () => {
    const { data, error: pErr } = await supabase.from("appointments").select(APPT_COLS)
      .eq("patient_id", r.patient_id).neq("status", "cancelado").gte("appointment_date", centerNow().date);
    if (!pErr) setPatientAppts((data ?? []) as ScheduleAppt[]);
  }, [r.patient_id]);

  // Profesionales activos y a quién se propone: el profesional a cargo de la
  // ficha o, si no tiene, el de su próximo turno (si no, se elige a mano)
  const loadPros = useCallback(async () => {
    setProsError(false);
    const today = centerNow().date;
    const [p, pat, next] = await Promise.all([
      supabase.from("professionals").select(PRO_COLS).order("name", { ascending: true }),
      supabase.from("patients").select("id, professional_id").eq("id", r.patient_id),
      supabase.from("appointments").select("professional_id, appointment_date, appointment_time, status")
        .eq("patient_id", r.patient_id).neq("status", "cancelado").gte("appointment_date", today)
        .order("appointment_date", { ascending: true }).order("appointment_time", { ascending: true }).limit(5),
    ]);
    if (p.error) { setProsError(true); return; }
    const list = (p.data ?? []) as ProfessionalOption[];
    const active = (x: unknown): x is string => typeof x === "string" && list.some((q) => q.id === x && q.active !== false);
    const fromFicha = ((pat.data ?? []) as { professional_id: string | null }[])[0]?.professional_id;
    const fromNext = ((next.data ?? []) as { professional_id: string | null }[]).find((a) => a.professional_id)?.professional_id;
    const pick: Suggested | null = active(fromFicha) ? { id: fromFicha, from: "ficha" }
      : active(fromNext) ? { id: fromNext, from: "turno" } : null;
    setPros(list);
    setSuggested(pick);
    if (pick && !proTouched.current) {
      setProfessionalId(pick.id);
      setDuration(String(sessionDuration(list.find((q) => q.id === pick.id)?.session_minutes)));
    }
  }, [r.patient_id]);

  useEffect(() => {
    void loadPros();
    void loadBlocks();
    void loadPatientAppts();
  }, [loadPros, loadBlocks, loadPatientAppts]);

  const agendaSeq = useRef(0);
  const loadAgenda = useCallback(async (proId: string) => {
    const n = ++agendaSeq.current;
    setAgendaLoading(true);
    setAgendaError(false);
    const today = centerNow().date;
    const { data, error: aErr } = await supabase.from("appointments").select(APPT_COLS)
      .eq("professional_id", proId).neq("status", "cancelado")
      .gte("appointment_date", addDaysKey(today, -SCHEDULE_HISTORY_DAYS))
      .lte("appointment_date", addDaysKey(today, SCHEDULE_HORIZON_DAYS))
      .order("appointment_date", { ascending: true });
    // Si mientras tanto se eligió otro profesional, vale esa carga
    if (agendaSeq.current !== n) return;
    setAgendaLoading(false);
    if (aErr) { setAgendaError(true); setAgenda(null); return; }
    setAgenda({ proId, appts: (data ?? []) as ScheduleAppt[] });
  }, []);

  useEffect(() => {
    if (professionalId) { void loadAgenda(professionalId); return; }
    agendaSeq.current++;
    setAgenda(null);
    setAgendaLoading(false);
    setAgendaError(false);
  }, [professionalId, loadAgenda]);

  function changeProfessional(next: string) {
    proTouched.current = true;
    setProfessionalId(next);
    setDuration(String(sessionDuration(activePros.find((x) => x.id === next)?.session_minutes)));
    setError(null);
  }

  // Hora del centro, en cada render (al elegir, al cargar)
  const now = centerNow();
  const nowMin = toMinutes(now.time);
  const durationNum = Number(duration);
  const durationOk = Number.isInteger(durationNum) && durationNum >= SCHEDULE_MIN_MINUTES && durationNum <= SCHEDULE_MAX_MINUTES;
  const suggest = useMemo(() => {
    if (!agenda || agenda.proId !== professionalId || !durationOk) return null;
    return suggestFreeSlots({
      days: r.days, band: r.band, professionalId, duration: durationNum,
      appointments: agenda.appts, patientAppointments: patientAppts, blocks, today: now.date, nowMinutes: nowMin,
    });
  }, [agenda, professionalId, durationOk, durationNum, r.days, r.band, patientAppts, blocks, now.date, nowMin]);

  // Un horario sugerido completa fecha y hora (el foco queda en el botón)
  function pick(s: SlotSuggestion) {
    setDate(s.date);
    setTime(s.time);
    setError(null);
  }

  // Avisos (no frenan): fuera de los días, del horario o de la modalidad que pidió la familia
  const warnings: string[] = [];
  if (date && isWeekendDate(date)) warnings.push("Es fin de semana: el centro atiende de lunes a viernes.");
  else if (weekdayOfKey(date) && !dayMatches(date, r.days)) warnings.push("No es uno de los días que pidió la familia.");
  if (time && durationOk && r.band !== "indistinto" && !bandMatches(time, durationNum, r.band)) {
    warnings.push(`Queda fuera del horario que pidió la familia: ${lowerFirst(TIME_BAND_LABEL[r.band])}.`);
  }
  if (r.modality !== "indistinto" && modality !== r.modality) {
    warnings.push(`No es la modalidad que pidió la familia: ${lowerFirst(APPT_REQ_MODALITY_LABEL[r.modality])}.`);
  }
  // Otro turno del chico a esa hora (con cualquier profesional: la base solo frena los del mismo)
  const clash = date && time && durationOk ? patientClash(date, time, durationNum, patientAppts) : null;
  if (clash) {
    const who = (pros ?? []).find((p) => p.id === clash.professional_id)?.name;
    warnings.push(`Ya tiene otro turno a esa hora (${String(clash.appointment_time).slice(0, 5)}${who ? `, con ${who}` : ""}).`);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current || orphan) return;
    // Con lo último que se cargó de la bandeja: si el pedido ya no se puede
    // agendar (lo resolvió otra persona o lo canceló la familia), no se carga nada
    if (!allowed || r.requester_blocked) { setError("El pedido cambió mientras tanto: actualizá la bandeja."); return; }
    const clock = centerNow();
    const invalid = scheduleFormError({ professionalId, date, time, duration: durationNum }, clock.date, toMinutes(clock.time));
    if (invalid) { setError(invalid); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let created: string | null = null;
    try {
      const { data, error: iErr } = await supabase.from("appointments").insert({
        patient_id: r.patient_id,
        professional_id: professionalId,
        appointment_date: date,
        appointment_time: time,
        duration_minutes: durationNum,
        modality,
        consultation_type: consultationType,
        reason: reason.trim() || "Sesión",
        status: "confirmado",
      }).select("id").single();
      created = data?.id ? String(data.id) : null;
      if (!created) {
        // Un bloqueo es un «no» de la base. Si no, pudo haberse guardado igual
        // (se cortó la respuesta) o ser el reintento de uno así, que choca
        // consigo mismo: se busca antes de pedir que pruebe de nuevo
        const code = iErr?.message?.split(":")[0];
        const found = code === "BLOCKED" ? null : await findSaved();
        if (found === undefined && code !== "OVERLAP") {
          setError("No pudimos ver si el turno se guardó: revisalo en la Agenda antes de probar de nuevo.");
          return;
        }
        if (!found) {
          // Superposición o bloqueo: el mensaje de la base. Las sugerencias se
          // vuelven a cargar (la agenda cambió)
          setError(agendaErrorMessage(iErr?.message));
          void loadAgenda(professionalId);
          void loadBlocks();
          void loadPatientAppts();
          return;
        }
        created = found;
      }
      const res = await onLink(created);
      if (res.ok) { onDone(); return; }
      await toOrphan({ id: created, date, time, msg: res.msg, stale: res.stale });
    } catch {
      if (created) await toOrphan({ id: created, date, time, msg: OFFLINE, stale: false });
      else setError("No se pudo guardar el turno. Probá de nuevo.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // El turno de este chico, con este profesional, ese día y a esa hora (sin
  // cancelar), si ya está en la Agenda. undefined: no se pudo buscar
  async function findSaved(): Promise<string | null | undefined> {
    const { data, error: fErr } = await supabase.from("appointments").select("id")
      .eq("patient_id", r.patient_id).eq("professional_id", professionalId)
      .eq("appointment_date", date).eq("appointment_time", time)
      .neq("status", "cancelado").limit(1);
    if (fErr) return undefined;
    const hit = ((data ?? []) as { id: string }[])[0];
    return hit ? String(hit.id) : null;
  }

  // Quedó enlazado aunque no llegó la respuesta: es un turno dado, no suelto
  function finishLinked(fresh: StaffApptRequest) {
    if (finished.current) return;
    finished.current = true;
    setOrphan(null);
    onLinked(fresh);
  }

  // No se pudo enlazar. Salvo que el pedido haya cambiado (409: la bandeja ya
  // se actualizó), pudo haberse guardado igual: se mira cómo quedó el pedido
  // antes de preguntar qué hacer con el turno
  async function toOrphan(o: Orphan) {
    if (!o.stale) {
      const fresh = await onCheck().catch(() => null);
      if (fresh && linkedTo(fresh, o.id)) { finishLinked(fresh); return; }
    }
    setOrphan(o);
  }

  // Si al actualizar la bandeja el pedido ya está enlazado a este turno, tampoco es un turno suelto
  useEffect(() => {
    if (!orphan || orphanBusy || finished.current || !linkedTo(r, orphan.id)) return;
    finished.current = true;
    setOrphan(null);
    onLinked(r);
  }, [orphan, orphanBusy, r, onLinked]);

  // El turno quedó en la Agenda sin enlazar: cancelarlo. Antes se mira cómo
  // quedó el pedido: si está enlazado a este turno, no se cancela
  async function cancelOrphan() {
    if (!orphan || orphanBusy) return;
    setOrphanBusy("cancel");
    setOrphanError(null);
    const fresh = await onCheck().catch(() => null);
    if (!fresh) { setOrphanBusy(null); setOrphanError("No pudimos ver cómo quedó el pedido. Probá de nuevo."); return; }
    if (linkedTo(fresh, orphan.id)) { setOrphanBusy(null); finishLinked(fresh); return; }
    const { error: uErr } = await supabase.from("appointments").update({ status: "cancelado" }).eq("id", orphan.id);
    setOrphanBusy(null);
    if (uErr) { setOrphanError("No se pudo cancelar el turno. Probá de nuevo o cancelalo desde la Agenda."); return; }
    toast.success("Turno cancelado. La familia lo ve como cancelado en el portal; el pedido no cambió.");
    setOrphan(null);
    onDone();
  }

  // Volver a enlazarlo (si el pedido sigue abierto: por ejemplo, falló la conexión)
  async function retryLink() {
    if (!orphan || orphanBusy) return;
    setOrphanBusy("retry");
    setOrphanError(null);
    const res = await onLink(orphan.id).catch((): LinkOutcome => ({ ok: false, msg: OFFLINE, stale: false }));
    if (res.ok) { setOrphanBusy(null); setOrphan(null); onDone(); return; }
    // Pudo haberse enlazado igual (se cortó la respuesta)
    const fresh = res.stale ? null : await onCheck().catch(() => null);
    setOrphanBusy(null);
    if (fresh && linkedTo(fresh, orphan.id)) { finishLinked(fresh); return; }
    setOrphan({ ...orphan, msg: res.msg, stale: res.stale });
  }

  function keepOrphan() {
    if (!orphan || orphanBusy) return;
    toast("El turno quedó en la Agenda, sin enlazar al pedido. La familia lo ve en sus turnos del portal.");
    setOrphan(null);
    onDone();
  }

  if (orphan) {
    // Ya enlazado (lo cierra el efecto de arriba): no se ofrece cancelarlo
    if (linkedTo(r, orphan.id)) return null;
    // Si el pedido cambió, la bandeja ya se actualizó: se dice cómo quedó
    const why = !allowed
      ? `el pedido cambió mientras tanto (ahora está «${APPT_REQ_STATUS_LABEL[r.status]}»).`
      : lowerFirst(orphan.msg);
    return (
      <div className="space-y-3">
        <div role="alert" className="space-y-2 rounded-xl bg-[color:var(--status-pending-bg)] p-3 text-sm">
          <p className={`flex gap-2 font-semibold ${TEXT_WARN}`}>
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              El turno quedó cargado en la Agenda ({slotText(orphan).inline}) pero no se pudo enlazar: {why}
            </span>
          </p>
          <p className="text-foreground/80">
            La familia igual lo ve en sus turnos del portal (no en el pedido). Si lo cancelás, lo ve como cancelado por el
            centro. ¿Qué hacemos con ese turno?
          </p>
        </div>
        {orphanError && <p role="alert" className={`text-sm ${TEXT_BAD}`}>{orphanError}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-3">
          {allowed && (
            <Button type="button" variant="outline" disabled={!!orphanBusy} aria-busy={orphanBusy === "retry"} onClick={retryLink}>
              {orphanBusy === "retry" ? <Loader2 className="mr-1.5 animate-spin" /> : <RefreshCw className="mr-1.5" />}
              Volver a enlazarlo
            </Button>
          )}
          <Button type="button" variant="ghost" disabled={!!orphanBusy} onClick={keepOrphan}>Dejarlo así</Button>
          <Button type="button" variant="destructive" disabled={!!orphanBusy} aria-busy={orphanBusy === "cancel"} onClick={cancelOrphan}>
            {orphanBusy === "cancel" && <Loader2 className="mr-1.5 animate-spin" />}
            Cancelar ese turno
          </Button>
        </div>
      </div>
    );
  }

  const formOff = !allowed || r.requester_blocked || busy;
  const ids = {
    pro: `${id}-pro`, proHint: `${id}-pro-hint`, slots: `${id}-slots`, date: `${id}-date`, time: `${id}-time`,
    dur: `${id}-dur`, mod: `${id}-mod`, type: `${id}-type`, reason: `${id}-reason`,
  };
  const proHint = !professionalId
    ? "Elegí quién lo atiende."
    : suggested?.id === professionalId
      ? suggested.from === "ficha" ? "Profesional a cargo según la ficha." : "Es quien lo atiende en su próximo turno."
      : null;
  const free = windowsText(suggest?.windows ?? {});

  return (
    // noValidate: los mensajes son los de acá (en castellano), no los del navegador
    <form onSubmit={save} noValidate className="space-y-4" aria-busy={busy}>
      <p className="flex gap-2 text-sm">
        <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        Queda en la Agenda y enlazado al pedido: la familia ve el día y la hora en el portal (no le llega ningún mensaje).
      </p>

      {prosError ? (
        <div role="alert" className={`text-sm ${TEXT_BAD}`}>
          No se pudo cargar la lista de profesionales.{" "}
          <Button type="button" size="sm" variant="link" className="h-auto p-0" onClick={() => void loadPros()}>Probar de nuevo</Button>
        </div>
      ) : !pros ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando profesionales…
        </p>
      ) : (
        <fieldset disabled={formOff} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Turno que se da</legend>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={ids.pro}>Profesional</Label>
            <select id={ids.pro} value={professionalId} onChange={(e) => changeProfessional(e.target.value)}
              className={selectClass} aria-describedby={proHint ? ids.proHint : undefined}>
              <option value="" disabled>Elegí el profesional</option>
              {activePros.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>)}
            </select>
            {proHint && <p id={ids.proHint} className="text-xs text-muted-foreground">{proHint}</p>}
          </div>

          {professionalId && (
            <div className="space-y-1.5 sm:col-span-2">
              <p id={ids.slots} className="text-sm font-semibold">Horarios libres de {pro?.name ?? "este profesional"}</p>
              {agendaLoading ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Buscando horarios libres…
                </p>
              ) : agendaError ? (
                <p className="text-xs text-muted-foreground">
                  No se pudieron buscar horarios libres: elegí día y hora a mano.{" "}
                  <Button type="button" size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => void loadAgenda(professionalId)}>
                    Probar de nuevo
                  </Button>
                </p>
              ) : !durationOk ? (
                <p className="text-xs text-muted-foreground">Revisá la duración para ver los horarios libres.</p>
              ) : suggest?.reason === "no_history" ? (
                <p className="text-xs text-muted-foreground">No sabemos qué días atiende: elegí día y hora a mano.</p>
              ) : suggest?.reason === "no_free" ? (
                <p className="text-xs text-muted-foreground">
                  No encontramos horarios libres en los días y el horario que pidió la familia (próximas 3 semanas): elegí día y hora a mano.
                  {free && ` Según su agenda, atiende ${free}.`}
                </p>
              ) : suggest ? (
                <>
                  <div role="group" aria-labelledby={ids.slots} className="flex flex-wrap gap-1.5">
                    {suggest.slots.map((s) => {
                      const label = slotText(s);
                      const active = s.date === date && s.time === time;
                      return (
                        <button key={`${s.date} ${s.time}`} type="button" onClick={() => pick(s)} aria-pressed={active}
                          className={[
                            "rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border/60 bg-muted text-foreground hover:bg-[color:var(--primary-soft)]",
                          ].join(" ")}>
                          {/* El nombre empieza con lo que se ve (para quien lo elige por voz) */}
                          {label.short}<span className="sr-only"> ({label.long})</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    En los días y el horario que pidió la familia, cuando suele atender. Tocá uno para usarlo.
                  </p>
                </>
              ) : null}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={ids.date}>Fecha</Label>
            <Input id={ids.date} type="date" min={now.date} value={date}
              onChange={(e) => { setDate(e.target.value); setError(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.time}>Hora</Label>
            <Input id={ids.time} type="time" step={300} min={fromMinutes(AGENDA_START_MIN)} max={fromMinutes(AGENDA_END_MIN)} value={time}
              onChange={(e) => { setTime(e.target.value.slice(0, 5)); setError(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.dur}>Duración (min)</Label>
            <Input id={ids.dur} type="number" inputMode="numeric" min={SCHEDULE_MIN_MINUTES} max={SCHEDULE_MAX_MINUTES} step={5}
              value={duration} onChange={(e) => { setDuration(e.target.value); setError(null); }} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.mod}>Modalidad</Label>
            <select id={ids.mod} value={modality} onChange={(e) => setModality(e.target.value as Modality)} className={selectClass}>
              <option value="presencial">Presencial</option>
              <option value="telemedicina">Telemedicina</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.type}>Tipo de consulta</Label>
            <select id={ids.type} value={consultationType} onChange={(e) => setConsultationType(e.target.value as ConsultationType)}
              className={selectClass}>
              <option value="primera_vez">Primera vez / evaluación</option>
              <option value="seguimiento">Seguimiento</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.reason}>Motivo</Label>
            <Input id={ids.reason} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: Seguir con el tratamiento" />
          </div>
        </fieldset>
      )}

      {/* Siempre en la página (si no, los lectores de pantalla no leen lo que
          aparece); vacía, no suma espacio */}
      <div aria-live="polite" className="space-y-1 empty:-mt-4">
        {warnings.map((w) => (
          <p key={w} className={`flex items-center gap-1.5 text-xs font-semibold ${TEXT_WARN}`}>
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> {w}
          </p>
        ))}
      </div>

      {error && <p role="alert" className={`text-sm ${TEXT_BAD}`}>{error}</p>}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-3">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Volver</Button>
        <Button type="submit" disabled={formOff || !pros} aria-busy={busy} className={PRIMARY_BTN}>
          {busy && <Loader2 className="mr-1.5 animate-spin" />}
          Dar el turno
        </Button>
      </div>
    </form>
  );
}
