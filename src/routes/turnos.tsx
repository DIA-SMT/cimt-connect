import { createFileRoute } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TIME_SLOTS, formatDateKey, formatTime, isWeekend } from "@/lib/appointments";
import { ChevronLeft, ChevronRight, Loader2, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppointmentForm } from "@/components/AppointmentForm";

type Appt = {
  appointment_date: string;
  appointment_time: string;
  status: "pendiente" | "confirmado" | "cancelado";
};

export const Route = createFileRoute("/turnos")({
  head: () => ({
    meta: [
      { title: "Solicitar turno — CIMT" },
      { name: "description", content: "Reservá tu turno gratuito en el Centro Integral Municipal de Tartamudez. Calendario con disponibilidad en tiempo real." },
      { property: "og:title", content: "Solicitar turno — CIMT" },
      { property: "og:description", content: "Calendario de turnos con disponibilidad en tiempo real." },
    ],
  }),
  component: TurnosPage,
});

function TurnosPage() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [appts, setAppts] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  async function fetchAppts() {
    const start = formatDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    const end = formatDateKey(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
    setLoading(true);
    const { data } = await supabase
      .from("appointments")
      .select("appointment_date, appointment_time, status")
      .gte("appointment_date", start)
      .lte("appointment_date", end)
      .neq("status", "cancelado");
    setAppts((data ?? []) as Appt[]);
    setLoading(false);
  }

  useEffect(() => { fetchAppts(); /* eslint-disable-next-line */ }, [cursor]);

  const days = useMemo(() => buildMonthGrid(cursor), [cursor]);

  const apptsByDate = useMemo(() => {
    const map = new Map<string, Appt[]>();
    for (const a of appts) {
      const arr = map.get(a.appointment_date) ?? [];
      arr.push(a);
      map.set(a.appointment_date, arr);
    }
    return map;
  }, [appts]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const slots = useMemo(() => {
    if (!selectedDate) return [];
    const key = formatDateKey(selectedDate);
    const dayAppts = apptsByDate.get(key) ?? [];
    return TIME_SLOTS.map((t) => {
      const found = dayAppts.find((a) => formatTime(a.appointment_time) === t);
      const status = found
        ? found.status === "confirmado" ? "occupied" : "pending"
        : "available";
      return { time: t, status: status as "occupied" | "pending" | "available" };
    });
  }, [selectedDate, apptsByDate]);

  return (
    <Layout>
      <section className="container mx-auto px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-4xl font-extrabold text-[color:var(--primary-deep)] sm:text-5xl">
            Solicitar turno
          </h1>
          <p className="mt-4 text-muted-foreground">
            Elegí un día disponible y luego un horario. La atención es gratuita.
          </p>
        </div>

        <Legend />

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* CALENDAR */}
          <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <button
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-[color:var(--primary-soft)]"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h2 className="font-display text-xl font-bold capitalize text-[color:var(--primary-deep)]">
                {cursor.toLocaleDateString("es-AR", { month: "long", year: "numeric" })}
              </h2>
              <button
                onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-[color:var(--primary-soft)]"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map((d) => (
                <div key={d} className="py-2">{d}</div>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1.5">
              {days.map((d, i) => {
                if (!d) return <div key={i} className="aspect-square" />;
                const inMonth = d.getMonth() === cursor.getMonth();
                const past = d < today;
                const weekend = isWeekend(d);
                const disabled = past || weekend || !inMonth;
                const key = formatDateKey(d);
                const dayAppts = apptsByDate.get(key) ?? [];
                const totalSlots = TIME_SLOTS.length;
                const occupied = dayAppts.filter(a => a.status === "confirmado").length;
                const pending = dayAppts.filter(a => a.status === "pendiente").length;
                const available = totalSlots - occupied - pending;
                const isSelected = selectedDate && formatDateKey(selectedDate) === key;

                return (
                  <button
                    key={i}
                    disabled={disabled}
                    onClick={() => { setSelectedDate(d); setSelectedTime(null); }}
                    className={[
                      "aspect-square rounded-xl text-sm transition-all flex flex-col items-center justify-center gap-1 p-1",
                      disabled
                        ? "cursor-not-allowed text-muted-foreground/40 bg-muted/30"
                        : "hover:bg-[color:var(--primary-soft)] cursor-pointer text-foreground",
                      isSelected && "!bg-primary !text-primary-foreground shadow-[var(--shadow-card)]",
                    ].filter(Boolean).join(" ")}
                  >
                    <span className="font-semibold leading-none">{d.getDate()}</span>
                    {!disabled && (
                      <span className="flex gap-0.5">
                        {available > 0 && <Dot color="var(--status-available)" />}
                        {pending > 0 && <Dot color="var(--status-pending)" />}
                        {occupied > 0 && <Dot color="var(--status-occupied)" />}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {loading && (
              <div className="mt-4 flex justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
          </div>

          {/* SLOTS */}
          <div className="rounded-3xl border border-border/60 bg-card p-5 shadow-[var(--shadow-card)] sm:p-6">
            {!selectedDate ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-muted-foreground">
                <Info className="h-10 w-10 text-primary/40" />
                <p className="mt-3 max-w-xs text-sm">
                  Seleccioná un día en el calendario para ver los horarios disponibles.
                </p>
              </div>
            ) : (
              <>
                <h3 className="font-display text-lg font-bold text-[color:var(--primary-deep)] capitalize">
                  {selectedDate.toLocaleDateString("es-AR", {
                    weekday: "long", day: "numeric", month: "long",
                  })}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">Elegí un horario disponible</p>
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {slots.map((s) => (
                    <button
                      key={s.time}
                      disabled={s.status !== "available"}
                      onClick={() => { setSelectedTime(s.time); setFormOpen(true); }}
                      className={[
                        "rounded-xl px-3 py-3 text-sm font-semibold transition-all border",
                        s.status === "available" && "bg-[color:var(--status-available-bg)] text-[color:var(--status-available)] border-[color:var(--status-available)]/30 hover:scale-[1.03] hover:shadow-md",
                        s.status === "pending" && "bg-[color:var(--status-pending-bg)] text-[color:var(--status-pending)] border-[color:var(--status-pending)]/30 cursor-not-allowed",
                        s.status === "occupied" && "bg-[color:var(--status-occupied-bg)] text-[color:var(--status-occupied)] border-[color:var(--status-occupied)]/30 cursor-not-allowed",
                      ].filter(Boolean).join(" ")}
                    >
                      {s.time}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); setSelectedTime(null); } }}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-[color:var(--primary-deep)]">
              Datos de la solicitud
            </DialogTitle>
          </DialogHeader>
          {selectedDate && selectedTime && (
            <AppointmentForm
              date={formatDateKey(selectedDate)}
              time={selectedTime}
              onSuccess={() => { setFormOpen(false); setSelectedTime(null); fetchAppts(); }}
              onCancel={() => { setFormOpen(false); setSelectedTime(null); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `var(${color})` }} />;
}

function Legend() {
  const items = [
    { color: "--status-available", label: "Disponible" },
    { color: "--status-pending", label: "Pendiente" },
    { color: "--status-occupied", label: "Ocupado" },
  ];
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: `var(${i.color})` }} />
          {i.label}
        </div>
      ))}
    </div>
  );
}

function buildMonthGrid(monthCursor: Date): (Date | null)[] {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Convert Sunday(0) -> 6, Mon(1) -> 0, etc. for Mon-first grid
  const startOffset = (firstDay.getDay() + 6) % 7;
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}