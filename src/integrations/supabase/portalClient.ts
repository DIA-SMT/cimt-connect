import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente de Supabase SOLO para la sesión de las familias del portal.
// Es distinto del cliente del panel (client.ts): guarda la sesión con otra
// clave, así una persona del equipo y una familia pueden usar el mismo
// navegador sin pisarse. Las familias no leen tablas: este cliente solo
// guarda y renueva la sesión; los datos los traen server/api/portal/*.

let client: SupabaseClient | null = null;

export function portalClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY para el portal de familias.");
  }
  client = createClient(url, key, {
    auth: {
      storageKey: "cimt-portal-auth",
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
