// De dónde sale el permiso expreso que pide el portal: la norma mínima, a la
// vista junto a la casilla, y el detalle en «Ver más». Puro y sin alias de
// imports (lo usan el portal y las pruebas).
//
// Borrador hasta que lo revise el área legal. Explica el permiso, no cambia
// lo que se acepta: por eso no sube la versión de los avisos
// (CLINICAL_NOTICE_VERSION, RECORDING_NOTICE_VERSION).
//
// Nunca se habla de la conformidad del adolescente (no se le revela a la
// familia; ver src/lib/portalClinicalRules.ts).

import { RECORDING_KEEP_DAYS } from "./recordingRules";

export type LegalPoint = { ref: string; text: string };

export type LegalBasis = {
  summary: string;
  laws: string;
  more: readonly LegalPoint[];
};

const SENSITIVE: LegalPoint = {
  ref: "Ley 25.326, art. 2",
  text: "La información sobre la salud es un «dato sensible»: tiene más protección que otros datos personales.",
};

// Información de salud en el portal (src/routes/portal.informacion-salud.tsx
// y el aviso de privacidad)
export const CLINICAL_LEGAL_BASIS: LegalBasis = {
  summary:
    "La información de salud es un dato sensible. Para mostrarla en el portal, la ley pide que lo aceptes de forma libre, expresa e informada, y que puedas retirar el permiso cuando quieras.",
  laws: "Ley 25.326 de Protección de Datos Personales (arts. 2 y 5) y Ley 26.529 de Derechos del Paciente (arts. 2 y 4).",
  more: [
    SENSITIVE,
    {
      ref: "Ley 25.326, arts. 5 y 6",
      text: "Para usar datos personales hace falta el consentimiento libre, expreso e informado de su titular, por escrito o por un medio equivalente, y antes hay que contarle para qué se usan y quién los ve. Por eso te explicamos cómo funciona y te pedimos la contraseña: deja constancia de que sos vos quien acepta.",
    },
    {
      ref: "Ley 25.326, art. 8",
      text: "Para atender a sus pacientes, el centro ya usa sus datos de salud, con secreto profesional. Verlos en el portal es aparte y optativo: por eso pedimos este permiso.",
    },
    {
      ref: "Ley 26.529, art. 2",
      text: "Los pacientes tienen derecho a la intimidad y a la confidencialidad, y el derecho a la información incluye el de no recibirla. Por eso nada aparece si no lo activás.",
    },
    {
      ref: "Ley 26.529, art. 4, y Código Civil y Comercial, art. 26",
      text: "La información de salud solo se comparte con otras personas si el paciente lo autoriza. Si es menor de edad, la recibe su representante legal: mamá, papá o tutor/a. Por eso el vínculo se verifica una vez en el centro, y un adulto autorizado ve solo los turnos.",
    },
    {
      ref: "Ley 26.529, art. 13, y Ley 25.326, art. 9",
      text: "La información de salud guardada en sistemas informáticos se protege con acceso restringido y claves. Por eso, a veces, te pedimos la contraseña de nuevo.",
    },
    {
      ref: "Decreto 1558/2001, art. 5",
      text: "El permiso se puede retirar en cualquier momento, desde «Información de salud» en el portal.",
    },
    {
      ref: "Ley 25.326, arts. 14 y 16",
      text: "Podés pedir ver tus datos y corregirlos. La Agencia de Acceso a la Información Pública controla que se cumpla esta ley y recibe reclamos.",
    },
  ],
};

// «Me grabo» (src/components/activity/RecordPlay.tsx)
export const RECORDING_LEGAL_BASIS: LegalBasis = {
  summary:
    "Una grabación de cómo habla el paciente es información de salud, un dato sensible. Por eso la ley pide tu permiso expreso antes de mandarla, y podés retirarlo cuando quieras.",
  laws: "Ley 25.326 de Protección de Datos Personales (arts. 2, 5 y 12).",
  more: [
    SENSITIVE,
    {
      ref: "Ley 25.326, arts. 5 y 6",
      text: "Para usar datos personales hace falta el consentimiento libre, expreso e informado de su titular, y antes hay que contarle para qué se usan, quién los ve y cuánto tiempo se guardan.",
    },
    {
      ref: "Ley 25.326, art. 4",
      text: `Los datos se borran cuando ya no hacen falta para lo que se pidieron. Por eso el audio se borra a los ${RECORDING_KEEP_DAYS} días.`,
    },
    {
      ref: "Ley 25.326, art. 12, y Decreto 1558/2001, art. 12",
      text: "La ley limita que los datos personales se procesen en otros países: con tu consentimiento expreso se puede. Por eso te avisamos que el reconocimiento de voz puede hacerse fuera de la Argentina.",
    },
    {
      ref: "Decreto 1558/2001, art. 5",
      text: "El permiso se puede retirar en cualquier momento, desde «Información de salud» en el portal: no se mandan más grabaciones y se borran los audios.",
    },
  ],
};
