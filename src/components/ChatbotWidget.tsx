import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Send, X, MessageCircle, CalendarCheck, ChevronDown } from "lucide-react";
import migueAvatar from "@/assets/migue-avatar.jpg";
import { MigueAvatar } from "./MigueAvatar";
import { ROLE_LABEL, type Staff } from "@/lib/staff";
import { StaffChatError, askStaffMigue } from "@/lib/staffAssistant";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = "user" | "assistant";
interface ChatMessage {
  id: string;
  role: Role;
  content: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QUICK_SUGGESTIONS = [
  { id: "turno", label: "¿Cómo saco un turno?" },
  { id: "gratuito", label: "¿Es gratuito?" },
  { id: "ubicacion", label: "¿Dónde están ubicados?" },
  { id: "especialistas", label: "¿Qué especialistas tienen?" },
  { id: "tartamudez", label: "¿Qué es la tartamudez?" },
];

// Modo equipo (dentro del panel, con sesión): consultas internas, sin datos clínicos
const STAFF_SUGGESTIONS = [
  { id: "hoy", label: "¿Qué turnos hay hoy?" },
  { id: "avisar", label: "¿Quién falta avisar para mañana?" },
  { id: "ingresos", label: "¿Cuántos ingresos hubo este mes?" },
  { id: "solicitudes", label: "¿Qué solicitudes están pendientes?" },
  { id: "taller", label: "¿Cuándo es el próximo taller?" },
];

const uid = () => Math.random().toString(36).slice(2, 9);

// ─── Sub-components ───────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-[color:var(--primary-deep)]/40"
          style={{ animation: `migue-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </div>
  );
}

// ─── Main widget ─────────────────────────────────────────────────────────────

/** Sin `staff`: el Migue informativo del sitio. Con `staff`: el modo equipo del panel. */
export function ChatbotWidget({ staff }: { staff?: Staff } = {}) {
  const staffMode = !!staff;
  const suggestions = staffMode
    ? [...(staff?.professional_id ? [{ id: "semana", label: "¿Qué turnos tengo esta semana?" }] : []), ...STAFF_SUGGESTIONS]
    : QUICK_SUGGESTIONS;
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showBadge, setShowBadge] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasOpenedRef = useRef(false);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, isTyping]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Greeting message on first open
  useEffect(() => {
    if (!isOpen || hasOpenedRef.current) return;
    hasOpenedRef.current = true;
    setShowBadge(false);
    setIsTyping(true);
    const t = setTimeout(() => {
      setIsTyping(false);
      setMessages([
        {
          id: uid(),
          role: "assistant",
          content: staffMode
            ? `¡Hola${staff?.full_name ? `, ${staff.full_name.split(" ")[0]}` : ""}! Soy **Migue**, en modo equipo. Puedo consultar turnos, métricas, solicitudes, pacientes y talleres del centro, y contarte dónde se hace cada cosa en el panel. No veo datos clínicos y no modifico nada. ¿Qué necesitás?`
            : "¡Hola! 👋 Soy **Migue**, el asistente virtual del CIMT. Estoy aquí para ayudarte con cualquier pregunta sobre tartamudez, nuestros servicios o cómo sacar un turno. ¿En qué te puedo ayudar?",
        },
      ]);
    }, 900);
    return () => clearTimeout(t);
    // El saludo se arma una sola vez; al cambiar de modo el widget se vuelve a montar (key en Layout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleOpen = () => {
    setIsOpen(true);
    setShowBadge(false);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;
    setApiError(null);

    const userMsg: ChatMessage = { id: uid(), role: "user", content: text.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setIsTyping(true);

    if (staff) {
      try {
        const reply = await askStaffMigue(updatedMessages.map((m) => ({ role: m.role, content: m.content })), staff);
        setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: reply }]);
      } catch (err: unknown) {
        console.error("[Migue equipo]", err);
        const timeout = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
        setApiError(timeout
          ? "La respuesta tardó demasiado. Probá de nuevo."
          : err instanceof StaffChatError ? err.message : "No se pudo conectar con el asistente.");
      } finally {
        setIsTyping(false);
      }
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      clearTimeout(timeoutId);

      const data = await response.json();

      // Límite de mensajes: se muestra el aviso tal cual, sin "Error al conectar"
      if (response.status === 429) {
        setIsTyping(false);
        setApiError(data?.error ?? "Llegaste al límite de mensajes por ahora. Probá de nuevo en unos minutos.");
        return;
      }

      if (!response.ok) {
        console.error("[Migue] API error:", data);
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }

      const reply = data.reply ?? "Lo siento, no pude procesar tu consulta. Intentá de nuevo.";

      setIsTyping(false);
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: reply }]);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      console.error("[Migue] fetch error:", err);
      setIsTyping(false);
      setApiError(
        isAbort
          ? "La respuesta tardó demasiado. Verificá tu conexión e intentá de nuevo."
          : `Error al conectar con el asistente. ${err instanceof Error ? err.message : ""}`
      );
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestion = (label: string) => {
    sendMessage(label);
  };

  const firstUserMessageSent = messages.some((m) => m.role === "user");

  // Render bold markdown in bot messages
  const renderContent = (text: string) => {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <strong key={i} className="font-semibold text-[color:var(--primary-deep)]">
          {part}
        </strong>
      ) : (
        part
      )
    );
  };

  return (
    <>
      {/* Keyframes injected once */}
      <style>{`
        @keyframes migue-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
        @keyframes migue-pulse-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes migue-slide-up {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* ── Floating button ──────────────────────────────────────────────── */}
      {!isOpen && (
        <button
          id="migue-chatbot-toggle"
          onClick={handleOpen}
          aria-label="Abrir chat con Migue"
          title="Chateá con Migue"
          className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-primary to-[color:var(--primary-deep)] p-[3px] shadow-[0_4px_24px_rgba(0,0,0,0.2)] transition-all hover:scale-105 hover:shadow-[0_6px_32px_rgba(0,0,0,0.28)] active:scale-95 sm:h-16 sm:w-16"
        >
          {/* Pulse ring (detrás de la foto) */}
          {showBadge && (
            <span
              className="absolute inset-0 rounded-full bg-primary"
              style={{ animation: "migue-pulse-ring 1.8s ease-out infinite" }}
            />
          )}
          <img
            src={migueAvatar}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="relative h-full w-full rounded-full border-2 border-white bg-[#fafafa] object-cover"
          />
          {/* Chat icon, para que se lea como botón de chat */}
          <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow ring-2 ring-background sm:h-6 sm:w-6">
            <MessageCircle className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </span>
          {/* Notification dot */}
          {showBadge && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white shadow">
              1
            </span>
          )}
        </button>
      )}

      {/* ── Chat panel ───────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          id="migue-chatbot-panel"
          className="fixed bottom-5 right-5 z-50 flex w-[360px] max-w-[calc(100vw-24px)] flex-col rounded-2xl border border-border/60 bg-background shadow-[0_8px_40px_rgba(0,0,0,0.18)]"
          style={{
            height: "min(560px, calc(100dvh - 100px))",
            animation: "migue-slide-up 0.22s ease-out",
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 rounded-t-2xl border-b border-border/60 bg-gradient-to-r from-[color:var(--primary-soft)] to-background px-4 py-3">
            <MigueAvatar size="md" />
            <div className="flex-1 min-w-0">
              <p className="font-display font-bold text-[color:var(--primary-deep)] leading-none text-sm">
                Migue
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {staffMode ? `Modo equipo · ${ROLE_LABEL[staff!.role]}` : "Asistente virtual · CIMT"}
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              En línea
            </div>
            <button
              id="migue-chatbot-close"
              onClick={() => setIsOpen(false)}
              aria-label="Cerrar chat"
              className="ml-1 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "items-end gap-2"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
              >
                {msg.role === "assistant" && <MigueAvatar size="sm" label="Migue:" />}
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${staffMode ? "whitespace-pre-line " : ""}${
                    msg.role === "user"
                      ? "rounded-br-none bg-primary text-primary-foreground font-medium shadow-sm"
                      : "rounded-bl-none bg-card border border-border/60 text-foreground shadow-[var(--shadow-card)]"
                  }`}
                >
                  {msg.role === "assistant" ? renderContent(msg.content) : msg.content}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex items-end gap-2 animate-in fade-in duration-200">
                <MigueAvatar size="sm" label="Migue está escribiendo" />
                <div className="rounded-2xl rounded-bl-none bg-card border border-border/60 px-3.5 py-2.5 shadow-sm">
                  <TypingDots />
                </div>
              </div>
            )}

            {/* API error */}
            {apiError && (
              <p className="text-center text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                {apiError}
              </p>
            )}

            {/* Quick suggestions — only before first user message */}
            {!firstUserMessageSent && !isTyping && messages.length > 0 && (
              <div className="pt-1">
                <p className="text-[10px] text-muted-foreground text-center mb-2 uppercase tracking-wider font-medium">
                  Sugerencias rápidas
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      id={`migue-suggestion-${s.id}`}
                      onClick={() => handleSuggestion(s.label)}
                      className="rounded-full border border-primary/25 bg-[color:var(--primary-soft)] px-3 py-1.5 text-xs font-semibold text-[color:var(--primary-deep)] transition-all hover:border-primary hover:bg-primary/10 hover:-translate-y-0.5 active:scale-95"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Turno shortcut — shown after some interaction */}
            {!staffMode && firstUserMessageSent && !isTyping && (
              <div className="flex justify-center pt-1">
                <Link
                  to="/turnos"
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-[color:var(--primary-soft)] px-3 py-1.5 text-xs font-semibold text-[color:var(--primary-deep)] hover:bg-primary/10 transition-colors"
                >
                  <CalendarCheck className="h-3 w-3" />
                  Sacar turno
                </Link>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Minimize hint */}
          <div className="flex justify-center pb-0 pt-0.5">
            <button
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors pb-1"
            >
              <ChevronDown className="h-3 w-3" />
              Minimizar
            </button>
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-border/60 px-3 py-3"
          >
            <input
              ref={inputRef}
              id="migue-chat-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={staffMode ? "Preguntá por turnos, métricas, solicitudes…" : "Escribí tu consulta..."}
              disabled={isTyping}
              className="flex-1 rounded-full border border-border/60 bg-muted/40 px-4 py-2 text-sm outline-none transition-all placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/15 disabled:opacity-50"
            />
            <button
              type="submit"
              id="migue-chat-send"
              disabled={!input.trim() || isTyping}
              aria-label="Enviar mensaje"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-all hover:bg-[color:var(--primary-deep)] disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
