// «Me grabo»: las grabaciones de práctica que manda la familia y escucha el
// profesional (reglas en src/lib/recordingRules.ts, análisis en
// src/lib/recordingAnalysis.ts, tablas y depósito en el script 38).
//   - La familia sube un WAV (16 kHz, mono, hasta 60 s) de un ejercicio cuya
//     actividad es «grabacion», con su permiso de grabaciones vigente.
//   - El audio va al depósito privado (solo lo toca el servidor) y lo reconoce
//     Azure o Groq, uno de respaldo del otro (sttOrder): de ahí salen las
//     cuentas y las marcas.
//   - El profesional (Dirección o el profesional del paciente) lo escucha con
//     una URL firmada de pocos minutos y anota su conteo (%SS).
//   - A los 90 días se borra el audio y el texto de lo que se dijo; quedan los
//     números. Se barre todos los días (server/api/cron/limpieza.ts), en cada
//     subida y cada vez que el panel pide la lista.
//   - Si la cuenta retira el permiso, se borra ya el audio de lo que mandó.
//   - Cada vez que alguien del equipo abre un audio queda en portal_access_log.

import { randomUUID } from "node:crypto";
import { type ActivitySpec, readActivity } from "../../src/lib/activitySpec";
import { type RecognizedWord, type RecordingAnalysis, analyzeWords, parseAzureDetailed, parseWhisperVerbose } from "../../src/lib/recordingAnalysis";
import {
  type FamilyRecordingConsentDTO, RECORDING_BUCKET, RECORDING_DAILY_MAX, RECORDING_MAX_BYTES, RECORDING_MIN_MS, RECORDING_NOTICE_VERSION,
  type RecordingStatus, type StaffRecordingConsent, type StaffRecordingDTO, deleteAfter, stripAnalysis, validateReview,
} from "../../src/lib/recordingRules";
import { wavDurationMs } from "../../src/lib/wavEncoder";
import { type Account, type Ctx, PortalError, centerNow, missingTable } from "./portal";
import { features } from "./portalClinical";
import { centerDayStartIso, resolveExercise } from "./practice";
import { azureConfig, recognize, recognizeGroq } from "./voice";

const OFFLINE = "No pudimos conectar. Probá de nuevo.";
const NOT_FOUND = "No encontramos esa grabación.";
const MISSING = "Las grabaciones todavía no están listas en la base (falta correr el script 38).";
const AUDIO_GONE = "El audio ya se borró (pasaron los 90 días o la familia retiró el permiso).";
const SWEEP_BATCH = 20;

type Row = {
  id: string; patient_id: string; plan_id: string; exercise_id: string; exercise_key: string; account_id: string | null;
  storage_path: string; duration_ms: number; status: RecordingStatus; analysis: RecordingAnalysis | null;
  analysis_error: string | null; review: StaffRecordingDTO["review"]; reviewed_at: string | null; reviewed_by_email: string | null;
  audio_deleted_at: string | null; delete_after: string; created_at: string;
};
const COLS = "id, patient_id, plan_id, exercise_id, exercise_key, account_id, storage_path, duration_ms, status, analysis, analysis_error, review, reviewed_at, reviewed_by_email, audio_deleted_at, delete_after, created_at";

/** Las tres etapas juntas: práctica, actividades y grabaciones */
export function recordingsOn(): boolean {
  const f = features();
  return f.includes("practice") && f.includes("activities") && f.includes("recordings");
}

export function requireRecordings() {
  if (!recordingsOn()) throw new PortalError(404, "No disponible.");
}

const dbFail = (error: { code?: string; message?: string } | null) =>
  missingTable(error) ? new PortalError(503, MISSING) : new PortalError(503, OFFLINE);

// ── El permiso de la cuenta ─────────────────────────────────────────────────

async function consentOk(ctx: Ctx, accountId: string): Promise<boolean> {
  const { data, error } = await ctx.admin.from("portal_consents").select("accepted, version")
    .eq("account_id", accountId).eq("kind", "grabaciones").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw dbFail(error);
  return !!data && data.accepted === true && data.version === RECORDING_NOTICE_VERSION;
}

/** Cuántas grabaciones de la cuenta todavía tienen audio */
async function audiosOf(ctx: Ctx, accountId: string): Promise<number> {
  const { count, error } = await ctx.admin.from("practice_recordings").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).is("audio_deleted_at", null);
  if (error) throw dbFail(error);
  return count ?? 0;
}

