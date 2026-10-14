// Portal — "Mi información" (etapa C): lo que el profesional publica y la
// familia lee. Reglas y tipos puros en src/lib/portalInfoRules.ts.
//
// Familia: solo si la regla de acceso dice "ok" para "info" (vínculo,
// verificación, consentimiento, habilitado por el profesional…) y si confirmó
// la contraseña en las últimas horas. Equipo: profesionales y Dirección
// publican y retiran; Administración ve solo los estados (sin textos).

import { createHash } from "node:crypto";
import {
  type InfoDTO, type ReportBody, type StaffInfoDTO, type StaffPublication, type SummaryBody, type WithdrawReason,
  HOME_TIPS, INFO_LIMITS, REVIEW_NOTE_MAX, TRAMITE_CODES, WITHDRAW_REASONS, cleanText, fitText, lintTexts,
  professionalLabel, reportSections, verificationCode,
} from "../../src/lib/portalInfoRules";
import { ADOLESCENT_FROM, ADULT_FROM, adolescentAgreed } from "../../src/lib/portalClinicalRules";
import { ageOn, centerNow } from "../../src/lib/portalRules";
import { type Account, type Ctx, type H3Event, PortalError, activeChildren, missingTable } from "./portal";
import { childrenClinical, needsReauth, requireClinical, staffClinical } from "./portalClinical";

const OFFLINE = "No pudimos conectar. Probá de nuevo.";
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

const THERAPY_LABEL: Record<string, string> = {
  individual: "Terapia individual",
  grupal: "Terapia grupal",
  gam: "Grupo de ayuda mutua",
  familia: "Acompañamiento familiar",
};

type PubRow = {
  id: string; patient_id: string; kind: "resumen" | "informe"; title: string; body: SummaryBody | ReportBody;
  source_report_id: string | null; version: number; author_label: string; published_at: string;
  published_by_email: string; withdrawn_at: string | null; withdrawn_by_email: string | null; withdraw_reason: WithdrawReason | null;
  review_note: string | null;
};
const PUB_COLS = "id, patient_id, kind, title, body, source_report_id, version, author_label, published_at, published_by_email, withdrawn_at, withdrawn_by_email, withdraw_reason, review_note";

function sha256(v: unknown): string {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}

// ── Familia ─────────────────────────────────────────────────────────────────

// La familia abre "Mi información" de una persona vinculada
export async function familyInfo(ctx: Ctx, event: H3Event, account: Account, patientId: string): Promise<InfoDTO> {
  const children = await activeChildren(ctx, account);
  const child = children.find((c) => c.patient_id === patientId);
  // Un paciente ajeno (o de un adulto autorizado) da lo mismo que uno que no existe
  if (!child || child.kind === "autorizado") throw new PortalError(404, "No encontramos esa información en tu cuenta.");
  const outcome = (await childrenClinical(ctx, account)).get(patientId)?.info ?? "not_available";
  if (outcome === "consent") throw new PortalError(403, "Para ver la información de salud, primero activala.", { code: "CONSENT" });
  if (outcome === "verify") throw new PortalError(403, "Para ver la información de salud, la primera vez tenés que pasar por el centro con tu DNI.", { code: "VERIFY" });
  if (outcome !== "ok") throw new PortalError(403, "Todavía no hay información para ver acá.", { code: "NOT_AVAILABLE" });
  if (await needsReauth(ctx, event, account, "info")) {
    throw new PortalError(403, "Para ver la información de salud, volvé a poner tu contraseña.", { code: "REAUTH" });
  }

  const { data, error } = await ctx.admin.from("portal_publications").select(PUB_COLS)
    .eq("patient_id", patientId).is("withdrawn_at", null).order("published_at", { ascending: false });
  if (error) throw new PortalError(503, OFFLINE);
  let pubs = (data ?? []) as PubRow[];

  // Un informe que después se anuló en la ficha deja de verse en el portal
  const sources = pubs.map((p) => p.source_report_id).filter((x): x is string => !!x);
  if (sources.length) {
    const { data: voided, error: vErr } = await ctx.admin.from("patient_reports").select("id")
      .in("id", sources).not("voided_at", "is", null);
    if (vErr) throw new PortalError(503, OFFLINE);
    const gone = new Set(((voided ?? []) as { id: string }[]).map((r) => r.id));
    pubs = pubs.filter((p) => !p.source_report_id || !gone.has(p.source_report_id));
  }

  // ¿Qué abrió ya esta cuenta? (para marcar lo nuevo y para que el equipo sepa quién lo leyó)
  const { data: seen, error: sErr } = pubs.length
    ? await ctx.admin.from("portal_access_log").select("target_id")
      .eq("account_id", account.id).eq("action", "ver_publicacion").in("target_id", pubs.map((p) => p.id))
    : { data: [] as { target_id: string }[], error: null };
  if (sErr) throw new PortalError(503, OFFLINE);
  const seenIds = new Set(((seen ?? []) as { target_id: string }[]).map((s) => s.target_id));

  const now = new Date().toISOString();
  const logRows = [
    { patient_id: patientId, account_id: account.id, action: "ver_informacion", target_id: null, at: now },
    ...pubs.filter((p) => !seenIds.has(p.id)).map((p) => ({ patient_id: patientId, account_id: account.id, action: "ver_publicacion", target_id: p.id, at: now })),
  ];
  const { error: logErr } = await ctx.admin.from("portal_access_log").insert(logRows);
  if (logErr) console.error("[portal] no se pudo registrar la lectura de información de salud");

  const summary = pubs.find((p) => p.kind === "resumen") ?? null;
  return {
    child: { id: child.patient_id, first_name: child.display, self: child.self },
    summary: summary ? {
      ...(summary.body as SummaryBody),
      id: summary.id, author_label: summary.author_label, published_at: summary.published_at,
      version: summary.version, is_new: !seenIds.has(summary.id), code: verificationCode(summary.id),
    } : null,
    reports: pubs.filter((p) => p.kind === "informe")
      .map((p) => {
        const b = p.body as ReportBody;
        return {
          id: p.id, title: p.title, report_date: b.report_date, author_label: p.author_label,
          published_at: p.published_at, sections: reportSections(b), is_new: !seenIds.has(p.id), code: verificationCode(p.id),
          written_by: b.mode === "tal_cual" && b.written_by && b.written_by !== p.author_label ? b.written_by : null,
        };
      })
      .sort((a, b) => b.report_date.localeCompare(a.report_date)),
  };
}

