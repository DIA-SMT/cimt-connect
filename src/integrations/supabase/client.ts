/**
 * Supabase client — auto-selects between mock and real based on VITE_USE_MOCK.
 *
 * Development without a DB:   VITE_USE_MOCK=true  in .env.local
 * Production / own DB:        remove VITE_USE_MOCK (or set to false) and
 *                             supply VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { mockSupabase } from "./mockClient";

// ── Mock mode ────────────────────────────────────────────────────────────────

const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

if (USE_MOCK) {
  console.info(
    "[cimt-connect] 🧪 Mock mode active — using in-memory data. " +
    "Set VITE_USE_MOCK=false and configure VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY to use a real database."
  );
}

// ── Real Supabase client (lazy) ───────────────────────────────────────────────

function createSupabaseClient() {
  const SUPABASE_URL =
    import.meta.env.VITE_SUPABASE_URL || (typeof process !== "undefined" ? process.env.SUPABASE_URL : undefined);
  const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    (typeof process !== "undefined" ? process.env.SUPABASE_PUBLISHABLE_KEY : undefined);

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Missing Supabase environment variables. " +
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your .env file, " +
      "or enable mock mode with VITE_USE_MOCK=true."
    );
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// ── Export ────────────────────────────────────────────────────────────────────
// Import the supabase client like this:
//   import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = USE_MOCK
  ? mockSupabase
  : new Proxy({} as ReturnType<typeof createSupabaseClient>, {
      get(_, prop, receiver) {
        if (!_supabase) _supabase = createSupabaseClient();
        return Reflect.get(_supabase, prop, receiver);
      },
    });
