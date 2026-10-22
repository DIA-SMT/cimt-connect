import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, CircleCheck, Info, Loader2, Mic } from "lucide-react";
import { CENTER } from "@/lib/center";
import { CLINICAL_LEGAL_BASIS } from "@/lib/legalBasis";
import type { FamilyRecordingConsentDTO } from "@/lib/recordingRules";
import {
  type ChildClinicalDTO, type ChildDTO, type FamilyClinicalDTO, type MeDTO, type PublicOutcome,
  CLINICAL_NOTICE_POINTS, portalApi, retryLabel,
} from "@/lib/portal";
import { FormAlert, LegalBasisNote, NoticeList, PageTitle, PasswordField } from "@/components/portal/ui";
import { card, pillOutline, pillPrimary, sectionTitle, snoozeClinicalNotice } from "@/components/portal/styles";

// Información de salud en el portal (etapa A): la cuenta la activa aceptando
// el aviso y confirmando su contraseña, y puede dejar de verla cuando quiera.
// Todavía no se muestra nada clínico: por persona se explica qué falta, sin
// dar nunca el motivo real (solo las respuestas de PublicOutcome).

export const Route = createFileRoute("/portal/informacion-salud")({
  component: InformacionSaludPage,
});

const HERE = "/portal/informacion-salud";
const TITLE = "Información de salud en el portal";

// Una sola respuesta por persona: si alguna de las dos áreas ya se puede ver,
// eso; si falta verificar el vínculo, eso (sirve para las dos)
function personOutcome(c: ChildClinicalDTO): PublicOutcome {
  const all = [c.info, c.practice];
  if (all.includes("ok")) return "ok";
  if (all.includes("verify")) return "verify";
  return "not_available"; // "consent" no debería llegar con la información activada
}

function InformacionSaludPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<MeDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const focusFlash = useRef(false);

  // quiet: actualiza después de activar o desactivar sin tapar la pantalla si falla
  const load = useCallback(async (quiet = false): Promise<MeDTO | null> => {
    if (!quiet) setLoadError(null);
    const r = await portalApi.me();
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: HERE }, replace: true });
        return null;
      }
      if (!quiet) setLoadError("No pudimos cargar esta página. Probá de nuevo en un rato.");
      return null;
    }
    setData(r.data);
    return r.data;
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  // Después de activar o desactivar, el foco va al mensaje (lectores de pantalla)
  useEffect(() => {
    if (!focusFlash.current || !flash) return;
    focusFlash.current = false;
    flashRef.current?.focus();
  });

  // Cambió la información de salud: se recarga todo (el estado de cada
  // persona depende de eso) y, si falla, al menos se ve el cambio
  async function changed(clinical: FamilyClinicalDTO, message: string) {
    const fresh = await load(true);
    if (!fresh) setData((d) => d && { ...d, clinical });
    setFlash(message);
    focusFlash.current = true;
  }

  const back = (
    <Link to="/portal" className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary">
      <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Inicio
    </Link>
  );

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <div className={`${card} flex flex-col gap-3`} role="alert">
          <p className="text-base">{loadError}</p>
          <button type="button" onClick={() => void load()} className={pillOutline}>Reintentar</button>
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

  const clinical = data.clinical;
  const accepted = !!clinical?.consent.accepted;
  // «Me grabo» prendido (práctica, actividades y grabaciones)
  const recordingsOn = !!clinical && (["practice", "activities", "recordings"] as const).every((f) => clinical.features.includes(f));

  return (
    <div className="flex flex-col gap-4">
      {back}
      <PageTitle sub={clinical && !accepted ? "Es optativo: si no la activás, ves los turnos igual que siempre." : undefined}>{TITLE}</PageTitle>

      {flash && (
        <div ref={flashRef} tabIndex={-1} role="status"
          className="flex scroll-mt-24 items-start gap-2 rounded-2xl bg-[color:var(--status-available-bg)] px-4 py-3 text-base font-semibold text-[oklch(0.42_0.12_150)] outline-none">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{flash}</span>
        </div>
      )}

      {!clinical ? (
        <div className={`${card} flex flex-col gap-3`}>
          <p className="text-base">Todavía no está disponible.</p>
          <Link to="/portal" className="min-h-11 self-start pt-2 text-base font-bold text-primary underline-offset-2 hover:underline">
            Volver al inicio →
          </Link>
        </div>
      ) : accepted ? (
        <Activated data={data} onRevoked={(c) => changed(c, "Listo: dejaste de ver la información de salud. Los turnos siguen igual.")}
          onAction={() => setFlash(null)} />
      ) : (
        <Activate clinical={clinical}
          onActivated={(c) => changed(c, "Listo: activaste la información de salud. Nada aparece hasta que tu profesional lo publique.")}
          onAction={() => setFlash(null)} />
      )}

      {recordingsOn && (
        <RecordingsConsent onDone={(message) => { setFlash(message); focusFlash.current = true; }} />
      )}
    </div>
  );
}

