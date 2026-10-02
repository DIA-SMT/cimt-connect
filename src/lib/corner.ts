// Rincón social: recomendaciones motivacionales (personas que tartamudean,
// películas, libros, artistas, deportistas). Esquema en 14_rincon_social.sql.

export type CornerCategory = "figuras" | "artistas" | "deportistas" | "peliculas" | "libros";

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
  figuras: "Figuras públicas",
  artistas: "Artistas y músicos",
  deportistas: "Deportistas",
  peliculas: "Películas y series",
  libros: "Libros y relatos",
};

export function sortCorner(items: CornerItem[]): CornerItem[] {
  return [...items].sort((a, b) => Number(b.featured) - Number(a.featured) || a.sort_order - b.sort_order || a.title.localeCompare(b.title));
}
