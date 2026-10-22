import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ChevronLeft, Mail, MapPin, Phone } from "lucide-react";
import { CENTER } from "@/lib/center";
import { CLINICAL_LEGAL_BASIS, RECORDING_LEGAL_BASIS } from "@/lib/legalBasis";
import { RECORDING_NOTICE_POINTS, RECORDING_NOTICE_VERSION } from "@/lib/recordingRules";
import { clinicalFlags } from "@/lib/portalHelp";
import { CLINICAL_NOTICE_POINTS, CLINICAL_NOTICE_VERSION, PRIVACY_POINTS, PRIVACY_VERSION, portalApi } from "@/lib/portal";
import { LegalBasisNote, NoticeList, PageTitle } from "@/components/portal/ui";
import { card, sectionTitle } from "@/components/portal/styles";

// Aviso de privacidad completo del portal. Se ve sin sesión: se enlaza desde
// la activación de la información de salud y se puede abrir antes de ingresar.
// La parte de información de salud es un borrador que todavía no aprobó el
// área legal: solo se muestra cuando la etapa está prendida (con sesión).

export const Route = createFileRoute("/portal/privacidad")({
  component: PrivacidadPage,
});

function PrivacidadPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [clinicalOn, setClinicalOn] = useState(false);
  // «Me grabo» prendido: su aviso también va acá
  const [recordingsOn, setRecordingsOn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await portalApi.hasSession())) return;
      const r = await portalApi.me();
      if (cancelled || !r.ok || !r.data.clinical) return;
      setClinicalOn(true);
      setRecordingsOn(clinicalFlags(r.data.clinical.features).recordings);
    })();
    return () => { cancelled = true; };
  }, []);

  function goBack() {
    if (window.history.length > 1) router.history.back();
    else navigate({ to: "/portal" });
  }

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={goBack} className="flex min-h-11 items-center gap-1 self-start text-base font-bold text-primary">
        <ChevronLeft className="h-5 w-5" aria-hidden="true" /> Volver
      </button>

      <PageTitle sub={`Versión ${PRIVACY_VERSION}`}>Aviso de privacidad del portal</PageTitle>

      <section aria-label="Aviso de privacidad del portal" className={card}>
        <NoticeList points={PRIVACY_POINTS} />
      </section>

      {clinicalOn && <section aria-labelledby="portal-privacidad-salud" className="mt-2 flex flex-col gap-3">
        <div>
          <h2 id="portal-privacidad-salud" className="font-display text-xl font-bold text-[color:var(--primary-deep)]">Información de salud</h2>
          <p className="text-sm text-muted-foreground">Borrador para revisión del área legal · versión {CLINICAL_NOTICE_VERSION}</p>
        </div>
        <div className={`${card} flex flex-col gap-4`}>
          <p className="text-base">
            Esto vale solo si activás la información de salud en el portal. Es optativo: si no la activás, ves los turnos igual que siempre.
          </p>
          <NoticeList points={CLINICAL_NOTICE_POINTS} />
          <LegalBasisNote basis={CLINICAL_LEGAL_BASIS} title="Por qué se pide un permiso aparte" />
        </div>
      </section>}

      {recordingsOn && <section aria-labelledby="portal-privacidad-grabaciones" className="mt-2 flex flex-col gap-3">
        <div>
          <h2 id="portal-privacidad-grabaciones" className="font-display text-xl font-bold text-[color:var(--primary-deep)]">Grabaciones de «Me grabo»</h2>
          <p className="text-sm text-muted-foreground">Borrador para revisión del área legal · versión {RECORDING_NOTICE_VERSION}</p>
        </div>
        <div className={`${card} flex flex-col gap-4`}>
          <p className="text-base">
            Esto vale solo si mandás grabaciones desde un ejercicio con «Me grabo». El permiso se pide la primera vez y se retira en «Información de salud».
          </p>
          <NoticeList points={RECORDING_NOTICE_POINTS} />
          <LegalBasisNote basis={RECORDING_LEGAL_BASIS} />
        </div>
      </section>}

      <section aria-labelledby="portal-privacidad-contacto" className="mt-2 flex flex-col gap-3">
        <h2 id="portal-privacidad-contacto" className={sectionTitle}>Tus derechos y cómo contactarnos</h2>
        <div className={`${card} flex flex-col gap-3`}>
          <p className="text-base">
            Podés pedir acceso a tus datos, corregirlos o dejar de usar el portal cuando quieras. Para hacerlo, o si tenés dudas sobre este aviso:
          </p>
          <ul className="flex flex-col gap-1">
            <li>
              <a href={CENTER.phoneHref} className="flex min-h-11 items-center gap-2 text-base font-bold text-primary">
                <Phone className="h-5 w-5 shrink-0" aria-hidden="true" /> {CENTER.phoneDisplay}
                <span className="font-normal text-muted-foreground">({CENTER.phoneNote.toLowerCase()})</span>
              </a>
            </li>
            <li>
              <a href={`mailto:${CENTER.email}`} className="flex min-h-11 items-center gap-2 text-base font-bold text-primary">
                <Mail className="h-5 w-5 shrink-0" aria-hidden="true" /> {CENTER.email}
              </a>
            </li>
            <li className="flex min-h-11 items-start gap-2 pt-2 text-base">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span>{CENTER.address}, {CENTER.city} · {CENTER.hoursLong}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
