// Datos institucionales del CIMT que se muestran en el sitio.
// Fuente: relevamiento con el equipo del centro (septiembre 2026).
// Si cambia algo, actualizar también el prompt de Migue en server/api/chat.ts.

export const CENTER = {
  address: "Catamarca 411",
  city: "San Miguel de Tucumán",
  hoursShort: "07:00 — 18:00 hs",
  hoursLong: "Lunes a viernes · 07:00 a 18:00 hs",
  phoneDisplay: "381 258-4491",
  phoneHref: "tel:+543812584491",
  phoneNote: "Solo llamadas",
  email: "cimt@smt.gob.ar",
  // Nombre oficial (la Dirección depende de la Municipalidad de San Miguel de Tucumán)
  name: "Dirección Centro Integral Municipal de Tartamudez",
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

// Provincias para la solicitud de turno: el CIMT recibe consultas de todo el
// país. La base valida la misma lista (28_turno_menor_consentimiento.sql).
export const HOME_PROVINCE = "Tucumán";
export const PROVINCES = [
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autónoma de Buenos Aires",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
] as const;

// Requisitos para ser paciente del CIMT (inicio y /turnos). Los pasó el
// centro el 15/10/2026. Si cambia algo, actualizar también el prompt de Migue
// en server/api/chat.ts.
export const INTAKE_REQUIREMENTS = [
  {
    key: "datos",
    title: "Datos personales completos",
    text: "Los del paciente y, si es menor, los de su adulto responsable.",
  },
  {
    key: "terapias",
    title: "Asistir a las terapias individuales y grupales",
    text: "De acuerdo a lo que necesite cada paciente.",
  },
  {
    key: "taller",
    title: "Taller obligatorio de padres",
    text: "Se hace una vez al mes.",
  },
  {
    key: "tutores",
    title: "Tutores responsables que acompañen en la terapia",
    text: "El acompañamiento de la familia es parte del tratamiento.",
  },
] as const;
