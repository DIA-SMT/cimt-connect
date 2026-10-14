import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { apptReqOpen } from "@/lib/apptRequestRules";
import { type ApptDTO, type ApptRequestDTO, type ChildPageDTO, portalApi } from "@/lib/portal";
import { ApptRequestCard } from "@/components/portal/ApptRequestCard";
import { AppointmentCard, PageTitle } from "@/components/portal/ui";
import { card, pillOutline, pillPrimary, sectionTitle } from "@/components/portal/styles";

// "Turnos" de una persona: solo sus turnos y sus pedidos de turno. La copia
// del historial se pide desde "Mi información" (cada cosa en un solo lugar).

export const Route = createFileRoute("/portal/chico/$patientId")({
  component: ChicoPage,
});

function ChicoPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ChildPageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  // quiet: actualiza después de pedir o cancelar sin tapar la pantalla si falla
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    const r = await portalApi.childAppointments(patientId);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: `/portal/chico/${patientId}` }, replace: true });
        return;
      }
      if (!quiet) setError(r.status === 404 ? r.error : "No pudimos cargar los turnos. Probá de nuevo en un rato.");
      return;
    }
    setData(r.data);
  }, [patientId, navigate]);

  useEffect(() => { void load(); }, [load]);

  function replaceAppt(updated: ApptDTO) {
    setData((d) => d && { ...d, appointments: d.appointments.map((a) => (a.id === updated.id ? updated : a)) });
  }

  function upsertApptRequest(updated: ApptRequestDTO) {
    setData((d) => {
      if (!d) return d;
      const known = d.turnos.requests.some((r) => r.id === updated.id);
      const requests = known ? d.turnos.requests.map((r) => (r.id === updated.id ? updated : r)) : [updated, ...d.turnos.requests];
      return { ...d, turnos: { ...d.turnos, requests } };
    });
  }

  // Invitación a pedir un turno (o a ver el pedido) cuando no hay turnos
  // agendados. Sin los pedidos de turno en el servidor, no se invita
  const askHint = !data ? ""
    : data.turnos.enabled && data.turnos.can_request ? " Si necesitás un turno, pedilo acá abajo."
      : data.turnos.requests.some((r) => apptReqOpen(r.status)) ? " El pedido de turno lo ves acá abajo." : "";

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
          <section aria-labelledby="portal-turnos" className="flex flex-col gap-4">
            <h2 id="portal-turnos" className="sr-only">Próximos turnos</h2>
            {data.appointments.length === 0 ? (
              <p className={`${card} text-base`}>{data.child.self ? "No tenés turnos agendados por ahora. Cuando el centro te asigne uno, lo vas a ver acá." : `${data.child.first_name} no tiene turnos agendados por ahora. Cuando el centro le asigne uno, lo vas a ver acá.`}{askHint}</p>
            ) : (
              data.appointments.map((a) => <AppointmentCard key={a.id} appt={a} showChild={false} onChanged={replaceAppt} />)
            )}
          </section>
          <ApptRequestSection key={`t-${data.child.id}`} data={data} onChanged={upsertApptRequest} onRefresh={() => void load(true)} />
        </>
      )}
    </div>
  );
}

// Pedidos de turno de esta persona (de cualquier adulto de la familia) y el
// botón para pedir uno, que lleva al formulario. El centro asigna el día y el
// horario: acá se ve en qué está el pedido. Sin pedidos y sin poder pedir
// (por ejemplo, con la función apagada en el servidor), no se muestra.
function ApptRequestSection({ data, onChanged, onRefresh }: {
  data: ChildPageDTO;
  onChanged: (updated: ApptRequestDTO) => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const { child, turnos } = data;
  const self = !!child.self;
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Se llegó recién de pedir el turno (o de "Ver el pedido en curso"): la
  // sección se monta recién con los datos cargados, así que acá se la muestra
  // y se le da el foco. Después se saca el #turno-pedido de la dirección, así
  // volver a esta página (desde un turno o con "atrás") no salta de nuevo
  useEffect(() => {
    if (window.location.hash !== "#turno-pedido") return;
    sectionRef.current?.scrollIntoView({ block: "start" });
    titleRef.current?.focus({ preventScroll: true });
    navigate({ to: "/portal/chico/$patientId", params: { patientId: child.id }, replace: true, resetScroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  // Los abiertos primero (en una sola lista, para que una tarjeta no se
  // vuelva a montar, y pierda el foco, cuando se cancela su pedido)
  const requests = [...turnos.requests].sort((a, b) => Number(apptReqOpen(b.status)) - Number(apptReqOpen(a.status)));
  const open = requests.some((r) => apptReqOpen(r.status));
  const canAsk = turnos.enabled && turnos.can_request;
  if (!canAsk && requests.length === 0) return null;

  function requestChanged(updated?: ApptRequestDTO) {
    if (updated) onChanged(updated);
    onRefresh();
  }

  return (
    <section id="turno-pedido" ref={sectionRef} aria-labelledby="portal-turno-pedido" className="mt-4 flex scroll-mt-20 flex-col gap-3">
      <h2 id="portal-turno-pedido" ref={titleRef} tabIndex={-1} className={`${sectionTitle} outline-none`}>Pedidos de turno</h2>
      {canAsk && !open && (
        <div className={`${card} flex flex-col gap-3`}>
          <p className="text-base">
            {self
              ? "¿Necesitás un turno? Contanos qué días y horarios te quedan bien y el centro te asigna uno."
              : `¿${child.first_name} necesita un turno? Contanos qué días y horarios les quedan bien y el centro le asigna uno.`}
          </p>
          <Link to="/portal/pedir-turno/$patientId" params={{ patientId: child.id }} className={`${pillPrimary} min-[420px]:self-start`}>
            Pedir un turno{!self && <span className="sr-only"> para {child.first_name}</span>}
          </Link>
        </div>
      )}
      {requests.map((r) => <ApptRequestCard key={r.id} req={r} onChanged={requestChanged} />)}
    </section>
  );
}
