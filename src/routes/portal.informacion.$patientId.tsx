import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { CENTER } from "@/lib/center";
import { type ApiResult, type ChildPageDTO, type HcRequestDTO, type InfoDTO, portalApi, retryLabel } from "@/lib/portal";
import { HcSection } from "@/components/portal/HcSection";
import { InfoEmpty, InfoView } from "@/components/portal/InfoView";
import { FormAlert, PageTitle, PasswordField } from "@/components/portal/ui";
import { card, pillOutline, pillPrimary } from "@/components/portal/styles";

// "Mi información" de una persona: lo que el profesional publicó para la
// familia (la parte clínica) y la copia de su historial (cada cosa en un solo
// lugar: los turnos van en "Turnos").
//   - La copia se pide siempre desde acá: es un derecho del paciente, no hace
//     falta activar la información de salud ni volver a poner la contraseña
//     (sí para recibirla en el portal y descargarla: lo resuelve HcSection).
//     Sus datos vienen de la página de la persona (childAppointments): si esa
//     da 404, la persona no está en la cuenta.
//   - La parte clínica (info) necesita haber activado la información de salud
//     y confirmar la contraseña cada tanto (403 REAUTH). Lo que no se puede ver
//     se explica con muy pocas respuestas: NOT_AVAILABLE da un texto neutro
//     (nunca el motivo real). Con la etapa "info" apagada en el servidor
//     (info_on: false en la página de la persona) ni se pide: queda solo la
//     copia. Un 404 (una cuenta que no la ve) también la oculta.

export const Route = createFileRoute("/portal/informacion/$patientId")({
  component: InformacionPage,
});

type Clinical =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "hidden" }
  | { kind: "ok"; info: InfoDTO }
  | { kind: "reauth" }
  | { kind: "consent" }
  | { kind: "verify"; message: string }
  | { kind: "empty" };

// Lo que se muestra de la parte clínica según la respuesta (sin el 401, que
// lleva a ingresar)
function clinicalOf(r: ApiResult<InfoDTO>): Clinical {
  if (r.ok) return { kind: "ok", info: r.data };
  if (r.status === 404) return { kind: "hidden" };
  if (r.status !== 403) return { kind: "error" };
  switch (r.code) {
    case "REAUTH": return { kind: "reauth" };
    case "CONSENT": return { kind: "consent" };
    case "VERIFY": return { kind: "verify", message: r.error };
    default: return { kind: "empty" };
  }
}

function InformacionPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const here = `/portal/informacion/${patientId}`;
  // La página de la persona (nombre y copia del historial)
  const [data, setData] = useState<ChildPageDTO | null>(null);
  const [clinical, setClinical] = useState<Clinical>({ kind: "loading" });
  const [failure, setFailure] = useState<{ kind: "error" } | { kind: "notfound"; message: string } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // Después de confirmar la contraseña, el foco va al título (el formulario desaparece)
  const focusTitle = useRef(false);
  // Respuesta de la última carga (si se cambia de persona, lo viejo no pisa lo nuevo)
  const seq = useRef(0);

  const toLogin = useCallback(() => {
    navigate({ to: "/portal/ingresar", search: { volver: here }, replace: true });
  }, [navigate, here]);

  // Las dos cosas juntas, para que la pantalla aparezca entera (y el salto a
  // #copia caiga en su lugar). La parte clínica se pide solo si la página de
  // la persona dice que el servidor la tiene prendida (info_on)
  const load = useCallback(async () => {
    const n = ++seq.current;
    setFailure(null);
    setData(null);
    setClinical({ kind: "loading" });
    const page = await portalApi.childAppointments(patientId);
    if (n !== seq.current) return;
    if (!page.ok) {
      if (page.status === 401) toLogin();
      else setFailure(page.status === 404 ? { kind: "notfound", message: page.error } : { kind: "error" });
      return;
    }
    if (page.data.info_on === false) {
      setData(page.data);
      setClinical({ kind: "hidden" });
      return;
    }
    const info = await portalApi.info(patientId);
    if (n !== seq.current) return;
    if (!info.ok && info.status === 401) {
      toLogin();
      return;
    }
    setData(page.data);
    setClinical(clinicalOf(info));
  }, [patientId, toLogin]);

  // Solo la parte clínica (después de confirmar la contraseña, o al reintentar)
  const loadInfo = useCallback(async () => {
    const n = seq.current;
    const r = await portalApi.info(patientId);
    if (n !== seq.current) return;
    if (!r.ok && r.status === 401) {
      toLogin();
      return;
    }
    setClinical(clinicalOf(r));
  }, [patientId, toLogin]);

  // Solo la copia, después de pedirla o cancelarla (sin tapar la pantalla si
  // falla). Si mientras tanto se apagó la etapa "info", la parte clínica se oculta
  const refreshHc = useCallback(async () => {
    const n = seq.current;
    const r = await portalApi.childAppointments(patientId);
    if (n !== seq.current) return;
    if (r.ok) {
      setData(r.data);
      if (r.data.info_on === false) setClinical({ kind: "hidden" });
    } else if (r.status === 401) toLogin();
  }, [patientId, toLogin]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!focusTitle.current) return;
    focusTitle.current = false;
    pageRef.current?.querySelector("h1")?.focus();
  });

  function upsertHc(updated: HcRequestDTO) {
    setData((d) => {
      if (!d) return d;
      const known = d.hc.requests.some((r) => r.id === updated.id);
      const requests = known ? d.hc.requests.map((r) => (r.id === updated.id ? updated : r)) : [updated, ...d.hc.requests];
      return { ...d, hc: { ...d.hc, requests } };
    });
  }

  function retryInfo() {
    setClinical({ kind: "loading" });
    void loadInfo();
  }

  async function reauthenticated() {
    focusTitle.current = true;
    await loadInfo();
  }

  // Se volvió a poner la contraseña para descargar la copia: si la parte
  // clínica la estaba pidiendo, se carga ya (sin escribirla dos veces). El foco
  // se queda en la copia, que es lo que se estaba haciendo
  function hcReauthenticated() {
    if (clinical.kind === "reauth") void loadInfo();
  }

  const back = (
    <Link to="/portal" className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary print:hidden">
      <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Inicio
    </Link>
  );

  if (failure) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className={`${card} flex flex-col gap-3`} role="alert">
          <p className="text-base">
            {failure.kind === "notfound" ? failure.message : "No pudimos cargar la información. Probá de nuevo en un rato."}
          </p>
          {failure.kind === "error" && <button type="button" onClick={() => void load()} className={pillOutline}>Reintentar</button>}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
          <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
          Cargando…
        </div>
      </div>
    );
  }

  const { child, hc } = data;
  const self = !!child.self;
  const showClinical = clinical.kind !== "hidden";
  const title = self ? "Mi información" : `Información de ${child.first_name}`;
  // Con la parte clínica a la vista, la copia se nombra como un agregado; sin
  // ella, la pantalla es solo para pedir la copia
  const askCopy = hc.can_request ? `pedís la copia ${self ? "de tu historial" : `del historial de ${child.first_name}`}.` : "";
  const sub = showClinical
    ? `Lo que el equipo del CIMT compartió con vos sobre ${self ? "tu tratamiento" : `el tratamiento de ${child.first_name}`}.${
      askCopy && ` Acá también ${askCopy}`}`
    : askCopy ? `Acá ${askCopy}` : undefined;

  return (
    <div ref={pageRef} className="flex flex-col gap-4">
      {back}
      <PageTitle sub={sub}>{title}</PageTitle>

      {clinical.kind === "loading" ? (
        <div role="status" className="flex items-center gap-3 py-6 text-base text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
          Cargando…
        </div>
      ) : clinical.kind === "error" ? (
        <div className={`${card} flex flex-col gap-3`} role="alert">
          <p className="text-base">No pudimos cargar la información de salud. Probá de nuevo en un rato.</p>
          <button type="button" onClick={retryInfo} className={`${pillOutline} min-[420px]:self-start`}>Reintentar</button>
        </div>
      ) : clinical.kind === "ok" ? (
        <InfoView info={clinical.info} />
      ) : clinical.kind === "reauth" ? (
        <Reauth here={here} onDone={reauthenticated} />
      ) : clinical.kind === "consent" ? (
        <div className={`${card} flex flex-col gap-3`}>
          <p className="text-base">Para ver la información de salud, primero tenés que activarla.</p>
          <Link to="/portal/informacion-salud" className={`${pillPrimary} min-[420px]:self-start`}>
            Activar la información de salud
          </Link>
        </div>
      ) : clinical.kind === "verify" ? (
        <div className={`${card} flex flex-col gap-2`}>
          <p className="text-base">{clinical.message}</p>
          {!self && (
            <p className="text-base">Si sos mamá, papá o tutor/a, traé también la partida o el documento que lo acredite.</p>
          )}
          <p className="text-base text-muted-foreground">{CENTER.address} · {CENTER.hoursLong}</p>
        </div>
      ) : clinical.kind === "empty" ? (
        <InfoEmpty self={self} />
      ) : null}

      {/* La copia funciona siempre, aunque la parte clínica esté cerrada */}
      <HcSection key={child.id} child={child} hc={hc} onChanged={upsertHc} onRefresh={() => void refreshHc()}
        onReauthenticated={hcReauthenticated} className={showClinical ? "mt-4" : ""} />
    </div>
  );
}

// "Volvé a poner tu contraseña" (cada tanto, para ver información de salud).
// Pedir la copia del historial no la necesita; descargarla (copia digital) sí,
// y la tarjeta del pedido la pide ahí mismo (esa confirmación también abre
// esta parte: hcReauthenticated)
function Reauth({ here, onDone }: { here: string; onDone: () => Promise<void> }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState(false);
  const [sending, setSending] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPasswordError(false);
    if (!password) {
      setError("Escribí tu contraseña del portal.");
      setPasswordError(true);
      passwordRef.current?.focus();
      return;
    }
    setSending(true);
    const r = await portalApi.reauth(password);
    if (!r.ok) {
      setSending(false);
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: here } });
        return;
      }
      if (r.code === "PASSWORD") {
        setError(r.error);
        setPasswordError(true);
        passwordRef.current?.focus();
      } else if (r.status === 429) {
        setError(`Hiciste muchos intentos. Probá de nuevo ${retryLabel(r.retry_at)}.`);
      } else {
        setError(r.error);
      }
      return;
    }
    setPassword("");
    // Se queda en "Confirmando…" hasta que se ve la información
    await onDone();
    setSending(false);
  }

  return (
    <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-4`}>
      <p className="text-base">Para ver la información de salud, volvé a poner tu contraseña.</p>
      <PasswordField id="portal-info-password" label="Tu contraseña" value={password} inputRef={passwordRef}
        onChange={(v) => { setPassword(v); setPasswordError(false); }} invalid={passwordError}
        help="La misma con la que entrás al portal. Así confirmamos que sos vos." />
      <FormAlert>{error}</FormAlert>
      <button type="submit" disabled={sending} className={`${pillPrimary} min-[420px]:self-start`}>
        {sending ? "Confirmando…" : "Continuar"}
      </button>
    </form>
  );
}
