-- ============================================================
-- 21 · DOMICILIO EN LA SOLICITUD DE TURNO
-- ============================================================
-- El formulario "Solicitar turno" del sitio pide ahora el domicilio
-- (calle y número) además de la localidad. Se guarda en la solicitud
-- y, al admitirla, pasa al campo Domicilio de la ficha del paciente.
--
-- Orden: se puede correr antes o después de publicar el código nuevo.
-- El dato nuevo va al final y es opcional para la base (DEFAULT NULL),
-- así el formulario que está publicado ahora sigue funcionando hasta
-- que se publique el nuevo, que lo pide como obligatorio.
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================

ALTER TABLE public.intake_requests
  ADD COLUMN IF NOT EXISTS address TEXT;

-- La función cambia de firma (un dato más): se borra la anterior
-- para que no queden dos versiones publicadas.
DROP FUNCTION IF EXISTS public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

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
  p_reason             TEXT,
  p_address            TEXT DEFAULT NULL
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
  p_address       := NULLIF(btrim(coalesce(p_address, '')), '');
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
  IF p_address IS NOT NULL AND length(p_address) NOT BETWEEN 5 AND 150 THEN
    RAISE EXCEPTION 'INVALID_ADDRESS: Revisá el domicilio (calle y número)';
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
    locality, address, preferred_modality, referred_by, reason
  ) VALUES (
    p_first_name, p_last_name, p_dni, p_age, p_patient_type, p_phone, p_email, p_guardian_name,
    p_locality, p_address, p_preferred_modality, p_referred_by, p_reason
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_intake_request(
  TEXT, TEXT, TEXT, INT, public.patient_type, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon, authenticated;


-- ── Verificación (las tres tienen que dar true) ───────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'intake_requests'
            AND column_name = 'address')                                   AS columna_ok,
  to_regprocedure('public.submit_intake_request(text,text,text,int,public.patient_type,text,text,text,text,text,text,text,text)')
    IS NOT NULL                                                            AS formulario_ok,
  to_regprocedure('public.submit_intake_request(text,text,text,int,public.patient_type,text,text,text,text,text,text,text)')
    IS NULL                                                                AS version_vieja_borrada;
