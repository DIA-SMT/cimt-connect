import { useCallback, useEffect, useRef, useState } from "react";

// "Escuchar": la voz del propio aparato (nada sale del celular: solo voces
// locales; si no hay una en español, no aparece). La usan la pantalla de
// práctica y las actividades (portal y vista previa del panel).

export type Speech = { available: boolean; speaking: boolean; speak: (texts: string[]) => void; stop: () => void };

// Solo voces locales (localService): con una voz "en la nube" el texto saldría
// del celular. Primero es-AR, después otras de Latinoamérica y cualquier español
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const lang = (v: SpeechSynthesisVoice) => String(v.lang ?? "").replace("_", "-").toLowerCase();
  const local = voices.filter((v) => v.localService && /^es(-|$)/.test(lang(v)));
  return local.find((v) => lang(v) === "es-ar")
    ?? local.find((v) => ["es-419", "es-us", "es-mx", "es-uy", "es-cl"].includes(lang(v)))
    ?? local[0]
    ?? null;
}

// La voz del aparato, si se puede usar. Los navegadores viejos (por ejemplo,
// Safari de iOS 15 o anterior) pueden tener speechSynthesis sin
// addEventListener: se mira cada pieza antes de usarla y cualquier falla solo
// esconde "Escuchar" (nunca rompe la pantalla de práctica)
function speechEngine(): SpeechSynthesis | null {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      return null;
    }
    const synth = window.speechSynthesis;
    return synth && typeof synth.getVoices === "function" && typeof synth.speak === "function" ? synth : null;
  } catch {
    return null;
  }
}

export function useSpeech(): Speech {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [speaking, setSpeaking] = useState(false);
  // Cada lectura tiene su número: el fin de una lectura cortada no apaga la nueva
  const run = useRef(0);

  useEffect(() => {
    const synth = speechEngine();
    if (!synth) return;
    const counter = run;
    const pick = () => {
      try {
        setVoice(pickVoice(Array.from(synth.getVoices() ?? [])));
      } catch {
        setVoice(null);
      }
    };
    pick();
    // Las voces pueden llegar después ("voiceschanged"). Sin addEventListener,
    // la propiedad onvoiceschanged; sin ninguna de las dos, queda lo de ahora
    let detach = () => {};
    try {
      if (typeof synth.addEventListener === "function") {
        synth.addEventListener("voiceschanged", pick);
        detach = () => synth.removeEventListener("voiceschanged", pick);
      } else {
        synth.onvoiceschanged = pick;
        detach = () => { if (synth.onvoiceschanged === pick) synth.onvoiceschanged = null; };
      }
    } catch { /* sin aviso de voces nuevas */ }
    return () => {
      try { detach(); } catch { /* nada que soltar */ }
      counter.current++;
      try { synth.cancel(); } catch { /* nada que cortar */ }
    };
  }, []);

  const stop = useCallback(() => {
    run.current++;
    setSpeaking(false);
    try { speechEngine()?.cancel(); } catch { /* nada que cortar */ }
  }, []);

  const speak = useCallback((texts: string[]) => {
    const synth = speechEngine();
    if (!voice || !synth) return;
    const n = ++run.current;
    const list = texts.map((t) => t.trim()).filter(Boolean);
    try {
      synth.cancel();
      list.forEach((t, i) => {
        const u = new SpeechSynthesisUtterance(t);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = 0.9;
        if (i === list.length - 1) {
          const end = () => { if (run.current === n) setSpeaking(false); };
          u.onend = end;
          u.onerror = end;
        }
        synth.speak(u);
      });
      setSpeaking(list.length > 0);
    } catch {
      // La voz no anduvo: se esconde "Escuchar"
      run.current++;
      setSpeaking(false);
      setVoice(null);
      try { synth.cancel(); } catch { /* nada que cortar */ }
    }
  }, [voice]);

  return { available: !!voice, speaking, speak, stop };
}

