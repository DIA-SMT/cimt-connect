-- ============================================================
-- CIMT Connect — Portal: ejercicios, devoluciones, metas y medallas (etapas B y D)
-- Correlo en Supabase → SQL Editor → New query → Run
-- Requiere haber corrido antes el script 22 (y, con él, el 18).
-- Es idempotente: se puede correr varias veces.
--
-- Qué hace (solo agrega; no modifica datos existentes):
--   1. ai_drafts: cada pedido de "Adaptar con ayuda de IA" (etapa D): qué se
--      mandó exactamente (sin datos que identifiquen al paciente), qué
--      devolvió el modelo y si se usó. Solo se agregan filas.
--   2. patient_exercise_plans: el plan de práctica de cada paciente, con
--      versiones (borrador, publicado, reemplazado, finalizado, retirado).
--      Uno publicado y uno en borrador por paciente, como máximo. Un plan
--      no se publica mientras algún ejercicio adaptado con IA no tenga
--      "Lo revisé".
--   3. patient_exercises: los ejercicios de cada versión del plan
--      (exercise_key: la identidad del ejercicio entre versiones). Solo se
--      editan mientras el plan es un borrador.
--   4. exercise_practice_logs: "Ya lo hice". Una práctica por ejercicio y
--      por día (aunque la anoten dos adultos), hasta 2 días hacia atrás y
--      nunca antes de que se publicara ese ejercicio. 40 por cuenta por día.
--      Deshacer = marcarla como deshecha.
--   5. exercise_practice_notes: "¿Cómo te fue?" y el comentario de cada
--      adulto (risk_flag: palabras de riesgo, lo calcula el servidor).
--   6. patient_practice_feedback: las devoluciones del profesional.
--   7. patient_goals: metas (de práctica o terapéuticas). Se dan por
--      logradas solo junto con una devolución.
--   8. patient_medals: medallas de constancia (automáticas) y del
--      profesional (siempre con una devolución). No se pierden: solo se
--      anulan, con motivo.
--   9. practice_publish_plan(), practice_withdraw_plan(),
--      practice_finish_plan(), practice_send_feedback() y
--      practice_withdraw_feedback(): publicar, retirar o finalizar un plan
--      (con sus metas: retirar y finalizar las cierran igual, con
--      practice_close_plan()) y mandar o retirar una devolución (con metas
--      logradas y medalla) en un solo paso. practice_pending() y
--      practice_days(): cuentas para la bandeja y la ficha (sin traer filas
--      sueltas). practice_plan_open(): si el plan de una meta sigue vigente
--      (lo usan las reglas de las metas). Solo las usa el servidor.
--
-- Nada de esto se ve en el portal mientras la etapa "practice" esté apagada
-- en el servidor (PORTAL_CLINICAL_FEATURES) y el profesional no prenda
-- "Mostrar ejercicios, devoluciones y medallas" para cada paciente.
--
-- Seguridad: las familias NUNCA leen estas tablas (todo pasa por el
-- servidor con la service role key). El equipo del panel solo puede LEER:
-- profesionales y Dirección (is_clinical) todo menos los registros de
-- práctica, que también ve Administración (is_admin: solo cuántos y cuándo;
-- los comentarios están en otra tabla). Escribir lo hace solo el servidor.
-- Nadie puede borrar: se retira, se deshace o se anula, con motivo.
-- Ninguna tabla tiene un campo de fluidez.
-- ============================================================


DO $$
BEGIN
  IF to_regclass('public.patient_portal_settings') IS NULL THEN
    RAISE EXCEPTION 'Falta correr antes el script 22 (portal: base clínica)';
  END IF;
END $$;


-- ── 1. Borradores de la IA (solo se agregan filas) ─────────────
CREATE TABLE IF NOT EXISTS public.ai_drafts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT        NOT NULL CHECK (kind IN ('adaptacion', 'devolucion')),
  -- Nunca se manda al proveedor: sirve para que el borrador se use solo en este paciente
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  requested_by_email TEXT        NOT NULL,
  model              TEXT        NOT NULL,
  prompt_version     TEXT        NOT NULL,
  catalog_version    TEXT,
  params             JSONB       NOT NULL, -- exactamente lo que se mandó (listas cerradas)
  output             JSONB,                -- lo que devolvió el modelo (ya validado)
  flags              JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(flags) = 'array'),
  status             TEXT        NOT NULL CHECK (status IN ('generado', 'usado', 'descartado', 'error')),
  error_code         TEXT,
  tokens_in          INT,
  tokens_out         INT,
  cost_usd           NUMERIC(10, 6),
  latency_ms         INT,
  used_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'error' OR error_code IS NOT NULL),
  CHECK ((status = 'usado') = (used_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ai_drafts_created_idx   ON public.ai_drafts (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_drafts_requester_idx ON public.ai_drafts (requested_by_email, created_at DESC);


-- ── 2. Planes de práctica ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_exercise_plans (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id             UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  version                INT         NOT NULL CHECK (version >= 1),
  supersedes_id          UUID        REFERENCES public.patient_exercise_plans(id) ON DELETE RESTRICT,
  status                 TEXT        NOT NULL DEFAULT 'borrador'
                                     CHECK (status IN ('borrador', 'publicado', 'reemplazado', 'finalizado', 'retirado')),
  title                  TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  goal_text              TEXT        CHECK (goal_text IS NULL OR length(goal_text) BETWEEN 1 AND 300),
  audience               TEXT        NOT NULL CHECK (audience IN ('infancia', 'preadolescencia', 'adolescencia', 'adultez')),
  days_per_week          INT         NOT NULL DEFAULT 3 CHECK (days_per_week BETWEEN 1 AND 7),
  review_on              DATE,
  -- Pausa de vacaciones: fecha de vuelta (la pausa vale mientras hoy sea anterior)
  on_break_until         DATE,
  auto_medals            BOOLEAN     NOT NULL DEFAULT true,
  -- Quién lo escribió (se fija al publicar): el profesional o la Dirección
  professional_id        UUID        REFERENCES public.professionals(id) ON DELETE RESTRICT,
  author_label           TEXT,
  adolescent_ack         BOOLEAN     NOT NULL DEFAULT false, -- "Lo conversé con …" (13 a 17 años)
  -- "Lo dejo así" para los avisos del título o de "Para qué es"
  lint_overrides         JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lint_overrides) = 'array'),
  created_by_email       TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_email       TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at           TIMESTAMPTZ,
  published_by_email     TEXT,
  closed_at              TIMESTAMPTZ,
  closed_by_email        TEXT,
  close_reason           TEXT        CHECK (close_reason IN ('reemplazado', 'finalizado', 'error', 'pedido_familia', 'otro', 'descartado')),
  -- "Visto": el profesional revisó las prácticas. last_reviewed_label: el
  -- nombre con que firma quien lo marcó ("Lic. … vio las prácticas el …")
  last_reviewed_at       TIMESTAMPTZ,
  last_reviewed_by_email TEXT,
  last_reviewed_label    TEXT,
  UNIQUE (patient_id, version),
  CHECK ((published_at IS NULL) = (published_by_email IS NULL)),
  CHECK ((closed_at IS NULL) = (closed_by_email IS NULL)),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL)),
  CHECK ((last_reviewed_at IS NULL) = (last_reviewed_by_email IS NULL)),
  CHECK ((last_reviewed_at IS NULL) = (last_reviewed_label IS NULL)),
  CHECK (last_reviewed_at IS NULL OR published_at IS NOT NULL),
  CHECK (status <> 'borrador'  OR (published_at IS NULL AND closed_at IS NULL)),
  CHECK (status <> 'publicado' OR (published_at IS NOT NULL AND author_label IS NOT NULL AND closed_at IS NULL)),
  CHECK (status NOT IN ('reemplazado', 'finalizado') OR (published_at IS NOT NULL AND closed_at IS NOT NULL)),
  CHECK (status <> 'retirado'  OR closed_at IS NOT NULL)
);

-- Uno publicado y uno en borrador por paciente
CREATE UNIQUE INDEX IF NOT EXISTS patient_exercise_plans_one_published
  ON public.patient_exercise_plans (patient_id) WHERE status = 'publicado';
CREATE UNIQUE INDEX IF NOT EXISTS patient_exercise_plans_one_draft
  ON public.patient_exercise_plans (patient_id) WHERE status = 'borrador';