export async function familyRecordingConsent(ctx: Ctx, account: Account): Promise<FamilyRecordingConsentDTO> {
  requireRecordings();
  const [accepted, audios] = await Promise.all([consentOk(ctx, account.id), audiosOf(ctx, account.id)]);
  return { accepted, version: RECORDING_NOTICE_VERSION, audios };
}

// Retirar el permiso borra ya el audio de todo lo que mandó la cuenta (el
// aviso lo promete): se adelanta el vencimiento y se barre. Quedan los números
// y las anotaciones del profesional, como a los 90 días.
export async function familyRecordingAccept(ctx: Ctx, account: Account, accepted: boolean): Promise<FamilyRecordingConsentDTO> {
  requireRecordings();
  const { error } = await ctx.admin.from("portal_consents").insert({
    account_id: account.id, kind: "grabaciones", version: RECORDING_NOTICE_VERSION, accepted, channel: "portal",
  });
  if (error) throw new PortalError(503, "No pudimos guardar tu respuesta. Probá de nuevo.");
  if (!accepted) {
    const { error: upErr } = await ctx.admin.from("practice_recordings").update({ delete_after: new Date().toISOString() })
      .eq("account_id", account.id).is("audio_deleted_at", null);
    if (upErr) console.error("[grabaciones] retirar permiso:", upErr.code ?? "error");
    for (let i = 0; i < 25 && (await sweepExpired(ctx).catch(() => 0)) > 0; i++);
  }
  return { accepted, version: RECORDING_NOTICE_VERSION, audios: await audiosOf(ctx, account.id) };
}

// ── La familia manda una grabación ──────────────────────────────────────────

export async function familyUpload(ctx: Ctx, account: Account, exerciseId: unknown, wav: Uint8Array): Promise<{ id: string; status: RecordingStatus }> {
  requireRecordings();
  const { plan, ex } = await resolveExercise(ctx, account, exerciseId);
  const act = readActivity((ex as { activity?: unknown }).activity ?? null);
  if (!act || act.mecanica !== "grabacion") throw new PortalError(404, "Este ejercicio no pide una grabación.");
  if (!(await consentOk(ctx, account.id))) {
    throw new PortalError(403, "Para mandar grabaciones, primero aceptá el permiso.", { code: "RECORDING_CONSENT" });
  }
  if (wav.length > RECORDING_MAX_BYTES) throw new PortalError(413, "La grabación es demasiado larga.");
  const ms = wavDurationMs(wav);
  if (ms === null) throw new PortalError(400, "No pudimos leer la grabación. Probá grabar de nuevo.");
  if (ms < RECORDING_MIN_MS) throw new PortalError(400, "Fue muy cortita. Probá grabar de nuevo.");
  if (ms > act.segundos * 1000 + 1500) throw new PortalError(400, `La grabación dura hasta ${act.segundos} segundos.`);

  const { count, error: countErr } = await ctx.admin.from("practice_recordings").select("id", { count: "exact", head: true })
    .eq("account_id", account.id).gte("created_at", centerDayStartIso(centerNow().date));
  if (countErr) throw dbFail(countErr);
  if ((count ?? 0) >= RECORDING_DAILY_MAX) {
    throw new PortalError(429, `Por hoy ya llegaron ${RECORDING_DAILY_MAX} grabaciones. Mañana se puede mandar otra.`, { code: "LIMIT" });
  }

  const id = randomUUID();
  const path = `${ex.patient_id}/${id}.wav`;
  const up = await ctx.admin.storage.from(RECORDING_BUCKET).upload(path, wav, { contentType: "audio/wav", upsert: false });
  if (up.error) throw new PortalError(503, OFFLINE);
  const created = new Date().toISOString();
  const { error } = await ctx.admin.from("practice_recordings").insert({
    id, patient_id: ex.patient_id, plan_id: plan.id, exercise_id: ex.id, exercise_key: ex.exercise_key, account_id: account.id,
    storage_path: path, duration_ms: ms, status: "analizando", created_at: created, delete_after: deleteAfter(created),
  });
  if (error) {
    await ctx.admin.storage.from(RECORDING_BUCKET).remove([path]).catch(() => {});
    throw dbFail(error);
  }
  const status = await analyze(ctx, id, wav);
  await sweepExpired(ctx).catch(() => {});
  return { id, status };
}

// ── El análisis ─────────────────────────────────────────────────────────────

// Quién reconoce la grabación, en orden: PORTAL_STT («azure,groq» por
// defecto; «groq,azure» para usar primero Groq). Si uno falla, se queda sin
// cupo o no reconoce nada, prueba el siguiente que tenga claves
export type SttSource = "azure" | "groq";

