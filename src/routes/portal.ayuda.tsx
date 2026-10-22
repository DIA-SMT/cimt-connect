import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { CENTER } from "@/lib/center";
import { type ClinicalFeature, portalApi } from "@/lib/portal";
import {
  APPT_A_ASK, APPT_A_CALL, APPT_Q, CODE_FAQ, COPY_A_CHOOSE, COPY_A_HAND, COPY_Q, EXERCISE_FAQ, FAMILY_FAQ, LEAVE_FAQ,
  LINKED_FAQ, MEDALS_FAQ, NOTICE_FAQ, PASSWORD_FAQ, REPORTS_A_CHOOSE, REPORTS_A_HAND, REPORTS_INFO, REPORTS_Q,
} from "@/lib/portalHelp";
import { PageTitle } from "@/components/portal/ui";
import { card } from "@/components/portal/styles";
import { announcePracticeNav, practiceHomes, practicePeople } from "@/components/portal/practiceFormat";

export const Route = createFileRoute("/portal/ayuda")({
  component: AyudaPage,
});

type Faq = { q: string; a: React.ReactNode };

// Los textos los comparte Migue en el portal (src/lib/portalHelp.ts)
const FAQ: Faq[] = [
  { q: APPT_Q, a: APPT_A_CALL },
  NOTICE_FAQ,
  { q: REPORTS_Q, a: REPORTS_A_HAND },
  { q: COPY_Q, a: COPY_A_HAND },
  PASSWORD_FAQ,
  CODE_FAQ,
  FAMILY_FAQ,
  LINKED_FAQ,
  LEAVE_FAQ,
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
