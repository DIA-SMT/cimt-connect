import { createLucideIcon } from "lucide-react";

// Bandera a cuadros de llegada (lucide no la tiene): el ícono de las metas.
// Mismo trazo que los demás íconos; los cuadros oscuros van rellenos
export const FinishFlag = createLucideIcon("finish-flag", [
  ["path", { d: "M4 22V2", key: "pole" }],
  ["rect", { x: "4", y: "4", width: "16", height: "10.5", rx: "1", key: "flag" }],
  ["path", { d: "M4 4h4v3.5H4zM12 4h4v3.5h-4zM8 7.5h4V11H8zM16 7.5h4V11h-4zM4 11h4v3.5H4zM12 11h4v3.5h-4z", fill: "currentColor", key: "checks" }],
]);
