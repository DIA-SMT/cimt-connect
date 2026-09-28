import { createFileRoute } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldAlert, CheckCircle2, XCircle, Clock3, Filter, LayoutDashboard, List, LogOut, Lock, Users, FileText } from "lucide-react";
import { toast } from "sonner";
import { formatTime } from "@/lib/appointments";
import { AdminDashboard } from "@/components/AdminDashboard";
import { PatientsTab } from "@/components/admin/PatientsTab";
import { PatientRecordSheet } from "@/components/admin/PatientRecordSheet";
import type { ProfessionalOption } from "@/lib/patients";

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
  patient_id: string | null;
  patients: Patient | null;
};

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Panel admin — CIMT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPage,
});

type Tab = "turnos" | "pacientes" | "dashboard";

type AuthState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "forbidden"; email: string }
  | { kind: "admin"; email: string };

// Gate de acceso: requiere sesión de Supabase Auth y estar en la tabla admins.
// La protección real está en la base (RLS): esto solo decide qué pantalla mostrar.
function AdminPage() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function resolve(session: any) {
      if (!session) {
        if (!cancelled) setAuth({ kind: "signed_out" });
        return;
      }
      const email = session.user?.email ?? "";
      const { data, error } = await supabase.rpc("is_admin");
      if (cancelled) return;
      setAuth(!error && data === true ? { kind: "admin", email } : { kind: "forbidden", email });
    }

    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => resolve(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: unknown) => {
      resolve(session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setAuth({ kind: "signed_out" });
  }

  if (auth.kind === "loading") {
    return (
      <Layout>
        <div className="flex justify-center py-32">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }
  if (auth.kind === "signed_out") return <AdminLogin />;
  if (auth.kind === "forbidden") return <AdminForbidden email={auth.email} onSignOut={signOut} />;
  return <AdminPanel email={auth.email} onSignOut={signOut} />;
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (error) toast.error("Email o contraseña incorrectos");
    // Si sale bien, onAuthStateChange en AdminPage cambia la pantalla
  }

  return (
    <Layout>
      <section className="container mx-auto flex justify-center px-4 py-16 md:py-24">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm space-y-4 rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8"
        >
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]">
              <Lock className="h-5 w-5" />
            </div>
            <h1 className="mt-3 font-display text-2xl font-extrabold text-[color:var(--primary-deep)]">
              Panel de administración
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Ingresá con tu cuenta del CIMT</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">Email</Label>
            <Input id="admin-email" type="email" autoComplete="username" required
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Contraseña</Label>
            <Input id="admin-password" type="password" autoComplete="current-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button type="submit" disabled={submitting}
            className="w-full bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ingresar
          </Button>
        </form>
      </section>
    </Layout>
  );
}

