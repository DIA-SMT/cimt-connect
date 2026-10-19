import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { GuidedTour } from "./GuidedTour";
import { canSpeak, stopSpeaking, trapTab } from "./tourHelpers";
import { Footprints, HelpCircle, Volume2 } from "lucide-react";
import {
  SITE_TOUR, TEXT_SIZE_KEY, TOUR_SEEN_KEY, type TextSize, parseTextSize,
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


function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sin almacenamiento: no pasa nada */ }
}


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
        <GuidedTour steps={SITE_TOUR} index={index} voice={voice} textSize={textSize}
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
