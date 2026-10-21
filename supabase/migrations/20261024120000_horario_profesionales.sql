-- ============================================================
-- 36 · HORARIO DE ATENCIÓN DE CADA PROFESIONAL
-- ============================================================
-- Cada profesional carga qué días atiende y en qué horario (hasta dos
-- franjas por día, de lunes a viernes, entre las 07:00 y las 18:00):
--   { "lun": [{"start": "08:00", "end": "12:00"}, {"start": "14:00", "end": "18:00"}],
--     "mie": [{"start": "08:00", "end": "12:00"}] }
-- Lo cambian el propio profesional («Mi perfil»), Administración y
-- Dirección (desde la agenda). La agenda pinta en gris las horas en que no
-- atiende y avisa si se da un turno fuera de horario, pero no lo impide
-- (sirve para excepciones). "Dar turno" desde el portal sugiere horarios
-- dentro de este horario.
--
-- Requiere el script 34 (usa my_professional_id()).
-- Orden: correlo ANTES de publicar el código nuevo.
-- Es idempotente: se puede correr varias veces.
-- ============================================================

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS weekly_hours JSONB;

-- Mismas reglas que hoursProblem() en src/lib/workHours.ts
CREATE OR REPLACE FUNCTION public.valid_weekly_hours(p JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
DECLARE
  k TEXT;
  r JSONB;
  v_start INT;
  v_end INT;
  v_prev_end INT;
BEGIN
  IF p IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k NOT IN ('lun', 'mar', 'mie', 'jue', 'vie') THEN RETURN false; END IF;
    IF jsonb_typeof(p -> k) <> 'array' OR jsonb_array_length(p -> k) > 2 THEN RETURN false; END IF;
    v_prev_end := NULL;
    FOR r IN SELECT x FROM jsonb_array_elements(p -> k) AS x
             ORDER BY x ->> 'start' LOOP
      IF coalesce(r ->> 'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
         OR coalesce(r ->> 'end', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN
        RETURN false;
      END IF;
      v_start := split_part(r ->> 'start', ':', 1)::int * 60 + split_part(r ->> 'start', ':', 2)::int;
      v_end   := split_part(r ->> 'end', ':', 1)::int * 60 + split_part(r ->> 'end', ':', 2)::int;
      IF v_start >= v_end OR v_start < 7 * 60 OR v_end > 18 * 60 THEN RETURN false; END IF;
      IF v_prev_end IS NOT NULL AND v_start < v_prev_end THEN RETURN false; END IF;
      v_prev_end := v_end;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE public.professionals DROP CONSTRAINT IF EXISTS professionals_weekly_hours_ok;
ALTER TABLE public.professionals
  ADD CONSTRAINT professionals_weekly_hours_ok CHECK (public.valid_weekly_hours(weekly_hours));

-- Cambiar el horario: el propio profesional, Administración o Dirección
CREATE OR REPLACE FUNCTION public.set_professional_hours(p_professional UUID, p_hours JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (public.is_director()
          OR coalesce(public.staff_role() = 'administracion', false)
          OR (p_professional IS NOT NULL AND p_professional = public.my_professional_id())) THEN
    RAISE EXCEPTION 'NOT_ALLOWED: Solo el profesional, Administración o Dirección pueden cambiar este horario';
  END IF;
  -- Un objeto vacío es "sin horario cargado"
  IF p_hours IS NOT NULL AND p_hours = '{}'::jsonb THEN p_hours := NULL; END IF;
  IF NOT public.valid_weekly_hours(p_hours) THEN
    RAISE EXCEPTION 'INVALID_HOURS: Revisá el horario: hasta dos franjas por día, de 07:00 a 18:00, sin superponerse';
  END IF;
  UPDATE public.professionals SET weekly_hours = p_hours WHERE id = p_professional;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: No encontramos a ese profesional';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_professional_hours(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_professional_hours(UUID, JSONB) TO authenticated;


-- ── Verificación (las tres tienen que dar true) ───────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'professionals' AND column_name = 'weekly_hours') AS columna_ok,
  public.valid_weekly_hours('{"lun": [{"start": "08:00", "end": "12:00"}, {"start": "14:00", "end": "18:00"}]}')
    AND NOT public.valid_weekly_hours('{"lun": [{"start": "12:00", "end": "08:00"}]}')            AS reglas_ok,
  to_regprocedure('public.set_professional_hours(uuid,jsonb)') IS NOT NULL                          AS funcion_ok;
