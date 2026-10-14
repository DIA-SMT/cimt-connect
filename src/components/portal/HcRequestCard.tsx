import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { CircleCheck, Download, FileText } from "lucide-react";
import { CENTER } from "@/lib/center";
import { type HcDocumentDTO, type HcRequestDTO, hcStatus, portalApi, retryLabel, stampLabel } from "@/lib/portal";
import { CallUs, FormAlert, PasswordField, StatusChip } from "./ui";
import { card, pillOutline, pillPrimary } from "./styles";

// Pedido de copia de la historia clínica tal como lo ve la familia: estado
// (siempre con texto), cómo la pidió (en mano o en el portal) y lo que sigue:
//   - en mano: dónde retirarla; mientras sigue pendiente, cancelarlo.
//   - en el portal (etapa E1): ya enviada, un botón por cada PDF. Solo la
//     cuenta que la pidió, durante 60 días, y con la contraseña confirmada
//     hace poco (403 REAUTH: se pide acá mismo y se reintenta). El enlace que
//     devuelve el servidor vence en un minuto: se usa enseguida y no se guarda.
// title: de quién es la copia, cuando la tarjeta no está dentro de la página
// de la persona (en el inicio, si su página ya no se puede abrir) ·
// onReauthenticated: se volvió a poner la contraseña acá (la misma confirmación
// sirve para ver "Mi información": la página no la vuelve a pedir).

// La primera vez que se descarga en este navegador, un aviso corto antes. Es
// solo una comodidad: si no hay almacenamiento, el aviso se muestra siempre
const DOWNLOAD_NOTICE_KEY = "cimt-portal-descarga-aviso";

