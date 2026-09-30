import { createFileRoute, Link } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Brain, GraduationCap, Hand, MessageCircle, Scale } from "lucide-react";
import { CENTER, DISCIPLINES } from "@/lib/center";
import { ServicesGrid } from "@/components/ServicesGrid";

// Por ahora se muestran las disciplinas del equipo, no personas: los nombres reales
// de los profesionales todavía no están confirmados (ver relevamiento, pregunta 11).

export const Route = createFileRoute("/profesionales")({
  head: () => ({
    meta: [
      { title: "Nuestro equipo — CIMT" },
      { name: "description", content: "Equipo interdisciplinario del Centro Integral Municipal de Tartamudez: fonoaudiología, psicología, psicopedagogía, terapia ocupacional y asesoría legal." },
      { property: "og:title", content: "Nuestro equipo — CIMT" },
      { property: "og:description", content: "Fonoaudiología, psicología, psicopedagogía, terapia ocupacional y asesoría legal." },
    ],
  }),
  component: ProfesionalesPage,
});

const DISCIPLINE_ICONS: Record<(typeof DISCIPLINES)[number]["name"], typeof Brain> = {
  "Fonoaudiología": MessageCircle,
  "Psicología": Brain,
  "Psicopedagogía": GraduationCap,
  "Terapia ocupacional": Hand,
  "Asesoría legal": Scale,
};

function ProfesionalesPage() {
  return (
    <Layout>
      <section className="container mx-auto px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
            Equipo interdisciplinario
          </div>
          <h1 className="mt-4 font-display text-4xl font-extrabold text-[color:var(--primary-deep)] sm:text-5xl">
            Nuestro equipo
          </h1>
          <p className="mt-4 text-muted-foreground">
            Profesionales de distintas disciplinas trabajan juntos para acompañar a niños, adolescentes
            y adultos con tartamudez, desde los {CENTER.minAge} años, y a sus familias.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {DISCIPLINES.map((d) => {
            const Icon = DISCIPLINE_ICONS[d.name];
            return (
              <article
                key={d.name}
                className="rounded-3xl border border-border/60 bg-card p-7 shadow-[var(--shadow-card)] transition-all hover:-translate-y-1 hover:shadow-[var(--shadow-elegant)]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-card)]">
                  <Icon className="h-6 w-6" strokeWidth={2} />
                </div>
                <h2 className="mt-5 text-xl font-bold text-[color:var(--primary-deep)]">{d.name}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d.description}</p>
              </article>
            );
          })}
        </div>

        <div className="mx-auto mt-16 max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold text-[color:var(--primary-deep)]">Cómo trabajamos</h2>
        </div>
        <ServicesGrid className="mt-8" />

        <div className="mt-12 flex flex-col items-center gap-3 text-center">
          <Button asChild size="lg" className="h-12 rounded-full bg-primary px-7 font-semibold hover:bg-[color:var(--primary-deep)]">
            <Link to="/turnos">
              Solicitar turno
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            O llamá al <a href={CENTER.phoneHref} className="font-semibold text-foreground hover:underline">{CENTER.phoneDisplay}</a>
          </p>
        </div>
      </section>
    </Layout>
  );
}
