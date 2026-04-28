import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, CalendarCheck, RotateCcw, Sparkles,
  User, Users, Heart, Repeat, Pause, Zap, HelpCircle, Clock3,
  CalendarDays, History, Smile, Frown, ShieldOff,
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

// ─── Types ────────────────────────────────────────────────────────────────────

type OptionId = string;
type StepOption = { id: OptionId; label: string; icon: typeof User; score: number };
type Step = { id: string; title: string; options: StepOption[] };
type Tone = "green" | "yellow" | "blue";
type ChatMsg =
  | { id: string; from: "bot"; text: string }
  | { id: string; from: "user"; text: string }
  | { id: string; from: "result"; score: number };

// ─── Data ─────────────────────────────────────────────────────────────────────

const STEPS: Step[] = [
  {
    id: "para_quien",
    title: "¿Para quién es esta consulta?",
    options: [
      { id: "mi", label: "Para mí", icon: User, score: 0 },
      { id: "hijo", label: "Para mi hijo/a", icon: Heart, score: 0 },
      { id: "familiar", label: "Para un familiar", icon: Users, score: 0 },
    ],
  },
  {
    id: "que_sucede",
    title: "¿Qué sucede al hablar?",
    options: [
      { id: "repite", label: "Repite sonidos", icon: Repeat, score: 2 },
      { id: "traba", label: "Se traba al empezar", icon: Pause, score: 2 },
      { id: "rapido", label: "Habla rápido y se enreda", icon: Zap, score: 1 },
      { id: "no_seguro", label: "No estoy seguro/a", icon: HelpCircle, score: 1 },
    ],
  },
  {
    id: "desde_cuando",
    title: "¿Desde cuándo ocurre esto?",
    options: [
      { id: "poco", label: "Hace poco", icon: Clock3, score: 1 },
      { id: "meses", label: "Hace meses", icon: CalendarDays, score: 2 },
      { id: "anios", label: "Hace años", icon: History, score: 3 },
    ],
  },
  {
    id: "impacto",
    title: "¿Cómo impacta en lo emocional y social?",
    options: [
      { id: "poco", label: "Le molesta poco", icon: Smile, score: 1 },
      { id: "frustra", label: "Le genera frustración", icon: Frown, score: 2 },
      { id: "evita", label: "Evita hablar", icon: ShieldOff, score: 3 },
    ],
  },
];

const INTRO_MESSAGES = [
  "¡Hola! 👋 Soy **LIA**, la asistente virtual del **Centro Integral de Motricidad del Habla**.",
  "Estoy aquí para ayudarte a entender mejor la fluidez del habla con unas preguntas simples.",
  "Es anónimo, gratuito y lleva solo **~1 minuto** ⏱️ ¿Empezamos?",
];

const BRIDGE = ["Entendido ✅", "Perfecto, gracias 😊", "Anotado 📝", "Claro ✅"];

