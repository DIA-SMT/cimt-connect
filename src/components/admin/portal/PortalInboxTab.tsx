import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BellRing, Clock, IdCard, Loader2, PackageCheck, RefreshCw, Scale, TriangleAlert, Undo2, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectClass } from "../fields";
import { HC_REJECT_TEXT, REASONS, apptDateLabel, isValidDni, normalizeDni, stampLabel } from "@/lib/portal";
import {
  type HcEventKind, type HcRejectReason, type HcStaffTarget, type HcStatus, type NoticeAction,
  type NoticeResolution, type StaffHcRequest, type StaffInbox, type StaffNotice,
  HC_EVENT_LABEL, HC_REJECT_LABEL, HC_REJECT_REASONS, HC_STATUS_LABEL, HC_TRANSITIONS, NOTICE_ACTIONS,
  NOTICE_ACTION_LABEL, RESOLUTION_LABEL, dniWithDots, portalStaffApi,
} from "@/lib/portalStaff";
import { type HcLinkKind, centerNow } from "@/lib/portalRules";

// Pestaña "Portal": bandeja de lo que mandan las familias desde el portal.
//   - Pedidos de copia de la historia clínica: el equipo la prepara, avisa que
//     está lista y registra a quién se la entregó (en mano, con DNI).
//   - Avisos de "no vamos a poder ir": el equipo decide qué pasa con el turno.
// La ve todo el panel. Acá sí hay nombres y DNI: nada de esto vuelve a la familia.

type Props = {
  /** Abre la ficha del paciente */
  onOpenPatient: (patientId: string) => void;
  /** Avisa al panel cuántas cosas quedan por resolver (para el número de la pestaña y el cartel de avisos) */
  onCountChange: (pending: { hc: number; notices: number }) => void;
  /** Con qué lista abrir (el cartel de avisos abre directo en "Avisos de turnos") */
  initialView?: View;
};

type View = "hc" | "notices";
type Tone = "warn" | "ok" | "bad" | "info" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  warn: "bg-[color:var(--status-pending-bg)] text-[oklch(0.45_0.11_70)]",
  ok: "bg-[color:var(--status-available-bg)] text-[oklch(0.42_0.12_150)]",
  bad: "bg-[color:var(--status-occupied-bg)] text-[oklch(0.48_0.19_25)]",
  info: "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]",
  muted: "bg-muted text-muted-foreground",
};
const TEXT_WARN = "text-[oklch(0.45_0.11_70)]";
const TEXT_BAD = "text-[oklch(0.5_0.19_25)]";

const HC_TONE: Record<HcStatus, Tone> = {
  pendiente: "warn",
  lista: "info",
  entregada: "ok",
  rechazada: "bad",
  cancelada: "muted",
};

const LINK_KIND_LABEL: Record<HcLinkKind, string> = {
  titular: "el propio paciente",
  representante_legal: "madre, padre o tutor/a",
};

type Done = { text: string; family?: string };
const doneText = (d: Done, instead: string | null) => [d.text, instead ?? d.family].filter(Boolean).join(" ");

const HC_DONE: Record<HcStaffTarget, Done> = {
  lista: { text: "Marcada como lista para retirar.", family: "La familia lo ve en el portal." },
  entregada: { text: "Entrega registrada." },
  rechazada: { text: "Pedido rechazado.", family: "La familia ve el motivo en el portal." },
  pendiente: { text: "El pedido volvió a pendiente." },
};
// still_allowed === false: quien pidió la copia ya no tiene derecho a pedirla,
// así que el pedido desapareció de su portal
const HC_GONE = "Quien la pidió ya no ve este pedido en el portal: avisale por teléfono.";

