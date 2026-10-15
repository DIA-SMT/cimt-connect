// Catálogo de ejercicios para el portal (etapas B y D).
//
// BORRADOR para que lo revisen y lo aprueben las fonoaudiólogas (y, en sus
// enfoques, psicopedagogía y terapia ocupacional) antes de usarlo con
// familias reales. Cambiar un texto aprobado es cambiar la versión
// (CATALOG_VERSION): el banco de prueba de la IA se repite con cada versión.
//
// Puro, sin alias de imports: lo usan el panel (elegir del catálogo), el
// servidor (lo que se adapta con IA sale de acá, nunca se inventa) y el mock.
//
// Reglas de los textos (diseño §4.3 y §5):
//   - Nada de presión sobre la fluidez: ni "hablar bien" ni "sin trabarse".
//     "Despacio" solo en habla fácil y en ritmo y claridad.
//   - Se valora practicar, participar y animarse, no cómo salió.
//   - Materiales de cualquier casa y sin pantallas. Hasta 8 años, juego.
//   - Los pasos le hablan a quien practica (de 2 a 5 años, al adulto que
//     juega con el chico o la chica). "Para el adulto que acompaña" le habla
//     al adulto. "Si cuesta…" siempre dice que se para y se cuenta en la
//     próxima sesión.
//   - Español rioplatense con vos, frases cortas, sin emojis.

import { type Approach, type CatalogEntry, approachAgeOk } from "./practiceRules";

export type { CatalogEntry } from "./practiceRules";

export const CATALOG_VERSION = "2026-10-borrador-1";

