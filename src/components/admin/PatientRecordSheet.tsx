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
  Home, History, FileCheck2,
} from "lucide-react";
import { formatTime } from "@/lib/appointments";
import { Chip, Section, TextAreaField, TextField, selectClass } from "./fields";
import { ReportsSection } from "./PatientReports";
import { PatientHistory } from "./PatientHistory";
import { GuardiansSection } from "./GuardiansSection";
import { ClinicalFormsSection } from "./ClinicalFormsSection";
import { AttachmentsSection } from "./AttachmentsSection";
import { VoidButton, VoidedBanner, voidRecord } from "./voiding";
import { canEditClinical, type Staff } from "@/lib/staff";
import { LOCALITY_OPTIONS } from "@/lib/center";
import {
  CASE_STATUS_LABEL, CIE10_OPTIONS, CUD_LABEL, CONDITION_OPTIONS, ageFromBirth, PATIENT_TYPE_LABEL, REFERRAL_KIND_LABEL,
  REFERRAL_STATUS_LABEL, SPECIALTY_OPTIONS, THERAPY_MODE_LABEL, formatShortDate, fullName, normalizePatient, todayKey,
  type TherapyMode,
  type CaseStatus, type CudStatus, type Followup, type PatientRecord, type PatientType,
  type ProfessionalOption, type Referral, type ReferralKind, type ReferralStatus, type Report,
} from "@/lib/patients";

type PatientAppt = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  status: "pendiente" | "confirmado" | "cancelado";
  consultation_type: "primera_vez" | "seguimiento";
  modality: "presencial" | "telemedicina" | null;
  reason: string;
  professional_id: string | null;
  duration_minutes: number;
  attendance: "presente" | "ausente" | "justificado" | null;
  practice_number: number | null;
};

type Props = {
  patientId: string | null;
  professionals: ProfessionalOption[];
  onClose: () => void;
  /** Se llama al cerrar si hubo cambios (ficha, derivaciones o seguimiento) */
  onChanged: () => void;
  /** Usuario actual: Administración ve lo clínico pero no lo modifica */
  staff: Staff;
};

// Campos editables de la ficha (lo que se manda en el update)
const EDITABLE_FIELDS = [
  "first_name", "last_name", "dni", "age", "phone", "email", "patient_type", "notes",
  "case_status", "professional_id", "referred_by", "main_diagnosis", "other_conditions",
  "cud_status", "is_medicated", "medication", "has_health_insurance", "health_insurance", "school",
  "locality", "therapy_modes",
  // Fase 3
  "birth_date", "address", "school_shift", "school_grade",
  "lives_with", "siblings", "main_caregiver", "parents_dedication",
  "arrival_route", "stutter_onset_age", "stutter_onset_form", "stutter_situations",
  "previous_treatments", "family_history", "avoids_speaking", "frustration_communicating",
  "diagnosis_code", "consent_signed", "consent_date", "discharge_date", "discharge_notes",
] as const satisfies readonly (keyof PatientRecord)[];


