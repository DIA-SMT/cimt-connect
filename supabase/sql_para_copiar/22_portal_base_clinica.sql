-- ============================================================
-- CIMT Connect — Portal: base segura para información de salud (etapa A)
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 18, 19 y 20.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo agrega; no modifica datos existentes):
--   1. patient_portal_settings: por paciente, si el portal muestra su
--      información y sus ejercicios (apagado al empezar), la conformidad del
--      adolescente (13 a 17 años) y la pausa por indicación profesional o
--      judicial.
--   2. portal_consents: constancia de lo que aceptó cada cuenta (aviso de
--      privacidad e "información de salud"), en el portal o en papel. Solo
--      se agregan filas.
--   3. portal_guardian_blocks: adultos bloqueados por orden judicial.
--   4. portal_links: verificación del vínculo en persona (DNI y, para
--      madre, padre o tutor/a, la documentación).
--   5. portal_step_up: "volvé a poner tu contraseña" antes de ver
--      información de salud o descargar algo.
--   6. portal_access_log: quién abrió qué (solo se agregan filas).
--   7. portal_verify_password(): el servidor confirma la contraseña sin
--      abrir una sesión nueva. Solo la puede usar el servidor.
--
-- Nada de esto muestra información clínica todavía: el portal la mantiene
-- apagada hasta que se prenda la etapa en el servidor.
--
-- Seguridad: como el resto del portal, las familias no leen ni escriben
-- estas tablas (todo pasa por el servidor con la service role key). El
-- equipo del panel solo puede LEER. Nadie puede borrar desde la app.
-- ============================================================


-- ── 1. Configuración del portal por paciente ───────────────────
CREATE TABLE IF NOT EXISTS public.patient_portal_settings (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                  UUID        NOT NULL UNIQUE REFERENCES public.patients(id) ON DELETE RESTRICT,
  info_enabled                BOOLEAN     NOT NULL DEFAULT false,
  practice_enabled            BOOLEAN     NOT NULL DEFAULT false,
  adolescent_agreed_on        DATE,
  adolescent_agreed_by_email  TEXT,
  adolescent_withdrawn_on     DATE,
  paused_at                   TIMESTAMPTZ,
  pause_reason                TEXT        CHECK (pause_reason IN ('indicacion_profesional', 'judicial')),
  updated_by_email            TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((paused_at IS NULL) = (pause_reason IS NULL))
);


