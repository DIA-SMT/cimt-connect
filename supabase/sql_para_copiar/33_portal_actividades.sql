-- ============================================================
-- 33 · PORTAL: ACTIVIDADES INTERACTIVAS (poesía y rima, fase 1)
-- ============================================================
-- Un ejercicio del plan de práctica puede llevar, además de sus pasos, una
-- actividad para jugar en el celular (poesía para leer juntos, completar la
-- rima). La actividad son DATOS que el portal sabe jugar, nunca código: su
-- forma la revisa el servidor (src/lib/activitySpec.ts) y acá solo se pone
-- el piso (un objeto y un tope de tamaño).
--
-- Va en el mismo ejercicio: se versiona, se congela al publicar y se quita
-- con él (patient_exercises_guard ya lo hace). Los pasos siguen siendo
-- obligatorios: son la versión sin pantalla.
--
-- Orden: correrlo ANTES de prender la etapa "activities" en
-- PORTAL_CLINICAL_FEATURES (sin la columna, el servidor la deja apagada).
-- Necesita el script 26.
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.patient_exercises') IS NULL THEN
    RAISE EXCEPTION 'Falta correr antes el script 26 (portal: práctica)';
  END IF;
END $$;

ALTER TABLE public.patient_exercises
  ADD COLUMN IF NOT EXISTS activity JSONB;

DO $$ BEGIN
  ALTER TABLE public.patient_exercises ADD CONSTRAINT patient_exercises_activity_check
    CHECK (activity IS NULL OR (jsonb_typeof(activity) = 'object' AND octet_length(activity::text) <= 24000));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── Verificación (tiene que dar true) ─────────────────────────
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'patient_exercises' AND column_name = 'activity'
) AND EXISTS (
  SELECT 1 FROM pg_constraint WHERE conname = 'patient_exercises_activity_check'
) AS actividades_ok;