-- ── 3. Ejercicios de cada versión del plan ─────────────────────
-- Pasos: de 2 a 6, de hasta 160 caracteres cada uno
CREATE OR REPLACE FUNCTION public.practice_steps_ok(p JSONB)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT jsonb_typeof(p) = 'array'
     AND jsonb_array_length(p) BETWEEN 2 AND 6
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p) x
                     WHERE jsonb_typeof(x) <> 'string' OR length(x #>> '{}') NOT BETWEEN 1 AND 160);
$$;

CREATE TABLE IF NOT EXISTS public.patient_exercises (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id              UUID        NOT NULL REFERENCES public.patient_exercise_plans(id) ON DELETE RESTRICT,
  patient_id           UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  -- Identidad estable entre versiones del plan ("Hecho hoy" se mantiene al republicar)
  exercise_key         UUID        NOT NULL DEFAULT gen_random_uuid(),
  source               TEXT        NOT NULL CHECK (source IN ('catalogo', 'manual', 'ia')),
  catalog_id           TEXT,
  catalog_version      TEXT,
  position             INT         NOT NULL CHECK (position BETWEEN 0 AND 20),
  approach             TEXT        NOT NULL CHECK (approach IN ('entorno_familia', 'habla_facil', 'tartamudear_facil', 'animarse',
                                                               'ritmo_y_claridad', 'escuela_y_lectura', 'regulacion_y_rutinas')),
  practiced_in_session BOOLEAN     NOT NULL DEFAULT false, -- "Ya lo practicamos en sesión"
  title                TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  para_que             TEXT        NOT NULL CHECK (length(para_que) BETWEEN 1 AND 200),
  pasos                JSONB       NOT NULL CHECK (public.practice_steps_ok(pasos)),
  minutes              INT         NOT NULL CHECK (minutes BETWEEN 1 AND 30),
  materiales           TEXT        CHECK (materiales IS NULL OR length(materiales) BETWEEN 1 AND 200),
  for_adult            TEXT        CHECK (for_adult IS NULL OR length(for_adult) BETWEEN 1 AND 300),
  si_cuesta            TEXT        NOT NULL CHECK (length(si_cuesta) BETWEEN 1 AND 200),
  with_adult           BOOLEAN     NOT NULL DEFAULT true,
  -- Adaptado con IA: lo marca el trigger a partir de ai_draft_id
  ai_draft_id          UUID        REFERENCES public.ai_drafts(id) ON DELETE RESTRICT,
  ai_drafted           BOOLEAN     NOT NULL DEFAULT false,
  reviewed_at          TIMESTAMPTZ, -- "Lo revisé"
  reviewed_by_email    TEXT,
  edit_ratio           NUMERIC(4, 3) CHECK (edit_ratio IS NULL OR edit_ratio BETWEEN 0 AND 1),
  -- "Lo dejo así": avisos del texto que el profesional decidió dejar, con el motivo
  lint_overrides       JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lint_overrides) = 'array'),
  removed_at           TIMESTAMPTZ, -- "Quitar": no se borra, se marca
  removed_by_email     TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, exercise_key),
  CHECK ((reviewed_at IS NULL) = (reviewed_by_email IS NULL)),
  CHECK ((removed_at IS NULL) = (removed_by_email IS NULL)),
  CHECK (source = 'manual' OR catalog_id IS NOT NULL),
  CHECK (source <> 'ia' OR ai_draft_id IS NOT NULL),
  CHECK (NOT ai_drafted OR ai_draft_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS patient_exercises_plan_idx ON public.patient_exercises (plan_id, position);
CREATE INDEX IF NOT EXISTS patient_exercises_key_idx  ON public.patient_exercises (patient_id, exercise_key);


-- ── 4. Registros de práctica ("Ya lo hice") ────────────────────
CREATE TABLE IF NOT EXISTS public.exercise_practice_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  plan_id      UUID        NOT NULL REFERENCES public.patient_exercise_plans(id) ON DELETE RESTRICT,
  exercise_id  UUID        NOT NULL REFERENCES public.patient_exercises(id) ON DELETE RESTRICT,
  exercise_key UUID        NOT NULL,
  account_id   UUID        REFERENCES public.portal_accounts(id) ON DELETE SET NULL,
  practiced_on DATE        NOT NULL, -- día del centro
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at    TIMESTAMPTZ           -- "Deshacer" (solo quien la anotó, el mismo día)
);

-- Una práctica vigente por ejercicio y por día
CREATE UNIQUE INDEX IF NOT EXISTS exercise_practice_logs_one_per_day
  ON public.exercise_practice_logs (patient_id, exercise_key, practiced_on) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS exercise_practice_logs_patient_idx ON public.exercise_practice_logs (patient_id, practiced_on DESC);
CREATE INDEX IF NOT EXISTS exercise_practice_logs_account_idx ON public.exercise_practice_logs (account_id, created_at DESC);
-- La bandeja: lo anotado en los últimos meses, de todos los pacientes
CREATE INDEX IF NOT EXISTS exercise_practice_logs_created_idx ON public.exercise_practice_logs (created_at DESC);


-- ── 5. "¿Cómo te fue?" de cada adulto ──────────────────────────
CREATE TABLE IF NOT EXISTS public.exercise_practice_notes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id     UUID        NOT NULL REFERENCES public.exercise_practice_logs(id) ON DELETE RESTRICT,
  patient_id UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  account_id UUID        REFERENCES public.portal_accounts(id) ON DELETE SET NULL,
  result     TEXT        CHECK (result IN ('bien', 'mas_o_menos', 'costo')),
  comment    TEXT        CHECK (comment IS NULL OR length(comment) BETWEEN 1 AND 280),
  -- Palabras de riesgo (lista fija en el servidor, sin IA): "Revisar hoy"
  risk_flag  BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (log_id, account_id),
  CHECK (result IS NOT NULL OR comment IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS exercise_practice_notes_patient_idx ON public.exercise_practice_notes (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS exercise_practice_notes_created_idx ON public.exercise_practice_notes (created_at DESC);


-- ── 6. Devoluciones del profesional ────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_practice_feedback (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  plan_id            UUID        REFERENCES public.patient_exercise_plans(id) ON DELETE RESTRICT,
  professional_id    UUID        REFERENCES public.professionals(id) ON DELETE RESTRICT,
  author_label       TEXT        NOT NULL,
  body               TEXT        NOT NULL CHECK (length(body) BETWEEN 10 AND 800),
  for_adult          TEXT        CHECK (for_adult IS NULL OR length(for_adult) BETWEEN 1 AND 300),
  period_start       DATE,
  period_end         DATE,
  adolescent_ack     BOOLEAN     NOT NULL DEFAULT false,
  -- "Lo dejo así" para los avisos del texto
  review_note        TEXT        CHECK (review_note IS NULL OR length(review_note) <= 200),
  -- Para más adelante ("Ayudame a escribirlo claro"); en la v1 se escriben a mano
  ai_draft_id        UUID        REFERENCES public.ai_drafts(id) ON DELETE RESTRICT,
  ai_drafted         BOOLEAN     NOT NULL DEFAULT false,
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by_email      TEXT        NOT NULL,
  withdrawn_at       TIMESTAMPTZ,
  withdrawn_by_email TEXT,
  withdraw_reason    TEXT        CHECK (withdraw_reason IN ('error', 'pedido_familia', 'otro')),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_by_email IS NULL)),
  CHECK ((withdrawn_at IS NULL) = (withdraw_reason IS NULL)),
  CHECK (NOT ai_drafted OR ai_draft_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS patient_practice_feedback_patient_idx ON public.patient_practice_feedback (patient_id, sent_at DESC);


-- ── 7. Metas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_goals (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id              UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  plan_id                 UUID        REFERENCES public.patient_exercise_plans(id) ON DELETE RESTRICT,
  kind                    TEXT        NOT NULL CHECK (kind IN ('practica', 'terapeutica')),
  title                   TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  -- Solo "practica": { "dias": N, "semanas": M } (practicar N días en M semanas)
  rule                    JSONB,
  medal_title             TEXT        CHECK (medal_title IS NULL OR length(medal_title) BETWEEN 1 AND 60),
  agreed_with_patient     BOOLEAN     NOT NULL DEFAULT false, -- "La elegimos junto con …"
  status                  TEXT        NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'activa', 'lograda', 'cambiada')),
  created_by_email        TEXT        NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at            TIMESTAMPTZ,
  published_by_email      TEXT,
  achieved_at             TIMESTAMPTZ,
  feedback_id             UUID        REFERENCES public.patient_practice_feedback(id) ON DELETE RESTRICT,
  changed_at              TIMESTAMPTZ,
  changed_by_email        TEXT,
  -- "Todavía no" en la bandeja (meta de práctica cumplida)
  met_notice_dismissed_at TIMESTAMPTZ,
  CHECK ((kind = 'practica') = (rule IS NOT NULL)),
  CHECK (rule IS NULL OR coalesce(
    jsonb_typeof(rule) = 'object'
    AND jsonb_typeof(rule -> 'dias') = 'number' AND jsonb_typeof(rule -> 'semanas') = 'number'
    AND (rule ->> 'semanas')::numeric = trunc((rule ->> 'semanas')::numeric)
    AND (rule ->> 'dias')::numeric = trunc((rule ->> 'dias')::numeric)
    AND (rule ->> 'semanas')::numeric BETWEEN 1 AND 12
    AND (rule ->> 'dias')::numeric BETWEEN 1 AND 84
    AND (rule ->> 'dias')::numeric <= 7 * (rule ->> 'semanas')::numeric, false)),
  CHECK ((published_at IS NULL) = (published_by_email IS NULL)),
  CHECK ((changed_at IS NULL) = (changed_by_email IS NULL)),
  -- Una en borrador que nunca se publicó queda "cambiada" si su plan se retira o se finaliza
  CHECK (status IN ('borrador', 'cambiada') OR published_at IS NOT NULL),
  CHECK (status <> 'lograda' OR (achieved_at IS NOT NULL AND feedback_id IS NOT NULL)),
  CHECK (status <> 'cambiada' OR changed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS patient_goals_patient_idx ON public.patient_goals (patient_id, created_at DESC);


-- ── 8. Medallas ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_medals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID        NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  kind             TEXT        NOT NULL CHECK (kind IN ('constancia', 'profesional')),
  code             TEXT        NOT NULL,
  title            TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  -- Lunes de la semana (semana_cumplida), día de la vuelta (de_vuelta) o ''
  period_key       TEXT        NOT NULL DEFAULT '' CHECK (period_key = '' OR period_key ~ '^\d{4}-\d{2}-\d{2}$'),
  plan_id          UUID        REFERENCES public.patient_exercise_plans(id) ON DELETE RESTRICT,
  goal_id          UUID        REFERENCES public.patient_goals(id) ON DELETE RESTRICT,
  feedback_id      UUID        REFERENCES public.patient_practice_feedback(id) ON DELETE RESTRICT,
  message          TEXT        CHECK (message IS NULL OR length(message) BETWEEN 1 AND 280),
  awarded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  awarded_by_email TEXT,       -- NULL: automática
  voided_at        TIMESTAMPTZ, -- solo para errores, con motivo
  voided_by_email  TEXT,
  void_reason      TEXT        CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 1 AND 200),
  CHECK ((kind = 'constancia' AND code IN ('primer_paso', 'semana_cumplida', 'un_mes', 'de_vuelta',
                                           'practicas_10', 'practicas_25', 'practicas_50'))
         OR (kind = 'profesional' AND code = 'profesional')),
  CHECK (kind <> 'profesional' OR (feedback_id IS NOT NULL AND awarded_by_email IS NOT NULL AND period_key = '')),
  CHECK (kind <> 'constancia' OR (goal_id IS NULL AND feedback_id IS NULL AND message IS NULL AND awarded_by_email IS NULL)),
  CHECK ((voided_at IS NULL) = (voided_by_email IS NULL)),
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);

