-- Copiar y ejecutar este script en el SQL Editor de Supabase.
-- Crea el mecanismo de keepalive para evitar que el proyecto Free se pause por inactividad.
-- Es idempotente: se puede ejecutar varias veces sin efectos secundarios.

create schema if not exists api;

create table if not exists api.supabase_keepalive (
  id smallint primary key default 1,
  last_ping timestamptz not null default now(),
  ping_count bigint not null default 0,
  constraint supabase_keepalive_singleton check (id = 1)
);

insert into api.supabase_keepalive (id) values (1)
on conflict (id) do nothing;

create or replace function api.keepalive()
returns json
language plpgsql
security invoker
set search_path = api, pg_temp
as $$
declare
  v_now timestamptz := now();
begin
  insert into api.supabase_keepalive (id, last_ping, ping_count)
  values (1, v_now, 1)
  on conflict (id) do update
    set last_ping = excluded.last_ping,
        ping_count = api.supabase_keepalive.ping_count + 1;

  return json_build_object('ok', true, 'timestamp', v_now);
end;
$$;

revoke all on function api.keepalive() from public;

grant usage on schema api to anon, authenticated;
grant execute on function api.keepalive() to anon, authenticated;
grant select, insert, update on table api.supabase_keepalive to anon, authenticated;

-- Para que el endpoint RPC quede expuesto via PostgREST, el schema "api" debe estar
-- agregado en: Supabase Dashboard -> Project Settings -> API -> "Exposed schemas".
-- Agregar "api" a la lista (junto con "public") y guardar.

-- Prueba manual:
-- select api.keepalive();
