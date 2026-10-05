import { useState } from "react";
import type { Staff } from "@/lib/staff";

// "Solo lo mío": filtro de la agenda y de pacientes para quien tiene el usuario
// vinculado a un profesional (lo vincula la Dirección en Equipo). Todos siguen
// pudiendo ver todo (relevamiento 13); esto es solo una vista. Para el rol
// Profesional arranca activado; la elección se recuerda en este navegador.

export function useMine(scope: "agenda" | "pacientes", staff: Staff) {
  const professionalId = staff.professional_id;
  const key = `cimt:solo-lo-mio:${scope}`;
  const [on, setOnState] = useState<boolean>(() => {
    if (!professionalId) return false;
    try {
      const saved = window.localStorage.getItem(key);
      if (saved !== null) return saved === "1";
    } catch {
      // sin acceso al almacenamiento: se usa el valor por defecto
    }
    return staff.role === "profesional";
  });

  function setOn(value: boolean) {
    setOnState(value);
    try {
      window.localStorage.setItem(key, value ? "1" : "0");
    } catch {
      // no se pudo recordar la preferencia; no pasa nada
    }
  }

  return {
    /** El usuario tiene un profesional vinculado */
    available: !!professionalId,
    /** El filtro está activo */
    on: !!professionalId && on,
    setOn,
    professionalId,
    /** Profesional sin usuario vinculado: conviene avisarle */
    needsLink: !professionalId && staff.role === "profesional",
  };
}
