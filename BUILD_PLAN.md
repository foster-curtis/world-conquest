# World Conquest: Build Plan

Executable plan for building v1 from `SPEC.md` (product/architecture truth) and `packages/engine/src/types.ts`
(engine contract). Orchestrator sessions read **only this file**; all state lives here and in git.
§ numbers refer to SPEC.md. Don't copy spec content here; point to it.

**Sessions** (one per phase, `/clear` between):

| Session | Runs | Ends at |
|---|---|---|
| A | Pre-flight, then M1 ‖ M2 (parallel worktrees) | User checkpoint: map PNG review |
| B | M3 | User checkpoint: pass-and-play play-test |
| C | M4 | — |
| D | M5, then M6, then Final handoff | Handoff list printed for the user |

---

## 1. Pre-flight checklist

Run every item and report results before building. If an item blocks the **next** milestone, stop and tell the user.

| Item | Check command | Blocks |
|---|---|---|
| Base branch: on `main`, clean, planning branch merged | `git status --short && git branch --show-current && git branch --merged main` (if `planning/spec-and-scaffold` isn't merged: `git switch main && git merge --ff-only planning/spec-and-scaffold`; local only, no push) | all |
| Toolchain installs and the scaffold is green | `pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm exec biome ci .` | all |
| Docker Desktop running (local Supabase) | `docker info --format '{{.ServerVersion}}'` | M4, M5 |
| Supabase CLI available | `npx supabase --version` (root devDependency) | M4–M6 |
| Unattended permissions: auto mode, or `.claude/settings.json` allowlist for `pnpm`, `git`, `node`, `npx supabase`, `deno`/`npx deno` | Orchestrator confirms its own permission mode; else `cat .claude/settings.json` | all (run stalls on prompts) |
| Network: npm registry | `npm ping` | all |
| Network: Natural Earth | `curl -sI -o /dev/null -w '%{http_code}' https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip` → `200` | M2 |
| Optional: Deno locally | `deno --version` (fallback: `npx --yes deno --version`; CI also runs the Deno checks) | none |

---

## 2. Branches, merging, verification

- The orchestrator's checkout stays on `main`. Nothing is pushed until the Final handoff.
- Each milestone works on `build/mN-<slug>` (e.g. `build/m1-engine`), branched from current `main`. Fixes after
  checkpoint feedback go on `build/mN-fix-<k>`.
- The subagent commits on its branch, runs acceptance, ticks its checklist block, **rebases onto `main`**, reruns
  acceptance if the rebase pulled anything in, then reports.
- The orchestrator merges with `git merge --ff-only build/mN-<slug>`. If that fails (the parallel branch landed first),
  it resumes the same subagent via SendMessage: "rebase onto main, rerun acceptance, report".
  Rebase conflicts in BUILD_PLAN.md (Blockers / Build decisions) resolve by keeping both sides.
- CI only runs on push/PR, so during the build every CI check (Biome, typecheck, tests, web build, Deno) is run locally.
- **Standard checks** (part of every milestone's acceptance):
  `pnpm test && pnpm typecheck && pnpm exec biome ci . && pnpm --filter @wc/web build`
- **Deno checks** (any milestone touching the engine or `game` function), using `deno` or `npx --yes deno`:
  `deno run packages/engine/deno-smoke.ts && deno check --config supabase/functions/game/deno.json supabase/functions/game/index.ts`

---

## 3. Milestones

| # | Milestone | Model | Parallel | User checkpoint |
|---|---|---|---|---|
| M1 | Engine + `maps/classic` data, test-first | opus | alongside M2 | no |
| M2 | Map art pipeline → `board.svg`, `layout.json`, PNG preview | sonnet | alongside M1 (worktree) | **yes**: PNG review |
| M3 | Pass-and-play UI, fully playable locally, no backend | sonnet | no | **yes**: play-test |
| M4 | Backend: migrations, RLS, `append_events`, `game` function, cron, email templates, integration tests | opus | no | no |
| M5 | Online UI: auth, lobby, My games, realtime/catch-up, replay/stats, PWA | sonnet | no | no |
| M6 | Deploy wiring in code only | sonnet | no | no |

**Changes from the original outline:** the auth email templates move from M6 to M4. M5 must test the 6-digit code
sign-in against the local mail viewer, which needs `{{ .Token }}` in the templates; §11 item 3 also groups templates
with Supabase. M6 keeps only CI/Vercel/keep-alive wiring.

**Everywhere:** leave out everything in §10. Event types and fields are frozen once M1 merges (§9.4): later
milestones may only *add* new event types or optional fields, and must log that under Build decisions.

### M1: Engine + classic map (opus, worktree)

- **Goal:** a pure, deterministic engine (`decide`/`apply`/views) and the classic map, proven by tests.
- **Read:** §4, §5.1, §5.2, §6 (Stack, Engine pattern), §9.4, §11 items 1–2, `types.ts`; for lobby/timer commands §2 (Lobby rules, Host leaving, Resigning), §3.
- **Depends on:** scaffold only.
- **Order (test-first):** (1) `maps/classic.ts` + map validation tests, as the **first commit** (M2 needs it);
  (2) rule modules in §11 item 2 order: combat math, reinforcement math, card sets, occupy rules, elimination,
  fortify connectivity, auto-play; (3) wire `decide`/`apply`: lobby → start → deal/draft → setup → turns → win
  conditions → resign/kick; (4) `toPlayerView` / `redactEvent`; (5) replay determinism.
- **Deliverables:**
  - `packages/engine/src/maps/classic.ts`, `packages/engine/src/maps/index.ts` (lookup by `MapId`)
  - `packages/engine/src/rules/*.ts` (combat, reinforcements, cards, fortify, autoplay)
  - `packages/engine/src/{state,decide,apply,views}.ts`, exported from `src/index.ts`
  - `*.test.ts` next to each module (Vitest + fast-check)
  - `packages/engine/deno-smoke.ts` extended to run a short decide/apply sequence on the classic map
  - SPEC §5.2 shrunk to a pointer to `maps/classic.ts`, as §5.2 itself instructs
- **Acceptance:**
  - Standard checks + Deno checks.
  - §5.1 validation tests pass for every registered map; classic has 42 territories, 6 continents, 83 borders,
    14 of each card symbol, bonuses per §5.2.
  - fast-check properties: army counts never negative, combat losses total `min(attacker dice, defender dice)`,
    fortify only along own connected chains, folding the emitted events from `createInitialState` reproduces the
    live state exactly.
  - A seeded random-legal-move simulation reaches `game_over` without throwing for 2–6 players, both win conditions,
    and runs with forced timeouts and resignations.
  - Every `GameEvent` type is emitted by at least one test, since shapes freeze after M1.
  - `toPlayerView` / `redactEvent` never leak deck order, other hands, or others' hidden setup (property test).
- **Risks / fallbacks:**
  - Event shapes freeze at merge (§9.4). If a shape in `types.ts` is wrong, fix it **now** (types + SPEC + Build decisions).
  - Local mode has no timers but `Phase.setup.deadlineAt` / `SetupStarted.deadlineAt` are non-nullable. Decide
    before freezing (suggested: keep them; the local UI ignores them) and log it.
  - Randomness only through `ctx.rng`, time only through `ctx.now`; no `Date.now()`, no `Math.random()` in engine code.
  - Deno compatibility (§6 Stack): explicit `.ts` imports, no Node built-ins, no dependencies.
  - `apply` must not mutate its input.
- **Leave out:** UI, server code, other maps, bots (§10).

### M2: Map art pipeline (sonnet, worktree)

- **Goal:** a reproducible Natural Earth → `board.svg` + `layout.json` build, plus a PNG preview for the user.
- **Read:** §5.1, §5.2 (IDs + adjacency), §5.3, §5.4, §7.1. Not `types.ts`.
- **Depends on:** nothing to start. The §5.3 cross-checks need `maps/classic.ts` from M1 (see risks).
- **Deliverables:**
  - `tools/map-build/build.ts` (run with Node; mapshaper as a library or CLI), with a `build` script in its `package.json`
  - `tools/map-build/assignments.json`: every Natural Earth country/province → territory ID or `"drop"`
  - Downloads cached in `tools/map-build/.cache/` (gitignored); raw Natural Earth data is never committed
  - `apps/web/src/board/board.svg`, `apps/web/src/board/layout.json` (committed, per §5.3 Outputs)
  - `tools/map-build/preview.png` (committed): board with territory fills by continent, sea links, and anchor dots
  - `tools/map-build/*.test.ts`: the §5.3 checks run against the committed outputs, so `pnpm test` covers them
- **Acceptance:**
  - Standard checks.
  - `pnpm --filter @wc/map-build build` run twice yields no diff: `git diff --exit-code apps/web/src/board`.
  - §5.3 build-time checks pass: exactly one `<path>` per territory, grouped by continent; every land-touching pair is
    adjacent; every adjacent non-touching pair has a sea link in `layout.json`; Alaska–Kamchatka is the only wrap
    link, drawn as two edge stubs (§5.4).
  - `layout.json` has a label/badge anchor for all 42 territories.
- **Risks / fallbacks:**
  - **Province splits (§5.3):** for each split country (Russia, Canada, US, Australia, and any other needed) use
    *only* admin-1 shapes, so admin-0/admin-1 generalization differences don't leave slivers.
  - "Touching" means shared arcs in mapshaper's topology (with a small tolerance), not raw polygon intersection.
  - A touching pair that isn't adjacent gets fixed in `assignments.json` (reassign or drop a province/island).
    **Never edit adjacency**: it is hand-authored truth (§5.1). Watch Kazakhstan, Russian Far East vs. Mongolia,
    Ceuta/Melilla, Kaliningrad, the Caucasus. If a violation can't be fixed, write a Blocker.
  - Projection (§5.3): rotate the central meridian so the cut falls in the Bering Strait and Chukotka stays whole on
    the right edge.
  - PNG rendering needs a rasterizer devDependency (e.g. `@resvg/resvg-js`).
  - **M1 dependency:** run the cross-checks last. If `maps/classic.ts` isn't on `main` yet, report
    "pipeline done, checks pending M1". The orchestrator merges M1 first, then resumes M2 to rebase and finish.
- **Leave out:** interactivity, labels baked into the SVG (the app draws them from `layout.json`), other maps, hand edits to outputs.
- **User checkpoint:** user opens `tools/map-build/preview.png` and approves it, or gives notes (simplification level, crop, assignments). Notes go to an `M2-fix` subagent.

### M3: Pass-and-play UI (sonnet)

- **Goal:** a complete pass-and-play game in the browser, with no backend.
- **Read:** §1, §4, §5.4, §7 (all), §8.1 ("On this device" only), §8.2–§8.3 (local replay + stats), `types.ts`.
- **Depends on:** M1, M2 merged; M2 checkpoint approved.
- **Deliverables** (under `apps/web/src/`; exact structure is the subagent's call):
  - `home/`: home screen with Pass-and-play, "Resume game", "On this device" list; Online entry present but disabled
  - `local/`: setup screen (names, colors, win condition), pass-the-device screens (§1), game controller that
    runs `decide`/`apply` with `Math.random`, IndexedDB persistence after every event (§7.8)
  - `board/`: SVG board from `board.svg` + `layout.json`, army badges with owner initial, zoom/pan, sea links (§5.4)
  - `input/`: one pure selection state machine, plus pointer and keyboard adapters (§7.2–§7.4), shortcut overlay, start tip
  - `hud/`: step bar, cards, players, activity feed (§7.6); no timer in local mode
  - `dice/`: dice and move animations, speed setting, reduce-motion (§7.5)
  - `replay/`, `stats/`: post-game viewer and stats from local events (§8.2–§8.3); built so M5 can feed server events
  - Vitest added to `apps/web` (`test` script)
- **Acceptance:**
  - Standard checks.
  - Selection machine unit tests cover every §7.4 context (candidates, Enter/Esc levels, placing keys, sliders, attack panel).
  - Headless test: the local controller plays complete games to `game_over` via random legal moves (2 players +
    neutral, 6 players, capitals), and resumes correctly from a persisted save.
  - Rendering always uses `toPlayerView(state, currentSeat)`, never full state (test asserts no other hands reach the UI).
  - `pnpm dev` serves the app (`curl -s -o /dev/null -w '%{http_code}' http://localhost:5173` → `200`).
- **Risks / fallbacks:**
  - SVG performance on phones: memoize territory paths; zoom/pan via a CSS/SVG transform. Log any library choices
    (router, gestures, animation) under Build decisions.
  - IndexedDB unavailable (private mode): fall back to in-memory with a visible warning.
  - Engine bugs found here get fixed in the engine with a test. If a fix needs an event-shape change, write a Blocker.
- **Leave out:** online mode, auth, timers, PWA (M5), §10.
- **User checkpoint:** user runs `pnpm dev` (and `pnpm dev --host` to try a phone on the LAN) and plays a game. Notes go to an `M3-fix` subagent.

### M4: Backend (opus)

- **Goal:** Supabase schema, security, write path, and the `game` function, all proven by integration tests on the local stack.
- **Read:** §2, §3, §6 (Data, Write path, Security, Auth, Notifications, Repo layout & tooling), §9.4, `types.ts`.
- **Depends on:** M1 (M3 not required, but run in order).
- **Deliverables:**
  - `supabase/migrations/<ts>_schema.sql`: §6 Data tables, unique `games.join_code`, `profiles`
  - `supabase/migrations/<ts>_rls.sql`: §6 Security, members-only SELECT on `games` / `game_seats`, own-row `profiles`
  - `supabase/migrations/<ts>_append_events.sql`: atomic version check + insert, denormalized `games` columns incl.
    `awaiting_seats`, `outbox` row on `TurnStarted` (§6 Notifications)
  - `supabase/migrations/<ts>_cron.sql`: every-minute expired-deadline check and daily stale-lobby job (§2, §3 Timer
    enforcement) calling the function via pg_net as `system`; function URL and secret read from Vault
  - `supabase/seed.sql`: local Vault values for the cron URL/secret
  - `supabase/functions/game/`: create game, look up by join code, commands, `?since=` views, replay, protocol check
    (426), system-actor auth, crypto RNG, retry on version conflict, broadcast `{ version }`
  - Transport types for the function's HTTP API (routes, request bodies, errors) added to `types.ts`, additively; SPEC updated; logged
  - `supabase/templates/magic_link.html`, `supabase/templates/confirmation.html` (§6 Auth), referenced in `config.toml`
  - `config.toml`: `site_url` / `additional_redirect_urls` set to the Vite dev URL (they currently say `127.0.0.1:3000`)
  - `tests/integration/` workspace package `@wc/integration` (add `tests/*` to `pnpm-workspace.yaml`) plus a root
    script `test:integration`; kept out of `pnpm test` because it needs Docker
- **Acceptance:**
  - Standard checks + Deno checks.
  - `npx supabase start && npx supabase db reset` applies all migrations cleanly.
  - `pnpm test:integration` covers: create/join/colors/settings/remove/start; 2-player neutral seat; a full turn
    through the function; `STALE_VERSION` on concurrent writes; RLS (members see metadata, non-members don't, no one
    reads `game_state` / `game_events` or writes any game table, `profiles` own row only); no response leaks deck or
    hidden info; `?since` catch-up, with `events: null` beyond `MAX_CATCHUP_EVENTS`; replay only for members after
    `game_over`; 426 on protocol mismatch; `ClaimTimeout` before/after the deadline; the cron SQL selects only expired
    games (call it directly); stale-lobby cancel; magic-link email in the local mail viewer contains the 6-digit code.
- **Risks / fallbacks:**
  - **Engine import (§6):** if local serving or `deno check` can't resolve `../../../packages/engine`, apply the §6
    fallback now: a sync script copies the engine into `supabase/functions/_shared/engine/` before serve, check and
    deploy. Log it. The first production deploy settles it for good (handoff).
  - pg_net calls from the DB container need the Docker-network URL locally; production differs, hence Vault values.
  - System-actor authentication and how `awaiting_seats` is computed (function vs. SQL) aren't fixed by the spec:
    decide and log both.
- **Leave out:** UI, the outbox email sender (§6 Notifications, §10), any production project.

### M5: Online UI (sonnet)

- **Goal:** online mode end to end against the local stack, plus the PWA.
- **Read:** §1, §2, §3 (client side), §6 (Auth, Write path), §7.4 (start tip), §7.6, §7.7, §7.8, §8, §9.4, §9.5, `types.ts` (transport section).
- **Depends on:** M3, M4.
- **Deliverables** (under `apps/web/src/online/` unless noted):
  - `api.ts`: the single client for the `game` function (sends `PROTOCOL_VERSION`, handles 426 with "reload")
  - `auth/`: email → magic link + "or enter the code", PKCE, return to the original `/g/CODE` URL, display-name prompt
  - `lobby/`: create, join page, settings, colors, remove, cancel, copy link + Web Share (§2)
  - `/g/:code` states (§2 Join code & link), board/HUD reused from M3 fed by server views, timers, Skip, ClaimTimeout
  - Realtime ping + presence + catch-up rules (§7.8); "My games" sections, badge, tab-title count (§8.1)
  - `/g/:code/replay` reusing M3's replay + stats with `ReplayResponse`
  - PWA: `vite-plugin-pwa`, manifest, icons, prompt-to-update (§9.5)
  - `apps/web/.env.example`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Acceptance:**
  - Standard checks.
  - Unit tests for catch-up (since/version/snap/`STALE_VERSION`) and `/g/:code` routing states.
  - Integration test (in `tests/integration`): two users sign in with the 6-digit code fetched from the local mail
    viewer's API, create, join by code, start, and play a turn, all through `online/api.ts`.
  - The web build emits a manifest and service worker.
- **Risks / fallbacks:**
  - PKCE links fail in other browsers: the code path must work on its own (§6 Auth).
  - No optimistic updates and no offline queue in online mode (§7.8).
  - Don't fork M3 components; the board consumes a `PlayerView` either way.
  - Service worker vs. stale tabs: rely on prompt-to-update plus the 426 check.
- **Leave out:** notifications, chat, spectators, rematch (§10), deploy.

### M6: Deploy wiring (sonnet)

- **Goal:** CI deploys in the §9.3 order once secrets exist. No accounts or dashboards touched.
- **Read:** §9 (all), §6 (Repo layout & tooling: engine import).
- **Depends on:** M4, M5.
- **Deliverables:**
  - `.github/workflows/ci.yml`: a `deploy` job (`needs` node + deno, only on push to `main`, `environment: production`):
    `supabase link` → `db push` → (engine sync, if M4 used the fallback) → `functions deploy game` → Vercel
    `pull`/`build`/`deploy --prebuilt --prod` with the `VITE_*` env
  - `apps/web/vercel.json`: SPA rewrite (§9.1), Git auto-deploy disabled
  - `.github/workflows/keep-alive.yml`: daily cron + `workflow_dispatch`, one lightweight Supabase API call (§9.5)
  - Final handoff (section 9 of this file) updated with the exact secret names the workflows use
- **Acceptance:**
  - Standard checks.
  - Workflows validate: `npx --yes @action-validator/cli .github/workflows/ci.yml .github/workflows/keep-alive.yml`.
  - `apps/web/vercel.json` parses and contains the catch-all rewrite.
  - The deploy job is **not** run (no secrets yet); say so in the report.
- **Risks / fallbacks:**
  - Vercel and the pnpm monorepo: build at the workspace root with `--prebuilt` so `@wc/engine` resolves.
  - Pin the Supabase CLI version in CI.
  - Function bundling outside `supabase/` (§6) is only proven by the first real deploy; the handoff covers it.
- **Leave out:** creating projects, DNS, secrets; PR preview deploys (§9.2, §10).

---

## 4. Subagent brief template

The orchestrator fills the `{…}` fields from section 3 and pastes:

```
You are building milestone {M#}: {Goal} for the World Conquest repo.
Branch: create `build/{m#}-{slug}` from main (`git switch -c build/{m#}-{slug}`) and commit only there.
Read ONLY: BUILD_PLAN.md section 3 entry for {M#}, SPEC.md {§ list}{, packages/engine/src/types.ts}. Don't explore beyond what the task needs.
Deliverables: {copy the milestone's Deliverables list}
Acceptance: {copy the milestone's Acceptance list}. Build until every acceptance command passes; run them yourself.
Leave out: {Leave out line}. Everything in SPEC §10 stays out.
Rules:
- Don't change existing event types/fields (SPEC §9.4){, except: M1 may until it merges}. If you must change the
  contract, update types.ts AND SPEC.md, and add a line to BUILD_PLAN.md "Build decisions".
- Choices the spec doesn't cover (libraries, file layout, protocol details): pick the simplest, log one line under
  "Build decisions".
- When blocked (missing info, failing tool, spec contradiction): write it under BUILD_PLAN.md "Blockers", commit,
  and stop. Don't guess.
- When done: tick your items in BUILD_PLAN.md "Progress checklist", commit, rebase onto main, rerun acceptance if the
  rebase pulled anything in. Don't merge or push.
Reply in 150 words or fewer: what was built, what was deferred, blockers, and the branch name.
```

---

## 5. Orchestrator rules

1. Read only BUILD_PLAN.md. Never read source code; trust the subagent reports and this checklist.
2. Resume by reading the Progress checklist, Blockers, and `git log --oneline -15`. Then run pre-flight.
3. One subagent per milestone (Agent tool, `model` from the milestone table). Run M1 and M2 in parallel with
   `isolation: "worktree"`. Others run in the main checkout.
4. Merge per section 2 (`git merge --ff-only`). Merge M1 before finishing M2's cross-checks.
5. After each merge, spawn a `test-runner` agent (`model: "haiku"`) on `main` with the milestone's acceptance
   commands; only failures come back. On failure, resume the milestone's subagent with the failure output.
6. Stop at user checkpoints and unresolved Blockers. Tell the user exactly what's needed (file to look at, command
   to run, question to answer). Checkpoint notes become a fix subagent on `build/mN-fix-<k>`.
7. No extra review passes, audits or re-exploration unless an acceptance check fails.
8. When everything is checked, print the Final handoff list (section 9) for the user.

---

## 6. Progress checklist

- [x] **Pre-flight** passed (record the date and any skipped items under Build decisions)

**M1: Engine + classic map**
- [x] `maps/classic.ts` + §5.1 validation tests (first commit)
- [x] Rule modules (§11 item 2 order); `decide`/`apply` from lobby through win conditions and resign/kick
- [x] Views + leak test; replay determinism; full-game simulation; every event type emitted
- [x] Deno smoke extended; SPEC §5.2 shrunk to a pointer
- [ ] Merged to `main` (event shapes frozen)

**M2: Map art**
- [x] Pipeline + `assignments.json`; `board.svg` + `layout.json`; `preview.png`
- [x] §5.3 cross-checks against `maps/classic.ts` pass; build is reproducible
- [ ] Merged to `main`
- [ ] **User approved preview PNG**

**M3: Pass-and-play UI**
- [ ] Home, local setup, pass-the-device, IndexedDB save/resume
- [ ] Board, selection machine + pointer/keyboard adapters, shortcut overlay, tip
- [ ] HUD, dice/animations, local replay + stats; headless full-game test
- [ ] Merged to `main`
- [ ] **User play-tested and approved**

**M4: Backend**
- [ ] Schema, RLS, `append_events` (denormalized columns, outbox), cron jobs + seed
- [ ] `game` function (create, lookup, commands, views, replay, 426, system actor); transport types in `types.ts` + SPEC
- [ ] Email templates + `config.toml` auth URLs; `tests/integration` green on the local stack
- [ ] Merged to `main`

**M5: Online UI**
- [ ] `api.ts` (protocol/426), auth (link + code), profile name, lobby, `/g/:code` states, sharing
- [ ] Online board (timers, Skip, ClaimTimeout, realtime, presence, catch-up), My games + badge, online replay + stats
- [ ] PWA; two-user integration test
- [ ] Merged to `main`

**M6: Deploy wiring**
- [ ] CI `deploy` job, `vercel.json`, keep-alive workflow, handoff secret names updated
- [ ] Merged to `main`

- [ ] **Final handoff** list printed for the user

---

## 7. Blockers

_None._ (Format: `- [M#] YYYY-MM-DD: what's blocked, what was tried, what's needed from whom.`)

---

## 8. Build decisions

(Format: `- [M#] decision: one line, with the reason.`)

- [pre] Pre-flight passed 2026-10-20, nothing skipped. Deno isn't installed locally, so Deno checks use `npx --yes deno` (2.9.6).
- [M1] Contract (pre-freeze): added `GameStarted.draftDeadlineAt`, `TurnStarted.startedAt`, and `at` on CardsTraded/ArmiesPlaced/AttackRolled/ArmiesOccupied/AttackEnded/Fortified, because `apply` has no clock but state holds the draft deadline, turn start and `lastActionAt`.
- [M1] Contract: `JoinGame.userId?` (filled by the edge function like `displayName`); the JoinGame actor is ignored because a joiner has no seat yet. New rejection code `NOT_A_SEAT`.
- [M1] Kept `Phase.setup.deadlineAt` / `SetupStarted.deadlineAt` non-nullable: local games get one from `pace` and the UI ignores it. Local turns have `deadlineAt: null` and `SkipTurn` is rejected.
- [M1] Card ids = territory ids, wilds `wild:1`/`wild:2`. Seat ids = lowest free 0–5; `seats` stays in join order (host passes to `seats[0]`); neutral takes the lowest free id.
- [M1] Deal/draft puts 1 army per territory; `armiesToPlace` = startingArmies − territories owned. Kicked seats auto-pick in the draft like neutral and get an auto SetupSubmitted.
- [M1] `CardsTraded.armies` = set value; +2 lands on the first traded card's territory you own. `forced` = made by auto-play.
- [M1] Blitz rolls max dice every round. A game-ending conquest auto-occupies the minimum before `GameEnded`. Fortify from the attack step emits `AttackEnded` first.
- [M1] Skipped/timed-out turns draw no card (same as resign). Order: [ArmiesOccupied] [CardsTraded] [ArmiesPlaced] TurnSkipped TurnEnded [SeatKicked] then GameEnded or TurnStarted.
- [M1] `redactEvent` never returns null: deck → `[]`; others' CardDrawn/SeatEliminated card ids → `''` (`HIDDEN_CARD_ID`); others' SetupSubmitted → `{}`/null.
- [M1] Test helpers (seeded rng, harness, random-legal-move sim) live in `packages/engine/src/testing/`, not exported.
- [M2] `layout.json` schema: `{width, height, anchors{id:[x,y]}, seaLinks[{a,b,from,to}], wrapLinks[{a,b,stubs[{territory,from,to}]}]}`; board is 2120x932 with a 60-unit empty margin each side so the Alaska/Kamchatka stubs (from territory to x=0 / x=width) are visible. Sea-link endpoints are the closest vertex pair.
- [M2] Pipeline: own JS does assignment/projection (Miller, central meridian 11E so the cut is at 169W); mapshaper does dissolve/clip/simplify (4% weighted Visvalingam)/`-points inner` anchors; `assignments.json` maps ADM0_A3 -> id|drop|{provinces,keep,parts}. Touching = shared boundary segment in `board.svg`. Preview labels exist only in `preview.png`.
- [M2] Dropped Russian Far East provinces touching China (Zabaykalsky, Amur, Jewish AO, Khabarovsk, Primorsky) since adjacency forbids irkutsk/kamchatka-china contact; leaves a visible gap. Kazakhstan -> ural; Caspian gives an afghanistan-ukraine sea link.

---

## 9. Final handoff (manual setup, printed by the last session)

Do these in order; Resend must be verified before friends can sign in (§6 Auth).

1. **Resend:** add and verify the domain `auth.fostercurtis.dev`; create an API key with sending access.
2. **Namecheap DNS:** add Resend's SPF/DKIM (and MX, if Resend lists one) records for `auth.fostercurtis.dev`, plus
   a DMARC TXT record; add `CNAME world-conquest` → the target Vercel shows for the domain.
3. **Supabase** (one free-tier project, §9.1):
   - Create the production project (Postgres major version matching `config.toml`); `npx supabase link --project-ref <ref>`.
   - Auth → SMTP: host `smtp.resend.com`, user `resend`, password = Resend API key, sender
     `World Conquest <no-reply@auth.fostercurtis.dev>`.
   - Auth → Email templates: paste **Magic Link** and **Confirm signup** from `supabase/templates/`.
   - Auth → URL configuration: Site URL `https://world-conquest.fostercurtis.dev`; redirect allowlist = that URL +
     the local dev URL.
   - Set the cron Vault values and the system-actor secret per M4's Build decisions (function URL, secret).
4. **Vercel:** create the project (root `apps/web`, Vite) without a Git connection (auto-deploy off); add the domain
   `world-conquest.fostercurtis.dev`; create a deploy token; note the org and project IDs.
5. **GitHub:** create a `production` environment with secrets: Supabase access token, project ref, DB password; Vercel
   token, org ID, project ID; `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; plus anything the keep-alive
   workflow needs. (M6 replaces this line with the exact names.)
6. **Ship:** push the branch, open a PR, let CI pass, merge to `main`. Watch the first deploy. If
   `functions deploy` can't bundle the engine from outside `supabase/`, switch to the §6 sync-script fallback.
7. **Smoke test:** sign in on a phone with the code, create a game, join from a second account, play a turn.

---

## 10. Kickoff prompt

Paste after `/clear` to start each orchestrator session:

```
You are the orchestrator for the World Conquest build.
Read BUILD_PLAN.md (only that file, never source code).
Run the section 1 pre-flight checks and report results; stop if anything blocks the next milestone.
Check the Progress checklist, Blockers and `git log --oneline -15` to see where the build stands.
Then run the next unchecked milestone(s) per the section 5 orchestrator rules, using the section 4 brief
and the model from the milestone table (M1 and M2 run in parallel worktrees).
Merge per section 2 and verify with a test-runner agent after each merge.
Stop at user checkpoints or unresolved blockers and tell me exactly what you need.
If every box is checked, print the section 9 Final handoff list.
{Optional: "Checkpoint approved: M2" / "M3 notes: …"}
```
