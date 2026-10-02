import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "./fields";
import {
  AUDIT_FIELD_LABEL, AUDIT_HIDDEN_FIELDS, AUDIT_TABLE_LABEL, formatAuditValue,
  type AuditEntry, type ProfessionalOption,
} from "@/lib/patients";

// Historial de cambios de la ficha (relevamiento, respuesta 15). Lo escribe la
// base con un trigger (11_roles_equipo_historial.sql); acá solo se lee.
// Se carga a pedido para no hacer más pesada la apertura de la ficha.

export function PatientHistory({ patientId, professionals }: { patientId: string; professionals: ProfessionalOption[] }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("audit_log")
      .select("id, table_name, record_id, action, changes, changed_by_email, changed_at")
      .eq("patient_id", patientId)
      .order("changed_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (error) { toast.error("No se pudo cargar el historial"); return; }
    setEntries((data ?? []) as AuditEntry[]);
  }

  const proName = new Map(professionals.map((p) => [p.id, p.name]));
  const show = (field: string, v: unknown) =>
    field === "professional_id" && typeof v === "string" ? proName.get(v) ?? "Otro profesional" : formatAuditValue(v);

  return (
    <Section icon={History} title="Historial de cambios"
      action={entries === null && (
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Ver historial
        </Button>
      )}>
      {entries === null ? (
        <p className="text-sm text-muted-foreground">Quién cambió qué y cuándo en esta ficha.</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay cambios registrados.</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => {
            const fields = Object.entries(e.changes ?? {}).filter(([k]) => !AUDIT_HIDDEN_FIELDS.has(k));
            const voided = e.action === "update" && "voided_at" in (e.changes ?? {});
            return (
              <li key={e.id} className="rounded-xl border border-border/60 p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-semibold text-[color:var(--primary-deep)]">
                    {new Date(e.changed_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  <span className="text-muted-foreground">{e.changed_by_email ?? "Solicitud online del sitio"}</span>
                </div>
                <div className="mt-1 font-semibold">
                  {AUDIT_TABLE_LABEL[e.table_name] ?? e.table_name}: {voided ? "anulado" : e.action === "insert" ? "creado" : "modificado"}
                </div>
                {e.action === "update" && !voided && fields.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {fields.map(([k, v]) => {
                      const [before, after] = Array.isArray(v) ? v : [undefined, v];
                      return (
                        <li key={k}>
                          <span className="text-foreground">{AUDIT_FIELD_LABEL[k] ?? k}:</span>{" "}
                          {show(k, before)} → <span className="text-foreground">{show(k, after)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {voided && (
                  <p className="mt-1 text-muted-foreground">
                    Motivo: {formatAuditValue((e.changes.void_reason as unknown[] | undefined)?.[1])}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
