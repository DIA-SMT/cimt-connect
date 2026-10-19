// Pruebas de las actividades armadas con ayuda de IA (fase 2): la idea libre
// (sin nombres ni datos), el pedido, el prompt, el esquema de la respuesta y
// cómo la respuesta del modelo se vuelve una actividad jugable.
// Correr con: bun test
import { describe, expect, test } from "bun:test";
import {
  type ActivityRequest, DEFAULT_ACTIVITY_REQUEST, activityFromWire, activityJsonSchema, activityPrompt, buildActivityRequest,
  ideaProblem, mockActivityWire,
} from "../src/lib/aiActivityRules";
import {
  ACTIVITY_FLAG_FIELD, type AiDraftRequest, PROMPT_BANNED_WORDS, activityRhymeIssues, buildAdaptParams, buildAdaptPrompt, describeSent,
  draftJsonSchema, draftToExerciseInput, draftToWire, exerciseFullText, mockDraft, parseExerciseDraft, requestOptionsFor,
} from "../src/lib/aiDraftRules";
import { activityWarnings } from "../src/lib/activityMechanics";

const REQ: AiDraftRequest = {
  patient_id: "00000000-0000-4000-8000-000000000001",
  catalog_ids: ["hf-tortuga-suave"],
  approach: "habla_facil",
  practiced_in_session: false,
  quien_acompana: "adulto_con_chico",
  contexto: ["casa"],
  minutos: 10,
  dificultad: "igual",
  adaptaciones: [],
  intereses: ["espacio"],
  formato: "poesia",
  actividad: { mecanica: "poesia", idea: "un astronauta que junta piezas de su nave", estrofas: 2, esquema: "AABB" },
};
const PATIENT = { age: 7, diagnosis_code: "F98.5" };

