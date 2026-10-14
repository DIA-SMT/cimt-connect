import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BellRing, CalendarCheck, CalendarPlus, ChevronDown, Clock, Eye, FileText, IdCard, Loader2, NotebookPen, PackageCheck,
  Phone, PhoneCall, RefreshCw, Scale, Send, Trash2, TriangleAlert, Undo2, Upload, UserRound, XCircle, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectClass } from "../fields";
import { HC_REJECT_TEXT, REASONS, apptDateLabel, capitalize, isValidDni, normalizeDni, stampLabel } from "@/lib/portal";
import {
  type HcChannel, type HcEventKind, type HcRejectReason, type HcSendAcks, type HcStaffTarget, type HcStatus,
  type NoticeAction, type NoticeResolution, type StaffHcDocument, type StaffHcRequest, type StaffInbox, type StaffNotice,
  APPT_REQ_REJECT_LABEL, APPT_REQ_STATUS_LABEL, HC_DOC_MAX_BYTES, HC_DOC_MAX_FILES, HC_EVENT_LABEL, HC_REJECT_LABEL,
  HC_REJECT_REASONS, HC_STATUS_LABEL, HC_TRANSITIONS, NOTICE_ACTIONS, NOTICE_ACTION_LABEL, RESOLUTION_LABEL, dniWithDots,
  portalStaffApi,
} from "@/lib/portalStaff";
import { type HcLinkKind, HC_VISIBLE_DAYS, centerNow, hcAvailableUntil } from "@/lib/portalRules";
import { ADOLESCENT_FROM, ADULT_FROM } from "@/lib/portalClinicalRules";
import { HC_LINK_SECONDS } from "@/lib/hcDigitalRules";
import { usePortalClinicalFeatures } from "./usePortalClinicalFeatures";
import {
  type ApptReqEventKind, type ApptReqReason, type ApptReqRejectReason, type ApptReqStaffTarget, type ApptReqStatus,
  type StaffApptRequest, type StaffApptSlot, type Weekday,
  APPT_REQ_MODALITY_LABEL, APPT_REQ_REJECT_REASONS, APPT_REQ_TRANSITIONS, TIME_BAND_LABEL, WEEKDAYS, WEEKDAY_LABEL,
  apptReqOpen,
} from "@/lib/apptRequestRules";

// Pestaña "Portal": bandeja de lo que mandan las familias desde el portal.
//   - Pedidos de copia de la historia clínica: el equipo la prepara, avisa que
//     está lista y registra a quién se la entregó (en mano, con DNI). Si la
//     familia pidió recibirla en el portal (copia digital, etapa E1), un
//     profesional o la Dirección sube los PDF firmados por la Dirección, los
//     revisa y la envía; la entrega en mano sigue estando siempre.
//   - Avisos de "no vamos a poder ir": el equipo decide qué pasa con el turno.
//   - Pedidos de turno: la familia cuenta para qué es y qué días y horarios le
//     quedan bien; el equipo lo carga en la Agenda y lo marca agendado (con el
//     turno enlazado), la llama para coordinar o le dice por qué no se puede.
// La ve todo el panel. Acá sí hay nombres y DNI: nada de esto vuelve a la familia.

type Props = {
  /** Abre la ficha del paciente */
  onOpenPatient: (patientId: string) => void;
  /** Avisa al panel cuántas cosas quedan por resolver (para el número de la pestaña y el cartel de avisos) */
  onCountChange: (pending: { hc: number; notices: number; turnos: number }) => void;
  /** Con qué lista abrir (el cartel de avisos abre directo en "Avisos de turnos") */
  initialView?: View;
};

type View = "hc" | "notices" | "turnos";
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
  enviada: "ok",
};

const LINK_KIND_LABEL: Record<HcLinkKind, string> = {
  titular: "el propio paciente",
  representante_legal: "madre, padre o tutor/a",
};

// Cómo pidió recibir la copia
const HC_CHANNEL_LABEL: Record<HcChannel, string> = {
  portal: "En el portal",
  mano: "En mano, en el centro",
};
// Un servidor anterior a la copia digital no manda el canal. Una copia
// enviada se pidió siempre en el portal
const hcChannel = (r: StaffHcRequest): HcChannel => (r.status === "enviada" ? "portal" : r.channel ?? "mano");
const hcDocs = (r: StaffHcRequest): StaffHcDocument[] => r.documents ?? [];

// digital_ok === false no dice por qué: si el servidor contestó con su motivo
// (por ejemplo, el portal del paciente en pausa), se muestra ese
const HC_DIGITAL_BLOCKED = "Esta cuenta no puede recibirla por el portal (no aceptó recibir información clínica, falta verificar el vínculo o el portal del paciente está en pausa): entregala en mano.";
// Al enviar, el servidor contesta 409 con este mensaje si los PDF del pedido
// ya no son los que estaban en pantalla (alguien subió o quitó uno)
const HC_DOCS_CHANGED = "La lista de PDF cambió";
const PRIMARY_BTN = "bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]";

// De 13 a 17 se suma una confirmación al enviar la copia por el portal
const isAdolescent = (age: number | null) => age !== null && age >= ADOLESCENT_FROM && age < ADULT_FROM;

// "Apellido, Nombre" → nombre de pila y "Nombre Apellido"
function nameParts(patientName: string): { first: string; full: string } {
  const [last, first] = patientName.split(",").map((s) => s.trim());
  return first ? { first, full: `${first} ${last}` } : { first: patientName, full: patientName };
}

// "12/10"
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

