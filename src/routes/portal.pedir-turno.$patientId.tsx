import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Check, ChevronLeft, Info, Loader2 } from "lucide-react";
import {
  type ApptReqModality, type ApptReqReason, type TimeBand, type Weekday,
  APPT_REQ_MODALITIES, APPT_REQ_MODALITY_LABEL, APPT_REQ_NOTE_MAX, APPT_REQ_REASONS, TIME_BANDS, TIME_BAND_LABEL,
  WEEKDAYS, WEEKDAY_LABEL, apptReqOpen, validateApptRequest,
} from "@/lib/apptRequestRules";
import { type ApptRequestDTO, type ChildPageDTO, portalApi } from "@/lib/portal";
import { ApptRequestCard } from "@/components/portal/ApptRequestCard";
import { CallUs, FormAlert, PageTitle } from "@/components/portal/ui";
import { card, choiceClass, pillOutline, pillPrimary, textareaClass } from "@/components/portal/styles";

// Pedir un turno: la familia cuenta para qué es y qué días y horarios le
// quedan bien. No elige un horario: el equipo lo agenda según la agenda del
// profesional (o la llama) y el estado del pedido se ve en la página de la
// persona. Con un pedido abierto no se puede hacer otro: se muestra ese.

export const Route = createFileRoute("/portal/pedir-turno/$patientId")({
  component: PedirTurnoPage,
});

type Field = "reason" | "days" | "band" | "modality" | "note";
const errorText = "text-base font-semibold text-[oklch(0.48_0.19_25)]";
const legendClass = "mb-2 text-base font-bold";

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden="true" className={`h-5 w-5 shrink-0 rounded-full border-2 ${on ? "border-[6px] border-primary" : "border-muted-foreground"}`} />;
}

function Box({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"}`}>
      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  );
}

function PedirTurnoPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const here = `/portal/pedir-turno/${patientId}`;
  const [data, setData] = useState<ChildPageDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await portalApi.childAppointments(patientId);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: here }, replace: true });
        return;
      }
      setLoadError(r.status === 404 ? r.error : "No pudimos cargar la página. Probá de nuevo en un rato.");
      return;
    }
    setData(r.data);
  }, [patientId, here, navigate]);

  useEffect(() => { void load(); }, [load]);

  // El pedido en curso que se ve acá se canceló (o ya había cambiado, por
  // ejemplo, porque el equipo dio el turno): se vuelve a la página de la
  // persona, que muestra cómo quedó y, si se puede, el botón para pedir otro.
  // Quedarse acá mostraría un "no podés pedir" viejo. "Atrás" no vuelve acá
  function requestChanged(updated?: ApptRequestDTO) {
    if (updated) toast.success("Listo, cancelaste el pedido.");
    else toast("El pedido cambió mientras tanto: fijate cómo quedó.");
    navigate({ to: "/portal/chico/$patientId", params: { patientId }, hash: "turno-pedido", replace: true });
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <Link to="/portal" className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Inicio
        </Link>
        <div className={`${card} flex flex-col gap-3`} role="alert">
          <p className="text-base">{loadError}</p>
          <button type="button" onClick={() => void load()} className={pillOutline}>Reintentar</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
        Cargando…
      </div>
    );
  }

  const { child, turnos } = data;
  const self = !!child.self;
  const open = turnos.requests.filter((r) => apptReqOpen(r.status));
  const canAsk = open.length === 0 && turnos.enabled && turnos.can_request;
  const backToTurnos = (
    <Link to="/portal/chico/$patientId" params={{ patientId: child.id }} className={`${pillOutline} min-[420px]:self-start`}>
      {self ? "Volver a tus turnos" : `Volver a los turnos de ${child.first_name}`}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <Link to="/portal/chico/$patientId" params={{ patientId: child.id }} className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary">
        <ChevronLeft className="h-5 w-5" aria-hidden="true" /> {self ? "Tus turnos" : `Turnos de ${child.first_name}`}
      </Link>
      <div>
        <PageTitle>{self ? "Pedir un turno" : `Pedir un turno para ${child.first_name}`}</PageTitle>
        {canAsk && (
          <p className="-mt-2 flex items-start gap-2 rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-base text-[color:var(--primary-deep)]">
            <Info className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              El centro asigna el día y el horario según la agenda de {self ? "tu" : "su"} profesional. Contanos qué
              necesitás y cuándo te queda bien: te avisamos acá.
            </span>
          </p>
        )}
      </div>

      {open.length > 0 ? (
        <>
          <p className="-mt-2 text-base">
            {self ? "Ya tenés un pedido de turno en curso" : `Ya hay un pedido de turno para ${child.first_name} en curso`}: te
            avisamos acá cuando el equipo lo resuelva.
          </p>
          {open.map((r) => <ApptRequestCard key={r.id} req={r} onChanged={requestChanged} />)}
          {backToTurnos}
        </>
      ) : !turnos.enabled ? (
        // El servidor todavía no tiene los pedidos de turno
        <>
          <p className={`${card} -mt-2 text-base`}>
            Por ahora los turnos se piden por teléfono. Si necesitás uno, <CallUs />.
          </p>
          {backToTurnos}
        </>
      ) : !canAsk ? (
        <>
          <p className={`${card} -mt-2 text-base`}>
            {self ? "Por ahora no podés pedir un turno desde el portal." : `Por ahora no se puede pedir un turno para ${child.first_name} desde el portal.`}
            {" "}Si necesitás uno, <CallUs />.
          </p>
          {backToTurnos}
        </>
      ) : (
        <RequestForm patientId={child.id} self={self} />
      )}
    </div>
  );
}