export function PatientRecordSheet({ patientId, professionals, onClose, onChanged, staff }: Props) {
  const clinical = canEditClinical(staff.role);
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
        .select("id, appointment_date, appointment_time, status, consultation_type, modality, reason, professional_id, duration_minutes, attendance, practice_number")
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
      const rec = normalizePatient(p.data as PatientRecord);
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
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [key]: value };
      if (key === "birth_date") {
        const age = ageFromBirth(value as string | null);
        if (age !== null) next.age = age;
      }
      return next;
    });
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
    if (!draft.consent_signed) payload.consent_date = null;
    if (payload.diagnosis_code) payload.diagnosis_code = String(payload.diagnosis_code).toUpperCase();
    const { error: dbError } = await supabase.from("patients").update(payload).eq("id", draft.id);
    setSaving(false);
    if (dbError) {
      toast.error(dbError.code === "23505" ? "Ya existe otro paciente con ese DNI"
        : dbError.message?.includes("CLINICAL_ONLY") ? "Solo los profesionales pueden modificar los datos clínicos"
        : "No se pudo guardar la ficha");
      return;
    }
    const saved = normalizePatient({ ...draft, ...payload } as PatientRecord);
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
                  disabled={!clinical}
                  title={clinical ? undefined : "Solo los profesionales pueden cambiar el estado del caso"}
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
                  <TextField label="Fecha de nacimiento" type="date" value={draft.birth_date ?? ""}
                    onChange={(v) => set("birth_date", v || null)} />
                  <div className="space-y-1.5">
                    <Label htmlFor="f-edad">Edad</Label>
                    <Input id="f-edad" type="number" value={String(draft.age)} disabled={!!draft.birth_date}
                      title={draft.birth_date ? "Se calcula con la fecha de nacimiento" : undefined}
                      onChange={(e) => set("age", Number(e.target.value))} />
                  </div>
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
                  <TextField label="Domicilio" value={draft.address ?? ""}
                    onChange={(v) => set("address", v)} placeholder="Calle, número, barrio" />
                  <div className="space-y-1.5">
                    <Label htmlFor="locality">Localidad</Label>
                    <Input id="locality" list="ficha-locality-options" value={draft.locality ?? ""}
                      onChange={(e) => set("locality", e.target.value)} placeholder="Ej: San Miguel de Tucumán" />
                    <datalist id="ficha-locality-options">
                      {LOCALITY_OPTIONS.map((l) => <option key={l} value={l} />)}
                    </datalist>
                  </div>
                  <div className="sm:col-span-2">
                    <TextField label="Escuela / institución" value={draft.school ?? ""}
                      onChange={(v) => set("school", v)} placeholder="Ej: Escuela N° 123" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="school_shift">Turno</Label>
                    <select id="school_shift" value={draft.school_shift ?? ""} className={selectClass}
                      onChange={(e) => set("school_shift", (e.target.value || null) as PatientRecord["school_shift"])}>
                      <option value="">Sin dato</option>
                      <option value="mañana">Mañana</option>
                      <option value="tarde">Tarde</option>
                    </select>
                  </div>
                  <TextField label="Grado / sala" value={draft.school_grade ?? ""}
                    onChange={(v) => set("school_grade", v)} placeholder="Ej: 2do grado, sala de 5" />
                </div>
              </Section>

              <GuardiansSection patientId={draft.id} onChanged={() => { changed.current = true; }} />

              <Section icon={Home} title="Contexto familiar y convivencia">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="¿Con quién vive?" value={draft.lives_with ?? ""}
                    onChange={(v) => set("lives_with", v)} placeholder="Ej: mamá, abuela y hermano" />
                  <TextField label="Hermanos (cuántos, edades)" value={draft.siblings ?? ""}
                    onChange={(v) => set("siblings", v)} placeholder="Ej: 2 — 4 y 11 años" />
                  <TextField label="Principal cuidador" value={draft.main_caregiver ?? ""}
                    onChange={(v) => set("main_caregiver", v)} />
                  <TextField label="Dedicación de los padres" value={draft.parents_dedication ?? ""}
                    onChange={(v) => set("parents_dedication", v)} placeholder="Trabajo, horarios" />
                </div>
              </Section>

              <Section icon={Stethoscope} title="Información clínica">
                {!clinical && (
                  <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                    Solo lectura: los datos clínicos los modifican los profesionales.
                  </p>
                )}
                <fieldset disabled={!clinical} className="min-w-0 space-y-4 disabled:opacity-80">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="¿Quién sugiere la consulta?" value={draft.referred_by ?? ""}
                    onChange={(v) => set("referred_by", v)} placeholder="Ej: escuela, pediatra, consulta espontánea" />
                  <TextField label="¿Cómo llega al CIMT?" value={draft.arrival_route ?? ""}
                    onChange={(v) => set("arrival_route", v)} placeholder="Ej: lo vieron en redes, se lo contó otra familia" />
                  <div className="space-y-1.5">
                    <Label htmlFor="professional_id">Profesional a cargo</Label>
                    <select id="professional_id" value={draft.professional_id ?? ""} className={selectClass}
                      onChange={(e) => set("professional_id", e.target.value || null)}>
                      <option value="">Sin asignar</option>
                      {professionals.filter((p) => p.active !== false || p.id === draft.professional_id).map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="diagnosis_code">Diagnóstico CIE-10</Label>
                    <Input id="diagnosis_code" list="cie10-options" value={draft.diagnosis_code ?? ""}
                      onChange={(e) => set("diagnosis_code", e.target.value)} placeholder="Ej: F98.5" />
                    <datalist id="cie10-options">
                      {CIE10_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                    </datalist>
                  </div>
                  <div className="sm:col-span-2">
                    <TextAreaField label="Diagnóstico / motivo principal" value={draft.main_diagnosis ?? ""}
                      onChange={(v) => set("main_diagnosis", v)} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Terapia</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(THERAPY_MODE_LABEL) as TherapyMode[]).map((m) => (
                      <Chip key={m} active={draft.therapy_modes.includes(m)}
                        onClick={() => set("therapy_modes", draft.therapy_modes.includes(m)
                          ? draft.therapy_modes.filter((x) => x !== m)
                          : [...draft.therapy_modes, m])}>
                        {THERAPY_MODE_LABEL[m]}
                      </Chip>
                    ))}
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
                </fieldset>
              </Section>

              <Section icon={History} title="Antecedentes de tartamudez">
                <fieldset disabled={!clinical} className="min-w-0 space-y-4 disabled:opacity-80">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Edad de inicio" value={draft.stutter_onset_age ?? ""}
                      onChange={(v) => set("stutter_onset_age", v)} placeholder="Ej: 3 años" />
                    <TextField label="Forma de inicio" value={draft.stutter_onset_form ?? ""}
                      onChange={(v) => set("stutter_onset_form", v)} placeholder="Ej: repentina, gradual" />
                    <div className="sm:col-span-2">
                      <TextAreaField label="Situaciones donde aparece más" value={draft.stutter_situations ?? ""}
                        onChange={(v) => set("stutter_situations", v)} />
                    </div>
                    <TextAreaField label="Tratamientos previos o actuales" value={draft.previous_treatments ?? ""}
                      onChange={(v) => set("previous_treatments", v)} />
                    <TextAreaField label="Antecedentes familiares" value={draft.family_history ?? ""}
                      onChange={(v) => set("family_history", v)} placeholder="¿Alguien más en la familia tartamudea?" />
                  </div>
                  <YesNoField label="¿Evita hablar en algunas situaciones?" value={draft.avoids_speaking}
                    onChange={(v) => set("avoids_speaking", v)} />
                  <YesNoField label="¿Se frustra o angustia al comunicarse?" value={draft.frustration_communicating}
                    onChange={(v) => set("frustration_communicating", v)} />
                </fieldset>
              </Section>

              <ClinicalFormsSection
                patient={patient ?? draft}
                professionals={professionals}
                staff={staff}
                canEdit={clinical}
                onChanged={() => { changed.current = true; }}
              />

              <ReferralsSection
                patientId={draft.id}
                referrals={referrals}
                canEdit={clinical}
                staffEmail={staff.email}
                onChange={(r) => { setReferrals(r); changed.current = true; }}
              />

              <ReportsSection
                patient={patient ?? draft}
                professionals={professionals}
                reports={reports}
                canEdit={clinical}
                staff={staff}
                onChange={(r) => { setReports(r); changed.current = true; }}
              />

              <FollowupsSection
                patientId={draft.id}
                followups={followups}
                canEdit={clinical}
                staffEmail={staff.email}
                onChange={(f) => { setFollowups(f); changed.current = true; }}
              />

              <Section icon={CalendarDays} title="Turnos y asistencia">
                <AttendanceSummary appts={appts} />
                {appts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tiene turnos registrados. Se dan desde la pestaña Agenda.</p>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
                    {appts.map((a) => {
                      const pro = professionals.find((p) => p.id === a.professional_id);
                      return (
                        <li key={a.id} className={`p-3 text-sm ${a.status === "cancelado" ? "opacity-60" : ""}`}>
                          <div className="flex flex-wrap items-center gap-2 font-semibold">
                            {formatShortDate(a.appointment_date)} · {formatTime(a.appointment_time)} hs
                            {a.attendance && <AttendanceTag value={a.attendance} />}
                            {a.status === "cancelado" && <span className="text-xs font-semibold text-[color:var(--status-occupied)]">Cancelado</span>}
                            {a.practice_number && (
                              <span className="ml-auto text-xs font-normal text-muted-foreground">Práctica N° {String(a.practice_number).padStart(6, "0")}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {pro ? pro.name : "Sin profesional"} · {a.duration_minutes} min
                            {" · "}{a.consultation_type === "primera_vez" ? "1ra vez" : "seguimiento"}
                            {a.modality === "telemedicina" && " · telemedicina"}
                          </div>
                          {a.reason && a.reason !== "Sesión" && <p className="mt-1 text-muted-foreground">{a.reason}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>

              <Section icon={FileCheck2} title="Consentimiento y alta">
                <div className="space-y-3 rounded-2xl border border-border/60 p-4">
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-semibold">
                    <Checkbox checked={draft.consent_signed}
                      onCheckedChange={(v) => {
                        set("consent_signed", v === true);
                        if (v === true && !draft.consent_date) set("consent_date", todayKey());
                      }} />
                    Consentimiento informado firmado
                  </label>
                  {draft.consent_signed ? (
                    <div className="max-w-xs">
                      <TextField label="Fecha de firma" type="date" value={draft.consent_date ?? ""}
                        onChange={(v) => set("consent_date", v || null)} />
                    </div>
                  ) : (
                    <p className="text-xs text-[color:var(--status-pending)]">Falta el consentimiento firmado. Escanealo y subilo en Adjuntos.</p>
                  )}
                </div>
                <fieldset disabled={!clinical} className="grid min-w-0 gap-4 disabled:opacity-80 sm:grid-cols-[200px_1fr]">
                  <TextField label="Fecha de alta" type="date" value={draft.discharge_date ?? ""}
                    onChange={(v) => set("discharge_date", v || null)} />
                  <TextAreaField label="Motivo / observaciones del alta" value={draft.discharge_notes ?? ""}
                    onChange={(v) => set("discharge_notes", v)} />
                </fieldset>
              </Section>

              <AttachmentsSection patientId={draft.id} staff={staff} onChanged={() => { changed.current = true; }} />

              <PatientHistory key={draft.id} patientId={draft.id} professionals={professionals} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Asistencia (relevamiento, respuestas 7 y 34) ────────────────────────────

function AttendanceSummary({ appts }: { appts: PatientAppt[] }) {
  const present = appts.filter((a) => a.attendance === "presente").length;
  const absent = appts.filter((a) => a.attendance === "ausente").length;
  const justified = appts.filter((a) => a.attendance === "justificado").length;
  if (present + absent + justified === 0) return null;
  // Las ausencias justificadas no bajan el porcentaje
  const rate = present + absent > 0 ? Math.round((present / (present + absent)) * 100) : null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <MiniStat label="Sesiones" value={present} />
      <MiniStat label="Faltas" value={absent} tone={absent > 0 ? "bad" : undefined} />
      <MiniStat label="Justificadas" value={justified} />
      <MiniStat label="Asistencia" value={rate === null ? "—" : `${rate}%`} tone={rate !== null && rate < 70 ? "bad" : undefined} />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number | string; tone?: "bad" }) {
  return (
    <div className="rounded-xl border border-border/60 p-2 text-center">
      <div className={`text-xl font-extrabold ${tone === "bad" ? "text-[color:var(--status-occupied)]" : "text-[color:var(--primary-deep)]"}`}>{value}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function AttendanceTag({ value }: { value: "presente" | "ausente" | "justificado" }) {
  const style = value === "presente"
    ? "bg-[color:var(--status-available-bg)] text-[color:var(--status-available)]"
    : value === "ausente"
      ? "bg-[color:var(--status-occupied-bg)] text-[color:var(--status-occupied)]"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style}`}>
      {value === "justificado" ? "Justificado" : value}
    </span>
  );
}

// ─── Derivaciones e interconsultas ───────────────────────────────────────────

function ReferralsSection({ patientId, referrals, canEdit, staffEmail, onChange }: {
  patientId: string; referrals: Referral[]; canEdit: boolean; staffEmail: string; onChange: (r: Referral[]) => void;
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

  async function annul(id: string, reason: string) {
    const patch = await voidRecord("patient_referrals", id, reason, staffEmail);
    if (patch) onChange(referrals.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <Section
      icon={ArrowRightLeft}
      title="Derivaciones e interconsultas"
      action={canEdit && !adding && (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nueva
        </Button>
      )}
    >
      {adding && canEdit && (
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
          {referrals.map((r) => (
            <ReferralCard key={r.id} referral={r} canEdit={canEdit && !r.voided_at} onUpdate={update}
              onVoid={(reason) => annul(r.id, reason)} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ReferralCard({ referral: r, canEdit, onUpdate, onVoid }: {
  referral: Referral;
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<Pick<Referral, "status" | "outcome" | "registered">>) => Promise<boolean>;
  onVoid: (reason: string) => Promise<unknown>;
}) {
  const [outcome, setOutcome] = useState(r.outcome ?? "");
  const outcomeDirty = outcome.trim() !== (r.outcome ?? "");

  return (
    <li className={`rounded-2xl border border-border/60 p-4 ${r.voided_at ? "opacity-70" : ""}`}>
      <fieldset disabled={!canEdit} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[color:var(--primary-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--primary-deep)]">
              {REFERRAL_KIND_LABEL[r.kind]}
            </span>
            <span className={`font-bold ${r.voided_at ? "line-through" : ""}`}>{r.specialty}</span>
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
      </fieldset>
      <VoidedBanner item={r} />
      {canEdit && (
        <div className="mt-2 flex justify-end">
          <VoidButton what="la derivación" onConfirm={onVoid} />
        </div>
      )}
    </li>
  );
}

// ─── Seguimiento / evolución ─────────────────────────────────────────────────

function FollowupsSection({ patientId, followups, canEdit, staffEmail, onChange }: {
  patientId: string; followups: Followup[]; canEdit: boolean; staffEmail: string; onChange: (f: Followup[]) => void;
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

  async function annul(id: string, reason: string) {
    const patch = await voidRecord("patient_followups", id, reason, staffEmail);
    if (patch) onChange(followups.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  return (
    <Section icon={NotebookPen} title="Seguimiento / evolución">
      {canEdit && (
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
      )}

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
              <p className={`mt-1 whitespace-pre-wrap text-sm ${f.voided_at ? "text-muted-foreground line-through" : ""}`}>{f.note}</p>
              <VoidedBanner item={f} />
              {canEdit && !f.voided_at && <VoidButton what="la nota" onConfirm={(reason) => annul(f.id, reason)} />}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// ─── Sí / No / Sin dato ──────────────────────────────────────────────────────

function YesNoField({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        <Chip active={value === null} onClick={() => onChange(null)}>Sin dato</Chip>
        <Chip active={value === true} onClick={() => onChange(true)}>Sí</Chip>
        <Chip active={value === false} onClick={() => onChange(false)}>No</Chip>
      </div>
    </div>
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

function emptyToNull(v: unknown) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  return t === "" ? null : t;
}

function validate(p: PatientRecord): string | null {
  if (p.first_name.trim().length < 2 || p.last_name.trim().length < 2) return "Nombre y apellido son obligatorios";
  if (!/^\d{6,10}$/.test(p.dni.trim())) return "DNI inválido";
  if (p.birth_date && p.birth_date > todayKey()) return "La fecha de nacimiento no puede ser futura";
  if (!Number.isInteger(p.age) || p.age < 1 || p.age > 120) return "Edad inválida";
  if (p.discharge_date && p.discharge_date > todayKey()) return "La fecha de alta no puede ser futura";
  if (p.phone.trim().length < 6) return "Teléfono inválido";
  return null;
}

function sortByDateDesc<T extends { created_at: string }>(items: T[], key: keyof T): T[] {
  return [...items].sort((a, b) =>
    String(b[key]).localeCompare(String(a[key])) || b.created_at.localeCompare(a.created_at));
}
