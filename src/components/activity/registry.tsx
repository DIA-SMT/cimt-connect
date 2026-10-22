import type { ComponentType } from "react";
import type { ActivitySpec, Mechanic } from "@/lib/activitySpec";
import { BalloonPlay } from "@/components/activity/BalloonPlay";
import { PoemPlay } from "@/components/activity/PoemPlay";
import { ReadingPlay } from "@/components/activity/ReadingPlay";
import { RecordPlay } from "@/components/activity/RecordPlay";
import { RhymePlay } from "@/components/activity/RhymePlay";
import type { MechanicProps } from "@/components/activity/types";

// Qué componente juega cada mecánica. Sumar una mecánica: su esquema
// (src/lib/activitySpec.ts), sus reglas (src/lib/activityMechanics.ts) y su
// componente acá.
type Players = { [K in Mechanic]: ComponentType<MechanicProps<Extract<ActivitySpec, { mecanica: K }>>> };

export const MECHANIC_PLAYER: Players = {
  poesia: PoemPlay,
  rima: RhymePlay,
  globo: BalloonPlay,
  lectura: ReadingPlay,
  grabacion: RecordPlay,
};

// Cómo se llama cada paso y qué hace falta para seguir (locked: [a quien
// practica solo, con acompañante]).
// start: el título antes de empezar («¡A jugar!»; «Me grabo» no es un juego)
// again: el botón para repetir al final («Jugar otra vez»)
export const MECHANIC_WORDS: Record<Mechanic, { step: string; locked: readonly [string, string]; start?: string; again?: string }> = {
  poesia: { step: "Verso", locked: ["", ""] },
  rima: { step: "Tarjeta", locked: ["Elegí la palabra que rima para seguir.", "Elijan la palabra que rima para seguir."] },
  globo: { step: "Palabra", locked: ["Para seguir: la palabra con el micrófono o con el botón de abajo.", "Para seguir: la palabra con el micrófono o con el botón de abajo."] },
  lectura: { step: "Frase", locked: ["Para seguir: la frase con la tortuga.", "Para seguir: la frase con la tortuga."] },
  grabacion: {
    step: "Grabación",
    locked: ["Para terminar: mandá la grabación o tocá «Lo hice sin grabar».", "Para terminar: manden la grabación o toquen «Lo hicimos sin grabar»."],
    start: "¡A grabar!",
    again: "Grabar otra vez",
  },
};
