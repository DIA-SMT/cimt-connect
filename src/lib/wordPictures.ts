// Dibujos para las palabras de los juegos con la voz (el globo y la tortuga).
// Puro y sin alias de imports: lo usan el portal, el panel y las pruebas.
//
// El dibujo sale solo de la palabra: «árbol» → 🌳, «uvas» → 🍇. Son emojis
// (se ven en cualquier celular y no hay que cargar imágenes); los íconos de
// las poesías no alcanzan, porque no hay osos, uvas ni elefantes. Si una
// palabra no está en la lista, no lleva dibujo. Sumar una: agregarla acá.

// Con tilde cuando cambia el sentido («papá» y «papa»)
const PICTURES: Record<string, string> = {
  // Animales
  oso: "🐻", osito: "🧸", gato: "🐱", gatito: "🐱", perro: "🐶", perrito: "🐶", pez: "🐟", pescado: "🐟", pajaro: "🐦",
  conejo: "🐰", tortuga: "🐢", caracol: "🐌", ardilla: "🐿️", elefante: "🐘", leon: "🦁", tigre: "🐯", mono: "🐒",
  jirafa: "🦒", vaca: "🐮", caballo: "🐴", oveja: "🐑", cerdo: "🐷", chancho: "🐷", gallina: "🐔", pollito: "🐥",
  pato: "🦆", rana: "🐸", sapo: "🐸", serpiente: "🐍", vibora: "🐍", abeja: "🐝", mariposa: "🦋", hormiga: "🐜",
  arana: "🕷️", ballena: "🐳", delfin: "🐬", pulpo: "🐙", tiburon: "🦈", cocodrilo: "🐊", dinosaurio: "🦕",
  buho: "🦉", loro: "🦜", pinguino: "🐧", raton: "🐭", zorro: "🦊", lobo: "🐺", unicornio: "🦄", dragon: "🐉",
  iguana: "🦎", lagartija: "🦎", aguila: "🦅", cangrejo: "🦀", murcielago: "🦇", oruga: "🐛", gusano: "🐛",
  // Comida
  uva: "🍇", manzana: "🍎", banana: "🍌", naranja: "🍊", limon: "🍋", frutilla: "🍓", sandia: "🍉", pera: "🍐",
  cereza: "🍒", durazno: "🍑", anana: "🍍", palta: "🥑", tomate: "🍅", zanahoria: "🥕", choclo: "🌽", papa: "🥔",
  pan: "🍞", queso: "🧀", huevo: "🥚", leche: "🥛", agua: "💧", helado: "🍦", torta: "🎂", galletita: "🍪",
  galleta: "🍪", caramelo: "🍬", chocolate: "🍫", pizza: "🍕", empanada: "🥟", hamburguesa: "🍔", pancho: "🌭",
  sopa: "🍲", arroz: "🍚", fideo: "🍝", miel: "🍯", jugo: "🧃", mate: "🧉", cafe: "☕",
  // Naturaleza
  arbol: "🌳", flor: "🌸", hoja: "🍃", sol: "☀️", luna: "🌙", estrella: "⭐", nube: "☁️", lluvia: "🌧️",
  arcoiris: "🌈", nieve: "❄️", fuego: "🔥", montana: "⛰️", cerro: "⛰️", mar: "🌊", ola: "🌊", rio: "🏞️",
  isla: "🏝️", playa: "🏖️", volcan: "🌋", planeta: "🪐", tierra: "🌍", campo: "🌾", bosque: "🌲", cactus: "🌵",
  semilla: "🌱", piedra: "🪨", viento: "🌬️",
  // Cosas y lugares
  casa: "🏠", escuela: "🏫", auto: "🚗", colectivo: "🚌", bici: "🚲", bicicleta: "🚲", avion: "✈️", tren: "🚆",
  barco: "⛵", cohete: "🚀", pelota: "⚽", globo: "🎈", libro: "📖", lapiz: "✏️", regalo: "🎁", reloj: "⏰",
  telefono: "📞", celular: "📱", llave: "🔑", campana: "🔔", guitarra: "🎸", tambor: "🥁", musica: "🎵",
  paraguas: "☂️", sombrero: "🎩", gorra: "🧢", zapato: "👟", zapatilla: "👟", remera: "👕", corona: "👑",
  mapa: "🗺️", robot: "🤖", cama: "🛏️", silla: "🪑", puerta: "🚪", ventana: "🪟", lampara: "💡", luz: "💡",
  tijera: "✂️", cuaderno: "📓", mochila: "🎒", computadora: "💻", tele: "📺", televisor: "📺", camara: "📷",
  corazon: "❤️", castillo: "🏰", carpa: "⛺", hospital: "🏥", parque: "🏞️", rompecabezas: "🧩", dado: "🎲",
  barrilete: "🪁", payaso: "🤡", fiesta: "🎉", cumpleanos: "🎂", vela: "🕯️", iman: "🧲",
  // Fútbol
  futbol: "⚽", gol: "⚽", arco: "🥅", cancha: "🏟️", botin: "👟",
  // Cuerpo y familia
  ojo: "👁️", mano: "✋", pie: "🦶", boca: "👄", nariz: "👃", oreja: "👂", diente: "🦷",
  "mamá": "👩", "papá": "👨", bebe: "👶", abuela: "👵", abuelo: "👴", nene: "👦", nena: "👧", familia: "👪",
  // Saludos
  hola: "👋", chau: "👋",
};

const plain = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");

// La palabra como clave: minúsculas, sin signos; primero con tilde («papá»),
// después sin tilde y en singular («uvas» → «uva», «flores» → «flor», «peces» → «pez»)
function candidates(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
  if (!w) return [];
  const p = plain(w).replace(/ñ/g, "n");
  const out = [w, p];
  if (p.endsWith("ces")) out.push(`${p.slice(0, -3)}z`);
  if (p.endsWith("es")) out.push(p.slice(0, -2));
  if (p.endsWith("s")) out.push(p.slice(0, -1));
  return out;
}

/** El dibujo de una palabra (o de la primera palabra con dibujo de una frase corta). null: sin dibujo */
export function pictureFor(text: string): string | null {
  for (const word of text.split(/\s+/)) {
    for (const c of candidates(word)) {
      const pic = PICTURES[c];
      if (pic) return pic;
    }
  }
  return null;
}

/** Los dibujos de las palabras de una frase, en orden y sin repetir (hasta max) */
export function picturesIn(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const word of text.split(/\s+/)) {
    const pic = pictureFor(word);
    if (pic && !out.includes(pic)) out.push(pic);
    if (out.length >= max) break;
  }
  return out;
}
