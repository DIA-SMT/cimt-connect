import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { CircleCheck, Info } from "lucide-react";
import { CENTER } from "@/lib/center";
import { type ApptTone, type ChildPageDTO, type HcChannel, type HcRequestDTO, portalApi } from "@/lib/portal";
import { CallUs, FormAlert } from "./ui";
import { HcRequestCard } from "./HcRequestCard";
import { TONE_CLASS, card, pillOutline, pillPrimary, sectionTitle } from "./styles";

// Copia de la historia clínica de una persona: los pedidos de esta cuenta y
// el botón para pedir una. Vive en "Mi información" y funciona siempre, aunque
// la parte clínica de esa pantalla esté cerrada (sin activar la información de
// salud, sin confirmar la contraseña o con esa etapa apagada en el servidor):
// pedir la copia es un derecho del paciente (Ley 26.529), no hace falta nada
// más. La copia se prepara en el centro y se entrega en mano, con DNI.
// Con la etapa E1 (hc.digital.offered) también se puede elegir recibirla en
// el portal: la Dirección la firma digitalmente y se descarga acá, con la
// contraseña. Si esta cuenta todavía no puede (blocked), esa opción se ve
// desactivada con el motivo; "not_available" la oculta (sin dar el motivo: por
// ejemplo, con lo clínico del paciente en pausa) y queda solo en mano.
//
// Los datos (child, hc) son los de la página de la persona
// (portalApi.childAppointments). onChanged: un pedido nuevo o que cambió, para
// verlo enseguida · onRefresh: volver a cargar los pedidos sin tapar la pantalla
// · onReauthenticated: se volvió a poner la contraseña para descargar (la
// página aprovecha para mostrar lo que la pedía también).

// Opción grande de "¿Cómo la querés recibir?" (como choiceClass, con el texto
// de ayuda debajo del nombre)
const optionClass = (on: boolean) =>
  `flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left text-base transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2 ${
    on ? "border-primary bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]" : "border-border/60 bg-card hover:border-primary/50"
  }`;
const optionOffClass =
  "flex min-h-12 cursor-not-allowed items-start gap-3 rounded-2xl border-2 border-dashed border-border/60 bg-muted px-4 py-3 text-left text-base text-muted-foreground";

