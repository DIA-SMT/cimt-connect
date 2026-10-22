# Prompt — Actividades interactivas en el portal CIMT

> **Nota (octubre 2026).** Este es el prompt original de la fase 1. Después se sumaron el globo de la voz suave, leer con la tortuga y «Me grabo» (grabaciones que escucha el profesional; script 38, etapa `recordings`), que acá figuraban fuera de alcance. Lo vigente está en el código (`src/lib/activitySpec.ts`, `src/lib/recordingRules.ts`) y en `supabase/sql_para_copiar/README.md`.

Minijuegos, ejercicios, poesías y rimas que se juegan de verdad, para el profesional que los crea y para la familia o el paciente que los usa.

> **Cómo usarlo.** Pegalo completo al empezar la sesión. El agente trabaja **una fase por vez** (sección 12), se detiene al terminar cada una con un informe corto y espera el OK antes de seguir. Antes de la fase 1 tienen que estar respondidas las decisiones de la sección 3 (o aceptados los supuestos que trae).

---

## 1. Contexto real del proyecto

CIMT es un centro dedicado exclusivamente a la tartamudez. Trabajamos en el **portal de pacientes y familias** de `cimt-connect`. El resto del sistema lo lidera Matías: cualquier cambio en sus archivos tiene que ser mínimo y quedar avisado.

Stack (no supongas otro):

- TanStack Start + React 19 + Tailwind 4, rutas en `src/routes/`.
- Servidor Nitro en `server/api/` (portal: `server/api/portal/`, panel: `server/api/portal-staff/`).
- Supabase con RLS. El esquema se crea con scripts numerados en `supabase/sql_para_copiar/` (el último es el 32) y cada uno tiene una migración gemela en `supabase/migrations/`. Todo cambio de esquema se replica en el modo mock (`src/integrations/supabase/mockClient.ts` / `mockPortal.ts`).
- IA: OpenRouter con `openai/gpt-4o-mini` (`server/lib/openrouter.ts`, `draftModel`/`draftApiKey` en `src/lib/aiDraftRules.ts`), esquema `json_schema` estricto armado por pedido y Zod.
- Pruebas con `bun test` en `tests/`, `bun run typecheck`, `bun run lint`.
- Las etapas clínicas del portal se prenden con `PORTAL_CLINICAL_FEATURES` (hoy: `consent,info,hc_digital,practice,ai`).

Lo que ya existe y hay que **reutilizar, no duplicar**:

| Pieza | Dónde |
|---|---|
| Catálogo aprobado de ejercicios (enfoques, edades, «para qué», «si cuesta», «para el adulto») | `src/lib/exerciseCatalog.ts`, tipos en `src/lib/practiceRules.ts` |
| Borradores con IA: parámetros cerrados, prompt, esquema por pedido, lint de frases, `PROMPT_VERSION` | `src/lib/aiDraftRules.ts`, `server/lib/aiDrafts.ts`, `server/api/portal-staff/ai-draft.ts` |
| Formatos actuales `ejercicio` / `minijuego` / `poesia` (hoy salen como **pasos de texto**) | `FORMATS` en `aiDraftRules.ts` |
| Plan de práctica del profesional: editor, «Lo revisé», publicar | `src/components/admin/portal/PortalPracticePlan.tsx`, `server/api/portal-staff/practice.ts` |
| Tablas: `ai_drafts`, `patient_exercise_plans`, `patient_exercises`, `exercise_practice_logs`, `patient_medals`… | `supabase/sql_para_copiar/26_portal_practica.sql` |
| Intereses del paciente | `32_intereses_paciente.sql` |
| Pantalla de práctica de la familia (pasos, temporizador opcional, lectura en voz alta con `speechSynthesis`, registro de práctica) | `src/routes/portal.practicar.$exerciseId.tsx`, `src/components/portal/PracticeParts.tsx` |
| Festejo y medallas (premian practicar, nunca la fluidez) | `src/components/portal/Celebration.tsx` |
| Banco de prueba de la IA (300 casos sintéticos, no corre en CI) | `scripts/ai-eval.ts` |

## 2. El problema que hay que resolver

Cuando el profesional elige «minijuego» o «poesía», la IA devuelve **un texto que describe** el juego, y la familia lee pasos. Queremos que el resultado sea una **actividad que se juega en el portal**, sin dejar de lado lo que ya funciona: catálogo aprobado, borrador que revisa el profesional y nada de presión sobre el habla.

La solución es de arquitectura. La IA genera una **especificación estructurada** (datos) para mecánicas que el portal ya sabe ejecutar; un motor propio la valida y la ejecuta. La IA nunca genera código.

