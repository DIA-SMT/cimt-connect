-- ============================================================
-- CIMT Connect — Portal: pedidos de copia de la historia clínica
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 18 y 19.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo agrega; no modifica tablas existentes):
--   1. portal_hc_requests: el paciente adulto (titular) o su representante
--      legal piden desde el portal una copia de la historia clínica. El
--      equipo la prepara, avisa que está lista y registra a quién se la
--      entregó (en mano, con DNI). El portal solo muestra el estado.
--   2. portal_hc_request_events: constancia de cada paso (quién y cuándo).
--   3. Un índice para la bandeja del equipo (avisos de turnos recientes).
--
-- Seguridad: como el resto del portal, las familias no leen ni escriben la
-- tabla (todo pasa por server/api/portal/* y server/api/portal-staff/* con la
-- service role key). El equipo del panel solo puede LEER. Nadie puede borrar
-- desde la app: el pedido queda como registro aunque se borre la cuenta.
-- ============================================================


-- ── 1. Pedidos de copia de la historia clínica ─────────────────
CREATE TABLE IF NOT EXISTS public.portal_hc_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  -- Si se borra la cuenta, el pedido queda (con los datos de quién lo hizo)
  account_id         UUID        REFERENCES public.portal_accounts(id) ON DELETE SET NULL,
  link_kind          TEXT        NOT NULL CHECK (link_kind IN ('titular', 'representante_legal')),
  requester_name     TEXT        NOT NULL,
  requester_dni      TEXT        NOT NULL CHECK (requester_dni ~ '^[0-9]{6,10}$'),
  status             TEXT        NOT NULL DEFAULT 'pendiente'
                     CHECK (status IN ('pendiente', 'lista', 'entregada', 'rechazada', 'cancelada')),
  ready_at           TIMESTAMPTZ,
  ready_by_email     TEXT,
  delivered_at       TIMESTAMPTZ,
  delivered_by_email TEXT,
  delivered_to_name  TEXT,
  delivered_to_dni   TEXT        CHECK (delivered_to_dni IS NULL OR delivered_to_dni ~ '^[0-9]{6,10}$'),
  rejected_at        TIMESTAMPTZ,
  rejected_by_email  TEXT,
  reject_reason      TEXT        CHECK (reject_reason IN ('no_habilitado', 'duplicado', 'otro')),
  cancelled_at       TIMESTAMPTZ,
  -- Notas internas del equipo: nunca se muestran en el portal
  staff_notes        TEXT        CHECK (staff_notes IS NULL OR length(staff_notes) <= 500),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_hc_requests_delivered_check
    CHECK (status <> 'entregada' OR (delivered_at IS NOT NULL AND delivered_to_name IS NOT NULL AND delivered_to_dni IS NOT NULL)),
  CONSTRAINT portal_hc_requests_rejected_check
    CHECK (status <> 'rechazada' OR reject_reason IS NOT NULL)
);

-- Un solo pedido abierto por persona y paciente
CREATE UNIQUE INDEX IF NOT EXISTS portal_hc_requests_open_uniq
  ON public.portal_hc_requests (patient_id, requester_dni)
  WHERE status IN ('pendiente', 'lista');

CREATE INDEX IF NOT EXISTS portal_hc_requests_status_idx  ON public.portal_hc_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_hc_requests_account_idx ON public.portal_hc_requests (account_id, created_at DESC);

-- Constancia de cada paso (quién y cuándo): solo se agregan filas.
-- by_email vacío = lo hizo la familia desde el portal.
CREATE TABLE IF NOT EXISTS public.portal_hc_request_events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID        NOT NULL REFERENCES public.portal_hc_requests(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL CHECK (kind IN ('pedido', 'lista', 'pendiente', 'entregada', 'rechazada', 'cancelada', 'nota')),
  by_email   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_hc_request_events_req_idx ON public.portal_hc_request_events (request_id, created_at);


-- ── 2. Bandeja del equipo: avisos de turnos recientes ─────────
CREATE INDEX IF NOT EXISTS portal_responses_created_idx
  ON public.portal_appointment_responses (created_at DESC);


-- ── 3. Seguridad (RLS) ─────────────────────────────────────────
ALTER TABLE public.portal_hc_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_hc_request_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.portal_hc_requests, public.portal_hc_request_events FROM anon;

DROP POLICY IF EXISTS "Staff view portal hc requests" ON public.portal_hc_requests;
DROP POLICY IF EXISTS "Staff view portal hc events"   ON public.portal_hc_request_events;
CREATE POLICY "Staff view portal hc requests" ON public.portal_hc_requests
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff view portal hc events"   ON public.portal_hc_request_events
  FOR SELECT TO authenticated USING (public.is_admin());


-- ── Verificación rápida (tiene que dar true) ───────────────────
-- Las dos tablas existen con RLS y sus únicas policies exigen ser del equipo
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity
      AND c.relname IN ('portal_hc_requests', 'portal_hc_request_events')) = 2
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename IN ('portal_hc_requests', 'portal_hc_request_events')
                    AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT ILIKE '%is_admin()%'))
  AND EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public' AND indexname = 'portal_hc_requests_open_uniq')
  AS portal_pedidos_ok;
