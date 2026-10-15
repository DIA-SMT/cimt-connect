import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { CENTER } from "@/lib/center";
import { type ClinicalFeature, portalApi } from "@/lib/portal";
import { PRACTICE_TEXT } from "@/lib/practiceRules";
import { PageTitle } from "@/components/portal/ui";
import { card } from "@/components/portal/styles";
import { announcePracticeNav, practiceHomes, practicePeople } from "@/components/portal/practiceFormat";

export const Route = createFileRoute("/portal/ayuda")({
  component: AyudaPage,
});

type Faq = { q: string; a: React.ReactNode };

// Pedir un turno: solo se explica cómo pedirlo si esta cuenta puede (con
// sesión, el servidor tiene los pedidos de turno y hay personas vinculadas).
// Si no (sin sesión, sin pedidos de turno o sin conexión), la respuesta neutra
const APPT_Q = "¿Puedo pedir o cambiar un turno desde acá?";
const APPT_A_ASK = "Podés pedir un turno desde «Turnos» → «Pedir un turno»: contás qué días y horarios te quedan bien y el centro te asigna uno según la agenda. Te avisamos acá. Para cambiar un turno ya dado, avisá «No vamos a poder ir» y el equipo te contacta.";
const APPT_A_CALL = "El centro asigna los días y horarios. Si necesitás un turno, llamanos. Para cambiar uno ya dado, avisá «No vamos a poder ir» y el equipo te contacta.";

// Diagnósticos e informes: sin "Mi información" (etapa "info"), el portal no
// muestra nada clínico. Con ella, solo lo que el profesional publica (nunca el
// historial completo): la pregunta se reemplaza por REPORTS_INFO
const REPORTS_Q = "¿Por qué no veo diagnósticos ni informes?";
const REPORTS_A_HAND = "El portal es solo para turnos, avisos y pedidos: no muestra diagnósticos, informes ni el historial del paciente. Si necesitás una copia del historial, la podés pedir desde el portal y te la entregamos en mano en el centro.";
const REPORTS_A_CHOOSE = "El portal es solo para turnos, avisos y pedidos: no muestra diagnósticos, informes ni el historial del paciente. Si necesitás una copia del historial, la podés pedir desde el portal y elegir si la recibís ahí o en mano en el centro.";
const REPORTS_INFO: Faq = {
  q: "¿Por qué no veo todos los diagnósticos e informes?",
  a: "En «Mi información» ves solo lo que tu profesional revisa y publica para la familia, explicado de forma simple: si todavía no publicó nada, no aparece nada. El portal nunca muestra el historial completo del paciente. Si lo necesitás, pedí una copia (más abajo te contamos cómo).",
};

// Copia del historial: con la copia digital (etapas "hc_digital" y "consent")
// se elige cómo recibirla; si no, siempre en mano
const COPY_Q = "¿Puedo pedir una copia del historial del paciente?";
const COPY_HOW = "Sí: en el inicio, tocá «Información» en la tarjeta del paciente (o «Mi información», si es la tuya) y ahí tocá «Pedir una copia». La pueden pedir el propio paciente, si es mayor de edad, y la madre, el padre o el/la tutor/a; un adulto autorizado, no.";
const COPY_A_HAND = `${COPY_HOW} El equipo la prepara y la entrega en mano en el centro (${CENTER.address}), con DNI, a quien la pidió. Cómo va el pedido lo ves en esa misma pantalla, y cuando esté lista para retirar también te avisamos arriba de todo en el inicio.`;
const COPY_A_CHOOSE = `${COPY_HOW} El equipo la prepara y elegís cómo recibirla: en el portal, con la firma digital de la Dirección (la descargás desde esa pantalla con tu contraseña), o en mano en el centro (${CENTER.address}), con DNI, a quien la pidió. Para recibirla en el portal tenés que tener activada la información de salud (y la primera vez, pasar por el centro con tu DNI); si esa opción no aparece, pedila en mano. Cómo va el pedido lo ves en esa misma pantalla, y cuando esté lista para retirar o para descargar también te avisamos arriba de todo en el inicio.`;

