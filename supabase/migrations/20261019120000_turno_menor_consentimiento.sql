-- ============================================================
-- 28 · SOLICITUD DE TURNO: ADULTO RESPONSABLE Y CONSENTIMIENTO
-- ============================================================
-- Si la persona que se va a atender es menor de 18 años, el turno lo
-- pide su adulto responsable (madre, padre, tutor/a legal u otro adulto
-- a cargo): primero carga sus datos (nombre, DNI y vínculo), después los
-- del paciente, y da el consentimiento informado. Se guarda la fecha y
-- la versión del texto aceptado.
--
-- También se guarda la provincia: el CIMT recibe consultas de todo el
-- país, no solo de Tucumán.
--
-- Orden: correrlo JUSTO ANTES de publicar el código nuevo. Mientras
-- tanto, el formulario publicado sigue andando para adultos; si alguien
-- pide un turno para un menor con la página vieja, le aparece «actualizá
-- la página» y, al recargar, ya ve los campos nuevos.
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================

ALTER TABLE public.intake_requests
  ADD COLUMN IF NOT EXISTS province              TEXT,
  ADD COLUMN IF NOT EXISTS guardian_dni          TEXT,
  ADD COLUMN IF NOT EXISTS guardian_relationship TEXT,
  ADD COLUMN IF NOT EXISTS guardian_consent_at   TIMESTAMPTZ,  -- cuándo dio el consentimiento
  ADD COLUMN IF NOT EXISTS consent_version       TEXT;         -- qué texto aceptó (está en el código)

DO $$ BEGIN
  ALTER TABLE public.intake_requests ADD CONSTRAINT intake_requests_guardian_relationship_check
    CHECK (guardian_relationship IN ('madre', 'padre', 'tutor', 'otro'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- La función cambia de firma (cinco datos más): se borra la anterior
-- para que no queden dos versiones publicadas.
DROP FUNCTION IF EXISTS public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
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
  p_consent_version       TEXT    DEFAULT NULL
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
    province, guardian_dni, guardian_relationship, guardian_consent_at, consent_version
  ) VALUES (
    p_first_name, p_last_name, p_dni, p_age, p_patient_type, p_phone, p_email, p_guardian_name,
    p_locality, p_address, p_preferred_modality, p_referred_by, p_reason,
    p_province, p_guardian_dni, p_guardian_relationship,
    CASE WHEN v_minor THEN now() END, p_consent_version
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO anon, authenticated;


-- ── Verificación (las tres tienen que dar true) ───────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'intake_requests'
      AND column_name IN ('province', 'guardian_dni', 'guardian_relationship',
                          'guardian_consent_at', 'consent_version')) = 5          AS columnas_ok,
  to_regprocedure('public.submit_intake_request(text,text,text,int,public.patient_type,text,text,text,text,text,text,text,text,text,text,text,boolean,text)')
    IS NOT NULL                                                                    AS formulario_ok,
  to_regprocedure('public.submit_intake_request(text,text,text,int,public.patient_type,text,text,text,text,text,text,text,text)')
    IS NULL                                                                        AS version_vieja_borrada;