// ── Equipo ──────────────────────────────────────────────────────────────────

type Staff = { user_id: string; email: string; role: string; clinical: boolean };

// Con qué nombre se publica: el profesional vinculado al usuario (con
// matrícula) o, para la Dirección sin profesional vinculado, "Dirección del CIMT"
async function authorOf(ctx: Ctx, staff: Staff): Promise<{ professional_id: string | null; label: string | null; problem: string | null }> {
  if (!staff.clinical) return { professional_id: null, label: null, problem: "Solo los profesionales y la Dirección publican en el portal." };
  const { data: pro, error } = await ctx.admin.from("professionals")
    .select("id, name, license").eq("user_id", staff.user_id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!pro) {
    if (staff.role === "direccion") return { professional_id: null, label: "Dirección del CIMT", problem: null };
    return { professional_id: null, label: null, problem: "Tu usuario no está vinculado a un profesional: pedile a la Dirección que te vincule en Equipo." };
  }
  const license = String(pro.license ?? "").trim();
  if (!license) return { professional_id: pro.id as string, label: null, problem: "Falta tu matrícula. Pedile a la Dirección que la cargue en Equipo." };
  return { professional_id: pro.id as string, label: `${pro.name} · MP ${license}`, problem: null };
}

async function readsFor(ctx: Ctx, pubIds: string[]): Promise<Map<string, { name: string; at: string }[]>> {
  const out = new Map<string, { name: string; at: string }[]>();
  if (!pubIds.length) return out;
  const { data, error } = await ctx.admin.from("portal_access_log").select("target_id, account_id, at")
    .eq("action", "ver_publicacion").in("target_id", pubIds).order("at", { ascending: true });
  if (error) throw new PortalError(503, OFFLINE);
  const rows = (data ?? []) as { target_id: string; account_id: string | null; at: string }[];
  const accIds = [...new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x))];
  const { data: accs } = accIds.length
    ? await ctx.admin.from("portal_accounts").select("id, first_name, last_name").in("id", accIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] };
  for (const r of rows) {
    const a = ((accs ?? []) as { id: string; first_name: string; last_name: string }[]).find((x) => x.id === r.account_id);
    const list = out.get(r.target_id) ?? [];
    const name = a ? `${a.first_name} ${a.last_name}`.trim() : "Una cuenta que ya no existe";
    if (!list.some((x) => x.name === name)) list.push({ name, at: r.at });
    out.set(r.target_id, list);
  }
  return out;
}

