import { useEffect, useState } from "react";
import { CircleCheck, CircleX, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { todayKey } from "@/lib/patients";
import { whatsappNumber } from "@/lib/reminders";
import {
  type AccessStatus, type StaffInviteResult,
  INVITE_EXPIRY_DAYS, ageOn, dniWithDots, portalStaffApi,
} from "@/lib/portalStaff";
import { samePhone } from "@/lib/portalRules";
import { InviteResultView } from "./InviteResultView";

// Acceso propio del paciente adulto (18 años o más) al Portal de familias:
// ve sus turnos y avisa si va, con su propio DNI. Se muestra al principio de
// Adultos responsables en la ficha. Lo puede usar todo el panel.

type PatientRow = {
  id: string; first_name: string; last_name: string; dni: string | null; phone: string | null;
  birth_date: string | null; discharge_date: string | null; patient_type: string | null;
  guardian_phone: string | null;
};

const SELF_AGE = 18;

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

const CHIP: Partial<Record<AccessStatus["state"], { text: (s: AccessStatus) => string; cls: string }>> = {
  invitado: { text: (s) => `Invitado al portal · vence ${s.state === "invitado" ? shortDate(s.expires_at) : ""}`, cls: "bg-[color:var(--status-pending-bg)] text-[oklch(0.45_0.11_70)]" },
  vencida: { text: () => "Invitación al portal vencida", cls: "bg-muted text-muted-foreground" },
  bloqueada: { text: () => "Invitación bloqueada por intentos", cls: "bg-[color:var(--status-occupied-bg)] text-[oklch(0.48_0.19_25)]" },
  activo: { text: () => "Portal activo", cls: "bg-[color:var(--status-available-bg)] text-[oklch(0.42_0.12_150)]" },
  pausado: { text: () => "Acceso al portal pausado", cls: "bg-muted text-muted-foreground" },
};

async function loadPatient(patientId: string): Promise<PatientRow | null> {
  const { data } = await supabase.from("patients")
    .select("id, first_name, last_name, dni, phone, birth_date, discharge_date, patient_type, guardian_phone")
    .eq("id", patientId).single();
  return (data as PatientRow | null) ?? null;
}

// rev: la ficha guardada (cambia al guardar), para releer edad, DNI y alta
export function PortalPatientAccess({ patientId, rev }: { patientId: string; rev?: unknown }) {
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!portalStaffApi.enabled) return;
    let cancelled = false;
    (async () => {
      const p = await loadPatient(patientId);
      if (cancelled || !p) return;
      setPatient(p);
      setStatus(await portalStaffApi.selfAccessStatus({ id: p.id, dni: p.dni }));
    })();
    return () => { cancelled = true; };
  }, [patientId, version, rev]);

  if (!portalStaffApi.enabled || !patient) return null;
  // Solo para mayores de edad (o adultos sin fecha de nacimiento cargada todavía)
  const age = patient.birth_date ? ageOn(patient.birth_date) : null;
  if (age !== null ? age < SELF_AGE : patient.patient_type !== "adulto") return null;
  // Con el alta cargada el portal no se puede usar
  if (patient.discharge_date && patient.discharge_date <= todayKey()) return null;

  const chip = status ? CHIP[status.state] : undefined;
  const canInvite = status?.state !== "activo" && status?.state !== "pausado";
  const label = status?.state === "invitado" ? "Reenviar invitación"
    : status?.state === "vencida" || status?.state === "bloqueada" ? "Generar una nueva invitación"
    : "Invitar al paciente al portal";

  return (
    <div className="mb-3 rounded-2xl border border-dashed border-primary/30 bg-[color:var(--primary-soft)]/40 p-3 text-sm">
      <p className="font-semibold">Acceso propio del paciente</p>
      <p className="text-xs text-muted-foreground">
        {patient.first_name} es mayor de edad: puede usar el Portal de familias con su propio DNI para ver sus turnos y avisar si va.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {chip && status && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip.cls}`}>
            <UserRound className="h-3 w-3" aria-hidden="true" /> {chip.text(status)}
          </span>
        )}
        {canInvite && (
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-full" onClick={() => setOpen(true)}>
            <UserRound className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {label}
          </Button>
        )}
      </div>
      {open && (
        <InviteSelfDialog patientId={patientId} hasPending={status?.state === "invitado"}
          onClose={() => { setOpen(false); setVersion((v) => v + 1); }} />
      )}
    </div>
  );
}

function InviteSelfDialog({ patientId, hasPending, onClose }: { patientId: string; hasPending: boolean; onClose: () => void }) {
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [identity, setIdentity] = useState<"hoy" | "antes" | null>(null);
  const [identityDate, setIdentityDate] = useState("");
  const [inPerson, setInPerson] = useState(false);
  const [channel, setChannel] = useState<"whatsapp" | "impresa">("whatsapp");
  const [expiresDays, setExpiresDays] = useState<number>(INVITE_EXPIRY_DAYS.whatsapp);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<StaffInviteResult | null>(null);
  // En fichas de cuando era chico, el teléfono suele ser el de la familia
  const [phoneOwner, setPhoneOwner] = useState<string | null>(null);
  const [phoneUnchecked, setPhoneUnchecked] = useState(false);

  // Datos frescos de la ficha al abrir (por si se acaban de cargar DNI o fecha)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // También los adultos que se quitaron de la ficha
      const [p, { data: gs, error: gErr }] = await Promise.all([
        loadPatient(patientId),
        supabase.from("patient_guardians").select("full_name, phone").eq("patient_id", patientId),
      ]);
      if (cancelled || !p) return;
      const owner = ((gs ?? []) as { full_name: string; phone: string | null }[]).find((g) => samePhone(p.phone, g.phone))?.full_name
        ?? (samePhone(p.phone, p.guardian_phone) ? "su adulto responsable" : null);
      setPatient(p);
      setPhoneOwner(owner);
      setPhoneUnchecked(!!gErr);
      if (owner || gErr || !whatsappNumber(p.phone)) { setChannel("impresa"); setExpiresDays(INVITE_EXPIRY_DAYS.impresa); }
    })();
    return () => { cancelled = true; };
  }, [patientId]);

  const waNumber = phoneOwner || phoneUnchecked ? null : whatsappNumber(patient?.phone);
  const age = patient?.birth_date ? ageOn(patient.birth_date) : null;
  const requirements = patient ? [
    { ok: !!patient.dni, text: patient.dni ? "DNI del paciente cargado" : "Falta el DNI del paciente en Datos personales" },
    { ok: !!patient.birth_date, text: patient.birth_date ? `Fecha de nacimiento cargada (${age} años)` : "Falta la fecha de nacimiento en Datos personales" },
    ...(age !== null && age < SELF_AGE ? [{ ok: false, text: "Es menor de edad: entra por su adulto responsable" }] : []),
    ...(patient.discharge_date && patient.discharge_date <= todayKey() ? [{ ok: false, text: "Tiene el alta cargada" }] : []),
  ] : [];
  const blocked = !patient || requirements.some((r) => !r.ok);
  const fullName = patient ? `${patient.first_name} ${patient.last_name}` : "";

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!patient) return;
    setError(null);
    if (!identity) { setError("Indicá cuándo se vio el DNI en persona."); return; }
    if (identity === "antes" && !identityDate) { setError("Indicá la fecha en que se vio el DNI."); return; }
    setSending(true);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await portalStaffApi.inviteSelf({
      patient: { id: patient.id, dni: patient.dni, first_name: patient.first_name, last_name: patient.last_name, phone: patient.phone },
      identity_checked_on: identity === "hoy" ? todayKey() : identityDate,
      in_person: inPerson,
      channel,
      expires_days: expiresDays,
      issued_by: session?.user?.email ?? "",
    });
    setSending(false);
    if (!r.ok) { setError(r.error); return; }
    setResult(r.data);
  }

  const radio = "flex min-h-10 cursor-pointer items-start gap-2 rounded-xl border border-border/60 p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-[color:var(--primary-soft)]";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !sending) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Invitar al paciente al portal</DialogTitle>
          <DialogDescription>
            {patient?.first_name ?? "El paciente"} va a poder ver sus turnos y avisar si va, con su propio DNI. El portal no muestra datos clínicos.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <InviteResultView result={result} personName={fullName} phone={patient?.phone ?? null}
            waNumber={waNumber} channel={channel} onClose={onClose} />
        ) : (
          <form onSubmit={generate} className="space-y-5">
            <ul className="space-y-1.5 text-sm" aria-label="Requisitos">
              {!patient && <li>Revisando…</li>}
              {requirements.map((r) => (
                <li key={r.text} className="flex items-start gap-2">
                  {r.ok
                    ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.5_0.13_150)]" aria-label="Listo" />
                    : <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.5_0.19_25)]" aria-label="Falta" />}
                  <span className={r.ok ? "" : "font-semibold"}>{r.text}</span>
                </li>
              ))}
            </ul>

            {!blocked && patient?.dni && (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-bold">Identidad de {patient.first_name}</legend>
                  <p className="rounded-xl bg-muted px-3 py-2 text-sm">
                    DNI en la ficha: <span className="font-display text-xl font-bold tracking-wide">{dniWithDots(patient.dni)}</span>
                    <span className="block text-xs text-muted-foreground">Leelo en voz alta frente al documento.</span>
                  </p>
                  <label className={radio}>
                    <input type="radio" name="self-identity" checked={identity === "hoy"} onChange={() => setIdentity("hoy")} className="mt-0.5" />
                    Vi el DNI en persona hoy
                  </label>
                  <label className={radio}>
                    <input type="radio" name="self-identity" checked={identity === "antes"} onChange={() => setIdentity("antes")} className="mt-0.5" />
                    <span className="flex-1">
                      Ya lo vimos en persona antes
                      {identity === "antes" && (
                        <Input type="date" max={todayKey()} value={identityDate} onChange={(e) => setIdentityDate(e.target.value)}
                          aria-label="Fecha en que se vio el DNI" className="mt-2 h-9" />
                      )}
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={inPerson} onChange={(e) => setInPerson(e.target.checked)} />
                    {patient.first_name} está en el centro ahora
                  </label>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-bold">Cómo se la damos</legend>
                  <label className={`${radio} ${!waNumber ? "cursor-not-allowed opacity-60" : ""}`}>
                    <input type="radio" name="self-channel" disabled={!waNumber} checked={channel === "whatsapp"} className="mt-0.5"
                      onChange={() => { setChannel("whatsapp"); setExpiresDays(INVITE_EXPIRY_DAYS.whatsapp); }} />
                    <span>
                      Por WhatsApp{patient.phone && waNumber ? ` al ${patient.phone}` : ""}
                      {phoneOwner
                        ? <span className="block text-xs">Ese teléfono también es de {phoneOwner}: el código le llegaría a esa persona. Entregala impresa o corregí el teléfono en Datos personales.</span>
                        : phoneUnchecked
                          ? <span className="block text-xs">No pudimos revisar de quién es el teléfono. Entregala impresa o probá de nuevo.</span>
                        : !waNumber
                          ? <span className="block text-xs">El teléfono del paciente no sirve para WhatsApp: corregilo en Datos personales o elegí impresa.</span>
                          : <span className="block text-xs text-muted-foreground">Confirmá con {patient.first_name} que ese número es suyo.</span>}
                    </span>
                  </label>
                  <label className={radio}>
                    <input type="radio" name="self-channel" checked={channel === "impresa"} className="mt-0.5"
                      onChange={() => { setChannel("impresa"); setExpiresDays(INVITE_EXPIRY_DAYS.impresa); }} />
                    Impresa, en mano
                  </label>
                  <div className="flex items-center gap-2 text-sm">
                    <Label htmlFor="portal-self-expires">Vence en</Label>
                    <select id="portal-self-expires" value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                      {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} días</option>)}
                    </select>
                  </div>
                </fieldset>

                {hasPending && (
                  <p className="rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm text-[oklch(0.42_0.1_70)]">
                    {patient.first_name} ya tiene una invitación pendiente: el código anterior deja de funcionar. Mandá o entregá el nuevo.
                  </p>
                )}
              </>
            )}

            {error && <p role="alert" className="rounded-xl bg-[color:var(--status-occupied-bg)] px-3 py-2 text-sm font-semibold text-[oklch(0.48_0.19_25)]">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={sending}>Cancelar</Button>
              <Button type="submit" disabled={blocked || sending} className="rounded-full">
                {sending ? "Generando…" : "Generar invitación"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
