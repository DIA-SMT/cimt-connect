import { createFileRoute, Link } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Brain, GraduationCap, Hand, MessageCircle, Scale, User2 } from "lucide-react";
import { CENTER, DISCIPLINES } from "@/lib/center";
import { ServicesGrid } from "@/components/ServicesGrid";

// Se muestran las disciplinas y, debajo, los profesionales que la Dirección marca
// "en el sitio" desde el panel (Equipo). get_public_team() solo devuelve nombre,
// especialidad, descripción y foto: nada privado del personal (relevamiento 42 y 44).

type TeamMember = { name: string; specialty: string; description: string | null; photo_url: string | null };

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
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    supabase.rpc("get_public_team").then(({ data }: { data: TeamMember[] | null }) => setTeam(data ?? []));
  }, []);

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

        {team.length > 0 && (
          <>
            <div className="mx-auto mt-16 max-w-2xl text-center">
              <h2 className="font-display text-3xl font-bold text-[color:var(--primary-deep)]">Profesionales</h2>
            </div>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {team.map((m) => (
                <article key={`${m.name}-${m.specialty}`}
                  className="overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
                  <div className="flex h-44 items-center justify-center bg-[var(--gradient-hero)]">
                    {m.photo_url ? (
                      <img src={m.photo_url} alt={m.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-background/90 shadow-lg">
                        <User2 className="h-10 w-10 text-primary" strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                  <div className="p-6">
                    <div className="text-xs font-semibold uppercase tracking-wider text-primary">{m.specialty}</div>
                    <h3 className="mt-1.5 text-lg font-bold text-[color:var(--primary-deep)]">{m.name}</h3>
                    {m.description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{m.description}</p>}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

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
