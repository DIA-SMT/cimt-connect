-- ============================================================
-- CIMT Connect — Fase 3: ficha clínica completa
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 6 a 14.
-- Es idempotente: se puede correr varias veces.
--
-- IMPORTANTE: correlo ANTES de publicar el código nuevo. El código publicado
-- hoy sigue funcionando con este script (no se borra ni renombra nada).
--
-- Qué hace (relevamiento 16–22, 26, 35 y formulario de Historia Clínica de
-- Terapia Ocupacional):
--   1. Ficha: fecha de nacimiento (la edad se calcula sola), domicilio,
--      escolaridad (escuela, turno, grado/sala), contexto familiar, motivo de
--      ingreso, antecedentes de tartamudez, diagnóstico CIE-10,
--      consentimiento informado y alta.
--   2. Adultos responsables: varios por paciente, con sus datos.
--   3. Historia clínica por área: formularios (Terapia Ocupacional y los que
--      se sumen) guardados por paciente, con fecha y profesional.
--   4. Adjuntos: consentimiento escaneado, copias de informes, estudios.
--      Se guardan en almacenamiento PRIVADO (solo el panel los descarga).
-- ============================================================


-- ── 1. Ficha ──────────────────────────────────────────────────

ALTER TABLE public.patients
  -- Filiación
  ADD COLUMN IF NOT EXISTS birth_date                DATE,
  ADD COLUMN IF NOT EXISTS address                   TEXT,
  ADD COLUMN IF NOT EXISTS school_shift              TEXT CHECK (school_shift IN ('mañana', 'tarde')),
  ADD COLUMN IF NOT EXISTS school_grade              TEXT,
  -- Contexto familiar y convivencia
  ADD COLUMN IF NOT EXISTS lives_with                TEXT,
  ADD COLUMN IF NOT EXISTS siblings                  TEXT,
  ADD COLUMN IF NOT EXISTS main_caregiver            TEXT,
  ADD COLUMN IF NOT EXISTS parents_dedication        TEXT,
  -- Motivo de consulta / ingreso
  ADD COLUMN IF NOT EXISTS arrival_route             TEXT,   -- cómo llega al CIMT
  -- Antecedentes de tartamudez
  ADD COLUMN IF NOT EXISTS stutter_onset_age         TEXT,
  ADD COLUMN IF NOT EXISTS stutter_onset_form        TEXT,
  ADD COLUMN IF NOT EXISTS stutter_situations        TEXT,
  ADD COLUMN IF NOT EXISTS previous_treatments       TEXT,
  ADD COLUMN IF NOT EXISTS family_history            TEXT,   -- antecedentes familiares de tartamudez
  ADD COLUMN IF NOT EXISTS avoids_speaking           BOOLEAN,
  ADD COLUMN IF NOT EXISTS frustration_communicating BOOLEAN,
  -- Diagnóstico estandarizado (respuesta 18: F98.5 y otros)
  ADD COLUMN IF NOT EXISTS diagnosis_code            TEXT,
  -- Consentimiento informado (respuesta 22: siempre)
  ADD COLUMN IF NOT EXISTS consent_signed            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_date              DATE,
  -- Alta (respuesta 35)
  ADD COLUMN IF NOT EXISTS discharge_date            DATE,
  ADD COLUMN IF NOT EXISTS discharge_notes           TEXT;

