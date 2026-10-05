import { createFileRoute, Link } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, Download, FileText, Heart, HeartHandshake, Lightbulb, MapPin, Phone, Quote } from "lucide-react";
import { GUIDES, type Guide, type GuideBlock, type GuideItem } from "@/lib/guides";
import { CENTER } from "@/lib/center";

// Para familias y escuelas: los folletos de las áreas del CIMT (src/lib/guides.ts)

export const Route = createFileRoute("/familias")({
  head: () => ({
    meta: [
      { title: "Para familias y escuelas — CIMT" },
      { name: "description", content: "Consejos del Centro Integral Municipal de Tartamudez para acompañar en casa y en la escuela, cómo prevenir el bullying y orientación legal." },
      { property: "og:title", content: "Para familias y escuelas — CIMT" },
      { property: "og:description", content: "Consejos para la familia, para docentes, cómo prevenir el bullying y orientación legal." },
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
            <HeartHandshake className="h-3.5 w-3.5" /> Para familias y escuelas
          </div>
          <h1 className="font-hand mx-auto mt-4 max-w-3xl text-5xl text-[color:var(--primary-deep)] sm:text-6xl">
            Acompañar también es parte de la terapia
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Consejos del equipo del CIMT para acompañar en casa y en la escuela, y orientación sobre tus derechos.
          </p>
          {GUIDES.length > 1 && (
            <nav aria-label="Folletos" className="mt-7 flex flex-wrap justify-center gap-2">
              {GUIDES.map((g) => (
                <a key={g.id} href={`#${g.id}`}
                  className="rounded-full border border-primary/25 bg-card px-4 py-2 text-sm font-semibold text-[color:var(--primary-deep)] shadow-[var(--shadow-card)] transition-colors hover:bg-[color:var(--primary-soft)]">
                  {g.area} <span className="font-normal text-muted-foreground">· {g.audience.replace(/^Para /, "")}</span>
                </a>
              ))}
            </nav>
          )}
        </div>
      </section>

      <div className="container mx-auto space-y-20 px-4 pb-16 md:px-6">
        {GUIDES.map((g) => <GuideSection key={g.id} guide={g} />)}

        <div className="mx-auto max-w-2xl rounded-3xl border border-primary/20 bg-card p-7 text-center shadow-[var(--shadow-card)]">
          <h2 className="font-hand text-3xl text-[color:var(--primary-deep)]">¿Querés que te acompañemos?</h2>
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
  const numbered = g.blocks.filter((b) => b.kind === "numbered");
  const boxes = g.blocks.filter((b) => b.kind === "tips" || b.kind === "list");
  const alerts = g.blocks.filter((b) => b.kind === "alert");
  const texts = g.blocks.filter((b) => b.kind === "text");
  return (
    <section id={g.id} className="scroll-mt-24 space-y-8">
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-wider text-primary">{g.area} · {g.audience}</div>
        <h2 className="font-hand mt-1 text-4xl text-[color:var(--primary-deep)] sm:text-5xl">{g.title}</h2>
        {g.subtitle && <p className="font-hand mt-1 text-2xl text-primary sm:text-3xl">{g.subtitle}</p>}
      </div>

      {g.intro && (
        <div className="mx-auto max-w-3xl rounded-3xl border border-border/60 bg-card p-6 text-center shadow-[var(--shadow-card)] md:p-7">
          {g.intro.title && <h3 className="font-hand mb-2 text-3xl text-[color:var(--primary-deep)]">{g.intro.title}</h3>}
          <p className="leading-relaxed text-foreground/85 md:text-lg">{g.intro.text}</p>
        </div>
      )}

      {numbered.map((b) => <NumberedBlock key={b.title} block={b} showTitle={!!g.intro} />)}

      {boxes.length > 0 && (
        <div className={`grid gap-6 ${boxes.length > 1 ? "lg:grid-cols-2" : "mx-auto max-w-3xl"}`}>
          {boxes.map((b) => <BoxBlock key={b.title} block={b} />)}
        </div>
      )}

      {alerts.map((b) => <AlertBlock key={b.title} block={b} />)}

      {texts.length > 0 && (
        <div className={`grid gap-6 ${texts.length > 1 ? "md:grid-cols-2" : "mx-auto max-w-3xl"}`}>
          {texts.map((b) => (
            <div key={b.title} className="rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] md:p-7">
              <h3 className="font-hand text-3xl text-[color:var(--primary-deep)]">{b.title}</h3>
              {b.items.map((p) => (
                <p key={splitItem(p).title} className="mt-3 leading-relaxed text-foreground/85">{splitItem(p).title}</p>
              ))}
            </div>
          ))}
        </div>
      )}

      {g.keyMessage && (
        <figure className="mx-auto max-w-3xl rounded-3xl border-2 border-[color:var(--primary-deep)]/30 bg-card p-6 text-center md:p-8">
          <Quote className="mx-auto h-6 w-6 text-primary" aria-hidden />
          <blockquote className="mt-3 font-display text-lg font-semibold leading-relaxed text-[color:var(--primary-deep)] md:text-xl">
            {g.keyMessage}
          </blockquote>
          <figcaption className="font-hand mt-2 text-2xl text-muted-foreground">Mensaje clave</figcaption>
        </figure>
      )}

      {g.contact && <ContactBox />}

      {g.original && <OriginalFolleto guide={g} />}
    </section>
  );
}

function NumberedBlock({ block, showTitle }: { block: GuideBlock; showTitle: boolean }) {
  return (
    <div className="space-y-4">
      {showTitle && <h3 className="font-hand text-center text-3xl text-[color:var(--primary-deep)]">{block.title}</h3>}
      <ol className={`grid gap-4 ${block.items.length === 3 ? "md:grid-cols-3" : "sm:grid-cols-2"}`}>
        {block.items.map((item, i) => {
          const { title, text } = splitItem(item);
          return (
            <li key={title} className="flex items-start gap-4 rounded-3xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--primary-soft)] font-hand text-3xl text-[color:var(--primary-deep)]">
                {i + 1}
              </span>
              <div>
                <h4 className="font-bold text-[color:var(--primary-deep)]">{title}</h4>
                {text && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BoxBlock({ block }: { block: GuideBlock }) {
  const tips = block.kind === "tips";
  const Icon = tips ? Heart : Lightbulb;
  return (
    <div className={tips
      ? "rounded-3xl border border-primary/20 bg-[color:var(--primary-soft)] p-6 md:p-7"
      : "rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] md:p-7"}>
      <h3 className="font-hand flex items-center gap-2 text-3xl text-[color:var(--primary-deep)]">
        <Icon className="h-5 w-5 shrink-0" /> {block.title}
      </h3>
      <ItemList items={block.items} />
      {block.groups?.map((grp) => (
        <div key={grp.title} className="mt-5">
          <h4 className="font-bold text-[color:var(--primary-deep)]">{grp.title}</h4>
          <ItemList items={grp.items} />
        </div>
      ))}
    </div>
  );
}

function AlertBlock({ block }: { block: GuideBlock }) {
  return (
    <div className="rounded-3xl border-2 border-[color:var(--status-occupied)]/30 bg-card p-6 shadow-[var(--shadow-card)] md:p-8">
      <h3 className="font-hand flex items-center justify-center gap-2 text-center text-4xl text-[color:var(--primary-deep)]">
        <AlertTriangle className="h-7 w-7 shrink-0 text-[color:var(--status-occupied)]" /> {block.title}
      </h3>
      <ul className="mt-6 grid gap-x-8 gap-y-4 md:grid-cols-2">
        {block.items.map((item) => {
          const { title, text } = splitItem(item);
          return (
            <li key={title} className="flex items-start gap-3 leading-relaxed">
              <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[color:var(--status-occupied)]" aria-hidden />
              <span>
                <strong className="text-[color:var(--primary-deep)]">{title}</strong>
                {text && <span className="text-foreground/85">{`: ${text}`}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {block.link && (
        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-border/60 pt-4 text-center text-sm text-muted-foreground">
          {block.link.text}
          <a href={block.link.href} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            {block.link.label} <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </p>
      )}
    </div>
  );
}

function ContactBox() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 rounded-3xl border border-primary/20 bg-[color:var(--primary-soft)] p-6 text-center md:p-7">
      <h3 className="font-hand text-3xl text-[color:var(--primary-deep)]">¿Querés hacer una consulta?</h3>
      <p className="text-foreground/85">Comunicate con el centro y te orientamos.</p>
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
        <a href={CENTER.phoneHref} className="inline-flex items-center gap-1.5 font-semibold text-[color:var(--primary-deep)] hover:underline">
          <Phone className="h-4 w-4" /> {CENTER.phoneDisplay} <span className="font-normal text-muted-foreground">({CENTER.phoneNote.toLowerCase()})</span>
        </a>
        <span className="inline-flex items-center gap-1.5 text-foreground/85">
          <MapPin className="h-4 w-4 text-primary" /> {CENTER.address} · {CENTER.hoursLong}
        </span>
      </div>
    </div>
  );
}

function ItemList({ items }: { items: GuideItem[] }) {
  return (
    <ul className="mt-4 space-y-3">
      {items.map((item) => {
        const { title, text } = splitItem(item);
        return (
          <li key={title} className="flex items-start gap-3 text-sm leading-relaxed text-foreground/85 md:text-base">
            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{text ? <><strong>{title}:</strong> {text}</> : title}</span>
          </li>
        );
      })}
    </ul>
  );
}

function OriginalFolleto({ guide: g }: { guide: Guide }) {
  if (!g.original) return null;
  const { images, pdf } = g.original;
  const download = pdf ?? images[0]?.src;
  return (
    <details className="group mx-auto max-w-4xl rounded-3xl border border-border/60 bg-card p-4 md:p-5">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 font-semibold text-[color:var(--primary-deep)]">
        <span className="flex items-center gap-2"><FileText className="h-4 w-4" /> Ver el folleto original</span>
        <span className="text-sm font-normal text-muted-foreground group-open:hidden">Tocá para abrir</span>
      </summary>
      <div className="mt-4 space-y-4">
        {images.map((img) => (
          <img key={img.src} src={img.src} alt={img.alt} width={img.width} height={img.height} loading="lazy"
            className="h-auto w-full rounded-2xl border border-border/60" />
        ))}
      </div>
      {download && (
        <div className="mt-3 flex justify-end">
          <Button asChild variant="outline" className="rounded-full">
            <a href={download} download={`CIMT - ${g.area}.${pdf ? "pdf" : "jpg"}`}>
              <Download className="mr-1.5 h-4 w-4" /> Descargar folleto{pdf ? " (PDF)" : ""}
            </a>
          </Button>
        </div>
      )}
    </details>
  );
}

function splitItem(item: GuideItem): { title: string; text: string | null } {
  return typeof item === "string" ? { title: item, text: null } : { title: item.title, text: item.text };
}
