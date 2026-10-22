// Dibujos para las palabras de los juegos con la voz (el globo y la tortuga).
// Puro y sin alias de imports: lo usan el portal, el panel y las pruebas.
//
// El dibujo sale solo de la palabra: «árbol» → 🌳, «uvas» → 🍇. Son emojis
// de hasta Emoji 12 (2019: se ven en casi todos los celulares y no hay que
// cargar imágenes); los íconos de las poesías no alcanzan, porque no hay
// osos, uvas ni elefantes. Si una palabra no está en la lista, no lleva
// dibujo. Sumar una: agregarla acá.
//   - Con tilde cuando cambia el sentido («papá» y «papa», «bebé» y «bebe»,
//     «río» y «rió») y con ñ («araña» no es «arana»; «moño» no es «mono»).
//   - Fuera las palabras que suelen ser otra cosa («dado que», «arco iris»)
//     y los dibujos que se prestan a otra lectura.
//   - En una frase, una palabra con mayúscula que no va primera es un nombre
//     (Sol, Luna, Pancho): no lleva dibujo.
const PICTURES: Record<string, string> = {
  // Animales
  oso: "🐻", osito: "🧸", gato: "🐱", gatito: "🐱", perro: "🐶", perrito: "🐶", pez: "🐟", pescado: "🐟", pajaro: "🐦",
  conejo: "🐰", tortuga: "🐢", caracol: "🐌", ardilla: "🐿️", elefante: "🐘", leon: "🦁", tigre: "🐯", mono: "🐒",
  jirafa: "🦒", vaca: "🐮", caballo: "🐴", oveja: "🐑", cerdo: "🐷", chancho: "🐷", gallina: "🐔", pollito: "🐥",
  pato: "🦆", rana: "🐸", sapo: "🐸", serpiente: "🐍", vibora: "🐍", abeja: "🐝", mariposa: "🦋", hormiga: "🐜",
  "araña": "🕷️", ballena: "🐳", delfin: "🐬", pulpo: "🐙", tiburon: "🦈", cocodrilo: "🐊", dinosaurio: "🦕",
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
  arcoiris: "🌈", nieve: "❄️", fuego: "🔥", "montaña": "⛰️", cerro: "⛰️", mar: "🌊", ola: "🌊", "río": "🏞️",
  isla: "🏝️", playa: "🏖️", volcan: "🌋", planeta: "🪐", tierra: "🌍", campo: "🌾", bosque: "🌲", cactus: "🌵",
  semilla: "🌱", viento: "🌬️",
  // Cosas y lugares
  casa: "🏠", escuela: "🏫", auto: "🚗", colectivo: "🚌", bici: "🚲", bicicleta: "🚲", avion: "✈️", tren: "🚆",
  barco: "⛵", cohete: "🚀", pelota: "⚽", globo: "🎈", libro: "📖", lapiz: "✏️", regalo: "🎁", reloj: "⏰",
  telefono: "📞", celular: "📱", llave: "🔑", campana: "🔔", guitarra: "🎸", tambor: "🥁", musica: "🎵",
  paraguas: "☂️", sombrero: "🎩", gorra: "🧢", zapato: "👞", zapatilla: "👟", remera: "👕", corona: "👑",
  mapa: "🗺️", robot: "🤖", cama: "🛏️", silla: "🪑", puerta: "🚪", lampara: "💡", luz: "💡",
  tijera: "✂️", cuaderno: "📓", mochila: "🎒", computadora: "💻", tele: "📺", televisor: "📺", camara: "📷",
  corazon: "❤️", castillo: "🏰", carpa: "⛺", hospital: "🏥", parque: "🏞️", rompecabezas: "🧩",
  barrilete: "🪁", payaso: "🤡", fiesta: "🎉", "cumpleaños": "🎂", vela: "🕯️", iman: "🧲",
  // Fútbol
  futbol: "⚽", gol: "⚽", cancha: "🏟️", botin: "👟",
  // Cuerpo y familia
  ojo: "👀", mano: "✋", pie: "🦶", nariz: "👃", oreja: "👂", diente: "🦷",
  "mamá": "👩", "papá": "👨", "bebé": "👶", abuela: "👵", abuelo: "👴", nene: "👦", nena: "👧",
  // Saludos
  hola: "👋", chau: "👋",
};

// Sin tildes pero con ñ (la ñ cambia la palabra: «moño», «campaña»)
const plain = (w: string) => w.replace(/ñ/g, "\u0001").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0001/g, "ñ");

// La palabra como clave: minúsculas, sin signos; primero con tilde («papá»),
// después sin tilde y en singular («uvas» → «uva», «flores» → «flor», «peces» → «pez»)
function candidates(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
  if (!w) return [];
  const p = plain(w);
  const out = [w, p];
  // El singular, con tilde y sin tilde («ríos» → «río», «bebés» → «bebé»)
  for (const base of new Set([w, p])) {
    if (base.endsWith("ces")) out.push(`${base.slice(0, -3)}z`);
    if (base.endsWith("es")) out.push(base.slice(0, -2));
    if (base.endsWith("s")) out.push(base.slice(0, -1));
  }
  return out;
}

// Con mayúscula y no al principio: un nombre (Sol, Luna, Pancho)
const isName = (word: string, i: number) => i > 0 && /^[A-ZÁÉÍÓÚÑ]/.test(word.replace(/^[^\p{L}]+/u, ""));

/** El dibujo de una palabra (o de la primera palabra con dibujo de una frase corta). null: sin dibujo */
export function pictureFor(text: string): string | null {
  const words = text.split(/\s+/).filter(Boolean);
  for (const [i, word] of words.entries()) {
    if (isName(word, i)) continue;
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
  for (const [i, word] of text.split(/\s+/).filter(Boolean).entries()) {
    if (isName(word, i)) continue;
    const pic = pictureFor(word);
    if (pic && !out.includes(pic)) out.push(pic);
    if (out.length >= max) break;
  }
  return out;
}
