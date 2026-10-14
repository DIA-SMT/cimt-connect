import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Eye, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InfoView } from "@/components/portal/InfoView";
import { selectClass } from "../fields";
import { audienceFor, baseExplanation, hasBaseFor } from "@/lib/diagnosisExplanations";
import { ADOLESCENT_FROM, ADULT_FROM } from "@/lib/portalClinicalRules";
import {
  type InfoDTO, type ReportBody, type SummaryBody,
  HOME_TIPS, INFO_LIMITS, REVIEW_NOTE_MAX, TRAMITE_CODES, WITHDRAW_REASONS, cleanText, fitText, lintTexts, reportSections,
} from "@/lib/portalInfoRules";
import {
  type InfoAction, type StaffInfoDTO, type StaffPublication, type StaffReportRow, WITHDRAW_LABEL, portalStaffApi,
} from "@/lib/portalStaff";

// "Mi información" dentro de "Portal del paciente" (etapa C): el profesional
// escribe en lenguaje claro qué trabajan y cómo acompañar en casa, y publica
// versiones para la familia de los informes. Lo publicado es una copia
// congelada: para cambiarlo se publica una versión nueva (la anterior queda en
// el historial) o se retira. Administración ve qué hay publicado y quién lo
// leyó, sin los textos. Las reglas están en portalInfoRules.ts y el servidor
// (server/lib/portalInfo.ts) vuelve a controlar todo.

type WithoutPatient<T> = T extends unknown ? Omit<T, "patient_id"> : never;
type InfoBody = WithoutPatient<Exclude<InfoAction, { action: "info_get" }>>;
type SendError = { message: string; stale: boolean }; // stale: otra persona lo cambió (409)
type Sent = { ok: true; data: StaffInfoDTO } | ({ ok: false } & SendError);
type Send = (body: InfoBody) => Promise<Sent>;
type Patient = StaffInfoDTO["patient"];
type Reason = (typeof WITHDRAW_REASONS)[number];

type DialogState =
  | { kind: "report"; report: StaffReportRow }
  | { kind: "withdraw"; pub: StaffPublication }
  | null;

type Tone = "ok" | "warn" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-[color:var(--status-available-bg)] text-[oklch(0.42_0.12_150)]",
  warn: "bg-[color:var(--status-pending-bg)] text-[oklch(0.45_0.11_70)]",
  muted: "bg-muted text-muted-foreground",
};
const PENDING_TEXT = "text-[oklch(0.45_0.11_70)]";
const ERROR_BOX = "rounded-xl bg-[color:var(--status-occupied-bg)] px-3 py-2 text-sm font-semibold text-[oklch(0.48_0.19_25)]";
const WARN_BOX = "rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm text-[oklch(0.42_0.1_70)]";
const PILL_BTN = "h-8 rounded-full";
const REVIEW_NEEDED = "Corregí el texto o tocá «Lo dejo así» y contá por qué.";

// ── Fechas y textos ─────────────────────────────────────────────────────────

const two = (n: number) => String(n).padStart(2, "0");

// dd/mm (con el año si no es este)
function dm(iso: string): string {
  const d = new Date(iso);
  const day = `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
  return d.getFullYear() === new Date().getFullYear() ? day : `${day}/${d.getFullYear()}`;
}

// AAAA-MM-DD → dd/mm/aaaa
function dmy(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

// "Ana", "Ana y Juan", "Ana, Juan y Pedro"
function names(list: string[]): string {
  return list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`;
}

function publishedToast(readers: string[]) {
  toast.success(readers.length
    ? `Publicado. ${names(readers)} ${readers.length === 1 ? "lo ve" : "lo ven"} en el portal.`
    : "Publicado. Se va a ver cuando alguien active el portal.");
}

// De 13 a 17 años también se confirma que se habló con el adolescente
const isAdolescent = (age: number | null) => age !== null && age >= ADOLESCENT_FROM && age < ADULT_FROM;

const found = lintTexts; // los textos ya limpios, igual que el servidor

// ── Sección ─────────────────────────────────────────────────────────────────

