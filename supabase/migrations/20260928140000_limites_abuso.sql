-- ============================================================
-- CIMT Connect — Límites contra abuso
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes 6_seguridad_admin.sql.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace:
--   1. Límite de mensajes al chatbot LIA por persona (cada mensaje
--      consume crédito de OpenRouter): 20 cada 10 minutos y 100 por día.
--   2. Turnos: cada DNI puede tener como máximo UN turno a futuro
--      (pendiente o confirmado). Reemplaza request_appointment().
-- ============================================================


-- ── 1. Rate limit del chat ────────────────────────────────────
--    La clave es un hash de la IP (no se guarda la IP real).
--    Solo se accede por la función; la tabla no tiene policies.

CREATE TABLE IF NOT EXISTS public.chat_rate_limits (
  key          TEXT        NOT NULL,
  bucket       TEXT        NOT NULL CHECK (bucket IN ('10m', 'day')),
  bucket_start TIMESTAMPTZ NOT NULL,
  hits         INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (key, bucket, bucket_start)
);

ALTER TABLE public.chat_rate_limits ENABLE ROW LEVEL SECURITY;

-- Devuelve true si la persona todavía puede mandar un mensaje (y lo cuenta)
CREATE OR REPLACE FUNCTION public.chat_rate_limit_hit(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hits_10m INT;
  v_hits_day INT;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 16 AND 128 THEN
    RETURN false;
  END IF;

  INSERT INTO public.chat_rate_limits (key, bucket, bucket_start, hits)
  VALUES (p_key, '10m', date_bin('10 minutes', now(), TIMESTAMPTZ '2000-01-01'), 1)
  ON CONFLICT (key, bucket, bucket_start) DO UPDATE SET hits = public.chat_rate_limits.hits + 1
  RETURNING hits INTO v_hits_10m;

  INSERT INTO public.chat_rate_limits (key, bucket, bucket_start, hits)
  VALUES (p_key, 'day', date_trunc('day', now()), 1)
  ON CONFLICT (key, bucket, bucket_start) DO UPDATE SET hits = public.chat_rate_limits.hits + 1
  RETURNING hits INTO v_hits_day;

  -- Limpieza ocasional de ventanas viejas
  IF random() < 0.02 THEN
    DELETE FROM public.chat_rate_limits WHERE bucket_start < now() - INTERVAL '2 days';
  END IF;

  RETURN v_hits_10m <= 20 AND v_hits_day <= 100;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_rate_limit_hit(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_rate_limit_hit(TEXT) TO anon, authenticated;


-- ── 2. Pedir turno: máximo un turno a futuro por DNI ──────────
--    Misma función que en 6_seguridad_admin.sql + la regla nueva
--    (código de error ALREADY_BOOKED).

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
  p_time              TIME
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

  -- Validar datos del paciente (mismas reglas que el formulario)
  IF length(p_first_name) NOT BETWEEN 2 AND 60 OR length(p_last_name) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'INVALID_NAME: Nombre o apellido inválido';
  END IF;
  IF p_dni !~ '^\d{6,10}$' THEN
    RAISE EXCEPTION 'INVALID_DNI: DNI inválido';
  END IF;
  IF p_age IS NULL OR p_age NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'INVALID_AGE: Edad inválida';
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

  -- Validar fecha y horario (mismos horarios que src/lib/appointments.ts)
  IF p_date < v_today THEN
    RAISE EXCEPTION 'INVALID_DATE: La fecha ya pasó';
  END IF;
  IF extract(isodow FROM p_date) IN (6, 7) THEN
    RAISE EXCEPTION 'INVALID_DATE: No se atiende sábados ni domingos';
  END IF;
  IF p_time NOT IN ('08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00') THEN
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

  -- Crear o actualizar paciente por DNI
  INSERT INTO public.patients (first_name, last_name, dni, age, phone, email, patient_type)
  VALUES (p_first_name, p_last_name, p_dni, p_age, p_phone, p_email, p_patient_type)
  ON CONFLICT (dni) DO UPDATE SET
    first_name   = EXCLUDED.first_name,
    last_name    = EXCLUDED.last_name,
    age          = EXCLUDED.age,
    phone        = EXCLUDED.phone,
    email        = EXCLUDED.email,
    patient_type = EXCLUDED.patient_type
  RETURNING id INTO v_patient_id;

  INSERT INTO public.appointments
    (patient_id, consultation_type, reason, appointment_date, appointment_time, status)
  VALUES
    (v_patient_id, p_consultation_type, p_reason, p_date, p_time, 'pendiente')
  RETURNING id INTO v_appt_id;

  RETURN v_appt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_appointment(
  TEXT, TEXT, TEXT, INT, TEXT, TEXT, public.patient_type, public.consultation_type, TEXT, DATE, TIME
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_appointment(
  TEXT, TEXT, TEXT, INT, TEXT, TEXT, public.patient_type, public.consultation_type, TEXT, DATE, TIME
) TO anon, authenticated;


-- ── Verificación rápida ────────────────────────────────────────
SELECT
  to_regprocedure('public.chat_rate_limit_hit(text)') IS NOT NULL AS rate_limit_ok,
  pg_get_functiondef('public.request_appointment(text,text,text,int,text,text,public.patient_type,public.consultation_type,text,date,time)'::regprocedure)
    LIKE '%ALREADY_BOOKED%' AS regla_dni_ok;
