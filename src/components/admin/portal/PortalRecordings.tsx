import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Minus, Mic, Plus, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { portalStaffApi } from "@/lib/portalStaff";
import { MARK_LABEL, type Mark, type MarkKind, analysisSummary, percentSS } from "@/lib/recordingAnalysis";
import { RECORDING_STATUS_LABEL, REVIEW_NOTE_MAX, type StaffRecordingDTO } from "@/lib/recordingRules";

// «Grabaciones» (etapa recordings), dentro de «Ejercicios, devoluciones y
// medallas»: lo que mandó el paciente (o quien lo acompaña) desde «Me grabo».
//   - La IA marca momentos para escuchar (pausas largas, posibles
//     repeticiones, muletillas, palabras estiradas): un toque en la marca
//     lleva el audio ahí. No diagnostica: marca.
//   - El profesional cuenta las sílabas tartamudeadas mientras escucha (+1)
//     y el %SS sale de su conteo sobre el total de sílabas (el de la IA, que
//     se puede corregir). Eso es lo que queda, y su evolución.
//   - Quien grabó nunca ve estos números.
//   - El audio se borra a los 90 días; quedan los números.

const ERROR_BOX = "rounded-xl bg-[color:var(--status-occupied-bg)] px-3 py-2 text-sm font-semibold text-[oklch(0.48_0.19_25)]";
const PILL_BTN = "h-8 rounded-full";
const MARK_COLOR: Record<MarkKind, string> = {
  pausa: "bg-sky-500",
  repeticion: "bg-amber-500",
  muletilla: "bg-violet-500",
  prolongacion: "bg-rose-500",
};
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const dateTime = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PortalRecordings({ patientId }: { patientId: string }) {
  const [items, setItems] = useState<StaffRecordingDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await portalStaffApi.recordings({ action: "list", patient_id: patientId });
    if (r.ok) setItems(r.data.items ?? []);
    else setError(r.error);
  }, [patientId]);
  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div role="alert" className={`${ERROR_BOX} flex flex-wrap items-center justify-between gap-2`}>
        <span>{error}</span>
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={() => void load()}>Probá de nuevo</Button>
      </div>
    );
  }
  if (!items) return <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando…</p>;

  const reviewed = items.filter((i) => i.review?.pss !== null && i.review?.pss !== undefined).slice().reverse();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Lo que se grabó desde «Me grabo». La IA marca momentos para escuchar; vos contás las sílabas tartamudeadas y queda tu %SS.
        Quien grabó no ve ningún número. El audio se borra a los 90 días.
      </p>
      {reviewed.length >= 2 && (
        <p className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <span className="font-semibold">Evolución del %SS:</span>{" "}
          {reviewed.map((i) => `${i.review!.pss}% (${new Date(i.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })})`).join(" → ")}
        </p>
      )}
      {!items.length && <p className="text-sm text-muted-foreground">Todavía no hay grabaciones. Aparecen cuando un ejercicio con «Me grabo» se manda desde el portal.</p>}
      <ul className="space-y-2">
        {items.map((r) => (
          <li key={r.id} className="rounded-xl border border-border/60 bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Mic className="h-4 w-4 text-primary" aria-hidden="true" /> {r.exercise_title}</p>
                <p className="text-xs text-muted-foreground">
                  {dateTime(r.created_at)} · {clock(r.duration_ms)} · {RECORDING_STATUS_LABEL[r.status]}
                  {r.review?.pss !== null && r.review?.pss !== undefined ? ` · %SS ${r.review.pss}` : ""}
                </p>
                {r.analysis && <p className="text-xs">{analysisSummary(r.analysis)}</p>}
              </div>
              <Button type="button" size="sm" variant={open === r.id ? "secondary" : "outline"} className={PILL_BTN} aria-expanded={open === r.id}
                onClick={() => setOpen(open === r.id ? null : r.id)}>
                {open === r.id ? "Cerrar" : r.status === "revisada" ? "Ver la revisión" : "Escuchar y revisar"}
              </Button>
            </div>
            {open === r.id && <RecordingReview rec={r} onSaved={() => void load()} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecordingReview({ rec, onSaved }: { rec: StaffRecordingDTO; onSaved: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [stuttered, setStuttered] = useState(rec.review?.stuttered ?? 0);
  const [syllables, setSyllables] = useState(String(rec.review?.syllables ?? rec.analysis?.syllables ?? ""));
  const [note, setNote] = useState(rec.review?.note ?? "");
  const [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const ids = { syl: useId(), note: useId() };

  useEffect(() => {
    if (!rec.audio) return;
    let cancelled = false;
    void portalStaffApi.recordings({ action: "audio", id: rec.id }).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data.url) setUrl(r.data.url);
      else setAudioError(r.ok ? "No se pudo abrir el audio." : r.error);
    });
    return () => { cancelled = true; };
  }, [rec.id, rec.audio]);

  function seek(m: Mark) {
    const a = audio.current;
    if (!a) return;
    a.currentTime = Math.max(0, (m.at - 600) / 1000);
    void a.play().catch(() => {});
  }

  async function save() {
    setBusy(true);
    const r = await portalStaffApi.recordings({ action: "review", id: rec.id, stuttered, syllables: Number(syllables), note: note.trim() || null });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success("Revisión guardada");
    onSaved();
  }

  async function reanalyze() {
    setBusy(true);
    const r = await portalStaffApi.recordings({ action: "reanalyze", id: rec.id });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    onSaved();
  }

  const total = Number(syllables);
  const pss = percentSS(stuttered, total);
  const span = Math.max(rec.duration_ms, 1);
  const marks = rec.analysis?.marks ?? [];
  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
      {rec.consigna && <p className="text-sm"><span className="font-semibold">Consigna:</span> {rec.consigna}</p>}
      {rec.texto && <p className="text-sm"><span className="font-semibold">Texto para leer:</span> {rec.texto}</p>}

      {!rec.audio ? (
        <p className="text-sm text-muted-foreground">El audio ya se borró (pasaron los 90 días). Quedan los números.</p>
      ) : audioError ? (
        <p className={ERROR_BOX}>{audioError}</p>
      ) : !url ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Abriendo el audio…</p>
      ) : (
        <audio ref={audio} controls src={url} className="w-full" />
      )}

      {/* Las marcas de la IA sobre la línea del tiempo: un toque lleva el audio ahí */}
      {marks.length > 0 && (
        <div className="space-y-2">
          <div className="relative h-6 rounded-full bg-muted" aria-hidden="true">
            {marks.map((m, i) => (
              <span key={i} title={`${clock(m.at)} · ${MARK_LABEL[m.kind]}`}
                className={`absolute top-1 h-4 rounded-full ${MARK_COLOR[m.kind]}`}
                style={{ left: `${(m.at / span) * 100}%`, width: `max(6px, ${(m.dur / span) * 100}%)` }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {marks.map((m, i) => (
              <li key={i}>
                <button type="button" onClick={() => seek(m)} disabled={!url}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
                  <span className={`h-2 w-2 rounded-full ${MARK_COLOR[m.kind]}`} aria-hidden="true" />
                  {clock(m.at)} · {MARK_LABEL[m.kind]}{m.text ? `: ${m.text}` : ""}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rec.analysis?.text && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">Lo que entendió la computadora</span> (puede tener errores): «{rec.analysis.text}»
        </p>
      )}
      {rec.status === "error" && rec.audio && (
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={() => void reanalyze()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Volver a analizar
        </Button>
      )}

      {/* El conteo del profesional */}
      <div className="space-y-3 rounded-xl bg-[color:var(--primary-soft)]/40 p-3">
        <p className="text-sm font-semibold">Tu conteo mientras escuchás</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="h-12 rounded-full px-5 text-base" onClick={() => setStuttered((n) => Math.min(n + 1, total || n + 1))}>
            <Plus className="mr-1.5 h-5 w-5" aria-hidden="true" /> Sílaba tartamudeada
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-10 w-10 rounded-full" aria-label="Restar una"
            disabled={stuttered === 0} onClick={() => setStuttered((n) => Math.max(0, n - 1))}>
            <Minus className="h-4 w-4" aria-hidden="true" />
          </Button>
          <p className="text-lg font-bold" aria-live="polite">{stuttered}</p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={ids.syl}>Total de sílabas</Label>
            <Input id={ids.syl} inputMode="numeric" className="h-10 w-28" value={syllables}
              onChange={(e) => setSyllables(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </div>
          <p className="pb-2 text-sm">%SS: <span className="text-lg font-bold">{pss ?? "—"}</span></p>
          {rec.analysis?.spm !== null && rec.analysis?.spm !== undefined && (
            <p className="pb-2 text-sm text-muted-foreground">Velocidad: {rec.analysis.spm} sílabas/min</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.note}>Nota <span className="font-normal text-muted-foreground">(solo para el equipo)</span></Label>
          <Textarea id={ids.note} rows={2} maxLength={REVIEW_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="button" size="sm" className={PILL_BTN} disabled={busy || pss === null} onClick={() => void save()}>
          <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {rec.review ? "Guardar los cambios" : "Guardar la revisión"}
        </Button>
        {rec.reviewed_at && (
          <p className="text-xs text-muted-foreground">Revisada el {dateTime(rec.reviewed_at)}{rec.reviewed_by_email ? ` por ${rec.reviewed_by_email}` : ""}.</p>
        )}
      </div>
    </div>
  );
}