function downloadNoticeSeen(): boolean {
  try {
    return localStorage.getItem(DOWNLOAD_NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

function markDownloadNoticeSeen(): void {
  try { localStorage.setItem(DOWNLOAD_NOTICE_KEY, "1"); } catch { /* sin almacenamiento */ }
}

// Baja el archivo con el enlace recién firmado, sin guardarlo en ningún lado.
// Es como ir a esa dirección (window.location.assign): con el enlace del
// servidor, de otro dominio, el navegador lo descarga por el encabezado del
// archivo; con el de la demo (blob:), el atributo download además evita que
// el PDF reemplace al portal y le pone el nombre genérico
function saveFile(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const CHANNEL_TEXT = { portal: "en el portal", mano: "en mano, en el centro" } as const;

type Step = { kind: "notice" | "reauth"; doc: HcDocumentDTO } | null;
type Focus = "status" | "ask" | "button" | "notice" | "reauth" | `doc:${string}`;

export function HcRequestCard({
  req, title, onChanged, onReauthenticated,
}: {
  req: HcRequestDTO;
  title?: string;
  onChanged?: (updated?: HcRequestDTO) => void;
  onReauthenticated?: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const askId = useId();
  const titleId = useId();
  const noticeId = useId();
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ text: string; consent?: boolean } | null>(null);
  // Descarga: el aviso de la primera vez o la contraseña, debajo del archivo
  const [step, setStep] = useState<Step>(null);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  // Nombre del archivo que se bajó (el que va a buscar en las descargas)
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLParagraphElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const reauthRef = useRef<HTMLInputElement>(null);
  const docButtons = useRef(new Map<string, HTMLButtonElement>());
  // Adónde va el foco después de abrir, cerrar o resolver una confirmación
  const focusNext = useRef<Focus | null>(null);
  const status = hcStatus(req);
  const stamp = stampLabel(req.created_at);
  // Enviada es siempre por el portal, aunque la hayan pedido en mano
  const portal = req.status === "enviada" || req.channel === "portal";
  const docs = req.status === "enviada" ? req.documents : [];

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target.startsWith("doc:")) {
      docButtons.current.get(target.slice(4))?.focus();
      return;
    }
    const refs = { status: statusRef, ask: askRef, button: cancelRef, notice: noticeRef, reauth: reauthRef } as const;
    refs[target as keyof typeof refs].current?.focus();
  });

  function toLogin() {
    navigate({ to: "/portal/ingresar", search: { volver: pathname } });
  }

  async function cancel() {
    setSaving(true);
    setError(null);
    const r = await portalApi.hcCancel(req.id);
    setSaving(false);
    if (!r.ok) {
      if (r.status === 401) {
        toLogin();
        return;
      }
      setError({ text: r.error });
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

  // "Descargar" de un archivo: la primera vez en este navegador, antes el aviso
  function startDownload(doc: HcDocumentDTO) {
    setError(null);
    setDownloaded(null);
    if (!downloadNoticeSeen()) {
      focusNext.current = "notice";
      setStep({ kind: "notice", doc });
      return;
    }
    void fetchDoc(doc);
  }

  function closeStep() {
    if (step) focusNext.current = `doc:${step.doc.id}`;
    setStep(null);
  }

  // Al terminar sin abrir otro paso (bien o con error), el foco vuelve siempre
  // al "Descargar" de ese archivo: mientras se preparaba estaba deshabilitado
  // (o tapado por el aviso o la contraseña) y el foco se habría perdido
  async function fetchDoc(doc: HcDocumentDTO) {
    setBusyDoc(doc.id);
    setError(null);
    setDownloaded(null);
    const r = await portalApi.hcDocument(doc.id);
    setBusyDoc(null);
    if (!r.ok) {
      if (r.status === 401) {
        toLogin();
        return;
      }
      // Hace falta volver a poner la contraseña: se pide acá y se reintenta
      if (r.status === 403 && r.code === "REAUTH") {
        focusNext.current = "reauth";
        setStep({ kind: "reauth", doc });
        return;
      }
      focusNext.current = `doc:${doc.id}`;
      setStep(null);
      setError({ text: r.error, consent: r.code === "CONSENT" });
      // Ya no está (venció o la quitaron): la tarjeta se actualiza
      if (r.status === 404 || r.status === 410) onChanged?.();
      return;
    }
    focusNext.current = `doc:${doc.id}`;
    setStep(null);
    markDownloadNoticeSeen();
    saveFile(r.data.url, r.data.file_name);
    setDownloaded(r.data.file_name);
  }

  async function reauthenticated(doc: HcDocumentDTO) {
    onReauthenticated?.();
    await fetchDoc(doc);
  }

  const locked = !!busyDoc || !!step;

  return (
    <article className={`${card} flex flex-col gap-3`}
      aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : `Pedido del ${stamp}`}>
      {title && <h3 id={titleId} className="font-display text-lg font-bold leading-snug">{title}</h3>}
      <div ref={statusRef} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <StatusChip tone={status.tone}>{status.text}</StatusChip>
        <p className="text-base text-muted-foreground">La pediste el {stamp} para recibirla {CHANNEL_TEXT[portal ? "portal" : "mano"]}.</p>
      </div>

      {req.status === "lista" && (
        <p className="text-base">
          Retirala en {CENTER.address} · {CENTER.hoursLong}. <b>Traé tu DNI:</b> se la entregamos a quien la pidió.
        </p>
      )}
      {req.status === "pendiente" && (
        <p className="text-base">{portal ? "Te avisamos acá cuando la puedas descargar." : "Te avisamos acá cuando esté lista."}</p>
      )}
      {req.status === "rechazada" && <p className="text-base">Si tenés dudas, <CallUs />.</p>}

      {/* Enviada por el portal y todavía disponible: un botón por archivo */}
      {docs.length > 0 && (
        <>
          <ul aria-label="Archivos de la copia" className="flex flex-col gap-2">
            {docs.map((d) => {
              const open = step?.doc.id === d.id ? step.kind : null;
              return (
                <li key={d.id} className="flex flex-col gap-3 rounded-2xl bg-muted p-4">
                  <div className="flex flex-col gap-3 min-[420px]:flex-row min-[420px]:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                      <div className="flex min-w-0 flex-col">
                        <span className="break-words text-base font-bold">{d.label}</span>
                        <span className="text-sm text-muted-foreground">
                          Código de verificación <span className="whitespace-nowrap font-mono font-bold text-foreground">{d.code}</span>
                        </span>
                      </div>
                    </div>
                    {!open && (
                      <button type="button" disabled={locked} onClick={() => startDownload(d)}
                        ref={(el) => { if (el) docButtons.current.set(d.id, el); else docButtons.current.delete(d.id); }}
                        className={`${pillPrimary} gap-2 min-[420px]:shrink-0`}>
                        <Download className="h-5 w-5" aria-hidden="true" />
                        {busyDoc === d.id ? "Preparando…" : <>Descargar<span className="sr-only"> {d.label}</span></>}
                      </button>
                    )}
                  </div>

                  {open === "notice" && (
                    <div role="group" aria-labelledby={noticeId} className="flex flex-col gap-3 rounded-2xl bg-card p-4">
                      <p id={noticeId} ref={noticeRef} tabIndex={-1} className="text-base font-semibold outline-none">
                        Queda guardado en este celular o computadora. Si lo compartís, tené en cuenta que es información de salud.
                      </p>
                      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                        <button type="button" onClick={() => void fetchDoc(d)} disabled={busyDoc === d.id} className={pillPrimary}>
                          {busyDoc === d.id ? "Preparando…" : "Descargar"}
                        </button>
                        <button type="button" onClick={closeStep} disabled={busyDoc === d.id} className={pillOutline}>Cancelar</button>
                      </div>
                    </div>
                  )}

                  {open === "reauth" && (
                    <DownloadReauth inputRef={reauthRef} onDone={() => reauthenticated(d)} onCancel={closeStep}
                      onExpired={toLogin} />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-muted-foreground">
            Cada archivo tiene la firma digital de la Dirección del CIMT. Con el código de verificación, el centro puede confirmar que es auténtico.
          </p>
        </>
      )}

      {/* Enviada por el portal, pero ya pasaron los días para descargarla */}
      {req.status === "enviada" && docs.length === 0 && (
        <p className="text-base">
          {req.child_page ? "Si la necesitás, pedila de nuevo." : <>Si la necesitás, <CallUs />.</>}
        </p>
      )}

      {downloaded && (
        <p role="status" className="flex items-start gap-2 text-base font-semibold text-[oklch(0.42_0.12_150)]">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <span>Listo: buscá «{downloaded}» en las descargas de este celular o computadora.</span>
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
          Cancelar pedido
        </button>
      ))}

      <FormAlert>{error?.text}</FormAlert>
      {error?.consent && (
        <Link to="/portal/informacion-salud" className={`${pillOutline} min-[420px]:self-start`}>
          Activar la información de salud
        </Link>
      )}
    </article>
  );
}

// "Volvé a poner tu contraseña" para descargar (la de los últimos 15 minutos).
// onDone: ya se confirmó; el botón sigue en "Confirmando…" hasta que termina
// el reintento · onExpired: la sesión venció (401)
function DownloadReauth({ inputRef, onDone, onCancel, onExpired }: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDone: () => Promise<void>;
  onCancel: () => void;
  onExpired: () => void;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState(false);
  const [sending, setSending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPasswordError(false);
    if (!password) {
      setError("Escribí tu contraseña del portal.");
      setPasswordError(true);
      inputRef.current?.focus();
      return;
    }
    setSending(true);
    const r = await portalApi.reauth(password);
    if (!r.ok) {
      setSending(false);
      if (r.status === 401) {
        onExpired();
        return;
      }
      if (r.code === "PASSWORD") {
        setError(r.error);
        setPasswordError(true);
        inputRef.current?.focus();
      } else if (r.status === 429) {
        setError(`Hiciste muchos intentos. Probá de nuevo ${retryLabel(r.retry_at)}.`);
      } else {
        setError(r.error);
      }
      return;
    }
    setPassword("");
    await onDone();
    setSending(false);
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-2xl bg-card p-4">
      <p className="text-base font-semibold">Para descargarla, volvé a poner tu contraseña.</p>
      <PasswordField id={`${id}-password`} label="Tu contraseña" value={password} inputRef={inputRef}
        onChange={(v) => { setPassword(v); setPasswordError(false); }} invalid={passwordError}
        help="La misma con la que entrás al portal. Así confirmamos que sos vos." />
      <FormAlert>{error}</FormAlert>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        <button type="submit" disabled={sending} className={pillPrimary}>{sending ? "Confirmando…" : "Continuar"}</button>
        <button type="button" onClick={onCancel} disabled={sending} className={pillOutline}>Cancelar</button>
      </div>
    </form>
  );
}
