-- ============================================================
-- CIMT Connect — Portal: copia digital de la historia clínica (etapa E1)
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes los scripts 20 y 22.
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo agrega; no borra datos):
--   1. portal_hc_requests: cómo pidió la familia recibir la copia ("mano",
--      como hasta ahora, o "portal") y, si se envió por el portal, cuándo,
--      quién la envió y qué confirmó. Suma el estado "enviada".
--   2. portal_hc_request_events: tres pasos nuevos en la constancia (PDF
--      subido, PDF quitado y copia enviada por el portal).
--   3. portal_hc_documents: los PDF de cada copia (la historia clínica
--      impresa desde la ficha y firmada digitalmente por la Dirección), con
--      su huella (sha256), quién los subió, cuándo se enviaron y si se
--      quitaron antes de enviarlos. No se borran: se marcan como quitados.
--   4. El bucket privado "portal-documents" de Storage (solo PDF, hasta
--      10 MB por archivo).
--
-- Mientras la etapa "hc_digital" esté apagada en el servidor
-- (PORTAL_CLINICAL_FEATURES; necesita también "consent"), el portal sigue
-- igual: la copia se entrega en mano. Prenderla sin haber corrido este
-- script no rompe nada: el servidor ve que faltan las columnas y la copia
-- digital sigue apagada (lo vuelve a mirar cada 5 minutos: después de
-- correrlo no hace falta reiniciar). Ya corrido, si la etapa se apaga, los
-- pedidos que se enviaron por el portal se siguen viendo como enviados (cómo
-- y cuándo), pero sin descarga.
--
-- Seguridad: las familias no leen las tablas ni el bucket (todo pasa por el
-- servidor con la service role key). El equipo del panel solo puede LEER la
-- lista de PDF. El bucket no tiene policies: desde el panel o el portal nadie
-- lo puede leer ni escribir directo. Los archivos los abre el servidor con
-- enlaces que vencen en 60 segundos, y queda registrado quién los abrió
-- (portal_access_log). Nadie puede borrar desde la app.
-- ============================================================


-- ── 1. Pedidos: cómo recibirla y el estado "enviada" ───────────
-- Los pedidos que ya existen quedan "mano"
ALTER TABLE public.portal_hc_requests ADD COLUMN IF NOT EXISTS channel       TEXT NOT NULL DEFAULT 'mano';
ALTER TABLE public.portal_hc_requests DROP CONSTRAINT IF EXISTS portal_hc_requests_channel_check;
ALTER TABLE public.portal_hc_requests ADD CONSTRAINT portal_hc_requests_channel_check
  CHECK (channel IN ('mano', 'portal'));
ALTER TABLE public.portal_hc_requests ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ;
ALTER TABLE public.portal_hc_requests ADD COLUMN IF NOT EXISTS sent_by_email TEXT;
-- Lo que confirmó quien la envió (completa y de este paciente, sin datos de
-- otras personas, firmada por la Dirección y, de 13 a 17 años, sin lo que el
-- adolescente contó en confianza)
ALTER TABLE public.portal_hc_requests ADD COLUMN IF NOT EXISTS sent_acks     JSONB;

-- El estado acepta "enviada" (el CHECK del script 20 se reemplaza entero)
ALTER TABLE public.portal_hc_requests DROP CONSTRAINT IF EXISTS portal_hc_requests_status_check;
ALTER TABLE public.portal_hc_requests ADD CONSTRAINT portal_hc_requests_status_check
  CHECK (status IN ('pendiente', 'lista', 'entregada', 'rechazada', 'cancelada', 'enviada'));

-- "enviada" solo por el portal, con quién, cuándo y qué confirmó
ALTER TABLE public.portal_hc_requests DROP CONSTRAINT IF EXISTS portal_hc_requests_sent_check;
ALTER TABLE public.portal_hc_requests ADD CONSTRAINT portal_hc_requests_sent_check
  CHECK (status <> 'enviada'
         OR (channel = 'portal' AND sent_at IS NOT NULL AND sent_by_email IS NOT NULL AND sent_acks IS NOT NULL));


