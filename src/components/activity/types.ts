import type { EngineEvent, EngineState } from "@/lib/activityEngine";
import type { Speech } from "@/components/portal/useSpeech";

// Lo que recibe el componente de cada mecánica (registry.tsx)
export type MechanicProps<S> = {
  spec: S;
  state: EngineState;
  dispatch: (e: EngineEvent) => void;
  speech: Speech;
  big: boolean; // hasta 8 años (modo tortuga): letra más grande
  ink: string; // color de los dibujos (el del tema)
};
