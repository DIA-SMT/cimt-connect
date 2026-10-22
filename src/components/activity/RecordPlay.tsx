import { useEffect, useRef, useState } from "react";
import { Check, Mic, RotateCcw, Send, ShieldCheck, Square } from "lucide-react";
import type { RecordingSpec } from "@/lib/activitySpec";
import { portalApi } from "@/lib/portal";
import { RECORDING_LEGAL_BASIS } from "@/lib/legalBasis";
import { RECORDING_MIN_MS, RECORDING_NOTICE_POINTS } from "@/lib/recordingRules";
import { wavDurationMs } from "@/lib/wavEncoder";
import { focusRing } from "@/components/portal/practiceFormat";
import { FormAlert, LegalBasisNote } from "@/components/portal/ui";
import { pillOutline, pillPrimary } from "@/components/portal/styles";
import type { MechanicProps } from "@/components/activity/types";
import { useRecorder } from "@/components/activity/useRecorder";

// «Me grabo»: la consigna (y el texto, si es para leer), grabar, escucharse,
// grabar de nuevo y mandarla al profesional. La primera vez, el permiso de
// grabaciones (src/lib/recordingRules.ts): se consulta al entrar, así no se
// sube el audio para enterarse de que falta. Nada sale del celular hasta que
// tocan «Mandar». En la vista previa del panel se graba y se escucha, pero no
// se manda. Grabarse es optativo: «Lo hicimos sin grabar» termina el paso.
// together: con un acompañante los textos van en plural.

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Send = "nada" | "permiso" | "aceptando" | "mandando" | "mandada";

