-- ============================================================
-- 27 · RINCÓN SOCIAL: PERSONALIDADES CON TARTAMUDEZ (videos)
-- ============================================================
-- Contenido que pasó el equipo del CIMT ("Personalidades alrededor del
-- mundo con tartamudez"): cada persona con un video de YouTube donde
-- habla de su tartamudez.
--
--   1. Suma las que faltaban: Rodrigo Rey, James Rodríguez, Camilo y
--      Jordi Sierra i Fabra (publicadas, sin foto).
--   2. Suma escritores y figuras históricas, con link a Wikipedia:
--      Demóstenes, Lewis Carroll, Jorge VI, Somerset Maugham, Jorge
--      Luis Borges, David Seidler y David Mitchell (publicadas, sin foto).
--   3. A las que ya estaban (Emily Blunt, Ed Sheeran, Bruce Willis y
--      Joe Biden) les cambia el link de Wikipedia por el video. Solo si
--      el link sigue siendo el original: lo que el equipo haya editado
--      desde el panel no se pisa.
--
-- La categoría "figuras" se muestra en el sitio como "Figuras públicas e
-- históricas" (el nombre está en el código, no en la base).
--
-- Solo cambia contenido (no código ni permisos): se puede correr en
-- cualquier momento. Después se edita como siempre desde el panel,
-- pestaña Rincón social.
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================

INSERT INTO public.social_corner_items
  (slug, category, title, subtitle, description, link_url, link_label, featured, published, sort_order)
VALUES
  ('demostenes', 'figuras', 'Demóstenes', 'Orador de la antigua Grecia',
   'Considerado uno de los grandes oradores de la historia. Según la tradición, tartamudeaba de joven y ensayaba sus discursos con piedras en la boca y frente al mar.',
   'https://es.wikipedia.org/wiki/Dem%C3%B3stenes', 'Más información', false, true, 22),
  ('lewis-carroll', 'figuras', 'Lewis Carroll', 'Escritor y matemático inglés',
   'Autor de «Alicia en el país de las maravillas». Tartamudeaba desde chico, igual que varios de sus hermanos. De adulto le costaba la vida social, pero se sentía cómodo contándoles historias a los chicos.',
   'https://es.wikipedia.org/wiki/Lewis_Carroll', 'Más información', false, true, 23),
  ('jorge-vi', 'figuras', 'Jorge VI', 'Rey del Reino Unido',
   'Padre de la reina Isabel II. Trabajó su forma de hablar junto a su terapeuta, Lionel Logue, para poder dirigirse a su país por radio durante la Segunda Guerra Mundial. Su historia inspiró «El discurso del rey».',
   'https://es.wikipedia.org/wiki/Jorge_VI_del_Reino_Unido', 'Más información', false, true, 24),
  ('somerset-maugham', 'figuras', 'Somerset Maugham', 'Escritor británico',
   'Uno de los novelistas y dramaturgos británicos más leídos del siglo XX, autor de «Servidumbre humana». Tartamudeó desde la infancia.',
   'https://es.wikipedia.org/wiki/William_Somerset_Maugham', 'Más información', false, true, 25),
  ('jorge-luis-borges', 'figuras', 'Jorge Luis Borges', 'Escritor argentino',
   'Uno de los grandes escritores en lengua española. De joven tartamudeaba y era muy tímido: hablar en público le generaba mucha ansiedad. Con los años dio clases y conferencias, y se hizo famoso por sus entrevistas.',
   'https://es.wikipedia.org/wiki/Jorge_Luis_Borges', 'Más información', false, true, 26),
  ('david-seidler', 'figuras', 'David Seidler', 'Guionista británico',
   'Ganó el Oscar por el guion de «El discurso del rey». Tartamudeaba de chico y se inspiró en su propia experiencia para contar la historia del rey Jorge VI.',
   'https://es.wikipedia.org/wiki/David_Seidler', 'Más información', false, true, 27),
  ('david-mitchell', 'figuras', 'David Mitchell', 'Escritor británico',
   'Autor de «El atlas de las nubes». En su novela «Black Swan Green», en parte autobiográfica, cuenta cómo es crecer siendo un chico que tartamudea.',
   'https://es.wikipedia.org/wiki/David_Mitchell', 'Más información', false, true, 28),
  ('jordi-sierra-i-fabra', 'figuras', 'Jordi Sierra i Fabra', 'Escritor y locutor',
   'Escritor español con cientos de libros para chicos y jóvenes, y locutor de radio. En el video se presenta así: «Soy escritor, locutor y tartamudo».',
   'https://www.youtube.com/shorts/OYRm4nz5a_c', 'Ver video', false, true, 21),
  ('camilo', 'artistas', 'Camilo', 'Cantante colombiano',
   'Cantante y compositor colombiano, ganador de varios Latin Grammy. En una entrevista en un podcast habló de su tartamudez.',
   'https://www.youtube.com/shorts/Wo0JUccEvnM', 'Ver video', false, true, 35),
  ('james-rodriguez', 'deportistas', 'James Rodríguez', 'Futbolista colombiano',
   'Figura de la selección de Colombia y goleador del Mundial 2014. Es uno de los deportistas más conocidos que tartamudean.',
   'https://www.youtube.com/shorts/oxqRp2L6CFQ', 'Ver video', false, true, 42),
  ('rodrigo-rey', 'deportistas', 'Rodrigo Rey', 'Futbolista, arquero argentino',
   'Arquero argentino. Habló en público de su tartamudez y de que en las canchas le gritan «tartamudo»: un llamado a respetar a quienes tartamudean.',
   'https://www.youtube.com/shorts/ECHqLq7GOWw', 'Ver video', false, true, 43)
ON CONFLICT (slug) DO NOTHING;

-- Las que ya estaban: el video en lugar de Wikipedia
UPDATE public.social_corner_items SET link_url = v.url, link_label = v.label
FROM (VALUES
  ('emily-blunt',  'https://es.wikipedia.org/wiki/Emily_Blunt',  'https://www.youtube.com/shorts/dDf367u57Jo',   'Ver video (en inglés)'),
  ('ed-sheeran',   'https://es.wikipedia.org/wiki/Ed_Sheeran',   'https://www.youtube.com/shorts/5_j3pWtYwaM',   'Ver video (en inglés)'),
  ('bruce-willis', 'https://es.wikipedia.org/wiki/Bruce_Willis', 'https://www.youtube.com/shorts/8lVV0OLsvBM',   'Ver video'),
  ('joe-biden',    'https://es.wikipedia.org/wiki/Joe_Biden',    'https://www.youtube.com/watch?v=6q6i3FDPzmw', 'Ver video (en inglés)')
) AS v(slug, old_url, url, label)
WHERE social_corner_items.slug = v.slug AND social_corner_items.link_url = v.old_url;


-- ── Verificación (tiene que dar 8, 8 y 7) ──────────────────────
SELECT
  (SELECT count(*) FROM public.social_corner_items
    WHERE slug IN ('jordi-sierra-i-fabra', 'camilo', 'james-rodriguez', 'rodrigo-rey',
                   'emily-blunt', 'ed-sheeran', 'bruce-willis', 'joe-biden'))       AS personalidades,
  (SELECT count(*) FROM public.social_corner_items
    WHERE slug IN ('jordi-sierra-i-fabra', 'camilo', 'james-rodriguez', 'rodrigo-rey',
                   'emily-blunt', 'ed-sheeran', 'bruce-willis', 'joe-biden')
      AND link_url LIKE 'https://www.youtube.com/%')                                 AS con_video,
  (SELECT count(*) FROM public.social_corner_items
    WHERE slug IN ('demostenes', 'lewis-carroll', 'jorge-vi', 'somerset-maugham',
                   'jorge-luis-borges', 'david-seidler', 'david-mitchell'))          AS escritores_e_historicas;
