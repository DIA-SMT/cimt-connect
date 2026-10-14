import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  type ApptReqModality, type ApptRequestDTO, type Weekday, TIME_BAND_LABEL, WEEKDAYS, WEEKDAY_LABEL,
} from "@/lib/apptRequestRules";
import { type ApptTone, apptDateLabel, capitalize, portalApi, stampLabel } from "@/lib/portal";
import { CallUs, FormAlert, StatusChip } from "./ui";
import { card, pillOutline, pillPrimary } from "./styles";

// Pedido de turno tal como lo ve la familia: en qué está (siempre con texto),
// qué se pidió y, mientras sigue abierto y lo pidió esta cuenta, cancelarlo.
// El portal no da turnos: el equipo lo agenda y acá se ve el turno que dio.
// showChild: la tarjeta va fuera de la página de la persona (en el inicio):
// el título dice para quién es y "los ves en la lista" lleva a sus turnos.

const linkClass = "inline-flex min-h-11 items-center self-start text-base font-bold text-primary underline-offset-2 hover:underline";

// En el resumen, "Cualquiera de las dos" no se entendería solo
const MODALITY_TEXT: Record<ApptReqModality, string> = {
  presencial: "En el centro",
  telemedicina: "Por videollamada",
  indistinto: "En el centro o por videollamada",
};