export async function staffInfo(ctx: Ctx, staff: Staff, patientId: string): Promise<StaffInfoDTO> {
  const [{ data: p, error: pErr }, pubs, reports, author, access] = await Promise.all([
    ctx.admin.from("patients").select("id, first_name, birth_date, diagnosis_code, professional_id, therapy_modes").eq("id", patientId).maybeSingle(),
    ctx.admin.from("portal_publications").select(PUB_COLS).eq("patient_id", patientId).order("published_at", { ascending: false }),
    ctx.admin.from("patient_reports").select("id, report_date, professional_id, progress, therapy_evolution, voided_at, updated_at, created_at")
      .eq("patient_id", patientId).order("report_date", { ascending: false }),
    authorOf(ctx, staff),
    staffClinical(ctx, patientId, staff.clinical),
  ]);
  if (pErr || pubs.error || reports.error) throw new PortalError(503, OFFLINE);
  if (!p) throw new PortalError(404, "No encontramos ese paciente.");

  const pubRows = (pubs.data ?? []) as PubRow[];
  const allReports = (reports.data ?? []) as {
    id: string; report_date: string; professional_id: string | null; progress: string | null;
    therapy_evolution: string | null; voided_at: string | null; updated_at?: string | null; created_at: string;
  }[];
  const reportRows = allReports.filter((r) => !r.voided_at);
  const voidedIds = new Set(allReports.filter((r) => r.voided_at).map((r) => r.id));
  const proIds = [...new Set([p.professional_id as string | null, ...reportRows.map((r) => r.professional_id)].filter((x): x is string => !!x))];
  const { data: pros } = proIds.length
    ? await ctx.admin.from("professionals").select("id, name, specialty").in("id", proIds)
    : { data: [] as { id: string; name: string; specialty: string | null }[] };
  const proOf = (id: string | null) => (id ? ((pros ?? []) as { id: string; name: string; specialty: string | null }[]).find((x) => x.id === id) ?? null : null);
  const proName = (id: string | null) => proOf(id)?.name ?? null;
  const reads = await readsFor(ctx, pubRows.map((x) => x.id));

  const toStaff = (r: PubRow): StaffPublication => ({
    id: r.id, kind: r.kind, title: r.title,
    body: staff.clinical ? r.body : null, // Administración no ve los textos
    version: r.version, author_label: r.author_label, published_at: r.published_at,
    published_by_email: r.published_by_email, withdrawn_at: r.withdrawn_at, withdrawn_by_email: r.withdrawn_by_email,
    withdraw_reason: r.withdraw_reason, source_report_id: r.source_report_id, reads: reads.get(r.id) ?? [],
    source_voided: !!r.source_report_id && voidedIds.has(r.source_report_id),
    code: verificationCode(r.id),
    review_note: staff.clinical ? r.review_note : null,
  });
  const today = centerNow().date;
  const age = p.birth_date ? ageOn(p.birth_date as string, today) : null;

  return {
    can_publish: staff.clinical,
    author: { label: author.label, problem: author.problem },
    patient: {
      id: p.id as string, first_name: p.first_name as string, age,
      diagnosis_code: (p.diagnosis_code as string | null) ?? null,
      professional_name: proName((p.professional_id as string | null) ?? null),
      professional_label: professionalLabel(proOf((p.professional_id as string | null) ?? null)),
      modes: ((p.therapy_modes as string[] | null) ?? []).map((m) => THERAPY_LABEL[m] ?? m),
    },
    info_enabled: access.settings.info_enabled,
    readers: access.accesses.filter((a) => a.info_block === null).map((a) => a.name),
    summary: (() => { const s = pubRows.find((r) => r.kind === "resumen" && !r.withdrawn_at); return s ? toStaff(s) : null; })(),
    history: pubRows.map(toStaff),
    reports: reportRows.map((r) => {
      const live = pubRows.find((x) => x.kind === "informe" && x.source_report_id === r.id && !x.withdrawn_at) ?? null;
      const edited = r.updated_at ?? r.created_at;
      return {
        id: r.id, report_date: r.report_date, edited_at: edited, professional_name: proName(r.professional_id),
        progress: staff.clinical ? r.progress : null,
        therapy_evolution: staff.clinical ? r.therapy_evolution : null,
        live: live ? toStaff(live) : null,
        changed_after: !!live && !!edited && edited > live.published_at,
      };
    }),
  };
}

