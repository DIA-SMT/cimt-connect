// Rincón social: recomendaciones motivacionales (personas que tartamudean,
// películas, libros, artistas, deportistas). Esquema en 14_rincon_social.sql.
// Desde 29_rincon_pacientes.sql también hay secciones con historias de
// pacientes del CIMT que se animan a contar su experiencia: las carga el
// equipo, con autorización escrita del paciente (o de su adulto responsable).

export type CornerCategory =
  | "figuras" | "artistas" | "deportistas" | "peliculas" | "libros"
  | "pacientes" | "desafios" | "experiencias" | "huellas";

export type CornerItem = {
  id: string;
  slug: string | null;
  category: CornerCategory;
  title: string;
  subtitle: string | null;
  description: string;
  link_url: string | null;
  link_label: string | null;
  image_url: string | null;
  featured: boolean;
  published: boolean;
  sort_order: number;
};

export const CORNER_CATEGORY_LABEL: Record<CornerCategory, string> = {
  figuras: "Figuras públicas e históricas",
  artistas: "Artistas y músicos",
  deportistas: "Deportistas",
  peliculas: "Películas y series",
  libros: "Libros y relatos",
  pacientes: "Nuestros pacientes",
  desafios: "Desafíos de la vida diaria",
  experiencias: "Experiencias",
  huellas: "Dejar tu huella",
};

/** Secciones con historias de pacientes del CIMT (bloque "Nuestra comunidad") */
export const COMMUNITY_CATEGORIES = ["pacientes", "desafios", "experiencias", "huellas"] as const satisfies readonly CornerCategory[];

export const COMMUNITY_CATEGORY_TEXT: Record<(typeof COMMUNITY_CATEGORIES)[number], string> = {
  pacientes: "Personas que se atienden en el CIMT y quieren contarnos quiénes son.",
  desafios: "Hablar por teléfono, pedir en un kiosco, dar una lección: cómo lo enfrentan.",
  experiencias: "Lo que vivieron en el camino, contado por ellos y sus familias.",
  huellas: "Mensajes para quienes recién empiezan.",
};

export function isCommunityCategory(c: CornerCategory): c is (typeof COMMUNITY_CATEGORIES)[number] {
  return (COMMUNITY_CATEGORIES as readonly CornerCategory[]).includes(c);
}

export function sortCorner(items: CornerItem[]): CornerItem[] {
  return [...items].sort((a, b) => Number(b.featured) - Number(a.featured) || a.sort_order - b.sort_order || a.title.localeCompare(b.title));
}