-- ── 2. Consentimientos (solo se agregan filas) ─────────────────
CREATE TABLE IF NOT EXISTS public.portal_consents (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID        REFERENCES public.portal_accounts(id) ON DELETE SET NULL,
  kind              TEXT        NOT NULL CHECK (kind IN ('privacidad', 'informacion_clinica')),
  version           TEXT        NOT NULL,
  accepted          BOOLEAN     NOT NULL,
  channel           TEXT        NOT NULL CHECK (channel IN ('portal', 'papel', 'migracion')),
  -- Formulario firmado y escaneado en Adjuntos de la ficha (obligatorio en papel)
  evidence_file_id  UUID        REFERENCES public.patient_files(id) ON DELETE RESTRICT,
  recorded_by_email TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (channel <> 'papel' OR (evidence_file_id IS NOT NULL AND recorded_by_email IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS portal_consents_account_idx ON public.portal_consents (account_id, kind, created_at DESC);

-- Lo que cada cuenta ya aceptó al activarse (versión 1 o 2 del aviso)
INSERT INTO public.portal_consents (account_id, kind, version, accepted, channel, created_at)
SELECT a.id, 'privacidad', a.privacy_version, true, 'migracion', coalesce(a.privacy_accepted_at, a.created_at)
FROM public.portal_accounts a
WHERE a.privacy_version IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.portal_consents c WHERE c.account_id = a.id AND c.kind = 'privacidad');


-- ── 3. Bloqueos por orden judicial ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_guardian_blocks (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  guardian_id      UUID        REFERENCES public.patient_guardians(id) ON DELETE SET NULL,
  dni              TEXT        NOT NULL CHECK (dni ~ '^[0-9]{6,10}$'),
  reason           TEXT        NOT NULL CHECK (reason IN ('orden_judicial', 'otro')),
  created_by_email TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifted_at        TIMESTAMPTZ,
  lifted_by_email  TEXT,
  CHECK ((lifted_at IS NULL) = (lifted_by_email IS NULL))
);

-- Un solo bloqueo vigente por persona y paciente
CREATE UNIQUE INDEX IF NOT EXISTS portal_guardian_blocks_live_uniq
  ON public.portal_guardian_blocks (patient_id, dni) WHERE lifted_at IS NULL;


-- ── 4. Verificación del vínculo en persona ─────────────────────
ALTER TABLE public.portal_links ADD COLUMN IF NOT EXISTS verified_in_person_on DATE;
ALTER TABLE public.portal_links ADD COLUMN IF NOT EXISTS verified_by_email     TEXT;
-- Solo madre, padre o tutor/a: se vio la partida o el documento que lo acredita
ALTER TABLE public.portal_links ADD COLUMN IF NOT EXISTS parental_checked_on   DATE;


-- ── 5. "Volvé a poner tu contraseña" ───────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_step_up (
  session_id   UUID        PRIMARY KEY,          -- session_id del token de la familia
  account_id   UUID        NOT NULL REFERENCES public.portal_accounts(id) ON DELETE CASCADE,
  verified_at  TIMESTAMPTZ NOT NULL,
  last_info_at TIMESTAMPTZ
);


-- ── 6. Registro de accesos (solo se agregan filas) ─────────────
CREATE TABLE IF NOT EXISTS public.portal_access_log (
  id          BIGSERIAL   PRIMARY KEY,
  patient_id  UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  account_id  UUID        REFERENCES public.portal_accounts(id) ON DELETE SET NULL,
  staff_email TEXT,
  action      TEXT        NOT NULL,
  target_id   UUID,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_access_log_patient_idx ON public.portal_access_log (patient_id, at DESC);


-- ── 7. Confirmar la contraseña desde el servidor ───────────────
-- Compara con el hash de Supabase Auth (bcrypt) sin abrir una sesión nueva.
-- Solo la puede ejecutar el servidor (service_role).
CREATE OR REPLACE FUNCTION public.portal_verify_password(p_user UUID, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((
    SELECT u.encrypted_password IS NOT NULL AND u.encrypted_password <> ''
       AND u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
    FROM auth.users u WHERE u.id = p_user
  ), false);
$$;

REVOKE ALL ON FUNCTION public.portal_verify_password(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_verify_password(UUID, TEXT) TO service_role;


-- ── Seguridad (RLS) ────────────────────────────────────────────
ALTER TABLE public.patient_portal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_consents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_guardian_blocks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_step_up          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_access_log       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.patient_portal_settings, public.portal_consents, public.portal_guardian_blocks,
  public.portal_step_up, public.portal_access_log FROM anon;

-- El equipo del panel puede leer (portal_step_up: nadie, solo el servidor)
DROP POLICY IF EXISTS "Staff view portal settings" ON public.patient_portal_settings;
DROP POLICY IF EXISTS "Staff view portal consents" ON public.portal_consents;
DROP POLICY IF EXISTS "Staff view portal blocks"   ON public.portal_guardian_blocks;
DROP POLICY IF EXISTS "Staff view portal access"   ON public.portal_access_log;
CREATE POLICY "Staff view portal settings" ON public.patient_portal_settings
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff view portal consents" ON public.portal_consents
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff view portal blocks"   ON public.portal_guardian_blocks
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff view portal access"   ON public.portal_access_log
  FOR SELECT TO authenticated USING (public.is_admin());


-- ── Verificación rápida (tiene que dar true) ───────────────────
SELECT
  -- Las 5 tablas existen con RLS
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity
      AND c.relname IN ('patient_portal_settings', 'portal_consents', 'portal_guardian_blocks',
                        'portal_step_up', 'portal_access_log')) = 5
  -- Sus únicas policies son de lectura y exigen ser del equipo
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public'
                    AND tablename IN ('patient_portal_settings', 'portal_consents', 'portal_guardian_blocks',
                                      'portal_step_up', 'portal_access_log')
                    AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT ILIKE '%is_admin()%'))
  -- Los vínculos tienen las columnas de verificación
  AND (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'portal_links'
          AND column_name IN ('verified_in_person_on', 'verified_by_email', 'parental_checked_on')) = 3
  -- La función de contraseña existe y nadie más que el servidor la puede usar
  AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'portal_verify_password' AND pronamespace = 'public'::regnamespace)
  AND NOT has_function_privilege('anon', 'public.portal_verify_password(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.portal_verify_password(uuid, text)', 'EXECUTE')
  AS portal_base_clinica_ok;
