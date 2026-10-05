// Selector "Todo el equipo / Mis turnos" (o "Todos / Mis pacientes")

export function ScopeToggle({ on, onChange, allLabel, mineLabel }: {
  on: boolean; onChange: (mine: boolean) => void; allLabel: string; mineLabel: string;
}) {
  const btn = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
      active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-[color:var(--primary-deep)]"
    }`;
  return (
    <div role="group" aria-label="Qué mostrar" className="inline-flex rounded-full border border-border/60 bg-card p-1">
      <button type="button" aria-pressed={!on} onClick={() => onChange(false)} className={btn(!on)}>{allLabel}</button>
      <button type="button" aria-pressed={on} onClick={() => onChange(true)} className={btn(on)}>{mineLabel}</button>
    </div>
  );
}
