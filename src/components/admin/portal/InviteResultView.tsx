import { toast } from "sonner";
import { Copy, MessageCircle, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CENTER } from "@/lib/center";
import { type StaffInviteResult, inviteLink, inviteMessage } from "@/lib/portalStaff";

// Resultado de una invitación al portal: el código (se muestra una sola vez),
// WhatsApp con el mensaje armado, copiar el mensaje e imprimir la hoja.
// Lo usan la invitación al adulto responsable y la del propio paciente adulto.

export function InviteResultView({ result, personName, phone, waNumber, channel, onClose }: {
  result: StaffInviteResult;
  personName: string; // nombre completo de quien recibe el código
  phone: string | null;
  waNumber: string | null;
  channel: "whatsapp" | "impresa";
  onClose: () => void;
}) {
  const firstName = personName.split(/\s+/)[0] ?? personName;
  // Qué va a ver: sus propios turnos, los de sus chicos, o los dos
  const what = [result.self ? "sus propios turnos" : null, result.children.length ? `los turnos de ${result.children.join(" y ")}` : null]
    .filter(Boolean).join(" y ");

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(inviteMessage(result));
      toast.success("Mensaje copiado");
    } catch {
      toast.error("No se pudo copiar. Seleccioná el texto a mano.");
    }
  }

  function print() {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const until = new Date(result.expires_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const portalUrl = `${window.location.host}/portal/activar`;
    const whatForYou = [result.self ? "tus turnos" : null, result.children.length ? `los turnos de ${result.children.join(" y ")}` : null]
      .filter(Boolean).join(" y ");
    const w = window.open("", "_blank");
    if (!w) { toast.error("Permití las ventanas emergentes para imprimir"); return; }
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Invitación al Portal de familias</title>
      <style>html{color-scheme:light;background:#fff}body{font-family:system-ui,sans-serif;margin:32px;font-size:13pt;color:#1a2b3c;max-width:640px}
      h1{font-size:18pt;margin:0 0 4px}.code{font-size:30pt;font-weight:800;letter-spacing:4px;border:2px dashed #1a2b3c;border-radius:12px;padding:12px;text-align:center;margin:16px 0}
      .url{font-size:16pt;font-weight:700}ol{line-height:1.7}.warn{border-left:4px solid #b45309;padding:8px 12px;background:#fff7ed}</style></head><body>
      <h1>CIMT — Portal de familias</h1>
      <p>${esc(personName)} · para ver ${esc(whatForYou)}</p>
      <div class="code">${esc(result.code)}</div>
      <p>Vence el ${esc(until)}.</p>
      <ol><li>Entrá a <span class="url">${esc(portalUrl)}</span></li><li>Escribí este código y <b>tu</b> DNI${result.children.length ? " (no el de tu hijo o hija)" : ""}.</li><li>${result.purpose === "vincular" ? "Confirmá con tu contraseña del portal." : "Elegí una contraseña y aceptá el aviso de privacidad."}</li></ol>
      <p class="warn">No le pases este código a nadie. Nadie del CIMT te lo va a pedir por teléfono ni por WhatsApp.</p>
      <p>¿Dudas? ${esc(CENTER.phoneDisplay)} (solo llamadas) · ${esc(CENTER.hoursLong)} · ${esc(CENTER.address)}</p>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-[color:var(--primary-soft)] p-4 text-center">
        <p className="text-sm font-semibold text-[color:var(--primary-deep)]">Código de {result.first_name}</p>
        <p className="font-display text-4xl font-extrabold tracking-widest text-[color:var(--primary-deep)]">{result.code}</p>
        <p className="mt-1 text-sm">Vence el {new Date(result.expires_at).toLocaleDateString("es-AR")}</p>
      </div>
      <p className="rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm font-semibold text-[oklch(0.42_0.1_70)]">
        Anotalo o envialo ahora: no se vuelve a mostrar.
      </p>
      {result.purpose === "vincular"
        ? <p className="text-sm">{result.first_name} ya tiene cuenta: este código suma {what} a su cuenta. Lo confirma con su contraseña.</p>
        : <p className="text-sm">Con este código {result.first_name} va a ver {what}.</p>}
      {result.replaced && (
        <p className="text-sm font-semibold">Reemplaza al código anterior de {result.first_name}: ese ya no sirve. Avisale que use este.</p>
      )}
      {channel === "whatsapp" && waNumber ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Se va a enviar al <b className="text-foreground">{phone}</b> (teléfono de {firstName} en la ficha).</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="rounded-full bg-[oklch(0.55_0.15_150)] hover:bg-[oklch(0.48_0.14_150)]">
              <a href={`https://wa.me/${waNumber}?text=${encodeURIComponent(inviteMessage(result))}`} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> Abrir WhatsApp
              </a>
            </Button>
            <Button type="button" variant="outline" className="rounded-full" onClick={copyMessage}>
              <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> Copiar mensaje
            </Button>
            <Button type="button" variant="outline" className="rounded-full" onClick={print}>
              <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" /> Imprimir
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="rounded-full" onClick={print}>
            <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" /> Imprimir invitación
          </Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={copyMessage}>
            <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> Copiar mensaje
          </Button>
        </div>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Link de activación</summary>
        <code className="break-all">{inviteLink(result.raw_code)}</code>
      </details>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" onClick={onClose}>Listo</Button>
      </div>
    </div>
  );
}
