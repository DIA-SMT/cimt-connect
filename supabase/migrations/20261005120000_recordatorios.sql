-- ============================================================
-- 16 · RECORDATORIOS DE TURNO (etapa A: WhatsApp con un clic)
-- ============================================================
-- Desde "Turnos de mañana" el equipo abre WhatsApp con el mensaje
-- ya escrito, o llama por teléfono, y marca el turno como "avisado".
-- Esto guarda quién avisó, cuándo y por qué medio (reemplaza la
-- columna "Avisado" de la planilla en papel).
--
-- No cambia permisos: todo el equipo ya puede actualizar turnos, y
-- marcar el aviso no pasa por las reglas de agenda (superposición /
-- bloqueos) porque no cambia fecha, hora ni profesional.
-- El historial de cambios registra el aviso como cualquier cambio.
-- ============================================================

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_by TEXT,
  ADD COLUMN IF NOT EXISTS reminder_channel TEXT
    CHECK (reminder_channel IN ('whatsapp', 'llamada', 'email'));

-- Si se desmarca el aviso, se limpian los tres datos juntos
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_reminder_consistente;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_reminder_consistente
  CHECK ((reminder_sent_at IS NULL) = (reminder_channel IS NULL));


-- ── Verificación (tiene que dar true) ─────────────────────────
SELECT
  (SELECT count(*) = 3 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments'
      AND column_name IN ('reminder_sent_at', 'reminder_sent_by', 'reminder_channel')) AS recordatorios_ok;
