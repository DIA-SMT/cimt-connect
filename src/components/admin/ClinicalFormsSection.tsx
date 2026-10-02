import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ClipboardList, Loader2, Plus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chip, Section, selectClass } from "./fields";
import { VoidButton, VoidedBanner, voidRecord } from "./voiding";
import type { Staff } from "@/lib/staff";
import {
  PATIENT_TYPE_LABEL, cie10Label, formatShortDate, fullName, insuranceLabel, professionalSignature, todayKey,
  type Guardian, type PatientRecord, type ProfessionalOption, type Voidable,
} from "@/lib/patients";
import {
  TEMPLATES, countAnswered, detailKey, formatAnswer, getTemplate,
  type Answers, type FormTemplate, type Question,
} from "@/lib/clinicalForms";

// Historia clínica por área (fase 3). Hoy: Terapia Ocupacional. Los
// formularios de las otras áreas se suman en src/lib/clinicalForms.ts.

export type ClinicalForm = {
  id: string;
  patient_id: string;
  template_id: string;
  area: string;
  answers: Answers;
  status: "borrador" | "completo";
  form_date: string;
  professional_id: string | null;
  author_email: string | null;
  created_at: string;
} & Voidable;

type Props = {
  patient: PatientRecord;
  professionals: ProfessionalOption[];
  staff: Staff;
  canEdit: boolean;
  onChanged: () => void;
};

