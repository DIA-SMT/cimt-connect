import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Loader2, Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClass, Section } from "./fields";
import { VoidButton, VoidedBanner, voidRecord } from "./voiding";
import type { Staff } from "@/lib/staff";
import { FILE_CATEGORY_LABEL, formatShortDate, type FileCategory, type PatientFile } from "@/lib/patients";

// Adjuntos de la ficha: consentimiento firmado escaneado, informes de
// interconsulta, estudios. Bucket privado: se descargan con un link firmado
// que vence en un minuto. No se borran: se anulan.

const BUCKET = "patient-files";
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"];

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsSection({ patientId, staff, onChanged }: { patientId: string; staff: Staff; onChanged: () => void }) {
  const [files, setFiles] = useState<PatientFile[]>([]);
  const [category, setCategory] = useState<FileCategory>("consentimiento");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const { data } = await supabase.from("patient_files").select("*").eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    setFiles((data ?? []) as PatientFile[]);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [patientId]);

  async function upload(file: File) {
    if (!ACCEPT.includes(file.type)) { toast.error("Solo PDF o imágenes (JPG, PNG, WEBP, HEIC)"); return; }
    if (file.size > MAX_BYTES) { toast.error("El archivo tiene que pesar menos de 10 MB"); return; }
    setUploading(true);
    const safeName = file.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-80);
    const path = `${patientId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { setUploading(false); toast.error("No se pudo subir el archivo"); return; }
    const { error } = await supabase.from("patient_files").insert({
      patient_id: patientId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      category,
      description: description.trim() || null,
    });
    setUploading(false);
    if (error) { toast.error("El archivo se subió pero no se pudo registrar en la ficha"); return; }
    toast.success("Archivo adjuntado");
    setDescription("");
    onChanged();
    load();
  }

  async function download(f: PatientFile) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.storage_path, 60);
    if (error || !data?.signedUrl) { toast.error("No se pudo abrir el archivo"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function annul(id: string, reason: string) {
    const patch = await voidRecord("patient_files", id, reason, staff.email);
    if (patch) { onChanged(); load(); }
  }

  return (
    <Section icon={Paperclip} title="Adjuntos">
      <div className="grid gap-3 rounded-2xl border border-dashed border-border p-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="att-cat">Tipo</Label>
          <select id="att-cat" value={category} onChange={(e) => setCategory(e.target.value as FileCategory)} className={selectClass}>
            {(Object.keys(FILE_CATEGORY_LABEL) as FileCategory[]).map((c) => <option key={c} value={c}>{FILE_CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="att-desc">Descripción (opcional)</Label>
          <Input id="att-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: informe de neurología, marzo" />
        </div>
        <Button variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
          Subir archivo
        </Button>
        <input ref={inputRef} type="file" accept={ACCEPT.join(",")} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
        <p className="text-xs text-muted-foreground sm:col-span-3">PDF o imagen, hasta 10 MB. Los archivos son privados: solo los ve el equipo del centro.</p>
      </div>

      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin archivos adjuntos.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => (
            <li key={f.id} className={`rounded-2xl border border-border/60 p-3 text-sm ${f.voided_at ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={`break-all font-semibold ${f.voided_at ? "line-through" : ""}`}>{f.file_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {FILE_CATEGORY_LABEL[f.category]} · {formatShortDate(f.created_at)}
                    {f.size_bytes ? ` · ${formatSize(f.size_bytes)}` : ""}{f.uploaded_by_email && ` · ${f.uploaded_by_email}`}
                  </div>
                  {f.description && <p className="mt-1 text-xs">{f.description}</p>}
                </div>
                <div className="flex gap-1">
                  {!f.voided_at && (
                    <Button size="sm" variant="outline" onClick={() => download(f)}><Download className="mr-1 h-3.5 w-3.5" /> Ver</Button>
                  )}
                  {!f.voided_at && <VoidButton what="el adjunto" onConfirm={(reason) => annul(f.id, reason)} />}
                </div>
              </div>
              <VoidedBanner item={f} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
