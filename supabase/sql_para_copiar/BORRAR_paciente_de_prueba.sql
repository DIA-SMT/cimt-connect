-- ============================================================
-- BORRAR UN PACIENTE DE PRUEBA (y la cuenta del portal de su adulto)
-- ============================================================
-- Para después de una demostración o una prueba con datos inventados.
-- Borra TODO lo de ese paciente: ficha, adultos, turnos, solicitudes,
-- historial de cambios, portal (cuentas, invitaciones, permisos, avisos,
-- pedidos, «Mi información», copia de la HC), ejercicios, prácticas,
-- devoluciones, metas, medallas, borradores de IA y grabaciones.
--
-- NUNCA con un paciente real: la historia clínica se conserva (Ley 26.529)
-- y en la app se anula, no se borra. Por eso hay que escribir el DNI Y el
-- apellido: si no coinciden, no se borra nada.
--
-- CÓMO SE USA
--   1. Completá abajo el DNI y el apellido del paciente, y el DNI del adulto
--      cuya cuenta del portal también se borra (vacío si no hay).
--   2. Correlo así como está: NO borra nada; muestra qué se va a borrar y
--      las carpetas de Storage. Anotá las carpetas.
--   3. Si está todo bien, sacale el "-- " a la línea SET de abajo y correlo
--      de nuevo: ahí sí borra (todo junto: si algo falla, no se borra nada).
--   4. A mano, en Supabase → Storage, borrá las carpetas anotadas (Supabase
--      no deja borrar archivos desde SQL):
--        · practice-recordings/<id del paciente>/   (audios de «Me grabo»)
--        · patient-files/<id del paciente>/         (adjuntos y foto)
--        · portal-documents/hc/<id del pedido>/     (PDF de la copia de la HC)
--
-- Los scripts opcionales que no se corrieron se saltean solos.
-- ============================================================

-- SET cimt.confirmo_borrado = 'si';

CREATE OR REPLACE FUNCTION pg_temp.datos_de_prueba() RETURNS TABLE (
  dni_paciente text, apellido text, dni_adulto text
) LANGUAGE sql AS $f$
  SELECT
    '99000002'::text,   -- DNI del paciente
    'Ibarra'::text,     -- su apellido, tal cual está en la ficha
    '99000001'::text    -- DNI del adulto con cuenta en el portal ('' si no hay)
$f$;

DO $$
DECLARE
  d record;
  p uuid;
  cuentas uuid[];
  usuarios uuid[];
  pedidos_hc uuid[];
  ids_historial uuid[];
  t text;
  -- Triggers que impiden borrar (registros que en la app solo se anulan)
  guardias text[][] := ARRAY[
    ['portal_publications', 'portal_publications_frozen'],
    ['patient_exercise_plans', 'patient_exercise_plans_guard'],
    ['patient_exercises', 'patient_exercises_guard'],
    ['exercise_practice_logs', 'exercise_practice_logs_append_only'],
    ['exercise_practice_notes', 'exercise_practice_notes_append_only'],
    ['patient_practice_feedback', 'patient_practice_feedback_frozen'],
    ['patient_medals', 'patient_medals_frozen'],
    ['patient_goals', 'patient_goals_guard'],
    ['ai_drafts', 'ai_drafts_guard']
  ];
  i int;
