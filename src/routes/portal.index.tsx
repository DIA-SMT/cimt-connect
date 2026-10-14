import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type LucideIcon, CalendarDays, CircleAlert, CircleCheck, FileHeart, Info, Loader2, ShieldCheck } from "lucide-react";
import {
  type ApptDTO, type ChildDTO, type FamilyClinicalDTO, type HcRequestDTO, type MeDTO, apptDateLabel, portalApi,
} from "@/lib/portal";
import { AppointmentCard, CallUs, PageTitle } from "@/components/portal/ui";
import { HcRequestCard } from "@/components/portal/HcRequestCard";
import {
  TONE_CLASS, card, clinicalNoticeSnoozed, newChip, pillOutline, pillPrimary, sectionTitle, snoozeClinicalNotice,
  tileLink, tileWideLink,
} from "@/components/portal/styles";

export const Route = createFileRoute("/portal/")({
  component: InicioPage,
});

// Cada cosa en un solo lugar: los pedidos de turno se ven en "Turnos" y los
// pedidos de copia del historial, en "Mi información". El inicio solo avisa,
// arriba de todo, cuando hay una copia lista para retirar o para descargar o
// una que no pudimos preparar, y muestra entero el pedido de copia de una
// persona cuya página ya no se puede abrir (por ejemplo, con el alta cargada:
// el derecho a la copia sigue)

// Copia con algo para hacer: retirarla en el centro o descargarla del portal
// (enviada y todavía disponible). null: nada por ahora
type CopyAction = "retirar" | "descargar";
function copyAction(r: HcRequestDTO): CopyAction | null {
  if (r.status === "lista") return "retirar";
  if (r.status === "enviada" && r.documents.length > 0) return "descargar";
  return null;
}

// Pedidos sin otro lugar: primero las copias para retirar o descargar,
// después las que están en curso y al final lo ya resuelto
const requestRank = (r: HcRequestDTO) => (copyAction(r) ? 0 : r.status === "pendiente" ? 1 : 2);

function InicioPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<MeDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Ahora no" del aviso de la información de salud (30 días, en este navegador).
  // Se lee al montar: el aviso recién se muestra con los datos cargados
  const [clinicalSnoozed, setClinicalSnoozed] = useState(true);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setClinicalSnoozed(clinicalNoticeSnoozed()); }, []);

  // quiet: actualiza después de cancelar un pedido sin tapar la pantalla si falla
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setError(null);
    const r = await portalApi.me();
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: "/portal" }, replace: true });
        return;
      }
      if (!quiet) setError("No pudimos cargar tus turnos. Probá de nuevo en un rato.");
      return;
    }
    setData(r.data);
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  function replaceAppt(updated: ApptDTO) {
    setData((d) => d && { ...d, week: d.week.map((a) => (a.id === updated.id ? updated : a)) });
  }

  // Pedido cancelado acá (o que cambió mientras tanto): se ve enseguida y se recarga todo
  function requestChanged(updated?: HcRequestDTO) {
    if (updated) setData((d) => d && { ...d, requests: d.requests.map((x) => (x.id === updated.id ? updated : x)) });
    void load(true);
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

  // Copias para retirar o descargar: un aviso arriba de todo (hay que hacer
  // algo). El detalle (cómo retirarla, descargarla, cancelar) está en "Mi
  // información" de esa persona o, si su página ya no se puede abrir, más
  // abajo, en "Tus pedidos"
  const ready = data.requests.filter((r) => copyAction(r));
  // Por persona, lo que hay para hacer (para la marca de su acceso). Si hubiera
  // las dos cosas, descargar va primero: se hace desde acá mismo
  const readyFor = new Map<string, CopyAction>();
  for (const r of ready) {
    const action = copyAction(r)!;
    if (readyFor.get(r.patient_id) !== "descargar") readyFor.set(r.patient_id, action);
  }
  // Personas con algún pedido de copia de esta cuenta (aunque ya no pueda pedir
  // otra, el pedido se sigue viendo en su "Mi información")
  const hcIds = new Set(data.requests.map((r) => r.patient_id));
  // Copias que no pudimos preparar (rechazadas, mientras el pedido se sigue
  // viendo): una línea en el mismo aviso, que lleva al pedido. Sin página a la
  // que ir no hace falta: el pedido completo ya está en "Tus pedidos"
  const rejected = data.requests.filter((r) => r.status === "rechazada" && r.child_page);
  // Lo listo va en verde y lo rechazado, en el tono de su estado
  const readyNotice = (ready.length > 0 || rejected.length > 0) && (
    <section aria-labelledby="portal-copia-lista" className="flex flex-col gap-2">
      <h2 id="portal-copia-lista" className="sr-only">Avisos</h2>
      {ready.length > 0 && (
        <div className={`flex flex-col gap-1 rounded-2xl px-4 py-3 ${TONE_CLASS.ok}`}>
          {ready.map((r) => <CopyNotice key={r.id} req={r} />)}
        </div>
      )}
      {rejected.length > 0 && (
        <div className={`flex flex-col gap-1 rounded-2xl px-4 py-3 ${TONE_CLASS.bad}`}>
          {rejected.map((r) => <CopyNotice key={r.id} req={r} />)}
        </div>
      )}
    </section>
  );

  // Pedidos de copia de personas cuya página ya no se puede abrir: no tienen
  // otro lugar, así que el pedido completo se ve acá
  const orphan = data.requests.filter((r) => !r.child_page).sort((a, b) => requestRank(a) - requestRank(b));
  const requestsSection = orphan.length > 0 && (
    <section aria-labelledby="portal-pedidos" className="flex flex-col gap-3">
      <h2 id="portal-pedidos" className={sectionTitle}>Tus pedidos</h2>
      {orphan.map((r) => (
        <HcRequestCard key={r.id} req={r} title={r.is_self ? "Copia de tu historial" : `Copia del historial de ${r.child_first_name}`}
          onChanged={requestChanged} />
      ))}
    </section>
  );

  function clinicalNotNow() {
    snoozeClinicalNotice();
    setClinicalSnoozed(true);
    // El aviso desaparece: el foco vuelve al título de la página
    pageRef.current?.querySelector("h1")?.focus();
  }

  // Información de salud (solo con la etapa prendida en el servidor): la
  // novedad hasta que la activa (o toca "Ahora no"), y después un acceso directo
  const clinical = data.clinical;
  const clinicalSection = !clinical ? null
    : clinical.consent.accepted ? (
      <Link to="/portal/informacion-salud"
        className="flex min-h-12 items-center gap-2 self-start text-base font-bold text-primary underline-offset-2 hover:underline">
        <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
        Información de salud: activada →
      </Link>
    ) : data.children.length > 0 && !clinicalSnoozed ? (
      <ClinicalNovelty clinical={clinical} onNotNow={clinicalNotNow} />
    ) : null;
  const infoOn = !!clinical?.features.includes("info");
  // Pedir un turno: solo se invita si el servidor ya tiene los pedidos de turno
  // y la cuenta tiene personas vinculadas (si no, no hay desde dónde pedirlo)
  const canAskAppt = data.can_request_appts && data.children.length > 0;

  return (
    <div ref={pageRef} className="flex flex-col gap-6">
      <div>
        <PageTitle>Hola, {data.guardian_first_name}</PageTitle>
        <p className="-mt-2 flex items-start gap-2 rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-base text-[color:var(--primary-deep)]">
          <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {onlySelf
              ? canAskAppt
                ? "El centro asigna los días y horarios: si necesitás un turno, pedilo desde «Mis turnos». Si no podés venir, avisanos con «No voy a poder ir»."
                : "El centro asigna los días y horarios. Si no podés venir, avisanos con «No voy a poder ir»."
              : canAskAppt
                ? "El centro asigna los días y horarios: si necesitan un turno, pedilo desde «Turnos». Si no pueden venir, avisanos con «No vamos a poder ir»."
                : "El centro asigna los días y horarios. Si no pueden venir, avisanos con «No vamos a poder ir»."}
          </span>
        </p>
      </div>

      {/* Una copia para retirar o descargar (o rechazada) va antes que la novedad */}
      {readyNotice}

      {clinicalSection}

      {data.children.length === 0 ? (
        <div className={card}>
          <p className="text-base">Todavía no hay turnos vinculados a tu cuenta. Si te parece un error, <CallUs /> (solo llamadas).</p>
        </div>
      ) : (
        <>
          <section aria-labelledby="portal-semana" className="flex flex-col gap-3">
            <h2 id="portal-semana" className={sectionTitle}>Esta semana</h2>
            {data.week.length === 0 ? (
              <p className={`${card} text-base text-muted-foreground`}>No hay turnos en los próximos 7 días.</p>
            ) : (
              data.week.map((a) => <AppointmentCard key={a.id} appt={a} onChanged={replaceAppt} />)
            )}
          </section>

          <section aria-labelledby="portal-chicos" className="flex flex-col gap-3">
            <h2 id="portal-chicos" className={sectionTitle}>{onlySelf ? "Tus turnos" : anySelf ? "Tus turnos y los de tus chicos" : "Tus chicos"}</h2>
            {data.children.map((c) => (
              <PersonCard key={c.id} child={c} infoOn={infoOn} canAskAppt={canAskAppt}
                hasHc={hcIds.has(c.id)} copy={readyFor.get(c.id) ?? null} />
            ))}
          </section>
        </>
      )}

      {requestsSection}
    </div>
  );
}

