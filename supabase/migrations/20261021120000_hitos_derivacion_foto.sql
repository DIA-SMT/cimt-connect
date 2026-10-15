-- ============================================================
-- 30 · HITOS EN LA LANDING, DERIVACIÓN DE SOLICITUDES Y FOTO
-- ============================================================
-- 1. Foto de perfil en la ficha del paciente: se guarda en el bucket
--    privado patient-files (se ve con un link temporal) y la ficha
--    guarda la ruta.
--
-- 2. Derivación de solicitudes: Dirección elige qué profesional va a
--    atender cada solicitud de turno. Queda registrado quién derivó y
--    cuándo; al admitir, ese profesional pasa a la ficha. Solo Dirección
--    puede cambiarlo (lo controla la base, no solo la pantalla).
--
-- 3. Primer contacto: la base anota cuándo una solicitud deja de estar
--    "nueva" (el equipo la contactó). Con eso las estadísticas miden el
--    tiempo de respuesta (el compromiso son 48 hs).
--
-- 4. Hitos de la landing: Dirección prepara los números en el panel
--    (Estadísticas), los revisa y los publica. La landing muestra la
--    última publicación. Cada publicación queda guardada (no se borra);
--    para sacarlos de la landing se publica una "ocultar".
--
-- Orden: correrlo ANTES de publicar el código nuevo (la landing y el
-- panel leen las tablas y columnas nuevas).
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================

-- ── 1. Foto de perfil ─────────────────────────────────────────
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS photo_path TEXT;   -- ruta en el bucket patient-files


-- ── 2 y 3. Derivación y primer contacto ───────────────────────
ALTER TABLE public.intake_requests
  ADD COLUMN IF NOT EXISTS assigned_professional_id UUID REFERENCES public.professionals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by              TEXT,
  ADD COLUMN IF NOT EXISTS first_contact_at         TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.intake_requests_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_service BOOLEAN := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Las solicitudes llegan sin derivar; la fecha de contacto la pone la base
    IF NEW.assigned_professional_id IS NOT NULL AND NOT (public.is_director() OR v_service) THEN
      NEW.assigned_professional_id := NULL;
    END IF;
    NEW.assigned_at := CASE WHEN NEW.assigned_professional_id IS NOT NULL THEN now() END;
    NEW.assigned_by := CASE WHEN NEW.assigned_professional_id IS NOT NULL THEN auth.jwt() ->> 'email' END;
    NEW.first_contact_at := CASE WHEN NEW.status <> 'nueva' THEN now() END;
    RETURN NEW;
  END IF;

  -- Derivar: solo Dirección
  IF NEW.assigned_professional_id IS DISTINCT FROM OLD.assigned_professional_id THEN
    IF NOT (public.is_director() OR v_service) THEN
      RAISE EXCEPTION 'NOT_ALLOWED: Solo Dirección puede derivar solicitudes';
    END IF;
    NEW.assigned_at := CASE WHEN NEW.assigned_professional_id IS NOT NULL THEN now() END;
    NEW.assigned_by := CASE WHEN NEW.assigned_professional_id IS NOT NULL THEN auth.jwt() ->> 'email' END;
  ELSE
    NEW.assigned_at := OLD.assigned_at;
    NEW.assigned_by := OLD.assigned_by;
  END IF;

  -- Primer contacto: la primera vez que deja de estar "nueva"
  NEW.first_contact_at := coalesce(
    OLD.first_contact_at,
    CASE WHEN OLD.status = 'nueva' AND NEW.status <> 'nueva' THEN now() END
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.intake_requests_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS intake_requests_guard ON public.intake_requests;
CREATE TRIGGER intake_requests_guard
  BEFORE INSERT OR UPDATE ON public.intake_requests
  FOR EACH ROW EXECUTE FUNCTION public.intake_requests_guard();


-- ── 4. Hitos publicados en la landing ─────────────────────────
CREATE TABLE IF NOT EXISTS public.public_milestones (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  hidden          BOOLEAN     NOT NULL DEFAULT false,  -- true = la landing no muestra hitos
  patients_total  INT         CHECK (patients_total >= 0),
  patients_since  DATE,                                -- "desde mayo de 2025"
  response_hours  INT         CHECK (response_hours BETWEEN 1 AND 720),
  wait_days       INT         CHECK (wait_days BETWEEN 0 AND 3650),   -- espera hasta el primer turno
  waiting_list    INT         CHECK (waiting_list >= 0),              -- solicitudes en curso
  month           DATE,                                -- mes del análisis mensual (día 1)
  month_value     INT         CHECK (month_value >= 0),
  month_label     TEXT        CHECK (length(month_label) <= 80),      -- "consultas atendidas"
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by    TEXT        DEFAULT (auth.jwt() ->> 'email')
);

CREATE INDEX IF NOT EXISTS idx_public_milestones_published ON public.public_milestones(published_at DESC);

ALTER TABLE public.public_milestones ENABLE ROW LEVEL SECURITY;

-- Son números agregados, sin datos personales: los lee cualquiera.
-- Publica solo Dirección; no se editan ni se borran.
DROP POLICY IF EXISTS "Anyone reads milestones"     ON public.public_milestones;
DROP POLICY IF EXISTS "Directors publish milestones" ON public.public_milestones;
CREATE POLICY "Anyone reads milestones" ON public.public_milestones
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Directors publish milestones" ON public.public_milestones
  FOR INSERT TO authenticated WITH CHECK (public.is_director());

REVOKE ALL ON public.public_milestones FROM anon, authenticated;
GRANT SELECT ON public.public_milestones TO anon, authenticated;
GRANT INSERT ON public.public_milestones TO authenticated;


-- ── Verificación (las cuatro tienen que dar true) ─────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'patients' AND column_name = 'photo_path')   AS foto_ok,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'intake_requests'
      AND column_name IN ('assigned_professional_id', 'assigned_at', 'assigned_by', 'first_contact_at')) = 4
                                                                                                         AS derivacion_ok,
  EXISTS (SELECT 1 FROM pg_trigger
          WHERE tgname = 'intake_requests_guard' AND tgrelid = 'public.intake_requests'::regclass)   AS control_ok,
  to_regclass('public.public_milestones') IS NOT NULL                                                AS hitos_ok;
