// Actividades interactivas: el motor del juego (una máquina de estados chica).
// Puro: lo usan los componentes de src/components/activity/ y las pruebas,
// que juegan cada mecánica de principio a fin sin navegador.
//
// listo → jugando ⇄ pausado → terminado. Cada paso (un verso, una tarjeta)
// queda hecho al verlo (autoComplete) o al resolverlo (COMPLETAR). Se avanza
// solo desde un paso hecho, y se termina solo con todos hechos. Un evento que
// no corresponde al estado se ignora: devuelve el mismo estado.
// Sin tiempos, sin puntajes y sin perder: se puede volver atrás, pausar y
// empezar de nuevo cuando quieran.

export type EngineStatus = "listo" | "jugando" | "pausado" | "terminado";
export type EngineState = { status: EngineStatus; step: number; total: number; done: boolean[] };
export type EngineEvent =
  | { type: "EMPEZAR" }
  | { type: "COMPLETAR" }
  | { type: "SIGUIENTE" }
  | { type: "ANTERIOR" }
  | { type: "PAUSAR" }
  | { type: "SEGUIR" }
  | { type: "REINICIAR" };

export function initialEngine(total: number): EngineState {
  const n = Math.max(0, Math.floor(total));
  return { status: "listo", step: 0, total: n, done: Array.from({ length: n }, () => false) };
}

const mark = (done: boolean[], i: number) => (done[i] ? done : done.map((d, j) => d || j === i));

export function engineReduce(s: EngineState, e: EngineEvent, autoComplete: boolean): EngineState {
  const seen = (st: EngineState): EngineState => (autoComplete ? { ...st, done: mark(st.done, st.step) } : st);
  switch (e.type) {
    case "EMPEZAR":
      if (s.status !== "listo" || s.total === 0) return s;
      return seen({ ...s, status: "jugando" });
    case "COMPLETAR":
      if (s.status !== "jugando" || s.done[s.step]) return s;
      return { ...s, done: mark(s.done, s.step) };
    case "SIGUIENTE":
      if (s.status !== "jugando" || !s.done[s.step]) return s;
      if (s.step < s.total - 1) return seen({ ...s, step: s.step + 1 });
      return s.done.every(Boolean) ? { ...s, status: "terminado" } : s;
    case "ANTERIOR":
      if (s.status === "terminado") return { ...s, status: "jugando", step: s.total - 1 };
      if (s.status !== "jugando" || s.step === 0) return s;
      return { ...s, step: s.step - 1 };
    case "PAUSAR":
      return s.status === "jugando" ? { ...s, status: "pausado" } : s;
    case "SEGUIR":
      return s.status === "pausado" ? { ...s, status: "jugando" } : s;
    case "REINICIAR":
      return initialEngine(s.total);
  }
}

// Lo guardado en el aparato («seguir otro día»): solo si coincide con esta
// actividad (misma cantidad de pasos) y tiene la forma de un estado. Si no,
// se empieza de cero. Un juego terminado vuelve a empezar.
export function restoreEngine(raw: unknown, total: number): EngineState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<EngineState>;
  if (r.total !== total || !Array.isArray(r.done) || r.done.length !== total || !r.done.every((d) => typeof d === "boolean")) return null;
  if (typeof r.step !== "number" || !Number.isInteger(r.step) || r.step < 0 || r.step >= total) return null;
  if (r.status !== "jugando" && r.status !== "pausado") return null;
  return { status: "pausado", step: r.step, total, done: [...r.done] };
}
