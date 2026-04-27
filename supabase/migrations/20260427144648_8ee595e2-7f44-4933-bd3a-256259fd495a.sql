
-- Enums
CREATE TYPE public.patient_type AS ENUM ('niño', 'adolescente', 'adulto');
CREATE TYPE public.consultation_type AS ENUM ('primera_vez', 'seguimiento');
CREATE TYPE public.appointment_status AS ENUM ('pendiente', 'confirmado', 'cancelado');

-- Professionals table
CREATE TABLE public.professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  days TEXT NOT NULL,
  description TEXT NOT NULL,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Appointments table
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dni TEXT NOT NULL,
  age INT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  patient_type public.patient_type NOT NULL,
  consultation_type public.consultation_type NOT NULL,
  reason TEXT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  status public.appointment_status NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_date ON public.appointments(appointment_date);
CREATE INDEX idx_appointments_status ON public.appointments(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER appointments_updated_at
BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Public can read professionals
CREATE POLICY "Public can view professionals" ON public.professionals
FOR SELECT USING (true);

-- Public can read appointments (for calendar visibility) and create them
CREATE POLICY "Public can view appointments" ON public.appointments
FOR SELECT USING (true);

CREATE POLICY "Public can create appointments" ON public.appointments
FOR INSERT WITH CHECK (true);

-- Public can update status (admin panel sin login todavía, MVP)
CREATE POLICY "Public can update appointments" ON public.appointments
FOR UPDATE USING (true) WITH CHECK (true);

-- Seed professionals
INSERT INTO public.professionals (name, specialty, days, description) VALUES
('Lic. María González', 'Fonoaudiología', 'Lunes, Miércoles y Viernes', 'Especialista en disfluencia infantil y adolescente, con 15 años de experiencia en abordaje integral de la tartamudez.'),
('Lic. Carlos Ramírez', 'Psicología', 'Martes y Jueves', 'Psicólogo clínico orientado al acompañamiento emocional de pacientes con disfluencia y sus familias.'),
('Dra. Laura Fernández', 'Coordinación', 'Lunes a Viernes', 'Coordinadora del centro, fonoaudióloga y referente en políticas públicas de salud comunicacional.'),
('Lic. Sofía Martínez', 'Fonoaudiología', 'Martes, Jueves y Viernes', 'Especialista en evaluación y tratamiento de disfluencia en adultos. Enfoque interdisciplinario.');
