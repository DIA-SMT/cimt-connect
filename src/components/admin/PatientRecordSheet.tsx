import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2, Save, User, Stethoscope, ArrowRightLeft, NotebookPen, CalendarDays, Plus, X,
} from "lucide-react";
import { formatTime } from "@/lib/appointments";
import { Chip, Section, TextAreaField, TextField, selectClass } from "./fields";
import { ReportsSection } from "./PatientReports";
import {
  CASE_STATUS_LABEL, CUD_LABEL, CONDITION_OPTIONS, PATIENT_TYPE_LABEL, REFERRAL_KIND_LABEL,
  REFERRAL_STATUS_LABEL, SPECIALTY_OPTIONS, formatShortDate, fullName, todayKey,
  type CaseStatus, type CudStatus, type Followup, type PatientRecord, type PatientType,
  type ProfessionalOption, type Referral, type ReferralKind, type ReferralStatus, type Report,
} from "@/lib/patients";

type PatientAppt = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: "pendiente" | "confirmado" | "cancelado";
  consultation_type: "primera_vez" | "seguimiento";
  reason: string;
};

type Props = {
  patientId: string | null;
  professionals: ProfessionalOption[];
  onClose: () => void;
  /** Se llama al cerrar si hubo cambios (ficha, derivaciones o seguimiento) */
  onChanged: () => void;
};

// Campos editables de la ficha (lo que se manda en el update)
const EDITABLE_FIELDS = [
  "first_name", "last_name", "dni", "age", "phone", "email", "patient_type", "notes",
  "case_status", "professional_id", "referred_by", "main_diagnosis", "other_conditions",
  "cud_status", "is_medicated", "medication", "has_health_insurance", "health_insurance", "school",
  "guardian_name", "guardian_phone",
] as const satisfies readonly (keyof PatientRecord)[];


