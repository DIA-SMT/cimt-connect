import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Foto de perfil de la ficha (30_hitos_derivacion_foto.sql). Va al bucket
// privado patient-files y se ve con un link temporal. Antes de subirla se
// recorta cuadrada y se achica a 512 px: pesa poco y no guarda datos de más
// (la ubicación de la foto se pierde al redibujarla). No se borran archivos:
// "Quitar" deja la ficha sin foto.

const BUCKET = "patient-files";
const SIZE = 512;

/** Recorta al centro y achica a JPEG cuadrado */
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/jpeg", 0.85));
}

export function PatientPhoto({ patientId, photoPath, initials, onChanged }: {
  patientId: string;
  photoPath: string | null;
  initials: string;
  onChanged: (path: string | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (!photoPath) return;
    supabase.storage.from(BUCKET).createSignedUrl(photoPath, 3600)
      .then(({ data }: { data: { signedUrl: string } | null }) => { if (!cancelled) setUrl(data?.signedUrl ?? null); });
    return () => { cancelled = true; };
  }, [photoPath]);

  async function save(path: string | null, ok: string) {
    const { error } = await supabase.from("patients").update({ photo_path: path }).eq("id", patientId);
    if (error) { toast.error("No se pudo guardar la foto en la ficha"); return; }
    onChanged(path);
    toast.success(ok);
  }

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) { toast.error("Elegí una imagen (JPG o PNG)"); return; }
    setBusy(true);
    try {
      const blob = await squareJpeg(file);
      const path = `${patientId}/foto-${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) { toast.error("No se pudo subir la foto"); return; }
      await save(path, "Foto actualizada");
    } catch {
      toast.error("No se pudo leer la imagen. Probá con una foto JPG o PNG.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
        title={photoPath ? "Cambiar la foto" : "Agregar foto de perfil"}
        className="group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border-2 border-primary/30 bg-[color:var(--primary-soft)] text-2xl font-bold text-[color:var(--primary-deep)]">
        {url ? <img src={url} alt="Foto de perfil" className="h-full w-full object-cover" /> : <span aria-hidden="true">{initials}</span>}
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-black/55 py-0.5 text-white opacity-90 transition-opacity group-hover:opacity-100">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </span>
        <span className="sr-only">{photoPath ? "Cambiar la foto" : "Agregar foto de perfil"}</span>
      </button>
      {photoPath && (
        <Button type="button" variant="ghost" size="sm" disabled={busy}
          onClick={() => { if (window.confirm("¿Quitar la foto de la ficha?")) save(null, "Foto quitada"); }}
          className="h-6 px-1.5 text-xs text-muted-foreground">
          <Trash2 className="mr-1 h-3 w-3" /> Quitar
        </Button>
      )}
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
    </div>
  );
}