-- Con fecha de nacimiento, la edad se calcula sola (estadísticas al día)
CREATE OR REPLACE FUNCTION public.patients_age_from_birth()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.birth_date IS NOT NULL THEN
    NEW.age := greatest(extract(year FROM age(current_date, NEW.birth_date))::INT, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patients_age_from_birth ON public.patients;
CREATE TRIGGER patients_age_from_birth
  BEFORE INSERT OR UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patients_age_from_birth();

-- Los datos clínicos nuevos también son solo para Profesional / Dirección.
-- (Filiación, contexto familiar y consentimiento los puede cargar Administración.)
CREATE OR REPLACE FUNCTION public.patients_guard_clinical()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF public.staff_role() = 'administracion' AND (
       NEW.case_status               IS DISTINCT FROM OLD.case_status
    OR NEW.professional_id           IS DISTINCT FROM OLD.professional_id
    OR NEW.main_diagnosis            IS DISTINCT FROM OLD.main_diagnosis
    OR NEW.diagnosis_code            IS DISTINCT FROM OLD.diagnosis_code
    OR NEW.other_conditions          IS DISTINCT FROM OLD.other_conditions
    OR NEW.therapy_modes             IS DISTINCT FROM OLD.therapy_modes
    OR NEW.cud_status                IS DISTINCT FROM OLD.cud_status
    OR NEW.is_medicated              IS DISTINCT FROM OLD.is_medicated
    OR NEW.medication                IS DISTINCT FROM OLD.medication
    OR NEW.notes                     IS DISTINCT FROM OLD.notes
    OR NEW.stutter_onset_age         IS DISTINCT FROM OLD.stutter_onset_age
    OR NEW.stutter_onset_form        IS DISTINCT FROM OLD.stutter_onset_form
    OR NEW.stutter_situations        IS DISTINCT FROM OLD.stutter_situations
    OR NEW.previous_treatments       IS DISTINCT FROM OLD.previous_treatments
    OR NEW.family_history            IS DISTINCT FROM OLD.family_history
    OR NEW.avoids_speaking           IS DISTINCT FROM OLD.avoids_speaking
    OR NEW.frustration_communicating IS DISTINCT FROM OLD.frustration_communicating
    OR NEW.discharge_date            IS DISTINCT FROM OLD.discharge_date
    OR NEW.discharge_notes           IS DISTINCT FROM OLD.discharge_notes
  ) THEN
    RAISE EXCEPTION 'CLINICAL_ONLY: Solo los profesionales pueden modificar los datos clínicos';
  END IF;
  RETURN NEW;
END;
$$;


-- ── 2. Adultos responsables ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.patient_guardians (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  full_name          TEXT        NOT NULL,
  relationship       TEXT,       -- madre, padre, abuela, tutor legal...
  dni                TEXT,
  phone              TEXT,
  email              TEXT,
  lives_with_patient BOOLEAN,
  is_primary         BOOLEAN     NOT NULL DEFAULT false,   -- contacto principal
  notes              TEXT,
  active             BOOLEAN     NOT NULL DEFAULT true,    -- en lugar de borrar
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardians_patient ON public.patient_guardians(patient_id);

DROP TRIGGER IF EXISTS patient_guardians_updated_at ON public.patient_guardians;
CREATE TRIGGER patient_guardians_updated_at
  BEFORE UPDATE ON public.patient_guardians
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Pasar el "tutor" que ya estaba cargado en la ficha (una sola vez)
INSERT INTO public.patient_guardians (patient_id, full_name, phone, is_primary)
SELECT p.id, p.guardian_name, p.guardian_phone, true
FROM public.patients p
WHERE p.guardian_name IS NOT NULL AND btrim(p.guardian_name) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.patient_guardians g WHERE g.patient_id = p.id);


-- ── 3. Historia clínica por área ──────────────────────────────
--    Las preguntas de cada formulario están en el código
--    (src/lib/clinicalForms.ts); acá se guardan las respuestas.

CREATE TABLE IF NOT EXISTS public.clinical_forms (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  template_id     TEXT        NOT NULL,                  -- ej: 'terapia_ocupacional_v1'
  area            TEXT        NOT NULL,                  -- ej: 'Terapia ocupacional'
  answers         JSONB       NOT NULL DEFAULT '{}'::JSONB,
  status          TEXT        NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'completo')),
  form_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  professional_id UUID        REFERENCES public.professionals(id) ON DELETE SET NULL,
  author_email    TEXT        DEFAULT (auth.jwt() ->> 'email'),
  voided_at       TIMESTAMPTZ,
  voided_by       TEXT,
  void_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinical_forms_patient ON public.clinical_forms(patient_id);

DROP TRIGGER IF EXISTS clinical_forms_updated_at ON public.clinical_forms;
CREATE TRIGGER clinical_forms_updated_at
  BEFORE UPDATE ON public.clinical_forms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 4. Adjuntos (almacenamiento privado) ──────────────────────

