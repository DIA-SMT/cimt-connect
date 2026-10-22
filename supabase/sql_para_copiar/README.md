# Scripts SQL de Supabase

Cada script se corre a mano en Supabase → SQL Editor → New query → Run, en
orden. Todos son idempotentes: si uno se corre dos veces no rompe nada. Los
que tienen copia en `supabase/migrations` son el mismo texto.

Antes de prender una etapa del portal en el servidor (`PORTAL_CLINICAL_FEATURES`)
hay que correr su script: sin la tabla, la etapa queda apagada o falla.

## Base del sistema

| Script | Qué agrega |
|---|---|
| 1 | Schema completo inicial |
| 2 | Profesionales de ejemplo (los quita el 10) |
| 3 | Tabla de pacientes |
| 4 | Datos de ejemplo con pacientes y turnos |
| 5 | Keepalive de Supabase (ver `docs/supabase-keepalive.md`) |
| 6 | Seguridad: login del panel y RLS cerrado |
| 7 | Ficha interna de pacientes |
| 8 | Límites contra abuso (chat, formularios) |
| 9 | Modalidad y localidad |
| 10 | Quita los profesionales de ejemplo |
| 11 | Roles, equipo e historial de cambios |
| 12 | Circuito de turnos |
| 13 | Encuesta de satisfacción |
| 14 | Rincón social |
| 15 | Ficha clínica completa (adultos responsables, historias por área, adjuntos) |
| 16 | Recordatorios de turno |
| 17 | Cierra las funciones del formulario viejo de turnos |
| 21 | Domicilio en la solicitud de turno |
| 27 | Rincón social: personalidades con tartamudez |
| 28 | Solicitud de turno: adulto responsable y consentimiento |
| 29 | Rincón social: historias de pacientes |
| 30 | Hitos en la landing, derivación de solicitudes y foto |
| 31 | Ficha: ingreso, antecedentes, semáforo y contacto |
| 32 | Intereses del paciente |
| 34 | Roles por paciente: cada profesional ve lo suyo |
| 35 | Mi perfil profesional |
| 36 | Horario de atención de cada profesional |
| 37 | Solicitudes en tiempo real |

## Portal de familias

| Script | Qué agrega | Etapa que habilita |
|---|---|---|
| 18 | Cuentas, invitaciones, vínculos y respuestas a turnos | (el portal, con `VITE_PORTAL_ENABLED=true`) |
| 19 | Acceso propio del paciente adulto | |
| 20 | Pedidos de copia de la historia clínica | |
| 22 | Base para información de salud: permisos, verificación, bloqueos | `consent` |
| 23 | «Mi información» (publicaciones del profesional) | `info` |
| 24 | Pedidos de turno | |
| 25 | Copia digital de la historia clínica | `hc_digital` (junto con `consent`) |
| 26 | Ejercicios, devoluciones, metas, medallas y borradores con IA | `practice`, `ai` |
| 33 | Actividades para jugar en el celular (poesía, rima, globo, tortuga) | `activities` (con `practice`) |
| 38 | «Me grabo»: grabaciones de práctica y su bucket | `recordings` (con `practice` y `activities`) |

`PORTAL_CLINICAL_FEATURES` es una lista separada por comas, por ejemplo
`consent,info,practice,ai,hc_digital,activities,recordings`. Las claves que
necesita cada etapa están en `.env.example`.

## Limpiezas

- `LIMPIAR_antes_de_lanzar.sql`: borra **todos** los datos de prueba
  (pacientes, turnos, cuentas del portal…) y deja el equipo y los
  profesionales. Se corre una sola vez, antes del lanzamiento.
- `BORRAR_paciente_de_prueba.sql`: borra **un** paciente de prueba y la
  cuenta del portal de su adulto, por DNI (por ejemplo, después de una
  demostración).

Supabase no deja borrar archivos de Storage desde SQL: los dos scripts dicen
qué carpetas borrar a mano.
