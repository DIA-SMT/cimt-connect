// Folletos del CIMT pasados a texto (página /familias), para que se lean bien
// en el celular, sean accesibles y LIA pueda recomendarlos. Los originales
// quedan en public/folletos/ para ver, descargar o imprimir.
//
// Para sumar un folleto: agregar un Guide a GUIDES con los bloques que tenga.

export type GuideItem = string | { title: string; text: string };

export type GuideBlock = {
  /**
   * numbered: puntos numerados (rol del área, dimensiones)
   * tips: consejos, en recuadro celeste
   * list: lista común en recuadro blanco
   * alert: recuadro de atención (bullying)
   */
  kind: "numbered" | "tips" | "list" | "alert";
  title: string;
  items: GuideItem[];
  /** Sublistas con título dentro del mismo recuadro */
  groups?: { title: string; items: GuideItem[] }[];
};

export type Guide = {
  id: string;
  area: string;
  /** A quién está dirigido (aparece como etiqueta) */
  audience: string;
  title: string;
  subtitle?: string;
  intro?: { title: string; text: string };
  blocks: GuideBlock[];
  keyMessage?: string;
  /** Imágenes del folleto original y, si hay, el PDF para descargar */
  original: { images: { src: string; alt: string; width: number; height: number }[]; pdf?: string };
};

export const GUIDES: Guide[] = [
  {
    id: "terapia-ocupacional",
    area: "Terapia ocupacional",
    audience: "Para la familia",
    title: "Rol de la Terapia Ocupacional en la tartamudez",
    blocks: [
      {
        kind: "numbered",
        title: "Qué hace la Terapia Ocupacional",
        items: [
          { title: "Favorece la participación social", text: "Acompaña al niño, adolescente o adulto a desenvolverse con seguridad en la escuela, en el trabajo y en la comunidad." },
          { title: "Promueve la independencia", text: "Entrena habilidades de la vida diaria que fortalecen la autonomía y la confianza." },
          { title: "Trabaja la regulación emocional", text: "Ayuda a manejar la ansiedad, la frustración y el miedo a hablar en público." },
          { title: "Refuerza la identidad ocupacional", text: "Fomenta que la persona pueda expresar quién es y qué le gusta a través de actividades significativas." },
        ],
      },
      {
        kind: "tips",
        title: "Consejos para la familia",
        items: [
          "Escuchar con paciencia y respetar los tiempos de habla.",
          "Evitar interrumpir o completar las frases.",
          "Fomentar la participación en actividades diarias (juegos, comidas, tareas simples).",
          "Valorar los logros y reforzar positivamente cada avance.",
          "Crear un ambiente seguro, de confianza y afecto, donde la comunicación sea siempre una experiencia positiva.",
        ],
      },
      {
        kind: "list",
        title: "Estrategias prácticas que puede usar el terapeuta ocupacional",
        items: [
          "Juegos de rol (simular entrevistas, llamadas telefónicas, pedir en un comercio).",
          "Actividades grupales que favorezcan la interacción con pares.",
          "Técnicas de relajación y respiración aplicadas en contextos de habla.",
          "Uso de apoyos visuales o tecnológicos para acompañar la comunicación.",
          "Rutinas de organización diaria que brinden seguridad y anticipación.",
        ],
      },
    ],
    keyMessage:
      "Desde la Terapia Ocupacional se potencia lo que cada individuo puede y quiere hacer, promoviendo una comunicación segura y una vida plena en todas sus dimensiones.",
    original: {
      images: [{
        src: "/folletos/terapia-ocupacional.jpg", width: 1280, height: 904,
        alt: "Folleto del CIMT: Rol de la Terapia Ocupacional en la tartamudez, consejos para la familia y estrategias prácticas.",
      }],
    },
  },
  {
    id: "psicopedagogia",
    area: "Psicopedagogía",
    audience: "Para docentes",
    title: "Psicopedagogía y tartamudez",
    subtitle: "Aprender a escuchar, enseñar a incluir",
    intro: {
      title: "¿Qué es la psicopedagogía?",
      text: "Es una disciplina que estudia los procesos de aprendizaje a lo largo de la vida. Su objetivo es favorecer aprendizajes significativos, inclusivos y saludables.",
    },
    blocks: [
      {
        kind: "numbered",
        title: "Desde la psicopedagogía la tartamudez se aborda desde",
        items: [
          { title: "La dimensión emocional", text: "Autoestima, confianza, ansiedad comunicativa." },
          { title: "La dimensión social", text: "Interacción con pares, participación en clase." },
          { title: "La dimensión del aprendizaje", text: "Cómo la tartamudez influye en la lectoescritura, la participación oral y el acceso al conocimiento." },
        ],
      },
      {
        kind: "tips",
        title: "Consejos para docentes",
        items: [
          "Escuchar con paciencia.",
          "Favorecer un clima seguro.",
          "Dar tiempo: respetar las pausas.",
          "Ofrecer apoyos visuales.",
          "Valorar sus logros.",
          "Mantener el contacto visual.",
        ],
        groups: [
          {
            title: "En actividades escolares",
            items: [
              "Adaptar los tiempos de exposición oral.",
              "Dar la opción de responder de manera escrita.",
              "Valorar el contenido de lo que dice más que la forma.",
            ],
          },
          {
            title: "En la convivencia escolar",
            items: [
              "Prevenir burlas, apodos o interrupciones por parte de los compañeros.",
              "Promover la empatía en el grupo.",
              "Asignar roles en los que el alumno pueda sentirse seguro y valorado.",
            ],
          },
        ],
      },
      {
        kind: "alert",
        title: "¿Cómo evitar el bullying?",
        items: [
          "Promover el respeto.",
          { title: "Intervenir de inmediato", text: "Ante burlas o imitaciones del habla, mostrando que no se toleran actitudes de discriminación." },
          { title: "Fomentar la empatía", text: "Actividades grupales donde los alumnos se pongan en el lugar del otro y valoren la diversidad." },
          "Hablar abiertamente sobre la tartamudez en el aula.",
          { title: "Reforzar fortalezas", text: "Destacar los logros académicos y personales del alumno." },
          { title: "Trabajo en red", text: "Articular con docentes, familia y equipo de orientación para generar un ambiente seguro y protector." },
        ],
      },
    ],
    original: {
      images: [
        { src: "/folletos/psicopedagogia-1.jpg", width: 1432, height: 1012, alt: "Folleto del CIMT: Psicopedagogía y tartamudez, consejos para docentes." },
        { src: "/folletos/psicopedagogia-2.jpg", width: 1432, height: 1012, alt: "Folleto del CIMT: ¿Cómo evitar el bullying?" },
      ],
      pdf: "/folletos/psicopedagogia.pdf",
    },
  },
];
