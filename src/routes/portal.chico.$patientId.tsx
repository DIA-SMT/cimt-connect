import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, CircleCheck, Info, Loader2 } from "lucide-react";
import { CENTER } from "@/lib/center";
import { type ApptDTO, type ApptTone, type ChildPageDTO, type HcRequestDTO, portalApi } from "@/lib/portal";
import { AppointmentCard, CallUs, FormAlert, HcRequestCard, PageTitle } from "@/components/portal/ui";
import { TONE_CLASS, card, pillOutline, pillPrimary, sectionTitle } from "@/components/portal/styles";

export const Route = createFileRoute("/portal/chico/$patientId")({
  component: ChicoPage,
});

const isOpenHc = (r: HcRequestDTO) => r.status === "pendiente" || r.status === "lista";

function ChicoPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ChildPageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Con un pedido de copia en curso, esa sección va arriba de los turnos. Se
  // decide al cargar la pantalla (no en cada actualización) para que no salte
  // de lugar mientras la familia pide o cancela
  const [hcFirst, setHcFirst] = useState(false);

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
    if (!quiet) setHcFirst(r.data.hc.requests.some(isOpenHc));
  }, [patientId, navigate]);

  useEffect(() => { void load(); }, [load]);

  function replaceAppt(updated: ApptDTO) {
    setData((d) => d && { ...d, appointments: d.appointments.map((a) => (a.id === updated.id ? updated : a)) });
  }

  function upsertHc(updated: HcRequestDTO) {
    setData((d) => {
      if (!d) return d;
      const known = d.hc.requests.some((r) => r.id === updated.id);
      const requests = known ? d.hc.requests.map((r) => (r.id === updated.id ? updated : r)) : [updated, ...d.hc.requests];
      return { ...d, hc: { ...d.hc, requests } };
    });
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
          {hcFirst && <HcSection key={data.child.id} first data={data} onChanged={upsertHc} onRefresh={() => void load(true)} />}
          {/* Con la copia arriba, los turnos llevan su propio título */}
          <section aria-labelledby="portal-turnos" className={`flex flex-col gap-4 ${hcFirst ? "mt-4" : ""}`}>
            <h2 id="portal-turnos" className={hcFirst ? sectionTitle : "sr-only"}>Próximos turnos</h2>
            {data.appointments.length === 0 ? (
              <p className={`${card} text-base`}>{data.child.self ? "No tenés turnos agendados por ahora. Cuando el centro te asigne uno, lo vas a ver acá." : `${data.child.first_name} no tiene turnos agendados por ahora. Cuando el centro le asigne uno, lo vas a ver acá.`}</p>
            ) : (
              data.appointments.map((a) => <AppointmentCard key={a.id} appt={a} showChild={false} onChanged={replaceAppt} />)
            )}
          </section>
          {!hcFirst && <HcSection key={data.child.id} first={false} data={data} onChanged={upsertHc} onRefresh={() => void load(true)} />}
        </>
      )}
    </div>
  );
}

