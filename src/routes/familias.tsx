import { createFileRoute, Link } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { ArrowRight, Download, Heart, HeartHandshake, Lightbulb, Quote } from "lucide-react";
import { GUIDES, type Guide } from "@/lib/guides";

// Para familias: consejos y folletos de las áreas del CIMT (src/lib/guides.ts)

export const Route = createFileRoute("/familias")({
  head: () => ({
    meta: [
      { title: "Para familias — CIMT" },
      { name: "description", content: "Consejos para acompañar a un hijo o familiar que tartamudea y cómo trabaja cada área del Centro Integral Municipal de Tartamudez." },
      { property: "og:title", content: "Para familias — CIMT" },
      { property: "og:description", content: "Consejos para la familia y el rol de cada área del CIMT en la tartamudez." },
    ],
  }),
  component: FamiliasPage,
});

function FamiliasPage() {
  return (
    <Layout>
      <section>
        <div className="container mx-auto px-4 py-14 text-center md:px-6 md:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
            <HeartHandshake className="h-3.5 w-3.5" /> Para familias
          </div>
          <h1 className="font-hand mx-auto mt-4 max-w-3xl text-5xl text-[color:var(--primary-deep)] sm:text-6xl">
            Acompañar también es parte de la terapia
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Consejos del equipo del CIMT para la familia y cómo trabaja cada área con la tartamudez.
          </p>
        </div>
      </section>

      <div className="container mx-auto space-y-16 px-4 pb-16 md:px-6">
        {GUIDES.map((g) => <GuideSection key={g.id} guide={g} />)}

        <div className="mx-auto max-w-2xl rounded-3xl border border-primary/20 bg-[var(--gradient-soft)] p-7 text-center">
          <h2 className="font-display text-2xl font-bold text-[color:var(--primary-deep)]">¿Querés que te acompañemos?</h2>
          <p className="mt-2 text-muted-foreground">
            La atención es gratuita. Solicitá un turno y el equipo se comunica con vos.
          </p>
          <Button asChild className="mt-5 rounded-full bg-primary px-6 font-semibold hover:bg-[color:var(--primary-deep)]">
            <Link to="/turnos">Solicitar turno <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
      </div>
    </Layout>
  );
}

function GuideSection({ guide: g }: { guide: Guide }) {
  return (
    <section id={g.id} className="scroll-mt-24 space-y-8">
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-wider text-primary">{g.area}</div>
        <h2 className="font-hand mt-1 text-4xl text-[color:var(--primary-deep)] sm:text-5xl">{g.title}</h2>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2">
        {g.role.map((r, i) => (
          <li key={r.title} className="flex items-start gap-4 rounded-3xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--primary-soft)] font-hand text-3xl text-[color:var(--primary-deep)]">
              {i + 1}
            </span>
            <div>
              <h3 className="font-bold text-[color:var(--primary-deep)]">{r.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-primary/20 bg-[color:var(--primary-soft)] p-6 md:p-7">
          <h3 className="font-hand flex items-center gap-2 text-3xl text-[color:var(--primary-deep)]">
            <Heart className="h-5 w-5 shrink-0" /> Consejos para la familia
          </h3>
          <ul className="mt-4 space-y-3">
            {g.familyTips.map((t) => <Bullet key={t}>{t}</Bullet>)}
          </ul>
        </div>
        <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] md:p-7">
          <h3 className="font-hand flex items-center gap-2 text-3xl text-[color:var(--primary-deep)]">
            <Lightbulb className="h-5 w-5 shrink-0" /> {g.strategiesTitle}
          </h3>
          <ul className="mt-4 space-y-3">
            {g.strategies.map((t) => <Bullet key={t}>{t}</Bullet>)}
          </ul>
        </div>
      </div>

      <figure className="mx-auto max-w-3xl rounded-3xl border-2 border-[color:var(--primary-deep)]/30 bg-card p-6 text-center md:p-8">
        <Quote className="mx-auto h-6 w-6 text-primary" aria-hidden />
        <blockquote className="mt-3 font-display text-lg font-semibold leading-relaxed text-[color:var(--primary-deep)] md:text-xl">
          {g.keyMessage}
        </blockquote>
        <figcaption className="font-hand mt-2 text-2xl text-muted-foreground">Mensaje clave</figcaption>
      </figure>

      {g.image && (
        <details className="group mx-auto max-w-4xl rounded-3xl border border-border/60 bg-card p-4 md:p-5">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 font-semibold text-[color:var(--primary-deep)]">
            Ver el folleto original
            <span className="text-sm font-normal text-muted-foreground group-open:hidden">Tocá para abrir</span>
          </summary>
          <img src={g.image.src} alt={g.image.alt} width={1280} height={904} loading="lazy"
            className="mt-4 h-auto w-full rounded-2xl border border-border/60" />
          <div className="mt-3 flex justify-end">
            <Button asChild variant="outline" className="rounded-full">
              <a href={g.image.src} download={`CIMT - ${g.area}.jpg`}>
                <Download className="mr-1.5 h-4 w-4" /> Descargar folleto
              </a>
            </Button>
          </div>
        </details>
      )}
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-relaxed text-foreground/85 md:text-base">
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
