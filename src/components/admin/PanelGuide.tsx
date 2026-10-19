import { useEffect, useId, useRef, useState } from "react";
import { BookOpenCheck, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GuidedTour } from "@/components/GuidedTour";
import { stopSpeaking, trapTab } from "@/components/tourHelpers";
import { PANEL_GUIDES, PANEL_WELCOME, type PanelStep, type PanelTab, panelWelcomeKey, stepsFor } from "@/lib/panelGuide";
import { ROLE_LABEL, type Staff } from "@/lib/staff";

// «¿Cómo se hace?» del panel: la guía paso a paso de la pestaña en la que se
// está, con los pasos del rol de quien mira. La primera vez que alguien entra
// (en este navegador) se le ofrece la guía de bienvenida.

function seen(email: string): boolean {
  try { return !!localStorage.getItem(panelWelcomeKey(email)); } catch { return true; }
}
function markSeen(email: string) {
  try { localStorage.setItem(panelWelcomeKey(email), "1"); } catch { /* sin almacenamiento: no pasa nada */ }
}

export function PanelGuide({ tab, staff }: { tab: PanelTab; staff: Staff }) {
  const [steps, setSteps] = useState<PanelStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [voice, setVoice] = useState(false);
  const [offer, setOffer] = useState(false);

  useEffect(() => {
    if (seen(staff.email)) return;
    const t = setTimeout(() => setOffer(true), 800);
    return () => clearTimeout(t);
  }, [staff.email]);

  function open(list: PanelStep[]) {
    markSeen(staff.email);
    setOffer(false);
    setIndex(0);
    setVoice(false);
    setSteps(stepsFor(list, staff.role));
  }
  function close() {
    stopSpeaking();
    setSteps(null);
  }

  return (
    <>
      <Button variant="outline" size="sm" data-tour="guia-panel" onClick={() => open(PANEL_GUIDES[tab])}
        className="border-2 border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100">
        <HelpCircle className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> ¿Cómo se hace?
      </Button>
      {offer && !steps && (
        <WelcomeOffer name={staff.full_name} role={ROLE_LABEL[staff.role]}
          onStart={() => open(PANEL_WELCOME)} onLater={() => { markSeen(staff.email); setOffer(false); }} />
      )}
      {steps && steps.length > 0 && (
        <GuidedTour steps={steps} index={index} voice={voice} onIndex={setIndex} onVoice={setVoice} onClose={close} />
      )}
    </>
  );
}

function WelcomeOffer({ name, role, onStart, onLater }: { name: string | null; role: string; onStart: () => void; onLater: () => void }) {
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-4 sm:items-center"
      onKeyDown={(e) => { if (e.key === "Escape") onLater(); trapTab(e, box.current); }}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="w-full max-w-md rounded-3xl border-2 border-primary/30 bg-card p-6 shadow-2xl">
        <h2 id={titleId} className="font-display text-2xl font-bold text-[color:var(--primary-deep)]">
          {name ? `¡Hola, ${name.split(" ")[0]}!` : "¡Hola!"}
        </h2>
        <p className="mt-2 text-base leading-relaxed">
          Entraste al panel con el rol <strong>{role}</strong>. ¿Querés una guía rápida de cómo está organizado?
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button ref={first} type="button" onClick={onStart}
            className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-bold text-primary-foreground hover:bg-[color:var(--primary-deep)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-400">
            <BookOpenCheck className="h-5 w-5" aria-hidden="true" /> Sí, mostrame
          </button>
          <button type="button" onClick={onLater}
            className="min-h-11 rounded-full text-base font-semibold text-muted-foreground underline-offset-2 hover:underline">
            Ahora no (está en «¿Cómo se hace?»)
          </button>
        </div>
      </div>
    </div>
  );
}
