-- ============================================================
-- 35 · MI PERFIL: CADA PROFESIONAL EDITA SU FOTO Y SU DESCRIPCIÓN
-- ============================================================
-- Desde el panel, botón «Mi perfil»: cada persona con su usuario
-- vinculado a un profesional cambia SOLO lo suyo:
--   - foto (la de la página Profesionales del sitio),
--   - descripción para el sitio,
--   - días de atención.
-- Nombre, especialidad, matrícula, duración de la sesión, si está activo
-- y si aparece en el sitio siguen siendo de la Dirección (pestaña Equipo):
-- salen en los informes firmados y en la agenda.
--
-- Requiere el script 34 (usa my_professional_id()).
-- Orden: correlo ANTES de publicar el código nuevo.
-- Es idempotente: se puede correr varias veces.
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_my_professional_profile(
  p_photo_url   TEXT,
  p_description TEXT,
  p_days        TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_id UUID := public.my_professional_id();
BEGIN
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'NOT_LINKED: Tu usuario no está vinculado a un profesional. Pedile a la Dirección que lo vincule en Equipo.';
  END IF;

  p_photo_url   := NULLIF(btrim(coalesce(p_photo_url, '')), '');
  p_description := NULLIF(btrim(coalesce(p_description, '')), '');
  p_days        := NULLIF(btrim(coalesce(p_days, '')), '');

  -- La foto tiene que ser del bucket de fotos de profesionales
  IF p_photo_url IS NOT NULL AND (
       length(p_photo_url) > 500
       OR p_photo_url !~ '^https?://'
       OR position('/storage/v1/object/public/professional-photos/' IN p_photo_url) = 0) THEN
    RAISE EXCEPTION 'INVALID_PHOTO: La foto no es válida';
  END IF;
  IF length(coalesce(p_description, '')) > 600 THEN
    RAISE EXCEPTION 'INVALID_DESCRIPTION: La descripción puede tener hasta 600 caracteres';
  END IF;
  IF length(coalesce(p_days, '')) > 120 THEN
    RAISE EXCEPTION 'INVALID_DAYS: Los días de atención pueden tener hasta 120 caracteres';
  END IF;

  UPDATE public.professionals
     SET photo_url = p_photo_url, description = p_description, days = p_days
   WHERE id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_professional_profile(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_professional_profile(TEXT, TEXT, TEXT) TO authenticated;


-- Subir la foto propia: en una carpeta con el id del profesional
DROP POLICY IF EXISTS "Professionals upload own photo" ON storage.objects;
CREATE POLICY "Professionals upload own photo" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'professional-photos'
              AND (storage.foldername(name))[1] = (SELECT public.my_professional_id())::text);


-- ── Verificación (las dos tienen que dar true) ────────────────
SELECT
  to_regprocedure('public.update_my_professional_profile(text,text,text)') IS NOT NULL AS perfil_ok,
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
          AND policyname = 'Professionals upload own photo')                         AS foto_ok;