export function RecordPlay({ spec, state, dispatch, big, exerciseId, together }: MechanicProps<RecordingSpec>) {
  const rec = useRecorder(spec.segundos);
  const [send, setSend] = useState<Send>("nada");
  const [error, setError] = useState<string | null>(null);
  // El permiso de la cuenta: null mientras no se sabe (o en la vista previa)
  const [consent, setConsent] = useState<boolean | null>(null);
  const t = (solo: string, juntos: string) => (together ? juntos : solo);

  const stopRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const permisoRef = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const prevStatus = useRef(rec.status);
  const focusNext = useRef<"permiso" | "listo" | null>(null);

  useEffect(() => {
    if (!exerciseId) return;
    let live = true;
    void portalApi.recordingConsent().then((r) => { if (live && r.ok) setConsent(r.data.accepted); });
    return () => { live = false; };
  }, [exerciseId]);

  // El foco sigue al botón que corresponde (el que se tocó desaparece)
  useEffect(() => {
    const before = prevStatus.current;
    prevStatus.current = rec.status;
    if (rec.status === "grabando" && before !== "grabando") stopRef.current?.focus();
    if (rec.status === "grabado" && before === "grabando") (sendRef.current ?? againRef.current)?.focus();
  }, [rec.status]);
  useEffect(() => {
    const target = focusNext.current;
    if (target === "permiso" && permisoRef.current) { focusNext.current = null; permisoRef.current.focus(); }
    if (target === "listo" && doneRef.current) { focusNext.current = null; doneRef.current.focus(); }
  });

  const ms = rec.wav ? wavDurationMs(rec.wav) : null;
  const tooShort = rec.status === "grabado" && (ms === null || ms < RECORDING_MIN_MS);
  const done = !!state.done[state.step];

  async function upload() {
    if (!rec.wav || !exerciseId) return;
    setError(null);
    setSend("mandando");
    const r = await portalApi.recordingUpload(exerciseId, rec.wav);
    if (r.ok) {
      setSend("mandada");
      focusNext.current = "listo";
      dispatch({ type: "COMPLETAR" });
      return;
    }
    if (r.code === "RECORDING_CONSENT") {
      setConsent(false);
      setSend("permiso");
      focusNext.current = "permiso";
      return;
    }
    setSend("nada");
    setError(r.error);
  }

  function mandar() {
    if (consent === false) {
      setError(null);
      setSend("permiso");
      focusNext.current = "permiso";
      return;
    }
    void upload();
  }

  async function accept() {
    if (send === "aceptando") return;
    setError(null);
    setSend("aceptando");
    const r = await portalApi.recordingAccept(true);
    if (!r.ok) {
      setSend("permiso");
      setError(r.error);
      return;
    }
    setConsent(true);
    await upload();
  }

  function again() {
    setSend("nada");
    setError(null);
    rec.reset();
    rec.start();
  }

  function withoutRecording() {
    rec.reset();
    setSend("nada");
    setError(null);
    dispatch({ type: "COMPLETAR" });
  }

  const busy = send === "mandando" || send === "aceptando";
  const statusLine =
    rec.status === "pidiendo" ? "Esperando el micrófono…"
    : rec.status === "grabando" ? "Grabando."
    : rec.status === "grabado" && rec.limitHit ? `Se cortó al llegar a ${clock(spec.segundos)}.`
    : rec.status === "grabado" && tooShort ? t("Fue muy cortita. Probá grabar de nuevo.", "Fue muy cortita. Prueben grabar de nuevo.")
    : "";

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className={`font-semibold leading-snug ${big ? "text-2xl" : "text-xl"}`}>{spec.consigna}</p>
      {spec.texto && (
        <p className={`w-full rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-left leading-relaxed ${big ? "text-2xl" : "text-xl"}`}>{spec.texto}</p>
      )}

      {send === "mandada" ? (
        <>
          <p ref={doneRef} tabIndex={-1} role="status" className="flex items-center gap-2 text-lg font-bold text-[color:var(--primary-deep)] outline-none">
            <Check className="h-6 w-6" aria-hidden="true" /> ¡Listo! El profesional la va a escuchar.
          </p>
          <button type="button" onClick={again} className={`${pillOutline} ${focusRing} gap-2`}>
            <RotateCcw className="h-5 w-5" aria-hidden="true" /> Grabar otra
          </button>
        </>
      ) : send === "permiso" || send === "aceptando" ? (
        <div className="flex w-full flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-card p-4 text-left">
          <h3 ref={permisoRef} tabIndex={-1} className="flex items-center gap-2 font-display text-lg font-bold outline-none">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /> Antes de mandar la primera grabación
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-base">
            {RECORDING_NOTICE_POINTS.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <LegalBasisNote basis={RECORDING_LEGAL_BASIS} />
          <FormAlert>{error}</FormAlert>
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <button type="button" onClick={() => void accept()} disabled={busy} className={`${pillPrimary} ${focusRing} gap-2`}>
              <Check className="h-5 w-5" aria-hidden="true" /> {send === "aceptando" ? "Mandando…" : "Acepto y la mando"}
            </button>
            <button type="button" onClick={() => { setError(null); setSend("nada"); }} disabled={busy} className={`${pillOutline} ${focusRing}`}>
              Ahora no
            </button>
          </div>
        </div>
      ) : (
        <>
          {rec.status === "grabando" && (
            <div className="flex w-full flex-col items-center gap-2">
              <p className="flex items-center gap-2 text-lg font-bold text-red-700 dark:text-red-400">
                <span className="h-3 w-3 animate-pulse rounded-full bg-red-600 motion-reduce:animate-none" aria-hidden="true" />
                Grabando · {clock(rec.seconds)} de {clock(spec.segundos)}
              </p>
              <div className="h-3 w-full max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(rec.level * 100)}%` }} />
              </div>
            </div>
          )}
          {rec.status === "grabado" && rec.url && !tooShort && (
            <div className="flex w-full flex-col items-center gap-2">
              <p className="text-base font-semibold">{t("Escuchala antes de mandarla:", "Escúchenla antes de mandarla:")}</p>
              <audio controls src={rec.url} className="w-full max-w-sm" />
            </div>
          )}
          {/* Lo que cambia se anuncia (sin leer el reloj cada segundo) */}
          <p role="status" className="sr-only">{statusLine}</p>
          {statusLine && rec.status !== "grabando" && <p className="text-base font-semibold">{statusLine}</p>}
          <FormAlert>{error}</FormAlert>

          {(rec.status === "listo" || rec.status === "pidiendo") && (
            <>
              <button type="button" onClick={rec.start} disabled={rec.status === "pidiendo"} className={`${pillPrimary} ${focusRing} gap-2`}>
                <Mic className="h-5 w-5" aria-hidden="true" /> Grabar
              </button>
              <p className="text-sm text-muted-foreground">
                Hasta {spec.segundos} segundos. {t("Antes de mandarla la podés escuchar y grabar de nuevo.", "Antes de mandarla la pueden escuchar y grabar de nuevo.")}
              </p>
            </>
          )}
          {rec.status === "grabando" && (
            <button ref={stopRef} type="button" onClick={rec.stop} className={`${pillPrimary} ${focusRing} gap-2`}>
              <Square className="h-5 w-5" aria-hidden="true" /> Parar
            </button>
          )}
          {rec.status === "grabado" && (
            <div className="flex w-full flex-col gap-2 min-[420px]:flex-row min-[420px]:justify-center">
              {tooShort ? null : exerciseId ? (
                <button ref={sendRef} type="button" onClick={mandar} disabled={busy} className={`${pillPrimary} ${focusRing} gap-2`}>
                  <Send className="h-5 w-5" aria-hidden="true" /> {send === "mandando" ? "Mandando…" : "Mandarla al profesional"}
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">En la vista previa no se manda nada.</p>
              )}
              <button ref={againRef} type="button" onClick={again} disabled={busy} className={`${pillOutline} ${focusRing} gap-2`}>
                <RotateCcw className="h-5 w-5" aria-hidden="true" /> Grabar de nuevo
              </button>
            </div>
          )}
          {(rec.status === "sin_permiso" || rec.status === "ocupado" || rec.status === "sin_microfono") && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-base text-muted-foreground">
                {rec.status === "sin_permiso"
                  ? t("El micrófono no tiene permiso. Podés darle permiso en el navegador y probar de nuevo.", "El micrófono no tiene permiso. Pueden darle permiso en el navegador y probar de nuevo.")
                  : rec.status === "ocupado"
                    ? t("El micrófono está ocupado (por ejemplo, en una llamada). Probá de nuevo en un rato.", "El micrófono está ocupado (por ejemplo, en una llamada). Prueben de nuevo en un rato.")
                    : t("Acá no se puede usar el micrófono. Podés hacer el ejercicio sin pantalla y contarlo en el próximo turno.", "Acá no se puede usar el micrófono. Pueden hacer el ejercicio sin pantalla y contarlo en el próximo turno.")}
              </p>
              {rec.status !== "sin_microfono" && (
                <button type="button" onClick={again} className={`${pillOutline} ${focusRing} gap-2`}>
                  <RotateCcw className="h-5 w-5" aria-hidden="true" /> Probar de nuevo
                </button>
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground">Solo la escucha el equipo profesional que atiende al paciente.</p>
          {!done && rec.status !== "grabando" && (
            <button type="button" onClick={withoutRecording} disabled={busy} className={`min-h-11 text-base font-bold text-primary underline underline-offset-2 ${focusRing}`}>
              {t("Lo hice sin grabar", "Lo hicimos sin grabar")}
            </button>
          )}
          {done && <p className="text-base text-muted-foreground">{t("Listo: ya podés terminar.", "Listo: ya pueden terminar.")}</p>}
        </>
      )}
    </div>
  );
}
