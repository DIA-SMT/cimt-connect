import { Header } from "./Header";
import { PanelHeader } from "./PanelHeader";
import { Footer } from "./Footer";
import { ChatbotWidget } from "./ChatbotWidget";
import { SiteTourProvider } from "./SiteTour";
import type { Staff } from "@/lib/staff";

// El sitio público va sobre hoja cuadriculada (como los folletos del CIMT).
// plain: fondo liso. panel: el panel del equipo, con su propia barra arriba
// (sin el menú ni el pie del sitio, que adentro confundían) y fondo liso.
// staff: dentro del panel, con sesión, Migue pasa a modo equipo.
// El recorrido accesible (SiteTour) es solo del sitio público.
export function Layout({ children, plain = false, panel = false, staff }: { children: React.ReactNode; plain?: boolean; panel?: boolean; staff?: Staff }) {
  const page = (
    <div className="flex min-h-screen flex-col">
      {panel ? <PanelHeader /> : <Header />}
      <main className={`isolate flex-1 ${plain || panel ? "" : "bg-notebook"}`}>{children}</main>
      {!panel && <Footer />}
      <ChatbotWidget key={staff ? "equipo" : "sitio"} staff={staff} />
    </div>
  );
  return staff || plain || panel ? page : <SiteTourProvider>{page}</SiteTourProvider>;
}
