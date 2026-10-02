import { Header } from "./Header";
import { Footer } from "./Footer";
import { ChatbotWidget } from "./ChatbotWidget";

// El sitio público va sobre hoja cuadriculada (como los folletos del CIMT).
// El panel de administración usa plain: fondo liso, más cómodo para trabajar.
export function Layout({ children, plain = false }: { children: React.ReactNode; plain?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={`isolate flex-1 ${plain ? "" : "bg-notebook"}`}>{children}</main>
      <Footer />
      <ChatbotWidget />
    </div>
  );
}
