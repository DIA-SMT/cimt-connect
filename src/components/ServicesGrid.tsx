import { HeartHandshake, Users, UsersRound, Video } from "lucide-react";
import { SERVICES } from "@/lib/center";

const SERVICE_ICONS: Record<(typeof SERVICES)[number]["key"], typeof Video> = {
  modalidad: Video,
  terapia: UsersRound,
  gam: HeartHandshake,
  familia: Users,
};

// Modalidades de atención del CIMT (presencial/telemedicina, individual/grupal, GAM, familia)
export function ServicesGrid({ className = "" }: { className?: string }) {
  return (
    <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
      {SERVICES.map((s) => {
        const Icon = SERVICE_ICONS[s.key];
        return (
          <div key={s.key} className="flex items-start gap-3 rounded-2xl border border-border/60 bg-background p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--primary-soft)] text-[color:var(--primary-deep)]">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-[color:var(--primary-deep)]">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
