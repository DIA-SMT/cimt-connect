import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { WEEKDAYS } from "@/lib/apptRequestRules";
import { MAX_RANGES_PER_DAY, WEEKDAY_NAME, type WeeklyHours, hoursProblem, hoursSummary, parseWeeklyHours } from "@/lib/workHours";

// Horario semanal de un profesional (script 36). Lo usan «Mi perfil» y el
// diálogo que Administración y Dirección abren desde la agenda.

const DEFAULT_RANGE = { start: "08:00", end: "12:00" };

export function HoursEditor({ value, onChange, idPrefix = "h" }: {
  value: WeeklyHours;
  onChange: (next: WeeklyHours) => void;
  idPrefix?: string;
}) {
  const problem = hoursProblem(value);
  const setDay = (d: (typeof WEEKDAYS)[number], ranges: { start: string; end: string }[] | undefined) => {
    const next = { ...value };
    if (ranges?.length) next[d] = ranges; else delete next[d];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {WEEKDAYS.map((d) => {
        const ranges = value[d] ?? [];
        const on = ranges.length > 0;
        return (
          <div key={d} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${on ? "border-primary/30 bg-[color:var(--primary-soft)]/40" : "border-border/60"}`}>
            <label className="flex w-28 shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={on} className="h-4 w-4 accent-[color:var(--primary)]"
                onChange={(e) => setDay(d, e.target.checked ? [DEFAULT_RANGE] : undefined)} />
              {WEEKDAY_NAME[d]}
            </label>
            {!on && <span className="text-xs text-muted-foreground">No atiende</span>}
            {ranges.map((r, i) => (
              <div key={i} className="flex items-center gap-1">
                <Input type="time" step={900} value={r.start} aria-label={`${WEEKDAY_NAME[d]}: desde`} id={`${idPrefix}-${d}-${i}-s`}
                  className="h-8 w-[6.5rem] px-2 text-sm"
                  onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                <span className="text-xs text-muted-foreground">a</span>
                <Input type="time" step={900} value={r.end} aria-label={`${WEEKDAY_NAME[d]}: hasta`} id={`${idPrefix}-${d}-${i}-e`}
                  className="h-8 w-[6.5rem] px-2 text-sm"
                  onChange={(e) => setDay(d, ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                {ranges.length > 1 && (
                  <button type="button" aria-label="Quitar esta franja" className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                    onClick={() => setDay(d, ranges.filter((_, j) => j !== i))}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {on && ranges.length < MAX_RANGES_PER_DAY && (
              <button type="button" className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-primary hover:bg-[color:var(--primary-soft)]"
                onClick={() => setDay(d, [...ranges, { start: "14:00", end: "18:00" }])}>
                <Plus className="h-3.5 w-3.5" /> Otra franja
              </button>
            )}
          </div>
        );
      })}
      {problem && <p role="alert" className="text-xs font-semibold text-destructive">{problem}</p>}
    </div>
  );
}

/** Guarda el horario (set_professional_hours). Devuelve si salió bien. */
export async function saveHours(professionalId: string, hours: WeeklyHours): Promise<boolean> {
  const problem = hoursProblem(hours);
  if (problem) { toast.error(problem); return false; }
  const { error } = await supabase.rpc("set_professional_hours", {
    p_professional: professionalId,
    p_hours: Object.keys(hours).length ? hours : null,
  });
  if (error) {
    const msg = String(error.message ?? "");
    toast.error(/^(NOT_ALLOWED|INVALID_HOURS|NOT_FOUND):/.test(msg) ? msg.slice(msg.indexOf(":") + 1).trim() : "No se pudo guardar el horario");
    return false;
  }
  return true;
}

// Desde la agenda (Administración y Dirección)
export function HoursDialog({ professional, onClose, onSaved }: {
  professional: { id: string; name: string; weekly_hours?: unknown } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hours, setHours] = useState<WeeklyHours>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setHours(parseWeeklyHours(professional?.weekly_hours) ?? {}); }, [professional]);

  async function save() {
    if (!professional) return;
    setSaving(true);
    const ok = await saveHours(professional.id, hours);
    setSaving(false);
    if (ok) { toast.success("Horario guardado"); onSaved(); onClose(); }
  }

  return (
    <Dialog open={!!professional} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Horario de {professional?.name}</DialogTitle>
          <DialogDescription>
            Los días y horarios en que atiende. La agenda pinta en gris el resto y avisa si se da un turno fuera de horario.
          </DialogDescription>
        </DialogHeader>
        <HoursEditor value={hours} onChange={setHours} idPrefix="hd" />
        {hoursSummary(hours) && <p className="text-xs text-muted-foreground">{hoursSummary(hours)}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar horario
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