// Reglas comunes antes de publicar: el profesional prendió "Mi información",
// no hay pausa, y de 13 a 17 años la conformidad del adolescente y su casilla
async function checkCanPublish(ctx: Ctx, patientId: string, body: Record<string, unknown>) {
  if (body.discussed_ack !== true) throw new PortalError(400, "Confirmá que ya lo conversaste en consulta.");
  const { data: s, error } = await ctx.admin.from("patient_portal_settings")
    .select("info_enabled, paused_at, adolescent_agreed_on, adolescent_withdrawn_on").eq("patient_id", patientId).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!s?.info_enabled) throw new PortalError(409, "Primero prendé «Mostrar «Mi información» en el portal» en Habilitación.");
  if (s.paused_at) throw new PortalError(409, "El portal de este paciente está en pausa: no se puede publicar.");
  const { data: p } = await ctx.admin.from("patients").select("birth_date").eq("id", patientId).maybeSingle();
  const age = p?.birth_date ? ageOn(p.birth_date as string, centerNow().date) : null;
  if (age !== null && age >= ADOLESCENT_FROM && age < ADULT_FROM) {
    if (!adolescentAgreed(s as { adolescent_agreed_on: string | null; adolescent_withdrawn_on: string | null }, age)) {
      throw new PortalError(409, "Falta registrar la conformidad del adolescente (en esta misma sección).");
    }
    if (body.adolescent_ack !== true) throw new PortalError(400, "Confirmá que lo conversaste con el adolescente.");
  }
}

// Retira la versión vigente (si hay) y guarda la nueva, en un solo paso
// (función portal_publish del script 23). expected_id: la versión vigente que
// el profesional tenía en pantalla; si cambió, no se pisa.
async function publishVersion(ctx: Ctx, staff: Staff, expected: unknown, row: {
  patient_id: string; kind: "resumen" | "informe"; title: string; body: SummaryBody | ReportBody;
  source_report_id: string | null; includes_diagnosis: boolean; adolescent_ack: boolean; review_note: string | null;
}) {
  if (expected !== null && expected !== undefined && !isUuid(expected)) throw new PortalError(400, "Pedido inválido");
  const author = await authorOf(ctx, staff);
  if (author.problem || !author.label) throw new PortalError(403, author.problem ?? "No se pudo identificar al autor.");
  const { error } = await ctx.admin.rpc("portal_publish", {
    p_patient: row.patient_id, p_kind: row.kind, p_source_report: row.source_report_id, p_expected: expected ?? null,
    p_title: row.title.slice(0, INFO_LIMITS.title), p_body: row.body, p_body_sha256: sha256(row.body),
    p_professional: author.professional_id, p_author_label: author.label,
    p_includes_diagnosis: row.includes_diagnosis, p_adolescent_ack: row.adolescent_ack,
    p_review_note: row.review_note, p_email: staff.email,
  });
  if (error && (/PUBLISH_CONFLICT/.test(error.message ?? "") || error.code === "23505")) {
    throw new PortalError(409, "Otra persona publicó una versión nueva mientras editabas. Actualizá la sección para verla.");
  }
  if (error) {
    console.error("[portal] no se pudo publicar", error.code);
    throw new PortalError(503, "No se pudo publicar. No se cambió nada en el portal: probá de nuevo.");
  }
}

// Texto limpio y completo: si es más largo que el límite se rechaza (cortarlo
// en silencio podría cambiar lo que dice)
function fit(raw: unknown, max: number, what: string): string {
  const r = fitText(raw, max, what);
  if (r.error) throw new PortalError(400, r.error);
  return r.text;
}

// Frases sobre fluidez o "curar" en lo que se publica: no se bloquea, pero
// el profesional tiene que contar por qué lo deja así (queda guardado)
function reviewNote(texts: string[], body: Record<string, unknown>): string | null {
  const found = lintTexts(texts);
  if (!found.length) return null;
  const note = cleanText(body.review_note, REVIEW_NOTE_MAX);
  if (note.length < 3) {
    throw new PortalError(400, `El texto dice «${found.join("», «")}»: corregilo o contá por qué lo dejás así.`, { code: "REVIEW" });
  }
  return note;
}

