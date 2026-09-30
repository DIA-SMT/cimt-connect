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

## GitHub desactiva el workflow si el repo está inactivo

GitHub apaga los workflows programados de repos públicos después de **60 días
sin actividad** en el repo (estado `disabled_inactivity`). Pasó el 5/7/2026:
el último commit había sido el 6/5 y el keepalive dejó de correr.

Para que no vuelva a pasar, el workflow tiene un segundo paso que llama a la
API de GitHub para volver a habilitarse a sí mismo en cada corrida, lo que
reinicia el contador de 60 días sin necesidad de commits. Necesita
`permissions: actions: write` (ya está en el workflow).

Si igual se desactiva (por ejemplo, si cambian los permisos del repo):
GitHub → Actions → "Supabase Keepalive" → **Enable workflow**, y después
**Run workflow** para probarlo.

Para ver el estado sin entrar a GitHub (repo público):

```bash
curl -s https://api.github.com/repos/DIA-SMT/cimt-connect/actions/workflows/supabase-keepalive.yml | grep '"state"'
```

Tiene que decir `"active"`.

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
