import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, HeartHandshake, House, Menu, Sparkles, Stethoscope, UserRound, X } from "lucide-react";
import logoTortuga from "../assets/logo-tortuga.png";
import migueAvatar from "@/assets/migue-avatar.jpg";
import { PORTAL_ENABLED } from "@/lib/portal";
import { CENTER } from "@/lib/center";
import { TourButton } from "./SiteTour";

// Menú del sitio: cada sección con su ícono y su color, para reconocerla de un
// vistazo. Las clases van completas (Tailwind no ve clases armadas por partes).
const NAV = [
  {
    to: "/", label: "Inicio", icon: House,
    bubble: "bg-sky-600 text-white shadow-sm", bubbleActive: "group-data-[status=active]:bg-sky-700 group-data-[status=active]:ring-2 group-data-[status=active]:ring-sky-300",
    item: "hover:bg-sky-50 data-[status=active]:bg-sky-100 data-[status=active]:text-sky-950", card: "border-sky-200 bg-sky-50 text-sky-950",
  },
  {
    to: "/explora", label: "Explorá", image: migueAvatar, // la cara de Migue, que guía el cuestionario
    bubble: "bg-violet-600 text-white shadow-sm", bubbleActive: "group-data-[status=active]:bg-violet-700 group-data-[status=active]:ring-2 group-data-[status=active]:ring-violet-300",
    item: "hover:bg-violet-50 data-[status=active]:bg-violet-100 data-[status=active]:text-violet-950", card: "border-violet-200 bg-violet-50 text-violet-950",
  },
  {
    to: "/profesionales", label: "Profesionales", icon: Stethoscope,
    bubble: "bg-teal-600 text-white shadow-sm", bubbleActive: "group-data-[status=active]:bg-teal-700 group-data-[status=active]:ring-2 group-data-[status=active]:ring-teal-300",
    item: "hover:bg-teal-50 data-[status=active]:bg-teal-100 data-[status=active]:text-teal-950", card: "border-teal-200 bg-teal-50 text-teal-950",
  },
  {
    to: "/familias", label: "Familias", icon: HeartHandshake,
    bubble: "bg-rose-600 text-white shadow-sm", bubbleActive: "group-data-[status=active]:bg-rose-700 group-data-[status=active]:ring-2 group-data-[status=active]:ring-rose-300",
    item: "hover:bg-rose-50 data-[status=active]:bg-rose-100 data-[status=active]:text-rose-950", card: "border-rose-200 bg-rose-50 text-rose-950",
  },
  {
    to: "/rincon", label: "Rincón social", icon: Sparkles,
    bubble: "bg-amber-600 text-white shadow-sm", bubbleActive: "group-data-[status=active]:bg-amber-700 group-data-[status=active]:ring-2 group-data-[status=active]:ring-amber-300",
    item: "hover:bg-amber-50 data-[status=active]:bg-amber-100 data-[status=active]:text-amber-950", card: "border-amber-200 bg-amber-50 text-amber-950",
  },
  {
    to: "/turnos", label: "Turnos", icon: CalendarCheck,
    bubble: "bg-emerald-600 text-white shadow-sm", bubbleActive: "group-data-[status=active]:bg-emerald-700 group-data-[status=active]:ring-2 group-data-[status=active]:ring-emerald-300",
    item: "hover:bg-emerald-50 data-[status=active]:bg-emerald-100 data-[status=active]:text-emerald-950", card: "border-emerald-200 bg-emerald-50 text-emerald-950",
  },
] as const;

