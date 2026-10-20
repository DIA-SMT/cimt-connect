-- ============================================================
-- 34 · ROLES: ADMINISTRACIÓN DERIVA Y CADA PROFESIONAL VE LO SUYO
-- ============================================================
-- Cómo queda cada rol:
--   - Dirección: control total (se reserva para el equipo de sistemas).
--   - Administración: ve todo, recibe las solicitudes y las DERIVA al
--     profesional que elige (antes solo podía Dirección).
--   - Profesional: ve solo SUS pacientes y lo que cuelga de ellos (ficha,
--     adultos responsables, turnos, evaluaciones, informes, derivaciones,
--     seguimiento, adjuntos, historial y lo del portal), su agenda y las
--     solicitudes que le derivaron.
--
-- "Sus pacientes" = los que tiene a cargo en la ficha, los que tienen un
-- turno (no cancelado) con él y los de solicitudes que le derivaron.
-- Un paciente que atienden dos profesionales lo ven los dos.
--
-- Lo controla la base: aunque alguien se saltee la pantalla, no ve ni
-- cambia nada de pacientes ajenos. El servidor del portal (que usa la
-- clave de servicio) aplica la misma regla con is_my_patient_of().
--
-- Orden: correlo ANTES de publicar el código nuevo (el panel nuevo deja
-- derivar a Administración y eso lo tiene que permitir la base). El código
-- que está publicado hoy sigue andando con este script.
--
-- Es idempotente: se puede correr varias veces.
-- ============================================================


-- ── 1. Funciones de ayuda ─────────────────────────────────────

-- Profesional vinculado al usuario que está usando el panel (NULL si no hay)
CREATE OR REPLACE FUNCTION public.my_professional_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.id FROM public.professionals p
  JOIN public.admins a ON a.user_id = p.user_id
  WHERE a.user_id = auth.uid() AND a.active
  LIMIT 1;
$$;

-- Dirección y Administración ven a todos los pacientes
CREATE OR REPLACE FUNCTION public.sees_all_patients()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce(public.staff_role() IN ('direccion', 'administracion'), false);
$$;

-- ¿El paciente está vinculado a ese profesional por un turno o una solicitud?
-- (no mira la tabla patients, así sirve también al crear la ficha)
CREATE OR REPLACE FUNCTION public.patient_linked_to(p_patient UUID, p_professional UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_patient IS NOT NULL AND p_professional IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.appointments a
            WHERE a.patient_id = p_patient AND a.professional_id = p_professional
              AND a.status <> 'cancelado')
    OR EXISTS (SELECT 1 FROM public.intake_requests r
               WHERE r.patient_id = p_patient AND r.assigned_professional_id = p_professional)
  );
$$;

-- ¿Ese profesional ve a ese paciente? (lo usa también el servidor del portal)
CREATE OR REPLACE FUNCTION public.is_my_patient_of(p_patient UUID, p_professional UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_patient IS NOT NULL AND p_professional IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.patients p WHERE p.id = p_patient AND p.professional_id = p_professional)
    OR public.patient_linked_to(p_patient, p_professional)
  );
$$;