const FAQ: Faq[] = [
  { q: APPT_Q, a: APPT_A_CALL },
  {
    q: "¿Avisar que no vamos cancela el turno?",
    a: "No automáticamente. El equipo revisa tu aviso y te contesta en el portal (por ejemplo, «Falta justificada»). Si podés, avisá con al menos un día de anticipación: así le damos el horario a otra familia.",
  },
  { q: REPORTS_Q, a: REPORTS_A_HAND },
  { q: COPY_Q, a: COPY_A_HAND },
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

// Información de salud: solo se explica si la etapa está prendida para esta
// cuenta (con sesión). Va después de la pregunta de diagnósticos e informes
const linkClass = "font-bold text-primary underline underline-offset-2";
const CLINICAL_FAQ: Faq[] = [
  {
    q: "¿Qué es la información de salud?",
    a: <>Es un espacio optativo donde tu profesional puede compartir lo que trabajan en el tratamiento, explicado de forma simple. Nada aparece hasta que tu profesional lo revisa y lo publica. Para verla, la tenés que activar en <Link to="/portal/informacion-salud" className={linkClass}>«Información de salud»</Link>. Un adulto autorizado sigue viendo solo los turnos.</>,
  },
  {
    q: "¿Cómo dejo de ver la información de salud?",
    a: <>En el inicio, tocá <Link to="/portal/informacion-salud" className={linkClass}>«Información de salud»</Link> y después «Dejar de ver la información de salud». Los turnos siguen funcionando igual.</>,
  },
];

// Medallas y ejercicios (etapa "practice"), después de la información de
// salud. La de las medallas, si alguna persona de esta cuenta tiene algo para
// ver (también sin plan, en "Mis logros"); las de los ejercicios, solo si
// alguna tiene un plan publicado
const MEDALS_FAQ: Faq[] = [
  {
    q: "¿Las medallas son por hablar sin trabarse?",
    a: "No. Son por practicar y por las metas que acordaron con tu profesional, que son de práctica y de animarse. Una medalla no se pierde nunca.",
  },
];
const EXERCISE_FAQ: Faq[] = [
  {
    q: "¿Qué pasa si un día no practicamos?",
    a: "No pasa nada. Las medallas no se pierden nunca y no hay rachas que se corten: se retoma cuando se pueda.",
  },
  {
    q: "¿Los ejercicios los hace una computadora?",
    a: "Los arma tu profesional, a partir de ejercicios que aprobó el centro. A veces usa una herramienta de inteligencia artificial para adaptarlos, pero siempre los revisa y los aprueba antes de publicarlos.",
  },
  {
    q: "¿Quién lee lo que contamos en «¿Cómo te fue?»?",
    a: `Lo lee el equipo profesional del CIMT antes del próximo turno. No es un chat ni se contesta al momento: si es urgente, llamanos al ${CENTER.phoneDisplay}. ${PRACTICE_TEXT.emergency_hint}`,
  },
];

function AyudaPage() {
  // Etapas prendidas para esta cuenta (null: sin sesión, sin la etapa
  // "consent" o sin conexión: los textos de siempre)
  const [features, setFeatures] = useState<ClinicalFeature[] | null>(null);
  const [canAskAppt, setCanAskAppt] = useState(false);
  const [hasPractice, setHasPractice] = useState(false);
  const [hasExercises, setHasExercises] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await portalApi.hasSession())) return;
        const r = await portalApi.me();
        if (cancelled || !r.ok) return;
        if (r.data.clinical) setFeatures(r.data.clinical.features);
        if (r.data.can_request_appts === true && r.data.children.length > 0) setCanAskAppt(true);
        // También sin plan: la pregunta de las medallas vale para "Mis logros"
        setHasPractice(practiceHomes(r.data).length > 0);
        setHasExercises(practicePeople(r.data).length > 0);
        announcePracticeNav(r.data);
      } catch { /* sin sesión o sin conexión: la ayuda se ve igual */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const infoOn = !!features?.includes("info");
  const digital = !!features?.includes("hc_digital") && !!features?.includes("consent");
  const faqs = FAQ.flatMap((f): Faq[] => {
    if (f.q === APPT_Q && canAskAppt) return [{ ...f, a: APPT_A_ASK }];
    if (f.q === REPORTS_Q) {
      const reports = infoOn ? REPORTS_INFO : digital ? { ...f, a: REPORTS_A_CHOOSE } : f;
      return features
        ? [reports, ...CLINICAL_FAQ, ...(hasPractice ? MEDALS_FAQ : []), ...(hasExercises ? EXERCISE_FAQ : [])]
        : [reports];
    }
    if (f.q === COPY_Q && digital) return [{ ...f, a: COPY_A_CHOOSE }];
    return [f];
  });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle sub="Preguntas frecuentes sobre el Portal de familias.">Ayuda</PageTitle>
      <div className="flex flex-col gap-2">
        {faqs.map((f) => (
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
