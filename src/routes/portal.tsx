import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, CircleHelp, House, Loader2, LogOut } from "lucide-react";
import logoTortuga from "../assets/logo-tortuga.png";
import { CENTER } from "@/lib/center";
import { PORTAL_ENABLED, portalApi } from "@/lib/portal";

// Marco del Portal de familias. No usa <Layout>: el portal no muestra el chat
// de Migue (en un área con sesión las familias escribirían datos de sus hijos)
// ni el botón "Solicitar turno" del sitio.

export const Route = createFileRoute("/portal")({
  head: () => ({
    meta: [
      { title: "Portal de familias — CIMT" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalLayout,
});

// Pantallas que se ven sin sesión
const PUBLIC_PATHS = ["/portal/ingresar", "/portal/activar", "/portal/ayuda"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname === `${p}/`);
}

function PortalLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [session, setSession] = useState<"checking" | "in" | "out">("checking");

  // La sesión vive en el navegador: se revisa recién al montar.
  // Al salir del portal (por ejemplo, "Volver al sitio") este marco todavía
  // ve la dirección nueva antes de desmontarse: fuera de /portal no se hace nada.
  useEffect(() => {
    if (!pathname.startsWith("/portal")) return;
    let cancelled = false;
    portalApi.hasSession().then((has) => {
      if (cancelled) return;
      setSession(has ? "in" : "out");
      if (!has && !isPublic(pathname)) {
        navigate({ to: "/portal/ingresar", search: { volver: pathname }, replace: true });
      }
    });
    return () => { cancelled = true; };
  }, [pathname, navigate]);

  async function signOut() {
    await portalApi.logout();
    setSession("out");
    navigate({ to: "/portal/ingresar", search: { salir: 1 } });
  }

  const signedIn = session === "in";
  const waiting = session === "checking" || (session === "out" && !isPublic(pathname));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between gap-3 px-4">
          <Link to="/portal" className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-border/40 bg-white shadow-[var(--shadow-card)]">
              <img src={logoTortuga} alt="" className="h-9 w-9 object-contain" />
            </div>
            <div className="leading-tight">
              <div className="font-display text-base font-bold text-[color:var(--primary-deep)]">CIMT</div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Portal de familias</div>
            </div>
          </Link>
          {signedIn ? (
            <button type="button" onClick={signOut}
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-[color:var(--primary-deep)] hover:bg-[color:var(--primary-soft)]">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Salir
            </button>
          ) : session === "out" && (
            // Sin sesión, la salida es volver al sitio público
            <Link to="/"
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-border/60 bg-card px-3.5 text-sm font-semibold text-[color:var(--primary-deep)] hover:bg-[color:var(--primary-soft)]">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Volver al sitio
            </Link>
          )}
        </div>
      </header>

      <main id="contenido" className="bg-notebook flex-1">
        <div className={`mx-auto w-full max-w-2xl px-4 pt-6 ${signedIn ? "pb-28" : "pb-12"}`}>
          {!PORTAL_ENABLED ? (
            <Unavailable />
          ) : waiting ? (
            <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
              Cargando…
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>

      <footer className="border-t border-border/60 bg-background px-4 py-5 text-center text-sm text-muted-foreground">
        {/* Con sesión, la barra de abajo es fija: el pie deja lugar para que no la tape */}
        <span className={signedIn ? "mb-16 block" : "block"}>
          ¿Dudas? Llamanos al <a href={CENTER.phoneHref} className="font-semibold text-[color:var(--primary-deep)] underline-offset-2 hover:underline">{CENTER.phoneDisplay}</a> ({CENTER.phoneNote.toLowerCase()}) · {CENTER.hoursLong} · {CENTER.address}
          <Link to="/" className="mt-2 block min-h-11 font-semibold text-[color:var(--primary-deep)] underline-offset-2 hover:underline">
            Ir al sitio del CIMT
          </Link>
        </span>
      </footer>

      {signedIn && PORTAL_ENABLED && <BottomNav pathname={pathname} />}
    </div>
  );
}

function BottomNav({ pathname }: { pathname: string }) {
  const items = [
    { to: "/portal", label: "Inicio", icon: House, active: !pathname.startsWith("/portal/ayuda") },
    { to: "/portal/ayuda", label: "Ayuda", icon: CircleHelp, active: pathname.startsWith("/portal/ayuda") },
  ] as const;
  return (
    <nav aria-label="Portal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <div className="mx-auto grid max-w-2xl grid-cols-2">
        {items.map(({ to, label, icon: Icon, active }) => (
          <Link key={to} to={to} aria-current={active ? "page" : undefined}
            className={`flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${active ? "text-primary" : "text-muted-foreground"}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function Unavailable() {
  return (
    <div className="rounded-3xl border border-border/60 bg-card p-6 text-center shadow-[var(--shadow-card)]">
      <h1 className="font-hand text-4xl text-[color:var(--primary-deep)]">Portal de familias</h1>
      <p className="mt-3 text-base text-muted-foreground">
        El portal todavía no está disponible. Para consultas sobre turnos, llamanos al {CENTER.phoneDisplay} ({CENTER.phoneNote.toLowerCase()}).
      </p>
    </div>
  );
}
