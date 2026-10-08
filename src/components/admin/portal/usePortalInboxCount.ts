import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { portalStaffApi } from "@/lib/portalStaff";

// Número de la pestaña "Portal" del panel: pedidos de copia de la historia
// clínica pendientes + avisos de turnos sin resolver. Se pide al abrir el
// panel, cada 2 minutos mientras la pestaña del navegador está a la vista y
// al volver a la ventana. La bandeja lo corrige con setCount después de
// cada acción.

const POLL_MS = 120_000;

export function usePortalInboxCount(): [number, Dispatch<SetStateAction<number>>] {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!portalStaffApi.enabled) return;
    let cancelled = false;
    let inFlight = false;

    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      const c = await portalStaffApi.inboxCount().catch(() => null);
      inFlight = false;
      if (!cancelled && c) setCount(c.hc_pending + c.notices_pending);
    }

    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return [count, setCount];
}