// ── Sin activar: el aviso, la casilla y la contraseña ─────────────────────────

function Activate({ clinical, onActivated, onAction }: {
  clinical: FamilyClinicalDTO;
  onActivated: (c: FamilyClinicalDTO) => Promise<void>;
  onAction: () => void;
}) {
  const navigate = useNavigate();
  const [accept, setAccept] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<React.ReactNode>(null);
  const [passwordError, setPasswordError] = useState(false);
  const [sending, setSending] = useState(false);
  const acceptRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Ya la había activado con un aviso anterior: tiene que aceptar el nuevo
  const renew = !!clinical.consent.version && clinical.consent.version !== clinical.consent.current_version;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onAction();
    setError(null);
    setPasswordError(false);
    if (!accept) {
      setError("Marcá la casilla para confirmar que leíste el aviso.");
      acceptRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Escribí tu contraseña del portal.");
      setPasswordError(true);
      passwordRef.current?.focus();
      return;
    }
    setSending(true);
    const r = await portalApi.clinicalConsent(true, password);
    if (!r.ok) {
      setSending(false);
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: HERE } });
        return;
      }
      if (r.code === "PASSWORD") {
        setError("La contraseña no es correcta.");
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
    // Se queda en "Activando…" hasta que la pantalla cambia
    await onActivated(r.data);
  }

  function notNow() {
    snoozeClinicalNotice();
    navigate({ to: "/portal" });
  }

  return (
    <>
      {renew && (
        <p className="flex items-start gap-2 rounded-2xl bg-[color:var(--status-pending-bg)] px-4 py-3 text-base font-semibold text-[oklch(0.45_0.11_70)]">
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>Actualizamos el aviso. Para seguir viendo la información de salud, leelo y aceptalo de nuevo.</span>
        </p>
      )}

      <section aria-labelledby="portal-salud-como" className={`${card} flex flex-col gap-4`}>
        <h2 id="portal-salud-como" className="font-display text-lg font-bold leading-snug">Cómo funciona</h2>
        <NoticeList points={CLINICAL_NOTICE_POINTS} />
        <Link to="/portal/privacidad" className="min-h-11 self-start pt-2 text-base font-bold text-primary underline underline-offset-2">
          Leer el aviso de privacidad completo
        </Link>
      </section>

      <form onSubmit={submit} noValidate className={`${card} flex flex-col gap-4`}>
        <LegalBasisNote basis={CLINICAL_LEGAL_BASIS} />
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-base font-semibold">
          <input ref={acceptRef} type="checkbox" checked={accept} required
            onChange={(e) => { setAccept(e.target.checked); setError(null); }}
            className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--primary)]" />
          Leí el aviso y quiero ver la información de salud en el portal
        </label>
        <PasswordField id="portal-salud-password" label="Tu contraseña" value={password} inputRef={passwordRef}
          onChange={(v) => { setPassword(v); setPasswordError(false); }} invalid={passwordError}
          help="La misma con la que entrás al portal. Así confirmamos que sos vos." />
        <FormAlert>{error}</FormAlert>
        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          <button type="submit" disabled={sending} className={pillPrimary}>{sending ? "Activando…" : "Activar"}</button>
          <button type="button" onClick={notNow} disabled={sending} className={pillOutline}>Ahora no</button>
        </div>
      </form>
    </>
  );
}