-- Una medalla de constancia vigente por código y período; una del profesional por meta
CREATE UNIQUE INDEX IF NOT EXISTS patient_medals_constancy_uniq
  ON public.patient_medals (patient_id, code, period_key) WHERE kind = 'constancia' AND voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patient_medals_goal_uniq
  ON public.patient_medals (goal_id) WHERE kind = 'profesional' AND goal_id IS NOT NULL AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS patient_medals_patient_idx ON public.patient_medals (patient_id, awarded_at DESC);


-- ── Reglas que cuida la base (además del servidor) ─────────────

-- Planes: un plan nuevo empieza como borrador. Al publicarlo: de 1 a 8
-- ejercicios, cada ejercicio de IA con "Lo revisé" y los enfoques que lo
-- piden con "Ya lo practicamos en sesión". Publicado: solo cambian el
-- estado (reemplazado, finalizado, retirado), el cierre, el "Visto" y la
-- pausa. Cerrado: solo el "Visto" (si se había publicado: las prácticas
-- que quedaron sin ver se marcan como vistas aunque el plan ya no esté
-- publicado). No se borra.
CREATE OR REPLACE FUNCTION public.patient_exercise_plans_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_count INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: los planes no se borran, se retiran';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'borrador' THEN
      RAISE EXCEPTION 'PRACTICE_PLAN: un plan nuevo empieza como borrador';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: el plan no cambia de paciente ni de versión';
  END IF;
  -- Cada cambio mueve updated_at (el servidor lo usa para no pisar a otra persona)
  NEW.updated_at := clock_timestamp();

  IF OLD.status = 'borrador' THEN
    IF NEW.status NOT IN ('borrador', 'publicado', 'retirado') THEN
      RAISE EXCEPTION 'PRACTICE_PLAN: un borrador solo se publica o se descarta';
    END IF;
    IF NEW.status = 'publicado' THEN
      IF EXISTS (SELECT 1 FROM public.patient_exercises e
                 WHERE e.plan_id = NEW.id AND e.removed_at IS NULL AND e.ai_drafted AND e.reviewed_at IS NULL) THEN
        RAISE EXCEPTION 'AI_NOT_REVIEWED: falta «Lo revisé» en un ejercicio adaptado con IA';
      END IF;
      SELECT count(*) INTO v_count FROM public.patient_exercises e WHERE e.plan_id = NEW.id AND e.removed_at IS NULL;
      IF v_count NOT BETWEEN 1 AND 8 THEN
        RAISE EXCEPTION 'PRACTICE_PLAN: un plan publicado tiene de 1 a 8 ejercicios';
      END IF;
      IF EXISTS (SELECT 1 FROM public.patient_exercises e
                 WHERE e.plan_id = NEW.id AND e.removed_at IS NULL
                   AND e.approach IN ('tartamudear_facil', 'animarse') AND NOT e.practiced_in_session) THEN
        RAISE EXCEPTION 'PRACTICE_PLAN: falta «Ya lo practicamos en sesión»';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'publicado' THEN
    IF NEW.status NOT IN ('publicado', 'reemplazado', 'finalizado', 'retirado') THEN
      RAISE EXCEPTION 'PUBLISHED_FROZEN: un plan publicado no vuelve a borrador';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'closed_at' - 'closed_by_email' - 'close_reason' - 'last_reviewed_at'
                      - 'last_reviewed_by_email' - 'last_reviewed_label' - 'on_break_until' - 'updated_at'
                      - 'updated_by_email')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'closed_at' - 'closed_by_email' - 'close_reason' - 'last_reviewed_at'
                      - 'last_reviewed_by_email' - 'last_reviewed_label' - 'on_break_until' - 'updated_at'
                      - 'updated_by_email') THEN
      RAISE EXCEPTION 'PUBLISHED_FROZEN: un plan publicado no se edita; armá una versión nueva';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.published_at IS NOT NULL
     AND (to_jsonb(NEW) - 'last_reviewed_at' - 'last_reviewed_by_email' - 'last_reviewed_label' - 'updated_at'
                        - 'updated_by_email')
         = (to_jsonb(OLD) - 'last_reviewed_at' - 'last_reviewed_by_email' - 'last_reviewed_label' - 'updated_at'
                          - 'updated_by_email') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PUBLISHED_FROZEN: el plan ya está cerrado';
END;
$$;

DROP TRIGGER IF EXISTS patient_exercise_plans_guard ON public.patient_exercise_plans;
CREATE TRIGGER patient_exercise_plans_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.patient_exercise_plans
  FOR EACH ROW EXECUTE FUNCTION public.patient_exercise_plans_guard();

