import { createFileRoute } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldAlert, CheckCircle2, XCircle, Clock3, Filter, LayoutDashboard, List, LogOut, Lock, Users, FileText, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { formatTime } from "@/lib/appointments";
import { AdminDashboard } from "@/components/AdminDashboard";
import { PatientsTab } from "@/components/admin/PatientsTab";
import { StatsTab } from "@/components/admin/StatsTab";
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
  professional_id: string | null;
  locality: string | null;
};

type Appt = {
  id: string;
  consultation_type: "primera_vez" | "seguimiento";
  modality: "presencial" | "telemedicina" | null;
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

type Tab = "turnos" | "pacientes" | "estadisticas" | "dashboard";

type AuthState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "forbidden"; email: string }
  | { kind: "admin"; email: string }
  | { kind: "recovery" }; // entró desde el link de "olvidé mi contraseña"

// Gate de acceso: requiere sesión de Supabase Auth y estar en la tabla admins.
// La protección real está en la base (RLS): esto solo decide qué pantalla mostrar.
function AdminPage() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    // El link del email de recuperación trae una sesión temporal: en vez del panel
    // hay que mostrar el formulario de contraseña nueva. Se mira el hash antes de
    // que supabase-js lo procese y lo borre.
    let recovering = window.location.hash.includes("type=recovery");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function resolve(session: any) {
      if (recovering) {
        if (!cancelled) setAuth({ kind: "recovery" });
        return;
      }
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
    const { data: sub } = supabase.auth.onAuthStateChange((event: string, session: unknown) => {
      if (event === "PASSWORD_RECOVERY") recovering = true;
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
  if (auth.kind === "recovery") return <SetNewPassword />;
  if (auth.kind === "forbidden") return <AdminForbidden email={auth.email} onSignOut={signOut} />;
  return <AdminPanel email={auth.email} onSignOut={signOut} />;
}

function AdminLogin() {
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
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

  async function handleForgot(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/admin`,
    });
    setSubmitting(false);
    if (error?.status === 429) {
      toast.error("Ya se pidieron varios emails. Esperá unos minutos antes de pedir otro.");
      return;
    }
    if (error) {
      toast.error("No se pudo enviar el email. Intentá de nuevo más tarde.");
      return;
    }
    // No se confirma si el email existe o no (evita que se puedan averiguar cuentas)
    setMode("sent");
  }

  if (mode === "sent") {
    return (
      <AuthCard title="Revisá tu email" subtitle="">
        <p className="text-center text-sm text-muted-foreground">
          Si <strong>{email.trim()}</strong> tiene una cuenta, te llegó un email con un link para crear una
          contraseña nueva. Puede tardar unos minutos; revisá también la carpeta de spam.
        </p>
        <Button variant="outline" className="w-full" onClick={() => setMode("login")}>
          Volver a ingresar
        </Button>
      </AuthCard>
    );
  }

  if (mode === "forgot") {
    return (
      <AuthCard title="Recuperar contraseña" subtitle="Te mandamos un link para crear una nueva" onSubmit={handleForgot}>
        <div className="space-y-1.5">
          <Label htmlFor="forgot-email">Email</Label>
          <Input id="forgot-email" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting}
          className="w-full bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviar link
        </Button>
        <button type="button" onClick={() => setMode("login")}
          className="block w-full text-center text-sm text-muted-foreground hover:text-foreground">
          Volver
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Panel de administración" subtitle="Ingresá con tu cuenta del CIMT" onSubmit={handleSubmit}>
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
      <button type="button" onClick={() => setMode("forgot")}
        className="block w-full text-center text-sm text-muted-foreground hover:text-foreground">
        ¿Olvidaste tu contraseña?
      </button>
    </AuthCard>
  );
}

// Pantalla a la que llega el link del email de recuperación
function SetNewPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("La contraseña tiene que tener al menos 8 caracteres");
      return;
    }
    if (password !== confirm) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error(
        error.code === "same_password"
          ? "La contraseña nueva tiene que ser distinta a la anterior"
          : "No se pudo cambiar la contraseña. Pedí un link nuevo desde «¿Olvidaste tu contraseña?».",
      );
      return;
    }
    toast.success("Contraseña actualizada");
    // Recarga limpia (sin el hash del link) para entrar al panel con la sesión nueva
    window.location.replace("/admin");
  }

  return (
    <AuthCard title="Nueva contraseña" subtitle="Elegí una contraseña de al menos 8 caracteres" onSubmit={handleSubmit}>
      <div className="space-y-1.5">
        <Label htmlFor="new-password">Contraseña nueva</Label>
        <Input id="new-password" type="password" autoComplete="new-password" required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Repetir contraseña</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" required minLength={8}
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      <Button type="submit" disabled={submitting}
        className="w-full bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar contraseña
      </Button>
    </AuthCard>
  );
}

// Tarjeta centrada que comparten el login, la recuperación y la contraseña nueva
function AuthCard({ title, subtitle, onSubmit, children }: {
  title: string;
  subtitle: string;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  const className =
    "w-full max-w-sm space-y-4 rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8";
  const content = (
    <>
      <div className="flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="mt-3 font-display text-2xl font-extrabold text-[color:var(--primary-deep)]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </>
  );
  return (
    <Layout>
      <section className="container mx-auto flex justify-center px-4 py-16 md:py-24">
        {onSubmit ? (
          <form onSubmit={onSubmit} className={className}>{content}</form>
        ) : (
          <div className={className}>{content}</div>
        )}
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
      .select("*, patients(first_name, last_name, dni, age, phone, email, patient_type, professional_id, locality)")
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
        <div className="mt-6 flex w-fit flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
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
            active={activeTab === "estadisticas"}
            onClick={() => setActiveTab("estadisticas")}
            icon={<BarChart3 className="h-4 w-4" />}
            label="Estadísticas"
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
        ) : activeTab === "estadisticas" ? (
          <StatsTab key={patientsVersion} />
        ) : activeTab === "dashboard" ? (
          <div className="mt-6">
            <AdminDashboard appts={appts} professionals={professionals} />
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
                          {a.modality === "telemedicina" && (
                            <span className="rounded-full bg-[color:var(--primary-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--primary-deep)]">
                              Telemedicina
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          DNI {a.patients?.dni} · {a.patients?.age} años · {a.patients?.phone}{a.patients?.email && ` · ${a.patients.email}`}
                          {a.patients?.locality && ` · ${a.patients.locality}`}
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