-- ¿La persona que usa el panel ve a este paciente?
CREATE OR REPLACE FUNCTION public.is_my_patient(p_patient UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.sees_all_patients()
      OR (public.staff_role() = 'profesional' AND public.is_my_patient_of(p_patient, public.my_professional_id()));
$$;

-- De una lista de pacientes, cuáles ve ese profesional (para el servidor del
-- portal: filtra la bandeja sin traer todos los turnos del profesional)
CREATE OR REPLACE FUNCTION public.patients_of_professional_among(p_professional UUID, p_patients UUID[])
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT DISTINCT x FROM unnest(p_patients) AS x WHERE public.is_my_patient_of(x, p_professional);
$$;

-- Convierte a UUID sin fallar (para las carpetas de los archivos)
CREATE OR REPLACE FUNCTION public.try_uuid(p TEXT)
RETURNS UUID
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT CASE WHEN p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p::uuid END;
$$;

REVOKE ALL ON FUNCTION public.my_professional_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sees_all_patients() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.patient_linked_to(UUID, UUID)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_patient_of(UUID, UUID)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_my_patient(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_professional_id()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.sees_all_patients()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.patient_linked_to(UUID, UUID)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_my_patient_of(UUID, UUID)    TO service_role;  -- la usan is_my_patient y el servidor
GRANT EXECUTE ON FUNCTION public.is_my_patient(UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.try_uuid(TEXT)                  TO authenticated;
-- Solo el servidor (clave de servicio): dice qué pacientes tiene cualquier profesional
REVOKE ALL ON FUNCTION public.patients_of_professional_among(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patients_of_professional_among(UUID, UUID[]) TO service_role;


-- ── 2. Derivar: Dirección y Administración ────────────────────
-- Misma función del script 30; cambia solo quién puede derivar.

CREATE OR REPLACE FUNCTION public.intake_requests_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_service BOOLEAN := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_can_assign BOOLEAN := public.is_director() OR coalesce(public.staff_role() = 'administracion', false) OR v_service;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Las solicitudes llegan sin derivar; la fecha de contacto la pone la base
    IF NEW.assigned_professional_id IS NOT NULL AND NOT v_can_assign THEN
      NEW.assigned_professional_id := NULL;
    END IF;
    NEW.assigned_at := CASE WHEN NEW.assigned_professional_id IS NOT NULL THEN now() END;
    NEW.assigned_by := CASE WHEN NEW.assigned_professional_id IS NOT NULL THEN auth.jwt() ->> 'email' END;
    NEW.first_contact_at := CASE WHEN NEW.status <> 'nueva' THEN now() END;
    RETURN NEW;
  END IF;

  -- Derivar: Dirección o Administración
  IF NEW.assigned_professional_id IS DISTINCT FROM OLD.assigned_professional_id THEN
    IF NOT v_can_assign THEN
      RAISE EXCEPTION 'NOT_ALLOWED: Solo Administración puede derivar solicitudes';
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


-- ── 3. Solicitudes: el profesional ve solo las que le derivaron ──

DROP POLICY IF EXISTS "Staff view intake"   ON public.intake_requests;
DROP POLICY IF EXISTS "Staff update intake" ON public.intake_requests;
CREATE POLICY "Staff view intake" ON public.intake_requests FOR SELECT TO authenticated
  USING (public.is_admin() AND ((SELECT public.sees_all_patients()) OR assigned_professional_id = (SELECT public.my_professional_id())));
CREATE POLICY "Staff update intake" ON public.intake_requests FOR UPDATE TO authenticated
  USING (public.is_admin() AND ((SELECT public.sees_all_patients()) OR assigned_professional_id = (SELECT public.my_professional_id())))
  WITH CHECK (public.is_admin() AND ((SELECT public.sees_all_patients()) OR assigned_professional_id = (SELECT public.my_professional_id())));


-- ── 4. Pacientes ──────────────────────────────────────────────

-- Si un profesional crea una ficha a mano, queda a su cargo (si no, no la vería)
CREATE OR REPLACE FUNCTION public.patients_default_professional()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.professional_id IS NULL AND public.staff_role() = 'profesional' THEN
    NEW.professional_id := (SELECT public.my_professional_id());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.patients_default_professional() FROM PUBLIC;
DROP TRIGGER IF EXISTS patients_default_professional ON public.patients;
CREATE TRIGGER patients_default_professional
  BEFORE INSERT ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.patients_default_professional();

-- La fila nueva se mira por sus propias columnas (al crearla todavía no existe)
DROP POLICY IF EXISTS "Staff view patients"   ON public.patients;
DROP POLICY IF EXISTS "Staff insert patients" ON public.patients;
DROP POLICY IF EXISTS "Staff update patients" ON public.patients;
CREATE POLICY "Staff view patients" ON public.patients FOR SELECT TO authenticated
  USING (public.is_admin() AND ((SELECT public.sees_all_patients())
         OR professional_id = (SELECT public.my_professional_id())
         OR public.patient_linked_to(id, (SELECT public.my_professional_id()))));
CREATE POLICY "Staff insert patients" ON public.patients FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND ((SELECT public.sees_all_patients()) OR professional_id = (SELECT public.my_professional_id())));
CREATE POLICY "Staff update patients" ON public.patients FOR UPDATE TO authenticated
  USING (public.is_admin() AND ((SELECT public.sees_all_patients())
         OR professional_id = (SELECT public.my_professional_id())
         OR public.patient_linked_to(id, (SELECT public.my_professional_id()))))
  WITH CHECK (public.is_admin() AND ((SELECT public.sees_all_patients())
         OR professional_id = (SELECT public.my_professional_id())
         OR public.patient_linked_to(id, (SELECT public.my_professional_id()))));


-- ── 5. Lo que cuelga de la ficha ──────────────────────────────

-- Adultos responsables y adjuntos: cualquier rol, solo de sus pacientes
DROP POLICY IF EXISTS "Staff view guardians"   ON public.patient_guardians;
DROP POLICY IF EXISTS "Staff insert guardians" ON public.patient_guardians;
DROP POLICY IF EXISTS "Staff update guardians" ON public.patient_guardians;
CREATE POLICY "Staff view guardians" ON public.patient_guardians FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_my_patient(patient_id));
CREATE POLICY "Staff insert guardians" ON public.patient_guardians FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND public.is_my_patient(patient_id));
CREATE POLICY "Staff update guardians" ON public.patient_guardians FOR UPDATE TO authenticated
  USING (public.is_admin() AND public.is_my_patient(patient_id))
  WITH CHECK (public.is_admin() AND public.is_my_patient(patient_id));

DROP POLICY IF EXISTS "Staff view files"   ON public.patient_files;
DROP POLICY IF EXISTS "Staff insert files" ON public.patient_files;
DROP POLICY IF EXISTS "Staff update files" ON public.patient_files;
CREATE POLICY "Staff view files" ON public.patient_files FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_my_patient(patient_id));
CREATE POLICY "Staff insert files" ON public.patient_files FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND public.is_my_patient(patient_id));
CREATE POLICY "Staff update files" ON public.patient_files FOR UPDATE TO authenticated
  USING (public.is_admin() AND public.is_my_patient(patient_id))
  WITH CHECK (public.is_admin() AND public.is_my_patient(patient_id));

