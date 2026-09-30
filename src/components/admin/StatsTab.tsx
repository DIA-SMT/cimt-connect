import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRightLeft, ClipboardX, Download, Loader2, UserPlus, Users, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CASE_STATUS_LABEL, PATIENT_TYPE_LABEL, THERAPY_MODE_LABEL, todayKey,
  type CaseStatus, type PatientType, type TherapyMode,
} from "@/lib/patients";

// Estadísticas para reportar (relevamiento: cantidad de pacientes, ingresos,
// localidad, derivaciones). "Situación actual" no depende del período; el resto
// cuenta solo lo que pasó dentro del período elegido.

type StatPatient = {
  id: string;
  created_at: string;
  locality: string | null;
  patient_type: PatientType;
  case_status: CaseStatus;
  has_health_insurance: boolean | null;
  therapy_modes: TherapyMode[] | null;
};
type StatReferral = { kind: string; specialty: string; status: string; registered: boolean; referral_date: string };
type StatAppt = { appointment_date: string; status: string; modality: string | null };

type Period = "mes" | "3m" | "anio" | "12m" | "todo";
const PERIOD_LABEL: Record<Period, string> = {
  mes: "Este mes",
  "3m": "Últimos 3 meses",
  anio: "Este año",
  "12m": "Últimos 12 meses",
  todo: "Todo",
};

type Row = { name: string; value: number };

const BAR_COLOR = "hsl(200 78% 42%)";
const GRID = "hsl(215 20% 92%)";
const TICK = { fontSize: 11, fill: "hsl(215 16% 45%)" };

