// Recursos visuales de las actividades interactivas: listas cerradas.
// Puro y sin alias de imports (lo usan el servidor, el panel, el portal, el
// mock y las pruebas). La actividad nombra un tema y, si quiere, un dibujo por
// estrofa o tarjeta, siempre por id: nunca una URL ni un archivo. Qué se ve
// para cada id lo decide el portal (src/components/activity/assets.tsx).
//
// Por ahora no hay ilustraciones propias: los dibujos son íconos de
// lucide-react. Sumar un dibujo es sumar un id acá y su ícono allá.

export const THEME_IDS = ["cielo", "mar", "selva", "espacio", "campo", "ciudad"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const THEME_LABEL: Record<ThemeId, string> = {
  cielo: "Cielo",
  mar: "Mar",
  selva: "Selva",
  espacio: "Espacio",
  campo: "Campo",
  ciudad: "Ciudad",
};
export const DEFAULT_THEME: ThemeId = "cielo";

export const ICON_IDS = [
  "gato", "perro", "pez", "pajaro", "conejo", "tortuga", "caracol", "ardilla", "bicho", "huella",
  "cohete", "luna", "sol", "estrella", "nube", "lluvia", "copo", "planeta", "arcoiris",
  "pino", "palmera", "flor", "hoja", "brote", "montana", "olas", "caracola", "ancla", "velero", "barco",
  "manzana", "cereza", "zanahoria", "helado", "torta", "galletita", "pizza", "huevo",
  "casa", "carpa", "castillo", "auto", "colectivo", "bici", "avion", "tren",
  "musica", "guitarra", "tambor", "libro", "lapiz", "pintura", "rompecabezas", "pelota",
  "regalo", "corazon", "paraguas", "corona", "llave", "campana", "mapa", "brujula", "pluma", "fantasma", "robot",
] as const;
export type IconId = (typeof ICON_IDS)[number];
export const ICON_LABEL: Record<IconId, string> = {
  gato: "Gato", perro: "Perro", pez: "Pez", pajaro: "Pájaro", conejo: "Conejo", tortuga: "Tortuga",
  caracol: "Caracol", ardilla: "Ardilla", bicho: "Bichito", huella: "Huella",
  cohete: "Cohete", luna: "Luna", sol: "Sol", estrella: "Estrella", nube: "Nube", lluvia: "Lluvia",
  copo: "Copo de nieve", planeta: "Planeta", arcoiris: "Arcoíris",
  pino: "Pino", palmera: "Palmera", flor: "Flor", hoja: "Hoja", brote: "Brote", montana: "Montaña",
  olas: "Olas", caracola: "Caracola", ancla: "Ancla", velero: "Velero", barco: "Barco",
  manzana: "Manzana", cereza: "Cereza", zanahoria: "Zanahoria", helado: "Helado", torta: "Torta",
  galletita: "Galletita", pizza: "Pizza", huevo: "Huevo",
  casa: "Casa", carpa: "Carpa", castillo: "Castillo", auto: "Auto", colectivo: "Colectivo", bici: "Bici",
  avion: "Avión", tren: "Tren",
  musica: "Música", guitarra: "Guitarra", tambor: "Tambor", libro: "Libro", lapiz: "Lápiz",
  pintura: "Pintura", rompecabezas: "Rompecabezas", pelota: "Pelota",
  regalo: "Regalo", corazon: "Corazón", paraguas: "Paraguas", corona: "Corona", llave: "Llave",
  campana: "Campana", mapa: "Mapa", brujula: "Brújula", pluma: "Pluma", fantasma: "Fantasma", robot: "Robot",
};

export const isThemeId = (x: unknown): x is ThemeId => (THEME_IDS as readonly unknown[]).includes(x);
export const isIconId = (x: unknown): x is IconId => (ICON_IDS as readonly unknown[]).includes(x);
