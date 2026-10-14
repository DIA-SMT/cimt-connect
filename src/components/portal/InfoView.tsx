import { useEffect, useId, useState } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, CircleCheck, Printer } from "lucide-react";
import type { InfoDTO, InfoReportDTO, InfoSummaryDTO } from "@/lib/portal";
import { centerDateOf } from "@/lib/portalRules";
import { CallUs } from "./ui";
import { card, newChip, pillOutline, sectionTitle } from "./styles";

// "Mi información": lo que el equipo publicó para una persona, tal como lo
// lee la familia. Solo muestra (no carga nada): lo usan la página del portal
// y la vista previa "Ver como la familia" del panel (preview: sin "Nuevo" ni
// "Imprimir"). Lo que escribe el profesional es texto plano: se respetan los
// saltos de línea y nunca se interpreta como HTML.

// Día del centro de una fecha ISO, como dd/mm/aaaa
function dayLabel(iso: string): string {
  return centerDateOf(iso).split("-").reverse().join("/");
}

// Sin nada publicado (o sin poder verlo: nunca se dice por qué)
export function InfoEmpty({ self }: { self: boolean }) {
  return (
    <p className={`${card} text-base`}>
      Todavía no hay información para ver acá. Cuando el equipo comparta algo, lo vas a ver acá. Si tenés dudas,
      consultalo con {self ? "tu" : "su"} profesional.
    </p>
  );
}

export function InfoView({ info, preview = false }: { info: InfoDTO; preview?: boolean }) {
  const uid = useId();
  // "Imprimir" de un informe: en el papel sale solo ese informe
  const [printing, setPrinting] = useState<string | null>(null);

  useEffect(() => {
    const done = () => setPrinting(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  function print(id: string) {
    flushSync(() => setPrinting(id));
    window.print();
  }

  const { child, summary, reports } = info;
  if (!summary && reports.length === 0) return <InfoEmpty self={child.self} />;

  return (
    <div className="flex flex-col gap-6">
      {summary && <Summary summary={summary} preview={preview} printHidden={!!printing} />}

      {reports.length > 0 && (
        <section aria-labelledby={`${uid}-informes`} className="flex flex-col gap-3">
          <h2 id={`${uid}-informes`} className={sectionTitle}>Informes</h2>
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} preview={preview}
              printHidden={!!printing && printing !== r.id} onPrint={() => print(r.id)} />
          ))}
        </section>
      )}
    </div>
  );
}

// Quién lo escribió, cuándo se publicó y el código de esa versión. writtenBy:
// un informe "tal cual" que escribió otra persona (author es quien lo publicó)
function Signature({ author, writtenBy, at, code }: { author: string; writtenBy?: string | null; at: string; code: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border/60 pt-3 text-muted-foreground">
      {writtenBy ? (
        <p className="text-base">Lo escribió {writtenBy}. Lo publicó {author} · {dayLabel(at)}</p>
      ) : (
        <p className="text-base">Lo escribió {author} · {dayLabel(at)}</p>
      )}
      <p className="text-sm">Código de verificación <span className="font-semibold tabular-nums text-foreground">{code}</span></p>
    </div>
  );
}

