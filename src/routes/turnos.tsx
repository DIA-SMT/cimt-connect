import { createFileRoute } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarDays, CheckCircle2, ClipboardList, Loader2, Phone, Users } from "lucide-react";
import { CENTER, LOCALITY_OPTIONS } from "@/lib/center";

// Solicitud de ingreso (fase 2). Según el relevamiento, el paciente no elige
// horario: el centro asigna terapia y profesional, el ingreso pasa por un taller
// informativo para familias (mensual) y los turnos se asignan por teléfono.

export const Route = createFileRoute("/turnos")({
  head: () => ({
    meta: [
      { title: "Solicitar turno — CIMT" },
      { name: "description", content: "Pedí tu ingreso al Centro Integral Municipal de Tartamudez. Atención gratuita desde los 2 años." },
      { property: "og:title", content: "Solicitar turno — CIMT" },
      { property: "og:description", content: "Completá la solicitud y el equipo del CIMT se comunica con vos." },
    ],
  }),
  component: TurnosPage,
});

const schema = z.object({
  first_name: z.string().trim().min(2, "Nombre requerido").max(60),
  last_name: z.string().trim().min(2, "Apellido requerido").max(60),
  dni: z.string().trim().regex(/^\d{6,10}$/, "DNI inválido"),
  age: z.coerce.number().int().min(CENTER.minAge, `El centro atiende a partir de los ${CENTER.minAge} años`).max(120),
  patient_type: z.enum(["niño", "adolescente", "adulto"]),
  guardian_name: z.string().trim().max(80),
  phone: z.string().trim().min(6, "Teléfono requerido").max(25),
  email: z.string().trim().email("Email inválido").max(120).optional().or(z.literal("")),
  locality: z.string().trim().min(2, "Indicá la localidad").max(80),
  preferred_modality: z.enum(["presencial", "telemedicina"]),
  referred_by: z.string().trim().max(120),
  reason: z.string().trim().min(5, "Contanos brevemente el motivo").max(800),
}).refine((d) => d.patient_type === "adulto" || d.guardian_name.length >= 3, {
  message: "Indicá el nombre del adulto responsable", path: ["guardian_name"],
});

type UpcomingWorkshop = { workshop_date: string; start_time: string; place: string };