export function sttOrder(env: Record<string, string | undefined> = process.env): SttSource[] {
  const wanted = (env.PORTAL_STT ?? "azure,groq").split(",").map((x) => x.trim()).filter((x): x is SttSource => x === "azure" || x === "groq");
  const order = [...new Set(wanted.length ? wanted : (["azure", "groq"] as SttSource[]))];
  return order.filter((s) => (s === "azure" ? !!azureConfig(env) : !!env.GROQ_API_KEY?.trim()));
}

async function wordsOf(wav: Uint8Array): Promise<{ words: RecognizedWord[]; source: SttSource } | null> {
  let failed: unknown = null;
  for (const source of sttOrder()) {
    try {
      const words = source === "azure"
        ? parseAzureDetailed(await recognize(wav, azureConfig(process.env)!))
        : parseWhisperVerbose(await recognizeGroq(wav, process.env.GROQ_API_KEY!.trim()));
      if (words) return { words, source };
    } catch (e) {
      failed = e;
      console.error(`[grabaciones] ${source}:`, e instanceof Error ? e.message.slice(0, 60) : "error");
    }
  }
  if (failed) throw failed;
  return null;
}

async function analyze(ctx: Ctx, id: string, wav: Uint8Array): Promise<RecordingStatus> {
  let status: RecordingStatus = "error";
  let analysis: RecordingAnalysis | null = null;
  let problem: string | null = null;
  try {
    if (!sttOrder().length) throw new Error("sin claves de Azure ni de Groq");
    const got = await wordsOf(wav);
    if (got) {
      analysis = { ...analyzeWords(got.words), source: got.source };
      status = "lista";
    } else problem = "No se escuchó habla en la grabación.";
  } catch {
    // Sin lo que se dijo en el log (wordsOf ya anotó qué servicio falló)
    problem = "No se pudo analizar. Se puede escuchar igual o volver a analizar.";
  }
  const { error } = await ctx.admin.from("practice_recordings")
    .update({ status, analysis, analysis_error: problem, analyzed_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error("[grabaciones] guardar análisis:", error.code ?? "error");
  return status;
}

// ── Los 90 días ─────────────────────────────────────────────────────────────

export async function sweepExpired(ctx: Ctx): Promise<number> {
  const { data, error } = await ctx.admin.from("practice_recordings").select("id, storage_path, analysis")
    .is("audio_deleted_at", null).lt("delete_after", new Date().toISOString()).limit(SWEEP_BATCH);
  if (error || !data?.length) return 0;
  const rows = data as Pick<Row, "id" | "storage_path" | "analysis">[];
  const rm = await ctx.admin.storage.from(RECORDING_BUCKET).remove(rows.map((r) => r.storage_path));
  if (rm.error) return 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    await ctx.admin.from("practice_recordings").update({ audio_deleted_at: now, analysis: stripAnalysis(r.analysis) }).eq("id", r.id);
  }
  return rows.length;
}

// ── El profesional ──────────────────────────────────────────────────────────

async function rowById(ctx: Ctx, id: unknown): Promise<Row> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new PortalError(400, "Pedido inválido");
  const { data, error } = await ctx.admin.from("practice_recordings").select(COLS).eq("id", id).maybeSingle();
  if (error) throw dbFail(error);
  if (!data) throw new PortalError(404, NOT_FOUND);
  return data as Row;
}

export async function staffRecordings(ctx: Ctx, patientId: string): Promise<StaffRecordingDTO[]> {
  await sweepExpired(ctx).catch(() => {});
  const { data, error } = await ctx.admin.from("practice_recordings").select(COLS).eq("patient_id", patientId)
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw dbFail(error);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map((r) => r.exercise_id))];
  const exercises = new Map<string, { title: string; activity: ActivitySpec | null }>();
  if (ids.length) {
    const { data: ex, error: exErr } = await ctx.admin.from("patient_exercises").select("id, title, activity").in("id", ids);
    if (exErr) throw new PortalError(503, OFFLINE);
    for (const e of (ex ?? []) as { id: string; title: string; activity: unknown }[]) {
      exercises.set(e.id, { title: e.title, activity: readActivity(e.activity) });
    }
  }
  return rows.map((r) => {
    const e = exercises.get(r.exercise_id);
    const act = e?.activity?.mecanica === "grabacion" ? e.activity : null;
    return {
      id: r.id, created_at: r.created_at, exercise_title: e?.title ?? "Ejercicio", consigna: act?.consigna ?? null,
      texto: act?.texto ?? null, duration_ms: r.duration_ms, status: r.status, analysis: r.analysis, review: r.review,
      reviewed_at: r.reviewed_at, reviewed_by_email: r.reviewed_by_email, audio: !r.audio_deleted_at, delete_after: r.delete_after,
    };
  });
}

