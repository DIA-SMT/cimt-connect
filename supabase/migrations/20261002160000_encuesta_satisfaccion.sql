-- ============================================================
-- CIMT Connect — Fase 5: encuesta de satisfacción
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 6 a 12.
-- Es idempotente: se puede correr varias veces.
--
-- IMPORTANTE: correlo ANTES de publicar el código nuevo.
--
-- Qué hace (relevamiento, respuesta 39: "satisfacción del paciente" y
-- "calidad de atención"):
--   - Tabla satisfaction_surveys: respuestas ANÓNIMAS (sin nombre ni DNI).
--   - Función pública submit_satisfaction_survey() para la página /encuesta.
--   - Solo el panel puede leer las respuestas.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.satisfaction_surveys (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  respondent           TEXT        NOT NULL CHECK (respondent IN ('paciente', 'familiar')),
  rating_attention     INT         NOT NULL CHECK (rating_attention BETWEEN 1 AND 5),     -- calidad de la atención
  rating_communication INT         NOT NULL CHECK (rating_communication BETWEEN 1 AND 5), -- claridad de las explicaciones
  rating_treatment     INT         NOT NULL CHECK (rating_treatment BETWEEN 1 AND 5),     -- trato del equipo
  rating_overall       INT         NOT NULL CHECK (rating_overall BETWEEN 1 AND 5),       -- satisfacción general
  would_recommend      BOOLEAN     NOT NULL,
  comment              TEXT        CHECK (length(comment) <= 600),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surveys_created ON public.satisfaction_surveys(created_at);

ALTER TABLE public.satisfaction_surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view surveys" ON public.satisfaction_surveys;
CREATE POLICY "Staff view surveys" ON public.satisfaction_surveys
  FOR SELECT TO authenticated USING (public.is_admin());

-- Envío desde el sitio. Sin datos personales; el comentario se recorta.
CREATE OR REPLACE FUNCTION public.submit_satisfaction_survey(
  p_respondent           TEXT,
  p_rating_attention     INT,
  p_rating_communication INT,
  p_rating_treatment     INT,
  p_rating_overall       INT,
  p_would_recommend      BOOLEAN,
  p_comment              TEXT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_respondent NOT IN ('paciente', 'familiar') THEN
    RAISE EXCEPTION 'INVALID_DATA: Indicá quién responde';
  END IF;
  IF p_rating_attention NOT BETWEEN 1 AND 5 OR p_rating_communication NOT BETWEEN 1 AND 5
     OR p_rating_treatment NOT BETWEEN 1 AND 5 OR p_rating_overall NOT BETWEEN 1 AND 5
     OR p_would_recommend IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATA: Respondé todas las preguntas';
  END IF;

  INSERT INTO public.satisfaction_surveys (
    respondent, rating_attention, rating_communication, rating_treatment, rating_overall, would_recommend, comment
  ) VALUES (
    p_respondent, p_rating_attention, p_rating_communication, p_rating_treatment, p_rating_overall, p_would_recommend,
    left(NULLIF(btrim(coalesce(p_comment, '')), ''), 600)
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_satisfaction_survey(TEXT, INT, INT, INT, INT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_satisfaction_survey(TEXT, INT, INT, INT, INT, BOOLEAN, TEXT) TO anon, authenticated;


-- ── Verificación rápida ────────────────────────────────────────
SELECT
  to_regclass('public.satisfaction_surveys') IS NOT NULL AS encuesta_ok,
  to_regprocedure('public.submit_satisfaction_survey(text,int,int,int,int,boolean,text)') IS NOT NULL AS formulario_ok;
