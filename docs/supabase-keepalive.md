# Supabase Keepalive

Mecanismo independiente del stack para evitar que el proyecto Supabase Free
se pause por inactividad.

## Qué se agregó

- **Migración SQL** (`supabase/migrations/20260506100000_supabase_keepalive.sql`,
  copia plana en `supabase/sql_para_copiar/5_supabase_keepalive.sql`):
  - Schema dedicado `api`.
  - Tabla `api.supabase_keepalive` (singleton, una sola fila id=1).
  - Función `api.keepalive()` con `security invoker` y `search_path` fijado.
    Hace un upsert inofensivo y devuelve `{ ok: true, timestamp: ... }`.
  - Permisos mínimos (`anon`, `authenticated`); no toca tablas del negocio.
  - Idempotente: se puede aplicar múltiples veces.
- **GitHub Action** (`.github/workflows/supabase-keepalive.yml`):
  programada cada 12h (06:00 y 18:00 UTC) + ejecución manual.
  Llama al endpoint RPC dedicado, no a endpoints de negocio.

## Setup (una sola vez)

1. **Aplicar la migración** en Supabase:
   - Opción A: `supabase db push` si usás la CLI.
   - Opción B: copiar `supabase/sql_para_copiar/5_supabase_keepalive.sql`
     en el SQL Editor del Dashboard y ejecutarlo.

2. **Exponer el schema `api`** en PostgREST:
   - Dashboard → Project Settings → API → "Exposed schemas".
   - Agregar `api` a la lista (junto con `public`) y guardar.

3. **Cargar los secrets en GitHub**:
   - Repo → Settings → Secrets and variables → Actions → New repository secret.
   - `SUPABASE_PROJECT_URL`: por ej. `https://xxxx.supabase.co` (sin `/` final).
   - `SUPABASE_ANON_KEY`: la `anon` public key del proyecto
     (Dashboard → Project Settings → API → Project API keys).

   Se usa la `anon key` (no la `service_role`) porque la función está pensada
   para ejecución pública con privilegios mínimos. Nunca commitear keys.

## Probar manualmente

- En SQL Editor:
  ```sql
  select api.keepalive();
  select * from api.supabase_keepalive;
  ```
- Vía RPC con curl:
  ```bash
  curl -X POST "$SUPABASE_PROJECT_URL/rest/v1/rpc/keepalive" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept-Profile: api" \
    -H "Content-Profile: api" \
    -d '{}'
  ```
- Disparar el workflow a mano: GitHub → Actions → "Supabase Keepalive" → Run workflow.

## Ajustar o desactivar

- Cambiar la frecuencia: editar el `cron` en
  `.github/workflows/supabase-keepalive.yml`. Mínimo recomendado: una vez cada 48h.
- Desactivar temporalmente: GitHub → Actions → "Supabase Keepalive" → Disable workflow.
- Desactivar definitivamente: borrar el archivo del workflow.

## Por qué

Los proyectos en el plan Free de Supabase se pausan tras ~7 días sin
actividad. Este mecanismo hace un write trivial sobre una tabla aislada para
mantener el proyecto activo, sin acoplarse a tablas de negocio ni al stack
de la app.