// ── Activada: el estado de cada persona y "dejar de verla" ────────────────────

function personText(c: ChildDTO, outcome: PublicOutcome): string {
  switch (outcome) {
    case "ok":
      return c.self
        ? "Cuando tu profesional comparta algo, lo vas a ver en «Mi información»."
        : `Cuando su profesional comparta algo, lo vas a ver en «Información de ${c.first_name}».`;
    case "verify":
      return c.self
        ? "Para verla, la primera vez tenés que pasar por el centro con tu DNI."
        : "Para verla, la primera vez tenés que pasar por el centro con tu DNI. Si sos mamá, papá o tutor/a, traé también la partida o el documento que lo acredite.";
    default:
      return "Todavía no hay información para ver acá. Cuando el equipo comparta algo, te avisamos.";
  }
}

function Activated({ data, onRevoked, onAction }: {
  data: MeDTO;
  onRevoked: (c: FamilyClinicalDTO) => Promise<void>;
  onAction: () => void;
}) {
  const navigate = useNavigate();
  const askId = useId();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const askRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Adónde va el foco después de abrir o cerrar la confirmación
  const focusNext = useRef<"ask" | "button" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "ask" ? askRef : buttonRef).current?.focus();
  });

  const people = data.children.filter((c) => c.clinical);
  const anySelf = people.some((c) => c.self);
  const onlySelf = anySelf && people.every((c) => c.self);
  // Con "Mi información" prendida, un acceso a la de cada persona que ya la puede ver
  const infoOn = !!data.clinical?.features.includes("info");

  async function revoke() {
    setSaving(true);
    setError(null);
    const r = await portalApi.clinicalConsent(false);
    if (!r.ok) {
      setSaving(false);
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: HERE } });
        return;
      }
      setError(r.error);
      return;
    }
    await onRevoked(r.data);
  }

  return (
    <>
      <section aria-labelledby="portal-salud-activa" className={`${card} flex flex-col gap-2`}>
        <h2 id="portal-salud-activa" className="flex items-center gap-2 font-display text-lg font-bold leading-snug">
          <CircleCheck className="h-6 w-6 shrink-0 text-[oklch(0.55_0.15_150)]" aria-hidden="true" />
          Activaste la información de salud
        </h2>
        <p className="text-base text-muted-foreground">Nada aparece hasta que tu profesional lo revisa y lo publica.</p>
        <Link to="/portal/privacidad" className="min-h-11 self-start pt-2 text-base font-bold text-primary underline underline-offset-2">
          Leer el aviso de privacidad
        </Link>
      </section>

      {people.length > 0 && (
        <section aria-labelledby="portal-salud-personas" className="mt-2 flex flex-col gap-3">
          <h2 id="portal-salud-personas" className={sectionTitle}>
            {onlySelf ? "Tu información" : anySelf ? "Tu información y la de tus chicos" : "Tus chicos"}
          </h2>
          {people.map((c) => {
            const outcome = personOutcome(c.clinical!);
            return (
              <article key={c.id} className={`${card} flex flex-col gap-2`}>
                <h3 className="font-display text-xl font-bold">{c.self ? "Vos" : c.first_name}</h3>
                <p className="text-base">{personText(c, outcome)}</p>
                {outcome === "verify" && (
                  <p className="text-base text-muted-foreground">{CENTER.address} · {CENTER.hoursLong}</p>
                )}
                {infoOn && c.clinical!.info === "ok" && (
                  <Link to="/portal/informacion/$patientId" params={{ patientId: c.id }}
                    className="min-h-11 self-start pt-2 text-base font-bold text-primary underline-offset-2 hover:underline">
                    {c.self ? "Ver tu información →" : `Ver la información de ${c.first_name} →`}
                  </Link>
                )}
              </article>
            );
          })}
        </section>
      )}

      <div className="mt-2 flex flex-col gap-3">
        {confirming ? (
          <div role="group" aria-labelledby={askId} className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
            <p id={askId} ref={askRef} tabIndex={-1} className="text-base font-bold outline-none">
              ¿Dejar de ver la información de salud? Los turnos siguen igual.
            </p>
            <FormAlert>{error}</FormAlert>
            <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
              <button type="button" onClick={() => void revoke()} disabled={saving} className={pillPrimary}>
                {saving ? "Guardando…" : "Sí, dejar de verla"}
              </button>
              <button type="button" disabled={saving} className={pillOutline}
                onClick={() => { focusNext.current = "button"; setError(null); setConfirming(false); }}>
                No
              </button>
            </div>
          </div>
        ) : (
          <button ref={buttonRef} type="button" className={`${pillOutline} min-[420px]:self-start`}
            onClick={() => { onAction(); focusNext.current = "ask"; setError(null); setConfirming(true); }}>
            Dejar de ver la información de salud
          </button>
        )}
      </div>
    </>
  );
}

