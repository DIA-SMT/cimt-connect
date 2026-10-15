-- ============================================================
-- LIMPIEZA DE LAS PRUEBAS · correr UNA SOLA VEZ, antes del lanzamiento
-- ============================================================
-- Durante la etapa de pruebas en producción se cargan pacientes, turnos,
-- solicitudes y cuentas del portal inventados. Este script los borra y deja
-- el sistema listo para empezar con datos reales.
--
-- NO es un script numerado ni una migración: no va en supabase/migrations
-- y no se vuelve a correr una vez que el centro usa el sistema de verdad
-- (con pacientes reales, los registros clínicos NO se borran: se anulan).
--
-- QUÉ BORRA
--   · Pacientes y todo lo de cada ficha: adultos responsables, historias por
--     área, derivaciones, seguimiento, informes, registro de adjuntos.
--   · Turnos, bloqueos de horario, solicitudes de ingreso.
--   · Portal: cuentas de familias (y sus usuarios de acceso), vínculos,
--     invitaciones, respuestas a turnos, intentos de ingreso, pedidos de
--     copia de la historia clínica y su constancia (requiere el script 20).
--     Y, si se corrieron sus scripts: configuración, consentimientos,
--     bloqueos y accesos de la información de salud (script 22), lo
--     publicado en «Mi información» (script 23), pedidos de turno y su
--     constancia (script 24), el registro de los PDF de la copia digital
--     de la historia clínica (script 25) y los ejercicios del portal:
--     planes, ejercicios, prácticas anotadas y "¿Cómo te fue?",
--     devoluciones, metas, medallas y borradores de la IA (script 26). Las
--     tablas de un script opcional (22 a 26) que todavía no se corrió se
--     saltean: el script funciona igual.
--   · Encuestas de satisfacción, historial de cambios, límites del chat.
--   · Reinicia la numeración de prácticas (vuelve a empezar en 000001).
--
-- QUÉ CONSERVA
--   · Usuarios del panel (admins) y sus accesos.
--   · Profesionales (con matrícula, días, foto).
--   · Rincón social.
--   · Talleres para familias: se conservan salvo que actives el paso opcional.
--
-- CÓMO SE USA
--   1. Correlo así como está: NO borra nada; al final muestra cuántos
--      registros se van a borrar (un total vacío quiere decir que esa tabla
--      no existe porque su script no se corrió).
--   2. Si está todo bien, sacale el "-- " a la línea SET de abajo y correlo
--      de nuevo: ahí sí borra. Al final todo tiene que dar 0 (o vacío).
--   3. A mano, en Supabase → Storage, en los buckets patient-files y
--      portal-documents (los PDF de la copia digital, si se corrió el
--      script 25): seleccioná todo y borrá (Supabase no permite borrar
--      archivos desde SQL).
--   4. En el panel → Equipo: desactivá los usuarios de prueba y revisá los
--      profesionales de prueba (se desactivan, no se borran).
-- ============================================================

-- SET cimt.confirmo_limpieza = 'si';

DO $$
DECLARE
  -- Tablas de los scripts opcionales: se borran solo si existen
  opcionales text[] := ARRAY[
    'portal_access_log', 'portal_step_up', 'portal_consents',
    'portal_guardian_blocks', 'patient_portal_settings',   -- script 22
    'portal_publications',                                 -- script 23
    'portal_appt_request_events', 'portal_appt_requests',  -- script 24
    'portal_hc_documents',                                 -- script 25
    'patient_medals', 'patient_goals',                     -- script 26
    'patient_practice_feedback', 'exercise_practice_notes',
    'exercise_practice_logs', 'patient_exercises',
    'patient_exercise_plans', 'ai_drafts'
  ];
  -- Tablas que están siempre (hasta el script 20)
  tablas text[] := ARRAY[
    'portal_hc_request_events', 'portal_hc_requests',
    'portal_appointment_responses', 'portal_links', 'portal_invitations',
    'portal_login_attempts', 'portal_accounts',
    'patient_files', 'clinical_forms', 'patient_guardians',
    'patient_referrals', 'patient_followups', 'patient_reports',
    'appointments', 'intake_requests', 'patients', 'schedule_blocks',
    'satisfaction_surveys', 'audit_log', 'chat_rate_limits'
  ];
  t text;
