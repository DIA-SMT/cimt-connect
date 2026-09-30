-- ============================================================
-- CIMT Connect — Datos del relevamiento con el equipo
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 6, 7 y 8.
-- Es idempotente: se puede correr varias veces.
--
-- IMPORTANTE: correlo ANTES de publicar el código nuevo (el formulario de
-- turnos nuevo manda modalidad y localidad; el código viejo sigue andando
-- con este script porque esos datos son opcionales para la base).
--
-- Qué hace:
--   1. patients.locality: localidad del paciente (para estadísticas)
--   2. patients.therapy_modes: individual / grupal / GAM / acompañamiento familiar
--   3. appointments.modality: presencial o telemedicina
--   4. request_appointment(): edad mínima 2 años, horarios de 07:00 a 17:00,
--      y recibe modalidad y localidad. Mantiene la regla de un turno a futuro
--      por DNI del script 8.
-- ============================================================


-- ── 1 y 2. Pacientes ──────────────────────────────────────────

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS locality      TEXT,
  ADD COLUMN IF NOT EXISTS therapy_modes TEXT[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE public.patients ADD CONSTRAINT patients_therapy_modes_check
    CHECK (therapy_modes <@ ARRAY['individual', 'grupal', 'gam', 'familia']::TEXT[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 3. Modalidad del turno ────────────────────────────────────

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS modality TEXT NOT NULL DEFAULT 'presencial';

DO $$ BEGIN
  ALTER TABLE public.appointments ADD CONSTRAINT appointments_modality_check
    CHECK (modality IN ('presencial', 'telemedicina'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 4. Pedir turno (nueva versión) ────────────────────────────
--    Cambian los parámetros, así que se borra la versión anterior para
--    que no queden dos funciones con el mismo nombre.

DROP FUNCTION IF EXISTS public.request_appointment(
  TEXT, TEXT, TEXT, INT, TEXT, TEXT, public.patient_type, public.consultation_type, TEXT, DATE, TIME
);

CREATE OR REPLACE FUNCTION public.request_appointment(
  p_first_name        TEXT,
  p_last_name         TEXT,
  p_dni               TEXT,
  p_age               INT,
  p_phone             TEXT,
  p_email             TEXT,
  p_patient_type      public.patient_type,
  p_consultation_type public.consultation_type,
  p_reason            TEXT,
  p_date              DATE,
  p_time              TIME,
  p_modality          TEXT DEFAULT 'presencial',
  p_locality          TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today      DATE := (now() AT TIME ZONE 'America/Argentina/Tucuman')::DATE;
  v_patient_id UUID;
  v_appt_id    UUID;
  v_existing   DATE;
BEGIN
  -- Normalizar
  p_first_name := btrim(p_first_name);
  p_last_name  := btrim(p_last_name);
  p_dni        := btrim(p_dni);
  p_phone      := btrim(p_phone);
  p_email      := NULLIF(btrim(coalesce(p_email, '')), '');
  p_reason     := btrim(p_reason);
  p_modality   := coalesce(NULLIF(btrim(p_modality), ''), 'presencial');
  p_locality   := NULLIF(btrim(coalesce(p_locality, '')), '');

  -- Validar datos del paciente (mismas reglas que el formulario)
  IF length(p_first_name) NOT BETWEEN 2 AND 60 OR length(p_last_name) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'INVALID_NAME: Nombre o apellido inválido';
  END IF;
  IF p_dni !~ '^\d{6,10}$' THEN
    RAISE EXCEPTION 'INVALID_DNI: DNI inválido';
  END IF;
  IF p_age IS NULL OR p_age NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'INVALID_AGE: El centro atiende a partir de los 2 años';
  END IF;
  IF length(p_phone) NOT BETWEEN 6 AND 25 THEN
    RAISE EXCEPTION 'INVALID_PHONE: Teléfono inválido';
  END IF;
  IF p_email IS NOT NULL AND (length(p_email) > 120 OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'INVALID_EMAIL: Email inválido';
  END IF;
  IF length(p_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'INVALID_REASON: Motivo inválido';
  END IF;
  IF p_modality NOT IN ('presencial', 'telemedicina') THEN
    RAISE EXCEPTION 'INVALID_MODALITY: Modalidad inválida';
  END IF;
  IF p_locality IS NOT NULL AND length(p_locality) > 80 THEN
    RAISE EXCEPTION 'INVALID_LOCALITY: Localidad inválida';
  END IF;

  -- Validar fecha y horario (mismos horarios que src/lib/appointments.ts)
  IF p_date < v_today THEN
    RAISE EXCEPTION 'INVALID_DATE: La fecha ya pasó';
  END IF;
  IF extract(isodow FROM p_date) IN (6, 7) THEN
    RAISE EXCEPTION 'INVALID_DATE: No se atiende sábados ni domingos';
  END IF;
  IF p_time NOT IN ('07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00') THEN
    RAISE EXCEPTION 'INVALID_TIME: Horario inválido';
  END IF;

  -- Un turno a futuro por DNI (el lock evita dos pedidos simultáneos del mismo DNI)
  PERFORM pg_advisory_xact_lock(hashtext('cimt_dni_' || p_dni));

  SELECT a.appointment_date INTO v_existing
  FROM public.appointments a
  JOIN public.patients p ON p.id = a.patient_id
  WHERE p.dni = p_dni
    AND a.status <> 'cancelado'
    AND a.appointment_date >= v_today
  ORDER BY a.appointment_date
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_BOOKED: Ya hay un turno a nombre de este DNI para el %. Si necesitás cambiarlo, comunicate con el centro.',
      to_char(v_existing, 'DD/MM/YYYY');
  END IF;

  -- Evitar que dos personas reserven el mismo horario al mismo tiempo
  PERFORM pg_advisory_xact_lock(hashtext('cimt_slot_' || p_date::TEXT || '_' || p_time::TEXT));

  IF EXISTS (
    SELECT 1 FROM public.appointments
    WHERE appointment_date = p_date
      AND appointment_time = p_time
      AND status <> 'cancelado'
  ) THEN
    RAISE EXCEPTION 'SLOT_TAKEN: Ese horario ya fue reservado';
  END IF;

  -- Crear o actualizar paciente por DNI (la localidad solo se pisa si viene cargada)
  INSERT INTO public.patients (first_name, last_name, dni, age, phone, email, patient_type, locality)
  VALUES (p_first_name, p_last_name, p_dni, p_age, p_phone, p_email, p_patient_type, p_locality)
  ON CONFLICT (dni) DO UPDATE SET
    first_name   = EXCLUDED.first_name,
    last_name    = EXCLUDED.last_name,
    age          = EXCLUDED.age,
    phone        = EXCLUDED.phone,
    email        = EXCLUDED.email,
    patient_type = EXCLUDED.patient_type,
    locality     = coalesce(EXCLUDED.locality, public.patients.locality)
  RETURNING id INTO v_patient_id;

  INSERT INTO public.appointments
    (patient_id, consultation_type, reason, appointment_date, appointment_time, status, modality)
  VALUES
    (v_patient_id, p_consultation_type, p_reason, p_date, p_time, 'pendiente', p_modality)
  RETURNING id INTO v_appt_id;

  RETURN v_appt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_appointment(
  TEXT, TEXT, TEXT, INT, TEXT, TEXT, public.patient_type, public.consultation_type, TEXT, DATE, TIME, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_appointment(
  TEXT, TEXT, TEXT, INT, TEXT, TEXT, public.patient_type, public.consultation_type, TEXT, DATE, TIME, TEXT, TEXT
) TO anon, authenticated;


-- ── Verificación rápida ────────────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'patients' AND column_name = 'locality')          AS localidad_ok,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'appointments' AND column_name = 'modality')      AS modalidad_ok,
  to_regprocedure('public.request_appointment(text,text,text,int,text,text,public.patient_type,public.consultation_type,text,date,time,text,text)')
    IS NOT NULL                                                                AS turnos_ok;