export function PortalInfoEditor({ patientId, refreshKey }: {
  patientId: string;
  /** Cambia cuando la sección de arriba guarda algo (habilitación, verificaciones, pausa…): se recarga para que «quién lo ve» esté al día */
  refreshKey?: unknown;
}) {
  const [forPatient, setForPatient] = useState(patientId);
  const [data, setData] = useState<StaffInfoDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const current = useRef(patientId);
  const loadSeq = useRef(0);
  const titleId = useId();

  // Otra ficha: se empieza de cero (y se ignoran respuestas de la anterior)
  if (forPatient !== patientId) {
    current.current = patientId;
    setForPatient(patientId);
    setData(null);
    setLoadError(null);
    setBusy(false);
    setDialog(null);
  }

  async function load() {
    const id = patientId;
    const n = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    const r = await portalStaffApi.info({ action: "info_get", patient_id: id });
    if (current.current !== id || loadSeq.current !== n) return;
    setLoading(false);
    if (!r.ok) { setLoadError(r.error); return; }
    setData(r.data);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [patientId, refreshKey]);

  const send: Send = async (body) => {
    const id = patientId;
    setBusy(true);
    const r = await portalStaffApi.info({ ...body, patient_id: id } as InfoAction);
    if (current.current !== id) return { ok: false, message: "Se abrió otra ficha.", stale: false };
    setBusy(false);
    if (!r.ok) return { ok: false, message: r.error, stale: r.status === 409 };
    // Lo que devuelve la acción es más nuevo que una carga que esté en camino
    loadSeq.current++;
    setLoading(false);
    setLoadError(null);
    setData(r.data);
    return { ok: true, data: r.data };
  };

  const closeDialog = () => setDialog(null);
  // "Actualizar" después de un conflicto: se cierra el diálogo y se trae lo último
  const reloadFromDialog = () => { setDialog(null); void load(); };
  const onWithdraw = (pub: StaffPublication) => setDialog({ kind: "withdraw", pub });
  const canPublish = !!data && data.can_publish && data.info_enabled && !data.author.problem;

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-2xl border border-border/60 p-4">
      <div>
        <h4 id={titleId} className="text-sm font-bold">Mi información</h4>
        <p className="text-xs text-muted-foreground">
          Un resumen en lenguaje claro para la familia. No es la historia clínica: la copia completa se pide aparte.
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

      {data && (
        <>
          <Readers data={data} />
          {data.can_publish ? (
            <>
              {!data.info_enabled && (
                <p className={WARN_BOX}>Para publicar, primero prendé «Mostrar «Mi información» en el portal» (arriba).</p>
              )}
              {data.author.problem ? (
                <p role="alert" className={ERROR_BOX}>{data.author.problem}</p>
              ) : data.author.label && (
                <p className="text-xs text-muted-foreground">
                  Se publica como: <span className="font-semibold text-foreground">{data.author.label}</span>
                </p>
              )}
              <VoidedAlerts data={data} busy={busy} onWithdraw={onWithdraw} />
              <SummaryEditor key={data.patient.id} data={data} canPublish={canPublish} busy={busy} send={send} reload={load}
                onWithdraw={onWithdraw} />
              <Reports data={data} canPublish={canPublish} busy={busy}
                onPublish={(report) => setDialog({ kind: "report", report })} onWithdraw={onWithdraw} />
            </>
          ) : (
            <ReadOnly data={data} />
          )}
          <History history={data.history} />
        </>
      )}

      {data && dialog?.kind === "report" && (
        <ReportDialog data={data} report={dialog.report} busy={busy} send={send} onClose={closeDialog} onReload={reloadFromDialog} />
      )}
      {data && dialog?.kind === "withdraw" && (
        <WithdrawDialog pub={dialog.pub} busy={busy} send={send} onClose={closeDialog} onReload={reloadFromDialog} />
      )}
    </section>
  );
}

// ── Partes ──────────────────────────────────────────────────────────────────

