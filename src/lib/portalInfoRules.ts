// Portal — "Mi información" (etapa C): lo que el profesional publica para el
// paciente o su familia. Puro: lo usan el servidor (server/lib/portalInfo.ts),
// el modo mock y las pruebas. Sin alias de imports (el servidor lo importa
// con ruta relativa).
//
// Nada de la ficha pasa solo al portal: el profesional escribe o elige cada
// cosa, ve quién la va a leer y la publica. Lo publicado es una copia
// congelada (no se edita: se retira y se publica una versión nueva).

// ── Límites ─────────────────────────────────────────────────────────────────
export const INFO_LIMITS = {
  que_trabajamos: 1500,
  acompanar: 800,
  report_text: 3000,
  title: 120,
} as const;

// Códigos que se pueden mostrar en "Datos para trámites" (solo estos)
export const TRAMITE_CODES: Record<string, string> = {
  "F98.5": "Tartamudez (CIE-10 F98.5)",
  "F98.6": "Farfulleo (CIE-10 F98.6)",
};

// Consejos para acompañar en casa que el profesional puede tildar
export const HOME_TIPS = [
  "Escuchar con paciencia, sin apurar",
  "No completar sus frases",
  "Valorar lo que dice, no cómo lo dice",
  "Darle tiempo para hablar",
  "Hablar con calma, sin pedirle que hable más despacio",
  "Hablar del tema con naturalidad si lo saca",
] as const;

export const WITHDRAW_REASONS = ["error", "pedido_familia", "otro"] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number] | "reemplazada";

// ── Revisión del texto ───────────────────────────────────────────────────────
// Frases que ponen el foco en "hablar sin trabarse" o en curar: en el portal
// no se mide ni se promete fluidez (puede sumar presión y ansiedad). Es un
// aviso para el profesional, no un bloqueo.
const FLUENCY_PATTERNS: [RegExp, string][] = [
  [/\bhabl(?:ar|e|á|a) bien\b/i, "hablar bien"],
  [/\bsin trab(?:arse|arte|ar)\b/i, "sin trabarse"],
  [/\bsin tartamude(?:ar|o)\b/i, "sin tartamudear"],
  [/\bflu(?:ido|ida|idez)\b/i, "fluidez"],
  [/\bcur(?:ar|arse|a|ación)\b/i, "curar"],
  [/\bnormal(?:mente|izar)?\b/i, "normal"],
];

export function lintText(text: string): string[] {
  const found: string[] = [];
  for (const [re, label] of FLUENCY_PATTERNS) if (re.test(text) && !found.includes(label)) found.push(label);
  return found;
}

