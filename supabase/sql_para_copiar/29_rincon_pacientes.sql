-- ============================================================
-- 29 · RINCÓN SOCIAL: HISTORIAS DE NUESTROS PACIENTES
-- ============================================================
-- Suma cuatro secciones al Rincón social, con historias de pacientes
-- del CIMT que se animan a contar su experiencia:
--
--   pacientes     → Nuestros pacientes
--   desafios      → Desafíos de la vida diaria
--   experiencias  → Experiencias
--   huellas       → Dejar tu huella
--
-- No hay formulario público: las historias llegan al equipo (en persona
-- o por mail) y el equipo las carga desde el panel, pestaña Rincón
-- social, con la autorización escrita del paciente (o de su adulto
-- responsable si es menor). Los nombres están en el código, no en la base.
--
-- Solo amplía las categorías permitidas: se puede correr en cualquier
-- momento (mejor antes de publicar el código, así el panel ya puede
-- guardar en las secciones nuevas).
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================

-- Se borra el control de categorías que haya (el nombre lo puso Postgres)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.social_corner_items'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE public.social_corner_items DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.social_corner_items ADD CONSTRAINT social_corner_items_category_check
  CHECK (category IN ('figuras', 'artistas', 'deportistas', 'peliculas', 'libros',
                      'pacientes', 'desafios', 'experiencias', 'huellas'));


-- ── Verificación (tiene que dar true) ─────────────────────────
SELECT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid = 'public.social_corner_items'::regclass
    AND conname = 'social_corner_items_category_check'
    AND pg_get_constraintdef(oid) LIKE '%huellas%'
) AS categorias_ok;
