import { createFileRoute } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Baby, CalendarDays, CheckCircle2, ClipboardList, ListChecks, Loader2, Phone, UserRound, Users } from "lucide-react";
import { CENTER, HOME_PROVINCE, LOCALITY_OPTIONS, PROVINCES } from "@/lib/center";
import {
  ADULT_AGE, CONSENT_POINTS, CONSENT_TITLE, GUARDIAN_RELATIONSHIP_LABEL, parseIntake, type IntakeFor,
} from "@/lib/intake";
import { RequirementsList } from "@/components/Requirements";

// Solicitud de ingreso (fase 2). Según el relevamiento, el paciente no elige
// horario: el centro asigna terapia y profesional, el ingreso pasa por un taller
// informativo para familias (mensual) y los turnos se asignan por teléfono.
// Si es para un menor, la pide su adulto responsable: primero sus datos,
// después los del paciente y al final el consentimiento informado.

export const Route = createFileRoute("/turnos")({
  head: () => ({
    meta: [
      { title: "Solicitar turno — CIMT" },
      { name: "description", content: "Pedí tu ingreso a la Dirección Centro Integral Municipal de Tartamudez. Atención gratuita desde los 2 años, para personas de todo el país." },
      { property: "og:title", content: "Solicitar turno — CIMT" },
      { property: "og:description", content: "Completá la solicitud y el equipo del CIMT se comunica con vos." },
    ],
  }),
  component: TurnosPage,
});

const FIELDS = [
  "first_name", "last_name", "dni", "age", "patient_type",
  "guardian_first_name", "guardian_last_name", "guardian_dni", "guardian_relationship",
  "phone", "email", "province", "locality", "address", "preferred_modality", "referred_by", "reason", "consent",
] as const;

type UpcomingWorkshop = { workshop_date: string; start_time: string; place: string };

