import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Phone, Plus, Star, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chip, Section, TextField } from "./fields";
import { GUARDIAN_RELATIONSHIPS, type Guardian } from "@/lib/patients";
import { PortalGuardianAccess } from "./portal/PortalGuardianAccess";

// Adultos responsables (relevamiento 21: "todos los datos de los adultos
// responsables para el acompañamiento de la terapia"). Datos de contacto:
// los carga todo el panel. No se borran: se quitan (active = false).

export function GuardiansSection({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [editing, setEditing] = useState<Guardian | "new" | null>(null);

  async function load() {
    const { data } = await supabase.from("patient_guardians").select("*").eq("patient_id", patientId).eq("active", true);
    setGuardians(((data ?? []) as Guardian[]).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [patientId]);

  async function remove(g: Guardian) {
    if (!window.confirm(`¿Quitar a ${g.full_name} de los adultos responsables? Queda registrado en el historial.`)) return;
    const { error } = await supabase.from("patient_guardians").update({ active: false }).eq("id", g.id);
    if (error) { toast.error("No se pudo quitar"); return; }
    onChanged();
    load();
  }

  return (
    <Section icon={UsersRound} title="Adultos responsables"
      action={<Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus className="mr-1 h-3.5 w-3.5" /> Agregar</Button>}>
      {guardians.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin adultos responsables cargados.</p>
      ) : (
        <ul className="space-y-2">
          {guardians.map((g) => (
            <li key={g.id} className="flex flex-wrap items-start justify-between gap-2 rounded-2xl border border-border/60 p-3 text-sm">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  {g.full_name}
                  {g.relationship && <span className="font-normal text-muted-foreground">· {g.relationship}</span>}
                  {g.is_primary && <span className="inline-flex items-center gap-0.5 text-xs text-[color:var(--primary-deep)]"><Star className="h-3 w-3" /> Contacto principal</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {g.phone && <a href={`tel:${g.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-foreground hover:underline"><Phone className="mr-0.5 inline h-3 w-3" />{g.phone}</a>}
                  {g.dni && ` · DNI ${g.dni}`}{g.email && ` · ${g.email}`}
                  {g.lives_with_patient === true && " · Convive"}{g.lives_with_patient === false && " · No convive"}
                </div>
                {g.notes && <p className="mt-1 text-xs">{g.notes}</p>}
                <PortalGuardianAccess guardian={g} patientId={patientId} />
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(g)}>Editar</Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => remove(g)}>Quitar</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <GuardianDialog patientId={patientId} guardian={editing === "new" ? null : editing}
          isFirst={guardians.length === 0}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); load(); }} />
      )}
    </Section>
  );
}

function GuardianDialog({ patientId, guardian, isFirst, onClose, onSaved }: {
  patientId: string; guardian: Guardian | null; isFirst: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    full_name: guardian?.full_name ?? "",
    relationship: guardian?.relationship ?? "",
    dni: guardian?.dni ?? "",
    phone: guardian?.phone ?? "",
    email: guardian?.email ?? "",
    lives_with_patient: guardian?.lives_with_patient ?? null as boolean | null,
    is_primary: guardian?.is_primary ?? isFirst,
    notes: guardian?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (form.full_name.trim().length < 3) { toast.error("Indicá el nombre y apellido"); return; }
    if (form.dni.trim() && !/^\d{6,10}$/.test(form.dni.trim())) { toast.error("DNI inválido"); return; }
    setSaving(true);
    const payload = {
      full_name: form.full_name.trim(),
      relationship: form.relationship.trim() || null,
      dni: form.dni.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      lives_with_patient: form.lives_with_patient,
      is_primary: form.is_primary,
      notes: form.notes.trim() || null,
    };
    // Un solo contacto principal por paciente
    if (form.is_primary) {
      await supabase.from("patient_guardians").update({ is_primary: false }).eq("patient_id", patientId).eq("is_primary", true);
    }
    const { error } = guardian
      ? await supabase.from("patient_guardians").update(payload).eq("id", guardian.id)
      : await supabase.from("patient_guardians").insert({ ...payload, patient_id: patientId });
    setSaving(false);
    if (error) { toast.error("No se pudo guardar"); return; }
    // La agenda y los recordatorios usan el contacto principal de la ficha
    if (form.is_primary) {
      await supabase.from("patients").update({ guardian_name: payload.full_name, guardian_phone: payload.phone }).eq("id", patientId);
    }
    toast.success("Adulto responsable guardado");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">
            {guardian ? "Editar adulto responsable" : "Agregar adulto responsable"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <TextField label="Nombre y apellido" value={form.full_name} onChange={(v) => set("full_name", v)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-rel">Vínculo</Label>
            <Input id="g-rel" list="g-rel-options" value={form.relationship} onChange={(e) => set("relationship", e.target.value)} />
            <datalist id="g-rel-options">{GUARDIAN_RELATIONSHIPS.map((r) => <option key={r} value={r} />)}</datalist>
          </div>
          <TextField label="DNI" value={form.dni} onChange={(v) => set("dni", v)} inputMode="numeric" />
          <TextField label="Teléfono" value={form.phone} onChange={(v) => set("phone", v)} inputMode="tel" />
          <TextField label="Email" value={form.email} onChange={(v) => set("email", v)} type="email" />
        </div>
        <div className="space-y-1.5">
          <Label>¿Convive con el paciente?</Label>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={form.lives_with_patient === null} onClick={() => set("lives_with_patient", null)}>Sin dato</Chip>
            <Chip active={form.lives_with_patient === true} onClick={() => set("lives_with_patient", true)}>Sí</Chip>
            <Chip active={form.lives_with_patient === false} onClick={() => set("lives_with_patient", false)}>No</Chip>
          </div>
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_primary} onChange={(e) => set("is_primary", e.target.checked)} />
          Contacto principal
        </label>
        <TextField label="Notas" value={form.notes} onChange={(v) => set("notes", v)} placeholder="Ej: solo puede después de las 14 hs" />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">Guardar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