// Una línea del aviso de arriba: qué pasa con la copia (lista para retirar o
// descargar, o que no la pudimos preparar) y "Ver →" al pedido, en "Mi
// información" de esa persona
function CopyNotice({ req: r }: { req: HcRequestDTO }) {
  const whose = r.is_self ? "de tu historial" : `del historial de ${r.child_first_name}`;
  const action = copyAction(r);
  const Icon = action ? CircleCheck : CircleAlert;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3">
      <p className="flex min-h-11 items-start gap-2 py-1 text-base font-semibold">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <span>
          {action === "descargar"
            ? `La copia ${whose} ya está para descargar.`
            : action === "retirar"
              ? `La copia ${whose} está lista para retirar en el centro.`
              : `No pudimos preparar la copia ${whose}.`}
        </span>
      </p>
      {/* Sin página a la que ir, el pedido completo está en "Tus pedidos" */}
      {r.child_page && (
        <Link to="/portal/informacion/$patientId" params={{ patientId: r.patient_id }} hash="copia"
          className="ml-7 inline-flex min-h-11 items-center text-base font-bold underline underline-offset-2">
          Ver<span className="sr-only"> {action ? "la copia" : "el pedido de la copia"} {whose}</span>&nbsp;→
        </Link>
      )}
    </div>
  );
}

// Tarjeta de cada persona: su próximo turno y, abajo, un cuadradito por cada
// cosa que puede ver: sus turnos y "Mi información" (la copia del historial y,
// con la etapa "info", lo que compartió el equipo; más adelante, ejercicios y
// medallas). canAskAppt: el servidor ya tiene los pedidos de turno (si no, no
// se invita a pedirlos) · hasHc: esta cuenta tiene pedidos de copia de esa
// persona · copy: alguno está listo para retirar o para descargar
function PersonCard({ child: c, infoOn, canAskAppt, hasHc, copy }: {
  child: ChildDTO; infoOn: boolean; canAskAppt: boolean; hasHc: boolean; copy: CopyAction | null;
}) {
  // "Mi información": para quien puede pedir la copia del historial (titular
  // o representante legal), con la etapa "info" o sin ella, y para quien ya
  // tiene pedidos que seguir. Si todavía no hay nada clínico para ver, la
  // página lo explica sin dar el motivo
  const showInfo = c.can_request_hc || hasHc;
  const fresh = (c.clinical?.info_new ?? 0) > 0;
  const of = c.self ? "" : ` de ${c.first_name}`;
  // Un solo acceso (sin derecho a la copia): una fila de ancho completo
  const wide = !showInfo;
  const link = wide ? tileWideLink : tileLink;
  const infoHint = infoOn ? "Lo que compartió el equipo y la copia del historial" : c.self ? "Copia de tu historial" : "Copia del historial";
  const noNext = c.self
    ? `No tenés más turnos agendados por ahora. Cuando el centro te asigne uno, lo vas a ver acá.${canAskAppt ? " Si necesitás uno, pedilo desde «Mis turnos»." : ""}`
    : `${c.first_name} no tiene más turnos agendados por ahora. Cuando el centro le asigne uno, lo vas a ver acá.${canAskAppt ? " Si necesitás uno, pedilo desde «Turnos»." : ""}`;
  return (
    <article className={`${card} flex flex-col gap-4`}>
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-xl font-bold">{c.self ? "Vos" : c.first_name}</h3>
        <p className="text-base text-muted-foreground">
          {c.next ? <>Próximo después de esta semana: <b className="text-foreground">{apptDateLabel(c.next)}</b></> : noNext}
        </p>
      </div>
      <ul aria-label={c.self ? "Tus accesos" : `Accesos de ${c.first_name}`} className={wide ? "flex" : "grid grid-cols-2 gap-3"}>
        <li className="flex min-w-0 flex-1">
          <Link to="/portal/chico/$patientId" params={{ patientId: c.id }} className={link}>
            <Tile icon={CalendarDays} label={c.self ? "Mis turnos" : "Turnos"} srLabel={of} hint={canAskAppt ? "Ver, avisar y pedir turno" : "Ver todos y avisar"} wide={wide} />
          </Link>
        </li>
        {showInfo && (
          <li className="flex min-w-0">
            <Link to="/portal/informacion/$patientId" params={{ patientId: c.id }} className={link}>
              <Tile icon={FileHeart} label={c.self ? "Mi información" : "Información"} srLabel={of}
                hint={infoHint} fresh={fresh} copy={copy} />
            </Link>
          </li>
        )}
      </ul>
    </article>
  );
}

