// Voz, teclado y animaciones del recorrido guiado (GuidedTour). Aparte del
// componente para que la recarga en caliente funcione.
import { audioKey } from "@/lib/siteTour";
import { RECORDED } from "@/lib/tourAudio.gen";

const hasSynth = () => typeof window !== "undefined" && "speechSynthesis" in window;
export const canSpeak = () => typeof window !== "undefined" && ("speechSynthesis" in window || "Audio" in window);
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let player: HTMLAudioElement | null = null;

// Si el texto tiene audio grabado (la voz de los podcasts, scripts/tour-audio.ts)
// suena ese; si no, o si el audio no carga, la voz del navegador
export function speak(text: string) {
  if (!canSpeak()) return;
  stopSpeaking();
  const file = RECORDED[audioKey(text)];
  if (!file || !("Audio" in window)) { speakWithBrowser(text); return; }
  const audio = (player ??= new Audio());
  audio.src = `/audio/recorrido/${file}`;
  audio.play().catch((e: unknown) => {
    // AbortError: se pausó o se pasó a otro paso antes de que arranque
    if ((e as Error).name !== "AbortError" && audio.src.endsWith(file)) speakWithBrowser(text);
  });
}

function speakWithBrowser(text: string) {
  if (!hasSynth()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "es-AR";
  const voice = synth.getVoices().find((v) => v.lang.startsWith("es-AR")) ?? synth.getVoices().find((v) => v.lang.startsWith("es"));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  synth.speak(u);
}

export function stopSpeaking() {
  player?.pause();
  if (hasSynth()) window.speechSynthesis.cancel();
}

// Tab y Shift+Tab quedan dentro de la tarjeta
export function trapTab(e: React.KeyboardEvent, box: HTMLElement | null) {
  if (e.key !== "Tab" || !box) return;
  const items = [...box.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]")];
  if (!items.length) return;
  const firstEl = items[0];
  const lastEl = items[items.length - 1];
  if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
  else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
}
