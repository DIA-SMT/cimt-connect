import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, ArrowRight, CalendarCheck, CheckCircle2, Sparkles,
  User, Users, Heart, Repeat, Pause, Zap, HelpCircle, Clock3,
  CalendarDays, History, Smile, Frown, ShieldOff, RotateCcw,
} from "lucide-react";

export const Route = createFileRoute("/explora")({
  head: () => ({
    meta: [
      { title: "Explorá tu fluidez al hablar — CIMT" },
      { name: "description", content: "Mini guía interactiva de orientación sobre la fluidez del habla. 5 preguntas, 1 minuto, resultado orientativo gratuito." },
      { property: "og:title", content: "Explorá tu fluidez al hablar — CIMT" },
      { property: "og:description", content: "Recorrido guiado de 1 minuto para orientarte sobre la disfluencia. Gratuito." },
    ],
  }),
  component: ExploraPage,
});

type OptionId = string;
type Step = {
  id: string;
  title: string;
  subtitle?: string;
  options: { id: OptionId; label: string; icon: typeof User; score: number }[];
};

const STEPS: Step[] = [
  {
    id: "para_quien",
    title: "¿Para quién es esta consulta?",
    subtitle: "Contanos a quién querés orientar.",
    options: [
      { id: "mi", label: "Para mí", icon: User, score: 0 },
      { id: "hijo", label: "Para mi hijo/a", icon: Heart, score: 0 },
      { id: "familiar", label: "Para un familiar", icon: Users, score: 0 },
    ],
  },
  {
    id: "que_sucede",
    title: "¿Qué sucede al hablar?",
    subtitle: "Elegí la opción que más se parezca.",
    options: [
      { id: "repite", label: "Repite sonidos", icon: Repeat, score: 2 },
      { id: "traba", label: "Se traba al empezar", icon: Pause, score: 2 },
      { id: "rapido", label: "Habla rápido y se enreda", icon: Zap, score: 1 },
      { id: "no_seguro", label: "No estoy seguro", icon: HelpCircle, score: 1 },
    ],
  },
  {
    id: "desde_cuando",
    title: "¿Desde cuándo ocurre?",
    options: [
      { id: "poco", label: "Hace poco", icon: Clock3, score: 1 },
      { id: "meses", label: "Hace meses", icon: CalendarDays, score: 2 },
      { id: "anios", label: "Hace años", icon: History, score: 3 },
    ],
  },
  {
    id: "impacto",
    title: "¿Cómo impacta?",
    subtitle: "Pensá en lo emocional y social.",
    options: [
      { id: "poco", label: "Le molesta poco", icon: Smile, score: 1 },
      { id: "frustra", label: "Le genera frustración", icon: Frown, score: 2 },
      { id: "evita", label: "Evita hablar", icon: ShieldOff, score: 3 },
    ],
  },
];

type Tone = "green" | "yellow" | "blue";

function getResult(score: number): { tone: Tone; emoji: string; title: string; description: string; cta: string } {
  if (score <= 3) {
    return {
      tone: "green",
      emoji: "🟢",
      title: "Puede ser algo evolutivo",
      description: "Por lo que nos contás, podría tratarse de una disfluencia evolutiva propia del desarrollo del habla. Te recomendamos observar la evolución y, si persiste o aumenta, consultar con nuestro equipo.",
      cta: "Conocer más",
    };
  }
  if (score <= 6) {
    return {
      tone: "yellow",
      emoji: "🟡",
      title: "Sería recomendable consultar",
      description: "Las señales que describís ameritan una evaluación profesional. Una consulta temprana permite orientar mejor el abordaje y evitar que se consolide.",
      cta: "Solicitar turno",
    };
  }
  return {
    tone: "blue",
    emoji: "🔵",
    title: "Nuestro equipo puede ayudarte",
    description: "Lo que describís indica que un acompañamiento profesional puede mejorar significativamente la comunicación y la calidad de vida. Solicitá un turno gratuito con nuestro equipo interdisciplinario.",
    cta: "Solicitar turno",
  };
}

