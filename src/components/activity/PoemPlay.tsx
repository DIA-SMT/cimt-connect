import { type PoemSpec } from "@/lib/activitySpec";
import { poemPlace } from "@/lib/activityMechanics";
import { ICON_COMPONENT } from "@/components/activity/assets";
import { ListenButton } from "@/components/portal/ListenButton";
import type { MechanicProps } from "@/components/activity/types";

// Poesía para leer juntos: la estrofa entera a la vista, con el verso de
// ahora marcado. Cada «Siguiente» pasa al verso que sigue (el motor cuenta un
// paso por verso). Con «palmas», el verso de ahora se ve palabra por palabra
// para marcar el ritmo con una palmada en cada una.

export function PoemPlay({ spec, state, speech, big, ink }: MechanicProps<PoemSpec>) {
  const at = poemPlace(spec, state.step);
  const estrofa = spec.estrofas[at.estrofa];
  const verse = estrofa.versos[at.verso];
  const Icon = estrofa.icono ? ICON_COMPONENT[estrofa.icono] : null;
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {Icon && <Icon className={`h-14 w-14 ${ink}`} aria-hidden="true" strokeWidth={1.75} />}
      <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
        Estrofa {at.estrofa + 1} de {spec.estrofas.length}
      </p>
      <ol className="flex w-full flex-col gap-1.5" aria-label={`Estrofa ${at.estrofa + 1}`}>
        {estrofa.versos.map((v, i) => {
          const now = i === at.verso;
          return (
            <li key={i} aria-current={now ? "true" : undefined}
              className={`rounded-2xl px-3 py-2 leading-snug transition-colors break-words ${big ? "text-2xl" : "text-xl"} ${
                now ? "bg-[color:var(--primary-soft)] font-bold text-[color:var(--primary-deep)]" : "text-foreground/70"
              }`}>
              {v}
            </li>
          );
        })}
      </ol>
      {spec.palmas && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-semibold text-muted-foreground">Una palmada en cada palabra:</p>
          <p className="flex flex-wrap justify-center gap-1.5" aria-hidden="true">
            {verse.split(" ").map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).map((w, i) => (
              <span key={i} className="rounded-full border-2 border-primary/30 px-2.5 py-0.5 text-base font-bold">{w}</span>
            ))}
          </p>
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <ListenButton speech={speech} texts={[verse]} label="Escuchar el verso" />
        <ListenButton speech={speech} texts={estrofa.versos} label="Escuchar la estrofa" />
      </div>
    </div>
  );
}
