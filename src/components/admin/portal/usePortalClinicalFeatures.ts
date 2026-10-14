import { useEffect, useState } from "react";
import { portalStaffApi, type ClinicalFeature } from "@/lib/portalStaff";

// Etapas de la información de salud prendidas en el servidor
// (PORTAL_CLINICAL_FEATURES). Se piden una vez por carga de la página y todas
// las fichas que se abran después usan la misma respuesta. Si la consulta
// falla, no se guarda: la próxima ficha que se abra vuelve a preguntar.
// Devuelve null mientras carga o si no se pudo saber; [] si está todo apagado.

let pending: Promise<ClinicalFeature[] | null> | null = null;
let known: ClinicalFeature[] | null = null;

function loadFeatures(): Promise<ClinicalFeature[] | null> {
  pending ??= portalStaffApi.clinicalFeatures()
    .catch(() => null)
    .then((f) => {
      if (f) known = f;
      else pending = null; // no se guarda un error
      return f;
    });
  return pending;
}

export function usePortalClinicalFeatures(): ClinicalFeature[] | null {
  const [features, setFeatures] = useState<ClinicalFeature[] | null>(known);

  useEffect(() => {
    if (known) return;
    let cancelled = false;
    loadFeatures().then((f) => { if (!cancelled) setFeatures(f); });
    return () => { cancelled = true; };
  }, []);

  return features;
}