// "2,4 MB"
function mbLabel(bytes: number): string {
  return `${Math.max(0.1, bytes / (1024 * 1024)).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;
}

// Revisión antes de subir (el servidor vuelve a revisar todo): null si está bien
function checkPdfs(files: File[], already: number): string | null {
  const left = HC_DOC_MAX_FILES - already;
  if (files.length > left) {
    return left <= 0
      ? `Ya hay ${HC_DOC_MAX_FILES} PDF, el máximo por pedido. Quitá uno para subir otro.`
      : `Se pueden subir hasta ${HC_DOC_MAX_FILES} PDF por pedido${already ? ` y ya hay ${already}` : ""}: elegí ${left === 1 ? "1 más" : `hasta ${left} más`}.`;
  }
  for (const f of files) {
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      return `«${f.name}» no es un PDF. Imprimí la historia desde la ficha a PDF y subí ese archivo.`;
    }
    if (f.size === 0) return `«${f.name}» está vacío.`;
    if (f.size > HC_DOC_MAX_BYTES) {
      return `«${f.name}» pesa ${mbLabel(f.size)}: el máximo es ${mbLabel(HC_DOC_MAX_BYTES)} por archivo.`;
    }
  }
  return null;
}

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
  return Date.parse(r.delivered_at ?? r.sent_at ?? r.rejected_at ?? r.cancelled_at ?? r.created_at);
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
    // Como en las copias: cuentan los que nadie miró todavía ("La vamos a llamar" ya tiene quien se ocupe)
    turnos: d.turnos.filter((r) => r.status === "pendiente").length,
  };
}

// Con qué lista abrir si no se eligió ninguna: los avisos si hay alguno sin
// resolver (son lo más urgente); después las copias (tienen plazo de 48 h) y,
// si no hay ninguna pendiente, los pedidos de turno. Se decide una sola vez,
// con la primera carga: después la lista no cambia sola al resolver algo.
function defaultView(p: ReturnType<typeof pendingOf>): View {
  if (p.notices > 0) return "notices";
  if (p.hc === 0 && p.turnos > 0) return "turnos";
  return "hc";
}

export function PortalInboxTab({ onOpenPatient, onCountChange, initialView }: Props) {
  const [data, setData] = useState<StaffInbox | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(initialView ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<{ id: string; how: NoticeAction } | null>(null);
  const [apptBusy, setApptBusy] = useState<{ id: string; to: ApptReqStaffTarget } | null>(null);
  const [apptDialog, setApptDialog] = useState<{ id: string; mode: ApptDialogMode } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Copia digital de la historia clínica (E1): vale solo con "consent" prendido.
  // null mientras se pregunta o si no se pudo saber
  const features = usePortalClinicalFeatures();
  const hcDigital = features === null ? null : features.includes("hc_digital") && features.includes("consent");

  const load = useCallback(async () => {
    setRefreshing(true);
    const r = await portalStaffApi.inbox();
    setRefreshing(false);
    setLoading(false);
    setNow(Date.now());
    if (!r.ok) { setLoadError(r.error); return; }
    setLoadError(null);
    // Un servidor anterior a los pedidos de turno no manda la lista
    const next = { ...r.data, turnos: r.data.turnos ?? [] };
    setData(next);
    // Sin lista elegida (ni de entrada ni con los botones), se elige con la
    // primera carga y queda fija: los números cambian al resolver, la lista no
    setView((v) => v ?? defaultView(pendingOf(next)));
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

  // La lista se elige con la primera carga (ver load) y no se recalcula con los números
  const shown: View = view ?? "hc";

  const hc = useMemo(() => sortHc(data?.hc ?? []), [data]);
  // Pendientes primero; el servidor ya las ordena por fecha del turno
  const notices = useMemo(() => [...(data?.notices ?? [])]
    .sort((a, b) => Number(a.resolution !== null) - Number(b.resolution !== null)), [data]);
  const turnos = useMemo(() => sortAppt(data?.turnos ?? []), [data]);

  function patchHc(row: StaffHcRequest) {
    setData((d) => d && { ...d, hc: d.hc.map((x) => (x.id === row.id ? row : x)) });
  }

  // Solo las notas: el resto de la fila puede haber cambiado mientras se guardaban
  function patchHcNotes(id: string, notes: string | null) {
    setData((d) => d && { ...d, hc: d.hc.map((x) => (x.id === id ? { ...x, staff_notes: notes } : x)) });
  }

  function patchAppt(row: StaffApptRequest) {
    setData((d) => d && { ...d, turnos: d.turnos.map((x) => (x.id === row.id ? row : x)) });
  }

  function patchApptNotes(id: string, notes: string | null) {
    setData((d) => d && { ...d, turnos: d.turnos.map((x) => (x.id === id ? { ...x, staff_notes: notes } : x)) });
  }

  // Cambia el estado de un pedido de turno. Los números de la pestaña se
  // recalculan solos al reemplazar el pedido en la lista.
  async function updateAppt(r: StaffApptRequest, to: ApptReqStaffTarget, extra: ApptExtra = {}): Promise<ApptOutcome> {
    setApptBusy({ id: r.id, to });
    const res = await portalStaffApi.apptUpdate({ id: r.id, to, ...extra });
    if (!res.ok) {
      const stale = res.status === 409;
      // Otra persona lo cambió o la familia lo canceló: se trae el estado actual
      if (stale) await load();
      setApptBusy(null);
      return { ok: false, msg: res.error, stale };
    }
    setApptBusy(null);
    patchAppt(res.data);
    // Con un bloqueo por orden judicial, a quien pidió no se le avisa (aunque
    // ya no tenga acceso). Sin bloqueo, si ya no tiene acceso, se le puede
    // avisar por teléfono
    const closing = to !== "pendiente";
    const blocked = closing && (r.requester_blocked || res.data.requester_blocked);
    const gone = closing && !blocked && (r.still_allowed === false || res.data.still_allowed === false);
    const unlinked = to === "agendado" && !res.data.appointment;
    toast.success(doneText(APPT_DONE[to], blocked ? APPT_BLOCKED_TOAST : gone ? APPT_GONE_TOAST : unlinked ? APPT_UNLINKED : null));
    return { ok: true };
  }

  // "Ya lo agendé" y "No se puede" piden un dato antes (diálogo); el resto va directo
  async function apptAction(r: StaffApptRequest, to: ApptReqStaffTarget) {
    if (to === "agendado" || to === "rechazado") { setApptDialog({ id: r.id, mode: to }); return; }
    const res = await updateAppt(r, to);
    if (!res.ok) toast.error(res.msg);
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
  // Se busca en la lista cada vez: al actualizar llegan los turnos recién cargados en la Agenda
  const openAppt = apptDialog ? data?.turnos.find((r) => r.id === apptDialog.id) : undefined;

  return (
    <div className="mt-6 max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-[color:var(--primary-deep)]">Portal de familias</h2>
          <p className="text-sm text-muted-foreground">
            Pedidos de copia del historial del paciente, avisos de turnos y pedidos de turno que mandan las familias desde el portal.
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
            <Chip active={shown === "turnos"} onClick={() => setView("turnos")}>
              Pedidos de turno ({pending.turnos})
            </Chip>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
            {shown === "hc" ? (
              <HcList list={hc} now={now} onOpen={setOpenId} />
            ) : shown === "notices" ? (
              <NoticeList list={notices} now={now} resolving={resolving} onResolve={resolveNotice} onOpenPatient={onOpenPatient} />
            ) : (
              <ApptList list={turnos} now={now} busy={apptBusy} onAction={apptAction}
                onNotesSaved={patchApptNotes} onOpenPatient={onOpenPatient} />
            )}
          </div>
        </>
      )}

      {openAppt && apptDialog && (
        <ApptDialog
          key={openAppt.id}
          request={openAppt}
          mode={apptDialog.mode}
          onClose={() => setApptDialog(null)}
          onSubmit={updateAppt}
          onReload={load}
        />
      )}

      {openHc && (
        <HcDialog
          key={openHc.id}
          request={openHc}
          now={now}
          digital={hcDigital}
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

// PDF subidos a un pedido abierto que todavía no se envió
function hcDocsDetail(r: StaffHcRequest): string | null {
  const n = hcDocs(r).length;
  return n ? `${n === 1 ? "1 PDF subido" : `${n} PDF subidos`} · falta enviarla` : null;
}

function hcDetail(r: StaffHcRequest): string | null {
  switch (r.status) {
    case "pendiente": return hcDocsDetail(r);
    case "lista": return [r.ready_at && `Lista desde el ${stampLabel(r.ready_at)}`, hcDocsDetail(r)].filter(Boolean).join(" · ") || null;
    case "enviada": {
      // El estado ya dice "Enviada por el portal": acá van las fechas
      if (!r.sent_at) return null;
      const until = hcAvailableUntil(r.sent_at);
      return `Enviada el ${stampLabel(r.sent_at)}${until ? ` · se puede descargar hasta el ${dayLabel(until)}` : ""}`;
    }
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
        <div className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          <span>Pidió {r.requester_name} · {LINK_KIND_LABEL[r.link_kind]} ·</span>
          <span>Pidió recibirla: <span className="font-semibold text-foreground/80">{HC_CHANNEL_LABEL[hcChannel(r)]}</span></span>
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
  add("enviada", r.sent_at, r.sent_by_email);
  const delivered = r.delivered_to_name
    ? `a ${r.delivered_to_name}${r.delivered_to_dni ? ` (DNI ${dniWithDots(r.delivered_to_dni)})` : ""}`
    : null;
  const rejected = r.reject_reason ? `Motivo: ${HC_REJECT_LABEL[r.reject_reason]}` : null;
  const sentDocs = r.status === "enviada" && hcDocs(r).length ? `${hcDocs(r).length} PDF` : null;
  for (const s of steps) {
    s.detail = s.kind === "entregada" ? delivered : s.kind === "rechazada" ? rejected : s.kind === "enviada" ? sentDocs : null;
  }
  return steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function HcDialog({ request: r, now, digital, onClose, onSaved, onNotesSaved, onReload, onOpenPatient }: {
  request: StaffHcRequest;
  now: number;
  digital: boolean | null; // copia digital (E1) prendida; null: no se sabe todavía
  onClose: () => void;
  onSaved: (row: StaffHcRequest) => void;
  onNotesSaved: (id: string, notes: string | null) => void;
  onReload: () => Promise<void>;
  onOpenPatient: (patientId: string) => void;
}) {
  const [mode, setMode] = useState<"idle" | "deliver" | "reject" | "send">("idle");
  const [busy, setBusy] = useState<HcStaffTarget | null>(null);
  // Subiendo, quitando o abriendo un PDF, o enviando la copia
  const [docBusy, setDocBusy] = useState(false);
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
    if (busy || savingNotes || docBusy) return;
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
    if (busy || savingNotes || docBusy) return;
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
  const statusLocked = !!busy || savingNotes;
  const locked = statusLocked || docBusy;

  // Copia digital: la familia pidió recibirla en el portal y la etapa está prendida
  const channel = hcChannel(r);
  const showDigital = digital === true && channel === "portal" && isOpen(r.status);
  const canSend = showDigital && r.digital_ok !== false && hcDocs(r).length > 0;
  // Si mientras se confirmaba el envío el pedido cambió (o se quitaron los PDF), se vuelve a las acciones
  const shownMode = mode === "send" && !canSend ? "idle" : mode;

  const primary = PRIMARY_BTN;

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy && !docBusy) onClose(); }}>
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
          <Item label="Pidió recibirla" value={HC_CHANNEL_LABEL[channel]} />
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
          {showDigital || r.status === "enviada"
            ? "Ley 26.529: la copia se entrega dentro de las 48 h de pedida."
            : "Ley 26.529: la copia se entrega dentro de las 48 h de pedida, en mano y con DNI."}
        </p>

        {channel === "portal" && isOpen(r.status) && digital === false && (
          <p className={`flex gap-2 text-xs font-semibold ${TEXT_WARN}`}>
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            La familia pidió recibirla en el portal, pero la copia digital no está disponible por ahora: entregala en mano.
          </p>
        )}

        {(showDigital || r.status === "enviada") && (
          <HcDigitalCopy
            r={r}
            now={now}
            locked={statusLocked}
            sending={shownMode === "send"}
            onSendMode={(on) => changeMode(on ? "send" : "idle")}
            onSaved={onSaved}
            onReload={onReload}
            onBusyChange={setDocBusy}
          />
        )}

        {shownMode !== "send" && (allowed.length > 0 || error) && (
          <div className="space-y-3 rounded-2xl border border-border/60 p-4">
            {shownMode === "idle" && allowed.length > 0 && showDigital && (
              <div className="text-sm font-bold">Otras opciones</div>
            )}
            {shownMode === "idle" && allowed.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {allowed.includes("lista") && (
                  // Si la pidió por el portal, lo principal es enviarla (arriba): esto queda como alternativa
                  <Button size="sm" variant={showDigital ? "outline" : "default"} disabled={locked} onClick={() => go("lista")}
                    className={showDigital ? "" : primary}>
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
          <Button variant="outline" disabled={docBusy} onClick={() => { onClose(); onOpenPatient(r.patient_id); }}>
            <UserRound className="mr-1.5" /> Abrir ficha
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={!!busy || docBusy}>Cerrar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Copia digital (E1) ──────────────────────────────────────────────────────
// Un profesional o la Dirección sube los PDF (la historia impresa desde la
// ficha y firmada digitalmente por la Dirección), los revisa y la envía. Los
// PDF no se tocan (se rompería la firma): cada uno se identifica con su
// código, el mismo que ve la familia al descargarlo. Administración solo ve
// los estados: si el servidor responde 403, se muestra su mensaje y se ocultan
// las acciones.

type DocBusy =
  | { kind: "upload"; done: number; total: number; name: string }
  | { kind: "open" | "remove"; id: string }
  | { kind: "send" };

function HcDigitalCopy({ r, now, locked, sending, onSendMode, onSaved, onReload, onBusyChange }: {
  r: StaffHcRequest;
  now: number;
  locked: boolean; // hay otro cambio del pedido en curso (estado o notas)
  sending: boolean; // mostrando las confirmaciones para enviarla
  onSendMode: (on: boolean) => void;
  onSaved: (row: StaffHcRequest) => void;
  onReload: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusyState] = useState<DocBusy | null>(null);
  const [error, setError] = useState<{ msg: string; stale: boolean } | null>(null);
  // El servidor dijo que esta persona no puede (Administración): su mensaje
  const [denied, setDenied] = useState<string | null>(null);
  // El servidor dijo que este pedido no se puede recibir por el portal (code
  // DIGITAL_BLOCKED; por ejemplo, el portal del paciente está en pausa): su mensaje, tal cual
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  // Si el navegador no dejó abrir la pestaña: el enlace para abrir el PDF a mano (vence enseguida)
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const docs = hcDocs(r);
  const sent = r.status === "enviada";
  const blocked = !sent && (r.digital_ok === false || blockedMsg !== null);
  const canAct = !sent && !blocked && !denied; // subir y enviar
  const disabled = locked || !!busy;

  // El enlace del PDF vence a los 60 segundos: después se deja de mostrar
  useEffect(() => {
    if (!link) return;
    const t = window.setTimeout(() => setLink(null), HC_LINK_SECONDS * 1000);
    return () => window.clearTimeout(t);
  }, [link]);

  function setBusy(b: DocBusy | null) {
    setBusyState(b);
    onBusyChange(!!b);
  }

  async function fail(res: { status: number; error: string; code?: string }, prefix = "") {
    if (res.status === 403) {
      setDenied(res.error);
      setError(null);
      onSendMode(false);
      await onReload();
      return;
    }
    if (res.code === "DIGITAL_BLOCKED") {
      setBlockedMsg(res.error);
      setError(null);
      onSendMode(false);
      await onReload();
      return;
    }
    const stale = res.status === 409;
    setError({ msg: prefix + res.error, stale });
    // Otra persona lo cambió: se trae el estado actual del pedido
    if (stale) await onReload();
  }

  async function upload(files: File[]) {
    if (disabled) return;
    const problem = checkPdfs(files, docs.length);
    if (problem) { setError({ msg: problem, stale: false }); return; }
    setError(null);
    let done = 0;
    for (const f of files) {
      setBusy({ kind: "upload", done, total: files.length, name: f.name });
      const res = await portalStaffApi.hcDocUpload(r.id, f);
      if (!res.ok) {
        setBusy(null);
        await fail(res, `${done ? `Se ${done === 1 ? "subió 1" : `subieron ${done}`} de ${files.length}. ` : ""}«${f.name}»: `);
        return;
      }
      onSaved(res.data);
      done++;
    }
    setBusy(null);
    toast.success(done === 1 ? "PDF subido." : `${done} PDF subidos.`);
  }

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // para poder volver a elegir el mismo archivo
    if (files.length) upload(files);
  }

  async function openDoc(d: StaffHcDocument) {
    if (busy) return;
    // La pestaña se abre ya, dentro del clic: abierta después de esperar al
    // servidor, el navegador la bloquea. Sin "noopener" para poder llevarla
    // al PDF; antes de eso se corta el vínculo con esta página.
    const tab = window.open("", "_blank");
    try {
      if (tab) tab.document.title = "Abriendo el PDF…";
    } catch {
      // nada: es solo el título mientras carga
    }
    setBusy({ kind: "open", id: d.id });
    setError(null);
    setLink(null);
    const res = await portalStaffApi.hcDocOpen(d.id);
    setBusy(null);
    if (!res.ok) {
      tab?.close();
      await fail(res);
      return;
    }
    if (tab && !tab.closed) {
      tab.opener = null;
      tab.location.href = res.data.url;
    } else {
      // Bloqueada (o ya cerrada): el enlace para abrirlo con un clic
      setLink({ id: d.id, url: res.data.url });
    }
  }

  async function removeDoc(d: StaffHcDocument) {
    if (disabled) return;
    if (!window.confirm(`¿Quitar «${d.file_name}» de este pedido? Todavía no se envió: la familia no lo vio.`)) return;
    setBusy({ kind: "remove", id: d.id });
    setError(null);
    const res = await portalStaffApi.hcDocRemove(d.id);
    setBusy(null);
    if (!res.ok) { await fail(res); return; }
    onSaved(res.data);
    toast.success("PDF quitado.");
  }

  async function send(acks: HcSendAcks) {
    if (disabled) return;
    setBusy({ kind: "send" });
    setError(null);
    // Van los PDF que están en pantalla: los que revisó quien envía
    const res = await portalStaffApi.hcSend(r.id, acks, docs.map((d) => d.id));
    setBusy(null);
    if (!res.ok) {
      // Alguien subió o quitó un PDF mientras se revisaba: se trae la lista
      // nueva y se sigue en el envío, con el aviso, para revisarla de nuevo
      // (las confirmaciones se vuelven a marcar: ver la key de HcSendForm)
      if (res.status === 409 && res.error.startsWith(HC_DOCS_CHANGED)) {
        setError({ msg: res.error, stale: true });
        await onReload();
        return;
      }
      await fail(res);
      return;
    }
    onSaved(res.data);
    onSendMode(false);
    toast.success(`Copia enviada por el portal. La familia la puede descargar durante ${HC_VISIBLE_DAYS} días.`);
  }

  const until = sent ? hcAvailableUntil(r.sent_at) : null;
  const expired = !!until && Date.parse(until) <= now;
  const uploading = busy?.kind === "upload" ? busy : null;

  return (
    <section aria-labelledby={`hc-digital-${r.id}`}
      className="space-y-3 rounded-2xl border border-primary/30 bg-[color:var(--primary-soft)]/30 p-4">
      <h3 id={`hc-digital-${r.id}`} className="flex items-center gap-1.5 text-sm font-bold text-[color:var(--primary-deep)]">
        <FileText className="h-4 w-4 shrink-0" aria-hidden /> Copia digital
      </h3>

      {sent ? (
        <div className="space-y-0.5 text-sm">
          <p>
            Enviada por el portal{r.sent_at && ` el ${stampLabel(r.sent_at)}`}{r.sent_by_email && ` por ${r.sent_by_email}`}.
          </p>
          {until && (
            <p className={expired ? "text-muted-foreground" : "font-semibold"}>
              {expired
                ? `El plazo para descargarla venció el ${dayLabel(until)}.`
                : `La familia la puede descargar hasta el ${dayLabel(until)}.`}
            </p>
          )}
        </div>
      ) : blocked ? (
        <p role="alert" className={`flex gap-2 rounded-xl bg-[color:var(--status-pending-bg)] p-2.5 text-sm font-semibold ${TEXT_WARN}`}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {blockedMsg ?? HC_DIGITAL_BLOCKED}
        </p>
      ) : !sending && (
        <>
          <ol className="list-inside list-decimal space-y-0.5 text-sm">
            <li>Imprimí la historia desde la ficha a PDF.</li>
            <li>La Dirección la firma digitalmente.</li>
            <li>Subila acá.</li>
            <li>Revisala y enviala.</li>
          </ol>
          {r.digital_ok === null && (
            <p className="text-xs text-muted-foreground">
              No pudimos verificar si esta cuenta puede recibirla por el portal: se revisa al enviarla.
            </p>
          )}
        </>
      )}

      {docs.length > 0 ? (
        <ul className="space-y-2" aria-label="PDF de la copia">
          {docs.map((d) => (
            <HcDocItem key={d.id} d={d}
              busy={busy && busy.kind !== "upload" && busy.kind !== "send" && busy.id === d.id ? busy.kind : null}
              disabled={!!busy}
              link={link?.id === d.id ? link.url : null}
              onOpen={denied ? null : () => openDoc(d)}
              onRemove={sent || denied || sending ? null : () => removeDoc(d)} />
          ))}
        </ul>
      ) : canAct && (
        <p className="text-xs text-muted-foreground">Todavía no se subió ningún PDF.</p>
      )}

      {canAct && !sending && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf" multiple className="hidden" onChange={pick}
            aria-label="Elegir los PDF de la copia" />
          <Button type="button" size="sm" variant="outline" disabled={disabled || docs.length >= HC_DOC_MAX_FILES}
            aria-busy={!!uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="mr-1.5 animate-spin" /> : <Upload className="mr-1.5" />}
            {uploading ? `Subiendo ${uploading.done + 1} de ${uploading.total}…` : "Subir PDF"}
          </Button>
          <Button type="button" size="sm" disabled={disabled || docs.length === 0} onClick={() => onSendMode(true)}
            className={PRIMARY_BTN}>
            <Send className="mr-1.5" /> Enviar por el portal
          </Button>
          <span className="w-full text-xs text-muted-foreground" aria-live="polite">
            {uploading
              ? `Subiendo «${uploading.name}»`
              : docs.length >= HC_DOC_MAX_FILES
                ? `Ya están los ${HC_DOC_MAX_FILES} PDF que se pueden subir por pedido.`
                : `PDF de hasta ${mbLabel(HC_DOC_MAX_BYTES)} cada uno, hasta ${HC_DOC_MAX_FILES} por pedido.${docs.length === 0 ? " Para enviarla tiene que haber al menos uno." : ""}`}
          </span>
        </div>
      )}

      {/* Si cambia la lista de PDF, las confirmaciones empiezan de nuevo: eran por los que se revisaron */}
      {canAct && sending && (
        <HcSendForm key={docs.map((d) => d.id).join(",")} r={r} busy={busy?.kind === "send"} disabled={disabled}
          onCancel={() => { setError(null); onSendMode(false); }} onSend={send} />
      )}

      {denied && (
        <p role="alert" className={`flex gap-2 text-sm font-semibold ${TEXT_BAD}`}>
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {denied}
        </p>
      )}
      {error && (
        <div role="alert" className={`flex flex-wrap items-center gap-x-2 text-sm ${TEXT_BAD}`}>
          <span>{error.msg}</span>
          {error.stale && (
            <Button type="button" size="sm" variant="link" className="h-auto p-0"
              onClick={() => { setError(null); onReload(); }}>Actualizar</Button>
          )}
        </div>
      )}
    </section>
  );
}

function HcDocItem({ d, busy, disabled, link, onOpen, onRemove }: {
  d: StaffHcDocument;
  busy: "open" | "remove" | null; // lo que se está haciendo con este PDF
  disabled: boolean;
  link: string | null; // el navegador no dejó abrir la pestaña: enlace para abrirlo a mano
  onOpen: (() => void) | null; // null: no se puede abrir
  onRemove: (() => void) | null; // null: no se puede quitar (ya se envió)
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border/60 bg-card p-2.5">
      <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold" title={d.file_name}>{d.file_name}</div>
        <div className="text-xs text-muted-foreground">
          {mbLabel(d.size_bytes)} ·{" "}
          <span title="La familia ve el mismo código al descargarla">
            Código <span className="font-semibold tabular-nums text-foreground">{d.code}</span>
          </span>
          {" "}· Subido por {d.uploaded_by_email} el {stampLabel(d.uploaded_at)}
        </div>
      </div>
      {(onOpen || onRemove) && (
        <div className="flex gap-1">
          {onOpen && (
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={disabled}
              aria-busy={busy === "open"} onClick={onOpen} aria-label={`Ver ${d.file_name}`}>
              {busy === "open" ? <Loader2 className="mr-1 animate-spin" /> : <Eye className="mr-1" />} Ver
            </Button>
          )}
          {onRemove && (
            <Button type="button" size="sm" variant="ghost" className={`h-8 px-2 text-xs ${TEXT_BAD}`} disabled={disabled}
              aria-busy={busy === "remove"} onClick={onRemove} aria-label={`Quitar ${d.file_name}`}>
              {busy === "remove" ? <Loader2 className="mr-1 animate-spin" /> : <Trash2 className="mr-1" />} Quitar
            </Button>
          )}
        </div>
      )}
      {link && (
        <p role="status" className="w-full text-xs text-muted-foreground">
          El navegador no dejó abrir otra pestaña.{" "}
          <a href={link} target="_blank" rel="noopener noreferrer"
            className="font-semibold text-[color:var(--primary-deep)] underline underline-offset-2">
            Abrir el PDF
          </a>{" "}
          (el enlace vence en un minuto)
        </p>
      )}
    </li>
  );
}

// Confirmaciones obligatorias antes de enviarla (el servidor también las pide)
function HcSendForm({ r, busy, disabled, onCancel, onSend }: {
  r: StaffHcRequest;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
  onSend: (acks: HcSendAcks) => void;
}) {
  const [acks, setAcks] = useState({ complete: false, no_third_parties: false, signed: false, adolescent: false });
  const teen = isAdolescent(r.patient_age);
  const { first, full } = nameParts(r.patient_name);
  const ready = acks.complete && acks.no_third_parties && acks.signed && (!teen || acks.adolescent);
  const check = (k: keyof typeof acks) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const on = e.target.checked;
    setAcks((a) => ({ ...a, [k]: on }));
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || disabled) return;
    onSend({ complete: true, no_third_parties: true, signed: true, ...(teen ? { adolescent: true } : {}) });
  }

  const box = "flex items-start gap-2 text-sm";
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border/60 bg-card p-3">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-bold">Antes de enviarla, confirmá</legend>
        <label className={box}>
          <input type="checkbox" required className="mt-0.5" checked={acks.complete} onChange={check("complete")} />
          Está completa y es de {full}
        </label>
        <label className={box}>
          <input type="checkbox" required className="mt-0.5" checked={acks.no_third_parties} onChange={check("no_third_parties")} />
          No tiene datos de otras personas
        </label>
        <label className={box}>
          <input type="checkbox" required className="mt-0.5" checked={acks.signed} onChange={check("signed")} />
          Cada PDF tiene la firma digital de la Dirección
        </label>
        {teen && (
          <div className="space-y-0.5">
            <label className={box}>
              <input type="checkbox" required className="mt-0.5" checked={acks.adolescent} onChange={check("adolescent")} />
              Revisé que no incluya lo que {first} ({r.patient_age} años) contó en confianza
            </label>
            <p className={`pl-6 text-xs font-semibold ${TEXT_WARN}`}>
              Si incluye algo así, entregala en mano después de consultar con la Dirección.
            </p>
          </div>
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        La familia la descarga desde el portal durante {HC_VISIBLE_DAYS} días con su contraseña. La entrega en mano sigue disponible.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>Volver</Button>
        <Button type="submit" size="sm" disabled={disabled || !ready} aria-busy={busy} className={PRIMARY_BTN}>
          {busy ? <Loader2 className="mr-1.5 animate-spin" /> : <Send className="mr-1.5" />}
          Enviar por el portal
        </Button>
      </div>
    </form>
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

// ─── Pedidos de turno ────────────────────────────────────────────────────────

type ApptDialogMode = "agendado" | "rechazado";
// Los motivos que elige el equipo ("bloqueo" lo pone solo el servidor)
type StaffRejectReason = (typeof APPT_REQ_REJECT_REASONS)[number];
type ApptExtra = { appointment_id?: string | null; reject_reason?: StaffRejectReason };
type ApptOutcome = { ok: true } | { ok: false; msg: string; stale: boolean };

const APPT_TONE: Record<ApptReqStatus, Tone> = {
  pendiente: "warn",
  contactar: "info",
  agendado: "ok",
  rechazado: "bad",
  cancelado: "muted",
};

const APPT_LINK_KIND_LABEL: Record<StaffApptRequest["link_kind"], string> = {
  titular: "Titular",
  representante_legal: "Representante legal",
  autorizado: "Adulto autorizado",
};

// Para qué es el turno (lo elige la familia al pedirlo)
const APPT_REASON_LABEL: Record<ApptReqReason, string> = {
  continuar: "Seguir con el tratamiento",
  consulta: "Una consulta",
  otro: "Otro motivo",
};

const APPT_EVENT_LABEL: Record<ApptReqEventKind, string> = {
  pedido: "Pedido desde el portal",
  contactar: "Marcado «La vamos a llamar»",
  agendado: "Agendado",
  pendiente: "Volvió a pendiente",
  rechazado: "No se dio turno",
  cancelado: "Cancelado por la familia",
  nota: "Notas internas editadas",
};

// Cada paso que puede dar el equipo y qué ve la familia
const APPT_ACTION: Record<ApptReqStaffTarget, { label: string; hint: string }> = {
  agendado: { label: "Ya lo agendé", hint: "Elegís el turno que cargaste en la Agenda: la familia ve el día y la hora." },
  contactar: { label: "La vamos a llamar", hint: "La familia ve que la vamos a llamar para coordinar." },
  rechazado: { label: "No se puede", hint: "Elegís el motivo: la familia lo ve en el portal." },
  pendiente: { label: "Volver a pendiente", hint: "Si se marcó por error." },
};
const APPT_ACTION_ICON: Record<ApptReqStaffTarget, LucideIcon> = {
  agendado: CalendarCheck,
  contactar: PhoneCall,
  rechazado: XCircle,
  pendiente: Undo2,
};

const APPT_DONE: Record<ApptReqStaffTarget, Done> = {
  agendado: { text: "Pedido agendado.", family: "La familia ve el día y la hora en el portal." },
  contactar: { text: "Pedido marcado «La vamos a llamar».", family: "La familia lo ve en el portal." },
  rechazado: { text: "Pedido cerrado sin turno.", family: "La familia ve el motivo en el portal." },
  pendiente: { text: "El pedido volvió a pendiente." },
};
// Agendado sin elegir el turno de la lista
const APPT_UNLINKED = "La familia ve que le dimos turno, pero no el día ni la hora.";
// still_allowed === false: quien pidió ya no entra al portal a ver a esta persona
const APPT_GONE_TOAST = "Quien lo pidió ya no tiene acceso al portal: si corresponde, avisale por teléfono.";
// requester_blocked: quien pidió tiene un bloqueo por orden judicial (pesa más que still_allowed)
const APPT_BLOCKED = "Tiene un bloqueo por orden judicial: no lo contactes ni le des el día y la hora. Resolvé el pedido sin avisarle.";
const APPT_BLOCKED_CLOSED = "Tiene un bloqueo por orden judicial: no lo contactes ni le des el día y la hora.";
const APPT_BLOCKED_TOAST = "Quien lo pidió tiene un bloqueo por orden judicial: no le avises.";
// appointment_cancelled: agendado, pero el turno enlazado se canceló (o pasó a otro paciente)
const APPT_LINK_CANCELLED = "El turno enlazado se canceló: la familia ve «Turno cancelado» y puede pedir otro.";

// Motivo del cierre sin turno. "bloqueo" (lo pone el servidor al cargar un
// bloqueo por orden judicial) se muestra tal cual, sin lo que ve la familia
function apptRejectText(reason: ApptReqRejectReason): string {
  const { label } = APPT_REQ_REJECT_LABEL[reason];
  return reason === "bloqueo" ? label : `Motivo: ${label}`;
}

// Pasos que se ofrecen. Con un bloqueo por orden judicial el pedido solo se
// cierra (agendar o «No se puede», sin avisarle): ni «Volver a pendiente» ni
// «La vamos a llamar» (el servidor no deja reabrirlo ni dejarlo abierto)
function apptSteps(r: StaffApptRequest): readonly ApptReqStaffTarget[] {
  const all = APPT_REQ_TRANSITIONS[r.status];
  return r.requester_blocked ? all.filter((to) => !apptReqOpen(to)) : all;
}

// Aviso sobre quien pidió: bloqueo judicial (no contactarlo) o, sin bloqueo,
// que ya no tiene acceso al portal (solo en pedidos abiertos)
function requesterAlert(r: StaffApptRequest): { tone: "blocked" | "gone"; text: string } | null {
  if (r.requester_blocked) return { tone: "blocked", text: apptReqOpen(r.status) ? APPT_BLOCKED : APPT_BLOCKED_CLOSED };
  if (apptReqOpen(r.status) && r.still_allowed === false) {
    return { tone: "gone", text: `${r.requester_name} ya no tiene acceso al portal: si corresponde, avisale por teléfono.` };
  }
  return null;
}

// "Jueves 22/10 · 17:30 · Lic. Pérez"
function slotLabel(s: StaffApptSlot): string {
  const [y, m, d] = s.date.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "long" });
  return `${capitalize(weekday)} ${s.date.slice(8, 10)}/${s.date.slice(5, 7)} · ${s.time.slice(0, 5)} · ${s.professional_name ?? "Sin profesional"}`;
}

// "Lunes, miércoles y viernes"; los cinco: "De lunes a viernes"
function daysLabel(days: Weekday[]): string {
  const names = WEEKDAYS.filter((d) => days.includes(d)).map((d) => WEEKDAY_LABEL[d].toLowerCase());
  if (names.length === WEEKDAYS.length) return "De lunes a viernes";
  const last = names.pop() ?? "";
  return capitalize(names.length ? `${names.join(", ")} y ${last}` : last);
}

function apptClosedAt(r: StaffApptRequest): number {
  const at = r.status === "agendado" ? r.scheduled_at : r.status === "rechazado" ? r.rejected_at : r.cancelled_at;
  return Date.parse(at ?? r.created_at);
}

// Pendientes y "la vamos a llamar" primero (los más viejos arriba); después los cerrados, los más nuevos arriba
function sortAppt(list: StaffApptRequest[]): StaffApptRequest[] {
  const rank = (s: ApptReqStatus) => (s === "pendiente" ? 0 : s === "contactar" ? 1 : 2);
  return [...list].sort((a, b) => rank(a.status) - rank(b.status)
    || (apptReqOpen(a.status)
      ? Date.parse(a.created_at) - Date.parse(b.created_at)
      : apptClosedAt(b) - apptClosedAt(a)));
}

// warn: hay algo que revisar (el turno enlazado se canceló)
function apptDetail(r: StaffApptRequest): { text: string; warn?: boolean } | null {
  switch (r.status) {
    case "pendiente": return null;
    case "contactar": return { text: ["Marcado para llamar", r.contacted_by_email && `por ${r.contacted_by_email}`,
      r.contacted_at && `el ${stampLabel(r.contacted_at)}`].filter(Boolean).join(" ") };
    case "agendado": return r.appointment
      ? { text: `Turno: ${slotLabel(r.appointment)}` }
      : r.appointment_cancelled
        ? { text: APPT_LINK_CANCELLED, warn: true }
        : { text: "Sin turno enlazado: la familia no ve el día ni la hora." };
    case "rechazado": return r.reject_reason ? { text: apptRejectText(r.reject_reason) } : null;
    case "cancelado": return r.cancelled_at ? { text: `La familia lo canceló el ${stampLabel(r.cancelled_at)}` } : null;
  }
}

type ApptStep = { kind: ApptReqEventKind; at: string; who: string | null; detail: string | null };

// Seguimiento del pedido, del paso más viejo al más nuevo (como en las copias:
// la constancia de cada paso y, lo que no la tenga, las fechas del pedido)
function apptTimeline(r: StaffApptRequest): ApptStep[] {
  const steps: ApptStep[] = (r.events ?? []).map((e) => ({
    kind: e.kind, at: e.at, who: e.by_email ?? "la familia", detail: null,
  }));
  const add = (kind: ApptReqEventKind, at: string | null, who: string | null) => {
    if (at && !steps.some((s) => s.kind === kind)) steps.push({ kind, at, who, detail: null });
  };
  add("pedido", r.created_at, "la familia");
  add("contactar", r.contacted_at, r.contacted_by_email);
  add("agendado", r.scheduled_at, r.scheduled_by_email);
  add("rechazado", r.rejected_at, r.rejected_by_email);
  add("cancelado", r.cancelled_at, "la familia");
  steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // El turno o el motivo van en el último paso del estado actual
  const current = [...steps].reverse().find((s) => s.kind === r.status);
  if (current) {
    current.detail = r.status === "agendado" && r.appointment ? slotLabel(r.appointment)
      : r.status === "rechazado" && r.reject_reason ? apptRejectText(r.reject_reason)
      : null;
  }
  return steps;
}

function ApptList({ list, now, busy, onAction, onNotesSaved, onOpenPatient }: {
  list: StaffApptRequest[];
  now: number;
  busy: { id: string; to: ApptReqStaffTarget } | null;
  onAction: (r: StaffApptRequest, to: ApptReqStaffTarget) => void;
  onNotesSaved: (id: string, notes: string | null) => void;
  onOpenPatient: (patientId: string) => void;
}) {
  if (list.length === 0) {
    return <div className="py-16 text-center text-sm text-muted-foreground">No hay pedidos de turno.</div>;
  }
  const open = list.filter((r) => apptReqOpen(r.status));
  const closed = list.filter((r) => !apptReqOpen(r.status));
  const row = (r: StaffApptRequest) => (
    <ApptRow key={r.id} r={r} now={now} locked={!!busy} busy={busy?.id === r.id ? busy.to : null}
      onAction={onAction} onNotesSaved={onNotesSaved} onOpenPatient={onOpenPatient} />
  );
  return (
    <ul className="divide-y divide-border/60">
      {open.length === 0
        ? <li className="py-10 text-center text-sm text-muted-foreground">No hay pedidos abiertos.</li>
        : open.map(row)}
      {closed.length > 0 && <GroupLabel>Cerrados en los últimos 30 días</GroupLabel>}
      {closed.map(row)}
    </ul>
  );
}

function ApptRow({ r, now, locked, busy, onAction, onNotesSaved, onOpenPatient }: {
  r: StaffApptRequest;
  now: number;
  locked: boolean; // hay un cambio de estado en curso (en este pedido o en otro)
  busy: ApptReqStaffTarget | null; // el cambio en curso es de este pedido
  onAction: (r: StaffApptRequest, to: ApptReqStaffTarget) => void;
  onNotesSaved: (id: string, notes: string | null) => void;
  onOpenPatient: (patientId: string) => void;
}) {
  const [panel, setPanel] = useState<"notes" | "history" | null>(null);
  const open = apptReqOpen(r.status);
  const allowed = apptSteps(r);
  const reqAlert = requesterAlert(r);
  const slow = r.status === "pendiente" && hoursSince(r.created_at, now) >= 48;
  const detail = apptDetail(r);
  const toggle = (p: "notes" | "history") => setPanel((cur) => (cur === p ? null : p));

  return (
    <li className="grid gap-2 p-4 md:px-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onOpenPatient(r.patient_id)} title="Abrir ficha"
          className="font-bold underline-offset-2 hover:text-[color:var(--primary-deep)] hover:underline">
          {r.patient_name}
        </button>
        <Pill tone={APPT_TONE[r.status]}>{APPT_REQ_STATUS_LABEL[r.status]}</Pill>
        {reqAlert && <Pill tone="bad">{reqAlert.tone === "blocked" ? "Bloqueo judicial" : "Ya no tiene acceso"}</Pill>}
        <span title={`Pedido el ${stampLabel(r.created_at)}`}
          className={`ml-auto inline-flex items-center gap-1 text-xs ${slow ? `font-semibold ${TEXT_WARN}` : "text-muted-foreground"}`}>
          {slow && <Clock className="h-3.5 w-3.5" aria-hidden />}
          {ago(r.created_at, now)} · {stampLabel(r.created_at)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        Pidió {r.requester_name} · {APPT_LINK_KIND_LABEL[r.link_kind]}
      </div>
      {reqAlert?.tone === "blocked" ? (
        <p className={`flex gap-2 rounded-xl bg-[color:var(--status-occupied-bg)] p-2.5 text-xs font-semibold ${TEXT_BAD}`}>
          <Scale className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {reqAlert.text}
        </p>
      ) : reqAlert && (
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${TEXT_BAD}`}>
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {reqAlert.text}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-muted/40 p-3 text-sm lg:grid-cols-4">
        <Item label="Para" value={APPT_REASON_LABEL[r.reason]} />
        <Item label="Días" value={daysLabel(r.days)} />
        <Item label="Horario" value={TIME_BAND_LABEL[r.band]} />
        <Item label="Modalidad" value={APPT_REQ_MODALITY_LABEL[r.modality]} />
      </dl>
      {r.note && (
        <p className="text-sm text-foreground/80">
          <span className="text-xs text-muted-foreground">Comentario: </span>«{r.note}»
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="sr-only">Teléfonos de la ficha:</span>
        {r.contact_phones.length === 0 ? "Sin teléfono en la ficha" : r.contact_phones.map((p) => (
          <a key={p} href={`tel:${p.replace(/[^\d+]/g, "")}`} className="font-semibold text-foreground hover:underline">{p}</a>
        ))}
      </div>
      {detail && (detail.warn ? (
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${TEXT_WARN}`}>
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {detail.text}
        </p>
      ) : <div className="text-xs font-semibold text-[color:var(--primary-deep)]">{detail.text}</div>)}

      {open && allowed.length > 0 && (
        <div role="group" aria-label={`Resolver el pedido de turno de ${r.patient_name}`} className="grid gap-2 pt-1 sm:grid-cols-3">
          {allowed.map((to) => {
            const Icon = APPT_ACTION_ICON[to];
            return (
              <button key={to} type="button" disabled={locked} onClick={() => onAction(r, to)} aria-busy={busy === to}
                className={`flex flex-col justify-start rounded-xl border p-2.5 text-left transition-colors hover:bg-[color:var(--primary-soft)]/40 disabled:cursor-not-allowed disabled:opacity-60 ${to === "agendado" ? "border-primary/50" : "border-border/60"}`}>
                <span className={`flex items-center gap-1.5 text-sm font-semibold ${to === "rechazado" ? TEXT_BAD : to === "agendado" ? "text-[color:var(--primary-deep)]" : ""}`}>
                  {busy === to
                    ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    : <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  {APPT_ACTION[to].label}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{APPT_ACTION[to].hint}</span>
              </button>
            );
          })}
        </div>
      )}

      {r.staff_notes && panel !== "notes" && (
        <p className="whitespace-pre-line rounded-xl bg-muted/50 px-3 py-2 text-xs">
          <span className="font-semibold">Notas internas:</span> {r.staff_notes}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" aria-expanded={panel === "notes"} onClick={() => toggle("notes")}>
          <NotebookPen className="mr-1" /> {r.staff_notes ? "Editar notas" : "Agregar notas"}
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" aria-expanded={panel === "history"} onClick={() => toggle("history")}>
          <ChevronDown className={`mr-1 transition-transform ${panel === "history" ? "rotate-180" : ""}`} /> Seguimiento
        </Button>
        {!open && allowed.includes("pendiente") && (
          <Button size="sm" variant="outline" className="ml-auto h-8 px-2.5 text-xs" disabled={locked}
            aria-busy={busy === "pendiente"} onClick={() => onAction(r, "pendiente")}>
            {busy === "pendiente" ? <Loader2 className="mr-1 animate-spin" /> : <Undo2 className="mr-1" />}
            Volver a pendiente
          </Button>
        )}
      </div>

      {panel === "notes" && <ApptNotes r={r} onSaved={onNotesSaved} onClose={() => setPanel(null)} />}
      {panel === "history" && (
        <ol className="space-y-1 rounded-xl bg-muted/50 p-3 text-sm">
          {apptTimeline(r).map((s, i) => (
            <li key={`${s.kind}-${s.at}-${i}`}>
              <span className="font-semibold">{APPT_EVENT_LABEL[s.kind]}:</span>{" "}
              {[stampLabel(s.at), s.detail, s.who && `por ${s.who}`].filter(Boolean).join(" · ")}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function ApptNotes({ r, onSaved, onClose }: {
  r: StaffApptRequest;
  onSaved: (id: string, notes: string | null) => void;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(r.staff_notes ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = notes.trim() !== (r.staff_notes ?? "");
  const id = `appt-notes-${r.id}`;

  async function save() {
    if (saving) return;
    const clean = notes.trim();
    setSaving(true);
    const res = await portalStaffApi.apptNotes(r.id, clean);
    setSaving(false);
    if (!res.ok) { toast.error(res.error); return; }
    // Solo las notas: el estado del pedido puede haber cambiado mientras tanto
    onSaved(r.id, clean || null);
    toast.success("Notas guardadas");
    onClose();
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Notas internas: la familia no las ve</Label>
      <Textarea id={id} rows={2} maxLength={500} value={notes} autoFocus onChange={(e) => setNotes(e.target.value)}
        placeholder="Ej: La llamamos el martes y no atendió" />
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{notes.length}/500</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>Cancelar</Button>
          <Button size="sm" variant="outline" disabled={saving || !dirty} onClick={save}>
            {saving && <Loader2 className="mr-1.5 animate-spin" />}
            Guardar notas
          </Button>
        </div>
      </div>
    </div>
  );
}

// "Ya lo agendé" (elegir el turno que se cargó en la Agenda) o "No se puede" (elegir el motivo)
function ApptDialog({ request: r, mode, onClose, onSubmit, onReload }: {
  request: StaffApptRequest;
  mode: ApptDialogMode;
  onClose: () => void;
  onSubmit: (r: StaffApptRequest, to: ApptReqStaffTarget, extra?: ApptExtra) => Promise<ApptOutcome>;
  onReload: () => Promise<void>;
}) {
  // undefined: todavía no eligió · null: no está en la lista / lo enlaza después
  const [slot, setSlot] = useState<string | null | undefined>(undefined);
  const [reason, setReason] = useState<StaffRejectReason | "">("");
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mientras estaba abierto, otra persona pudo cambiarlo (o la familia cancelarlo)
  const allowed = APPT_REQ_TRANSITIONS[r.status].includes(mode);
  // Si al actualizar la lista el turno elegido ya no está, hay que volver a elegir
  const chosen = typeof slot === "string" && !r.upcoming.some((s) => s.id === slot) ? undefined : slot;
  const ready = mode === "agendado" ? chosen !== undefined : !!reason;
  const reqAlert = requesterAlert(r);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !allowed) return;
    if (!ready) { setError(mode === "agendado" ? "Elegí el turno que le diste." : "Elegí el motivo."); return; }
    setBusy(true);
    setError(null);
    const res = await onSubmit(r, mode, mode === "agendado" ? { appointment_id: chosen ?? null } : { reject_reason: reason || undefined });
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.msg);
  }

  async function refresh() {
    setReloading(true);
    setError(null);
    await onReload();
    setReloading(false);
  }

  const summary = [APPT_REASON_LABEL[r.reason], daysLabel(r.days), TIME_BAND_LABEL[r.band], APPT_REQ_MODALITY_LABEL[r.modality]].join(" · ");
  const radio = "flex min-h-10 cursor-pointer items-start gap-2 rounded-xl border border-border/60 p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-[color:var(--primary-soft)]";
  const primary = "bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">{r.patient_name}</DialogTitle>
          <DialogDescription>
            {mode === "agendado" ? "Ya lo agendé" : "No se puede dar el turno"} · <Pill tone={APPT_TONE[r.status]}>{APPT_REQ_STATUS_LABEL[r.status]}</Pill>
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <div className="text-xs text-muted-foreground">Pidió {r.requester_name} · {APPT_LINK_KIND_LABEL[r.link_kind]}</div>
          <div className="font-medium">{summary}</div>
          {r.note && <div className="mt-1 text-foreground/80">«{r.note}»</div>}
        </div>

        {reqAlert && (
          <div role="alert" className={`flex gap-2 rounded-xl bg-[color:var(--status-occupied-bg)] p-3 text-sm ${TEXT_BAD}`}>
            {reqAlert.tone === "blocked"
              ? <Scale className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            <p className={reqAlert.tone === "blocked" ? "font-semibold" : ""}>{reqAlert.text}</p>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {!allowed ? (
            <p role="alert" className={`text-sm ${TEXT_BAD}`}>
              El pedido cambió mientras tanto: ahora está «{APPT_REQ_STATUS_LABEL[r.status]}».
            </p>
          ) : mode === "agendado" ? (
            <>
              <p className="flex gap-2 text-sm">
                <CalendarPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                Cargalo primero en la Agenda; la familia ve el día y la hora acá.
              </p>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-bold">¿Qué turno le diste?</legend>
                {r.upcoming.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No tiene turnos próximos en la Agenda. Si recién lo cargaste, tocá «Actualizar la lista».
                  </p>
                )}
                {r.upcoming.map((s) => (
                  <label key={s.id} className={radio}>
                    <input type="radio" name="appt-slot" className="mt-0.5" checked={chosen === s.id} onChange={() => setSlot(s.id)} />
                    {slotLabel(s)}
                  </label>
                ))}
                <label className={radio}>
                  <input type="radio" name="appt-slot" className="mt-0.5" checked={chosen === null} onChange={() => setSlot(null)} />
                  <span>
                    No está en la lista / lo enlazo después
                    <span className="block text-xs text-muted-foreground">
                      {APPT_UNLINKED}
                      {/* Con un bloqueo judicial el pedido no se puede reabrir */}
                      {!r.requester_blocked && " Para enlazarlo más adelante: «Volver a pendiente» y de nuevo «Ya lo agendé»."}
                    </span>
                  </span>
                </label>
                <Button type="button" size="sm" variant="link" className="h-auto p-0" disabled={reloading || busy} onClick={refresh}>
                  <RefreshCw className={`mr-1 ${reloading ? "animate-spin" : ""}`} /> Actualizar la lista
                </Button>
              </fieldset>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="appt-reject">Motivo</Label>
              <select id="appt-reject" value={reason} onChange={(e) => setReason(e.target.value as StaffRejectReason | "")}
                className={selectClass}>
                <option value="" disabled>Elegí el motivo</option>
                {APPT_REQ_REJECT_REASONS.map((k) => <option key={k} value={k}>{APPT_REQ_REJECT_LABEL[k].label}</option>)}
              </select>
              {reason && <p className="text-xs text-muted-foreground">{APPT_REQ_REJECT_LABEL[reason].family}</p>}
            </div>
          )}

          {error && <p role="alert" className={`text-sm ${TEXT_BAD}`}>{error}</p>}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{allowed ? "Volver" : "Cerrar"}</Button>
            {allowed && (
              <Button type="submit" disabled={busy || reloading || !ready}
                variant={mode === "rechazado" ? "destructive" : "default"} className={mode === "agendado" ? primary : ""}>
                {busy && <Loader2 className="mr-1.5 animate-spin" />}
                {mode === "agendado" ? "Marcar agendado" : "Confirmar: no se puede"}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
