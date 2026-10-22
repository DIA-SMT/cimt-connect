import { useCallback, useEffect, useRef, useState } from "react";
import { FRAME_MS, displayLevel, newTracker, trackVoice } from "@/lib/speechGames";

// El micrófono del globo (src/lib/speechGames.ts): solo el volumen de la voz,
// en el momento y en este aparato. No se graba ni se manda nada: el audio no
// sale del analizador y se descarta cuadro a cuadro.
//   - Se prende recién cuando la familia toca «Usar el micrófono» (el
//     navegador pide permiso) y se apaga al salir del juego.
//   - Sin cancelación de eco ni control automático de volumen: si no, el
//     celular «aplana» la voz y no se ve cómo arranca.

// ocupado: el micrófono lo está usando otra cosa (por ejemplo, una llamada)
export type MeterStatus = "apagado" | "pidiendo" | "escuchando" | "sin_permiso" | "sin_microfono" | "ocupado";

export type VoiceMeter = {
  status: MeterStatus;
  /** Para dibujar: de 0 a 1 */
  level: number;
  start: () => void;
  stop: () => void;
};

export const meterAvailable = () =>
  typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  && typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) === "function";

/** onAttempt: cuando termina un intento, los volúmenes (RMS) desde un poco antes del arranque */
export function useVoiceMeter(onAttempt: (levels: number[]) => void): VoiceMeter {
  const [status, setStatus] = useState<MeterStatus>(() => (meterAvailable() ? "apagado" : "sin_microfono"));
  const [level, setLevel] = useState(0);
  const parts = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const attempt = useRef(onAttempt);
  attempt.current = onAttempt;
  // Si se apaga (o se sale del juego) mientras el navegador pide permiso, el
  // micrófono que llega tarde se cierra enseguida
  const wanted = useRef(false);

  const stop = useCallback(() => {
    wanted.current = false;
    const p = parts.current;
    parts.current = null;
    if (p) {
      cancelAnimationFrame(p.raf);
      p.stream.getTracks().forEach((t) => t.stop());
      void p.ctx.close().catch(() => {});
    }
    setLevel(0);
    setStatus((s) => (s === "escuchando" || s === "pidiendo" ? "apagado" : s));
  }, []);

  const start = useCallback(() => {
    if (parts.current || wanted.current || !meterAvailable()) return;
    wanted.current = true;
    setStatus("pidiendo");
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) {
        wanted.current = false;
        const name = (e as Error).name;
        setStatus(name === "NotAllowedError" ? "sin_permiso" : name === "NotReadableError" || name === "AbortError" ? "ocupado" : "sin_microfono");
        return;
      }
      if (!wanted.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      await ctx.resume().catch(() => {});
      if (!wanted.current) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
        return;
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let tracker = newTracker();
      let last = 0;
      let shown = 0;
      const tick = (now: number) => {
        if (!parts.current) return;
        parts.current.raf = requestAnimationFrame(tick);
        // Un cuadro cada FRAME_MS (en pantallas de 120 Hz, no el doble)
        if (now - last < FRAME_MS - 2) return;
        last = now;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const r = trackVoice(tracker, rms);
        tracker = r.tracker;
        if (r.attempt) attempt.current(r.attempt);
        // El globo sube rápido y baja más despacio (se lee mejor)
        const target = displayLevel(rms);
        shown = target > shown ? shown + (target - shown) * 0.5 : shown + (target - shown) * 0.12;
        setLevel(shown);
      };
      parts.current = { stream, ctx, raf: requestAnimationFrame(tick) };
      setStatus("escuchando");
    })();
  }, []);

  useEffect(() => stop, [stop]);

  // Salir de la pantalla (otra app, bloquear el celular): el micrófono se apaga
  useEffect(() => {
    const leave = () => { if (parts.current || wanted.current) stop(); };
    const away = () => { if (document.visibilityState === "hidden") leave(); };
    document.addEventListener("visibilitychange", away);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("pagehide", leave);
    };
  }, [stop]);

  return { status, level, start, stop };
}
