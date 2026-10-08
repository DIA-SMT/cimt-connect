import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { portalStaffApi } from "@/lib/portalStaff";

// Números de la pestaña "Portal" del panel: pedidos de copia de la historia
// clínica pendientes y avisos de turnos sin resolver, por separado. Los avisos
// de "no vamos a poder ir" son más urgentes (hay que liberar el horario), así
// que el panel los resalta y, si llega uno nuevo mientras está abierto, avisa.
// Se pide al abrir el panel, cada minuto mientras la pestaña del navegador
// está a la vista y al volver a la ventana. La bandeja lo corrige con setCounts
// después de cada acción.

const POLL_MS = 60_000;

export type PortalCounts = { hc: number; notices: number };

export function usePortalInboxCount(onOpenNotices?: () => void): [PortalCounts, Dispatch<SetStateAction<PortalCounts>>] {
  const [counts, setCounts] = useState<PortalCounts>({ hc: 0, notices: 0 });
  const lastNotices = useRef<number | null>(null);
  const openRef = useRef(onOpenNotices);
  openRef.current = onOpenNotices;

  useEffect(() => {
    if (!portalStaffApi.enabled) return;
    let cancelled = false;
    let inFlight = false;

    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      const c = await portalStaffApi.inboxCount().catch(() => null);
      inFlight = false;
      if (cancelled || !c) return;
      // Aviso nuevo desde la última vez (no al abrir el panel: para eso está el cartel)
      if (lastNotices.current !== null && c.notices_pending > lastNotices.current) {
        const nuevos = c.notices_pending - lastNotices.current;
        toast.warning(nuevos === 1 ? "Una familia avisó que no va a venir a un turno" : `${nuevos} familias avisaron que no van a venir a un turno`, {
          description: "Resolvelo en Portal → Avisos de turnos para liberar el horario.",
          duration: 20_000,
          action: openRef.current ? { label: "Ver", onClick: () => openRef.current?.() } : undefined,
        });
      }
      lastNotices.current = c.notices_pending;
      setCounts({ hc: c.hc_pending, notices: c.notices_pending });
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

  // La bandeja, al resolver, baja el número: que no cuente como "nuevo" después
  useEffect(() => {
    if (lastNotices.current !== null) lastNotices.current = counts.notices;
  }, [counts.notices]);

  return [counts, setCounts];
}
