import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// Solicitudes de turno nuevas (estado «Nueva») para la pestaña y el cartel del
// panel. Cada uno ve las que le corresponden (la base filtra: un profesional,
// solo las derivadas a él; script 34).
//   - Tiempo real: Supabase avisa apenas entra o cambia una solicitud
//     (la tabla está en la publicación supabase_realtime, script 37).
//   - Respaldo: se revisa cada 30 s mientras la pestaña del navegador está a
//     la vista y al volver a la ventana (por si el tiempo real se corta).
// Cuando aparece una que no estaba, avisa con un cartel emergente y sube
// `version`, así la bandeja de Solicitudes se recarga sola.

const POLL_MS = 30_000;

export function useNewRequests(onOpen?: () => void) {
  const [count, setCount] = useState(0);
  const [version, setVersion] = useState(0);
  const known = useRef<Set<string> | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from("intake_requests").select("id").eq("status", "nueva");
    if (error || !data) return;
    const ids = new Set((data as { id: string }[]).map((r) => r.id));
    const prev = known.current;
    known.current = ids;
    setCount(ids.size);
    if (!prev) return; // al abrir el panel no se avisa: para eso está el cartel
    const arrived = [...ids].filter((id) => !prev.has(id)).length;
    if (arrived > 0) {
      setVersion((v) => v + 1);
      toast.info(arrived === 1 ? "Llegó una nueva solicitud de turno" : `Llegaron ${arrived} solicitudes de turno nuevas`, {
        description: arrived === 1 ? "Revisala en la pestaña Solicitudes." : "Revisalas en la pestaña Solicitudes.",
        duration: 15_000,
        action: openRef.current ? { label: "Ver", onClick: () => openRef.current?.() } : undefined,
      });
    } else if ([...prev].some((id) => !ids.has(id))) {
      setVersion((v) => v + 1); // alguien la atendió desde otra compu
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);

    // Tiempo real (el modo demo no lo tiene: queda el respaldo)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any;
    const channel = typeof client.channel === "function"
      ? client.channel("panel-solicitudes")
          .on("postgres_changes", { event: "*", schema: "public", table: "intake_requests" }, () => { void refresh(); })
          .subscribe()
      : null;

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      if (channel) void client.removeChannel(channel);
    };
  }, [refresh]);

  return { count, setCount, version, refresh };
}
