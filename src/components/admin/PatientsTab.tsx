import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Loader2, Pill, Plus, Search, ArrowRightLeft, ClipboardX } from "lucide-react";
import {
  CASE_STATUS_COLOR, CASE_STATUS_LABEL, PATIENT_TYPE_LABEL, exportPatientsCsv, formatShortDate,
  fullName, normalizePatient, type CaseStatus, type PatientRecord, type PatientStats, type PatientType, type ProfessionalOption,
} from "@/lib/patients";
import { LOCALITY_OPTIONS } from "@/lib/center";

type Props = {
  professionals: ProfessionalOption[];
  /** Cambia cuando se guarda una ficha, para recargar la lista */
  version: number;
  onOpen: (patientId: string) => void;
};

export function PatientsTab({ professionals, version, onOpen }: Props) {
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [stats, setStats] = useState<Map<string, PatientStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CaseStatus>("all");
  const [insuranceFilter, setInsuranceFilter] = useState<"all" | "con" | "sin">("all");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("patients").select("*").order("last_name", { ascending: true }),
      supabase.from("patient_referrals").select("patient_id, status, registered"),
      supabase.from("patient_followups").select("patient_id, note_date"),
      supabase.from("patient_reports").select("patient_id, report_date"),
    ]).then(([p, r, f, rep]) => {
      if (cancelled) return;
      if (p.error) toast.error("No se pudieron cargar los pacientes");
      setPatients(((p.data ?? []) as PatientRecord[]).map(normalizePatient));

      const map = new Map<string, PatientStats>();
      const get = (id: string) => {
        let st = map.get(id);
        if (!st) map.set(id, (st = { pendingReferrals: 0, unregisteredReferrals: 0, totalReferrals: 0 }));
        return st;
      };
      for (const row of (r.data ?? []) as { patient_id: string; status: string; registered: boolean }[]) {
        const st = get(row.patient_id);
        st.totalReferrals++;
        if (row.status === "pendiente") st.pendingReferrals++;
        if (!row.registered && row.status !== "cancelada") st.unregisteredReferrals++;
      }
      for (const row of (f.data ?? []) as { patient_id: string; note_date: string }[]) {
        const st = get(row.patient_id);
        if ((st.lastFollowup ?? "") < row.note_date) st.lastFollowup = row.note_date;
      }
      for (const row of (rep.data ?? []) as { patient_id: string; report_date: string }[]) {
        const st = get(row.patient_id);
        if ((st.lastReport ?? "") < row.report_date) st.lastReport = row.report_date;
      }
      setStats(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [version]);

  const counts = useMemo(() => {
    const c = new Map<CaseStatus, number>();
    for (const p of patients) c.set(p.case_status, (c.get(p.case_status) ?? 0) + 1);
    return c;
  }, [patients]);

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    return patients.filter((p) => {
      if (statusFilter !== "all" && p.case_status !== statusFilter) return false;
      if (insuranceFilter === "con" && p.has_health_insurance !== true) return false;
      if (insuranceFilter === "sin" && p.has_health_insurance !== false) return false;
      if (!q) return true;
      return normalizeText(`${p.first_name} ${p.last_name} ${p.dni} ${p.locality ?? ""}`).includes(q);
    });
  }, [patients, query, statusFilter, insuranceFilter]);

  const proName = useMemo(() => new Map(professionals.map((p) => [p.id, p.name])), [professionals]);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, DNI o localidad"
            aria-label="Buscar paciente" className="pl-9" />
        </div>
        <Button variant="outline" onClick={() => exportPatientsCsv(filtered, professionals, stats)}
          disabled={filtered.length === 0}>
          <Download className="mr-1.5 h-4 w-4" /> Exportar a Excel
        </Button>
        <Button onClick={() => setCreating(true)}
          className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
          <Plus className="mr-1.5 h-4 w-4" /> Nuevo paciente
        </Button>
      </div>

      {/* Filtro por estado del caso */}
      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
          Todos ({patients.length})
        </FilterChip>
        {(Object.keys(CASE_STATUS_LABEL) as CaseStatus[]).map((s) => (
          <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {CASE_STATUS_LABEL[s]} ({counts.get(s) ?? 0})
          </FilterChip>
        ))}
      </div>
      <div className="-mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-muted-foreground">Obra social:</span>
        <FilterChip active={insuranceFilter === "all"} onClick={() => setInsuranceFilter("all")}>Todas</FilterChip>
        <FilterChip active={insuranceFilter === "con"} onClick={() => setInsuranceFilter("con")}>
          Con obra social ({patients.filter((p) => p.has_health_insurance === true).length})
        </FilterChip>
        <FilterChip active={insuranceFilter === "sin"} onClick={() => setInsuranceFilter("sin")}>
          Sin obra social ({patients.filter((p) => p.has_health_insurance === false).length})
        </FilterChip>
      </div>

      {/* Planilla */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">No hay pacientes para mostrar.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.map((p) => {
              const st = stats.get(p.id);
              const pending = st?.pendingReferrals ?? 0;
              const unregistered = st?.unregisteredReferrals ?? 0;
              const last = st?.lastFollowup;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => onOpen(p.id)}
                    className="grid w-full gap-2 p-4 text-left transition-colors hover:bg-[color:var(--primary-soft)]/40 md:grid-cols-[1.4fr_1fr_auto] md:items-center md:gap-4 md:px-5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-foreground">{fullName(p)}</span>
                        <CaseBadge status={p.case_status} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        DNI {p.dni} · {p.age} años · {PATIENT_TYPE_LABEL[p.patient_type as PatientType]}
                        {p.locality && ` · ${p.locality}`}
                        {p.has_health_insurance !== null && ` · ${p.has_health_insurance ? p.health_insurance || "Con obra social" : "Sin obra social"}`}
                        {p.professional_id && proName.has(p.professional_id) && ` · ${proName.get(p.professional_id)}`}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {p.other_conditions.slice(0, 3).map((c) => (
                        <span key={c} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          {c}
                        </span>
                      ))}
                      {p.other_conditions.length > 3 && (
                        <span className="px-1 text-[11px] font-semibold text-muted-foreground">+{p.other_conditions.length - 3}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground md:justify-end">
                      {p.is_medicated && (
                        <span className="inline-flex items-center gap-1 font-semibold text-[color:var(--primary-deep)]" title="Viene medicado">
                          <Pill className="h-3.5 w-3.5" /> Medicado
                        </span>
                      )}
                      {pending > 0 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-[color:var(--status-pending)]">
                          <ArrowRightLeft className="h-3.5 w-3.5" /> {pending} pendiente{pending > 1 && "s"}
                        </span>
                      )}
                      {unregistered > 0 && (
                        <span className="inline-flex items-center gap-1 font-semibold text-[color:var(--status-occupied)]"
                          title="Derivaciones o interconsultas sin la casilla de registrada">
                          <ClipboardX className="h-3.5 w-3.5" /> {unregistered} sin registrar
                        </span>
                      )}
                      <span>{last ? `Últ. seguimiento ${formatShortDate(last)}` : "Sin seguimiento"}</span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <NewPatientDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => {
          setCreating(false);
          setPatients((prev) => [...prev, p].sort((a, b) => a.last_name.localeCompare(b.last_name)));
          onOpen(p.id);
        }}
      />
    </div>
  );
}

