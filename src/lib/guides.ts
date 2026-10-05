// Folletos y textos del CIMT para la página /familias, pasados a texto para que
// se lean bien en el celular, sean accesibles y Migue pueda recomendarlos. Los
// folletos originales quedan en public/folletos/ para ver, descargar o imprimir.
//
// Para sumar un folleto: agregar un Guide a GUIDES con los bloques que tenga.

export type GuideItem = string | { title: string; text: string };

export type GuideBlock = {
  /**
   * numbered: puntos numerados (rol del área, dimensiones)
   * tips: consejos, en recuadro celeste
   * list: lista común en recuadro blanco
   * alert: recuadro de atención (bullying)
   * text: párrafos en recuadro blanco (items = párrafos)
   */
  kind: "numbered" | "tips" | "list" | "alert" | "text";
  title: string;
  items: GuideItem[];
  /** Sublistas con título dentro del mismo recuadro */
  groups?: { title: string; items: GuideItem[] }[];
  /** Enlace a otra sección de la página (por ejemplo, del bullying al Área legal) */
  link?: { href: string; text: string; label: string };
};

export type Guide = {
  id: string;
  area: string;
  /** A quién está dirigido (aparece como etiqueta) */
  audience: string;
  title: string;
  subtitle?: string;
  intro?: { title?: string; text: string };
  blocks: GuideBlock[];
  keyMessage?: string;
  /** Muestra al final cómo comunicarse con el centro para consultar */
  contact?: boolean;
  /** Imágenes del folleto original y, si hay, el PDF para descargar */
  original?: { images: { src: string; alt: string; width: number; height: number }[]; pdf?: string };
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
        link: {
          href: "#area-legal",
          text: "Si un chico sufre burlas u hostigamiento por su forma de hablar, el Área Legal del centro también puede orientar a la familia.",
          label: "Conocé el Área Legal",
        },
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
  {
    // Texto de la Dirección del CIMT (Área Legal, propuesta para canales digitales)
    id: "area-legal",
    area: "Área legal",
    audience: "Para pacientes y familias",
    title: "¿Sabías que el Centro también cuenta con Área Legal?",
    intro: {
      text: "La tartamudez no ocurre solamente dentro del consultorio. A veces, la forma de hablar puede dar lugar a burlas, hostigamiento, discriminación, exclusión o dificultades para participar plenamente en la escuela, el trabajo u otros espacios. Por eso, el abordaje integral también contempla la orientación jurídica.",
    },
    blocks: [
      {
        kind: "tips",
        title: "¿Cuándo podés consultar?",
        items: [
          "Si vos o un familiar con tartamudez atraviesan una situación de discriminación o trato desigual.",
          "Si existen burlas, imitaciones, hostigamiento, bullying o ciberbullying vinculados con la forma de hablar.",
          "Si no sabés cómo actuar, qué derechos están involucrados o a qué institución recurrir.",
          "Si necesitás orientación ante una situación escolar, laboral o institucional relacionada con la tartamudez.",
        ],
      },
      {
        kind: "text",
        title: "Consultar no es denunciar",
        items: [
          "Acercarte al Área Legal no significa que tengas que iniciar una denuncia o un reclamo. Podés consultar para informarte, ser escuchado, conocer tus derechos y recibir orientación sobre los pasos o canales disponibles. Si la situación requiere la intervención de otro organismo, también podemos orientarte sobre dónde recurrir.",
        ],
      },
      {
        kind: "text",
        title: "Un abordaje interdisciplinario",
        items: [
          "El Área Legal trabaja junto con las demás disciplinas de la Dirección. Cada situación es diferente y puede requerir distintas miradas. La orientación jurídica se suma al acompañamiento integral de la persona con tartamudez y su familia.",
        ],
      },
    ],
    keyMessage: "Informarte también es cuidar tus derechos.",
    contact: true,
  },
];