function Dot({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true"
      className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${on ? "border-[6px] border-primary" : "border-muted-foreground"}`} />
  );
}

export function HcSection({ child, hc, onChanged, onRefresh, onReauthenticated, className = "" }: {
  child: ChildPageDTO["child"];
  hc: ChildPageDTO["hc"];
  onChanged: (updated: HcRequestDTO) => void;
  onRefresh: () => void;
  onReauthenticated?: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const self = !!child.self;
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tone: ApptTone; text: string } | null>(null);
  // Cómo la quiere recibir (solo si se ofrece la copia digital)
  const [channel, setChannel] = useState<HcChannel | null>(null);
  const [channelError, setChannelError] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const askTitleRef = useRef<HTMLHeadingElement>(null);
  const askButtonRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  // Adónde va el foco después de abrir o cerrar la confirmación, o de enviar
  const focusNext = useRef<"ask" | "button" | "done" | null>(null);

  // Se llegó desde el aviso del inicio (#copia): la sección se monta recién
  // con los datos cargados, así que acá se la muestra y se le da el foco.
  // Después se saca el #copia de la dirección, así volver a esta página (con
  // "atrás", por ejemplo) no salta de nuevo a la copia.
  useEffect(() => {
    if (window.location.hash !== "#copia") return;
    sectionRef.current?.scrollIntoView({ block: "start" });
    titleRef.current?.focus({ preventScroll: true });
    navigate({ to: "/portal/informacion/$patientId", params: { patientId: child.id }, replace: true, resetScroll: false });
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
  // ¿Se puede elegir? Con "not_available" no se muestra la opción del portal
  // y queda el pedido en mano, como siempre
  const blocked = hc.digital.blocked;
  const choose = hc.digital.offered && blocked !== "not_available";
  const portalOk = choose && !blocked;
  // Sin poder recibirla en el portal, la única opción es en mano
  const chosen: HcChannel | null = !choose ? "mano" : portalOk ? channel : "mano";

  function openAsk() {
    focusNext.current = "ask";
    setError(null);
    setChannelError(false);
    setDone(null);
    setAsking(true);
  }

  function closeAsk() {
    focusNext.current = "button";
    setError(null);
    setChannelError(false);
    setAsking(false);
  }

  async function create() {
    if (!chosen) {
      setError(null);
      setChannelError(true);
      firstOptionRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    setChannelError(false);
    const r = await portalApi.hcCreate(child.id, chosen);
    setSending(false);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: pathname } });
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
      // Ya no se puede recibir en el portal (cambió mientras tanto): se vuelve
      // a cargar, así la opción se ve como está ahora
      if (r.code === "DIGITAL_BLOCKED") {
        setChannel(null);
        onRefresh();
      }
      return;
    }
    setAsking(false);
    setChannel(null);
    setDone({
      tone: "ok",
      text: chosen === "portal"
        ? "Listo, recibimos tu pedido. Te avisamos acá cuando la puedas descargar."
        : "Listo, recibimos tu pedido. Te avisamos acá cuando esté lista.",
    });
    focusNext.current = "done";
    onChanged(r.data);
    onRefresh();
  }

  function requestChanged(updated?: HcRequestDTO) {
    setDone(null);
    if (updated) onChanged(updated);
    onRefresh();
  }

  function pick(c: HcChannel) {
    setChannel(c);
    setChannelError(false);
  }

  // Por qué todavía no se puede recibir en el portal (consent o verify)
  const blockedReason = blocked === "consent"
    ? "Para recibirla en el portal, primero activá la información de salud."
    : `Para recibirla en el portal, la primera vez tenés que pasar por el centro con tu DNI.${
      self ? "" : " Si sos mamá, papá o tutor/a, traé también la partida o el documento que lo acredite."}`;

  const choice = choose && (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-base font-bold">¿Cómo la querés recibir?</legend>
      {portalOk ? (
        <label className={optionClass(chosen === "portal")}>
          <input ref={firstOptionRef} type="radio" name={`hc-channel-${child.id}`} value="portal" checked={chosen === "portal"}
            onChange={() => pick("portal")} aria-describedby="portal-hc-portal-help" className="sr-only" />
          <Dot on={chosen === "portal"} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-bold">En el portal</span>
            <span id="portal-hc-portal-help" className="text-sm text-muted-foreground">
              La descargás acá, con la firma digital de la Dirección. Vas a tener que poner tu contraseña para bajarla.
            </span>
          </span>
        </label>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className={optionOffClass}>
            <input type="radio" name={`hc-channel-${child.id}`} value="portal" checked={false} disabled
              aria-describedby="portal-hc-portal-help" className="sr-only" />
            <Dot on={false} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-bold">En el portal</span>
              <span id="portal-hc-portal-help" className="text-sm">{blockedReason}</span>
            </span>
          </label>
          {blocked === "consent" && (
            <Link to="/portal/informacion-salud"
              className="inline-flex min-h-11 items-center self-start px-1 text-base font-bold text-primary underline-offset-2 hover:underline">
              Activar la información de salud →
            </Link>
          )}
        </div>
      )}
      <label className={optionClass(chosen === "mano")}>
        <input ref={portalOk ? undefined : firstOptionRef} type="radio" name={`hc-channel-${child.id}`} value="mano"
          checked={chosen === "mano"} onChange={() => pick("mano")} aria-describedby="portal-hc-mano-help" className="sr-only" />
        <Dot on={chosen === "mano"} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-bold">En mano, en el centro</span>
          <span id="portal-hc-mano-help" className="text-sm text-muted-foreground">
            La retirás en {CENTER.address} con tu DNI.
          </span>
        </span>
      </label>
    </fieldset>
  );

  // scroll-mt: que el encabezado fijo del portal no tape el título al saltar acá.
  // No se imprime: al imprimir un informe sale solo el informe
  return (
    <section id="copia" ref={sectionRef} aria-labelledby="portal-hc"
      className={`flex scroll-mt-20 flex-col gap-3 print:hidden ${className}`}>
      <h2 id="portal-hc" ref={titleRef} tabIndex={-1} className={`${sectionTitle} outline-none`}>
        {self ? "Copia de tu historial" : `Copia del historial de ${child.first_name}`}
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

      {hc.requests.map((r) => (
        <HcRequestCard key={r.id} req={r} onChanged={requestChanged} onReauthenticated={onReauthenticated} />
      ))}

      {canAsk && asking && (
        <div role="group" aria-labelledby="portal-hc-ask" className={`${card} flex flex-col gap-4`}>
          <h3 id="portal-hc-ask" ref={askTitleRef} tabIndex={-1} className="font-display text-lg font-bold leading-snug outline-none">
            {self ? "Pedir una copia de tu historial" : `Pedir una copia del historial de ${child.first_name}`}
          </h3>
          {choose ? (
            <>
              <p className="text-base">La prepara el equipo del centro y te avisamos acá cuando esté lista.</p>
              {choice}
            </>
          ) : (
            <ul className="flex list-disc flex-col gap-2 pl-5 text-base">
              <li>La prepara el equipo del centro.</li>
              <li>Te la entregamos en mano en el centro ({CENTER.address}). Traé tu DNI: solo se la damos a quien la pidió.</li>
              <li>No la mandamos por el portal ni por WhatsApp.</li>
              <li>Te avisamos acá cuando esté lista.</li>
            </ul>
          )}
          <FormAlert>{error ?? (channelError ? "Elegí cómo la querés recibir." : null)}</FormAlert>
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
          {/* Con la opción del portal a la vista (aunque todavía no se pueda
              elegir), sin prometer la entrega en mano */}
          <p className="text-base">
            {self ? "Si necesitás una copia de tu historial, pedila acá" : `Si necesitás una copia del historial de ${child.first_name}, pedila acá`}
            {choose
              ? ": la podés recibir en el portal o en mano en el centro."
              : ". La preparamos y te la entregamos en mano en el centro."}
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