-- ── 2. Constancia: pasos nuevos ────────────────────────────────
ALTER TABLE public.portal_hc_request_events DROP CONSTRAINT IF EXISTS portal_hc_request_events_kind_check;
ALTER TABLE public.portal_hc_request_events ADD CONSTRAINT portal_hc_request_events_kind_check
  CHECK (kind IN ('pedido', 'lista', 'pendiente', 'entregada', 'rechazada', 'cancelada', 'nota',
                  'documento', 'documento_quitado', 'enviada'));


-- ── 3. Los PDF de cada copia ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.portal_hc_documents (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID        NOT NULL REFERENCES public.portal_hc_requests(id) ON DELETE RESTRICT,
  patient_id        UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  -- Dónde está en el bucket portal-documents: hc/{request_id}/{uuid}.pdf
  storage_path      TEXT        NOT NULL UNIQUE,
  -- Nombre original del archivo (solo lo ve el equipo; la familia descarga
  -- uno genérico, sin datos del paciente)
  file_name         TEXT        NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  size_bytes        INT         NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256            TEXT        NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by_email TEXT        NOT NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Se envió a la familia (desde ahí no se puede quitar)
  published_at      TIMESTAMPTZ,
  -- Se quitó antes de enviarlo (el archivo se borra del bucket; la fila queda)
  removed_at        TIMESTAMPTZ,
  removed_by_email  TEXT,
  CONSTRAINT portal_hc_documents_removed_pair CHECK ((removed_at IS NULL) = (removed_by_email IS NULL)),
  CONSTRAINT portal_hc_documents_sent_kept    CHECK (NOT (published_at IS NOT NULL AND removed_at IS NOT NULL)),
  CONSTRAINT portal_hc_documents_path_check   CHECK (storage_path LIKE ('hc/' || request_id::text || '/%.pdf'))
);

CREATE INDEX IF NOT EXISTS portal_hc_documents_request_idx ON public.portal_hc_documents (request_id, uploaded_at);


-- ── 4. Bucket privado para los PDF ─────────────────────────────
-- Sin policies a propósito: solo lo usa el servidor (service role)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('portal-documents', 'portal-documents', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ── Seguridad (RLS) ────────────────────────────────────────────
ALTER TABLE public.portal_hc_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_hc_documents FROM anon;

DROP POLICY IF EXISTS "Staff view portal hc documents" ON public.portal_hc_documents;
CREATE POLICY "Staff view portal hc documents" ON public.portal_hc_documents
  FOR SELECT TO authenticated USING (public.is_admin());


-- ── Verificación rápida (tiene que dar true) ───────────────────
SELECT
  -- Los pedidos tienen las columnas nuevas
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portal_hc_requests'
      AND column_name IN ('channel', 'sent_at', 'sent_by_email', 'sent_acks')) = 4
  -- El estado acepta "enviada" y la constancia tiene los pasos nuevos
  AND EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.portal_hc_requests'::regclass
                AND conname = 'portal_hc_requests_status_check'
                AND pg_get_constraintdef(oid) LIKE '%''enviada''%')
  AND EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.portal_hc_request_events'::regclass
                AND conname = 'portal_hc_request_events_kind_check'
                AND pg_get_constraintdef(oid) LIKE '%''documento_quitado''%'
                AND pg_get_constraintdef(oid) LIKE '%''enviada''%')
  -- Y no quedó ningún CHECK viejo (con otro nombre) que no deje usar "enviada"
  AND NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid IN ('public.portal_hc_requests'::regclass, 'public.portal_hc_request_events'::regclass)
                    AND contype = 'c'
                    AND pg_get_constraintdef(oid) LIKE '%''cancelada''%'
                    AND pg_get_constraintdef(oid) NOT LIKE '%''enviada''%')
  -- La tabla de PDF existe con RLS y su única policy es de lectura para el equipo
  AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'portal_hc_documents' AND c.relrowsecurity)
  AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'portal_hc_documents')
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'portal_hc_documents'
                    AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT ILIKE '%is_admin()%'))
  -- El bucket existe y es privado
  AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'portal-documents' AND NOT public)
  -- Ninguna policy de Storage lo menciona (solo lo toca el servidor)
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage'
                    AND (coalesce(qual, '') ILIKE '%portal-documents%'
                         OR coalesce(with_check, '') ILIKE '%portal-documents%'))
  AS portal_copia_digital_ok;
