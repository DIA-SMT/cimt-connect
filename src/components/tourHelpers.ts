// Voz, teclado y animaciones del recorrido guiado (GuidedTour). Aparte del
// componente para que la recarga en caliente funcione.

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function speak(text: string) {
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
export const stopSpeaking = () => { if (canSpeak()) window.speechSynthesis.cancel(); };

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
