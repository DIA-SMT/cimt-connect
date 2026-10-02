import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ArrowRight, BookOpen, Clapperboard, ExternalLink, Loader2, Mic2, Sparkles, Trophy, Users } from "lucide-react";
import { CENTER } from "@/lib/center";
import { CORNER_CATEGORY_LABEL, sortCorner, type CornerCategory, type CornerItem } from "@/lib/corner";

// Rincón social: espacio motivacional con personas que tartamudean, películas,
// libros, artistas y deportistas. El contenido lo administra el equipo desde
// el panel (pestaña "Rincón social"); acá se muestra solo lo publicado.

export const Route = createFileRoute("/rincon")({
  head: () => ({
    meta: [
      { title: "Rincón social — CIMT" },
      { name: "description", content: "Historias, películas, libros, artistas y deportistas que inspiran: la tartamudez no define lo que una persona puede lograr." },
      { property: "og:title", content: "Rincón social — CIMT" },
      { property: "og:description", content: "Historias que inspiran sobre la tartamudez." },
    ],
  }),
  component: RinconPage,
});

const CATEGORY_ICON: Record<CornerCategory, typeof Users> = {
  figuras: Users,
  artistas: Mic2,
  deportistas: Trophy,
  peliculas: Clapperboard,
  libros: BookOpen,
};

function RinconPage() {
  const [items, setItems] = useState<CornerItem[] | null>(null);
  const [filter, setFilter] = useState<"todo" | CornerCategory>("todo");

  useEffect(() => {
    supabase.from("social_corner_items").select("*").eq("published", true)
      .then(({ data }: { data: CornerItem[] | null }) => setItems(sortCorner(data ?? [])));
  }, []);

  const featured = items?.filter((i) => i.featured) ?? [];
  const rest = useMemo(
    () => (items ?? []).filter((i) => !i.featured && (filter === "todo" || i.category === filter)),
    [items, filter],
  );
  const categories = (Object.keys(CORNER_CATEGORY_LABEL) as CornerCategory[])
    .filter((c) => items?.some((i) => !i.featured && i.category === c));

  return (
    <Layout>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[var(--gradient-soft)]" />
        <div className="container mx-auto px-4 py-14 text-center md:px-6 md:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
            <Sparkles className="h-3.5 w-3.5" /> Rincón social
          </div>
          <h1 className="mx-auto mt-4 max-w-3xl font-display text-4xl font-extrabold text-[color:var(--primary-deep)] sm:text-5xl">
            Historias que inspiran
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Personas, películas, libros, artistas y deportistas que muestran que la tartamudez
            <strong className="text-foreground"> no define lo que una persona puede lograr</strong>.
          </p>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-16 md:px-6">
        {items === null ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">Muy pronto vamos a compartir recomendaciones en este espacio.</p>
        ) : (
          <>
            {featured.map((item) => <FeaturedCard key={item.id} item={item} />)}

            {categories.length > 1 && (
              <div className="mt-10 flex flex-wrap justify-center gap-1.5">
                <FilterChip active={filter === "todo"} onClick={() => setFilter("todo")}>Todo</FilterChip>
                {categories.map((c) => (
                  <FilterChip key={c} active={filter === c} onClick={() => setFilter(c)}>{CORNER_CATEGORY_LABEL[c]}</FilterChip>
                ))}
              </div>
            )}

            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((item) => <ItemCard key={item.id} item={item} />)}
            </div>
          </>
        )}

        <div className="mx-auto mt-14 max-w-2xl rounded-3xl border border-primary/20 bg-[var(--gradient-soft)] p-7 text-center">
          <h2 className="font-display text-2xl font-bold text-[color:var(--primary-deep)]">¿Conocés una historia que inspire?</h2>
          <p className="mt-2 text-muted-foreground">
            Si querés recomendar una película, un libro o una persona, contanos: escribinos a{" "}
            <a href={`mailto:${CENTER.email}`} className="font-semibold text-foreground hover:underline">{CENTER.email}</a>.
          </p>
          <Button asChild className="mt-5 rounded-full bg-primary px-6 font-semibold hover:bg-[color:var(--primary-deep)]">
            <Link to="/turnos">Solicitar turno <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
      </section>
    </Layout>
  );
}

function FeaturedCard({ item }: { item: CornerItem }) {
  const Icon = CATEGORY_ICON[item.category];
  return (
    <article className="mx-auto mb-6 grid max-w-4xl gap-6 overflow-hidden rounded-3xl border border-primary/25 bg-card p-6 shadow-[var(--shadow-elegant)] sm:grid-cols-[auto_1fr] sm:p-8">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        {item.image_url
          ? <img src={item.image_url} alt="" className="h-full w-full rounded-2xl object-cover" />
          : <Icon className="h-10 w-10" />}
      </div>
      <div>
        <div className="text-xs font-bold uppercase tracking-wider text-primary">Destacado · {CORNER_CATEGORY_LABEL[item.category]}</div>
        <h2 className="mt-1 font-display text-2xl font-extrabold text-[color:var(--primary-deep)]">{item.title}</h2>
        {item.subtitle && <p className="text-sm font-medium text-muted-foreground">{item.subtitle}</p>}
        <p className="mt-3 leading-relaxed text-foreground/85">{item.description}</p>
        {item.link_url && (
          <Button asChild className="mt-4 rounded-full bg-primary font-semibold hover:bg-[color:var(--primary-deep)]">
            <a href={item.link_url} target="_blank" rel="noopener noreferrer">
              {item.link_label || "Ver más"} <ExternalLink className="ml-1.5 h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
    </article>
  );
}

function ItemCard({ item }: { item: CornerItem }) {
  const Icon = CATEGORY_ICON[item.category];
  return (
    <article className="flex flex-col rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] transition-all hover:-translate-y-1 hover:shadow-[var(--shadow-elegant)]">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]">
          {item.image_url ? <img src={item.image_url} alt="" className="h-full w-full object-cover" /> : <Icon className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-[color:var(--primary-deep)]">{item.title}</h3>
          <p className="truncate text-xs font-medium text-muted-foreground">{item.subtitle ?? CORNER_CATEGORY_LABEL[item.category]}</p>
        </div>
      </div>
      <p className="mt-4 flex-1 text-sm leading-relaxed text-foreground/80">{item.description}</p>
      {item.link_url && (
        <a href={item.link_url} target="_blank" rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          {item.link_label || "Ver más"} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </article>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={[
      "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
    ].join(" ")}>
      {children}
    </button>
  );
}
