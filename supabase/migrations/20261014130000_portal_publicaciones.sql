-- ============================================================
-- CIMT Connect — Portal: "Mi información" (etapa C)
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes el script 22.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo agrega; no modifica datos existentes):
--   portal_publications: lo que el profesional publica en el portal para el
--   paciente o su familia, en lenguaje claro: el resumen ("Qué trabajamos",
--   cómo lo trabajamos, cómo acompañar en casa) y los informes en una versión
--   para la familia. Cada publicación es una copia congelada, con versión,
--   autor y matrícula. No se edita ni se borra: para corregir algo se retira
--   (con motivo) y se publica una versión nueva.
--
-- Seguridad: las familias no leen la tabla (todo pasa por el servidor). El
-- equipo del panel la puede LEER solo si es profesional o Dirección. Publicar
-- y retirar lo hace solo el servidor. Nadie puede borrar.
-- ============================================================


CREATE TABLE IF NOT EXISTS public.portal_publications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  kind               TEXT        NOT NULL CHECK (kind IN ('resumen', 'informe')),
  title              TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  -- Texto plano por secciones (lo arma el servidor; nunca HTML)
  body               JSONB       NOT NULL,
  body_sha256        TEXT        NOT NULL,
  -- Informe de la ficha del que sale (solo kind = 'informe')
  source_report_id   UUID        REFERENCES public.patient_reports(id) ON DELETE RESTRICT,
  version            INT         NOT NULL CHECK (version >= 1),
  supersedes_id      UUID        REFERENCES public.portal_publications(id),
  -- Quién lo escribió: el profesional (con matrícula) o la Dirección
  professional_id    UUID        REFERENCES public.professionals(id) ON DELETE RESTRICT,
  author_label       TEXT        NOT NULL,
  includes_diagnosis BOOLEAN     NOT NULL DEFAULT false,
  discussed_ack      BOOLEAN     NOT NULL DEFAULT false, -- "Ya lo conversé en consulta"
  adolescent_ack     BOOLEAN     NOT NULL DEFAULT false, -- "Lo conversé con …" (13 a 17 años)
  -- Si el texto tenía frases sobre fluidez y el profesional eligió "Lo dejo así": por qué
  review_note        TEXT        CHECK (review_note IS NULL OR length(review_note) <= 200),
  published_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by_email TEXT        NOT NULL,
  withdrawn_at       TIMESTAMPTZ,
  withdrawn_by_email TEXT,
  withdraw_reason    TEXT        CHECK (withdraw_reason IN ('reemplazada', 'error', 'pedido_familia', 'otro')),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_by_email IS NULL)),
  CHECK ((withdrawn_at IS NULL) = (withdraw_reason IS NULL)),
  CHECK (NOT includes_diagnosis OR discussed_ack),
  CHECK ((kind = 'informe') = (source_report_id IS NOT NULL))
);

-- Una sola versión vigente del resumen por paciente, y de cada informe
CREATE UNIQUE INDEX IF NOT EXISTS portal_publications_live_summary
  ON public.portal_publications (patient_id) WHERE kind = 'resumen' AND withdrawn_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS portal_publications_live_report
  ON public.portal_publications (source_report_id) WHERE kind = 'informe' AND withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS portal_publications_patient_idx
  ON public.portal_publications (patient_id, published_at DESC);

-- Lo publicado no se cambia: solo se puede retirar
CREATE OR REPLACE FUNCTION public.portal_publications_frozen()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: lo publicado no se borra, se retira';
  END IF;
  IF OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: ya estaba retirado';
  END IF;
  IF (to_jsonb(NEW) - 'withdrawn_at' - 'withdrawn_by_email' - 'withdraw_reason')
     IS DISTINCT FROM (to_jsonb(OLD) - 'withdrawn_at' - 'withdrawn_by_email' - 'withdraw_reason') THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: lo publicado no se edita; retiralo y publicá una versión nueva';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portal_publications_frozen ON public.portal_publications;