## 3. Decisiones previas (bloqueantes)

Las tiene que confirmar el centro (fonoaudiología). Si no están confirmadas, implementá con el **supuesto** indicado, detrás de un flag nuevo, sin prenderlo.

| # | Decisión | Supuesto si no hay respuesta |
|---|---|---|
| D1 | ¿La IA crea actividades libres o parte del catálogo? | **El catálogo pone el marco terapéutico, la IA el contenido.** Cada actividad se ancla a un ejercicio o enfoque del catálogo: «para qué», «si cuesta» y «para el adulto» salen de ahí. La IA genera el contenido del juego (versos, palabras, tarjetas, historia) dentro de una mecánica. El profesional puede sumar una idea libre («astronautas», «que aparezca su perro»). |
| D2 | Pantallas: el catálogo dice «sin pantallas» | La actividad interactiva es **un complemento, no un reemplazo**: cada una tiene también su versión sin pantalla (los pasos de siempre). Hasta los 8 años se juega **siempre con un adulto**. Para 2 a 5 años no hay versión interactiva en el MVP. |
| D3 | ¿Quién juega? | Por defecto, el adulto y el chico juntos. El modo «solo» queda para 13 años o más y lo elige el profesional. |
| D4 | ¿Qué se registra del juego? | Solo «jugó» y «terminó», en `exercise_practice_logs`, como la práctica de hoy. Ni aciertos, ni tiempos, ni puntajes, ni nada sobre cómo habló. |
| D5 | Audio | Sin grabaciones, por ahora no hay audio de menores. Lectura en voz alta con la síntesis del navegador (no sale nada del dispositivo). |

## 4. Reglas clínicas y de tono (no negociables)

- Nada de presión sobre la fluidez: no aparecen «hablar bien», «sin trabarse», «más rápido», «correcto/incorrecto» sobre el habla. Se valora participar, animarse y practicar.
- Sin cronómetros obligatorios, sin vidas, sin perder, sin rankings. Siempre se puede pausar, saltear y «seguir otro día».
- Las mecánicas con respuesta (rima, memoria) evalúan el **lenguaje o el juego**, nunca el habla. Si la respuesta no es la esperada, se ofrece otra vez con una pista, sin marca roja ni sonido de error.
- Las consignas para hablar en voz alta (contar, decir juntos) no tienen respuesta correcta y no se verifican.
- No se fuerzan técnicas de habla que el profesional no indicó. «Despacio» solo en los enfoques que ya lo admiten.
- Español rioplatense con vos, frases cortas y sin emojis, con las mismas reglas de texto que `exerciseCatalog.ts` y el mismo lint (`lintPracticeText`).
- La IA nunca nombra diagnósticos (regla vigente desde `PROMPT_VERSION` v4).

## 5. Arquitectura

```
Profesional ─► parámetros cerrados + idea libre
           ─► servidor: arma el pedido (sin datos del paciente) ─► OpenRouter (json_schema estricto)
           ─► validación: Zod + reglas por mecánica + lint + chequeos deterministas
           ─► reparación de la pieza que falló (1 reintento)  ─► borrador en ai_drafts
           ─► editor del profesional (vista previa con el MISMO motor) ─► «Lo revisé» ─► publicar en el plan
Familia    ─► portal: el motor ejecuta la especificación publicada (sin llamar a la IA)
```

Piezas nuevas, con nombres orientativos (adaptalos a las convenciones del repo):

1. **`src/lib/activitySpec.ts`, contrato.** Unión discriminada por `mecanica` con versión (`spec_version`). Para cada mecánica: esquema Zod, esquema JSON para el proveedor, límites (largos, cantidades), condición de fin y migración entre versiones. Puro y sin alias de imports, porque lo usan el servidor, el panel, el portal, el mock y las pruebas.
2. **Registro de mecánicas.** Un mapa `mecanica → { schema, jsonSchema, validar, componente, edades, enfoques, conAdulto }`. Agregar una mecánica nueva es agregar una entrada, sin tocar el motor.
3. **Validador independiente del modelo.** Además de Zod: chequeos deterministas por mecánica (sección 7), referencias a recursos que existan, que se pueda terminar y que no haya estados imposibles.
4. **Motor de ejecución (React).** Una máquina de estados chica (`listo → jugando → pieza_activa → pieza_terminada → terminado`, más `pausado`), con eventos validados: un evento que no corresponde al estado se ignora. Un componente `<Activity spec=… mode="preview"|"portal" />` elige el componente de cada mecánica según el registro.
5. **Catálogo de recursos visuales** (`src/lib/activityAssets.ts`). La IA elige recursos **por id** de una lista cerrada que viaja en el esquema (`enum`), nunca URLs. Para el MVP: íconos de `lucide-react` e ilustraciones simples propias, más temas de color por escenario (espacio, mar, selva, ciudad…). Si un id no existe, se usa uno genérico y se registra el faltante. Queda preparado para sumar ilustraciones o imágenes generadas más adelante, sin que sean una dependencia.

