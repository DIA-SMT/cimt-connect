import { timingSafeEqual } from "node:crypto";
import { defineEventHandler } from "nitro/h3";
import { PortalError, handle, setup } from "../../lib/portal";
import { sweepExpired } from "../../lib/recordings";

// Limpieza diaria (Vercel Cron, agendada en vite.config.ts): borra el audio
// de las grabaciones de «Me grabo» que pasaron los 90 días, aunque nadie
// mande grabaciones ni abra el panel. El aviso a la familia lo promete.
//   GET /api/cron/limpieza → { grabaciones: <cuántos audios se borraron> }
// Vercel la llama con «Authorization: Bearer $CRON_SECRET». Sin CRON_SECRET
// en las variables del proyecto no corre (401): nadie de afuera la dispara.

const MAX_ROUNDS = 25; // de a 20 por vuelta (SWEEP_BATCH): hasta 500 por día

export default defineEventHandler((event) => handle(event, async () => {
  const secret = process.env.CRON_SECRET?.trim();
  const got = Buffer.from(event.req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) throw new PortalError(401, "No autorizado");
  const ctx = setup();
  let total = 0;
  for (let i = 0; i < MAX_ROUNDS; i++) {
    const n = await sweepExpired(ctx);
    total += n;
    if (n === 0) break;
  }
  if (total) console.log(`[limpieza] audios borrados: ${total}`);
  return { grabaciones: total };
}));