BEGIN
  SELECT * INTO d FROM pg_temp.datos_de_prueba();
  SELECT id INTO p FROM public.patients WHERE dni = d.dni_paciente AND lower(last_name) = lower(d.apellido);
  IF p IS NULL THEN
    RAISE EXCEPTION 'No hay un paciente con DNI % y apellido %: no se borró nada.', d.dni_paciente, d.apellido;
  END IF;

  -- Cuentas del portal: la del adulto y, si tiene, la propia del paciente
  SELECT array_agg(id), array_agg(user_id) INTO cuentas, usuarios FROM public.portal_accounts
   WHERE dni IN (d.dni_paciente, nullif(d.dni_adulto, ''));
  cuentas := coalesce(cuentas, '{}');
  usuarios := coalesce(usuarios, '{}');
  SELECT array_agg(id) INTO pedidos_hc FROM public.portal_hc_requests WHERE patient_id = p;
  pedidos_hc := coalesce(pedidos_hc, '{}');

  RAISE NOTICE 'Paciente: %  ·  cuentas del portal: %', p, cardinality(cuentas);
  RAISE NOTICE 'Storage a borrar a mano: practice-recordings/%/ · patient-files/%/', p, p;
  FOR i IN 1 .. cardinality(pedidos_hc) LOOP
    RAISE NOTICE 'Storage a borrar a mano: portal-documents/hc/%/', pedidos_hc[i];
  END LOOP;

  IF current_setting('cimt.confirmo_borrado', true) IS DISTINCT FROM 'si' THEN
    RAISE NOTICE 'Modo revisión: no se borró nada. Mirá los totales de abajo.';
    RETURN;
  END IF;

  -- Lo que el historial de cambios registra sin el id del paciente
  SELECT array_agg(id) INTO ids_historial FROM (
    SELECT id FROM public.appointments WHERE patient_id = p
    UNION SELECT id FROM public.intake_requests
     WHERE patient_id = p OR dni = d.dni_paciente OR guardian_dni IN (d.dni_paciente, nullif(d.dni_adulto, ''))
  ) x;
  ids_historial := coalesce(ids_historial, '{}');

  FOR i IN 1 .. array_length(guardias, 1) LOOP
    IF to_regclass('public.' || guardias[i][1]) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', guardias[i][1], guardias[i][2]);
    END IF;
  END LOOP;

  -- Práctica (de las hojas a la raíz)
  IF to_regclass('public.practice_recordings') IS NOT NULL THEN
    DELETE FROM public.practice_recordings WHERE patient_id = p;
  END IF;
  IF to_regclass('public.patient_medals') IS NOT NULL THEN
    DELETE FROM public.patient_medals WHERE patient_id = p;
    DELETE FROM public.patient_goals WHERE patient_id = p;
    DELETE FROM public.patient_practice_feedback WHERE patient_id = p;
    DELETE FROM public.exercise_practice_notes WHERE patient_id = p;
    DELETE FROM public.exercise_practice_logs WHERE patient_id = p;
    DELETE FROM public.patient_exercises WHERE patient_id = p;
    UPDATE public.patient_exercise_plans SET supersedes_id = NULL WHERE patient_id = p;
    DELETE FROM public.patient_exercise_plans WHERE patient_id = p;
    DELETE FROM public.ai_drafts WHERE patient_id = p;
  END IF;

  -- Portal
  IF to_regclass('public.portal_publications') IS NOT NULL THEN
    UPDATE public.portal_publications SET supersedes_id = NULL WHERE patient_id = p;
    DELETE FROM public.portal_publications WHERE patient_id = p;
  END IF;
  IF to_regclass('public.portal_hc_documents') IS NOT NULL THEN
    DELETE FROM public.portal_hc_documents WHERE patient_id = p;
  END IF;
  DELETE FROM public.portal_hc_requests WHERE patient_id = p;
  IF to_regclass('public.portal_appt_requests') IS NOT NULL THEN
    DELETE FROM public.portal_appt_requests WHERE patient_id = p;
  END IF;
  IF to_regclass('public.portal_consents') IS NOT NULL THEN
    DELETE FROM public.portal_consents
     WHERE account_id = ANY (cuentas)
        OR evidence_file_id IN (SELECT id FROM public.patient_files WHERE patient_id = p);
    DELETE FROM public.portal_access_log WHERE patient_id = p OR account_id = ANY (cuentas);
    DELETE FROM public.patient_portal_settings WHERE patient_id = p;
    DELETE FROM public.portal_guardian_blocks WHERE patient_id = p;
  END IF;
  DELETE FROM public.portal_invitations
   WHERE dni IN (d.dni_paciente, nullif(d.dni_adulto, ''))
      OR account_id = ANY (cuentas)
      OR children @> jsonb_build_array(jsonb_build_object('patient_id', p));

  -- Turnos y solicitudes (si no, quedarían sueltos: la ficha los suelta, no los borra)
  DELETE FROM public.appointments WHERE patient_id = p;
  DELETE FROM public.intake_requests
   WHERE patient_id = p OR dni = d.dni_paciente OR guardian_dni IN (d.dni_paciente, nullif(d.dni_adulto, ''));

  -- La ficha: arrastra adultos, historias por área, adjuntos, derivaciones,
  -- seguimientos, informes y vínculos del portal
  DELETE FROM public.patients WHERE id = p;

  -- Los usuarios de acceso: arrastran sus cuentas del portal
  DELETE FROM auth.users WHERE id = ANY (usuarios);

  -- El historial de cambios de todo lo anterior
  DELETE FROM public.audit_log WHERE patient_id = p OR record_id = ANY (ids_historial) OR record_id = p;

  FOR i IN 1 .. array_length(guardias, 1) LOOP
    IF to_regclass('public.' || guardias[i][1]) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', guardias[i][1], guardias[i][2]);
    END IF;
  END LOOP;

  RAISE NOTICE 'Listo: se borró el paciente y % cuenta(s) del portal. Falta borrar las carpetas de Storage.', cardinality(cuentas);
END $$;

-- ── Qué hay de ese paciente (antes de confirmar: lo que se va a borrar; después: todo en 0) ──
CREATE OR REPLACE FUNCTION pg_temp.cuenta(tabla text, condicion text) RETURNS bigint
LANGUAGE plpgsql AS $f$
DECLARE
  n bigint;
BEGIN
  IF to_regclass(tabla) IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT count(*) FROM %s WHERE %s', to_regclass(tabla), condicion) INTO n;
  RETURN n;
END
$f$;

WITH d AS (SELECT * FROM pg_temp.datos_de_prueba()),
     p AS (SELECT pa.id FROM public.patients pa, d WHERE pa.dni = d.dni_paciente AND lower(pa.last_name) = lower(d.apellido))
SELECT
  (SELECT id FROM p)                                                                      AS id_paciente,
  (SELECT count(*) FROM public.portal_accounts, d WHERE dni IN (d.dni_paciente, nullif(d.dni_adulto, ''))) AS cuentas_portal,
  (SELECT count(*) FROM public.appointments WHERE patient_id = (SELECT id FROM p))         AS turnos,
  (SELECT count(*) FROM public.patient_guardians WHERE patient_id = (SELECT id FROM p))    AS adultos_en_la_ficha,
  pg_temp.cuenta('public.patient_exercise_plans', format('patient_id = %L', (SELECT id FROM p)))  AS planes,
  pg_temp.cuenta('public.exercise_practice_logs', format('patient_id = %L', (SELECT id FROM p)))  AS practicas,
  pg_temp.cuenta('public.patient_medals', format('patient_id = %L', (SELECT id FROM p)))          AS medallas,
  pg_temp.cuenta('public.practice_recordings', format('patient_id = %L', (SELECT id FROM p)))     AS grabaciones,
  pg_temp.cuenta('public.portal_publications', format('patient_id = %L', (SELECT id FROM p)))     AS publicaciones,
  (SELECT count(*) FROM public.audit_log WHERE patient_id = (SELECT id FROM p))            AS historial;
