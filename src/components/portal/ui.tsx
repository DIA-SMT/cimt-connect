import { useId, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertCircle, ChevronDown, Eye, EyeOff, Scale, ShieldCheck } from "lucide-react";
import { CENTER } from "@/lib/center";
import type { LegalBasis } from "@/lib/legalBasis";
import { TONE_CLASS, apptMeta, card, inputClass, pillOutline, pillPrimary } from "./styles";
import { type ApptDTO, type ApptTone, apptDateLabel, apptStatus, portalApi, shortDayLabel } from "@/lib/portal";

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

// Lista de puntos de un aviso (privacidad, información de salud)
export function NoticeList({ points }: { points: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {points.map((p) => (
        <li key={p} className="flex gap-2.5 text-base">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

// De dónde sale un permiso expreso: la norma mínima a la vista y el detalle
// en «Ver más» (src/lib/legalBasis.ts)
export function LegalBasisNote({ basis, title = "Por qué te pedimos este permiso" }: { basis: LegalBasis; title?: string }) {
  const [open, setOpen] = useState(false);
  const moreId = useId();
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-left">
      <p className="flex items-start gap-2 text-base font-bold">
        <Scale className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" /> {title}
      </p>
      <p className="text-base">{basis.summary}</p>
      <p className="text-sm text-muted-foreground">{basis.laws}</p>
      {open && (
        <ul id={moreId} className="flex flex-col gap-2.5 border-t border-primary/20 pt-3">
          {basis.more.map((p) => (
            <li key={p.ref} className="text-base">
              <span className="block text-sm font-bold text-[color:var(--primary-deep)]">{p.ref}</span>
              {p.text}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={moreId}
        className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary underline underline-offset-2">
        {open ? "Ver menos" : "Ver más"}
        <ChevronDown className={`h-5 w-5 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
    </div>
  );
}

// Campo de contraseña con "Mostrar / Ocultar" (como en Ingresar)
export function PasswordField({
  id, label, value, onChange, autoComplete = "current-password", help, invalid = false, inputRef,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: "current-password" | "new-password";
  help?: React.ReactNode;
  invalid?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  const helpId = `${id}-help`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base font-bold">{label}</label>
      <div className="relative">
        <input ref={inputRef} id={id} name="password" type={show ? "text" : "password"} autoComplete={autoComplete}
          value={value} onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined} aria-describedby={help ? helpId : undefined}
          className={`${inputClass} pr-24`} />
        <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          className="absolute inset-y-0 right-1 my-auto flex h-11 items-center gap-1 rounded-full px-3 text-sm font-bold text-primary">
          {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          {show ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {help && <p id={helpId} className="text-sm text-muted-foreground">{help}</p>}
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
