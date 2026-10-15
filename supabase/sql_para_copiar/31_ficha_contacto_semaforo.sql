-- ============================================================
-- 31 · FICHA: INGRESO, ANTECEDENTES, SEMÁFORO Y CONTACTO
-- ============================================================
-- 1. Fecha de ingreso del paciente (editable). Las fichas que ya existen
--    toman la fecha en que se crearon; las nuevas, la de hoy.
--
-- 2. "Otros antecedentes" (además de los de tartamudez). Es un dato
--    clínico: solo lo cambian Profesional y Dirección.
--
-- 3. Semáforo de autonomía: si quien gestiona los turnos (el paciente o
--    su adulto responsable) lee, escribe y usa el celular.
--      verde    = puede gestionar sus turnos solo (portal, mensajes)
--      amarillo = necesita ayuda (audios, confirmar por llamada)
--      rojo     = no maneja lectoescritura ni celular: llamada o en persona
--
-- 4. Tipo de teléfono, para saber cómo contactar:
--      whatsapp = celular con WhatsApp (mensajes y audios)
--      celular  = celular sin WhatsApp (llamadas y SMS)
--      fijo     = teléfono fijo (solo llamadas)
--    En la ficha (teléfono del paciente y del adulto responsable), en
--    cada adulto responsable y en la solicitud de turno del sitio.
--
-- 5. Adultos responsables: uno puede marcarse "principal cuidador" y otro
--    "2do responsable" (uno de cada uno por paciente).
--
-- 6. Historial de cambios con nombre y rol: una función que devuelve el
--    nombre y el rol de cada usuario del panel (solo para el equipo).
--
-- Orden: correrlo ANTES de publicar el código nuevo. La solicitud de
-- turno publicada sigue andando mientras tanto (el dato nuevo es opcional
-- para la base).
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================

-- ── 1 a 4. Ficha del paciente ─────────────────────────────────
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS admission_date      DATE,
  ADD COLUMN IF NOT EXISTS other_history       TEXT,
  ADD COLUMN IF NOT EXISTS autonomy            TEXT,
  ADD COLUMN IF NOT EXISTS phone_kind          TEXT,
  ADD COLUMN IF NOT EXISTS guardian_phone_kind TEXT;

UPDATE public.patients
SET admission_date = (created_at AT TIME ZONE 'America/Argentina/Tucuman')::DATE
WHERE admission_date IS NULL;

ALTER TABLE public.patients
  ALTER COLUMN admission_date SET DEFAULT ((now() AT TIME ZONE 'America/Argentina/Tucuman')::DATE);

