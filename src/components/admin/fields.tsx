// Piezas de formulario compartidas por la ficha del paciente y los informes
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, type LucideIcon } from "lucide-react";

export const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function Section({ icon: Icon, title, action, children }: {
  icon: LucideIcon; title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold text-[color:var(--primary-deep)]">
          <Icon className="h-4 w-4" /> {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-[color:var(--primary-soft)]",
      ].join(" ")}
    >
      {children}
      {active && <X className="h-3 w-3" aria-hidden />}
    </button>
  );
}

export function TextField({ label, value, onChange, type = "text", placeholder, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
  placeholder?: string; inputMode?: "numeric" | "tel";
}) {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} placeholder={placeholder} inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function TextAreaField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
