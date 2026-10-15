import { CheckCircle2 } from "lucide-react";
import { INTAKE_REQUIREMENTS } from "@/lib/center";

// Requisitos para el ingreso al CIMT (inicio y /turnos)
export function RequirementsList({ className = "" }: { className?: string }) {
  return (
    <ul className={`grid gap-3 sm:grid-cols-2 ${className}`}>
      {INTAKE_REQUIREMENTS.map((r) => (
        <li key={r.key} className="flex gap-3 rounded-2xl border border-border bg-background p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <div className="font-semibold text-[color:var(--primary-deep)]">{r.title}</div>
            <p className="mt-0.5 text-sm text-muted-foreground">{r.text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
