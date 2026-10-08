import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Eye, EyeOff, Info } from "lucide-react";
import {
  isValidDni, normalizeDni, portalApi, PORTAL_MOCK, retryLabel,
} from "@/lib/portal";
import { CallUs, FormAlert, PageTitle } from "@/components/portal/ui";
import { card, inputClass, pillOutline, pillPrimary } from "@/components/portal/styles";

type Search = { volver?: string; salir?: number };

export const Route = createFileRoute("/portal/ingresar")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    // Solo se vuelve a rutas del portal (nunca a otra página o sitio)
    volver: typeof s.volver === "string" && /^\/portal(\/[\w$-]+)*\/?$/.test(s.volver) ? s.volver : undefined,
    salir: s.salir ? 1 : undefined,
  }),
  component: IngresarPage,
});

function IngresarPage() {
  const { volver, salir } = Route.useSearch();
  const navigate = useNavigate();
  const [dni, setDni] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [dniError, setDniError] = useState<string | null>(null);
  const [error, setError] = useState<React.ReactNode>(null);
  const [sending, setSending] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const dniRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (salir) toast.success("Cerraste sesión.");
  }, [salir]);

  // Si ya hay sesión, directo al portal
  useEffect(() => {
    portalApi.hasSession().then((has) => { if (has) navigate({ href: volver ?? "/portal", replace: true }); });
  }, [navigate, volver]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidDni(dni)) {
      setDniError("Revisá tu DNI: tiene que tener entre 6 y 10 números.");
      dniRef.current?.focus();
      return;
    }
    setDniError(null);
    setSending(true);
    const r = await portalApi.login(dni, password);
    setSending(false);
    if (!r.ok) {
      if (r.status === 429) setError(<>Hiciste muchos intentos. Probá de nuevo {retryLabel(r.retry_at)} o <CallUs />.</>);
      else if (r.status === 503) setError("No se pudo conectar. Revisá tu conexión y probá de nuevo.");
      else setError(r.error);
      return;
    }
    navigate({ href: volver ?? "/portal", replace: true });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageTitle sub="Mirá tus turnos o los de tus chicos, y avisanos si pueden venir.">Portal de familias</PageTitle>

      <div className={`${card} flex flex-col gap-4`}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="portal-dni" className="text-base font-bold">DNI</label>
          <input
            ref={dniRef} id="portal-dni" name="username" inputMode="numeric" autoComplete="username"
            placeholder="Ej.: 30111222" value={dni}
            onChange={(e) => { setDni(normalizeDni(e.target.value)); setDniError(null); }}
            aria-invalid={!!dniError} aria-describedby={dniError ? "portal-dni-error" : undefined}
            className={inputClass}
          />
          {dniError && <p id="portal-dni-error" role="alert" className="text-base font-semibold text-[oklch(0.48_0.19_25)]">{dniError}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="portal-password" className="text-base font-bold">Contraseña</label>
          <div className="relative">
            <input
              id="portal-password" name="password" type={showPassword ? "text" : "password"}
              autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} pr-24`}
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute inset-y-0 right-1 my-auto flex h-11 items-center gap-1 rounded-full px-3 text-sm font-bold text-primary">
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
        </div>

        <FormAlert>{error}</FormAlert>

        <button type="submit" disabled={sending} className={pillPrimary}>
          {sending ? "Ingresando…" : "Ingresar"}
        </button>
      </form>

        <button type="button" onClick={() => setForgotOpen((v) => !v)} aria-expanded={forgotOpen} aria-controls="portal-forgot"
          className="min-h-11 self-start text-base font-bold text-primary underline-offset-2 hover:underline">
          ¿Olvidaste tu contraseña?
        </button>
        {forgotOpen && <ForgotPassword initialDni={dni} />}
      </div>

      <div className="rounded-3xl bg-[color:var(--primary-soft)] p-5 text-base">
        ¿Es tu primera vez? Si el centro te dio un código de invitación,{" "}
        <Link to="/portal/activar" className="font-bold text-[color:var(--primary-deep)] underline underline-offset-2">activá tu cuenta →</Link>
      </div>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        El portal no muestra información clínica. Es optativo: si no lo usás, la atención sigue igual.
      </p>

      {PORTAL_MOCK && <DemoBox />}
    </div>
  );
}

function ForgotPassword({ initialDni }: { initialDni: string }) {
  const [dni, setDni] = useState(initialDni);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidDni(dni)) { setError("Revisá tu DNI: tiene que tener entre 6 y 10 números."); return; }
    setSending(true);
    const r = await portalApi.requestRecovery(dni);
    setSending(false);
    if (!r.ok) { setError(r.status === 429 ? "Hiciste muchos pedidos. Probá más tarde." : r.error); return; }
    setDone(true);
  }

  return (
    <form id="portal-forgot" onSubmit={ask} noValidate className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4">
      {done ? (
        <p role="status" className="text-base">Si tenés una cuenta, el centro te va a contactar para darte un código nuevo.</p>
      ) : (
        <>
          <p className="text-base">Pedí un código nuevo: el centro te lo manda al teléfono que confirmó con vos. También podés <CallUs /> (solo llamadas).</p>
          <label htmlFor="portal-forgot-dni" className="text-base font-bold">Tu DNI</label>
          <input id="portal-forgot-dni" inputMode="numeric" value={dni}
            onChange={(e) => setDni(normalizeDni(e.target.value))} className={inputClass} />
          {error && <p role="alert" className="text-base font-semibold text-[oklch(0.48_0.19_25)]">{error}</p>}
          <button type="submit" disabled={sending} className={pillOutline}>
            {sending ? "Enviando…" : "Pedir un código nuevo"}
          </button>
        </>
      )}
      <Link to="/portal/activar" className="min-h-11 text-base font-bold text-primary underline-offset-2 hover:underline">
        Ya tengo un código
      </Link>
    </form>
  );
}

// Solo en modo mock: datos para probar el portal
function DemoBox() {
  async function reset() {
    const m = await import("@/integrations/supabase/mockPortal");
    m.resetDemo();
    toast.success("Demo reiniciada.");
  }
  return (
    <aside className="rounded-3xl border-2 border-dashed border-primary/30 bg-card p-5 text-sm">
      <p className="font-display text-base font-bold text-[color:var(--primary-deep)]">Modo demo (datos de prueba)</p>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
        <li>Laura (2 chicos): DNI <b>30111222</b> · contraseña <b>familia2026</b></li>
        <li>Jorge (papá de Valentina, adulto autorizado de Martín: no puede pedir copia de su historial): DNI <b>28999888</b> · contraseña <b>familia2026</b></li>
        <li>Activar cuenta: código <b>24680 13579</b> con DNI <b>27444555</b></li>
        <li>Contraseña nueva para Laura: código <b>97531 86420</b> con DNI <b>30111222</b></li>
      </ul>
      <button type="button" onClick={reset} className="mt-3 min-h-11 font-bold text-primary underline-offset-2 hover:underline">
        Reiniciar demo
      </button>
    </aside>
  );
}
