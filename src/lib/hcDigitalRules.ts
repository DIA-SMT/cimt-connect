// Portal — copia digital de la historia clínica (etapa E1, "hc_digital").
// Reglas puras: las usan el servidor (server/lib/hcDocuments.ts y
// server/lib/requests.ts), el modo mock y las pruebas. Sin alias de imports
// (el servidor lo importa con ruta relativa).
//
// El equipo imprime la historia de la ficha a PDF, la Dirección firma cada
// PDF digitalmente (fuera del sistema) y un profesional o la Dirección los
// sube al pedido. Los PDF no se tocan (un sello rompería la firma): solo se
// revisa que sean PDF de verdad, sin contraseña, y se guarda su huella.

import { ADOLESCENT_FROM, ADULT_FROM } from "./portalClinicalRules";
import { HC_DOC_MAX_BYTES, type HcRow, type HcSendAcks, centerDateOf, hcAvailableUntil } from "./portalRules";

// Bucket privado de Storage (script 24). Solo lo toca el servidor.
export const HC_BUCKET = "portal-documents";
export const HC_DOC_NAME_MAX = 200;
// Los enlaces para abrir o descargar un PDF vencen enseguida
export const HC_LINK_SECONDS = 60;

// Lo que ve el equipo cuando la cuenta que pidió no puede recibirla por el portal
export const HC_DIGITAL_BLOCKED_STAFF =
  "Esta cuenta no aceptó recibir información clínica por el portal (o falta verificar el vínculo): entregala en mano.";

// ── El archivo ──────────────────────────────────────────────────────────────

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ENCRYPT = [...("/Encrypt")].map((c) => c.charCodeAt(0));

// Empieza como un PDF ("%PDF-")
export function isPdfBytes(b: Uint8Array): boolean {
  return b.length >= PDF_MAGIC.length && PDF_MAGIC.every((x, i) => b[i] === x);
}

// Tiene contraseña o permisos (diccionario /Encrypt): la familia podría no
// poder abrirlo. El diccionario va siempre sin comprimir (en el trailer o en
// el diccionario del xref), así que alcanza con buscar los bytes.
export function looksEncrypted(b: Uint8Array): boolean {
  const first = ENCRYPT[0];
  const last = b.length - ENCRYPT.length;
  outer: for (let i = b.indexOf(first); i !== -1 && i <= last; i = b.indexOf(first, i + 1)) {
    for (let j = 1; j < ENCRYPT.length; j++) if (b[i + j] !== ENCRYPT[j]) continue outer;
    return true;
  }
  return false;
}

export type PdfProblem = "empty" | "too_big" | "not_pdf" | "encrypted";

export const PDF_PROBLEM_TEXT: Record<PdfProblem, string> = {
  empty: "El archivo está vacío. Imprimí de nuevo la historia clínica como PDF y subilo otra vez.",
  too_big: "El PDF pesa más de 10 MB. Imprimilo en partes (podés subir hasta 5 PDF por pedido).",
  not_pdf: "El archivo no es un PDF. Imprimí la historia clínica desde la ficha como PDF y subilo otra vez.",
  encrypted: "El PDF tiene contraseña o permisos: la familia podría no poder abrirlo. Subilo sin protección.",
};

// Revisión del archivo ya subido (lo que no pasa se borra del bucket)
export function pdfProblem(b: Uint8Array): PdfProblem | null {
  if (!b.length) return "empty";
  if (b.length > HC_DOC_MAX_BYTES) return "too_big";
  if (!isPdfBytes(b)) return "not_pdf";
  if (looksEncrypted(b)) return "encrypted";
  return null;
}

// Nombre original del archivo (solo lo ve el equipo): sin carpetas, sin
// caracteres de control y de hasta 200 caracteres
export function cleanDocName(raw: unknown): string {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, HC_DOC_NAME_MAX);
}

// Antes de dar el enlace de subida: nombre .pdf y tamaño razonable
export function docUploadProblem(name: string, size: unknown): string | null {
  if (!name || !/\.pdf$/i.test(name)) return "Subí la historia clínica en PDF (un archivo .pdf).";
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1) return PDF_PROBLEM_TEXT.empty;
  if (size > HC_DOC_MAX_BYTES) return PDF_PROBLEM_TEXT.too_big;
  return null;
}

// Dónde se guarda cada PDF: hc/{pedido}/{uuid}.pdf
export function hcDocPath(requestId: string, fileId: string): string {
  return `hc/${requestId}/${fileId}.pdf`;
}

// La ruta que manda el panel al registrar un PDF tiene que ser de ese pedido
export function hcDocPathOk(path: unknown, requestId: string): path is string {
  return typeof path === "string"
    && /^[0-9a-f-]{36}$/i.test(requestId)
    && new RegExp(`^hc/${requestId}/[0-9a-f-]{36}\\.pdf$`, "i").test(path);
}

// ── Lo que ve la familia ────────────────────────────────────────────────────

// "Historia clínica" o, si son varios PDF, "Historia clínica (1 de 2)"
export function hcDocLabel(index: number, total: number): string {
  return total > 1 ? `Historia clínica (${index + 1} de ${total})` : "Historia clínica";
}

// Nombre genérico de la descarga (nada del paciente): la fecha de envío,
// en la hora del centro. Si son varios PDF, con su número.
export function hcDownloadName(sentAt: string, index = 0, total = 1): string {
  const day = centerDateOf(sentAt);
  return total > 1 ? `CIMT-historia-clinica-${day}-${index + 1}-de-${total}.pdf` : `CIMT-historia-clinica-${day}.pdf`;
}

// ¿Se puede descargar todavía? (enviada y dentro de los 60 días)
export function hcDownloadable(r: Pick<HcRow, "status" | "sent_at">, now: Date = new Date()): boolean {
  if (r.status !== "enviada") return false;
  const until = hcAvailableUntil(r.sent_at ?? null);
  return !!until && Date.parse(until) > now.getTime();
}

// ── Al enviarla ─────────────────────────────────────────────────────────────

// De 13 a 17 se confirma también que no incluye lo que contó en confianza
export function isAdolescentAge(age: number | null): boolean {
  return age !== null && age >= ADOLESCENT_FROM && age < ADULT_FROM;
}

// null si están todas las confirmaciones que hacen falta
export function hcSendAcksProblem(acks: unknown, age: number | null): string | null {
  const a = (acks && typeof acks === "object" ? acks : {}) as Partial<Record<keyof HcSendAcks, unknown>>;
  if (a.complete !== true || a.no_third_parties !== true || a.signed !== true) {
    return "Confirmá las casillas antes de enviarla (completa y de este paciente, sin datos de otras personas y firmada por la Dirección).";
  }
  if (isAdolescentAge(age) && a.adolescent !== true) {
    return "Confirmá que no incluye lo que el adolescente contó en confianza.";
  }
  return null;
}

// Lo que se guarda de las confirmaciones (sent_acks)
export function cleanAcks(acks: unknown, age: number | null): HcSendAcks {
  const a = (acks && typeof acks === "object" ? acks : {}) as Partial<Record<keyof HcSendAcks, unknown>>;
  return {
    complete: a.complete === true,
    no_third_parties: a.no_third_parties === true,
    signed: a.signed === true,
    ...(isAdolescentAge(age) ? { adolescent: a.adolescent === true } : {}),
  };
}
