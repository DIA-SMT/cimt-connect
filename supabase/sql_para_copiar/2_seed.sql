
-- Profesionales con UUIDs fijos
INSERT INTO public.professionals (id, name, specialty, days, description, photo_url, created_at)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Lic. María Elena Rodríguez',
    'Fonoaudiología',
    'Lunes, Miércoles y Viernes',
    'Especialista en trastornos de la fluidez del habla con más de 12 años de experiencia en abordaje de la tartamudez en niños y adultos. Formada en técnicas de fluidez y aceptación.',
    NULL,
    '2024-01-10T09:00:00Z'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Lic. Carlos Andrés Méndez',
    'Psicología',
    'Martes y Jueves',
    'Psicólogo clínico con orientación cognitivo-conductual. Trabaja los aspectos emocionales, sociales y de autoestima asociados a la disfluencia, acompañando a pacientes y familias.',
    NULL,
    '2024-01-12T09:00:00Z'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Lic. Sofía Valentina Torres',
    'Fonoaudiología',
    'Lunes a Viernes',
    'Fonoaudióloga especializada en evaluación y diagnóstico temprano de disfluencias en primera infancia. Referente en el trabajo interdisciplinario con pediatría.',
    NULL,
    '2024-02-01T09:00:00Z'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'Lic. Patricio Herrera',
    'Coordinación',
    'Lunes a Viernes',
    'Coordinador general del CIMT. Gestiona la articulación del equipo, el seguimiento de pacientes y la vinculación con organismos municipales y educativos.',
    NULL,
    '2024-01-08T09:00:00Z'
  )
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  specialty   = EXCLUDED.specialty,
  days        = EXCLUDED.days,
  description = EXCLUDED.description;

-- Turnos de ejemplo (fechas relativas a hoy)
INSERT INTO public.appointments
  (first_name, last_name, dni, age, phone, email, patient_type, consultation_type, reason, appointment_date, appointment_time, status, professional_id)
VALUES
  (
    'Luciana', 'Gomez', '38201456', 32,
    '3814-223456', 'luciana.gomez@email.com',
    'adulto', 'primera_vez',
    'Noto bloqueos al hablar en situaciones de trabajo y reuniones. Quiero saber si hay tratamiento.',
    CURRENT_DATE + 1, '08:00:00', 'pendiente',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'Martín', 'Villagra', '41889201', 9,
    '3815-110987', NULL,
    'niño', 'primera_vez',
    'Mi hijo tiene 9 años y repite mucho las sílabas al hablar. La maestra nos sugirió consultar.',
    CURRENT_DATE + 1, '09:00:00', 'confirmado',
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'Fernanda', 'Ruiz', '35674123', 17,
    '3816-445678', 'fernanda.ruiz@gmail.com',
    'adolescente', 'seguimiento',
    'Continuación del tratamiento iniciado en marzo. Progresando bien con los ejercicios.',
    CURRENT_DATE + 2, '10:00:00', 'confirmado',
    '11111111-1111-1111-1111-111111111111'
  ),
  (
    'Roberto', 'Páez', '29341567', 45,
    '3817-667890', NULL,
    'adulto', 'seguimiento',
    'Sesión mensual de seguimiento. Control de técnicas de fluidez.',
    CURRENT_DATE + 3, '11:00:00', 'pendiente',
    '22222222-2222-2222-2222-222222222222'
  ),
  (
    'Valentina', 'Suárez', '44102938', 6,
    '3818-990123', 'mama.suarez@hotmail.com',
    'niño', 'primera_vez',
    'Valentina tiene 6 años, empezó el jardín y la maestra nota que tartamudea mucho.',
    CURRENT_DATE + 4, '07:30:00', 'cancelado',
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'Diego', 'Maidana', '36789012', 28,
    '3811-334455', 'diego.maidana@work.com',
    'adulto', 'primera_vez',
    'Tartamudeo al hablar en público. Me genera mucha ansiedad en el trabajo.',
    CURRENT_DATE + 5, '08:30:00', 'pendiente',
    NULL
  );