Prohibido: `eval`, `new Function`, `dangerouslySetInnerHTML` con texto del modelo, URLs que vengan del modelo y cualquier forma de ejecutar lo que devuelve la IA.

**Sin Phaser en este alcance.** Todo se resuelve con React, SVG y CSS (transiciones con `prefers-reduced-motion`). Phaser entra solo si en el futuro hay arte (sprites, fondos) y una mecánica que lo necesite de verdad (movimiento libre, colisiones).

## 6. Mecánicas del MVP

Cada una tiene su versión sin pantalla (los pasos del catálogo adaptados) y su condición de fin explícita.

| Mecánica | Qué es | Qué genera la IA | Fin |
|---|---|---|---|
| `poesia` | Leer o decir juntos una poesía corta, verso a verso, con el verso actual resaltado, lectura en voz alta opcional y marcas de ritmo (palmas) si el profesional lo pide | Título, estrofas y versos, dibujo por estrofa (id), consigna para el adulto | Llegar al último verso (se puede volver atrás) |
| `rima` | Elegir entre 2 y 4 opciones la palabra que rima o completa el verso | Pares verso/palabra, distractores que **no** riman, dibujos (ids) | Pasar por todas las tarjetas (con pista si no sale) |
| `memoria` | Dar vuelta tarjetas y encontrar pares (dibujo-palabra o palabras que riman). Al encontrar un par aparece una consigna para decir o contar | Pares, consigna corta por par | Todos los pares encontrados |
| `tarjetas_para_contar` | Mazo de consignas para hablar por turnos («Contá qué harías si…»), con dado o ruleta, para situaciones cotidianas | Consignas por situación y edad | Recorrer el mazo o cortar cuando quieran |
| `historia` | Historia con decisiones: en cada escena se elige entre 2 o 3 caminos y aparece una consigna para contar en voz alta | Escenas, opciones, finales (todos buenos), dibujos (ids) | Llegar a cualquier final |
| `aventura` | Composición: un mapa con 2 a 4 estaciones (planetas, islas…), cada una con una de las mecánicas anteriores, y un objetivo que se completa al recorrerlas («juntar las piezas de la nave») | Nombre, historia marco, escenario (tema), estaciones con su mecánica y contenido | Completar todas las estaciones |

Si el profesional pide algo que ninguna mecánica cubre (por ejemplo «que el personaje camine por el mapa»), el sistema **lo dice** y ofrece la mecánica más cercana. Nunca lo simula.

## 7. Generación con IA (gpt-4o-mini vía OpenRouter)

- **Generación en dos pasos, para que el esquema no crezca sin control.** (1) *Plan*: qué mecánica va en cada pieza o estación, con un esquema chico y cerrado. (2) *Contenido*: un pedido por pieza, con el esquema de esa mecánica, en paralelo y con el plazo total que ya usa `generateAdaptDraft`. En una actividad de una sola mecánica, el paso 1 lo resuelve el servidor sin IA.
- **Qué viaja al proveedor:** lo mismo que hoy (listas cerradas, franja de edad, texto aprobado del catálogo) más la **idea libre** del profesional, tratada como dato y no como instrucción. Antes de mandarla se revisa contra nombres propios, DNI, teléfonos, escuelas y fechas; si aparece algo así, se le pide al profesional que lo saque. Nunca viajan nombre, edad exacta, diagnóstico ni notas.
- **Intereses:** los del paciente (script 32) se pueden sugerir como temática; el profesional elige cuáles viajan.
- **Chequeos deterministas por mecánica:**
  - `poesia` y `rima`: la rima se verifica en el código comparando la terminación de cada verso desde la última vocal tónica (rima consonante o asonante, según lo pedido), con el esquema de rima pedido (AABB, ABAB, ABCB), la cantidad de versos y estrofas, el largo por verso según la franja de edad y sin palabras repetidas como final de rima. Si falla, se regenera **solo** la estrofa o el par que falló.
  - `rima`: los distractores no riman con la respuesta.
  - `memoria`: pares únicos y sin duplicados.
  - `historia`: todas las escenas se pueden alcanzar, todas las ramas llegan a un final y no hay ciclos.
  - Todas: largos máximos, ids de recursos válidos y lint de frases.
