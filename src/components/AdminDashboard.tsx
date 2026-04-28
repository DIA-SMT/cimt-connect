import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Users, CalendarCheck, TrendingUp, Clock3,
} from "lucide-react";
import { MOCK_PROFESSIONALS } from "@/lib/mockData";

// ─── Types ────────────────────────────────────────────────────────────────────

type Patient = {
  first_name: string;
  last_name: string;
  dni: string;
  age: number;
  phone: string;
  email: string | null;
  patient_type: "niño" | "adolescente" | "adulto";
};

type Appt = {
  id: string;
  consultation_type: "primera_vez" | "seguimiento";
  reason: string;
  appointment_date: string;
  appointment_time: string;
  status: "pendiente" | "confirmado" | "cancelado";
  professional_id: string | null;
  created_at: string;
  patients: Patient | null;
};

type Props = { appts: Appt[] };

// ─── Color palette ────────────────────────────────────────────────────────────

const PALETTE = {
  primary:   "hsl(200 78% 42%)",
  soft:      "hsl(200 78% 70%)",
  accent:    "hsl(160 60% 45%)",
  warn:      "hsl(38 92% 55%)",
  danger:    "hsl(0 72% 58%)",
  muted:     "hsl(215 20% 85%)",
};

const DONUT_PATIENT = [PALETTE.primary, PALETTE.accent, PALETTE.warn];
const DONUT_CONSULT  = [PALETTE.primary, PALETTE.soft];
const DONUT_STATUS   = [PALETTE.warn, PALETTE.accent, PALETTE.danger];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DAY_LABELS: Record<number, string> = {
  0: "Dom", 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb",
};

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, color = "primary",
}: {
  icon: typeof Users; label: string; value: string | number;
  sub?: string; color?: "primary" | "accent" | "warn" | "danger";
}) {
  const bg = {
    primary: "bg-primary/10 text-primary",
    accent:  "bg-emerald-500/10 text-emerald-600",
    warn:    "bg-amber-400/10 text-amber-600",
    danger:  "bg-red-500/10 text-red-600",
  }[color];

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg}`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-3 text-4xl font-extrabold text-[color:var(--primary-deep)]">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
      <h3 className="mb-4 text-base font-bold text-[color:var(--primary-deep)]">{title}</h3>
      {children}
    </div>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { value: number; name?: string; fill?: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-background px-3 py-2 shadow-lg text-sm">
      {label && <div className="mb-1 font-semibold text-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.fill ?? PALETTE.primary }} />
          <span>{p.name ?? ""} <strong className="text-foreground">{p.value}</strong></span>
        </div>
      ))}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function AdminDashboard({ appts }: Props) {
  // Only non-cancelled for most metrics
  const active = appts.filter((a) => a.status !== "cancelado");

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalPacientes = appts.length;
  const tasa = appts.length
    ? Math.round((appts.filter((a) => a.status === "confirmado").length / appts.length) * 100)
    : 0;
  const primeraVez = appts.filter((a) => a.consultation_type === "primera_vez").length;
  const avgAge = appts.length
    ? Math.round(appts.reduce((s, a) => s + (a.patients?.age ?? 0), 0) / appts.length)
    : 0;

  // ── Turnos por día de la semana (activos) ─────────────────────────────────
  const byDayOfWeek = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const a of active) {
      const dow = parseLocalDate(a.appointment_date).getDay();
      if (dow >= 1 && dow <= 5) counts[dow] = (counts[dow] ?? 0) + 1;
    }
    return [1, 2, 3, 4, 5].map((d) => ({ dia: DAY_LABELS[d], turnos: counts[d] ?? 0 }));
  }, [active]);

  // ── Turnos por profesional ────────────────────────────────────────────────
  const byProfessional = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of appts) {
      const key = a.professional_id ?? "__none__";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([id, total]) => {
        const pro = MOCK_PROFESSIONALS.find((p) => p.id === id);
        const name = pro ? pro.name.replace(/^Lic\.\s*/, "").split(" ").slice(0, 1).join(" ") + " " + pro.name.split(" ").slice(-1) : "Sin asignar";
        return { name, total };
      })
      .sort((a, b) => b.total - a.total);
  }, [appts]);

  // ── Tipo de paciente ──────────────────────────────────────────────────────
  const byPatientType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of appts) {
      const type = a.patients?.patient_type ?? "Desconocido";
      map[type] = (map[type] ?? 0) + 1;
    }
    return Object.entries(map).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1), value,
    }));
  }, [appts]);

  // ── Tipo de consulta ──────────────────────────────────────────────────────
  const byConsultType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of appts) map[a.consultation_type] = (map[a.consultation_type] ?? 0) + 1;
    return [
      { name: "Primera vez", value: map["primera_vez"] ?? 0 },
      { name: "Seguimiento", value: map["seguimiento"] ?? 0 },
    ];
  }, [appts]);

  // ── Estado de turnos ──────────────────────────────────────────────────────
  const byStatus = useMemo(() => [
    { name: "Pendiente",  value: appts.filter((a) => a.status === "pendiente").length },
    { name: "Confirmado", value: appts.filter((a) => a.status === "confirmado").length },
    { name: "Cancelado",  value: appts.filter((a) => a.status === "cancelado").length },
  ], [appts]);

  // ── Turnos por fecha (timeline últimos 14 días + próximos) ────────────────
  const timeline = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of appts) {
      counts[a.appointment_date] = (counts[a.appointment_date] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, turnos]) => {
        const d = parseLocalDate(date);
        const label = d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
        return { label, turnos };
      });
  }, [appts]);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users}        label="Total solicitudes" value={totalPacientes}          sub="en todos los estados"          color="primary" />
        <KpiCard icon={CalendarCheck} label="Primera vez"       value={primeraVez}              sub={`${appts.length - primeraVez} seguimientos`} color="accent"  />
        <KpiCard icon={TrendingUp}   label="Tasa confirmación"  value={`${tasa}%`}              sub="sobre total de solicitudes"    color="warn"    />
        <KpiCard icon={Clock3}       label="Edad promedio"      value={`${avgAge} años`}        sub="de los pacientes registrados"  color="danger"  />
      </div>

      {/* Timeline — turnos por fecha */}
      <ChartCard title="Solicitudes por fecha">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={timeline} barSize={28} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 20% 92%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(215 16% 55%)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(215 16% 55%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(200 78% 42% / 0.06)" }} />
            <Bar dataKey="turnos" name="Turnos" fill={PALETTE.primary} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Row: day-of-week + professional */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Turnos por día de la semana">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={byDayOfWeek} barSize={32} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 20% 92%)" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 12, fill: "hsl(215 16% 55%)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(215 16% 55%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(200 78% 42% / 0.06)" }} />
              <Bar dataKey="turnos" name="Turnos" radius={[6, 6, 0, 0]}>
                {byDayOfWeek.map((_, i) => (
                  <Cell key={i} fill={i === 2 ? PALETTE.accent : PALETTE.primary} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Atenciones por profesional">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={byProfessional}
              layout="vertical"
              barSize={20}
              margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 20% 92%)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(215 16% 55%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: "hsl(215 16% 55%)" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(200 78% 42% / 0.06)" }} />
              <Bar dataKey="total" name="Turnos" fill={PALETTE.accent} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row: donuts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard title="Tipo de paciente">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byPatientType} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
                {byPatientType.map((_, i) => (
                  <Cell key={i} fill={DONUT_PATIENT[i % DONUT_PATIENT.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tipo de consulta">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byConsultType} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
                {byConsultType.map((_, i) => (
                  <Cell key={i} fill={DONUT_CONSULT[i % DONUT_CONSULT.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Estado de solicitudes">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byStatus} cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={3} dataKey="value">
                {byStatus.map((_, i) => (
                  <Cell key={i} fill={DONUT_STATUS[i % DONUT_STATUS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "12px" }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
