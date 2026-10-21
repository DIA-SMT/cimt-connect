import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, FileUser, Loader2, MessageCircle, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type BookedAppt, type PatientLite, NewAppointmentDialog } from "./AgendaTab";
import { type Modality, fromMinutes, longDate, toMinutes } from "@/lib/agenda";
import { type PhoneKind, PHONE_KIND_LABEL, acceptsWhatsApp } from "@/lib/contact";
import { todayKey, type ProfessionalOption } from "@/lib/patients";
import { bookedMessage, reminderPhone, reminderPhoneKind, whatsappLink } from "@/lib/reminders";

// «Dar turno» en un solo recorrido: el diálogo de Nuevo turno con el paciente
// ya elegido (y sus horarios libres) y, al guardarlo, el aviso a la familia
// por WhatsApp con el mensaje escrito (o el teléfono para llamar). Se abre al
// admitir una derivación (Solicitudes) y desde la ficha (Turnos y asistencia).
// El aviso no marca el recordatorio del día anterior: ese se manda igual.

type Contact = PatientLite & {
  phone: string; guardian_phone: string | null; guardian_name: string | null; patient_type: string;
  phone_kind: PhoneKind | null; guardian_phone_kind: PhoneKind | null;
  professional_id: string | null;
};

const CONTACT_COLS = "id, first_name, last_name, dni, phone, guardian_phone, guardian_name, patient_type, phone_kind, guardian_phone_kind, professional_id";
const PRIMARY_BTN = "bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]";

export function DarTurno({ patientId, professionals, professionalId, modality, consultationType, title, onClose, onBooked, onOpenPatient }: {
  patientId: string;
  professionals: ProfessionalOption[];
  /** Si no viene: el profesional a cargo de la ficha */
  professionalId?: string | null;
  modality?: Modality;
  /** Si no viene: primera vez si no tiene ningún turno, si no seguimiento */
  consultationType?: "primera_vez" | "seguimiento";
  title?: string;
  /** Se cerró: booked, si se llegó a dar el turno */
  onClose: (booked: boolean) => void;
  /** Se guardó el turno (para recargar la lista) */
  onBooked?: () => void;
  /** Botón «Abrir ficha» al final (desde Solicitudes) */
  onOpenPatient?: (patientId: string) => void;
}) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [type, setType] = useState<"primera_vez" | "seguimiento" | null>(consultationType ?? null);
  const [booked, setBooked] = useState<BookedAppt | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("patients").select(CONTACT_COLS).eq("id", patientId).single(),
      consultationType ? Promise.resolve({ data: [] })
        : supabase.from("appointments").select("id").eq("patient_id", patientId).neq("status", "cancelado").limit(1),
    ]).then(([p, a]) => {
      if (cancelled) return;
      if (p.error || !p.data) { toast.error("No se pudo cargar el paciente"); onClose(false); return; }
      setContact(p.data as Contact);
      if (!consultationType) setType(((a as { data: unknown[] | null }).data ?? []).length ? "seguimiento" : "primera_vez");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  if (!contact || !type) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onClose(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{title ?? "Dar turno"}</DialogTitle>
            <DialogDescription className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  if (!booked) {
    const active = (id: string | null | undefined) => !!id && professionals.some((p) => p.id === id && p.active !== false);
    const pro = active(professionalId) ? professionalId! : active(contact.professional_id) ? contact.professional_id! : "";
    return (
      <NewAppointmentDialog
        professionals={professionals}
        fixedPatient={contact}
        title={title ?? "Dar turno"}
        initial={{ professional_id: pro, date: todayKey(), time: "09:00", modality, consultation_type: type }}
        onClose={() => onClose(false)}
        onSaved={() => onBooked?.()}
        onBooked={setBooked}
      />
    );
  }

  return <BookedDialog booked={booked} contact={contact} professionals={professionals} onClose={() => onClose(true)} onOpenPatient={onOpenPatient} />;
}

// Turno dado: el resumen y avisar a la familia
function BookedDialog({ booked: b, contact, professionals, onClose, onOpenPatient }: {
  booked: BookedAppt;
  contact: Contact;
  professionals: ProfessionalOption[];
  onClose: () => void;
  onOpenPatient?: (patientId: string) => void;
}) {
  const [sent, setSent] = useState(false);
  const pro = professionals.find((p) => p.id === b.professional_id);
  const appt = {
    appointment_date: b.appointment_date, appointment_time: b.appointment_time, modality: b.modality,
    consultation_type: b.consultation_type, patients: contact,
  };
  const phone = reminderPhone(appt);
  const kind = reminderPhoneKind(appt);
  const wa = whatsappLink(appt, pro?.name, bookedMessage(appt, pro?.name, b.weekly));
  const minor = contact.patient_type !== "adulto";
  const to = minor && contact.guardian_phone && phone === contact.guardian_phone
    ? `${contact.guardian_name ?? "el adulto responsable"} (adulto responsable)`
    : `${contact.first_name} ${contact.last_name}`;
  const time = fromMinutes(toMinutes(b.appointment_time));

  function openWhatsApp() {
    if (!wa) return;
    window.open(wa, "_blank", "noopener");
    setSent(true);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-2xl text-[color:var(--primary-deep)]">
            <CalendarCheck className="h-6 w-6" aria-hidden /> Turno dado
          </DialogTitle>
          <DialogDescription>{contact.last_name}, {contact.first_name}</DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl border border-border/60 bg-[color:var(--primary-soft)]/40 p-4 text-sm">
          <p className="font-semibold first-letter:uppercase">{longDate(b.appointment_date)} a las {time} hs</p>
          <p className="text-muted-foreground">
            {pro?.name ?? "Sin profesional"} · {b.modality === "telemedicina" ? "Telemedicina" : "Presencial"}
            {" · "}{b.consultation_type === "primera_vez" ? "Primera vez" : "Seguimiento"}
            {b.weekly > 1 && ` · ${b.weekly} semanas seguidas`}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold">Avisarle a la familia</p>
          {!phone ? (
            <p className="text-sm text-muted-foreground">La ficha no tiene teléfono cargado: cargalo en Datos para poder avisar.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                A {to} · {phone}{kind && ` · ${PHONE_KIND_LABEL[kind]}`}
              </p>
              {wa ? (
                <Button onClick={openWhatsApp} className="w-full bg-[#1f8f4e] text-white hover:bg-[#18733e]">
                  <MessageCircle className="mr-1.5 h-4 w-4" /> {sent ? "Abrir WhatsApp de nuevo" : "Avisar por WhatsApp"}
                </Button>
              ) : (
                <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {acceptsWhatsApp(kind) ? "No pudimos leer el número para WhatsApp." : "Este teléfono no tiene WhatsApp."} Avisale por llamada.
                </p>
              )}
              <Button asChild variant="outline" className="w-full">
                <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone className="mr-1.5 h-4 w-4" /> Llamar</a>
              </Button>
              {sent && <p role="status" className="text-xs text-muted-foreground">Se abrió WhatsApp con el mensaje escrito: falta tocar «Enviar».</p>}
              <p className="text-xs text-muted-foreground">El recordatorio del día anterior se manda igual desde la Agenda.</p>
            </>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 pt-3">
          {onOpenPatient && (
            <Button variant="outline" onClick={() => { onClose(); onOpenPatient(contact.id); }}>
              <FileUser className="mr-1.5 h-4 w-4" /> Abrir ficha
            </Button>
          )}
          <Button onClick={onClose} className={PRIMARY_BTN}>Listo</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