BEGIN
  IF current_setting('cimt.confirmo_limpieza', true) IS DISTINCT FROM 'si' THEN
    RAISE NOTICE 'Modo revisión: no se borró nada. Mirá los totales de abajo.';
    RETURN;
  END IF;

  -- Cuentas del portal: borrar el usuario de acceso borra la cuenta (cascada)
  DELETE FROM auth.users WHERE id IN (SELECT user_id FROM public.portal_accounts);

  FOREACH t IN ARRAY opcionales LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      tablas := array_append(tablas, t);
    ELSE
      RAISE NOTICE 'No está la tabla % (su script no se corrió): se saltea.', t;
    END IF;
  END LOOP;

  -- Todas las que están, en un solo TRUNCATE y sin CASCADE a propósito: si
  -- apareciera una tabla nueva que dependa de estas, el script falla sin
  -- borrar nada en vez de llevársela puesta.
  EXECUTE 'TRUNCATE TABLE '
    || (SELECT string_agg(format('public.%I', x), ', ') FROM unnest(tablas) AS x);

  ALTER SEQUENCE public.practice_number_seq RESTART WITH 1;

  -- Opcional: talleres de prueba. Si los talleres cargados son de prueba,
  -- sacale el "-- " a la línea siguiente.
  -- TRUNCATE TABLE public.workshops;

  RAISE NOTICE 'Limpieza hecha.';
END $$;

-- Cuántas filas tiene una tabla; vacío (NULL) si la tabla no existe porque
-- su script no se corrió. Es temporal: desaparece al cerrar la sesión.
CREATE OR REPLACE FUNCTION pg_temp.cuenta(tabla text) RETURNS bigint
LANGUAGE plpgsql AS $f$
DECLARE
  n bigint;
BEGIN
  IF to_regclass(tabla) IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('SELECT count(*) FROM %s', to_regclass(tabla)) INTO n;
  RETURN n;
END
$f$;

-- ── Totales (antes de confirmar: lo que se va a borrar; después: todo en 0) ──
SELECT
  (SELECT count(*) FROM public.patients)                     AS pacientes,
  (SELECT count(*) FROM public.appointments)                 AS turnos,
  (SELECT count(*) FROM public.intake_requests)              AS solicitudes,
  (SELECT count(*) FROM public.patient_guardians)            AS adultos_responsables,
  (SELECT count(*) FROM public.clinical_forms)               AS historias_por_area,
  (SELECT count(*) FROM public.patient_reports)              AS informes,
  (SELECT count(*) FROM public.patient_files)                AS adjuntos,
  (SELECT count(*) FROM public.portal_accounts)              AS cuentas_portal,
  (SELECT count(*) FROM public.portal_hc_requests)           AS pedidos_copia_hc,
  pg_temp.cuenta('public.portal_hc_documents')               AS pdf_copia_hc,
  pg_temp.cuenta('public.portal_appt_requests')              AS pedidos_turno,
  pg_temp.cuenta('public.portal_publications')               AS publicaciones_portal,
  pg_temp.cuenta('public.portal_consents')                   AS consentimientos_portal,
  pg_temp.cuenta('public.patient_exercise_plans')            AS planes_de_practica,
  pg_temp.cuenta('public.exercise_practice_logs')            AS practicas_anotadas,
  (SELECT count(*) FROM public.satisfaction_surveys)         AS encuestas,
  (SELECT count(*) FROM public.audit_log)                    AS historial,
  (SELECT count(*) FROM public.workshops)                    AS talleres_se_conservan,
  (SELECT count(*) FROM public.professionals)                AS profesionales_se_conservan,
  (SELECT count(*) FROM public.admins WHERE active)          AS usuarios_activos_se_conservan;