function Summary({ summary, preview, printHidden }: { summary: InfoSummaryDTO; preview: boolean; printHidden: boolean }) {
  const uid = useId();
  const [tramitesOpen, setTramitesOpen] = useState(false);
  const como = summary.como_trabajamos;
  const { text, tips } = summary.acompanar;
  const hide = printHidden ? "print:hidden" : "";

  return (
    <>
      <section aria-labelledby={`${uid}-que`} className={`flex flex-col gap-3 ${hide}`}>
        <div className="flex items-center gap-2">
          <h2 id={`${uid}-que`} className={sectionTitle}>Qué trabajamos</h2>
          {summary.is_new && !preview && <span className={newChip}>Nuevo</span>}
        </div>
        <div className={`${card} flex flex-col gap-4`}>
          <p className="whitespace-pre-line break-words text-base">{summary.que_trabajamos}</p>

          {summary.tramites && (
            <div className="rounded-2xl bg-muted px-4">
              <button type="button" onClick={() => setTramitesOpen((v) => !v)}
                aria-expanded={tramitesOpen} aria-controls={tramitesOpen ? `${uid}-tramites` : undefined}
                className="flex min-h-12 w-full items-center justify-between gap-2 text-left text-base font-bold text-[color:var(--primary-deep)]">
                Datos para trámites
                <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${tramitesOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              {tramitesOpen && (
                <div id={`${uid}-tramites`} className="flex flex-col gap-1 pb-4">
                  <p className="text-base font-semibold">{summary.tramites.label}</p>
                  <p className="text-base text-muted-foreground">
                    No es un certificado. Para el CUD o la obra social, pedí el certificado en el centro.
                  </p>
                </div>
              )}
            </div>
          )}

          <Signature author={summary.author_label} at={summary.published_at} code={summary.code} />
        </div>
        <p className="text-base text-muted-foreground">¿Algo no se entiende? Preguntalo en el próximo turno o <CallUs />.</p>
      </section>

      {como && (como.modes.length > 0 || como.professional) && (
        <section aria-labelledby={`${uid}-como`} className={`flex flex-col gap-3 ${hide}`}>
          <h2 id={`${uid}-como`} className={sectionTitle}>Cómo lo trabajamos</h2>
          <div className={`${card} flex flex-col gap-3`}>
            {como.modes.length > 0 && (
              <ul className="flex list-disc flex-col gap-2 pl-5 text-base">
                {como.modes.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
            {como.professional && <p className="text-base">Con {como.professional}</p>}
          </div>
        </section>
      )}

      {(text || tips.length > 0) && (
        <section aria-labelledby={`${uid}-casa`} className={`flex flex-col gap-3 ${hide}`}>
          <h2 id={`${uid}-casa`} className={sectionTitle}>Cómo acompañar en casa</h2>
          <div className={`${card} flex flex-col gap-4`}>
            {text && <p className="whitespace-pre-line break-words text-base">{text}</p>}
            {tips.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {tips.map((t) => (
                  <li key={t} className="flex gap-2.5 text-base">
                    <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function ReportCard({ report, preview, printHidden, onPrint }: {
  report: InfoReportDTO;
  preview: boolean;
  printHidden: boolean; // se imprime otro informe
  onPrint: () => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  // Para los botones, en lectores de pantalla: "Leer el informe del 12/09/2026"
  const which = report.title.charAt(0).toLowerCase() + report.title.slice(1);

  return (
    <article aria-labelledby={`${uid}-title`} className={`${card} flex flex-col gap-3 ${printHidden ? "print:hidden" : ""}`}>
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 id={`${uid}-title`} className="font-display text-lg font-bold leading-snug">{report.title}</h3>
          {report.is_new && !preview && <span className={`${newChip} mt-0.5`}>Nuevo</span>}
        </div>
        <p className="text-base text-muted-foreground">{report.written_by ?? report.author_label}</p>
      </div>

      <button type="button" onClick={() => setOpen((v) => !v)}
        aria-expanded={open} aria-controls={open ? `${uid}-body` : undefined}
        className={`${pillOutline} gap-2 min-[420px]:self-start print:hidden`}>
        {open ? "Cerrar" : "Leer"}<span className="sr-only"> el {which}</span>
        <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div id={`${uid}-body`} className="flex flex-col gap-4">
          {report.sections.map((s, i) => (
            <div key={i} className="flex flex-col gap-1">
              {s.label && <h4 className="font-display text-base font-bold">{s.label}</h4>}
              <p className="whitespace-pre-line break-words text-base">{s.text}</p>
            </div>
          ))}
          <Signature author={report.author_label} writtenBy={report.written_by} at={report.published_at} code={report.code} />
          {!preview && (
            <button type="button" onClick={onPrint} className={`${pillOutline} gap-2 min-[420px]:self-start print:hidden`}>
              <Printer className="h-5 w-5" aria-hidden="true" />
              Imprimir<span className="sr-only"> el {which}</span>
            </button>
          )}
        </div>
      )}
    </article>
  );
}