// Alta manual: pacientes que llegan derivados sin sacar turno online
function NewPatientDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (p: PatientRecord) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "").trim();
    const payload = {
      first_name: get("first_name"),
      last_name: get("last_name"),
      dni: get("dni"),
      age: Number(get("age")),
      phone: get("phone"),
      patient_type: get("patient_type") as PatientType,
      locality: get("locality") || null,
    };
    if (payload.first_name.length < 2 || payload.last_name.length < 2) { toast.error("Nombre y apellido son obligatorios"); return; }
    if (!/^\d{6,10}$/.test(payload.dni)) { toast.error("DNI inválido"); return; }
    if (!Number.isInteger(payload.age) || payload.age < 1 || payload.age > 120) { toast.error("Edad inválida"); return; }
    if (payload.phone.length < 6) { toast.error("Teléfono inválido"); return; }

    setSaving(true);
    const { data, error } = await supabase.from("patients").insert(payload).select().single();
    setSaving(false);
    if (error || !data) {
      toast.error(error?.code === "23505" ? "Ya existe un paciente con ese DNI" : "No se pudo crear el paciente");
      return;
    }
    toast.success("Paciente creado");
    onCreated(normalizePatient(data as PatientRecord));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Nuevo paciente</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="first_name" label="Nombre" />
            <Field name="last_name" label="Apellido" />
            <Field name="dni" label="DNI" inputMode="numeric" />
            <Field name="age" label="Edad" type="number" />
            <Field name="phone" label="Teléfono" inputMode="tel" />
            <div className="space-y-1.5">
              <Label htmlFor="np_locality">Localidad</Label>
              <Input id="np_locality" name="locality" list="np-locality-options" maxLength={80} />
              <datalist id="np-locality-options">
                {LOCALITY_OPTIONS.map((l) => <option key={l} value={l} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np_patient_type">Tipo de paciente</Label>
              <select id="np_patient_type" name="patient_type" required defaultValue=""
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <option value="" disabled>Seleccionar...</option>
                {(Object.keys(PATIENT_TYPE_LABEL) as PatientType[]).map((t) => (
                  <option key={t} value={t}>{PATIENT_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">El resto de la ficha se completa después de crearlo.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Crear y abrir ficha
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ name, label, type = "text", inputMode }: {
  name: string; label: string; type?: string; inputMode?: "numeric" | "tel";
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`np_${name}`}>{label}</Label>
      <Input id={`np_${name}`} name={name} type={type} inputMode={inputMode} required />
    </div>
  );
}

function CaseBadge({ status }: { status: CaseStatus }) {
  const c = CASE_STATUS_COLOR[status];
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ backgroundColor: c.bg, color: c.fg }}>
      {CASE_STATUS_LABEL[status]}
    </span>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// Búsqueda sin distinguir mayúsculas ni tildes
function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
