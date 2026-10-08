import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { CENTER } from "@/lib/center";
import { TONE_CLASS, apptMeta, card, pillOutline, pillPrimary } from "./styles";
import {
  type ApptDTO, type ApptTone, type HcRequestDTO,
  apptDateLabel, apptStatus, hcStatus, portalApi, shortDayLabel, stampLabel,
} from "@/lib/portal";

// Piezas comunes del Portal de familias. Texto de 16 px como mínimo, botones
// de 48 px de alto y estados siempre con texto (no solo color).

export function StatusChip({ tone, children }: { tone: ApptTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center self-start rounded-full px-3 py-1 text-sm font-bold ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 tabIndex={-1} className="font-hand text-4xl leading-tight text-[color:var(--primary-deep)] outline-none">{children}</h1>
      {sub && <p className="mt-1 text-base text-muted-foreground">{sub}</p>}
    </div>
  );
}

// Error persistente junto al botón (no un aviso que desaparece)
export function FormAlert({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-2xl bg-[color:var(--status-occupied-bg)] px-4 py-3 text-base font-semibold text-[oklch(0.48_0.19_25)]">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function CallUs() {
  return (
    <>
      llamanos al <a href={CENTER.phoneHref} className="font-bold underline underline-offset-2">{CENTER.phoneDisplay}</a>
    </>
  );
}

export function AppointmentCard({
  appt, showChild = true, onChanged,
}: { appt: ApptDTO; showChild?: boolean; onChanged?: (a: ApptDTO) => void }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const [saving, setSaving] = useState(false);
  const status = apptStatus(appt);
  const resp = appt.response;
  const responded = !!resp && resp.by_me;
  // El botón de un toque solo aparece si esta cuenta todavía no respondió:
  // si ya avisó que no van, el cambio va por "Cambiar respuesta" (no se
  // deshace un aviso con un toque accidental)
  const showConfirm = appt.can_confirm && !responded;

  async function confirm() {
    setSaving(true);
    const r = await portalApi.respond({ appointment_id: appt.id, response: "confirmo" });
    setSaving(false);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: pathname } });
        return;
      }
      toast.error(r.status === 503 ? "No pudimos conectar. Probá de nuevo." : r.error);
      return;
    }
    toast.success(`¡Gracias! Te esperamos el ${shortDayLabel(appt.date)} a las ${appt.time}.`);
    onChanged?.(r.data);
  }

  // El turno propio del titular se titula "Tu turno"; los de los chicos, con su nombre
  const title = showChild ? `${appt.is_self ? "Tu turno" : appt.child_first_name} · ${apptDateLabel(appt)}` : apptDateLabel(appt);

  return (
    <article className={`${card} flex flex-col gap-3`} aria-label={title}>
      <div>
        <h3 className={`font-display text-lg font-bold leading-snug text-foreground ${appt.state === "cancelado" ? "line-through decoration-1" : ""}`}>
          {title}
        </h3>
        <p className="text-base text-muted-foreground">{apptMeta(appt)}</p>
      </div>

      {status && <StatusChip tone={status.tone}>{status.text}</StatusChip>}

      {!status && appt.confirm_from && (
        <p className="text-base font-semibold text-muted-foreground">
          Vas a poder confirmar desde el {shortDayLabel(appt.confirm_from)}
        </p>
      )}

      {appt.is_today && appt.can_decline && (
        <p className="text-base font-semibold text-[oklch(0.42_0.1_70)]">
          Es para hoy: si no {appt.is_self ? "podés" : "pueden"} venir, además de avisar acá, <CallUs />.
        </p>
      )}

      {appt.can_decline && (
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          {showConfirm && (
            <button type="button" onClick={confirm} disabled={saving} className={pillPrimary}>
              {saving ? "Guardando…" : appt.is_self ? "Voy a ir" : "Vamos a ir"}
            </button>
          )}
          <Link to="/portal/turno/$appointmentId" params={{ appointmentId: appt.id }}
            className={`${pillOutline} ${showConfirm ? "" : "min-[420px]:col-span-2"}`}>
            {responded ? "Cambiar respuesta" : appt.is_self ? "No voy a poder ir" : "No vamos a poder ir"}
          </Link>
        </div>
      )}
    </article>
  );
}

// Pedido de copia de la historia clínica tal como lo ve la familia: estado
// (siempre con texto), cómo retirarla y, mientras sigue pendiente, cancelarlo.
// La copia nunca viaja por el portal: se entrega en mano en el centro.
// title: de quién es la copia, cuando la tarjeta no está dentro de la página
// del paciente (por ejemplo, en el inicio).
export function HcRequestCard({
  req, title, onChanged,
}: { req: HcRequestDTO; title?: string; onChanged?: (updated?: HcRequestDTO) => void }) {
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
  const status = hcStatus(req);
  const stamp = stampLabel(req.created_at);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "status" ? statusRef : target === "ask" ? askRef : cancelRef).current?.focus();
  });

  async function cancel() {
    setSaving(true);
    setError(null);
    const r = await portalApi.hcCancel(req.id);
    setSaving(false);
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: pathname } });
        return;
      }
      setError(r.error);
      // El pedido ya cambió de estado (por ejemplo, la copia está lista): se actualiza
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

  return (
    <article className={`${card} flex flex-col gap-3`}
      aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : `Pedido del ${stamp}`}>
      {title && <h3 id={titleId} className="font-display text-lg font-bold leading-snug">{title}</h3>}
      <div ref={statusRef} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <StatusChip tone={status.tone}>{status.text}</StatusChip>
        <p className="text-base text-muted-foreground">Pedida el {stamp}</p>
      </div>

      {req.status === "lista" && (
        <p className="text-base">
          Retirala en {CENTER.address} · {CENTER.hoursLong}. <b>Traé tu DNI:</b> se la entregamos a quien la pidió.
        </p>
      )}
      {req.status === "pendiente" && <p className="text-base">Te avisamos acá cuando esté lista.</p>}
      {req.status === "rechazada" && <p className="text-base">Si tenés dudas, <CallUs />.</p>}

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
          Cancelar pedido
        </button>
      ))}

      <FormAlert>{error}</FormAlert>
    </article>
  );
}
