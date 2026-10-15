import { useEffect, useState } from "react";
import { Award, CalendarRange, Clock, Hourglass, ListOrdered, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hasMilestones, monthYear, type PublicMilestones } from "@/lib/milestones";

// Landing: el CIMT como referente y los hitos que publicó Dirección
// (los números salen de las estadísticas del panel, con aprobación previa).

export function Milestones() {
  const [m, setM] = useState<PublicMilestones | null>(null);

  useEffect(() => {
    supabase.from("public_milestones").select("*").order("published_at", { ascending: false }).limit(1)
      .then(({ data }: { data: PublicMilestones[] | null }) => setM(data?.[0] ?? null));
  }, []);

  const show = hasMilestones(m);

  return (
    <section className="container mx-auto px-4 pb-16 md:px-6">
      <div className="flex flex-col items-start gap-4 rounded-3xl bg-primary bg-[image:var(--gradient-hero)] p-6 text-white shadow-[var(--shadow-elegant)] sm:flex-row sm:items-center md:p-8">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
          <Award className="h-8 w-8" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold sm:text-3xl">Únicos en el municipio, la provincia y el país</h2>
          <p className="mt-1.5 text-base leading-relaxed text-white/90 sm:text-lg">
            El CIMT es el único centro público dedicado exclusivamente a la tartamudez en San Miguel de Tucumán,
            en Tucumán y en la Argentina: un referente en la atención pública.
          </p>
        </div>
      </div>

      {show && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {m.patients_total !== null && (
              <Tile icon={Users} value={m.patients_total.toLocaleString("es-AR")}
                text={`pacientes atendidos${m.patients_since ? ` desde ${monthYear(m.patients_since)}` : ""}`} />
            )}
            {m.response_hours !== null && (
              <Tile icon={Clock} value={`${m.response_hours} hs`} text="como máximo para responder tu solicitud" />
            )}
            {m.wait_days !== null && (
              <Tile icon={Hourglass} value={`${m.wait_days} ${m.wait_days === 1 ? "día" : "días"}`}
                text="de espera habitual hasta el primer turno" />
            )}
            {m.waiting_list !== null && (
              <Tile icon={ListOrdered} value={m.waiting_list.toLocaleString("es-AR")}
                text={m.waiting_list === 1 ? "solicitud en lista de espera" : "solicitudes en lista de espera"} />
            )}
          </div>

          {m.month_value !== null && m.month && m.month_label && (
            <div className="mt-4 flex flex-col gap-3 rounded-3xl border-2 border-primary/30 bg-[color:var(--primary-soft)]/60 p-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[color:var(--primary-deep)]">
                <CalendarRange className="h-5 w-5" aria-hidden="true" />
                Análisis mensual · {monthYear(m.month)}
              </div>
              <p className="text-lg text-foreground sm:ml-auto">
                <strong className="font-display text-3xl font-extrabold text-[color:var(--primary-deep)]">
                  {m.month_value.toLocaleString("es-AR")}
                </strong>{" "}
                {m.month_label}
              </p>
            </div>
          )}

          <p className="mt-3 text-right text-xs text-muted-foreground">
            Datos del CIMT actualizados el {new Date(m.published_at).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}.
          </p>
        </>
      )}
    </section>
  );
}

function Tile({ icon: Icon, value, text }: { icon: typeof Users; value: string; text: string }) {
  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-card)]">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="mt-4 font-display text-4xl font-extrabold text-[color:var(--primary-deep)]">{value}</div>
      <p className="mt-1 text-sm leading-snug text-muted-foreground">{text}</p>
    </div>
  );
}
