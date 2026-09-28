import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FileText, Loader2, Pencil, Plus, Printer } from "lucide-react";
import { Section, TextAreaField, TextField, selectClass } from "./fields";
import {
  PATIENT_TYPE_LABEL, formatShortDate, fullName, insuranceLabel, todayKey,
  type PatientRecord, type ProfessionalOption, type Report,
} from "@/lib/patients";

type ReportDraft = Pick<Report, "report_date" | "professional_id" | "diagnosis" | "progress" | "therapy_evolution">;

// Informes profesionales: diagnóstico, progreso y evolución de la terapia
export function ReportsSection({ patient, professionals, reports, onChange }: {
  patient: PatientRecord;
  professionals: ProfessionalOption[];
  reports: Report[];
  onChange: (r: Report[]) => void;
}) {
  // null = cerrado, "new" = informe nuevo, id = editando ese informe
  const [editing, setEditing] = useState<string | null>(null);

  function newDraft(): ReportDraft {
    return {
      report_date: todayKey(),
      professional_id: patient.professional_id ?? reports[0]?.professional_id ?? null,
      // Arranca con el último diagnóstico cargado, que suele repetirse entre informes
      diagnosis: reports[0]?.diagnosis ?? patient.main_diagnosis ?? "",
      progress: "",
      therapy_evolution: "",
    };
  }

  async function save(draft: ReportDraft): Promise<boolean> {
    const payload = {
      report_date: draft.report_date,
      professional_id: draft.professional_id || null,
      diagnosis: draft.diagnosis?.trim() || null,
      progress: draft.progress?.trim() || null,
      therapy_evolution: draft.therapy_evolution?.trim() || null,
    };
    if (!payload.diagnosis && !payload.progress && !payload.therapy_evolution) {
      toast.error("El informe está vacío");
      return false;
    }

    if (editing === "new") {
      const { data, error } = await supabase.from("patient_reports")
        .insert({ ...payload, patient_id: patient.id }).select().single();
      if (error || !data) { toast.error("No se pudo guardar el informe"); return false; }
      onChange(sortReports([data as Report, ...reports]));
    } else {
      const { error } = await supabase.from("patient_reports").update(payload).eq("id", editing);
      if (error) { toast.error("No se pudo guardar el informe"); return false; }
      onChange(sortReports(reports.map((r) => (r.id === editing ? { ...r, ...payload } : r))));
    }
    toast.success("Informe guardado");
    setEditing(null);
    return true;
  }

  const proById = new Map(professionals.map((p) => [p.id, p]));

  return (
    <Section
      icon={FileText}
      title="Informes profesionales"
      action={editing === null && (
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nuevo informe
        </Button>
      )}
    >
      {editing === "new" && (
        <ReportForm initial={newDraft()} professionals={professionals} onSave={save} onCancel={() => setEditing(null)} />
      )}

      {reports.length === 0 && editing !== "new" ? (
        <p className="text-sm text-muted-foreground">Todavía no hay informes profesionales.</p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) =>
            editing === r.id ? (
              <li key={r.id}>
                <ReportForm initial={r} professionals={professionals} onSave={save} onCancel={() => setEditing(null)} />
              </li>
            ) : (
              <li key={r.id} className="rounded-2xl border border-border/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-bold">Informe del {formatShortDate(r.report_date)}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.professional_id && proById.has(r.professional_id)
                        ? `${proById.get(r.professional_id)!.name} — ${proById.get(r.professional_id)!.specialty}`
                        : "Sin profesional asignado"}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={editing !== null} onClick={() => setEditing(r.id)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                    </Button>
                    <Button size="sm" variant="outline"
                      onClick={() => printReport(r, patient, r.professional_id ? proById.get(r.professional_id) : undefined)}>
                      <Printer className="mr-1 h-3.5 w-3.5" /> Imprimir
                    </Button>
                  </div>
                </div>
                <dl className="mt-3 space-y-2 text-sm">
                  <ReportField label="Diagnóstico" value={r.diagnosis} />
                  <ReportField label="Progreso" value={r.progress} />
                  <ReportField label="Evolución de la terapia" value={r.therapy_evolution} />
                </dl>
              </li>
            ),
          )}
        </ul>
      )}
    </Section>
  );
}

