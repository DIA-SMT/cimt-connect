import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2 } from "lucide-react";

// Encuesta de satisfacción anónima (relevamiento, respuesta 39: satisfacción del
// paciente y calidad de atención). El centro comparte el link o lo imprime.
// No pide nombre ni DNI.

export const Route = createFileRoute("/encuesta")({
  head: () => ({
    meta: [
      { title: "Encuesta de satisfacción — CIMT" },
      { name: "description", content: "Contanos cómo fue tu experiencia en el Centro Integral Municipal de Tartamudez. Es anónima." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EncuestaPage,
});

const QUESTIONS = [
  { key: "rating_attention", label: "¿Cómo calificarías la atención recibida?" },
  { key: "rating_communication", label: "¿Te explicaron con claridad el tratamiento y los pasos a seguir?" },
  { key: "rating_treatment", label: "¿Cómo fue el trato del equipo?" },
  { key: "rating_overall", label: "En general, ¿qué tan conforme estás con el CIMT?" },
] as const;

type RatingKey = (typeof QUESTIONS)[number]["key"];
const SCALE = ["Muy mal", "Mal", "Regular", "Bien", "Muy bien"];

function EncuestaPage() {
  const [respondent, setRespondent] = useState<"paciente" | "familiar" | null>(null);
  const [ratings, setRatings] = useState<Partial<Record<RatingKey, number>>>({});
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const complete = respondent && QUESTIONS.every((q) => ratings[q.key]) && recommend !== null;

  async function submit() {
    if (!complete) { toast.error("Respondé todas las preguntas"); return; }
    setSending(true);
    const { error } = await supabase.rpc("submit_satisfaction_survey", {
      p_respondent: respondent,
      p_rating_attention: ratings.rating_attention,
      p_rating_communication: ratings.rating_communication,
      p_rating_treatment: ratings.rating_treatment,
      p_rating_overall: ratings.rating_overall,
      p_would_recommend: recommend,
      p_comment: comment.trim() || null,
    });
    setSending(false);
    if (error) { toast.error("No se pudo enviar. Probá de nuevo en un rato."); return; }
    setDone(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <Layout>
      <section className="container mx-auto max-w-2xl px-4 py-12 md:py-16">
        <div className="text-center">
          <h1 className="font-display text-4xl font-extrabold text-[color:var(--primary-deep)]">Encuesta de satisfacción</h1>
          <p className="mt-3 text-muted-foreground">
            Nos ayuda a mejorar. Es <strong>anónima</strong>: no te pedimos nombre ni DNI. Te lleva un minuto.
          </p>
        </div>

        <div className="mt-8 rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8">
          {done ? (
            <div className="flex flex-col items-center py-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--status-available-bg)] text-[color:var(--status-available)]">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="mt-4 text-2xl font-bold text-[color:var(--primary-deep)]">¡Gracias por responder!</h2>
              <p className="mt-2 text-muted-foreground">Tu opinión nos sirve para mejorar la atención.</p>
            </div>
          ) : (
            <div className="space-y-7">
              <fieldset className="space-y-2">
                <legend className="font-semibold">¿Quién responde?</legend>
                <div className="flex flex-wrap gap-2">
                  {(["paciente", "familiar"] as const).map((r) => (
                    <Choice key={r} active={respondent === r} onClick={() => setRespondent(r)}>
                      {r === "paciente" ? "Soy paciente" : "Soy familiar / acompañante"}
                    </Choice>
                  ))}
                </div>
              </fieldset>

              {QUESTIONS.map((q) => (
                <fieldset key={q.key} className="space-y-2">
                  <legend className="font-semibold">{q.label}</legend>
                  <div className="grid grid-cols-5 gap-1.5">
                    {SCALE.map((label, i) => (
                      <button key={label} type="button" aria-pressed={ratings[q.key] === i + 1}
                        onClick={() => setRatings((r) => ({ ...r, [q.key]: i + 1 }))}
                        className={[
                          "flex flex-col items-center rounded-xl border px-1 py-2 text-xs font-semibold transition-colors",
                          ratings[q.key] === i + 1
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background text-muted-foreground hover:bg-[color:var(--primary-soft)]",
                        ].join(" ")}>
                        <span className="text-lg">{i + 1}</span>
                        <span className="leading-tight">{label}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}

              <fieldset className="space-y-2">
                <legend className="font-semibold">¿Recomendarías el CIMT a otras personas?</legend>
                <div className="flex gap-2">
                  <Choice active={recommend === true} onClick={() => setRecommend(true)}>Sí</Choice>
                  <Choice active={recommend === false} onClick={() => setRecommend(false)}>No</Choice>
                </div>
              </fieldset>

              <div className="space-y-2">
                <label htmlFor="comment" className="font-semibold">¿Querés contarnos algo más? (opcional)</label>
                <Textarea id="comment" rows={3} maxLength={600} value={comment} onChange={(e) => setComment(e.target.value)}
                  placeholder="Sugerencias, lo que te gustó o lo que podemos mejorar. No incluyas datos personales." />
              </div>

              <Button onClick={submit} disabled={sending || !complete}
                className="w-full bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
                {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar respuestas
              </Button>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={[
        "rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-[color:var(--primary-soft)]",
      ].join(" ")}>
      {children}
    </button>
  );
}