// Copia de la historia clínica: los pedidos de esta cuenta y el botón para
// pedir una. La copia se prepara en el centro y se entrega en mano, con DNI:
// el portal solo lleva el pedido y su estado.
function HcSection({ data, first, onChanged, onRefresh }: {
  data: ChildPageDTO;
  first: boolean; // va arriba de los turnos
  onChanged: (updated: HcRequestDTO) => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const { child, hc } = data;
  const self = !!child.self;
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tone: ApptTone; text: string } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const askTitleRef = useRef<HTMLHeadingElement>(null);
  const askButtonRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  // Adónde va el foco después de abrir o cerrar la confirmación, o de enviar
  const focusNext = useRef<"ask" | "button" | "done" | null>(null);

  // Se llegó desde "Ver detalle" de un pedido (#copia): la sección se monta
  // recién con los datos cargados, así que acá se la muestra y se le da el
  // foco. Después se saca el #copia de la dirección, así volver a esta
  // página (desde un turno o con "atrás") no salta de nuevo a la copia.
  useEffect(() => {
    if (window.location.hash !== "#copia") return;
    sectionRef.current?.scrollIntoView({ block: "start" });
    titleRef.current?.focus({ preventScroll: true });
    navigate({ to: "/portal/chico/$patientId", params: { patientId: child.id }, replace: true, resetScroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "ask" ? askTitleRef : target === "button" ? askButtonRef : doneRef).current?.focus();
  });

  // Solo un pedido abierto por vez
  const open = hc.requests.some((r) => r.status === "pendiente" || r.status === "lista");
  const canAsk = hc.can_request && !open;

  function openAsk() {
    focusNext.current = "ask";
    setError(null);
    setDone(null);
    setAsking(true);
  }

  function closeAsk() {
    focusNext.current = "button";
    setError(null);
    setAsking(false);
  }

  async function create() {
    setSending(true);
    setError(null);
    const r = await portalApi.hcCreate(child.id);
    setSending(false);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: `/portal/chico/${child.id}` } });
        return;
      }
      // Ya había un pedido en curso (por ejemplo, desde otra pestaña): se muestra
      if (r.code === "HC_OPEN") {
        setAsking(false);
        setDone({ tone: "info", text: r.error });
        focusNext.current = "done";
        onRefresh();
        return;
      }
      setError(r.error);
      return;
    }
    setAsking(false);
    setDone({ tone: "ok", text: "Listo, recibimos tu pedido. Te avisamos acá cuando esté lista." });
    focusNext.current = "done";
    onChanged(r.data);
    onRefresh();
  }

  function requestChanged(updated?: HcRequestDTO) {
    setDone(null);
    if (updated) onChanged(updated);
    onRefresh();
  }

  // scroll-mt: que el encabezado fijo del portal no tape el título al saltar acá
  return (
    <section id="copia" ref={sectionRef} aria-labelledby="portal-hc" className={`flex scroll-mt-20 flex-col gap-3 ${first ? "" : "mt-4"}`}>
      <h2 id="portal-hc" ref={titleRef} tabIndex={-1} className={`${sectionTitle} outline-none`}>
        {self ? "Copia de tu historial" : "Copia del historial del paciente"}
      </h2>

      {done && (
        <div ref={doneRef} tabIndex={-1} role="status"
          className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-base font-semibold outline-none ${TONE_CLASS[done.tone]}`}>
          {done.tone === "ok"
            ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            : <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />}
          <span>{done.text}</span>
        </div>
      )}

      {hc.requests.map((r) => <HcRequestCard key={r.id} req={r} onChanged={requestChanged} />)}

      {canAsk && asking && (
        <div role="group" aria-labelledby="portal-hc-ask" className={`${card} flex flex-col gap-4`}>
          <h3 id="portal-hc-ask" ref={askTitleRef} tabIndex={-1} className="font-display text-lg font-bold leading-snug outline-none">
            {self ? "Pedir una copia de tu historial" : `Pedir una copia del historial de ${child.first_name}`}
          </h3>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-base">
            <li>La prepara el equipo del centro.</li>
            <li>Te la entregamos en mano en el centro ({CENTER.address}). Traé tu DNI: solo se la damos a quien la pidió.</li>
            <li>No la mandamos por el portal ni por WhatsApp.</li>
            <li>Te avisamos acá cuando esté lista.</li>
          </ul>
          <FormAlert>{error}</FormAlert>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <button type="button" onClick={() => void create()} disabled={sending} className={pillPrimary}>
              {sending ? "Enviando…" : "Confirmar pedido"}
            </button>
            <button type="button" onClick={closeAsk} disabled={sending} className={pillOutline}>Volver</button>
          </div>
        </div>
      )}

      {canAsk && !asking && (
        <div className={`${card} flex flex-col gap-3`}>
          <p className="text-base">
            {self ? "Si necesitás una copia de tu historial, pedila acá." : `Si necesitás una copia del historial de ${child.first_name}, pedila acá.`}
            {" "}La preparamos y te la entregamos en mano en el centro.
          </p>
          <button ref={askButtonRef} type="button" onClick={openAsk} className={`${pillPrimary} min-[420px]:self-start`}>
            Pedir una copia
          </button>
        </div>
      )}

      {!hc.can_request && (
        <p className={`${card} text-base text-muted-foreground`}>
          La copia la pueden pedir la madre, el padre o el/la tutor/a, o el propio paciente si es mayor de edad. Si la necesitás, <CallUs />.
        </p>
      )}
    </section>
  );
}