// Texto plano: se colapsan espacios, se respetan los saltos de línea
export function cleanText(raw: unknown, max: number = Number.MAX_SAFE_INTEGER): string {
  return String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

// Texto limpio y completo. Si pasa el límite no se corta (cortarlo en silencio
// podría cambiar lo que dice): error = el mensaje para mostrar
export function fitText(raw: unknown, max: number, what: string): { text: string; error: string | null } {
  const text = cleanText(raw);
  return { text, error: text.length > max ? `${what} es muy largo: el máximo es ${max} caracteres.` : null };
}

// Frases sobre fluidez en varios textos, revisados ya limpios (como en el servidor)
export function lintTexts(texts: string[]): string[] {
  return [...new Set(texts.flatMap((t) => lintText(cleanText(t))))];
}

// Cómo figura quien lo atiende en "Cómo lo trabajamos" (nombre y especialidad)
export function professionalLabel(pro: { name: string; specialty?: string | null } | null): string | null {
  if (!pro) return null;
  return pro.specialty ? `${pro.name} (${pro.specialty})` : pro.name;
}

// Código que va al pie de lo publicado ("12345 67890"): sale del id de la
// publicación, así el equipo puede ubicar exactamente qué versión leyó la familia
export function verificationCode(id: string): string {
  const hex = id.replace(/[^0-9a-f]/gi, "").slice(0, 12);
  const n = (BigInt(`0x${hex || "0"}`) % 10_000_000_000n).toString().padStart(10, "0");
  return `${n.slice(0, 5)} ${n.slice(5)}`;
}

// Aviso de fluidez en lo que se va a publicar: hace falta el motivo para dejarlo
export const REVIEW_NOTE_MAX = 200;

// ── Lo que se guarda (body) ──────────────────────────────────────────────────

export type SummaryBody = {
  que_trabajamos: string;
  tramites: { code: string; label: string } | null;
  como_trabajamos: { professional: string | null; modes: string[] } | null;
  acompanar: { text: string; tips: string[] };
};

export type ReportBody =
  | { mode: "familia"; report_date: string; text: string }
  // written_by: quien escribió el informe en la ficha (puede no ser quien lo publica)
  | { mode: "tal_cual"; report_date: string; progress: string | null; therapy_evolution: string | null; written_by?: string | null };

// Secciones de un informe tal como las lee la familia
export function reportSections(b: ReportBody): { label: string; text: string }[] {
  if (b.mode === "familia") return [{ label: "", text: b.text }];
  const out: { label: string; text: string }[] = [];
  if (b.progress) out.push({ label: "Progreso", text: b.progress });
  if (b.therapy_evolution) out.push({ label: "Evolución de la terapia", text: b.therapy_evolution });
  return out;
}

// ── Lo que ve la familia ─────────────────────────────────────────────────────

export type InfoSummaryDTO = SummaryBody & {
  id: string; author_label: string; published_at: string; version: number; is_new: boolean; code: string;
};
export type InfoReportDTO = {
  id: string; title: string; report_date: string; author_label: string; published_at: string;
  sections: { label: string; text: string }[]; is_new: boolean; code: string;
  written_by: string | null; // "tal cual" de un informe que escribió otra persona: quién lo escribió
};
export type InfoDTO = {
  child: { id: string; first_name: string; self: boolean };
  summary: InfoSummaryDTO | null;
  reports: InfoReportDTO[];
};

// ── Lo que ve el equipo ──────────────────────────────────────────────────────

export type StaffPublication = {
  id: string;
  kind: "resumen" | "informe";
  title: string;
  body: SummaryBody | ReportBody | null; // null para Administración (no ve textos clínicos)
  version: number;
  author_label: string;
  published_at: string;
  published_by_email: string;
  withdrawn_at: string | null;
  withdrawn_by_email: string | null;
  withdraw_reason: WithdrawReason | null;
  source_report_id: string | null;
  reads: { name: string; at: string }[]; // quién de la familia lo abrió (la primera vez)
  source_voided: boolean; // el informe de la ficha se anuló: la familia ya no lo ve
  code: string; // código de verificación (el mismo que ve la familia)
  review_note: string | null; // por qué se dejó un texto con aviso de fluidez (solo perfiles clínicos)
};

export type StaffReportRow = {
  id: string;
  report_date: string;
  edited_at: string; // última edición en la ficha: se manda al publicar (si cambió, 409)
  professional_name: string | null;
  // Solo para perfiles clínicos (Administración no ve textos)
  progress: string | null;
  therapy_evolution: string | null;
  live: StaffPublication | null; // versión publicada vigente
  changed_after: boolean; // el informe se editó después de publicarlo
};

export type StaffInfoDTO = {
  can_publish: boolean; // profesional o Dirección
  author: { label: string | null; problem: string | null }; // con qué nombre se publica
  patient: {
    id: string; first_name: string; age: number | null;
    diagnosis_code: string | null; // para ofrecer el texto base y "Datos para trámites"
    professional_name: string | null; modes: string[];
    professional_label: string | null; // como se publica en "Cómo lo trabajamos" (professionalLabel)
  };
  info_enabled: boolean;
  readers: string[]; // nombres de quienes hoy ven "Mi información"
  summary: StaffPublication | null; // vigente
  history: StaffPublication[]; // todas, de la más nueva a la más vieja
  reports: StaffReportRow[];
};
