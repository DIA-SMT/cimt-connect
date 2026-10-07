-- ============================================================
-- CIMT Connect — Portal de familias: acceso propio del paciente adulto
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes el script 18.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo toca tablas del portal; no modifica tablas existentes):
--   El paciente mayor de edad (18 o más) puede usar el portal con su propio
--   DNI para ver sus turnos y avisar si va. Es un vínculo "titular": la
--   cuenta es del propio paciente y no pasa por un adulto responsable, así
--   que no tiene fila de patient_guardians (guardian_id queda vacío).
--
--   El servidor controla en cada pedido que el DNI de la cuenta sea el de la
--   ficha y que el paciente siga siendo mayor de edad y sin alta.
-- ============================================================

-- ── 1. portal_links: vínculo "titular" sin adulto responsable ──
ALTER TABLE public.portal_links ALTER COLUMN guardian_id DROP NOT NULL;

ALTER TABLE public.portal_links DROP CONSTRAINT IF EXISTS portal_links_relationship_kind_check;
ALTER TABLE public.portal_links ADD CONSTRAINT portal_links_relationship_kind_check
  CHECK (relationship_kind IN ('representante_legal', 'autorizado', 'titular'));

-- El titular no tiene fila de adulto responsable; los demás vínculos sí
ALTER TABLE public.portal_links DROP CONSTRAINT IF EXISTS portal_links_guardian_kind_check;
ALTER TABLE public.portal_links ADD CONSTRAINT portal_links_guardian_kind_check
  CHECK ((relationship_kind = 'titular') = (guardian_id IS NULL));


-- ── 2. portal_invitations: invitaciones para el propio paciente ─
ALTER TABLE public.portal_invitations DROP CONSTRAINT IF EXISTS portal_invitations_relationship_kind_check;
ALTER TABLE public.portal_invitations ADD CONSTRAINT portal_invitations_relationship_kind_check
  CHECK (relationship_kind IN ('representante_legal', 'autorizado', 'titular'));


-- ── Verificación rápida (tiene que dar true) ───────────────────
SELECT
  (SELECT is_nullable = 'YES' FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'portal_links' AND column_name = 'guardian_id')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_links_guardian_kind_check')
  AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_invitations_relationship_kind_check')
  AS portal_titular_ok;
