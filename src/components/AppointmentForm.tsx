import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2 } from "lucide-react";

const schema = z.object({
  first_name: z.string().trim().min(2, "Nombre requerido").max(60),
  last_name: z.string().trim().min(2, "Apellido requerido").max(60),
  dni: z.string().trim().regex(/^\d{6,10}$/, "DNI inválido"),
  age: z.coerce.number().int().min(1).max(120),
  phone: z.string().trim().min(6, "Teléfono requerido").max(25),
  email: z.string().trim().email("Email inválido").max(120).optional().or(z.literal("")),
  patient_type: z.enum(["niño", "adolescente", "adulto"]),
  consultation_type: z.enum(["primera_vez", "seguimiento"]),
  reason: z.string().trim().min(5, "Indicá brevemente el motivo").max(500),
});

type Props = {
  date: string;
  time: string;
  onSuccess: () => void;
  onCancel: () => void;
};

export function AppointmentForm({ date, time, onSuccess, onCancel }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = {
      first_name: fd.get("first_name") as string,
      last_name: fd.get("last_name") as string,
      dni: fd.get("dni") as string,
      age: fd.get("age") as string,
      phone: fd.get("phone") as string,
      email: (fd.get("email") as string) || "",
      patient_type: fd.get("patient_type") as "niño" | "adolescente" | "adulto",
      consultation_type: fd.get("consultation_type") as "primera_vez" | "seguimiento",
      reason: fd.get("reason") as string,
    };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Datos inválidos");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("appointments").insert({
      ...parsed.data,
      email: parsed.data.email || null,
      appointment_date: date,
      appointment_time: time,
      status: "pendiente",
    });
    setSubmitting(false);
    if (error) {
      toast.error("No se pudo guardar la solicitud. Intentá nuevamente.");
      return;
    }
    setDone(true);
    toast.success("¡Solicitud enviada! Te contactaremos para confirmar.");
    setTimeout(onSuccess, 1800);
  }

  if (done) {
    return (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--status-available-bg)] text-[color:var(--status-available)]">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h3 className="mt-4 text-2xl font-bold text-[color:var(--primary-deep)]">¡Solicitud enviada!</h3>
        <p className="mt-2 max-w-sm text-muted-foreground">
          Tu turno quedó <strong>pendiente de confirmación</strong>. El equipo del CIMT se
          comunicará a la brevedad.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-sm">
        <span className="font-semibold text-[color:var(--primary-deep)]">Turno solicitado:</span>{" "}
        <span className="text-foreground">{formatLongDate(date)} a las {time} hs</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" name="first_name" required />
        <Field label="Apellido" name="last_name" required />
        <Field label="DNI" name="dni" required inputMode="numeric" />
        <Field label="Edad" name="age" required type="number" min={1} max={120} />
        <Field label="Teléfono" name="phone" required inputMode="tel" />
        <Field label="Email (opcional)" name="email" type="email" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Tipo de paciente" name="patient_type" options={[
          { value: "niño", label: "Niño/a" },
          { value: "adolescente", label: "Adolescente" },
          { value: "adulto", label: "Adulto" },
        ]} />
        <SelectField label="Tipo de consulta" name="consultation_type" options={[
          { value: "primera_vez", label: "Primera vez" },
          { value: "seguimiento", label: "Seguimiento" },
        ]} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reason">Motivo breve de consulta</Label>
        <Textarea id="reason" name="reason" required maxLength={500} rows={3}
          placeholder="Ej: Mi hijo de 6 años presenta repeticiones al hablar..." />
      </div>

      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={submitting}
          className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Confirmar solicitud
        </Button>
      </div>
    </form>
  );
}

function Field({ label, name, required, type = "text", ...rest }: {
  label: string; name: string; required?: boolean; type?: string;
  inputMode?: "numeric" | "tel"; min?: number; max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      <Input id={name} name={name} type={type} required={required} {...rest} />
    </div>
  );
}

function SelectField({ label, name, options }: {
  label: string; name: string; options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label} <span className="text-destructive">*</span></Label>
      <select id={name} name={name} required defaultValue=""
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <option value="" disabled>Seleccionar...</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function formatLongDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}