export function StatsTab() {
  const [patients, setPatients] = useState<StatPatient[]>([]);
  const [referrals, setReferrals] = useState<StatReferral[]>([]);
  const [appts, setAppts] = useState<StatAppt[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("12m");

  useEffect(() => {
    Promise.all([
      supabase.from("patients")
        .select("id, created_at, locality, patient_type, case_status, has_health_insurance, therapy_modes"),
      supabase.from("patient_referrals").select("kind, specialty, status, registered, referral_date"),
      supabase.from("appointments").select("appointment_date, status, modality"),
    ]).then(([p, r, a]) => {
      if (p.error || r.error || a.error) toast.error("No se pudieron cargar todas las estadísticas");
      setPatients((p.data ?? []) as StatPatient[]);
      setReferrals((r.data ?? []) as StatReferral[]);
      setAppts((a.data ?? []) as StatAppt[]);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = (isoDate: string) => !start || isoDate.slice(0, 10) >= start;

    // Situación actual
    const active = patients.filter((p) => p.case_status === "en_evaluacion" || p.case_status === "en_tratamiento").length;
    const pendingReferrals = referrals.filter((r) => r.status === "pendiente").length;
    const unregistered = referrals.filter((r) => !r.registered && r.status !== "cancelada").length;
    const byStatus = (Object.keys(CASE_STATUS_LABEL) as CaseStatus[])
      .map((s) => ({ name: CASE_STATUS_LABEL[s], value: patients.filter((p) => p.case_status === s).length }));
    const byTherapy = (Object.keys(THERAPY_MODE_LABEL) as TherapyMode[])
      .map((m) => ({ name: THERAPY_MODE_LABEL[m], value: patients.filter((p) => p.therapy_modes?.includes(m)).length }));

    // Período
    const newPatients = patients.filter((p) => inPeriod(localDateKey(p.created_at)));
    const periodReferrals = referrals.filter((r) => inPeriod(r.referral_date));
    const periodAppts = appts.filter((a) => a.status !== "cancelado" && inPeriod(a.appointment_date));
    const telemed = periodAppts.filter((a) => a.modality === "telemedicina").length;

    return {
      start,
      total: patients.length,
      active,
      pendingReferrals,
      unregistered,
      byStatus,
      byTherapy,
      newCount: newPatients.length,
      byMonth: countByMonth(newPatients.map((p) => localDateKey(p.created_at)), start),
      byLocality: topN(groupLocalities(newPatients.map((p) => p.locality)), 10),
      byType: (Object.keys(PATIENT_TYPE_LABEL) as PatientType[])
        .map((t) => ({ name: PATIENT_TYPE_LABEL[t], value: newPatients.filter((p) => p.patient_type === t).length })),
      byInsurance: [
        { name: "Con obra social", value: newPatients.filter((p) => p.has_health_insurance === true).length },
        { name: "Sin obra social", value: newPatients.filter((p) => p.has_health_insurance === false).length },
        { name: "Sin dato", value: newPatients.filter((p) => p.has_health_insurance === null).length },
      ],
      referralCount: periodReferrals.length,
      referralRegistered: periodReferrals.filter((r) => r.registered).length,
      bySpecialty: topN(countBy(periodReferrals.map((r) => r.specialty.trim() || "Sin especialidad")), 10),
      apptCount: periodAppts.length,
      telemed,
    };
  }, [patients, referrals, appts, period]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  const periodText = period === "todo" ? "desde el inicio" : PERIOD_LABEL[period].toLowerCase();

  return (
    <div className="mt-6 space-y-8">
      {/* Situación actual */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-bold text-[color:var(--primary-deep)]">Situación actual</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={Users} label="Pacientes registrados" value={stats.total} />
          <Tile icon={Users} label="Activos" value={stats.active} sub="En evaluación o en tratamiento" />
          <Tile icon={ArrowRightLeft} label="Derivaciones pendientes" value={stats.pendingReferrals} />
          <Tile icon={ClipboardX} label="Sin registrar" value={stats.unregistered} sub="Derivaciones / interconsultas" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <HBarCard title="Pacientes por estado del caso" data={stats.byStatus} />
          <HBarCard title="Pacientes por tipo de terapia" data={stats.byTherapy}
            note="Un paciente puede estar en más de una." />
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
            <Button size="sm" variant="outline" className="ml-1" onClick={() => exportStatsCsv(stats, period)}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar a Excel
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tile icon={UserPlus} label="Ingresos" value={stats.newCount} sub={`Pacientes nuevos ${periodText}`} />
          <Tile icon={ArrowRightLeft} label="Derivaciones" value={stats.referralCount}
            sub={stats.referralCount ? `${stats.referralRegistered} registradas` : "Derivaciones e interconsultas"} />
          <Tile icon={CalendarCheck} label="Turnos" value={stats.apptCount}
            sub={stats.apptCount ? `${stats.telemed} por telemedicina` : "Sin contar cancelados"} />
        </div>

        <ChartCard title="Ingresos por mes">
          {stats.byMonth.every((m) => m.value === 0) ? <Empty /> : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.byMonth} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<StatTooltip unit="ingresos" />} cursor={{ fill: "hsl(200 78% 42% / 0.06)" }} />
                <Bar dataKey="value" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <HBarCard title="Ingresos por localidad" data={stats.byLocality} />
          <HBarCard title="Derivaciones por especialidad" data={stats.bySpecialty} unit="derivaciones" />
          <HBarCard title="Ingresos por edad" data={stats.byType} />
          <HBarCard title="Ingresos por obra social" data={stats.byInsurance} />
        </div>
      </section>
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Tile({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" /> {label}
      </div>
      <div className="mt-2 text-3xl font-extrabold text-[color:var(--primary-deep)]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
      <h3 className="text-base font-bold text-[color:var(--primary-deep)]">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

// Barras horizontales: sirven para categorías con nombres largos (localidades, especialidades)
function HBarCard({ title, data, note, unit = "pacientes" }: { title: string; data: Row[]; note?: string; unit?: string }) {
  const height = Math.max(120, data.length * 34 + 16);
  return (
    <ChartCard title={title} note={note}>
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
    </ChartCard>
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

// ─── Cálculos ────────────────────────────────────────────────────────────────

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// created_at viene en UTC: se pasa a fecha local para no correr los ingresos de las 21 hs al día siguiente
function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Primer día del período (null = sin límite)
function periodStart(period: Period): string | null {
  const now = new Date();
  const first = (monthsBack: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };
  if (period === "mes") return first(0);
  if (period === "3m") return first(2);
  if (period === "12m") return first(11);
  if (period === "anio") return `${now.getFullYear()}-01-01`;
  return null;
}

function countByMonth(dates: string[], start: string | null): Row[] {
  const today = todayKey();
  const from = start ?? (dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : today);
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);

  const rows: Row[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ey, em] = today.slice(0, 7).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    rows.push({ name: `${MONTHS[m - 1]} ${String(y).slice(2)}`, value: counts.get(key) ?? 0 });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return rows;
}

function countBy(values: string[]): Row[] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

// Agrupa localidades escritas distinto ("yerba buena", "Yerba Buena ") bajo la forma más usada
function groupLocalities(values: (string | null)[]): Row[] {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  let missing = 0;
  for (const raw of values) {
    const v = raw?.trim().replace(/\s+/g, " ");
    if (!v) { missing++; continue; }
    const key = v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const g = groups.get(key) ?? { count: 0, spellings: new Map() };
    g.count++;
    g.spellings.set(v, (g.spellings.get(v) ?? 0) + 1);
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => ({
    name: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0],
    value: g.count,
  })).sort((a, b) => b.value - a.value);
  if (missing) rows.push({ name: "Sin dato", value: missing });
  return rows;
}

// Las primeras N y el resto sumado en "Otras" ("Sin dato" siempre queda aparte, al final)
function topN(rows: Row[], n: number): Row[] {
  const missing = rows.find((r) => r.name === "Sin dato");
  const rest = rows.filter((r) => r !== missing);
  const out = rest.slice(0, n);
  const others = rest.slice(n).reduce((sum, r) => sum + r.value, 0);
  if (others) out.push({ name: "Otras", value: others });
  if (missing) out.push(missing);
  return out;
}

// ─── Exportación ─────────────────────────────────────────────────────────────

type Stats = {
  start: string | null; total: number; active: number; pendingReferrals: number; unregistered: number;
  byStatus: Row[]; byTherapy: Row[]; newCount: number; byMonth: Row[]; byLocality: Row[]; byType: Row[];
  byInsurance: Row[]; referralCount: number; referralRegistered: number; bySpecialty: Row[];
  apptCount: number; telemed: number;
};

function exportStatsCsv(s: Stats, period: Period) {
  const rows: (string | number)[][] = [
    ["Estadísticas CIMT"],
    ["Generado", todayKey()],
    ["Período", PERIOD_LABEL[period] + (s.start ? ` (desde ${s.start})` : "")],
    [],
    ["SITUACIÓN ACTUAL"],
    ["Pacientes registrados", s.total],
    ["Pacientes activos", s.active],
    ["Derivaciones pendientes", s.pendingReferrals],
    ["Derivaciones sin registrar", s.unregistered],
    [],
    ["Estado del caso", "Pacientes"], ...s.byStatus.map((r) => [r.name, r.value]),
    [],
    ["Tipo de terapia", "Pacientes"], ...s.byTherapy.map((r) => [r.name, r.value]),
    [],
    ["EN EL PERÍODO"],
    ["Ingresos (pacientes nuevos)", s.newCount],
    ["Derivaciones e interconsultas", s.referralCount],
    ["Derivaciones registradas", s.referralRegistered],
    ["Turnos (sin cancelados)", s.apptCount],
    ["Turnos por telemedicina", s.telemed],
    [],
    ["Mes", "Ingresos"], ...s.byMonth.map((r) => [r.name, r.value]),
    [],
    ["Localidad", "Ingresos"], ...s.byLocality.map((r) => [r.name, r.value]),
    [],
    ["Edad", "Ingresos"], ...s.byType.map((r) => [r.name, r.value]),
    [],
    ["Obra social", "Ingresos"], ...s.byInsurance.map((r) => [r.name, r.value]),
    [],
    ["Especialidad", "Derivaciones"], ...s.bySpecialty.map((r) => [r.name, r.value]),
  ];
  const escape = (v: unknown) => {
    const str = v === undefined || v === null ? "" : String(v);
    return /[;"\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = rows.map((r) => r.map(escape).join(";")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `estadisticas-cimt-${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
