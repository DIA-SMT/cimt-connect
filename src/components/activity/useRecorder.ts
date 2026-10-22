import { useCallback, useEffect, useRef, useState } from "react";
import { downsample, encodeWav, joinChunks } from "@/lib/wavEncoder";
import { meterAvailable } from "@/components/activity/useVoiceMeter";

// «Me grabo»: graba en el celular y arma un WAV de 16 kHz (src/lib/wavEncoder.ts).
// No sale nada hasta que la familia toca «Mandar»: antes se puede escuchar y
// grabar de nuevo. Se corta solo al llegar a los segundos de la consigna.
// Con cancelación de eco y de ruido (al revés que el globo): para que la
// computadora entienda mejor lo que se dice.

export type RecStatus = "listo" | "pidiendo" | "grabando" | "grabado" | "sin_permiso" | "sin_microfono";

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

  const stop = useCallback(() => {
    wanted.current = false;
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
    setStatus("pidiendo");
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (e) {
        wanted.current = false;
        setStatus((e as Error).name === "NotAllowedError" ? "sin_permiso" : "sin_microfono");
        return;
      }
      if (!wanted.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      await ctx.resume().catch(() => {});
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
        if (secs >= maxSeconds) stopRef.current();
      };
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
    setStatus(meterAvailable() ? "listo" : "sin_microfono");
  }, [release]);

  useEffect(() => () => {
    wanted.current = false;
    release();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, [release]);

  return { status, seconds, level, wav, url, start, stop, reset };
}
