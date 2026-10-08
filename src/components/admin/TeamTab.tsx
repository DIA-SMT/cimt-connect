import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Globe, ImageUp, KeyRound, Loader2, Plus, Power, User2, UserPlus, Wand2 } from "lucide-react";
import { TextAreaField, TextField, selectClass } from "./fields";
import { DISCIPLINES } from "@/lib/center";
import { ROLE_DESCRIPTION, ROLE_LABEL, usersApi, type PanelUser, type StaffRole } from "@/lib/staff";
import { PASSWORD_MIN } from "@/lib/passwords";

// Pestaña "Equipo" (solo Dirección): profesionales del centro y usuarios del panel.
// Relevamiento: 44 (fotos y descripción en el sitio), 47 (la Dirección da de alta
// y de baja a los usuarios).

type Professional = {
  id: string;
  name: string;
  specialty: string;
  license: string | null;
  days: string | null;
  description: string | null;
  photo_url: string | null;
  active: boolean;
  show_on_site: boolean;
  user_id: string | null;
  session_minutes: number;
};

type Props = {
  currentEmail: string;
  /** Avisa al panel para recargar la lista de profesionales de los selects */
  onProfessionalsChanged: () => void;
};

const SPECIALTY_SUGGESTIONS = [
  ...DISCIPLINES.map((d) => d.name),
  "Fonoaudiología — neurolingüística",
  "Fonoaudiología — especialista en tartamudez",
];

