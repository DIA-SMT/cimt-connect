import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiResult } from "@/lib/portal";
import { STAFF_PRACTICE_TEXT } from "@/lib/practiceRules";
import { type PracticeAction, type StaffPracticeDTO, portalStaffApi } from "@/lib/portalStaff";
import { PortalPracticeFollowup, PortalPracticeGoals } from "./PortalPracticeFollowup";
import { PortalPracticePlan, type PracticeSend } from "./PortalPracticePlan";
import { PortalRecordings } from "./PortalRecordings";
import {
  type UnsavedPart, changesInbox, hasUnsaved, isPanelOwner, isSectionMounted, markInboxStale, sectionMounted,
} from "./practiceHandoff";

// "Ejercicios, devoluciones y medallas" dentro de "Portal del paciente"
// (etapa practice). Carga la vista del equipo (StaffPracticeDTO) y la
// comparte con tres vistas: el plan de práctica (PortalPracticePlan), las
// prácticas y devoluciones, y las metas y medallas (PortalPracticeFollowup).
// Todas las acciones pasan por send(), que devuelve la vista actualizada.
// Administración ve estados, no textos (el servidor ya los manda vacíos).
// El servidor (server/api/portal-staff/practice.ts) vuelve a controlar todo.
// Con practiceHandoff.ts:
//   - «Dar la medalla» desde la bandeja: la sección de arriba toma el pedido
//     y lo pasa en medalAsk; acá se abre «Metas y medallas» con la devolución
//     de esa meta y su medalla cargadas (una vez por pedido).
//   - Cambios sin guardar (el plan o la devolución): avisa a la sección de
//     arriba (pregunta antes de cerrarse), al navegador (antes de salir de la
//     página) y, si la ficha se cierra o se abre otra, quedan aparte (solo
//     para owner, quien usa el panel) y vuelven al abrir de nuevo esta sección.
//     Si cambia quién usa el panel, la sección de arriba se cierra: lo de
//     owner queda aparte para owner y la próxima persona empieza de cero.
//   - Se carga una vez al montarse y de nuevo solo cuando sube refreshKey.
//   - Después de cada acción que sale bien, avisa a la bandeja y al número de
//     la pestaña Portal que se vuelvan a cargar (markInboxStale).

// "recordings": «Me grabo» (etapa recordings), solo para perfiles clínicos
type View = "plan" | "followup" | "goals" | "recordings";

const ERROR_BOX = "rounded-xl bg-[color:var(--status-occupied-bg)] px-3 py-2 text-sm font-semibold text-[oklch(0.48_0.19_25)]";
const PILL_BTN = "h-8 rounded-full";

export type MedalAsk = { goalId: string; n: number };

