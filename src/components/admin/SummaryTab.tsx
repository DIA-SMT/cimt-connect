import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, BellRing, CalendarCheck, CalendarClock, CheckCircle2, ChevronDown, ClipboardList, FileText, HeartPulse,
  History, Inbox, Loader2, MailOpen, Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { fromMinutes, longDate, nextWorkday, toMinutes, type Workshop } from "@/lib/agenda";
import { type Activity, type ActivityKind, type AuditRow, dayLabel, describeActivity } from "@/lib/activity";
import { todayKey, type ProfessionalOption } from "@/lib/patients";
import { ROLE_LABEL, seesAllPatients, type Staff, type StaffRole } from "@/lib/staff";

// Pestaña «Resumen» (la primera del panel): cómo viene el día, qué hay para
// resolver, qué espera mañana y lo último que se hizo, en palabras simples.
// Cada uno ve lo suyo: la base filtra (script 34), así que un profesional ve
// su día, sus pendientes y la actividad de sus pacientes.

type Tab = "agenda" | "solicitudes" | "portal" | "pacientes";

type ApptLite = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  attendance: string | null;
  professional_id: string | null;
  reminder_sent_at: string | null;
  patients: { first_name: string; last_name: string } | null;
};
type RequestLite = { id: string; first_name: string; last_name: string; created_at: string };
type Directory = Map<string, { name: string; role: StaffRole }>;