export const CATALOG: readonly CatalogEntry[] = [
  // ── Tiempo en familia (entorno_familia, desde 2 años) ──
  {
    id: "ef-tiempo-especial",
    approach: "entorno_familia",
    ages: { from: 2, to: 8 },
    title: "Tiempo especial de juego",
    para_que: "Un rato tranquilo de juego, a solas con un adulto, para disfrutar de hablar sin apuro.",
    pasos: [
      "Elijan un lugar tranquilo y un juego sin pantallas: bloques, muñecos o masa.",
      "El chico o la chica elige a qué jugar y cómo. El adulto acompaña.",
      "El adulto cuenta lo que ve con frases cortas y tranquilas: «Armaste una torre alta».",
      "Hagan pocas preguntas. Cuando quiere contar algo, el adulto espera con calma.",
      "Al final, el adulto le dice algo lindo del rato que pasaron juntos.",
    ],
    minutes: 10,
    materiales: "Juguetes de la casa: bloques, muñecos, masa o lápices de colores.",
    for_adult: "Es un rato para disfrutar juntos, no para corregir. Hablá tranquilo y sin apuro, y escuchá hasta el final. Si un día no se puede, no pasa nada.",
    si_cuesta: "Si cuesta o no tiene ganas, paren ahí y prueben otro día. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "ef-cuento-figuras",
    approach: "entorno_familia",
    ages: { from: 2, to: 5 },
    title: "Cuento con figuras",
    para_que: "Compartir un libro con imágenes en un momento tranquilo, para que hablar sea un placer.",
    pasos: [
      "Elegí un libro con muchas imágenes y sentate al lado del chico o la chica.",
      "Contá lo que pasa en cada página con frases cortas y tranquilas.",
      "Hacé pausas para que señale o cuente lo que quiera.",
      "Si cuenta algo, escuchá hasta el final y respondé a lo que dijo.",
      "Terminen cuando pierda el interés, aunque no hayan llegado al final.",
    ],
    minutes: 10,
    materiales: "Un libro o una revista con imágenes.",
    for_adult: "No hace falta que repita palabras ni que lea. Lo importante es disfrutar el cuento juntos y darle tiempo para hablar.",
    si_cuesta: "Si no tiene ganas, dejen el libro para otro momento. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "ef-turnos-mesa",
    approach: "entorno_familia",
    ages: { from: 4, to: 12 },
    title: "Turnos en la mesa",
    para_que: "Que en la familia cada uno tenga su turno para contar algo, sin apuro y sin interrupciones.",
    pasos: [
      "Durante una comida, elijan un objeto que pase de mano en mano, como una cuchara de madera.",
      "Habla quien tiene el objeto. Los demás escuchan hasta que termina.",
      "Cada uno cuenta algo lindo o divertido del día.",
      "Nadie completa las frases de otro ni lo apura.",
      "Cuando todos contaron algo, terminó el juego.",
    ],
    minutes: 10,
    materiales: "Un objeto para pasar de mano en mano: una cuchara de madera o un muñequito.",
    for_adult: "Mostrá con tu ejemplo cómo se espera el turno y cómo se escucha. Valorá lo que cuenta, no cómo lo dice.",
    si_cuesta: "Si alguien no quiere hablar, no insistan: puede pasar su turno. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "ef-charla-tranquila",
    approach: "entorno_familia",
    ages: { from: 13 },
    title: "Charla tranquila en casa",
    para_que: "Tener un momento de charla sin apuro con alguien de confianza, para disfrutar de conversar.",
    pasos: [
      "Elegí a alguien de tu casa y un momento tranquilo, sin pantallas cerca.",
      "Charlen sobre algo que te guste: un deporte, una serie o un plan.",
      "Tomate el tiempo que necesites para contar. Nadie te apura.",
      "Al final, cuéntense una cosa que les gustó de la charla.",
    ],
    minutes: 10,
    materiales: "Nada especial: solo un rato tranquilo.",
    for_adult: "Escuchá con interés y sin completar sus frases. Valorá lo que cuenta, no cómo lo dice. Si un día no se puede, no pasa nada.",
    si_cuesta: "Si un día no da, no pasa nada: prueben otro día. Contalo en la próxima sesión.",
    with_adult: true,
  },

  // ── Habla fácil (habla_facil, desde 6 años) ──
  {
    id: "hf-tortuga-suave",
    approach: "habla_facil",
    ages: { from: 6, to: 8 },
    title: "La tortuga que habla suave",
    para_que: "Jugar a hablar como una tortuga, suave y despacito, para conocer otra forma de hablar.",
    pasos: [
      "Mirá el dibujo de la tortuga y el de la liebre.",
      "La liebre habla rápido. La tortuga habla suave y despacito.",
      "Elegí un dibujo y contá qué es, hablando como la tortuga.",
      "Ahora le toca al adulto. Vos decís si habló como la tortuga.",
      "Jueguen con 5 dibujos.",
    ],
    minutes: 5,
    materiales: "Un dibujo de una tortuga, uno de una liebre y 5 dibujos o figuritas de cosas de la casa.",
    for_adult: "Probalo vos primero y hacelo como un juego. Felicitá que lo intente, no cómo le salió. Usen la tortuga solo durante el juego: el resto del día, que hable como le salga.",
    si_cuesta: "Si se frustra o no quiere, paren y jueguen a otra cosa. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "hf-arranque-suave",
    approach: "habla_facil",
    ages: { from: 9, to: 12 },
    title: "Arranque suave",
    para_que: "Practicar cómo empezar a hablar con un arranque suave, dentro de un juego.",
    pasos: [
      "Elegí 5 palabras que empiecen con vocal: árbol, oso, uva, elefante, isla.",
      "Decí cada palabra empezando suave, como si soplaras apenas.",
      "Armá una frase corta con cada palabra, con el mismo arranque suave.",
      "El adulto te dice cuál le sonó más suave. Después cambien de rol.",
    ],
    minutes: 5,
    materiales: "Un papel con las 5 palabras.",
    for_adult: "Hacelo como un juego y probalo vos también. Felicitá que lo intente, no cómo le salió. La técnica es para el ejercicio: el resto del día, que hable como le salga.",
    si_cuesta: "Si se aburre o le cuesta, paren ahí. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "hf-contactos-suaves",
    approach: "habla_facil",
    ages: { from: 13 },
    title: "Contactos suaves",
    para_que: "Practicar arranques y contactos suaves en palabras y frases, para tenerlos a mano cuando los necesites.",
    pasos: [
      "Escribí 6 palabras que uses seguido: tu nombre, tu calle, tu comida favorita.",
      "Decí cada una con un arranque suave, con los labios y la lengua apenas apoyados.",
      "Usá esas palabras en frases cortas, despacio y con el mismo contacto suave.",
      "Leé en voz alta un párrafo corto usando la técnica al empezar cada frase.",
      "Anotá con cuál te sentiste más cómodo o cómoda.",
    ],
    minutes: 10,
    materiales: "Un cuaderno y un texto corto para leer.",
    for_adult: "Si te pide ayuda, escuchá sin corregir. La técnica es para la práctica: en el resto del día no hace falta que la use.",
    si_cuesta: "Si te cansás o te frustra, dejalo por hoy. Contalo en la próxima sesión.",
    with_adult: false,
  },

  // ── Tartamudear fácil (tartamudear_facil, desde 9 años; ya practicado en sesión) ──
  {
    id: "tf-trabas-proposito",
    approach: "tartamudear_facil",
    ages: { from: 9, to: 12 },
    title: "Trabas a propósito",
    para_que: "Perderle el miedo al tartamudeo: practicar trabarse a propósito, con calma y como un juego.",
    pasos: [
      "Elijan juntos 5 palabras: casa, mesa, perro, sol, pan.",
      "Decí cada palabra repitiendo el primer sonido a propósito, suave y relajado: «ca-ca-casa».",
      "Ahora le toca al adulto hacer lo mismo con otras palabras.",
      "Conversen: ¿cómo se sintió trabarse a propósito?",
    ],
    minutes: 5,
    materiales: "Un papel con las 5 palabras.",
    for_adult: "Este ejercicio ya lo practicaron en sesión. Acompañá con calma y curiosidad: trabarse a propósito es parte del juego. No corrijas ni completes palabras.",
    si_cuesta: "Si se pone incómodo, paren ahí: no hace falta seguir. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "tf-tartamudeo-voluntario",
    approach: "tartamudear_facil",
    ages: { from: 13 },
    title: "Tartamudeo a propósito",
    para_que: "Tartamudear a propósito en situaciones tranquilas, para que el tartamudeo dé menos miedo.",
    pasos: [
      "Elegí 5 frases que digas seguido en casa.",
      "Decilas tartamudeando a propósito en una palabra, de forma relajada.",
      "Probalo con alguien de confianza en una charla corta.",
      "Anotá cómo te sentiste antes y después, sin juzgarte.",
    ],
    minutes: 10,
    materiales: "Un cuaderno para anotar.",
    for_adult: "Ya lo practicaron en sesión. Si te lo pide, acompañá con naturalidad: es parte del ejercicio. No corrijas ni completes palabras.",
    si_cuesta: "Si te incomoda mucho, dejalo por hoy. Contalo en la próxima sesión.",
    with_adult: false,
  },

  // ── Animarse (animarse, desde 9 años; ya practicado en sesión) ──
  {
    id: "an-escalera-desafios",
    approach: "animarse",
    ages: { from: 9, to: 12 },
    title: "Escalera de desafíos",
    para_que: "Animarse de a poco a hablar en situaciones nuevas, eligiendo desafíos chiquitos.",
    pasos: [
      "Dibujen una escalera de 4 escalones en una hoja.",
      "En cada escalón escriban un desafío, del más fácil al más difícil: saludar al vecino, pedir algo en el kiosco.",
      "Elegí el primer escalón y animate a hacerlo esta semana.",
      "Cuando lo hagas, pintá el escalón. Lo que vale es animarse, no cómo salió.",
    ],
    minutes: 10,
    materiales: "Una hoja y lápices de colores.",
    for_adult: "Que el desafío lo elija quien practica. Quedate cerca si lo necesita y felicitá que se animó, más allá de cómo salió.",
    si_cuesta: "Si un desafío da mucho miedo, bajen un escalón o déjenlo para otro día. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "an-me-animo-preguntar",
    approach: "animarse",
    ages: { from: 13 },
    title: "Me animo a preguntar",
    para_que: "Animarte a hacer una pregunta en un lugar público, a tu ritmo.",
    pasos: [
      "Elegí un lugar tranquilo: un kiosco, una librería o la biblioteca.",
      "Elegí una pregunta simple: si tienen algo, cuánto cuesta o a qué hora cierran.",
      "Entrá y hacé la pregunta. Tomate el tiempo que necesites.",
      "Después anotá qué hiciste y cómo te sentiste. Lo que vale es haberte animado.",
    ],
    minutes: 10,
    materiales: "Un cuaderno para anotar.",
    for_adult: "Si te lo pide, acompañá a la distancia. Valorá que se animó, no cómo salió.",
    si_cuesta: "Si hoy no se puede, elegí un desafío más fácil o probá otro día. Contalo en la próxima sesión.",
    with_adult: false,
  },
  {
    id: "an-una-llamada",
    approach: "animarse",
    ages: { from: 13 },
    title: "Una llamada corta",
    para_que: "Animarte a hacer una llamada corta para consultar algo, algo que a muchas personas les cuesta.",
    pasos: [
      "Elegí a dónde llamar: un comercio, un club o la biblioteca.",
      "Anotá en un papel qué querés preguntar, en pocas palabras.",
      "Hacé la llamada y preguntá. Si te trabás, seguí: está bien.",
      "Al cortar, anotá cómo te fue y qué te gustaría probar la próxima vez.",
    ],
    minutes: 10,
    materiales: "Un teléfono y un papel para anotar.",
    for_adult: "Si te lo pide, quedate cerca. No hables por quien practica ni completes sus frases. Valorá que se animó.",
    si_cuesta: "Si la llamada da mucho miedo, empezá con una persona conocida. Contalo en la próxima sesión.",
    with_adult: false,
  },

  // ── Ritmo y claridad (ritmo_y_claridad, desde 9 años) ──
  {
    id: "rc-tres-cuadros",
    approach: "ritmo_y_claridad",
    ages: { from: 9, to: 12 },
    title: "Contar en tres cuadros",
    para_que: "Ordenar lo que querés contar y hacer pausas, para que te entiendan mejor.",
    pasos: [
      "Elegí algo que te pasó hoy.",
      "Dibujá tres cuadros: qué pasó primero, después y al final.",
      "Contalo mirando los cuadros, con una pausa entre cada uno.",
      "El adulto te cuenta qué entendió. Si falta algo, lo agregan juntos.",
    ],
    minutes: 10,
    materiales: "Una hoja y lápices.",
    for_adult: "Acá sí se trabaja el ritmo: durante el ejercicio podés recordarle las pausas. Fuera de la práctica, no lo corrijas todo el tiempo.",
    si_cuesta: "Si se cansa o se frustra, paren ahí. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "rc-pausas-lectura",
    approach: "ritmo_y_claridad",
    ages: { from: 13 },
    title: "Pausas en la lectura",
    para_que: "Darte cuenta de tu ritmo al leer en voz alta y practicar pausas, para que se entienda lo que decís.",
    pasos: [
      "Elegí un texto corto que te guste: una noticia, un cuento o una receta.",
      "Marcá con una barra dónde vas a hacer una pausa, cada pocas palabras.",
      "Leelo en voz alta, despacio, respetando las pausas.",
      "Leelo otra vez y fijate si las pausas te salieron más naturales.",
    ],
    minutes: 10,
    materiales: "Un texto corto impreso o de una revista, y un lápiz.",
    for_adult: "Si te pide que escuches, contale qué entendiste. Fuera de la práctica, no lo corrijas todo el tiempo.",
    si_cuesta: "Si te aburre o te cansa, probá con un texto más corto. Contalo en la próxima sesión.",
    with_adult: false,
  },
  {
    id: "rc-explicar-pasos",
    approach: "ritmo_y_claridad",
    ages: { from: 13 },
    title: "Explicá algo paso a paso",
    para_que: "Explicar algo con orden y pausas, como en una situación de todos los días.",
    pasos: [
      "Elegí algo que sepas hacer: una receta, un juego o cómo llegar a un lugar.",
      "Anotá los pasos en una lista corta.",
      "Explicáselo a alguien de tu casa, un paso por vez, con una pausa entre cada uno.",
      "Pedile que te cuente qué entendió. Si algo no quedó claro, explicá esa parte de nuevo.",
    ],
    minutes: 10,
    materiales: "Un papel para anotar los pasos.",
    for_adult: "Escuchá hasta el final y contale qué entendiste. Valorá lo que explica, no cómo lo dice.",
    si_cuesta: "Si se hace largo, elegí algo más corto para explicar. Contalo en la próxima sesión.",
    with_adult: true,
  },

  // ── Escuela y lectura (escuela_y_lectura, de 6 a 17 años; psicopedagogía) ──
  {
    id: "el-leemos-turnos",
    approach: "escuela_y_lectura",
    ages: { from: 6, to: 8 },
    title: "Leemos de a turnos",
    para_que: "Disfrutar de leer juntos, de a turnos, sin apuro y sin corregir.",
    pasos: [
      "Elijan un libro corto con imágenes.",
      "Lean de a turnos: una página el adulto y una página vos.",
      "Si una palabra cuesta, el adulto espera tranquilo. Si querés, la leen juntos.",
      "Al terminar, cuenten qué les gustó del cuento.",
    ],
    minutes: 10,
    materiales: "Un libro corto con imágenes.",
    for_adult: "Valorá el esfuerzo y lo que entiende, no si lee rápido. Esperá con calma y no completes las palabras.",
    si_cuesta: "Si se cansa, terminen ahí y sigan otro día. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "el-exposicion-casa",
    approach: "escuela_y_lectura",
    ages: { from: 9, to: 12 },
    title: "Mi exposición en casa",
    para_que: "Practicar en casa cómo contar un tema de la escuela, para llegar a clase con más confianza.",
    pasos: [
      "Elegí un tema que estés viendo en la escuela.",
      "Escribí 3 tarjetas con las ideas principales, con palabras o dibujos.",
      "Contale el tema a tu familia mirando las tarjetas.",
      "Tu familia te dice qué fue lo que más le gustó de lo que contaste.",
    ],
    minutes: 10,
    materiales: "Tres tarjetas de cartón o papel y lápices.",
    for_adult: "Escuchá con interés y valorá lo que cuenta, no cómo lo dice. No hace falta que salga perfecto.",
    si_cuesta: "Si se pone nervioso o nerviosa, prueben con una sola tarjeta. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "el-preparar-participacion",
    approach: "escuela_y_lectura",
    ages: { from: 13, to: 17 },
    title: "Preparar una participación",
    para_que: "Preparar con tiempo una intervención en clase, para participar con más confianza.",
    pasos: [
      "Elegí una clase en la que quieras participar esta semana.",
      "Escribí en una tarjeta lo que querés decir, en pocas palabras.",
      "Practicalo en voz alta una o dos veces en casa.",
      "En clase, animate a decirlo. Si preferís, empezá leyendo la tarjeta.",
      "Después anotá cómo te fue.",
    ],
    minutes: 10,
    materiales: "Una tarjeta o un papel chico.",
    for_adult: "Si te pide que lo escuches, valorá lo que quiere decir más que la forma.",
    si_cuesta: "Si esta semana no se da, no pasa nada: elegí otra clase. Contalo en la próxima sesión.",
    with_adult: false,
  },

  // ── Regulación y rutinas (regulacion_y_rutinas, desde 2 años; terapia ocupacional) ──
  {
    id: "rr-rutina-dibujos",
    approach: "regulacion_y_rutinas",
    ages: { from: 2, to: 5 },
    title: "La rutina en dibujos",
    para_que: "Que la mañana sea previsible y tranquila, con la rutina a la vista en dibujos.",
    pasos: [
      "Dibujen juntos los pasos de la mañana: levantarse, vestirse, desayunar, salir.",
      "Peguen los dibujos en orden en un lugar a la vista.",
      "Cada mañana, miren juntos el cartel y señalen qué viene ahora.",
      "Avisá antes de cada cambio: «Cuando termines la leche, nos vestimos».",
    ],
    minutes: 10,
    materiales: "Hojas, lápices de colores y cinta para pegar.",
    for_adult: "Las rutinas previsibles dan calma. Avisá los cambios con tiempo y acompañá sin apurar. Si un día no sale, se retoma al siguiente.",
    si_cuesta: "Si un día no sale, no pasa nada: retomen al otro día. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "rr-pausa-calma",
    approach: "regulacion_y_rutinas",
    ages: { from: 6, to: 12 },
    title: "Pausa de calma",
    para_que: "Tener un momento de calma con el cuerpo, para bajar el ritmo cuando el día viene agitado.",
    pasos: [
      "Busquen un lugar tranquilo.",
      "Estírense como un gato: brazos arriba, bien largos, y después aflojen.",
      "Soplen burbujas o un molinete, suave y largo, tres veces.",
      "Apriétense las manos fuerte y suelten, tres veces.",
      "Cuenten cómo se siente el cuerpo ahora.",
    ],
    minutes: 5,
    materiales: "Burbujas, un molinete o una pluma para soplar.",
    for_adult: "Hacelo junto con quien practica: copiar al adulto ayuda. Es un momento lindo para compartir, no una forma de calmar a la fuerza.",
    si_cuesta: "Si no tiene ganas, déjenlo para otro momento. Cuéntenlo en la próxima sesión.",
    with_adult: true,
  },
  {
    id: "rr-semana-papel",
    approach: "regulacion_y_rutinas",
    ages: { from: 13 },
    title: "Mi semana en un papel",
    para_que: "Organizar la semana con momentos de descanso, para que haya menos apuro.",
    pasos: [
      "Dibujá una grilla con los 7 días.",
      "Anotá lo fijo: la escuela o el trabajo, las actividades y los turnos.",
      "Sumá en cada día un momento de descanso que te guste.",
      "Dejala a la vista y revisala el domingo.",
    ],
    minutes: 10,
    materiales: "Una hoja y lápices.",
    for_adult: "Si te la muestra, ayudá a que los momentos de descanso se respeten.",
    si_cuesta: "Si cuesta sostenerla, simplificala: un solo momento de descanso por día. Contalo en la próxima sesión.",
    with_adult: false,
  },
];

// Un ejercicio del catálogo por su id (null si no existe)
export function catalogEntry(id: string): CatalogEntry | null {
  return CATALOG.find((e) => e.id === id) ?? null;
}

// ¿El ejercicio corresponde a esta edad? (su franja y la del enfoque)
export function catalogFits(e: CatalogEntry, age: number | null): boolean {
  if (age === null || !approachAgeOk(e.approach, age)) return false;
  return age >= e.ages.from && (e.ages.to === undefined || age <= e.ages.to);
}

// "Elegir del catálogo": solo los ejercicios de los enfoques que
// corresponden al paciente (approachesForDiagnosis) y a su edad. La casilla
// "Ya lo practicamos en sesión" se pide después, en el editor.
export function catalogFor(approaches: readonly Approach[], age: number | null): CatalogEntry[] {
  const wanted = new Set(approaches);
  return CATALOG.filter((e) => wanted.has(e.approach) && catalogFits(e, age));
}
