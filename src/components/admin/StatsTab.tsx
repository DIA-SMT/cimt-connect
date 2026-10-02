import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRightLeft, CalendarCheck, ClipboardX, Copy, Download, FileText, Hourglass, Inbox, Loader2, Smile, UserPlus, Users, UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatShortDate, todayKey, type ProfessionalOption } from "@/lib/patients";
import {
  computeStats, fmt1, weekOf,
  type Range, type Row, type Stats, type StatsData, type StatAppt, type StatIntake, type StatPatient,
  type StatReferral, type StatSurvey, type StatWorkshop,
} from "@/lib/stats";
import { exportStatsCsv, printWeeklyReport } from "./weeklyReport";

// Estadísticas para reportar (relevamiento 38–39). "Situación actual" no
// depende del período; el resto cuenta solo lo que pasó dentro del período.
// El informe semanal para la Gerencia de Datos usa el mismo cálculo.

type Period = "semana" | "semana_pasada" | "mes" | "3m" | "anio" | "12m" | "todo";
const PERIOD_LABEL: Record<Period, string> = {
  semana: "Esta semana",
  semana_pasada: "Semana pasada",
  mes: "Este mes",
  "3m": "Últimos 3 meses",
  anio: "Este año",
  "12m": "Últimos 12 meses",
  todo: "Todo",
};

const BAR_COLOR = "hsl(200 78% 42%)";
const GRID = "hsl(215 20% 92%)";
const TICK = { fontSize: 11, fill: "hsl(215 16% 45%)" };

