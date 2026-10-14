import { CENTER } from "@/lib/center";
import type { ApptDTO, ApptTone } from "@/lib/portal";

// Clases y formato compartidos del Portal de familias (separados de ui.tsx
// para que la recarga en caliente funcione: ese archivo exporta solo componentes).

export const pillPrimary =
  "inline-flex h-12 items-center justify-center rounded-full bg-primary px-5 text-base font-bold text-primary-foreground shadow-sm transition-colors hover:bg-[color:var(--primary-deep)] disabled:cursor-not-allowed disabled:opacity-50";
export const pillOutline =
  "inline-flex h-12 items-center justify-center rounded-full border-2 border-primary/30 bg-card px-5 text-base font-bold text-[color:var(--primary-deep)] transition-colors hover:border-primary hover:bg-[color:var(--primary-soft)] disabled:cursor-not-allowed disabled:opacity-50";
export const card = "rounded-3xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]";
export const inputClass =
  "h-12 w-full rounded-2xl border border-input bg-[color:var(--muted)] px-4 text-base outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary/60 focus:bg-card focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-destructive";
export const textareaClass =
  "min-h-28 w-full resize-y rounded-2xl border border-input bg-[color:var(--muted)] px-4 py-3 text-base outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary/60 focus:bg-card focus:ring-2 focus:ring-primary/20 aria-[invalid=true]:border-destructive";
// Opción grande de un formulario (radio o casilla con el input oculto): la
// elegida se marca con el borde y el fondo, además del círculo o la tilde.
// compact: para opciones cortas en grilla (los días de la semana)
export const choiceClass = (on: boolean, compact = false) =>
  `flex min-h-12 cursor-pointer items-center rounded-2xl border-2 py-2 text-left text-base font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2 ${
    compact ? "gap-2 px-3" : "gap-3 px-4"
  } ${
    on ? "border-primary bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]" : "border-border/60 bg-card hover:border-primary/50"
  }`;
// Título de cada sección de una pantalla ("Esta semana", "Tus pedidos"…)
export const sectionTitle = "font-display text-sm font-bold uppercase tracking-widest text-muted-foreground";
// Fila de ancho completo que lleva a otra pantalla ("Información de Martina →")
export const rowLink =
  "flex min-h-12 w-full items-center gap-3 rounded-2xl bg-[color:var(--primary-soft)] px-4 py-2 text-base font-bold text-[color:var(--primary-deep)] transition-colors hover:bg-primary/15";
// Cuadradito de acceso en la tarjeta de cada persona ("Turnos", "Mi información")
export const tileLink =
  "relative flex min-h-32 min-w-0 flex-1 flex-col justify-between gap-3 rounded-2xl border border-primary/15 bg-[color:var(--primary-soft)] p-4 text-[color:var(--primary-deep)] transition-colors hover:border-primary/40 hover:bg-primary/15";
// El mismo acceso cuando es el único de la tarjeta: ocupa todo el ancho, en una fila
export const tileWideLink =
  "flex min-h-16 w-full min-w-0 items-center gap-3 rounded-2xl border border-primary/15 bg-[color:var(--primary-soft)] px-4 py-3 text-[color:var(--primary-deep)] transition-colors hover:border-primary/40 hover:bg-primary/15";
// Marca de lo que esta cuenta todavía no abrió (siempre con el texto "Nuevo")
export const newChip =
  "inline-flex shrink-0 items-center rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-primary-foreground print:hidden";

// Colores de texto de estado con buen contraste sobre los fondos --status-*-bg
export const TONE_CLASS: Record<ApptTone, string> = {
  ok: "bg-[color:var(--status-available-bg)] text-[oklch(0.42_0.12_150)]",
  warn: "bg-[color:var(--status-pending-bg)] text-[oklch(0.45_0.11_70)]",
  bad: "bg-[color:var(--status-occupied-bg)] text-[oklch(0.48_0.19_25)]",
  info: "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]",
  muted: "bg-muted text-muted-foreground",
};

// "Ahora no" del aviso de la información de salud en el inicio: se vuelve a
// mostrar a los 30 días. Solo es una comodidad de este navegador: si el
// almacenamiento no está disponible, el aviso se muestra igual.
const CLINICAL_SNOOZE_KEY = "cimt-portal-salud-ahora-no";
const CLINICAL_SNOOZE_MS = 30 * 24 * 3_600_000;

export function snoozeClinicalNotice(): void {
  try { localStorage.setItem(CLINICAL_SNOOZE_KEY, String(Date.now())); } catch { /* sin almacenamiento */ }
}

export function clinicalNoticeSnoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(CLINICAL_SNOOZE_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < CLINICAL_SNOOZE_MS;
  } catch {
    return false;
  }
}

export function apptMeta(a: ApptDTO): string {
  const where = a.modality === "presencial" ? `Presencial · ${CENTER.address}` : "Telemedicina";
  return a.professional_name ? `${where} · con ${a.professional_name}` : where;
}
