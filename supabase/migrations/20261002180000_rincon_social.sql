-- ============================================================
-- CIMT Connect — Rincón social
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes el script 11 (usa is_admin()).
-- Es idempotente: se puede correr varias veces (el contenido inicial no se
-- duplica ni pisa lo que el equipo haya editado).
--
-- IMPORTANTE: correlo ANTES de publicar el código nuevo.
--
-- Qué hace:
--   - Tabla social_corner_items: recomendaciones motivacionales (personas
--     que tartamudean, películas, libros, artistas, deportistas).
--   - El público ve solo lo publicado; el panel administra todo.
--   - Carga un contenido inicial (casos documentados públicamente y el
--     libro "Yo y la tartamudez" de la Municipalidad).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.social_corner_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT        UNIQUE,
  category         TEXT        NOT NULL CHECK (category IN ('figuras', 'artistas', 'deportistas', 'peliculas', 'libros')),
  title            TEXT        NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  subtitle         TEXT        CHECK (length(subtitle) <= 120),       -- ej: "Actriz", "Película, 2010"
  description      TEXT        NOT NULL CHECK (length(description) BETWEEN 10 AND 600),
  link_url         TEXT        CHECK (link_url ~ '^https?://'),
  link_label       TEXT        CHECK (length(link_label) <= 40),
  image_url        TEXT        CHECK (image_url ~ '^https?://'),
  featured         BOOLEAN     NOT NULL DEFAULT false,
  published        BOOLEAN     NOT NULL DEFAULT false,
  sort_order       INT         NOT NULL DEFAULT 100,
  created_by_email TEXT        DEFAULT (auth.jwt() ->> 'email'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS social_corner_items_updated_at ON public.social_corner_items;
CREATE TRIGGER social_corner_items_updated_at
  BEFORE UPDATE ON public.social_corner_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.social_corner_items ENABLE ROW LEVEL SECURITY;

-- El sitio ve solo lo publicado; el panel ve todo (incluidos borradores)
DROP POLICY IF EXISTS "Public view published corner" ON public.social_corner_items;
DROP POLICY IF EXISTS "Staff insert corner"          ON public.social_corner_items;
DROP POLICY IF EXISTS "Staff update corner"          ON public.social_corner_items;
CREATE POLICY "Public view published corner" ON public.social_corner_items
  FOR SELECT TO anon, authenticated USING (published OR public.is_admin());
CREATE POLICY "Staff insert corner" ON public.social_corner_items
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff update corner" ON public.social_corner_items
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── Contenido inicial ─────────────────────────────────────────
-- Casos documentados públicamente. El equipo puede editarlos, despublicarlos
-- o sumar otros desde el panel (pestaña "Rincón social").

INSERT INTO public.social_corner_items
  (slug, category, title, subtitle, description, link_url, link_label, featured, published, sort_order)
VALUES
  ('yo-y-la-tartamudez', 'libros', 'Yo y la tartamudez', 'Libro de la Municipalidad de San Miguel de Tucumán',
   'Relatos de familias y de personas con tartamudez que se atienden en el CIMT: los avances de niñas, niños y jóvenes, el acompañamiento a las familias y cartas con experiencias personales.',
   'https://smt.gob.ar/nota/yo-y-la-tartamudez/101', 'Leer en la Biblioteca Digital', true, true, 1),
  ('el-discurso-del-rey', 'peliculas', 'El discurso del rey', 'Película, 2010',
   'Cuenta cómo el rey Jorge VI del Reino Unido trabajó su tartamudez junto a su terapeuta Lionel Logue para poder hablarle a su país. Ganó el Oscar a mejor película.',
   'https://es.wikipedia.org/wiki/El_discurso_del_rey', 'Más información', false, true, 10),
  ('stutterer', 'peliculas', 'Stutterer', 'Cortometraje, 2015',
   'Un joven con tartamudez que se comunica con soltura por internet tiene que enfrentar un encuentro cara a cara. Ganó el Oscar al mejor cortometraje de ficción.',
   'https://en.wikipedia.org/wiki/Stutterer_(film)', 'Más información (en inglés)', false, true, 11),
  ('joe-biden', 'figuras', 'Joe Biden', 'Expresidente de Estados Unidos',
   'Tartamudea desde la infancia y habló públicamente muchas veces sobre cómo trabajó su forma de hablar, y del acompañamiento a chicos que tartamudean.',
   'https://es.wikipedia.org/wiki/Joe_Biden', 'Más información', false, true, 20),
  ('emily-blunt', 'artistas', 'Emily Blunt', 'Actriz',
   'Tartamudeaba de chica. Cuenta que la actuación, al ponerse en la piel de otros personajes, la ayudó a ganar confianza para hablar.',
   'https://es.wikipedia.org/wiki/Emily_Blunt', 'Más información', false, true, 30),
  ('samuel-l-jackson', 'artistas', 'Samuel L. Jackson', 'Actor',
   'Tartamudea desde niño y habló abiertamente de las estrategias que lo ayudaron a seguir adelante con su carrera como actor.',
   'https://es.wikipedia.org/wiki/Samuel_L._Jackson', 'Más información', false, true, 31),
  ('james-earl-jones', 'artistas', 'James Earl Jones', 'Actor',
   'De chico tartamudeaba tanto que durante años casi no habló. Con el tiempo se convirtió en una de las voces más reconocidas del cine: Darth Vader y Mufasa.',
   'https://es.wikipedia.org/wiki/James_Earl_Jones', 'Más información', false, true, 32),
  ('bruce-willis', 'artistas', 'Bruce Willis', 'Actor',
   'Tartamudeaba en la adolescencia y contó que subirse al escenario en el teatro escolar lo ayudó a hablar con más fluidez.',
   'https://es.wikipedia.org/wiki/Bruce_Willis', 'Más información', false, true, 33),
  ('ed-sheeran', 'artistas', 'Ed Sheeran', 'Cantante',
   'Tartamudeaba de chico. Contó que aprender a rapear canciones de Eminem lo ayudó con el ritmo y la fluidez al hablar.',
   'https://es.wikipedia.org/wiki/Ed_Sheeran', 'Más información', false, true, 34),
  ('tiger-woods', 'deportistas', 'Tiger Woods', 'Golfista',
   'Tartamudeaba de niño y contó que practicaba hablando en voz alta, incluso con su perro, hasta sentirse más seguro.',
   'https://es.wikipedia.org/wiki/Tiger_Woods', 'Más información', false, true, 40),
  ('bill-walton', 'deportistas', 'Bill Walton', 'Basquetbolista y comentarista',
   'Campeón de la NBA, tuvo una tartamudez severa hasta la adultez. Después de trabajarla se dedicó a comentar partidos por televisión.',
   'https://es.wikipedia.org/wiki/Bill_Walton', 'Más información', false, true, 41)
ON CONFLICT (slug) DO NOTHING;


-- ── Verificación rápida ────────────────────────────────────────
SELECT
  to_regclass('public.social_corner_items') IS NOT NULL                     AS rincon_ok,
  (SELECT count(*) FROM public.social_corner_items WHERE published)          AS publicados;
