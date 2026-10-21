-- SPEC §6 Security. Clients never read full state or events and never write game tables.
-- Members may SELECT their games' `games` / `game_seats` rows; users read/write only their own profile.

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_seats enable row level security;
alter table public.game_events enable row level security;
alter table public.game_state enable row level security;
alter table public.outbox enable row level security;

-- Supabase's default privileges grant everything to anon/authenticated; take it back explicitly.
revoke all on table public.games, public.game_seats, public.game_events, public.game_state, public.outbox
  from public, anon, authenticated;
revoke all on table public.profiles from public, anon, authenticated;

grant select on table public.games, public.game_seats to authenticated;
grant select, insert, update on table public.profiles to authenticated;

-- Membership check outside RLS, so the game_seats policy doesn't recurse into itself.
create function public.is_game_member(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.game_seats s
    where s.game_id = p_game_id and s.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_game_member(uuid) from public, anon;
grant execute on function public.is_game_member(uuid) to authenticated;

create policy games_select_members on public.games
  for select to authenticated
  using (public.is_game_member(id));

create policy game_seats_select_members on public.game_seats
  for select to authenticated
  using (public.is_game_member(game_id));

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
