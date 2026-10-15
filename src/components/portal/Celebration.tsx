import { useEffect, useId, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Medal } from "lucide-react";
import logoTortuga from "@/assets/logo-tortuga.png";
import { type CelebrationDTO, portalApi } from "@/lib/portal";
import { authorName, celebrationNames } from "@/lib/practiceRules";
import { card, pillOutline, pillPrimary } from "./styles";
import { focusRing, seeMedalsLabel, seenBatches, whoOf } from "./practiceFormat";

// Celebración de una medalla nueva (diseño §5.5): después de "Ya lo hice", si
// la práctica ganó una medalla, o al abrir el Inicio o los ejercicios, si hay
// una que esta cuenta todavía no vio.
//   - Se anuncia (recibe el foco al aparecer) y no se cierra sola: se va con
//     "Seguir" o con "Ver…", y ahí queda vista para esta cuenta (si hay dos
//     adultos, cada uno la ve una vez).
//   - Hasta 8 años: la tortuga y "¡Medalla nueva!". Desde 9: "Nuevo logro: …",
//     sin dibujos infantiles.
//   - Las del profesional se nombran de forma genérica ("Lic. Ana Torres le dio
//     una medalla a Martín"): su nombre se ve en la página de medallas.
//   - Animación solo con motion-safe, corta, sin sonido ni vibración.
// place: dónde se muestra ("practica": en la pantalla de práctica, donde
// quien practica está mirando: el botón dice "Ver mis medallas")
// onClose: "Seguir". Recibe el pedido de "ya la vi" (termina cuando el
// servidor la marcó, aunque falle), por si la página quiere actualizar algo

export function Celebration({ items, place, onClose }: {
  items: CelebrationDTO[];
  place: "inicio" | "ejercicios" | "practica";
  onClose: (seen?: Promise<unknown>) => void;
}) {
  const id = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ids = items.map((c) => c.medal_id).join(",");

  // Recibe el foco al aparecer (y si cambian las medallas que muestra)
  useEffect(() => {
    if (ids) headingRef.current?.focus();
  }, [ids]);

  const first = items[0];
  if (!first) return null;

  const w = whoOf(first);
  const tortuga = first.audience === "infancia";
  const several = items.length > 1;
  // "una medalla" / "un logro" según el modo (desde 9 años se dice "logro")
  const a = tortuga ? "una medalla" : "un logro";

  // Título (lo que se lee al recibir el foco) y una línea con quién la ganó
  let main: string;
  let big: string | null = null;
  let detail: string | null = null;
  if (several) {
    main = tortuga ? "¡Medallas nuevas!" : "Nuevos logros:";
    // Sin repetir nombres: "Semana cumplida (3 veces) y Primer paso" (todas
    // quedan vistas igual: markSeen manda cada medal_id)
    big = celebrationNames(items, tortuga ? "medalla" : "logro");
    if (!w.self) detail = `${w.first_name} ${tortuga ? "las" : "los"} ganó.`;
  } else if (first.title) {
    if (tortuga) {
      main = "¡Medalla nueva!";
      big = first.title;
    } else {
      main = `Nuevo logro: ${first.title}`;
    }
    if (first.kind === "profesional") {
      detail = w.self ? `${tortuga ? "Te la" : "Te lo"} dio ${authorName(first.by)}.` : `Se ${tortuga ? "la" : "lo"} dio ${authorName(first.by)} a ${w.first_name}.`;
    } else if (!w.self) {
      detail = `${w.first_name} ${tortuga ? "la" : "lo"} ganó practicando.`;
    }
  } else {
    // Del profesional, sin nombre (genérica)
    main = tortuga ? "¡Medalla nueva!" : "Nuevo logro";
    detail = w.self ? `${authorName(first.by)} te dio ${a}.` : `${authorName(first.by)} le dio ${a} a ${w.first_name}.`;
  }

  const seeLabel = place === "practica" && tortuga && !w.self ? "Ver mis medallas" : seeMedalsLabel(w);

  function markSeen(): Promise<unknown> {
    return Promise.all(seenBatches(items.map((c) => c.medal_id)).map((ids) => portalApi.medalsSeen(ids).catch(() => undefined)));
  }

  return (
    <section aria-labelledby={id}
      className={`${card} flex flex-col items-center gap-4 border-2 border-primary/40 bg-[color:var(--primary-soft)] text-center text-[color:var(--primary-deep)]`}>
      {tortuga ? (
        <img src={logoTortuga} alt="" width={96} height={96}
          className="h-24 w-24 object-contain motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in motion-safe:duration-700" />
      ) : (
        <span aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-card text-primary shadow-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
          <Medal className="h-9 w-9" />
        </span>
      )}

      <h2 id={id} ref={headingRef} tabIndex={-1} className="flex flex-col gap-1 outline-none">
        <span className={`font-display font-bold leading-tight ${tortuga ? "text-3xl" : "text-2xl"}`}>{main}</span>
        {big && <span className="font-display text-2xl font-bold leading-tight text-foreground">{big}</span>}
        {detail && <span className="text-base font-semibold leading-snug">{detail}</span>}
      </h2>

      <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <Link to="/portal/medallas/$patientId" params={{ patientId: first.patient_id }} onClick={() => void markSeen()}
          className={`${pillPrimary} ${focusRing} h-auto min-h-12 py-2 text-center`}>
          {seeLabel}
        </Link>
        <button type="button" onClick={() => onClose(markSeen())} className={`${pillOutline} ${focusRing}`}>
          Seguir
        </button>
      </div>
    </section>
  );
}
