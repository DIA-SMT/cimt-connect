# Actividades interactivas — Fase 0: diagnóstico y diseño

Informe de la fase 0 de [prompt-actividades-interactivas.md](prompt-actividades-interactivas.md). No hay código todavía.

## 1. Qué confirmé y qué corrijo del prompt

**Se confirma:**

- El stack, las piezas y las rutas que nombra el prompt existen y hacen lo que dice.
- Los ejercicios de un plan publicado **no se pueden editar**: `patient_exercises_guard` rechaza cambios si el plan no está en borrador, y cada republicación es una versión nueva. Una especificación guardada en el ejercicio queda congelada con la versión que vio la familia, sin trabajo extra.
- La lectura en voz alta ya existe (`useSpeech` en `portal.practicar.$exerciseId.tsx`), solo con voces del aparato.
- `practiceSuggest.ts` ya sugiere el formato desde la ficha, con el «por qué».
- `ADAPTATIONS` ya tiene `sin_pantallas`: si el profesional la marca, los formatos interactivos se deshabilitan.

**Correcciones al prompt:**

| Tema | Lo que dice el prompt | Lo que hay en el repo | Ajuste |
|---|---|---|---|
| Recursos visuales | Ilustraciones propias más íconos | **No hay ninguna ilustración**: solo `lucide-react` y un ícono propio (`FinishFlag`). Lucide tiene animales comunes, espacio y objetos, pero no dinosaurios, piratas ni personajes. | En el MVP, las mecánicas no dependen de imágenes: poesía y rima son de texto con voz, y memoria funciona con palabras y, cuando hay, con íconos. Las ilustraciones quedan como pedido aparte. |
| «Jugó» y «terminó» (D4) | Registrar las dos cosas | `exercise_practice_logs` admite **una práctica por ejercicio y por día** y es lo que alimenta medallas y constancia | **Terminar el juego no anota nada solo**: muestra el «Ya lo hicimos» de siempre (y después «¿Cómo te fue?»). «Jugó» no se guarda en el servidor; el avance queda solo en el aparato. **No hace falta ningún dato nuevo.** |
| Borradores de IA | Registrar cada generación | `ai_drafts.kind` acepta solo `adaptacion` y `devolucion`, y el trigger exige `adaptacion` para enlazar un ejercicio | La actividad viaja en el mismo borrador `adaptacion`. Regenerar una pieza suelta usa un `kind` nuevo (`actividad_pieza`): el script 33 amplía ese CHECK. |
| Pedido a la IA | — | Hoy un pedido toma de 1 a 4 ejercicios del catálogo | En formatos interactivos, **1 ejercicio del catálogo por pedido = 1 actividad**. Es más barato y entra cómodo en los 25 s. |
| Idea libre | — | `AiDraftRequest` no tiene ningún campo de texto libre; todo son listas cerradas | Es lo único nuevo que viaja al proveedor. Necesita revisión de datos personales en el servidor (y en el panel, para avisar antes de enviar). |
| Sin versión interactiva de 2 a 5 años (D2) | — | `audience` = `infancia` cubre de 2 a 8 años | El corte va por **edad** (el servidor la tiene), no por audiencia. |
| Revisión del texto | Lint de frases | `lintPracticeText`, «Lo dejo así» (`lint_overrides`) y `edit_ratio` miran solo los campos del ejercicio | Hay que sumarles los textos de la actividad. |
| Modo mock | Replicar | `mockPortal.ts` tiene unas 5500 líneas y ya simula la IA con `mockDraft` | Hay que sumar la columna nueva, un `mockActivity` por mecánica y la lectura en el portal. Es un costo real en cada fase. |

**Archivos de Matías:** ninguno. `portalClinicalRules.ts` (el flag), `mockPortal.ts`, `PortalPracticePlan.tsx`, `practice.ts`, `aiDraftRules.ts` y las rutas del portal son nuestros. `admin.tsx` no se toca.

## 2. Contrato: `src/lib/activitySpec.ts`

Es puro, sin alias de imports y con Zod. Lo usan el servidor, el panel, el portal, el mock, el banco de prueba y las pruebas.

