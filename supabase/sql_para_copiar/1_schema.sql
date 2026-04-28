-- ============================================================
-- CIMT Connect — Schema completo (idempotente)
-- Correlo en Supabase → SQL Editor → New query → Run
-- ============================================================

-- Enums (sin error si ya existen)
DO $$ BEGIN CREATE TYPE public.patient_type AS ENUM ('niño', 'adolescente', 'adulto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.consultation_type AS ENUM ('primera_vez', 'seguimiento');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.appointment_status AS ENUM ('pendiente', 'confirmado', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tabla: professionals
CREATE TABLE IF NOT EXISTS public.professionals (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  specialty   TEXT        NOT NULL,
  days        TEXT        NOT NULL,
  description TEXT        NOT NULL,
  photo_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tabla: appointments
CREATE TABLE IF NOT EXISTS public.appointments (
  id                UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name        TEXT                      NOT NULL,
  last_name         TEXT                      NOT NULL,
  dni               TEXT                      NOT NULL,
  age               INT                       NOT NULL,
  phone             TEXT                      NOT NULL,
  email             TEXT,
  patient_type      public.patient_type       NOT NULL,
  consultation_type public.consultation_type  NOT NULL,
  reason            TEXT                      NOT NULL,
  appointment_date  DATE                      NOT NULL,
  appointment_time  TIME                      NOT NULL,
  status            public.appointment_status NOT NULL DEFAULT 'pendiente',
  professional_id   UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ               NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ               NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_appointments_date   ON public.appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON public.appointments(status);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS appointments_updated_at ON public.appointments;
CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Row Level Security
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments  ENABLE ROW LEVEL SECURITY;

-- Policies: professionals (lectura pública)
DROP POLICY IF EXISTS "Public can view professionals" ON public.professionals;
CREATE POLICY "Public can view professionals"
  ON public.professionals FOR SELECT USING (true);

-- Policies: appointments (lectura, inserción y actualización pública — MVP sin auth)
DROP POLICY IF EXISTS "Public can view appointments"   ON public.appointments;
DROP POLICY IF EXISTS "Public can create appointments" ON public.appointments;
DROP POLICY IF EXISTS "Public can update appointments" ON public.appointments;

CREATE POLICY "Public can view appointments"
  ON public.appointments FOR SELECT USING (true);

CREATE POLICY "Public can create appointments"
  ON public.appointments FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can update appointments"
  ON public.appointments FOR UPDATE USING (true) WITH CHECK (true);
