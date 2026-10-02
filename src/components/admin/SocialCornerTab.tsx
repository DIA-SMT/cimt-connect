import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Eye, EyeOff, Loader2, Plus, Star } from "lucide-react";
import { TextAreaField, TextField, selectClass } from "./fields";
import { CORNER_CATEGORY_LABEL, sortCorner, type CornerCategory, type CornerItem } from "@/lib/corner";

// Pestaña "Rincón social": el equipo administra las recomendaciones que se
// ven en /rincon. Nada se publica hasta marcarlo como publicado.

export function SocialCornerTab() {
  const [items, setItems] = useState<CornerItem[] | null>(null);
  const [editing, setEditing] = useState<CornerItem | "new" | null>(null);

  async function load() {
    const { data, error } = await supabase.from("social_corner_items").select("*");
    if (error) toast.error("No se pudo cargar el Rincón social");
    setItems(sortCorner((data ?? []) as CornerItem[]));
  }

  useEffect(() => { load(); }, []);

  async function togglePublished(item: CornerItem) {
    const { error } = await supabase.from("social_corner_items").update({ published: !item.published }).eq("id", item.id);
    if (error) { toast.error("No se pudo actualizar"); return; }
    toast.success(item.published ? "Despublicado" : "Publicado en el sitio");
    load();
  }

  if (!items) return <div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-[color:var(--primary-deep)]">Rincón social</h2>
          <p className="text-sm text-muted-foreground">
            Recomendaciones motivacionales que se ven en{" "}
            <a href="/rincon" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">/rincon</a>.
            Usá solo información pública y verificada, sin datos personales de pacientes.
          </p>
        </div>
        <Button onClick={() => setEditing("new")} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
          <Plus className="mr-1.5 h-4 w-4" /> Nueva recomendación
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]">
        {items.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Todavía no hay recomendaciones.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 p-4">
                <button onClick={() => setEditing(item)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-bold ${item.published ? "" : "text-muted-foreground"}`}>{item.title}</span>
                    {item.featured && <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-[color:var(--status-pending)]"><Star className="h-3 w-3" /> Destacado</span>}
                    {!item.published && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Borrador</span>}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {CORNER_CATEGORY_LABEL[item.category]}{item.subtitle && ` · ${item.subtitle}`} · orden {item.sort_order}
                  </div>
                </button>
                {item.link_url && (
                  <a href={item.link_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary" title="Abrir el link">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => togglePublished(item)}>
                  {item.published ? <><EyeOff className="mr-1 h-3.5 w-3.5" /> Despublicar</> : <><Eye className="mr-1 h-3.5 w-3.5" /> Publicar</>}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <ItemDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function ItemDialog({ item, onClose, onSaved }: { item: CornerItem | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    category: item?.category ?? ("figuras" as CornerCategory),
    title: item?.title ?? "",
    subtitle: item?.subtitle ?? "",
    description: item?.description ?? "",
    link_url: item?.link_url ?? "",
    link_label: item?.link_label ?? "",
    image_url: item?.image_url ?? "",
    featured: item?.featured ?? false,
    published: item?.published ?? false,
    sort_order: String(item?.sort_order ?? 100),
  });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    const title = form.title.trim();
    const description = form.description.trim();
    if (title.length < 2) { toast.error("Indicá el título"); return; }
    if (description.length < 10) { toast.error("Escribí una descripción (al menos 10 caracteres)"); return; }
    for (const [label, url] of [["link", form.link_url], ["imagen", form.image_url]] as const) {
      if (url.trim() && !/^https?:\/\//.test(url.trim())) { toast.error(`El ${label} tiene que empezar con https://`); return; }
    }
    setSaving(true);
    const payload = {
      category: form.category,
      title,
      subtitle: form.subtitle.trim() || null,
      description,
      link_url: form.link_url.trim() || null,
      link_label: form.link_label.trim() || null,
      image_url: form.image_url.trim() || null,
      featured: form.featured,
      published: form.published,
      sort_order: Number(form.sort_order) || 100,
    };
    const { error } = item
      ? await supabase.from("social_corner_items").update(payload).eq("id", item.id)
      : await supabase.from("social_corner_items").insert(payload);
    setSaving(false);
    if (error) { toast.error("No se pudo guardar"); return; }
    toast.success("Guardado");
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">
            {item ? "Editar recomendación" : "Nueva recomendación"}
          </DialogTitle>
          <DialogDescription>Personas, películas, libros, artistas o deportistas relacionados con la tartamudez.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sc-cat">Categoría</Label>
              <select id="sc-cat" value={form.category} onChange={(e) => set("category", e.target.value as CornerCategory)} className={selectClass}>
                {(Object.keys(CORNER_CATEGORY_LABEL) as CornerCategory[]).map((c) => <option key={c} value={c}>{CORNER_CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            <TextField label="Orden (menor = primero)" type="number" value={form.sort_order} onChange={(v) => set("sort_order", v)} />
            <TextField label="Título" value={form.title} onChange={(v) => set("title", v)} placeholder="Ej: El discurso del rey" />
            <TextField label="Subtítulo" value={form.subtitle} onChange={(v) => set("subtitle", v)} placeholder="Ej: Película, 2010 · Actriz" />
          </div>
          <TextAreaField label="Descripción" value={form.description} onChange={(v) => set("description", v)}
            placeholder="Por qué es inspirador y qué relación tiene con la tartamudez (hasta 600 caracteres)" />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Link (opcional)" value={form.link_url} onChange={(v) => set("link_url", v)} placeholder="https://…" />
            <TextField label="Texto del link" value={form.link_label} onChange={(v) => set("link_label", v)} placeholder="Ej: Leer más" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sc-img">Imagen (opcional, link)</Label>
            <Input id="sc-img" value={form.image_url} onChange={(e) => set("image_url", e.target.value)} placeholder="https://…" />
            <p className="text-xs text-muted-foreground">Solo imágenes propias o con permiso de uso. Sin imagen se muestra un ícono.</p>
          </div>
          <div className="space-y-3 rounded-2xl border border-border/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="sc-feat" className="font-semibold">Destacado (aparece primero, en grande)</Label>
              <Switch id="sc-feat" checked={form.featured} onCheckedChange={(v) => set("featured", v)} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="sc-pub" className="font-semibold">Publicado en el sitio</Label>
              <Switch id="sc-pub" checked={form.published} onCheckedChange={(v) => set("published", v)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-[color:var(--primary-deep)]">
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