function Block({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-3 border-t border-border/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 id={id} className="text-sm font-semibold">{title}</h5>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]}`}>{children}</span>;
}

function Readers({ data }: { data: StaffInfoDTO }) {
  if (!data.readers.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {data.can_publish
          ? "Todavía nadie lo ve en el portal. Podés dejarlo listo: se va a ver cuando alguien active su acceso."
          : "Todavía nadie lo ve en el portal."}
      </p>
    );
  }
  return (
    <p className="text-sm">
      {data.can_publish ? "Lo que publiques acá lo ven en el portal: " : "Lo publicado lo ven en el portal: "}
      <span className="font-semibold">{names(data.readers)}</span>
    </p>
  );
}

function ReadsLine({ reads }: { reads: StaffPublication["reads"] }) {
  return (
    <p className="text-xs text-muted-foreground">
      {reads.length ? reads.map((x) => `${x.name} la vio el ${dm(x.at)}`).join(" · ") : "Todavía nadie de la familia la abrió"}
    </p>
  );
}

// Un informe que se anuló en la ficha después de publicarlo
function VoidedAlerts({ data, busy, onWithdraw }: { data: StaffInfoDTO; busy: boolean; onWithdraw: (p: StaffPublication) => void }) {
  const voided = data.history.filter((x) => x.source_voided && !x.withdrawn_at);
  return (
    <>
      {voided.map((pub) => (
        <div key={pub.id} role="alert" className={`${ERROR_BOX} flex flex-wrap items-center justify-between gap-2`}>
          <span>
            <span className="block">{pub.title}</span>
            El informe se anuló en la ficha: retiralo del portal. El portal ya lo oculta solo.
          </span>
          <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={() => onWithdraw(pub)}>
            Retirar del portal
          </Button>
        </div>
      ))}
    </>
  );
}

// Administración: qué hay publicado y quién lo leyó, sin los textos
function ReadOnly({ data }: { data: StaffInfoDTO }) {
  const live = [data.summary, ...data.reports.map((r) => r.live)].filter((x): x is StaffPublication => !!x);
  return (
    <>
      <p className="text-xs text-muted-foreground">Solo los profesionales publican, revisan y dan medallas en el portal.</p>
      {!data.info_enabled && (
        <p className="text-xs text-muted-foreground">«Mi información» no está prendida en el portal para este paciente.</p>
      )}
      {live.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay nada publicado.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {live.map((x) => (
            <li key={x.id} className="space-y-1 py-3 text-sm first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-semibold">{x.title}</span>
                <span className="text-xs text-muted-foreground">v{x.version} · publicada el {dm(x.published_at)}</span>
              </div>
              <p className="text-xs">{x.author_label}</p>
              <ReadsLine reads={x.reads} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── Qué trabajamos (resumen) ────────────────────────────────────────────────

type SummaryForm = { que: string; showCode: boolean; showTeam: boolean; acompanar: string; tips: string[] };

function formFrom(b: SummaryBody | null): SummaryForm {
  if (!b) return { que: "", showCode: false, showTeam: false, acompanar: "", tips: [] };
  return { que: b.que_trabajamos, showCode: !!b.tramites, showTeam: !!b.como_trabajamos, acompanar: b.acompanar.text, tips: [...b.acompanar.tips] };
}

// El formulario dice otra cosa que la versión publicada (o que el formulario vacío)
function differs(f: SummaryForm, b: SummaryBody | null): boolean {
  const o = formFrom(b);
  const tips = (t: string[]) => [...t].sort().join("|");
  return cleanText(f.que) !== cleanText(o.que)
    || f.showCode !== o.showCode || f.showTeam !== o.showTeam
    || cleanText(f.acompanar) !== cleanText(o.acompanar)
    || tips(f.tips) !== tips(o.tips);
}

// Lo que se publicaría con el formulario (lo mismo que arma el servidor; los
// textos no se cortan: si pasan el límite, el servidor los rechaza)
function bodyFrom(f: SummaryForm, p: Patient): SummaryBody {
  const code = p.diagnosis_code;
  return {
    que_trabajamos: cleanText(f.que),
    tramites: f.showCode && code && TRAMITE_CODES[code] ? { code, label: TRAMITE_CODES[code] } : null,
    como_trabajamos: f.showTeam ? { professional: p.professional_label, modes: p.modes } : null,
    acompanar: { text: cleanText(f.acompanar), tips: HOME_TIPS.filter((t) => f.tips.includes(t)) },
  };
}

// Lo que vería la familia: el formulario y los informes publicados
function previewInfo(data: StaffInfoDTO, summary: SummaryBody): InfoDTO {
  const p = data.patient;
  return {
    child: { id: p.id, first_name: p.first_name, self: p.age !== null && p.age >= ADULT_FROM },
    summary: summary.que_trabajamos ? {
      ...summary, id: "vista-previa", author_label: data.author.label ?? "", published_at: new Date().toISOString(),
      version: (data.summary?.version ?? 0) + 1, is_new: false, code: "00000 00000",
    } : null,
    reports: data.reports
      .flatMap((r) => {
        const pub = r.live;
        if (!pub?.body) return [];
        const b = pub.body as ReportBody;
        return [{
          id: pub.id, title: pub.title, report_date: b.report_date, author_label: pub.author_label,
          published_at: pub.published_at, sections: reportSections(b), is_new: false, code: pub.code,
          written_by: b.mode === "tal_cual" && b.written_by && b.written_by !== pub.author_label ? b.written_by : null,
        }];
      })
      .sort((a, b) => b.report_date.localeCompare(a.report_date)),
  };
}

function SummaryEditor({ data, canPublish, busy, send, reload, onWithdraw }: {
  data: StaffInfoDTO; canPublish: boolean; busy: boolean; send: Send; reload: () => Promise<void>;
  onWithdraw: (p: StaffPublication) => void;
}) {
  const p = data.patient;
  const code = p.diagnosis_code;
  const tramite = code ? TRAMITE_CODES[code] : undefined;
  const live = data.summary;
  const liveBody = (live?.body as SummaryBody | null | undefined) ?? null;
  const [form, setForm] = useState<SummaryForm>(() => formFrom(liveBody));
  const [base, setBase] = useState<{ id: string | null; body: SummaryBody | null }>({ id: live?.id ?? null, body: liveBody });
  const [askBase, setAskBase] = useState(false);
  const [keep, setKeep] = useState(false);
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ expected: StaffPublication | null } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const queRef = useRef<HTMLTextAreaElement>(null);
  const acompRef = useRef<HTMLTextAreaElement>(null);
  const cancelBaseRef = useRef<HTMLButtonElement>(null);
  const queId = useId();
  const acompId = useId();

  // base: la versión de la que partió lo que se está editando. Si cambió la
  // vigente (alguien publicó o retiró) y no había cambios, el formulario pasa
  // a la vigente; si los había, no se pisa nada: se avisa (ver "newer")
  const [seen, setSeen] = useState<string | null>(live?.id ?? null);
  if ((live?.id ?? null) !== seen) {
    setSeen(live?.id ?? null);
    if (!differs(form, base.body)) {
      setBase({ id: live?.id ?? null, body: liveBody });
      setForm(formFrom(liveBody));
    }
  }
  const newer = (live?.id ?? null) !== base.id;

  useEffect(() => { if (askBase) cancelBaseRef.current?.focus(); }, [askBase]);

  const set = (patch: Partial<SummaryForm>) => { setFormError(null); setForm((f) => ({ ...f, ...patch })); };
  const dirty = differs(form, liveBody);
  const phrases = found([form.que, form.acompanar]);
  const baseText = hasBaseFor(code) ? baseExplanation(code, audienceFor(p.age), p.first_name) : null;
  const teamLine = [p.professional_label ?? "Sin profesional asignado en la ficha", p.modes.length ? p.modes.join(", ") : null]
    .filter(Boolean).join(" · ");

  function insertBase() {
    if (!baseText) return;
    if (form.que.trim() && cleanText(form.que, INFO_LIMITS.que_trabajamos) !== baseText) { setAskBase(true); return; }
    set({ que: baseText });
    queRef.current?.focus();
  }

  function fix() {
    (found([form.que]).length ? queRef : acompRef).current?.focus();
  }

  function askPublish() {
    setFormError(null);
    if (bodyFrom(form, p).que_trabajamos.length < 20) {
      setFormError("Escribí qué trabajan en el CIMT (al menos unas palabras).");
      queRef.current?.focus();
      return;
    }
    const tooLong = fitText(form.que, INFO_LIMITS.que_trabajamos, "«¿Qué trabajamos en el CIMT?»").error
      ?? fitText(form.acompanar, INFO_LIMITS.acompanar, "«Cómo acompañar en casa»").error;
    if (tooLong) { setFormError(tooLong); return; }
    if (phrases.length && (!keep || cleanText(note, REVIEW_NOTE_MAX).length < 3)) { setFormError(REVIEW_NEEDED); return; }
    // Se publica sobre la versión de la que partió la edición: si ya no es la
    // vigente, el servidor responde 409 y no se pisa lo de otra persona
    setConfirm({ expected: data.history.find((h) => h.id === base.id) ?? null });
  }

  async function publish(acks: Acks): Promise<Sent> {
    const body = bodyFrom(form, p);
    const r = await send({
      action: "publish_summary",
      expected_id: confirm?.expected?.id ?? null,
      que_trabajamos: body.que_trabajamos,
      show_code: !!body.tramites,
      show_team: form.showTeam,
      acompanar: body.acompanar.text,
      tips: body.acompanar.tips,
      discussed_ack: acks.discussed,
      ...(isAdolescent(p.age) ? { adolescent_ack: acks.adolescent } : {}),
      ...(phrases.length ? { review_note: cleanText(note, REVIEW_NOTE_MAX) } : {}),
    });
    if (!r.ok) return r;
    // El formulario queda con lo publicado (el servidor limpia espacios y líneas)
    const published = (r.data.summary?.body as SummaryBody | null | undefined) ?? null;
    if (published) setForm(formFrom(published));
    setBase({ id: r.data.summary?.id ?? null, body: published });
    setKeep(false);
    setNote("");
    setConfirm(null);
    publishedToast(r.data.readers);
    return r;
  }

  return (
    <Block title="Qué trabajamos" aside={(
      <div className="flex flex-wrap gap-1.5">
        {live ? <Pill tone="ok">Publicado el {dm(live.published_at)} (v{live.version})</Pill> : <Pill tone="muted">Sin publicar</Pill>}
        {live && dirty && <Pill tone="warn">Cambios sin publicar</Pill>}
      </div>
    )}>
      {live && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ReadsLine reads={live.reads} />
          <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={() => onWithdraw(live)}>
            Retirar del portal
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Label htmlFor={queId}>¿Qué trabajamos en el CIMT?</Label>
          {baseText && (
            <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={insertBase}>
              Usar el texto base de {code ?? "evaluación"}
            </Button>
          )}
        </div>
        {askBase && (
          <div role="group" aria-label="Usar el texto base" className="space-y-2 rounded-xl bg-muted p-3 text-sm">
            <p>¿Reemplazar lo que escribiste por el texto base?</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button ref={cancelBaseRef} type="button" size="sm" variant="ghost" onClick={() => setAskBase(false)}>Cancelar</Button>
              <Button type="button" size="sm"
                onClick={() => { set({ que: baseText ?? "" }); setAskBase(false); queRef.current?.focus(); }}>
                Reemplazar
              </Button>
            </div>
          </div>
        )}
        <Textarea id={queId} ref={queRef} rows={6} maxLength={INFO_LIMITS.que_trabajamos} value={form.que}
          onChange={(e) => set({ que: e.target.value })} />
        <Counter n={form.que.length} max={INFO_LIMITS.que_trabajamos} />
      </div>

      {tramite && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.showCode} onChange={(e) => set({ showCode: e.target.checked })} />
          <span>Mostrar el código en «Datos para trámites» <span className="text-muted-foreground">({tramite})</span></span>
        </label>
      )}
      <div className="space-y-0.5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={form.showTeam} onChange={(e) => set({ showTeam: e.target.checked })} />
          Mostrar quién lo atiende y cómo
        </label>
        <p className="pl-6 text-xs text-muted-foreground">{teamLine}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={acompId}>Cómo acompañar en casa</Label>
        <div role="group" aria-label="Consejos para acompañar en casa" className="flex flex-wrap gap-1.5">
          {HOME_TIPS.map((t) => {
            const on = form.tips.includes(t);
            return (
              <TipChip key={t} active={on} onClick={() => set({ tips: on ? form.tips.filter((x) => x !== t) : [...form.tips, t] })}>
                {t}
              </TipChip>
            );
          })}
        </div>
        <Textarea id={acompId} ref={acompRef} rows={3} maxLength={INFO_LIMITS.acompanar} value={form.acompanar}
          placeholder="Algo más para la familia (opcional)" onChange={(e) => set({ acompanar: e.target.value })} />
        <Counter n={form.acompanar.length} max={INFO_LIMITS.acompanar} />
      </div>

      {/* Lo ya publicado se revisó al publicarlo: el aviso vuelve si se cambia algo */}
      {(!live || dirty) && (
        <FluencyReview phrases={phrases} keep={keep} note={note} onFix={fix}
          onKeep={() => setKeep(true)} onNote={(v) => { setFormError(null); setNote(v); }} />
      )}
      {formError && <p role="alert" className={ERROR_BOX}>{formError}</p>}
      {newer && (
        <div role="status" className={`${WARN_BOX} space-y-2`}>
          {live ? (
            <p>
              Mientras editabas se publicó otra versión (v{live.version}, el {dm(live.published_at)}, por {live.published_by_email}).
              Para no pisarla, cargala y volvé a hacer tus cambios.
            </p>
          ) : (
            <p>Mientras editabas se retiró la versión publicada.</p>
          )}
          <div className="flex justify-end">
            {live ? (
              <Button type="button" size="sm" variant="outline" className={PILL_BTN}
                onClick={() => { setBase({ id: live.id, body: liveBody }); setForm(formFrom(liveBody)); setKeep(false); setNote(""); }}>
                Cargar la versión publicada
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" className={PILL_BTN}
                onClick={() => setBase({ id: null, body: null })}>
                Seguir con mis cambios
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {live && !dirty && <span className="text-xs text-muted-foreground">Ya está publicado así.</span>}
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={() => setPreviewing(true)}>
          <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Ver como la familia
        </Button>
        <Button type="button" size="sm" className={PILL_BTN} disabled={!canPublish || busy || newer || (!!live && !dirty)} onClick={askPublish}>
          Publicar
        </Button>
      </div>

      {previewing && <PreviewDialog info={previewInfo(data, bodyFrom(form, p))} onClose={() => setPreviewing(false)} />}
      {confirm && (
        <SummaryPublishDialog data={data} expected={confirm.expected} busy={busy} onPublish={publish}
          onClose={() => setConfirm(null)} onReload={() => { setConfirm(null); void reload(); }} />
      )}
    </Block>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return <p className={`text-right text-xs ${n >= max ? PENDING_TEXT : "text-muted-foreground"}`}>{n}/{max}</p>;
}

function TipChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={[
      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-left text-xs font-semibold transition-colors",
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
    ].join(" ")}>
      {active && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}

// Aviso de fluidez: no bloquea, pero para dejarlo hay que contar por qué
function FluencyReview({ phrases, keep, note, onFix, onKeep, onNote }: {
  phrases: string[]; keep: boolean; note: string; onFix: () => void; onKeep: () => void; onNote: (v: string) => void;
}) {
  const noteId = useId();
  if (!phrases.length) return null;
  return (
    <div className="space-y-2 rounded-xl bg-[color:var(--status-pending-bg)] p-3 text-sm text-[oklch(0.42_0.1_70)]">
      <p className="flex gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          El texto dice «{phrases.join("», «")}». En el portal no prometemos ni medimos fluidez: puede sumar presión.
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={onFix}>Corregirlo</Button>
        {!keep && <Button type="button" size="sm" variant="ghost" className={PILL_BTN} onClick={onKeep}>Lo dejo así</Button>}
      </div>
      {keep && (
        <div className="space-y-1.5">
          <Label htmlFor={noteId} className="text-foreground">¿Por qué lo dejás así?</Label>
          <Input id={noteId} value={note} maxLength={REVIEW_NOTE_MAX} autoFocus className="bg-background"
            placeholder="Ej.: es la palabra que usa la familia" onChange={(e) => onNote(e.target.value)} />
          <p className="text-xs">Queda guardado con la publicación. La familia no lo ve.</p>
        </div>
      )}
    </div>
  );
}

// ── Informes ────────────────────────────────────────────────────────────────

function Reports({ data, canPublish, busy, onPublish, onWithdraw }: {
  data: StaffInfoDTO; canPublish: boolean; busy: boolean;
  onPublish: (r: StaffReportRow) => void; onWithdraw: (p: StaffPublication) => void;
}) {
  return (
    <Block title="Informes">
      {data.reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay informes en la ficha.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {data.reports.map((r) => (
            <li key={r.id} className="space-y-1.5 py-3 text-sm first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-semibold">Informe del {dmy(r.report_date)}</span>
                <span className="text-xs text-muted-foreground">{r.professional_name ?? "Sin profesional"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.live ? <Pill tone="ok">Publicado el {dm(r.live.published_at)}</Pill> : <Pill tone="muted">Sin publicar</Pill>}
                {r.changed_after && <Pill tone="warn">Cambió después de publicarlo</Pill>}
              </div>
              {r.live && <ReadsLine reads={r.live.reads} />}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={!canPublish || busy}
                  onClick={() => onPublish(r)}>
                  {r.live ? "Publicar la versión nueva" : "Publicar"}
                </Button>
                {r.live && (
                  <Button type="button" size="sm" variant="ghost" className={PILL_BTN} disabled={busy} onClick={() => onWithdraw(r.live!)}>
                    Retirar del portal
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

// ── Historial ───────────────────────────────────────────────────────────────

function History({ history }: { history: StaffPublication[] }) {
  const [open, setOpen] = useState(false);
  if (!history.length) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border/60 pt-3">
      <CollapsibleTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="-ml-2 h-8 gap-1.5 px-2 font-semibold">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          Historial ({history.length})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 divide-y divide-border/60">
          {history.map((h) => (
            <li key={h.id} className="space-y-0.5 py-2.5 text-xs first:pt-0 last:pb-0">
              <p className="text-sm">
                <span className="font-semibold">v{h.version} · {h.title}</span> · publicada el {dm(h.published_at)} por {h.published_by_email}
              </p>
              {h.withdrawn_at && (
                <p className="text-muted-foreground">
                  (retirada el {dm(h.withdrawn_at)}{h.withdrawn_by_email ? ` por ${h.withdrawn_by_email}` : ""}
                  {h.withdraw_reason ? `: ${WITHDRAW_LABEL[h.withdraw_reason]}` : ""})
                </p>
              )}
              {h.source_voided && <p className="text-muted-foreground">El informe se anuló en la ficha.</p>}
              <p className="text-muted-foreground">Código {h.code}</p>
              {h.reads.length > 0 && <p>{h.reads.map((x) => `${x.name} la vio el ${dm(x.at)}`).join(" · ")}</p>}
              {h.review_note && <p className={PENDING_TEXT}>Se dejó con aviso de fluidez: {h.review_note}</p>}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Diálogos ────────────────────────────────────────────────────────────────

type Acks = { discussed: boolean; adolescent: boolean };
const NO_ACKS: Acks = { discussed: false, adolescent: false };
const acksOk = (a: Acks, age: number | null) => a.discussed && (!isAdolescent(age) || a.adolescent);

function AckChecks({ patient, value, onChange }: { patient: Patient; value: Acks; onChange: (v: Acks) => void }) {
  return (
    <fieldset className="space-y-2 rounded-xl bg-muted p-3">
      <legend className="sr-only">Antes de publicar</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={value.discussed}
          onChange={(e) => onChange({ ...value, discussed: e.target.checked })} />
        Ya lo conversé en consulta
      </label>
      {isAdolescent(patient.age) && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={value.adolescent}
            onChange={(e) => onChange({ ...value, adolescent: e.target.checked })} />
          Lo conversé con {patient.first_name} ({patient.age} años)
        </label>
      )}
    </fieldset>
  );
}

function WhoWillSee({ readers, replaces }: { readers: string[]; replaces: StaffPublication | null }) {
  return (
    <div className="space-y-1 text-sm">
      <p>
        {readers.length
          ? <>Lo van a ver: <span className="font-semibold">{names(readers)}</span></>
          : "Todavía nadie lo ve: se va a ver cuando alguien active el portal."}
      </p>
      {replaces && <p>Reemplaza la versión del {dm(replaces.published_at)}.</p>}
    </div>
  );
}

function ErrorBox({ error, onReload }: { error: SendError | null; onReload: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className={`${ERROR_BOX} flex flex-wrap items-center justify-between gap-2`}>
      <span>{error.message}</span>
      {error.stale && (
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} onClick={onReload}>Actualizar</Button>
      )}
    </div>
  );
}

function DialogButtons({ busy, onClose, submit, disabled, destructive }: {
  busy: boolean; onClose: () => void; submit: string; disabled?: boolean; destructive?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || disabled} className="rounded-full">
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {submit}
      </Button>
    </div>
  );
}

const TITLE = "font-display text-2xl text-[color:var(--primary-deep)]";

function PreviewDialog({ info, onClose }: { info: InfoDTO; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[94vh] max-w-[460px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Así lo ve la familia</DialogTitle>
          <DialogDescription>Es una vista previa en un celular: todavía no se publica nada.</DialogDescription>
        </DialogHeader>
        <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[2rem] border-[6px] border-foreground/80 shadow-lg">
          <div className="bg-notebook max-h-[65vh] overflow-y-auto px-4 pb-6 pt-5">
            <InfoView info={info} preview />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryPublishDialog({ data, expected, busy, onPublish, onClose, onReload }: {
  data: StaffInfoDTO; expected: StaffPublication | null; busy: boolean;
  onPublish: (acks: Acks) => Promise<Sent>; onClose: () => void; onReload: () => void;
}) {
  const p = data.patient;
  const [acks, setAcks] = useState<Acks>(NO_ACKS);
  const [error, setError] = useState<SendError | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!acksOk(acks, p.age)) return;
    const r = await onPublish(acks);
    if (!r.ok) setError(r);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>¿Publicar «Mi información» de {p.first_name}?</DialogTitle>
          <DialogDescription>Queda así en el portal hasta que publiques una versión nueva o lo retires.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <WhoWillSee readers={data.readers} replaces={expected} />
          <AckChecks patient={p} value={acks} onChange={setAcks} />
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={busy} onClose={onClose} submit="Publicar" disabled={!acksOk(acks, p.age)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DialogProps = { busy: boolean; send: Send; onClose: () => void; onReload: () => void };

function ReportDialog({ data, report, busy, send, onClose, onReload }: DialogProps & { data: StaffInfoDTO; report: StaffReportRow }) {
  const p = data.patient;
  const live = report.live;
  const liveBody = (live?.body as ReportBody | null | undefined) ?? null;
  const progress = report.progress?.trim() ? report.progress : null;
  const evolution = report.therapy_evolution?.trim() ? report.therapy_evolution : null;
  const [mode, setMode] = useState<"familia" | "tal_cual">(liveBody?.mode ?? "familia");
  const [text, setText] = useState(liveBody?.mode === "familia" ? liveBody.text : "");
  const [incProgress, setIncProgress] = useState(liveBody?.mode === "tal_cual" && !!liveBody.progress && !!progress);
  const [incEvolution, setIncEvolution] = useState(liveBody?.mode === "tal_cual" && !!liveBody.therapy_evolution && !!evolution);
  const [acks, setAcks] = useState<Acks>(NO_ACKS);
  const [keep, setKeep] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<SendError | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const name = useId();

  const chosen = [incProgress ? progress : null, incEvolution ? evolution : null].filter((x): x is string => !!x);
  const phrases = found(mode === "familia" ? [text] : chosen);

  // Tal cual no se puede editar acá: se pasa a la versión para la familia,
  // partiendo de lo elegido
  function fix() {
    if (mode === "tal_cual") {
      setMode("familia");
      if (!text.trim()) setText(chosen.join("\n\n"));
    }
    setTimeout(() => textRef.current?.focus(), 0);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { text: clean, error: tooLong } = fitText(text, INFO_LIMITS.report_text, "La versión para la familia");
    if (mode === "familia" && tooLong) { setError({ message: tooLong, stale: false }); return; }
    if (mode === "familia" && clean.length < 20) {
      setError({ message: "Escribí la versión para la familia (al menos unas palabras).", stale: false });
      return;
    }
    if (mode === "tal_cual" && !chosen.length) {
      setError({ message: "Elegí al menos una sección con texto (Progreso o Evolución).", stale: false });
      return;
    }
    if (phrases.length && (!keep || cleanText(note, REVIEW_NOTE_MAX).length < 3)) { setError({ message: REVIEW_NEEDED, stale: false }); return; }
    if (!acksOk(acks, p.age)) return;
    const r = await send({
      action: "publish_report",
      expected_id: live?.id ?? null,
      report_id: report.id,
      report_edited_at: report.edited_at,
      mode,
      ...(mode === "familia"
        ? { text: clean }
        : { include_progress: incProgress && !!progress, include_evolution: incEvolution && !!evolution }),
      discussed_ack: acks.discussed,
      ...(isAdolescent(p.age) ? { adolescent_ack: acks.adolescent } : {}),
      ...(phrases.length ? { review_note: cleanText(note, REVIEW_NOTE_MAX) } : {}),
    });
    if (!r.ok) { setError(r); return; }
    publishedToast(r.data.readers);
    onClose();
  }

  const radio = (value: typeof mode, label: string) => (
    <label className="flex items-center gap-2 text-sm font-semibold">
      <input type="radio" name={name} value={value} checked={mode === value}
        onChange={() => { setError(null); setMode(value); }} />
      {label}
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Publicar el informe del {dmy(report.report_date)}</DialogTitle>
          <DialogDescription>
            {report.professional_name ? `Lo escribió ${report.professional_name}. ` : ""}Elegí cómo lo va a leer la familia.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className={`${WARN_BOX} space-y-1`}>
            <p>Los informes están escritos para el equipo. Revisá que se entiendan y que no nombren a otras personas.</p>
            <p>El Diagnóstico de un informe nunca se publica tal cual.</p>
          </div>

          <fieldset className="space-y-2">
            <legend className="sr-only">Cómo publicarlo</legend>
            {radio("familia", "Versión para la familia")}
            {radio("tal_cual", "Tal cual")}
          </fieldset>

          {mode === "familia" ? (
            <div className="space-y-1.5">
              {(progress || evolution) && (
                <details className="rounded-xl bg-muted/60 p-3 text-xs">
                  <summary className="cursor-pointer font-semibold">Ver lo que dice el informe</summary>
                  <div className="mt-2 space-y-2">
                    {progress && <ReportText label="Progreso" text={progress} />}
                    {evolution && <ReportText label="Evolución de la terapia" text={evolution} />}
                  </div>
                </details>
              )}
              <Label htmlFor={textId}>Versión para la familia</Label>
              <Textarea id={textId} ref={textRef} rows={8} maxLength={INFO_LIMITS.report_text} value={text}
                onChange={(e) => { setError(null); setText(e.target.value); }} />
              <Counter n={text.length} max={INFO_LIMITS.report_text} />
            </div>
          ) : (
            <div className="space-y-3">
              <TalCualCheck label="Progreso" text={progress} checked={incProgress}
                onChange={(v) => { setError(null); setIncProgress(v); }} />
              <TalCualCheck label="Evolución de la terapia" text={evolution} checked={incEvolution}
                onChange={(v) => { setError(null); setIncEvolution(v); }} />
            </div>
          )}

          <FluencyReview phrases={phrases} keep={keep} note={note} onFix={fix}
            onKeep={() => setKeep(true)} onNote={(v) => { setError(null); setNote(v); }} />
          <WhoWillSee readers={data.readers} replaces={live} />
          <AckChecks patient={p} value={acks} onChange={setAcks} />
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={busy} onClose={onClose} submit="Publicar" disabled={!acksOk(acks, p.age)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReportText({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="font-semibold">{label}</p>
      <p className="whitespace-pre-line">{text}</p>
    </div>
  );
}

function TalCualCheck({ label, text, checked, onChange }: {
  label: string; text: string | null; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className={`flex items-start gap-2 text-sm font-semibold ${text ? "" : "text-muted-foreground"}`}>
        <input type="checkbox" className="mt-0.5" checked={checked && !!text} disabled={!text}
          onChange={(e) => onChange(e.target.checked)} />
        {label}{!text && " (vacío en el informe)"}
      </label>
      {text && (
        <p className="max-h-40 overflow-y-auto whitespace-pre-line rounded-lg bg-muted/60 p-2 text-xs">{text}</p>
      )}
    </div>
  );
}

function WithdrawDialog({ pub, busy, send, onClose, onReload }: DialogProps & { pub: StaffPublication }) {
  const [reason, setReason] = useState<Reason | "">("");
  const [error, setError] = useState<SendError | null>(null);
  const reasonId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason) { setError({ message: "Elegí el motivo.", stale: false }); return; }
    const r = await send({ action: "withdraw", publication_id: pub.id, reason });
    if (!r.ok) { setError(r); return; }
    toast.success("Se retiró del portal.");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={TITLE}>Retirar del portal</DialogTitle>
          <DialogDescription>{pub.title} · v{pub.version}, publicada el {dm(pub.published_at)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Motivo</Label>
            <select id={reasonId} value={reason} className={selectClass}
              onChange={(e) => { setError(null); setReason(e.target.value as Reason | ""); }}>
              <option value="">Elegí el motivo</option>
              {WITHDRAW_REASONS.map((k) => <option key={k} value={k}>{WITHDRAW_LABEL[k]}</option>)}
            </select>
          </div>
          <p className="text-sm">Deja de verse en el portal. Queda guardado acá, con tu usuario, la fecha y el motivo.</p>
          <ErrorBox error={error} onReload={onReload} />
          <DialogButtons busy={busy} onClose={onClose} submit="Retirar" destructive />
        </form>
      </DialogContent>
    </Dialog>
  );
}
