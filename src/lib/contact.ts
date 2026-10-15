// Cómo contactar a cada familia (31_ficha_contacto_semaforo.sql):
//   - tipo de teléfono: si recibe WhatsApp (mensajes y audios), si es un
//     celular sin WhatsApp o un fijo (solo llamadas);
//   - semáforo de autonomía: si quien gestiona los turnos (el paciente o su
//     adulto responsable) lee, escribe y usa el celular. El objetivo es ser
//     inclusivos: el equipo sabe de antemano si hay que llamar o ayudar.

export type PhoneKind = "whatsapp" | "celular" | "fijo";

export const PHONE_KIND_LABEL: Record<PhoneKind, string> = {
  whatsapp: "Celular con WhatsApp",
  celular: "Celular sin WhatsApp",
  fijo: "Teléfono fijo",
};

export const PHONE_KIND_HINT: Record<PhoneKind, string> = {
  whatsapp: "Recibe mensajes y audios",
  celular: "Llamadas y SMS",
  fijo: "Solo llamadas",
};

export const PHONE_KINDS = Object.keys(PHONE_KIND_LABEL) as PhoneKind[];

/** WhatsApp solo si no se sabe (dato viejo) o si dijeron que tiene */
export function acceptsWhatsApp(kind: PhoneKind | null | undefined): boolean {
  return !kind || kind === "whatsapp";
}

export type Autonomy = "verde" | "amarillo" | "rojo";

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  verde: "Verde · gestiona solo",
  amarillo: "Amarillo · necesita ayuda",
  rojo: "Rojo · llamada o en persona",
};

export const AUTONOMY_HINT: Record<Autonomy, string> = {
  verde: "Lee, escribe y usa el celular: puede gestionar sus turnos (portal, mensajes).",
  amarillo: "Necesita ayuda: preferir audios o mensajes cortos y confirmar por llamada.",
  rojo: "No maneja lectoescritura ni celular: todo por llamada o en persona.",
};

/** Colores del semáforo (punto, chip con texto oscuro sobre fondo claro) */
export const AUTONOMY_COLOR: Record<Autonomy, { dot: string; chip: string }> = {
  verde: { dot: "bg-emerald-600", chip: "border-emerald-300 bg-emerald-50 text-emerald-900" },
  amarillo: { dot: "bg-amber-500", chip: "border-amber-300 bg-amber-50 text-amber-950" },
  rojo: { dot: "bg-red-600", chip: "border-red-300 bg-red-50 text-red-900" },
};

export const AUTONOMIES = Object.keys(AUTONOMY_LABEL) as Autonomy[];

export type CaregiverRole = "principal" | "segundo";

export const CAREGIVER_ROLE_LABEL: Record<CaregiverRole, string> = {
  principal: "Principal cuidador",
  segundo: "2do responsable",
};
