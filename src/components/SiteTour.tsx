import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Footprints, HelpCircle, Volume2, VolumeX, X } from "lucide-react";
import {
  SITE_TOUR, TEXT_SIZE_KEY, TOUR_SEEN_KEY, type TextSize, nextTextSize, parseTextSize, spokenText,
} from "@/lib/siteTour";

// Recorrido accesible del sitio público (src/lib/siteTour.ts):
//   - la primera vez que alguien entra al inicio, una bienvenida con opciones
//     grandes: hacer el recorrido, hacerlo escuchándolo o agrandar la letra;
//   - el recorrido resalta el lugar real de la página con un borde grueso y
//     explica en una tarjeta grande abajo (en el celular, también abajo);
//   - se maneja con teclado (Tab queda dentro de la tarjeta, Escape cierra,
//     flechas para ir y volver), el lector de pantalla anuncia cada paso, y se
//     respeta "menos animaciones";
//   - «Ayuda», en el encabezado, lo vuelve a abrir desde cualquier página.
// Lo único que se guarda es en este navegador: si ya se vio y el tamaño de letra.

type TourCtx = { start: (voice?: boolean) => void };
const TourContext = createContext<TourCtx | null>(null);

const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: no pasa nada */ }
}

function speak(text: string) {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-AR";
  const voice = synth.getVoices().find((v) => v.lang.startsWith("es-AR")) ?? synth.getVoices().find((v) => v.lang.startsWith("es"));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  synth.speak(u);
}
const stopSpeaking = () => { if (canSpeak()) window.speechSynthesis.cancel(); };

// Tamaño de la letra de todo el sitio (el sitio usa rem: escala todo junto)
function useTextSize(): [TextSize, (s: TextSize) => void] {
  const [size, setSize] = useState<TextSize>(100);
  useEffect(() => { setSize(parseTextSize(readStorage(TEXT_SIZE_KEY))); }, []);
  useEffect(() => {
    document.documentElement.style.fontSize = size === 100 ? "" : `${size}%`;
    return () => { document.documentElement.style.fontSize = ""; };
  }, [size]);
  const set = useCallback((s: TextSize) => { setSize(s); writeStorage(TEXT_SIZE_KEY, String(s)); }, []);
  return [size, set];
}

export function SiteTourProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [voice, setVoice] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [textSize, setTextSize] = useTextSize();

  const start = useCallback((withVoice = false) => {
    writeStorage(TOUR_SEEN_KEY, "1");
    setWelcome(false);
    // El recorrido es del inicio: desde otra página, primero se va ahí
    if (window.location.pathname !== "/") {
      navigate({ to: "/", hash: withVoice ? "recorrido-voz" : "recorrido" });
      return;
    }
    setIndex(0);
    setVoice(withVoice && canSpeak());
    setActive(true);
  }, [navigate]);

  // En el inicio: #recorrido lo abre; la primera visita ofrece la bienvenida
  useEffect(() => {
    if (window.location.pathname !== "/") return;
    const hash = window.location.hash.slice(1);
    if (hash === "recorrido" || hash === "recorrido-voz") {
      history.replaceState(null, "", "/");
      setIndex(0);
      setVoice(hash === "recorrido-voz" && canSpeak());
      setActive(true);
      return;
    }
    if (readStorage(TOUR_SEEN_KEY)) return;
    const t = setTimeout(() => setWelcome(true), 900);
    return () => clearTimeout(t);
  }, []);

  function close() {
    stopSpeaking();
    setActive(false);
    writeStorage(TOUR_SEEN_KEY, "1");
  }

  return (
    <TourContext.Provider value={{ start }}>
      {children}
      {welcome && !active && (
        <WelcomeDialog textSize={textSize} onTextSize={setTextSize} onStart={start}
          onLater={() => { writeStorage(TOUR_SEEN_KEY, "1"); setWelcome(false); }} />
      )}
      {active && (
        <TourOverlay index={index} voice={voice} textSize={textSize}
          onIndex={setIndex} onVoice={setVoice} onTextSize={setTextSize} onClose={close} />
      )}
    </TourContext.Provider>
  );
}

