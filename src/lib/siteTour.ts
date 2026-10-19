// Recorrido guiado del sitio público, pensado para personas con discapacidad
// (baja visión, lectura, motricidad, cognitivas). Textos en lectura fácil:
// frases cortas, una idea por frase, palabras simples. Cada paso se puede
// escuchar (voz del navegador: no se graba nada).
//
// Cada paso resalta un lugar real de la página («targets»: el primero que se
// vea, así sirve en la compu y en el celular). Sin target: tarjeta sola.

export type TourStep = {
  id: string;
  title: string;
  text: string;
  /** Selectores CSS; se usa el primero que esté visible */
  targets?: string[];
};

export const SITE_TOUR: TourStep[] = [
  {
    id: "hola",
    title: "Te damos la bienvenida",
    text: "Este es el sitio del CIMT. Te mostramos cómo usarlo, paso a paso. Podés ir para atrás y para adelante cuando quieras.",
  },
  {
    id: "menu",
    title: "El menú",
    text: "Arriba está el menú. Cada parte tiene un dibujo y un color. En el celular, tocá las tres rayitas.",
    targets: ['[data-tour="menu"]', '[data-tour="menu-celular"]'],
  },
  {
    id: "turno",
    title: "Pedir un turno",
    text: "Para pedir un turno, tocá «Solicitar turno». Si te cuesta escribir, podés llamarnos o usar el micrófono.",
    targets: ['[data-tour="turno"]', '[data-tour="turno-celular"]'],
  },
  {
    id: "explora",
    title: "Sacarte las dudas",
    text: "En «Explorá», Migue te hace preguntas simples. Te ayuda a entender lo que te pasa. Está en el menú.",
    targets: ['[data-tour="explora"]', '[data-tour="menu-celular"]'],
  },
  {
    id: "requisitos",
    title: "Los requisitos",
    text: "Acá dice qué hace falta para atenderte en el CIMT. Son pocas cosas.",
    targets: ["#requisitos"],
  },
  {
    id: "migue",
    title: "Hablar con Migue",
    text: "El botón redondo de abajo es Migue. Podés escribirle tus preguntas cuando quieras.",
    targets: ['[data-tour="migue"]'],
  },
  {
    id: "contacto",
    title: "Hablar con una persona",
    text: "Si preferís hablar con alguien, llamanos. Atendemos de lunes a viernes, de 7 a 18.",
    targets: ['[data-tour="contacto"]'],
  },
  {
    id: "listo",
    title: "¡Listo!",
    text: "Podés volver a ver este recorrido cuando quieras. Tocá «Ayuda», arriba. En el celular está dentro del menú.",
    targets: ['[data-tour="ayuda"]', '[data-tour="menu-celular"]'],
  },
];

// Lectura fácil: hasta 16 palabras por frase (lo revisan las pruebas)
export const EASY_READ_MAX_WORDS = 16;
export function longSentences(text: string, max = EASY_READ_MAX_WORDS): string[] {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).filter(Boolean).length > max);
}

// Lo que se recuerda en este navegador (no viaja a ningún lado)
export const TOUR_SEEN_KEY = "cimt-recorrido-visto-v1";
export const TEXT_SIZE_KEY = "cimt-tamano-letra";

// Tamaño de la letra de todo el sitio, en %
export const TEXT_SIZES = [100, 115, 130] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export function nextTextSize(current: number, dir: 1 | -1): TextSize {
  const i = TEXT_SIZES.indexOf(current as TextSize);
  const at = i < 0 ? 0 : i;
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, at + dir))];
}
export function parseTextSize(raw: string | null): TextSize {
  const n = Number(raw);
  return (TEXT_SIZES as readonly number[]).includes(n) ? (n as TextSize) : 100;
}

/** Lo que se lee en voz alta en cada paso */
export function spokenText(step: TourStep, index: number, total: number): string {
  return `Paso ${index + 1} de ${total}. ${step.title}. ${step.text}`;
}
