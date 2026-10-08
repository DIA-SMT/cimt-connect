import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Info, Loader2 } from "lucide-react";
import { type ApptDTO, type MeDTO, apptDateLabel, portalApi } from "@/lib/portal";
import { AppointmentCard, CallUs, PageTitle } from "@/components/portal/ui";
import { card, pillOutline } from "@/components/portal/styles";

export const Route = createFileRoute("/portal/")({
  component: InicioPage,
});

function InicioPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<MeDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await portalApi.me();
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: "/portal" }, replace: true });
        return;
      }
      setError("No pudimos cargar tus turnos. Probá de nuevo en un rato.");
      return;
    }
    setData(r.data);
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  function replaceAppt(updated: ApptDTO) {
    setData((d) => d && { ...d, week: d.week.map((a) => (a.id === updated.id ? updated : a)) });
  }

  if (error) {
    return (
      <div className={`${card} flex flex-col gap-3`} role="alert">
        <p className="text-base">{error}</p>
        <button type="button" onClick={() => void load()} className={pillOutline}>Reintentar</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
        Cargando tus turnos…
      </div>
    );
  }

  // Cuenta del propio paciente adulto (titular), sola o con chicos a cargo
  const anySelf = data.children.some((c) => c.self);
  const onlySelf = anySelf && data.children.every((c) => c.self);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageTitle>Hola, {data.guardian_first_name}</PageTitle>
        <p className="-mt-2 flex items-start gap-2 rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-base text-[color:var(--primary-deep)]">
          <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {onlySelf
              ? "El centro asigna los días y horarios. Si no podés venir, avisanos con «No voy a poder ir»."
              : "El centro asigna los días y horarios. Si no pueden venir, avisanos con «No vamos a poder ir»."}
          </span>
        </p>
      </div>

      {data.children.length === 0 ? (
        <div className={card}>
          <p className="text-base">Todavía no hay turnos vinculados a tu cuenta. Si te parece un error, <CallUs /> (solo llamadas).</p>
        </div>
      ) : (
        <>
          <section aria-labelledby="portal-semana" className="flex flex-col gap-3">
            <h2 id="portal-semana" className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">Esta semana</h2>
            {data.week.length === 0 ? (
              <p className={`${card} text-base text-muted-foreground`}>No hay turnos en los próximos 7 días.</p>
            ) : (
              data.week.map((a) => <AppointmentCard key={a.id} appt={a} onChanged={replaceAppt} />)
            )}
          </section>

          <section aria-labelledby="portal-chicos" className="flex flex-col gap-3">
            <h2 id="portal-chicos" className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">{onlySelf ? "Tus turnos" : anySelf ? "Tus turnos y los de tus chicos" : "Tus chicos"}</h2>
            {data.children.map((c) => (
              <article key={c.id} className={`${card} flex flex-col gap-2`}>
                <h3 className="font-display text-xl font-bold">{c.self ? "Vos" : c.first_name}</h3>
                <p className="text-base text-muted-foreground">
                  {c.next ? <>Próximo después de esta semana: <b className="text-foreground">{apptDateLabel(c.next)}</b></> : c.self ? "No tenés más turnos agendados por ahora. Cuando el centro te asigne uno, lo vas a ver acá." : `${c.first_name} no tiene más turnos agendados por ahora. Cuando el centro le asigne uno, lo vas a ver acá.`}
                </p>
                <Link to="/portal/chico/$patientId" params={{ patientId: c.id }}
                  className="min-h-11 self-start pt-2 text-base font-bold text-primary underline-offset-2 hover:underline">
                  {c.self ? "Ver todos tus turnos →" : `Ver todos los turnos de ${c.first_name} →`}
                </Link>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
