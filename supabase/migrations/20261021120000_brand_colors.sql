-- Brand pass (Oct 2026): player colors are crimson, cobalt, jade, berry, bone, sky;
-- gray stays the neutral seat. Pre-launch, so no existing rows are converted.
-- If a local database still holds games with the old IDs, run `supabase db reset` first.

alter table public.game_seats
  add constraint game_seats_color_check
  check (color in ('crimson', 'cobalt', 'jade', 'berry', 'bone', 'sky', 'gray'));
