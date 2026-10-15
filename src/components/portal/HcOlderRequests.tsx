import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { HcRequestDTO } from "@/lib/portal";
import { HcRequestCard } from "./HcRequestCard";
import { pillOutline } from "./styles";

// Pedidos de copia del historial ya cerrados que no se ven enteros (los
// "older" de splitHcRequests): plegados en "Ver pedidos anteriores (N)",
// cerrado al entrar, con las mismas tarjetas adentro. Así no se acumulan a la
// vista, pero se siguen pudiendo ver mientras el servidor los mande.
// titleOf: de quién es cada copia, cuando la lista no está en la página de la
// persona (en el inicio, "Tus pedidos")
export function HcOlderRequests({ requests, titleOf, onChanged, onReauthenticated }: {
  requests: HcRequestDTO[];
  titleOf?: (r: HcRequestDTO) => string;
  onChanged?: (updated?: HcRequestDTO) => void;
  onReauthenticated?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (!requests.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={open ? id : undefined}
        className={`${pillOutline} gap-2 min-[420px]:self-start`}>
        {open ? "Ocultar pedidos anteriores" : `Ver pedidos anteriores (${requests.length})`}
        <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-3">
          {requests.map((r) => (
            <HcRequestCard key={r.id} req={r} title={titleOf?.(r)} onChanged={onChanged} onReauthenticated={onReauthenticated} />
          ))}
        </div>
      )}
    </div>
  );
}
