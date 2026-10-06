import { CENTER } from "@/lib/center";
import type { ApptDTO } from "@/lib/portal";

// Clases y formato compartidos del Portal de familias (separados de ui.tsx
// para que la recarga en caliente funcione: ese archivo exporta solo componentes).

export const pillPrimary =
  "inline-flex h-12 items-center justify-center rounded-full bg-primary px-5 text-base font-bold text-primary-foreground shadow-sm transition-colors hover:bg-[color:var(--primary-deep)] disabled:cursor-not-allowed disabled:opacity-50";
export const pillOutline =
  "inline-flex h-12 items-center justify-center rounded-full border-2 border-primary/30 bg-card px-5 text-base font-bold text-[color:var(--primary-deep)] transition-colors hover:border-primary hover:bg-[color:var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-50";
export const card = "rounded-3xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]";
export const inputClass =
  "h-12 w-full rounded-2xl border border-input bg-[color:var(--muted)] px-4 text-base outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary/60 focus:bg-card focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-destructive";

export function apptMeta(a: ApptDTO): string {
  const where = a.modality === "presencial" ? `Presencial · ${CENTER.address}` : "Telemedicina";
  return a.professional_name ? `${where} · con ${a.professional_name}` : where;
}