export function PortalPracticeSection({ patientId, refreshKey, onDirtyChange, owner, medalAsk = null }: {
  patientId: string;
  /**
   * Contador: sube cuando la sección de arriba guarda algo (habilitación, verificaciones, pausa…) o se trae lo último
   * por un 409 (practiceHandoff.refreshesPractice). Entonces se recarga, para que «quién lo ve» esté al día. Al
   * montarse se carga sola una vez: recargar la sección de arriba no la vuelve a cargar
   */
  refreshKey?: number;
  /** Hay cambios sin guardar en el plan o en la devolución */
  onDirtyChange?: (dirty: boolean) => void;
  /** Quién usa el panel (practiceHandoff.unsavedOwner): lo sin guardar queda aparte solo para esa persona. null: no queda nada */
  owner: string | null;
  /** «Dar la medalla» desde la bandeja (ya tomado por la sección de arriba): se atiende una vez por cada n */
  medalAsk?: MedalAsk | null;
}) {
  const [forPatient, setForPatient] = useState(patientId);
  const [data, setData] = useState<StaffPracticeDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("plan");
  // «Dar la medalla» para «Metas y medallas» (n: cada pedido se atiende una vez)
  const [goalsAsk, setGoalsAsk] = useState<MedalAsk | null>(null);
  const medalAskDone = useRef<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const current = useRef(patientId);
  const loadSeq = useRef(0);
  const dirtyParts = useRef(new Set<UnsavedPart>());
  const sectionRef = useRef<HTMLElement>(null);
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  // Para el aviso al cerrar la ficha con cambios sin guardar
  const who = useRef<{ first: string; owner: string | null } | null>(null);
  if (data) who.current = { first: data.patient.first_name, owner };
  const titleId = useId();
  const tabsId = useId();

  // Otra ficha: se empieza de cero (y se ignoran respuestas de la anterior)
  if (forPatient !== patientId) {
    current.current = patientId;
    setForPatient(patientId);
    setData(null);
    setLoadError(null);
    setBusy(false);
    setView("plan");
    setGoalsAsk(null);
  }

  // Una falla inesperada (no una respuesta con error) se muestra como cualquier otro error
  const call = (body: PracticeAction): Promise<ApiResult<StaffPracticeDTO>> =>
    portalStaffApi.practice(body).catch(() => ({ ok: false as const, status: 503, error: "No se pudo conectar con el servidor." }));

  async function load() {
    const id = patientId;
    const n = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    const r = await call({ action: "get", patient_id: id });
    if (current.current !== id || loadSeq.current !== n) return;
    setLoading(false);
    if (!r.ok) { setLoadError(r.error); return; }
    setData(r.data);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [patientId, refreshKey]);

  // «Dar la medalla» desde la bandeja: con la vista cargada, a «Metas y
  // medallas» con la devolución lista. Una sola vez por pedido (las recargas
  // no lo repiten)
  const loaded = !!data;
  useEffect(() => {
    if (!medalAsk || !loaded || medalAskDone.current === medalAsk.n) return;
    medalAskDone.current = medalAsk.n;
    setView("goals");
    setGoalsAsk(medalAsk);
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [medalAsk, loaded]);

  // Todas las acciones: siempre sobre la ficha abierta. La respuesta es la
  // vista completa y reemplaza a la que había
  const send: PracticeSend = async (body) => {
    const id = patientId;
    setBusy(true);
    const r = await call({ ...body, patient_id: id } as PracticeAction);
    // La bandeja (Portal → Prácticas) y el número de la pestaña se vuelven a
    // cargar (también si mientras tanto se abrió otra ficha: la acción se hizo)
    if (r.ok && changesInbox(body.action)) markInboxStale(id);
    if (current.current !== id) return { ok: false, status: 0, error: "Se abrió otra ficha." };
    setBusy(false);
    if (!r.ok) return { ok: false, status: r.status, error: r.error, code: r.code };
    // Lo que devuelve la acción es más nuevo que una carga que esté en camino
    loadSeq.current++;
    setLoading(false);
    setLoadError(null);
    setData(r.data);
    return { ok: true, data: r.data };
  };

  // ── Cambios sin guardar ──
  const onDirty = useCallback((part: UnsavedPart, on: boolean) => {
    if (on) dirtyParts.current.add(part);
    else dirtyParts.current.delete(part);
    setDirty(dirtyParts.current.size > 0);
  }, []);

  useEffect(() => { onDirtyRef.current?.(dirty); }, [dirty]);

  // Antes de salir de la página (recargar, cerrar la pestaña): el navegador pregunta
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Al cerrar la ficha (o abrir otra) con cambios sin guardar, las partes los
  // dejan aparte al desmontarse; acá se avisa dónde encontrarlos. No se avisa
  // si la sección se cerró confirmando que se pierden (no queda nada aparte),
  // si se vuelve a montar enseguida ni si se cerró porque cambió quién usa el
  // panel (lo de otra persona no se muestra: isPanelOwner)
  useEffect(() => {
    const id = patientId;
    const unmount = sectionMounted(id);
    return () => {
      unmount();
      const w = who.current;
      window.setTimeout(() => {
        if (!w || isSectionMounted(id) || !isPanelOwner(w.owner) || !hasUnsaved(id, w.owner)) return;
        toast.warning(`Quedaron cambios sin guardar en «Ejercicios, devoluciones y medallas» de ${w.first}.`, {
          description: "Siguen ahí cuando vuelvas a abrir su ficha (hasta 12 horas), mientras no cierres ni recargues esta pestaña.",
          duration: 10_000,
        });
      }, 0);
    };
  }, [patientId]);

  const props = data ? { data, busy, send, reload: load, onDirty, owner } : null;
  const newPractice = data ? data.pending.logs + data.pending.comments : 0;
  const tabs: { key: View; label: string; count: number; urgent: boolean }[] = [
    { key: "plan", label: "Plan de práctica", count: data?.draft ? 1 : 0, urgent: false },
    { key: "followup", label: "Prácticas y devoluciones", count: newPractice, urgent: (data?.pending.risk ?? 0) > 0 },
    { key: "goals", label: "Metas y medallas", count: data?.goals_met.length ?? 0, urgent: false },
    ...(data?.features.recordings && data.can_edit
      ? [{ key: "recordings" as const, label: "Grabaciones", count: data.recordings_to_listen ?? 0, urgent: false }]
      : []),
  ];

  function onTabKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.key === view);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].key;
    setView(next);
    document.getElementById(`${tabsId}-tab-${next}`)?.focus();
  }

  return (
    <section ref={sectionRef} aria-labelledby={titleId} className="scroll-mt-20 space-y-4 rounded-2xl border border-border/60 p-4">
      <div>
        <h4 id={titleId} className="text-sm font-bold">Ejercicios, devoluciones y medallas</h4>
        <p className="text-xs text-muted-foreground">
          Ejercicios para practicar en casa, lo que anota la familia y tus devoluciones. {STAFF_PRACTICE_TEXT.internal_use}
        </p>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {data ? "Actualizando…" : "Cargando…"}
        </p>
      )}
      {loadError && (
        <div role="alert" className={`${ERROR_BOX} flex flex-wrap items-center justify-between gap-2`}>
          <span>{loadError}</span>
          <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={() => void load()} disabled={loading}>
            Probá de nuevo
          </Button>
        </div>
      )}

      {props && (
        <>
          <p className="text-sm">{props.data.readers_line}</p>
          <div role="tablist" aria-label="Vistas de la práctica" className="flex flex-wrap gap-1.5" onKeyDown={onTabKey}>
            {tabs.map((t) => {
              const active = view === t.key;
              return (
                <button key={t.key} type="button" role="tab" id={`${tabsId}-tab-${t.key}`} aria-selected={active}
                  aria-controls={`${tabsId}-panel-${t.key}`} tabIndex={active ? 0 : -1} onClick={() => setView(t.key)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
                    t.urgent && !active ? "ring-2 ring-[oklch(0.6_0.19_25)]/50" : "",
                  ].join(" ")}>
                  {t.urgent && <span className="h-2 w-2 rounded-full bg-[oklch(0.6_0.19_25)]" aria-hidden="true" />}
                  {t.label}
                  {t.key !== "plan" && t.count > 0 && <span>({t.count})</span>}
                  {t.key === "plan" && t.count > 0 && <span className="font-normal">· borrador</span>}
                </button>
              );
            })}
          </div>
          {/* Las tres vistas quedan montadas: cambiar de vista no pierde lo que se estaba escribiendo */}
          <div role="tabpanel" id={`${tabsId}-panel-plan`} aria-labelledby={`${tabsId}-tab-plan`} hidden={view !== "plan"}>
            <PortalPracticePlan {...props} />
          </div>
          <div role="tabpanel" id={`${tabsId}-panel-followup`} aria-labelledby={`${tabsId}-tab-followup`} hidden={view !== "followup"}>
            <PortalPracticeFollowup {...props} />
          </div>
          <div role="tabpanel" id={`${tabsId}-panel-goals`} aria-labelledby={`${tabsId}-tab-goals`} hidden={view !== "goals"}>
            <PortalPracticeGoals {...props} medalAsk={goalsAsk} />
          </div>
          {/* Grabaciones: se carga recién al abrirla (el audio, al abrir cada una) */}
          {view === "recordings" && (
            <div role="tabpanel" id={`${tabsId}-panel-recordings`} aria-labelledby={`${tabsId}-tab-recordings`}>
              <PortalRecordings patientId={patientId} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
