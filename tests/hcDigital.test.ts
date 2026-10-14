// Pruebas de la copia digital de la historia clínica (etapa E1): lo que ve la
// familia de un pedido enviado por el portal, las reglas puras de los PDF
// (src/lib/hcDigitalRules.ts) y el servidor (server/lib/requests.ts y
// hcDocuments.ts) contra una base de prueba en memoria: la pausa del
// paciente, el script 24 sin correr, los archivos sueltos, los cambios y los
// cortes mientras se sube un PDF, el envío con la lista de PDF revisados y
// las etapas que se informan (portalClinical.ts). Correr con: bun test
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  DOWNLOAD_NOT_AVAILABLE, DOWNLOAD_PAUSED, familyDownload, staffRegister, staffSend, staffUploadUrl, verifyDownloadText,
} from "../server/lib/hcDocuments";
import { type Account, type ActiveChild, type Ctx, type H3Event, PortalError } from "../server/lib/portal";
import { effectiveFeatures, familyClinical } from "../server/lib/portalClinical";
import {
  HC_DIGITAL_PAUSED_STAFF, PARENTAL_PROOF, createHcRequest, digitalBlockedText, discardDrafts, e1Columns,
  hcDigitalOffer, hcRequestsFor, requesterDigitalBlock, resetE1Columns, staffHcList,
} from "../server/lib/requests";
import {
  HC_DIGITAL_BLOCKED_STAFF, cleanAcks, cleanDocName, docUploadProblem, hcDocLabel, hcDocPath, hcDocPathOk,
  hcDownloadName, hcDownloadable, hcSendAcksProblem, isAdolescentAge, isPdfBytes, looksEncrypted, pdfProblem,
} from "../src/lib/hcDigitalRules";
import { CLINICAL_NOTICE_VERSION } from "../src/lib/portalClinicalRules";
import { verificationCode } from "../src/lib/portalInfoRules";
import {
  HC_DOC_MAX_BYTES, HC_TRANSITIONS, HC_VISIBLE_DAYS, computeHcDto, hcAvailableUntil, hcVisible,
  type HcDocumentDTO, type HcRow,
} from "../src/lib/portalRules";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const bytes = (s: string) => new TextEncoder().encode(s);

const base: HcRow = {
  id: "11111111-1111-4111-8111-111111111111",
  patient_id: "22222222-2222-4222-8222-222222222222",
  status: "pendiente",
  created_at: "2026-10-01T12:00:00.000Z",
  updated_at: "2026-10-01T12:00:00.000Z",
  ready_at: null,
  delivered_at: null,
  reject_reason: null,
};
const child = { display: "Martín", self: false };
const docId = "33333333-3333-4333-8333-333333333333";
const docs: HcDocumentDTO[] = [{ id: docId, label: "Historia clínica", code: verificationCode(docId) }];

describe("pedido de copia: canal y copia enviada", () => {
  test("sin el script 24 (sin channel ni sent_at) es en mano y sin descarga", () => {
    const dto = computeHcDto(base, child);
    expect(dto.channel).toBe("mano");
    expect(dto.sent_at).toBeNull();
    expect(dto.available_until).toBeNull();
    expect(dto.documents).toEqual([]);
  });

  test("pedido para recibir en el portal, todavía pendiente: sin documentos aunque se pasen", () => {
    const dto = computeHcDto({ ...base, channel: "portal", sent_at: null }, child, docs);
    expect(dto.channel).toBe("portal");
    expect(dto.can_cancel).toBe(true);
    expect(dto.available_until).toBeNull();
    expect(dto.documents).toEqual([]);
  });

  test("enviada: disponible 60 días desde el envío, con sus PDF", () => {
    const sentAt = "2026-10-10T15:00:00.000Z";
    const row: HcRow = { ...base, status: "enviada", channel: "portal", sent_at: sentAt, updated_at: sentAt };
    const dto = computeHcDto(row, child, docs, new Date("2026-10-20T12:00:00.000Z"));
    expect(dto.status).toBe("enviada");
    expect(dto.sent_at).toBe(sentAt);
    expect(dto.available_until).toBe(new Date(Date.parse(sentAt) + HC_VISIBLE_DAYS * DAY).toISOString());
    expect(dto.documents).toEqual(docs);
    expect(dto.can_cancel).toBe(false);
    expect(dto.reject_reason).toBeNull();
  });

  test("enviada y vencida: sigue la fecha, pero sin documentos", () => {
    const sentAt = "2026-08-01T15:00:00.000Z";
    const row: HcRow = { ...base, status: "enviada", channel: "portal", sent_at: sentAt, updated_at: sentAt };
    const dto = computeHcDto(row, child, docs, new Date(Date.parse(sentAt) + (HC_VISIBLE_DAYS + 1) * DAY));
    expect(dto.available_until).not.toBeNull();
    expect(dto.documents).toEqual([]);
  });

  test("justo al vencer ya no se descarga", () => {
    const sentAt = "2026-10-10T15:00:00.000Z";
    const row: HcRow = { ...base, status: "enviada", channel: "portal", sent_at: sentAt };
    const until = new Date(Date.parse(sentAt) + HC_VISIBLE_DAYS * DAY);
    expect(computeHcDto(row, child, docs, new Date(until.getTime() - 1)).documents).toEqual(docs);
    expect(computeHcDto(row, child, docs, until).documents).toEqual([]);
  });

  test("sent_at solo se muestra si está enviada", () => {
    const dto = computeHcDto({ ...base, status: "entregada", channel: "portal", sent_at: "2026-10-10T15:00:00.000Z" }, child, docs);
    expect(dto.sent_at).toBeNull();
    expect(dto.available_until).toBeNull();
    expect(dto.documents).toEqual([]);
  });

  test("una copia enviada se sigue viendo mientras se puede descargar", () => {
    const sentAt = "2026-10-10T15:00:00.000Z";
    const row: HcRow = { ...base, status: "enviada", sent_at: sentAt, updated_at: sentAt };
    expect(hcVisible(row, new Date(Date.parse(sentAt) + 59 * DAY))).toBe(true);
    expect(hcVisible(row, new Date(Date.parse(sentAt) + 61 * DAY))).toBe(false);
  });

  test("hcAvailableUntil: 60 días desde el envío (null sin envío)", () => {
    expect(hcAvailableUntil(null)).toBeNull();
    expect(hcAvailableUntil("2026-10-01T00:00:00.000Z")).toBe("2026-11-30T00:00:00.000Z");
  });

  test("una copia enviada no tiene más pasos para el equipo", () => {
    expect(HC_TRANSITIONS.enviada).toEqual([]);
  });

  test("hcDownloadable: solo enviada y dentro de los 60 días", () => {
    const sentAt = "2026-10-10T15:00:00.000Z";
    const now = new Date("2026-10-20T00:00:00.000Z");
    expect(hcDownloadable({ status: "enviada", sent_at: sentAt }, now)).toBe(true);
    expect(hcDownloadable({ status: "enviada", sent_at: null }, now)).toBe(false);
    expect(hcDownloadable({ status: "entregada", sent_at: sentAt }, now)).toBe(false);
    expect(hcDownloadable({ status: "enviada", sent_at: sentAt }, new Date(Date.parse(sentAt) + 61 * DAY))).toBe(false);
  });
});

