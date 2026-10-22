-- ============================================================
-- 38 · PORTAL: «ME GRABO» (grabaciones de práctica)
-- ============================================================
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 22, 26, 33 y 34.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo agrega; no borra datos):
--   1. portal_consents: suma el permiso "grabaciones" (cada cuenta lo acepta
--      aparte del de la información de salud).
--   2. practice_recordings: cada grabación que manda la familia desde un
--      ejercicio con la actividad «Me grabo», con el análisis de la IA
--      (marcas para escuchar) y la revisión del profesional (su %SS). A los
--      90 días el servidor borra el audio y el texto de lo que se dijo
--      (audio_deleted_at); quedan los números.
--   3. El bucket privado "practice-recordings" de Storage (solo WAV, hasta
--      3 MB: un minuto de audio).
--
-- La etapa "recordings" se prende en el servidor (PORTAL_CLINICAL_FEATURES,
-- junto con "practice" y "activities"). Correr este script ANTES de
-- prenderla. Para el análisis hacen falta las claves de Azure
-- (AZURE_SPEECH_KEY_1/2 y AZURE_SPEECH_REGION) o de Groq (GROQ_API_KEY): uno
-- es respaldo del otro (PORTAL_STT elige el orden, "azure,groq" por defecto).
--
-- Seguridad: las familias no leen la tabla ni el bucket (todo pasa por el
-- servidor con la service role key). En el panel, solo los perfiles
-- clínicos de cada paciente pueden LEER la tabla (Administración no). El
-- bucket no tiene policies: el audio lo abre el servidor con enlaces que
-- vencen en 5 minutos. Nadie puede borrar desde la app.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.portal_consents') IS NULL THEN
    RAISE EXCEPTION 'Falta correr antes el script 22 (portal: base clínica)';
  END IF;
  IF to_regclass('public.patient_exercises') IS NULL THEN
    RAISE EXCEPTION 'Falta correr antes el script 26 (portal: práctica)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'patient_exercises' AND column_name = 'activity') THEN
    RAISE EXCEPTION 'Falta correr antes el script 33 (portal: actividades)';
  END IF;
  IF to_regprocedure('public.is_my_patient(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta correr antes el script 34 (roles por paciente)';
  END IF;
END $$;


-- ── 1. El permiso "grabaciones" ────────────────────────────────
ALTER TABLE public.portal_consents DROP CONSTRAINT IF EXISTS portal_consents_kind_check;
ALTER TABLE public.portal_consents ADD CONSTRAINT portal_consents_kind_check
  CHECK (kind IN ('privacidad', 'informacion_clinica', 'grabaciones'));


-- ── 2. Las grabaciones ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.practice_recordings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  plan_id           UUID        NOT NULL REFERENCES public.patient_exercise_plans(id) ON DELETE RESTRICT,
  exercise_id       UUID        NOT NULL REFERENCES public.patient_exercises(id) ON DELETE RESTRICT,
  exercise_key      UUID        NOT NULL,
  account_id        UUID        REFERENCES public.portal_accounts(id) ON DELETE SET NULL,
  storage_path      TEXT        NOT NULL UNIQUE,
  duration_ms       INTEGER     NOT NULL CHECK (duration_ms > 0 AND duration_ms <= 62000),
  status            TEXT        NOT NULL DEFAULT 'analizando' CHECK (status IN ('analizando', 'lista', 'error', 'revisada')),
  analysis          JSONB       CHECK (analysis IS NULL OR jsonb_typeof(analysis) = 'object'),
  analysis_error    TEXT,
  analyzed_at       TIMESTAMPTZ,
  review            JSONB       CHECK (review IS NULL OR jsonb_typeof(review) = 'object'),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by_email TEXT,
  delete_after      TIMESTAMPTZ NOT NULL,
  audio_deleted_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((review IS NULL) = (reviewed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS practice_recordings_patient_idx ON public.practice_recordings (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS practice_recordings_account_idx ON public.practice_recordings (account_id, created_at DESC);
-- Lo que hay que borrar a los 90 días
CREATE INDEX IF NOT EXISTS practice_recordings_expiry_idx ON public.practice_recordings (delete_after) WHERE audio_deleted_at IS NULL;


-- ── 3. Bucket privado para el audio ────────────────────────────
-- Sin policies a propósito: solo lo usa el servidor (service role)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('practice-recordings', 'practice-recordings', false, 3145728, ARRAY['audio/wav'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── Seguridad (RLS) ────────────────────────────────────────────
ALTER TABLE public.practice_recordings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.practice_recordings FROM anon;

DROP POLICY IF EXISTS "Clinical view practice recordings" ON public.practice_recordings;
CREATE POLICY "Clinical view practice recordings" ON public.practice_recordings
  FOR SELECT TO authenticated USING (public.is_clinical() AND public.is_my_patient(patient_id));


-- ── Verificación (tiene que dar true) ─────────────────────────
SELECT
  -- El permiso "grabaciones" se puede guardar
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'portal_consents_kind_check' AND pg_get_constraintdef(oid) ILIKE '%grabaciones%')
  -- La tabla, con RLS y una sola policy de lectura clínica por paciente
  AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'practice_recordings' AND c.relrowsecurity)
  AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'practice_recordings')
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'practice_recordings'
                    AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT ILIKE '%is_clinical()%'
                         OR coalesce(qual, '') NOT ILIKE '%is_my_patient%'))
  -- El bucket existe y es privado
  AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'practice-recordings' AND NOT public)
  -- Ninguna policy de Storage lo menciona (solo lo toca el servidor)
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage'
                    AND (coalesce(qual, '') ILIKE '%practice-recordings%'
                         OR coalesce(with_check, '') ILIKE '%practice-recordings%'))
  AS portal_grabaciones_ok;
