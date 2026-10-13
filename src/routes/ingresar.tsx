import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { PORTAL_ENABLED, isValidDni, normalizeDni, portalApi, retryLabel } from "@/lib/portal";
import { CENTER } from "@/lib/center";

// Una sola entrada para todos: con email entra el equipo (panel), con DNI
// entran las familias y los pacientes (portal). /admin sin sesión manda acá.

export const Route = createFileRoute("/ingresar")({
  head: () => ({
    meta: [
      { title: "Ingresar — CIMT" },
      { name: "description", content: "Ingreso al portal de familias y al panel del equipo del Centro Integral Municipal de Tartamudez." },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { salir?: number } => ({ salir: s.salir ? 1 : undefined }),
  component: IngresarPage,
});

const isEmail = (v: string) => v.includes("@");

function IngresarPage() {
  const { salir } = Route.useSearch();
  const navigate = useNavigate();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState<null | "form" | "sent-email" | "sent-dni">(null);
  const [open, setOpen] = useState<{ panel: boolean; portal: boolean }>({ panel: false, portal: false });

  useEffect(() => {
    if (salir) toast.success("Cerraste sesión.");
  }, [salir]);

  // Si ya hay una sesión abierta, se ofrece seguir (no se redirige solo: puede
  // haber una del panel y otra del portal en la misma compu)
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }: { data: { session: unknown } }) => {
      if (!data.session) return;
      const { data: staff } = await supabase.rpc("current_staff");
      if (staff) setOpen((o) => ({ ...o, panel: true }));
    });
    if (PORTAL_ENABLED) portalApi.hasSession().then((has) => { if (has) setOpen((o) => ({ ...o, portal: true })); });
  }, []);

  const value = id.trim();
  const kind: "email" | "dni" | null = !value ? null : isEmail(value) ? "email" : "dni";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!kind) { setError("Escribí tu DNI (familias y pacientes) o tu email (equipo del CIMT)."); return; }
    if (!password) { setError("Escribí tu contraseña."); return; }

    setSending(true);
    if (kind === "email") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: value, password });
      setSending(false);
      if (authError) { setError("Email o contraseña incorrectos."); return; }
      navigate({ to: "/admin" });
      return;
    }

    if (!PORTAL_ENABLED) { setSending(false); setError("El portal de familias todavía no está disponible."); return; }
    const dni = normalizeDni(value);
    if (!isValidDni(dni)) { setSending(false); setError("Revisá tu DNI: tiene que tener entre 6 y 10 números."); return; }
    const r = await portalApi.login(dni, password);
    setSending(false);
    if (!r.ok) {
      setError(r.status === 429 ? `Hiciste muchos intentos. Probá de nuevo ${retryLabel(r.retry_at)} o llamá al ${CENTER.phoneDisplay}.`
        : r.status === 503 ? "No se pudo conectar. Revisá tu conexión y probá de nuevo."
        : r.error);
      return;
    }
    navigate({ href: "/portal" });
  }

  async function recover(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!kind) { setError("Escribí tu DNI o tu email para recuperar la contraseña."); return; }
    setSending(true);
    if (kind === "email") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(value, { redirectTo: `${window.location.origin}/admin` });
      setSending(false);
      if (resetError?.status === 429) { setError("Ya se pidieron varios emails. Esperá unos minutos antes de pedir otro."); return; }
      if (resetError) { setError("No se pudo enviar el email. Intentá de nuevo más tarde."); return; }
      setForgot("sent-email");
      return;
    }
    const dni = normalizeDni(value);
    if (!PORTAL_ENABLED || !isValidDni(dni)) { setSending(false); setError("Revisá tu DNI: tiene que tener entre 6 y 10 números."); return; }
    const r = await portalApi.requestRecovery(dni);
    setSending(false);
    if (!r.ok) { setError(r.status === 429 ? "Hiciste muchos pedidos. Probá más tarde." : r.error); return; }
    setForgot("sent-dni");
  }

  return (
    <Layout>
      <section className="container mx-auto flex justify-center px-4 py-14 md:py-20">
        <div className="w-full max-w-md space-y-5">
          {(open.panel || open.portal) && (
            <div className="rounded-2xl border border-primary/20 bg-[color:var(--primary-soft)] p-4 text-sm">
              <p className="font-semibold text-[color:var(--primary-deep)]">Ya tenés una sesión abierta</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {open.panel && <Button size="sm" asChild className="rounded-full"><Link to="/admin">Ir al panel</Link></Button>}
                {open.portal && <Button size="sm" asChild variant="outline" className="rounded-full"><a href="/portal">Ir a mi portal</a></Button>}
              </div>
            </div>
          )}

          <div className="space-y-5 rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
            <div className="space-y-1.5 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]">
                <LogIn className="h-6 w-6" aria-hidden />
              </div>
              <h1 className="font-hand text-4xl text-[color:var(--primary-deep)]">Ingresar</h1>
              <p className="text-sm text-muted-foreground">
                Familias y pacientes: con tu <b>DNI</b>. Equipo del CIMT: con tu <b>email</b>.
              </p>
            </div>

            {forgot === "sent-email" ? (
              <div role="status" className="space-y-3 text-center text-sm">
                <p>Si <b>{value}</b> tiene una cuenta del equipo, te llegó un email con un link para crear una contraseña nueva. Revisá también la carpeta de spam.</p>
                <Button variant="outline" className="w-full" onClick={() => setForgot(null)}>Volver a ingresar</Button>
              </div>
            ) : forgot === "sent-dni" ? (
              <div role="status" className="space-y-3 text-center text-sm">
                <p>Si tenés una cuenta en el portal, el centro te va a contactar para darte un código nuevo. También podés llamar al {CENTER.phoneDisplay}.</p>
                <Button variant="outline" className="w-full" onClick={() => setForgot(null)}>Volver a ingresar</Button>
              </div>
            ) : (
              <form onSubmit={forgot === "form" ? recover : submit} noValidate className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ingresar-id">DNI o email</Label>
                  <Input id="ingresar-id" name="username" autoComplete="username" autoFocus value={id}
                    onChange={(e) => { setId(e.target.value); setError(null); }}
                    placeholder="Ej.: 30111222 o nombre@smt.gob.ar" className="h-11 text-base" />
                  {kind && (
                    <p className="text-xs text-muted-foreground">
                      {kind === "email" ? "Vas a entrar al panel del equipo." : "Vas a entrar al portal de familias."}
                    </p>
                  )}
                </div>

                {forgot !== "form" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ingresar-password">Contraseña</Label>
                    <div className="relative">
                      <Input id="ingresar-password" name="password" type={show ? "text" : "password"} autoComplete="current-password"
                        value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} className="h-11 pr-24 text-base" />
                      <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show}
                        aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                        className="absolute inset-y-0 right-1 my-auto flex h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold text-primary">
                        {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                        {show ? "Ocultar" : "Mostrar"}
                      </button>
                    </div>
                  </div>
                )}

                {error && <p role="alert" className="text-sm font-semibold text-[oklch(0.5_0.19_25)]">{error}</p>}

                <Button type="submit" disabled={sending} className="h-11 w-full rounded-full bg-primary text-base font-semibold hover:bg-[color:var(--primary-deep)]">
                  {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {forgot === "form" ? (kind === "dni" ? "Pedir un código nuevo" : "Enviarme un link") : "Ingresar"}
                </Button>

                <button type="button" onClick={() => { setForgot(forgot === "form" ? null : "form"); setError(null); }}
                  className="w-full text-center text-sm font-semibold text-primary underline-offset-2 hover:underline">
                  {forgot === "form" ? "Volver a ingresar" : "¿Olvidaste tu contraseña?"}
                </button>
              </form>
            )}
          </div>

          {PORTAL_ENABLED && (
            <div className="rounded-2xl bg-[color:var(--primary-soft)] p-4 text-sm">
              ¿Es tu primera vez en el portal? Si el centro te dio un código de invitación,{" "}
              <a href="/portal/activar" className="font-semibold text-[color:var(--primary-deep)] underline underline-offset-2">activá tu cuenta →</a>
            </div>
          )}
          <p className="text-center text-xs text-muted-foreground">
            ¿No tenés cuenta? Las cuentas las da el centro. Para pedir un turno no hace falta:{" "}
            <Link to="/turnos" className="font-semibold text-primary hover:underline">solicitalo acá</Link>.
          </p>
        </div>
      </section>
    </Layout>
  );
}
