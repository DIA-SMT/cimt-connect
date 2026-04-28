import { createFileRoute, Link } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import {
  MapPin, Clock, Phone, Mail, CalendarCheck, Stethoscope,
  HeartHandshake, Users, ShieldCheck, Sparkles, ArrowRight,
  Info, AlertCircle, Baby, Activity, CheckCircle2,
} from "lucide-react";
import heroImg from "@/assets/hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CIMT — Centro Integral Municipal de Tartamudez | San Miguel de Tucumán" },
      { name: "description", content: "Atención gratuita e interdisciplinaria de la tartamudez en Catamarca 411, San Miguel de Tucumán. Detección temprana, diagnóstico y tratamiento integral." },
      { property: "og:title", content: "CIMT — Centro Integral Municipal de Tartamudez" },
      { property: "og:description", content: "Atención gratuita e interdisciplinaria de la disfluencia. Solicitá tu turno online." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <Layout>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[var(--gradient-soft)]" />
        <div className="container mx-auto grid gap-10 px-4 py-16 md:grid-cols-2 md:gap-12 md:px-6 md:py-24 lg:py-28">
          <div className="flex flex-col justify-center">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
              <Sparkles className="h-3.5 w-3.5" />
              Salud pública municipal
            </div>
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.05] text-[color:var(--primary-deep)] sm:text-5xl lg:text-6xl">
              Centro Integral Municipal de <span className="text-primary">Tartamudez</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Atención <strong className="text-foreground">gratuita e interdisciplinaria</strong> para
              personas con disfluencia. Detección temprana, diagnóstico y tratamiento integral
              en San Miguel de Tucumán.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 rounded-full bg-primary px-7 text-base font-semibold text-primary-foreground shadow-[var(--shadow-elegant)] hover:bg-[color:var(--primary-deep)]">
                <Link to="/turnos">
                  <CalendarCheck className="mr-1 h-5 w-5" />
                  Solicitar turno
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full border-primary/30 px-7 text-base font-semibold text-[color:var(--primary-deep)] hover:bg-primary/5">
                <Link to="/profesionales">Ver profesionales</Link>
              </Button>
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4 sm:max-w-md md:grid-cols-3">
              <InfoChip icon={MapPin} title="Catamarca 411" subtitle="San Miguel de Tucumán" />
              <InfoChip icon={Clock} title="Lun a Vie" subtitle="07:30 — 17:30 hs" />
              <InfoChip icon={ShieldCheck} title="Gratuito" subtitle="Equipo interdisciplinario" />
            </div>
          </div>

          <div className="relative flex flex-col items-center justify-center">
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-[var(--gradient-hero)] opacity-20 blur-2xl" />
            <div className="w-full max-w-xs overflow-hidden rounded-3xl shadow-[var(--shadow-elegant)] ring-1 ring-primary/10 sm:max-w-sm">
              <img
                src={heroImg}
                alt="Centro Integral Municipal de Tartamudez — Si tartamudeás no estás solo. Catamarca 411."
                width={800}
                height={1000}
                className="block h-auto w-full bg-[color:var(--primary-soft)] object-contain"
              />
            </div>
          </div>
        </div>
      </section>

      {/* INFO SECTION */}
      <section className="container mx-auto px-4 py-16 md:px-6 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-[color:var(--primary-deep)] sm:text-4xl">
            Acompañamiento integral en cada etapa
          </h2>
          <p className="mt-4 text-muted-foreground">
            Trabajamos desde un enfoque humano, científico e interdisciplinario para que
            cada persona con disfluencia encuentre la ayuda que necesita.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <FeatureCard
            icon={Stethoscope}
            title="Detección temprana"
            text="Evaluación profesional para identificar señales de disfluencia en niños y adolescentes lo antes posible."
          />
          <FeatureCard
            icon={HeartHandshake}
            title="Diagnóstico personalizado"
            text="Cada paciente recibe una valoración integral por nuestro equipo de fonoaudiología y psicología."
          />
          <FeatureCard
            icon={Users}
            title="Tratamiento integral"
            text="Abordaje continuo que incluye al paciente, su familia y entorno. Seguimiento profesional gratuito."
          />
        </div>
      </section>

      {/* MAP + CONTACT */}
      <section className="bg-[color:var(--primary-soft)]/40 py-16 md:py-20">
        <div className="container mx-auto grid gap-10 px-4 md:grid-cols-2 md:px-6">
          <div>
            <h2 className="font-display text-3xl font-bold text-[color:var(--primary-deep)]">
              Encontranos
            </h2>
            <p className="mt-3 text-muted-foreground">
              Estamos ubicados en pleno centro de San Miguel de Tucumán. Ingreso libre y gratuito.
            </p>
            <ul className="mt-6 space-y-4">
              <ContactItem icon={MapPin} label="Dirección" value="Catamarca 411, San Miguel de Tucumán" />
              <ContactItem icon={Clock} label="Horarios" value="Lunes a Viernes · 07:30 a 17:30 hs" />
              <ContactItem icon={Phone} label="Teléfono" value="(0381) 4XX-XXXX" />
              <ContactItem icon={Mail} label="Email" value="cimt@smt.gob.ar" />
            </ul>
            <Button asChild size="lg" className="mt-8 h-12 rounded-full bg-primary px-7 font-semibold hover:bg-[color:var(--primary-deep)]">
              <Link to="/turnos">
                Solicitar turno
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border/60 shadow-[var(--shadow-card)]">
            <iframe
              title="Mapa CIMT — Catamarca 411, San Miguel de Tucumán"
              src="https://www.google.com/maps?q=Catamarca+411,+San+Miguel+de+Tucum%C3%A1n,+Argentina&output=embed"
              className="h-80 w-full border-0 md:h-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>
    </Layout>
  );
}

function InfoChip({ icon: Icon, title, subtitle }: { icon: typeof MapPin; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]">
        <Icon className="h-4 w-4" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, text }: { icon: typeof Stethoscope; title: string; text: string }) {
  return (
    <div className="group rounded-3xl border border-border/60 bg-card p-7 shadow-[var(--shadow-card)] transition-all hover:-translate-y-1 hover:shadow-[var(--shadow-elegant)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--gradient-hero)] text-primary-foreground shadow-[var(--shadow-card)]">
        <Icon className="h-6 w-6" strokeWidth={2} />
      </div>
      <h3 className="mt-5 text-xl font-bold text-[color:var(--primary-deep)]">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function ContactItem({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <li className="flex items-start gap-4 rounded-2xl border border-border/60 bg-background p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--primary-soft)] text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-base font-medium text-foreground">{value}</div>
      </div>
    </li>
  );
}