- **Sonidos de interés:** si el profesional marca sonidos o palabras, la IA los incluye con naturalidad y el validador cuenta cuántas veces aparecen. No se arman trabalenguas ni seguidillas de sonidos difíciles (regla vigente del formato `poesia`).
- **Reintentos:** uno por pieza, dentro del plazo total. Si no alcanza, el borrador vuelve con la pieza marcada «no se pudo generar» para que el profesional la regenere o la escriba a mano. **Nunca se presenta una actividad incompleta como lista.**
- **Costos:** se usan el tope diario del centro y el límite por persona que ya existen, y se registran tokens, costo y latencia en `ai_drafts`. Sube `PROMPT_VERSION` y se suma `ACTIVITY_PROMPT_VERSION`. No se cambia de modelo sin evidencia del banco de prueba.

## 8. Experiencia del profesional

Dentro del plan de práctica (`PortalPracticePlan.tsx`), no en una pantalla aparte:

1. **«Crear actividad»**: un campo grande «Describí la actividad que querés crear…» y, debajo, chips opcionales precargados desde la ficha: enfoque, franja de edad, mecánica (o «Que la elija la IA»), temática o intereses, cantidad de piezas, sonidos de interés, «leer en voz alta», con adulto o solo. El profesional no necesita saber los nombres técnicos de las mecánicas.
2. **Vista previa jugable** en un marco del tamaño de un celular, con el mismo componente que verá la familia. Se puede jugar entera.
3. **Edición pieza por pieza, sobre la vista previa:** cambiar un verso, una tarjeta, una opción o un dibujo, con validación en vivo. Si un verso editado deja de rimar, aparece un aviso que no bloquea. También se puede **regenerar una sola pieza** sin rehacer todo.
4. **«Lo revisé» → publicar**, igual que hoy: nada llega a la familia sin la revisión del profesional.
5. **Duplicar** una actividad para otro paciente, y **guardarla como modelo propio** para reutilizarla (en una fase posterior).
6. Errores claros y recuperables: «No pudimos armar la estrofa 2. Regenerala o escribila».

## 9. Experiencia de la familia y del paciente

En `portal.practicar.$exerciseId.tsx`, sin romper lo que ya existe:

- Pensado primero para celular: botones grandes, una cosa por pantalla y que se pueda jugar con una sola mano.
- Antes de empezar, un recuadro «Para el adulto que acompaña» (del catálogo), y un botón para ver la **versión sin pantalla**.
- Lectura en voz alta de consignas y versos (`speechSynthesis`, ya existe). Para los que todavía no leen, todo con dibujo y voz.
- Pausa, «seguir otro día» (se guarda dónde quedó en el dispositivo) y «volver a empezar».
- Al terminar, el festejo de siempre (`Celebration.tsx`) y el registro de práctica habitual. Las medallas siguen premiando practicar.
- Accesibilidad: foco visible, navegable con teclado y lector de pantalla, contraste AA, `prefers-reduced-motion`, sin parpadeos y sin sonidos fuertes ni automáticos.
- La actividad publicada se ejecuta desde lo guardado, **sin volver a llamar a la IA**.

## 10. Persistencia

- La especificación se guarda con el ejercicio del plan, como columnas nuevas en `patient_exercises` (`activity jsonb`, `activity_mechanic`, `activity_spec_version`) o en una tabla hija si te parece más limpio. Justificá la elección en la fase 0.
- Sigue el versionado del plan que ya existe: el borrador y lo publicado son filas distintas, y la familia ve siempre la versión publicada.
- El borrador crudo de la IA queda en `ai_drafts`, como hoy.
- Script nuevo `33_…sql` más su migración gemela: idempotente, sin `DELETE` y con un `SELECT` de verificación al final. Se replica en el mock.
- La lectura del portal es por RLS, solo para el vínculo de ese paciente. No se guarda nada clínico nuevo.

## 11. Calidad y pruebas