function daysText(days: Weekday[]): string {
  if (WEEKDAYS.every((d) => days.includes(d))) return "Cualquier día";
  const names = days.map((d) => WEEKDAY_LABEL[d].toLowerCase());
  return capitalize(names.length > 1 ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}` : names[0] ?? "");
}

function apptReqStatus(r: ApptRequestDTO): { tone: ApptTone; text: string } {
  switch (r.status) {
    case "pendiente": return { tone: "warn", text: "Pedido recibido" };
    case "contactar": return { tone: "info", text: r.mine ? "Te vamos a llamar" : "Vamos a llamar a la familia" };
    case "agendado":
      // El turno que se dio ya no está (se canceló o se borró)
      return r.appointment_cancelled ? { tone: "warn", text: "Turno cancelado" } : { tone: "ok", text: "Turno asignado" };
    case "rechazado":
      if (r.reject_reason === "ya_tiene_turnos") return { tone: "info", text: r.is_self ? "Ya tenés turnos" : "Ya tiene turnos" };
      // Lo cerró el servidor (bloqueo judicial): neutro, sin dar el motivo
      if (r.reject_reason === "bloqueo") return { tone: "muted", text: "Pedido cerrado" };
      return { tone: "bad", text: "Sin turno" };
    case "cancelado": return { tone: "muted", text: "Pedido cancelado" };
  }
}

// onChanged: se canceló (con el pedido actualizado) o ya había cambiado (sin
// nada: la tarjeta muestra lo que respondió el servidor)
export function ApptRequestCard({
  req, showChild = false, onChanged,
}: { req: ApptRequestDTO; showChild?: boolean; onChanged?: (updated?: ApptRequestDTO) => void }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const askId = useId();
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLParagraphElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Adónde va el foco después de abrir, cerrar o resolver la confirmación
  const focusNext = useRef<"status" | "ask" | "button" | null>(null);
  const status = apptReqStatus(req);
  const stamp = stampLabel(req.created_at);
  const title = !showChild ? "Pedido de turno" : req.is_self ? "Tu pedido de turno" : `Pedido de turno para ${req.child_first_name}`;

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "status" ? statusRef : target === "ask" ? askRef : cancelRef).current?.focus();
  });

  async function cancel() {
    setSaving(true);
    setError(null);
    const r = await portalApi.apptRequestCancel(req.id);
    setSaving(false);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: pathname } });
        return;
      }
      setError(r.error);
      // El pedido ya cambió de estado (por ejemplo, el equipo ya dio el turno): se actualiza
      if (r.status === 409) {
        setConfirming(false);
        focusNext.current = "status";
        onChanged?.();
      }
      return;
    }
    setConfirming(false);
    focusNext.current = "status";
    onChanged?.(r.data);
  }

  // Fuera de la página de la persona, "los ves en la lista" lleva a sus turnos
  const listLink = showChild && (
    <Link to="/portal/chico/$patientId" params={{ patientId: req.patient_id }} className={linkClass}>
      {req.is_self ? "Ver tus turnos" : `Ver los turnos de ${req.child_first_name}`} →
    </Link>
  );

  let text: React.ReactNode;
  let action: React.ReactNode = null;
  switch (req.status) {
    case "pendiente":
      text = req.mine
        ? "Recibimos tu pedido. El equipo te asigna día y horario y te avisamos acá."
        : "Recibimos el pedido. El equipo asigna día y horario y te avisamos acá.";
      break;
    case "contactar":
      text = req.mine
        ? "Te vamos a llamar para coordinar el día y el horario."
        : "Vamos a llamar a la familia para coordinar el día y el horario.";
      break;
    case "agendado":
      if (req.appointment_cancelled) {
        // Se puede pedir otro: en la página de la persona está el botón
        text = req.is_self
          ? "El turno que te dimos se canceló. Si necesitás otro, pedilo de nuevo."
          : `El turno que le dimos a ${req.child_first_name} se canceló. Si necesita otro, pedilo de nuevo.`;
        action = listLink;
      } else if (req.appointment) {
        text = <>Te dimos turno: <b>{apptDateLabel(req.appointment)}</b></>;
        action = (
          <Link to="/portal/turno/$appointmentId" params={{ appointmentId: req.appointment.id }} className={linkClass}>
            Ver el turno →
          </Link>
        );
      } else {
        text = "Te dimos turno: lo ves en la lista de turnos.";
        action = listLink;
      }
      break;
    case "rechazado":
      if (req.reject_reason === "ya_tiene_turnos") {
        text = req.is_self ? "Ya tenés turnos asignados: los ves en la lista." : "Ya tiene turnos asignados: los ves en la lista.";
        action = listLink;
      } else if (req.reject_reason === "bloqueo") {
        // Se cerró al cargar un bloqueo por orden judicial: no se explica el
        // motivo ni se ofrece llamar. Se puede pedir otro desde la página de la persona
        text = req.is_self
          ? "Este pedido se cerró sin turno. Si necesitás uno, pedilo de nuevo."
          : `Este pedido se cerró sin turno. Si ${req.child_first_name} necesita uno, pedilo de nuevo.`;
        action = listLink;
      } else {
        text = <>No pudimos darte turno. Te llamamos para explicarte; si no, <CallUs />.</>;
      }
      break;
    case "cancelado":
      text = req.mine ? "Cancelaste este pedido." : "Se canceló este pedido.";
      break;
  }

  const who = req.mine ? "Pedido" : req.is_self ? "Lo pidió alguien de tu familia" : "Lo pidió otro adulto de la familia";

  return (
    <article className={`${card} flex flex-col gap-3`} aria-labelledby={titleId}>
      <h3 id={titleId} className="font-display text-lg font-bold leading-snug">{title}</h3>
      <div ref={statusRef} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <StatusChip tone={status.tone}>{status.text}</StatusChip>
        <p className="text-base">{text}</p>
        {action}
      </div>

      <div className="flex flex-col gap-0.5 text-base text-muted-foreground">
        <p>{daysText(req.days)} · {TIME_BAND_LABEL[req.band]} · {MODALITY_TEXT[req.modality]}</p>
        <p>{who} el {stamp}</p>
      </div>
      {req.note && (
        <p className="whitespace-pre-line break-words rounded-2xl bg-muted px-4 py-3 text-base">
          <span className="font-bold">Tu comentario:</span> {req.note}
        </p>
      )}

      {req.can_cancel && (confirming ? (
        <div role="group" aria-labelledby={askId} className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
          <p id={askId} ref={askRef} tabIndex={-1} className="text-base font-bold outline-none">¿Cancelar el pedido?</p>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <button type="button" onClick={() => void cancel()} disabled={saving} className={pillPrimary}>
              {saving ? "Cancelando…" : "Sí, cancelar"}
            </button>
            <button type="button" disabled={saving} className={pillOutline}
              onClick={() => { focusNext.current = "button"; setConfirming(false); }}>
              No
            </button>
          </div>
        </div>
      ) : (
        <button ref={cancelRef} type="button" className={`${pillOutline} min-[420px]:self-start`}
          onClick={() => { focusNext.current = "ask"; setError(null); setConfirming(true); }}>
          Cancelar el pedido
        </button>
      ))}

      <FormAlert>{error}</FormAlert>
    </article>
  );
}
