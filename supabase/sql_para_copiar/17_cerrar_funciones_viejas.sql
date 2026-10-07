-- ============================================================
-- CIMT Connect — Cerrar las funciones del formulario viejo de turnos
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 1 a 16.
-- Es idempotente: se puede correr varias veces.
--
-- IMPORTANTE: después de este script NO vuelvas a correr el 6, el 8 ni
-- el 9: los tres vuelven a abrir estas funciones al público.
--
-- Qué hace:
--   Cierra TODAS las versiones de request_appointment() y get_booked_slots()
--   para el público (anon) y para cualquier sesión (authenticated).
--   El sitio ya no las usa: desde la fase 2 las solicitudes entran por
--   submit_intake_request() (script 12). Solo las usa el modo mock, que
--   no pasa por la base.
--
--   Por qué: request_appointment() seguía abierta y, con un DNI conocido,
--   dejaba pisar nombre, teléfono y email de un paciente real (el teléfono
--   es el que usan los recordatorios) y revelaba la fecha de su próximo
--   turno. get_booked_slots() mostraba la ocupación de la agenda.
--
--   No se borran (no se borra nada en la base): solo se les quita el
--   permiso de ejecución. Si algún día se necesitan, se vuelven a habilitar
--   con un GRANT explícito.
-- ============================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('request_appointment', 'get_booked_slots')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;


-- ── Verificación rápida (tiene que dar true) ──────────────────
SELECT NOT EXISTS (
  SELECT 1
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('request_appointment', 'get_booked_slots')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
) AS funciones_viejas_cerradas;
