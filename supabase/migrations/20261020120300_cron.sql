-- SPEC §3 Timer enforcement and §2 Stale lobbies. Plain SQL picks the games; pg_net calls the `game`
-- function as the `system` actor only for those games, so idle minutes cost no function invocations.
-- The function URL and the system secret come from Vault (`game_function_url`, `game_system_secret`):
-- locally from seed.sql (Docker-network URL), in production set by hand (BUILD_PLAN Final handoff).

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Active games whose deadline (draft pick, setup, async turn) passed more than the 1 s grace ago.
create function public.expired_game_ids()
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select g.id from public.games g
  where g.status = 'active' and g.deadline_at is not null and g.deadline_at + interval '1 second' < now()
  order by g.deadline_at;
$$;

-- Lobbies with no events for 14 days (updated_at moves on every append).
create function public.stale_lobby_ids()
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select g.id from public.games g
  where g.status = 'lobby' and g.updated_at < now() - interval '14 days'
  order by g.updated_at;
$$;

-- Queues one POST {gameId, action} to <game_function_url>/system; returns the pg_net request id.
create function public.call_game_system(p_game_id uuid, p_action text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'game_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'game_system_secret';
  if v_url is null or v_secret is null then
    raise warning 'call_game_system: Vault secrets game_function_url / game_system_secret are missing';
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/system',
    body := jsonb_build_object('gameId', p_game_id, 'action', p_action),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-wc-system-secret', v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;

create function public.cron_claim_timeouts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in select public.expired_game_ids() loop
    perform public.call_game_system(v_id, 'timeout');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create function public.cron_expire_lobbies()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n integer := 0;
begin
  for v_id in select public.stale_lobby_ids() loop
    perform public.call_game_system(v_id, 'expire');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.expired_game_ids() from public, anon, authenticated;
revoke execute on function public.stale_lobby_ids() from public, anon, authenticated;
revoke execute on function public.call_game_system(uuid, text) from public, anon, authenticated;
revoke execute on function public.cron_claim_timeouts() from public, anon, authenticated;
revoke execute on function public.cron_expire_lobbies() from public, anon, authenticated;

select cron.schedule('wc-claim-timeouts', '* * * * *', 'select public.cron_claim_timeouts()');
select cron.schedule('wc-expire-lobbies', '17 3 * * *', 'select public.cron_expire_lobbies()');
