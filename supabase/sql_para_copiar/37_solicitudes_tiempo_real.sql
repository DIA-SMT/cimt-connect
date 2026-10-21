-- ============================================================
-- 37 · SOLICITUDES EN TIEMPO REAL
-- ============================================================
-- Suma la tabla de solicitudes de turno a la publicación de tiempo real
-- de Supabase: cuando alguien completa «Solicitar turno» en el sitio, el
-- panel se entera al instante (número de la pestaña, cartel y aviso), sin
-- recargar la página.
--
-- No cambia permisos: el tiempo real respeta los mismos permisos de la base
-- (script 34). Cada persona recibe solo lo que puede ver: Administración y
-- Dirección, todas; un profesional, las derivadas a él.
--
-- Sin este script el panel igual se actualiza solo cada 30 segundos.
-- Se puede correr antes o después de publicar el código.
-- Es idempotente: se puede correr varias veces.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'intake_requests') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.intake_requests;
  END IF;
END $$;


-- ── Verificación (tiene que dar true) ─────────────────────────
SELECT EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                 AND tablename = 'intake_requests') AS tiempo_real_ok;
