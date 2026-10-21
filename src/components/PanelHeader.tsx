import { ExternalLink } from "lucide-react";
import logoTortuga from "@/assets/logo-tortuga.png";
import { CENTER } from "@/lib/center";

// Barra de arriba del panel del equipo: reemplaza el menú del sitio público
// (dentro del panel ese menú confundía). Mide 56 px: la grilla de la agenda
// se pega justo debajo (STICKY_TOP en AgendaTab).
export function PanelHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/90 backdrop-blur-md">
      <div className="container mx-auto flex h-14 items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/40 bg-white shadow-[var(--shadow-card)]">
            <img src={logoTortuga} alt="" className="h-7 w-7 object-contain" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-display text-sm font-bold text-[color:var(--primary-deep)]">CIMT · Panel del equipo</div>
            <div className="hidden truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:block">
              {CENTER.name}
            </div>
          </div>
        </div>
        <a href="/" target="_blank" rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-[color:var(--primary-deep)] transition-colors hover:border-primary hover:bg-[color:var(--primary-soft)]">
          Ver el sitio <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    </header>
  );
}