export function PatientRecordSheet({ patientId, professionals, onClose, onChanged }: Props) {
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [draft, setDraft] = useState<PatientRecord | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [appts, setAppts] = useState<PatientAppt[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const changed = useRef(false);

  useEffect(() => {
    if (!patientId) return;
    changed.current = false;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from("patients").select("*").eq("id", patientId).single(),
      supabase.from("patient_referrals").select("*").eq("patient_id", patientId)
        .order("referral_date", { ascending: false }),
      supabase.from("patient_followups").select("*").eq("patient_id", patientId)
        .order("note_date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("appointments")
        .select("id, appointment_date, appointment_time, status, consultation_type, reason")
        .eq("patient_id", patientId)
        .order("appointment_date", { ascending: false }),
      supabase.from("patient_reports").select("*").eq("patient_id", patientId)
        .order("report_date", { ascending: false }).order("created_at", { ascending: false }),
    ]).then(([p, r, f, a, rep]) => {
      if (cancelled) return;
      if (p.error || !p.data) {
        toast.error("No se pudo cargar la ficha");
        onClose();
        return;
      }
      const rec = normalize(p.data as PatientRecord);
      setPatient(rec);
      setDraft(rec);
      setReferrals((r.data ?? []) as Referral[]);
      setFollowups((f.data ?? []) as Followup[]);
      setAppts((a.data ?? []) as PatientAppt[]);
      setReports((rep.data ?? []) as Report[]);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const dirty = !!patient && !!draft && EDITABLE_FIELDS.some(
    (k) => JSON.stringify(patient[k]) !== JSON.stringify(draft[k]),
  );

  function set<K extends keyof PatientRecord>(key: K, value: PatientRecord[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function requestClose() {
    if (dirty && !window.confirm("Hay cambios sin guardar en la ficha. ¿Cerrar igual?")) return;
    setPatient(null);
    setDraft(null);
    onClose();
    if (changed.current) onChanged();
  }

  async function save() {
    if (!draft) return;
    const error = validate(draft);
    if (error) { toast.error(error); return; }

    setSaving(true);
    const payload = Object.fromEntries(EDITABLE_FIELDS.map((k) => [k, emptyToNull(draft[k])]));
    if (draft.has_health_insurance !== true) payload.health_insurance = null;
    const { error: dbError } = await supabase.from("patients").update(payload).eq("id", draft.id);
    setSaving(false);
    if (dbError) {
      toast.error(dbError.code === "23505" ? "Ya existe otro paciente con ese DNI" : "No se pudo guardar la ficha");
      return;
    }
    const saved = normalize({ ...draft, ...payload } as PatientRecord);
    setPatient(saved);
    setDraft(saved);
    toast.success("Ficha guardada");
    changed.current = true;
  }

  return (
    <Sheet open={!!patientId} onOpenChange={(open) => { if (!open) requestClose(); }}>
      {/* El botón de cerrar por defecto se oculta: scrollea con el contenido. Va uno propio en el header fijo. */}
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl [&>button:last-child]:hidden">
        {loading || !draft ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>Ficha del paciente</SheetTitle>
              <SheetDescription>Cargando</SheetDescription>
            </SheetHeader>
            <div className="flex justify-center py-32">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          </>
        ) : (
          <>
            {/* Header fijo con nombre, estado y guardar */}
            <SheetHeader className="sticky top-0 z-10 border-b border-border/60 bg-background/95 px-5 py-4 pr-14 text-left backdrop-blur sm:px-6 sm:pr-14">
              <SheetClose asChild>
                <Button variant="ghost" size="icon" className="absolute right-3 top-3" aria-label="Cerrar ficha">
                  <X className="h-5 w-5" />
                </Button>
              </SheetClose>
              <SheetTitle className="font-display text-2xl font-extrabold text-[color:var(--primary-deep)]">
                {fullName(draft)}
              </SheetTitle>
              <SheetDescription>
                DNI {draft.dni} · {draft.age} años · {PATIENT_TYPE_LABEL[draft.patient_type]}
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <select
                  aria-label="Estado del caso"
                  value={draft.case_status}
                  onChange={(e) => set("case_status", e.target.value as CaseStatus)}
                  className={`${selectClass} h-9 w-auto`}
                >
                  {(Object.keys(CASE_STATUS_LABEL) as CaseStatus[]).map((s) => (
                    <option key={s} value={s}>{CASE_STATUS_LABEL[s]}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={!dirty || saving}
                  className="ml-auto bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]"
                >
                  {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                  {dirty ? "Guardar cambios" : "Guardado"}
                </Button>
              </div>
            </SheetHeader>

            <div className="space-y-8 px-5 py-6 sm:px-6">
              <Section icon={User} title="Datos personales y contacto">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Nombre" value={draft.first_name} onChange={(v) => set("first_name", v)} />
                  <TextField label="Apellido" value={draft.last_name} onChange={(v) => set("last_name", v)} />
                  <TextField label="DNI" value={draft.dni} onChange={(v) => set("dni", v)} inputMode="numeric" />
                  <TextField label="Edad" value={String(draft.age)} type="number"
                    onChange={(v) => set("age", Number(v))} />
                  <TextField label="Teléfono" value={draft.phone} onChange={(v) => set("phone", v)} inputMode="tel" />
                  <TextField label="Email" value={draft.email ?? ""} type="email" onChange={(v) => set("email", v)} />
                  <div className="space-y-1.5">
                    <Label htmlFor="patient_type">Tipo de paciente</Label>
                    <select id="patient_type" value={draft.patient_type} className={selectClass}
                      onChange={(e) => set("patient_type", e.target.value as PatientType)}>
                      {(Object.keys(PATIENT_TYPE_LABEL) as PatientType[]).map((t) => (
                        <option key={t} value={t}>{PATIENT_TYPE_LABEL[t]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Obra social</Label>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip active={draft.has_health_insurance === null} onClick={() => set("has_health_insurance", null)}>Sin dato</Chip>
                      <Chip active={draft.has_health_insurance === true} onClick={() => set("has_health_insurance", true)}>Con obra social</Chip>
                      <Chip active={draft.has_health_insurance === false} onClick={() => set("has_health_insurance", false)}>Sin obra social</Chip>
                    </div>
                    {draft.has_health_insurance && (
                      <Input aria-label="Nombre de la obra social" value={draft.health_insurance ?? ""}
                        onChange={(e) => set("health_insurance", e.target.value)}
                        placeholder="¿Cuál? Ej: Subsidio de Salud, PAMI, OSDE" className="mt-1.5" />
                    )}
                  </div>
                  <TextField label="Tutor / responsable" value={draft.guardian_name ?? ""}
                    onChange={(v) => set("guardian_name", v)} placeholder="Para menores de edad" />
                  <TextField label="Teléfono del tutor" value={draft.guardian_phone ?? ""}
                    onChange={(v) => set("guardian_phone", v)} inputMode="tel" />
                  <div className="sm:col-span-2">
                    <TextField label="Escolaridad / institución" value={draft.school ?? ""}
                      onChange={(v) => set("school", v)} placeholder="Ej: 1er grado, Escuela N° 123" />
                  </div>
                </div>
              </Section>

              <Section icon={Stethoscope} title="Información clínica">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Derivado al CIMT por" value={draft.referred_by ?? ""}
                    onChange={(v) => set("referred_by", v)} placeholder="Ej: escuela, pediatra, consulta espontánea" />
                  <div className="space-y-1.5">
                    <Label htmlFor="professional_id">Profesional a cargo</Label>
                    <select id="professional_id" value={draft.professional_id ?? ""} className={selectClass}
                      onChange={(e) => set("professional_id", e.target.value || null)}>
                      <option value="">Sin asignar</option>
                      {professionals.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <TextAreaField label="Diagnóstico / motivo principal" value={draft.main_diagnosis ?? ""}
                      onChange={(v) => set("main_diagnosis", v)} />
                  </div>
                </div>

                <ConditionsField value={draft.other_conditions} onChange={(v) => set("other_conditions", v)} />

                <div className="space-y-1.5">
                  <Label>Certificado Único de Discapacidad (CUD)</Label>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip active={draft.cud_status === null} onClick={() => set("cud_status", null)}>Sin dato</Chip>
                    {(Object.keys(CUD_LABEL) as CudStatus[]).map((c) => (
                      <Chip key={c} active={draft.cud_status === c} onClick={() => set("cud_status", c)}>
                        {CUD_LABEL[c]}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-border/60 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="is_medicated" className="font-semibold">¿Viene medicado?</Label>
                    <Switch id="is_medicated" checked={draft.is_medicated}
                      onCheckedChange={(v) => set("is_medicated", v)} />
                  </div>
                  {draft.is_medicated && (
                    <TextAreaField label="Medicación, dosis y quién la indica" value={draft.medication ?? ""}
                      onChange={(v) => set("medication", v)} placeholder="Ej: Risperidona 0,5 mg/día — Dr. Pérez (neuropediatra)" />
                  )}
                </div>

                <TextAreaField label="Notas generales" value={draft.notes ?? ""} onChange={(v) => set("notes", v)} />
              </Section>

              <ReferralsSection
                patientId={draft.id}
                referrals={referrals}
                onChange={(r) => { setReferrals(r); changed.current = true; }}
              />

              <ReportsSection
                patient={patient ?? draft}
                professionals={professionals}
                reports={reports}
                onChange={(r) => { setReports(r); changed.current = true; }}
              />

              <FollowupsSection
                patientId={draft.id}
                followups={followups}
                onChange={(f) => { setFollowups(f); changed.current = true; }}
              />

              <Section icon={CalendarDays} title="Turnos">
                {appts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tiene turnos registrados.</p>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
                    {appts.map((a) => (
                      <li key={a.id} className="p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2 font-semibold">
                          {formatShortDate(a.appointment_date)} · {formatTime(a.appointment_time)} hs
                          <span className="text-xs font-normal text-muted-foreground">
                            <span className="capitalize">{a.status}</span>
                            {" · "}{a.consultation_type === "primera_vez" ? "1ra vez" : "seguimiento"}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground">{a.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Derivaciones e interconsultas ───────────────────────────────────────────

function ReferralsSection({ patientId, referrals, onChange }: {
  patientId: string; referrals: Referral[]; onChange: (r: Referral[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyReferralForm);

  async function add() {
    if (!form.specialty.trim()) { toast.error("Indicá la especialidad"); return; }
    setSaving(true);
    const { data, error } = await supabase.from("patient_referrals").insert({
      patient_id: patientId,
      kind: form.kind,
      specialty: form.specialty.trim(),
      destination: form.destination.trim() || null,
      reason: form.reason.trim() || null,
      referral_date: form.referral_date,
    }).select().single();
    setSaving(false);
    if (error || !data) { toast.error("No se pudo guardar"); return; }
    onChange(sortByDateDesc([data as Referral, ...referrals], "referral_date"));
    setForm(emptyReferralForm());
    setAdding(false);
  }

  async function update(id: string, patch: Partial<Pick<Referral, "status" | "outcome" | "registered">>) {
    const { error } = await supabase.from("patient_referrals").update(patch).eq("id", id);
    if (error) { toast.error("No se pudo actualizar"); return false; }
    onChange(referrals.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    return true;
  }

  return (
    <Section
      icon={ArrowRightLeft}
      title="Derivaciones e interconsultas"
      action={!adding && (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nueva
        </Button>
      )}
    >
      {adding && (
        <div className="space-y-4 rounded-2xl border border-primary/30 bg-[color:var(--primary-soft)]/40 p-4">
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(REFERRAL_KIND_LABEL) as ReferralKind[]).map((k) => (
              <Chip key={k} active={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>
                {REFERRAL_KIND_LABEL[k]}
              </Chip>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ref_specialty">Especialidad</Label>
              <Input id="ref_specialty" list="specialty-options" value={form.specialty}
                onChange={(e) => setForm({ ...form, specialty: e.target.value })} />
              <datalist id="specialty-options">
                {SPECIALTY_OPTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <TextField label="Fecha" type="date" value={form.referral_date}
              onChange={(v) => setForm({ ...form, referral_date: v })} />
            <div className="sm:col-span-2">
              <TextField label="Institución / profesional de destino" value={form.destination}
                onChange={(v) => setForm({ ...form, destination: v })} placeholder="Ej: Hospital de Niños — Dra. Gómez" />
            </div>
            <div className="sm:col-span-2">
              <TextAreaField label="Motivo" value={form.reason} onChange={(v) => setForm({ ...form, reason: v })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" disabled={saving}
              onClick={() => { setAdding(false); setForm(emptyReferralForm()); }}>
              Cancelar
            </Button>
            <Button size="sm" onClick={add} disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      )}

      {referrals.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">Sin derivaciones ni interconsultas registradas.</p>
      ) : (
        <ul className="space-y-3">
          {referrals.map((r) => <ReferralCard key={r.id} referral={r} onUpdate={update} />)}
        </ul>
      )}
    </Section>
  );
}

function ReferralCard({ referral: r, onUpdate }: {
  referral: Referral;
  onUpdate: (id: string, patch: Partial<Pick<Referral, "status" | "outcome" | "registered">>) => Promise<boolean>;
}) {
  const [outcome, setOutcome] = useState(r.outcome ?? "");
  const outcomeDirty = outcome.trim() !== (r.outcome ?? "");

  return (
    <li className="rounded-2xl border border-border/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color:var(--primary-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--primary-deep)]">
              {REFERRAL_KIND_LABEL[r.kind]}
            </span>
            <span className="font-bold">{r.specialty}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatShortDate(r.referral_date)}{r.destination && ` · ${r.destination}`}
          </div>
        </div>
        <select
          aria-label="Estado de la derivación"
          value={r.status}
          onChange={(e) => onUpdate(r.id, { status: e.target.value as ReferralStatus })}
          className={`${selectClass} h-8 w-auto py-1 text-xs`}
        >
          {(Object.keys(REFERRAL_STATUS_LABEL) as ReferralStatus[]).map((s) => (
            <option key={s} value={s}>{REFERRAL_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      {r.reason && <p className="mt-2 text-sm text-foreground/80">{r.reason}</p>}
      <label
        htmlFor={`registered-${r.id}`}
        className={[
          "mt-3 flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold",
          r.registered
            ? "border-[color:var(--status-available)]/40 bg-[color:var(--status-available-bg)] text-[color:var(--status-available)]"
            : "border-[color:var(--status-pending)]/40 bg-[color:var(--status-pending-bg)] text-[color:var(--status-pending)]",
        ].join(" ")}
      >
        <Checkbox id={`registered-${r.id}`} checked={r.registered}
          onCheckedChange={(v) => onUpdate(r.id, { registered: v === true })} />
        {REFERRAL_KIND_LABEL[r.kind]} registrada
      </label>
      <div className="mt-3 space-y-1.5">
        <Label htmlFor={`outcome-${r.id}`} className="text-xs text-muted-foreground">Respuesta / resultado</Label>
        <Textarea id={`outcome-${r.id}`} rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)}
          placeholder="Qué respondió el profesional, indicaciones, próximos pasos..." />
        {outcomeDirty && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => onUpdate(r.id, { outcome: outcome.trim() || null })}>
              Guardar respuesta
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

// ─── Seguimiento / evolución ─────────────────────────────────────────────────

function FollowupsSection({ patientId, followups, onChange }: {
  patientId: string; followups: Followup[]; onChange: (f: Followup[]) => void;
}) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayKey);
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!note.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from("patient_followups")
      .insert({ patient_id: patientId, note: note.trim(), note_date: date })
      .select().single();
    setSaving(false);
    if (error || !data) { toast.error("No se pudo guardar la nota"); return; }
    onChange(sortByDateDesc([data as Followup, ...followups], "note_date"));
    setNote("");
    setDate(todayKey());
  }

  return (
    <Section icon={NotebookPen} title="Seguimiento / evolución">
      <div className="space-y-3 rounded-2xl border border-border/60 p-4">
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
          aria-label="Nueva nota de seguimiento"
          placeholder="Ej: Sesión de evaluación. Se observa... Se indica interconsulta con neurología." />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            aria-label="Fecha de la nota" className="h-9 w-auto" />
          <Button size="sm" onClick={add} disabled={saving || !note.trim()}
            className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Agregar nota
          </Button>
        </div>
      </div>

      {followups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay notas de seguimiento.</p>
      ) : (
        <ol className="relative space-y-4 border-l-2 border-[color:var(--primary-soft)] pl-5">
          {followups.map((f) => (
            <li key={f.id} className="relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-background bg-primary" />
              <div className="text-xs font-semibold text-[color:var(--primary-deep)]">
                {formatShortDate(f.note_date)}
                {f.author_email && <span className="font-normal text-muted-foreground"> · {f.author_email}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{f.note}</p>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// ─── Otras condiciones (chips + texto libre) ─────────────────────────────────

function ConditionsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [custom, setCustom] = useState("");
  const options = [...CONDITION_OPTIONS, ...value.filter((v) => !(CONDITION_OPTIONS as readonly string[]).includes(v))];

  function toggle(c: string) {
    onChange(value.includes(c) ? value.filter((v) => v !== c) : [...value, c]);
  }

  function addCustom() {
    const c = custom.trim();
    if (c && !value.includes(c)) onChange([...value, c]);
    setCustom("");
  }

  return (
    <div className="space-y-1.5">
      <Label>Otras condiciones / discapacidades</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((c) => (
          <Chip key={c} active={value.includes(c)} onClick={() => toggle(c)}>{c}</Chip>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Agregar otra..."
          aria-label="Agregar otra condición"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }}
          className="h-9" />
        <Button type="button" size="sm" variant="outline" onClick={addCustom} disabled={!custom.trim()}>
          Agregar
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyReferralForm() {
  return {
    kind: "interconsulta" as ReferralKind,
    specialty: "",
    destination: "",
    reason: "",
    referral_date: todayKey(),
  };
}

// La base puede devolver null en columnas nuevas de filas viejas
function normalize(p: PatientRecord): PatientRecord {
  return {
    ...p,
    other_conditions: p.other_conditions ?? [],
    is_medicated: !!p.is_medicated,
    has_health_insurance: p.has_health_insurance ?? null,
  };
}

function emptyToNull(v: unknown) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
}

function validate(p: PatientRecord): string | null {
  if (p.first_name.trim().length < 2 || p.last_name.trim().length < 2) return "Nombre y apellido son obligatorios";
  if (!/^\d{6,10}$/.test(p.dni.trim())) return "DNI inválido";
  if (!Number.isInteger(p.age) || p.age < 1 || p.age > 120) return "Edad inválida";
  if (p.phone.trim().length < 6) return "Teléfono inválido";
  return null;
}

function sortByDateDesc<T extends { created_at: string }>(items: T[], key: keyof T): T[] {
  return [...items].sort((a, b) =>
    String(b[key]).localeCompare(String(a[key])) || b.created_at.localeCompare(a.created_at));
}