-- Ejercicios: solo se cargan y editan mientras su plan es un borrador, del
-- mismo paciente. Cada cambio mueve el updated_at del plan (así publicar
-- se entera si alguien cambió un ejercicio después de revisarlo) y espera
-- a una publicación en curso: lo que llega después ve el plan publicado y
-- no entra. Procedencia de la IA: el borrador tiene que ser de este
-- paciente; el ejercicio queda marcado como adaptado con IA (no se puede
-- desmarcar) y el borrador, como usado. No se borran.
CREATE OR REPLACE FUNCTION public.patient_exercises_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_status    TEXT;
  v_patient   UUID;
  v_draft     RECORD;
  v_new_draft BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: los ejercicios no se borran, se quitan';
  END IF;
  -- Primero se toma la fila del plan (espera a quien esté publicando) y
  -- después se mira su estado, ya actualizado
  UPDATE public.patient_exercise_plans SET updated_at = clock_timestamp()
   WHERE id = NEW.plan_id
   RETURNING status, patient_id INTO v_status, v_patient;
  IF v_status IS DISTINCT FROM 'borrador' THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: los ejercicios de un plan publicado no se editan; armá una versión nueva';
  END IF;
  IF v_patient IS DISTINCT FROM NEW.patient_id THEN
    RAISE EXCEPTION 'PRACTICE_PLAN: el ejercicio es de otro paciente';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_new_draft := NEW.ai_draft_id IS NOT NULL;
  ELSE
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR NEW.exercise_key IS DISTINCT FROM OLD.exercise_key THEN
      RAISE EXCEPTION 'PUBLISHED_FROZEN: el ejercicio no cambia de plan ni de identidad';
    END IF;
    IF OLD.ai_drafted THEN
      NEW.ai_drafted  := true;
      NEW.ai_draft_id := coalesce(NEW.ai_draft_id, OLD.ai_draft_id);
    END IF;
    v_new_draft := NEW.ai_draft_id IS NOT NULL AND NEW.ai_draft_id IS DISTINCT FROM OLD.ai_draft_id;
  END IF;
  IF v_new_draft THEN
    SELECT patient_id, kind, status INTO v_draft FROM public.ai_drafts WHERE id = NEW.ai_draft_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AI_DRAFT: el borrador de IA no existe';
    END IF;
    IF v_draft.patient_id IS DISTINCT FROM NEW.patient_id OR v_draft.kind <> 'adaptacion'
       OR v_draft.status NOT IN ('generado', 'usado') THEN
      RAISE EXCEPTION 'AI_DRAFT: el borrador de IA no es de este paciente o ya no se puede usar';
    END IF;
    UPDATE public.ai_drafts SET status = 'usado', used_at = now() WHERE id = NEW.ai_draft_id AND status = 'generado';
  END IF;
  IF NEW.ai_draft_id IS NOT NULL THEN
    NEW.ai_drafted := true;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patient_exercises_guard ON public.patient_exercises;
CREATE TRIGGER patient_exercises_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.patient_exercises
  FOR EACH ROW EXECUTE FUNCTION public.patient_exercises_guard();

-- Registro de práctica: el ejercicio es de un plan publicado de ese
-- paciente y no se quitó; la fecha va de hoy−2 (hora del centro) a hoy, y
-- nunca antes del día en que se publicó por primera vez ese ejercicio
-- (exercise_key). 40 registros por cuenta por día (cuentan los deshechos).
CREATE OR REPLACE FUNCTION public.exercise_practice_logs_check()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_today   DATE := (now() AT TIME ZONE 'America/Argentina/Tucuman')::DATE;
  v_ex      RECORD;
  v_first   DATE;
  v_count   INT;
BEGIN
  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'PRACTICE_LOG: falta la cuenta que la anota';
  END IF;
  SELECT e.patient_id, e.plan_id, e.exercise_key, e.removed_at, p.status, p.patient_id AS plan_patient
    INTO v_ex
    FROM public.patient_exercises e JOIN public.patient_exercise_plans p ON p.id = e.plan_id
   WHERE e.id = NEW.exercise_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRACTICE_LOG: el ejercicio no existe';
  END IF;
  IF v_ex.status <> 'publicado' OR v_ex.removed_at IS NOT NULL
     OR v_ex.patient_id IS DISTINCT FROM NEW.patient_id OR v_ex.plan_patient IS DISTINCT FROM NEW.patient_id
     OR v_ex.plan_id IS DISTINCT FROM NEW.plan_id OR v_ex.exercise_key IS DISTINCT FROM NEW.exercise_key THEN
    RAISE EXCEPTION 'PRACTICE_LOG: el ejercicio no está en el plan publicado de este paciente';
  END IF;
  SELECT min((p.published_at AT TIME ZONE 'America/Argentina/Tucuman')::DATE) INTO v_first
    FROM public.patient_exercises e JOIN public.patient_exercise_plans p ON p.id = e.plan_id
   WHERE e.patient_id = NEW.patient_id AND e.exercise_key = NEW.exercise_key AND p.published_at IS NOT NULL;
  IF NEW.practiced_on > v_today OR NEW.practiced_on < v_today - 2 THEN
    RAISE EXCEPTION 'PRACTICE_DATE: se puede anotar hoy, ayer o anteayer';
  END IF;
  IF v_first IS NULL OR NEW.practiced_on < v_first THEN
    RAISE EXCEPTION 'PRACTICE_DATE: ese día todavía no tenían este ejercicio';
  END IF;
  SELECT count(*) INTO v_count FROM public.exercise_practice_logs
   WHERE account_id = NEW.account_id
     AND created_at >= (v_today::TIMESTAMP AT TIME ZONE 'America/Argentina/Tucuman');
  IF v_count >= 40 THEN
    RAISE EXCEPTION 'PRACTICE_LIMIT: llegaste al máximo de anotaciones por hoy';
  END IF;
  NEW.created_at := now();
  NEW.voided_at  := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exercise_practice_logs_check ON public.exercise_practice_logs;
CREATE TRIGGER exercise_practice_logs_check
  BEFORE INSERT ON public.exercise_practice_logs
  FOR EACH ROW EXECUTE FUNCTION public.exercise_practice_logs_check();

-- Registros: solo se pueden deshacer (una vez). Notas: no cambian. En los
-- dos, la única otra excepción es que la cuenta pase a NULL (Postgres hace
-- el ON DELETE SET NULL de una cuenta borrada como un UPDATE). No se borran.
CREATE OR REPLACE FUNCTION public.practice_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: los registros de práctica no se borran';
  END IF;
  IF NEW.account_id IS NULL AND OLD.account_id IS NOT NULL
     AND (to_jsonb(NEW) - 'account_id') = (to_jsonb(OLD) - 'account_id') THEN
    RETURN NEW;
  END IF;
  -- Por jsonb: las notas no tienen voided_at (OLD.voided_at fallaría en ellas)
  IF TG_TABLE_NAME = 'exercise_practice_logs'
     AND (to_jsonb(OLD) ->> 'voided_at') IS NULL AND (to_jsonb(NEW) ->> 'voided_at') IS NOT NULL
     AND (to_jsonb(NEW) - 'voided_at') = (to_jsonb(OLD) - 'voided_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PUBLISHED_FROZEN: los registros de práctica no se editan';
END;
$$;

DROP TRIGGER IF EXISTS exercise_practice_logs_append_only ON public.exercise_practice_logs;
CREATE TRIGGER exercise_practice_logs_append_only
  BEFORE UPDATE OR DELETE ON public.exercise_practice_logs
  FOR EACH ROW EXECUTE FUNCTION public.practice_append_only();

DROP TRIGGER IF EXISTS exercise_practice_notes_append_only ON public.exercise_practice_notes;
CREATE TRIGGER exercise_practice_notes_append_only
  BEFORE UPDATE OR DELETE ON public.exercise_practice_notes
  FOR EACH ROW EXECUTE FUNCTION public.practice_append_only();

-- Notas: sobre una práctica vigente del mismo paciente
CREATE OR REPLACE FUNCTION public.exercise_practice_notes_check()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'PRACTICE_LOG: falta la cuenta que escribe la nota';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exercise_practice_logs l
                 WHERE l.id = NEW.log_id AND l.patient_id = NEW.patient_id AND l.voided_at IS NULL) THEN
    RAISE EXCEPTION 'PRACTICE_LOG: esa práctica ya no está';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS exercise_practice_notes_check ON public.exercise_practice_notes;
CREATE TRIGGER exercise_practice_notes_check
  BEFORE INSERT ON public.exercise_practice_notes
  FOR EACH ROW EXECUTE FUNCTION public.exercise_practice_notes_check();

