-- ============================================================
-- CIMT Connect — Fase 1: roles, equipo e historial de cambios
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 6 a 9.
-- Es idempotente: se puede correr varias veces.
--
-- IMPORTANTE: correlo ANTES de publicar el código nuevo.
--
-- Qué hace:
--   1. Roles de usuario: dirección, profesional, administración
--      (los usuarios que ya existen quedan como "dirección").
--   2. Profesionales: matrícula, activo, si se muestran en el sitio y a qué
--      usuario corresponden. La lectura pública pasa a una función que solo
--      devuelve los que la Dirección marca para el sitio.
--   3. Permisos por rol (relevamiento, respuestas 12 y 14):
--        - Todos los usuarios del panel ven todo.
--        - Administración: turnos, pacientes (datos de contacto), asistencia.
--        - Profesional y Dirección: además, datos clínicos, derivaciones,
--          informes y seguimiento.
--        - Dirección: además, profesionales y usuarios.
--        - NADIE borra: los registros se "anulan" (Ley 26.529, la historia
--          clínica se conserva).
--   4. Historial de cambios: quién cambió qué y cuándo (respuesta 15).
--   5. Fotos de los profesionales (almacenamiento público).
-- ============================================================


-- ── 1. Roles ──────────────────────────────────────────────────

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS role      TEXT    NOT NULL DEFAULT 'direccion',
  ADD COLUMN IF NOT EXISTS email     TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS active    BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE public.admins ADD CONSTRAINT admins_role_check
    CHECK (role IN ('direccion', 'profesional', 'administracion'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Los usuarios nuevos arrancan con el rol de menos permisos
ALTER TABLE public.admins ALTER COLUMN role SET DEFAULT 'administracion';

-- Completar el email de los usuarios existentes
UPDATE public.admins a SET email = u.email
FROM auth.users u
WHERE u.id = a.user_id AND a.email IS NULL;

-- Rol del usuario actual (NULL si no es del panel o está desactivado)
CREATE OR REPLACE FUNCTION public.staff_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT role FROM public.admins WHERE user_id = auth.uid() AND active;
$$;

-- Cualquier usuario activo del panel (lo usan las policies existentes)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admins WHERE user_id = auth.uid() AND active);
$$;

-- Profesional o Dirección: puede tocar datos clínicos
CREATE OR REPLACE FUNCTION public.is_clinical()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(public.staff_role() IN ('direccion', 'profesional'), false);
$$;

CREATE OR REPLACE FUNCTION public.is_director()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(public.staff_role() = 'direccion', false);
$$;

REVOKE ALL ON FUNCTION public.staff_role()  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_clinical() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_director() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_role()  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_clinical() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_director() TO anon, authenticated;

-- La Dirección ve y edita a todos los usuarios (rol, nombre, activo).
-- Crear usuarios nuevos lo hace el servidor (necesita la service role key).
DROP POLICY IF EXISTS "Directors view admins"   ON public.admins;
DROP POLICY IF EXISTS "Directors update admins" ON public.admins;
CREATE POLICY "Directors view admins"
  ON public.admins FOR SELECT TO authenticated USING (public.is_director());
CREATE POLICY "Directors update admins"
  ON public.admins FOR UPDATE TO authenticated
  USING (public.is_director()) WITH CHECK (public.is_director());

-- Nunca dejar el sistema sin ninguna Dirección activa
CREATE OR REPLACE FUNCTION public.admins_keep_one_director()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'direccion' AND OLD.active
     AND (TG_OP = 'DELETE' OR NEW.role <> 'direccion' OR NOT NEW.active)
     AND NOT EXISTS (
       SELECT 1 FROM public.admins
       WHERE role = 'direccion' AND active AND user_id <> OLD.user_id
     ) THEN
    RAISE EXCEPTION 'LAST_DIRECTOR: Tiene que quedar al menos un usuario de Dirección activo';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS admins_keep_one_director ON public.admins;
CREATE TRIGGER admins_keep_one_director
  BEFORE UPDATE OR DELETE ON public.admins
  FOR EACH ROW EXECUTE FUNCTION public.admins_keep_one_director();


-- ── 2. Profesionales ──────────────────────────────────────────

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS license      TEXT,                          -- matrícula (MP)
  ADD COLUMN IF NOT EXISTS active       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_on_site BOOLEAN NOT NULL DEFAULT false, -- la Dirección decide quién aparece
  ADD COLUMN IF NOT EXISTS user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.professionals ALTER COLUMN days        DROP NOT NULL;
ALTER TABLE public.professionals ALTER COLUMN description DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS professionals_user_id_key
  ON public.professionals(user_id) WHERE user_id IS NOT NULL;

-- Equipo para el sitio público: solo nombre, especialidad, descripción y foto,
-- y solo de quienes la Dirección marcó (relevamiento 42: nada privado del personal)
CREATE OR REPLACE FUNCTION public.get_public_team()
RETURNS TABLE (name TEXT, specialty TEXT, description TEXT, photo_url TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.name, p.specialty, p.description, p.photo_url
  FROM public.professionals p
  WHERE p.active AND p.show_on_site
  ORDER BY p.specialty, p.name;
$$;

REVOKE ALL ON FUNCTION public.get_public_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_team() TO anon, authenticated;


-- ── 3. Permisos por rol (sin DELETE para nadie) ───────────────

-- professionals: el público ya no lee la tabla (usa get_public_team)
DROP POLICY IF EXISTS "Public can view professionals" ON public.professionals;
DROP POLICY IF EXISTS "Admins manage professionals"   ON public.professionals;
DROP POLICY IF EXISTS "Staff view professionals"      ON public.professionals;
DROP POLICY IF EXISTS "Directors insert professionals" ON public.professionals;
DROP POLICY IF EXISTS "Directors update professionals" ON public.professionals;
CREATE POLICY "Staff view professionals"
  ON public.professionals FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Directors insert professionals"
  ON public.professionals FOR INSERT TO authenticated WITH CHECK (public.is_director());
CREATE POLICY "Directors update professionals"
  ON public.professionals FOR UPDATE TO authenticated
  USING (public.is_director()) WITH CHECK (public.is_director());

-- patients y appointments: todo el panel lee, crea y modifica
-- (los datos clínicos del paciente los protege un trigger, más abajo)
DROP POLICY IF EXISTS "Admins manage patients"     ON public.patients;
DROP POLICY IF EXISTS "Staff view patients"        ON public.patients;
DROP POLICY IF EXISTS "Staff insert patients"      ON public.patients;
DROP POLICY IF EXISTS "Staff update patients"      ON public.patients;
CREATE POLICY "Staff view patients"   ON public.patients FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff insert patients" ON public.patients FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff update patients" ON public.patients FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage appointments" ON public.appointments;
DROP POLICY IF EXISTS "Staff view appointments"    ON public.appointments;
DROP POLICY IF EXISTS "Staff insert appointments"  ON public.appointments;
DROP POLICY IF EXISTS "Staff update appointments"  ON public.appointments;
CREATE POLICY "Staff view appointments"   ON public.appointments FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Staff insert appointments" ON public.appointments FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Staff update appointments" ON public.appointments FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Derivaciones, seguimiento e informes: todo el panel lee; escriben
-- solo Profesional y Dirección. Se agregan columnas para "anular".
ALTER TABLE public.patient_referrals
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by TEXT,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE public.patient_followups
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by TEXT,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE public.patient_reports
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by TEXT,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

DROP POLICY IF EXISTS "Admins manage referrals"     ON public.patient_referrals;
DROP POLICY IF EXISTS "Staff view referrals"        ON public.patient_referrals;
DROP POLICY IF EXISTS "Clinical insert referrals"   ON public.patient_referrals;
DROP POLICY IF EXISTS "Clinical update referrals"   ON public.patient_referrals;
CREATE POLICY "Staff view referrals"      ON public.patient_referrals FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Clinical insert referrals" ON public.patient_referrals FOR INSERT TO authenticated WITH CHECK (public.is_clinical());
CREATE POLICY "Clinical update referrals" ON public.patient_referrals FOR UPDATE TO authenticated
  USING (public.is_clinical()) WITH CHECK (public.is_clinical());

DROP POLICY IF EXISTS "Admins manage followups"     ON public.patient_followups;
DROP POLICY IF EXISTS "Staff view followups"        ON public.patient_followups;
DROP POLICY IF EXISTS "Clinical insert followups"   ON public.patient_followups;
DROP POLICY IF EXISTS "Clinical update followups"   ON public.patient_followups;
CREATE POLICY "Staff view followups"      ON public.patient_followups FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Clinical insert followups" ON public.patient_followups FOR INSERT TO authenticated WITH CHECK (public.is_clinical());
CREATE POLICY "Clinical update followups" ON public.patient_followups FOR UPDATE TO authenticated
  USING (public.is_clinical()) WITH CHECK (public.is_clinical());

DROP POLICY IF EXISTS "Admins manage reports"       ON public.patient_reports;
DROP POLICY IF EXISTS "Staff view reports"          ON public.patient_reports;
DROP POLICY IF EXISTS "Clinical insert reports"     ON public.patient_reports;
DROP POLICY IF EXISTS "Clinical update reports"     ON public.patient_reports;
CREATE POLICY "Staff view reports"        ON public.patient_reports FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Clinical insert reports"   ON public.patient_reports FOR INSERT TO authenticated WITH CHECK (public.is_clinical());
CREATE POLICY "Clinical update reports"   ON public.patient_reports FOR UPDATE TO authenticated
  USING (public.is_clinical()) WITH CHECK (public.is_clinical());

-- Administración puede editar contacto/filiación del paciente, no lo clínico
CREATE OR REPLACE FUNCTION public.patients_guard_clinical()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF public.staff_role() = 'administracion' AND (
       NEW.case_status      IS DISTINCT FROM OLD.case_status
    OR NEW.professional_id  IS DISTINCT FROM OLD.professional_id
    OR NEW.main_diagnosis   IS DISTINCT FROM OLD.main_diagnosis
    OR NEW.other_conditions IS DISTINCT FROM OLD.other_conditions
    OR NEW.therapy_modes    IS DISTINCT FROM OLD.therapy_modes
    OR NEW.cud_status       IS DISTINCT FROM OLD.cud_status
    OR NEW.is_medicated     IS DISTINCT FROM OLD.is_medicated
    OR NEW.medication       IS DISTINCT FROM OLD.medication
    OR NEW.notes            IS DISTINCT FROM OLD.notes
  ) THEN
    RAISE EXCEPTION 'CLINICAL_ONLY: Solo los profesionales pueden modificar los datos clínicos';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patients_guard_clinical ON public.patients;
CREATE TRIGGER patients_guard_clinical
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patients_guard_clinical();

-- Datos del usuario actual para el panel (rol, nombre y profesional vinculado)
CREATE OR REPLACE FUNCTION public.current_staff()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'role', a.role,
    'full_name', a.full_name,
    'email', a.email,
    'professional_id', (SELECT p.id FROM public.professionals p WHERE p.user_id = a.user_id LIMIT 1)
  )
  FROM public.admins a
  WHERE a.user_id = auth.uid() AND a.active;
$$;

REVOKE ALL ON FUNCTION public.current_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_staff() TO authenticated;


-- ── 4. Historial de cambios ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.audit_log (
  id               BIGSERIAL   PRIMARY KEY,
  table_name       TEXT        NOT NULL,
  record_id        UUID,
  patient_id       UUID,
  action           TEXT        NOT NULL,   -- insert / update
  changes          JSONB,                  -- update: {campo: [antes, después]}; insert: {campo: valor}
  changed_by       UUID,
  changed_by_email TEXT,                   -- NULL = solicitud online desde el sitio
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_patient ON public.audit_log(patient_id, changed_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Solo lectura para el panel; lo escribe únicamente el trigger
DROP POLICY IF EXISTS "Staff view audit" ON public.audit_log;
CREATE POLICY "Staff view audit" ON public.audit_log FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_new     JSONB := to_jsonb(NEW);
  v_old     JSONB;
  v_changes JSONB := '{}'::JSONB;
  k         TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    FOR k IN SELECT jsonb_object_keys(v_new) LOOP
      IF k NOT IN ('updated_at', 'created_at') AND (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN
        v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      END IF;
    END LOOP;
    IF v_changes = '{}'::JSONB THEN
      RETURN NEW;
    END IF;
  ELSE
    v_changes := v_new - 'id' - 'created_at' - 'updated_at';
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, patient_id, action, changes, changed_by, changed_by_email)
  VALUES (
    TG_TABLE_NAME,
    (v_new ->> 'id')::UUID,
    CASE WHEN TG_TABLE_NAME = 'patients' THEN (v_new ->> 'id')::UUID ELSE (v_new ->> 'patient_id')::UUID END,
    lower(TG_OP),
    v_changes,
    auth.uid(),
    auth.jwt() ->> 'email'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_patients     ON public.patients;
DROP TRIGGER IF EXISTS audit_appointments ON public.appointments;
DROP TRIGGER IF EXISTS audit_referrals    ON public.patient_referrals;
DROP TRIGGER IF EXISTS audit_followups    ON public.patient_followups;
DROP TRIGGER IF EXISTS audit_reports      ON public.patient_reports;
CREATE TRIGGER audit_patients     AFTER INSERT OR UPDATE ON public.patients          FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_appointments AFTER INSERT OR UPDATE ON public.appointments      FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_referrals    AFTER INSERT OR UPDATE ON public.patient_referrals FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_followups    AFTER INSERT OR UPDATE ON public.patient_followups FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER audit_reports      AFTER INSERT OR UPDATE ON public.patient_reports   FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();


-- ── 5. Fotos de los profesionales ─────────────────────────────
--    Bucket público (las fotos se muestran en el sitio); solo la Dirección sube.

INSERT INTO storage.buckets (id, name, public)
VALUES ('professional-photos', 'professional-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Directors upload professional photos" ON storage.objects;
DROP POLICY IF EXISTS "Directors update professional photos" ON storage.objects;
CREATE POLICY "Directors upload professional photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'professional-photos' AND public.is_director());
CREATE POLICY "Directors update professional photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'professional-photos' AND public.is_director());


-- ── Verificación rápida ────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.admins WHERE role = 'direccion' AND active) AS usuarios_direccion,
  to_regclass('public.audit_log') IS NOT NULL                             AS historial_ok,
  to_regprocedure('public.current_staff()') IS NOT NULL                    AS roles_ok,
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'professional-photos') AS fotos_ok;