function RequestForm({ patientId, self }: { patientId: string; self: boolean }) {
  const navigate = useNavigate();
  const [reason, setReason] = useState<ApptReqReason | null>(null);
  const [days, setDays] = useState<Weekday[]>([]);
  const [band, setBand] = useState<TimeBand | null>(null);
  const [modality, setModality] = useState<ApptReqModality | null>(null);
  const [note, setNote] = useState("");
  // Lo que falta completar (al lado de la pregunta) y lo que respondió el servidor (al lado del botón)
  const [fieldError, setFieldError] = useState<{ field: Field; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openExists, setOpenExists] = useState(false);
  const [sending, setSending] = useState(false);
  // Primer control de cada pregunta: ahí va el foco si falta completarla
  const firstRef = useRef<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  const reasonLabel: Record<ApptReqReason, string> = {
    continuar: "Seguir con las sesiones",
    consulta: self ? "Una consulta con tu profesional" : "Una consulta con su profesional",
    otro: "Otra cosa",
  };
  const allDays = days.length === WEEKDAYS.length;

  function clearError(field: Field) {
    setFieldError((e) => (e?.field === field ? null : e));
  }

  function toggleDay(d: Weekday) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || cur.includes(x))));
    clearError("days");
  }

  function setAllDays(on: boolean) {
    setDays(on ? [...WEEKDAYS] : []);
    clearError("days");
  }

  // Qué pregunta falta, en el mismo orden en que las revisa validateApptRequest
  function missing(): Field {
    if (!reason) return "reason";
    if (!days.length) return "days";
    if (!band) return "band";
    if (!modality) return "modality";
    return "note";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOpenExists(false);
    const v = validateApptRequest({ reason, days, band, modality, note });
    if (!v.ok) {
      const field = missing();
      setFieldError({ field, text: v.error });
      firstRef.current[field]?.focus();
      return;
    }
    setFieldError(null);
    setSending(true);
    const r = await portalApi.apptRequestCreate(patientId, v.value);
    setSending(false);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: `/portal/pedir-turno/${patientId}` } });
        return;
      }
      // Ya había un pedido en curso (por ejemplo, de otro adulto o desde otra pestaña)
      if (r.code === "APPT_OPEN") setOpenExists(true);
      setError(r.error);
      return;
    }
    toast.success("Listo, recibimos tu pedido. Te avisamos acá.");
    // El pedido se ve en la página de la persona; "atrás" no vuelve al formulario
    navigate({ to: "/portal/chico/$patientId", params: { patientId }, hash: "turno-pedido", replace: true });
  }

  const errorFor = (field: Field) => fieldError?.field === field && (
    <p id={`pt-${field}-error`} role="alert" className={errorText}>{fieldError.text}</p>
  );
  const describedBy = (field: Field, extra?: string) =>
    [extra, fieldError?.field === field ? `pt-${field}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-6`}>
      <fieldset className="flex flex-col gap-2" aria-describedby={describedBy("reason")}>
        <legend className={legendClass}>¿Para qué es?</legend>
        {APPT_REQ_REASONS.map((o, i) => (
          <label key={o} className={choiceClass(reason === o)}>
            <input ref={i === 0 ? (el) => { firstRef.current.reason = el; } : undefined}
              type="radio" name="reason" value={o} checked={reason === o}
              onChange={() => { setReason(o); clearError("reason"); }} className="sr-only" />
            <Dot on={reason === o} />
            {reasonLabel[o]}
          </label>
        ))}
        {errorFor("reason")}
      </fieldset>

      <fieldset className="flex flex-col gap-2" aria-describedby={describedBy("days", "pt-days-help")}>
        <legend className={legendClass}>{self ? "¿Qué días te quedan bien?" : "¿Qué días les quedan bien?"}</legend>
        <p id="pt-days-help" className="-mt-1 text-sm text-muted-foreground">Podés marcar más de uno.</p>
        <label className={choiceClass(allDays)}>
          <input ref={(el) => { firstRef.current.days = el; }} type="checkbox" checked={allDays}
            onChange={(e) => setAllDays(e.target.checked)} className="sr-only" />
          <Box on={allDays} />
          Cualquier día
        </label>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
          {WEEKDAYS.map((d) => (
            <label key={d} className={choiceClass(days.includes(d), true)}>
              <input type="checkbox" name="days" value={d} checked={days.includes(d)}
                onChange={() => toggleDay(d)} className="sr-only" />
              <Box on={days.includes(d)} />
              {WEEKDAY_LABEL[d]}
            </label>
          ))}
        </div>
        {errorFor("days")}
      </fieldset>

      <fieldset className="flex flex-col gap-2" aria-describedby={describedBy("band")}>
        <legend className={legendClass}>¿En qué horario?</legend>
        {TIME_BANDS.map((o, i) => (
          <label key={o} className={choiceClass(band === o)}>
            <input ref={i === 0 ? (el) => { firstRef.current.band = el; } : undefined}
              type="radio" name="band" value={o} checked={band === o}
              onChange={() => { setBand(o); clearError("band"); }} className="sr-only" />
            <Dot on={band === o} />
            {TIME_BAND_LABEL[o]}
          </label>
        ))}
        {errorFor("band")}
      </fieldset>

      <fieldset className="flex flex-col gap-2" aria-describedby={describedBy("modality")}>
        <legend className={legendClass}>¿Cómo?</legend>
        {APPT_REQ_MODALITIES.map((o, i) => (
          <label key={o} className={choiceClass(modality === o)}>
            <input ref={i === 0 ? (el) => { firstRef.current.modality = el; } : undefined}
              type="radio" name="modality" value={o} checked={modality === o}
              onChange={() => { setModality(o); clearError("modality"); }} className="sr-only" />
            <Dot on={modality === o} />
            {APPT_REQ_MODALITY_LABEL[o]}
          </label>
        ))}
        {errorFor("modality")}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="pt-note" className="text-base font-bold">
          Comentario <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <textarea ref={(el) => { firstRef.current.note = el; }} id="pt-note" rows={3} maxLength={APPT_REQ_NOTE_MAX}
          value={note} onChange={(e) => { setNote(e.target.value); clearError("note"); }}
          aria-invalid={fieldError?.field === "note" || undefined} aria-describedby={describedBy("note", "pt-note-help")}
          className={textareaClass} />
        <p id="pt-note-help" className="text-sm text-muted-foreground">
          No escribas datos de salud: eso lo hablamos en el turno. {note.length}/{APPT_REQ_NOTE_MAX}
        </p>
        {errorFor("note")}
      </div>

      <FormAlert>{error}</FormAlert>
      {openExists && (
        <Link to="/portal/chico/$patientId" params={{ patientId }} hash="turno-pedido"
          className="inline-flex min-h-11 items-center self-start text-base font-bold text-primary underline-offset-2 hover:underline">
          Ver el pedido en curso →
        </Link>
      )}
      <button type="submit" disabled={sending} className={pillPrimary}>
        {sending ? "Enviando…" : "Enviar pedido"}
      </button>
    </form>
  );
}
