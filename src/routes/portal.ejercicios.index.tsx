import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ListChecks, Loader2 } from "lucide-react";
import { capitalize, portalApi } from "@/lib/portal";
import { PRACTICE_TEXT, breakLine, exercisesTitle, onBreak, weekLine } from "@/lib/practiceRules";
import { centerNow } from "@/lib/portalRules";
import { BackToHome } from "@/components/portal/PracticeParts";
import { type PracticePerson, announcePracticeNav, focusRing, practicePeople, whoOf } from "@/components/portal/practiceFormat";
import { PageTitle } from "@/components/portal/ui";
import { card, pillOutline, tileWideLink } from "@/components/portal/styles";

// Botón "Ejercicios" de la barra de abajo (diseño §2.2): si hay una sola
// persona con plan publicado, entra directo a sus ejercicios; si hay varias,
// una tarjeta por persona ("Martín · esta semana 2 de 3 días"). Quien no
// tiene plan no aparece acá: sus logros están en el Inicio.

export const Route = createFileRoute("/portal/ejercicios/")({
  component: EjerciciosIndexPage,
});

function EjerciciosIndexPage() {
  const navigate = useNavigate();
  const [people, setPeople] = useState<PracticePerson[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    const r = await portalApi.me();
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: "/portal/ejercicios" }, replace: true });
        return;
      }
      setError(true);
      return;
    }
    announcePracticeNav(r.data);
    const list = practicePeople(r.data);
    if (list.length === 1) {
      navigate({ to: "/portal/ejercicios/$patientId", params: { patientId: list[0].child.id }, replace: true });
      return;
    }
    setPeople(list);
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <BackToHome />
        <div className={`${card} flex flex-col gap-3`} role="alert">
          <p className="text-base">No pudimos cargar los ejercicios. Probá de nuevo en un rato.</p>
          <button type="button" onClick={() => void load()} className={`${pillOutline} ${focusRing} min-[420px]:self-start`}>Reintentar</button>
        </div>
      </div>
    );
  }

  if (!people) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
        Cargando…
      </div>
    );
  }

  const today = centerNow().date;
  return (
    <div className="flex flex-col gap-4">
      <BackToHome />
      <PageTitle>Ejercicios</PageTitle>
      {people.length === 0 ? (
        <p className={`${card} text-base`}>{PRACTICE_TEXT.not_available}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {people.map(({ child, home }) => {
            const w = whoOf({ first_name: child.first_name, self: child.self, audience: home.audience });
            const paused = onBreak(home.on_break_until, today) && home.on_break_until;
            return (
              <li key={child.id} className="flex">
                <Link to="/portal/ejercicios/$patientId" params={{ patientId: child.id }} className={`${tileWideLink} ${focusRing}`}>
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm">
                    <ListChecks className="h-6 w-6" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="break-words text-base font-bold leading-snug">{exercisesTitle(w)}</span>
                    <span className="text-sm leading-snug opacity-80">
                      {paused ? breakLine(paused) : home.week ? capitalize(weekLine(home.week)) : "Para practicar en casa"}
                    </span>
                  </span>
                  <span aria-hidden="true" className="shrink-0">→</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
