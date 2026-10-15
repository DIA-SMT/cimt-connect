import { useEffect, useRef } from "react";
import { longDate } from "@/lib/agenda";
import { type ChildDTO, type FeedbackItemDTO, type MeDTO, type PracticeHomeDTO, capitalize, portalApi } from "@/lib/portal";
import { centerDateOf } from "@/lib/portalRules";
import { type PlanAudience, type PracticeWho, PRACTICE_TEXT, ddmm, medalWord } from "@/lib/practiceRules";

// Ejercicios, devoluciones y medallas (etapa B) en el Portal de familias:
// formato y utilidades compartidas (separadas de los componentes para que la
// recarga en caliente funcione). Los títulos y textos salen siempre de
// practiceRules.ts: acá solo se arman las palabras que dependen de "medalla"
// o "logro" y las fechas.

// Foco visible en los botones propios de estas pantallas
export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

// La persona de la que se habla (para los títulos de practiceRules)
export function whoOf(p: { first_name: string; self: boolean; audience: PlanAudience }): PracticeWho {
  return { first_name: p.first_name, self: p.self, audience: p.audience };
}

// Personas con algo de la etapa "practice" para ver en esta cuenta: un plan
// publicado o devoluciones, metas o medallas (cuadradito "Mis logros" del
// Inicio y la ayuda). El servidor ya aplicó la regla de acceso: sin "ok", no
// llega practice_home
export type PracticePerson = { child: ChildDTO; home: PracticeHomeDTO };

export function practiceHomes(me: Pick<MeDTO, "children">): PracticePerson[] {
  return me.children.flatMap((c) =>
    c.clinical?.practice === "ok" && c.clinical.practice_home ? [{ child: c, home: c.clinical.practice_home }] : []);
}

// Personas con un plan publicado (botón Ejercicios y su cuadradito en el Inicio)
export function practicePeople(me: Pick<MeDTO, "children">): PracticePerson[] {
  return practiceHomes(me).filter((p) => p.home.has_plan);
}

// La barra de abajo muestra "Ejercicios" si alguna persona tiene plan (sin
// plan, "Mis logros" está en el Inicio). Las páginas que ya piden /me (Inicio,
// Ayuda, Ejercicios) se lo avisan con este evento, así la barra no lo vuelve
// a pedir
export const PRACTICE_NAV_EVENT = "cimt-portal-practice-nav";

export function announcePracticeNav(me: Pick<MeDTO, "children">): void {
  try {
    window.dispatchEvent(new CustomEvent<boolean>(PRACTICE_NAV_EVENT, { detail: practicePeople(me).length > 0 }));
  } catch { /* sin window (no pasa en el navegador) */ }
}

// Una página de una persona que ya muestra un plan publicado (sus ejercicios,
// practicar) también se lo avisa a la barra, así "Ejercicios" sigue en "Mis
// logros" aunque no se haya pasado por el Inicio. Solo avisa que sí: que no
// hay plan lo dice /me (otra persona de la cuenta puede tenerlo)
export function announcePlanShown(): void {
  try {
    window.dispatchEvent(new CustomEvent<boolean>(PRACTICE_NAV_EVENT, { detail: true }));
  } catch { /* sin window (no pasa en el navegador) */ }
}

// "medals_seen" y "feedback_seen" aceptan hasta 50 ids por pedido: más, en
// varios pedidos (sin repetir ids)
export const SEEN_BATCH = 50;

