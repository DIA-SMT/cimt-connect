// Textos base para "¿Qué trabajamos en el CIMT?" (etapa C). El profesional
// parte de uno de estos y lo adapta: nunca se publica el diagnóstico de la
// ficha tal cual. Puro, sin imports (lo usa también el modo mock).
//
// BORRADOR: las fonoaudiólogas y la Dirección tienen que revisarlos y
// aprobarlos antes de usar el portal con familias reales.

export type Audience = "infancia" | "adolescencia" | "adultez";

export function audienceFor(age: number | null): Audience {
  if (age !== null && age >= 18) return "adultez";
  if (age !== null && age >= 13) return "adolescencia";
  return "infancia";
}

const BASE: Record<string, Record<Audience, string>> = {
  "F98.5": {
    infancia:
      "{nombre} a veces repite sonidos o sílabas, alarga algunas palabras o se traba al empezar a hablar. Se llama tartamudez y es frecuente en la infancia. No es culpa de nadie y no tiene que ver con la inteligencia.\n\nEn el CIMT trabajamos para que {nombre} hable con confianza y disfrute comunicarse, y para que en casa sepan cómo acompañar.",
    adolescencia:
      "{nombre} tiene tartamudez: a veces repite sonidos, alarga palabras o se traba al hablar. Es algo que les pasa a muchas personas y no tiene que ver con la inteligencia ni con los nervios.\n\nEn el CIMT trabajamos para que se anime a hablar en las situaciones que le importan, con herramientas que le sirvan y sin sentir presión.",
    adultez:
      "Tenés tartamudez: a veces repetís sonidos, alargás palabras o te trabás al hablar. Les pasa a muchas personas y no tiene que ver con la inteligencia.\n\nEn el CIMT trabajamos para que puedas comunicarte con confianza en las situaciones que te importan, con herramientas que te sirvan.",
  },
  "F98.6": {
    infancia:
      "{nombre} a veces habla muy rápido o de forma desordenada, y se le mezclan o se le comen sílabas. Se llama farfulleo. No es culpa de nadie y no tiene que ver con la inteligencia.\n\nEn el CIMT trabajamos para que pueda organizar lo que quiere decir y que lo entiendan mejor.",
    adolescencia:
      "{nombre} tiene farfulleo: a veces habla muy rápido o de forma desordenada y se le mezclan las sílabas. No tiene que ver con la inteligencia.\n\nEn el CIMT trabajamos para que se dé cuenta de su ritmo y lo pueda manejar en las situaciones que le importan.",
    adultez:
      "Tenés farfulleo: a veces hablás muy rápido o de forma desordenada y se mezclan las sílabas. No tiene que ver con la inteligencia.\n\nEn el CIMT trabajamos para que puedas darte cuenta de tu ritmo y manejarlo en las situaciones que te importan.",
  },
  evaluacion: {
    infancia:
      "Estamos conociendo a {nombre} para entender cómo habla y qué necesita. Cuando terminemos la evaluación, lo conversamos en el centro y te contamos acá qué vamos a trabajar.",
    adolescencia:
      "Estamos conociendo a {nombre} para entender cómo habla y qué necesita. Cuando terminemos la evaluación, lo conversamos en el centro y lo contamos acá.",
    adultez:
      "Estamos en la etapa de evaluación para entender cómo hablás y qué necesitás. Cuando terminemos, lo conversamos en el centro y te lo contamos acá.",
  },
};

// Texto base para un código (F98.5, F98.6) o "evaluacion" si no hay diagnóstico
export function baseExplanation(code: string | null, audience: Audience, firstName: string): string | null {
  const key = code && BASE[code] ? code : code ? null : "evaluacion";
  if (!key) return null;
  return BASE[key][audience].replaceAll("{nombre}", firstName);
}

export function hasBaseFor(code: string | null): boolean {
  return !code || !!BASE[code];
}
