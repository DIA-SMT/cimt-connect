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
--      registros se van a borrar.
--   2. Si está todo bien, sacale el "-- " a la línea SET de abajo y correlo
--      de nuevo: ahí sí borra. Al final todo tiene que dar 0.
--   3. A mano, en Supabase → Storage → patient-files: seleccioná todo y
--      borrá (Supabase no permite borrar archivos desde SQL).
--   4. En el panel → Equipo: desactivá los usuarios de prueba y revisá los
--      profesionales de prueba (se desactivan, no se borran).
-- ============================================================

-- SET cimt.confirmo_limpieza = 'si';

DO $$
BEGIN
  IF current_setting('cimt.confirmo_limpieza', true) IS DISTINCT FROM 'si' THEN
    RAISE NOTICE 'Modo revisión: no se borró nada. Mirá los totales de abajo.';
    RETURN;
  END IF;

  -- Cuentas del portal: borrar el usuario de acceso borra la cuenta (cascada)
  DELETE FROM auth.users WHERE id IN (SELECT user_id FROM public.portal_accounts);

  -- Sin CASCADE a propósito: si apareciera una tabla nueva que dependa de
  -- estas, el script falla sin borrar nada en vez de llevársela puesta.
  TRUNCATE TABLE
    public.portal_hc_request_events,
    public.portal_hc_requests,
    public.portal_appointment_responses,
    public.portal_links,
    public.portal_invitations,
    public.portal_login_attempts,
    public.portal_accounts,
    public.patient_files,
    public.clinical_forms,
    public.patient_guardians,
    public.patient_referrals,
    public.patient_followups,
    public.patient_reports,
    public.appointments,
    public.intake_requests,
    public.patients,
    public.schedule_blocks,
    public.satisfaction_surveys,
    public.audit_log,
    public.chat_rate_limits;

  ALTER SEQUENCE public.practice_number_seq RESTART WITH 1;

  -- Opcional: talleres de prueba. Si los talleres cargados son de prueba,
  -- sacale el "-- " a la línea siguiente.
  -- TRUNCATE TABLE public.workshops;

  RAISE NOTICE 'Limpieza hecha.';
END $$;

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
  (SELECT count(*) FROM public.satisfaction_surveys)         AS encuestas,
  (SELECT count(*) FROM public.audit_log)                    AS historial,
  (SELECT count(*) FROM public.workshops)                    AS talleres_se_conservan,
  (SELECT count(*) FROM public.professionals)                AS profesionales_se_conservan,
  (SELECT count(*) FROM public.admins WHERE active)          AS usuarios_activos_se_conservan;