export async function publishSummary(ctx: Ctx, staff: Staff, patientId: string, body: Record<string, unknown>): Promise<StaffInfoDTO> {
  requireClinical(staff);
  await checkCanPublish(ctx, patientId, body);
  const que = fit(body.que_trabajamos, INFO_LIMITS.que_trabajamos, "«¿Qué trabajamos en el CIMT?»");
  if (que.length < 20) throw new PortalError(400, "Escribí qué trabajan en el CIMT (al menos unas palabras).");
  const { data: p } = await ctx.admin.from("patients").select("first_name, diagnosis_code, professional_id, therapy_modes").eq("id", patientId).maybeSingle();
  if (!p) throw new PortalError(404, "No encontramos ese paciente.");
  const code = (p.diagnosis_code as string | null) ?? null;
  const tramites = body.show_code === true && code && TRAMITE_CODES[code] ? { code, label: TRAMITE_CODES[code] } : null;
  let como: SummaryBody["como_trabajamos"] = null;
  if (body.show_team === true) {
    const { data: pro } = p.professional_id
      ? await ctx.admin.from("professionals").select("name, specialty").eq("id", p.professional_id).maybeSingle()
      : { data: null };
    como = {
      professional: professionalLabel(pro as { name: string; specialty: string | null } | null),
      modes: ((p.therapy_modes as string[] | null) ?? []).map((m) => THERAPY_LABEL[m] ?? m),
    };
  }
  const tips = Array.isArray(body.tips) ? (body.tips as unknown[]).filter((t): t is string => typeof t === "string" && (HOME_TIPS as readonly string[]).includes(t)) : [];
  const summary: SummaryBody = {
    que_trabajamos: que,
    tramites,
    como_trabajamos: como,
    acompanar: { text: fit(body.acompanar, INFO_LIMITS.acompanar, "«Cómo acompañar en casa»"), tips: [...new Set(tips)] },
  };
  await publishVersion(ctx, staff, body.expected_id, {
    patient_id: patientId, kind: "resumen", title: "Qué trabajamos", body: summary,
    source_report_id: null, includes_diagnosis: true, adolescent_ack: body.adolescent_ack === true,
    review_note: reviewNote([summary.que_trabajamos, summary.acompanar.text], body),
  });
  return staffInfo(ctx, staff, patientId);
}

export async function publishReport(ctx: Ctx, staff: Staff, patientId: string, body: Record<string, unknown>): Promise<StaffInfoDTO> {
  requireClinical(staff);
  if (!isUuid(body.report_id)) throw new PortalError(400, "Pedido inválido");
  await checkCanPublish(ctx, patientId, body);
  const { data: r, error } = await ctx.admin.from("patient_reports")
    .select("id, patient_id, report_date, professional_id, progress, therapy_evolution, voided_at, updated_at, created_at")
    .eq("id", body.report_id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!r || r.patient_id !== patientId) throw new PortalError(404, "No encontramos ese informe.");
  if (r.voided_at) throw new PortalError(409, "El informe está anulado en la ficha: no se puede publicar.");
  // Se publica lo que el profesional revisó: si el informe se editó en la
  // ficha mientras tanto, primero tiene que ver el texto nuevo
  if (body.report_edited_at !== ((r.updated_at as string | null) ?? (r.created_at as string))) {
    throw new PortalError(409, "El informe cambió en la ficha mientras lo revisabas. Actualizá la sección para ver el texto nuevo.");
  }
  let report: ReportBody;
  if (body.mode === "familia") {
    const text = fit(body.text, INFO_LIMITS.report_text, "La versión para la familia");
    if (text.length < 20) throw new PortalError(400, "Escribí la versión para la familia (al menos unas palabras).");
    report = { mode: "familia", report_date: r.report_date as string, text };
  } else if (body.mode === "tal_cual") {
    // Tal cual solo se publican Progreso y Evolución: el Diagnóstico de un
    // informe está escrito para el equipo y nunca va tal cual
    const progress = body.include_progress === true
      ? fit(r.progress, INFO_LIMITS.report_text, "El Progreso del informe (para publicarlo tal cual)") || null : null;
    const evolution = body.include_evolution === true
      ? fit(r.therapy_evolution, INFO_LIMITS.report_text, "La Evolución del informe (para publicarla tal cual)") || null : null;
    if (!progress && !evolution) throw new PortalError(400, "Elegí al menos una sección con texto (Progreso o Evolución).");
    // Quién lo escribió en la ficha: si no es quien lo publica, la familia ve los dos
    const { data: writer } = r.professional_id
      ? await ctx.admin.from("professionals").select("name, license").eq("id", r.professional_id).maybeSingle()
      : { data: null };
    const license = String(writer?.license ?? "").trim();
    report = {
      mode: "tal_cual", report_date: r.report_date as string, progress, therapy_evolution: evolution,
      written_by: writer ? `${writer.name}${license ? ` · MP ${license}` : ""}` : null,
    };
  } else {
    throw new PortalError(400, "Elegí cómo publicarlo.");
  }
  const [y, m, d] = String(r.report_date).split("-");
  await publishVersion(ctx, staff, body.expected_id, {
    patient_id: patientId, kind: "informe", title: `Informe del ${d}/${m}/${y}`, body: report,
    source_report_id: r.id as string, includes_diagnosis: false, adolescent_ack: body.adolescent_ack === true,
    review_note: reviewNote(reportSections(report).map((x) => x.text), body),
  });
  return staffInfo(ctx, staff, patientId);
}