function built(req: AiDraftRequest = REQ, patient = PATIENT) {
  const r = buildAdaptParams(req, patient);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("la idea libre", () => {
  test("se manda una idea sin datos de la persona", () => {
    expect(ideaProblem("")).toBeNull();
    expect(ideaProblem(null)).toBeNull();
    expect(ideaProblem("Un astronauta que recorre tres planetas y junta las piezas de su nave.")).toBeNull();
    expect(ideaProblem("Un viaje a marte. Después vuelve a casa")).toBeNull();
    expect(ideaProblem("«Un pirata» que arma historias")).toBeNull();
  });

  test("nombres, números largos, mails, enlaces y lo muy largo, no", () => {
    expect(ideaProblem("un cuento para Juan sobre dinosaurios")).toContain("«Juan»");
    expect(ideaProblem("que juegue con su perro Toby")).toContain("nombre propio");
    expect(ideaProblem("vive en el 4111222")).toContain("números");
    expect(ideaProblem("escribir a mama@mail.com")).toContain("mails");
    expect(ideaProblem("ver www.algo.com")).toContain("enlaces");
    expect(ideaProblem("x".repeat(161))).toContain("160");
  });
});

describe("el pedido", () => {
  test("valores por defecto y listas cerradas", () => {
    const r = buildActivityRequest({ mecanica: "rima", tarjetas: 99, sonidos: ["p", "zz", "rr"], idea: "  un  pirata  " });
    expect(r).toEqual({ ok: true, value: { ...DEFAULT_ACTIVITY_REQUEST, mecanica: "rima", tarjetas: 4, sonidos: ["p", "rr"], idea: "un pirata" } });
    expect(buildActivityRequest({ mecanica: "aventura" }).ok).toBe(false);
    expect(buildActivityRequest({ mecanica: "poesia", sonidos: ["p", "b", "m", "t"] }).ok).toBe(false);
    expect(buildActivityRequest({ mecanica: "poesia", idea: "para Juan" }).ok).toBe(false);
    expect(buildActivityRequest(null).ok).toBe(false);
  });

  test("buildAdaptParams: con «Poesía o rima», un solo ejercicio y desde los 6 años", () => {
    const b = built();
    expect(b.params.actividad).toMatchObject({ mecanica: "poesia", estrofas: 2, esquema: "AABB", idea: "un astronauta que junta piezas de su nave" });
    const err = (req: AiDraftRequest, patient = PATIENT) => {
      const r = buildAdaptParams(req, patient);
      return r.ok ? null : r.error;
    };
    expect(err({ ...REQ, formato: "minijuego" })).toContain("Poesía o rima");
    expect(err({ ...REQ, catalog_ids: ["hf-tortuga-suave", "hf-tortuga-suave-2"] })).toBeTruthy();
    expect(err(REQ, { age: 5, diagnosis_code: "F98.5" })).toBeTruthy();
    expect(err({ ...REQ, actividad: { mecanica: "poesia", idea: "para Martina" } })).toContain("nombre propio");
    // Sin juego, el pedido es el de siempre (sin la clave «actividad»)
    expect("actividad" in built({ ...REQ, actividad: null }).params).toBe(false);
  });
});

describe("el prompt y el esquema", () => {
  test("el bloque del juego reemplaza al del formato; la idea va como dato en <pedido>", () => {
    const b = built();
    const { system, user } = buildAdaptPrompt(b.params, b.entries);
    expect(system).toContain("«actividad»: una poesía original");
    expect(system).toContain("2 estrofas de 4 versos");
    expect(system).not.toContain("Va completa dentro de uno de los pasos");
    expect(user).toContain("un astronauta que junta piezas de su nave");
    for (const w of PROMPT_BANNED_WORDS) expect(activityPrompt(b.params.actividad!)).not.toContain(w);
    expect(requestOptionsFor(b.params).max_tokens).toBeGreaterThan(requestOptionsFor({}).max_tokens);
  });

  test("el esquema suma «actividad» obligatoria, en el subconjunto del modo strict", () => {
    const s = draftJsonSchema(["hf-tortuga-suave"], { mecanica: "rima" });
    expect(s.required).toContain("actividad");
    const keys = new Set<string>();
    let depth = 0;
    const walk = (node: unknown, d: number) => {
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (k === "type" || k === "required" || k === "additionalProperties" || k === "properties" || k === "items") keys.add(k);
        if (k === "type" && v === "object") depth = Math.max(depth, d);
        walk(v, k === "properties" ? d + 1 : d);
      }
    };
    walk(s, 1);
    expect([...keys].sort()).toEqual(["additionalProperties", "items", "properties", "required", "type"]);
    expect(depth).toBeLessThanOrEqual(5);
    expect(() => draftJsonSchema(["a", "b"], { mecanica: "poesia" })).toThrow();
    expect(activityJsonSchema({ mecanica: "poesia" }).required).toEqual(["titulo", "tema", "estrofas"]);
  });
});

describe("de la respuesta a la actividad", () => {
  const req: ActivityRequest = { ...DEFAULT_ACTIVITY_REQUEST, mecanica: "poesia", estrofas: 2, esquema: "AABB", palmas: true };

  test("suma lo que pidió el profesional; tema y dibujos fuera del catálogo no se inventan", () => {
    const wire = { ...mockActivityWire(req), tema: "https://x.com/fondo.png", estrofas: (mockActivityWire(req).estrofas as { versos: string[] }[]).map((e) => ({ ...e, icono: "dinosaurio" })) };
    const r = activityFromWire(wire, req);
    expect(r.ok).toBe(true);
    if (!r.ok || r.spec.mecanica !== "poesia") return;
    expect(r.spec).toMatchObject({ v: 1, mecanica: "poesia", esquema: "AABB", rima: "asonante", palmas: true, tema: "cielo" });
    expect(r.spec.estrofas.every((e) => e.icono === null)).toBe(true);
    expect(activityWarnings(r.spec)).toEqual([]);
  });

  test("la forma pedida se cumple", () => {
    expect(activityFromWire(mockActivityWire({ ...req, estrofas: 3 }), { ...req, estrofas: 3 }).ok).toBe(true);
    expect(activityFromWire(mockActivityWire({ ...req, estrofas: 1 }), req).ok).toBe(false);
    const rima = { ...DEFAULT_ACTIVITY_REQUEST, mecanica: "rima" as const, tarjetas: 3 };
    expect(activityFromWire(mockActivityWire(rima), rima).ok).toBe(true);
    expect(activityFromWire(mockActivityWire(rima), { ...rima, tarjetas: 4 }).ok).toBe(false);
    expect(activityFromWire({ titulo: "x", tema: "mar", tarjetas: "no" }, rima).ok).toBe(false);
  });

  test("el demo arma juegos que riman (poesía AABB y AA, y las seis tarjetas)", () => {
    for (const r of [req, { ...req, esquema: "AA" as const, estrofas: 3 }, { ...DEFAULT_ACTIVITY_REQUEST, mecanica: "rima" as const, tarjetas: 6 }]) {
      const a = activityFromWire(mockActivityWire(r), r);
      expect(a.ok).toBe(true);
      if (a.ok) expect(activityWarnings(a.spec)).toEqual([]);
    }
  });
});

