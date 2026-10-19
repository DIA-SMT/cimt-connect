import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Volume2, VolumeX, X } from "lucide-react";
import { type TextSize, type TourStep, type TourTarget, nextTextSize, spokenText } from "@/lib/siteTour";
import { reducedMotion, canSpeak, speak, stopSpeaking, trapTab } from "./tourHelpers";

// Recorrido paso a paso, accesible, que comparten el sitio público (SiteTour)
// y el panel (PanelGuide):
//   - resalta el lugar real de la página con un borde amarillo grueso y
//     oscurece el resto; si el paso no tiene lugar, oscurece todo;
//   - la tarjeta va abajo (también en el celular), con letra grande;
//   - teclado: Tab queda dentro de la tarjeta, Escape cierra, flechas para
//     ir y volver; el lector de pantalla anuncia cada paso;
//   - voz del navegador (no se graba nada) y "menos animaciones".

const visible = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// El primer lugar de la lista que se vea en pantalla (compu o celular). Un
// lugar es un selector CSS o un texto visible (un botón «Nuevo turno»), así
// no hace falta marcar cada botón del panel
function findTarget(targets?: TourTarget[]): HTMLElement | null {
  for (const t of targets ?? []) {
    if (typeof t === "string") {
      for (const el of document.querySelectorAll<HTMLElement>(t)) if (visible(el)) return el;
      continue;
    }
    const root = t.within ? document.querySelector<HTMLElement>(t.within) : document.body;
    if (!root) continue;
    const want = norm(t.text);
    for (const el of root.querySelectorAll<HTMLElement>(t.tag ?? "button, a, h2, h3, label")) {
      if (norm(el.textContent ?? "").startsWith(want) && visible(el)) return el;
    }
  }
  return null;
}

export function GuidedTour({ steps, index, voice, textSize, onIndex, onVoice, onTextSize, onClose }: {
  steps: TourStep[]; index: number; voice: boolean;
  onIndex: (i: number) => void; onVoice: (v: boolean) => void; onClose: () => void;
  /** Con tamaño de letra (sitio público): botones A− y A+ */
  textSize?: TextSize; onTextSize?: (s: TextSize) => void;
}) {
  const step = steps[index];
  const total = steps.length;
  const last = index === total - 1;
  const titleId = useId();
  const textId = useId();
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Lleva el lugar a la vista (arriba de la tarjeta) y sigue su posición
  useLayoutEffect(() => {
    const el = findTarget(step.targets);
    if (!el) { setRect(null); return; }
    if (!el.closest("header")) {
      const top = el.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
    }
    let raf = 0;
    const update = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setRect(el.getBoundingClientRect())); };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [step]);

  // Foco en el título del paso (el lector de pantalla lo anuncia) y, si está
  // la voz, lo lee
  useEffect(() => {
    heading.current?.focus();
    if (voice) speak(spokenText(step, index, total));
  }, [step, index, total, voice]);

  useEffect(() => () => stopSpeaking(), []);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowRight" && !last) { e.preventDefault(); onIndex(index + 1); return; }
    if (e.key === "ArrowLeft" && index > 0) { e.preventDefault(); onIndex(index - 1); return; }
    trapTab(e, card.current);
  }

  const pad = 8;
  return (
    <div className="fixed inset-0 z-[70]" onKeyDown={onKey}>
      {/* Fondo oscuro con un hueco y un borde grueso sobre el lugar del paso */}
      {rect ? (
        <div aria-hidden="true" data-tour-highlight className="pointer-events-none fixed rounded-2xl transition-[top,left,width,height] duration-200 motion-reduce:transition-none"
          style={{
            top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
            // Borde amarillo grueso (outline: el box-shadow es el fondo oscuro)
            outline: "4px solid #fbbf24", outlineOffset: 0,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.65)",
          }} />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-slate-950/65" />
      )}

      <div ref={card} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId}
        className="fixed inset-x-3 bottom-3 mx-auto max-w-xl rounded-3xl border-2 border-primary/30 bg-card p-5 shadow-2xl sm:bottom-6 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-bold uppercase tracking-wider text-primary">Paso {index + 1} de {total}</p>
          <button type="button" onClick={onClose} aria-label="Cerrar el recorrido"
            className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        <h2 ref={heading} id={titleId} tabIndex={-1} aria-live="polite"
          className="font-display text-2xl font-bold text-[color:var(--primary-deep)] outline-none">{step.title}</h2>
        <p id={textId} className="mt-2 text-lg leading-relaxed">{step.text}</p>

        {/* Puntitos de avance (además del "Paso 2 de 8") */}
        <div aria-hidden="true" className="mt-4 flex gap-1.5">
          {steps.map((s, i) => (
            <span key={s.id} className={`h-2 flex-1 rounded-full ${i <= index ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canSpeak() && (
            <button type="button" aria-pressed={voice}
              onClick={() => { if (voice) { stopSpeaking(); onVoice(false); } else { onVoice(true); speak(spokenText(step, index, total)); } }}
              className="flex min-h-11 items-center gap-2 rounded-full border-2 border-primary/30 px-4 text-base font-semibold text-[color:var(--primary-deep)] hover:bg-[color:var(--primary-soft)]">
              {voice ? <VolumeX className="h-5 w-5" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
              {voice ? "Silenciar" : "Escuchar"}
            </button>
          )}
          {textSize !== undefined && onTextSize && (
            <div className="flex items-center rounded-full border-2 border-amber-300 bg-amber-50 text-amber-950">
              <button type="button" onClick={() => onTextSize(nextTextSize(textSize, -1))} disabled={textSize === 100}
                aria-label="Letra más chica" className="min-h-11 rounded-l-full px-3 text-base font-extrabold disabled:opacity-40">A−</button>
              <span className="px-1 text-sm font-semibold" aria-live="polite">{textSize}%</span>
              <button type="button" onClick={() => onTextSize(nextTextSize(textSize, 1))} disabled={textSize === 130}
                aria-label="Letra más grande" className="min-h-11 rounded-r-full px-3 text-base font-extrabold disabled:opacity-40">A+</button>
            </div>
          )}
          <div className="ml-auto flex gap-2">
            {index > 0 && (
              <button type="button" onClick={() => onIndex(index - 1)}
                className="flex min-h-12 items-center gap-1.5 rounded-full border-2 border-border px-4 text-base font-bold hover:bg-muted">
                <ArrowLeft className="h-5 w-5" aria-hidden="true" /> Anterior
              </button>
            )}
            <button type="button" onClick={() => (last ? onClose() : onIndex(index + 1))}
              className="flex min-h-12 items-center gap-1.5 rounded-full bg-primary px-5 text-base font-bold text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {last ? "Terminar" : <>Siguiente <ArrowRight className="h-5 w-5" aria-hidden="true" /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