function ReportForm({ initial, professionals, onSave, onCancel }: {
  initial: ReportDraft;
  professionals: ProfessionalOption[];
  onSave: (d: ReportDraft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ReportDraft>(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ReportDraft>(k: K, v: ReportDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function submit() {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="space-y-4 rounded-2xl border border-primary/30 bg-[color:var(--primary-soft)]/40 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Fecha del informe" type="date" value={draft.report_date}
          onChange={(v) => set("report_date", v)} />
        <div className="space-y-1.5">
          <Label htmlFor="report_professional">Profesional</Label>
          <select id="report_professional" value={draft.professional_id ?? ""} className={selectClass}
            onChange={(e) => set("professional_id", e.target.value || null)}>
            <option value="">Sin asignar</option>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>
            ))}
          </select>
        </div>
      </div>
      <TextAreaField label="Diagnóstico" value={draft.diagnosis ?? ""} onChange={(v) => set("diagnosis", v)} />
      <TextAreaField label="Progreso" value={draft.progress ?? ""} onChange={(v) => set("progress", v)}
        placeholder="Logros y cambios observados en el período" />
      <TextAreaField label="Evolución de la terapia" value={draft.therapy_evolution ?? ""}
        onChange={(v) => set("therapy_evolution", v)}
        placeholder="Cómo viene el tratamiento, ajustes, próximos objetivos" />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
        <Button size="sm" onClick={submit} disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Guardar informe
        </Button>
      </div>
    </div>
  );
}

function ReportField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-foreground/85">{value}</dd>
    </div>
  );
}

function sortReports(reports: Report[]): Report[] {
  return [...reports].sort((a, b) =>
    b.report_date.localeCompare(a.report_date) || b.created_at.localeCompare(a.created_at));
}

// ─── Impresión ───────────────────────────────────────────────────────────────
// Abre el informe en una ventana aparte con formato de hoja A4 y lanza el
// diálogo de impresión (desde ahí también se puede guardar como PDF).

function printReport(r: Report, p: PatientRecord, pro: ProfessionalOption | undefined) {
  const esc = (s: string | null | undefined) =>
    (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const block = (title: string, value: string | null) =>
    value ? `<h2>${title}</h2><p>${esc(value)}</p>` : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Informe — ${esc(fullName(p))} — ${formatShortDate(r.report_date)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a2b3c; font-size: 12pt; line-height: 1.5; margin: 0; }
  header { border-bottom: 2px solid #1d4f7a; padding-bottom: 10px; margin-bottom: 18px; }
  header strong { font-size: 16pt; color: #1d4f7a; }
  header div { font-size: 10pt; color: #55657a; }
  h1 { font-size: 15pt; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 18px; font-size: 11pt; }
  td { padding: 4px 8px; border: 1px solid #d5dde6; vertical-align: top; }
  td:first-child { width: 32%; color: #55657a; }
  h2 { font-size: 12pt; color: #1d4f7a; margin: 18px 0 4px; text-transform: uppercase; letter-spacing: .04em; }
  p { margin: 0; white-space: pre-wrap; }
  .firma { margin-top: 70px; width: 60%; margin-left: auto; text-align: center; border-top: 1px solid #1a2b3c; padding-top: 6px; font-size: 11pt; }
  footer { margin-top: 40px; font-size: 9pt; color: #7a8899; text-align: center; }
  @media screen { body { max-width: 760px; margin: 32px auto; padding: 0 24px; } }
</style></head>
<body>
  <header>
    <strong>CIMT — Centro Integral Municipal de Tartamudez</strong>
    <div>Municipalidad de San Miguel de Tucumán · Catamarca 411 · cimt@smt.gob.ar</div>
  </header>
  <h1>Informe profesional</h1>
  <table>
    <tr><td>Paciente</td><td>${esc(fullName(p))}</td></tr>
    <tr><td>DNI</td><td>${esc(p.dni)}</td></tr>
    <tr><td>Edad</td><td>${p.age} años (${esc(PATIENT_TYPE_LABEL[p.patient_type])})</td></tr>
    <tr><td>Obra social</td><td>${esc(insuranceLabel(p))}</td></tr>
    <tr><td>Fecha del informe</td><td>${formatShortDate(r.report_date)}</td></tr>
  </table>
  ${block("Diagnóstico", r.diagnosis)}
  ${block("Progreso", r.progress)}
  ${block("Evolución de la terapia", r.therapy_evolution)}
  <div class="firma">${pro ? `${esc(pro.name)}<br>${esc(pro.specialty)}` : "Firma y sello del profesional"}</div>
  <footer>Documento de uso interno — contiene información de salud confidencial.</footer>
  <script>window.onload = () => { window.print(); };</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    toast.error("El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