function ExploraPage() {
  const [started, setStarted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { id: OptionId; score: number }>>({});

  const totalSteps = STEPS.length;
  const isFinished = stepIndex >= totalSteps;
  const currentStep = STEPS[Math.min(stepIndex, totalSteps - 1)];
  const progressPct = isFinished ? 100 : Math.round((stepIndex / totalSteps) * 100);

  const score = useMemo(
    () => Object.values(answers).reduce((sum, a) => sum + a.score, 0),
    [answers],
  );

  const handleSelect = (optionId: OptionId, optionScore: number) => {
    setAnswers((prev) => ({ ...prev, [currentStep.id]: { id: optionId, score: optionScore } }));
    // Auto-advance after a short delay for nicer UX
    setTimeout(() => {
      setStepIndex((i) => i + 1);
    }, 220);
  };

  const handleBack = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  const handleRestart = () => {
    setStarted(false);
    setStepIndex(0);
    setAnswers({});
  };

  return (
    <Layout>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[var(--gradient-soft)]" />
        <div className="container mx-auto max-w-3xl px-4 py-14 md:px-6 md:py-20">
          {!started && (
            <Intro onStart={() => setStarted(true)} />
          )}

          {started && !isFinished && (
            <div className="rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-card)] sm:p-8 md:p-10">
              {/* Progress */}
              <div className="mb-8">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Paso {stepIndex + 1} de {totalSteps}</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--primary-soft)]">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <h2 className="font-display text-2xl font-bold text-[color:var(--primary-deep)] sm:text-3xl">
                {currentStep.title}
              </h2>
              {currentStep.subtitle && (
                <p className="mt-2 text-sm text-muted-foreground sm:text-base">{currentStep.subtitle}</p>
              )}

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {currentStep.options.map((opt) => {
                  const selected = answers[currentStep.id]?.id === opt.id;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelect(opt.id, opt.score)}
                      className={`group flex items-center gap-3 rounded-2xl border-2 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] ${
                        selected
                          ? "border-primary bg-primary/5 shadow-[var(--shadow-card)]"
                          : "border-border/60 bg-background hover:border-primary/40"
                      }`}
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)] group-hover:bg-primary/15"
                      }`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className="flex-1 text-sm font-semibold text-foreground sm:text-base">{opt.label}</span>
                      {selected && <CheckCircle2 className="h-5 w-5 text-primary" />}
                    </button>
                  );
                })}
              </div>

              <div className="mt-8 flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleBack}
                  disabled={stepIndex === 0}
                  className="rounded-full text-muted-foreground hover:text-[color:var(--primary-deep)] disabled:opacity-40"
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Atrás
                </Button>
                <span className="text-xs text-muted-foreground">Tocá una opción para avanzar</span>
              </div>
            </div>
          )}

          {started && isFinished && (
            <ResultCard
              result={getResult(score)}
              onRestart={handleRestart}
            />
          )}
        </div>
      </section>
    </Layout>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--primary-deep)]">
        <Sparkles className="h-3.5 w-3.5" />
        Mini guía interactiva
      </div>
      <h1 className="mt-5 font-display text-4xl font-extrabold leading-tight text-[color:var(--primary-deep)] sm:text-5xl">
        Explorá tu fluidez al hablar
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
        Un recorrido guiado de <strong className="text-foreground">1 minuto</strong> con 5 preguntas cortas para orientarte sobre la disfluencia. Es anónimo, gratuito y no reemplaza una consulta profesional.
      </p>

      <div className="mx-auto mt-8 grid max-w-md gap-3 text-left sm:grid-cols-3">
        <MiniBadge value="5" label="preguntas" />
        <MiniBadge value="~1 min" label="duración" />
        <MiniBadge value="100%" label="anónimo" />
      </div>

      <Button
        size="lg"
        onClick={onStart}
        className="mt-9 h-12 rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground shadow-[var(--shadow-elegant)] hover:bg-[color:var(--primary-deep)]"
      >
        Comenzar
        <ArrowRight className="ml-1 h-5 w-5" />
      </Button>
    </div>
  );
}

function MiniBadge({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3 text-center backdrop-blur">
      <div className="text-lg font-bold text-[color:var(--primary-deep)]">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ResultCard({
  result,
  onRestart,
}: {
  result: ReturnType<typeof getResult>;
  onRestart: () => void;
}) {
  const toneStyles: Record<Tone, { ring: string; bg: string; chip: string; text: string }> = {
    green: {
      ring: "ring-emerald-500/30",
      bg: "bg-emerald-50",
      chip: "bg-emerald-500 text-white",
      text: "text-emerald-900",
    },
    yellow: {
      ring: "ring-amber-500/30",
      bg: "bg-amber-50",
      chip: "bg-amber-500 text-white",
      text: "text-amber-900",
    },
    blue: {
      ring: "ring-primary/30",
      bg: "bg-[color:var(--primary-soft)]",
      chip: "bg-primary text-primary-foreground",
      text: "text-[color:var(--primary-deep)]",
    },
  };
  const t = toneStyles[result.tone];

  return (
    <div className={`rounded-3xl border border-border/60 bg-card p-6 shadow-[var(--shadow-elegant)] ring-2 sm:p-10 ${t.ring}`}>
      <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl ${t.chip}`}>
        <span aria-hidden>{result.emoji}</span>
      </div>
      <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Resultado orientativo
      </div>
      <h2 className="mt-3 font-display text-3xl font-bold text-[color:var(--primary-deep)] sm:text-4xl">
        {result.title}
      </h2>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
        {result.description}
      </p>

      <div className={`mt-6 rounded-2xl p-4 text-sm ${t.bg} ${t.text}`}>
        <strong>Importante:</strong> este resultado es solo orientativo y no constituye un diagnóstico. Para una evaluación profesional, solicitá un turno gratuito con nuestro equipo.
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg" className="h-12 rounded-full bg-primary px-7 font-semibold hover:bg-[color:var(--primary-deep)]">
          <Link to="/turnos">
            <CalendarCheck className="mr-1 h-5 w-5" />
            {result.cta}
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onRestart}
          className="h-12 rounded-full border-primary/30 px-7 font-semibold text-[color:var(--primary-deep)] hover:bg-primary/5"
        >
          <RotateCcw className="mr-1 h-4 w-4" />
          Volver a empezar
        </Button>
      </div>
    </div>
  );
}