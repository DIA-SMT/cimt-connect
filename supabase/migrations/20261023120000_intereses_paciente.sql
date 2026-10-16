-- ============================================================
-- 32 · INTERESES DEL PACIENTE (para armar los ejercicios)
-- ============================================================
-- La ficha guarda qué le gusta al paciente (fútbol, animales, música…)
-- para que el editor de ejercicios lo sugiera solo. Es una lista cerrada:
-- la misma que INTERESTS en src/lib/aiDraftRules.ts.
--
-- No es un dato clínico: lo puede cargar todo el panel.
--
-- Orden: correrlo ANTES de publicar el código nuevo (la ficha lo guarda).
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE public.patients ADD CONSTRAINT patients_interests_check
    CHECK (interests <@ ARRAY[
      'futbol', 'deportes', 'animales', 'dinosaurios', 'dibujo', 'musica', 'baile', 'cocina', 'autos',
      'espacio', 'superheroes', 'cuentos', 'construccion', 'naturaleza', 'manualidades', 'videojuegos'
    ]::TEXT[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── Verificación (tiene que dar true) ─────────────────────────
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'patients' AND column_name = 'interests'
) AS intereses_ok;
