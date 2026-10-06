-- ============================================================
-- CIMT Connect — Portal de familias (fase 1)
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 1 a 17.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo agrega; no modifica tablas existentes):
--   1. portal_accounts: una cuenta por adulto responsable (DNI), atada a un
--      usuario de Supabase Auth con app_metadata.kind = 'family'.
--   2. portal_links: qué chicos ve cada cuenta. El vínculo vale mientras la
--      fila del adulto en la ficha del chico siga activa y con el mismo DNI
--      (lo controla el servidor en cada pedido).
--   3. portal_invitations: códigos de invitación (se guarda solo un HMAC del
--      código, nunca el código).
--   4. portal_appointment_responses: "vamos a ir" / "no vamos a poder ir".
--   5. portal_login_attempts: límite de intentos de ingreso por DNI.
--
-- Seguridad: las familias NO leen ni escriben ninguna tabla. Todo pasa por
-- server/api/portal/* con la service role key. RLS está activado en todas
-- las tablas nuevas, sin policies para familias; el equipo del panel solo
-- puede LEER (para ver estados y avisos). Nadie puede borrar desde la app.
-- ============================================================


-- ── 1. Cuentas ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_accounts (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  dni                   TEXT        NOT NULL UNIQUE CHECK (dni ~ '^[0-9]{6,10}$'),
  first_name            TEXT        NOT NULL,
  last_name             TEXT        NOT NULL DEFAULT '',
  active                BOOLEAN     NOT NULL DEFAULT true,
  privacy_version       TEXT,
  privacy_accepted_at   TIMESTAMPTZ,
  verified_phone        TEXT,
  recovery_requested_at TIMESTAMPTZ,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 2. Vínculos cuenta ↔ chico ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_links (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID        NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  patient_id           UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  guardian_id          UUID        NOT NULL REFERENCES public.patient_guardians(id) ON DELETE CASCADE,
  relationship_kind    TEXT        NOT NULL CHECK (relationship_kind IN ('representante_legal', 'autorizado')),
  authorized_by        TEXT,
  adolescent_consent_at TIMESTAMPTZ, -- conformidad del chico de 16 o 17 años
  created_by_email     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at           TIMESTAMPTZ,
  revoked_by_email     TEXT,
  revoke_reason        TEXT
);

-- Un solo vínculo vigente por cuenta y chico
CREATE UNIQUE INDEX IF NOT EXISTS portal_links_active_uniq
  ON public.portal_links (account_id, patient_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS portal_links_patient_idx ON public.portal_links (patient_id);


-- ── 3. Invitaciones ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_invitations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash           TEXT        NOT NULL UNIQUE, -- HMAC-SHA256(PORTAL_CODE_PEPPER, código)
  dni                 TEXT        NOT NULL CHECK (dni ~ '^[0-9]{6,10}$'),
  purpose             TEXT        NOT NULL CHECK (purpose IN ('activacion', 'vincular', 'recuperacion')),
  first_name          TEXT        NOT NULL,
  last_name           TEXT        NOT NULL DEFAULT '',
  account_id          UUID        REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  -- [{ "patient_id": uuid, "guardian_id": uuid, "consent": bool }]
  children            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  relationship_kind   TEXT        CHECK (relationship_kind IN ('representante_legal', 'autorizado')),
  authorized_by       TEXT,
  phone               TEXT,
  in_person           BOOLEAN     NOT NULL DEFAULT false,
  channel             TEXT        CHECK (channel IN ('whatsapp', 'impresa')),
  identity_checked_on DATE,
  issued_by_email     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  failed_attempts     INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS portal_invitations_dni_idx ON public.portal_invitations (dni);


-- ── 4. Respuestas a turnos ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_appointment_responses (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id    UUID        NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  account_id        UUID        NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  kind              TEXT        NOT NULL CHECK (kind IN ('confirmo', 'no_puedo')),
  reason_code       TEXT        CHECK (reason_code IN ('salud', 'escuela', 'transporte', 'trabajo', 'otro')),
  reason_text       TEXT        CHECK (reason_text IS NULL OR length(reason_text) <= 140),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lo que resolvió el equipo cuando no fue cancelar ni justificar el turno
  outcome           TEXT        CHECK (outcome IN ('reprogramado', 'otro')),
  resolved_at       TIMESTAMPTZ,
  resolved_by_email TEXT,
  CHECK (kind = 'no_puedo' OR reason_code IS NULL)
);

CREATE INDEX IF NOT EXISTS portal_responses_appt_idx ON public.portal_appointment_responses (appointment_id, created_at DESC);


-- ── 5. Intentos de ingreso ─────────────────────────────────────
-- La clave es un hash del DNI (no se guarda el DNI de quien intenta)
CREATE TABLE IF NOT EXISTS public.portal_login_attempts (
  key          TEXT        PRIMARY KEY,
  count        INT         NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 6. Seguridad (RLS) ─────────────────────────────────────────
ALTER TABLE public.portal_accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_links                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_invitations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_appointment_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_login_attempts        ENABLE ROW LEVEL SECURITY;

-- El público no tiene nada que hacer acá
REVOKE ALL ON public.portal_accounts, public.portal_links, public.portal_invitations,
  public.portal_appointment_responses, public.portal_login_attempts FROM anon;

-- El equipo del panel puede leer (estados, invitaciones pendientes, avisos).
-- Las familias, aunque tengan sesión, no ven nada: no están en admins.
DROP POLICY IF EXISTS "Staff view portal accounts"  ON public.portal_accounts;
DROP POLICY IF EXISTS "Staff view portal links"     ON public.portal_links;
DROP POLICY IF EXISTS "Staff view portal invites"   ON public.portal_invitations;
DROP POLICY IF EXISTS "Staff view portal responses" ON public.portal_appointment_responses;
CREATE POLICY "Staff view portal accounts"  ON public.portal_accounts
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff view portal links"     ON public.portal_links
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff view portal invites"   ON public.portal_invitations
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff view portal responses" ON public.portal_appointment_responses
  FOR SELECT TO authenticated USING (public.is_admin());
-- portal_login_attempts: sin policies (solo el servidor)


-- ── Verificación rápida ────────────────────────────────────────
-- 1) Las 5 tablas existen con RLS activado (tiene que dar 5)
SELECT count(*) AS tablas_portal_con_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relrowsecurity
  AND c.relname IN ('portal_accounts', 'portal_links', 'portal_invitations',
                    'portal_appointment_responses', 'portal_login_attempts');

-- 2) Las funciones viejas siguen cerradas (script 17; tiene que dar true)
SELECT NOT EXISTS (
  SELECT 1 FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('request_appointment', 'get_booked_slots')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
) AS funciones_viejas_cerradas;

-- 3) Aviso: policies de tablas de pacientes que NO exigen ser del equipo.
--    Tiene que dar 0 filas: si aparece alguna, una familia con sesión
--    podría leer esa tabla. Revisala antes de abrir el portal.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('patients', 'appointments', 'patient_guardians', 'patient_referrals',
                    'patient_followups', 'patient_reports', 'clinical_forms', 'patient_files',
                    'intake_requests', 'audit_log', 'admins')
  AND ('authenticated' = ANY (roles) OR 'public' = ANY (roles))
  AND (coalesce(qual, '') || coalesce(with_check, '')) NOT ILIKE '%is_admin()%'
  AND (coalesce(qual, '') || coalesce(with_check, '')) NOT ILIKE '%is_clinical()%'
  AND (coalesce(qual, '') || coalesce(with_check, '')) NOT ILIKE '%is_director()%'
  AND (coalesce(qual, '') || coalesce(with_check, '')) NOT ILIKE '%auth.uid()%';
