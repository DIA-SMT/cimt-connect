import { Link } from "@tanstack/react-router";
import logoTortuga from "../assets/logo-tortuga.png";

export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <Link to="/" className="flex items-center gap-2.5 group">
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
        <nav className="flex items-center gap-1 sm:gap-2">
          <NavLink to="/">Inicio</NavLink>
          <NavLink to="/explora">Explorá</NavLink>
          <NavLink to="/profesionales">Profesionales</NavLink>
          <NavLink to="/turnos">Turnos</NavLink>
          <Link
            to="/turnos"
            className="ml-2 hidden rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)] transition-all hover:bg-[color:var(--primary-deep)] hover:shadow-[var(--shadow-elegant)] sm:inline-block"
          >
            Solicitar turno
          </Link>
        </nav>
      </div>
    </header>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-[color:var(--primary-soft)] hover:text-[color:var(--primary-deep)] data-[status=active]:bg-[color:var(--primary-soft)] data-[status=active]:text-[color:var(--primary-deep)]"
    >
      {children}
    </Link>
  );
}