/** El audio, con una URL firmada de 5 minutos. Queda registrado quién lo abrió */
export async function staffRecordingAudio(ctx: Ctx, staff: { email: string }, id: unknown): Promise<{ url: string }> {
  const row = await rowById(ctx, id);
  if (row.audio_deleted_at) throw new PortalError(410, AUDIO_GONE);
  const { data, error } = await ctx.admin.storage.from(RECORDING_BUCKET).createSignedUrl(row.storage_path, 300);
  if (error || !data?.signedUrl) throw new PortalError(503, OFFLINE);
  const { error: logErr } = await ctx.admin.from("portal_access_log").insert({
    patient_id: row.patient_id, account_id: null, staff_email: staff.email, action: "equipo_escuchar_grabacion", target_id: row.id,
  });
  if (logErr) console.error("[grabaciones] registro de acceso:", logErr.code ?? "error");
  return { url: data.signedUrl };
}

/** El permiso de grabaciones de cada adulto (o del paciente) con acceso al portal */
export async function staffRecordingConsents(ctx: Ctx, patientId: string): Promise<StaffRecordingConsent[]> {
  const { data: links, error } = await ctx.admin.from("portal_links").select("account_id, guardian_id")
    .eq("patient_id", patientId).is("revoked_at", null);
  if (error) throw new PortalError(503, OFFLINE);
  const rows = (links ?? []) as { account_id: string; guardian_id: string | null }[];
  if (!rows.length) return [];
  const accountIds = [...new Set(rows.map((l) => l.account_id))];
  const guardianIds = rows.map((l) => l.guardian_id).filter((g): g is string => !!g);
  const [accounts, guardians, consents] = await Promise.all([
    ctx.admin.from("portal_accounts").select("id, first_name, last_name").in("id", accountIds),
    guardianIds.length
      ? ctx.admin.from("patient_guardians").select("id, relationship").in("id", guardianIds)
      : Promise.resolve({ data: [], error: null }),
    ctx.admin.from("portal_consents").select("account_id, accepted, version, created_at")
      .in("account_id", accountIds).eq("kind", "grabaciones").order("created_at", { ascending: false }),
  ]);
  if (accounts.error || guardians.error || consents.error) throw dbFail(accounts.error ?? guardians.error ?? consents.error);
  const accs = (accounts.data ?? []) as { id: string; first_name: string; last_name: string }[];
  const rels = (guardians.data ?? []) as { id: string; relationship: string | null }[];
  const cons = (consents.data ?? []) as { account_id: string; accepted: boolean; version: string; created_at: string }[];
  return rows.flatMap((l) => {
    const acc = accs.find((a) => a.id === l.account_id);
    if (!acc) return [];
    const c = cons.find((x) => x.account_id === l.account_id);
    const state: StaffRecordingConsent["state"] = !c ? "nunca" : c.accepted && c.version === RECORDING_NOTICE_VERSION ? "si" : "no";
    return [{
      name: `${acc.first_name} ${acc.last_name}`.trim(), relationship: rels.find((x) => x.id === l.guardian_id)?.relationship ?? null,
      state, at: c?.created_at ?? null,
    }];
  });
}

export async function staffRecordingReview(ctx: Ctx, staff: { email: string }, id: unknown, body: unknown): Promise<{ ok: true }> {
  const row = await rowById(ctx, id);
  const v = validateReview(body);
  if (!v.ok) throw new PortalError(400, v.error);
  const { error } = await ctx.admin.from("practice_recordings").update({
    review: v.value, status: "revisada", reviewed_at: new Date().toISOString(), reviewed_by_email: staff.email,
  }).eq("id", row.id);
  if (error) throw dbFail(error);
  return { ok: true };
}

export async function staffRecordingReanalyze(ctx: Ctx, id: unknown): Promise<{ status: RecordingStatus }> {
  const row = await rowById(ctx, id);
  if (row.audio_deleted_at) throw new PortalError(410, AUDIO_GONE);
  const { data, error } = await ctx.admin.storage.from(RECORDING_BUCKET).download(row.storage_path);
  if (error || !data) throw new PortalError(503, OFFLINE);
  const status = await analyze(ctx, row.id, new Uint8Array(await data.arrayBuffer()));
  // Una grabación ya revisada sigue revisada (el análisis nuevo queda al lado)
  if (row.status === "revisada") {
    await ctx.admin.from("practice_recordings").update({ status: "revisada" }).eq("id", row.id);
    return { status: "revisada" };
  }
  return { status };
}