function AdminForbidden({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <Layout>
      <section className="container mx-auto flex justify-center px-4 py-16 md:py-24">
        <div className="w-full max-w-sm rounded-3xl border border-border/60 bg-card p-8 text-center shadow-[var(--shadow-card)]">
          <ShieldAlert className="mx-auto h-10 w-10 text-[color:var(--status-occupied)]" />
          <h1 className="mt-3 font-display text-xl font-bold text-[color:var(--primary-deep)]">Sin permisos</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            La cuenta <strong>{email}</strong> no tiene acceso al panel. Pedile a un administrador que te habilite.
          </p>
          <Button variant="outline" className="mt-5" onClick={onSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
          </Button>
        </div>
      </section>
    </Layout>
  );
}

function AdminPanel({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | Appt["status"]>("all");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [activeTab, setActiveTab] = useState<Tab>("turnos");
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);
  const [openPatientId, setOpenPatientId] = useState<string | null>(null);
  const [patientsVersion, setPatientsVersion] = useState(0);

  async function fetchAppts({ silent = false } = {}) {
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from("appointments")
      .select("*, patients(first_name, last_name, dni, age, phone, email, patient_type)")
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });
    if (error) toast.error("No se pudieron cargar los turnos");
    setAppts((data ?? []) as Appt[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchAppts();
    supabase.from("professionals").select("id, name, specialty").order("name", { ascending: true })
      .then(({ data }: { data: ProfessionalOption[] | null }) => setProfessionals(data ?? []));
  }, []);

  // Al cerrar una ficha con cambios: recargar la planilla y los turnos (por si cambió el nombre)
  function handlePatientChanged() {
    setPatientsVersion((v) => v + 1);
    fetchAppts({ silent: true });
  }

  async function updateStatus(id: string, status: Appt["status"]) {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
    if (error) {
      toast.error("No se pudo actualizar");
      return;
    }
    toast.success(`Turno ${status}`);
    setAppts((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  }

  const filtered = useMemo(() => {
    return appts.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (dateFilter && a.appointment_date !== dateFilter) return false;
      return true;
    });
  }, [appts, statusFilter, dateFilter]);

  const counts = useMemo(() => ({
    pendiente: appts.filter(a => a.status === "pendiente").length,
    confirmado: appts.filter(a => a.status === "confirmado").length,
    cancelado: appts.filter(a => a.status === "cancelado").length,
  }), [appts]);

  return (
    <Layout>
      <section className="container mx-auto px-4 py-10 md:px-6 md:py-14">
        {/* Header */}
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="font-display text-3xl font-extrabold text-[color:var(--primary-deep)] sm:text-4xl">
              Panel de administración
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Gestión y métricas del CIMT
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{email}</span>
            <Button variant="outline" size="sm" onClick={onSignOut}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Cerrar sesión
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-1 rounded-xl border border-border/60 bg-muted/40 p-1 w-fit">
          <TabButton
            active={activeTab === "turnos"}
            onClick={() => setActiveTab("turnos")}
            icon={<List className="h-4 w-4" />}
            label="Turnos"
          />
          <TabButton
            active={activeTab === "pacientes"}
            onClick={() => setActiveTab("pacientes")}
            icon={<Users className="h-4 w-4" />}
            label="Pacientes"
          />
          <TabButton
            active={activeTab === "dashboard"}
            onClick={() => setActiveTab("dashboard")}
            icon={<LayoutDashboard className="h-4 w-4" />}
            label="Dashboard"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : activeTab === "pacientes" ? (
          <PatientsTab professionals={professionals} version={patientsVersion} onOpen={setOpenPatientId} />
        ) : activeTab === "dashboard" ? (
          <div className="mt-6">
            <AdminDashboard appts={appts} />
          </div>
        ) : (
          <>
            {/* Stat cards */}
            <div className="mt-6 grid grid-cols-3 gap-3">
              <Stat label="Pendientes" value={counts.pendiente} color="--status-pending" />
              <Stat label="Confirmados" value={counts.confirmado} color="--status-available" />
              <Stat label="Cancelados" value={counts.cancelado} color="--status-occupied" />
            </div>

            {/* Filters */}
            <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card p-4">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-muted-foreground">Filtrar:</span>
              <div className="flex flex-wrap gap-1.5">
                {(["all", "pendiente", "confirmado", "cancelado"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={[
                      "rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors",
                      statusFilter === s
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
                    ].join(" ")}
                  >
                    {s === "all" ? "Todos" : s}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                  className="h-9 w-auto"
                />
                {dateFilter && (
                  <Button variant="outline" size="sm" onClick={() => setDateFilter("")}>
                    Limpiar
                  </Button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">No hay solicitudes para mostrar.</div>
              ) : (
                <div className="divide-y divide-border/60">
                  {filtered.map((a) => (
                    <div key={a.id} className="grid gap-3 p-5 md:grid-cols-[auto_1fr_auto] md:items-center">
                      <div className="rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-center md:w-32">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--primary-deep)]">
                          {formatDate(a.appointment_date, "weekday")}
                        </div>
                        <div className="text-2xl font-extrabold text-[color:var(--primary-deep)]">
                          {formatDate(a.appointment_date, "day")}
                        </div>
                        <div className="text-xs font-semibold text-[color:var(--primary-deep)] capitalize">
                          {formatDate(a.appointment_date, "month")} · {formatTime(a.appointment_time)}
                        </div>
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold text-foreground">
                            {a.patients?.first_name} {a.patients?.last_name}
                          </h3>
                          <StatusBadge status={a.status} />
                          <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {a.patients?.patient_type} · {a.consultation_type === "primera_vez" ? "1ra vez" : "seguimiento"}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          DNI {a.patients?.dni} · {a.patients?.age} años · {a.patients?.phone}{a.patients?.email && ` · ${a.patients.email}`}
                        </div>
                        <p className="mt-2 text-sm text-foreground/80 line-clamp-2">{a.reason}</p>
                      </div>
                      <div className="flex flex-wrap gap-1.5 md:flex-col md:items-end">
                        {a.patient_id && (
                          <Button size="sm" variant="outline" onClick={() => setOpenPatientId(a.patient_id)}>
                            <FileText className="mr-1 h-3.5 w-3.5" /> Ficha
                          </Button>
                        )}
                        <Button size="sm" variant="outline"
                          disabled={a.status === "confirmado"}
                          onClick={() => updateStatus(a.id, "confirmado")}
                          className="border-[color:var(--status-available)]/40 text-[color:var(--status-available)] hover:bg-[color:var(--status-available-bg)]">
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Confirmar
                        </Button>
                        <Button size="sm" variant="outline"
                          disabled={a.status === "pendiente"}
                          onClick={() => updateStatus(a.id, "pendiente")}>
                          <Clock3 className="mr-1 h-3.5 w-3.5" /> Pendiente
                        </Button>
                        <Button size="sm" variant="outline"
                          disabled={a.status === "cancelado"}
                          onClick={() => updateStatus(a.id, "cancelado")}
                          className="border-[color:var(--status-occupied)]/40 text-[color:var(--status-occupied)] hover:bg-[color:var(--status-occupied-bg)]">
                          <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <PatientRecordSheet
        patientId={openPatientId}
        professionals={professionals}
        onClose={() => setOpenPatientId(null)}
        onChanged={handlePatientChanged}
      />
    </Layout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabButton({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
        active
          ? "bg-background text-[color:var(--primary-deep)] shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: `var(${color})` }} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-extrabold text-[color:var(--primary-deep)]">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: "pendiente" | "confirmado" | "cancelado" }) {
  const map = {
    pendiente:  { bg: "var(--status-pending-bg)",   fg: "var(--status-pending)" },
    confirmado: { bg: "var(--status-available-bg)", fg: "var(--status-available)" },
    cancelado:  { bg: "var(--status-occupied-bg)",  fg: "var(--status-occupied)" },
  } as const;
  const c = map[status];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {status}
    </span>
  );
}

function formatDate(iso: string, part: "weekday" | "day" | "month"): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (part === "weekday") return date.toLocaleDateString("es-AR", { weekday: "short" });
  if (part === "day") return String(date.getDate());
  return date.toLocaleDateString("es-AR", { month: "short" });
}