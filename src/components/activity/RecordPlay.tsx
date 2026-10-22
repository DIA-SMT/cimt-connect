import { useState } from "react";
import { Check, Mic, RotateCcw, Send, ShieldCheck, Square } from "lucide-react";
import type { RecordingSpec } from "@/lib/activitySpec";
import { portalApi } from "@/lib/portal";
import { RECORDING_LEGAL_BASIS } from "@/lib/legalBasis";
import { RECORDING_NOTICE_POINTS } from "@/lib/recordingRules";
import { focusRing } from "@/components/portal/practiceFormat";
import { LegalBasisNote } from "@/components/portal/ui";
import { pillOutline, pillPrimary } from "@/components/portal/styles";
import type { MechanicProps } from "@/components/activity/types";
import { useRecorder } from "@/components/activity/useRecorder";

// «Me grabo»: la consigna (y el texto, si es para leer), grabar, escucharse,
// grabar de nuevo y mandarla al profesional. La primera vez, el permiso de
// grabaciones (src/lib/recordingRules.ts). Nada sale del celular hasta que
// tocan «Mandar». En la vista previa del panel se graba y se escucha, pero no
// se manda. Grabarse es optativo: siempre está «Sin pantalla».

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function RecordPlay({ spec, dispatch, big, exerciseId, together }: MechanicProps<RecordingSpec>) {
  const rec = useRecorder(spec.segundos);
  const [send, setSend] = useState<"nada" | "mandando" | "mandada" | "permiso">("nada");
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!rec.wav || !exerciseId) return;
    setError(null);
    setSend("mandando");
    const r = await portalApi.recordingUpload(exerciseId, rec.wav);
    if (r.ok) {
      setSend("mandada");
      dispatch({ type: "COMPLETAR" });
      return;
    }
    if (r.code === "RECORDING_CONSENT") { setSend("permiso"); return; }
    setSend("nada");
    setError(r.error);
  }

  async function accept() {
    setError(null);
    const r = await portalApi.recordingAccept(true);
    if (r.ok) await upload();
    else setError(r.error);
  }

  function again() {
    setSend("nada");
    setError(null);
    rec.reset();
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className={`font-semibold leading-snug ${big ? "text-2xl" : "text-xl"}`}>{spec.consigna}</p>
      {spec.texto && (
        <p className={`w-full rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-left leading-relaxed ${big ? "text-2xl" : "text-xl"}`}>{spec.texto}</p>
      )}

      {send === "mandada" ? (
        <>
          <p role="status" className="flex items-center gap-2 text-lg font-bold text-[color:var(--primary-deep)]">
            <Check className="h-6 w-6" aria-hidden="true" /> ¡Listo! Tu profesional la va a escuchar.
          </p>
          <button type="button" onClick={again} className={`${pillOutline} ${focusRing} gap-2`}>
            <RotateCcw className="h-5 w-5" aria-hidden="true" /> Grabar otra
          </button>
        </>
      ) : send === "permiso" ? (
        <div className="flex w-full flex-col gap-3 rounded-2xl border-2 border-primary/30 bg-card p-4 text-left">
          <p className="flex items-center gap-2 font-display text-lg font-bold">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /> Antes de mandar tu primera grabación
          </p>
          <ul className="list-disc space-y-1 pl-5 text-base">
            {RECORDING_NOTICE_POINTS.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <LegalBasisNote basis={RECORDING_LEGAL_BASIS} />
          <div className="flex flex-col gap-2 min-[420px]:flex-row">
            <button type="button" onClick={() => void accept()} className={`${pillPrimary} ${focusRing} gap-2`}>
              <Check className="h-5 w-5" aria-hidden="true" /> Acepto y la mando
            </button>
            <button type="button" onClick={() => setSend("nada")} className={`${pillOutline} ${focusRing}`}>Ahora no</button>
          </div>
        </div>
      ) : (
        <>
          {rec.status === "grabando" && (
            <div className="flex w-full flex-col items-center gap-2" role="status">
              <p className="flex items-center gap-2 text-lg font-bold text-red-700 dark:text-red-400">
                <span className="h-3 w-3 animate-pulse rounded-full bg-red-600 motion-reduce:animate-none" aria-hidden="true" />
                Grabando · {clock(rec.seconds)} de {clock(spec.segundos)}
              </p>
              <div className="h-3 w-full max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(rec.level * 100)}%` }} />
              </div>
            </div>
          )}
          {rec.status === "grabado" && rec.url && (
            <div className="flex w-full flex-col items-center gap-2">
              <p className="text-base font-semibold">Escuchala antes de mandarla:</p>
              <audio controls src={rec.url} className="w-full max-w-sm" />
            </div>
          )}
          {error && <p role="alert" className="text-base font-semibold text-destructive">{error}</p>}

          {(rec.status === "listo" || rec.status === "pidiendo") && (
            <>
              <button type="button" onClick={rec.start} disabled={rec.status === "pidiendo"} className={`${pillPrimary} ${focusRing} gap-2`}>
                <Mic className="h-5 w-5" aria-hidden="true" /> {rec.status === "pidiendo" ? "Esperando el micrófono…" : "Grabar"}
              </button>
              <p className="text-sm text-muted-foreground">Hasta {spec.segundos} segundos. Antes de mandarla la podés escuchar y grabar de nuevo.</p>
            </>
          )}
          {rec.status === "grabando" && (
            <button type="button" onClick={rec.stop} className={`${pillPrimary} ${focusRing} gap-2`}>
              <Square className="h-5 w-5" aria-hidden="true" /> Parar
            </button>
          )}
          {rec.status === "grabado" && (
            <div className="flex w-full flex-col gap-2 min-[420px]:flex-row min-[420px]:justify-center">
              {exerciseId ? (
                <button type="button" onClick={() => void upload()} disabled={send === "mandando"} className={`${pillPrimary} ${focusRing} gap-2`}>
                  <Send className="h-5 w-5" aria-hidden="true" /> {send === "mandando" ? "Mandando…" : "Mandar a mi profesional"}
                </button>
              ) : (
                <p className="text-sm text-muted-foreground">En la vista previa no se manda nada.</p>
              )}
              <button type="button" onClick={again} disabled={send === "mandando"} className={`${pillOutline} ${focusRing} gap-2`}>
                <RotateCcw className="h-5 w-5" aria-hidden="true" /> Grabar de nuevo
              </button>
            </div>
          )}
          {(rec.status === "sin_permiso" || rec.status === "sin_microfono") && (
            <p className="text-base text-muted-foreground">
              {rec.status === "sin_permiso" ? "El micrófono no tiene permiso." : "Acá no se puede usar el micrófono."}{" "}
              {together ? "Pueden hacer el ejercicio sin pantalla y contarlo en el próximo turno." : "Podés hacer el ejercicio sin pantalla y contarlo en el próximo turno."}
            </p>
          )}
          <p className="text-xs text-muted-foreground">Solo la escucha el equipo del CIMT.</p>
        </>
      )}
    </div>
  );
}
