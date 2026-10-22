// @lovable.dev/vite-tanstack-config already includes the following - do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nitro } from "nitro/vite";

export default defineConfig({
  cloudflare: false,
  // Las funciones de Vercel corren en São Paulo (gru1), al lado de la base de
  // Supabase (sa-east-1): cada pedido del portal hace varias consultas
  // seguidas y desde Washington (la región por defecto) cada una cruzaba el
  // continente.
  // Todos los días a las 6 de Argentina (9 UTC): la limpieza de los audios de
  // «Me grabo» con más de 90 días (server/api/cron/limpieza.ts; necesita la
  // variable CRON_SECRET en Vercel)
  plugins: [nitro({
    serverDir: "server",
    vercel: {
      functions: { regions: ["gru1"] },
      config: { version: 3, crons: [{ path: "/api/cron/limpieza", schedule: "0 9 * * *" }] },
    },
  })],
});
