-- ============================================================
-- CIMT Connect — Seed con modelo patients + appointments
-- Correlo DESPUÉS de 3_add_patients_table.sql
--
-- Si ya tenés datos del seed anterior (2_seed.sql), podés
-- limpiar todo primero descomentando el TRUNCATE de abajo.
-- ============================================================

-- (Opcional) Limpiar todo y empezar de cero:
-- TRUNCATE public.appointments, public.patients, public.professionals RESTART IDENTITY CASCADE;


-- ── Profesionales ─────────────────────────────────────────────

INSERT INTO public.professionals (id, name, specialty, days, description, photo_url, created_at)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Lic. María Elena Rodríguez',
    'Fonoaudiología',
    'Lunes, Miércoles y Viernes',
    'Especialista en trastornos de la fluidez del habla con más de 12 años de experiencia en abordaje de la tartamudez en niños y adultos. Formada en técnicas de fluidez y aceptación.',
    NULL, '2024-01-10T09:00:00Z'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Lic. Carlos Andrés Méndez',
    'Psicología',
    'Martes y Jueves',
    'Psicólogo clínico con orientación cognitivo-conductual. Trabaja los aspectos emocionales, sociales y de autoestima asociados a la disfluencia, acompañando a pacientes y familias.',
    NULL, '2024-01-12T09:00:00Z'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Lic. Sofía Valentina Torres',
    'Fonoaudiología',
    'Lunes a Viernes',
    'Fonoaudióloga especializada en evaluación y diagnóstico temprano de disfluencias en primera infancia. Referente en el trabajo interdisciplinario con pediatría.',
    NULL, '2024-02-01T09:00:00Z'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'Lic. Patricio Herrera',
    'Coordinación',
    'Lunes a Viernes',
    'Coordinador general del CIMT. Gestiona la articulación del equipo, el seguimiento de pacientes y la vinculación con organismos municipales y educativos.',
    NULL, '2024-01-08T09:00:00Z'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, specialty = EXCLUDED.specialty,
  days = EXCLUDED.days,  description = EXCLUDED.description;


-- ── Pacientes (registro central) ──────────────────────────────

INSERT INTO public.patients (id, first_name, last_name, dni, age, phone, email, patient_type)
VALUES
  ('aaaa0001-0000-0000-0000-000000000001', 'Luciana',   'Gomez',    '38201456', 32, '3814-223456', 'luciana.gomez@email.com',   'adulto'),
  ('aaaa0002-0000-0000-0000-000000000002', 'Martín',    'Villagra', '41889201',  9, '3815-110987', NULL,                        'niño'),
  ('aaaa0003-0000-0000-0000-000000000003', 'Fernanda',  'Ruiz',     '35674123', 17, '3816-445678', 'fernanda.ruiz@gmail.com',   'adolescente'),
  ('aaaa0004-0000-0000-0000-000000000004', 'Roberto',   'Páez',     '29341567', 45, '3817-667890', NULL,                        'adulto'),
  ('aaaa0005-0000-0000-0000-000000000005', 'Valentina', 'Suárez',   '44102938',  6, '3818-990123', 'mama.suarez@hotmail.com',   'niño'),
  ('aaaa0006-0000-0000-0000-000000000006', 'Diego',     'Maidana',  '36789012', 28, '3811-334455', 'diego.maidana@work.com',    'adulto')
ON CONFLICT (dni) DO NOTHING;


-- ── Turnos (referencian patients + professionals) ─────────────

INSERT INTO public.appointments
  (patient_id, consultation_type, reason, appointment_date, appointment_time, status, professional_id)
VALUES
  (
    'aaaa0001-0000-0000-0000-000000000001',
    'primera_vez',
    'Noto bloqueos al hablar en situaciones de trabajo y reuniones. Quiero saber si hay tratamiento.',
    CURRENT_DATE + 1, '08:00:00', 'pendiente',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'aaaa0002-0000-0000-0000-000000000002',
    'primera_vez',
    'Mi hijo tiene 9 años y repite mucho las sílabas al hablar. La maestra nos sugirió consultar.',
    CURRENT_DATE + 1, '09:00:00', 'confirmado',
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'aaaa0003-0000-0000-0000-000000000003',
    'seguimiento',
    'Continuación del tratamiento iniciado en marzo. Progresando bien con los ejercicios.',
    CURRENT_DATE + 2, '10:00:00', 'confirmado',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'aaaa0004-0000-0000-0000-000000000004',
    'seguimiento',
    'Sesión mensual de seguimiento. Control de técnicas de fluidez.',
    CURRENT_DATE + 3, '11:00:00', 'pendiente',
    '22222222-2222-2222-2222-222222222222'
  ),
  (
    'aaaa0005-0000-0000-0000-000000000005',
    'primera_vez',
    'Valentina tiene 6 años, empezó el jardín y la maestra nota que tartamudea mucho.',
    CURRENT_DATE + 4, '07:30:00', 'cancelado',
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'aaaa0006-0000-0000-0000-000000000006',
    'primera_vez',
    'Tartamudeo al hablar en público. Me genera mucha ansiedad en el trabajo.',
    CURRENT_DATE + 5, '08:30:00', 'pendiente',
    NULL
  );


-- ── Verificación ──────────────────────────────────────────────
SELECT 'professionals' AS tabla, COUNT(*) AS filas FROM public.professionals
UNION ALL
SELECT 'patients',     COUNT(*) FROM public.patients
UNION ALL
SELECT 'appointments', COUNT(*) FROM public.appointments;
