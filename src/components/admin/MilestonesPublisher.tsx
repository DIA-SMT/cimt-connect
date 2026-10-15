import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { EyeOff, Globe, Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectClass } from "./fields";
import { todayKey } from "@/lib/patients";
import { computeStats, fmt1, milestonesDraftFrom, RESPONSE_GOAL_HOURS, type StatsData } from "@/lib/stats";
import {
  MONTHLY_KINDS, hasMilestones, milestonesError, monthYear,
  type MilestonesDraft, type MonthlyKind, type PublicMilestones,
} from "@/lib/milestones";

// Estadísticas → "Hitos de la landing" (solo Dirección). Propone los números
// con los datos del panel; Dirección los revisa, los corrige si hace falta y
// los publica. Nada llega a la landing sin este paso.

type NumKey = "patients_total" | "response_hours" | "wait_days" | "waiting_list" | "month_value";

export function MilestonesPublisher({ data }: { data: StatsData }) {
  const [current, setCurrent] = useState<PublicMilestones | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data: rows } = await supabase.from("public_milestones").select("*")
      .order("published_at", { ascending: false }).limit(1);
    setCurrent((rows as PublicMilestones[] | null)?.[0] ?? null);
  }
  useEffect(() => { load(); }, []);

  async function hide() {
    if (!window.confirm("¿Sacar los hitos de la landing? Se pueden volver a publicar cuando quieras.")) return;
    setBusy(true);
    const { error } = await supabase.from("public_milestones").insert({ hidden: true });
    setBusy(false);
    if (error) { toast.error("No se pudo ocultar"); return; }
    toast.success("Los hitos ya no se muestran en la landing");
    load();
  }

  const live = current && hasMilestones(current) ? current : null;

  return (
    <section className="rounded-2xl border-2 border-primary/30 bg-[color:var(--primary-soft)]/40 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Megaphone className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg font-bold text-[color:var(--primary-deep)]">Hitos de la landing</h2>
        <div className="ml-auto flex flex-wrap gap-2">
          {live && (
            <Button size="sm" variant="outline" onClick={hide} disabled={busy}>
              <EyeOff className="mr-1.5 h-3.5 w-3.5" /> Ocultar
            </Button>
          )}
          <Button size="sm" onClick={() => setEditing(true)} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            <Globe className="mr-1.5 h-3.5 w-3.5" /> Preparar publicación
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {current === undefined ? "Cargando…"
          : live ? `En la landing desde el ${new Date(live.published_at).toLocaleDateString("es-AR")}: ${summary(live)}.`
          : "Ahora la landing no muestra hitos. Prepará una publicación con los números del panel."}
      </p>
      {editing && <PublishDialog data={data} onClose={() => setEditing(false)} onPublished={() => { setEditing(false); load(); }} />}
    </section>
  );
}

function summary(m: PublicMilestones): string {
  return [
    m.patients_total !== null && `${m.patients_total} pacientes`,
    m.response_hours !== null && `respuesta en ${m.response_hours} hs`,
    m.wait_days !== null && `${m.wait_days} días de espera`,
    m.waiting_list !== null && `${m.waiting_list} en lista de espera`,
    m.month_value !== null && m.month && `${m.month_value} ${m.month_label} en ${monthYear(m.month)}`,
  ].filter(Boolean).join(" · ");
}

function PublishDialog({ data, onClose, onPublished }: { data: StatsData; onClose: () => void; onPublished: () => void }) {
  const [kind, setKind] = useState<MonthlyKind>("consultas");
  const proposal = useMemo(() => milestonesDraftFrom(data, todayKey(), kind), [data, kind]);
  const [draft, setDraft] = useState<MilestonesDraft>(proposal);
  const [saving, setSaving] = useState(false);

  // Al cambiar qué se cuenta en el mes, se recalcula solo ese dato
  useEffect(() => {
    setDraft((d) => ({ ...d, month_value: proposal.month_value, month_label: proposal.month_label }));
  }, [proposal]);

  // La medición real de la respuesta (últimos 6 meses), como referencia
  const measured = useMemo(() => {
    const t = todayKey();
    const [y, m, d] = t.split("-").map(Number);
    const from = new Date(y, m - 7, d);
    return computeStats(data, {
      start: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${String(from.getDate()).padStart(2, "0")}`,
      end: t,
    }).intake;
  }, [data]);

  const setNum = (k: NumKey, v: string) =>
    setDraft((d) => ({ ...d, [k]: v.trim() === "" ? null : Number(v) }));

  async function publish() {
    const err = milestonesError(draft);
    if (err) { toast.error(err); return; }
    setSaving(true);
    const { error } = await supabase.from("public_milestones").insert({
      ...draft,
      month_label: draft.month_label?.trim() || null,
      month: draft.month_value === null ? null : draft.month,
    });
    setSaving(false);
    if (error) { toast.error("No se pudo publicar"); return; }
    toast.success("Hitos publicados en la landing");
    onPublished();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Publicar hitos en la landing</DialogTitle>
          <DialogDescription>
            Los números vienen de las estadísticas del panel. Revisalos y corregilos si hace falta: se publican tal
            cual. Un campo vacío no se muestra.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField label="Pacientes atendidos" value={draft.patients_total} onChange={(v) => setNum("patients_total", v)}
              hint={`Fichas en el panel: ${proposal.patients_total}`} />
            <div className="space-y-1.5">
              <Label htmlFor="ms-since">Desde</Label>
              <Input id="ms-since" type="month" value={draft.patients_since?.slice(0, 7) ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, patients_since: e.target.value ? `${e.target.value}-01` : null }))} />
            </div>
            <NumField label="Horas máximas para responder" value={draft.response_hours} onChange={(v) => setNum("response_hours", v)}
              hint={measured.responseCount
                ? `Medido (6 meses): mediana ${fmt1(measured.responseMedianHours)} hs, ${measured.responseOnTimePct}% en ${RESPONSE_GOAL_HOURS} hs`
                : "Todavía no hay mediciones de respuesta"} />
            <NumField label="Días de espera hasta el primer turno" value={draft.wait_days} onChange={(v) => setNum("wait_days", v)}
              hint="Mediana de los últimos 6 meses" />
            <NumField label="Lista de espera" value={draft.waiting_list} onChange={(v) => setNum("waiting_list", v)}
              hint="Solicitudes en curso hoy" />
          </div>

          <div className="space-y-3 rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-[color:var(--primary-deep)]">Análisis mensual</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ms-kind">Dato del mes</Label>
                <select id="ms-kind" value={kind} onChange={(e) => setKind(e.target.value as MonthlyKind)} className={selectClass}>
                  {(Object.keys(MONTHLY_KINDS) as MonthlyKind[]).map((k) => <option key={k} value={k}>{MONTHLY_KINDS[k]}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ms-month">Mes</Label>
                <Input id="ms-month" type="month" value={draft.month?.slice(0, 7) ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, month: e.target.value ? `${e.target.value}-01` : null }))} />
              </div>
              <NumField label="Número" value={draft.month_value} onChange={(v) => setNum("month_value", v)}
                hint="Calculado para el mes cerrado anterior" />
              <div className="space-y-1.5">
                <Label htmlFor="ms-label">Texto</Label>
                <Input id="ms-label" maxLength={80} value={draft.month_label ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, month_label: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={publish} disabled={saving} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Publicar en la landing
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NumField({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (v: string) => void; hint?: string }) {
  const id = `ms-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={0} inputMode="numeric" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
