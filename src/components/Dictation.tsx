import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";

// Dictado por voz para quien no puede o no quiere escribir: un botón de
// micrófono al lado del campo; lo que se dice se escribe solo. Usa el
// reconocimiento de voz del navegador (Chrome, Edge, Safari): no guardamos
// ningún audio. Si el navegador no lo tiene, el botón no aparece.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Recognition = any;

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** ¿Este navegador puede dictar? (se decide en el cliente, después de montar) */
export function useDictationSupported(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => { setOk(!!recognitionClass()); }, []);
  return ok;
}

/** Agrega el texto dictado al campo (sirve para campos no controlados) */
export function appendDictation(current: string, spoken: string, numeric: boolean): string {
  if (numeric) return current + spoken.replace(/\D/g, "");
  const text = spoken.trim();
  if (!text) return current;
  if (!current.trim()) return text.charAt(0).toUpperCase() + text.slice(1);
  return `${current.replace(/\s+$/, "")} ${text}`;
}

export function DictationButton({ targetId, label, numeric = false }: { targetId: string; label: string; numeric?: boolean }) {
  const supported = useDictationSupported();
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.abort?.(), []);

  if (!supported) return null;

  function start() {
    const R = recognitionClass();
    if (!R) return;
    const r = new R();
    r.lang = "es-AR";
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const spoken = e.results[0]?.[0]?.transcript ?? "";
      const el = document.getElementById(targetId) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return;
      const value = appendDictation(el.value, spoken, numeric);
      // Setter nativo + evento input: así React y el formulario ven el cambio
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
    };
    r.onerror = (e: { error?: string }) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast.error("Para dictar, permití que el navegador use el micrófono");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        toast.error("No se pudo usar el dictado. Probá de nuevo o escribilo.");
      }
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  }

  return (
    <button type="button" onClick={() => (listening ? rec.current?.stop() : start())}
      aria-label={listening ? `Terminar de dictar: ${label}` : `Dictar con la voz: ${label}`} aria-pressed={listening}
      title={listening ? "Te estoy escuchando… tocá para terminar" : "Dictar con la voz"}
      className={[
        "absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full transition-colors",
        listening ? "animate-pulse bg-red-600 text-white" : "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)] hover:bg-primary hover:text-primary-foreground",
      ].join(" ")}>
      {listening ? <Square className="h-3.5 w-3.5" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
