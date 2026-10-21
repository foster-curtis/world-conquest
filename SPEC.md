# Risk-Style Browser Game — Spec

Source of truth for rules, product behavior, and architecture. Types live in `packages/engine/src/types.ts`; if this doc and the types disagree, fix one of them.

Private game for friends. Original name "World Conquest" and map art if ever made public (game mechanics aren't protected; Hasbro's name, board art and card designs are).

---

## 1. Modes

Home screen offers two **completely separate** modes:

|             | Pass-and-play              | Online                            |
| ----------- | -------------------------- | --------------------------------- |
| Devices     | One device, shared         | Each player on their own          |
| Sign-in     | None                       | Required (Supabase Auth)          |
| Engine runs | In the browser (local RNG) | Server edge function (crypto RNG) |
| Persistence | IndexedDB                  | Postgres                          |
| Timers      | None                       | Yes (see §3)                      |

No bots. No mixing modes (no two local players inside an online game).

**Pass-and-play setup:** a local screen where players enter names, pick colors (same color picker and rules as the online lobby; `gray` reserved for neutral), and choose the win condition (`classic` or `capitals`, §2 Settings). No join code, no sign-in.

**Pass-and-play hidden info:** show a "Pass the device to \_\_\_" screen before every turn and before each player's setup turn, so cards and hidden setup placements stay private.

---

## 2. Online lobby

1. Host creates a game → gets a **join code / link**.
2. Players join at any time (lobby may fill asynchronously).
3. Host can edit settings and **remove players** while in the lobby.
4. Host starts the game; **minimum 2 players**, maximum 6.
5. Settings freeze at start.

### Join code & link

