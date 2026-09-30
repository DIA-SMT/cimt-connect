-- ============================================================
-- CIMT Connect — Quitar los profesionales de ejemplo
-- Correlo en Supabase → SQL Editor → New query → Run
--
-- La tabla professionals tiene los 4 nombres de ejemplo que se cargaron
-- al armar el proyecto (2_seed.sql). No son personas reales del centro.
-- Aparecen en el panel admin como opciones de "Profesional a cargo".
--
-- Qué hace: borra SOLO esos 4 registros, por nombre. Si algún paciente,
-- turno o informe los tenía asignados, queda "Sin asignar" (no se borra
-- nada más).
--
-- Después, los profesionales reales se cargan en:
--   Supabase → Table Editor → professionals → Insert row
--   (name, specialty, days, description; photo_url es opcional)
-- ============================================================

DELETE FROM public.professionals
WHERE name IN (
  'Lic. María Elena Rodríguez',
  'Lic. Sofía Valentina Torres',
  'Lic. Carlos Andrés Méndez',
  'Lic. Patricio Herrera'
);

-- Verificación: lo que queda en la tabla
SELECT name, specialty, days FROM public.professionals ORDER BY specialty, name;