export async function withdrawPublication(ctx: Ctx, staff: Staff, patientId: string, body: Record<string, unknown>): Promise<StaffInfoDTO> {
  requireClinical(staff);
  if (!isUuid(body.publication_id)) throw new PortalError(400, "Pedido inválido");
  const reason = String(body.reason) as WithdrawReason;
  if (!(WITHDRAW_REASONS as readonly string[]).includes(reason)) throw new PortalError(400, "Elegí el motivo.");
  const { data: pub, error } = await ctx.admin.from("portal_publications")
    .select("id, patient_id, published_by_email, withdrawn_at").eq("id", body.publication_id).maybeSingle();
  if (error) throw new PortalError(503, OFFLINE);
  if (!pub || pub.patient_id !== patientId) throw new PortalError(404, "No encontramos esa publicación.");
  if (pub.withdrawn_at) throw new PortalError(409, "Ya estaba retirada. Actualizá la sección.");
  // Cada profesional retira lo suyo; la Dirección, cualquier cosa
  if (staff.role !== "direccion" && pub.published_by_email !== staff.email) {
    throw new PortalError(403, "Solo quien lo publicó o la Dirección lo pueden retirar.");
  }
  const { data: done, error: uErr } = await ctx.admin.from("portal_publications")
    .update({ withdrawn_at: new Date().toISOString(), withdrawn_by_email: staff.email, withdraw_reason: reason })
    .eq("id", pub.id).is("withdrawn_at", null).select("id");
  if (uErr) throw new PortalError(503, OFFLINE);
  if (!done?.length) throw new PortalError(409, "Ya estaba retirada. Actualizá la sección.");
  return staffInfo(ctx, staff, patientId);
}

// Para el Inicio: cuántas publicaciones vigentes no abrió todavía esta cuenta
// (solo de las personas para las que "info" da ok). No muestra contenido.
export async function infoNewCounts(ctx: Ctx, account: Account, patientIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!patientIds.length) return out;
  const { data, error } = await ctx.admin.from("portal_publications").select("id, patient_id, source_report_id")
    .in("patient_id", patientIds).is("withdrawn_at", null);
  if (error) {
    if (missingTable(error)) return out;
    throw new PortalError(503, OFFLINE);
  }
  let pubs = (data ?? []) as { id: string; patient_id: string; source_report_id: string | null }[];
  if (!pubs.length) return out;
  const sources = pubs.map((p) => p.source_report_id).filter((x): x is string => !!x);
  const [{ data: seen, error: sErr }, { data: voided, error: vErr }] = await Promise.all([
    ctx.admin.from("portal_access_log").select("target_id")
      .eq("account_id", account.id).eq("action", "ver_publicacion").in("target_id", pubs.map((p) => p.id)),
    sources.length
      ? ctx.admin.from("patient_reports").select("id").in("id", sources).not("voided_at", "is", null)
      : Promise.resolve({ data: [] as { id: string }[], error: null }),
  ]);
  if (sErr || vErr) throw new PortalError(503, OFFLINE);
  const seenIds = new Set(((seen ?? []) as { target_id: string }[]).map((x) => x.target_id));
  const gone = new Set(((voided ?? []) as { id: string }[]).map((x) => x.id));
  pubs = pubs.filter((p) => !seenIds.has(p.id) && !(p.source_report_id && gone.has(p.source_report_id)));
  for (const p of pubs) out.set(p.patient_id, (out.get(p.patient_id) ?? 0) + 1);
  return out;
}