function TurnosPage() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [patientType, setPatientType] = useState("");
  const [workshops, setWorkshops] = useState<UpcomingWorkshop[]>([]);

  useEffect(() => {
    supabase.rpc("get_upcoming_workshops").then(({ data }: { data: UpcomingWorkshop[] | null }) => setWorkshops(data ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = Object.fromEntries(
      ["first_name", "last_name", "dni", "age", "patient_type", "guardian_name", "phone", "email", "locality",
        "preferred_modality", "referred_by", "reason"].map((k) => [k, String(fd.get(k) ?? "")]),
    );
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Revisá los datos");
      return;
    }
    const d = parsed.data;
    setSubmitting(true);
    const { error } = await supabase.rpc("submit_intake_request", {
      p_first_name: d.first_name,
      p_last_name: d.last_name,
      p_dni: d.dni,
      p_age: d.age,
      p_patient_type: d.patient_type,
      p_phone: d.phone,
      p_email: d.email || null,
      p_guardian_name: d.patient_type === "adulto" ? null : d.guardian_name,
      p_locality: d.locality,
      p_preferred_modality: d.preferred_modality,
      p_referred_by: d.referred_by || null,
      p_reason: d.reason,
    });
    setSubmitting(false);
    if (error) {
      const code = error.message?.split(":")[0];
      toast.error(code === "ALREADY_REQUESTED" || code?.startsWith("INVALID_")
        ? error.message.slice(code.length + 1).trim()
        : "No se pudo enviar la solicitud. Probá de nuevo o llamanos.");
      return;
    }
    setDone(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <Layout>
      <section className="container mx-auto px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-4xl font-extrabold text-[color:var(--primary-deep)] sm:text-5xl">
            Solicitar turno
          </h1>
          <p className="mt-4 text-muted-foreground">
            La atención es gratuita, para niños, adolescentes y adultos desde los {CENTER.minAge} años.
            Completá la solicitud y el equipo del CIMT se comunica con vos.
          </p>
        </div>

        {/* Cómo sigue */}
        <ol className="mx-auto mt-10 grid max-w-4xl gap-4 md:grid-cols-3">
          <Step n={1} icon={ClipboardList} title="Completás la solicitud"
            text="Con los datos de la persona que consulta y el motivo." />
          <Step n={2} icon={Users} title="Taller informativo"
            text="Te llamamos para invitarte al taller para familias, que se hace una vez al mes." />
          <Step n={3} icon={CalendarDays} title="Turnos asignados"
            text="El equipo evalúa cada caso y te asigna los turnos con los profesionales que correspondan." />
        </ol>

        {workshops.length > 0 && (
          <p className="mx-auto mt-6 max-w-2xl rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-center text-sm text-[color:var(--primary-deep)]">
            <strong>Próximo taller para familias:</strong>{" "}
            {formatLong(workshops[0].workshop_date)} a las {workshops[0].start_time.slice(0, 5)} hs · {workshops[0].place}
          </p>
        )}

        <div className="mx-auto mt-10 max-w-2xl rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
          {done ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--status-available-bg)] text-[color:var(--status-available)]">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-2xl font-bold text-[color:var(--primary-deep)]">¡Solicitud enviada!</h2>
              <p className="mt-2 max-w-md text-muted-foreground">
                El equipo del CIMT te va a llamar al teléfono que dejaste para invitarte al próximo taller
                informativo y coordinar los turnos.
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                ¿Dudas? Llamá al <a href={CENTER.phoneHref} className="font-semibold text-foreground hover:underline">{CENTER.phoneDisplay}</a>
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <h2 className="font-display text-xl font-bold text-[color:var(--primary-deep)]">Datos de la persona que consulta</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Nombre" name="first_name" required />
                <Field label="Apellido" name="last_name" required />
                <Field label="DNI" name="dni" required inputMode="numeric" />
                <Field label="Edad" name="age" required type="number" min={CENTER.minAge} max={120} />
                <div className="space-y-1.5">
                  <Label htmlFor="patient_type">Es<span className="text-destructive"> *</span></Label>
                  <select id="patient_type" name="patient_type" required value={patientType}
                    onChange={(e) => setPatientType(e.target.value)} className={selectClass}>
                    <option value="" disabled>Seleccionar...</option>
                    <option value="niño">Niño/a</option>
                    <option value="adolescente">Adolescente</option>
                    <option value="adulto">Adulto</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="locality">Localidad<span className="text-destructive"> *</span></Label>
                  <Input id="locality" name="locality" required list="locality-options" maxLength={80}
                    placeholder="Ej: San Miguel de Tucumán" autoComplete="address-level2" />
                  <datalist id="locality-options">
                    {LOCALITY_OPTIONS.map((l) => <option key={l} value={l} />)}
                  </datalist>
                </div>
              </div>

              <h2 className="pt-2 font-display text-xl font-bold text-[color:var(--primary-deep)]">Contacto</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {patientType && patientType !== "adulto" && (
                  <div className="sm:col-span-2">
                    <Field label="Nombre del adulto responsable" name="guardian_name" required />
                  </div>
                )}
                {(!patientType || patientType === "adulto") && <input type="hidden" name="guardian_name" value="" />}
                <Field label="Teléfono" name="phone" required inputMode="tel" />
                <Field label="Email (opcional)" name="email" type="email" />
              </div>

              <h2 className="pt-2 font-display text-xl font-bold text-[color:var(--primary-deep)]">Consulta</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="preferred_modality">Modalidad preferida<span className="text-destructive"> *</span></Label>
                  <select id="preferred_modality" name="preferred_modality" required defaultValue="presencial" className={selectClass}>
                    <option value="presencial">Presencial (en el centro)</option>
                    <option value="telemedicina">Telemedicina (a distancia)</option>
                  </select>
                </div>
                <Field label="¿Quién lo deriva? (opcional)" name="referred_by" placeholder="Ej: escuela, pediatra" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reason">Motivo de la consulta<span className="text-destructive"> *</span></Label>
                <Textarea id="reason" name="reason" required maxLength={800} rows={4}
                  placeholder="Ej: Mi hijo de 6 años repite sílabas al empezar a hablar desde hace unos meses..." />
              </div>

              <div className="flex flex-col-reverse items-center justify-between gap-3 pt-2 sm:flex-row">
                <p className="text-xs text-muted-foreground">
                  <Phone className="mr-1 inline h-3.5 w-3.5" />
                  También podés pedirlo al {CENTER.phoneDisplay} (solo llamadas).
                </p>
                <Button type="submit" disabled={submitting}
                  className="w-full bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)] sm:w-auto">
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Enviar solicitud
                </Button>
              </div>
            </form>
          )}
        </div>
      </section>
    </Layout>
  );
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Step({ n, icon: Icon, title, text }: { n: number; icon: typeof Users; title: string; text: string }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-border/60 bg-background p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-primary">Paso {n}</div>
        <h3 className="font-bold text-[color:var(--primary-deep)]">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
      </div>
    </li>
  );
}

function Field({ label, name, required, type = "text", ...rest }: {
  label: string; name: string; required?: boolean; type?: string;
  inputMode?: "numeric" | "tel"; min?: number; max?: number; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}{required && <span className="text-destructive"> *</span>}</Label>
      <Input id={name} name={name} type={type} required={required} {...rest} />
    </div>
  );
}

function formatLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}
