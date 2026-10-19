import {
  type LucideIcon,
  Anchor, Apple, Bell, Bike, Bird, BookOpen, Bot, Bus, Cake, Car, Carrot, Castle, Cat, Cherry, Cloud, CloudRain, Compass,
  Cookie, Crown, Dog, Drum, Egg, Feather, Fish, Flower2, Ghost, Gift, Guitar, Heart, House, IceCreamCone, Key, Leaf, Map,
  Moon, Mountain, Music, Orbit, Palette, PawPrint, Pencil, Pizza, Plane, Puzzle, Rabbit, Rainbow, Rocket, Sailboat, Shell,
  Ship, Snail, Snowflake, Sprout, Squirrel, Star, Sun, Tent, TrainFront, TreePalm, TreePine, Turtle, Umbrella, Volleyball,
  Waves, Bug,
} from "lucide-react";
import type { IconId, ThemeId } from "@/lib/activityAssets";

// Qué se ve para cada id del catálogo de recursos (src/lib/activityAssets.ts)

export const ICON_COMPONENT: Record<IconId, LucideIcon> = {
  gato: Cat, perro: Dog, pez: Fish, pajaro: Bird, conejo: Rabbit, tortuga: Turtle, caracol: Snail, ardilla: Squirrel,
  bicho: Bug, huella: PawPrint, cohete: Rocket, luna: Moon, sol: Sun, estrella: Star, nube: Cloud, lluvia: CloudRain,
  copo: Snowflake, planeta: Orbit, arcoiris: Rainbow, pino: TreePine, palmera: TreePalm, flor: Flower2, hoja: Leaf,
  brote: Sprout, montana: Mountain, olas: Waves, caracola: Shell, ancla: Anchor, velero: Sailboat, barco: Ship,
  manzana: Apple, cereza: Cherry, zanahoria: Carrot, helado: IceCreamCone, torta: Cake, galletita: Cookie, pizza: Pizza,
  huevo: Egg, casa: House, carpa: Tent, castillo: Castle, auto: Car, colectivo: Bus, bici: Bike, avion: Plane,
  tren: TrainFront, musica: Music, guitarra: Guitar, tambor: Drum, libro: BookOpen, lapiz: Pencil, pintura: Palette,
  rompecabezas: Puzzle, pelota: Volleyball, regalo: Gift, corazon: Heart, paraguas: Umbrella, corona: Crown, llave: Key,
  campana: Bell, mapa: Map, brujula: Compass, pluma: Feather, fantasma: Ghost, robot: Bot,
};

// Cada tema: el fondo de la cabecera, el color de los dibujos y su ícono
export const THEME_STYLE: Record<ThemeId, { band: string; ink: string; icon: LucideIcon }> = {
  cielo: { band: "bg-sky-100 dark:bg-sky-950", ink: "text-sky-800 dark:text-sky-200", icon: Cloud },
  mar: { band: "bg-cyan-100 dark:bg-cyan-950", ink: "text-cyan-800 dark:text-cyan-200", icon: Waves },
  selva: { band: "bg-emerald-100 dark:bg-emerald-950", ink: "text-emerald-800 dark:text-emerald-200", icon: TreePalm },
  espacio: { band: "bg-indigo-100 dark:bg-indigo-950", ink: "text-indigo-800 dark:text-indigo-200", icon: Rocket },
  campo: { band: "bg-lime-100 dark:bg-lime-950", ink: "text-lime-800 dark:text-lime-200", icon: Sprout },
  ciudad: { band: "bg-amber-100 dark:bg-amber-950", ink: "text-amber-800 dark:text-amber-200", icon: House },
};