export function StatsTab({ professionals }: { professionals: ProfessionalOption[] }) {
  const [data, setData] = useState<Omit<StatsData, "professionals"> | null>(null);
  const [period, setPeriod] = useState<Period>("mes");
  const [weekly, setWeekly] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("patients").select("id, created_at, locality, patient_type, case_status, has_health_insurance, therapy_modes, other_conditions, age"),
      supabase.from("patient_referrals").select("specialty, status, registered, referral_date, voided_at"),
      supabase.from("appointments").select("patient_id, professional_id, appointment_date, status, modality, attendance"),
      supabase.from("intake_requests").select("created_at, status, workshop_id, workshop_attended, patient_id"),
      supabase.from("workshops").select("id, workshop_date, canceled"),
      supabase.from("satisfaction_surveys").select("*"),
    ]).then(([p, r, a, i, w, s]) => {
      if ([p, r, a, i, w, s].some((x) => x.error)) toast.error("No se pudieron cargar todas las estadísticas");
      setData({
        patients: (p.data ?? []) as StatPatient[],
        referrals: (r.data ?? []) as StatReferral[],
        appts: (a.data ?? []) as StatAppt[],
        intake: (i.data ?? []) as StatIntake[],
        workshops: (w.data ?? []) as StatWorkshop[],
        surveys: (s.data ?? []) as StatSurvey[],
      });
    });
  }, []);

  const stats = useMemo(
    () => (data ? computeStats({ ...data, professionals }, periodRange(period)) : null),
    [data, professionals, period],
  );

  if (!data || !stats) {
    return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  const s = stats;
  return (
    <div className="mt-6 space-y-8">
      {/* Situación actual */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-[color:var(--primary-deep)]">Situación actual</h2>
          <Button onClick={() => setWeekly(true)} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            <FileText className="mr-1.5 h-4 w-4" /> Informe semanal
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={Users} label="Pacientes registrados" value={s.current.total} />
          <Tile icon={Users} label="Activos" value={s.current.active} sub="En evaluación o en tratamiento" />
          <Tile icon={ArrowRightLeft} label="Derivaciones pendientes" value={s.current.pendingReferrals} />
          <Tile icon={ClipboardX} label="Sin registrar" value={s.current.unregistered} sub="Derivaciones / interconsultas" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <HBarCard title="Pacientes por estado del caso" data={s.current.byStatus} />
          <HBarCard title="Pacientes por tipo de terapia" data={s.current.byTherapy} note="Un paciente puede estar en más de una." />
        </div>
      </section>

      {/* Período */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-[color:var(--primary-deep)]">En el período</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={[
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  period === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
                ].join(" ")}>
                {PERIOD_LABEL[p]}
              </button>
            ))}
            <Button size="sm" variant="outline" className="ml-1" onClick={() => exportStatsCsv(s, PERIOD_LABEL[period])}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Excel
            </Button>
          </div>
        </div>
        {s.range.start && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Del {formatShortDate(s.range.start)} al {formatShortDate(s.range.end ?? todayKey())}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={UserPlus} label="Ingresos" value={s.admissions.count} sub="Pacientes nuevos" />
          <Tile icon={Inbox} label="Solicitudes" value={s.intake.received} sub="Recibidas desde el sitio" />
          <Tile icon={CalendarCheck} label="Prácticas" value={s.attention.practices}
            sub={`${s.attention.scheduled} turnos · ${s.attention.telemed} telemedicina`} />
          <Tile icon={UserX} label="Ausentismo" value={s.attention.absenteeism === null ? "—" : `${s.attention.absenteeism}%`}
            sub={`${s.attention.absent} ausentes · ${s.attention.justified} justificados`} />
          <Tile icon={ArrowRightLeft} label="Derivaciones" value={s.referrals.count} sub={`${s.referrals.registered} registradas`} />
          <Tile icon={Hourglass} label="Tiempo de espera" value={s.intake.waitMedian === null ? "—" : `${fmt1(s.intake.waitMedian)} d`}
            sub={s.intake.waitCount ? `Mediana de ${s.intake.waitCount} · solicitud → 1ª sesión` : "Solicitud → primera sesión"} />
          <Tile icon={Smile} label="Satisfacción" value={s.satisfaction.overall === null ? "—" : `${fmt1(s.satisfaction.overall)} / 5`}
            sub={`${s.satisfaction.count} encuesta${s.satisfaction.count === 1 ? "" : "s"}`} />
          <Tile icon={Users} label="Talleres" value={s.intake.workshops}
            sub={`${s.intake.workshopAttended} de ${s.intake.workshopEnrolled} familias asistieron`} />
        </div>

        {/* Atención por profesional */}
        <Card title="Atención por profesional" note="Prácticas = turnos marcados como presentes.">
          {s.attention.byProfessional.length === 0 ? <Empty /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-1.5 pr-3">Profesional</th><th className="px-2 text-right">Turnos</th><th className="px-2 text-right">Prácticas</th>
                    <th className="px-2 text-right">Ausentes</th><th className="px-2 text-right">Justif.</th><th className="pl-2 text-right">Asistencia</th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {s.attention.byProfessional.map((r) => (
                    <tr key={r.name}>
                      <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                      <td className="px-2 text-right tabular-nums">{r.scheduled}</td>
                      <td className="px-2 text-right tabular-nums">{r.present}</td>
                      <td className="px-2 text-right tabular-nums">{r.absent}</td>
                      <td className="px-2 text-right tabular-nums">{r.justified}</td>
                      <td className="pl-2 text-right tabular-nums">{r.present + r.absent ? `${Math.round((r.present / (r.present + r.absent)) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Ingresos por mes">
          {s.admissions.byMonth.every((m) => m.value === 0) ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={s.admissions.byMonth} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<StatTooltip unit="ingresos" />} cursor={{ fill: "hsl(200 78% 42% / 0.06)" }} />
                <Bar dataKey="value" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <HBarCard title="Ingresos por localidad" data={s.admissions.byLocality} />
          <HBarCard title="Ingresos por edad" data={s.admissions.byAge} />
          <HBarCard title="Condiciones asociadas (ingresos)" data={s.admissions.byCondition} />
          <HBarCard title="Ingresos por obra social" data={s.admissions.byInsurance} />
          <HBarCard title="Solicitudes por estado" data={s.intake.byStatus} unit="solicitudes" />
          <HBarCard title="Derivaciones por especialidad" data={s.referrals.bySpecialty} unit="derivaciones" />
        </div>

        <SatisfactionCard stats={s} />
      </section>

      {weekly && <WeeklyDialog data={{ ...data, professionals }} onClose={() => setWeekly(false)} />}
    </div>
  );
}

function periodRange(p: Period): Range {
  const today = todayKey();
  const now = new Date();
  const first = (monthsBack: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };
  if (p === "semana") return weekOf(today);
  if (p === "semana_pasada") {
    const last = new Date(now); last.setDate(now.getDate() - 7);
    return weekOf(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`);
  }
  if (p === "mes") return { start: first(0), end: null };
  if (p === "3m") return { start: first(2), end: null };
  if (p === "12m") return { start: first(11), end: null };
  if (p === "anio") return { start: `${now.getFullYear()}-01-01`, end: null };
  return { start: null, end: null };
}

// ─── Satisfacción ────────────────────────────────────────────────────────────

function SatisfactionCard({ stats: s }: { stats: Stats }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/encuesta` : "/encuesta";
  const items: [string, number | null][] = [
    ["Calidad de la atención", s.satisfaction.attention],
    ["Claridad de las explicaciones", s.satisfaction.communication],
    ["Trato del equipo", s.satisfaction.treatment],
    ["Satisfacción general", s.satisfaction.overall],
  ];
  return (
    <Card title="Satisfacción (encuesta anónima)" note="Promedios de 1 a 5 de las encuestas respondidas en el período.">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-3">
          {s.satisfaction.count === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay encuestas en este período.</p>
          ) : (
            <>
              {items.map(([label, v]) => (
                <div key={label}>
                  <div className="flex justify-between text-sm"><span>{label}</span><strong className="tabular-nums">{fmt1(v)}</strong></div>
                  <div className="mt-1 h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full" style={{ width: `${((v ?? 0) / 5) * 100}%`, backgroundColor: BAR_COLOR }} />
                  </div>
                </div>
              ))}
              <p className="text-sm"><strong>{s.satisfaction.recommend}%</strong> recomendaría el CIMT.</p>
            </>
          )}
          <div className="rounded-xl bg-[color:var(--primary-soft)] p-3 text-sm">
            <div className="font-semibold text-[color:var(--primary-deep)]">Link para compartir la encuesta</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="truncate rounded bg-background px-2 py-1 text-xs">{url}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(url); toast.success("Link copiado"); }}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copiar
              </Button>
            </div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold">Comentarios recientes</div>
          {s.satisfaction.comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin comentarios.</p>
          ) : (
            <ul className="space-y-2">
              {s.satisfaction.comments.map((c, i) => (
                <li key={i} className="rounded-xl border border-border/60 p-2.5 text-sm">
                  <p className="whitespace-pre-wrap">“{c.text}”</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatShortDate(c.date)} · {c.respondent}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Informe semanal ─────────────────────────────────────────────────────────

function WeeklyDialog({ data, onClose }: { data: StatsData; onClose: () => void }) {
  const [day, setDay] = useState(() => {
    // Por defecto, la semana pasada (la que se reporta)
    const d = new Date(); d.setDate(d.getDate() - 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const week = weekOf(day);
  const stats = useMemo(() => computeStats(data, week), [data, week.start]); // eslint-disable-line react-hooks/exhaustive-deps
  const label = `Semana del ${formatShortDate(week.start)} al ${formatShortDate(week.end)}`;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Informe semanal</DialogTitle>
          <DialogDescription>Para la Gerencia de Datos. Lunes a domingo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="week-day">Cualquier día de la semana a reportar</Label>
          <Input id="week-day" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <p className="text-sm font-semibold text-[color:var(--primary-deep)]">{label}</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 text-sm">
          <li>Ingresos: <strong>{stats.admissions.count}</strong></li>
          <li>Solicitudes: <strong>{stats.intake.received}</strong></li>
          <li>Prácticas: <strong>{stats.attention.practices}</strong></li>
          <li>Ausentismo: <strong>{stats.attention.absenteeism === null ? "—" : `${stats.attention.absenteeism}%`}</strong></li>
          <li>Derivaciones: <strong>{stats.referrals.count}</strong></li>
          <li>Encuestas: <strong>{stats.satisfaction.count}</strong></li>
        </ul>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => exportStatsCsv(stats, label)}>
            <Download className="mr-1.5 h-4 w-4" /> Excel
          </Button>
          <Button onClick={() => printWeeklyReport(stats, label)} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            <FileText className="mr-1.5 h-4 w-4" /> Imprimir / PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Tile({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" /> {label}
      </div>
      <div className="mt-2 text-3xl font-extrabold tabular-nums text-[color:var(--primary-deep)]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
      <h3 className="text-base font-bold text-[color:var(--primary-deep)]">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

// Barras horizontales: categorías con nombres largos (localidades, especialidades)
function HBarCard({ title, data, note, unit = "pacientes" }: { title: string; data: Row[]; note?: string; unit?: string }) {
  const height = Math.max(120, data.length * 34 + 16);
  return (
    <Card title={title} note={note}>
      {data.every((d) => d.value === 0) ? <Empty /> : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 4, bottom: 0 }}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={150} tick={TICK} axisLine={false} tickLine={false} />
            <Tooltip content={<StatTooltip unit={unit} />} cursor={{ fill: "hsl(200 78% 42% / 0.06)" }} />
            <Bar dataKey="value" fill={BAR_COLOR} radius={[0, 4, 4, 0]} maxBarSize={22}
              label={{ position: "right", fontSize: 11, fill: "hsl(215 16% 35%)" }} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function StatTooltip({ active, payload, label, unit }: {
  active?: boolean; payload?: { value: number; payload: Row }[]; label?: string; unit: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm shadow-lg">
      <div className="font-semibold text-foreground">{label ?? payload[0].payload.name}</div>
      <div className="text-muted-foreground"><strong className="text-foreground">{payload[0].value}</strong> {unit}</div>
    </div>
  );
}

function Empty() {
  return <p className="py-8 text-center text-sm text-muted-foreground">Sin datos en este período.</p>;
}