export function seenBatches(ids: string[], size: number = SEEN_BATCH): string[][] {
  const list = [...new Set(ids)];
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Día del centro de una fecha ISO: "10/10"
export function isoDdmm(iso: string): string {
  return ddmm(centerDateOf(iso));
}

// Día del centro de una fecha ISO: "Viernes 10 de octubre"
export function isoLongDay(iso: string): string {
  return capitalize(longDate(centerDateOf(iso)).replace(",", ""));
}

// "medalla" hasta los 12; "logro" desde los 13 y para el titular (medalWord)
export function medalTerms(w: PracticeWho) {
  const logro = medalWord(w) === "logro";
  return {
    a: logro ? "un logro" : "una medalla",
    the: logro ? "el logro" : "la medalla",
    many: logro ? "logros" : "medallas",
    theMany: logro ? "los logros" : "las medallas",
    won: logro ? "Ganado" : "Ganada",
    gaveYou: logro ? "Te lo dio" : "Te la dio",
    fresh: logro ? "Nuevo" : "Nueva",
    seeAll: logro ? "Ver todos" : "Ver todas",
  };
}

// "Ver mis logros" / "Ver las medallas de Martín" / "Ver los logros de Fernanda"
export function seeMedalsLabel(w: PracticeWho): string {
  if (w.self) return "Ver mis logros";
  return `Ver ${medalTerms(w).theMany} de ${w.first_name}`;
}

// "Volver a mis logros" / "Volver a las medallas de Martín"
export function backToMedalsLabel(w: PracticeWho): string {
  if (w.self) return "Volver a mis logros";
  return `Volver a ${medalTerms(w).theMany} de ${w.first_name}`;
}

// Hasta los 12 (si no es el propio titular) las devoluciones se llaman
// "mensajes", como en feedbackTitle ("Mensaje de Lic. … para Martín")
export function feedbackIsMessage(w: PracticeWho): boolean {
  return !w.self && (w.audience === "infancia" || w.audience === "preadolescencia");
}

// Lo que hay en "Mis logros", en el orden de la página: "Medallas, metas y
// mensajes" (hasta 12) / "Logros, metas y devoluciones"
export function medalsHint(w: PracticeWho): string {
  return `${capitalize(medalTerms(w).many)}, metas y ${feedbackIsMessage(w) ? "mensajes" : "devoluciones"}`;
}

// Lo nuevo de "Mis logros", para el lector de pantalla (la marca visible dice
// "Nuevo"): ", hay un mensaje nuevo y una medalla nueva" o, con más de uno,
// ", hay mensajes nuevos" (sin el número: nada para comparar entre hermanos).
// "" si no hay nada
export function newThingsSr(w: PracticeWho, feedbackNew: number, medalsNew: number): string {
  const t = medalTerms(w);
  const message = feedbackIsMessage(w);
  const parts = [
    feedbackNew > 1 ? (message ? "mensajes nuevos" : "devoluciones nuevas")
      : feedbackNew === 1 ? (message ? "un mensaje nuevo" : "una devolución nueva") : null,
    medalsNew > 1 ? `${t.many} ${t.fresh.toLowerCase()}s`
      : medalsNew === 1 ? `${t.a} ${t.fresh.toLowerCase()}` : null,
  ].filter((x): x is string => !!x);
  return parts.length ? `, hay ${parts.join(" y ")}` : "";
}

// Marca como vistas por esta cuenta las devoluciones nuevas que la página ya
// mostró enteras (después de mostrarlas, una vez cada una; pedirlas no marca
// nada, así "Nueva" se ve aunque la página se cargue dos veces). Si falla,
// siguen nuevas y se vuelven a marcar en otra visita. shown: las que se ven
// enteras (estable entre renders) o null mientras carga
export function useFeedbackSeen(shown: FeedbackItemDTO[] | null): void {
  const marked = useRef(new Set<string>());
  useEffect(() => {
    if (!shown) return;
    const fresh = shown.filter((f) => f.is_new && !marked.current.has(f.id)).map((f) => f.id);
    for (const ids of seenBatches(fresh)) {
      ids.forEach((id) => marked.current.add(id));
      void portalApi.feedbackSeen(ids)
        .then((r) => { if (!r.ok) ids.forEach((id) => marked.current.delete(id)); })
        .catch(() => ids.forEach((id) => marked.current.delete(id)));
    }
  }, [shown]);
}

// Lo que no se puede ver se explica con muy pocas respuestas (como en "Mi
// información"): activar la información de salud, pasar por el centro o un
// texto neutro que nunca dice el motivo
export type PracticeFailure =
  | { kind: "error" }
  | { kind: "consent" }
  | { kind: "verify"; message: string }
  | { kind: "empty"; message: string };

export const VERIFY_FALLBACK = "Para ver la información de salud, la primera vez tenés que pasar por el centro con tu DNI.";

// notFound: el texto para un 404 (persona o ejercicio ajeno, que no existe o
// con la etapa apagada en el servidor: siempre el mismo texto)
export function practiceFailure(
  r: { status: number; code?: string; error: string },
  notFound: string = PRACTICE_TEXT.not_available,
): PracticeFailure {
  if (r.status === 404) return { kind: "empty", message: notFound };
  if (r.status !== 403) return { kind: "error" };
  if (r.code === "CONSENT") return { kind: "consent" };
  if (r.code === "VERIFY") return { kind: "verify", message: r.error || VERIFY_FALLBACK };
  return { kind: "empty", message: PRACTICE_TEXT.not_available };
}

// "Mis logros" y todas las devoluciones se ven también sin plan: lo mismo que
// practiceFailure, pero con textos que no nombran los ejercicios (el del
// servidor para "pasar por el centro" sí los nombra). Nunca dicen el motivo
export function logrosFailure(r: { status: number; code?: string; error: string }): PracticeFailure {
  const f = practiceFailure(r);
  if (f.kind === "empty") return { kind: "empty", message: PRACTICE_TEXT.nothing_here };
  if (f.kind === "verify") return { kind: "verify", message: VERIFY_FALLBACK };
  return f;
}
