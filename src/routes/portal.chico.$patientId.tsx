import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { type ApptDTO, portalApi } from "@/lib/portal";
import { AppointmentCard, PageTitle } from "@/components/portal/ui";
import { card, pillOutline } from "@/components/portal/styles";

export const Route = createFileRoute("/portal/chico/$patientId")({
  component: ChicoPage,
});

function ChicoPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<{ child: { id: string; first_name: string; self?: boolean }; appointments: ApptDTO[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await portalApi.childAppointments(patientId);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: `/portal/chico/${patientId}` }, replace: true });
        return;
      }
      setError(r.status === 404 ? r.error : "No pudimos cargar los turnos. Probá de nuevo en un rato.");
      return;
    }
    setData(r.data);
  }, [patientId, navigate]);

  useEffect(() => { void load(); }, [load]);

  function replaceAppt(updated: ApptDTO) {
    setData((d) => d && { ...d, appointments: d.appointments.map((a) => (a.id === updated.id ? updated : a)) });
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/portal" className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary">
        <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Inicio
      </Link>
      {error ? (
        <div className={`${card} flex flex-col gap-3`} role="alert">
          <p className="text-base">{error}</p>
          <button type="button" onClick={() => void load()} className={pillOutline}>Reintentar</button>
        </div>
      ) : !data ? (
        <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
          Cargando…
        </div>
      ) : (
        <>
          <PageTitle sub="Próximos 90 días.">{data.child.self ? "Tus turnos" : `Turnos de ${data.child.first_name}`}</PageTitle>
          {data.appointments.length === 0 ? (
            <p className={`${card} text-base`}>{data.child.self ? "No tenés turnos agendados por ahora. Cuando el centro te asigne uno, lo vas a ver acá." : `${data.child.first_name} no tiene turnos agendados por ahora. Cuando el centro le asigne uno, lo vas a ver acá.`}</p>
          ) : (
            data.appointments.map((a) => <AppointmentCard key={a.id} appt={a} showChild={false} onChanged={replaceAppt} />)
          )}
        </>
      )}
    </div>
  );
}