- **Code:** 6 characters from an alphabet without look-alikes (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`: no 0/O, 1/I/L), e.g. `K7QM2X`. Unique across all games (unique index on `games.join_code`).
- **One URL for the game's whole life:** `https://world-conquest.fostercurtis.dev/g/K7QM2X`.
  - In lobby, non-members see the join page.
  - Members see the game itself (lobby, then board).
  - After start, non-members see "This game has already started".
- **Signed-out visitors** sign in first, then return to the same URL (the magic-link redirect carries it; the 6-digit code path keeps the current tab).
- **Sharing:** "Copy link", plus the native share sheet (Web Share API) where available.

### Players: names & colors

- **Display name** is per account: a `profiles` row (`user_id`, `display_name`), set on first sign-in and editable anytime. The edge function copies it into the seat on `JoinGame` (a snapshot; later profile edits don't rename seats in existing games), together with the caller's `userId` from auth; neither is trusted from the client.
- **Colors:** on join you get the **first free color** (or the one requested, if free). Anyone can switch to any free color (`ChangeColor`) until the game starts. `gray` is reserved for the neutral seat and can't be picked; the other 6 colors cover a full 6-player game.

### Host leaving, canceling, cleanup

- **Host leaves the lobby:** host passes to the **earliest-joined remaining player** (`HostChanged`). If nobody is left, the lobby is canceled (`GameCanceled`, reason `empty`).
- **Host cancels:** "Cancel game" closes the lobby for everyone (`GameCanceled`, reason `host`).
- **Stale lobbies:** a daily pg_cron job cancels lobbies with no events for **14 days** (`GameCanceled`, reason `expired`, sent as the `system` actor).
- Canceled games stay in the database (phase `canceled`) but are hidden from game lists.

### Resigning (after start)

- `LeaveGame` after the lobby means **Resign**, behind a confirmation dialog. It counts as an **immediate kick** (`SeatKicked`, reason `resigned`): the seat becomes inert, its cards are discarded (§4.6), and the last-standing rule applies (§4.7).
- If it's the resigner's turn: a pending occupy resolves with the minimum, and the turn ends (no card draw).
- During draft or setup: the seat's remaining picks/placements are auto-filled exactly as on timeout.

### Lobby rules

- Lowering `maxSeats` below the current number of joined players → `INVALID_SETTINGS`.
- Joining a full game → `GAME_FULL`.

### Settings

- **Win condition:** `classic` (control every territory) or `capitals`.
- **Pace:** `async` (default) or `sync` (synchronous play required).
- **Territory assignment:** `random` (default) or `draft` — **draft only allowed when pace = sync** (so online only; pass-and-play always deals randomly).
- **Map:** `mapId`, fixed to `classic` in v1 (see §5). Host map choice is a possible future setting, out of scope for v1.

### Presence

Show which players currently have the game open (Supabase Realtime Presence). Ephemeral; not stored.

---

## 3. Timers & pace

| Situation                  | Sync                                       | Async                   |
| -------------------------- | ------------------------------------------ | ----------------------- |
| Draft pick                 | 15 s per pick; timeout → random pick       | n/a (draft not allowed) |
| Setup turn (whole process) | 6 min                                      | 24 h                    |
| Regular turn               | Others may **skip** after 5 min inactivity | 24 h deadline           |

- In sync, the 5-minute rule **replaces** the 24-hour timer.
- "Inactivity" = time since the current player's last action (`lastActionAt`).
- **Setup timeout:** that player's armies are distributed **evenly** across their territories.
- **Turn timeout / skip (auto-play):** force card trade if holding 5+, auto-place reinforcements **evenly across all owned territories**, end turn, +1 strike.
- **Strikes:** 3 **consecutive** skips/timeouts → player is **kicked**. Any real action resets strikes.

### Timer enforcement

- Server stores `deadlineAt` (or `lastActionAt` for sync turns); clients render countdowns from it.
- **Lazy claim:** when a client's countdown hits zero it sends `ClaimTimeout`; server verifies `now() > deadline + 1 s grace`. First claim wins; duplicates rejected by version check.
- **Fallback:** pg_cron runs a **plain SQL check every minute** (`deadline_at + grace < now()` on active games) and calls the edge function via pg_net (as the `system` actor) **only for games with an expired deadline**, so 6-min/24-h deadlines get claimed when nobody is online. Idle minutes cost no edge-function invocations (the free tier has 500K/month; calling every minute would burn ~43K).
- Sync `SkipTurn` is checked server-side on request; no cron.

---

## 4. Game flow

```
LOBBY → TERRITORY_ASSIGNMENT → SETUP → TURN loop → GAME_OVER
  └─→ CANCELED (lobby only: host cancels, lobby empties, or 14-day expiry; §2)
```

### 4.1 Start

Assign turn order (random); shuffle the deck. Colors were already chosen in the lobby (§2). With 2 human players, add a **neutral** seat (always `gray`).

### 4.2 Territory assignment

**Assignment order** = turn order, with the neutral seat (2-player) appended last.

- **Random (default; always used in pass-and-play):** deal territories evenly at random in assignment order. When the count doesn't divide evenly, the **first** seats in assignment order get the extra territories (e.g. 42 territories, 4 players → 11, 11, 10, 10).
- **Draft (online + sync only):** seats pick one territory at a time in assignment order, 15 s per pick, timeout → random pick. The neutral seat takes its slot each round with an immediate random pick (`auto: true`).

### 4.3 Setup (simultaneous, hidden)

- One setup turn, **active for all players at once**.
- Each player places their starting armies (count from the map's `startingArmies` table, §5); submissions lock and stay **hidden from others** until everyone is done (or the timer expires).
- In capitals mode, each player also chooses their capital here.
- Neutral armies are placed by the computer **randomly** (at least 1 per territory).
- When all submitted or timer expires: auto-fill timed-out players (even distribution), then **reveal** all placements and begin turn 1.

### 4.4 Turn

1. **Reinforce**
   - Armies = `max(3, floor(territories / 3))` + continent bonuses + card trades.
   - Must trade if holding **5+** cards at turn start.
   - Must place all reinforcements before attacking.
2. **Attack** (optional, repeatable)
   - Attack an adjacent enemy territory from one with ≥ 2 armies; attacker chooses 1–3 dice (≤ armies − 1).
   - **Defender always rolls the maximum allowed** (computer rolls; defender makes no decision). This applies to humans, neutral, and kicked seats.
   - **Blitz** (`untilConquered`): keep rolling max dice until the territory falls or the attacker is down to 1 army. Each round is logged separately for animation.
   - On conquest: **must occupy** with at least the number of dice rolled in the final battle (max = armies − 1).
   - **Eliminating a player:** take their cards. If that brings your hand to **6+**, you must trade immediately (and place those armies) until you hold ≤ 4, before continuing.
3. **Fortify** (optional, once): move armies along a **connected chain of your own territories**; leave ≥ 1 behind.
4. **End turn:** draw one card if you conquered ≥ 1 territory this turn.

### 4.5 Cards

- Deck: one card per territory (infantry/cavalry/artillery) + 2 wilds.
- Valid sets: three of a kind, one of each, or any two + wild.
- **Escalating values:** 4, 6, 8, 10, 12, 15, then +5 per trade (global counter).
- +2 armies on a traded card's territory if you own it.
- Discard pile reshuffles into the deck when empty.

### 4.6 Inert seats (neutral & kicked)

Neutral (2-player) and kicked players (by strikes or by resigning) are treated the same way:

- No turns, no reinforcements.
- Armies stay on the board; the computer rolls their defense.
- Must be conquered like anyone else.
- **Kicked players' cards are discarded.**

### 4.7 Win conditions

- **Classic:** control every territory (including inert seats' territories).
- **Capitals:** control every capital; a kicked player's capital still must be captured.
- **Last standing (all modes, both win conditions):** the moment only **one human seat is still `active`** (every other human is kicked or eliminated), that human wins (`reason: 'last_standing'`). Neutral and kicked seats' remaining armies don't need to be destroyed. In 2-player games this is the normal way to win.

---

## 5. Map

v1 ships one map, `classic`. The system is **multi-map ready**: engine code never hard-codes territories, and every game records its `mapId` in settings. A published map is **immutable** (event logs reference its territory IDs forever); any change, even a balance tweak, means a new map ID.

### 5.1 Map definition (engine)

`MapDefinition` (in `packages/engine/src/types.ts`) is pure data: `id`, `name`, territories (name, continent, adjacency, card symbol), continents (name, bonus), `startingArmies`. No geometry.

- **IDs** are `snake_case`, unique within a map, permanent. Display names are cosmetic and may change freely.
- **Adjacency is hand-authored and is the source of truth**; never derived from geometry.
- Engine tests validate every map: adjacency symmetric, no self-links, all referenced IDs exist, graph connected, every territory in exactly one existing continent, card symbols present.

### 5.2 Classic map

The source of truth is [`packages/engine/src/maps/classic.ts`](packages/engine/src/maps/classic.ts): 42 territories,
6 continents, 83 borders (the standard layout; `alaska`–`kamchatka` wraps around the map edge), card symbols cycling
infantry → cavalry → artillery in table order (14 of each), and starting armies 40/35/30/25/20 for 2–6 humans (in
2-player games the neutral seat also gets 40). `maps/maps.test.ts` pins these numbers and the continent bonuses.

### 5.3 Map art (web app)

Original art **generated from Natural Earth** (public domain) by a reproducible build script. No hand drawing.

- **Pipeline** (mapshaper + own JS): Natural Earth 1:10m admin-0 countries + admin-1 provinces (used where classic territories split a country: Russia, China, Canada, US, Australia, etc.) → an **assignment table** mapping each country/province to a territory ID, or explicitly to "drop" (Antarctica, Hawaii, minor islands); a rule may also send the piece of a polygon inside a lon/lat box elsewhere (e.g. the Alaska panhandle) → project → dissolve → **warp** → simplify → **stylize** → fit → export.
- **Projection:** Miller, Atlantic-centered, cut in the Bering Strait, so **Alaska–Kamchatka is the only wrap-around link**; cropped at 56°S.
- **Warp (game-board layout):** a declarative, smooth, continuous displacement field (`warp.json`) applied to every projected vertex before topology and the touching checks. It is composed of global steps (latitude-dependent horizontal squeeze and vertical stretch, moving-least-squares control groups, radial lenses), never per-territory transforms, so shared borders stay shared; the build fails if the field folds near land. It shrinks the oceans and high-latitude stretch into a compact board (about 1.25:1 instead of 2.3:1; there is no fixed aspect, the board size follows from the warped land plus margins), enlarges Europe, South America, Australia and small territories toward classic game-board proportions, and pulls Greenland toward Iceland. Each continent stays recognizable.
- **Stylization:** simplification is one default setting, tuned for the **chunky/simplified** look that fits the clean flat style (§7.1), with coarser per-territory overrides where a cleaner silhouette reads better (Australia, Greenland). Then small detached islands are dropped, narrow one-territory water inlets are filled, needle-thin one-territory spikes are cut, and Chaikin smoothing runs on the shared-arc topology: a border is smoothed once, so both sides stay identical, and junctions are relaxed so corners where borders meet round off too.
- **Tappability:** the §5.3 checks fail if any territory's label anchor sits less than 15 board units inside its shape.
- **Outputs (committed, so the app build needs no network):**
  - `board.svg`: one `<path id="{territoryId}">` per territory, grouped by continent.
  - `layout.json`: per-territory label/army-badge anchor (pole of inaccessibility) and sea-link endpoints, plus an optional `via` control point that makes a link a quadratic curve.
- **Sea-link overrides** (`sealinks.json`, an input; outputs are never hand-edited): any link can pin its endpoints (to an anchor, or to the coast point nearest a given lon/lat or board point) and pass through a water point as a curve. Unlisted links join the closest coast points. The build fails if a link crosses land or another link.
- **Small territories:** the fixed-size army badge doubles as the tap target; the warp's lenses still enlarge small islands (Iceland, Great Britain, Japan, Madagascar, Indonesia) so the shapes themselves read clearly.
- **Build-time checks against the map definition:** every territory has exactly one path; every land-touching pair is listed as adjacent; every adjacent pair that *doesn't* touch has a sea link in `layout.json`.

### 5.4 Sea links

- Drawn **always visible** as subtle dashed lines between territories.
- **Alaska–Kamchatka** is drawn as two short stubs running off the left and right edges, each ending in a chevron; selecting/highlighting either end highlights both stubs.
- Selecting a territory always highlights its valid targets, so links are never ambiguous.

---

## 6. Architecture

### Stack

- **Frontend:** Vite + React; board drawn as **SVG** (one `<path>` per territory, fill = owner color, `<text>` army counts); Framer Motion/CSS for dice and moves. No game engine.
- **Backend:** Supabase — Auth, Postgres, Realtime (broadcast + presence), Edge Functions, pg_cron.
- **Engine:** pure TypeScript package, no dependencies, shared by edge function and pass-and-play client. Must load unmodified in both Node/Vite and Deno (edge functions): explicit `.ts` import extensions, no Node built-ins, shipped as source (no build step).

### Repo layout & tooling

```
packages/engine/     types.ts, decide/apply/views, maps/classic.ts, tests
apps/web/            Vite + React; generated board.svg + layout.json committed under src/board/
tools/map-build/     Natural Earth → board.svg / layout.json (mapshaper); run manually
supabase/            config.toml, migrations/, functions/game/
```

- **Package manager:** pnpm workspaces.
- **Tests:** Vitest for the engine, plus fast-check (dev dependency) for property tests (combat odds, army totals never negative, fortify connectivity). CI also runs a Deno smoke test that imports the engine, to catch Node-only imports.
- **Lint/format:** Biome.
- **Edge functions:** a **single `game` function** handles every command and every `PlayerView` read; the cron fallback calls it with the `system` actor. One deploy, one copy of the engine and map.
- **Engine → edge function import:** try a direct import first (per-function `deno.json`: `"@wc/engine": "../../../packages/engine/src/index.ts"`). If deploy bundling won't follow paths outside `supabase/`, a sync script copies the engine into `supabase/functions/_shared/engine/` before deploy. Settle on the first deploy.

### Engine pattern (commands → events → state)

```
decide(state, actor, command, ctx) → Event[] | Rejection   // validation + RNG live here only
apply(state, event) → state                                // pure reducer, deterministic
toPlayerView(state, viewer) → PlayerView                   // redaction
redactEvent(event, viewer) → Event | null
```

- Dice results, deck order and auto-play outcomes are written into events → replays are deterministic.
- Auto-play (timeouts/skips) expands into ordinary events inside `decide`.
- Times that state depends on are written into events too, since `apply` never reads a clock: deadlines
  (`GameStarted.draftDeadlineAt`, `DraftPicked.nextDeadlineAt`, `SetupStarted.deadlineAt`, `TurnStarted.deadlineAt`),
  `TurnStarted.startedAt`, and `at` on every turn action (the source of `lastActionAt`).
- Local (pass-and-play) games still get a setup `deadlineAt` (from `pace`); the local UI ignores it. Their turns have
  no deadline and `SkipTurn` is rejected.

### Data (Postgres)

```
games       (id, mode, status, host_user_id, join_code, settings jsonb,
             phase, current_seat, awaiting_seats smallint[],
             deadline_at, last_action_at, version, updated_at)
game_seats  (game_id, seat, user_id, display_name, color, turn_order,
             kind, status, consecutive_strikes)
game_events (game_id, seq, type, payload jsonb, actor_seat, created_at,
             PRIMARY KEY (game_id, seq))
game_state  (game_id PRIMARY KEY, seq, state jsonb)  -- ONE row per game, overwritten each write;
                                                     -- deleted at game end (rebuildable from events)
outbox      (id, game_id, kind, recipient_user_id, payload, sent_at)
profiles    (user_id PRIMARY KEY → auth.users, display_name, updated_at)  -- users read/write only their own row (RLS)
```

- **`awaiting_seats`** = who must act right now: the current seat in a turn, every unsubmitted seat in setup, the picking seat in draft, empty otherwise. `append_events` keeps it (and the other denormalized `games` columns) in sync with the new state in the same transaction. It drives the "Your move" list and badge (§8).
- **Members may `SELECT` their games' `games` and `game_seats` rows** (metadata only, via RLS) for the game lists; `game_state` and `game_events` stay function-only.
- **Storage budget:** events are about 1 MB per finished game, so the 500 MB free database holds hundreds of games. Finished games are kept forever.

### Write path

1. Client sends a command to an edge function (authenticated).
2. Function loads state + version, runs `decide`.
3. Calls RPC `append_events(game_id, expected_version, events, new_state)` — atomic check-and-insert (**optimistic concurrency**); retry on conflict.
4. Broadcast `{ version }` ping on the game's Realtime channel.
5. Each client fetches **its own** view from the edge function with `?since=<its last version>`. The response (`ViewResponse` in types) is the current `PlayerView` **plus the events since that version, each passed through `redactEvent`** for that viewer, so clients can animate other players' dice and moves.
   - If the client is more than `MAX_CATCHUP_EVENTS` (200) behind, or sends no `since`, `events` is `null`: the client snaps to the new view without animating.
   - Events the viewer may not see at all (`redactEvent` → `null`) are omitted.

### Security

- Clients **never read full state** (RLS can't redact inside JSON). All reads of game state go through the edge function's player view.
- RLS blocks direct client writes to game tables.
- Deck order, other hands, and others' hidden setup are server-only.

### Auth (online mode only)

- **Sign-in method:** **email magic link, with a 6-digit code in the same email** (Supabase Auth passwordless, PKCE flow). No passwords, no OAuth in v1.
  - Clicking the link signs you in.
  - The sign-in screen also has an "or enter the code" field (`verifyOtp({ email, token, type: 'email' })`). This covers phones where the link opens in the mail app's built-in browser; PKCE links only work in the browser that requested them.
  - Both the **Magic Link** and **Confirm signup** templates (first sign-in creates the user) include `{{ .ConfirmationURL }}` and `{{ .Token }}`. Templates live in the repo (`supabase/templates/*.html`), are referenced from `config.toml` for local dev, and are copied to the dashboard for prod. Keep them short and plain (no marketing copy, few links) for deliverability.
- **Production URL:** `https://world-conquest.fostercurtis.dev`, served by Vercel (§9.1).
- **Email delivery:** **Resend** as Supabase Auth's custom SMTP server, configured in the dashboard (Auth → SMTP: host `smtp.resend.com`, user `resend`, password = Resend API key), not in code.
  - Sending domain: **`auth.fostercurtis.dev`**, verified in Resend (SPF/DKIM DNS records, plus DMARC).
  - From: `World Conquest <no-reply@auth.fostercurtis.dev>`.
  - Supabase's built-in SMTP only sends to project team members, so Resend is required before inviting friends.
- **Rate limit:** Supabase caps custom-SMTP auth email at 30/hour by default; fine for a friends-only game.
- **Local dev:** the local Supabase stack catches all auth email in its built-in mail viewer, so dev never touches Resend.
- **Redirect allowlist:** the local dev URL and `https://world-conquest.fostercurtis.dev`.
- The same Resend account and domain are reused later by the outbox email sender.

### Notifications

None for v1. `TurnStarted` writes an `outbox` row so an email sender can be added later without changes elsewhere.

---

## 7. UI/UX

### 7.1 Visual style

- **Clean flat:** solid territory fills in owner color, thin borders, calm blue-gray ocean, sans-serif type, chunky simplified shapes (§5.3).
- **One theme** for v1 (no dark mode).
- **Color-blind support:** player colors are tuned to stay distinguishable, and every army badge also shows the owner's initial.

### 7.2 Input principles

- **Desktop and phone are equal first-class targets.** Every action is reachable by touch, by mouse, and by **keyboard alone**.
- All board input goes through **one selection state machine** (idle → source selected → target selected → panel). Pointer and keyboard are thin adapters over it, so they can't drift apart.
- **Army counts are never typed:** sliders, ± buttons and Min/Max buttons (or keys) only, so no phone keyboard pops up.
- **Targets:** the fixed-size army badge is the tap target (≥ 44 px on touch), so small territories are easy to hit.
- **Desktop mouse:** hovering shows a tooltip (name, owner, armies, continent) and previews the highlight; wheel/trackpad zooms; right-click = back (same as Esc).
- **Accessibility basics:** visible focus ring on the focused territory; territories have labels like "Brazil, yours, 5 armies"; the camera auto-pans to keep the focused territory on screen when zoomed in.

### 7.3 Board interactions

- **Reinforce and setup:**
  - Tapping (or Enter on) your own territory adds 1 army **and keeps it selected**; a bottom panel has −/+ and "all here" buttons that act on the selected territory. − takes back armies staged this step (never below zero staged) into the pool.
  - Placements are staged on the device with undo, and **Confirm** sends one `PlaceReinforcements` / `SubmitSetup` command.
  - In capitals setup, a "Choose capital" toggle switches what tapping does.
- **Draft:** tap (or Enter on) an unclaimed territory to pick it; the countdown is shown.
- **Attack:**
  - Selecting a source (≥ 2 armies, with an enemy neighbor) highlights its valid targets. Selecting a target opens the attack panel.
  - The panel has dice 1/2/3 (defaulting to the maximum) plus **Roll** and **Blitz**. It stays open for repeated rolls; tapping empty space or Esc cancels.
- **Occupy:** a slider with Min/Max buttons, defaulting to **Max**; confirm to move.
- **Fortify:** selecting a source highlights every territory reachable through your own chain. Then select a destination, set the slider, and confirm.

### 7.4 Keyboard map (desktop)

The board is a single focus area. While it has focus, it takes Tab/Shift+Tab; **Esc with nothing selected** releases focus to the HUD, where normal Tab navigation applies.

| Context | Keys |
|---|---|
| **Board focus** | **Tab / Shift+Tab**: next / previous **candidate** territory. Candidates depend on context: before a selection, your territories that can act in this step (reinforce: all yours; attack: ≥ 2 armies with an enemy neighbor; fortify: ≥ 2 armies with a reachable own territory; draft: unclaimed). After a source is selected, its valid targets. Order: map definition order (by continent, roughly west → east). |
| | **Enter**: same as tapping the focused territory (select, or +1 when placing). **Esc**: back one level (target → source → nothing). |
| **Placing** (reinforce/setup) | **↑ / ↓**: ±1 on the focused territory; **Shift+↑ / ↓**: ±5; **End**: all remaining here; **Home**: clear this territory; **Ctrl+Z**: undo. |
| **Attack panel** | **1 / 2 / 3**: dice count; **Space**: roll; **B**: blitz; **Esc**: close the panel. Space rolls wherever focus is while the panel is open. |
| **Sliders** (occupy, fortify) | **← / →** or **↑ / ↓**: ±1; **Shift+arrows**: ±5; **Home / End**: min / max; **Enter**: confirm. |
| **Global** | **Ctrl+Enter**: the step bar's main button (Confirm / End attack / End turn); **C**: open cards; **L**: show / hide the activity log; **Esc** while a dice result is open: close it; **hold Alt+/**: shortcut overlay. |

**Shortcut overlay:**
- **Hold Alt+/** (Option+/ on Mac) to show a small overlay of every shortcut, grouped as in the table above, with the current context's group highlighted. Releasing the keys hides it.
- Detect the physical key (`event.code === 'Slash'`) so it works on any keyboard layout, and `preventDefault` so Mac doesn't type "÷".
- A "Keyboard shortcuts" button in the HUD opens the same overlay for mouse users (click to toggle).
- **Start-of-game tip:** at the beginning of every game, a dismissible tip "Hold Alt + / to see keyboard shortcuts" appears. In online mode it shows when the player first opens the board; in pass-and-play, once at game start. Only on devices with a fine pointer (`(pointer: fine)`), so phones don't see it.

### 7.5 Dice and animation

- **2D dice** tumble for about 0.6 s, then pair up highest-to-highest, with the losing dice dimmed. Lost armies float up as "−N" over each territory.
- **Blitz** plays its rounds fast, capped at about 1.5 s total, then shows the totals.
- **The result panel stays open until the player closes it** (Close button or Esc), even with animation off. Rolling again replaces it; the board stays usable around it once the animation has finished.
- **Animation speed** setting: normal / fast / off. The device's reduce-motion setting means "off".
- Other players' actions animate from the catch-up events in `ViewResponse` (§6 write path). Pass-and-play animates directly from local events.

### 7.6 Turn HUD

| Element | Contents |
|---|---|
| **Step bar** | Reinforce → Attack → Fortify, reinforcements left to place, and one main button (Confirm / End attack / End turn) |
| **Timer** | Countdown to the deadline. In sync mode, other players see a **Skip** button once 5 minutes of inactivity have passed. |
| **Cards** | Your hand. Valid sets are highlighted, the best set is pre-selected, and a forced trade (5+ cards, or 6+ after an elimination) blocks everything else. |
| **Players** | Color, name, territory/army/card counts, online dot, strikes |
| **Activity feed** | Plain-language log ("Ana took Brazil from Ben"); also lists continent bonuses. Collapsible at every width (button or **L**); the choice is remembered per device |

### 7.7 Layout

- **Desktop:** the board in the middle, a right sidebar with players and the feed, and the step bar along the bottom.
- **Phone (portrait first; landscape also works):** the board fills the screen with pinch-zoom/pan and auto-pans to the action. The HUD is a collapsible bottom panel, with a strip of players across the top.
- **Installable app (PWA):** a web app manifest and icons so the game can be added to the home screen. Offline caching and updates: §9.5.

### 7.8 Connection and reconnect

- **Online mode** never queues actions while offline; the server is the only authority. No optimistic updates, except local staging of placements before Confirm.
- **While disconnected:** a "Reconnecting…" banner shows and action buttons are disabled.
- **Catching up:** the client fetches `?since=<version>` whenever Realtime reconnects or the tab is refocused, and every 30 s while the tab is visible (in case a broadcast was missed).
- **`STALE_VERSION`:** reload the view and show a short "the game moved on" notice.
- **Pass-and-play:** saved to IndexedDB after every event; the home screen offers "Resume game".

---

## 8. Game lists, replay & stats

### 8.1 "My games" (home screen)

- **Online sections:** **Your move** (`awaiting_seats` contains my seat), **Waiting on others**, **Lobbies**, **Finished** (most recent first). Canceled games are hidden.
- **On this device:** pass-and-play saves from IndexedDB (resume or delete).
- **Waiting-on-you count:** a badge on the home screen and in the tab title, e.g. "(2) World Conquest".

### 8.2 Replay (after game over)

- **Only after the game ends.** During play, history is the activity feed (§7.6); there is no mid-game scrubber.
- **URL:** `/g/K7QM2X/replay`, members only. Pass-and-play opens the same viewer from its local events.
- **Everything is revealed:** for a game in `game_over`, the edge function serves members the **full, unredacted** event log (`ReplayResponse` in types): all hands, hidden setup placements, card draws.
- **Viewer:** the normal board and animations, rebuilt in the browser by folding events through the engine's `apply` from `createInitialState`. A timeline lets you step by event or by turn, with play/pause and speed (normal / fast / instant).

### 8.3 Stats (after game over)

Computed in the browser from the replayed events:
- territories and armies per player over time (charts)
- dice luck: expected vs. actual losses per player
- biggest battle (most armies lost in one attack sequence)
- longest-held continent

### 8.4 Not in v1

- **No rematch / "Play again".** Players start a new game normally.

---

## 9. Hosting & deploy

### 9.1 Where things run

| Piece | Where |
|---|---|
| Frontend (static Vite build) | **Vercel** (Hobby plan, alongside the existing site), at `world-conquest.fostercurtis.dev` |
| DNS | **Namecheap**: `CNAME world-conquest → Vercel`; Resend's SPF/DKIM/DMARC records for `auth.fostercurtis.dev` |
| Database, Auth, Realtime, edge function, cron | **Supabase**, one free-tier production project |

- **SPA fallback:** every route (`/g/K7QM2X`, `/g/K7QM2X/replay`, …) serves `index.html` (a `vercel.json` rewrite).
- Swapping the frontend to Cloudflare Pages later = change the CI deploy step + the CNAME (add the domain in Pages *before* pointing the CNAME).

### 9.2 Environments

- **Local:** `supabase start` (Docker) + Vite dev server. Auth email goes to the local mail viewer.
- **Production:** the one Supabase project + Vercel. The second free Supabase project stays spare.
- **No PR preview deploys in v1** (they would share the production database; a free staging project would pause after 7 idle days).

### 9.3 Deploy pipeline (GitHub Actions)

- **PRs and `main`:** the existing CI (Biome, typecheck, tests, web build, Deno checks).
- **On push to `main`, after CI passes, deploy in order:**
  1. `supabase db push` (migrations)
  2. `supabase functions deploy game`
  3. Frontend via the Vercel CLI (`vercel deploy --prod`)
- **No Vercel Git auto-deploy:** CI owns the order, so the frontend never goes live before the backend it needs.
- **Secrets** live in a GitHub `production` environment: Supabase access token, project ref, DB password, Vercel token/org/project IDs.

### 9.4 Compatibility rules

- **Events are append-only, forever.** Event types and fields may be **added** (new optional fields only); never renamed, removed, or changed in meaning. Old games and replays must keep folding through `apply`.
- **Protocol version:** the client sends `PROTOCOL_VERSION` (from the engine) on every request. The edge function rejects a mismatch with HTTP 426, and the client shows "New version available, reload". This catches tabs left open for days in async games.

### 9.5 PWA, offline & keep-alive

- **Offline:** `vite-plugin-pwa` precaches the app shell, so **pass-and-play works fully offline**. Updates use **prompt-to-update** mode (pairs with the protocol check). Online mode shows "You're offline" without a connection.
- **Free-tier pause prevention:** a daily scheduled GitHub Actions workflow makes one lightweight Supabase API call, so the project isn't paused between game nights.

---

## 10. Out of scope for v1

Unless decided otherwise later:

- Bots / AI players
- Notifications (the `outbox` table is ready for an email sender via the same Resend account)
- In-game chat
- Alliances
- Spectators (`PlayerView.viewer: null` stays in the contract for redaction and tests, but there is no spectator UI or access)
- Rematch / "Play again" (§8.4)
- Host map choice (§2); other maps
- Dark mode (§7.1)
- PR preview deploys (§9.2)

---

## 11. Roadmap / open work

0. ~~**Scaffold**~~ — done: repo layout per §6 (pnpm workspaces, Vitest, Biome, CI with Deno smoke test).
1. **Map** — specified in §5. To build: classic map data file + validation tests; Natural Earth → SVG build script, `board.svg`, `layout.json`.
2. **Engine** — `decide`/`apply` test-first: combat math, reinforcement math, card sets, occupy rules, elimination, connectivity for fortify, auto-play.
3. **Supabase** — schema (§6, incl. `profiles`, `awaiting_seats`), RLS, `append_events` RPC, edge function (commands, `?since=` views, replay, protocol check), cron fallback + stale-lobby cleanup, email templates (§6 Auth).
4. **UI** — per §7–§8: home/"My games", sign-in (link + code), lobby, board + keyboard map, turn HUD, dice animation, presence, pass-the-device screens, replay + stats, PWA.
5. **Deploy** — per §9: Resend domain + Supabase SMTP, Vercel project + CNAME, CI deploy jobs, daily keep-alive workflow.