CREATE TRIGGER portal_publications_frozen
  BEFORE UPDATE OR DELETE ON public.portal_publications
  FOR EACH ROW EXECUTE FUNCTION public.portal_publications_frozen();

-- Publicar una versión nueva: retira la vigente y guarda la nueva en un solo
-- paso (si algo falla, queda la anterior). p_expected es la versión vigente
-- que tenía el profesional en pantalla (NULL si no había ninguna): si otra
-- persona publicó mientras tanto, no se pisa. Solo la usa el servidor.
CREATE OR REPLACE FUNCTION public.portal_publish(
  p_patient UUID, p_kind TEXT, p_source_report UUID, p_expected UUID,
  p_title TEXT, p_body JSONB, p_body_sha256 TEXT,
  p_professional UUID, p_author_label TEXT, p_includes_diagnosis BOOLEAN, p_adolescent_ack BOOLEAN,
  p_review_note TEXT, p_email TEXT
)
RETURNS UUID
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_live    UUID;
  v_version INT;
  v_id      UUID;
BEGIN
  -- De a una publicación por paciente a la vez
  PERFORM pg_advisory_xact_lock(hashtext('portal_publish:' || p_patient::text));

  SELECT id INTO v_live FROM public.portal_publications
   WHERE patient_id = p_patient AND kind = p_kind AND withdrawn_at IS NULL
     AND (p_kind = 'resumen' OR source_report_id = p_source_report);
  IF v_live IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'PUBLISH_CONFLICT: otra persona publicó una versión nueva';
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version FROM public.portal_publications
   WHERE patient_id = p_patient AND kind = p_kind
     AND (p_kind = 'resumen' OR source_report_id = p_source_report);

  IF v_live IS NOT NULL THEN
    UPDATE public.portal_publications
       SET withdrawn_at = now(), withdrawn_by_email = p_email, withdraw_reason = 'reemplazada'
     WHERE id = v_live;
  END IF;

  INSERT INTO public.portal_publications (
    patient_id, kind, title, body, body_sha256, source_report_id, version, supersedes_id,
    professional_id, author_label, includes_diagnosis, discussed_ack, adolescent_ack, review_note, published_by_email
  ) VALUES (
    p_patient, p_kind, p_title, p_body, p_body_sha256, p_source_report, v_version, v_live,
    p_professional, p_author_label, p_includes_diagnosis, true, p_adolescent_ack, p_review_note, p_email
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_publish(UUID, TEXT, UUID, UUID, TEXT, JSONB, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_publish(UUID, TEXT, UUID, UUID, TEXT, JSONB, TEXT, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT)
  TO service_role;


-- ── Seguridad (RLS) ────────────────────────────────────────────
ALTER TABLE public.portal_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_publications FROM anon;

DROP POLICY IF EXISTS "Clinical view portal publications" ON public.portal_publications;
CREATE POLICY "Clinical view portal publications" ON public.portal_publications
  FOR SELECT TO authenticated USING (public.is_clinical());


-- ── Verificación rápida (tiene que dar true) ───────────────────
SELECT
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'portal_publications' AND c.relrowsecurity)
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'portal_publications'
                    AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT ILIKE '%is_clinical()%'))
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'portal_publications_frozen' AND NOT tgisinternal)
  AND (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('portal_publications_live_summary', 'portal_publications_live_report')) = 2
  -- Publicar: solo el servidor
  AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'portal_publish' AND pronamespace = 'public'::regnamespace)
  AND NOT has_function_privilege('anon',
        'public.portal_publish(uuid, text, uuid, uuid, text, jsonb, text, uuid, text, boolean, boolean, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
        'public.portal_publish(uuid, text, uuid, uuid, text, jsonb, text, uuid, text, boolean, boolean, text, text)', 'EXECUTE')
  AS portal_publicaciones_ok;
