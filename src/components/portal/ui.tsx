import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { CENTER } from "@/lib/center";
import { apptMeta, card, pillOutline, pillPrimary } from "./styles";
import {
  type ApptDTO, type ApptTone,
  apptDateLabel, apptStatus, portalApi, shortDayLabel,
} from "@/lib/portal";

// Piezas comunes del Portal de familias. Texto de 16 px como mínimo, botones
// de 48 px de alto y estados siempre con texto (no solo color).


// Colores de texto de estado con buen contraste sobre los fondos --status-*-bg
const TONE: Record<ApptTone, string> = {
  ok: "bg-[color:var(--status-available-bg)] text-[oklch(0.42_0.12_150)]",
  warn: "bg-[color:var(--status-pending-bg)] text-[oklch(0.45_0.11_70)]",
  bad: "bg-[color:var(--status-occupied-bg)] text-[oklch(0.48_0.19_25)]",
  info: "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]",
  muted: "bg-muted text-muted-foreground",
};

export function StatusChip({ tone, children }: { tone: ApptTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center self-start rounded-full px-3 py-1 text-sm font-bold ${TONE[tone]}`}>
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
