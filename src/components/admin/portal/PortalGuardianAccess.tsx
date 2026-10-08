import { useEffect, useMemo, useState } from "react";
import { CircleCheck, CircleX, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Guardian } from "@/lib/patients";
import { todayKey } from "@/lib/patients";
import { whatsappNumber } from "@/lib/reminders";
import {
  type AccessStatus, type RelationshipKind, type StaffInviteResult,
  INVITE_EXPIRY_DAYS, RELATIONSHIP_KIND_LABEL,
  ageOn, dniWithDots, portalStaffApi,
} from "@/lib/portalStaff";
import { InviteResultView } from "./InviteResultView";

// Acceso al Portal de familias desde la ficha: estado del acceso de cada
// adulto responsable y el botón "Invitar al portal". Se muestra en la fila de
// Adultos responsables (GuardiansSection). Lo puede usar todo el panel.

type PatientLite = {
  id: string; first_name: string; last_name: string;
  birth_date: string | null; discharge_date: string | null;
};

type Candidate = PatientLite & {
  guardian_id: string; problem: string | null; age: number | null;
  access: AccessStatus["state"] | null; // estado del portal de ese chico para este adulto
};

function eligibility(p: PatientLite, sibling = false): { problem: string | null; age: number | null } {
  if (!p.birth_date) return { problem: "Falta la fecha de nacimiento (se carga en Datos personales de la ficha)", age: null };
  const age = ageOn(p.birth_date);
  if (p.discharge_date && p.discharge_date <= todayKey()) return { problem: "Tiene el alta cargada", age };
  if (age >= 18) {
    return { problem: sibling
      ? "Es mayor de edad: puede tener su propio acceso desde su ficha («Invitar al paciente al portal»)"
      : "Es mayor de edad: puede tener su propio acceso con «Invitar al paciente al portal», arriba en esta sección", age };
  }
  return { problem: null, age };
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

const CHIP: Record<AccessStatus["state"], { text: (s: AccessStatus) => string; cls: string } | null> = {
  sin_dni: null,
  ninguno: null,
  invitado: { text: (s) => `Invitado al portal · vence ${s.state === "invitado" ? shortDate(s.expires_at) : ""}`, cls: "bg-[color:var(--status-pending-bg)] text-[oklch(0.45_0.11_70)]" },
  vencida: { text: () => "Invitación al portal vencida", cls: "bg-muted text-muted-foreground" },
  bloqueada: { text: () => "Invitación bloqueada por intentos", cls: "bg-[color:var(--status-occupied-bg)] text-[oklch(0.48_0.19_25)]" },
  activo: { text: () => "Portal activo", cls: "bg-[color:var(--status-available-bg)] text-[oklch(0.42_0.12_150)]" },
  pausado: { text: () => "Acceso al portal pausado", cls: "bg-muted text-muted-foreground" },
};

export function PortalGuardianAccess({ guardian, patientId }: { guardian: Guardian; patientId: string }) {
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    portalStaffApi.accessStatus({ id: guardian.id, dni: guardian.dni }, patientId).then((s) => { if (!cancelled) setStatus(s); });
    return () => { cancelled = true; };
  }, [guardian.id, guardian.dni, patientId, version]);

  if (!portalStaffApi.enabled) return null;

  const chip = status ? CHIP[status.state] : null;
  const label = status?.state === "invitado" ? "Reenviar invitación"
    : status?.state === "vencida" || status?.state === "bloqueada" ? "Generar una nueva invitación"
    : "Invitar al portal";
  const canInvite = status?.state !== "activo" && status?.state !== "pausado";

  return (
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
      {open && (
        <InvitePortalDialog guardian={guardian} patientId={patientId} hasPending={status?.state === "invitado"}
          onClose={() => { setOpen(false); setVersion((v) => v + 1); }} />
      )}
    </div>
  );
}

