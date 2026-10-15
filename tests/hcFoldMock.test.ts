// Pruebas del modo mock (src/integrations/supabase/mockPortal.ts) para que los
// pedidos de copia cerrados no se acumulen en el portal: cada pedido trae
// cuándo se cerró (closed_at, de la columna del paso, como el servidor), la
// demo tiene pedidos viejos para ver el plegado («Ver pedidos anteriores»),
// el aviso de un rechazo dura una semana y la tarjeta rechazada pasa del rojo
// al gris. El mock guarda todo en localStorage y la sesión en sessionStorage:
// acá van en memoria. Las esperas del mock (que imitan la red) se acortan a 0.
// Correr con: bun test
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { hcStatus } from "../src/lib/portal";
import { HC_NOTICE_DAYS, HC_RECENT_CLOSED_DAYS, hcRejectNotices, splitHcRequests } from "../src/lib/portalRules";

type Mock = typeof import("../src/integrations/supabase/mockPortal");

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
}

const g = globalThis as unknown as Record<string, unknown>;
const realSetTimeout = globalThis.setTimeout;
const hadWindow = "window" in g;
const local = new MemoryStorage();
const session = new MemoryStorage();
let mock: Mock;

const DAY = 24 * 60 * 60 * 1000;
const STAFF = "demo@cimt.local";
const MARTIN = "c-martin";

const ok = <T>(r: { ok: true; data: T } | { ok: false; status: number; error: string }): T => {
  if (!r.ok) throw new Error(`${r.status} ${r.error}`);
  return r.data;
};

beforeAll(async () => {
  g.setTimeout = ((fn: (...a: unknown[]) => void, _ms?: number, ...args: unknown[]) => realSetTimeout(fn, 0, ...args)) as never;
  g.window = { localStorage: local, sessionStorage: session };
  mock = await import("../src/integrations/supabase/mockPortal");
});

afterAll(() => {
  g.setTimeout = realSetTimeout;
  if (!hadWindow) delete g.window;
});

beforeEach(async () => {
  mock.resetDemo();
  local.clear();
  session.clear();
  ok(await mock.login("30111222", "familia2026")); // Laura
});

describe("mock: pedidos de copia cerrados", () => {
  test("la demo: el pendiente de Martín a la vista y sus dos pedidos viejos plegados", async () => {
    const { requests } = ok(await mock.childAppointments(MARTIN)).hc;
    const { current, older } = splitHcRequests(requests);
    expect(current.map((r) => r.id)).toEqual(["hc-demo-1"]);
    // Del que se cerró último (entregada) al primero (cancelada)
    expect(older.map((r) => r.id)).toEqual(["hc-demo-4", "hc-demo-3"]);
    expect(current[0].closed_at).toBeNull();
    for (const r of older) {
      const days = (Date.now() - Date.parse(r.closed_at!)) / DAY;
      expect(days).toBeGreaterThan(HC_RECENT_CLOSED_DAYS);
    }
    // La entregada se cerró al entregarla (40 días), no al pedirla (46)
    const delivered = older[0];
    expect(delivered.closed_at).toBe(delivered.delivered_at);
    expect(Math.round((Date.now() - Date.parse(delivered.closed_at!)) / DAY)).toBe(40);
    // El inicio no avisa ningún rechazo
    expect(hcRejectNotices(ok(await mock.me()).requests)).toEqual([]);
  });

  test("la demo: Valentina, con la copia para descargar, no tiene nada plegado", async () => {
    const { requests } = ok(await mock.childAppointments("c-valentina")).hc;
    const { current, older } = splitHcRequests(requests);
    expect(current.map((r) => r.id)).toEqual(["hc-demo-2"]);
    expect(current[0].closed_at).toBe(current[0].sent_at);
    expect(older).toEqual([]);
  });

  test("un rechazo: closed_at del rechazo, las notas no lo mueven y el aviso dura una semana", async () => {
    ok(await mock.staffHcUpdate({ id: "hc-demo-1", to: "rechazada", reject_reason: "otro" }, STAFF));
    const first = ok(await mock.me()).requests.find((r) => r.id === "hc-demo-1")!;
    expect(first.status).toBe("rechazada");
    expect(Date.now() - Date.parse(first.closed_at!)).toBeLessThan(60_000);

    ok(await mock.staffHcNotes("hc-demo-1", "Llamamos a Laura.", STAFF));
    const { requests } = ok(await mock.me());
    const again = requests.find((r) => r.id === "hc-demo-1")!;
    expect(again.closed_at).toBe(first.closed_at);

    // Inicio: el aviso en rojo, solo hasta 7 días después del rechazo
    expect(hcRejectNotices(requests).map((r) => r.id)).toEqual(["hc-demo-1"]);
    const rejectedAt = Date.parse(again.closed_at!);
    expect(hcRejectNotices(requests, new Date(rejectedAt + HC_NOTICE_DAYS * DAY)).map((r) => r.id)).toEqual(["hc-demo-1"]);
    expect(hcRejectNotices(requests, new Date(rejectedAt + HC_NOTICE_DAYS * DAY + 1))).toEqual([]);
    // La tarjeta: el mismo texto, en rojo la primera semana y después en gris
    const fresh = hcStatus(again);
    const later = hcStatus(again, new Date(rejectedAt + 8 * DAY));
    expect(fresh.tone).toBe("bad");
    expect(later.tone).toBe("muted");
    expect(later.text).toBe(fresh.text);

    // «Mi información»: el rechazo es el cerrado más nuevo (a la vista); los viejos, plegados
    const page = ok(await mock.childAppointments(MARTIN)).hc.requests;
    const split = splitHcRequests(page);
    expect(split.current.map((r) => r.id)).toEqual(["hc-demo-1"]);
    expect(split.older.map((r) => r.id)).toEqual(["hc-demo-4", "hc-demo-3"]);
    // Pasados 30 días, también se pliega
    const month = splitHcRequests(page, new Date(rejectedAt + (HC_RECENT_CLOSED_DAYS + 1) * DAY));
    expect(month.current).toEqual([]);
    expect(month.older.map((r) => r.id)).toEqual(["hc-demo-1", "hc-demo-4", "hc-demo-3"]);
  });

  test("cancelado por la familia: closed_at del momento en que lo canceló", async () => {
    const cancelled = ok(await mock.hcCancel("hc-demo-1"));
    expect(cancelled.status).toBe("cancelada");
    expect(Date.now() - Date.parse(cancelled.closed_at!)).toBeLessThan(60_000);
  });
});