/** «Ayuda» del encabezado (fuera del sitio público no se muestra) */
export function TourButton({ variant = "header", onDone }: { variant?: "header" | "menu"; onDone?: () => void }) {
  const ctx = useContext(TourContext);
  if (!ctx) return null;
  if (variant === "menu") {
    return (
      <button type="button" onClick={() => { onDone?.(); ctx.start(); }}
        className="col-span-2 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 text-left font-semibold text-amber-950 sm:col-span-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white">
          <HelpCircle className="h-5 w-5" aria-hidden="true" />
        </span>
        Ayuda: cómo usar este sitio, paso a paso
      </button>
    );
  }
  return (
    <button type="button" data-tour="ayuda" onClick={() => ctx.start()}
      title="Cómo usar este sitio, paso a paso" aria-label="Ayuda: cómo usar este sitio, paso a paso"
      className="flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-2 border-amber-300 bg-amber-50 px-2 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-100 xl:px-3">
      <HelpCircle className="h-4 w-4" aria-hidden="true" />
      <span className="hidden xl:inline">Ayuda</span>
    </button>
  );
}

// ── Bienvenida (primera visita al inicio) ───────────────────────────────────

function WelcomeDialog({ textSize, onTextSize, onStart, onLater }: {
  textSize: TextSize; onTextSize: (s: TextSize) => void; onStart: (voice?: boolean) => void; onLater: () => void;
}) {
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const big = textSize > 100;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center"
      onKeyDown={(e) => { if (e.key === "Escape") onLater(); trapTab(e, box.current); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-lg rounded-3xl border-2 border-primary/30 bg-card p-6 shadow-2xl">
        <h2 id={titleId} className="font-display text-2xl font-bold text-[color:var(--primary-deep)]">¿Es tu primera vez acá?</h2>
        <p className="mt-2 text-lg leading-relaxed">Te mostramos cómo usar el sitio en {SITE_TOUR.length} pasos cortos.</p>
        <div className="mt-5 flex flex-col gap-3">
          <button ref={first} type="button" onClick={() => onStart(false)} className={bigOption("bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]")}>
            <Footprints className="h-6 w-6 shrink-0" aria-hidden="true" /> Hacer el recorrido
          </button>
          {canSpeak() && (
            <button type="button" onClick={() => onStart(true)} className={bigOption("border-2 border-primary/40 bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]")}>
              <Volume2 className="h-6 w-6 shrink-0" aria-hidden="true" /> Hacer el recorrido escuchándolo
            </button>
          )}
          <button type="button" aria-pressed={big} onClick={() => onTextSize(big ? 100 : 130)}
            className={bigOption("border-2 border-amber-300 bg-amber-50 text-amber-950")}>
            <span aria-hidden="true" className="w-6 shrink-0 text-center font-display text-xl font-extrabold">A+</span>
            {big ? "Volver a la letra normal" : "Agrandar la letra"}
          </button>
        </div>
        <button type="button" onClick={onLater} className="mt-4 min-h-11 w-full rounded-full text-base font-semibold text-muted-foreground underline-offset-2 hover:underline">
          Ahora no (está en «Ayuda», arriba)
        </button>
      </div>
    </div>
  );
}

const bigOption = (tone: string) =>
  `flex min-h-14 w-full items-center gap-3 rounded-2xl px-5 py-3 text-left text-lg font-bold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 ${tone}`;

// Tab y Shift+Tab quedan dentro de la tarjeta
function trapTab(e: React.KeyboardEvent, box: HTMLElement | null) {
  if (e.key !== "Tab" || !box) return;
  const items = [...box.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
  if (!items.length) return;
  const firstEl = items[0];
  const lastEl = items[items.length - 1];
  if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
  else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
}

// ── El recorrido ────────────────────────────────────────────────────────────

// El primer lugar de la lista que se vea en pantalla (compu o celular)
function findTarget(selectors?: string[]): HTMLElement | null {
  for (const s of selectors ?? []) {
    for (const el of document.querySelectorAll<HTMLElement>(s)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

function TourOverlay({ index, voice, textSize, onIndex, onVoice, onTextSize, onClose }: {
  index: number; voice: boolean; textSize: TextSize;
  onIndex: (i: number) => void; onVoice: (v: boolean) => void; onTextSize: (s: TextSize) => void; onClose: () => void;
}) {
  const step = SITE_TOUR[index];
  const total = SITE_TOUR.length;
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
          {SITE_TOUR.map((s, i) => (
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
          <div className="flex items-center rounded-full border-2 border-amber-300 bg-amber-50 text-amber-950">
            <button type="button" onClick={() => onTextSize(nextTextSize(textSize, -1))} disabled={textSize === 100}
              aria-label="Letra más chica" className="min-h-11 rounded-l-full px-3 text-base font-extrabold disabled:opacity-40">A−</button>
            <span className="px-1 text-sm font-semibold" aria-live="polite">{textSize}%</span>
            <button type="button" onClick={() => onTextSize(nextTextSize(textSize, 1))} disabled={textSize === 130}
              aria-label="Letra más grande" className="min-h-11 rounded-r-full px-3 text-base font-extrabold disabled:opacity-40">A+</button>
          </div>
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
