import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarPlus, CheckCircle2, Loader2, Phone, Search, UserPlus, Users, XCircle } from "lucide-react";
import { selectClass } from "./fields";
import { PATIENT_TYPE_LABEL, formatShortDate, todayKey } from "@/lib/patients";
import {
  INTAKE_STATUS_COLOR, INTAKE_STATUS_LABEL, longDate,
  type IntakeRequest, type IntakeStatus, type Workshop,
} from "@/lib/agenda";

// Pestaña "Solicitudes": bandeja de solicitudes de ingreso del sitio y talleres
// informativos para familias (relevamiento, respuestas 3, 5 y 8).
// Circuito: nueva → contactada → anotada al taller → admitida (se crea la ficha).

type Props = {
  /** Abre la ficha del paciente (al admitir) */
  onOpenPatient: (patientId: string) => void;
  /** Avisa al panel que cambió la cantidad de solicitudes nuevas */
  onCountChange: (nuevas: number) => void;
};

const OPEN_STATUSES: IntakeStatus[] = ["nueva", "contactada", "taller"];

export function IntakeTab({ onOpenPatient, onCountChange }: Props) {
  const [requests, setRequests] = useState<IntakeRequest[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"abiertas" | IntakeStatus>("abiertas");
  const [query, setQuery] = useState("");
  const [openRequest, setOpenRequest] = useState<IntakeRequest | null>(null);
  const [openWorkshop, setOpenWorkshop] = useState<Workshop | "new" | null>(null);

  async function load() {
    const [r, w] = await Promise.all([
      supabase.from("intake_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("workshops").select("*").order("workshop_date", { ascending: false }),
    ]);
    if (r.error || w.error) toast.error("No se pudieron cargar las solicitudes");
    setRequests((r.data ?? []) as IntakeRequest[]);
    setWorkshops((w.data ?? []) as Workshop[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Contador de solicitudes nuevas para la pestaña del panel
  useEffect(() => {
    if (!loading) onCountChange(requests.filter((x) => x.status === "nueva").length);
  }, [requests, loading, onCountChange]);

  function patchLocal(id: string, patch: Partial<IntakeRequest>) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setOpenRequest((cur) => (cur && cur.id === id ? { ...cur, ...patch } : cur));
  }

  async function update(id: string, patch: Partial<IntakeRequest>, okMessage?: string) {
    const { error } = await supabase.from("intake_requests").update(patch).eq("id", id);
    if (error) { toast.error("No se pudo actualizar la solicitud"); return false; }
    patchLocal(id, patch);
    if (okMessage) toast.success(okMessage);
    return true;
  }

  // Admitir: se crea la ficha del paciente (o se vincula la que ya existe por DNI)
  async function admit(r: IntakeRequest) {
    const { data: existing } = await supabase.from("patients").select("id").eq("dni", r.dni);
    let patientId = (existing as { id: string }[] | null)?.[0]?.id;
    if (!patientId) {
      const { data, error } = await supabase.from("patients").insert({
        first_name: r.first_name,
        last_name: r.last_name,
        dni: r.dni,
        age: r.age,
        phone: r.phone,
        email: r.email,
        patient_type: r.patient_type,
        locality: r.locality,
        referred_by: r.referred_by,
        guardian_name: r.guardian_name,
      }).select().single();
      if (error || !data) { toast.error("No se pudo crear la ficha del paciente"); return; }
      patientId = (data as { id: string }).id;
    }
    const ok = await update(r.id, { status: "admitida", patient_id: patientId }, "Paciente admitido");
    if (ok) {
      setOpenRequest(null);
      onOpenPatient(patientId);
    }
  }

  const workshopById = useMemo(() => new Map(workshops.map((w) => [w.id, w])), [workshops]);
  const upcoming = workshops.filter((w) => !w.canceled && w.workshop_date >= todayKey())
    .sort((a, b) => a.workshop_date.localeCompare(b.workshop_date));

  const counts = useMemo(() => {
    const c = new Map<IntakeStatus, number>();
    for (const r of requests) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    return c;
  }, [requests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (filter === "abiertas" ? !OPEN_STATUSES.includes(r.status) : r.status !== filter) return false;
      return !q || `${r.first_name} ${r.last_name} ${r.dni} ${r.phone}`.toLowerCase().includes(q);
    });
  }, [requests, filter, query]);

  if (loading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }

  return (
    <div className="mt-6 grid gap-8 xl:grid-cols-[1fr_320px]">
      {/* ── Bandeja ── */}
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, DNI o teléfono"
              aria-label="Buscar solicitud" className="pl-9" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filter === "abiertas"} onClick={() => setFilter("abiertas")}>
            En curso ({OPEN_STATUSES.reduce((s, k) => s + (counts.get(k) ?? 0), 0)})
          </Chip>
          {(Object.keys(INTAKE_STATUS_LABEL) as IntakeStatus[]).map((s) => (
            <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
              {INTAKE_STATUS_LABEL[s]} ({counts.get(s) ?? 0})
            </Chip>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No hay solicitudes para mostrar.</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((r) => {
                const w = r.workshop_id ? workshopById.get(r.workshop_id) : undefined;
                return (
                  <li key={r.id}>
                    <button onClick={() => setOpenRequest(r)}
                      className="grid w-full gap-1 p-4 text-left transition-colors hover:bg-[color:var(--primary-soft)]/40 md:px-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{r.last_name}, {r.first_name}</span>
                        <StatusBadge status={r.status} />
                        {r.preferred_modality === "telemedicina" && <span className="text-xs font-semibold text-[color:var(--primary-deep)]">Telemedicina</span>}
                        <span className="ml-auto text-xs text-muted-foreground">{formatShortDate(r.created_at)}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.age} años · {PATIENT_TYPE_LABEL[r.patient_type]} · {r.phone}
                        {r.guardian_name && ` · Responsable: ${r.guardian_name}`}{r.locality && ` · ${r.locality}`}
                      </div>
                      {w && (
                        <div className="text-xs font-semibold text-[color:var(--primary-deep)]">
                          Taller del {formatShortDate(w.workshop_date)}
                          {r.workshop_attended === true && " · asistió"}{r.workshop_attended === false && " · no asistió"}
                        </div>
                      )}
                      <p className="line-clamp-2 text-sm text-foreground/80">{r.reason}</p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ── Talleres ── */}
      <aside className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-[color:var(--primary-deep)]">Talleres para familias</h2>
          <Button size="sm" variant="outline" onClick={() => setOpenWorkshop("new")}>
            <CalendarPlus className="mr-1 h-3.5 w-3.5" /> Nuevo
          </Button>
        </div>
        {workshops.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Cargá la fecha del próximo taller: se muestra en la página de turnos.
          </p>
        ) : (
          <ul className="space-y-2">
            {[...upcoming, ...workshops.filter((w) => !upcoming.includes(w))].slice(0, 8).map((w) => {
              const enrolled = requests.filter((r) => r.workshop_id === w.id);
              const past = w.workshop_date < todayKey();
              return (
                <li key={w.id}>
                  <button onClick={() => setOpenWorkshop(w)}
                    className={`w-full rounded-2xl border border-border/60 bg-card p-3 text-left text-sm shadow-[var(--shadow-card)] hover:bg-[color:var(--primary-soft)]/40 ${w.canceled || past ? "opacity-60" : ""}`}>
                    <div className="font-semibold capitalize">{longDate(w.workshop_date)} · {w.start_time.slice(0, 5)} hs</div>
                    <div className="text-xs text-muted-foreground">
                      {w.canceled ? "Cancelado" : `${enrolled.length} anotada${enrolled.length === 1 ? "" : "s"}`}
                      {past && !w.canceled && ` · ${enrolled.filter((r) => r.workshop_attended).length} asistieron`}
                      {w.capacity && !w.canceled && ` · cupo ${w.capacity}`}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {openRequest && (
        <RequestDialog
          request={openRequest}
          workshops={upcoming}
          workshopById={workshopById}
          onClose={() => setOpenRequest(null)}
          onUpdate={(patch, msg) => update(openRequest.id, patch, msg)}
          onAdmit={() => admit(openRequest)}
          onOpenPatient={onOpenPatient}
        />
      )}
      {openWorkshop && (
        <WorkshopDialog
          workshop={openWorkshop === "new" ? null : openWorkshop}
          enrolled={openWorkshop === "new" ? [] : requests.filter((r) => r.workshop_id === openWorkshop.id)}
          onClose={() => setOpenWorkshop(null)}
          onSaved={() => { setOpenWorkshop(null); load(); }}
          onAttendance={(r, attended) => update(r.id, { workshop_attended: attended })}
        />
      )}
    </div>
  );
}

// ─── Detalle de una solicitud ────────────────────────────────────────────────

function RequestDialog({ request: r, workshops, workshopById, onClose, onUpdate, onAdmit, onOpenPatient }: {
  request: IntakeRequest;
  workshops: Workshop[];
  workshopById: Map<string, Workshop>;
  onClose: () => void;
  onUpdate: (patch: Partial<IntakeRequest>, okMessage?: string) => Promise<boolean>;
  onAdmit: () => Promise<void>;
  onOpenPatient: (patientId: string) => void;
}) {
  const [notes, setNotes] = useState(r.notes ?? "");
  const [workshopId, setWorkshopId] = useState(r.workshop_id ?? workshops[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const w = r.workshop_id ? workshopById.get(r.workshop_id) : undefined;
  const closed = r.status === "admitida" || r.status === "no_corresponde";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">{r.first_name} {r.last_name}</DialogTitle>
          <DialogDescription>
            Solicitud del {formatShortDate(r.created_at)} · <StatusBadge status={r.status} />
          </DialogDescription>
        </DialogHeader>

        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Item label="DNI" value={r.dni} />
          <Item label="Edad" value={`${r.age} años (${PATIENT_TYPE_LABEL[r.patient_type]})`} />
          <Item label="Teléfono" value={<a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`} className="font-semibold hover:underline"><Phone className="mr-1 inline h-3.5 w-3.5" />{r.phone}</a>} />
          <Item label="Email" value={r.email ?? "—"} />
          {r.guardian_name && <Item label="Adulto responsable" value={r.guardian_name} />}
          <Item label="Localidad" value={r.locality ?? "—"} />
          <Item label="Modalidad preferida" value={r.preferred_modality === "telemedicina" ? "Telemedicina" : "Presencial"} />
          {r.referred_by && <Item label="Derivado por" value={r.referred_by} />}
        </dl>
        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Motivo</div>
          <p className="mt-1 whitespace-pre-wrap">{r.reason}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="intake-notes">Notas internas</Label>
          <Textarea id="intake-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej: Llamado el 3/10, la madre confirma asistencia al taller" />
          {notes.trim() !== (r.notes ?? "") && (
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => run(() => onUpdate({ notes: notes.trim() || null }, "Notas guardadas"))}>Guardar notas</Button>
            </div>
          )}
        </div>

        {/* Pasos del circuito */}
        {r.status === "admitida" && r.patient_id ? (
          <Button onClick={() => { onClose(); onOpenPatient(r.patient_id!); }}
            className="w-full bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            Abrir ficha del paciente
          </Button>
        ) : !closed && (
          <div className="space-y-3 rounded-2xl border border-border/60 p-4">
            {r.status === "nueva" && (
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => run(() => onUpdate({ status: "contactada" }, "Marcada como contactada"))}>
                <Phone className="mr-1.5 h-3.5 w-3.5" /> Marcar como contactada
              </Button>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="intake-workshop">Taller informativo</Label>
              {workshops.length === 0 && !w ? (
                <p className="text-xs text-muted-foreground">No hay talleres próximos cargados (se cargan en el panel de la derecha).</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <select id="intake-workshop" value={workshopId} onChange={(e) => setWorkshopId(e.target.value)}
                    className={`${selectClass} h-9 w-auto`}>
                    {w && !workshops.includes(w) && <option value={w.id}>{formatShortDate(w.workshop_date)} (pasado)</option>}
                    {workshops.map((x) => <option key={x.id} value={x.id}>{formatShortDate(x.workshop_date)} · {x.start_time.slice(0, 5)} hs</option>)}
                  </select>
                  <Button size="sm" variant="outline" disabled={busy || !workshopId || workshopId === r.workshop_id}
                    onClick={() => run(() => onUpdate({ status: "taller", workshop_id: workshopId, workshop_attended: null }, "Anotada al taller"))}>
                    <Users className="mr-1.5 h-3.5 w-3.5" /> Anotar al taller
                  </Button>
                </div>
              )}
              {w && (
                <label className="flex w-fit cursor-pointer items-center gap-2 pt-1 text-sm">
                  <Checkbox checked={r.workshop_attended === true}
                    onCheckedChange={(v) => onUpdate({ workshop_attended: v === true })} />
                  Asistió al taller del {formatShortDate(w.workshop_date)}
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
              <Button size="sm" disabled={busy} onClick={() => run(onAdmit)}
                className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
                <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Admitir y crear ficha
              </Button>
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => {
                  if (!window.confirm("¿Marcar la solicitud como 'no corresponde'? Conviene dejar el motivo en las notas.")) return;
                  run(() => onUpdate({ status: "no_corresponde", notes: notes.trim() || r.notes }, "Solicitud cerrada"));
                }}
                className="text-[color:var(--status-occupied)]">
                <XCircle className="mr-1.5 h-3.5 w-3.5" /> No corresponde
              </Button>
            </div>
          </div>
        )}
        {r.status === "no_corresponde" && (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => run(() => onUpdate({ status: "contactada" }, "Solicitud reabierta"))}>Reabrir solicitud</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Taller: alta / edición y asistencia ─────────────────────────────────────

function WorkshopDialog({ workshop, enrolled, onClose, onSaved, onAttendance }: {
  workshop: Workshop | null;
  enrolled: IntakeRequest[];
  onClose: () => void;
  onSaved: () => void;
  onAttendance: (r: IntakeRequest, attended: boolean) => Promise<boolean>;
}) {
  const [form, setForm] = useState({
    workshop_date: workshop?.workshop_date ?? "",
    start_time: workshop?.start_time.slice(0, 5) ?? "09:00",
    place: workshop?.place ?? "Catamarca 411",
    capacity: workshop?.capacity ? String(workshop.capacity) : "",
    notes: workshop?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save(extra: Partial<Workshop> = {}) {
    if (!form.workshop_date) { toast.error("Elegí la fecha"); return; }
    setSaving(true);
    const payload = {
      workshop_date: form.workshop_date,
      start_time: form.start_time,
      place: form.place.trim() || "Catamarca 411",
      capacity: form.capacity ? Number(form.capacity) : null,
      notes: form.notes.trim() || null,
      ...extra,
    };
    const { error } = workshop
      ? await supabase.from("workshops").update(payload).eq("id", workshop.id)
      : await supabase.from("workshops").insert(payload);
    setSaving(false);
    if (error) { toast.error("No se pudo guardar el taller"); return; }
    toast.success(extra.canceled ? "Taller cancelado" : "Taller guardado");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">
            {workshop ? "Taller para familias" : "Nuevo taller"}
          </DialogTitle>
          <DialogDescription>Los talleres próximos se muestran en la página pública de turnos.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ws-date">Fecha</Label>
            <Input id="ws-date" type="date" value={form.workshop_date} onChange={(e) => setForm({ ...form, workshop_date: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-time">Hora</Label>
            <Input id="ws-time" type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-place">Lugar</Label>
            <Input id="ws-place" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-cap">Cupo (opcional)</Label>
            <Input id="ws-cap" type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-notes">Notas</Label>
          <Textarea id="ws-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        {workshop && (
          <div className="space-y-2">
            <div className="text-sm font-semibold">Familias anotadas ({enrolled.length})</div>
            {enrolled.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía nadie. Se anotan desde cada solicitud.</p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
                {enrolled.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                    <span>
                      <span className="font-semibold">{r.last_name}, {r.first_name}</span>
                      <span className="text-muted-foreground"> · {r.phone}</span>
                    </span>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                      <Checkbox checked={r.workshop_attended === true} onCheckedChange={(v) => onAttendance(r, v === true)} />
                      Asistió
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2">
          {workshop && !workshop.canceled ? (
            <Button variant="ghost" disabled={saving} onClick={() => window.confirm("¿Cancelar este taller?") && save({ canceled: true })}
              className="text-[color:var(--status-occupied)]">Cancelar taller</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cerrar</Button>
            <Button onClick={() => save()} disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              <CheckCircle2 className="mr-1.5 h-4 w-4" /> Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IntakeStatus }) {
  const c = INTAKE_STATUS_COLOR[status];
  return (
    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: c.bg, color: c.fg }}>
      {INTAKE_STATUS_LABEL[status]}
    </span>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={[
      "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
    ].join(" ")}>
      {children}
    </button>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