describe("parseExerciseDraft con el juego", () => {
  const b = built();
  const draft = mockDraft(b.params, b.entries);
  const wire = draftToWire(draft);
  const parse = (raw: unknown) => parseExerciseDraft(raw, b.params.catalogo.ids, b.params.minutos, b.params.enfoque, b.params.actividad);

  test("la forma del modelo y la de adentro dan la misma actividad", () => {
    const fromWire = parse(wire);
    const fromInside = parse(draft);
    expect(fromWire.ok && fromInside.ok).toBe(true);
    if (!fromWire.ok || !fromInside.ok) return;
    expect(fromWire.draft.actividad).toEqual(fromInside.draft.actividad);
    expect(fromWire.draft.actividad?.mecanica).toBe("poesia");
    expect(activityRhymeIssues(fromWire.draft)).toBe(0);
  });

  test("sin el juego pedido, lo que venga en «actividad» no se usa", () => {
    const r = parseExerciseDraft(wire, b.params.catalogo.ids, b.params.minutos, b.params.enfoque, null);
    expect(r.ok && r.draft.actividad).toBe(undefined);
  });

  test("un juego roto se rechaza; uno con palabras bloqueadas también", () => {
    expect(parse({ ...wire, actividad: { titulo: "x", tema: "mar", estrofas: [] } })).toMatchObject({ ok: false, code: "ACTIVITY" });
    expect(parse({ ...wire, actividad: undefined })).toMatchObject({ ok: false, code: "ACTIVITY" });
    const act = wire.actividad as { estrofas: { versos: string[] }[] };
    const bad = { ...wire, actividad: { ...act, estrofas: act.estrofas.map((e, i) => (i === 0 ? { ...e, versos: ["Vamos a hablar bien", ...e.versos.slice(1)] } : e)) } };
    expect(parse(bad)).toMatchObject({ ok: false, code: "LINT_BLOCK" });
  });

  test("si no rima, pasa con avisos para el profesional", () => {
    const act = wire.actividad as { estrofas: { versos: string[] }[] };
    const off = { ...wire, actividad: { ...act, estrofas: act.estrofas.map((e, i) => (i === 0 ? { ...e, versos: [e.versos[0], "camina por la calle", ...e.versos.slice(2)] } : e)) } };
    const r = parse(off);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(activityRhymeIssues(r.draft)).toBe(1);
    expect(r.flags.some((f) => f.field === ACTIVITY_FLAG_FIELD && f.term.includes("no parecen rimar"))).toBe(true);
  });

  test("del borrador al editor: el juego va con el ejercicio y cuenta para lo editado", () => {
    const r = parse(wire);
    if (!r.ok) throw new Error();
    const input = draftToExerciseInput(r.draft.ejercicios[0], { approach: "habla_facil", practiced_in_session: false, draft_id: "d" }, r.draft.actividad ?? null);
    expect(input.activity?.mecanica).toBe("poesia");
    expect(exerciseFullText(input)).toContain("Un cohete chiquito");
  });

  test("«Esto es lo que se manda a la IA» nombra el juego y la idea", () => {
    const sent = describeSent(b.params, b.entries);
    expect(sent.fields).toContainEqual({ label: "Idea", value: "un astronauta que junta piezas de su nave" });
    expect(sent.fields.find((f) => f.label === "Juego para el celular")?.value).toContain("2 estrofas de 4 versos");
  });
});
