import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CircleCheck, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  type ActivationInfo, PRIVACY_POINTS, PRIVACY_VERSION,
  isValidDni, normalizeCode, normalizeDni, passwordProblem, portalApi, retryLabel,
} from "@/lib/portal";
import { CallUs, FormAlert, PageTitle } from "@/components/portal/ui";
import { card, inputClass, pillOutline, pillPrimary } from "@/components/portal/styles";

// Activar la cuenta con el código que da el centro (o elegir una contraseña
// nueva con un código de recuperación). El código puede venir en el link de
// WhatsApp como /portal/activar#c=1234567890: el fragmento no llega a los
// logs del servidor; se guarda en sessionStorage y se borra de la URL.

export const Route = createFileRoute("/portal/activar")({
  component: ActivarPage,
});

const CODE_KEY = "cimt-portal-code";
type Step = 1 | 2 | 3 | "done";

function ActivarPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [code, setCode] = useState("");
  const [dni, setDni] = useState("");
  const [info, setInfo] = useState<ActivationInfo | null>(null);
  const [childrenOk, setChildrenOk] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<React.ReactNode>(null);
  const [fails, setFails] = useState(0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ first_name: string; children: string[] } | null>(null);
  const headingRef = useRef<HTMLDivElement>(null);

  // Código desde el link (#c=…) o desde sessionStorage
  useEffect(() => {
    try {
      const m = window.location.hash.match(/[#&]c=([\d\s-]+)/);
      if (m) {
        const c = normalizeCode(m[1]);
        sessionStorage.setItem(CODE_KEY, c);
        history.replaceState(null, "", window.location.pathname + window.location.search);
        setCode(c);
      } else {
        const saved = sessionStorage.getItem(CODE_KEY);
        if (saved) setCode(saved);
      }
    } catch { /* sin storage: se escribe a mano */ }
  }, []);

  // Al cambiar de paso, el foco va al título
  useEffect(() => {
    headingRef.current?.querySelector("h1")?.focus();
  }, [step]);

  function failMessage(status: number, msg: string, retryAt?: string): React.ReactNode {
    if (status === 429) return <>Hiciste muchos intentos. Probá de nuevo {retryLabel(retryAt)} o <CallUs />.</>;
    if (status === 503) return "No se pudo conectar. Revisá tu conexión y probá de nuevo.";
    return msg;
  }

  async function checkCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.length !== 10) { setError("El código tiene 10 números."); return; }
    if (!isValidDni(dni)) { setError("Revisá tu DNI: tiene que tener entre 6 y 10 números."); return; }
    setSending(true);
    const r = await portalApi.activationCheck(dni, code);
    setSending(false);
    if (!r.ok) {
      if (r.code === "ACCOUNT_EXISTS") {
        setError(<>{r.error} <Link to="/portal/ingresar" className="underline">Ir a ingresar</Link></>);
        return;
      }
      const n = fails + 1;
      setFails(n);
      setError(
        <>
          {failMessage(r.status, r.error, r.retry_at)}
          {n >= 2 && r.status === 400 && (
            <span className="mt-1 block font-normal">Fijate que sea <b>tu</b> DNI, no el de tu hijo o hija. Si sigue sin funcionar, <CallUs />: puede haber un error en el código.</span>
          )}
        </>,
      );
      return;
    }
    setInfo(r.data);
    setChildrenOk(null);
    setStep(2);
  }

  // El código suma chicos a una cuenta que ya existe: se confirma con la contraseña actual
  const linking = info?.needs === "current_password";

  async function complete() {
    setError(null);
    setSending(true);
    const r = await portalApi.activationComplete({
      dni, code, password, password_repeat: linking ? password : repeat,
      accept_privacy_version: info?.needs_privacy ? PRIVACY_VERSION : undefined,
    });
    setSending(false);
    if (!r.ok) {
      setError(failMessage(r.status, r.error, r.retry_at));
      if (r.code === "PASSWORD") setStep(2);
      return;
    }
    try { sessionStorage.removeItem(CODE_KEY); } catch { /* nada */ }
    setDone(r.data);
    setStep("done");
  }

  function passwordStep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (linking) {
      if (!password) { setError("Escribí tu contraseña actual del portal."); return; }
      void complete();
      return;
    }
    const problem = passwordProblem(password, repeat, dni);
    if (problem) { setError(problem); return; }
    if (info?.needs_privacy) setStep(3);
    else void complete();
  }

  const recovery = info?.purpose === "recuperacion";
  // Hasta saber si el código es de alta (3 pasos) o de contraseña nueva (2), no se muestra el total
  const stepLabel = (n: number) => (info ? `Paso ${n} de ${info.needs_privacy ? 3 : 2}` : `Paso ${n}`);

  return (
    <div ref={headingRef} className="flex flex-col gap-5">
      {step === 1 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">{stepLabel(1)}</p>
          <PageTitle sub="Para activar tu cuenta o elegir una contraseña nueva, usá el código que te mandamos por WhatsApp o que te dimos impreso.">Ingresá tu código</PageTitle>
          <form onSubmit={checkCode} noValidate className={`${card} flex flex-col gap-4`}>
            <div className="flex flex-col gap-2">
              <label htmlFor="portal-code" className="text-base font-bold">Código</label>
              <InputOTP
                id="portal-code" maxLength={10} value={code} onChange={setCode}
                pattern={REGEXP_ONLY_DIGITS} inputMode="numeric" autoComplete="one-time-code"
                pasteTransformer={(t) => normalizeCode(t)}
                containerClassName="gap-1.5 sm:gap-2"
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4].map((i) => <InputOTPSlot key={i} index={i} className="h-12 w-7 bg-card text-lg font-bold min-[400px]:w-8 sm:w-10 sm:text-xl" />)}
                </InputOTPGroup>
                <InputOTPGroup>
                  {[5, 6, 7, 8, 9].map((i) => <InputOTPSlot key={i} index={i} className="h-12 w-7 bg-card text-lg font-bold min-[400px]:w-8 sm:w-10 sm:text-xl" />)}
                </InputOTPGroup>
              </InputOTP>
              <p className="text-sm text-muted-foreground">Si tocaste el link de WhatsApp, ya está cargado.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="portal-act-dni" className="text-base font-bold">Tu DNI</label>
              <input id="portal-act-dni" name="username" inputMode="numeric" autoComplete="username" value={dni}
                placeholder="El tuyo, no el de tu hijo o hija"
                onChange={(e) => setDni(normalizeDni(e.target.value))} className={inputClass} />
            </div>
            <p className="rounded-2xl bg-[color:var(--primary-soft)] px-4 py-3 text-base font-semibold text-[color:var(--primary-deep)]">
              No le pases este código a nadie. Nadie del CIMT te lo va a pedir.
            </p>
            <FormAlert>{error}</FormAlert>
            <button type="submit" disabled={sending} className={pillPrimary}>{sending ? "Revisando…" : "Continuar"}</button>
          </form>
          <Link to="/portal/ingresar" className="min-h-11 text-base font-bold text-primary underline-offset-2 hover:underline">
            ← Ya tengo cuenta: ingresar
          </Link>
        </>
      )}

      {step === 2 && info && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">{stepLabel(2)}</p>
          <PageTitle>{recovery ? "Elegí una contraseña nueva" : linking ? "Sumar a tu cuenta" : "Confirmá"}</PageTitle>
          <div className={`${card} flex flex-col gap-3`}>
            <p className="font-display text-lg font-bold">{recovery ? "Tu cuenta está vinculada con:" : linking ? "Vas a sumar a tu cuenta a:" : "Vas a vincular tu cuenta con:"}</p>
            <ul className="flex flex-wrap gap-2">
              {info.children.map((c) => (
                <li key={c} className="rounded-full bg-[color:var(--primary-soft)] px-4 py-1.5 text-base font-bold text-[color:var(--primary-deep)]">{c}</li>
              ))}
            </ul>
            {childrenOk === null && (
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                <button type="button" onClick={() => setChildrenOk(true)} className={pillPrimary}>Sí, es correcto</button>
                <button type="button" onClick={() => setChildrenOk(false)} className={pillOutline}>No es mi chico/a</button>
              </div>
            )}
            {childrenOk === false && (
              <div role="alert" className="rounded-2xl bg-[color:var(--status-occupied-bg)] px-4 py-3 text-base font-semibold text-[oklch(0.48_0.19_25)]">
                No sigas. <CallUs /> (solo llamadas) así lo corregimos.
                <button type="button" onClick={() => setChildrenOk(null)}
                  className="mt-2 block min-h-11 font-bold text-[color:var(--primary-deep)] underline underline-offset-2">
                  Me equivoqué, volver
                </button>
              </div>
            )}
          </div>

          {childrenOk && (
            <form onSubmit={passwordStep} noValidate className={`${card} flex flex-col gap-4`}>
              {/* Para que el gestor de contraseñas guarde el par DNI + contraseña */}
              <input type="text" name="username" autoComplete="username" value={dni} readOnly hidden />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="portal-new-password" className="text-base font-bold">{linking ? "Tu contraseña actual del portal" : recovery ? "Contraseña nueva" : "Elegí una contraseña"}</label>
                <div className="relative">
                  <input id="portal-new-password" type={showPassword ? "text" : "password"} autoComplete={linking ? "current-password" : "new-password"}
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    aria-describedby="portal-password-help" className={`${inputClass} pr-24`} />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-pressed={showPassword}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className="absolute inset-y-0 right-1 my-auto flex h-11 items-center gap-1 rounded-full px-3 text-sm font-bold text-primary">
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    {showPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </div>
                <p id="portal-password-help" className="text-sm text-muted-foreground">
                  {linking ? "La misma con la que entrás al portal." : "Al menos 8 caracteres. No uses tu DNI ni algo fácil como 12345678."}
                </p>
              </div>
              {!linking && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="portal-repeat-password" className="text-base font-bold">Repetila</label>
                  <input id="portal-repeat-password" type={showPassword ? "text" : "password"} autoComplete="new-password"
                    value={repeat} onChange={(e) => setRepeat(e.target.value)} className={inputClass} />
                </div>
              )}
              <FormAlert>{error}</FormAlert>
              <button type="submit" disabled={sending} className={pillPrimary}>
                {sending ? "Guardando…" : recovery ? "Guardar contraseña" : linking ? "Sumar a mi cuenta" : "Continuar"}
              </button>
            </form>
          )}
        </>
      )}

      {step === 3 && info && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Paso 3 de 3</p>
          <PageTitle>Antes de empezar</PageTitle>
          <form onSubmit={(e) => { e.preventDefault(); if (accept) void complete(); }} className={`${card} flex flex-col gap-4`}>
            <ul className="flex flex-col gap-2.5">
              {PRIVACY_POINTS.map((p) => (
                <li key={p} className="flex gap-2.5 text-base">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-base font-semibold">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1 h-5 w-5 accent-[color:var(--primary)]" />
              Leí el aviso y quiero usar el portal.
            </label>
            <FormAlert>{error}</FormAlert>
            <button type="submit" disabled={!accept || sending} className={pillPrimary}>
              {sending ? "Activando…" : "Activar mi cuenta"}
            </button>
          </form>
        </>
      )}

      {step === "done" && done && (
        <div className={`${card} flex flex-col items-center gap-3 text-center`}>
          <CircleCheck className="h-14 w-14 text-[oklch(0.55_0.15_150)]" aria-hidden="true" />
          <PageTitle>{recovery ? "Contraseña actualizada" : `¡Listo, ${done.first_name}!`}</PageTitle>
          {done.children.length > 0 && (
            <p className="text-base">Ya podés ver los turnos de {listNames(done.children)}.</p>
          )}
          <p className="text-base text-muted-foreground">
            La próxima vez, entrá a <b>{typeof window !== "undefined" ? window.location.host : ""}/portal</b> con tu DNI y tu contraseña.
          </p>
          <button type="button" onClick={() => navigate({ to: "/portal" })} className={`${pillPrimary} w-full`}>Ir al inicio</button>
        </div>
      )}
    </div>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}