function TurnosPage() {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [who, setWho] = useState<IntakeFor | "">("");
  const [province, setProvince] = useState<string>(HOME_PROVINCE);
  const [workshops, setWorkshops] = useState<UpcomingWorkshop[]>([]);

  useEffect(() => {
    supabase.rpc("get_upcoming_workshops").then(({ data }: { data: UpcomingWorkshop[] | null }) => setWorkshops(data ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw: Record<string, string> = Object.fromEntries(FIELDS.map((k) => [k, String(fd.get(k) ?? "")]));
    raw.for = who;
    const parsed = parseIntake(raw);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("submit_intake_request", parsed.args);
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

  const minor = who === "menor";

  return (
    <Layout>
      <section className="container mx-auto px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-hand text-5xl text-[color:var(--primary-deep)] sm:text-6xl">
            Solicitar turno
          </h1>
          <p className="mt-4 text-muted-foreground">
            La atención es gratuita, para niños, adolescentes y adultos desde los {CENTER.minAge} años.
            Recibimos consultas de todo el país. Completá la solicitud y el equipo del CIMT se comunica con vos.
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

        {/* Requisitos */}
        <div id="requisitos" className="mx-auto mt-10 max-w-4xl scroll-mt-24">
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-[color:var(--primary-deep)]">
            <ListChecks className="h-6 w-6 text-primary" aria-hidden="true" />
            Requisitos para ser paciente del CIMT
          </h2>
          <RequirementsList className="mt-4" />
        </div>

        <div className="mx-auto mt-10 max-w-2xl rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
          {done ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--status-available-bg)] text-[color:var(--status-available)]">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="font-hand mt-4 text-4xl text-[color:var(--primary-deep)]">¡Solicitud enviada!</h2>
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
              <fieldset>
                <legend className="font-display text-xl font-bold text-[color:var(--primary-deep)]">¿Para quién es el turno?</legend>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <WhoOption checked={who === "yo"} onSelect={() => setWho("yo")} icon={UserRound}
                    title="Para mí" text={`Tengo ${ADULT_AGE} años o más`} />
                  <WhoOption checked={who === "menor"} onSelect={() => setWho("menor")} icon={Baby}
                    title="Para un/a menor a mi cargo" text="Soy su madre, padre o tutor/a" />
                </div>
              </fieldset>

              {who === "" ? (
                <p className="text-sm text-muted-foreground">Elegí una opción para completar la solicitud.</p>
              ) : (
                // key: al cambiar de opción se vacía el formulario (los mismos campos son de otra persona)
                <div key={who} className="space-y-5">
                  {minor && (
                    <>
                      <SectionTitle n={1}>Tus datos (adulto responsable)</SectionTitle>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Nombre" name="guardian_first_name" required maxLength={40} autoComplete="given-name" />
                        <Field label="Apellido" name="guardian_last_name" required maxLength={39} autoComplete="family-name" />
                        <Field label="DNI" name="guardian_dni" required inputMode="numeric" maxLength={10} />
                        <div className="space-y-1.5">
                          <Label htmlFor="guardian_relationship">Vínculo<span className="text-destructive"> *</span></Label>
                          <select id="guardian_relationship" name="guardian_relationship" required defaultValue="" className={selectClass}>
                            <option value="" disabled>Seleccionar...</option>
                            {Object.entries(GUARDIAN_RELATIONSHIP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </div>
                        <Field label="Teléfono" name="phone" required inputMode="tel" autoComplete="tel" />
                        <Field label="Email (opcional)" name="email" type="email" autoComplete="email" />
                      </div>
                    </>
                  )}

                  <SectionTitle n={minor ? 2 : 1}>{minor ? "Datos de la persona que se va a atender" : "Tus datos"}</SectionTitle>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nombre" name="first_name" required maxLength={60} autoComplete={minor ? "off" : "given-name"} />
                    <Field label="Apellido" name="last_name" required maxLength={60} autoComplete={minor ? "off" : "family-name"} />
                    <Field label="DNI" name="dni" required inputMode="numeric" maxLength={10} />
                    <Field label="Edad" name="age" required type="number"
                      min={minor ? CENTER.minAge : ADULT_AGE} max={minor ? ADULT_AGE - 1 : 120} />
                    {minor && (
                      <div className="space-y-1.5">
                        <Label htmlFor="patient_type">Es<span className="text-destructive"> *</span></Label>
                        <select id="patient_type" name="patient_type" required defaultValue="" className={selectClass}>
                          <option value="" disabled>Seleccionar...</option>
                          <option value="niño">Niño/a</option>
                          <option value="adolescente">Adolescente</option>
                        </select>
                      </div>
                    )}
                    {!minor && (
                      <>
                        <Field label="Teléfono" name="phone" required inputMode="tel" autoComplete="tel" />
                        <Field label="Email (opcional)" name="email" type="email" autoComplete="email" />
                      </>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="province">Provincia<span className="text-destructive"> *</span></Label>
                      <select id="province" name="province" required value={province}
                        onChange={(e) => setProvince(e.target.value)} className={selectClass}>
                        {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="locality">Localidad<span className="text-destructive"> *</span></Label>
                      <Input id="locality" name="locality" required maxLength={80} autoComplete="address-level2"
                        list={province === HOME_PROVINCE ? "locality-options" : undefined}
                        placeholder={province === HOME_PROVINCE ? "Ej: Yerba Buena" : "Ciudad o pueblo"} />
                      <datalist id="locality-options">
                        {LOCALITY_OPTIONS.map((l) => <option key={l} value={l} />)}
                      </datalist>
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="address">Domicilio<span className="text-destructive"> *</span></Label>
                      <Input id="address" name="address" required maxLength={150} autoComplete="street-address"
                        placeholder="Calle y número. Ej: Av. Sarmiento 1250, Barrio Norte" />
                      <p className="text-xs text-muted-foreground">Si la calle no tiene número, escribí «s/n» y alguna referencia.</p>
                    </div>
                  </div>

                  <SectionTitle n={minor ? 3 : 2}>Consulta</SectionTitle>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="preferred_modality">Modalidad preferida<span className="text-destructive"> *</span></Label>
                      <select id="preferred_modality" name="preferred_modality" required defaultValue="presencial" className={selectClass}>
                        <option value="presencial">Presencial (en el centro)</option>
                        <option value="telemedicina">Telemedicina (a distancia)</option>
                      </select>
                      {province !== HOME_PROVINCE && (
                        <p className="text-xs text-muted-foreground">Si vivís lejos de Tucumán, podés elegir telemedicina.</p>
                      )}
                    </div>
                    <Field label="¿Quién lo deriva? (opcional)" name="referred_by" placeholder="Ej: escuela, pediatra" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reason">Motivo de la consulta<span className="text-destructive"> *</span></Label>
                    <Textarea id="reason" name="reason" required maxLength={800} rows={4}
                      placeholder={minor
                        ? "Ej: Mi hijo de 6 años repite sílabas al empezar a hablar desde hace unos meses..."
                        : "Ej: Tartamudeo desde chico y quiero empezar un tratamiento..."} />
                  </div>

                  {minor ? (
                    <>
                      <SectionTitle n={4}>{CONSENT_TITLE}</SectionTitle>
                      <div className="rounded-2xl border border-border bg-muted/60 p-4 text-sm leading-relaxed text-foreground">
                        <p className="font-semibold">Como adulto responsable de la persona que se va a atender:</p>
                        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                          {CONSENT_POINTS.map((p) => <li key={p}>{p}</li>)}
                        </ol>
                      </div>
                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-primary/40 bg-[color:var(--primary-soft)]/50 p-4 text-sm font-medium text-foreground">
                        <input type="checkbox" name="consent" required className="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--primary)]" />
                        <span>Leí el consentimiento informado y, como adulto responsable, lo acepto.</span>
                      </label>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Tus datos se usan solo para organizar tu atención en el CIMT, de forma confidencial.
                    </p>
                  )}

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
                </div>
              )}
            </form>
          )}
        </div>
      </section>
    </Layout>
  );
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function SectionTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 pt-2 font-display text-xl font-bold text-[color:var(--primary-deep)]">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground">{n}</span>
      {children}
    </h2>
  );
}

function WhoOption({ checked, onSelect, icon: Icon, title, text }: {
  checked: boolean; onSelect: () => void; icon: typeof Users; title: string; text: string;
}) {
  return (
    <label className={[
      "flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
      checked ? "border-primary bg-[color:var(--primary-soft)]" : "border-border bg-background hover:border-primary/50",
    ].join(" ")}>
      <input type="radio" name="who" className="sr-only" checked={checked} onChange={onSelect} required />
      <span className={[
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
        checked ? "bg-primary text-primary-foreground" : "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]",
      ].join(" ")}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span>
        <span className="block font-bold text-[color:var(--primary-deep)]">{title}</span>
        <span className="block text-sm text-muted-foreground">{text}</span>
      </span>
    </label>
  );
}

function Step({ n, icon: Icon, title, text }: { n: number; icon: typeof Users; title: string; text: string }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-border bg-background p-5">
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
  inputMode?: "numeric" | "tel"; min?: number; max?: number; maxLength?: number; placeholder?: string; autoComplete?: string;
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
