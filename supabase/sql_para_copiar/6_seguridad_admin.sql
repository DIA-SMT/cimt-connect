-- ============================================================
-- CIMT Connect — Seguridad: panel admin con login + RLS cerrado
-- Correlo en Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace:
--   1. Crea la tabla admins (qué usuarios de Supabase Auth pueden entrar al panel)
--   2. Cierra patients y appointments: solo los admins pueden leer/modificar
--   3. Expone dos funciones públicas para el sitio:
--        - get_booked_slots(): horarios ocupados (sin datos personales)
--        - request_appointment(): pedir un turno (valida y guarda)
--
-- Después de correrlo, crear el/los usuario/s admin (ver al final).
-- ============================================================


-- ── 1. Admins ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admins (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Cada usuario puede ver solo su propia fila (para saber si es admin)
DROP POLICY IF EXISTS "Users can view own admin row" ON public.admins;
CREATE POLICY "Users can view own admin row"
  ON public.admins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;


-- ── 2. Cerrar patients y appointments ─────────────────────────

-- Borrar las policies públicas del MVP
DROP POLICY IF EXISTS "Public can view patients"       ON public.patients;
DROP POLICY IF EXISTS "Public can create patients"     ON public.patients;
DROP POLICY IF EXISTS "Public can update patients"     ON public.patients;
DROP POLICY IF EXISTS "Public can view appointments"   ON public.appointments;
DROP POLICY IF EXISTS "Public can create appointments" ON public.appointments;
DROP POLICY IF EXISTS "Public can update appointments" ON public.appointments;

-- Solo admins
DROP POLICY IF EXISTS "Admins manage patients" ON public.patients;
CREATE POLICY "Admins manage patients"
  ON public.patients FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage appointments" ON public.appointments;
CREATE POLICY "Admins manage appointments"
  ON public.appointments FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- professionals: la lectura pública sigue; solo admins modifican
DROP POLICY IF EXISTS "Admins manage professionals" ON public.professionals;
CREATE POLICY "Admins manage professionals"
  ON public.professionals FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());


-- ── 3a. Horarios ocupados (público, sin datos personales) ─────

CREATE OR REPLACE FUNCTION public.get_booked_slots(p_start DATE, p_end DATE)
RETURNS TABLE (
  appointment_date DATE,
  appointment_time TIME,
  status           public.appointment_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.appointment_date, a.appointment_time, a.status
  FROM public.appointments a
  WHERE a.appointment_date BETWEEN p_start AND p_end
    AND a.status <> 'cancelado'
    AND p_end - p_start <= 62;  -- como mucho ~2 meses por consulta
$$;

REVOKE ALL ON FUNCTION public.get_booked_slots(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booked_slots(DATE, DATE) TO anon, authenticated;


-- ── 3b. Pedir turno (público) ─────────────────────────────────
--    Valida los datos, crea o actualiza el paciente por DNI y
--    guarda el turno como 'pendiente'. Devuelve el id del turno.
--    Los errores empiezan con un código (SLOT_TAKEN, INVALID_...)
--    para que el front muestre un mensaje claro.

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


-- ============================================================
-- CREAR USUARIO ADMIN (hacerlo una vez por cada persona)
--
--   1. Supabase → Authentication → Users → "Add user" → "Create new user"
--      Poner email + contraseña y tildar "Auto Confirm User".
--   2. Correr esto reemplazando el email:
--
--      INSERT INTO public.admins (user_id)
--      SELECT id FROM auth.users WHERE email = 'persona@smt.gob.ar'
--      ON CONFLICT DO NOTHING;
--
-- Recomendado: Authentication → Sign In / Providers → desactivar
-- "Allow new users to sign up" (igual, sin estar en admins no ven nada).
-- ============================================================


-- ── Verificación rápida ────────────────────────────────────────
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
