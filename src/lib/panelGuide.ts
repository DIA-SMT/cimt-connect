// Guía paso a paso del panel interno: una por pestaña («¿Cómo se hace?») y
// una de bienvenida la primera vez que alguien entra. Cada paso puede ser solo
// para algunos roles (Dirección, Profesional, Administración): cada uno ve lo
// que puede hacer. Los lugares se buscan por el texto del botón o del título
// (así no hace falta marcar cada botón) o por su data-tour.
// Textos claros y cortos: hasta 22 palabras por frase (lo revisan las pruebas).

import type { TourStep, TourTarget } from "./siteTour";
import type { StaffRole } from "./staff";

export type PanelStep = TourStep & { roles?: StaffRole[] };
export type PanelTab = "resumen" | "agenda" | "solicitudes" | "portal" | "pacientes" | "estadisticas" | "dashboard" | "rincon" | "equipo";

const tab = (label: string): TourTarget => ({ text: label, tag: "button", within: '[data-tour="pestanas"]' });
const btn = (label: string): TourTarget => ({ text: label, tag: "button" });

const CLINICAL: StaffRole[] = ["direccion", "profesional"];
const DIRECTOR: StaffRole[] = ["direccion"];
const ALL_PATIENTS: StaffRole[] = ["direccion", "administracion"];

// Primera vez en el panel: cómo está organizado
export const PANEL_WELCOME: PanelStep[] = [
  {
    id: "hola", title: "Te damos la bienvenida al panel",
    text: "Te mostramos cómo está organizado. En cada pestaña, el botón «¿Cómo se hace?» te explica paso a paso.",
  },
  {
    id: "pestanas", title: "Las pestañas",
    text: "Arriba están las secciones del panel. Ves las que corresponden a tu rol.",
    targets: ['[data-tour="pestanas"]'],
  },
  {
    id: "resumen", title: "Resumen",
    text: "Lo primero que ves al entrar: cómo viene el día, qué hay para resolver y lo último que se hizo.",
    targets: [tab("Resumen")],
  },
  {
    id: "agenda", title: "Agenda",
    text: "Los turnos del día, una columna por profesional. Desde acá se dan turnos y se marca la asistencia.",
    targets: [tab("Agenda")],
  },
  {
    id: "solicitudes", title: "Solicitudes", roles: ALL_PATIENTS,
    text: "Los pedidos de turno que llegan del sitio. Se contactan, se anotan al taller, se derivan y se admiten.",
    targets: [tab("Solicitudes")],
  },
  {
    id: "solicitudes-mias", title: "Solicitudes", roles: ["profesional"],
    text: "Las solicitudes que Administración te derivó, con todos los datos que dejó la familia.",
    targets: [tab("Solicitudes")],
  },
  {
    id: "portal", title: "Portal",
    text: "Lo que mandan las familias desde su cuenta: avisos, pedidos de turno y pedidos de historia clínica.",
    targets: [tab("Portal")],
  },
  {
    id: "pacientes", title: "Pacientes",
    text: "Las fichas de los pacientes. Cada ficha se abre a pantalla completa, con pestañas. Un profesional ve solo los suyos.",
    targets: [tab("Pacientes")],
  },
  {
    id: "estadisticas", title: "Estadísticas", roles: ALL_PATIENTS,
    text: "Los números del centro, por período, y el informe semanal.",
    targets: [tab("Estadísticas")],
  },
  {
    id: "equipo", title: "Equipo", roles: DIRECTOR,
    text: "Usuarios y profesionales. Acá se crean las cuentas y se elige el rol de cada persona.",
    targets: [tab("Equipo")],
  },
  {
    id: "ayuda", title: "Siempre a mano",
    text: "Cuando tengas una duda, tocá «¿Cómo se hace?». Te explica la pestaña en la que estás.",
    targets: ['[data-tour="guia-panel"]'],
  },
];