// Contenido de un acceso: ícono, nombre y una ayuda corta. fresh: hay algo
// que esta cuenta todavía no abrió ("Nuevo") · copy: hay una copia del
// historial lista para retirar o para descargar ("Copia lista") · wide: es el
// único de la tarjeta y va en una fila
function Tile({ icon: Icon, label, srLabel, hint, fresh = false, copy = null, wide = false }: {
  icon: LucideIcon; label: string; srLabel: string; hint: string; fresh?: boolean; copy?: CopyAction | null; wide?: boolean;
}) {
  const icon = (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm">
      <Icon className="h-6 w-6" aria-hidden="true" />
    </span>
  );
  // En el cuadradito, "Nuevo" va en la esquina: así no lo ensancha
  const chip = fresh && (
    <span aria-hidden="true" className={wide ? newChip : `${newChip} absolute right-3 top-3`}>Nuevo</span>
  );
  const text = (
    <span className={`flex min-w-0 flex-col gap-0.5 ${wide ? "flex-1" : ""}`}>
      <span className="break-words text-base font-bold leading-snug">
        {label}<span className="sr-only">{srLabel}</span>
        {fresh && <span className="sr-only">, hay información nueva</span>}
        {copy && (
          <span className="sr-only">
            {copy === "descargar" ? ", la copia del historial está para descargar" : ", la copia del historial está lista para retirar"}
          </span>
        )}
      </span>
      <span className="text-sm font-normal leading-snug opacity-80">{hint}</span>
      {/* Debajo de la ayuda (en la esquina no entra junto a "Nuevo") */}
      {copy && (
        <span aria-hidden="true"
          className={`mt-1 inline-flex self-start rounded-full px-2.5 py-0.5 text-sm font-bold print:hidden ${TONE_CLASS.ok}`}>
          Copia lista
        </span>
      )}
    </span>
  );
  return wide
    ? <>{icon}{text}{chip}<span aria-hidden="true" className="shrink-0">→</span></>
    : <>{icon}{chip}{text}</>;
}

// Aviso de la información de salud en el portal, hasta que la cuenta la activa
function ClinicalNovelty({ clinical, onNotNow }: { clinical: FamilyClinicalDTO; onNotNow: () => void }) {
  // Ya la había activado con un aviso anterior: tiene que aceptar el nuevo
  const renew = !!clinical.consent.version && clinical.consent.version !== clinical.consent.current_version;
  return (
    <section aria-labelledby="portal-salud-novedad" className={`${card} flex flex-col gap-3 border-primary/30`}>
      <h2 id="portal-salud-novedad" className="flex items-start gap-2 font-display text-lg font-bold leading-snug">
        <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
        {renew
          ? "Actualizamos el aviso de la información de salud"
          : "Novedad: tu profesional va a poder compartir información de salud en el portal"}
      </h2>
      <p className="text-base text-muted-foreground">
        {renew
          ? "Para seguir viéndola, leelo y aceptalo de nuevo."
          : "Es optativo: si no la activás, ves los turnos igual que siempre."}
      </p>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <Link to="/portal/informacion-salud" className={pillPrimary}>{renew ? "Ver el aviso" : "Ver cómo funciona"}</Link>
        <button type="button" onClick={onNotNow} className={pillOutline}>Ahora no</button>
      </div>
    </section>
  );
}
