-- ============================================================
-- CIMT Connect — Ficha interna de pacientes
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes 6_seguridad_admin.sql (usa is_admin()).
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace:
--   1. Agrega a patients los datos de la ficha (estado del caso,
--      condiciones, CUD, medicación, tutor, etc.)
--   2. Crea patient_referrals: derivaciones e interconsultas
--   3. Crea patient_followups: notas de seguimiento / evolución
--   4. Crea patient_reports: informes profesionales (diagnóstico,
--      progreso y evolución de la terapia)
--   Todo accesible SOLO para admins.
-- ============================================================


-- ── 1. Datos de la ficha en patients ──────────────────────────

DO $$ BEGIN
  CREATE TYPE public.case_status AS ENUM
    ('en_evaluacion', 'en_tratamiento', 'derivado', 'alta', 'abandono');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS case_status      public.case_status NOT NULL DEFAULT 'en_evaluacion',
  ADD COLUMN IF NOT EXISTS professional_id  UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referred_by      TEXT,     -- quién lo derivó al CIMT (escuela, pediatra...)
  ADD COLUMN IF NOT EXISTS main_diagnosis   TEXT,     -- diagnóstico / motivo principal
  ADD COLUMN IF NOT EXISTS other_conditions TEXT[] NOT NULL DEFAULT '{}',  -- otras discapacidades / condiciones
  ADD COLUMN IF NOT EXISTS cud_status       TEXT CHECK (cud_status IN ('si', 'no', 'en_tramite')),
  ADD COLUMN IF NOT EXISTS is_medicated     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS medication       TEXT,     -- medicación, dosis, quién la indica
  ADD COLUMN IF NOT EXISTS has_health_insurance BOOLEAN,  -- con / sin obra social (NULL = sin dato)
  ADD COLUMN IF NOT EXISTS health_insurance TEXT,     -- nombre de la obra social
  ADD COLUMN IF NOT EXISTS school           TEXT,     -- escolaridad / institución
  ADD COLUMN IF NOT EXISTS guardian_name    TEXT,     -- tutor o responsable (menores)
  ADD COLUMN IF NOT EXISTS guardian_phone   TEXT;

CREATE INDEX IF NOT EXISTS idx_patients_case_status ON public.patients(case_status);


-- ── 2. Derivaciones e interconsultas ──────────────────────────

CREATE TABLE IF NOT EXISTS public.patient_referrals (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL CHECK (kind IN ('derivacion', 'interconsulta')),
  specialty     TEXT        NOT NULL,   -- Neurología, Psicopedagogía, Terapia ocupacional...
  destination   TEXT,                   -- institución o profesional
  reason        TEXT,
  referral_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  status        TEXT        NOT NULL DEFAULT 'pendiente'
                            CHECK (status IN ('pendiente', 'realizada', 'cancelada')),
  outcome       TEXT,                   -- respuesta / resultado de la interconsulta
  registered    BOOLEAN     NOT NULL DEFAULT false,  -- casilla "interconsulta registrada"
  created_by    TEXT        DEFAULT (auth.jwt() ->> 'email'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Por si la tabla ya existía de una versión anterior de este script
ALTER TABLE public.patient_referrals
  ADD COLUMN IF NOT EXISTS registered BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_referrals_patient ON public.patient_referrals(patient_id);

DROP TRIGGER IF EXISTS patient_referrals_updated_at ON public.patient_referrals;
CREATE TRIGGER patient_referrals_updated_at
  BEFORE UPDATE ON public.patient_referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 3. Seguimiento / evolución ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.patient_followups (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  note_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
  note         TEXT        NOT NULL,
  author_email TEXT        DEFAULT (auth.jwt() ->> 'email'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followups_patient ON public.patient_followups(patient_id);


-- ── 4. Informes profesionales ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.patient_reports (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  report_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
  professional_id   UUID        REFERENCES public.professionals(id) ON DELETE SET NULL,
  diagnosis         TEXT,       -- diagnóstico
  progress          TEXT,       -- progreso
  therapy_evolution TEXT,       -- evolución de la terapia
  author_email      TEXT        DEFAULT (auth.jwt() ->> 'email'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_patient ON public.patient_reports(patient_id);

DROP TRIGGER IF EXISTS patient_reports_updated_at ON public.patient_reports;
CREATE TRIGGER patient_reports_updated_at
  BEFORE UPDATE ON public.patient_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 5. RLS: solo admins ───────────────────────────────────────

ALTER TABLE public.patient_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_reports   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage referrals" ON public.patient_referrals;
CREATE POLICY "Admins manage referrals"
  ON public.patient_referrals FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage followups" ON public.patient_followups;
CREATE POLICY "Admins manage followups"
  ON public.patient_followups FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage reports" ON public.patient_reports;
CREATE POLICY "Admins manage reports"
  ON public.patient_reports FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ── Verificación rápida ────────────────────────────────────────
SELECT 'patients' AS tabla, COUNT(*) AS filas FROM public.patients
UNION ALL SELECT 'patient_referrals', COUNT(*) FROM public.patient_referrals
UNION ALL SELECT 'patient_followups', COUNT(*) FROM public.patient_followups
UNION ALL SELECT 'patient_reports', COUNT(*) FROM public.patient_reports;