type NavItem = (typeof NAV)[number];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur-md">
      <div className="container mx-auto flex h-[4.5rem] items-center justify-between gap-3 px-4 md:px-6">
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
            <div className="hidden max-w-[11.5rem] text-[10px] font-semibold uppercase leading-snug tracking-wide text-muted-foreground sm:block">
              {CENTER.name}
            </div>
          </div>
        </Link>

        {/* Escritorio: ícono arriba y nombre abajo */}
        <nav className="hidden items-center gap-0.5 lg:flex xl:gap-1.5">
          <div data-tour="menu" className="flex items-center gap-0.5 xl:gap-1.5">
            {NAV.map((item) => <DesktopLink key={item.to} item={item} />)}
          </div>
          <span className="ml-1"><TourButton /></span>
          <Link
            to="/turnos"
            data-tour="turno"
            className="ml-1 whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)] transition-all hover:bg-[color:var(--primary-deep)] hover:shadow-[var(--shadow-elegant)]"
          >
            Solicitar turno
          </Link>
          <Link
            to="/ingresar"
            title={PORTAL_ENABLED ? "Familias con cuenta (con DNI) y equipo del CIMT (con email)" : "Equipo del CIMT"}
            aria-label="Ingresar"
            className="ml-1 flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-primary/40 px-2 text-sm font-semibold text-[color:var(--primary-deep)] transition-colors hover:border-primary hover:bg-[color:var(--primary-soft)] xl:px-3.5"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            <span className="hidden xl:inline">Ingresar</span>
          </Link>
        </nav>

        {/* Celular y tablet */}
        <div className="flex items-center gap-2 lg:hidden">
          <Link to="/turnos" onClick={() => setOpen(false)} data-tour="turno-celular"
            className="rounded-full bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)]">
            Solicitar turno
          </Link>
          {/* En pantallas de menos de 360 px no entra: queda en el menú */}
          <Link to="/ingresar" onClick={() => setOpen(false)} aria-label="Ingresar"
            className="hidden h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-border bg-background text-sm font-semibold text-[color:var(--primary-deep)] min-[360px]:flex sm:px-3.5">
            <UserRound className="h-5 w-5" aria-hidden="true" />
            <span className="hidden sm:inline">Ingresar</span>
          </Link>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" data-tour="menu-celular"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-[color:var(--primary-deep)]">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Menú del celular: tarjetas de colores con su ícono */}
      {open && (
        <nav id="mobile-nav" className="border-t border-border bg-background lg:hidden">
          <div className="container mx-auto grid grid-cols-2 gap-2.5 px-4 py-4 sm:grid-cols-3">
            {NAV.map((item) => (
              <MobileLink key={item.to} item={item} onClick={() => setOpen(false)} />
            ))}
            <Link to="/ingresar" onClick={() => setOpen(false)}
              className="col-span-2 flex items-center gap-3 rounded-2xl border-2 border-primary/30 bg-[color:var(--primary-soft)]/60 p-3 font-semibold text-[color:var(--primary-deep)] sm:col-span-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <UserRound className="h-5 w-5" aria-hidden="true" />
              </span>
              {PORTAL_ENABLED ? "Ingresar (familias con cuenta y equipo)" : "Ingresar (equipo del CIMT)"}
            </Link>
            <TourButton variant="menu" onDone={() => setOpen(false)} />
          </div>
        </nav>
      )}
    </header>
  );
}

// Ícono de la sección, o la imagen si tiene (Explorá lleva la cara de Migue)
function NavIcon({ item, className }: { item: NavItem; className: string }) {
  if ("image" in item) {
    return <img src={item.image} alt="" aria-hidden="true" draggable={false} className="h-full w-full rounded-[inherit] bg-white object-cover" />;
  }
  const Icon = item.icon;
  return <Icon className={className} aria-hidden="true" />;
}

function DesktopLink({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      data-tour={item.to === "/explora" ? "explora" : undefined}
      className={`group flex min-w-[4.5rem] flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-[13px] font-semibold text-foreground/85 transition-colors xl:min-w-[5.25rem] ${item.item}`}
    >
      <span className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl transition-colors ${item.bubble} ${item.bubbleActive}`}>
        <NavIcon item={item} className="h-4 w-4" />
      </span>
      <span className="whitespace-nowrap leading-none">{item.label}</span>
    </Link>
  );
}

function MobileLink({ item, onClick }: { item: NavItem; onClick: () => void }) {
  return (
    <Link
      to={item.to}
      onClick={onClick}
      activeOptions={{ exact: item.to === "/" }}
      className={`group flex flex-col items-center gap-2 rounded-2xl border-2 px-2 py-3 text-center text-base font-semibold leading-tight data-[status=active]:ring-2 data-[status=active]:ring-current ${item.card}`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl ${item.bubble} ${item.bubbleActive}`}>
        <NavIcon item={item} className="h-6 w-6" />
      </span>
      {item.label}
    </Link>
  );
}