const NOTICE_DONE: Record<NoticeAction, Done> = {
  justificar: { text: "Falta justificada.", family: "La familia lo ve en el portal." },
  cancelar: { text: "Turno cancelado.", family: "La familia lo ve en el portal." },
  reprogramar: { text: "Aviso resuelto. Reprogramá el turno desde la agenda." },
  visto: { text: "Aviso marcado como visto." },
};
// El portal muestra los turnos desde hoy: los de días anteriores la familia ya no los ve
const NOTICE_GONE = "La familia ya no ve este turno en el portal: si hace falta, avisale por otro medio.";
// Qué hace cada acción con el turno (en lugar de lo que ve la familia, para los turnos que ya no ve)
const NOTICE_EFFECT: Record<NoticeAction, string> = {
  justificar: "Carga «justificado» en la asistencia del turno.",
  cancelar: "Cancela el turno.",
  reprogramar: "El turno se reprograma desde la agenda.",
  visto: "El turno no cambia.",
};
const RESOLUTION_TONE: Record<NoticeResolution, Tone> = {
  justificado: "info",
  cancelado: "info",
  reprogramado: "info",
  otro: "info",
  asistio: "ok",
};

// El turno ya empezó (el servidor no deja cancelarlo)
const apptPast = (n: Pick<StaffNotice, "date" | "time" | "is_past">, now = centerNow()) =>
  n.is_past || `${n.date} ${n.time}` <= `${now.date} ${now.time}`;

const HOUR_MS = 60 * 60 * 1000;
const isOpen = (s: HcStatus) => s === "pendiente" || s === "lista";

function hoursSince(iso: string, now: number): number {
  return (now - Date.parse(iso)) / HOUR_MS;
}

// "recién", "hace 20 min", "hace 5 h", "hace 2 días"
function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (mins < 1) return "recién";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

function closedAt(r: StaffHcRequest): number {
  return Date.parse(r.delivered_at ?? r.rejected_at ?? r.cancelled_at ?? r.created_at);
}

// Pendientes y listas primero (los más viejos arriba); después los cerrados, los más nuevos arriba
function sortHc(list: StaffHcRequest[]): StaffHcRequest[] {
  const rank = (s: HcStatus) => (s === "pendiente" ? 0 : s === "lista" ? 1 : 2);
  return [...list].sort((a, b) => rank(a.status) - rank(b.status)
    || (isOpen(a.status)
      ? Date.parse(a.created_at) - Date.parse(b.created_at)
      : closedAt(b) - closedAt(a)));
}

function pendingOf(d: StaffInbox) {
  return {
    hc: d.hc.filter((r) => r.status === "pendiente").length,
    notices: d.notices.filter((n) => n.resolution === null).length,
  };
}