function getResult(score: number): { tone: Tone; emoji: string; title: string; description: string; cta: string } {
  if (score <= 3) {
    return {
      tone: "green", emoji: "🟢",
      title: "Puede ser algo evolutivo",
      description: "Por lo que me contás, podría tratarse de una disfluencia evolutiva propia del desarrollo del habla. Te recomiendo observar la evolución y, si persiste o aumenta, consultar con nuestro equipo.",
      cta: "Conocer más",
    };
  }
  if (score <= 6) {
    return {
      tone: "yellow", emoji: "🟡",
      title: "Sería recomendable consultar",
      description: "Las señales que describís ameritan una evaluación profesional. Una consulta temprana permite orientar mejor el abordaje y evitar que se consolide.",
      cta: "Solicitar turno",
    };
  }
  return {
    tone: "blue", emoji: "🔵",
    title: "Nuestro equipo puede ayudarte",
    description: "Lo que describís indica que un acompañamiento profesional puede mejorar significativamente la comunicación y la calidad de vida. Solicitá un turno gratuito con nuestro equipo interdisciplinario.",
    cta: "Solicitar turno",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);
const wait = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

function renderBotText(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-bold text-[color:var(--primary-deep)]">{part}</strong> : part
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LiaAvatar({ size = "md" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  return (
    <div className={`${dim} shrink-0 rounded-full bg-gradient-to-br from-primary to-[color:var(--primary-deep)] flex items-center justify-center font-display font-bold text-primary-foreground shadow-sm`}>
      LIA
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-[color:var(--primary-deep)]/40"
          style={{ animation: `lia-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </div>
  );
}

function ChatBubble({ msg, onRestart }: { msg: ChatMsg; onRestart: () => void }) {
  if (msg.from === "bot") {
    return (
      <div className="flex items-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <LiaAvatar size="sm" />
        <div className="max-w-[80%] rounded-2xl rounded-bl-none bg-card border border-border/60 px-4 py-3 text-sm leading-relaxed text-foreground shadow-[var(--shadow-card)]">
          {renderBotText(msg.text)}
        </div>
      </div>
    );
  }

  if (msg.from === "user") {
    return (
      <div className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="max-w-[75%] rounded-2xl rounded-br-none bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm">
          {msg.text}
        </div>
      </div>
    );
  }

  // Result card
  const result = getResult(msg.score);
  const toneStyles: Record<Tone, { ring: string; bg: string; badge: string; text: string }> = {
    green: { ring: "border-emerald-200", bg: "bg-emerald-50", badge: "bg-emerald-500 text-white", text: "text-emerald-900" },
    yellow: { ring: "border-amber-200", bg: "bg-amber-50", badge: "bg-amber-500 text-white", text: "text-amber-900" },
    blue: { ring: "border-primary/30", bg: "bg-[color:var(--primary-soft)]", badge: "bg-primary text-primary-foreground", text: "text-[color:var(--primary-deep)]" },
  };
  const t = toneStyles[result.tone];

  return (
    <div className="flex items-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <LiaAvatar size="sm" />
      <div className={`max-w-[85%] rounded-2xl rounded-bl-none border bg-card p-5 shadow-[var(--shadow-elegant)] ${t.ring}`}>
        <div className="flex items-center gap-2 mb-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${t.badge}`}>
            <span>{result.emoji}</span> Resultado orientativo
          </span>
        </div>
        <p className={`font-display text-lg font-bold leading-snug mb-2 ${t.text}`}>{result.title}</p>
        <p className="text-sm leading-relaxed text-muted-foreground mb-4">{result.description}</p>
        <div className={`rounded-xl p-3 text-xs ${t.bg} ${t.text} mb-4`}>
          <strong>Importante:</strong> este resultado es solo orientativo y no constituye un diagnóstico. Para una evaluación profesional, solicitá un turno gratuito.
        </div>
        <Button asChild size="sm" className="w-full rounded-full bg-primary font-semibold hover:bg-[color:var(--primary-deep)]">
          <Link to="/turnos">
            <CalendarCheck className="mr-1.5 h-4 w-4" />
            {result.cta}
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ExploraPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [started, setStarted] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [answers, setAnswers] = useState<Record<string, { id: string; score: number }>>({});
  const [finished, setFinished] = useState(false);
  const [restartKey, setRestartKey] = useState(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  // sessionRef is incremented on every restart so in-flight handlers abort
  const sessionRef = useRef(0);

  // Auto-scroll — only when messages are actually present
  useEffect(() => {
    if (messages.length > 0 || isTyping) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, isTyping]);

  // Intro sequence (re-runs on restart).
  // Uses a LOCAL `cancelled` boolean so StrictMode's double-invoke doesn't
  // let the first async continue after cleanup runs.
  useEffect(() => {
    let cancelled = false;
    // Bump session so any in-flight handlers from a previous run abort.
    const mySession = ++sessionRef.current;

    setMessages([]);
    setStarted(false);
    setStepIndex(-1);
    setAnswers({});
    setFinished(false);
    setIsTyping(false);

    const run = async () => {
      for (let i = 0; i < INTRO_MESSAGES.length; i++) {
        if (cancelled) return;
        setIsTyping(true);
        await wait(750 + i * 100);
        if (cancelled) return;
        setIsTyping(false);
        setMessages((prev) => [...prev, { id: uid(), from: "bot", text: INTRO_MESSAGES[i] }]);
        if (i < INTRO_MESSAGES.length - 1) await wait(280);
      }
    };

    run();
    // Cleanup: mark this specific invocation as cancelled
    return () => {
      cancelled = true;
      void mySession; // suppress unused-var lint
    };
  }, [restartKey]);

  const handleStart = async () => {
    if (isTyping) return;
    const mySession = sessionRef.current;
    setStarted(true);
    setIsTyping(true);
    await wait(750);
    if (sessionRef.current !== mySession) return;
    setIsTyping(false);
    setMessages((prev) => [...prev, { id: uid(), from: "bot", text: STEPS[0].title }]);
    setStepIndex(0);
  };

  const handleSelect = async (option: StepOption) => {
    if (isTyping || finished) return;
    const mySession = sessionRef.current;

    setMessages((prev) => [...prev, { id: uid(), from: "user", text: option.label }]);

    const newAnswers = { ...answers, [STEPS[stepIndex].id]: { id: option.id, score: option.score } };
    setAnswers(newAnswers);

    const nextIndex = stepIndex + 1;

    if (nextIndex >= STEPS.length) {
      // Done
      setIsTyping(true);
      await wait(900);
      if (sessionRef.current !== mySession) return;
      setIsTyping(false);
      setMessages((prev) => [...prev, { id: uid(), from: "bot", text: "¡Gracias por contarme! 🙏 Ya analicé tus respuestas..." }]);
      await wait(350);
      setIsTyping(true);
      await wait(1100);
      if (sessionRef.current !== mySession) return;
      setIsTyping(false);
      const finalScore = Object.values(newAnswers).reduce((sum, a) => sum + a.score, 0);
      setMessages((prev) => [...prev, { id: uid(), from: "result", score: finalScore }]);
      setFinished(true);
      setStepIndex(nextIndex);
    } else {
      // Next question
      setIsTyping(true);
      await wait(800);
      if (sessionRef.current !== mySession) return;
      setIsTyping(false);
      setMessages((prev) => [...prev, { id: uid(), from: "bot", text: BRIDGE[stepIndex % BRIDGE.length] }]);
      await wait(300);
      setIsTyping(true);
      await wait(650);
      if (sessionRef.current !== mySession) return;
      setIsTyping(false);
      setMessages((prev) => [...prev, { id: uid(), from: "bot", text: STEPS[nextIndex].title }]);
      setStepIndex(nextIndex);
    }
  };

  const handleRestart = () => {
    // Bumping sessionRef here aborts any in-flight handleSelect/handleStart
    sessionRef.current++;
    setRestartKey((k) => k + 1);
  };

  const currentStep = stepIndex >= 0 && stepIndex < STEPS.length ? STEPS[stepIndex] : null;
  const showStart = !started && messages.length >= INTRO_MESSAGES.length && !isTyping;
  const canAnswer = !!currentStep && !isTyping && !finished;

  return (
    <Layout>
      <style>{`
        @keyframes lia-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>

      <section className="relative flex flex-col" style={{ minHeight: "calc(100vh - 68px)" }}>
        <div className="absolute inset-0 -z-10 bg-[var(--gradient-soft)]" />

        {/* ── Header ── */}
        <div className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
          <div className="container mx-auto max-w-2xl px-4 py-3 flex items-center gap-3">
            <LiaAvatar />
            <div>
              <p className="font-display font-bold text-[color:var(--primary-deep)] leading-none">LIA</p>
              <p className="text-xs text-muted-foreground mt-0.5">Asistente virtual · CIMT</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              En línea
            </div>
          </div>
        </div>

        {/* ── Chat messages ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="container mx-auto max-w-2xl px-4 py-6 flex flex-col gap-4">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} onRestart={handleRestart} />
            ))}

            {isTyping && (
              <div className="flex items-end gap-2 animate-in fade-in duration-200">
                <LiaAvatar size="sm" />
                <div className="rounded-2xl rounded-bl-none bg-card border border-border/60 px-4 py-3 shadow-sm">
                  <TypingDots />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Bottom controls ── */}
        <div className="sticky bottom-0 z-20 border-t border-border/60 bg-background/90 backdrop-blur-md">
          <div className="container mx-auto max-w-2xl px-4 py-4">

            {/* Start button */}
            {showStart && (
              <Button
                onClick={handleStart}
                size="lg"
                className="w-full h-12 rounded-full bg-primary font-semibold text-primary-foreground shadow-[var(--shadow-elegant)] hover:bg-[color:var(--primary-deep)] transition-all hover:-translate-y-0.5"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                ¡Vamos!
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            )}

            {/* Option chips */}
            {canAnswer && (
              <div className="flex flex-wrap gap-2 justify-center">
                {currentStep.options.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSelect(opt)}
                      className="flex items-center gap-2 rounded-full border-2 border-primary/25 bg-background px-4 py-2.5 text-sm font-semibold text-[color:var(--primary-deep)] transition-all hover:border-primary hover:bg-[color:var(--primary-soft)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] active:scale-95"
                    >
                      <Icon className="h-4 w-4 text-primary shrink-0" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Restart */}
            {finished && (
              <Button
                type="button"
                variant="outline"
                onClick={handleRestart}
                className="w-full h-11 rounded-full border-primary/30 font-semibold text-[color:var(--primary-deep)] hover:bg-primary/5"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Volver a empezar
              </Button>
            )}

            {/* Hint */}
            {canAnswer && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Tocá una opción para responderle a LIA
              </p>
            )}
          </div>
        </div>
      </section>
    </Layout>
  );
}