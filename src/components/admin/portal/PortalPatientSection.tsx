import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Section, selectClass } from "../fields";
import { todayKey } from "@/lib/patients";
import { CLINICAL_NOTICE_VERSION, adolescentAgreed } from "@/lib/portalClinicalRules";
import {
  type ClinicalAction, type ClinicalBlock, type StaffAccessRow, type StaffClinicalDTO, type StaffGuardianRow,
  CLINICAL_BLOCK_LABEL, portalStaffApi,
} from "@/lib/portalStaff";
import { usePortalClinicalFeatures } from "./usePortalClinicalFeatures";
import { PortalInfoEditor } from "./PortalInfoEditor";

// Sección "Portal del paciente" de la ficha: quién puede ver la información
// de salud del paciente en el Portal de familias y por qué no (eso lo ve solo
// el equipo), qué se muestra, conformidad del adolescente, pausa y bloqueos
// por orden judicial. Con la etapa "info", abajo va «Mi información»
// (PortalInfoEditor). Aparece solo si el servidor tiene prendida alguna etapa
// (PORTAL_CLINICAL_FEATURES) y se carga recién al abrirla.

type WithoutPatient<T> = T extends unknown ? Omit<T, "patient_id"> : never;
type ActionBody = WithoutPatient<ClinicalAction>;
type Act = (body: ActionBody) => Promise<string | null>; // null: salió bien; si no, el mensaje de error
type PartKey = "who" | "enable" | "adolescent" | "pause" | "block";

type DialogState =
  | { kind: "verify"; row: StaffAccessRow }
  | { kind: "paper"; row: StaffAccessRow }
  | { kind: "block"; guardian: StaffGuardianRow }
  | null;

const PAUSE_LABEL: Record<string, string> = {
  indicacion_profesional: "Indicación profesional",
  judicial: "Orden judicial",
};
const BLOCK_REASON_LABEL: Record<string, string> = {
  orden_judicial: "Orden judicial",
  otro: "Otro motivo",
};

const PENDING_TEXT = "text-[oklch(0.45_0.11_70)]";
const ERROR_BOX = "rounded-xl bg-[color:var(--status-occupied-bg)] px-3 py-2 text-sm font-semibold text-[oklch(0.48_0.19_25)]";
const PILL_BTN = "h-8 rounded-full";

// ── Fechas (es-AR). Las de solo día (AAAA-MM-DD) se leen en hora local ──────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(iso: string): Date {
  if (DATE_ONLY.test(iso)) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(iso);
}

const two = (n: number) => String(n).padStart(2, "0");

