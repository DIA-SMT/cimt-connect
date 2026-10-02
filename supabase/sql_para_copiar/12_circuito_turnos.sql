-- ============================================================
-- CIMT Connect — Fase 2: nuevo circuito de turnos
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 6 a 11.
-- Es idempotente: se puede correr varias veces.
--
-- IMPORTANTE: correlo ANTES de publicar el código nuevo. El código que está
-- publicado hoy sigue funcionando con este script (no se borra nada).
--
-- Qué hace (relevamiento, respuestas 1–3, 5–10, 25, 33, 34):
--   1. Solicitudes de ingreso: el sitio ya no reserva horarios; la familia
--      deja sus datos y el centro la contacta (taller → turnos por teléfono).
--   2. Talleres informativos para familias (fecha, lugar, asistencia).
--   3. Agenda por profesional: duración según profesional (30/40 min), varios
--      profesionales a la vez, sin superposición para el mismo profesional.
--   4. Asistencia: presente / ausente / justificado. "Presente" registra la
--      práctica con número correlativo y fecha.
--   5. Bloqueos de agenda (fumigación, paro, actividad de terreno).
-- ============================================================


-- ── 1. Solicitudes de ingreso ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.intake_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name         TEXT        NOT NULL,
  last_name          TEXT        NOT NULL,
  dni                TEXT        NOT NULL,
  age                INT         NOT NULL,
  patient_type       public.patient_type NOT NULL,
  phone              TEXT        NOT NULL,
  email              TEXT,
  guardian_name      TEXT,       -- adulto responsable (menores)
  locality           TEXT,
  preferred_modality TEXT        NOT NULL DEFAULT 'presencial'
                                 CHECK (preferred_modality IN ('presencial', 'telemedicina')),
  referred_by        TEXT,       -- quién lo deriva (escuela, pediatra...)
  reason             TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'nueva'
                                 CHECK (status IN ('nueva', 'contactada', 'taller', 'admitida', 'no_corresponde')),
  workshop_id        UUID,       -- FK más abajo (la tabla se crea después)
  workshop_attended  BOOLEAN,
  patient_id         UUID        REFERENCES public.patients(id) ON DELETE SET NULL,
  notes              TEXT,       -- notas internas
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_intake_status ON public.intake_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_intake_dni    ON public.intake_requests(dni);

DROP TRIGGER IF EXISTS intake_requests_updated_at ON public.intake_requests;
CREATE TRIGGER intake_requests_updated_at
  BEFORE UPDATE ON public.intake_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 2. Talleres informativos para familias ────────────────────

