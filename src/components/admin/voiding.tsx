import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatShortDate, type Voidable } from "@/lib/patients";

// Anular en lugar de borrar: la historia clínica se conserva (Ley 26.529).
// El registro queda visible, tachado, con quién lo anuló y por qué.

type VoidableTable = "patient_referrals" | "patient_followups" | "patient_reports" | "clinical_forms" | "patient_files";

export async function voidRecord(table: VoidableTable, id: string, reason: string, email: string): Promise<Voidable | null> {
  const patch = { voided_at: new Date().toISOString(), voided_by: email, void_reason: reason };
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) {
    toast.error("No se pudo anular");
    return null;
  }
  toast.success("Anulado");
  return patch;
}

export function VoidButton({ what, onConfirm }: { what: string; onConfirm: (reason: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    await onConfirm(reason.trim());
    setSaving(false);
    setOpen(false);
    setReason("");
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}
        className="h-8 text-muted-foreground hover:text-[color:var(--status-occupied)]">
        <Ban className="mr-1 h-3.5 w-3.5" /> Anular
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) setOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-[color:var(--primary-deep)]">Anular {what}</DialogTitle>
            <DialogDescription>
              No se borra: queda en la ficha marcado como anulado, con tu usuario, la fecha y el motivo.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Motivo de la anulación"
            placeholder="Motivo (ej: cargado por error en otro paciente)" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={confirm} disabled={saving || reason.trim().length < 3}
              className="bg-[color:var(--status-occupied)] text-white hover:opacity-90">
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Anular
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VoidedBanner({ item }: { item: Voidable }) {
  if (!item.voided_at) return null;
  return (
    <p className="mt-2 rounded-lg bg-[color:var(--status-occupied-bg)] px-3 py-1.5 text-xs text-[color:var(--status-occupied)]">
      <strong>Anulado</strong> el {formatShortDate(item.voided_at)}
      {item.voided_by && ` por ${item.voided_by}`}{item.void_reason && `: ${item.void_reason}`}
    </p>
  );
}
