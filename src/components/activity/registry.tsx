import type { ComponentType } from "react";
import type { ActivitySpec, Mechanic } from "@/lib/activitySpec";
import { PoemPlay } from "@/components/activity/PoemPlay";
import { RhymePlay } from "@/components/activity/RhymePlay";
import type { MechanicProps } from "@/components/activity/types";

// Qué componente juega cada mecánica. Sumar una mecánica: su esquema
// (src/lib/activitySpec.ts), sus reglas (src/lib/activityMechanics.ts) y su
// componente acá.
type Players = { [K in Mechanic]: ComponentType<MechanicProps<Extract<ActivitySpec, { mecanica: K }>>> };

export const MECHANIC_PLAYER: Players = {
  poesia: PoemPlay,
  rima: RhymePlay,
};

// Cómo se llama cada paso y qué hace falta para seguir
export const MECHANIC_WORDS: Record<Mechanic, { step: string; locked: string }> = {
  poesia: { step: "Verso", locked: "" },
  rima: { step: "Tarjeta", locked: "Elijan la palabra que rima para seguir." },
};