```ts
export const SPEC_VERSION = 1;
export const MECHANICS = ["poesia", "rima", "memoria", "tarjetas", "historia", "aventura"] as const;

type Base = { v: 1; titulo: string; tema: ThemeId };   // tema: lista cerrada de activityAssets

type Poesia   = Base & { mecanica: "poesia";
  esquema: "AABB" | "ABAB" | "ABCB" | "libre"; rima: "consonante" | "asonante";
  palmas: boolean;                                      // marcas de ritmo, si el profesional lo pide
  estrofas: { versos: string[]; icono?: IconId }[] };   // 1 a 4 estrofas, 2 a 4 versos

type Rima     = Base & { mecanica: "rima";
  tarjetas: { verso: string; respuesta: string; opciones: string[]; icono?: IconId }[] };  // el hueco es «___»

type Memoria  = Base & { mecanica: "memoria";
  pares: { a: Carta; b: Carta; consigna?: string }[] };  // Carta = { texto } | { icono }

type Tarjetas = Base & { mecanica: "tarjetas"; situacion: string; consignas: string[] };

type Historia = Base & { mecanica: "historia"; inicio: string;
  escenas: Record<string, { texto: string; consigna?: string; opciones: { texto: string; va_a: string }[] }> };
  // una escena sin opciones es un final

type Aventura = Base & { mecanica: "aventura"; marco: string; objetivo: string;
  estaciones: { nombre: string; icono?: IconId; pieza: Poesia | Rima | Memoria | Tarjetas | Historia }[] };  // de 2 a 4, un solo nivel

export type ActivitySpec = Poesia | Rima | Memoria | Tarjetas | Historia | Aventura;
```

- `v` en cada especificación y una función `migrateSpec(raw)` que lleva cualquier versión vieja a la actual antes de validar. Un publicado viejo siempre se puede abrir.
- Los límites (cantidades y largos) van en un `ACTIVITY_LIMITS` en el mismo archivo, compartido con el esquema JSON del proveedor.
- La aventura compone solo un nivel: una estación no puede ser otra aventura.

## 3. Registro de mecánicas

En dos partes, para que el servidor no importe React:

- **`src/lib/activityMechanics.ts`** (puro): por mecánica, `schema` (Zod), `jsonSchema(params)` para el proveedor, `check(spec)` con los chequeos deterministas, `texts(spec)` (todos los textos con su ruta, para el lint, «Lo dejo así», `edit_ratio` y la versión sin pantalla), `minAge`, el formato al que pertenece (`poesia` → `poesia`/`rima`; `minijuego` → el resto) y `finished(state)`.
- **`src/components/activity/registry.tsx`**: mecánica → componente.

Una mecánica nueva se suma con una entrada en cada uno y su componente.

**Chequeo de rima** (`src/lib/rhymeEs.ts`, puro): busca la vocal tónica con las reglas de acentuación (tilde; si no hay, llana cuando termina en vocal, n o s, y aguda en el resto) y separa diptongos, hiatos y vocales débiles. Desde esa vocal saca la terminación consonante y la asonante (vocales sin las débiles de los diptongos). Lleva pruebas con agudas, graves, esdrújulas, diptongos, hiatos con tilde y monosílabos.

## 4. Dónde se guarda

Script **`33_portal_actividades.sql`** más su migración gemela:

```sql
ALTER TABLE public.patient_exercises
  ADD COLUMN IF NOT EXISTS activity JSONB
  CHECK (activity IS NULL OR (jsonb_typeof(activity) = 'object' AND octet_length(activity::text) <= 24000));
-- ai_drafts.kind: + 'actividad_pieza' (drop/add del CHECK, idempotente)
-- SELECT de verificación
```

- **Una sola columna, no una tabla hija.** La actividad es parte del ejercicio: se versiona, se congela, se quita y se publica con él, y `patient_exercises_guard` ya hace todo eso. Una tabla hija duplicaría el guard, el orden de bloqueo de `practice_publish_plan` y el traslado entre versiones.
- La validación de verdad (Zod más `check`) la hace el servidor en `saveDraft`. La base solo pone el piso: que sea un objeto y el tope de tamaño.
- Los pasos del ejercicio siguen siendo obligatorios y son la **versión sin pantalla**. Si un ejercicio tiene actividad, la familia elige entre «Jugar en el celular» y «Sin pantalla».