-- Devoluciones: solo se pueden retirar (una vez). Medallas: solo anular
-- (una vez). No se borran.
CREATE OR REPLACE FUNCTION public.practice_withdraw_only()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_cols TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: no se borra; se retira o se anula con motivo';
  END IF;
  IF TG_TABLE_NAME = 'patient_practice_feedback' THEN
    v_cols := ARRAY['withdrawn_at', 'withdrawn_by_email', 'withdraw_reason'];
  ELSE
    v_cols := ARRAY['voided_at', 'voided_by_email', 'void_reason'];
  END IF;
  IF (to_jsonb(OLD) ->> v_cols[1]) IS NOT NULL THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: ya estaba retirado o anulado';
  END IF;
  IF (to_jsonb(NEW) - v_cols) IS DISTINCT FROM (to_jsonb(OLD) - v_cols) THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: no se edita; se retira o se anula con motivo';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patient_practice_feedback_frozen ON public.patient_practice_feedback;
CREATE TRIGGER patient_practice_feedback_frozen
  BEFORE UPDATE OR DELETE ON public.patient_practice_feedback
  FOR EACH ROW EXECUTE FUNCTION public.practice_withdraw_only();

DROP TRIGGER IF EXISTS patient_medals_frozen ON public.patient_medals;
CREATE TRIGGER patient_medals_frozen
  BEFORE UPDATE OR DELETE ON public.patient_medals
  FOR EACH ROW EXECUTE FUNCTION public.practice_withdraw_only();