// dd/mm (con el año si no es este)
function dm(iso: string): string {
  const d = toDate(iso);
  const day = `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
  return d.getFullYear() === new Date().getFullYear() ? day : `${day}/${d.getFullYear()}`;
}

// dd/mm hh:mm
function dmhm(iso: string): string {
  const d = new Date(iso);
  return `${dm(iso)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

// ── Textos de cada acceso ───────────────────────────────────────────────────

function relationLabel(r: StaffAccessRow): string {
  if (r.link_kind === "titular") return "El propio paciente";
  if (r.link_kind === "autorizado") return r.relationship ? `Adulto autorizado · ${r.relationship}` : "Adulto autorizado";
  return r.relationship ?? "Madre, padre o tutor/a";
}

function consentActive(r: StaffAccessRow): boolean {
  return !!r.consent && r.consent.accepted && r.consent.version === CLINICAL_NOTICE_VERSION;
}

function consentText(r: StaffAccessRow): string {
  const c = r.consent;
  if (!c) return "Todavía no activó la información de salud";
  const paper = c.channel === "papel" ? " (en papel)" : "";
  if (!c.accepted) return `La desactivó el ${dm(c.at)}${paper}`;
  if (c.version !== CLINICAL_NOTICE_VERSION) return `Aceptó un aviso anterior el ${dm(c.at)}${paper}: falta que active el actual`;
  return `Activó la información de salud el ${dm(c.at)}${paper}`;
}

function summary(dto: StaffClinicalDTO | null): string {
  if (!dto) return "Quién la ve, qué se muestra, pausa y bloqueos por orden judicial.";
  const n = dto.accesses.length;
  const seeing = dto.accesses.filter((a) => a.info_block === null).length;
  const parts = [n === 0 ? "Nadie tiene acceso todavía" : n === 1 ? "1 cuenta con acceso" : `${n} cuentas con acceso`];
  if (n) parts.push(seeing === 1 ? "1 ve la información" : `${seeing} ven la información`);
  if (dto.settings.paused_at) parts.push("en pausa");
  const blocked = dto.guardians.filter((g) => g.block).length;
  if (blocked) parts.push(blocked === 1 ? "1 adulto bloqueado" : `${blocked} adultos bloqueados`);
  return parts.join(" · ");
}

// ── Sección ─────────────────────────────────────────────────────────────────

export function PortalPatientSection({ patientId }: { patientId: string }) {
  const features = usePortalClinicalFeatures();
  const [forPatient, setForPatient] = useState(patientId);
  const [open, setOpen] = useState(false);
  const [dto, setDto] = useState<StaffClinicalDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ part: PartKey; message: string } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const current = useRef(patientId);
  const loadSeq = useRef(0);
  const contentId = useId();

  // Otra ficha: se empieza de cero (y se ignoran respuestas de la anterior)
  if (forPatient !== patientId) {
    current.current = patientId;
    setForPatient(patientId);
    setOpen(false);
    setDto(null);
    setLoading(false);
    setLoadError(null);
    setBusy(false);
    setError(null);
    setDialog(null);
  }

  async function load() {
    const id = patientId;
    const n = ++loadSeq.current;
    setLoading(true);
    setLoadError(null);
    const r = await portalStaffApi.clinical({ action: "get", patient_id: id });
    if (current.current !== id || loadSeq.current !== n) return;
    setLoading(false);
    if (!r.ok) { setLoadError(r.error); return; }
    setDto(r.data);
  }

  const act: Act = async (body) => {
    const id = patientId;
    setBusy(true);
    setError(null);
    const r = await portalStaffApi.clinical({ ...body, patient_id: id } as ClinicalAction);
    if (current.current !== id) return "Se abrió otra ficha.";
    setBusy(false);
    if (!r.ok) {
      // Otra persona lo cambió mientras tanto: se trae lo último
      if (r.status === 409) void load();
      return r.error;
    }
    // Lo que devuelve la acción es más nuevo que una carga que esté en camino
    loadSeq.current++;
    setLoading(false);
    setLoadError(null);
    setDto(r.data);
    return null;
  };

  // Acciones que se hacen sin diálogo: el error aparece en su parte
  async function actIn(part: PartKey, body: ActionBody): Promise<boolean> {
    const message = await act(body);
    if (message) setError({ part, message });
    return !message;
  }

  function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setError(null);
    void load();
  }

  if (!features || features.length === 0) return null;

  const errorFor = (part: PartKey) => (error?.part === part ? <p role="alert" className={ERROR_BOX}>{error.message}</p> : null);

  return (
    <Section
      icon={ShieldCheck}
      title="Portal del paciente"
      action={(
        <Button type="button" size="sm" variant="outline" onClick={toggle}
          aria-label={open ? "Cerrar Portal del paciente" : "Abrir Portal del paciente"}
          aria-expanded={open} aria-controls={open ? contentId : undefined}>
          {open ? "Cerrar" : "Abrir"}
        </Button>
      )}
    >
      <div>
        <p className="text-sm font-semibold">Información de salud en el portal</p>
        {!open && <p className="text-xs text-muted-foreground">{summary(dto)}</p>}
      </div>

      {open && (
        <div id={contentId} className="space-y-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {dto ? "Actualizando…" : "Cargando…"}
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
          {dto && (
            <>
              {dto.patient.discharged && (
                <p className="rounded-xl bg-muted px-3 py-2 text-sm font-semibold">
                  {dto.patient.first_name} tiene el alta: el portal ya no le muestra nada de esto. Queda guardado acá.
                </p>
              )}
              <WhoSees dto={dto} busy={busy} error={errorFor("who")} onDialog={setDialog} />
              <Enablement dto={dto} busy={busy} error={errorFor("enable")} actIn={actIn} />
              {dto.adolescent_required && <Adolescent dto={dto} busy={busy} error={errorFor("adolescent")} actIn={actIn} />}
              {(dto.can_edit || !!dto.settings.paused_at) && <Pause dto={dto} busy={busy} error={errorFor("pause")} actIn={actIn} />}
              <Blocks dto={dto} busy={busy} error={errorFor("block")} actIn={actIn} onDialog={setDialog} />
              {/* Se recarga cuando esta sección guarda algo: «quién lo ve» y la habilitación cambian acá */}
              {features.includes("info") && <PortalInfoEditor key={patientId} patientId={patientId} refreshKey={dto} />}
            </>
          )}
        </div>
      )}

      {dto && dialog?.kind === "verify" && (
        <VerifyDialog row={dialog.row} firstName={dto.patient.first_name} busy={busy} act={act} onClose={() => setDialog(null)} />
      )}
      {dto && dialog?.kind === "paper" && (
        <PaperDialog row={dialog.row} files={dto.paper_files} busy={busy} act={act} onClose={() => setDialog(null)} />
      )}
      {dto && dialog?.kind === "block" && (
        <BlockDialog guardian={dialog.guardian} firstName={dto.patient.first_name} busy={busy} act={act} onClose={() => setDialog(null)} />
      )}
    </Section>
  );
}

