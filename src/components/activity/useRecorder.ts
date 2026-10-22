import { useCallback, useEffect, useRef, useState } from "react";
import { downsample, encodeWav, joinChunks } from "@/lib/wavEncoder";
import { meterAvailable } from "@/components/activity/useVoiceMeter";

// «Me grabo»: graba en el celular y arma un WAV de 16 kHz (src/lib/wavEncoder.ts).
// No sale nada hasta que la familia toca «Mandar»: antes se puede escuchar y
// grabar de nuevo. Se corta solo al llegar a los segundos de la consigna.
// Con cancelación de eco y de ruido (al revés que el globo): para que la
// computadora entienda mejor lo que se dice.
// Si el celular corta el micrófono (una llamada) o se sale de la pantalla
// mientras graba, se para y queda lo grabado hasta ahí.

// ocupado: el micrófono lo está usando otra cosa (por ejemplo, una llamada)
export type RecStatus = "listo" | "pidiendo" | "grabando" | "grabado" | "sin_permiso" | "sin_microfono" | "ocupado";

type Parts = {
  stream: MediaStream; ctx: AudioContext; source: MediaStreamAudioSourceNode; proc: ScriptProcessorNode;
  chunks: Float32Array[]; samples: number;
};

export function useRecorder(maxSeconds: number) {
  const [status, setStatus] = useState<RecStatus>(() => (meterAvailable() ? "listo" : "sin_microfono"));
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [wav, setWav] = useState<Uint8Array | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  // Se cortó solo al llegar al máximo (para avisarlo)
  const [limitHit, setLimitHit] = useState(false);
  const parts = useRef<Parts | null>(null);
  const wanted = useRef(false);
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    const p = parts.current;
    parts.current = null;
    if (!p) return null;
    p.proc.onaudioprocess = null;
    try { p.source.disconnect(); p.proc.disconnect(); } catch { /* ya desconectado */ }
    p.stream.getTracks().forEach((t) => t.stop());
    void p.ctx.close().catch(() => {});
    return p;
  }, []);

  const stop = useCallback((atLimit = false) => {
    wanted.current = false;
    setLimitHit(atLimit);
    const p = release();
    setLevel(0);
    if (!p || !p.samples) { setStatus("listo"); return; }
    const data = encodeWav(downsample(joinChunks(p.chunks), p.ctx.sampleRate));
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const u = URL.createObjectURL(new Blob([data as BlobPart], { type: "audio/wav" }));
    urlRef.current = u;
    setWav(data);
    setUrl(u);
    setStatus("grabado");
  }, [release]);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = useCallback(() => {
    if (parts.current || wanted.current || !meterAvailable()) return;
    wanted.current = true;
    setLimitHit(false);
    setStatus("pidiendo");
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        wanted.current = false;
        const name = (e as Error).name;
        setStatus(name === "NotAllowedError" ? "sin_permiso" : name === "NotReadableError" || name === "AbortError" ? "ocupado" : "sin_microfono");
        return;
      }
      if (!wanted.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      await ctx.resume().catch(() => {});
      // Se fue de la pantalla mientras se prendía: no queda el micrófono abierto
      if (!wanted.current) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
        return;
      }
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor: anda en todos los celulares (también en iPhone)
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const p: Parts = { stream, ctx, source, proc, chunks: [], samples: 0 };
      proc.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        p.chunks.push(new Float32Array(ch));
        p.samples += ch.length;
        let sum = 0;
        for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
        setLevel(Math.min(1, Math.sqrt(sum / ch.length) * 6));
        const secs = p.samples / ctx.sampleRate;
        setSeconds(secs);
        if (secs >= maxSeconds) stopRef.current(true);
      };
      // El celular cortó el micrófono (una llamada, otra app): queda lo grabado
      stream.getAudioTracks().forEach((t) => t.addEventListener("ended", () => { if (parts.current === p) stopRef.current(); }));
      source.connect(proc);
      proc.connect(ctx.destination); // sin esto algunos navegadores no llaman a onaudioprocess (sale silencio)
      parts.current = p;
      setSeconds(0);
      setStatus("grabando");
    })();
  }, [maxSeconds]);

  const reset = useCallback(() => {
    wanted.current = false;
    release();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setWav(null);
    setUrl(null);
    setSeconds(0);
    setLevel(0);
    setLimitHit(false);
    setStatus(meterAvailable() ? "listo" : "sin_microfono");
  }, [release]);

  // Salir de la pantalla (otra app, bloquear el celular) mientras graba: se para
  useEffect(() => {
    const leave = () => { if (parts.current) stopRef.current(); };
    const away = () => { if (document.visibilityState === "hidden") leave(); };
    document.addEventListener("visibilitychange", away);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  useEffect(() => () => {
    wanted.current = false;
    release();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, [release]);

  return { status, seconds, level, wav, url, limitHit, start, stop: () => stop(), reset };
}
