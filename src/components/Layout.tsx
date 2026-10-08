import { Header } from "./Header";
import { Footer } from "./Footer";
import { ChatbotWidget } from "./ChatbotWidget";
import type { Staff } from "@/lib/staff";

// El sitio público va sobre hoja cuadriculada (como los folletos del CIMT).
// El panel de administración usa plain: fondo liso, más cómodo para trabajar.
// staff: dentro del panel, con sesión, Migue pasa a modo equipo
export function Layout({ children, plain = false, staff }: { children: React.ReactNode; plain?: boolean; staff?: Staff }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={`isolate flex-1 ${plain ? "" : "bg-notebook"}`}>{children}</main>
      <Footer />
      <ChatbotWidget key={staff ? "equipo" : "sitio"} staff={staff} />
    </div>
  );
}