export function ClinicalFormsSection({ patient, professionals, staff, canEdit, onChanged }: Props) {
  const [forms, setForms] = useState<ClinicalForm[]>([]);
  const [open, setOpen] = useState<ClinicalForm | FormTemplate | null>(null);
  const [choosing, setChoosing] = useState(false);

  async function load() {
    const { data } = await supabase.from("clinical_forms").select("*").eq("patient_id", patient.id)
      .order("form_date", { ascending: false });
    setForms((data ?? []) as ClinicalForm[]);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [patient.id]);

  const proById = new Map(professionals.map((p) => [p.id, p]));

  async function annul(id: string, reason: string) {
    const patch = await voidRecord("clinical_forms", id, reason, staff.email);
    if (patch) { onChanged(); load(); }
  }

  return (
    <Section icon={ClipboardList} title="Historia clínica por área"
      action={canEdit && (
        <Button size="sm" variant="outline"
          onClick={() => (TEMPLATES.length === 1 ? setOpen(TEMPLATES[0]) : setChoosing(true))}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nueva historia
        </Button>
      )}>
      {forms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay historias clínicas por área. {canEdit && `Disponible: ${TEMPLATES.map((t) => t.area).join(", ")}.`}
        </p>
      ) : (
        <ul className="space-y-2">
          {forms.map((f) => {
            const t = getTemplate(f.template_id);
            const progress = t ? countAnswered(t, f.answers) : null;
            const pro = f.professional_id ? proById.get(f.professional_id) : undefined;
            return (
              <li key={f.id} className={`rounded-2xl border border-border/60 p-3 text-sm ${f.voided_at ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => setOpen(f)}>
                    <div className={`font-semibold ${f.voided_at ? "line-through" : ""}`}>{f.area} · {formatShortDate(f.form_date)}</div>
                    <div className="text-xs text-muted-foreground">
                      {f.status === "completo" ? "Completa" : "Borrador"}
                      {progress && ` · ${progress.answered} de ${progress.total} preguntas`}
                      {pro ? ` · ${pro.name}` : f.author_email ? ` · ${f.author_email}` : ""}
                    </div>
                  </button>
                  <div className="flex gap-1">
                    {t && !f.voided_at && (
                      <Button size="sm" variant="outline" onClick={() => printClinicalForm(t, f, patient, pro)}>
                        <Printer className="mr-1 h-3.5 w-3.5" /> Imprimir
                      </Button>
                    )}
                  </div>
                </div>
                <VoidedBanner item={f} />
                {canEdit && !f.voided_at && (
                  <div className="flex justify-end"><VoidButton what="la historia clínica" onConfirm={(reason) => annul(f.id, reason)} /></div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {choosing && (
        <Dialog open onOpenChange={(o) => { if (!o) setChoosing(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>¿De qué área?</DialogTitle></DialogHeader>
            <div className="space-y-2">
              {TEMPLATES.map((t) => (
                <Button key={t.id} variant="outline" className="w-full justify-start" onClick={() => { setChoosing(false); setOpen(t); }}>{t.area}</Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {open && (
        <ClinicalFormDialog
          patient={patient}
          professionals={professionals}
          staff={staff}
          canEdit={canEdit}
          source={open}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); onChanged(); load(); }}
        />
      )}
    </Section>
  );
}

// ─── Editor del formulario ───────────────────────────────────────────────────

function ClinicalFormDialog({ patient, professionals, staff, canEdit, source, onClose, onSaved }: {
  patient: PatientRecord;
  professionals: ProfessionalOption[];
  staff: Staff;
  canEdit: boolean;
  source: ClinicalForm | FormTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = "template_id" in source ? source : null;
  const template = existing ? getTemplate(existing.template_id) : (source as FormTemplate);
  const readOnly = !canEdit || !!existing?.voided_at;
  const [answers, setAnswers] = useState<Answers>(existing?.answers ?? {});
  const [formDate, setFormDate] = useState(existing?.form_date ?? todayKey());
  const [professionalId, setProfessionalId] = useState(existing?.professional_id ?? staff.professional_id ?? "");
  const [saving, setSaving] = useState(false);

  if (!template) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent><p>Este formulario ya no está disponible en el sistema.</p></DialogContent>
      </Dialog>
    );
  }

  const set: SetAnswer = (id, v) => setAnswers((a) => ({ ...a, [id]: typeof v === "function" ? v(a[id]) : v }));
  const progress = countAnswered(template, answers);

  async function save(status: "borrador" | "completo") {
    setSaving(true);
    const payload = { answers, status, form_date: formDate, professional_id: professionalId || null };
    const { error } = existing
      ? await supabase.from("clinical_forms").update(payload).eq("id", existing.id)
      : await supabase.from("clinical_forms").insert({ ...payload, patient_id: patient.id, template_id: template!.id, area: template!.area });
    setSaving(false);
    if (error) { toast.error("No se pudo guardar la historia clínica"); return; }
    toast.success(status === "completo" ? "Historia clínica completa" : "Borrador guardado");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[94vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">{template.title}</DialogTitle>
          <DialogDescription>
            {fullName(patient)} · DNI {patient.dni} · {progress.answered} de {progress.total} preguntas respondidas.
            Los datos personales, el contexto familiar y los antecedentes se toman de la ficha.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={readOnly} className="min-w-0 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cf-date">Fecha</Label>
              <Input id="cf-date" type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-pro">Profesional</Label>
              <select id="cf-pro" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className={selectClass}>
                <option value="">Sin asignar</option>
                {professionals.filter((p) => p.active !== false || p.id === professionalId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>
                ))}
              </select>
            </div>
          </div>

          {template.sections.map((section, i) => (
            <section key={section.id} className="space-y-4">
              <h3 className="border-b border-border/60 pb-1 font-display text-lg font-bold text-[color:var(--primary-deep)]">
                {i + 1}. {section.title}
              </h3>
              {section.questions.map((q) => <QuestionField key={q.id} q={q} answers={answers} set={set} />)}
            </section>
          ))}
        </fieldset>

        <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap justify-end gap-2 border-t border-border/60 bg-background/95 px-6 py-3 backdrop-blur">
          <Button variant="outline" onClick={onClose} disabled={saving}>{readOnly ? "Cerrar" : "Cancelar"}</Button>
          {!readOnly && (
            <>
              <Button variant="outline" onClick={() => save("borrador")} disabled={saving}>Guardar borrador</Button>
              <Button onClick={() => save("completo")} disabled={saving} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Guardar como completa
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type SetAnswer = (id: string, v: Answers[string] | ((prev: Answers[string]) => Answers[string])) => void;

function QuestionField({ q, answers, set }: { q: Question; answers: Answers; set: SetAnswer }) {
  const value = answers[q.id];
  if (q.type === "text" || q.type === "textarea") {
    const Comp = q.type === "text" ? Input : Textarea;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`q-${q.id}`}>{q.label}</Label>
        <Comp id={`q-${q.id}`} value={typeof value === "string" ? value : ""} placeholder={q.placeholder}
          {...(q.type === "textarea" ? { rows: 3 } : {})}
          onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(q.id, e.target.value)} />
      </div>
    );
  }
  if (q.type === "multi") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-1.5">
        <Label>{q.label}</Label>
        <div className="flex flex-wrap gap-1.5">
          {q.options.map((o) => (
            <Chip key={o} active={selected.includes(o)}
              onClick={() => set(q.id, (prev) => {
                const cur = Array.isArray(prev) ? prev : [];
                return cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o];
              })}>{o}</Chip>
          ))}
        </div>
      </div>
    );
  }
  if (q.type !== "single") return null;
  const detail = answers[detailKey(q.id)];
  return (
    <div className="space-y-1.5">
      <Label>{q.label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {q.options.map((o) => (
          <Chip key={o} active={value === o} onClick={() => set(q.id, value === o ? null : o)}>{o}</Chip>
        ))}
      </div>
      {q.detail && value === q.detail.when && (
        <Input aria-label={q.detail.label} placeholder={q.detail.label} value={typeof detail === "string" ? detail : ""}
          onChange={(e) => set(detailKey(q.id), e.target.value)} className="mt-1.5" />
      )}
    </div>
  );
}

// ─── Impresión: reproduce el formulario en papel con los datos de la ficha ──

async function printClinicalForm(t: FormTemplate, f: ClinicalForm, p: PatientRecord, pro: ProfessionalOption | undefined) {
  const { data } = await supabase.from("patient_guardians").select("*").eq("patient_id", p.id).eq("active", true);
  const guardians = (data ?? []) as Guardian[];
  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const row = (label: string, value: unknown) => `<tr><td class="l">${esc(label)}</td><td>${esc(value) || "—"}</td></tr>`;
  const yn = (b: boolean | null) => (b === true ? "Sí" : b === false ? "No" : "");
  const guardianText = guardians.map((g) => `${g.full_name}${g.relationship ? ` (${g.relationship})` : ""}${g.phone ? ` · ${g.phone}` : ""}`).join("; ");

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(t.title)} — ${esc(fullName(p))}</title>
<style>
  @page { size: A4; margin: 16mm; } html { color-scheme: light; background: #fff; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a2b3c; font-size: 10.5pt; margin: 0; }
  @media screen { body { max-width: 800px; margin: 24px auto; padding: 0 20px; } }
  header { border-bottom: 2px solid #1d4f7a; padding-bottom: 8px; margin-bottom: 12px; }
  header strong { font-size: 13pt; color: #1d4f7a; } header div { font-size: 9pt; color: #55657a; }
  h1 { font-size: 13.5pt; margin: 0 0 2px; } .sub { color: #55657a; margin: 0 0 10px; }
  h2 { font-size: 11pt; color: #1d4f7a; margin: 14px 0 5px; border-bottom: 1px solid #d5dde6; padding-bottom: 2px; }
  table { border-collapse: collapse; width: 100%; } td { border: 1px solid #d5dde6; padding: 3px 6px; vertical-align: top; }
  td.l { width: 38%; color: #55657a; } p.free { white-space: pre-wrap; border: 1px solid #d5dde6; padding: 6px; min-height: 40px; margin: 0; }
  .firma { margin-top: 50px; width: 55%; margin-left: auto; text-align: center; border-top: 1px solid #1a2b3c; padding-top: 5px; font-size: 10pt; }
  footer { margin-top: 18px; font-size: 8.5pt; color: #7a8899; text-align: center; }
</style></head><body>
<header><strong>Historia Clínica CIM de Tartamudez</strong><div>Municipalidad de San Miguel de Tucumán · Catamarca 411</div></header>
<h1>Área: ${esc(t.area)}</h1>
<p class="sub">Fecha: ${esc(formatShortDate(f.form_date))}${f.status === "borrador" ? " · BORRADOR" : ""}</p>

<h2>1) Datos personales</h2><table>
${row("Nombre", fullName(p))}${row("Edad", `${p.age} años (${PATIENT_TYPE_LABEL[p.patient_type]})`)}
${row("Diagnóstico", [cie10Label(p.diagnosis_code), p.main_diagnosis].filter(Boolean).join(" · "))}${row("DNI", p.dni)}
${row("Fecha de nacimiento", p.birth_date ? formatShortDate(p.birth_date) : "")}${row("Teléfono", p.phone)}
${row("Adultos responsables", guardianText)}${row("Dirección", [p.address, p.locality].filter(Boolean).join(", "))}
${row("Obra social", insuranceLabel(p))}${row("Escuela", p.school)}${row("Turno", p.school_shift === "mañana" ? "Mañana" : p.school_shift === "tarde" ? "Tarde" : "")}${row("Grado / sala", p.school_grade)}
</table>
<h2>2) Contexto familiar y convivencia</h2><table>
${row("¿Con quién vive?", p.lives_with)}${row("Hermanos (cuántos, edades)", p.siblings)}
${row("Principal cuidador", p.main_caregiver)}${row("Dedicación de los padres", p.parents_dedication)}
</table>
<h2>3) Motivo de consulta / ingreso al centro</h2><table>
${row("¿Cómo llega al CIMT?", p.arrival_route)}${row("¿Quién sugiere la consulta?", p.referred_by)}
</table>
<h2>4) Antecedentes de tartamudez</h2><table>
${row("Edad de inicio", p.stutter_onset_age)}${row("Forma de inicio", p.stutter_onset_form)}
${row("Situaciones donde aparece más", p.stutter_situations)}${row("Tratamientos previos o actuales", p.previous_treatments)}
${row("Antecedentes familiares", p.family_history)}${row("Evita hablar en algunas situaciones", yn(p.avoids_speaking))}
${row("Se frustra o angustia al comunicarse", yn(p.frustration_communicating))}
</table>
${t.sections.map((s, i) => `<h2>${i + 5}) ${esc(s.title)}</h2>${
    s.questions.length === 1 && s.questions[0].type === "textarea"
      ? `<p class="free">${esc(formatAnswer(s.questions[0], f.answers))}</p>`
      : `<table>${s.questions.map((q) => row(q.label, formatAnswer(q, f.answers))).join("")}</table>`
  }`).join("")}
<div class="firma">${pro ? `${esc(professionalSignature(pro))}<br>${esc(pro.specialty)}` : "Firma y sello del profesional"}</div>
<footer>Documento de uso interno — contiene información de salud confidencial.</footer>
<script>window.onload = () => window.print();</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) { toast.error("El navegador bloqueó la ventana. Permití las ventanas emergentes para este sitio."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