export function PortalInboxTab({ onOpenPatient, onCountChange, initialView }: Props) {
  const [data, setData] = useState<StaffInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(initialView ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<{ id: string; how: NoticeAction } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setRefreshing(true);
    const r = await portalStaffApi.inbox();
    setRefreshing(false);
    setLoading(false);
    setNow(Date.now());
    if (!r.ok) { setLoadError(r.error); return; }
    setLoadError(null);
    setData(r.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  // La antigüedad de los pedidos ("hace 5 h") se recalcula sola
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const pending = useMemo(() => (data ? pendingOf(data) : null), [data]);

  // Número de la pestaña del panel
  useEffect(() => {
    if (pending) onCountChange(pending);
  }, [pending, onCountChange]);

  // Sin elección previa, abre en los avisos si hay alguno sin resolver: son lo más urgente
  const shown: View = view ?? (pending && pending.notices > 0 ? "notices" : "hc");

  const hc = useMemo(() => sortHc(data?.hc ?? []), [data]);
  // Pendientes primero; el servidor ya las ordena por fecha del turno
  const notices = useMemo(() => [...(data?.notices ?? [])]
    .sort((a, b) => Number(a.resolution !== null) - Number(b.resolution !== null)), [data]);

  function patchHc(row: StaffHcRequest) {
    setData((d) => d && { ...d, hc: d.hc.map((x) => (x.id === row.id ? row : x)) });
  }

  // Solo las notas: el resto de la fila puede haber cambiado mientras se guardaban
  function patchHcNotes(id: string, notes: string | null) {
    setData((d) => d && { ...d, hc: d.hc.map((x) => (x.id === id ? { ...x, staff_notes: notes } : x)) });
  }

  async function resolveNotice(n: StaffNotice, how: NoticeAction) {
    if (how === "cancelar" && apptPast(n)) {
      toast.error("El turno ya pasó: no se puede cancelar. Usá «Justificar la falta» o «Tomamos nota».");
      return;
    }
    if (how === "cancelar" && !window.confirm(
      `¿Cancelar el turno de ${n.patient_name} del ${apptDateLabel(n)}? ${n.family_sees ? "La familia va a ver «Cancelamos el turno por tu aviso»." : NOTICE_GONE}`,
    )) return;
    setResolving({ id: n.response_id, how });
    const r = await portalStaffApi.resolveNotice(n.response_id, how);
    if (r.ok) toast.success(doneText(NOTICE_DONE[how], n.family_sees ? null : NOTICE_GONE));
    else toast.error(r.error);
    // Siempre se vuelve a cargar: también después de un 409 (otra persona lo
    // resolvió, la familia cambió su respuesta o el turno cambió)
    await load();
    setResolving(null);
  }

  if (loading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  const openHc = openId ? data?.hc.find((r) => r.id === openId) : undefined;

  return (
    <div className="mt-6 max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-[color:var(--primary-deep)]">Portal de familias</h2>
          <p className="text-sm text-muted-foreground">
            Pedidos de copia del historial del paciente y avisos de turnos que mandan las familias desde el portal.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load()} disabled={refreshing} aria-busy={refreshing}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden /> Actualizar
        </Button>
      </div>

      {!data || !pending ? (
        <div className="rounded-2xl border border-border/60 bg-card px-4 py-16 text-center text-sm text-muted-foreground shadow-[var(--shadow-card)]">
          <p role="alert">{loadError ?? "No se pudo cargar la bandeja."}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => load()} disabled={refreshing}>Probar de nuevo</Button>
        </div>
      ) : (
        <>
          {loadError && (
            <p role="alert" className={`text-sm ${TEXT_BAD}`}>No se pudo actualizar la bandeja: {loadError}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Chip active={shown === "hc"} onClick={() => setView("hc")}>
              Copias del historial ({pending.hc})
            </Chip>
            <Chip active={shown === "notices"} urgent={pending.notices > 0} onClick={() => setView("notices")}>
              Avisos de turnos ({pending.notices})
            </Chip>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
            {shown === "hc" ? (
              <HcList list={hc} now={now} onOpen={setOpenId} />
            ) : (
              <NoticeList list={notices} now={now} resolving={resolving} onResolve={resolveNotice} onOpenPatient={onOpenPatient} />
            )}
          </div>
        </>
      )}

      {openHc && (
        <HcDialog
          key={openHc.id}
          request={openHc}
          now={now}
          onClose={() => setOpenId(null)}
          onSaved={patchHc}
          onNotesSaved={patchHcNotes}
          onReload={load}
          onOpenPatient={onOpenPatient}
        />
      )}
    </div>
  );
}

// ─── Pedidos de copia de la historia clínica ─────────────────────────────────

function HcList({ list, now, onOpen }: { list: StaffHcRequest[]; now: number; onOpen: (id: string) => void }) {
  if (list.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">No hay pedidos de copia del historial del paciente.</div>;
  }
  const open = list.filter((r) => isOpen(r.status));
  const closed = list.filter((r) => !isOpen(r.status));
  return (
    <ul className="divide-y divide-border/60">
      {open.length === 0
        ? <li className="py-10 text-center text-sm text-muted-foreground">No hay pedidos abiertos.</li>
        : open.map((r) => <HcRow key={r.id} r={r} now={now} onOpen={() => onOpen(r.id)} />)}
      {closed.length > 0 && <GroupLabel>Cerrados en los últimos 30 días</GroupLabel>}
      {closed.map((r) => <HcRow key={r.id} r={r} now={now} onOpen={() => onOpen(r.id)} />)}
    </ul>
  );
}

function hcDetail(r: StaffHcRequest): string | null {
  switch (r.status) {
    case "pendiente": return null;
    case "lista": return r.ready_at ? `Lista desde el ${stampLabel(r.ready_at)}` : null;
    case "entregada": return r.delivered_at
      ? `Entregada el ${stampLabel(r.delivered_at)}${r.delivered_to_name ? ` a ${r.delivered_to_name}` : ""}`
      : null;
    case "rechazada": return r.reject_reason ? `Motivo: ${HC_REJECT_LABEL[r.reject_reason]}` : null;
    case "cancelada": return r.cancelled_at ? `La familia lo canceló el ${stampLabel(r.cancelled_at)}` : null;
  }
}

function HcRow({ r, now, onOpen }: { r: StaffHcRequest; now: number; onOpen: () => void }) {
  const hours = hoursSince(r.created_at, now);
  const late = r.status === "pendiente" && hours >= 48;
  const slow = r.status === "pendiente" && hours >= 24;
  const detail = hcDetail(r);
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="grid w-full gap-1 p-4 text-left transition-colors hover:bg-[color:var(--primary-soft)]/40 md:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{r.patient_name}</span>
          <Pill tone={HC_TONE[r.status]}>{HC_STATUS_LABEL[r.status]}</Pill>
          {r.still_allowed === false && <Pill tone="bad">Ya no está habilitado</Pill>}
          <span title={`Pedido el ${stampLabel(r.created_at)}`}
            className={`ml-auto inline-flex items-center gap-1 text-xs ${late ? `font-semibold ${TEXT_BAD}` : slow ? `font-semibold ${TEXT_WARN}` : "text-muted-foreground"}`}>
            {slow && <Clock className="h-3.5 w-3.5" aria-hidden />}
            {ago(r.created_at, now)}{late && " · Pasaron más de 48 h"}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Pidió {r.requester_name} · {LINK_KIND_LABEL[r.link_kind]}
        </div>
        {detail && <div className="text-xs font-semibold text-[color:var(--primary-deep)]">{detail}</div>}
      </button>
    </li>
  );
}

type HcStep = { kind: HcEventKind; at: string; who: string | null; detail: string | null };

// Seguimiento del pedido, del paso más viejo al más nuevo: la constancia de
// cada paso (events) y, para lo que no tenga constancia (pedidos de antes, o
// si no se pudo guardar), las fechas del pedido, sin repetir.
function hcTimeline(r: StaffHcRequest): HcStep[] {
  const steps: HcStep[] = (r.events ?? []).map((e) => ({
    kind: e.kind, at: e.at, who: e.by_email ?? "la familia", detail: null,
  }));
  const add = (kind: HcEventKind, at: string | null, who: string | null) => {
    if (at && !steps.some((s) => s.kind === kind)) steps.push({ kind, at, who, detail: null });
  };
  add("pedido", r.created_at, "la familia");
  add("lista", r.ready_at, r.ready_by_email);
  add("entregada", r.delivered_at, r.delivered_by_email);
  add("rechazada", r.rejected_at, r.rejected_by_email);
  add("cancelada", r.cancelled_at, "la familia");
  const delivered = r.delivered_to_name
    ? `a ${r.delivered_to_name}${r.delivered_to_dni ? ` (DNI ${dniWithDots(r.delivered_to_dni)})` : ""}`
    : null;
  const rejected = r.reject_reason ? `Motivo: ${HC_REJECT_LABEL[r.reject_reason]}` : null;
  for (const s of steps) s.detail = s.kind === "entregada" ? delivered : s.kind === "rechazada" ? rejected : null;
  return steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function HcDialog({ request: r, now, onClose, onSaved, onNotesSaved, onReload, onOpenPatient }: {
  request: StaffHcRequest;
  now: number;
  onClose: () => void;
  onSaved: (row: StaffHcRequest) => void;
  onNotesSaved: (id: string, notes: string | null) => void;
  onReload: () => Promise<void>;
  onOpenPatient: (patientId: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "deliver" | "reject">("idle");
  const [busy, setBusy] = useState<HcStaffTarget | null>(null);
  const [error, setError] = useState<{ msg: string; stale: boolean } | null>(null);
  const [toName, setToName] = useState(r.requester_name);
  const [toDni, setToDni] = useState(r.requester_dni);
  const [reason, setReason] = useState<HcRejectReason | "">(r.still_allowed === false ? "no_habilitado" : "");
  const [notes, setNotes] = useState(r.staff_notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const allowed = HC_TRANSITIONS[r.status];
  const notesDirty = notes.trim() !== (r.staff_notes ?? "");

  function changeMode(m: typeof mode) {
    setError(null);
    setMode(m);
  }

  async function go(to: HcStaffTarget, extra: { delivered_to_name?: string; delivered_to_dni?: string; reject_reason?: HcRejectReason } = {}) {
    if (busy || savingNotes) return;
    setBusy(to);
    setError(null);
    const res = await portalStaffApi.hcUpdate({ id: r.id, to, ...extra });
    if (!res.ok) {
      const stale = res.status === 409;
      setError({ msg: res.error, stale });
      // Otra persona lo cambió: se trae el estado actual del pedido
      if (stale) await onReload();
      setBusy(null);
      return;
    }
    setBusy(null);
    onSaved(res.data);
    setMode("idle");
    // Si quien pidió ya no está habilitado, el pedido ya no aparece en su portal
    const gone = to !== "pendiente" && (r.still_allowed === false || res.data.still_allowed === false);
    toast.success(doneText(HC_DONE[to], gone ? HC_GONE : null));
  }

  function deliver(e: React.FormEvent) {
    e.preventDefault();
    const name = toName.replace(/\s+/g, " ").trim();
    const dni = normalizeDni(toDni);
    if (name.length < 3) { setError({ msg: "Escribí el nombre de quien la retiró.", stale: false }); return; }
    if (!isValidDni(dni)) { setError({ msg: "Revisá el DNI de quien la retiró.", stale: false }); return; }
    go("entregada", { delivered_to_name: name, delivered_to_dni: dni });
  }

  function reject(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) { setError({ msg: "Elegí el motivo.", stale: false }); return; }
    go("rechazada", { reject_reason: reason });
  }

  async function saveNotes() {
    if (busy || savingNotes) return;
    const clean = notes.trim();
    setSavingNotes(true);
    const res = await portalStaffApi.hcNotes(r.id, clean);
    setSavingNotes(false);
    if (!res.ok) { toast.error(res.error); return; }
    // Solo las notas: el estado del pedido puede haber cambiado mientras tanto
    onNotesSaved(r.id, clean || null);
    // Si se siguió escribiendo mientras se guardaba, no se pisa lo nuevo
    setNotes((cur) => (cur.trim() === clean ? clean : cur));
    toast.success("Notas guardadas");
  }

  async function reload() {
    setError(null);
    await onReload();
  }

  const steps = hcTimeline(r);
  // Mientras se guardan las notas no se cambia el estado, y al revés
  const locked = !!busy || savingNotes;

  const primary = "bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">{r.patient_name}</DialogTitle>
          <DialogDescription>
            Copia del historial del paciente · <Pill tone={HC_TONE[r.status]}>{HC_STATUS_LABEL[r.status]}</Pill>
          </DialogDescription>
        </DialogHeader>

        {r.still_allowed === false && (
          <div role="alert" className={`flex gap-2 rounded-xl bg-[color:var(--status-occupied-bg)] p-3 text-sm ${TEXT_BAD}`}>
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Quien la pidió ya no tiene derecho a pedir la copia: el paciente cumplió 18 y la había pedido un adulto
              responsable, se quitó o se cambió al adulto en la ficha, o se borró la cuenta. {HC_GONE} Verificá antes
              de entregar.
            </p>
          </div>
        )}
        {r.still_allowed === null && isOpen(r.status) && (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            No pudimos verificar si quien la pidió sigue habilitado. Revisá la ficha antes de entregar.
          </p>
        )}

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Item label="DNI del paciente" value={r.patient_dni ? dniWithDots(normalizeDni(r.patient_dni)) : "Sin DNI en la ficha"} />
          <Item label="Pedido" value={`${stampLabel(r.created_at)} (${ago(r.created_at, now)})`} />
          <Item label="Pidió" value={`${r.requester_name} · ${LINK_KIND_LABEL[r.link_kind]}`} />
          <Item label="DNI de quien pidió" value={dniWithDots(r.requester_dni)} />
        </dl>

        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Seguimiento</div>
          <ol className="mt-1 space-y-1">
            {steps.map((s, i) => (
              <li key={`${s.kind}-${s.at}-${i}`}>
                <span className="font-semibold">{HC_EVENT_LABEL[s.kind]}:</span>{" "}
                {[stampLabel(s.at), s.detail, s.who && `por ${s.who}`].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ol>
        </div>

        <p className="flex gap-2 text-xs text-muted-foreground">
          <Scale className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Ley 26.529: la copia se entrega dentro de las 48 h de pedida, en mano y con DNI.
        </p>

        {(allowed.length > 0 || error) && (
          <div className="space-y-3 rounded-2xl border border-border/60 p-4">
            {mode === "idle" && allowed.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {allowed.includes("lista") && (
                  <Button size="sm" disabled={locked} onClick={() => go("lista")} className={primary}>
                    {busy === "lista" ? <Loader2 className="mr-1.5 animate-spin" /> : <PackageCheck className="mr-1.5" />}
                    Marcar lista para retirar
                  </Button>
                )}
                {allowed.includes("entregada") && (
                  <Button size="sm" variant={r.status === "lista" ? "default" : "outline"} disabled={locked}
                    onClick={() => changeMode("deliver")} className={r.status === "lista" ? primary : ""}>
                    <IdCard className="mr-1.5" /> Registrar entrega
                  </Button>
                )}
                {allowed.includes("pendiente") && (
                  <Button size="sm" variant="outline" disabled={locked} onClick={() => go("pendiente")}>
                    {busy === "pendiente" ? <Loader2 className="mr-1.5 animate-spin" /> : <Undo2 className="mr-1.5" />}
                    Volver a pendiente
                  </Button>
                )}
                {allowed.includes("rechazada") && (
                  <Button size="sm" variant="outline" disabled={locked} onClick={() => changeMode("reject")} className={TEXT_BAD}>
                    <XCircle className="mr-1.5" /> Rechazar
                  </Button>
                )}
              </div>
            )}

            {mode === "deliver" && allowed.includes("entregada") && (
              <form onSubmit={deliver} className="space-y-3">
                <div className="text-sm font-bold">Registrar entrega</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="hc-to-name">Nombre de quien la retiró</Label>
                    <Input id="hc-to-name" value={toName} maxLength={120} autoComplete="off"
                      onChange={(e) => setToName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hc-to-dni">DNI de quien la retiró</Label>
                    <Input id="hc-to-dni" value={toDni} inputMode="numeric" maxLength={12} autoComplete="off"
                      onChange={(e) => setToDni(e.target.value)} />
                  </div>
                </div>
                <p className={`flex items-center gap-1.5 text-xs font-semibold ${TEXT_WARN}`}>
                  <IdCard className="h-3.5 w-3.5 shrink-0" aria-hidden /> Verificá el DNI en persona
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => changeMode("idle")}>Volver</Button>
                  <Button type="submit" size="sm" disabled={locked} className={primary}>
                    {busy === "entregada" && <Loader2 className="mr-1.5 animate-spin" />}
                    Confirmar entrega
                  </Button>
                </div>
              </form>
            )}

            {mode === "reject" && allowed.includes("rechazada") && (
              <form onSubmit={reject} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="hc-reject">Motivo del rechazo</Label>
                  <select id="hc-reject" value={reason} onChange={(e) => setReason(e.target.value as HcRejectReason | "")}
                    className={selectClass}>
                    <option value="" disabled>Elegí el motivo</option>
                    {HC_REJECT_REASONS.map((k) => <option key={k} value={k}>{HC_REJECT_LABEL[k]}</option>)}
                  </select>
                  {r.still_allowed === false ? (
                    <p className={`text-xs font-semibold ${TEXT_BAD}`}>{HC_GONE}</p>
                  ) : reason && (
                    <p className="text-xs text-muted-foreground">La familia va a ver: «{HC_REJECT_TEXT[reason]}»</p>
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => changeMode("idle")}>Volver</Button>
                  <Button type="submit" size="sm" variant="destructive" disabled={locked || !reason}>
                    {busy === "rechazada" && <Loader2 className="mr-1.5 animate-spin" />}
                    Confirmar rechazo
                  </Button>
                </div>
              </form>
            )}

            {error && (
              <div role="alert" className={`flex flex-wrap items-center gap-x-2 text-sm ${TEXT_BAD}`}>
                <span>{error.msg}</span>
                {error.stale && (
                  <Button type="button" size="sm" variant="link" className="h-auto p-0" onClick={reload}>Actualizar</Button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="hc-notes">Notas internas (la familia no las ve)</Label>
          <Textarea id="hc-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Se avisó por teléfono que está lista" />
          <div className="flex min-h-8 items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{notes.length}/500</span>
            {notesDirty && (
              <Button size="sm" variant="outline" disabled={locked} onClick={saveNotes}>
                {savingNotes && <Loader2 className="mr-1.5 animate-spin" />}
                Guardar notas
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-3">
          <Button variant="outline" onClick={() => { onClose(); onOpenPatient(r.patient_id); }}>
            <UserRound className="mr-1.5" /> Abrir ficha
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cerrar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Avisos de "no vamos a poder ir" ─────────────────────────────────────────

function NoticeList({ list, now, resolving, onResolve, onOpenPatient }: {
  list: StaffNotice[];
  now: number;
  resolving: { id: string; how: NoticeAction } | null;
  onResolve: (n: StaffNotice, how: NoticeAction) => void;
  onOpenPatient: (patientId: string) => void;
}) {
  if (list.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">No hay avisos de turnos para mostrar.</div>;
  }
  // Hora del centro: se recalcula con el reloj de la bandeja (cada minuto)
  const center = centerNow(new Date(now));
  const open = list.filter((n) => n.resolution === null);
  const done = list.filter((n) => n.resolution !== null);
  const tomorrow = nextDateKey(center.date);
  const row = (n: StaffNotice) => (
    <NoticeRow key={n.response_id} n={n} past={apptPast(n, center)} gone={!n.family_sees}
      soon={n.date === center.date ? "hoy" : n.date === tomorrow ? "mañana" : null}
      resolving={resolving} onResolve={onResolve} onOpenPatient={onOpenPatient} />
  );
  return (
    <ul className="divide-y divide-border/60">
      {open.length === 0
        ? <li className="py-10 text-center text-sm text-muted-foreground">No hay avisos sin resolver.</li>
        : open.map(row)}
      {done.length > 0 && <GroupLabel>Resueltos en los últimos 14 días</GroupLabel>}
      {done.map(row)}
    </ul>
  );
}

function NoticeRow({ n, past, gone, soon, resolving, onResolve, onOpenPatient }: {
  n: StaffNotice;
  soon: "hoy" | "mañana" | null; // el turno es hoy o mañana: más urgente
  past: boolean; // el turno ya empezó: no se puede cancelar
  gone: boolean; // el turno es de un día anterior: la familia ya no lo ve en el portal
  resolving: { id: string; how: NoticeAction } | null;
  onResolve: (n: StaffNotice, how: NoticeAction) => void;
  onOpenPatient: (patientId: string) => void;
}) {
  const reason = n.reason_code ? REASONS.find((x) => x.code === n.reason_code)?.label ?? null : null;
  // Un turno que ya pasó no se puede cancelar (el servidor lo rechaza)
  const actions = NOTICE_ACTIONS.filter((how) => !(how === "cancelar" && past));
  const urgent = n.resolution === null;
  return (
    <li className={`grid gap-2 p-4 md:px-5 ${urgent ? "border-l-4 border-l-[oklch(0.6_0.19_25)] bg-[color:var(--status-occupied-bg)]/40" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {urgent && <BellRing className={`h-4 w-4 shrink-0 ${TEXT_BAD}`} aria-hidden />}
        <span className="font-bold">{n.patient_name}</span>
        {urgent && soon && !past && <Pill tone="bad">{soon === "hoy" ? "Turno hoy" : "Turno mañana"}</Pill>}
        {n.resolution && <Pill tone={RESOLUTION_TONE[n.resolution]}>{RESOLUTION_LABEL[n.resolution]}</Pill>}
        {past && <Pill tone="muted">El turno ya pasó</Pill>}
        <Button size="sm" variant="ghost" className="ml-auto h-8 px-2 text-xs" onClick={() => onOpenPatient(n.patient_id)}>
          <UserRound className="mr-1" /> Abrir ficha
        </Button>
      </div>
      <div className="text-sm font-semibold text-[color:var(--primary-deep)]">
        {apptDateLabel(n)} · {n.professional_name ?? "Sin profesional"}
        {n.modality === "telemedicina" && " · Telemedicina"}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>
          Avisó {n.requester_name ?? "una cuenta borrada"}{n.is_self ? " (el propio paciente)" : ""} · {stampLabel(n.at)}
        </span>
        <Pill tone={n.on_time ? "ok" : "warn"}>{n.on_time ? "a tiempo" : "tarde"}</Pill>
      </div>
      {(reason || n.reason_text) && (
        <p className="text-sm text-foreground/80">
          {reason}{reason && n.reason_text && ": "}{n.reason_text && `«${n.reason_text}»`}
        </p>
      )}

      {n.resolution === null ? (
        <>
          {gone && (
            <p className={`flex items-center gap-1.5 text-xs font-semibold ${TEXT_WARN}`}>
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> {NOTICE_GONE}
            </p>
          )}
          <div role="group" aria-label={`Resolver el aviso de ${n.patient_name}`}
            className={`grid grid-cols-2 gap-2 pt-1 ${actions.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            {actions.map((how) => {
              const busy = resolving?.id === n.response_id && resolving.how === how;
              return (
                <button key={how} type="button" disabled={!!resolving} onClick={() => onResolve(n, how)} aria-busy={busy}
                  className="flex flex-col justify-start rounded-xl border border-border/60 p-2.5 text-left transition-colors hover:bg-[color:var(--primary-soft)]/40 disabled:cursor-not-allowed disabled:opacity-60">
                  <span className={`flex items-center gap-1.5 text-sm font-semibold ${how === "cancelar" ? TEXT_BAD : ""}`}>
                    {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />}
                    {NOTICE_ACTION_LABEL[how].label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {gone ? NOTICE_EFFECT[how] : NOTICE_ACTION_LABEL[how].family}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (n.resolved_by_email || n.resolved_at) && (
        <p className="text-xs text-muted-foreground">
          Resuelto{n.resolved_by_email ? ` por ${n.resolved_by_email}` : ""}
          {n.resolved_at && `${n.resolved_by_email ? " ·" : " el"} ${stampLabel(n.resolved_at)}`}
        </p>
      )}
    </li>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <li className="bg-muted/40 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground md:px-5">
      {children}
    </li>
  );
}

function Chip({ active, urgent = false, onClick, children }: { active: boolean; urgent?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={[
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
      urgent && !active ? "ring-2 ring-[oklch(0.6_0.19_25)]/50" : "",
    ].join(" ")}>
      {urgent && <span className="h-2 w-2 rounded-full bg-[oklch(0.6_0.19_25)]" aria-hidden />}
      {children}
    </button>
  );
}

// Día siguiente de una fecha AAAA-MM-DD (fecha del centro)
function nextDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
