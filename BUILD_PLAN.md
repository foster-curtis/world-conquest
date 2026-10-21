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
  - Workflows validate: `npx --yes @action-validator/cli .github/workflows/ci.yml && npx --yes @action-validator/cli .github/workflows/keep-alive.yml` (the CLI takes one path per call).
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
- [x] Merged to `main` (event shapes frozen)

**M2: Map art**
- [x] Pipeline + `assignments.json`; `board.svg` + `layout.json`; `preview.png`
- [x] §5.3 cross-checks against `maps/classic.ts` pass; build is reproducible
- [x] Merged to `main`
- [x] **User approved preview PNG** (2026-10-20, after M2-fix-1 round 2; user may refine the art later)

**M3: Pass-and-play UI**
- [x] Home, local setup, pass-the-device, IndexedDB save/resume
- [x] Board, selection machine + pointer/keyboard adapters, shortcut overlay, tip
- [x] HUD, dice/animations, local replay + stats; headless full-game test
- [x] Merged to `main`
- [x] **User play-tested and approved** (2026-10-20, after M3-fix-1 and M3-fix-2; approval given conditional on the fix-2 sidebar change)

**M4: Backend**
- [x] Schema, RLS, `append_events` (denormalized columns, outbox), cron jobs + seed
- [x] `game` function (create, lookup, commands, views, replay, 426, system actor); transport types in `types.ts` + SPEC
- [x] Email templates + `config.toml` auth URLs; `tests/integration` green on the local stack
- [x] Merged to `main`

**M5: Online UI**
- [x] `api.ts` (protocol/426), auth (link + code), profile name, lobby, `/g/:code` states, sharing
- [x] Online board (timers, Skip, ClaimTimeout, realtime, presence, catch-up), My games + badge, online replay + stats
- [x] PWA; two-user integration test
- [x] Merged to `main`

**M6: Deploy wiring**
- [x] CI `deploy` job, `vercel.json`, keep-alive workflow, handoff secret names updated
- [x] Merged to `main`

- [x] **Final handoff** list printed for the user

---

## 7. Blockers

_None._ (Format: `- [M#] YYYY-MM-DD: what's blocked, what was tried, what's needed from whom.`)

---

## 8. Build decisions

(Format: `- [M#] decision: one line, with the reason.`)

