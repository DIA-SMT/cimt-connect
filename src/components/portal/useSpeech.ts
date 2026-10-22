import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { portalApi } from "@/lib/portal";
import { type VoiceUrlsDTO, cleanVoiceText } from "@/lib/voiceRules";

// "Escuchar": la voz de Azure (es-AR-ElenaNeural, la misma del recorrido del
// sitio: server/lib/voice.ts). Lo que se escucha son los textos del
// ejercicio, que escribe el equipo: el servidor los firma y Azure genera cada
// audio una sola vez. Si la voz de Azure no está (modo demo, sin las claves,
// sin conexión), queda la voz del propio aparato, solo voces locales; si
// tampoco hay una en español, "Escuchar" no aparece.
//   - Las URLs se piden apenas se ve el texto (prepare, desde ListenButton):
//     al tocar «Escuchar» el audio arranca en el mismo toque, como piden los
//     iPhone.
// La usan la pantalla de práctica y las actividades: en el portal ("familia")
// y en la vista previa del panel ("equipo").

export type Speech = {
  available: boolean;
  speaking: boolean;
  speak: (texts: string[]) => void;
  stop: () => void;
  /** Pide de antemano las URLs de la voz de Azure de estos textos */
  prepare: (texts: string[]) => void;
};

type Who = "familia" | "equipo";

const MOCK = import.meta.env.VITE_USE_MOCK === "true";

// ── La voz de Azure: URLs firmadas, guardadas por texto ─────────────────────
// "no": el servidor dijo que no hay voz de Azure (o no hay sesión): no se
// vuelve a preguntar. Un corte de red no la apaga: se reintenta la próxima
let cloud: "?" | "si" | "no" = MOCK ? "no" : "?";
const urls = new Map<string, string | null>();
const loading = new Map<string, Promise<void>>();

async function sign(who: Who, texts: string[]): Promise<VoiceUrlsDTO | "no" | null> {
  if (who === "familia") {
    const r = await portalApi.voiceUrls(texts);
    if (r.ok) return r.data;
    return r.status >= 400 && r.status < 500 ? "no" : null;
  }
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  if (!token) return "no";
  const res = await fetch("/api/portal/voz", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ texts }),
  });
  if (res.status >= 400 && res.status < 500) return "no";
  return res.ok ? ((await res.json()) as VoiceUrlsDTO) : null;
}

async function loadUrls(who: Who, texts: string[]): Promise<void> {
  if (cloud === "no") return;
  const want = [...new Set(texts)].filter((t) => !urls.has(t) && !loading.has(t));
  if (want.length) {
    const p = (async () => {
      try {
        const r = await sign(who, want);
        if (r === "no" || (r && !r.available)) {
          cloud = "no";
          return;
        }
        if (!r) return; // sin conexión: se vuelve a pedir la próxima
        cloud = "si";
        want.forEach((t, i) => urls.set(t, r.urls[i] ?? null));
      } catch { /* sin conexión: queda la voz del aparato esta vez */ }
    })().finally(() => want.forEach((t) => loading.delete(t)));
    want.forEach((t) => loading.set(t, p));
  }
  await Promise.all(texts.map((t) => loading.get(t)));
}

const cleanAll = (texts: string[]) => texts.map((t) => cleanVoiceText(t) ?? t.trim()).filter(Boolean);

// ── La voz del aparato (el respaldo) ────────────────────────────────────────

// Solo voces locales (localService): con una voz "en la nube" del navegador
// el texto saldría a otro lado. Primero es-AR, después otras de Latinoamérica
// y cualquier español
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

export function useSpeech(who: Who = "familia"): Speech {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [cloudOk, setCloudOk] = useState(cloud !== "no");
  const [speaking, setSpeaking] = useState(false);
  // Cada lectura tiene su número: el fin de una lectura cortada no apaga la nueva
  const run = useRef(0);
  const player = useRef<HTMLAudioElement | null>(null);

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

  // Al salir de la pantalla, se corta el audio
  useEffect(() => () => { run.current++; player.current?.pause(); }, []);

  const stop = useCallback(() => {
    run.current++;
    setSpeaking(false);
    player.current?.pause();
    try { speechEngine()?.cancel(); } catch { /* nada que cortar */ }
  }, []);

  const speakWithDevice = useCallback((list: string[], n: number) => {
    const synth = speechEngine();
    if (!voice || !synth || !list.length) {
      if (run.current === n) setSpeaking(false);
      return;
    }
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
      setSpeaking(true);
    } catch {
      // La voz no anduvo: se esconde "Escuchar"
      run.current++;
      setSpeaking(false);
      setVoice(null);
      try { synth.cancel(); } catch { /* nada que cortar */ }
    }
  }, [voice]);

  // Los audios de Azure, uno detrás del otro. Si uno no carga, sigue la voz del aparato
  const playUrls = useCallback((srcs: string[], list: string[], n: number) => {
    const audio = (player.current ??= new Audio());
    let i = 0;
    const next = () => {
      if (run.current !== n) return;
      if (i >= srcs.length) { setSpeaking(false); return; }
      audio.src = srcs[i++];
      audio.play().catch((e: unknown) => {
        if (run.current === n && (e as Error).name !== "AbortError") speakWithDevice(list.slice(i - 1), n);
      });
    };
    audio.onended = next;
    audio.onerror = () => { if (run.current === n) speakWithDevice(list.slice(i - 1), n); };
    setSpeaking(true);
    next();
  }, [speakWithDevice]);

  const speak = useCallback((texts: string[]) => {
    const list = cleanAll(texts);
    run.current++;
    player.current?.pause();
    try { speechEngine()?.cancel(); } catch { /* nada que cortar */ }
    const n = run.current;
    if (!list.length) { setSpeaking(false); return; }
    const ready = (): string[] | null => {
      const srcs = list.map((t) => urls.get(t));
      return srcs.every((s): s is string => typeof s === "string") ? srcs : null;
    };
    if (cloud !== "no") {
      const srcs = ready();
      if (srcs) { playUrls(srcs, list, n); return; }
      // Todavía no estaban: se piden y suena después (si el celular no lo
      // deja sonar fuera del toque, sigue la voz del aparato)
      setSpeaking(true);
      void loadUrls(who, list).then(() => {
        setCloudOk(cloud !== "no");
        if (run.current !== n) return;
        const later = ready();
        if (later) playUrls(later, list, n);
        else speakWithDevice(list, n);
      });
      return;
    }
    speakWithDevice(list, n);
  }, [who, playUrls, speakWithDevice]);

  const prepare = useCallback((texts: string[]) => {
    if (cloud === "no") return;
    void loadUrls(who, cleanAll(texts)).then(() => setCloudOk(cloud !== "no"));
  }, [who]);

  return { available: cloudOk || !!voice, speaking, speak, stop, prepare };
}