const PAGE = 40;
// «Lo último que se hizo»: cada día es un desplegable (abierto solo el más
// nuevo) y, abierto, muestra los primeros DAY_SHOWN movimientos
const DAY_SHOWN = 5;
// "miércoles, 21 de octubre" → "Miércoles, 21 de octubre"
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const REFRESH_MS = 60_000;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const hoursSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
const waitText = (h: number) => (h < 1 ? "hace menos de una hora" : h < 48 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} días`);

export function SummaryTab({ staff, professionals, portalCounts, onOpenTab, onOpenNotices, refreshKey = 0 }: {
  staff: Staff;
  professionals: ProfessionalOption[];
  portalCounts: { hc: number; notices: number; turnos: number };
  onOpenTab: (tab: Tab) => void;
  onOpenNotices: () => void;
  /** Cambia cuando llega una solicitud nueva: recargar */
  refreshKey?: number;
}) {
  const all = seesAllPatients(staff.role);
  const today = todayKey();
  const tomorrow = nextWorkday(today);
  const proName = useMemo(() => new Map(professionals.map((p) => [p.id, p.name])), [professionals]);

  const [appts, setAppts] = useState<ApptLite[] | null>(null);
  const [requests, setRequests] = useState<RequestLite[]>([]);
  const [unregistered, setUnregistered] = useState(0);
  const [workshop, setWorkshop] = useState<Workshop | null>(null);
  const [log, setLog] = useState<AuditRow[]>([]);
  const [limit, setLimit] = useState(PAGE);
  // Días abiertos y días con todos sus movimientos a la vista (por su etiqueta).
  // null: todavía no se tocó nada (queda abierto el más nuevo)
  const [openDays, setOpenDays] = useState<Set<string> | null>(null);
  const [fullDays, setFullDays] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };
  const [moreLoading, setMoreLoading] = useState(false);
  const [names, setNames] = useState<{ patients: Map<string, string>; requests: Map<string, string>; staff: Directory }>({
    patients: new Map(), requests: new Map(), staff: new Map(),
  });

  const load = useCallback(async (max: number) => {
    const [a, r, ref, w, l, dir] = await Promise.all([
      supabase.from("appointments")
        .select("id, appointment_date, appointment_time, attendance, professional_id, reminder_sent_at, patients(first_name, last_name)")
        .gte("appointment_date", today).lte("appointment_date", tomorrow).neq("status", "cancelado").order("appointment_time"),
      supabase.from("intake_requests").select("id, first_name, last_name, created_at").eq("status", "nueva").order("created_at"),
      supabase.from("patient_referrals").select("id, status, registered, voided_at"),
      supabase.from("workshops").select("*").gte("workshop_date", today).order("workshop_date"),
      supabase.from("audit_log").select("*").order("changed_at", { ascending: false }).limit(max),
      supabase.rpc("staff_directory"),
    ]);
    const mine = (x: ApptLite) => all || x.professional_id === staff.professional_id;
    setAppts(((a.data ?? []) as ApptLite[]).filter(mine));
    setRequests((r.data ?? []) as RequestLite[]);
    setUnregistered(((ref.data ?? []) as { status: string; registered: boolean; voided_at: string | null }[])
      .filter((x) => !x.voided_at && !x.registered && x.status !== "cancelada").length);
    setWorkshop(((w.data ?? []) as Workshop[]).find((x) => !x.canceled) ?? null);
    const rows = ((l.data ?? []) as AuditRow[]).slice(0, max);
    setLog(rows);

    // Nombres para contar el historial
    const patientIds = [...new Set(rows.map((x) => x.patient_id).filter(Boolean) as string[])];
    const requestIds = [...new Set(rows.filter((x) => x.table_name === "intake_requests").map((x) => x.record_id).filter(Boolean) as string[])];
    const [p, q] = await Promise.all([
      patientIds.length ? supabase.from("patients").select("id, first_name, last_name").in("id", patientIds) : Promise.resolve({ data: [] }),
      requestIds.length ? supabase.from("intake_requests").select("id, first_name, last_name").in("id", requestIds) : Promise.resolve({ data: [] }),
    ]);
    const full = (x: { first_name: string; last_name: string }) => `${x.first_name} ${x.last_name}`.trim();
    setNames({
      patients: new Map(((p.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((x) => [x.id, full(x)])),
      requests: new Map(((q.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((x) => [x.id, full(x)])),
      staff: new Map(((dir.data ?? []) as { email: string; full_name: string | null; role: StaffRole }[])
        .map((x) => [x.email.toLowerCase(), { name: x.full_name || x.email, role: x.role }])),
    });
  }, [all, staff.professional_id, today, tomorrow]);

  useEffect(() => { void load(limit); }, [load, limit, refreshKey]);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void load(limit); };
    const timer = window.setInterval(tick, REFRESH_MS);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [load, limit]);

  if (!appts) {
    return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  // ── Hoy ──
  const todays = appts.filter((a) => a.appointment_date === today);
  const came = todays.filter((a) => a.attendance === "presente").length;
  const missed = todays.filter((a) => a.attendance === "ausente" || a.attendance === "justificado").length;
  const left = todays.length - came - missed;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const next = todays.find((a) => !a.attendance && toMinutes(a.appointment_time) >= nowMin - 10);
  const patientName = (a: ApptLite) => (a.patients ? `${a.patients.first_name} ${a.patients.last_name}` : "un paciente");
  const weekend = [0, 6].includes(new Date(`${today}T12:00:00`).getDay());
  const you = all ? "hay" : "tenés";

  // ── Mañana ──
  const tomorrows = appts.filter((a) => a.appointment_date === tomorrow);
  const notified = tomorrows.filter((a) => a.reminder_sent_at).length;
  const toNotify = tomorrows.length - notified;

  // ── Para resolver ──
  const oldest = requests[0];
  const oldestH = oldest ? hoursSince(oldest.created_at) : 0;
  const pending: { icon: typeof Inbox; tone: "rojo" | "ambar" | "azul"; text: string; action: string; go: () => void }[] = [];
  if (portalCounts.notices > 0) pending.push({
    icon: BellRing, tone: "rojo", action: "Ver avisos", go: onOpenNotices,
    text: `${plural(portalCounts.notices, "Una familia avisó", `${portalCounts.notices} familias avisaron`)} que no va${portalCounts.notices === 1 ? "" : "n"} a venir a un turno: hay que resolverlo para liberar el horario.`,
  });
  if (requests.length > 0) pending.push({
    icon: Inbox, tone: oldestH >= 48 ? "rojo" : oldestH >= 24 ? "ambar" : "azul", action: "Ver solicitudes", go: () => onOpenTab("solicitudes"),
    text: `${all ? plural(requests.length, "Hay una solicitud de turno nueva", `Hay ${requests.length} solicitudes de turno nuevas`) : plural(requests.length, "Te derivaron una solicitud nueva", `Te derivaron ${requests.length} solicitudes nuevas`)}. La más antigua espera ${waitText(oldestH)}${oldestH >= 48 ? ": ya pasaron las 48 hs del compromiso de respuesta" : ""}.`,
  });
  if (toNotify > 0) pending.push({
    icon: CalendarClock, tone: "azul", action: "Ir a la agenda", go: () => onOpenTab("agenda"),
    text: `${plural(toNotify, "Falta un recordatorio", `Faltan ${toNotify} recordatorios`)} para el ${longDate(tomorrow)} (botón «Turnos de mañana»).`,
  });
  if (portalCounts.turnos > 0) pending.push({
    icon: CalendarCheck, tone: "azul", action: "Ir al Portal", go: () => onOpenTab("portal"),
    text: `${plural(portalCounts.turnos, "Una familia pidió un turno", `${portalCounts.turnos} familias pidieron turno`)} desde el portal.`,
  });
  if (portalCounts.hc > 0) pending.push({
    icon: MailOpen, tone: "ambar", action: "Ir al Portal", go: () => onOpenTab("portal"),
    text: `${plural(portalCounts.hc, "Hay un pedido de copia del historial", `Hay ${portalCounts.hc} pedidos de copia del historial`)} por preparar.`,
  });
  if (unregistered > 0) pending.push({
    icon: FileText, tone: "azul", action: "Ir a Pacientes", go: () => onOpenTab("pacientes"),
    text: `${plural(unregistered, "Hay una derivación o interconsulta", `Hay ${unregistered} derivaciones o interconsultas`)} sin registrar.`,
  });

  // ── Historial ──
  const activity = log
    .map((row) => {
      const a = describeActivity(row, {
        patient: (id) => (id ? names.patients.get(id) ?? null : null),
        request: (id) => (id ? names.requests.get(id) ?? null : null),
        professional: (id) => (id ? proName.get(id) ?? null : null),
      });
      return a ? { row, ...a } : null;
    })
    .filter(Boolean) as ({ row: AuditRow } & Activity)[];
  const groups: { label: string; items: typeof activity }[] = [];
  for (const it of activity) {
    const label = dayLabel(it.row.changed_at, today);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(it); else groups.push({ label, items: [it] });
  }
  const actor = (row: AuditRow) => {
    if (!row.changed_by_email) return row.table_name === "intake_requests" && row.action === "insert" ? "Desde el sitio" : "El sistema";
    const s = names.staff.get(row.changed_by_email.toLowerCase());
    return s ? `${s.name} (${ROLE_LABEL[s.role]})` : row.changed_by_email;
  };

  const greeting = now.getHours() < 12 ? "Buen día" : now.getHours() < 20 ? "Buenas tardes" : "Buenas noches";
  const firstName = (staff.full_name || "").split(" ")[0];

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-6">
        {/* Hoy */}
        <section className="rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)]">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">{greeting}{firstName ? `, ${firstName}` : ""}</p>
          <h2 className="mt-1 font-display text-2xl font-extrabold text-[color:var(--primary-deep)]">{cap(longDate(today))}</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-foreground/85">
            {weekend
              ? "Hoy es fin de semana: el centro no atiende."
              : todays.length === 0
                ? `Hoy no ${all ? "hay" : "tenés"} turnos agendados.`
                : <>
                    Hoy {you} <b>{todays.length} {plural(todays.length, "turno", "turnos")}</b>
                    {came + missed > 0
                      ? <>: {came > 0 && <>{came} ya {plural(came, "vino", "vinieron")}</>}{came > 0 && missed > 0 && ", "}{missed > 0 && <>{missed} {plural(missed, "faltó", "faltaron")}</>}{left > 0 ? <> y {plural(left, "queda", "quedan")} <b>{left}</b></> : <> y no queda ninguno</>}.</>
                      : "."}
                    {next && <> El próximo es a las <b>{fromMinutes(toMinutes(next.appointment_time))}</b>: {patientName(next)}{all && next.professional_id && proName.get(next.professional_id) ? <> con {proName.get(next.professional_id)}</> : null}.</>}
                  </>}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat label={plural(came, "Vino", "Vinieron")} value={came} tone="verde" />
            <Stat label="Por atender" value={left} tone="azul" />
            <Stat label={plural(missed, "Faltó", "Faltaron")} value={missed} tone="rojo" />
          </div>
        </section>

        {/* Para resolver */}
        <section className="rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)]">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-[color:var(--primary-deep)]">
            <ClipboardList className="h-5 w-5" /> Para resolver
          </h2>
          {pending.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-[color:var(--status-available)]">
              <CheckCircle2 className="h-4 w-4" /> Nada pendiente por ahora. ¡Todo al día!
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {pending.map((p, i) => (
                <li key={i} className={`flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-2.5 ${TONE[p.tone]}`}>
                  <p.icon className="h-4 w-4 shrink-0" aria-hidden />
                  <p className="min-w-0 flex-1 text-sm text-foreground/90">{p.text}</p>
                  <Button size="sm" variant="outline" onClick={p.go} className="shrink-0 bg-background">
                    {p.action} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Mañana */}
        <section className="rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)]">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-[color:var(--primary-deep)]">
            <CalendarClock className="h-5 w-5" /> Lo que viene
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-foreground/85">
            {cap(longDate(tomorrow))}:{" "}
            {tomorrows.length === 0
              ? `no ${all ? "hay" : "tenés"} turnos agendados.`
              : <>{all ? "hay" : "tenés"} <b>{tomorrows.length} {plural(tomorrows.length, "turno", "turnos")}</b>. {toNotify === 0 ? "Ya se avisó a todos." : notified === 0 ? <>Todavía no se avisó a nadie: {plural(toNotify, "falta", "faltan")} <b>{toNotify}</b>.</> : <>Ya se avisó a {notified}; {plural(toNotify, "falta", "faltan")} <b>{toNotify}</b>.</>}</>}
          </p>
          {all && (
            <p className="mt-2 flex items-start gap-2 text-sm text-foreground/85">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                {workshop
                  ? <>Próximo taller para familias: <b>{longDate(workshop.workshop_date)}</b> a las {workshop.start_time.slice(0, 5)} hs · {workshop.place}.</>
                  : "No hay un próximo taller para familias cargado (se carga en Solicitudes)."}
              </span>
            </p>
          )}
        </section>
      </div>

      {/* Lo último que se hizo */}
      <section className="rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)]">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-[color:var(--primary-deep)]">
          <History className="h-5 w-5" /> Lo último que se hizo
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {all ? "Lo que hizo el equipo en el panel y lo que llegó desde el sitio." : "Lo que se hizo con tus pacientes."}
        </p>
        {groups.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Todavía no hay movimientos para mostrar.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {groups.map((g, gi) => {
              const open = openDays ? openDays.has(g.label) : gi === 0;
              const full = fullDays.has(g.label);
              const items = full ? g.items : g.items.slice(0, DAY_SHOWN);
              const panelId = `actividad-${gi}`;
              return (
              <div key={g.label} className="rounded-2xl border border-border/60">
                <button type="button" aria-expanded={open} aria-controls={panelId}
                  onClick={() => setOpenDays(toggle(openDays ?? new Set(groups[0] ? [groups[0].label] : []), g.label))}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-left hover:bg-[color:var(--primary-soft)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground first-letter:uppercase">{g.label}</span>
                  <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    {g.items.length} {plural(g.items.length, "movimiento", "movimientos")}
                    <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                  </span>
                </button>
                {open && (
                <div id={panelId} className="px-4 pb-3">
                <ol className="space-y-2.5 border-l-2 border-border/70 pl-4">
                  {items.map((it) => {
                    const Icon = KIND_ICON[it.kind];
                    return (
                      <li key={String(it.row.id)} className="relative text-sm">
                        <span className="absolute -left-[1.4rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card">
                          <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                        </span>
                        <span className="font-semibold tabular-nums text-muted-foreground">
                          {new Date(it.row.changed_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}
                        </span>{" · "}
                        <b className="text-[color:var(--primary-deep)]">{actor(it.row)}</b>{" "}
                        <span className="text-foreground/85">{it.text}.</span>
                      </li>
                    );
                  })}
                </ol>
                {g.items.length > DAY_SHOWN && (
                  <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-xs"
                    onClick={() => setFullDays(toggle(fullDays, g.label))}>
                    {full ? "Ver menos" : `Ver ${plural(g.items.length - DAY_SHOWN, "1 más", `los ${g.items.length - DAY_SHOWN} restantes`)}`}
                  </Button>
                )}
                </div>
                )}
              </div>
              );
            })}
            {log.length >= limit && (
              <Button variant="outline" size="sm" disabled={moreLoading}
                onClick={async () => { setMoreLoading(true); setLimit((n) => n + PAGE); setMoreLoading(false); }}>
                {moreLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />} Ver más
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

const TONE: Record<"rojo" | "ambar" | "azul", string> = {
  rojo: "border-[oklch(0.6_0.19_25)]/40 bg-[color:var(--status-occupied-bg)] text-[oklch(0.45_0.19_25)]",
  ambar: "border-amber-300 bg-amber-50 text-amber-900",
  azul: "border-primary/25 bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]",
};

const KIND_ICON: Record<ActivityKind, typeof Inbox> = {
  solicitud: Inbox, turno: CalendarCheck, asistencia: CheckCircle2, aviso: BellRing,
  ficha: Users, clinico: HeartPulse, anulado: FileText,
};

function Stat({ label, value, tone }: { label: string; value: number; tone: "verde" | "azul" | "rojo" }) {
  const cls = tone === "verde" ? "bg-[color:var(--status-available-bg)] text-[color:var(--status-available)]"
    : tone === "rojo" ? "bg-[color:var(--status-occupied-bg)] text-[oklch(0.5_0.19_25)]"
    : "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]";
  return (
    <div className={`rounded-2xl px-3 py-2 text-center ${cls}`}>
      <div className="font-display text-2xl font-extrabold tabular-nums">{value}</div>
      <div className="text-xs font-semibold">{label}</div>
    </div>
  );
}
