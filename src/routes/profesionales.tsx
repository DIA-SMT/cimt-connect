import { createFileRoute } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Calendar, User2, Loader2 } from "lucide-react";

type Professional = {
  id: string;
  name: string;
  specialty: string;
  days: string;
  description: string;
  photo_url: string | null;
};

export const Route = createFileRoute("/profesionales")({
  head: () => ({
    meta: [
      { title: "Profesionales — CIMT" },
      { name: "description", content: "Conocé al equipo interdisciplinario del Centro Integral Municipal de Tartamudez: fonoaudiología, psicología y coordinación." },
      { property: "og:title", content: "Profesionales — CIMT" },
      { property: "og:description", content: "Equipo interdisciplinario de fonoaudiología, psicología y coordinación." },
    ],
  }),
  component: ProfesionalesPage,
});

function ProfesionalesPage() {
  const [pros, setPros] = useState<Professional[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("professionals")
      .select("*")
      .order("specialty", { ascending: true })
      .then(({ data }) => {
        setPros(data ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <Layout>
      <section className="container mx-auto px-4 py-14 md:px-6 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
            Equipo interdisciplinario
          </div>
          <h1 className="mt-4 font-display text-4xl font-extrabold text-[color:var(--primary-deep)] sm:text-5xl">
            Nuestros profesionales
          </h1>
          <p className="mt-4 text-muted-foreground">
            Un equipo comprometido con el cuidado, la escucha y el abordaje integral de la
            disfluencia.
          </p>
        </div>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pros.map((p) => (
              <article
                key={p.id}
                className="group overflow-hidden rounded-3xl border border-border/60 bg-card shadow-[var(--shadow-card)] transition-all hover:-translate-y-1 hover:shadow-[var(--shadow-elegant)]"
              >
                <div className="relative h-48 bg-[var(--gradient-hero)]">
                  <div className="absolute inset-0 flex items-center justify-center">
                    {p.photo_url ? (
                      <img src={p.photo_url} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-background/90 shadow-lg ring-4 ring-background/40">
                        <User2 className="h-12 w-12 text-primary" strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                    {p.specialty}
                  </div>
                  <h3 className="mt-1.5 text-xl font-bold text-[color:var(--primary-deep)]">
                    {p.name}
                  </h3>
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4 text-primary" />
                    {p.days}
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                    {p.description}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}