DO $$ BEGIN
  ALTER TABLE public.patients ADD CONSTRAINT patients_autonomy_check
    CHECK (autonomy IN ('verde', 'amarillo', 'rojo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.patients ADD CONSTRAINT patients_phone_kind_check
    CHECK (phone_kind IN ('whatsapp', 'celular', 'fijo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.patients ADD CONSTRAINT patients_guardian_phone_kind_check
    CHECK (guardian_phone_kind IN ('whatsapp', 'celular', 'fijo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Datos clínicos solo para Profesional / Dirección (se suma other_history;
-- el resto es igual que en 15_ficha_completa.sql)
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
    OR NEW.other_history             IS DISTINCT FROM OLD.other_history
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


-- ── 4 y 5. Adultos responsables ───────────────────────────────
ALTER TABLE public.patient_guardians
  ADD COLUMN IF NOT EXISTS caregiver_role TEXT,   -- principal / segundo
  ADD COLUMN IF NOT EXISTS phone_kind     TEXT;

DO $$ BEGIN
  ALTER TABLE public.patient_guardians ADD CONSTRAINT patient_guardians_caregiver_role_check
    CHECK (caregiver_role IN ('principal', 'segundo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.patient_guardians ADD CONSTRAINT patient_guardians_phone_kind_check
    CHECK (phone_kind IN ('whatsapp', 'celular', 'fijo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un principal cuidador y un 2do responsable por paciente (entre los activos)
CREATE UNIQUE INDEX IF NOT EXISTS uq_guardians_caregiver_role
  ON public.patient_guardians(patient_id, caregiver_role)
  WHERE active AND caregiver_role IS NOT NULL;


-- ── 4. Tipo de teléfono en la solicitud de turno ──────────────
ALTER TABLE public.intake_requests
  ADD COLUMN IF NOT EXISTS phone_kind TEXT;

DO $$ BEGIN
  ALTER TABLE public.intake_requests ADD CONSTRAINT intake_requests_phone_kind_check
    CHECK (phone_kind IN ('whatsapp', 'celular', 'fijo'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- La función cambia de firma (un dato más): se borra la anterior.
-- Todo lo demás es igual que en 28_turno_menor_consentimiento.sql.
DROP FUNCTION IF EXISTS public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, BOOLEAN, TEXT
);

CREATE OR REPLACE FUNCTION public.submit_intake_request(
  p_first_name            TEXT,
  p_last_name             TEXT,
  p_dni                   TEXT,
  p_age                   INT,
  p_patient_type          public.patient_type,
  p_phone                 TEXT,
  p_email                 TEXT,
  p_guardian_name         TEXT,
  p_locality              TEXT,
  p_preferred_modality    TEXT,
  p_referred_by           TEXT,
  p_reason                TEXT,
  p_address               TEXT    DEFAULT NULL,
  p_province              TEXT    DEFAULT NULL,
  p_guardian_dni          TEXT    DEFAULT NULL,
  p_guardian_relationship TEXT    DEFAULT NULL,
  p_guardian_consent      BOOLEAN DEFAULT NULL,
  p_consent_version       TEXT    DEFAULT NULL,
  p_phone_kind            TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id    UUID;
  v_minor BOOLEAN;
BEGIN
  p_first_name    := btrim(p_first_name);
  p_last_name     := btrim(p_last_name);
  p_dni           := btrim(p_dni);
  p_phone         := btrim(p_phone);
  p_email         := NULLIF(btrim(coalesce(p_email, '')), '');
  p_guardian_name := NULLIF(btrim(coalesce(p_guardian_name, '')), '');
  p_locality      := NULLIF(btrim(coalesce(p_locality, '')), '');
  p_address       := NULLIF(btrim(coalesce(p_address, '')), '');
  p_province      := NULLIF(btrim(coalesce(p_province, '')), '');
  p_guardian_dni  := NULLIF(btrim(coalesce(p_guardian_dni, '')), '');
  p_guardian_relationship := NULLIF(btrim(coalesce(p_guardian_relationship, '')), '');
  p_consent_version := NULLIF(btrim(coalesce(p_consent_version, '')), '');
  p_phone_kind    := NULLIF(btrim(coalesce(p_phone_kind, '')), '');
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
  IF p_phone_kind IS NOT NULL AND p_phone_kind NOT IN ('whatsapp', 'celular', 'fijo') THEN
    RAISE EXCEPTION 'INVALID_PHONE: Indicá qué tipo de teléfono es';
  END IF;
  IF p_email IS NOT NULL AND (length(p_email) > 120 OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'INVALID_EMAIL: Email inválido';
  END IF;
  IF length(coalesce(p_locality, '')) > 80 OR length(coalesce(p_referred_by, '')) > 120 THEN
    RAISE EXCEPTION 'INVALID_DATA: Algún dato es demasiado largo';
  END IF;
  IF p_address IS NOT NULL AND length(p_address) NOT BETWEEN 5 AND 150 THEN
    RAISE EXCEPTION 'INVALID_ADDRESS: Revisá el domicilio (calle y número)';
  END IF;
  -- Misma lista que PROVINCES en src/lib/center.ts
  IF p_province IS NOT NULL AND p_province NOT IN (
    'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Ciudad Autónoma de Buenos Aires', 'Córdoba',
    'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones',
    'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe',
    'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'
  ) THEN
    RAISE EXCEPTION 'INVALID_PROVINCE: Elegí la provincia';
  END IF;
  IF p_preferred_modality NOT IN ('presencial', 'telemedicina') THEN
    RAISE EXCEPTION 'INVALID_MODALITY: Modalidad inválida';
  END IF;
  IF length(p_reason) NOT BETWEEN 5 AND 800 THEN
    RAISE EXCEPTION 'INVALID_REASON: Contanos brevemente el motivo de la consulta';
  END IF;

  -- Menor de 18: lo pide el adulto responsable, con su DNI, el vínculo y
  -- el consentimiento informado. A un adulto no se le guardan esos datos.
  v_minor := p_age < 18 OR p_patient_type <> 'adulto';
  IF v_minor THEN
    IF p_patient_type = 'adulto' THEN
      RAISE EXCEPTION 'INVALID_AGE: Si la persona tiene menos de 18 años, el turno lo pide su adulto responsable';
    END IF;
    IF p_guardian_name IS NULL OR length(p_guardian_name) NOT BETWEEN 3 AND 80
       OR p_guardian_relationship IS NULL OR p_guardian_relationship NOT IN ('madre', 'padre', 'tutor', 'otro') THEN
      RAISE EXCEPTION 'INVALID_GUARDIAN: Completá los datos del adulto responsable (si no ves esos campos, actualizá la página)';
    END IF;
    IF p_guardian_dni IS NULL OR p_guardian_dni !~ '^\d{6,10}$' THEN
      RAISE EXCEPTION 'INVALID_GUARDIAN_DNI: DNI del adulto responsable inválido';
    END IF;
    IF p_guardian_dni = p_dni THEN
      RAISE EXCEPTION 'INVALID_GUARDIAN_DNI: El DNI del adulto responsable tiene que ser distinto del de la persona que se va a atender';
    END IF;
    IF p_guardian_consent IS NOT TRUE OR p_consent_version IS NULL OR length(p_consent_version) > 40 THEN
      RAISE EXCEPTION 'INVALID_CONSENT: Para pedir un turno para un menor, el adulto responsable tiene que dar su consentimiento informado';
    END IF;
  ELSE
    p_guardian_name := NULL;
    p_guardian_dni := NULL;
    p_guardian_relationship := NULL;
    p_consent_version := NULL;
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
    locality, address, preferred_modality, referred_by, reason,
    province, guardian_dni, guardian_relationship, guardian_consent_at, consent_version, phone_kind
  ) VALUES (
    p_first_name, p_last_name, p_dni, p_age, p_patient_type, p_phone, p_email, p_guardian_name,
    p_locality, p_address, p_preferred_modality, p_referred_by, p_reason,
    p_province, p_guardian_dni, p_guardian_relationship,
    CASE WHEN v_minor THEN now() END, p_consent_version, p_phone_kind
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT
) TO anon, authenticated;


-- ── 6. Nombre y rol de cada usuario del panel (historial) ──────
-- Incluye a los usuarios dados de baja: sus cambios siguen en el historial.
-- El nombre sale del profesional vinculado o, si no tiene, del usuario.
CREATE OR REPLACE FUNCTION public.staff_directory()
RETURNS TABLE (email TEXT, full_name TEXT, role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.email,
         coalesce(p.name, NULLIF(btrim(a.full_name), '')),
         a.role
  FROM public.admins a
  LEFT JOIN public.professionals p ON p.user_id = a.user_id
  WHERE public.is_admin() AND a.email IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.staff_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_directory() TO authenticated;


-- ── Verificación (las cinco tienen que dar true) ──────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patients'
      AND column_name IN ('admission_date', 'other_history', 'autonomy', 'phone_kind', 'guardian_phone_kind')) = 5
                                                                                            AS ficha_ok,
  NOT EXISTS (SELECT 1 FROM public.patients WHERE admission_date IS NULL)                   AS ingresos_ok,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patient_guardians'
      AND column_name IN ('caregiver_role', 'phone_kind')) = 2                              AS responsables_ok,
  to_regprocedure('public.submit_intake_request(text,text,text,int,public.patient_type,text,text,text,text,text,text,text,text,text,text,text,boolean,text,text)')
    IS NOT NULL                                                                             AS formulario_ok,
  to_regprocedure('public.staff_directory()') IS NOT NULL                                   AS historial_ok;