-- Clínico: lo ven todos (de sus pacientes) y lo cargan profesionales y Dirección
DROP POLICY IF EXISTS "Staff view followups"     ON public.patient_followups;
DROP POLICY IF EXISTS "Clinical insert followups" ON public.patient_followups;
DROP POLICY IF EXISTS "Clinical update followups" ON public.patient_followups;
CREATE POLICY "Staff view followups" ON public.patient_followups FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_my_patient(patient_id));
CREATE POLICY "Clinical insert followups" ON public.patient_followups FOR INSERT TO authenticated
  WITH CHECK (public.is_clinical() AND public.is_my_patient(patient_id));
CREATE POLICY "Clinical update followups" ON public.patient_followups FOR UPDATE TO authenticated
  USING (public.is_clinical() AND public.is_my_patient(patient_id))
  WITH CHECK (public.is_clinical() AND public.is_my_patient(patient_id));

DROP POLICY IF EXISTS "Staff view referrals"     ON public.patient_referrals;
DROP POLICY IF EXISTS "Clinical insert referrals" ON public.patient_referrals;
DROP POLICY IF EXISTS "Clinical update referrals" ON public.patient_referrals;
CREATE POLICY "Staff view referrals" ON public.patient_referrals FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_my_patient(patient_id));
CREATE POLICY "Clinical insert referrals" ON public.patient_referrals FOR INSERT TO authenticated
  WITH CHECK (public.is_clinical() AND public.is_my_patient(patient_id));
CREATE POLICY "Clinical update referrals" ON public.patient_referrals FOR UPDATE TO authenticated
  USING (public.is_clinical() AND public.is_my_patient(patient_id))
  WITH CHECK (public.is_clinical() AND public.is_my_patient(patient_id));

DROP POLICY IF EXISTS "Staff view reports"     ON public.patient_reports;
DROP POLICY IF EXISTS "Clinical insert reports" ON public.patient_reports;
DROP POLICY IF EXISTS "Clinical update reports" ON public.patient_reports;
CREATE POLICY "Staff view reports" ON public.patient_reports FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_my_patient(patient_id));
CREATE POLICY "Clinical insert reports" ON public.patient_reports FOR INSERT TO authenticated
  WITH CHECK (public.is_clinical() AND public.is_my_patient(patient_id));