- `bun test` para cada mecánica: esquema, chequeos deterministas (incluido el detector de rima, con casos de rima consonante y asonante, esdrújulas, agudas y diptongos), máquina de estados (eventos inválidos ignorados) y migraciones de versión.
- **Prueba de que se puede terminar:** para cada mecánica, un recorrido automático que juega una especificación válida de principio a fin y llega a `terminado`. Que algo se renderice sin errores no alcanza.
- Pruebas del servidor: errores del proveedor, JSON inválido, recurso inexistente, mecánica no disponible, idea libre con datos personales y permisos por rol.
- Extender `scripts/ai-eval.ts` con al menos 40 pedidos de actividades: las ocho solicitudes de ejemplo de abajo y variantes por edad y enfoque. Mide el porcentaje de especificaciones válidas al primer intento y después de reparar, rimas que pasan el chequeo, latencia y costo, y deja una muestra para que las fonos la revisen a mano (originalidad, naturalidad y adecuación a la edad).
- Antes de cerrar cada fase: `bun run typecheck`, `bun run lint` sobre lo tocado y `bun test`. Además, verificar en el navegador (modo mock en :5174) la vista previa del panel y la pantalla de la familia, en celular y en escritorio.

Solicitudes de ejemplo que el sistema tiene que resolver (o decir con claridad qué parte no puede):

1. «Una poesía de cuatro estrofas sobre dinosaurios para decir juntos.»
2. «Un juego de memoria con animales.»
3. «Un desafío de rimas para un chico de ocho años al que le encanta el fútbol.»
4. «Una aventura donde un pirata arma una historia en tres islas.»
5. «Un astronauta que recorre tres planetas y junta las piezas de su nave.»
6. «Tarjetas para practicar pedir cosas en un kiosco, para un adolescente.»
7. «Una historia donde el paciente elige qué hace el personaje.»
8. «Una rima corta con la /p/ para la casa.»

## 12. Fases (una por vez, con informe y OK entre cada una)

- **Fase 0, diagnóstico corto.** Leé solo las piezas de la sección 1 y confirmá o corregí lo que dice este prompt. Proponé el contrato (`activitySpec`), el registro, dónde se guarda y dónde se integra en el panel y en el portal. Listá qué cambia en archivos de Matías (idealmente nada). No escribas código todavía.
- **Fase 1, motor y contrato sin IA.** Contrato, registro, validador, máquina de estados y las mecánicas `poesia` y `rima`, alimentadas con especificaciones escritas a mano. Vista previa en el panel y pantalla de la familia, con pruebas y la prueba de que se pueden terminar. Todo detrás del flag nuevo `activities`: hay que sumarlo a `CLINICAL_FEATURES` en `src/lib/portalClinicalRules.ts` (si no, `parseFeatures` lo descarta) y prenderlo en `PORTAL_CLINICAL_FEATURES`.
- **Fase 2, generación con IA para `poesia` y `rima`.** Pedido, esquema, chequeo de rima, reparación por pieza, registro, idea libre con revisión de datos personales y edición pieza por pieza. Extender el banco de prueba y correrlo (gasta crédito: pedí OK antes).
- **Fase 3, más mecánicas.** `memoria`, `tarjetas_para_contar` e `historia`.
- **Fase 4, `aventura`.** Plan en dos pasos, mapa con estaciones y temas visuales.
- **Fase 5, herramientas del profesional.** Duplicar, guardar como modelo y regenerar una pieza desde la vista publicada.

Fuera de alcance (cada uno necesita su propia decisión): Phaser y personajes que se mueven, grabaciones y cualquier análisis del habla, imágenes generadas con IA y versión interactiva para 2 a 5 años.

## 13. Cómo trabajar

- Rama `Agustin`. Sin commits, push ni scripts en la base sin mi OK.
- Cambios mínimos y avisados en archivos de Matías.
- No presentes como hecho algo que no está implementado y probado. Si una prueba falla, mostrá la salida.
- Cuando una decisión de la sección 3 cambie el diseño, frená y preguntá.

## 14. Criterios de aceptación

1. El profesional describe una actividad en lenguaje natural (más chips opcionales) y obtiene un borrador jugable.
2. La especificación es válida según Zod y los chequeos de su mecánica; si no, se repara la pieza o se marca, nunca se presenta incompleta.
3. Las poesías y las rimas riman de verdad (verificado en el código), son originales y se pueden editar.
4. La vista previa y el portal usan el mismo motor, y cada mecánica se puede terminar (con prueba automática).
5. Nada llega a la familia sin «Lo revisé», y la familia juega sin volver a llamar a la IA.
6. No viajan datos del paciente al proveedor y no se ejecuta nada de lo que devuelve el modelo.
7. Sin puntajes, tiempos ni medidas del habla; solo «jugó» y «terminó».
8. Cada actividad tiene su versión sin pantalla.
9. Agregar una mecánica nueva es agregar una entrada al registro y su componente.
10. Typecheck, lint y pruebas en verde, y verificación en el navegador en celular y escritorio.
