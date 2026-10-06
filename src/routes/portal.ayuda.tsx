import { createFileRoute } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { CENTER } from "@/lib/center";
import { PageTitle } from "@/components/portal/ui";
import { card } from "@/components/portal/styles";

export const Route = createFileRoute("/portal/ayuda")({
  component: AyudaPage,
});

const FAQ = [
  {
    q: "¿Puedo pedir o cambiar un turno desde acá?",
    a: "No. El centro asigna los días y horarios. Si no pueden venir, avisá con «No vamos a poder ir» y el equipo te contacta si hace falta.",
  },
  {
    q: "¿Avisar que no vamos cancela el turno?",
    a: "No automáticamente. El equipo revisa tu aviso y te contesta en el portal (por ejemplo, «Falta justificada»). Si podés, avisá con al menos un día de anticipación: así le damos el horario a otra familia.",
  },
  {
    q: "¿Por qué no veo diagnósticos ni informes?",
    a: "El portal es solo para turnos y avisos. Si necesitás una copia de la historia clínica, pedila en el centro: se entrega en mano a la madre, el padre o el/la tutor/a, con DNI.",
  },
  {
    q: "Me olvidé la contraseña.",
    a: "En «Ingresar», tocá «¿Olvidaste tu contraseña?» y pedí un código nuevo, o llamanos.",
  },
  {
    q: "Me pidieron el código por WhatsApp o por teléfono.",
    a: "No lo pases. Nadie del CIMT te lo va a pedir. El código es solo para que vos actives tu cuenta.",
  },
  {
    q: "Otra persona de la familia quiere entrar.",
    a: "Cada adulto tiene su propia cuenta y su propia contraseña. Pedile al centro una invitación para esa persona.",
  },
  {
    q: "Alguien vinculado no debería ver estos turnos.",
    a: "Llamanos cuanto antes y le quitamos el acceso.",
  },
  {
    q: "¿Cómo dejo de usar el portal?",
    a: "Avisanos y desactivamos tu acceso. La atención sigue igual.",
  },
];

function AyudaPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub="Preguntas frecuentes sobre el Portal de familias.">Ayuda</PageTitle>
      <div className="flex flex-col gap-2">
        {FAQ.map((f) => (
          <details key={f.q} className="group rounded-2xl border border-border/60 bg-card px-5 shadow-[var(--shadow-card)]">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-display text-base font-bold [&::-webkit-details-marker]:hidden">
              {f.q}
              <span aria-hidden="true" className="text-xl text-primary transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="pb-4 text-base text-muted-foreground">{f.a}</p>
          </details>
        ))}
      </div>
      <div className={`${card} flex flex-col gap-1`}>
        <p className="font-display text-lg font-bold">¿Necesitás hablar con el centro?</p>
        <a href={CENTER.phoneHref} className="flex min-h-11 items-center gap-2 text-lg font-bold text-primary">
          <Phone className="h-5 w-5" aria-hidden="true" /> {CENTER.phoneDisplay}
        </a>
        <p className="text-base text-muted-foreground">{CENTER.phoneNote} · {CENTER.hoursLong} · {CENTER.address}</p>
      </div>
    </div>
  );
}