describe("revisión del PDF subido", () => {
  test("empieza con %PDF-", () => {
    expect(isPdfBytes(bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj"))).toBe(true);
    expect(isPdfBytes(bytes("%PDF"))).toBe(false);
    expect(isPdfBytes(bytes("PK\u0003\u0004 un zip"))).toBe(false);
    expect(isPdfBytes(bytes(" %PDF-1.7"))).toBe(false);
    expect(isPdfBytes(new Uint8Array())).toBe(false);
  });

  test("detecta un PDF con contraseña o permisos (/Encrypt)", () => {
    expect(looksEncrypted(bytes("%PDF-1.7\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>"))).toBe(true);
    expect(looksEncrypted(bytes("%PDF-1.7\ntrailer\n<< /Root 1 0 R /Size 9 >>"))).toBe(false);
    // Casi, pero no
    expect(looksEncrypted(bytes("%PDF-1.7 /Encryp /encrypt /Encryp"))).toBe(false);
    // Al final del archivo
    expect(looksEncrypted(bytes("%PDF-1.7 ... /Encrypt"))).toBe(true);
    // Una firma digital no es /Encrypt
    expect(looksEncrypted(bytes("%PDF-1.7 /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 1 2 3]"))).toBe(false);
  });

  test("pdfProblem: vacío, muy grande, no PDF, protegido u OK", () => {
    expect(pdfProblem(new Uint8Array())).toBe("empty");
    const big = new Uint8Array(HC_DOC_MAX_BYTES + 1);
    big.set(bytes("%PDF-1.7"));
    expect(pdfProblem(big)).toBe("too_big");
    expect(pdfProblem(bytes("<html>no</html>"))).toBe("not_pdf");
    expect(pdfProblem(bytes("%PDF-1.7 << /Encrypt 3 0 R >>"))).toBe("encrypted");
    expect(pdfProblem(bytes("%PDF-1.7 << /Root 1 0 R >> %%EOF"))).toBeNull();
    const max = new Uint8Array(HC_DOC_MAX_BYTES);
    max.set(bytes("%PDF-1.7"));
    expect(pdfProblem(max)).toBeNull();
  });

  test("antes de subir: .pdf y hasta 10 MB", () => {
    expect(docUploadProblem("historia.pdf", 1000)).toBeNull();
    expect(docUploadProblem("HISTORIA.PDF", HC_DOC_MAX_BYTES)).toBeNull();
    expect(docUploadProblem("historia.docx", 1000)).not.toBeNull();
    expect(docUploadProblem("", 1000)).not.toBeNull();
    expect(docUploadProblem("historia.pdf", 0)).not.toBeNull();
    expect(docUploadProblem("historia.pdf", "1000")).not.toBeNull();
    expect(docUploadProblem("historia.pdf", 1.5)).not.toBeNull();
    expect(docUploadProblem("historia.pdf", HC_DOC_MAX_BYTES + 1)).not.toBeNull();
  });

  test("nombre original: sin carpetas ni caracteres de control, hasta 200", () => {
    expect(cleanDocName("C:\\Users\\dir\\HC Pérez  firmada.pdf")).toBe("HC Pérez firmada.pdf");
    expect(cleanDocName("../../etc/x.pdf")).toBe("x.pdf");
    expect(cleanDocName("a\u0000b\u001fc.pdf")).toBe("abc.pdf");
    expect(cleanDocName(null)).toBe("");
    expect(cleanDocName(`${"a".repeat(300)}.pdf`).length).toBe(200);
  });

  test("ruta en el bucket: hc/{pedido}/{uuid}.pdf, y solo de ese pedido", () => {
    const req = base.id;
    const path = hcDocPath(req, docId);
    expect(path).toBe(`hc/${req}/${docId}.pdf`);
    expect(hcDocPathOk(path, req)).toBe(true);
    expect(hcDocPathOk(hcDocPath(base.patient_id, docId), req)).toBe(false);
    expect(hcDocPathOk(`hc/${req}/../otro/${docId}.pdf`, req)).toBe(false);
    expect(hcDocPathOk(`hc/${req}/${docId}.pdf.exe`, req)).toBe(false);
    expect(hcDocPathOk(`patient-files/${req}/${docId}.pdf`, req)).toBe(false);
    expect(hcDocPathOk(path, "no-es-un-uuid")).toBe(false);
    expect(hcDocPathOk(42, req)).toBe(false);
  });
});

describe("lo que ve la familia de los PDF", () => {
  test("etiqueta: una sola o numeradas", () => {
    expect(hcDocLabel(0, 1)).toBe("Historia clínica");
    expect(hcDocLabel(0, 2)).toBe("Historia clínica (1 de 2)");
    expect(hcDocLabel(1, 2)).toBe("Historia clínica (2 de 2)");
  });

  test("nombre de la descarga: genérico, con la fecha de envío en la hora del centro", () => {
    // 01:30 UTC del 11 es todavía el 10 en Tucumán
    expect(hcDownloadName("2026-10-11T01:30:00.000Z")).toBe("CIMT-historia-clinica-2026-10-10.pdf");
    expect(hcDownloadName("2026-10-11T15:00:00.000Z", 0, 1)).toBe("CIMT-historia-clinica-2026-10-11.pdf");
    expect(hcDownloadName("2026-10-11T15:00:00.000Z", 1, 3)).toBe("CIMT-historia-clinica-2026-10-11-2-de-3.pdf");
  });

  test("el código de verificación es el mismo para el equipo y la familia", () => {
    expect(verificationCode(docId)).toMatch(/^\d{5} \d{5}$/);
    expect(verificationCode(docId)).toBe(verificationCode(docId.toUpperCase()));
  });
});

describe("al enviarla por el portal", () => {
  const all = { complete: true, no_third_parties: true, signed: true };

  test("hacen falta las tres confirmaciones", () => {
    expect(hcSendAcksProblem(all, 9)).toBeNull();
    expect(hcSendAcksProblem({ ...all, signed: false }, 9)).not.toBeNull();
    expect(hcSendAcksProblem({ complete: true, no_third_parties: true }, 30)).not.toBeNull();
    expect(hcSendAcksProblem({ ...all, complete: "true" }, 30)).not.toBeNull();
    expect(hcSendAcksProblem(null, 30)).not.toBeNull();
    expect(hcSendAcksProblem(undefined, null)).not.toBeNull();
  });

  test("de 13 a 17, también la del adolescente", () => {
    expect(isAdolescentAge(12)).toBe(false);
    expect(isAdolescentAge(13)).toBe(true);
    expect(isAdolescentAge(17)).toBe(true);
    expect(isAdolescentAge(18)).toBe(false);
    expect(isAdolescentAge(null)).toBe(false);
    expect(hcSendAcksProblem(all, 15)).not.toBeNull();
    expect(hcSendAcksProblem({ ...all, adolescent: true }, 15)).toBeNull();
    expect(hcSendAcksProblem(all, 12)).toBeNull();
    expect(hcSendAcksProblem(all, 18)).toBeNull();
  });

  test("lo que se guarda: solo las casillas conocidas (y la del adolescente si corresponde)", () => {
    expect(cleanAcks({ ...all, extra: "x" }, 30)).toEqual(all);
    expect(cleanAcks({ ...all, adolescent: true }, 30)).toEqual(all);
    expect(cleanAcks({ ...all, adolescent: true }, 15)).toEqual({ ...all, adolescent: true });
  });

  test("el aviso para el equipo cuando la cuenta no puede recibirla dice que se entrega en mano", () => {
    expect(HC_DIGITAL_BLOCKED_STAFF).toContain("entregala en mano");
    expect(HC_DIGITAL_PAUSED_STAFF).toBe("El portal de este paciente está en pausa: entregala en mano.");
  });
});

describe("textos cuando falta verificar el vínculo", () => {
  test("a madre, padre o tutor/a también se le pide lo que acredita el vínculo", () => {
    expect(digitalBlockedText("verify", "representante_legal")).toContain(PARENTAL_PROOF);
    expect(digitalBlockedText("verify", "representante_legal")).toContain("podés pedirla para retirar en el centro");
    expect(digitalBlockedText("verify", "titular")).not.toContain(PARENTAL_PROOF);
    expect(digitalBlockedText("consent", "representante_legal")).not.toContain(PARENTAL_PROOF);
    expect(digitalBlockedText("not_available", "representante_legal")).not.toContain(PARENTAL_PROOF);
    expect(verifyDownloadText("titular")).toBe("Para descargarla, primero tenés que pasar por el centro con tu DNI.");
    expect(verifyDownloadText("representante_legal")).toBe(
      `Para descargarla, primero tenés que pasar por el centro con tu DNI. ${PARENTAL_PROOF}`,
    );
  });
});

// ── El servidor, con una base de prueba en memoria ──────────────────────────
// Imita lo justo del cliente de Supabase que usan requests.ts y
// hcDocuments.ts: select/insert/update con eq, in, is, not, gte, limit,
// single y maybeSingle; tablas o columnas que faltan (scripts sin correr),
// cortes de conexión, cambios de otra persona a la vez y el bucket de Storage.

type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null; count?: number | null };
type Op = "select" | "insert" | "update";

const CUT: DbError = { code: "", message: "TypeError: fetch failed" }; // se cortó la conexión

class FakeDb {
  tables: Record<string, Row[]> = {};
  missingTables = new Set<string>();
  missingCols: Record<string, string[]> = {};
  offline = new Set<string>(); // tablas que contestan con error de conexión
  onInsert: ((table: string, row: Row) => void) | null = null;
  // Antes de cada consulta: puede cambiar la base (otra persona a la vez) o
  // devolver true para que esa consulta falle por la conexión
  beforeQuery: ((q: { table: string; op: Op; payload: Row; cols: string }) => boolean | void) | null = null;
  // La fila se guarda pero la respuesta no llega
  lostInsert: ((table: string) => boolean) | null = null;
  // Al bajar un archivo del bucket
  onDownload: ((path: string) => void) | null = null;
  files = new Map<string, { bytes: Uint8Array; created_at: string }>();
  removed: string[] = [];
}

const REQUEST_DEFAULTS = (): Row => ({
  status: "pendiente", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  ready_at: null, delivered_at: null, reject_reason: null, channel: "mano", sent_at: null, sent_by_email: null,
});
const DOC_DEFAULTS = (): Row => ({ uploaded_at: new Date().toISOString(), published_at: null, removed_at: null, removed_by_email: null });

class FakeQuery implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: Op = "select";
  private cols = "*";
  private payload: Row = {};
  private mode: "many" | "one" | "maybe" = "many";
  private head = false;
  private max: number | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(cols = "*", opts: { head?: boolean } = {}) { this.cols = cols; this.head = !!opts.head; return this; }
  insert(row: Row) { this.op = "insert"; this.payload = row; this.cols = ""; return this; }
  update(patch: Row) { this.op = "update"; this.payload = patch; this.cols = ""; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: null) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  not(c: string, _op: "is", v: null) { this.filters.push((r) => (r[c] ?? null) !== v); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
  order() { return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.mode = "one"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }

  private problem(): DbError | null {
    const t = this.table;
    if (this.db.offline.has(t)) return { code: "", message: "TypeError: fetch failed" };
    if (this.db.missingTables.has(t)) return { code: "42P01", message: `relation "public.${t}" does not exist` };
    const gone = (c: string) => this.db.missingCols[t]?.includes(c);
    const write = Object.keys(this.payload).find(gone);
    if (write) return { code: "PGRST204", message: `Could not find the '${write}' column of '${t}' in the schema cache` };
    const read = this.colList().find(gone);
    if (read) return { code: "42703", message: `column ${t}.${read} does not exist` };
    return null;
  }

  private colList(): string[] {
    return this.cols && this.cols !== "*" ? this.cols.split(",").map((c) => c.trim()) : [];
  }

  private run(): Result {
    const error = this.problem();
    if (error) return { data: null, error };
    if (this.db.beforeQuery?.({ table: this.table, op: this.op, payload: this.payload, cols: this.cols })) return { data: null, error: CUT };
    const rows = (this.db.tables[this.table] ??= []);
    let out: Row[];
    if (this.op === "insert") {
      const defaults = this.table === "portal_hc_requests" ? REQUEST_DEFAULTS()
        : this.table === "portal_hc_documents" ? DOC_DEFAULTS() : { created_at: new Date().toISOString() };
      for (const c of this.db.missingCols[this.table] ?? []) delete defaults[c];
      const row: Row = { id: randomUUID(), ...defaults, ...this.payload };
      if (this.table === "portal_hc_documents" && rows.some((r) => r.storage_path === row.storage_path)) {
        return { data: null, error: { code: "23505", message: "duplicate key value" } };
      }
      rows.push(row);
      this.db.onInsert?.(this.table, row);
      if (this.db.lostInsert?.(this.table)) return { data: null, error: CUT };
      out = [row];
    } else {
      out = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") for (const r of out) Object.assign(r, this.payload);
    }
    if (this.max !== null) out = out.slice(0, this.max);
    if (this.head) return { data: null, error: null, count: out.length };
    const cols = this.colList();
    const pick = (r: Row) => (cols.length ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : { ...r });
    const data = this.cols === "" ? null : out.map(pick);
    if (this.mode === "one") {
      return out.length === 1 ? { data: pick(out[0]), error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    if (this.mode === "maybe") return { data: out.length ? pick(out[0]) : null, error: null };
    return { data, error: null };
  }
}

function fakeCtx(db: FakeDb): Ctx {
  const inFolder = (folder: string) => [...db.files].filter(([p]) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes("/"));
  const bucket = {
    list: async (folder: string) => ({
      data: inFolder(folder).map(([p, f]) => ({ name: p.slice(folder.length + 1), id: p, created_at: f.created_at, updated_at: f.created_at })),
      error: null,
    }),
    remove: async (paths: string[]) => {
      for (const p of paths) {
        db.files.delete(p);
        db.removed.push(p);
      }
      return { data: [], error: null };
    },
    download: async (path: string) => {
      db.onDownload?.(path);
      const f = db.files.get(path);
      return f ? { data: new Blob([f.bytes]), error: null } : { data: null, error: { message: "Object not found" } };
    },
    createSignedUploadUrl: async (path: string) => ({ data: { path, token: "token-de-prueba" }, error: null }),
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.test/${path}` }, error: null }),
  };
  const admin = { from: (t: string) => new FakeQuery(db, t), storage: { from: () => bucket } };
  return { admin, anon: () => admin, asUser: () => admin, pepper: "p".repeat(32) } as unknown as Ctx;
}

const P = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // paciente (6 años)
const A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // cuenta de la mamá
const R = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // pedido de copia
const ACCOUNT: Account = { id: A, user_id: "u-1", dni: "28999888", first_name: "Ana", last_name: "Pérez", active: true };
const CHILD: ActiveChild = { patient_id: P, first_name: "Martín", last_name: "Pérez", display: "Martín", kind: "representante_legal", self: false };
const STAFF = { email: "prof@cimt.test", clinical: true };
const ACKS = { complete: true, no_third_parties: true, signed: true };
const PDF = bytes("%PDF-1.7 << /Root 1 0 R >> %%EOF");
const NO_EVENT = {} as H3Event; // la descarga se frena antes de mirar la sesión
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function seed(o: { paused?: boolean; verified?: boolean; noE1?: boolean } = {}): FakeDb {
  const verified = o.verified ?? true;
  const db = new FakeDb();
  db.tables = {
    patients: [{ id: P, first_name: "Martín", last_name: "Pérez", dni: "50111222", birth_date: "2020-05-01", discharge_date: null }],
    patient_guardians: [{ id: "g-1", patient_id: P, dni: "28999888", active: true }],
    portal_accounts: [{ ...ACCOUNT }],
    portal_links: [{
      id: "l-1", account_id: A, patient_id: P, guardian_id: "g-1", relationship_kind: "representante_legal",
      adolescent_consent_at: null, revoked_at: null,
      verified_in_person_on: verified ? "2026-10-01" : null, parental_checked_on: verified ? "2026-10-01" : null,
    }],
    portal_guardian_blocks: [],
    portal_consents: [{ account_id: A, kind: "informacion_clinica", version: CLINICAL_NOTICE_VERSION, accepted: true, channel: "portal", created_at: "2026-10-01T10:00:00.000Z" }],
    patient_portal_settings: [{
      patient_id: P, info_enabled: false, practice_enabled: false, paused_at: o.paused ? "2026-10-12T10:00:00.000Z" : null,
      adolescent_agreed_on: null, adolescent_withdrawn_on: null,
    }],
    portal_hc_requests: [],
    portal_hc_request_events: [],
    portal_hc_documents: [],
    portal_access_log: [],
  };
  if (o.noE1) {
    db.missingCols.portal_hc_requests = ["channel", "sent_at", "sent_by_email", "sent_acks"];
    db.missingTables.add("portal_hc_documents");
  }
  return db;
}

// Un pedido "en el portal" (pendiente, salvo que se diga otra cosa)
function addRequest(db: FakeDb, patch: Row = {}): Row {
  const row: Row = {
    id: R, patient_id: P, account_id: A, link_kind: "representante_legal", requester_name: "Ana Pérez", requester_dni: "28999888",
    status: "pendiente", channel: "portal", sent_at: null, sent_by_email: null, created_at: ago(DAY), updated_at: ago(DAY),
    ready_at: null, ready_by_email: null, delivered_at: null, delivered_by_email: null, delivered_to_name: null, delivered_to_dni: null,
    rejected_at: null, rejected_by_email: null, reject_reason: null, cancelled_at: null, staff_notes: null,
    ...patch,
  };
  db.tables.portal_hc_requests.push(row);
  return row;
}

// Un PDF del pedido (con su archivo en el bucket)
function addDoc(db: FakeDb, patch: Row = {}): Row {
  const id = (patch.id as string | undefined) ?? docId;
  const row: Row = {
    id, request_id: R, patient_id: P, storage_path: hcDocPath(R, id), file_name: "hc.pdf", size_bytes: PDF.length,
    sha256: "0".repeat(64), uploaded_by_email: STAFF.email, uploaded_at: ago(DAY), published_at: null, removed_at: null, removed_by_email: null,
    ...patch,
  };
  db.tables.portal_hc_documents.push(row);
  db.files.set(row.storage_path as string, { bytes: PDF, created_at: row.uploaded_at as string });
  return row;
}

async function failure(p: Promise<unknown>): Promise<PortalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PortalError) return e;
    throw e;
  }
  throw new Error("se esperaba un error y no lo hubo");
}

const savedFeatures = process.env.PORTAL_CLINICAL_FEATURES;
const featuresOn = () => {
  process.env.PORTAL_CLINICAL_FEATURES = "consent,hc_digital";
  resetE1Columns();
};
afterAll(() => {
  if (savedFeatures === undefined) delete process.env.PORTAL_CLINICAL_FEATURES;
  else process.env.PORTAL_CLINICAL_FEATURES = savedFeatures;
  resetE1Columns();
});

describe("servidor: portal del paciente en pausa", () => {
  beforeEach(featuresOn);

  test("sin pausa se ofrece recibirla en el portal y se puede pedir así", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    expect(await hcDigitalOffer(ctx, ACCOUNT, CHILD)).toEqual({ offered: true, blocked: null });
    const dto = await createHcRequest(ctx, ACCOUNT, [CHILD], P, "portal");
    expect(dto.channel).toBe("portal");
  });

  test("con pausa la familia no ve la opción del portal (sin saber por qué), pero la pide en mano", async () => {
    const db = seed({ paused: true });
    const ctx = fakeCtx(db);
    expect(await hcDigitalOffer(ctx, ACCOUNT, CHILD)).toEqual({ offered: true, blocked: "not_available" });
    const e = await failure(createHcRequest(ctx, ACCOUNT, [CHILD], P, "portal"));
    expect(e.status).toBe(409);
    expect(e.extra.code).toBe("DIGITAL_BLOCKED");
    expect(e.message).toBe("Por ahora no se puede recibir por el portal. Podés pedirla para retirar en el centro.");
    expect(db.tables.portal_hc_requests).toHaveLength(0);
    const dto = await createHcRequest(ctx, ACCOUNT, [CHILD], P, "mano");
    expect(dto.channel).toBe("mano");
    expect(dto.status).toBe("pendiente");
  });

  test("la pausa se informa aunque además falte verificar el vínculo", async () => {
    const ctx = fakeCtx(seed({ paused: true, verified: false }));
    expect(await hcDigitalOffer(ctx, ACCOUNT, CHILD)).toEqual({ offered: true, blocked: "not_available" });
  });

  test("con pausa el equipo no puede subir ni enviar: se entrega en mano", async () => {
    const db = seed({ paused: true });
    const ctx = fakeCtx(db);
    addRequest(db);
    addDoc(db);
    expect(await requesterDigitalBlock(ctx, { account_id: A, patient_id: P })).toBe(HC_DIGITAL_PAUSED_STAFF);
    // También si la cuenta que pidió ya no existe: la pausa va primero
    expect(await requesterDigitalBlock(ctx, { account_id: null, patient_id: P })).toBe(HC_DIGITAL_PAUSED_STAFF);

    const up = await failure(staffUploadUrl(ctx, STAFF, { request_id: R, file_name: "hc.pdf", size_bytes: 1000 }));
    expect(up.status).toBe(409);
    expect(up.extra.code).toBe("DIGITAL_BLOCKED");
    expect(up.message).toBe(HC_DIGITAL_PAUSED_STAFF);

    const send = await failure(staffSend(ctx, STAFF, { request_id: R, acks: ACKS, document_ids: [docId] }));
    expect(send.status).toBe(409);
    expect(send.extra.code).toBe("DIGITAL_BLOCKED");
    expect(send.message).toBe(HC_DIGITAL_PAUSED_STAFF);
    expect(db.tables.portal_hc_requests[0].status).toBe("pendiente");
    expect(db.tables.portal_hc_documents[0].published_at).toBeNull();

    const [row] = await staffHcList(ctx);
    expect(row.digital_ok).toBe(false);
  });

  test("con pausa, una copia ya enviada no se descarga desde el portal", async () => {
    const db = seed({ paused: true });
    addRequest(db, { status: "enviada", sent_at: ago(DAY), sent_by_email: "dir@cimt.test", updated_at: ago(DAY) });
    addDoc(db, { published_at: ago(DAY) });
    const e = await failure(familyDownload(fakeCtx(db), NO_EVENT, ACCOUNT, docId));
    expect(e.status).toBe(403);
    expect(e.extra.code).toBe("NOT_AVAILABLE");
    expect(e.message).toBe(DOWNLOAD_PAUSED);
    expect(DOWNLOAD_PAUSED).toBe("Por ahora no se puede descargar desde el portal. Si la necesitás, pedila en mano en el centro.");
    expect(db.tables.portal_access_log).toHaveLength(0);
  });

  test("si la cuenta ya no tiene derecho a la copia, la descarga no habla de la pausa", async () => {
    const db = seed({ paused: true });
    db.tables.patient_guardians[0].active = false; // se quitó al adulto de la ficha
    addRequest(db, { status: "enviada", sent_at: ago(DAY), sent_by_email: "dir@cimt.test", updated_at: ago(DAY) });
    addDoc(db, { published_at: ago(DAY) });
    const e = await failure(familyDownload(fakeCtx(db), NO_EVENT, ACCOUNT, docId));
    expect(e.extra.code).toBe("NOT_AVAILABLE");
    expect(e.message).toBe(DOWNLOAD_NOT_AVAILABLE);
  });

  test("sin pausa el equipo ve que la cuenta puede recibirla", async () => {
    const db = seed();
    addRequest(db);
    const ctx = fakeCtx(db);
    expect(await requesterDigitalBlock(ctx, { account_id: A, patient_id: P })).toBeNull();
    const [row] = await staffHcList(ctx);
    expect(row.digital_ok).toBe(true);
  });

  test("sin la tabla de configuración (script 21 sin correr) no hay pausa", async () => {
    const db = seed({ paused: true });
    db.missingTables.add("patient_portal_settings");
    expect(await hcDigitalOffer(fakeCtx(db), ACCOUNT, CHILD)).toEqual({ offered: true, blocked: null });
  });
});

describe("servidor: falta verificar el vínculo", () => {
  beforeEach(featuresOn);

  test("al pedirla en el portal y al descargar, a la mamá se le pide también la partida", async () => {
    const db = seed({ verified: false });
    const ctx = fakeCtx(db);
    const e = await failure(createHcRequest(ctx, ACCOUNT, [CHILD], P, "portal"));
    expect(e.extra.code).toBe("DIGITAL_BLOCKED");
    expect(e.message).toBe(digitalBlockedText("verify", "representante_legal"));
    expect(e.message).toContain(PARENTAL_PROOF);

    addRequest(db, { status: "enviada", sent_at: ago(DAY), sent_by_email: "dir@cimt.test", updated_at: ago(DAY) });
    addDoc(db, { published_at: ago(DAY) });
    const d = await failure(familyDownload(ctx, NO_EVENT, ACCOUNT, docId));
    expect(d.status).toBe(403);
    expect(d.extra.code).toBe("VERIFY");
    expect(d.message).toBe(verifyDownloadText("representante_legal"));
  });
});

describe("servidor: script 24 (columnas de la copia digital)", () => {
  beforeEach(featuresOn);

  test("con la etapa prendida y sin el script, la copia digital queda apagada y los pedidos siguen como antes", async () => {
    const db = seed({ noE1: true });
    const ctx = fakeCtx(db);
    expect(await hcDigitalOffer(ctx, ACCOUNT, CHILD)).toEqual({ offered: false, blocked: null });
    const e = await failure(createHcRequest(ctx, ACCOUNT, [CHILD], P, "portal"));
    expect(e.extra.code).toBe("DIGITAL_BLOCKED");
    const dto = await createHcRequest(ctx, ACCOUNT, [CHILD], P, "mano");
    expect(dto.channel).toBe("mano");
    expect(db.tables.portal_hc_requests[0]).not.toHaveProperty("channel");
    expect(await hcRequestsFor(ctx, ACCOUNT, [CHILD])).toHaveLength(1);
    const [row] = await staffHcList(ctx);
    expect(row.channel).toBe("mano");
    expect(row.digital_ok).toBeNull();
    expect(row.documents).toEqual([]);
    expect((await failure(familyDownload(ctx, NO_EVENT, ACCOUNT, docId))).status).toBe(404);
    expect((await failure(staffUploadUrl(ctx, STAFF, { request_id: R, file_name: "hc.pdf", size_bytes: 1000 }))).status).toBe(404);
  });

  test("con la etapa apagada, una copia ya enviada se sigue viendo como enviada por el portal", async () => {
    process.env.PORTAL_CLINICAL_FEATURES = "consent";
    const db = seed();
    const ctx = fakeCtx(db);
    const sentAt = ago(2 * DAY);
    addRequest(db, { status: "enviada", sent_at: sentAt, sent_by_email: "dir@cimt.test", updated_at: sentAt });
    addDoc(db, { published_at: sentAt });
    const [dto] = await hcRequestsFor(ctx, ACCOUNT, [CHILD]);
    expect(dto.status).toBe("enviada");
    expect(dto.channel).toBe("portal");
    expect(dto.sent_at).toBe(sentAt);
    expect(dto.documents).toEqual([]); // sin descarga mientras la etapa esté apagada
    const [row] = await staffHcList(ctx);
    expect(row.channel).toBe("portal");
    expect(row.sent_at).toBe(sentAt);
    expect(row.sent_by_email).toBe("dir@cimt.test");
    expect(await hcDigitalOffer(ctx, ACCOUNT, CHILD)).toEqual({ offered: false, blocked: null });
  });

  test("se vuelve a mirar cada 5 minutos mientras falte; una vez que está, no", async () => {
    const db = seed({ noE1: true });
    const ctx = fakeCtx(db);
    expect(await e1Columns(ctx)).toBe(false);
    db.missingCols = {};
    db.missingTables.clear();
    expect(await e1Columns(ctx)).toBe(false); // todavía con lo que sabía
    setSystemTime(new Date(Date.now() + 6 * 60 * 1000));
    try {
      expect(await e1Columns(ctx)).toBe(true);
    } finally {
      setSystemTime();
    }
    db.missingCols.portal_hc_requests = ["channel"];
    expect(await e1Columns(ctx)).toBe(true);
  });

  test("un error de conexión no se toma como que falta el script", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    db.offline.add("portal_hc_requests");
    expect((await failure(e1Columns(ctx))).status).toBe(503);
    db.offline.clear();
    expect(await e1Columns(ctx)).toBe(true);
  });
});

describe("servidor: archivos sueltos y cambios mientras se sube", () => {
  beforeEach(featuresOn);

  test("al pedir un enlace de subida se borran las subidas viejas que nunca se registraron", async () => {
    const db = seed();
    const ctx = fakeCtx(db);
    addRequest(db);
    const live = addDoc(db, { id: randomUUID(), uploaded_at: ago(3 * HOUR) });
    const removed = addDoc(db, { id: randomUUID(), uploaded_at: ago(3 * HOUR), removed_at: ago(2 * HOUR), removed_by_email: STAFF.email });
    const oldOrphan = hcDocPath(R, randomUUID());
    const youngOrphan = hcDocPath(R, randomUUID());
    const otherRequest = hcDocPath(randomUUID(), randomUUID());
    db.files.set(oldOrphan, { bytes: PDF, created_at: ago(3 * HOUR) });
    db.files.set(youngOrphan, { bytes: PDF, created_at: ago(10 * 60 * 1000) });
    db.files.set(otherRequest, { bytes: PDF, created_at: ago(3 * HOUR) });

    const out = await staffUploadUrl(ctx, STAFF, { request_id: R, file_name: "hc.pdf", size_bytes: 1000 });
    expect(hcDocPathOk(out.path, R)).toBe(true);
    expect(db.removed.sort()).toEqual([oldOrphan, removed.storage_path as string].sort());
    expect(db.files.has(youngOrphan)).toBe(true); // puede ser una subida en curso
    expect(db.files.has(live.storage_path as string)).toBe(true);
    expect(db.files.has(otherRequest)).toBe(true);

    // Al cerrar el pedido no queda nada suelto (ya no acepta PDF)
    db.tables.portal_hc_requests[0].status = "entregada";
    await discardDrafts(ctx, R, STAFF.email);
    expect(db.files.has(youngOrphan)).toBe(false);
    expect(db.files.has(live.storage_path as string)).toBe(false);
    expect(db.tables.portal_hc_documents.find((d) => d.id === live.id)?.removed_at).not.toBeNull();
    expect(db.files.has(otherRequest)).toBe(true);
  });

  test("registrar un PDF: queda en el pedido", async () => {
    const db = seed();
    addRequest(db);
    const path = hcDocPath(R, randomUUID());
    db.files.set(path, { bytes: PDF, created_at: new Date().toISOString() });
    const out = await staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "HC firmada.pdf" });
    expect(out.documents).toHaveLength(1);
    expect(out.documents[0].file_name).toBe("HC firmada.pdf");
    expect(db.files.has(path)).toBe(true);
    expect(db.tables.portal_hc_request_events.map((e) => e.kind)).toEqual(["documento"]);
  });

  test("si el pedido se cierra mientras se sube el PDF, el PDF no queda", async () => {
    const db = seed();
    addRequest(db);
    const path = hcDocPath(R, randomUUID());
    db.files.set(path, { bytes: PDF, created_at: new Date().toISOString() });
    // Otra persona del equipo la entrega en mano justo cuando se guarda la fila
    db.onInsert = (table) => {
      if (table === "portal_hc_documents") db.tables.portal_hc_requests[0].status = "entregada";
    };
    const e = await failure(staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "hc.pdf" }));
    expect(e.status).toBe(409);
    expect(e.message).toBe("El pedido cambió mientras subías el archivo. Actualizá la bandeja.");
    expect(db.tables.portal_hc_documents[0].removed_at).not.toBeNull();
    expect(db.tables.portal_hc_documents[0].removed_by_email).toBe(STAFF.email);
    expect(db.files.has(path)).toBe(false);
    expect(db.tables.portal_hc_request_events).toHaveLength(0);
  });

  test("lo que no es un PDF se borra del bucket", async () => {
    const db = seed();
    addRequest(db);
    const path = hcDocPath(R, randomUUID());
    db.files.set(path, { bytes: bytes("<html>no</html>"), created_at: new Date().toISOString() });
    const e = await failure(staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "hc.pdf" }));
    expect(e.extra.code).toBe("PDF");
    expect(db.files.has(path)).toBe(false);
    expect(db.tables.portal_hc_documents).toHaveLength(0);
  });

  test("al enviarla se borra lo que quedó suelto en la carpeta del pedido", async () => {
    const db = seed();
    addRequest(db);
    const doc = addDoc(db, { id: randomUUID() });
    const orphan = hcDocPath(R, randomUUID());
    db.files.set(orphan, { bytes: PDF, created_at: ago(5 * 60 * 1000) });
    const out = await staffSend(fakeCtx(db), STAFF, { request_id: R, acks: ACKS, document_ids: [doc.id] });
    expect(out.status).toBe("enviada");
    expect(db.files.has(orphan)).toBe(false);
    expect(db.files.has(doc.storage_path as string)).toBe(true);
  });

  test("la bandeja borra lo que llegó tarde a un pedido recién cerrado", async () => {
    const db = seed();
    addRequest(db, { status: "entregada", updated_at: ago(HOUR) });
    const R2 = randomUUID(); // cerrado hace 3 horas: ya no se revisa
    addRequest(db, { id: R2, status: "rechazada", reject_reason: "otro", updated_at: ago(3 * HOUR) });
    const late = hcDocPath(R, randomUUID());
    const older = hcDocPath(R2, randomUUID());
    db.files.set(late, { bytes: PDF, created_at: ago(10 * 60 * 1000) });
    db.files.set(older, { bytes: PDF, created_at: ago(10 * 60 * 1000) });
    expect(await staffHcList(fakeCtx(db))).toHaveLength(2);
    expect(db.files.has(late)).toBe(false);
    expect(db.files.has(older)).toBe(true);
  });

  test("si no se puede revisar la carpeta, la bandeja sale igual", async () => {
    const db = seed();
    addRequest(db, { status: "entregada", updated_at: ago(HOUR) });
    // La consulta de sweepOrphans (qué archivos tienen fila) no contesta
    db.beforeQuery = (q) => q.table === "portal_hc_documents" && q.cols.includes("storage_path");
    const late = hcDocPath(R, randomUUID());
    db.files.set(late, { bytes: PDF, created_at: ago(10 * 60 * 1000) });
    expect(await staffHcList(fakeCtx(db))).toHaveLength(1);
    expect(db.files.has(late)).toBe(true);
  });
});

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// Un archivo recién subido a la carpeta del pedido (todavía sin registrar)
function upload(db: FakeDb): string {
  const path = hcDocPath(R, randomUUID());
  db.files.set(path, { bytes: PDF, created_at: new Date().toISOString() });
  return path;
}

describe("servidor: registrar un PDF (cortes y dos intentos a la vez)", () => {
  beforeEach(featuresOn);

  test("si la fila se guardó pero la respuesta no llegó, el archivo no se borra y el reintento lo encuentra", async () => {
    const db = seed();
    addRequest(db);
    const path = upload(db);
    const ctx = fakeCtx(db);
    db.lostInsert = (t) => t === "portal_hc_documents";
    const e = await failure(staffRegister(ctx, STAFF, { request_id: R, path, file_name: "hc.pdf" }));
    expect(e.status).toBe(503);
    expect(db.files.has(path)).toBe(true);
    expect(db.tables.portal_hc_documents).toHaveLength(1);

    db.lostInsert = null;
    const out = await staffRegister(ctx, STAFF, { request_id: R, path, file_name: "hc.pdf" });
    expect(out.documents.map((d) => d.id)).toEqual([db.tables.portal_hc_documents[0].id as string]);
    expect(db.files.has(path)).toBe(true);
  });

  test("si no se puede saber si quedó registrado, el archivo no se toca", async () => {
    const db = seed();
    addRequest(db);
    const path = upload(db);
    let tried = false;
    db.beforeQuery = (q) => {
      if (q.table !== "portal_hc_documents") return false;
      if (q.op === "insert") tried = true;
      return tried; // desde el intento de guardarla, la tabla no contesta
    };
    const e = await failure(staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "hc.pdf" }));
    expect(e.status).toBe(503);
    expect(db.files.has(path)).toBe(true); // si quedó suelto, lo borra sweepOrphans más adelante
    expect(db.tables.portal_hc_documents).toHaveLength(0);
  });

  test("si la fila no se guardó, el archivo se borra", async () => {
    const db = seed();
    addRequest(db);
    const path = upload(db);
    db.beforeQuery = (q) => q.table === "portal_hc_documents" && q.op === "insert";
    const e = await failure(staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "hc.pdf" }));
    expect(e.status).toBe(503);
    expect(db.files.has(path)).toBe(false);
    expect(db.tables.portal_hc_documents).toHaveLength(0);
  });

  test("dos intentos a la vez con el mismo archivo: el segundo devuelve el pedido, sin 409 y sin borrar nada", async () => {
    const db = seed();
    addRequest(db);
    const path = upload(db);
    // El otro intento termina de registrarlo mientras este baja el archivo
    db.onDownload = (p) => {
      if (p === path && !db.tables.portal_hc_documents.length) addDoc(db, { id: randomUUID(), storage_path: path, sha256: sha(PDF) });
    };
    const out = await staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "hc.pdf" });
    expect(out.documents).toHaveLength(1);
    expect(db.tables.portal_hc_documents).toHaveLength(1);
    expect(db.files.has(path)).toBe(true);
    expect(db.removed).toEqual([]);
  });

  test("el mismo PDF en otro archivo del pedido: 409 y se borra solo el nuevo", async () => {
    const db = seed();
    addRequest(db);
    const first = addDoc(db, { id: randomUUID(), sha256: sha(PDF) });
    const path = upload(db);
    const e = await failure(staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "hc.pdf" }));
    expect(e.status).toBe(409);
    expect(e.message).toBe("Ese PDF ya está subido en este pedido.");
    expect(db.files.has(path)).toBe(false);
    expect(db.files.has(first.storage_path as string)).toBe(true);
  });

  test("si no se puede volver a mirar el pedido después de guardar, el PDF se quita y se avisa el error", async () => {
    const db = seed();
    addRequest(db);
    const path = upload(db);
    let saved = false;
    db.onInsert = (t) => {
      if (t === "portal_hc_documents") saved = true;
    };
    db.beforeQuery = (q) => saved && q.table === "portal_hc_requests" && q.op === "select";
    const e = await failure(staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "hc.pdf" }));
    expect(e.status).toBe(503);
    expect(e.message).toBe("No se pudo guardar el PDF. Probá de nuevo.");
    expect(db.tables.portal_hc_documents[0].removed_at).not.toBeNull();
    expect(db.files.has(path)).toBe(false);
    expect(db.tables.portal_hc_request_events).toHaveLength(0);
  });

  test("si el PDF ya salió con la copia mientras se registraba, queda y se devuelve el pedido", async () => {
    const db = seed();
    addRequest(db);
    const path = upload(db);
    db.onInsert = (t, row) => {
      if (t !== "portal_hc_documents") return;
      const now = new Date().toISOString();
      Object.assign(db.tables.portal_hc_requests[0], { status: "enviada", sent_at: now, sent_by_email: "dir@cimt.test", updated_at: now });
      row.published_at = now;
    };
    const out = await staffRegister(fakeCtx(db), STAFF, { request_id: R, path, file_name: "hc.pdf" });
    expect(out.status).toBe("enviada");
    expect(out.documents).toHaveLength(1);
    expect(db.tables.portal_hc_documents[0].removed_at).toBeNull();
    expect(db.files.has(path)).toBe(true);
    expect(db.tables.portal_hc_request_events.map((e) => e.kind)).toEqual(["documento"]);
  });
});

describe("servidor: enviar la copia con los PDF revisados", () => {
  beforeEach(featuresOn);
  const LIST_CHANGED = "La lista de PDF cambió mientras revisabas. Actualizá y revisala de nuevo.";

  function twoDocs(db: FakeDb) {
    addRequest(db);
    return [addDoc(db, { id: randomUUID(), uploaded_at: ago(2 * HOUR) }), addDoc(db, { id: randomUUID(), uploaded_at: ago(HOUR) })];
  }
  const unchanged = (db: FakeDb) => {
    expect(db.tables.portal_hc_requests[0].status).toBe("pendiente");
    expect(db.tables.portal_hc_requests[0].sent_at).toBeNull();
    expect(db.tables.portal_hc_documents.every((d) => d.published_at === null)).toBe(true);
  };

  test("sin la lista de los PDF revisados no se envía", async () => {
    const db = seed();
    const [a] = twoDocs(db);
    const ctx = fakeCtx(db);
    for (const document_ids of [undefined, [], ["no-es-un-id"], a.id]) {
      expect((await failure(staffSend(ctx, STAFF, { request_id: R, acks: ACKS, document_ids }))).status).toBe(400);
    }
    unchanged(db);
  });

  test("si alguien subió otro PDF mientras se revisaba: 409 y no se envía", async () => {
    const db = seed();
    const [a] = twoDocs(db);
    const e = await failure(staffSend(fakeCtx(db), STAFF, { request_id: R, acks: ACKS, document_ids: [a.id] }));
    expect(e.status).toBe(409);
    expect(e.message).toBe(LIST_CHANGED);
    unchanged(db);
  });

  test("si alguien quitó uno de los revisados: 409 y no se envía", async () => {
    const db = seed();
    const [a, b] = twoDocs(db);
    b.removed_at = ago(60 * 1000);
    const e = await failure(staffSend(fakeCtx(db), STAFF, { request_id: R, acks: ACKS, document_ids: [a.id, b.id] }));
    expect(e.message).toBe(LIST_CHANGED);
    unchanged(db);
  });

  test("con la lista exacta (en cualquier orden) se envía y se publican esos PDF", async () => {
    const db = seed();
    const [a, b] = twoDocs(db);
    const out = await staffSend(fakeCtx(db), STAFF, {
      request_id: R, acks: ACKS, document_ids: [(b.id as string).toUpperCase(), a.id, a.id],
    });
    expect(out.status).toBe("enviada");
    expect(db.tables.portal_hc_documents.every((d) => d.published_at !== null)).toBe(true);
    expect(db.tables.portal_hc_request_events.map((e) => e.kind)).toEqual(["enviada"]);
  });

  test("un PDF que se registra durante el envío no sale con la copia", async () => {
    const db = seed();
    const [a, b] = twoDocs(db);
    const late: Row[] = [];
    db.beforeQuery = (q) => {
      if (q.table === "portal_hc_requests" && q.op === "update" && q.payload.status === "enviada" && !late.length) {
        late.push(addDoc(db, { id: randomUUID() }));
      }
    };
    const out = await staffSend(fakeCtx(db), STAFF, { request_id: R, acks: ACKS, document_ids: [a.id, b.id] });
    expect(out.status).toBe("enviada");
    expect(a.published_at).not.toBeNull();
    expect(b.published_at).not.toBeNull();
    expect(late).toHaveLength(1);
    expect(late[0].published_at).toBeNull();
  });

  test("si uno de los revisados se quita justo antes de publicar, se deshace el envío", async () => {
    const db = seed();
    const [a, b] = twoDocs(db);
    db.beforeQuery = (q) => {
      if (q.table === "portal_hc_documents" && q.op === "update" && q.payload.published_at && !b.removed_at) b.removed_at = new Date().toISOString();
    };
    const e = await failure(staffSend(fakeCtx(db), STAFF, { request_id: R, acks: ACKS, document_ids: [a.id, b.id] }));
    expect(e.status).toBe(409);
    expect(e.message).toBe(LIST_CHANGED);
    unchanged(db);
    expect(db.tables.portal_hc_request_events).toHaveLength(0);
  });
});

describe("servidor: etapas que se informan al portal y al panel", () => {
  beforeEach(featuresOn);

  test("hc_digital solo si la copia digital está disponible de verdad", async () => {
    const ctx = fakeCtx(seed());
    expect((await familyClinical(ctx, ACCOUNT)).features).toEqual(["consent", "hc_digital"]);
    expect(await effectiveFeatures(ctx)).toEqual(["consent", "hc_digital"]);
  });

  test("sin el script 24 no se nombra hc_digital (aunque esté prendida)", async () => {
    const ctx = fakeCtx(seed({ noE1: true }));
    const out = await familyClinical(ctx, ACCOUNT);
    expect(out.features).toEqual(["consent"]);
    expect(out.consent.accepted).toBe(true);
    expect(await effectiveFeatures(ctx)).toEqual(["consent"]);
  });

  test("sin consent, hc_digital no vale", async () => {
    process.env.PORTAL_CLINICAL_FEATURES = "info,hc_digital";
    expect(await effectiveFeatures(fakeCtx(seed()))).toEqual(["info"]);
  });

  test("si no se puede saber (sin conexión), no se nombra y no falla", async () => {
    const db = seed();
    db.offline.add("portal_hc_requests");
    expect(await effectiveFeatures(fakeCtx(db))).toEqual(["consent"]);
  });
});
