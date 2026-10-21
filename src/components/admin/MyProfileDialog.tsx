import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "./TeamTab";

// «Mi perfil»: cada profesional cambia su foto, su descripción para el sitio y
// sus días de atención (update_my_professional_profile, script 35). Nombre,
// especialidad, matrícula y si aparece en el sitio los maneja la Dirección.

type Profile = {
  name: string;
  specialty: string;
  license: string | null;
  days: string | null;
  description: string | null;
  photo_url: string | null;
  show_on_site: boolean;
};

const DESCRIPTION_MAX = 600;

export function MyProfileDialog({ open, onClose, professionalId }: { open: boolean; onClose: () => void; professionalId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photo, setPhoto] = useState("");
  const [description, setDescription] = useState("");
  const [days, setDays] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProfile(null);
    supabase.from("professionals").select("name, specialty, license, days, description, photo_url, show_on_site")
      .eq("id", professionalId).single()
      .then(({ data, error }: { data: Profile | null; error: unknown }) => {
        if (error || !data) { toast.error("No se pudo cargar tu perfil"); onClose(); return; }
        setProfile(data);
        setPhoto(data.photo_url ?? "");
        setDescription(data.description ?? "");
        setDays(data.days ?? "");
      });
  }, [open, professionalId, onClose]);

  async function uploadPhoto(file: File) {
    if (!file.type.startsWith("image/")) { toast.error("Elegí una imagen (JPG o PNG)"); return; }
    if (file.size > 3 * 1024 * 1024) { toast.error("La imagen tiene que pesar menos de 3 MB"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    // Cada profesional sube en su propia carpeta (lo controla la base)
    const path = `${professionalId}/${crypto.randomUUID()}.${ext}`;
    const bucket = supabase.storage.from("professional-photos");
    const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (error) { toast.error("No se pudo subir la foto"); return; }
    setPhoto(bucket.getPublicUrl(path).data.publicUrl);
  }

  async function save() {
    if (description.trim().length > DESCRIPTION_MAX) { toast.error(`La descripción puede tener hasta ${DESCRIPTION_MAX} caracteres`); return; }
    setSaving(true);
    const { error } = await supabase.rpc("update_my_professional_profile", {
      p_photo_url: photo || null,
      p_description: description.trim() || null,
      p_days: days.trim() || null,
    });
    setSaving(false);
    if (error) {
      const msg = String(error.message ?? "");
      toast.error(/^(NOT_LINKED|INVALID_[A-Z]+):/.test(msg) ? msg.slice(msg.indexOf(":") + 1).trim() : "No se pudo guardar tu perfil");
      return;
    }
    toast.success("Perfil actualizado");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">Mi perfil</DialogTitle>
          <DialogDescription>
            Tu foto y tu descripción son las que se ven en la página Profesionales del sitio.
          </DialogDescription>
        </DialogHeader>

        {!profile ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar url={photo || null} name={profile.name} size="lg" />
              <div className="min-w-0 space-y-1.5">
                <div className="font-semibold text-[color:var(--primary-deep)]">{profile.name}</div>
                <div className="text-xs text-muted-foreground">
                  {profile.specialty}{profile.license ? ` · ${/^m\.?p/i.test(profile.license) ? profile.license : `MP ${profile.license}`}` : ""}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline" disabled={uploading}>
                    <label className="cursor-pointer">
                      {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                      {photo ? "Cambiar foto" : "Subir foto"}
                      <input type="file" accept="image/*" className="sr-only"
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPhoto(f); }} />
                    </label>
                  </Button>
                  {photo && <Button size="sm" variant="ghost" onClick={() => setPhoto("")}>Quitar</Button>}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mp-days">Días de atención</Label>
              <Input id="mp-days" value={days} maxLength={120} onChange={(e) => setDays(e.target.value)}
                placeholder="Ej: Lunes, miércoles y viernes" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mp-desc">Descripción para el sitio</Label>
              <Textarea id="mp-desc" rows={4} value={description} maxLength={DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Contá en pocas palabras tu formación y cómo trabajás con los pacientes." />
              <p className="text-right text-xs text-muted-foreground">{description.length}/{DESCRIPTION_MAX}</p>
            </div>

            <p className="rounded-xl bg-[color:var(--primary-soft)] px-3 py-2 text-xs text-[color:var(--primary-deep)]">
              {profile.show_on_site
                ? "Hoy aparecés en la página Profesionales del sitio. "
                : "Hoy no aparecés en la página Profesionales del sitio: lo habilita la Dirección, con tu autorización. "}
              El nombre, la especialidad y la matrícula los cambia la Dirección (salen en los informes firmados).
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={save} disabled={saving || uploading}
                className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
