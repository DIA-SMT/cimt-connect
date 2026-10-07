import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronLeft, CircleCheck, Loader2 } from "lucide-react";
import {
  type ApptDTO, type ReasonCode, type ResponseKind,
  CONFIRM_WINDOW_DAYS, REASONS, REASON_TEXT_MAX, apptDateLabel, apptStatus, portalApi, shortDayLabel, stampLabel,
} from "@/lib/portal";
import { CallUs, FormAlert, PageTitle, StatusChip } from "@/components/portal/ui";
import { apptMeta, card, inputClass, pillOutline, pillPrimary } from "@/components/portal/styles";

export const Route = createFileRoute("/portal/turno/$appointmentId")({
  component: TurnoPage,
});

const optionClass = (on: boolean, disabled = false) =>
  `flex min-h-12 w-full items-center gap-3 rounded-2xl border-2 px-4 py-2 text-left text-base font-bold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-2 ${
    disabled ? "cursor-not-allowed border-border/60 bg-muted text-muted-foreground" :
    on ? "border-primary bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]" : "border-border/60 bg-card hover:border-primary/50"
  }`;

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={`h-5 w-5 shrink-0 rounded-full border-2 ${on ? "border-[6px] border-primary" : "border-muted-foreground"}`} />;
}

function TurnoPage() {
  const { appointmentId } = Route.useParams();
  const navigate = useNavigate();
  const router = useRouter();
  const [appt, setAppt] = useState<ApptDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<ResponseKind | null>(null);
  const [reason, setReason] = useState<ReasonCode | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<React.ReactNode>(null);
  const [reasonError, setReasonError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentNo, setSentNo] = useState(false);
  const sentRef = useRef<HTMLDivElement>(null);

  // Después de avisar, el foco va al mensaje de confirmación (lectores de pantalla)
  useEffect(() => {
    if (sentNo) sentRef.current?.querySelector("h1")?.focus();
  }, [sentNo]);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await portalApi.appointment(appointmentId);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: `/portal/turno/${appointmentId}` }, replace: true });
        return;
      }
      setLoadError(r.status === 404 ? r.error : "No pudimos cargar el turno. Probá de nuevo en un rato.");
      return;
    }
    setAppt(r.data);
    if (r.data.response?.by_me) {
      setChoice(r.data.response.kind);
      if (r.data.response.reason_code) setReason(r.data.response.reason_code);
    }
  }, [appointmentId, navigate]);

  useEffect(() => { void load(); }, [load]);

  function goBack() {
    if (window.history.length > 1) router.history.back();
    else navigate({ to: "/portal" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!appt || !choice) { setError("Elegí una respuesta."); return; }
    setError(null);
    if (choice === "no_puedo" && !reason) { setReasonError(true); return; }
    setSending(true);
    const r = await portalApi.respond({
      appointment_id: appt.id, response: choice,
      ...(choice === "no_puedo" ? { reason_code: reason!, reason_text: text.trim() || undefined } : {}),
    });
    setSending(false);
    if (!r.ok) {
      if (r.status === 401) { navigate({ to: "/portal/ingresar", search: { volver: `/portal/turno/${appt.id}` } }); return; }
      setError(r.status === 503 ? "No pudimos conectar. Probá de nuevo." : r.error);
      return;
    }
    setAppt(r.data);
    if (choice === "confirmo") {
      toast.success(`¡Gracias! Te esperamos el ${shortDayLabel(appt.date)} a las ${appt.time}.`);
      goBack();
    } else {
      setSentNo(true);
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <div className={`${card} flex flex-col gap-3`} role="alert">
          <p className="text-base">{loadError}</p>
          <button type="button" onClick={() => void load()} className={pillOutline}>Reintentar</button>
        </div>
      </div>
    );
  }

  if (!appt) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
        Cargando…
      </div>
    );
  }

  if (sentNo) {
    return (
      <div ref={sentRef} role="status" className={`${card} flex flex-col items-center gap-3 text-center`}>
        <CircleCheck className="h-14 w-14 text-[oklch(0.55_0.15_150)]" aria-hidden="true" />
        <PageTitle>Gracias por avisar</PageTitle>
        <p className="text-base">El equipo ya lo ve. Vas a ver acá qué resolvimos.</p>
        {appt.is_today && <p className="text-base font-semibold text-[oklch(0.45_0.11_70)]">Como es para hoy, además <CallUs />.</p>}
        <Link to="/portal" className={`${pillPrimary} w-full`}>Volver al inicio</Link>
      </div>
    );
  }

  const status = apptStatus(appt);
  const r = appt.response;
  const closed = appt.state === "cancelado" || appt.is_past || !appt.can_decline;

  return (
    <div className="flex flex-col gap-4">
      <BackLink childId={appt.child_id} childName={appt.is_self ? null : appt.child_first_name} />
      <PageTitle>{appt.is_self ? "¿Podés venir?" : "¿Pueden venir?"}</PageTitle>

      <div className="rounded-3xl bg-[color:var(--primary-soft)] p-5">
        <p className="font-display text-lg font-bold text-[color:var(--primary-deep)]">{appt.is_self ? "Tu turno" : appt.child_first_name} · {apptDateLabel(appt)}</p>
        <p className="text-sm text-[color:var(--primary-deep)]/80">{apptMeta(appt)}</p>
      </div>

      {closed ? (
        <div className={`${card} flex flex-col gap-3`}>
          {status && <StatusChip tone={status.tone}>{status.text}</StatusChip>}
          <p className="text-base">
            {appt.state === "cancelado" ? "El centro canceló este turno."
              : appt.is_past
                ? (r?.kind === "no_puedo"
                  ? `Este turno ya pasó. ${r.by_me ? "Tu aviso" : "El aviso"} quedó registrado.`
                  : <>Este turno ya pasó. Si no {appt.is_self ? "pudiste" : "pudieron"} venir, <CallUs />.</>)
              : <>El equipo ya resolvió el aviso. Si cambió algo, <CallUs />.</>}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-4`}>
          {r && r.by_me && <p className="text-sm text-muted-foreground">Respondiste el {stampLabel(r.at)}.</p>}
          {r && !r.by_me && (
            <p className="rounded-2xl bg-muted px-4 py-3 text-base">
              {appt.is_self
                ? <>Tu familia avisó el {stampLabel(r.at)} que {r.kind === "confirmo" ? "vas" : "no vas"}. Podés responder igual.</>
                : <>Otro adulto de la familia avisó el {stampLabel(r.at)} que {r.kind === "confirmo" ? "van" : "no van"}. Podés responder igual.</>}
            </p>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-base font-bold">Tu respuesta</legend>
            <label className={`${optionClass(choice === "confirmo", !appt.can_confirm)} ${appt.can_confirm ? "cursor-pointer" : ""}`}>
              <input type="radio" name="response" value="confirmo" checked={choice === "confirmo"} disabled={!appt.can_confirm}
                onChange={() => { setChoice("confirmo"); setError(null); }} className="sr-only" />
              <Dot on={choice === "confirmo"} />
              <span>
                {appt.is_self ? "Voy a ir" : "Vamos a ir"}
                {!appt.can_confirm && appt.confirm_from && (
                  <span className="block text-sm font-semibold">Vas a poder confirmar desde el {shortDayLabel(appt.confirm_from)} ({CONFIRM_WINDOW_DAYS} días antes)</span>
                )}
              </span>
            </label>
            <label className={`${optionClass(choice === "no_puedo")} cursor-pointer`}>
              <input type="radio" name="response" value="no_puedo" checked={choice === "no_puedo"}
                onChange={() => { setChoice("no_puedo"); setError(null); }} className="sr-only" />
              <Dot on={choice === "no_puedo"} />
              {appt.is_self ? "No voy a poder ir" : "No vamos a poder ir"}
            </label>
          </fieldset>

          {choice === "no_puedo" && (
            <>
              <fieldset className="flex flex-col gap-2" aria-describedby={reasonError ? "portal-reason-error" : undefined}>
                <legend className="mb-2 text-base font-bold">{appt.is_self ? "¿Por qué no podés venir?" : "¿Por qué no pueden venir?"}</legend>
                {REASONS.map((o) => (
                  <label key={o.code} className={`${optionClass(reason === o.code)} cursor-pointer`}>
                    <input type="radio" name="reason" value={o.code} checked={reason === o.code}
                      onChange={() => { setReason(o.code); setReasonError(false); }} className="sr-only" />
                    <Dot on={reason === o.code} />
                    {o.label}
                  </label>
                ))}
                {reasonError && <p id="portal-reason-error" role="alert" className="text-base font-semibold text-[oklch(0.48_0.19_25)]">Elegí un motivo.</p>}
              </fieldset>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="portal-reason-text" className="text-base font-bold">¿Querés agregar algo? <span className="font-normal text-muted-foreground">(opcional)</span></label>
                <input id="portal-reason-text" maxLength={REASON_TEXT_MAX} value={text} onChange={(e) => setText(e.target.value)}
                  aria-describedby="portal-reason-help" className={inputClass} />
                <p id="portal-reason-help" className="text-sm text-muted-foreground">No incluyas datos de salud ni diagnósticos. {text.length}/{REASON_TEXT_MAX}</p>
              </div>
              <p className="rounded-2xl bg-[color:var(--status-pending-bg)] px-4 py-3 text-base text-[oklch(0.42_0.1_70)]">
                Avisar no cancela el turno automáticamente: el equipo lo revisa y te contesta acá mismo. Avisar con al menos un día de anticipación nos ayuda a darle el horario a otra familia.
              </p>
              {appt.is_today && (
                <p className="text-base font-semibold text-[oklch(0.45_0.11_70)]">Es para hoy: además de avisar acá, <CallUs />.</p>
              )}
            </>
          )}

          <FormAlert>{error}</FormAlert>
          <button type="submit" disabled={sending || !choice} className={pillPrimary}>
            {sending ? "Guardando…" : r?.by_me ? "Cambiar respuesta" : "Enviar respuesta"}
          </button>
        </form>
      )}
    </div>
  );
}

function BackLink({ childId, childName }: { childId?: string; childName?: string | null }) {
  return childId ? (
    <Link to="/portal/chico/$patientId" params={{ patientId: childId }} className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary">
      <ChevronLeft className="h-5 w-5" aria-hidden="true" /> {childName ? `Turnos de ${childName}` : "Tus turnos"}
    </Link>
  ) : (
    <Link to="/portal" className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary">
      <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Inicio
    </Link>
  );
}