CREATE TABLE IF NOT EXISTS public.patient_files (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  storage_path      TEXT        NOT NULL UNIQUE,
  file_name         TEXT        NOT NULL,
  mime_type         TEXT,
  size_bytes        BIGINT,
  category          TEXT        NOT NULL DEFAULT 'otro'
                                CHECK (category IN ('consentimiento', 'informe_interconsulta', 'estudio', 'otro')),
  description       TEXT,
  uploaded_by_email TEXT        DEFAULT (auth.jwt() ->> 'email'),
  voided_at         TIMESTAMPTZ,
  voided_by         TEXT,
  void_reason       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patient_files_patient ON public.patient_files(patient_id);

-- Bucket PRIVADO: no hay links públicos; el panel pide un link temporal
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('patient-files', 'patient-files', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Staff read patient files"   ON storage.objects;
DROP POLICY IF EXISTS "Staff upload patient files" ON storage.objects;
CREATE POLICY "Staff read patient files" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'patient-files' AND public.is_admin());
CREATE POLICY "Staff upload patient files" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'patient-files' AND public.is_admin());
-- Sin UPDATE ni DELETE: los archivos no se reemplazan ni se borran (se anulan en la ficha)


-- ── 5. Permisos ───────────────────────────────────────────────

ALTER TABLE public.patient_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_forms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_files     ENABLE ROW LEVEL SECURITY;

-- Adultos responsables: datos de contacto → todo el panel
DROP POLICY IF EXISTS "Staff view guardians"   ON public.patient_guardians;
DROP POLICY IF EXISTS "Staff insert guardians" ON public.patient_guardians;
DROP POLICY IF EXISTS "Staff update guardians" ON public.patient_guardians;
CREATE POLICY "Staff view guardians"   ON public.patient_guardians FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff insert guardians" ON public.patient_guardians FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff update guardians" ON public.patient_guardians FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Historia clínica por área: todos leen, escriben Profesional y Dirección
DROP POLICY IF EXISTS "Staff view clinical forms"     ON public.clinical_forms;
DROP POLICY IF EXISTS "Clinical insert clinical forms" ON public.clinical_forms;
DROP POLICY IF EXISTS "Clinical update clinical forms" ON public.clinical_forms;
CREATE POLICY "Staff view clinical forms"      ON public.clinical_forms FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Clinical insert clinical forms" ON public.clinical_forms FOR INSERT TO authenticated WITH CHECK (public.is_clinical());
CREATE POLICY "Clinical update clinical forms" ON public.clinical_forms FOR UPDATE TO authenticated
  USING (public.is_clinical()) WITH CHECK (public.is_clinical());

-- Adjuntos: todo el panel sube (ej. Administración escanea el consentimiento) y lee
DROP POLICY IF EXISTS "Staff view files"   ON public.patient_files;
DROP POLICY IF EXISTS "Staff insert files" ON public.patient_files;
DROP POLICY IF EXISTS "Staff update files" ON public.patient_files;
CREATE POLICY "Staff view files"   ON public.patient_files FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff insert files" ON public.patient_files FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff update files" ON public.patient_files FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Historial de cambios para las tablas nuevas
DROP TRIGGER IF EXISTS audit_guardians      ON public.patient_guardians;
DROP TRIGGER IF EXISTS audit_clinical_forms ON public.clinical_forms;
DROP TRIGGER IF EXISTS audit_patient_files  ON public.patient_files;
CREATE TRIGGER audit_guardians      AFTER INSERT OR UPDATE ON public.patient_guardians FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_clinical_forms AFTER INSERT OR UPDATE ON public.clinical_forms    FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_patient_files  AFTER INSERT OR UPDATE ON public.patient_files     FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


-- ── Verificación rápida ────────────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'patients' AND column_name = 'birth_date')     AS ficha_ok,
  to_regclass('public.patient_guardians') IS NOT NULL                       AS responsables_ok,
  to_regclass('public.clinical_forms') IS NOT NULL                          AS historia_por_area_ok,
  to_regclass('public.patient_files') IS NOT NULL                           AS adjuntos_ok,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'patient-files' AND NOT public) AS almacenamiento_privado_ok;