export function TeamTab({ currentEmail, onProfessionalsChanged }: Props) {
  const [pros, setPros] = useState<Professional[]>([]);
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPro, setEditingPro] = useState<Professional | "new" | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [passwordFor, setPasswordFor] = useState<PanelUser | null>(null);

  async function load() {
    const [p, u] = await Promise.all([
      supabase.from("professionals")
        .select("id, name, specialty, license, days, description, photo_url, active, show_on_site, user_id, session_minutes")
        .order("name", { ascending: true }),
      supabase.from("admins").select("user_id, email, full_name, role, active, created_at").order("created_at"),
    ]);
    if (p.error || u.error) toast.error("No se pudo cargar el equipo");
    setPros((p.data ?? []) as Professional[]);
    setUsers((u.data ?? []) as PanelUser[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const proByUser = useMemo(() => new Map(pros.filter((p) => p.user_id).map((p) => [p.user_id!, p])), [pros]);
  const userEmail = useMemo(() => new Map(users.map((u) => [u.user_id, u.email ?? ""])), [users]);

  async function changeRole(u: PanelUser, role: StaffRole) {
    const { error } = await supabase.from("admins").update({ role }).eq("user_id", u.user_id);
    if (error) {
      toast.error(error.message?.includes("LAST_DIRECTOR")
        ? "Tiene que quedar al menos un usuario de Dirección activo"
        : "No se pudo cambiar el rol");
      return;
    }
    toast.success(`${u.email} ahora es ${ROLE_LABEL[role]}`);
    setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? { ...x, role } : x)));
  }

  async function setActive(u: PanelUser, active: boolean) {
    if (!active && !window.confirm(`¿Desactivar a ${u.email}? No va a poder ingresar al panel.`)) return;
    const res = await usersApi({ action: "set_active", user_id: u.user_id, active });
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(active ? "Usuario activado" : "Usuario desactivado");
    setUsers((prev) => prev.map((x) => (x.user_id === u.user_id ? { ...x, active } : x)));
  }

  // Un usuario se vincula como máximo a un profesional (para firmar informes)
  async function linkProfessional(u: PanelUser, professionalId: string) {
    const current = proByUser.get(u.user_id);
    if (current && current.id !== professionalId) {
      await supabase.from("professionals").update({ user_id: null }).eq("id", current.id);
    }
    if (professionalId) {
      const { error } = await supabase.from("professionals").update({ user_id: u.user_id }).eq("id", professionalId);
      if (error) { toast.error("No se pudo vincular el profesional"); return; }
    }
    toast.success("Vinculación actualizada");
    load();
    onProfessionalsChanged();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-10">
      {/* ── Profesionales ── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-[color:var(--primary-deep)]">Profesionales</h2>
            <p className="text-sm text-muted-foreground">
              Aparecen en las fichas e informes. Solo los marcados "en el sitio" se muestran en la página del equipo.
            </p>
          </div>
          <Button onClick={() => setEditingPro("new")}
            className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo profesional
          </Button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
          {pros.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Todavía no hay profesionales cargados.</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {pros.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setEditingPro(p)}
                    className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-[color:var(--primary-soft)]/40">
                    <Avatar url={p.photo_url} name={p.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-bold ${p.active ? "text-foreground" : "text-muted-foreground line-through"}`}>{p.name}</span>
                        {!p.active && <Tag tone="muted">Inactivo</Tag>}
                        {p.active && p.show_on_site && <Tag tone="primary"><Globe className="h-3 w-3" /> En el sitio</Tag>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.specialty}{p.license && ` · MP ${p.license}`} · {p.session_minutes ?? 30} min
                        {p.user_id && userEmail.get(p.user_id) && ` · Usuario: ${userEmail.get(p.user_id)}`}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Usuarios del panel ── */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold text-[color:var(--primary-deep)]">Usuarios del panel</h2>
            <p className="text-sm text-muted-foreground">Quién puede ingresar y qué puede hacer.</p>
          </div>
          <Button onClick={() => setCreatingUser(true)}
            className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            <UserPlus className="mr-1.5 h-4 w-4" /> Nuevo usuario
          </Button>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
          <ul className="divide-y divide-border/60">
            {users.map((u) => {
              const isMe = u.email?.toLowerCase() === currentEmail.toLowerCase();
              const linked = proByUser.get(u.user_id);
              return (
                <li key={u.user_id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-bold ${u.active ? "" : "text-muted-foreground line-through"}`}>
                        {u.full_name || u.email}
                      </span>
                      {isMe && <Tag tone="primary">Vos</Tag>}
                      {!u.active && <Tag tone="muted">Desactivado</Tag>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.full_name ? u.email : ROLE_DESCRIPTION[u.role]}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select aria-label={`Rol de ${u.email}`} value={u.role} disabled={isMe || !u.active}
                      onChange={(e) => changeRole(u, e.target.value as StaffRole)}
                      className={`${selectClass} h-9 w-auto`}>
                      {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                    {u.role !== "administracion" && (
                      <select aria-label={`Profesional vinculado a ${u.email}`} value={linked?.id ?? ""}
                        onChange={(e) => linkProfessional(u, e.target.value)}
                        className={`${selectClass} h-9 w-auto max-w-56`}>
                        <option value="">Sin profesional vinculado</option>
                        {pros.filter((p) => p.active && (!p.user_id || p.user_id === u.user_id)).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setPasswordFor(u)} title="Asignar contraseña nueva">
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>
                    {!isMe && (
                      <Button size="sm" variant="outline" onClick={() => setActive(u, !u.active)}
                        className={u.active ? "text-[color:var(--status-occupied)]" : ""}>
                        <Power className="mr-1 h-3.5 w-3.5" /> {u.active ? "Desactivar" : "Activar"}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {editingPro && (
        <ProfessionalDialog
          professional={editingPro === "new" ? null : editingPro}
          onClose={() => setEditingPro(null)}
          onSaved={() => { setEditingPro(null); load(); onProfessionalsChanged(); }}
        />
      )}
      {creatingUser && (
        <NewUserDialog
          professionals={pros.filter((p) => p.active && !p.user_id)}
          onClose={() => setCreatingUser(false)}
          onCreated={() => { setCreatingUser(false); load(); onProfessionalsChanged(); }}
        />
      )}
      {passwordFor && <SetPasswordDialog user={passwordFor} onClose={() => setPasswordFor(null)} />}
    </div>
  );
}

// ─── Alta / edición de profesional ───────────────────────────────────────────

function ProfessionalDialog({ professional, onClose, onSaved }: {
  professional: Professional | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: professional?.name ?? "",
    specialty: professional?.specialty ?? "",
    license: professional?.license ?? "",
    days: professional?.days ?? "",
    description: professional?.description ?? "",
    photo_url: professional?.photo_url ?? "",
    active: professional?.active ?? true,
    show_on_site: professional?.show_on_site ?? false,
    session_minutes: String(professional?.session_minutes ?? 30),
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function uploadPhoto(file: File) {
    if (!file.type.startsWith("image/")) { toast.error("Elegí una imagen"); return; }
    if (file.size > 3 * 1024 * 1024) { toast.error("La imagen tiene que pesar menos de 3 MB"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const bucket = supabase.storage.from("professional-photos");
    const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (error) { toast.error("No se pudo subir la foto"); return; }
    set("photo_url", bucket.getPublicUrl(path).data.publicUrl);
  }

  async function save() {
    if (form.name.trim().length < 3) { toast.error("Indicá el nombre"); return; }
    if (form.specialty.trim().length < 3) { toast.error("Indicá la especialidad"); return; }
    if (form.show_on_site && !form.active) { toast.error("Un profesional inactivo no puede mostrarse en el sitio"); return; }
    const minutes = Number(form.session_minutes);
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 180) { toast.error("La duración de la sesión tiene que estar entre 10 y 180 minutos"); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      specialty: form.specialty.trim(),
      license: form.license.trim() || null,
      days: form.days.trim() || null,
      description: form.description.trim() || null,
      photo_url: form.photo_url || null,
      active: form.active,
      show_on_site: form.show_on_site,
      session_minutes: minutes,
    };
    const { error } = professional
      ? await supabase.from("professionals").update(payload).eq("id", professional.id)
      : await supabase.from("professionals").insert(payload);
    setSaving(false);
    if (error) { toast.error("No se pudo guardar"); return; }
    toast.success(professional ? "Profesional actualizado" : "Profesional agregado");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">
            {professional ? "Editar profesional" : "Nuevo profesional"}
          </DialogTitle>
          <DialogDescription>
            La matrícula sale en los informes impresos. La foto y la descripción solo se ven en el sitio si lo marcás.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar url={form.photo_url} name={form.name} size="lg" />
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline" disabled={uploading}>
                <label className="cursor-pointer">
                  {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageUp className="mr-1.5 h-3.5 w-3.5" />}
                  {form.photo_url ? "Cambiar foto" : "Subir foto"}
                  <input type="file" accept="image/*" className="sr-only"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
                </label>
              </Button>
              {form.photo_url && (
                <Button size="sm" variant="ghost" onClick={() => set("photo_url", "")}>Quitar</Button>
              )}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nombre (como figura en informes)" value={form.name} onChange={(v) => set("name", v)}
              placeholder="Ej: Lic. Ana Pérez" />
            <div className="space-y-1.5">
              <Label htmlFor="pro-specialty">Especialidad</Label>
              <Input id="pro-specialty" list="pro-specialties" value={form.specialty}
                onChange={(e) => set("specialty", e.target.value)} />
              <datalist id="pro-specialties">
                {SPECIALTY_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
              </datalist>
            </div>
            <TextField label="Matrícula (MP)" value={form.license} onChange={(v) => set("license", v)} placeholder="Ej: 2226" />
            <TextField label="Días de atención" value={form.days} onChange={(v) => set("days", v)} placeholder="Ej: Lunes a viernes" />
            <TextField label="Duración de la sesión (min)" type="number" value={form.session_minutes}
              onChange={(v) => set("session_minutes", v)} placeholder="30" />
          </div>
          <TextAreaField label="Descripción para el sitio" value={form.description} onChange={(v) => set("description", v)}
            placeholder="Breve presentación profesional (sin datos personales)" />
          <div className="space-y-3 rounded-2xl border border-border/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="pro-active" className="font-semibold">Activo</Label>
              <Switch id="pro-active" checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v, show_on_site: v ? f.show_on_site : false }))} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="pro-site" className="font-semibold">Mostrar en la página del equipo</Label>
                <p className="text-xs text-muted-foreground">Solo con autorización del profesional.</p>
              </div>
              <Switch id="pro-site" checked={form.show_on_site} disabled={!form.active}
                onCheckedChange={(v) => set("show_on_site", v)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving || uploading}
              className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Alta de usuario ─────────────────────────────────────────────────────────

function NewUserDialog({ professionals, onClose, onCreated }: {
  professionals: Professional[]; onClose: () => void; onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<StaffRole>("administracion");
  const [password, setPassword] = useState(generatePassword);
  const [professionalId, setProfessionalId] = useState("");
  const [mustChange, setMustChange] = useState(true);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const res = await usersApi({
      action: "create",
      email: email.trim(),
      password,
      full_name: fullName.trim() || undefined,
      role,
      professional_id: role !== "administracion" ? professionalId || null : null,
      must_change: mustChange,
    });
    setSaving(false);
    if ("error" in res) { toast.error(res.error); return; }
    setCreated(true);
  }

  if (created) {
    return (
      <Dialog open onOpenChange={(o) => { if (!o) onCreated(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Usuario creado</DialogTitle>
            <DialogDescription>
              Pasale estos datos a la persona por un medio seguro.
              {mustChange
                ? " Al ingresar por primera vez le vamos a pedir que elija una contraseña propia."
                : ' Puede cambiar la contraseña desde el panel (botón "Contraseña").'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-2xl bg-[color:var(--primary-soft)] p-4 text-sm">
            <div><span className="text-muted-foreground">Ingreso:</span> <strong>{window.location.origin}/admin</strong></div>
            <div><span className="text-muted-foreground">Email:</span> <strong>{email.trim()}</strong></div>
            <div><span className="text-muted-foreground">Contraseña inicial:</span> <strong className="font-mono">{password}</strong></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => {
              navigator.clipboard?.writeText(`Ingreso: ${window.location.origin}/admin\nEmail: ${email.trim()}\nContraseña inicial: ${password}`);
              toast.success("Copiado");
            }}>Copiar</Button>
            <Button onClick={onCreated} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">Listo</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Nuevo usuario</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nu-email">Email</Label>
              <Input id="nu-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-name">Nombre</Label>
              <Input id="nu-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Rol</legend>
            {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => (
              <label key={r} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${role === r ? "border-primary bg-[color:var(--primary-soft)]/50" : "border-border/60"}`}>
                <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1" />
                <span>
                  <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
                  <span className="block text-xs text-muted-foreground">{ROLE_DESCRIPTION[r]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {role !== "administracion" && (
            <div className="space-y-1.5">
              <Label htmlFor="nu-pro">Profesional vinculado</Label>
              <select id="nu-pro" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} className={selectClass}>
                <option value="">Ninguno</option>
                {professionals.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.specialty}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Sus informes salen firmados con ese nombre y matrícula.</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="nu-pass">Contraseña inicial</Label>
            <div className="flex gap-2">
              <Input id="nu-pass" required minLength={PASSWORD_MIN} value={password} onChange={(e) => setPassword(e.target.value)}
                className="font-mono" />
              <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())} title="Generar otra">
                <Wand2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium">Pedir que la cambie al ingresar</span>
              <span className="block text-xs text-muted-foreground">La primera vez que entre al panel va a tener que elegir una contraseña propia.</span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Crear usuario
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordDialog({ user, onClose }: { user: PanelUser; onClose: () => void }) {
  const [password, setPassword] = useState(generatePassword);
  const [mustChange, setMustChange] = useState(true);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await usersApi({ action: "set_password", user_id: user.user_id, password, must_change: mustChange });
    setSaving(false);
    if ("error" in res) { toast.error(res.error); return; }
    navigator.clipboard?.writeText(password);
    toast.success("Contraseña asignada y copiada");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-[color:var(--primary-deep)]">Contraseña nueva</DialogTitle>
          <DialogDescription>Para {user.email}. Pasásela por un medio seguro.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input value={password} onChange={(e) => setPassword(e.target.value)} minLength={PASSWORD_MIN} className="font-mono"
            aria-label="Contraseña nueva" />
          <Button type="button" variant="outline" onClick={() => setPassword(generatePassword())} title="Generar otra">
            <Wand2 className="h-4 w-4" />
          </Button>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium">Pedir que la cambie al ingresar</span>
              <span className="block text-xs text-muted-foreground">La primera vez que entre al panel va a tener que elegir una contraseña propia.</span>
            </span>
          </label>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving || password.length < PASSWORD_MIN}
            className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Asignar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

function Avatar({ url, name, size = "md" }: { url: string | null; name: string; size?: "md" | "lg" }) {
  const cls = size === "lg" ? "h-16 w-16" : "h-11 w-11";
  return url ? (
    <img src={url} alt={name} className={`${cls} shrink-0 rounded-full object-cover ring-2 ring-border/60`} />
  ) : (
    <div className={`${cls} flex shrink-0 items-center justify-center rounded-full bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]`}>
      <User2 className="h-1/2 w-1/2" />
    </div>
  );
}

function Tag({ tone, children }: { tone: "primary" | "muted"; children: React.ReactNode }) {
  return (
    <span className={[
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
      tone === "primary" ? "bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]" : "bg-muted text-muted-foreground",
    ].join(" ")}>
      {children}
    </span>
  );
}

// Contraseña inicial legible: sin caracteres ambiguos (0/O, 1/l)
function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
