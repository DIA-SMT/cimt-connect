-- ============================================================
-- CIMT Connect — Portal: pedidos de turno
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 18, 19 y 20.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo agrega; no modifica tablas existentes):
--   1. portal_appt_requests: un adulto con acceso a los turnos de una persona
--      (titular, representante legal o autorizado) pide un turno desde el
--      portal: para qué es, qué días y en qué horario les queda bien, si es en
--      el centro o por videollamada y un comentario corto (opcional). No elige
--      día ni hora: el equipo lo agenda en la Agenda (y lo enlaza al pedido),
--      avisa que la va a llamar o lo rechaza con un motivo. El portal solo
--      muestra el estado del pedido.
--   2. portal_appt_request_events: constancia de cada paso (quién y cuándo).
--
-- Seguridad: como el resto del portal, las familias no leen ni escriben la
-- tabla (todo pasa por server/api/portal/* y server/api/portal-staff/* con la
-- service role key). El equipo del panel solo puede LEER. Nadie puede borrar
-- desde la app: el pedido queda como registro aunque se borre la cuenta.
-- ============================================================


-- ── 1. Pedidos de turno ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_appt_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  -- Si se borra la cuenta, el pedido queda (con el nombre de quién lo hizo)
  account_id         UUID        REFERENCES public.portal_accounts(id) ON DELETE SET NULL,
  link_kind          TEXT        NOT NULL CHECK (link_kind IN ('titular', 'representante_legal', 'autorizado')),
  requester_name     TEXT        NOT NULL,
  reason             TEXT        NOT NULL CHECK (reason IN ('continuar', 'consulta', 'otro')),
  -- Días que les quedan bien (el centro atiende de lunes a viernes)
  days               TEXT[]      NOT NULL
                     CHECK (cardinality(days) BETWEEN 1 AND 5
                            AND days <@ ARRAY['lun', 'mar', 'mie', 'jue', 'vie']::text[]),
  band               TEXT        NOT NULL CHECK (band IN ('manana', 'tarde', 'indistinto')),
  modality           TEXT        NOT NULL CHECK (modality IN ('presencial', 'telemedicina', 'indistinto')),
  -- Comentario de la familia: corto y sin datos de salud (eso se habla en el turno)
  note               TEXT        CHECK (note IS NULL OR length(note) <= 140),
  status             TEXT        NOT NULL DEFAULT 'pendiente'
                     CHECK (status IN ('pendiente', 'contactar', 'agendado', 'rechazado', 'cancelado')),
  -- El turno que dio el equipo (si lo enlazó). Si se borra el turno, el pedido queda
  appointment_id     UUID        REFERENCES public.appointments(id) ON DELETE SET NULL,
  scheduled_at       TIMESTAMPTZ,
  scheduled_by_email TEXT,
  contacted_at       TIMESTAMPTZ,
  contacted_by_email TEXT,
  rejected_at        TIMESTAMPTZ,
  rejected_by_email  TEXT,
  -- bloqueo: lo cierra el servidor al cargar un bloqueo por orden judicial
  reject_reason      TEXT        CHECK (reject_reason IN ('ya_tiene_turnos', 'otro', 'bloqueo')),
  cancelled_at       TIMESTAMPTZ,
  -- Notas internas del equipo: nunca se muestran en el portal
  staff_notes        TEXT        CHECK (staff_notes IS NULL OR length(staff_notes) <= 500),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT portal_appt_requests_rejected_check
    CHECK (status <> 'rechazado' OR reject_reason IS NOT NULL)
);

-- Un solo pedido abierto por persona (lo haya pedido el adulto que sea)
CREATE UNIQUE INDEX IF NOT EXISTS portal_appt_requests_open_uniq
  ON public.portal_appt_requests (patient_id)
  WHERE status IN ('pendiente', 'contactar');

CREATE INDEX IF NOT EXISTS portal_appt_requests_status_idx  ON public.portal_appt_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_appt_requests_account_idx ON public.portal_appt_requests (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_appt_requests_patient_idx ON public.portal_appt_requests (patient_id, created_at DESC);

-- Constancia de cada paso (quién y cuándo): solo se agregan filas.
-- by_email vacío = lo hizo la familia desde el portal.
CREATE TABLE IF NOT EXISTS public.portal_appt_request_events (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID        NOT NULL REFERENCES public.portal_appt_requests(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL
             CHECK (kind IN ('pedido', 'contactar', 'agendado', 'pendiente', 'rechazado', 'cancelado', 'nota')),
  by_email   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_appt_request_events_req_idx ON public.portal_appt_request_events (request_id, created_at);


-- ── 2. Seguridad (RLS) ─────────────────────────────────────────
ALTER TABLE public.portal_appt_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_appt_request_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.portal_appt_requests, public.portal_appt_request_events FROM anon;

DROP POLICY IF EXISTS "Staff view portal appt requests" ON public.portal_appt_requests;
DROP POLICY IF EXISTS "Staff view portal appt events"   ON public.portal_appt_request_events;
CREATE POLICY "Staff view portal appt requests" ON public.portal_appt_requests
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff view portal appt events"   ON public.portal_appt_request_events
  FOR SELECT TO authenticated USING (public.is_admin());


-- ── Verificación rápida (tiene que dar true) ───────────────────
-- Las dos tablas existen con RLS, cada una con su policy, y las únicas
-- policies exigen ser del equipo y solo permiten leer
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity
      AND c.relname IN ('portal_appt_requests', 'portal_appt_request_events')) = 2
  AND (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('portal_appt_requests', 'portal_appt_request_events')) = 2
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename IN ('portal_appt_requests', 'portal_appt_request_events')
                    AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT ILIKE '%is_admin()%'))
  AND EXISTS (SELECT 1 FROM pg_indexes
              WHERE schemaname = 'public' AND indexname = 'portal_appt_requests_open_uniq')
  AS portal_pedidos_turno_ok;