// ── Partes ──────────────────────────────────────────────────────────────────

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-2xl border border-border/60 p-4">
      <h4 id={id} className="text-sm font-bold">{title}</h4>
      {children}
    </section>
  );
}

type PartProps = { dto: StaffClinicalDTO; busy: boolean; error: React.ReactNode };
type ActIn = (part: PartKey, body: ActionBody) => Promise<boolean>;

function Outcome({ block }: { block: ClinicalBlock | null }) {
  if (block === null) {
    return (
      <span className="inline-flex rounded-full bg-[color:var(--status-available-bg)] px-2.5 py-0.5 text-xs font-semibold text-[oklch(0.42_0.12_150)]">
        Ve la información
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
      {CLINICAL_BLOCK_LABEL[block]}
    </span>
  );
}

function WhoSees({ dto, busy, error, onDialog }: PartProps & { onDialog: (d: DialogState) => void }) {
  const first = dto.patient.first_name;
  return (
    <Part title="Quién lo ve">
      {dto.accesses.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía nadie tiene acceso al portal para {first}. Podés dejar todo listo: lo van a ver cuando activen su cuenta.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {dto.accesses.map((r) => {
            const autorizado = r.link_kind === "autorizado";
            const rep = r.link_kind === "representante_legal";
            const verified = !!r.verified_in_person_on;
            const needsDocs = rep && verified && !r.parental_checked_on;
            const verifyLabel = !verified ? "Verificar en persona" : needsDocs ? "Registrar la documentación" : "Corregir la verificación";
            return (
              <li key={r.link_id} className="space-y-1.5 py-3 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-xs text-muted-foreground">{relationLabel(r)}</span>
                </div>
                {!autorizado && (
                  <>
                    <p className="text-xs">
                      {verified ? (
                        <>
                          Verificado en persona el {dm(r.verified_in_person_on!)}
                          {rep && (r.parental_checked_on
                            ? <> · documentación vista el {dm(r.parental_checked_on)}</>
                            : <span className={`font-semibold ${PENDING_TEXT}`}> · Falta ver la documentación</span>)}
                        </>
                      ) : (
                        <span className={`font-semibold ${PENDING_TEXT}`}>Falta verificar en persona</span>
                      )}
                    </p>
                    <p className="text-xs">{consentText(r)}</p>
                  </>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Outcome block={r.info_block} />
                  {r.practice_block !== r.info_block && (
                    <span className="text-xs text-muted-foreground">
                      {r.practice_block === null
                        ? "Ejercicios, devoluciones y medallas: los ve"
                        : `Ejercicios, devoluciones y medallas: ${CLINICAL_BLOCK_LABEL[r.practice_block]}`}
                    </span>
                  )}
                </div>
                {!autorizado && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy}
                      onClick={() => onDialog({ kind: "verify", row: r })}>
                      {verifyLabel}
                    </Button>
                    {!consentActive(r) && (
                      <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy}
                        onClick={() => onDialog({ kind: "paper", row: r })}>
                        Registrar aceptación en papel
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error}
    </Part>
  );
}

function Enablement({ dto, busy, error, actIn }: PartProps & { actIn: ActIn }) {
  const infoId = useId();
  const practiceId = useId();
  const s = dto.settings;
  const locked = !dto.can_edit || busy;
  return (
    <Part title="Habilitación">
      {!dto.can_edit && <p className="text-xs text-muted-foreground">Solo los profesionales y la Dirección cambian esto.</p>}
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={infoId} className="leading-snug">Mostrar «Mi información» en el portal</Label>
        <Switch id={infoId} checked={s.info_enabled} disabled={locked}
          onCheckedChange={(v) => void actIn("enable", { action: "set", info_enabled: v })} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={practiceId} className="leading-snug">Mostrar ejercicios, devoluciones y medallas</Label>
        <Switch id={practiceId} checked={s.practice_enabled} disabled={locked}
          onCheckedChange={(v) => void actIn("enable", { action: "set", practice_enabled: v })} />
      </div>
      <p className="text-xs text-muted-foreground">
        {dto.features.includes("info")
          ? "Lo que publiques en «Mi información» (más abajo) lo ven solo las personas de «Quién lo ve». Los ejercicios y las medallas llegan más adelante."
          : "Todavía no hay nada para publicar: esto deja listo el acceso."}
      </p>
      {s.updated_by_email && (
        <p className="text-xs text-muted-foreground">
          Último cambio: {s.updated_by_email}{s.updated_at ? ` · ${dmhm(s.updated_at)}` : ""}
        </p>
      )}
      {error}
    </Part>
  );
}

function Adolescent({ dto, busy, error, actIn }: PartProps & { actIn: ActIn }) {
  const first = dto.patient.first_name;
  const s = dto.settings;
  const agreed = adolescentAgreed(s, dto.patient.age);
  const today = todayKey();
  const [date, setDate] = useState(today);
  const [formError, setFormError] = useState<string | null>(null);
  const dateId = useId();

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!date || date > today) { setFormError("Indicá la fecha en que dio su conformidad (no puede ser futura)."); return; }
    await actIn("adolescent", { action: "adolescent", agreed_on: date });
  }

  return (
    <Part title={`Conformidad de ${first}${dto.patient.age !== null ? ` (${dto.patient.age} años)` : ""}`}>
      <p className="text-xs text-muted-foreground">
        Desde los 13 años su opinión cuenta (CCyC art. 26). Sin su conformidad, su familia no ve nada clínico en el portal.
      </p>
      {agreed && s.adolescent_agreed_on ? (
        <>
          <p className="text-sm">
            Dio su conformidad el {dm(s.adolescent_agreed_on)}
            {s.adolescent_agreed_by_email && ` (la registró ${s.adolescent_agreed_by_email})`}
          </p>
          {dto.can_edit && (
            <ConfirmButton
              label="Retiró su conformidad"
              question={`¿Registrar que ${first} retiró su conformidad? Su familia deja de ver lo clínico en el portal.`}
              confirmLabel="Sí, la retiró"
              disabled={busy}
              onConfirm={() => actIn("adolescent", { action: "adolescent", withdrawn: true })}
            />
          )}
        </>
      ) : (
        <>
          <p className={`text-sm font-semibold ${PENDING_TEXT}`}>
            {s.adolescent_withdrawn_on ? `Retiró su conformidad el ${dm(s.adolescent_withdrawn_on)}.` : "Todavía no dio su conformidad."}
          </p>
          {dto.can_edit && (
            <form onSubmit={register} className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor={dateId}>Fecha en que la dio</Label>
                <Input id={dateId} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-auto" />
              </div>
              <Button type="submit" size="sm" disabled={busy} className="h-9 rounded-full">Registrar conformidad</Button>
            </form>
          )}
          {formError && <p role="alert" className={ERROR_BOX}>{formError}</p>}
        </>
      )}
      {error}
    </Part>
  );
}

function Pause({ dto, busy, error, actIn }: PartProps & { actIn: ActIn }) {
  const s = dto.settings;
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<"" | "indicacion_profesional" | "judicial">("");
  const [formError, setFormError] = useState<string | null>(null);
  const reasonId = useId();

  async function pause(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!reason) { setFormError("Elegí el motivo."); return; }
    if (await actIn("pause", { action: "pause", reason })) { setAsking(false); setReason(""); }
  }

  return (
    <Part title="Pausa">
      {s.paused_at ? (
        <>
          <p className="text-sm font-semibold">
            En pausa desde {dm(s.paused_at)}{s.pause_reason ? ` · ${PAUSE_LABEL[s.pause_reason] ?? s.pause_reason}` : ""}
          </p>
          {dto.can_edit && (
            <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy}
              onClick={() => void actIn("pause", { action: "pause", reason: null })}>
              Quitar la pausa
            </Button>
          )}
        </>
      ) : !asking ? (
        <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy} onClick={() => setAsking(true)}>
          Pausar todo lo clínico
        </Button>
      ) : (
        <form onSubmit={pause} className="space-y-3 rounded-xl bg-muted p-3">
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Motivo</Label>
            <select id={reasonId} value={reason} className={selectClass} autoFocus
              onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="">Elegí el motivo</option>
              <option value="indicacion_profesional">Indicación profesional</option>
              <option value="judicial">Orden judicial</option>
            </select>
          </div>
          <p className="text-sm">Nadie de la familia va a ver nada clínico de {dto.patient.first_name} hasta que quites la pausa.</p>
          {formError && <p role="alert" className={ERROR_BOX}>{formError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy}
              onClick={() => { setAsking(false); setReason(""); setFormError(null); }}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" variant="destructive" disabled={busy}>Pausar</Button>
          </div>
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Si un adulto pide dejar de ver, lo desactiva él desde el portal: la pausa es solo por indicación profesional o judicial.
      </p>
      {error}
    </Part>
  );
}

function Blocks({ dto, busy, error, actIn, onDialog }: PartProps & { actIn: ActIn; onDialog: (d: DialogState) => void }) {
  return (
    <Part title="Bloqueo por orden judicial">
      {dto.guardians.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay adultos responsables cargados en la ficha.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {dto.guardians.map((g) => (
            <li key={g.guardian_id} className="space-y-1.5 py-3 text-sm first:pt-0 last:pb-0">
              <div>
                <span className="font-semibold">{g.name}</span>
                {g.relationship && <span className="text-xs text-muted-foreground"> · {g.relationship}</span>}
              </div>
              {g.block ? (
                <>
                  <p className="text-xs font-semibold text-[oklch(0.48_0.19_25)]">
                    Bloqueado · {BLOCK_REASON_LABEL[g.block.reason] ?? g.block.reason} · {dm(g.block.created_at)} por {g.block.created_by_email}
                  </p>
                  <ConfirmButton
                    label="Quitar bloqueo"
                    question={`¿Quitar el bloqueo de ${g.name}? Sus accesos no vuelven solos: si corresponde, invitalo de nuevo al portal.`}
                    confirmLabel="Sí, quitar el bloqueo"
                    disabled={busy}
                    onConfirm={() => actIn("block", { action: "unblock", block_id: g.block!.id })}
                  />
                </>
              ) : g.dni ? (
                <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={busy}
                  onClick={() => onDialog({ kind: "block", guardian: g })}>
                  Bloquear por orden judicial
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">Sin DNI en la ficha: no se puede bloquear</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {error}
    </Part>
  );
}

// Botón que pide confirmación en la misma página (sin window.confirm)
function ConfirmButton({ label, question, confirmLabel, disabled, onConfirm }: {
  label: string; question: string; confirmLabel: string; disabled: boolean; onConfirm: () => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (asking) cancelRef.current?.focus(); }, [asking]);

  if (!asking) {
    return (
      <Button type="button" size="sm" variant="outline" className={PILL_BTN} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div role="group" aria-label={label} className="space-y-2 rounded-xl bg-muted p-3 text-sm">
      <p>{question}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => setAsking(false)}>
          Cancelar
        </Button>
        <Button type="button" size="sm" variant="destructive" disabled={disabled}
          onClick={async () => { if (await onConfirm()) setAsking(false); }}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

// ── Diálogos ────────────────────────────────────────────────────────────────

type DialogProps = { busy: boolean; act: Act; onClose: () => void };

function DialogButtons({ busy, onClose, submit, destructive }: { busy: boolean; onClose: () => void; submit: string; destructive?: boolean }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy} className="rounded-full">
        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        {submit}
      </Button>
    </div>
  );
}

function VerifyDialog({ row, firstName, busy, act, onClose }: DialogProps & { row: StaffAccessRow; firstName: string }) {
  const rep = row.link_kind === "representante_legal";
  const today = todayKey();
  const [date, setDate] = useState(row.verified_in_person_on ?? today);
  const [docs, setDocs] = useState(!!row.parental_checked_on);
  const [error, setError] = useState<string | null>(null);
  const dateId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date || date > today) { setError("Indicá cuándo se vio el DNI en persona (no puede ser una fecha futura)."); return; }
    const message = await act({
      action: "verify_link",
      link_id: row.link_id,
      in_person_on: date,
      // La documentación se registra con la misma fecha (o se conserva la que ya estaba)
      ...(rep ? { parental_on: docs ? (row.parental_checked_on ?? date) : null } : {}),
    });
    if (message) { setError(message); return; }
    toast.success("Verificación guardada");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Verificar en persona</DialogTitle>
          <DialogDescription>
            Pedile el DNI a {row.name} y confirmá que es la persona de la cuenta del portal.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={dateId}>Fecha en que se vio el DNI</Label>
            <Input id={dateId} type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="h-10 w-auto" />
          </div>
          {rep && (
            <div className="space-y-1.5">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={docs} onChange={(e) => setDocs(e.target.checked)} />
                Vi la documentación que acredita la responsabilidad parental
              </label>
              <p className="text-xs text-muted-foreground">
                Por ejemplo, la partida de nacimiento de {firstName} o la designación del tutor/a.
                {!docs && " Sin esto, no va a ver la información de salud."}
              </p>
            </div>
          )}
          {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
          <DialogButtons busy={busy} onClose={onClose} submit="Guardar" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaperDialog({ row, files, busy, act, onClose }: DialogProps & { row: StaffAccessRow; files: StaffClinicalDTO["paper_files"] }) {
  const [fileId, setFileId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileSelectId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fileId) { setError("Elegí el formulario firmado."); return; }
    const message = await act({ action: "consent_paper", account_id: row.account_id, file_id: fileId });
    if (message) { setError(message); return; }
    toast.success("Aceptación en papel registrada");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Registrar aceptación en papel</DialogTitle>
          <DialogDescription>
            {row.name} firmó en papel el aviso para ver la información de salud en el portal.
          </DialogDescription>
        </DialogHeader>
        {files.length === 0 ? (
          <div className="space-y-4">
            <p className="rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm text-[oklch(0.42_0.1_70)]">
              Primero escaneá el formulario firmado y subilo en Adjuntos con el tipo «Consentimiento informado».
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={onClose}>Entendido</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={fileSelectId}>Formulario firmado (de Adjuntos)</Label>
              <select id={fileSelectId} value={fileId} onChange={(e) => setFileId(e.target.value)} className={selectClass}>
                <option value="">Elegí el archivo</option>
                {files.map((f) => <option key={f.id} value={f.id}>{f.file_name} · subido el {dm(f.created_at)}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">
                Tiene que ser el formulario del aviso vigente, firmado por {row.name}. Si no está en la lista, subilo en Adjuntos con el tipo «Consentimiento informado».
              </p>
            </div>
            {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
            <DialogButtons busy={busy} onClose={onClose} submit="Registrar" />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BlockDialog({ guardian, firstName, busy, act, onClose }: DialogProps & { guardian: StaffGuardianRow; firstName: string }) {
  const [reason, setReason] = useState<"orden_judicial" | "otro">("orden_judicial");
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const message = await act({ action: "block", guardian_id: guardian.guardian_id, reason });
    if (message) { setError(message); return; }
    toast.success(`${guardian.name} quedó bloqueado en el portal`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Bloquear por orden judicial</DialogTitle>
          <DialogDescription>
            {guardian.name}{guardian.relationship ? ` (${guardian.relationship})` : ""} deja de ver a {firstName} en el portal.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={reasonId}>Motivo</Label>
            <select id={reasonId} value={reason} className={selectClass}
              onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="orden_judicial">Orden judicial</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <p className="rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm text-[oklch(0.42_0.1_70)]">
            Se cortan sus accesos al portal para {firstName}, sus invitaciones pendientes y sus pedidos de turno abiertos (quedan cerrados sin turno, con la constancia). El bloqueo no cambia el teléfono de los recordatorios por WhatsApp: revisalo en la ficha.
          </p>
          {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
          <DialogButtons busy={busy} onClose={onClose} submit="Bloquear" destructive />
        </form>
      </DialogContent>
    </Dialog>
  );
}