## 5. Integración

**Servidor**

- `ExerciseInput` y `validateExerciseInput` (`practiceRules.ts`) suman `activity: ActivitySpec | null`. `saveDraft` la valida, la corta por edad y por `sin_pantallas`, y suma sus textos a los avisos del lint.
- `EX_COLS`, `StaffExerciseDTO` y `PracticeExerciseDTO.exercise` suman `activity`. La familia la recibe solo con el flag `activities` prendido; si no, llega `null` y ve la pantalla de hoy.
- `editRatios` compara también los textos de la actividad.
- IA: `FORMAT_PROMPT` y `buildAdaptParams` suman `mecanica`, `idea` (revisada contra datos personales) y los parámetros de la poesía (esquema, versos, sonidos). La respuesta es el ejercicio de siempre más `actividad`, con el esquema de esa mecánica. `check` falla → se repara la pieza (un reintento) → si sigue fallando, la pieza vuelve marcada. `PROMPT_VERSION` pasa a v7.
- `CLINICAL_FEATURES` (`portalClinicalRules.ts`) suma `activities`.

**Panel** (`PortalPracticePlan.tsx`)

- En `AiDialog`, al elegir «Minijuego» o «Poesía o rima» aparecen la mecánica (o «Que la elija la IA», recién en la fase 4), el campo «Describí la idea» y las opciones de la poesía.
- En `ExerciseCard`, si hay actividad: la vista previa en un marco de celular (el mismo componente que la familia), la edición pieza por pieza y «Regenerar esta pieza».
- **Sin IA también se puede** (fase 1): «Convertir en poesía interactiva» toma una poesía pegada o escrita por el profesional y la parte en estrofas y versos; las tarjetas de rima se cargan a mano.

**Portal** (`portal.practicar.$exerciseId.tsx`)

- Si `exercise.activity` existe, aparece arriba un selector «Jugar en el celular» / «Sin pantalla» (los pasos de hoy).
- `<Activity spec mode="portal" screenMode>` en `src/components/activity/`, con los estilos del portal (`components/portal/styles.ts`) para que se vea igual en la vista previa del panel.
- Al terminar, el «Ya lo hicimos» de siempre, con su festejo y sus medallas. El avance va al `localStorage` del aparato (con try/catch) para «seguir otro día».

**Motor:** `src/lib/activityEngine.ts` (puro) tiene un reducer con estados `listo → jugando ⇄ pausado → pieza_terminada → terminado` y eventos que se ignoran si no corresponden. Así la prueba de que se puede terminar corre en `bun test` sin navegador.

## 6. Fases ajustadas

| Fase | Entrega | Base de datos |
|---|---|---|
| **1** | Contrato, registro, motor, chequeo de rima, mecánicas `poesia` y `rima`, vista previa en el panel y juego en el portal. Carga **manual** (convertir una poesía escrita en interactiva y tarjetas de rima a mano), modo mock y pruebas. | Script 33 (te pido OK antes de correrlo) |
| **2** | La IA genera `poesia` y `rima`: idea libre con revisión de datos personales, reparación por pieza, «Regenerar esta pieza» y banco de prueba (gasta crédito: OK antes). | — |
| **3** | `memoria`, `tarjetas` e `historia`, con su carga manual y su generación | — |
| **4** | `aventura` (plan en dos pasos, mapa) y «Que la elija la IA» | — |
| **5** | Duplicar y guardar como modelo | Puede necesitar una tabla de modelos |

La fase 1 ya sirve sola: el profesional puede volver interactiva una poesía propia sin depender de la IA, y el motor se prueba de punta a punta antes de gastar en generación.

## 7. Qué necesito para arrancar la fase 1

1. Tu OK a este diseño: una columna `activity` en `patient_exercises`, terminar el juego = ofrecer «Ya lo hicimos» y carga manual en la fase 1.
2. Las decisiones D1 a D5 siguen como supuestos. La fase 1 va detrás del flag `activities` y no cambia nada en producción mientras siga apagado.