function InvitePortalDialog({ guardian, patientId, hasPending, onClose }: {
  guardian: Guardian; patientId: string; hasPending: boolean; onClose: () => void;
}) {
  const [current, setCurrent] = useState<Candidate | null>(null);
  const [siblings, setSiblings] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<"hoy" | "antes" | null>(null);
  const [identityDate, setIdentityDate] = useState("");
  const [inPerson, setInPerson] = useState(false);
  const [kind, setKind] = useState<RelationshipKind | null>(null);
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  const [consents, setConsents] = useState<string[]>([]);
  const waNumber = whatsappNumber(guardian.phone);
  const [channel, setChannel] = useState<"whatsapp" | "impresa">(waNumber ? "whatsapp" : "impresa");
  const [expiresDays, setExpiresDays] = useState<number>(waNumber ? INVITE_EXPIRY_DAYS.whatsapp : INVITE_EXPIRY_DAYS.impresa);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<StaffInviteResult | null>(null);

  const firstName = guardian.full_name.split(/\s+/)[0] ?? guardian.full_name;

  // Ficha actual y hermanos: otras fichas donde este adulto figura (activo)
  // con el mismo DNI
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cols = "id, first_name, last_name, birth_date, discharge_date";
      const { data: p } = await supabase.from("patients").select(cols).eq("id", patientId).single();
      let sibs: Candidate[] = [];
      if (guardian.dni) {
        const { data: rows } = await supabase.from("patient_guardians").select("*").eq("dni", guardian.dni).eq("active", true);
        const seen = new Set<string>();
        for (const g of (rows ?? []) as Guardian[]) {
          // Si el adulto está cargado dos veces en la misma ficha, el chico va una sola vez
          if (g.patient_id === patientId || seen.has(g.patient_id)) continue;
          seen.add(g.patient_id);
          const { data: sp } = await supabase.from("patients").select(cols).eq("id", g.patient_id).single();
          if (!sp) continue;
          const access = (await portalStaffApi.accessStatus({ id: g.id, dni: g.dni }, g.patient_id))?.state ?? null;
          sibs.push({ ...(sp as PatientLite), guardian_id: g.id, ...eligibility(sp as PatientLite, true), access });
        }
        sibs = sibs.sort((a, b) => a.first_name.localeCompare(b.first_name));
      }
      if (cancelled) return;
      if (p) setCurrent({ ...(p as PatientLite), guardian_id: guardian.id, ...eligibility(p as PatientLite), access: null });
      setSiblings(sibs);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [patientId, guardian.dni, guardian.id]);

  const selected = useMemo(() => {
    const list: Candidate[] = [];
    if (current && !current.problem) list.push(current);
    for (const s of siblings) {
      if (s.problem || s.access === "activo" || s.access === "pausado") continue;
      if (extra.includes(s.id) || s.access === "invitado") list.push(s);
    }
    return list;
  }, [current, siblings, extra]);

  const needsConsent = selected.filter((c) => (c.age ?? 0) >= 16);
  const replacesCode = hasPending || siblings.some((s) => s.access === "invitado");

  const requirements = [
    { ok: !!guardian.dni, text: guardian.dni ? `DNI de ${firstName} cargado` : `Falta el DNI de ${firstName}: cerrá este diálogo y usá «Editar» en su fila` },
    { ok: !!current && !current.problem, text: current?.problem ?? `Datos de ${current?.first_name ?? "el chico"} completos` },
  ];
  const blocked = loading || requirements.some((r) => !r.ok);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!identity) { setError("Indicá cuándo se vio el DNI en persona."); return; }
    if (identity === "antes" && !identityDate) { setError("Indicá la fecha en que se vio el DNI."); return; }
    if (!kind) { setError("Elegí el tipo de vínculo."); return; }
    if (kind === "autorizado" && authorizedBy.trim().length < 3) { setError("Indicá quién autorizó a este adulto."); return; }
    const missing = needsConsent.filter((c) => !consents.includes(c.id));
    if (missing.length) { setError(`Falta registrar la conformidad de ${missing.map((c) => c.first_name).join(" y ")}.`); return; }
    setSending(true);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await portalStaffApi.invite({
      guardian: { id: guardian.id, dni: guardian.dni, full_name: guardian.full_name, phone: guardian.phone },
      children: selected.map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, guardian_id: c.guardian_id })),
      adolescent_consents: needsConsent.map((c) => c.id),
      relationship_kind: kind,
      authorized_by: kind === "autorizado" ? authorizedBy.trim() : undefined,
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
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Invitar al Portal de familias</DialogTitle>
          <DialogDescription>
            {firstName} va a poder ver los turnos de los chicos que marques y avisar si pueden venir. El portal no muestra datos clínicos.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <InviteResultView result={result} personName={guardian.full_name} phone={guardian.phone}
            waNumber={waNumber} channel={channel} onClose={onClose} />
        ) : (
          <form onSubmit={generate} className="space-y-5">
            <ul className="space-y-1.5 text-sm" aria-label="Requisitos">
              {requirements.map((r) => (
                <li key={r.text} className="flex items-start gap-2">
                  {r.ok
                    ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.5_0.13_150)]" aria-label="Listo" />
                    : <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-[oklch(0.5_0.19_25)]" aria-label="Falta" />}
                  <span className={r.ok ? "" : "font-semibold"}>{loading ? "Revisando…" : r.text}</span>
                </li>
              ))}
            </ul>

            {!blocked && guardian.dni && (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-bold">Identidad de {firstName}</legend>
                  <p className="rounded-xl bg-muted px-3 py-2 text-sm">
                    DNI en la ficha: <span className="font-display text-xl font-bold tracking-wide">{dniWithDots(guardian.dni)}</span>
                    <span className="block text-xs text-muted-foreground">Leelo en voz alta frente al documento.</span>
                  </p>
                  <label className={radio}>
                    <input type="radio" name="identity" checked={identity === "hoy"} onChange={() => setIdentity("hoy")} className="mt-0.5" />
                    Vi el DNI en persona hoy
                  </label>
                  <label className={radio}>
                    <input type="radio" name="identity" checked={identity === "antes"} onChange={() => setIdentity("antes")} className="mt-0.5" />
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
                    {firstName} está en el centro ahora
                  </label>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-bold">Vínculo con los chicos</legend>
                  {(["representante_legal", "autorizado"] as const).map((k) => (
                    <label key={k} className={radio}>
                      <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} className="mt-0.5" />
                      {RELATIONSHIP_KIND_LABEL[k]}
                    </label>
                  ))}
                  {kind === "autorizado" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="portal-authorized-by">¿Quién lo autorizó?</Label>
                      <Input id="portal-authorized-by" value={authorizedBy} onChange={(e) => setAuthorizedBy(e.target.value)} placeholder="Ej.: la madre, Laura Gómez" />
                      <p className="text-xs text-muted-foreground">Un adulto autorizado ve turnos y avisa, pero no puede pedir la historia clínica.</p>
                    </div>
                  )}
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-bold">Chicos que va a ver</legend>
                  {current && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked disabled /> {current.first_name} {current.last_name}{current.age !== null && ` (${current.age} años)`}
                    </label>
                  )}
                  {siblings.map((s) => {
                    const hasAccess = s.access === "activo" || s.access === "pausado";
                    const pendingInvite = s.access === "invitado";
                    const fixed = !!s.problem || hasAccess || pendingInvite;
                    const note = s.problem
                      ?? (hasAccess ? `Ya tiene acceso al portal con ${firstName}.`
                        : pendingInvite ? "Tiene una invitación pendiente: queda incluido en el código nuevo." : null);
                    return (
                      <label key={s.id} className={`flex items-start gap-2 text-sm ${s.problem || hasAccess ? "text-muted-foreground" : ""}`}>
                        <input type="checkbox" disabled={fixed} checked={pendingInvite || extra.includes(s.id)} className="mt-0.5"
                          onChange={(e) => setExtra((x) => (e.target.checked ? [...x, s.id] : x.filter((id) => id !== s.id)))} />
                        <span>
                          También es responsable de {s.first_name} {s.last_name}{s.age !== null && ` (${s.age} años)`}
                          {note && <span className="block text-xs">{note}</span>}
                        </span>
                      </label>
                    );
                  })}
                  {siblings.length === 0 && (
                    <p className="text-xs text-muted-foreground">Si {firstName} es responsable de otro chico, cargale el mismo DNI en esa ficha y aparece acá.</p>
                  )}
                  {needsConsent.map((c) => (
                    <label key={c.id} className="flex items-start gap-2 rounded-xl bg-[color:var(--status-pending-bg)] p-2.5 text-sm">
                      <input type="checkbox" className="mt-0.5" checked={consents.includes(c.id)}
                        onChange={(e) => setConsents((x) => (e.target.checked ? [...x, c.id] : x.filter((id) => id !== c.id)))} />
                      {c.first_name} tiene {c.age} años: dio su conformidad para que {firstName} vea sus turnos.
                    </label>
                  ))}
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-bold">Cómo se la damos</legend>
                  <label className={`${radio} ${!waNumber ? "cursor-not-allowed opacity-60" : ""}`}>
                    <input type="radio" name="channel" disabled={!waNumber} checked={channel === "whatsapp"} className="mt-0.5"
                      onChange={() => { setChannel("whatsapp"); setExpiresDays(INVITE_EXPIRY_DAYS.whatsapp); }} />
                    <span>
                      Por WhatsApp{guardian.phone && waNumber ? ` al ${guardian.phone}` : ""}
                      {!waNumber && <span className="block text-xs">El teléfono de {firstName} no sirve para WhatsApp: corregilo con «Editar» o elegí impresa.</span>}
                    </span>
                  </label>
                  <label className={radio}>
                    <input type="radio" name="channel" checked={channel === "impresa"} className="mt-0.5"
                      onChange={() => { setChannel("impresa"); setExpiresDays(INVITE_EXPIRY_DAYS.impresa); }} />
                    Impresa, en mano
                  </label>
                  <div className="flex items-center gap-2 text-sm">
                    <Label htmlFor="portal-expires">Vence en</Label>
                    <select id="portal-expires" value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                      {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} días</option>)}
                    </select>
                  </div>
                </fieldset>
              </>
            )}

            {!blocked && replacesCode && (
              <p className="rounded-xl bg-[color:var(--status-pending-bg)] px-3 py-2 text-sm text-[oklch(0.42_0.1_70)]">
                {firstName} ya tiene una invitación pendiente: el código anterior deja de funcionar. Mandá o entregá el nuevo.
              </p>
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
