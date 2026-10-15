import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { type FeedbackDTO, portalApi } from "@/lib/portal";
import { feedbackHeader, feedbackNoReply } from "@/lib/practiceRules";
import { BackToMedals, FeedbackCard, PracticeGate } from "@/components/portal/PracticeParts";
import {
  type PracticeFailure, feedbackIsMessage, logrosFailure, useFeedbackSeen, whoOf,
} from "@/components/portal/practiceFormat";
import { PageTitle } from "@/components/portal/ui";
import { card } from "@/components/portal/styles";

// Todas las devoluciones del profesional (diseño §2.7), desde "Ver todas" en
// "Mis logros" (ahí se ven las 2 más nuevas). Le hablan al adulto dueño de la
// cuenta; hasta los 12 años se llaman "mensajes" y cada una se titula
// "Mensaje de … para Martín" (feedbackTitle). Pedirlas no marca nada:
// después de mostrarlas, la página marca las nuevas como vistas por esta
// cuenta ("feedback_seen", diseño §8.6), así "Nueva" se ve aunque la página
// se cargue dos veces (React en modo estricto, "Reintentar"). No piden la
// contraseña de nuevo. La familia no responde en la v1: lo que quiera contar,
// en el próximo turno o, con un plan publicado, al marcar un ejercicio. Se
// ven también sin plan: ningún texto da por hecho que hay ejercicios.

export const Route = createFileRoute("/portal/devoluciones/$patientId")({
  component: DevolucionesPage,
});

function DevolucionesPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<FeedbackDTO | null>(null);
  const [failure, setFailure] = useState<PracticeFailure | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setFailure(null);
    setData(null);
    const r = await portalApi.feedback(patientId);
    if (n !== seq.current) return;
    if (!r.ok) {
      if (r.status === 401) {
        navigate({ to: "/portal/ingresar", search: { volver: `/portal/devoluciones/${patientId}` }, replace: true });
        return;
      }
      setFailure(logrosFailure(r));
      return;
    }
    setData(r.data);
  }, [patientId, navigate]);

  useEffect(() => { void load(); }, [load]);

  // Ya se mostraron todas enteras: las nuevas quedan vistas para la próxima vez
  useFeedbackSeen(data ? data.items : null);

  // Mientras carga o si falla no se sabe a quién se le habla ("mensajes" o
  // "devoluciones"): sin título mientras carga y uno que vale para todos si falla
  if (failure || !data) {
    return (
      <div className="flex flex-col gap-4">
        <BackToMedals patientId={patientId} w={null} />
        {failure ? (
          <>
            <PageTitle>De tu profesional</PageTitle>
            <PracticeGate failure={failure} onRetry={() => void load()}
              errorText="No pudimos cargar esta página. Probá de nuevo en un rato." />
          </>
        ) : (
          <div role="status" className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
            Cargando…
          </div>
        )}
      </div>
    );
  }

  const w = whoOf(data.child);
  const message = feedbackIsMessage(w);
  return (
    <div className="flex flex-col gap-4">
      <BackToMedals patientId={patientId} w={w} />
      <PageTitle sub={feedbackHeader(message)}>
        {w.self ? "Devoluciones" : `${message ? "Mensajes" : "Devoluciones"} para ${w.first_name}`}
      </PageTitle>
      {data.items.length === 0 ? (
        <p className={`${card} text-base`}>
          {message
            ? "Todavía no hay mensajes. Cuando tu profesional escriba uno, lo vas a ver acá."
            : "Todavía no hay devoluciones. Cuando tu profesional escriba una, la vas a ver acá."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((f) => <FeedbackCard key={f.id} item={f} w={w} level={2} />)}
        </div>
      )}
      <p className="text-base text-muted-foreground">{feedbackNoReply(data.has_plan)}</p>
    </div>
  );
}