// ── «Me grabo»: el permiso de grabaciones de la cuenta ────────────────────────
// Retirarlo borra ya los audios que mandó la cuenta (server/lib/recordings.ts);
// sin permiso pero con audios guardados (por ejemplo, después de un aviso
// nuevo), igual se pueden borrar. Sin permiso ni audios, no se muestra.

function RecordingsConsent({ onDone }: { onDone: (message: string) => void }) {
  const askId = useId();
  const [state, setState] = useState<FamilyRecordingConsentDTO | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const askRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"ask" | "button" | null>(null);

  useEffect(() => {
    let live = true;
    void portalApi.recordingConsent().then((r) => { if (live && r.ok) setState(r.data); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    (target === "ask" ? askRef : buttonRef).current?.focus();
  });

  if (!state || (!state.accepted && state.audios === 0)) return null;
  const n = state.audios;
  const saved = n === 0 ? null : `Hay ${n} ${n === 1 ? "grabación" : "grabaciones"} con el audio guardado.`;

  async function revoke() {
    if (!state) return;
    const before = state;
    setSaving(true);
    setError(null);
    const r = await portalApi.recordingAccept(false);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setConfirming(false);
    setState(r.data);
    const audios = before.audios === 0 ? null : before.audios === 1 ? "se borró el audio que mandaste" : `se borraron los ${before.audios} audios que mandaste`;
    onDone(before.accepted
      ? `Listo: retiraste el permiso de grabaciones${audios ? ` y ${audios}` : ""}.`
      : `Listo: ${audios ?? "no había audios guardados"}.`);
  }

  return (
    <section aria-labelledby="portal-salud-grabaciones" className={`${card} mt-2 flex flex-col gap-3`}>
      <h2 id="portal-salud-grabaciones" className="flex items-center gap-2 font-display text-lg font-bold leading-snug">
        <Mic className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /> Grabaciones de «Me grabo»
      </h2>
      <p className="text-base">
        {state.accepted ? "Diste permiso para mandar grabaciones al equipo profesional. " : ""}
        {saved ? `${saved} ` : ""}Cada audio se borra solo a los 90 días.
      </p>
      {confirming ? (
        <div role="group" aria-labelledby={askId} className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
          <p id={askId} ref={askRef} tabIndex={-1} className="text-base font-bold outline-none">
            {state.accepted
              ? "¿Retirar el permiso? No se mandan más grabaciones y se borran ya los audios que mandaste. Las anotaciones del profesional quedan."
              : "¿Borrar ya los audios que mandaste? Las anotaciones del profesional quedan."}
          </p>
          <FormAlert>{error}</FormAlert>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <button type="button" onClick={() => void revoke()} disabled={saving} className={pillPrimary}>
              {saving ? "Guardando…" : state.accepted ? "Sí, retirar" : "Sí, borrar"}
            </button>
            <button type="button" disabled={saving} className={pillOutline}
              onClick={() => { focusNext.current = "button"; setError(null); setConfirming(false); }}>
              No
            </button>
          </div>
        </div>
      ) : (
        <button ref={buttonRef} type="button" className={`${pillOutline} min-[420px]:self-start`}
          onClick={() => { focusNext.current = "ask"; setError(null); setConfirming(true); }}>
          {state.accepted ? "Retirar el permiso de grabaciones" : "Borrar los audios ahora"}
        </button>
      )}
    </section>
  );
}