CREATE POLICY "Clinical update reports" ON public.patient_reports FOR UPDATE TO authenticated
  USING (public.is_clinical() AND public.is_my_patient(patient_id))
  WITH CHECK (public.is_clinical() AND public.is_my_patient(patient_id));

DROP POLICY IF EXISTS "Staff view clinical forms"     ON public.clinical_forms;
DROP POLICY IF EXISTS "Clinical insert clinical forms" ON public.clinical_forms;
DROP POLICY IF EXISTS "Clinical update clinical forms" ON public.clinical_forms;
CREATE POLICY "Staff view clinical forms" ON public.clinical_forms FOR SELECT TO authenticated
  USING (public.is_admin() AND public.is_my_patient(patient_id));
CREATE POLICY "Clinical insert clinical forms" ON public.clinical_forms FOR INSERT TO authenticated
  WITH CHECK (public.is_clinical() AND public.is_my_patient(patient_id));
CREATE POLICY "Clinical update clinical forms" ON public.clinical_forms FOR UPDATE TO authenticated
  USING (public.is_clinical() AND public.is_my_patient(patient_id))
  WITH CHECK (public.is_clinical() AND public.is_my_patient(patient_id));

-- Historial de cambios: el profesional ve el de sus pacientes
DROP POLICY IF EXISTS "Staff view audit" ON public.audit_log;
CREATE POLICY "Staff view audit" ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_admin() AND ((SELECT public.sees_all_patients()) OR public.is_my_patient(patient_id)));


-- ── 6. Turnos: los suyos y los de sus pacientes ───────────────

DROP POLICY IF EXISTS "Staff view appointments"   ON public.appointments;
DROP POLICY IF EXISTS "Staff insert appointments" ON public.appointments;
DROP POLICY IF EXISTS "Staff update appointments" ON public.appointments;
CREATE POLICY "Staff view appointments" ON public.appointments FOR SELECT TO authenticated
  USING (public.is_admin() AND ((SELECT public.sees_all_patients())
         OR professional_id = (SELECT public.my_professional_id()) OR public.is_my_patient(patient_id)));
CREATE POLICY "Staff insert appointments" ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND ((SELECT public.sees_all_patients())
         OR professional_id = (SELECT public.my_professional_id()) OR public.is_my_patient(patient_id)));
CREATE POLICY "Staff update appointments" ON public.appointments FOR UPDATE TO authenticated
  USING (public.is_admin() AND ((SELECT public.sees_all_patients())
         OR professional_id = (SELECT public.my_professional_id()) OR public.is_my_patient(patient_id)))
  WITH CHECK (public.is_admin() AND ((SELECT public.sees_all_patients())
         OR professional_id = (SELECT public.my_professional_id()) OR public.is_my_patient(patient_id)));


-- ── 7. Archivos (bucket privado patient-files, carpeta = paciente) ──

DROP POLICY IF EXISTS "Staff read patient files"   ON storage.objects;
DROP POLICY IF EXISTS "Staff upload patient files" ON storage.objects;
CREATE POLICY "Staff read patient files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'patient-files' AND public.is_admin()
         AND public.is_my_patient(public.try_uuid((storage.foldername(name))[1])));
CREATE POLICY "Staff upload patient files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'patient-files' AND public.is_admin()
         AND public.is_my_patient(public.try_uuid((storage.foldername(name))[1])));


-- ── 8. Portal y prácticas (el panel los lee por el servidor; esto es
--       una segunda barrera por si alguien consulta la base directo) ──

DO $$
DECLARE
  r RECORD;
