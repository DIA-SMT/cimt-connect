// Historia clínica por área (fase 3). Cada área del CIMT tiene su formulario:
// acá se definen las preguntas; las respuestas se guardan en clinical_forms.
//
// Los datos comunes a todas las áreas (filiación, contexto familiar, motivo de
// ingreso y antecedentes de tartamudez) están en la ficha del paciente y se
// imprimen como encabezado de cada historia, igual que en el formulario en papel.
//
// Para sumar el formulario de otra área: agregar un FormTemplate a TEMPLATES.
// Si se cambian las preguntas de uno existente, crear una versión nueva (_v2)
// para no mezclar respuestas viejas.

export type Answer = string | string[] | null;
export type Answers = Record<string, Answer>;

type BaseQuestion = { id: string; label: string };
export type Question =
  | (BaseQuestion & { type: "text" | "textarea"; placeholder?: string })
  | (BaseQuestion & { type: "single"; options: string[]; detail?: { when: string; label: string } })
  | (BaseQuestion & { type: "multi"; options: string[] });

export type FormSection = { id: string; title: string; questions: Question[] };
export type FormTemplate = { id: string; area: string; title: string; sections: FormSection[] };

const YES_NO = ["Sí", "No"];

// Formulario "Historia Clínica CIM de Tartamudez — Área: Terapia Ocupacional"
// (secciones 5 a 9 y observaciones; las 1 a 4 están en la ficha).
const TERAPIA_OCUPACIONAL_V1: FormTemplate = {
  id: "terapia_ocupacional_v1",
  area: "Terapia ocupacional",
  title: "Evaluación — Terapia ocupacional",
  sections: [
    {
      id: "avd",
      title: "AVD básicas: rutinas",
      questions: [
        { id: "avd_alimentacion", label: "Alimentación", type: "multi", options: ["Pincha y corta solo", "Usa cubiertos", "Toma del vaso solo"] },
        { id: "avd_vestido", label: "Vestido", type: "multi", options: ["Se viste solo", "Elige la ropa"] },
        { id: "avd_cordones", label: "Atado de cordones", type: "single", options: YES_NO },
        { id: "avd_higiene", label: "Higiene: lavado de manos y rostro", type: "single", options: ["Sí", "No", "Semiindependiente"] },
        { id: "avd_dientes", label: "Cepillado de dientes", type: "single", options: ["Sí", "No", "En proceso"] },
        { id: "avd_dinero", label: "Autonomía avanzada: manejo del dinero", type: "single", options: YES_NO },
        { id: "avd_hogar", label: "Ayuda en tareas del hogar", type: "single", options: YES_NO, detail: { when: "Sí", label: "¿Cuáles?" } },
      ],
    },
    {
      id: "ocio",
      title: "Ocio, juego y tiempo libre",
      questions: [
        { id: "ocio_despues_escuela", label: "¿Qué hace al volver de la escuela o el jardín?", type: "textarea" },
        { id: "ocio_juego_pares", label: "Tipo de juego: juego con pares", type: "single", options: YES_NO, detail: { when: "Sí", label: "¿Cuáles?" } },
        { id: "ocio_pantallas", label: "Tiempo de uso de pantallas", type: "single", options: ["Poco", "Moderado", "Excesivo"] },
        { id: "ocio_actividad_fisica", label: "Actividad física", type: "text" },
        { id: "ocio_sostener_juego", label: "Dificultad para sostener el juego", type: "single", options: YES_NO },
        { id: "ocio_frustracion", label: "Frustración al perder o no lograr objetivos", type: "single", options: YES_NO },
      ],
    },
    {
      id: "regulacion",
      title: "Regulación emocional y conductual",
      questions: [
        { id: "reg_frustracion", label: "Manejo de la frustración", type: "textarea" },
        { id: "reg_berrinches", label: "Berrinches acordes a la edad", type: "single", options: YES_NO, detail: { when: "Sí", label: "¿Cuándo ocurren?" } },
        { id: "reg_esperar_turnos", label: "Dificultad para esperar turnos", type: "single", options: YES_NO },
        { id: "reg_ansiedad", label: "Ansiedad ante situaciones nuevas", type: "single", options: YES_NO },
      ],
    },
    {
      id: "atencion",
      title: "Atención y organización",
      questions: [
        { id: "at_sostiene", label: "Sostiene actividades", type: "single", options: YES_NO },
        { id: "at_llamado", label: "Necesita constante llamado de atención", type: "single", options: YES_NO },
        { id: "at_consignas", label: "Dificultad para seguir consignas simples", type: "single", options: YES_NO, detail: { when: "Sí", label: "¿Cuáles?" } },
      ],
    },
    {
      id: "sensorial",
      title: "Procesamiento sensorial",
      questions: [
        { id: "sens_ruidos", label: "Molestia ante los ruidos", type: "single", options: YES_NO },
        { id: "sens_texturas", label: "Rechazo de texturas", type: "single", options: YES_NO },
        { id: "sens_movimiento", label: "Búsqueda constante del movimiento", type: "single", options: YES_NO },
        { id: "sens_quieto", label: "Dificultad para permanecer quieto", type: "single", options: YES_NO },
      ],
    },
    {
      id: "observaciones",
      title: "Observaciones generales",
      questions: [{ id: "observaciones", label: "Observaciones", type: "textarea" }],
    },
  ],
};

export const TEMPLATES: FormTemplate[] = [TERAPIA_OCUPACIONAL_V1];

export function getTemplate(id: string): FormTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

// Clave donde se guarda el detalle ("¿Cuáles?") de una pregunta
export const detailKey = (questionId: string) => `${questionId}__detalle`;

export function countAnswered(t: FormTemplate, answers: Answers): { answered: number; total: number } {
  const qs = t.sections.flatMap((s) => s.questions);
  const answered = qs.filter((q) => {
    const a = answers[q.id];
    return Array.isArray(a) ? a.length > 0 : a !== null && a !== undefined && String(a).trim() !== "";
  }).length;
  return { answered, total: qs.length };
}

export function formatAnswer(q: Question, answers: Answers): string {
  const a = answers[q.id];
  let text = Array.isArray(a) ? a.join(", ") : (a ?? "");
  if (q.type === "single" && q.detail && a === q.detail.when) {
    const d = answers[detailKey(q.id)];
    if (typeof d === "string" && d.trim()) text += ` — ${q.detail.label} ${d.trim()}`;
  }
  return text;
}
