// Datos institucionales del CIMT que se muestran en el sitio.
// Fuente: relevamiento con el equipo del centro (septiembre 2026).
// Si cambia algo, actualizar también el prompt de LIA en server/api/chat.ts.

export const CENTER = {
  address: "Catamarca 411",
  city: "San Miguel de Tucumán",
  hoursShort: "07:00 — 18:00 hs",
  hoursLong: "Lunes a viernes · 07:00 a 18:00 hs",
  phoneDisplay: "381 258-4491",
  phoneHref: "tel:+543812584491",
  phoneNote: "Solo llamadas",
  email: "cimt@smt.gob.ar",
  minAge: 2,
} as const;

export const DISCIPLINES = [
  {
    name: "Fonoaudiología",
    description: "Evaluación y tratamiento de la fluidez del habla y de la comunicación.",
  },
  {
    name: "Psicología",
    description: "Acompañamiento emocional y abordaje de la ansiedad asociada al habla.",
  },
  {
    name: "Psicopedagogía",
    description: "Apoyo en los procesos de aprendizaje y en la vida escolar.",
  },
  {
    name: "Terapia ocupacional",
    description: "Trabajo sobre la autonomía y la participación en las actividades cotidianas.",
  },
  {
    name: "Asesoría legal",
    description: "Orientación jurídica ante discriminación, burlas o bullying vinculados con la tartamudez, y sobre derechos y trámites.",
  },
] as const;

export const SERVICES = [
  {
    key: "modalidad",
    title: "Presencial y telemedicina",
    text: "Atención en el centro o a distancia, siempre con turno programado.",
  },
  {
    key: "terapia",
    title: "Terapia individual y grupal",
    text: "Espacios individuales y grupales según lo que necesite cada persona.",
  },
  {
    key: "gam",
    title: "GAM los miércoles",
    text: "Grupo de Ayuda Mutua de personas con tartamudez, todos los miércoles.",
  },
  {
    key: "familia",
    title: "Acompañamiento a la familia",
    text: "Orientación y contención para las familias y el entorno del paciente.",
  },
] as const;

// Sugerencias para el campo "Localidad" (formulario de turnos y ficha).
// Se puede escribir cualquier otra; sirve para que las estadísticas agrupen bien.
export const LOCALITY_OPTIONS = [
  "San Miguel de Tucumán",
  "Yerba Buena",
  "Tafí Viejo",
  "Banda del Río Salí",
  "Alderetes",
  "Las Talitas",
  "Lules",
  "El Manantial",
  "San Pablo",
  "Famaillá",
  "Monteros",
  "Concepción",
  "Aguilares",
  "Simoca",
  "Tafí del Valle",
] as const;