CREATE TABLE IF NOT EXISTS public.workshops (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workshop_date DATE        NOT NULL,
  start_time    TIME        NOT NULL DEFAULT '09:00',
  place         TEXT        NOT NULL DEFAULT 'Catamarca 411',
  capacity      INT,
  notes         TEXT,
  canceled      BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.intake_requests ADD CONSTRAINT intake_requests_workshop_fkey
    FOREIGN KEY (workshop_id) REFERENCES public.workshops(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Para mostrar en el sitio cuándo es el próximo taller (sin datos personales)
CREATE OR REPLACE FUNCTION public.get_upcoming_workshops()
RETURNS TABLE (workshop_date DATE, start_time TIME, place TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT w.workshop_date, w.start_time, w.place
  FROM public.workshops w
  WHERE NOT w.canceled
    AND w.workshop_date >= (now() AT TIME ZONE 'America/Argentina/Tucuman')::DATE
  ORDER BY w.workshop_date, w.start_time
  LIMIT 3;
$$;

REVOKE ALL ON FUNCTION public.get_upcoming_workshops() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_upcoming_workshops() TO anon, authenticated;


-- ── 3. Agenda por profesional ─────────────────────────────────

-- Duración de la sesión según el profesional (respuesta 1: fono, psicoped. y
-- TO 30 min; psicología 40 min). Se puede cambiar en el panel (Equipo).
ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS session_minutes INT NOT NULL DEFAULT 30;

UPDATE public.professionals SET session_minutes = 40
WHERE specialty ILIKE 'psicolog%' AND session_minutes = 30;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS duration_minutes       INT  NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS attendance             TEXT,
  ADD COLUMN IF NOT EXISTS practice_number        BIGINT,
  ADD COLUMN IF NOT EXISTS practice_registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_email       TEXT DEFAULT (auth.jwt() ->> 'email');

DO $$ BEGIN
  ALTER TABLE public.appointments ADD CONSTRAINT appointments_attendance_check
    CHECK (attendance IN ('presente', 'ausente', 'justificado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_practice_number_key
  ON public.appointments(practice_number) WHERE practice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_pro_date
  ON public.appointments(professional_id, appointment_date);

-- La nota de la sesión (registro diario) queda vinculada al turno
ALTER TABLE public.patient_followups
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL;


-- ── 4. Bloqueos de agenda ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.schedule_blocks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  block_date       DATE        NOT NULL,
  start_time       TIME,       -- NULL = día completo
  end_time         TIME,
  professional_id  UUID        REFERENCES public.professionals(id) ON DELETE CASCADE, -- NULL = todo el centro
  reason           TEXT        NOT NULL,
  active           BOOLEAN     NOT NULL DEFAULT true,
  created_by_email TEXT        DEFAULT (auth.jwt() ->> 'email'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CHECK (start_time IS NULL OR start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_blocks_date ON public.schedule_blocks(block_date) WHERE active;


-- ── 5. Reglas de la agenda (trigger) ──────────────────────────
--    - Mismo profesional, mismo día: los turnos no se pueden superponer.
--    - No se puede agendar dentro de un bloqueo activo.
--    - Al marcar "presente" se registra la práctica (número + fecha).

CREATE SEQUENCE IF NOT EXISTS public.practice_number_seq START 1;

CREATE OR REPLACE FUNCTION public.appointments_agenda_rules()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_start TIME := NEW.appointment_time;
  v_end   TIME := NEW.appointment_time + make_interval(mins => NEW.duration_minutes);
  v_reason TEXT;
BEGIN
  -- Registro de la práctica al marcar presente (una sola vez por turno)
  IF NEW.attendance = 'presente' AND NEW.practice_number IS NULL THEN
    NEW.practice_number := nextval('public.practice_number_seq');
    NEW.practice_registered_at := now();
  END IF;

  -- Las reglas de agenda solo aplican a turnos vigentes con profesional,
  -- y solo cuando cambia algo de la agenda (no al marcar asistencia)
  IF NEW.status = 'cancelado' OR NEW.professional_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.appointment_date IS NOT DISTINCT FROM OLD.appointment_date
     AND NEW.appointment_time IS NOT DISTINCT FROM OLD.appointment_time
     AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
     AND NEW.professional_id  IS NOT DISTINCT FROM OLD.professional_id
     AND NEW.status           IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id <> NEW.id
      AND a.professional_id = NEW.professional_id
      AND a.appointment_date = NEW.appointment_date
      AND a.status <> 'cancelado'
      AND a.appointment_time < v_end
      AND (a.appointment_time + make_interval(mins => a.duration_minutes)) > v_start
  ) THEN
    RAISE EXCEPTION 'OVERLAP: El profesional ya tiene un turno en ese horario';
  END IF;

  SELECT b.reason INTO v_reason
  FROM public.schedule_blocks b
  WHERE b.active
    AND b.block_date = NEW.appointment_date
    AND (b.professional_id IS NULL OR b.professional_id = NEW.professional_id)
    AND (b.start_time IS NULL OR (b.start_time < v_end AND b.end_time > v_start))
  LIMIT 1;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED: Ese horario está bloqueado (%)', v_reason;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS appointments_agenda_rules ON public.appointments;
CREATE TRIGGER appointments_agenda_rules
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_agenda_rules();


-- ── 6. Solicitud de ingreso desde el sitio (público) ──────────
--    Valida los datos y evita duplicados: una solicitud abierta por DNI.

CREATE OR REPLACE FUNCTION public.submit_intake_request(
  p_first_name         TEXT,
  p_last_name          TEXT,
  p_dni                TEXT,
  p_age                INT,
  p_patient_type       public.patient_type,
  p_phone              TEXT,
  p_email              TEXT,
  p_guardian_name      TEXT,
  p_locality           TEXT,
  p_preferred_modality TEXT,
  p_referred_by        TEXT,
  p_reason             TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  p_first_name    := btrim(p_first_name);
  p_last_name     := btrim(p_last_name);
  p_dni           := btrim(p_dni);
  p_phone         := btrim(p_phone);
  p_email         := NULLIF(btrim(coalesce(p_email, '')), '');
  p_guardian_name := NULLIF(btrim(coalesce(p_guardian_name, '')), '');
  p_locality      := NULLIF(btrim(coalesce(p_locality, '')), '');
  p_referred_by   := NULLIF(btrim(coalesce(p_referred_by, '')), '');
  p_reason        := btrim(p_reason);
  p_preferred_modality := coalesce(NULLIF(btrim(p_preferred_modality), ''), 'presencial');

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
  IF p_patient_type <> 'adulto' AND p_guardian_name IS NULL THEN
    RAISE EXCEPTION 'INVALID_GUARDIAN: Indicá el nombre del adulto responsable';
  END IF;
  IF length(coalesce(p_guardian_name, '')) > 80 OR length(coalesce(p_locality, '')) > 80
     OR length(coalesce(p_referred_by, '')) > 120 THEN
    RAISE EXCEPTION 'INVALID_DATA: Algún dato es demasiado largo';
  END IF;
  IF p_preferred_modality NOT IN ('presencial', 'telemedicina') THEN
    RAISE EXCEPTION 'INVALID_MODALITY: Modalidad inválida';
  END IF;
  IF length(p_reason) NOT BETWEEN 5 AND 800 THEN
    RAISE EXCEPTION 'INVALID_REASON: Contanos brevemente el motivo de la consulta';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cimt_intake_' || p_dni));
  IF EXISTS (
    SELECT 1 FROM public.intake_requests
    WHERE dni = p_dni AND status IN ('nueva', 'contactada', 'taller')
  ) THEN
    RAISE EXCEPTION 'ALREADY_REQUESTED: Ya tenemos una solicitud en curso con ese DNI. El equipo se va a comunicar al teléfono que dejaste.';
  END IF;

  INSERT INTO public.intake_requests (
    first_name, last_name, dni, age, patient_type, phone, email, guardian_name,
    locality, preferred_modality, referred_by, reason
  ) VALUES (
    p_first_name, p_last_name, p_dni, p_age, p_patient_type, p_phone, p_email, p_guardian_name,
    p_locality, p_preferred_modality, p_referred_by, p_reason
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated;


-- ── 7. Permisos: todo el panel (incluida Administración) ──────
--    Solicitudes, talleres y bloqueos son tareas administrativas.

ALTER TABLE public.intake_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workshops       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view intake"   ON public.intake_requests;
DROP POLICY IF EXISTS "Staff insert intake" ON public.intake_requests;
DROP POLICY IF EXISTS "Staff update intake" ON public.intake_requests;
CREATE POLICY "Staff view intake"   ON public.intake_requests FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff insert intake" ON public.intake_requests FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff update intake" ON public.intake_requests FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff view workshops"   ON public.workshops;
DROP POLICY IF EXISTS "Staff insert workshops" ON public.workshops;
DROP POLICY IF EXISTS "Staff update workshops" ON public.workshops;
CREATE POLICY "Staff view workshops"   ON public.workshops FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff insert workshops" ON public.workshops FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff update workshops" ON public.workshops FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Staff view blocks"   ON public.schedule_blocks;
DROP POLICY IF EXISTS "Staff insert blocks" ON public.schedule_blocks;
DROP POLICY IF EXISTS "Staff update blocks" ON public.schedule_blocks;
CREATE POLICY "Staff view blocks"   ON public.schedule_blocks FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff insert blocks" ON public.schedule_blocks FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff update blocks" ON public.schedule_blocks FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Historial de cambios también para las solicitudes
DROP TRIGGER IF EXISTS audit_intake ON public.intake_requests;
CREATE TRIGGER audit_intake AFTER INSERT OR UPDATE ON public.intake_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


-- ── Verificación rápida ────────────────────────────────────────
SELECT
  to_regclass('public.intake_requests') IS NOT NULL                        AS solicitudes_ok,
  to_regclass('public.workshops') IS NOT NULL                              AS talleres_ok,
  to_regclass('public.schedule_blocks') IS NOT NULL                        AS bloqueos_ok,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'appointments' AND column_name = 'practice_number') AS asistencia_ok,
  to_regprocedure('public.submit_intake_request(text,text,text,int,public.patient_type,text,text,text,text,text,text,text)')
    IS NOT NULL                                                            AS formulario_ok;
