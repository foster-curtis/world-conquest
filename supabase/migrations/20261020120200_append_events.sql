-- SPEC §6 Write path: atomic version check + event insert, state overwrite, denormalized `games` columns,
-- `game_seats` sync and the `outbox` row on TurnStarted, all in one transaction. Service role only.

-- Who must act right now (SPEC §6 Data): current seat in a turn, picking seat in draft, every unsubmitted
-- active human in setup, empty otherwise. Computed from the engine state, so it can't drift from it.
create function public.awaiting_seats(p_state jsonb)
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select case p_state -> 'phase' ->> 'kind'
    when 'turn' then array[(p_state -> 'phase' ->> 'seat')::smallint]
    when 'draft' then array[(p_state -> 'phase' ->> 'pickingSeat')::smallint]
    when 'setup' then coalesce((
      select array_agg(k::smallint order by k::smallint)
      from jsonb_object_keys(p_state -> 'phase' -> 'armiesToPlace') as k
      where not ((p_state -> 'phase' -> 'submitted') @> jsonb_build_array(k::int))
        and exists (
          select 1 from jsonb_array_elements(p_state -> 'seats') as s
          where (s ->> 'seat') = k and s ->> 'kind' = 'human' and s ->> 'status' = 'active'
        )
    ), '{}'::smallint[])
    else '{}'::smallint[]
  end;
$$;

create function public.append_events(
  p_game_id uuid,
  p_expected_version integer,
  p_events jsonb,
  p_new_state jsonb,
  p_actor_seat smallint default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_current integer;
  v_count integer := jsonb_array_length(p_events);
  v_version integer := p_expected_version + jsonb_array_length(p_events);
  v_phase jsonb := p_new_state -> 'phase';
  v_kind text := p_new_state -> 'phase' ->> 'kind';
begin
  if v_count = 0 then
    raise exception 'append_events: no events' using errcode = '22023';
  end if;
  if (p_new_state ->> 'version')::integer is distinct from v_version
     or (p_new_state ->> 'gameId') is distinct from p_game_id::text then
    raise exception 'append_events: new_state does not match game/version' using errcode = '22023';
  end if;

  -- Row lock serializes concurrent writers; the loser sees the new version.
  select g.version into v_current from public.games g where g.id = p_game_id for update;
  if not found then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_current <> p_expected_version then
    raise exception 'STALE_VERSION' using errcode = '40001', detail = format('current version %s', v_current);
  end if;

  insert into public.game_events (game_id, seq, type, payload, actor_seat)
  select p_game_id, p_expected_version + e.ord::integer, e.value ->> 'type', e.value, p_actor_seat
  from jsonb_array_elements(p_events) with ordinality as e (value, ord);

  if v_kind in ('game_over', 'canceled') then
    delete from public.game_state where game_id = p_game_id;
  else
    insert into public.game_state (game_id, seq, state)
    values (p_game_id, v_version, p_new_state)
    on conflict (game_id) do update set seq = excluded.seq, state = excluded.state;
  end if;

  update public.games g set
    version = v_version,
    phase = v_kind,
    status = case v_kind
      when 'lobby' then 'lobby'
      when 'game_over' then 'finished'
      when 'canceled' then 'canceled'
      else 'active'
    end,
    settings = p_new_state -> 'settings',
    current_seat = case when v_kind = 'turn' then (v_phase ->> 'seat')::smallint end,
    awaiting_seats = public.awaiting_seats(p_new_state),
    deadline_at = case when v_kind in ('draft', 'setup', 'turn') then (v_phase ->> 'deadlineAt')::timestamptz end,
    last_action_at = case when v_kind = 'turn' then (v_phase ->> 'lastActionAt')::timestamptz end,
    host_user_id = (
      select (s ->> 'userId')::uuid
      from jsonb_array_elements(p_new_state -> 'seats') as s
      where (s ->> 'seat')::smallint = (p_new_state ->> 'hostSeat')::smallint
    ),
    updated_at = now()
  where g.id = p_game_id;

  delete from public.game_seats gs
  where gs.game_id = p_game_id
    and gs.seat not in (select (s ->> 'seat')::smallint from jsonb_array_elements(p_new_state -> 'seats') as s);

  insert into public.game_seats as gs
    (game_id, seat, user_id, display_name, color, turn_order, kind, status, consecutive_strikes)
  select
    p_game_id,
    (s ->> 'seat')::smallint,
    (s ->> 'userId')::uuid,
    s ->> 'displayName',
    s ->> 'color',
    (s ->> 'turnOrder')::smallint,
    s ->> 'kind',
    s ->> 'status',
    (s ->> 'consecutiveStrikes')::smallint
  from jsonb_array_elements(p_new_state -> 'seats') as s
  on conflict (game_id, seat) do update set
    user_id = excluded.user_id,
    display_name = excluded.display_name,
    color = excluded.color,
    turn_order = excluded.turn_order,
    kind = excluded.kind,
    status = excluded.status,
    consecutive_strikes = excluded.consecutive_strikes;

  -- SPEC §6 Notifications: one outbox row per TurnStarted, for a future email sender.
  insert into public.outbox (game_id, kind, recipient_user_id, payload)
  select
    p_game_id,
    'turn_started',
    (
      select (s ->> 'userId')::uuid
      from jsonb_array_elements(p_new_state -> 'seats') as s
      where (s ->> 'seat') = (e.value ->> 'seat')
    ),
    jsonb_build_object(
      'seq', p_expected_version + e.ord::integer,
      'seat', (e.value ->> 'seat')::integer,
      'deadlineAt', e.value -> 'deadlineAt'
    )
  from jsonb_array_elements(p_events) with ordinality as e (value, ord)
  where e.value ->> 'type' = 'TurnStarted';

  return v_version;
end;
$$;

-- Creates the games row and appends the first events (the host's SeatJoined) in one transaction.
-- A join_code collision raises unique_violation (23505); the function retries with a new code.
create function public.create_game(
  p_game_id uuid,
  p_join_code text,
  p_events jsonb,
  p_new_state jsonb,
  p_actor_seat smallint default null
)
returns integer
language plpgsql
set search_path = ''
as $$
begin
  insert into public.games (id, mode, status, join_code, settings, phase, version)
  values (p_game_id, p_new_state -> 'settings' ->> 'mode', 'lobby', p_join_code, p_new_state -> 'settings', 'lobby', 0);
  return public.append_events(p_game_id, 0, p_events, p_new_state, p_actor_seat);
end;
$$;

revoke execute on function public.awaiting_seats(jsonb) from public, anon, authenticated;
revoke execute on function public.append_events(uuid, integer, jsonb, jsonb, smallint) from public, anon, authenticated;
revoke execute on function public.create_game(uuid, text, jsonb, jsonb, smallint) from public, anon, authenticated;
grant execute on function public.awaiting_seats(jsonb) to service_role;
grant execute on function public.append_events(uuid, integer, jsonb, jsonb, smallint) to service_role;
grant execute on function public.create_game(uuid, text, jsonb, jsonb, smallint) to service_role;