-- Si el plan de una meta sigue vigente: publicado, en borrador o una versión
-- anterior del publicado (su cadena de supersedes_id: las metas de las
-- versiones que reemplazó siguen activas). En la cadena solo hay versiones
-- reemplazadas: al publicar, supersedes_id es el plan que de verdad se
-- reemplaza (practice_publish_plan), nunca uno finalizado o retirado. Una
-- meta sin plan no depende de ninguno (eso lo mira quien llama). Lo mismo
-- que planOpen() del servidor.
CREATE OR REPLACE FUNCTION public.practice_plan_open(p_plan UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH RECURSIVE chain AS (
    SELECT p.id, p.patient_id, p.supersedes_id, 1 AS depth
      FROM public.patient_exercise_plans p
     WHERE p.status = 'publicado'
       AND p.patient_id = (SELECT x.patient_id FROM public.patient_exercise_plans x WHERE x.id = p_plan)
    UNION ALL
    SELECT p.id, p.patient_id, p.supersedes_id, c.depth + 1
      FROM chain c JOIN public.patient_exercise_plans p ON p.id = c.supersedes_id AND p.patient_id = c.patient_id
     WHERE c.depth < 1000
  )
  SELECT EXISTS (SELECT 1 FROM public.patient_exercise_plans p
                  WHERE p.id = p_plan AND p.status IN ('publicado', 'borrador'))
      OR EXISTS (SELECT 1 FROM chain c WHERE c.id = p_plan);
$$;

REVOKE ALL ON FUNCTION public.practice_plan_open(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_plan_open(UUID) TO service_role;

-- Metas: una meta nueva empieza como borrador y se edita; su plan (si
-- tiene) es de ese paciente y está publicado o en borrador. Una en borrador
-- se publica solo si su plan sigue vigente (practice_plan_open), la de un
-- plan en borrador solo junto con él (practice_publish_plan) y, si su
-- plan se cerró (retirado o finalizado), queda "cambiada". Una activa solo pasa a lograda (con su
-- devolución) o a cambiada, o se marca "Todavía no". Una lograda cuya
-- devolución se retiró vuelve a activa si su plan sigue vigente (o no tiene
-- plan) y, si no, queda "cambiada". Cambiada no cambia más. No se borran.
CREATE OR REPLACE FUNCTION public.patient_goals_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_open     BOOLEAN;
  v_new_plan BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: las metas no se borran; se cambian';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_new_plan := NEW.plan_id IS NOT NULL;
  ELSE
    IF NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
      RAISE EXCEPTION 'PUBLISHED_FROZEN: la meta no cambia de paciente';
    END IF;
    v_new_plan := NEW.plan_id IS NOT NULL AND NEW.plan_id IS DISTINCT FROM OLD.plan_id;
  END IF;
  -- Al cargarla o cambiarla de plan: un plan de este paciente, publicado o en borrador
  IF v_new_plan
     AND NOT EXISTS (SELECT 1 FROM public.patient_exercise_plans p
                     WHERE p.id = NEW.plan_id AND p.patient_id = NEW.patient_id
                       AND p.status IN ('publicado', 'borrador')) THEN
    RAISE EXCEPTION 'PRACTICE_GOAL_PLAN: el plan de la meta ya se cerró o es de otro paciente';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'borrador' THEN
      RAISE EXCEPTION 'PRACTICE_GOAL: una meta nueva empieza como borrador';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'borrador' THEN
    IF NEW.status = 'activa' THEN
      IF NEW.plan_id IS NOT NULL AND NOT public.practice_plan_open(NEW.plan_id) THEN
        RAISE EXCEPTION 'PRACTICE_GOAL_PLAN: el plan de la meta ya se cerró';
      END IF;
      -- La de un plan en borrador sale junto con él (practice_publish_plan
      -- lo publica antes de activarla): sola, quedaría a la vista aunque
      -- después el borrador se descarte
      IF NEW.plan_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.patient_exercise_plans p
                                              WHERE p.id = NEW.plan_id AND p.status = 'borrador') THEN
        RAISE EXCEPTION 'PRACTICE_GOAL_WITH_PLAN: la meta se publica junto con su plan en borrador';
      END IF;
    ELSIF NEW.status = 'cambiada' THEN
      IF OLD.plan_id IS NULL OR public.practice_plan_open(OLD.plan_id)
         OR (to_jsonb(NEW) - 'status' - 'changed_at' - 'changed_by_email' - 'updated_at')
            IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'changed_at' - 'changed_by_email' - 'updated_at') THEN
        RAISE EXCEPTION 'PRACTICE_GOAL: una meta en borrador solo se publica (queda cambiada si se cierra su plan)';
      END IF;
    ELSIF NEW.status <> 'borrador' THEN
      RAISE EXCEPTION 'PRACTICE_GOAL: una meta en borrador solo se publica';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'activa' THEN
    IF NEW.status NOT IN ('activa', 'lograda', 'cambiada') THEN
      RAISE EXCEPTION 'PRACTICE_GOAL: una meta activa solo se logra o se cambia';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'achieved_at' - 'feedback_id' - 'changed_at' - 'changed_by_email'
                      - 'met_notice_dismissed_at' - 'updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'achieved_at' - 'feedback_id' - 'changed_at' - 'changed_by_email'
                      - 'met_notice_dismissed_at' - 'updated_at') THEN
      RAISE EXCEPTION 'PUBLISHED_FROZEN: una meta publicada no se edita; cambiala por otra';
    END IF;
    RETURN NEW;
  END IF;
  -- Lograda con una devolución que se retiró: activa otra vez si su plan
  -- sigue vigente (o no tiene plan); "cambiada" si su plan ya se cerró
  IF OLD.status = 'lograda' AND NEW.status IN ('activa', 'cambiada')
     AND NEW.achieved_at IS NULL AND NEW.feedback_id IS NULL
     AND EXISTS (SELECT 1 FROM public.patient_practice_feedback f
                 WHERE f.id = OLD.feedback_id AND f.withdrawn_at IS NOT NULL) THEN
    v_open := OLD.plan_id IS NULL OR public.practice_plan_open(OLD.plan_id);
    IF NEW.status = 'activa' AND v_open
       AND (to_jsonb(NEW) - 'status' - 'achieved_at' - 'feedback_id' - 'updated_at')
           = (to_jsonb(OLD) - 'status' - 'achieved_at' - 'feedback_id' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'cambiada' AND NOT v_open
       AND (to_jsonb(NEW) - 'status' - 'achieved_at' - 'feedback_id' - 'changed_at' - 'changed_by_email' - 'updated_at')
           = (to_jsonb(OLD) - 'status' - 'achieved_at' - 'feedback_id' - 'changed_at' - 'changed_by_email' - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'PUBLISHED_FROZEN: la meta ya está cerrada';
END;
$$;

DROP TRIGGER IF EXISTS patient_goals_guard ON public.patient_goals;
CREATE TRIGGER patient_goals_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.patient_goals
  FOR EACH ROW EXECUTE FUNCTION public.patient_goals_guard();

-- Borradores de la IA: solo pasan de "generado" a "usado" o "descartado". No se borran.
CREATE OR REPLACE FUNCTION public.ai_drafts_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: los borradores de IA no se borran';
  END IF;
  IF OLD.status <> 'generado' OR NEW.status NOT IN ('generado', 'usado', 'descartado')
     OR (to_jsonb(NEW) - 'status' - 'used_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'used_at') THEN
    RAISE EXCEPTION 'PUBLISHED_FROZEN: un borrador de IA solo se marca como usado o descartado';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_drafts_guard ON public.ai_drafts;
CREATE TRIGGER ai_drafts_guard
  BEFORE UPDATE OR DELETE ON public.ai_drafts
  FOR EACH ROW EXECUTE FUNCTION public.ai_drafts_guard();


-- ── 9. Operaciones de un solo paso (solo el servidor) ──────────

-- Publicar el borrador de un plan: reemplaza el publicado (si había), copia
-- el "Visto" y la pausa de vacaciones vigente, guarda cuánto se editó cada
-- ejercicio de IA (p_edit_ratios: { id del ejercicio: 0..1 }) y publica las
-- metas en borrador del plan. supersedes_id queda en el plan que de verdad
-- reemplaza (el publicado ahora, o ninguno): el borrador pudo armarse sobre
-- una versión que después se finalizó o se retiró, y esa no vuelve a la
-- cadena del publicado (practice_plan_open: sus metas no vuelven a valer).
-- p_expected es el publicado que tenía el profesional en pantalla (NULL si
-- no había) y p_expected_updated_at, el updated_at del borrador que el
-- servidor revisó: si otra persona publicó o cambió el borrador (o uno de
-- sus ejercicios) mientras tanto, no se pisa.
DROP FUNCTION IF EXISTS public.practice_publish_plan(UUID, UUID, UUID, TEXT, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION public.practice_publish_plan(
  p_plan UUID, p_expected UUID, p_expected_updated_at TIMESTAMPTZ, p_edit_ratios JSONB,
  p_professional UUID, p_author_label TEXT, p_adolescent_ack BOOLEAN, p_email TEXT
)
RETURNS UUID
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_patient     UUID;
  v_status      TEXT;
  v_updated     TIMESTAMPTZ;
  v_live        UUID;
  v_reviewed_at TIMESTAMPTZ;
  v_reviewed_by TEXT;
  v_reviewed_lb TEXT;
  v_break       DATE;
  v_today       DATE := (now() AT TIME ZONE 'America/Argentina/Tucuman')::DATE;
BEGIN
  SELECT patient_id INTO v_patient FROM public.patient_exercise_plans WHERE id = p_plan;
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'PRACTICE_PLAN: el plan no existe';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('practice_plan:' || v_patient::text));

  -- Los ejercicios y después el plan, en el mismo orden en que los toma
  -- quien guarda un ejercicio (así no se traban entre sí)
  PERFORM 1 FROM public.patient_exercises WHERE plan_id = p_plan ORDER BY id FOR UPDATE;
  SELECT status, updated_at INTO v_status, v_updated FROM public.patient_exercise_plans WHERE id = p_plan FOR UPDATE;
  IF v_status <> 'borrador' THEN
    RAISE EXCEPTION 'PUBLISH_CONFLICT: el borrador ya no está';
  END IF;
  IF v_updated IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'PUBLISH_CONFLICT: otra persona cambió el borrador';
  END IF;
  SELECT id, last_reviewed_at, last_reviewed_by_email, last_reviewed_label, on_break_until
    INTO v_live, v_reviewed_at, v_reviewed_by, v_reviewed_lb, v_break
    FROM public.patient_exercise_plans WHERE patient_id = v_patient AND status = 'publicado';
  IF v_live IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'PUBLISH_CONFLICT: otra persona publicó una versión nueva';
  END IF;

  IF p_edit_ratios IS NOT NULL AND jsonb_typeof(p_edit_ratios) = 'object' THEN
    UPDATE public.patient_exercises e
       SET edit_ratio = round((r.value)::NUMERIC, 3)
      FROM jsonb_each_text(p_edit_ratios) r
     WHERE e.plan_id = p_plan AND e.id::TEXT = r.key;
  END IF;

  IF v_live IS NOT NULL THEN
    UPDATE public.patient_exercise_plans
       SET status = 'reemplazado', closed_at = now(), closed_by_email = p_email, close_reason = 'reemplazado',
           updated_at = now(), updated_by_email = p_email
     WHERE id = v_live;
  END IF;

  UPDATE public.patient_exercise_plans
     SET status = 'publicado', published_at = now(), published_by_email = p_email,
         professional_id = p_professional, author_label = p_author_label,
         adolescent_ack = coalesce(p_adolescent_ack, false),
         -- El que se reemplaza de verdad (no el que había al armar el borrador)
         supersedes_id = v_live,
         -- La pausa de vacaciones del plan que se reemplaza sigue en la versión nueva
         on_break_until = coalesce(on_break_until, CASE WHEN v_break > v_today THEN v_break END),
         last_reviewed_at = coalesce(last_reviewed_at, v_reviewed_at),
         last_reviewed_by_email = coalesce(last_reviewed_by_email, v_reviewed_by),
         last_reviewed_label = coalesce(last_reviewed_label, v_reviewed_lb),
         updated_at = now(), updated_by_email = p_email
   WHERE id = p_plan;

  UPDATE public.patient_goals
     SET status = 'activa', published_at = now(), published_by_email = p_email, updated_at = now()
   WHERE plan_id = p_plan AND status = 'borrador';

  RETURN p_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.practice_publish_plan(UUID, UUID, TIMESTAMPTZ, JSONB, UUID, TEXT, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_publish_plan(UUID, UUID, TIMESTAMPTZ, JSONB, UUID, TEXT, BOOLEAN, TEXT)
  TO service_role;

-- Cerrar un plan publicado: retirarlo (p_status 'retirado', por error, a
-- pedido de la familia u otro motivo) o finalizarlo (p_status y p_reason
-- 'finalizado'). Las dos cosas cierran igual: deja de verse junto con las
-- metas de su cadena de versiones (él y las que reemplazó, por
-- supersedes_id: las metas de las versiones anteriores seguían activas).
-- Las activas pasan a "cambiada" y las en borrador también (ya no se
-- podrían publicar); las logradas quedan con su devolución. Así
-- practice_plan_open(), practice_withdraw_feedback(), las reglas de las
-- metas y lo que ve la familia coinciden en que el plan ya se cerró. Solo
-- si sigue publicado. Todo o nada. La usan practice_withdraw_plan() y
-- practice_finish_plan().
CREATE OR REPLACE FUNCTION public.practice_close_plan(p_plan UUID, p_status TEXT, p_reason TEXT, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_patient UUID;
  v_chain   UUID[];
BEGIN
  IF NOT coalesce((p_status = 'finalizado' AND p_reason = 'finalizado')
                  OR (p_status = 'retirado' AND p_reason IN ('error', 'pedido_familia', 'otro')), false) THEN
    RAISE EXCEPTION 'PRACTICE_PLAN: un plan publicado se retira (con motivo) o se finaliza';
  END IF;
  SELECT patient_id INTO v_patient FROM public.patient_exercise_plans WHERE id = p_plan;
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'PRACTICE_PLAN: el plan no existe';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('practice_plan:' || v_patient::text));

  UPDATE public.patient_exercise_plans
     SET status = p_status, closed_at = now(), closed_by_email = p_email, close_reason = p_reason,
         updated_at = now(), updated_by_email = p_email
   WHERE id = p_plan AND status = 'publicado';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUBLISH_CONFLICT: el plan ya no está publicado';
  END IF;

  -- El plan y las versiones que reemplazó
  WITH RECURSIVE chain AS (
    SELECT p.id, p.supersedes_id, 1 AS depth
      FROM public.patient_exercise_plans p WHERE p.id = p_plan
    UNION ALL
    SELECT p.id, p.supersedes_id, c.depth + 1
      FROM chain c JOIN public.patient_exercise_plans p ON p.id = c.supersedes_id AND p.patient_id = v_patient
     WHERE c.depth < 1000
  )
  SELECT array_agg(c.id) INTO v_chain FROM chain c;

  UPDATE public.patient_goals
     SET status = 'cambiada', changed_at = now(), changed_by_email = p_email, updated_at = now()
   WHERE plan_id = ANY (v_chain) AND status IN ('activa', 'borrador');

  RETURN p_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.practice_close_plan(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_close_plan(UUID, TEXT, TEXT, TEXT) TO service_role;

-- Retirar un plan publicado (por error, a pedido de la familia u otro motivo)
CREATE OR REPLACE FUNCTION public.practice_withdraw_plan(p_plan UUID, p_reason TEXT, p_email TEXT)
RETURNS UUID
LANGUAGE sql SET search_path = ''
AS $$
  SELECT public.practice_close_plan(p_plan, 'retirado', p_reason, p_email);
$$;

REVOKE ALL ON FUNCTION public.practice_withdraw_plan(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_withdraw_plan(UUID, TEXT, TEXT) TO service_role;

-- Finalizar un plan publicado (terminó la etapa): se cierra como al retirarlo
CREATE OR REPLACE FUNCTION public.practice_finish_plan(p_plan UUID, p_email TEXT)
RETURNS UUID
LANGUAGE sql SET search_path = ''
AS $$
  SELECT public.practice_close_plan(p_plan, 'finalizado', 'finalizado', p_email);
$$;

REVOKE ALL ON FUNCTION public.practice_finish_plan(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_finish_plan(UUID, TEXT) TO service_role;

-- Mandar una devolución: la guarda, da por logradas las metas elegidas
-- (activas y de este paciente), entrega la medalla del profesional (si hay)
-- y marca "Visto" con el nombre de quien la firma, en el plan publicado (o,
-- si ya no hay uno, en el último que se publicó). Todo o nada.
CREATE OR REPLACE FUNCTION public.practice_send_feedback(
  p_patient UUID, p_plan UUID, p_professional UUID, p_author_label TEXT, p_body TEXT, p_for_adult TEXT,
  p_period_start DATE, p_period_end DATE, p_adolescent_ack BOOLEAN, p_review_note TEXT,
  p_goal_ids UUID[], p_medal_title TEXT, p_medal_message TEXT, p_medal_goal UUID, p_email TEXT
)
RETURNS UUID
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_id    UUID;
  v_goals UUID[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_goal_ids, '{}'::UUID[])));
  v_n     INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('practice_plan:' || p_patient::text));

  IF p_plan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.patient_exercise_plans WHERE id = p_plan AND patient_id = p_patient) THEN
    RAISE EXCEPTION 'PRACTICE_PLAN: el plan es de otro paciente';
  END IF;

  INSERT INTO public.patient_practice_feedback (
    patient_id, plan_id, professional_id, author_label, body, for_adult, period_start, period_end,
    adolescent_ack, review_note, sent_by_email
  ) VALUES (
    p_patient, p_plan, p_professional, p_author_label, p_body, p_for_adult, p_period_start, p_period_end,
    coalesce(p_adolescent_ack, false), p_review_note, p_email
  ) RETURNING id INTO v_id;

  IF cardinality(v_goals) > 0 THEN
    UPDATE public.patient_goals
       SET status = 'lograda', achieved_at = now(), feedback_id = v_id, updated_at = now()
     WHERE id = ANY (v_goals) AND patient_id = p_patient AND status = 'activa';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> cardinality(v_goals) THEN
      RAISE EXCEPTION 'PRACTICE_GOAL: alguna meta ya no está activa';
    END IF;
  END IF;

  IF p_medal_title IS NOT NULL THEN
    IF p_medal_goal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.patient_goals WHERE id = p_medal_goal AND patient_id = p_patient) THEN
      RAISE EXCEPTION 'PRACTICE_GOAL: la meta es de otro paciente';
    END IF;
    INSERT INTO public.patient_medals (patient_id, kind, code, title, plan_id, goal_id, feedback_id, message, awarded_by_email)
    VALUES (p_patient, 'profesional', 'profesional', p_medal_title, p_plan, p_medal_goal, v_id, p_medal_message, p_email);
  END IF;

  UPDATE public.patient_exercise_plans
     SET last_reviewed_at = now(), last_reviewed_by_email = p_email, last_reviewed_label = p_author_label,
         updated_at = now(), updated_by_email = p_email
   WHERE id = (SELECT p.id FROM public.patient_exercise_plans p
                WHERE p.patient_id = p_patient AND p.published_at IS NOT NULL
                ORDER BY (p.status = 'publicado') DESC, p.version DESC
                LIMIT 1);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.practice_send_feedback(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, BOOLEAN, TEXT, UUID[], TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_send_feedback(UUID, UUID, UUID, TEXT, TEXT, TEXT, DATE, DATE, BOOLEAN, TEXT, UUID[], TEXT, TEXT, UUID, TEXT)
  TO service_role;

-- Retirar una devolución: deja de verse y se deshace lo que la familia veía
-- por ella. Las metas que dio por logradas vuelven a estar activas si su
-- plan sigue vigente (o no tienen plan); las de un plan que ya se cerró
-- (finalizado, retirado o una versión anterior de uno que ya no está)
-- quedan "cambiada", así la familia no las vuelve a ver. La medalla del
-- profesional que entregó queda anulada ("devolución retirada"). Solo si
-- seguía vigente. Todo o nada.
CREATE OR REPLACE FUNCTION public.practice_withdraw_feedback(p_feedback UUID, p_reason TEXT, p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql SET search_path = ''
AS $$
DECLARE
  v_patient UUID;
BEGIN
  SELECT patient_id INTO v_patient FROM public.patient_practice_feedback WHERE id = p_feedback;
  IF v_patient IS NULL THEN
    RAISE EXCEPTION 'PRACTICE_FEEDBACK: la devolución no existe';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('practice_plan:' || v_patient::text));

  UPDATE public.patient_practice_feedback
     SET withdrawn_at = now(), withdrawn_by_email = p_email, withdraw_reason = p_reason
   WHERE id = p_feedback AND withdrawn_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRACTICE_FEEDBACK: ya estaba retirada';
  END IF;

  UPDATE public.patient_goals g
     SET status = 'activa', achieved_at = NULL, feedback_id = NULL, updated_at = now()
   WHERE g.feedback_id = p_feedback AND g.status = 'lograda'
     AND (g.plan_id IS NULL OR public.practice_plan_open(g.plan_id));
  UPDATE public.patient_goals g
     SET status = 'cambiada', achieved_at = NULL, feedback_id = NULL, changed_at = now(), changed_by_email = p_email,
         updated_at = now()
   WHERE g.feedback_id = p_feedback AND g.status = 'lograda';

  UPDATE public.patient_medals
     SET voided_at = now(), voided_by_email = p_email, void_reason = 'devolución retirada'
   WHERE feedback_id = p_feedback AND kind = 'profesional' AND voided_at IS NULL;

  RETURN p_feedback;
END;
$$;

REVOKE ALL ON FUNCTION public.practice_withdraw_feedback(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_withdraw_feedback(UUID, TEXT, TEXT) TO service_role;

-- Bandeja y ficha: por paciente, lo que la familia anotó después del último
-- "Visto" (de cualquier versión del plan) y desde p_since (NULL: sin
-- límite): prácticas vigentes y la más vieja, comentarios, "Me costó",
-- comentarios con palabras de riesgo y el primero. Vienen los pacientes con
-- algo pendiente y los de p_patients (aunque no tengan nada); con p_only,
-- solo los de p_patients (la ficha de un paciente: no recorre los demás).
-- Los de riesgo primero: una fila por paciente, así nada nuevo queda afuera
-- por el tope de filas de la API.
DROP FUNCTION IF EXISTS public.practice_pending(TIMESTAMPTZ, UUID[]);
CREATE OR REPLACE FUNCTION public.practice_pending(p_since TIMESTAMPTZ, p_patients UUID[], p_only BOOLEAN)
RETURNS TABLE (
  patient_id UUID, last_reviewed_at TIMESTAMPTZ, on_break_until DATE, logs INT, first_log DATE,
  comments INT, costo INT, risk INT, first_note TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path = ''
AS $$
  WITH reviewed AS (
    SELECT p.patient_id AS pid,
           max(p.last_reviewed_at) AS reviewed_at,
           max(p.on_break_until) FILTER (WHERE p.status = 'publicado') AS break_until
      FROM public.patient_exercise_plans p
     WHERE p.published_at IS NOT NULL
       AND (NOT coalesce(p_only, false) OR p.patient_id = ANY (coalesce(p_patients, '{}'::UUID[])))
     GROUP BY p.patient_id
  ),
  l AS (
    SELECT x.patient_id AS pid, count(*)::INT AS n, min(x.practiced_on) AS first_on
      FROM public.exercise_practice_logs x JOIN reviewed r ON r.pid = x.patient_id
     WHERE x.voided_at IS NULL
       AND (NOT coalesce(p_only, false) OR x.patient_id = ANY (coalesce(p_patients, '{}'::UUID[])))
       AND (p_since IS NULL OR x.created_at >= p_since)
       AND (r.reviewed_at IS NULL OR x.created_at > r.reviewed_at)
     GROUP BY x.patient_id
  ),
  n AS (
    SELECT x.patient_id AS pid,
           (count(*) FILTER (WHERE x.comment IS NOT NULL))::INT AS comments,
           (count(*) FILTER (WHERE x.result = 'costo'))::INT AS costo,
           (count(*) FILTER (WHERE x.risk_flag))::INT AS risk,
           min(x.created_at) AS first_at
      FROM public.exercise_practice_notes x JOIN reviewed r ON r.pid = x.patient_id
     WHERE (x.comment IS NOT NULL OR x.result = 'costo' OR x.risk_flag)
       AND (NOT coalesce(p_only, false) OR x.patient_id = ANY (coalesce(p_patients, '{}'::UUID[])))
       AND (p_since IS NULL OR x.created_at >= p_since)
       AND (r.reviewed_at IS NULL OR x.created_at > r.reviewed_at)
     GROUP BY x.patient_id
  )
  SELECT r.pid, r.reviewed_at, r.break_until, coalesce(l.n, 0), l.first_on,
         coalesce(n.comments, 0), coalesce(n.costo, 0), coalesce(n.risk, 0), n.first_at
    FROM reviewed r
    LEFT JOIN l ON l.pid = r.pid
    LEFT JOIN n ON n.pid = r.pid
   WHERE l.pid IS NOT NULL OR n.pid IS NOT NULL OR r.pid = ANY (coalesce(p_patients, '{}'::UUID[]))
   ORDER BY coalesce(n.risk, 0) DESC, l.first_on NULLS LAST, r.pid;
$$;

REVOKE ALL ON FUNCTION public.practice_pending(TIMESTAMPTZ, UUID[], BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_pending(TIMESTAMPTZ, UUID[], BOOLEAN) TO service_role;

-- Días con práctica (vigente) de cada paciente desde p_from (NULL: todos),
-- con cuántas prácticas hubo cada día (en orden). Una fila por paciente:
-- el resumen de la ficha y el progreso de las metas no dependen del tope de
-- filas de la API.
CREATE OR REPLACE FUNCTION public.practice_days(p_patients UUID[], p_from DATE)
RETURNS TABLE (patient_id UUID, days DATE[], counts INT[])
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT d.pid, array_agg(d.on_day ORDER BY d.on_day), array_agg(d.n ORDER BY d.on_day)
    FROM (SELECT x.patient_id AS pid, x.practiced_on AS on_day, count(*)::INT AS n
            FROM public.exercise_practice_logs x
           WHERE x.patient_id = ANY (p_patients) AND x.voided_at IS NULL
             AND (p_from IS NULL OR x.practiced_on >= p_from)
           GROUP BY x.patient_id, x.practiced_on) d
   GROUP BY d.pid;
$$;

REVOKE ALL ON FUNCTION public.practice_days(UUID[], DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_days(UUID[], DATE) TO service_role;


-- ── Seguridad (RLS) ────────────────────────────────────────────
ALTER TABLE public.ai_drafts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_exercise_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_exercises         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_practice_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_practice_notes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_practice_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_goals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_medals            ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_drafts, public.patient_exercise_plans, public.patient_exercises, public.exercise_practice_logs,
  public.exercise_practice_notes, public.patient_practice_feedback, public.patient_goals, public.patient_medals FROM anon;

-- Solo lectura. Profesionales y Dirección: todo. Administración: además, los
-- registros de práctica (cuántos y cuándo; los comentarios están en las notas)
DROP POLICY IF EXISTS "Clinical view ai drafts"         ON public.ai_drafts;
DROP POLICY IF EXISTS "Clinical view exercise plans"    ON public.patient_exercise_plans;
DROP POLICY IF EXISTS "Clinical view exercises"         ON public.patient_exercises;
DROP POLICY IF EXISTS "Staff view practice logs"        ON public.exercise_practice_logs;
DROP POLICY IF EXISTS "Clinical view practice notes"    ON public.exercise_practice_notes;
DROP POLICY IF EXISTS "Clinical view practice feedback" ON public.patient_practice_feedback;
DROP POLICY IF EXISTS "Clinical view goals"             ON public.patient_goals;
DROP POLICY IF EXISTS "Clinical view medals"            ON public.patient_medals;
CREATE POLICY "Clinical view ai drafts"         ON public.ai_drafts
  FOR SELECT TO authenticated USING (public.is_clinical());
CREATE POLICY "Clinical view exercise plans"    ON public.patient_exercise_plans
  FOR SELECT TO authenticated USING (public.is_clinical());
CREATE POLICY "Clinical view exercises"         ON public.patient_exercises
  FOR SELECT TO authenticated USING (public.is_clinical());
CREATE POLICY "Staff view practice logs"        ON public.exercise_practice_logs
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Clinical view practice notes"    ON public.exercise_practice_notes
  FOR SELECT TO authenticated USING (public.is_clinical());
CREATE POLICY "Clinical view practice feedback" ON public.patient_practice_feedback
  FOR SELECT TO authenticated USING (public.is_clinical());
CREATE POLICY "Clinical view goals"             ON public.patient_goals
  FOR SELECT TO authenticated USING (public.is_clinical());
CREATE POLICY "Clinical view medals"            ON public.patient_medals
  FOR SELECT TO authenticated USING (public.is_clinical());


-- ── Verificación rápida (tiene que dar true) ───────────────────
SELECT
  -- Las 8 tablas existen con RLS
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity
      AND c.relname IN ('ai_drafts', 'patient_exercise_plans', 'patient_exercises', 'exercise_practice_logs',
                        'exercise_practice_notes', 'patient_practice_feedback', 'patient_goals', 'patient_medals')) = 8
  -- Cada una tiene una sola policy, de lectura
  AND (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND cmd = 'SELECT'
          AND tablename IN ('ai_drafts', 'patient_exercise_plans', 'patient_exercises', 'exercise_practice_logs',
                            'exercise_practice_notes', 'patient_practice_feedback', 'patient_goals', 'patient_medals')) = 8
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND cmd <> 'SELECT'
                    AND tablename IN ('ai_drafts', 'patient_exercise_plans', 'patient_exercises', 'exercise_practice_logs',
                                      'exercise_practice_notes', 'patient_practice_feedback', 'patient_goals', 'patient_medals'))
  -- Lo clínico, solo profesionales y Dirección; los registros, el equipo
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public'
                    AND tablename IN ('ai_drafts', 'patient_exercise_plans', 'patient_exercises', 'exercise_practice_notes',
                                      'patient_practice_feedback', 'patient_goals', 'patient_medals')
                    AND coalesce(qual, '') NOT ILIKE '%is_clinical()%')
  AND NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'exercise_practice_logs'
                    AND coalesce(qual, '') NOT ILIKE '%is_admin()%')
  -- Las reglas de la base
  AND (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
        AND tgname IN ('patient_exercise_plans_guard', 'patient_exercises_guard', 'exercise_practice_logs_check',
                       'exercise_practice_logs_append_only', 'exercise_practice_notes_append_only',
                       'exercise_practice_notes_check', 'patient_practice_feedback_frozen', 'patient_medals_frozen',
                       'patient_goals_guard', 'ai_drafts_guard')) = 10
  AND (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
        AND indexname IN ('patient_exercise_plans_one_published', 'patient_exercise_plans_one_draft',
                          'exercise_practice_logs_one_per_day', 'patient_medals_constancy_uniq',
                          'patient_medals_goal_uniq')) = 5
  -- Publicar, retirar, finalizar, mandar devoluciones y las cuentas: solo el servidor
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[
        'public.practice_publish_plan(uuid, uuid, timestamptz, jsonb, uuid, text, boolean, text)',
        'public.practice_close_plan(uuid, text, text, text)',
        'public.practice_withdraw_plan(uuid, text, text)',
        'public.practice_finish_plan(uuid, text)',
        'public.practice_send_feedback(uuid, uuid, uuid, text, text, text, date, date, boolean, text, uuid[], text, text, uuid, text)',
        'public.practice_withdraw_feedback(uuid, text, text)',
        'public.practice_pending(timestamptz, uuid[], boolean)',
        'public.practice_days(uuid[], date)',
        'public.practice_plan_open(uuid)']) f(sig)
      WHERE has_function_privilege('anon', f.sig, 'EXECUTE') OR has_function_privilege('authenticated', f.sig, 'EXECUTE'))
  AS portal_practica_ok;
