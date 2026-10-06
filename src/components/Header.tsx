import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, UserRound, X } from "lucide-react";
import logoTortuga from "../assets/logo-tortuga.png";
import { PORTAL_ENABLED } from "@/lib/portal";

const NAV = [
  { to: "/", label: "Inicio" },
  { to: "/explora", label: "Explorá" },
  { to: "/profesionales", label: "Profesionales" },
  { to: "/familias", label: "Familias" },
  { to: "/rincon", label: "Rincón social" },
  { to: "/turnos", label: "Turnos" },
] as const;

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 group" onClick={() => setOpen(false)}>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-[var(--shadow-card)] transition-transform group-hover:scale-105 overflow-hidden border border-border/40">
            <img
              src={logoTortuga}
              alt="CIMT Logo"
              className="h-9 w-9 object-contain"
            />
          </div>
          <div className="leading-tight">
            <div className="font-display text-base font-bold text-[color:var(--primary-deep)]">CIMT</div>
            <div className="hidden text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:block">
              Centro Integral de Tartamudez
            </div>
          </div>
        </Link>

        {/* Escritorio */}
        <nav className="hidden items-center gap-1 lg:flex lg:gap-2">
          {NAV.map((item) => <NavLink key={item.to} to={item.to}>{item.label}</NavLink>)}
          <Link
            to="/turnos"
            className="ml-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)] transition-all hover:bg-[color:var(--primary-deep)] hover:shadow-[var(--shadow-elegant)]"
          >
            Solicitar turno
          </Link>
          {PORTAL_ENABLED && (
            <Link
              to="/portal"
              title="Portal de familias: ver los turnos y avisar si pueden venir"
              aria-label="Mi portal (Portal de familias)"
              className="flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-primary/30 px-2 text-sm font-semibold text-[color:var(--primary-deep)] transition-colors hover:border-primary hover:bg-[color:var(--primary-soft)] xl:px-3.5"
            >
              <UserRound className="h-4 w-4" aria-hidden="true" />
              <span className="hidden xl:inline">Mi portal</span>
            </Link>
          )}
        </nav>

        {/* Celular y tablet */}
        <div className="flex items-center gap-2 lg:hidden">
          <Link to="/turnos" onClick={() => setOpen(false)}
            className="rounded-full bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)]">
            Solicitar turno
          </Link>
          {PORTAL_ENABLED && (
            // En pantallas de menos de 360 px no entra: queda en el menú
            <Link to="/portal" onClick={() => setOpen(false)} aria-label="Mi portal (Portal de familias)"
              className="hidden h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-border bg-background text-sm font-semibold text-[color:var(--primary-deep)] min-[360px]:flex sm:px-3.5">
              <UserRound className="h-5 w-5" aria-hidden="true" />
              <span className="hidden sm:inline">Mi portal</span>
            </Link>
          )}
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-[color:var(--primary-deep)]">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" className="border-t border-border/60 bg-background lg:hidden">
          <div className="container mx-auto flex flex-col gap-1 px-4 py-3">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)} block>{item.label}</NavLink>
            ))}
            {PORTAL_ENABLED && <NavLink to="/portal" onClick={() => setOpen(false)} block>Mi portal (familias con cuenta)</NavLink>}
          </div>
        </nav>
      )}
    </header>
  );
}

function NavLink({ to, children, onClick, block }: { to: string; children: React.ReactNode; onClick?: () => void; block?: boolean }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      activeOptions={{ exact: to === "/" }}
      className={`${block ? "block px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"} rounded-full font-medium text-muted-foreground transition-colors hover:bg-[color:var(--primary-soft)] hover:text-[color:var(--primary-deep)] data-[status=active]:bg-[color:var(--primary-soft)] data-[status=active]:text-[color:var(--primary-deep)]`}
    >
      {children}
    </Link>
  );
}
