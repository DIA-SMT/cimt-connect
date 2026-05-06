import { Header } from "./Header";
import { Footer } from "./Footer";
import { ChatbotWidget } from "./ChatbotWidget";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
      <ChatbotWidget />
    </div>
  );
}