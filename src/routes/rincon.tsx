import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, BookOpen, Clapperboard, ExternalLink, Footprints, HeartHandshake, Loader2, MessagesSquare, Mic2, Mountain,
  PlayCircle, Sparkles, Trophy, Users,
} from "lucide-react";
import { CENTER } from "@/lib/center";
import {
  COMMUNITY_CATEGORIES, COMMUNITY_CATEGORY_TEXT, CORNER_CATEGORY_LABEL, isCommunityCategory, sortCorner,
  type CornerCategory, type CornerItem,
} from "@/lib/corner";

// Rincón social: espacio motivacional con personas que tartamudean,
// películas, libros, artistas y deportistas, y "Nuestra comunidad": historias
// de pacientes del CIMT que se animan a contar su experiencia (un filtro más,
// con sus cuatro secciones). El contenido lo administra el equipo desde el
// panel (pestaña "Rincón social"); acá se muestra solo lo publicado.
// #comunidad o #experiencias (etc.) abren el filtro ya elegido.

export const Route = createFileRoute("/rincon")({
  head: () => ({
    meta: [
      { title: "Rincón social — CIMT" },
      { name: "description", content: "Historias de nuestros pacientes, películas, libros, artistas y deportistas que inspiran: la tartamudez no define lo que una persona puede lograr." },
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
  pacientes: HeartHandshake,
  desafios: Mountain,
  experiencias: MessagesSquare,
  huellas: Footprints,
};

type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number];

// Un color por sección de "Nuestra comunidad" (texto oscuro sobre fondo claro)
const COMMUNITY_COLOR: Record<CommunityCategory, { card: string; icon: string }> = {
  pacientes: { card: "border-sky-300 bg-sky-50 text-sky-950", icon: "bg-sky-700 text-white" },
  desafios: { card: "border-amber-300 bg-amber-50 text-amber-950", icon: "bg-amber-700 text-white" },
  experiencias: { card: "border-violet-300 bg-violet-50 text-violet-950", icon: "bg-violet-700 text-white" },
  huellas: { card: "border-emerald-300 bg-emerald-50 text-emerald-950", icon: "bg-emerald-700 text-white" },
};

type Filter = "todo" | "comunidad" | CornerCategory;

function RinconPage() {
  const [items, setItems] = useState<CornerItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("todo");
  // Dentro de "Nuestra comunidad": todas sus secciones o una
  const [section, setSection] = useState<"todas" | CommunityCategory>("todas");

  useEffect(() => {
    supabase.from("social_corner_items").select("*").eq("published", true)
      .then(({ data }: { data: CornerItem[] | null }) => setItems(sortCorner(data ?? [])));
    // Links viejos y de afuera: #comunidad, #experiencias, #peliculas… (al
    // abrir la página y si cambia el # sin recargarla)
    const fromHash = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (hash === "comunidad") { setFilter("comunidad"); setSection("todas"); }
      else if ((COMMUNITY_CATEGORIES as readonly string[]).includes(hash)) {
        setFilter("comunidad");
        setSection(hash as CommunityCategory);
      } else if (hash in CORNER_CATEGORY_LABEL) setFilter(hash as CornerCategory);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const community = useMemo(() => (items ?? []).filter((i) => isCommunityCategory(i.category)), [items]);
  const featured = (items ?? []).filter((i) => i.featured && !isCommunityCategory(i.category));
  const rest = (items ?? []).filter((i) => !featured.includes(i) && (filter === "todo" || i.category === filter));
  // Filtros: los de las recomendaciones que tienen algo publicado
  const categories = (Object.keys(CORNER_CATEGORY_LABEL) as CornerCategory[])
    .filter((c) => !isCommunityCategory(c) && (items ?? []).some((i) => !i.featured && i.category === c));

  function choose(f: Filter) {
    setFilter(f);
    setSection("todas");
    // La dirección acompaña al filtro (se puede compartir el link)
    history.replaceState(null, "", f === "todo" ? window.location.pathname : `#${f}`);
  }

  return (
    <Layout>
      <section className="relative overflow-hidden">
        <div className="container mx-auto px-4 py-14 text-center md:px-6 md:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
            <Sparkles className="h-3.5 w-3.5" /> Rincón social
          </div>
          <h1 className="font-hand mx-auto mt-4 max-w-3xl text-5xl text-[color:var(--primary-deep)] sm:text-6xl">
            Historias que inspiran
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Nuestros pacientes, y también personas, películas, libros, artistas y deportistas que muestran
            que la tartamudez <strong className="text-foreground">no define lo que una persona puede lograr</strong>.
          </p>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-16 md:px-6">
        {items === null ? (
          <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
        ) : (
          <>
            {filter === "todo" && featured.map((item) => <FeaturedCard key={item.id} item={item} />)}

            <div role="group" aria-label="Filtrar el Rincón social" className="mt-10 flex flex-wrap justify-center gap-1.5">
              <FilterChip active={filter === "todo"} onClick={() => choose("todo")}>Todo</FilterChip>
              <FilterChip active={filter === "comunidad"} onClick={() => choose("comunidad")} community>
                <HeartHandshake className="h-3.5 w-3.5" aria-hidden="true" /> Nuestra comunidad
              </FilterChip>
              {categories.map((c) => (
                <FilterChip key={c} active={filter === c} onClick={() => choose(c)}>{CORNER_CATEGORY_LABEL[c]}</FilterChip>
              ))}
            </div>

            {filter === "comunidad" ? (
              <CommunityView items={community} section={section} onSection={setSection} />
            ) : rest.length === 0 ? (
              <p className="py-10 text-center text-muted-foreground">Muy pronto vamos a compartir recomendaciones en este espacio.</p>
            ) : (
              <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((item) => <ItemCard key={item.id} item={item} />)}
              </div>
            )}
          </>
        )}

        <div className="mx-auto mt-14 max-w-2xl rounded-3xl border border-primary/20 bg-[var(--gradient-soft)] p-7 text-center">
          <h2 className="font-hand text-3xl text-[color:var(--primary-deep)]">¿Conocés una historia que inspire?</h2>
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

// El filtro "Nuestra comunidad": qué es, sus cuatro secciones (cada una con
// su color y cuántas historias tiene), las historias publicadas y, siempre al
// final, la invitación a dejar la propia huella.
function CommunityView({ items, section, onSection }: {
  items: CornerItem[]; section: "todas" | CommunityCategory; onSection: (s: "todas" | CommunityCategory) => void;
}) {
  const count = (c: CommunityCategory) => items.filter((i) => i.category === c).length;
  const list = sortCorner(items.filter((i) => section === "todas" || i.category === section));
  return (
    <div className="mt-8">
      <p className="mx-auto max-w-2xl text-center text-lg text-muted-foreground">
        Pacientes del CIMT que se animan a contar su experiencia, para que nadie se sienta solo.
      </p>

      <div role="group" aria-label="Secciones de Nuestra comunidad" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {COMMUNITY_CATEGORIES.map((c) => {
          const Icon = CATEGORY_ICON[c];
          const on = section === c;
          const n = count(c);
          return (
            <button key={c} type="button" aria-pressed={on} onClick={() => onSection(on ? "todas" : c)}
              className={`flex flex-col gap-2 rounded-3xl border-2 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] ${COMMUNITY_COLOR[c].card} ${on ? "ring-4 ring-current/25" : ""}`}>
              <span className="flex items-center gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${COMMUNITY_COLOR[c].icon}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-base font-bold leading-tight">{CORNER_CATEGORY_LABEL[c]}</span>
              </span>
              <span className="text-sm leading-relaxed">{COMMUNITY_CATEGORY_TEXT[c]}</span>
              <span className="mt-auto text-xs font-bold uppercase tracking-wider">
                {n === 0 ? "Pronto" : n === 1 ? "1 historia" : `${n} historias`}{on ? " · elegida" : ""}
              </span>
            </button>
          );
        })}
      </div>

      {list.length > 0 ? (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((item) => <ItemCard key={item.id} item={item} />)}
        </div>
      ) : (
        <div className="mx-auto mt-8 flex max-w-2xl flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-border bg-card/80 p-8 text-center">
          <MessagesSquare className="h-8 w-8 text-primary" aria-hidden="true" />
          <p className="text-lg font-bold text-[color:var(--primary-deep)]">
            {section === "todas" ? "Las primeras historias están por llegar" : `Todavía no hay historias en «${CORNER_CATEGORY_LABEL[section]}»`}
          </p>
          <p className="text-muted-foreground">El equipo las va a ir sumando con la autorización de cada paciente. ¿Querés que la tuya sea una de las primeras?</p>
        </div>
      )}

      <div className={`mx-auto mt-8 flex max-w-3xl flex-col gap-3 rounded-3xl border-2 p-6 sm:flex-row sm:items-center ${COMMUNITY_COLOR.huellas.card}`}>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${COMMUNITY_COLOR.huellas.icon}`}>
          <Footprints className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-lg font-bold">¿Querés dejar tu huella?</p>
          <p className="mt-1 leading-relaxed">
            Si te atendés en el CIMT y querés contar tu historia o dejar un mensaje para quienes recién
            empiezan, hablá con tu profesional o escribinos a{" "}
            <a href={`mailto:${CENTER.email}`} className="font-semibold underline">{CENTER.email}</a>.
            La publicamos solo con tu autorización (y la de tu adulto responsable, si sos menor).
          </p>
        </div>
      </div>
    </div>
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
              {item.link_label || "Ver más"} <LinkIcon url={item.link_url} className="ml-1.5 h-4 w-4" />
            </a>
          </Button>
        )}
      </div>
    </article>
  );
}

// Los videos de YouTube llevan el ícono de "play" en lugar del de link externo
function LinkIcon({ url, className }: { url: string; className: string }) {
  const isVideo = /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url);
  return isVideo ? <PlayCircle className={className} /> : <ExternalLink className={className} />;
}

function ItemCard({ item }: { item: CornerItem }) {
  const Icon = CATEGORY_ICON[item.category];
  // Las historias de pacientes llevan el color de su sección
  const tone = isCommunityCategory(item.category) ? COMMUNITY_COLOR[item.category].icon : "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]";
  return (
    <article className="flex flex-col rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] transition-all hover:-translate-y-1 hover:shadow-[var(--shadow-elegant)]">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl ${tone}`}>
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
          {item.link_label || "Ver más"} <LinkIcon url={item.link_url} className="h-3.5 w-3.5" />
        </a>
      )}
    </article>
  );
}

// community: el filtro "Nuestra comunidad" se distingue con su color
function FilterChip({ active, onClick, community = false, children }: {
  active: boolean; onClick: () => void; community?: boolean; children: React.ReactNode;
}) {
  const tone = community
    ? active ? "bg-emerald-700 text-white" : "border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
    : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]";
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={[
      "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
      tone,
    ].join(" ")}>
      {children}
    </button>
  );
}
