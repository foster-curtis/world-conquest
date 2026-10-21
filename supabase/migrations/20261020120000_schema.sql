-- SPEC §6 Data. Game tables are written only by the `game` edge function (service role) through
-- append_events / create_game; clients read `games` / `game_seats` (members only) and their own profile.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  updated_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key,
  mode text not null default 'online' check (mode in ('local', 'online')),
  -- lobby | active (draft, setup, turn) | finished (game_over) | canceled
  status text not null check (status in ('lobby', 'active', 'finished', 'canceled')),
  host_user_id uuid references auth.users (id) on delete set null,
  -- 6 characters, alphabet without look-alikes (SPEC §2 Join code & link)
  join_code text not null check (join_code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  settings jsonb not null,
  phase text not null check (phase in ('lobby', 'draft', 'setup', 'turn', 'game_over', 'canceled')),
  current_seat smallint,
  awaiting_seats smallint[] not null default '{}',
  deadline_at timestamptz,
  last_action_at timestamptz,
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index games_join_code_key on public.games (join_code);
-- cron: expired deadlines on active games, stale lobbies
create index games_active_deadline_idx on public.games (deadline_at) where status = 'active' and deadline_at is not null;
create index games_lobby_updated_idx on public.games (updated_at) where status = 'lobby';

create table public.game_seats (
  game_id uuid not null references public.games (id) on delete cascade,
  seat smallint not null check (seat between 0 and 5),
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null,
  color text not null,
  turn_order smallint,
  kind text not null check (kind in ('human', 'neutral')),
  status text not null check (status in ('active', 'kicked', 'eliminated')),
  consecutive_strikes smallint not null default 0,
  primary key (game_id, seat)
);

create index game_seats_user_idx on public.game_seats (user_id);

create table public.game_events (
  game_id uuid not null references public.games (id) on delete cascade,
  seq integer not null check (seq > 0),
  type text not null,
  payload jsonb not null,
  actor_seat smallint, -- null for the system actor and for JoinGame
  created_at timestamptz not null default now(),
  primary key (game_id, seq)
);

-- One row per game, overwritten on each write; deleted at game end (rebuildable from events).
create table public.game_state (
  game_id uuid primary key references public.games (id) on delete cascade,
  seq integer not null,
  state jsonb not null
);

-- SPEC §6 Notifications: rows only; no sender in v1.
create table public.outbox (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  kind text not null,
  recipient_user_id uuid references auth.users (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index outbox_unsent_idx on public.outbox (id) where sent_at is null;
