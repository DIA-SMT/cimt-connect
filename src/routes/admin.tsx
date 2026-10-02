import { createFileRoute } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ShieldAlert, LayoutDashboard, LogOut, Lock, Users, BarChart3, UserCog, KeyRound, CalendarDays, Inbox } from "lucide-react";
import { toast } from "sonner";
import { AdminDashboard } from "@/components/AdminDashboard";
import { PatientsTab } from "@/components/admin/PatientsTab";
import { StatsTab } from "@/components/admin/StatsTab";
import { PatientRecordSheet } from "@/components/admin/PatientRecordSheet";
import { TeamTab } from "@/components/admin/TeamTab";
import { AgendaTab } from "@/components/admin/AgendaTab";
import { IntakeTab } from "@/components/admin/IntakeTab";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProfessionalOption } from "@/lib/patients";
import { ROLE_LABEL, isDirector, type Staff } from "@/lib/staff";

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

type Tab = "agenda" | "solicitudes" | "pacientes" | "estadisticas" | "dashboard" | "equipo";

type AuthState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "forbidden"; email: string }
  | { kind: "admin"; staff: Staff }
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
      // current_staff() devuelve rol, nombre y profesional vinculado (NULL si no es del panel)
      const { data, error } = await supabase.rpc("current_staff");
      if (cancelled) return;
      setAuth(!error && data
        ? { kind: "admin", staff: { ...(data as Staff), email: (data as Staff).email ?? email } }
        : { kind: "forbidden", email });
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
  return <AdminPanel staff={auth.staff} onSignOut={signOut} />;
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
            La cuenta <strong>{email}</strong> no tiene acceso al panel (o fue desactivada). Pedile a la Dirección que te habilite.
          </p>
          <Button variant="outline" className="mt-5" onClick={onSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
          </Button>
        </div>
      </section>
    </Layout>
  );
}

function AdminPanel({ staff, onSignOut }: { staff: Staff; onSignOut: () => void }) {
  const [appts, setAppts] = useState<Appt[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("agenda");
  const [professionals, setProfessionals] = useState<ProfessionalOption[]>([]);
  const [openPatientId, setOpenPatientId] = useState<string | null>(null);
  const [patientsVersion, setPatientsVersion] = useState(0);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newRequests, setNewRequests] = useState(0);

  function loadProfessionals() {
    supabase.from("professionals").select("id, name, specialty, license, active, session_minutes").order("name", { ascending: true })
      .then(({ data }: { data: ProfessionalOption[] | null }) => setProfessionals(data ?? []));
  }

  // Turnos para el Dashboard (la agenda carga los suyos por día)
  async function fetchAppts() {
    const { data, error } = await supabase
      .from("appointments")
      .select("*, patients(first_name, last_name, dni, age, phone, email, patient_type, professional_id, locality)")
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });
    if (error) toast.error("No se pudieron cargar los turnos");
    setAppts((data ?? []) as Appt[]);
  }

  useEffect(() => {
    fetchAppts();
    loadProfessionals();
    // Contador de solicitudes nuevas para la pestaña
    supabase.from("intake_requests").select("id").eq("status", "nueva")
      .then(({ data }: { data: { id: string }[] | null }) => setNewRequests(data?.length ?? 0));
  }, []);

  // Al cerrar una ficha con cambios: recargar la planilla y los turnos (por si cambió el nombre)
  function handlePatientChanged() {
    setPatientsVersion((v) => v + 1);
    fetchAppts();
  }

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
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1 text-right leading-tight">
              <div className="text-sm font-semibold text-foreground">{staff.full_name || staff.email}</div>
              <div className="text-xs text-muted-foreground">{ROLE_LABEL[staff.role]}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setChangingPassword(true)}>
              <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Contraseña
            </Button>
            <Button variant="outline" size="sm" onClick={onSignOut}>
              <LogOut className="mr-1.5 h-3.5 w-3.5" /> Cerrar sesión
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex w-fit flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/40 p-1">
          <TabButton active={activeTab === "agenda"} onClick={() => setActiveTab("agenda")}
            icon={<CalendarDays className="h-4 w-4" />} label="Agenda" />
          <TabButton active={activeTab === "solicitudes"} onClick={() => setActiveTab("solicitudes")}
            icon={<Inbox className="h-4 w-4" />} label="Solicitudes" badge={newRequests} />
          <TabButton active={activeTab === "pacientes"} onClick={() => setActiveTab("pacientes")}
            icon={<Users className="h-4 w-4" />} label="Pacientes" />
          <TabButton active={activeTab === "estadisticas"} onClick={() => setActiveTab("estadisticas")}
            icon={<BarChart3 className="h-4 w-4" />} label="Estadísticas" />
          <TabButton active={activeTab === "dashboard"} onClick={() => setActiveTab("dashboard")}
            icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" />
          {isDirector(staff.role) && (
            <TabButton active={activeTab === "equipo"} onClick={() => setActiveTab("equipo")}
              icon={<UserCog className="h-4 w-4" />} label="Equipo" />
          )}
        </div>

        {activeTab === "agenda" ? (
          <AgendaTab professionals={professionals} staff={staff} onOpenPatient={setOpenPatientId} />
        ) : activeTab === "solicitudes" ? (
          <IntakeTab onOpenPatient={(id) => { setPatientsVersion((v) => v + 1); setOpenPatientId(id); }}
            onCountChange={setNewRequests} />
        ) : activeTab === "pacientes" ? (
          <PatientsTab professionals={professionals} version={patientsVersion} onOpen={setOpenPatientId} />
        ) : activeTab === "estadisticas" ? (
          <StatsTab key={patientsVersion} professionals={professionals} />
        ) : activeTab === "equipo" && isDirector(staff.role) ? (
          <TeamTab currentEmail={staff.email} onProfessionalsChanged={loadProfessionals} />
        ) : (
          <div className="mt-6">
            <AdminDashboard appts={appts} professionals={professionals} />
          </div>
        )}
      </section>

      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />

      <PatientRecordSheet
        patientId={openPatientId}
        professionals={professionals}
        onClose={() => setOpenPatientId(null)}
        onChanged={handlePatientChanged}
        staff={staff}
      />
    </Layout>
  );
}

// Cambiar la contraseña propia desde el panel (útil si la Dirección dio una inicial)
function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  function close() {
    setPassword("");
    setConfirm("");
    onClose();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 8) { toast.error("La contraseña tiene que tener al menos 8 caracteres"); return; }
    if (password !== confirm) { toast.error("Las contraseñas no coinciden"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(error.code === "same_password"
        ? "La contraseña nueva tiene que ser distinta a la anterior"
        : "No se pudo cambiar la contraseña");
      return;
    }
    toast.success("Contraseña actualizada");
    close();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-[color:var(--primary-deep)]">Cambiar contraseña</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">Contraseña nueva</Label>
            <Input id="cp-new" type="password" autoComplete="new-password" required minLength={8}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">Repetir contraseña</Label>
            <Input id="cp-confirm" type="password" autoComplete="new-password" required minLength={8}
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabButton({
  active, onClick, icon, label, badge = 0,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
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
      {badge > 0 && (
        <span className="rounded-full bg-[color:var(--status-pending)] px-1.5 text-[10px] font-bold text-white">{badge}</span>
      )}
    </button>
  );
}