export const PANEL_GUIDES: Record<PanelTab, PanelStep[]> = {
  resumen: [
    {
      id: "hoy", title: "Tu día",
      text: "Arriba ves cómo viene el día: cuántos turnos hay, quién ya vino y cuál es el próximo.",
    },
    {
      id: "pendientes", title: "Para resolver",
      text: "Lo que hay que atender, del más urgente al menos. Cada uno tiene un botón que te lleva a resolverlo.",
    },
    {
      id: "manana", title: "Lo que viene",
      text: "Los turnos del próximo día hábil y cuántos recordatorios faltan.",
    },
    {
      id: "historial", title: "Lo último que se hizo",
      text: "Quién hizo qué y cuándo, en palabras simples. Con «Ver más» vas más atrás.",
    },
  ],
  agenda: [
    {
      id: "dia", title: "Elegir el día",
      text: "Con las flechas o el calendario cambiás de día. «Hoy» te trae al día actual.",
      targets: ['input[aria-label="Fecha de la agenda"]'],
    },
    {
      id: "mis", title: "Tu semana", roles: ["profesional"],
      text: "Ves tus turnos de lunes a viernes, una columna por día. Con las flechas pasás de semana.",
    },
    {
      id: "nuevo", title: "Dar un turno",
      text: "Tocá «Nuevo turno», buscá al paciente por nombre o DNI y elegí profesional, día y hora. El paciente tiene que tener ficha.",
      targets: [btn("Nuevo turno")],
    },
    {
      id: "grilla", title: "La grilla",
      text: "Cada columna es un profesional. Tocá un turno para abrirlo: ahí marcás si vino, si faltó o si avisó.",
      targets: ['[data-tour="agenda-grilla"]'],
    },
    {
      id: "asistencia", title: "Asistencia y prácticas",
      text: "Al marcar «Presente» se registra la práctica con su número. Si no vino, marcá «Ausente» o «Ausente justificado».",
    },
    {
      id: "manana", title: "Recordatorios",
      text: "En «Turnos de mañana» avisás a cada familia por WhatsApp o por llamada. El sistema te dice cuándo conviene llamar.",
      targets: [btn("Turnos de mañana")],
    },
    {
      id: "bloquear", title: "Bloquear un horario",
      text: "Para imprevistos: ese horario queda sin turnos. Se ve en la agenda con el motivo.",
      targets: [btn("Bloquear horario")],
    },
  ],
  solicitudes: [
    {
      id: "buscar", title: "Buscar una solicitud",
      text: "Buscá por nombre, DNI o teléfono.",
      targets: ['input[aria-label="Buscar solicitud"]'],
    },
    {
      id: "estados", title: "En qué paso está cada una",
      text: "«En curso» muestra lo pendiente. El camino es: nueva, contactada, anotada al taller y admitida.",
      targets: [btn("En curso")],
    },
    {
      id: "abrir", title: "Abrir una solicitud",
      text: "Tocá una solicitud para ver sus datos. Si es de un menor, ves al adulto responsable y su consentimiento.",
    },
    {
      id: "contactar", title: "Llamar y anotar al taller",
      text: "Llamá a la familia y tocá «Marcar como contactada». Después anotala en el próximo taller informativo.",
    },
    {
      id: "derivar", title: "Derivar a un profesional", roles: ALL_PATIENTS,
      text: "En el recuadro «Derivación», elegí qué profesional la va a atender. Queda registrado quién derivó y cuándo.",
    },
    {
      id: "derivada", title: "Tus solicitudes", roles: ["profesional"],
      text: "Administración te deriva las solicitudes que vas a atender. Acá ves solo esas, con todos sus datos.",
    },
    {
      id: "admitir", title: "Admitir",
      text: "Cuando corresponde, tocá «Admitir y crear ficha». Los datos pasan solos a la ficha del paciente.",
    },
    {
      id: "talleres", title: "Talleres para familias",
      text: "Acá cargás los talleres informativos. Después marcás quién asistió.",
      targets: [{ text: "Talleres para familias", tag: "h2" }],
    },
  ],
  portal: [
    {
      id: "bandeja", title: "La bandeja del portal",
      text: "Acá llega lo que mandan las familias desde su cuenta. El número de la pestaña es lo pendiente.",
      targets: [{ text: "Portal de familias", tag: "h2" }],
    },
    {
      id: "avisos", title: "Avisos de que no vienen",
      text: "Liberá el horario o avisale al profesional. Después marcalo como resuelto.",
      targets: [btn("Avisos de turnos")],
    },
    {
      id: "turnos", title: "Pedidos de turno",
      text: "Dale el turno desde «Dar turno» o llamá a la familia. También lo podés rechazar con un motivo.",
      targets: [btn("Pedidos de turno")],
    },
    {
      id: "hc", title: "Copias del historial",
      text: "Prepará la copia que piden y avisá cuando está lista para descargar.",
      targets: [btn("Copias del historial")],
    },
    {
      id: "invitar", title: "Invitar a una familia",
      text: "Desde la ficha del paciente, en «Adultos responsables», tocá «Invitar al portal».",
    },
    {
      id: "practica", title: "Ejercicios con IA", roles: CLINICAL,
      text: "En la ficha, pestaña Portal, armás el plan de práctica. La IA solo propone: vos revisás todo antes de publicar.",
    },
  ],
  pacientes: [
    {
      id: "buscar", title: "Buscar un paciente",
      text: "Buscá por nombre, DNI o localidad. Los filtros de abajo separan por estado y obra social.",
      targets: ['input[aria-label="Buscar paciente"]'],
    },
    {
      id: "nuevo", title: "Cargar un paciente",
      text: "Si alguien llega sin solicitud del sitio, cargalo con «Nuevo paciente».",
      targets: [btn("Nuevo paciente")],
    },
    {
      id: "excel", title: "Planilla",
      text: "«Exportar a Excel» descarga los pacientes que estás viendo.",
      targets: [btn("Exportar a Excel")],
    },
    {
      id: "ficha", title: "La ficha",
      text: "Tocá un paciente para abrir su ficha a pantalla completa. Tiene foto, estado y el botón «Guardar cambios».",
    },
    {
      id: "pestanas", title: "Las pestañas de la ficha",
      text: "Datos personales, resumen de historia clínica, turnos y derivaciones, portal y documentos.",
    },
    {
      id: "clinico", title: "Datos clínicos", roles: CLINICAL,
      text: "Diagnóstico, antecedentes, informes y evolución los cargan Profesional y Dirección.",
    },
    {
      id: "clinico-admin", title: "Datos clínicos", roles: ["administracion"],
      text: "Los datos clínicos los ves, pero los cargan Profesional y Dirección. Vos cargás contacto, adultos responsables y adjuntos.",
    },
    {
      id: "semaforo", title: "Semáforo y teléfono",
      text: "En Datos personales marcá el semáforo y el tipo de teléfono. Así la agenda sabe si conviene llamar.",
    },
    {
      id: "historial", title: "Todo queda registrado",
      text: "Cada cambio queda en el historial, con nombre, rol y fecha. Está en la pestaña Documentos.",
    },
  ],
  estadisticas: [
    {
      id: "hitos", title: "Publicar los hitos", roles: DIRECTOR,
      text: "Revisá los números del panel, corregilos si hace falta y publicalos en la página de inicio.",
      targets: [btn("Preparar publicación")],
    },
    {
      id: "informe", title: "Informe semanal",
      text: "Para la Gerencia de Datos. Se arma solo y se puede imprimir o copiar.",
      targets: [btn("Informe semanal")],
    },
    {
      id: "periodo", title: "Elegir el período",
      text: "Elegí el período y todo lo de abajo se recalcula.",
      targets: [btn("Este mes")],
    },
    {
      id: "solicitudes", title: "Solicitudes de turno",
      text: "Cuántas llegan, de dónde son y en cuánto tiempo se responden. La meta es responder en 48 horas.",
      targets: [{ text: "Solicitudes de turno", tag: "h3" }],
    },
    {
      id: "excel", title: "Exportar",
      text: "«Excel» descarga los números del período.",
      targets: [btn("Excel")],
    },
  ],
  dashboard: [
    {
      id: "resumen", title: "Dashboard",
      text: "Un resumen rápido de los turnos. Para los números completos, usá la pestaña Estadísticas.",
    },
  ],
  rincon: [
    {
      id: "nueva", title: "Sumar una recomendación",
      text: "Tocá «Nueva recomendación» y elegí la categoría: personas, películas, libros o historias de pacientes.",
      targets: [btn("Nueva recomendación")],
    },
    {
      id: "publicar", title: "Publicar",
      text: "Nada se ve en el sitio hasta marcarlo como publicado.",
    },
    {
      id: "comunidad", title: "Historias de pacientes",
      text: "Para publicar la historia de un paciente hace falta su autorización escrita. Si es menor, también la de su adulto responsable.",
    },
  ],
  equipo: [
    {
      id: "usuario", title: "Crear una cuenta", roles: DIRECTOR,
      text: "Tocá «Nuevo usuario», cargá el email, el nombre y el rol. Marcá que cambie la contraseña al entrar.",
      targets: [btn("Nuevo usuario")],
    },
    {
      id: "roles", title: "Los roles", roles: DIRECTOR,
      text: "Dirección controla todo. Administración recibe y deriva las solicitudes y ve a todos. Profesional ve solo sus pacientes.",
    },
    {
      id: "profesional", title: "Profesionales", roles: DIRECTOR,
      text: "Con «Nuevo profesional» lo sumás a la agenda. Vinculalo con su usuario para que vea «Mis turnos».",
      targets: [btn("Nuevo profesional")],
    },
  ],
};

/** Los pasos que ve este rol */
export function stepsFor(steps: PanelStep[], role: StaffRole): PanelStep[] {
  return steps.filter((s) => !s.roles || s.roles.includes(role));
}

/** Clave de "ya vio la bienvenida", por usuario (en este navegador) */
export const panelWelcomeKey = (email: string) => `cimt-panel-guia-vista:${email.trim().toLowerCase()}`;
