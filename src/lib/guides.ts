// Folletos del CIMT para familias, pasados a texto para que se lean bien en el
// celular, sean accesibles y LIA pueda recomendarlos. La imagen original queda
// en public/folletos/ para descargar o imprimir.
//
// Para sumar el folleto de otra área: agregar un Guide a GUIDES.

export type Guide = {
  id: string;
  area: string;
  title: string;
  /** Rol del área: puntos numerados */
  role: { title: string; text: string }[];
  familyTips: string[];
  strategiesTitle: string;
  strategies: string[];
  keyMessage: string;
  /** Imagen original del folleto (en public/) */
  image?: { src: string; alt: string };
};

export const GUIDES: Guide[] = [
  {
    id: "terapia-ocupacional",
    area: "Terapia ocupacional",
    title: "Rol de la Terapia Ocupacional en la tartamudez",
    role: [
      {
        title: "Favorece la participación social",
        text: "Acompaña al niño, adolescente o adulto a desenvolverse con seguridad en la escuela, en el trabajo y en la comunidad.",
      },
      {
        title: "Promueve la independencia",
        text: "Entrena habilidades de la vida diaria que fortalecen la autonomía y la confianza.",
      },
      {
        title: "Trabaja la regulación emocional",
        text: "Ayuda a manejar la ansiedad, la frustración y el miedo a hablar en público.",
      },
      {
        title: "Refuerza la identidad ocupacional",
        text: "Fomenta que la persona pueda expresar quién es y qué le gusta a través de actividades significativas.",
      },
    ],
    familyTips: [
      "Escuchar con paciencia y respetar los tiempos de habla.",
      "Evitar interrumpir o completar las frases.",
      "Fomentar la participación en actividades diarias (juegos, comidas, tareas simples).",
      "Valorar los logros y reforzar positivamente cada avance.",
      "Crear un ambiente seguro, de confianza y afecto, donde la comunicación sea siempre una experiencia positiva.",
    ],
    strategiesTitle: "Estrategias prácticas que puede usar el terapeuta ocupacional",
    strategies: [
      "Juegos de rol (simular entrevistas, llamadas telefónicas, pedir en un comercio).",
      "Actividades grupales que favorezcan la interacción con pares.",
      "Técnicas de relajación y respiración aplicadas en contextos de habla.",
      "Uso de apoyos visuales o tecnológicos para acompañar la comunicación.",
      "Rutinas de organización diaria que brinden seguridad y anticipación.",
    ],
    keyMessage:
      "Desde la Terapia Ocupacional se potencia lo que cada individuo puede y quiere hacer, promoviendo una comunicación segura y una vida plena en todas sus dimensiones.",
    image: {
      src: "/folletos/terapia-ocupacional.jpg",
      alt: "Folleto del CIMT: Rol de la Terapia Ocupacional en la tartamudez, consejos para la familia y estrategias prácticas.",
    },
  },
];
