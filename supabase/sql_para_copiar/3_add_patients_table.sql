-- ============================================================
-- CIMT Connect — Migración: agregar tabla patients
-- Correlo en Supabase → SQL Editor → New query → Run
--
-- Qué hace:
--   1. Crea tabla patients
--   2. Mueve los datos de pacientes de appointments → patients
--   3. Agrega patient_id a appointments
--   4. Elimina los campos de paciente duplicados en appointments
-- ============================================================


-- ── 1. Crear tabla patients ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.patients (
  id           UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name   TEXT                  NOT NULL,
  last_name    TEXT                  NOT NULL,
  dni          TEXT                  NOT NULL UNIQUE,
  age          INT                   NOT NULL,
  phone        TEXT                  NOT NULL,
  email        TEXT,
  patient_type public.patient_type   NOT NULL,
  notes        TEXT,                           -- notas clínicas opcionales
  created_at   TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patients_dni ON public.patients(dni);

-- Trigger updated_at
DROP TRIGGER IF EXISTS patients_updated_at ON public.patients;
CREATE TRIGGER patients_updated_at
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view patients"   ON public.patients;
DROP POLICY IF EXISTS "Public can create patients" ON public.patients;
DROP POLICY IF EXISTS "Public can update patients" ON public.patients;

CREATE POLICY "Public can view patients"
  ON public.patients FOR SELECT USING (true);

CREATE POLICY "Public can create patients"
  ON public.patients FOR INSERT WITH CHECK (true);

CREATE POLICY "Public can update patients"
  ON public.patients FOR UPDATE USING (true) WITH CHECK (true);


-- ── 2. Migrar datos existentes: appointments → patients ───────
--    Si la tabla appointments ya tiene filas, las convierte.
--    Deduplica por DNI (queda el registro más antiguo).

INSERT INTO public.patients (first_name, last_name, dni, age, phone, email, patient_type, created_at)
SELECT DISTINCT ON (dni)
  first_name, last_name, dni, age, phone, email, patient_type, created_at
FROM public.appointments
ORDER BY dni, created_at
ON CONFLICT (dni) DO NOTHING;


-- ── 3. Agregar columna patient_id a appointments ──────────────

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES public.patients(id) ON DELETE SET NULL;

-- Vincular appointments existentes con su paciente (por DNI)
UPDATE public.appointments a
SET    patient_id = p.id
FROM   public.patients p
WHERE  a.dni = p.dni
  AND  a.patient_id IS NULL;


-- ── 4. Eliminar campos de paciente duplicados en appointments ──
--    Solo se corre si la columna existe (idempotente)

ALTER TABLE public.appointments
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS dni,
  DROP COLUMN IF EXISTS age,
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS patient_type;


-- ── Verificación rápida ────────────────────────────────────────
SELECT 'patients' AS tabla, COUNT(*) AS filas FROM public.patients
UNION ALL
SELECT 'appointments', COUNT(*) FROM public.appointments;
