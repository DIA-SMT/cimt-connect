/**
 * Mock data — usado mientras no hay DB propia configurada.
 * Los datos replican exactamente el schema de Supabase (types.ts).
 * Para activar: VITE_USE_MOCK=true en .env.local
 */

export type MockProfessional = {
  id: string;
  name: string;
  specialty: string;
  days: string;
  description: string;
  photo_url: string | null;
  created_at: string;
};

export type MockAppointment = {
  id: string;
  first_name: string;
  last_name: string;
  dni: string;
  age: number;
  phone: string;
  email: string | null;
  patient_type: "niño" | "adolescente" | "adulto";
  consultation_type: "primera_vez" | "seguimiento";
  reason: string;
  appointment_date: string;
  appointment_time: string;
  status: "pendiente" | "confirmado" | "cancelado";
  professional_id: string | null;
  created_at: string;
  updated_at: string;
};

export const MOCK_PROFESSIONALS: MockProfessional[] = [
  {
    id: "pro-001",
    name: "Lic. María Elena Rodríguez",
    specialty: "Fonoaudiología",
    days: "Lunes, Miércoles y Viernes",
    description:
      "Especialista en trastornos de la fluidez del habla con más de 12 años de experiencia en abordaje de la tartamudez en niños y adultos. Formada en técnicas de fluidez y aceptación.",
    photo_url: null,
    created_at: "2024-01-10T09:00:00Z",
  },
  {
    id: "pro-002",
    name: "Lic. Carlos Andrés Méndez",
    specialty: "Psicología",
    days: "Martes y Jueves",
    description:
      "Psicólogo clínico con orientación cognitivo-conductual. Trabaja los aspectos emocionales, sociales y de autoestima asociados a la disfluencia, acompañando a pacientes y familias.",
    photo_url: null,
    created_at: "2024-01-12T09:00:00Z",
  },
  {
    id: "pro-003",
    name: "Lic. Sofía Valentina Torres",
    specialty: "Fonoaudiología",
    days: "Lunes a Viernes",
    description:
      "Fonoaudióloga especializada en evaluación y diagnóstico temprano de disfluencias en primera infancia. Referente en el trabajo interdisciplinario con pediatría.",
    photo_url: null,
    created_at: "2024-02-01T09:00:00Z",
  },
  {
    id: "pro-004",
    name: "Lic. Patricio Herrera",
    specialty: "Coordinación",
    days: "Lunes a Viernes",
    description:
      "Coordinador general del CIMT. Gestiona la articulación del equipo, el seguimiento de pacientes y la vinculación con organismos municipales y educativos.",
    photo_url: null,
    created_at: "2024-01-08T09:00:00Z",
  },
];

// Helper para generar fechas relativas al día de hoy
function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  // Skip weekends when generating future dates
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() + 1);
  }
  return d.toISOString().split("T")[0];
}

export const MOCK_APPOINTMENTS: MockAppointment[] = [
  {
    id: "appt-001",
    first_name: "Luciana",
    last_name: "Gomez",
    dni: "38201456",
    age: 32,
    phone: "3814-223456",
    email: "luciana.gomez@email.com",
    patient_type: "adulto",
    consultation_type: "primera_vez",
    reason: "Noto bloqueos al hablar en situaciones de trabajo y reuniones. Quiero saber si hay tratamiento.",
    appointment_date: dateOffset(1),
    appointment_time: "08:00:00",
    status: "pendiente",
    professional_id: "pro-001",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "appt-002",
    first_name: "Martín",
    last_name: "Villagra",
    dni: "41889201",
    age: 9,
    phone: "3815-110987",
    email: null,
    patient_type: "niño",
    consultation_type: "primera_vez",
    reason: "Mi hijo tiene 9 años y repite mucho las sílabas al hablar. La maestra nos sugirió consultar.",
    appointment_date: dateOffset(1),
    appointment_time: "09:00:00",
    status: "confirmado",
    professional_id: "pro-003",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "appt-003",
    first_name: "Fernanda",
    last_name: "Ruiz",
    dni: "35674123",
    age: 17,
    phone: "3816-445678",
    email: "fernanda.ruiz@gmail.com",
    patient_type: "adolescente",
    consultation_type: "seguimiento",
    reason: "Continuación del tratamiento iniciado en marzo. Progresando bien con los ejercicios.",
    appointment_date: dateOffset(2),
    appointment_time: "10:00:00",
    status: "confirmado",
    professional_id: "pro-001",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "appt-004",
    first_name: "Roberto",
    last_name: "Páez",
    dni: "29341567",
    age: 45,
    phone: "3817-667890",
    email: null,
    patient_type: "adulto",
    consultation_type: "seguimiento",
    reason: "Sesión mensual de seguimiento. Control de técnicas de fluidez.",
    appointment_date: dateOffset(3),
    appointment_time: "11:00:00",
    status: "pendiente",
    professional_id: "pro-002",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "appt-005",
    first_name: "Valentina",
    last_name: "Suárez",
    dni: "44102938",
    age: 6,
    phone: "3818-990123",
    email: "mama.suarez@hotmail.com",
    patient_type: "niño",
    consultation_type: "primera_vez",
    reason: "Valentina tiene 6 años, empezó el jardín y la maestra nota que tartamudea mucho.",
    appointment_date: dateOffset(4),
    appointment_time: "07:30:00",
    status: "cancelado",
    professional_id: "pro-003",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "appt-006",
    first_name: "Diego",
    last_name: "Maidana",
    dni: "36789012",
    age: 28,
    phone: "3811-334455",
    email: "diego.maidana@work.com",
    patient_type: "adulto",
    consultation_type: "primera_vez",
    reason: "Tartamudeo al hablar en público. Me genera mucha ansiedad en el trabajo.",
    appointment_date: dateOffset(5),
    appointment_time: "08:30:00",
    status: "pendiente",
    professional_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];