BEGIN
  -- tabla, nombre de la política, condición original
  FOR r IN SELECT * FROM (VALUES
    ('patient_portal_settings',  'Staff view portal settings',        'public.is_admin()'),
    ('portal_guardian_blocks',   'Staff view portal blocks',          'public.is_admin()'),
    ('portal_access_log',        'Staff view portal access',          'public.is_admin()'),
    ('portal_publications',      'Clinical view portal publications', 'public.is_clinical()'),
    ('portal_appt_requests',     'Staff view portal appt requests',   'public.is_admin()'),
    ('portal_hc_requests',       'Staff view portal hc requests',     'public.is_admin()'),
    ('portal_hc_documents',      'Staff view portal hc documents',    'public.is_admin()'),
    ('portal_links',             'Staff view portal links',           'public.is_admin()'),
    ('ai_drafts',                'Clinical view ai drafts',           'public.is_clinical()'),
    ('patient_exercise_plans',   'Clinical view exercise plans',      'public.is_clinical()'),
    ('patient_exercises',        'Clinical view exercises',           'public.is_clinical()'),
    ('exercise_practice_logs',   'Staff view practice logs',          'public.is_admin()'),
    ('exercise_practice_notes',  'Clinical view practice notes',      'public.is_clinical()'),
    ('patient_practice_feedback','Clinical view practice feedback',   'public.is_clinical()'),
    ('patient_goals',            'Clinical view goals',               'public.is_clinical()'),
    ('patient_medals',           'Clinical view medals',              'public.is_clinical()')
  ) AS t(tbl, pol, cond)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s AND public.is_my_patient(patient_id))',
                     r.pol, r.tbl, r.cond);
    END IF;
  END LOOP;

  -- Avisos de "no vamos": por el turno
  IF to_regclass('public.portal_appointment_responses') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Staff view portal responses" ON public.portal_appointment_responses;
    CREATE POLICY "Staff view portal responses" ON public.portal_appointment_responses FOR SELECT TO authenticated
      USING (public.is_admin() AND ((SELECT public.sees_all_patients()) OR EXISTS (
        SELECT 1 FROM public.appointments a WHERE a.id = appointment_id
          AND (a.professional_id = (SELECT public.my_professional_id()) OR public.is_my_patient(a.patient_id)))));
  END IF;
  -- Seguimiento de pedidos: por el pedido
  IF to_regclass('public.portal_hc_request_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Staff view portal hc events" ON public.portal_hc_request_events;
    CREATE POLICY "Staff view portal hc events" ON public.portal_hc_request_events FOR SELECT TO authenticated
      USING (public.is_admin() AND EXISTS (SELECT 1 FROM public.portal_hc_requests q
             WHERE q.id = request_id AND public.is_my_patient(q.patient_id)));
  END IF;
  IF to_regclass('public.portal_appt_request_events') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Staff view portal appt events" ON public.portal_appt_request_events;
    CREATE POLICY "Staff view portal appt events" ON public.portal_appt_request_events FOR SELECT TO authenticated
      USING (public.is_admin() AND EXISTS (SELECT 1 FROM public.portal_appt_requests q
             WHERE q.id = request_id AND public.is_my_patient(q.patient_id)));
  END IF;
  -- Cuentas, invitaciones y consentimientos de las familias: Dirección y Administración
  IF to_regclass('public.portal_accounts') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Staff view portal accounts" ON public.portal_accounts;
    CREATE POLICY "Staff view portal accounts" ON public.portal_accounts FOR SELECT TO authenticated
      USING (public.is_admin() AND (SELECT public.sees_all_patients()));
  END IF;
  IF to_regclass('public.portal_invitations') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Staff view portal invites" ON public.portal_invitations;
    CREATE POLICY "Staff view portal invites" ON public.portal_invitations FOR SELECT TO authenticated
      USING (public.is_admin() AND (SELECT public.sees_all_patients()));
  END IF;
  IF to_regclass('public.portal_consents') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Staff view portal consents" ON public.portal_consents;
    CREATE POLICY "Staff view portal consents" ON public.portal_consents FOR SELECT TO authenticated
      USING (public.is_admin() AND (SELECT public.sees_all_patients()));
  END IF;
END $$;


-- ── Verificación (todo tiene que dar true) ────────────────────
SELECT
  to_regprocedure('public.is_my_patient(uuid)') IS NOT NULL                       AS funciones_ok,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
     AND policyname IN ('Staff view patients', 'Staff view appointments', 'Staff view intake',
                        'Staff view guardians', 'Staff view reports', 'Staff view audit')
     AND (qual LIKE '%sees_all_patients%' OR qual LIKE '%is_my_patient%')) = 6     AS permisos_ok,
  position('administracion' IN pg_get_functiondef('public.intake_requests_guard()'::regprocedure)) > 0
                                                                                  AS administracion_deriva,
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
     AND policyname = 'Staff read patient files' AND qual LIKE '%is_my_patient%')  AS archivos_ok;
