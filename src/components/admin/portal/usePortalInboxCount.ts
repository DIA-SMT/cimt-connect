import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { portalStaffApi } from "@/lib/portalStaff";
import { onInboxStale, practiceCountsFromServer } from "./practiceHandoff";

// Números de la pestaña "Portal" del panel: pedidos de copia de la historia
// clínica pendientes, avisos de turnos sin resolver, pedidos de turno
// pendientes y "Prácticas" (solo perfiles clínicos con la etapa practice; si
// no, 0), por separado. practice = practice_pending + practice_risk: las filas
// de MIS pacientes más los pacientes que no son míos con comentarios de riesgo
// sin ver (el servidor no los cuenta dos veces; ver practiceHandoff.ts). Es lo
// mismo que "Mis pacientes" en la bandeja. practiceRisk = practice_risk.
// practiceUrgent = practice_urgent > 0: algún comentario de riesgo sin ver, de
// cualquier paciente; con eso la pestaña se marca como urgente (como con los
// avisos).
// Los avisos de "no vamos a poder ir" son más urgentes (hay que liberar el
// horario), así que el panel los resalta y, si llega uno nuevo mientras está
// abierto, avisa.
// Se pide al abrir el panel, cada minuto mientras la pestaña del navegador
// está a la vista, al volver a la ventana y después de cada acción de la
// práctica en la ficha (practiceHandoff: onInboxStale). La bandeja lo
// corrige con setCounts después de cada acción (con los mismos números).

const POLL_MS = 60_000;
const STALE_DELAY_MS = 300; // varias acciones seguidas: un solo pedido

// practice: practice_pending + practice_risk (practiceBadgeFromCount; la bandeja, practiceBadge)
// practiceRisk: practice_risk (la bandeja, practiceRiskCount)
// practiceUrgent: practice_urgent > 0 (la bandeja, practiceUrgentFromInbox: alguna fila de prácticas con riesgo)
export type PortalCounts = { hc: number; notices: number; turnos: number; practice: number; practiceRisk: number; practiceUrgent: boolean };

export function usePortalInboxCount(onOpenNotices?: () => void): [PortalCounts, Dispatch<SetStateAction<PortalCounts>>] {
  const [counts, setCounts] = useState<PortalCounts>({ hc: 0, notices: 0, turnos: 0, practice: 0, practiceRisk: 0, practiceUrgent: false });
  const lastNotices = useRef<number | null>(null);
  const openRef = useRef(onOpenNotices);
  openRef.current = onOpenNotices;

  useEffect(() => {
    if (!portalStaffApi.enabled) return;
    let cancelled = false;
    let inFlight = false;
    // Pidieron números nuevos mientras había un pedido en camino (que puede
    // traer los de antes de la acción): se pide de nuevo al terminar
    let again = false;
    let staleTimer: number | undefined;

    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      const c = await portalStaffApi.inboxCount().catch(() => null);
      inFlight = false;
      if (cancelled) return;
      if (again) {
        again = false;
        void refresh();
        return;
      }
      if (!c) return;
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
      // turnos_pending puede faltar si el servidor es anterior a los pedidos de
      // turno; practice_pending, practice_risk y practice_urgent, sin la etapa
      // practice o para Administración
      setCounts({ hc: c.hc_pending, notices: c.notices_pending, turnos: c.turnos_pending ?? 0, ...practiceCountsFromServer(c) });
    }

    // Después de una acción de la práctica en la ficha
    function refreshAfterAction() {
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => {
        if (inFlight) again = true;
        else void refresh();
      }, STALE_DELAY_MS);
    }

    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    window.addEventListener("focus", refresh);
    const offStale = onInboxStale(refreshAfterAction);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(staleTimer);
      window.removeEventListener("focus", refresh);
      offStale();
    };
  }, []);

  // La bandeja, al resolver, baja el número: que no cuente como "nuevo" después
  useEffect(() => {
    if (lastNotices.current !== null) lastNotices.current = counts.notices;
  }, [counts.notices]);

  return [counts, setCounts];
}