- [pre] Pre-flight passed 2026-10-20, nothing skipped. Deno isn't installed locally, so Deno checks use `npx --yes deno` (2.9.6).
- [orch] `.claude/worktrees/` gitignored: Biome (vcs.useIgnoreFile) otherwise finds the agent worktrees' nested `biome.json` and fails `biome ci .` on main.
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
- [M2] `layout.json` schema: `{width, height, anchors{id:[x,y]}, seaLinks[{a,b,from,to}], wrapLinks[{a,b,stubs[{territory,from,to}]}]}`; 60-unit empty margin left/right so the Alaska/Kamchatka stubs (from territory to x=0 / x=width) are visible.
- [M2] Pipeline: own JS does assignment/projection (Miller, central meridian 11E so the cut is at 169W); mapshaper does dissolve/clip/simplify/`-points inner` anchors; `assignments.json` maps ADM0_A3 -> id|drop|{provinces,keep,parts}. Touching = shared boundary segment in `board.svg`. Preview labels exist only in `preview.png`. Kazakhstan -> ural; Caspian gives an afghanistan-ukraine sea link.
- [M2-fix-1] Board stylized per user notes: `warp.json` (squeeze high latitudes toward 11E, vertical stretch up to 1.2x in the tropics/south, MLS control groups moving/scaling the Americas, Greenland, Baffin, Australasia, lenses on Europe, Japan, Siam, Irkutsk, New Guinea, Indonesia, Madagascar, Iceland, Great Britain) applied to projected vertices after dissolve, before topology; build fails if the Jacobian drops below 0.05 near land. Board is now 1520x1216 (1.25:1, was 2120x932); size follows from the warped land + margins, SPEC has no fixed aspect. The user's 1975 board photo was used only to judge relative sizes/placement, never traced.
- [M2-fix-1] Stylization: weighted Visvalingam at interval=4 board units, detached islands < 220 units^2 dropped (never a territory's largest part), one-territory water inlets narrower than 5 units filled (fixes the St Lawrence sliver), one-territory spikes thinner than 7 units cut (removes Baja), then 3 Chaikin passes per arc chain with junction relaxation before each pass (borders smoothed once, corners at junctions rounded; on a crossing the junction freezes, then the chain stays unsmoothed). Per-territory simplify overrides: Australia 16, Greenland (incl. Baffin) 14, New Guinea 7. Anchors must sit >= 15 units inside their shape; now part of `runChecks` and a test, so it cannot regress.
- [M2-fix-1] `layout.json` sea links gain optional `via` (quadratic Bézier control point; additive). Endpoints come from `sealinks.json` overrides (`anchor`, `{lonlat}` or `{board}` snapped to the coast, `through` a water point) else the closest vertex pair; build fails if a link crosses land or another link. Tuned: Ontario's endpoint on its Hudson Bay coast (link from Baffin), Italy-Tunisia, Java-NW Australia.
- [M2-fix-1] Mongolia buffer: China split by admin-1; Inner Mongolia, Heilongjiang, Jilin, Liaoning -> mongolia; Zabaykalsky (Chita) -> irkutsk; Amur, Jewish AO, Khabarovsk, Primorsky -> kamchatka (Sakhalin dropped: it read as a sliver). Korea -> mongolia: it touches only Manchuria (mongolia) and Primorsky (kamchatka, adjacent), so the checks pass with no tolerance. Yakutsk touches neither mongolia nor china. Siberia-China border widened by giving East Kazakhstan and western Mongolia (Bayan-Olgii, Hovd, Uvs, Govi-Altai) to siberia.
- [M2-fix-1] Dropped for the stylized look: Indonesia except Sumatra/Java/Borneo/Sulawesi (Malaysian Borneo + Brunei -> indonesia), Timor-Leste, PNG islands, Canadian Arctic islands except Baffin, Russian Arctic islands (Novaya Zemlya, Franz Josef, Severnaya Zemlya, New Siberian, Wrangel), Hainan, East Thrace (gives a short Dardanelles link). Cabinda -> congo. `keep` may be a list of boxes and provinces may carry their own rule.
- [M2-fix-1] Round-2 assignments (user notes on sizes/shapes): Libya -> egypt; Baffin + Southampton -> greenland (short links to NWT, Quebec and Ontario); Kyzylorda, South Kazakhstan, Zhambyl, Mangystau -> afghanistan; Denmark -> northern_europe (removed the Jutland spike; scandinavia-northern_europe is now a sea link); Peninsular Malaysia, Singapore, Tasmania dropped. New `split` rule (lon/lat box cut, via mapshaper clip/erase): Alaska panhandle -> alberta (removed a BC sliver), Alaska Peninsula tip dropped (needle).

- [M3] No router, gesture or animation libraries: screens are a state switch in `App.tsx`, zoom/pan/pinch are own pointer code over pure `board/camera.ts`, animation is CSS plus timers; fewer deps, nothing to bundle.
- [M3] Dev deps added to apps/web: `vitest` (plus `vitest.config.ts`, node env) and `fake-indexeddb` for the persistence test. No jsdom: tests cover logic and the controller.
- [M3] Saves: IndexedDB `wc-local` with stores `meta` and `events` (key [id, n]); events are appended after every command, resume folds them with `apply`. In-memory fallback plus a visible warning when IndexedDB fails.
- [M3] Pass screen is derived, not stored: key = phase:seat:turnCount, so it shows before every setup turn and turn, and again after a resume.
- [M3] UI only receives `toPlayerView` and `redactEvent`-ed events from `LocalGame`; the full log is available only at game over (replay). Game-over board uses viewer null.
- [M3] Selection machine: Confirm for placing needs all armies placed (and a capital in capitals setup); fortify slider defaults to Max like occupy; `board/` is linted now (only board.svg and layout.json are excluded from Biome); camera `fit` was renamed `fitCamera` because Biome reads `fit(` as a focused test.
- [M3] Replay and stats take `{gameId, settings, events}` (plain or sequenced events) so M5 can pass a `ReplayResponse` unchanged. Charts are hand-written SVG. Stats time axis = turn number; longest-held continent counts turns.
- [M3] Not verified in a real browser this session (the browser tool disconnected): layout, touch gestures and animations need the user play-test. Deferred: PWA, timers, resign confirmation uses window.confirm.
- [M3-fix-1] decision: activity log toggles with L (free in the 7.4 table); collapsed state kept in localStorage 'wc-feed-collapsed' (guarded), per device.
- [M3-fix-1] decision: fortify bug root cause: after a fortify the step stays 'fortify' with fortified=true and deriveEnv mapped that to mode 'none', so the main button was disabled; it now stays mode 'fortify' with no candidates, so End turn works.
- [M3-fix-1] decision: placement was already staged until Confirm; the real bug was pointer hover(null) clearing the selection when the mouse left the board for the panel. Hover is now ignored while placing (selection is sticky); no contract change.
- [M3-fix-1] decision: dice result is kept in GameScreen state from `lastRollResult(events)` (works with animation off), closed by a Close button or Esc (Esc first, then the usual levels); no click-outside, because the board must stay clickable for the next roll. Enter is not used since it confirms sliders.
- [M3-fix-2] decision: the sidebar collapse is desktop-only (CSS media query min-width 801px); phones keep the existing bottom drawer, so the header toggle is hidden there. The grid column animates to 0 and the stage refits through the Board ResizeObserver. L state is stored in localStorage 'wc-sidebar-closed' (replaces 'wc-feed-collapsed'; old value is ignored).
- [M3-fix-2] decision: the compact strip is a grid row between the top bar and the board (not an overlay), so it can never cover the action panel or step bar; it scrolls horizontally if seats overflow rather than wrapping.
- [M4] decision: local stack ports moved from 543xx to 553xx (API 55321, DB 55322, Studio 55323, mail 55324, inspector 8093), because another local Supabase project already holds the defaults on this machine; M5's `.env` uses `http://127.0.0.1:55321`.
- [M4] decision: engine import works directly (`deno.json` → `../../../packages/engine/src/index.ts`) for both `deno check` and local serving under `supabase start`; no sync-script fallback. Production bundling is still settled by the first deploy (handoff).
- [M4] decision: system actor auth = shared secret header `x-wc-system-secret` checked (constant time) against function env `WC_SYSTEM_SECRET`; cron reads Vault `game_system_secret` + `game_function_url` (base URL, `/system` is appended). Local values: config.toml `[edge_runtime.secrets]` and seed.sql (`local-dev-system-secret`, `http://kong:8000/functions/v1/game`). Prod: `supabase secrets set WC_SYSTEM_SECRET=…` and `vault.create_secret(…)` for both names. Dedicated secret instead of the service-role key so Vault never holds full DB rights.
- [M4] decision: `awaiting_seats` (and every other denormalized `games` column, plus `game_seats` rows) is computed in SQL inside `append_events` from `new_state` (`public.awaiting_seats(jsonb)`), so it can never drift from the stored state; setup lists unsubmitted active humans only.
- [M4] decision: `games.status` = lobby | active (draft/setup/turn) | finished | canceled; `games.phase` = `phase.kind`. `game_state` is deleted on game_over and canceled; the function then rebuilds state by folding events with `createInitialState(id, games.settings)`.
- [M4] decision: creation goes through RPC `create_game` (insert row + first `append_events` in one transaction); join-code collisions (23505) retry with a new crypto-random code. `append_events` locks the `games` row (FOR UPDATE) and raises `STALE_VERSION` on a mismatch; all game RPCs/cron functions are revoked from anon/authenticated, granted to service_role only.
- [M6] decision: deploy job uses `supabase/setup-cli@v1` pinned to 2.121.0, `functions deploy game --use-api` (no Docker) and `vercel@latest` via npx; keep-alive GETs `/rest/v1/profiles?select=id&limit=1` with the publishable key daily at 06:17 UTC; vercel.json disables Git deploys via `git.deploymentEnabled: false`. Deploy job not run (no secrets yet).
- [M4] contract (additive): transport section in `types.ts`: `PROTOCOL_HEADER`, `SYSTEM_SECRET_HEADER`, `CreateGameRequest/Response`, `JoinLookupResponse`, `CommandRequest/Response`, `SystemRequest`, `GAME_CHANNEL_PREFIX`, `VERSION_BROADCAST_EVENT`, `VersionPing`, `ApiErrorCode`, `ApiError`, `ApiRoute`; SPEC §6 Write path has the route table. No event or command changes.
- [M4] decision: protocol: missing or different `x-wc-protocol` → 426 `PROTOCOL_MISMATCH` (checked before auth); `/system` is exempt so a protocol bump never needs a cron SQL change. `CommandResponse` is only `{ version }`: clients fetch their view with `?since=`. `?since` greater than the current version also returns `events: null`.
- [M4] decision: `expectedVersion` on commands is optional: with it a moved-on game answers `STALE_VERSION`; without it the function re-decides on the fresh state (5 tries). Duplicate ClaimTimeouts still fail via the engine's deadline check.
- [M4] decision: version ping = Realtime REST broadcast (`/realtime/v1/api/broadcast`) on public channel `game:<id>`, event `version`, best effort after commit; it carries only a number, so no Realtime RLS. Users are resolved with `auth.getUser(jwt)` (`verify_jwt = false` stays).
- [M4] decision: `JoinGame` is the only command a non-member may send (decided with the system actor as stand-in, name from `profiles`, userId from auth); no profile → 400 `NO_PROFILE`. Request bodies are shape-checked in `functions/game/validate.ts` before the engine.
- [M4] decision: deps: function uses `npm:@supabase/supabase-js@^2` (unused `@supabase/server` import-map entry dropped); `@wc/integration` uses `@supabase/supabase-js`, `postgres` (direct SQL for backdating and cron calls) and `@types/node`; its script is `integration` (not `test`) so `pnpm test` skips it. Tests read keys from `supabase status -o json` in a global setup and run files serially.
- [M4] decision: auth: `site_url` `http://localhost:5173`, redirect allowlist `http://localhost:5173`, `http://localhost:5173/**`, `http://127.0.0.1:5173/**` (the link carries `/g/CODE`); both templates share the subject "Your World Conquest sign-in code". The local email rate limit (2/h) didn't trigger with Mailpit, so it's unchanged.
- [M5] decision: routing is the plain History API in `App.tsx` (`online/route.ts`: `/g/CODE`, `/g/CODE/replay`, plus `/g/CODE/stats` for the stats screen); no router library. Home and the pass-and-play screens stay a state switch. Hosting needs the SPA rewrite (M6 `vercel.json`); the PWA `navigateFallback` covers the installed app.
- [M5] decision: `GameScreen` now takes a `GameSource` interface (`src/gameSource.ts`) instead of `LocalGame`; dispatch may be async, events arrive through `subscribe`, `onChange` covers snaps. Online extras (timer slot, presence, offline banner, notice) come in as an optional `online` prop; offline disables actions via the existing `locked` state. `PlayersPanel` gained presence dots and strikes.
- [M5] decision: `OnlineGame` always sends `expectedVersion` = the version it holds (so `STALE_VERSION` reloads the view with a "game moved on" notice), then fetches `?since=`; first load uses `since=0` so the feed gets history (no animation). A snap (`events: null`) restarts the feed. Refreshes are single-flight with one follow-up.
- [M5] decision: `online/api.ts` and `online/auth/auth.ts` are framework-free and imported directly by `tests/integration/src/online.test.ts`. The client also sends `apikey` (publishable key) next to the user JWT, which the local gateway accepts.
- [M5] decision: "My games" reads `games` with embedded `game_seats` straight through RLS (members only), polled every 30 s while visible and on focus; the badge and tab title count `awaiting_seats` containing my seat. Realtime presence is keyed by user id and tracks `{seat}`.
- [M5] decision: timers: client countdown from `deadlineAt`; `ClaimTimeout` fires once `now > deadline + 1 s` and retries every 3 s while still expired; sync Skip appears for non-current active players 5 min after `lastActionAt`.
- [M5] decision: PWA: `vite-plugin-pwa` generateSW, `registerType: prompt`, `UpdatePrompt` banner; icons are generated placeholder PNGs in `apps/web/public` (replace with real art later). A 426 shows a separate "New version available, reload" banner. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`; without them the build hides the online section.
- [M5] decision: not verified in a real browser this session (no browser tool): the lobby, join page, timer and presence UI, magic-link return, and the service worker update flow need the user play-test. Deferred: rename of display name after first set (profile edit UI), changing profile name in settings.
- [orch] M5 and M6 ran in parallel (user-approved 2026-10-21; M6 in a worktree, rebased after M5 merged): M6 touches only workflows, `vercel.json` and the handoff, and the env names and engine import were already settled.
- [orch] M6 acceptance: `@action-validator/cli` accepts a single path, so the workflows are validated one per call.

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
5. **GitHub:** create a `production` environment with these secrets (exact names): `SUPABASE_ACCESS_TOKEN`,
   `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. The keep-alive workflow reuses the two `VITE_*` secrets.
   The Vercel project's Root Directory must be `apps/web`; `vercel build` runs from the repo root so `@wc/engine` resolves.
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
