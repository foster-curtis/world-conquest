# World Conquest brand kit: implementation guide

For the agent applying this brand to `foster-curtis/world-conquest`. Every
decision below is final; nothing here needs a judgment call about style.
Where the repo disagrees with this file, this file wins. SPEC.md gets updated to
match (step 9).

The full brand book with live component previews is the "World Conquest" design
system artifact. This README is self-sufficient; you don't need it to do the work.

## The brand in five rules

1. **One dark theme.** No light mode, no toggle, no `prefers-color-scheme` branch.
   Light values are noted at the bottom of `brand.css` for later; don't wire them.
2. **Amber (`--accent`) means "you / act now".** It marks your turn, your selected
   territory, staged reinforcements and the one button that advances your phase.
   It is never decoration, never a player color, and never used for focus rings.
   At most one amber fill on screen at a time.
3. **Every color comes from a token.** No hex literals outside `styles/brand.css`,
   `board/colors.ts` (which mirrors the player tokens for SVG) and the email
   templates (which can't use CSS variables).
4. **Geist for words, JetBrains Mono for numbers.** Army counts, dice, timers,
   join codes, card and territory counts use `.num` (mono, tabular, 600).
5. **Flat.** No gradients, no glows. Use at most one subtle shadow, on floating
   overlays only (dice, modals). Elevation is `--background` → `--surface` →
   `--surface-strong`, separated by `--border`.

## Where each file goes

The kit mirrors the repo layout. Copy each path to the same path in the repo.

| Kit path | Action |
|---|---|
| `apps/web/src/styles/brand.css` | New file. Import it in `main.tsx` before `styles.css` (step 2). |
| `apps/web/src/board/colors.ts` | Replace the existing file. |
| `apps/web/public/favicon.ico` | New. 16/32/48 in one file; the 16px frame is pixel-snapped. |
| `apps/web/public/apple-touch-icon.png` | Replace. |
| `apps/web/public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Replace. The maskable one keeps the mark inside the 80% safe circle. |
| `apps/web/public/brand/*.svg` | New. Masters for in-app logo use (`mark.svg`) and future exports. |
| `apps/web/public/brand/email-mark.png` | New. The emails load it from `{{ .SiteURL }}/brand/email-mark.png`, so it must deploy at that path. |
| `supabase/migrations/20261021120000_brand_colors.sql` | New. Adds a check constraint for the new color IDs; converts nothing (pre-launch). |
| `supabase/templates/magic_link.html`, `confirmation.html` | Replace. Subjects in `config.toml` stay as they are. |

**Don't add an SVG favicon** (`<link rel="icon" type="image/svg+xml">`). Browsers prefer it
over the `.ico`, and the angled mark blurs at 16px in a tab.

## Implementation order

### 1. Head and PWA

`apps/web/index.html`:

```html
<meta name="theme-color" content="#14161a" />
<meta name="color-scheme" content="dark" />
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

`apps/web/vite.config.ts`, inside `VitePWA`:

- `includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'brand/*.svg']`
- `manifest.background_color` and `manifest.theme_color`: `'#14161a'`
- `manifest.description`: `'Take the map with your friends, one turn at a time.'`
- `workbox.globPatterns`: add `woff2`, giving `'**/*.{js,css,html,svg,png,json,woff2}'`.
  Without it, pass-and-play loses its fonts offline (SPEC 9.5).

### 2. Fonts and tokens

```sh
pnpm --filter @wc/web add @fontsource-variable/geist @fontsource/jetbrains-mono
```

`apps/web/src/main.tsx`, before any other CSS import:

```ts
import '@fontsource-variable/geist';
import '@fontsource/jetbrains-mono/600.css';
import './styles/brand.css';
import './styles.css';
```

### 3. Retire the old variables in `styles.css`

Delete the old `:root` block (except `--bottom-h`, which is layout) and rename
every usage:

| Old | New |
|---|---|
| `--ink` (text) | `--foreground` |
| `--muted` | `--muted` (same name, new value) |
| `--bg` | `--background` |
| `--card` | `--surface` |
| `--line` | `--border`; use `--border-control` on inputs and secondary buttons |
| `--ocean` | `--sea` |
| `--accent` | `--accent` (now amber; see the rules for where it may appear) |
| `--danger` | `--danger` |
| `--warn-bg` | `--warning-bg`, with text in `--warning-text` |
| `--radius` (10px) | `--radius-card` for panels, `--radius` (6px) for controls |
| `font-family: system-ui…` | remove; inherited from `brand.css` |

Then replace every remaining literal color in `styles.css` and in the `.tsx`
files (`Hud`, `Board`, `Stats`, `Lobby`, `OnlineHome`, `Replay`, `SetupScreen`,
`PassScreen`):

| Literal(s) today | Token |
|---|---|
| `#fff` backgrounds, `#f3f4f6` (kbd) | `--surface` / `--surface-strong` |
| `#111827`, `#1f2937` text or strokes | `--foreground` (on board strokes, see step 5) |
| `#9ca3af`, `#9aa8b8` (hover borders) | `--muted` |
| `#2563eb`, `#1d4ed8`, `#eff6ff` (blue accent, toggled state) | `--accent` fill, or `--accent-subtle` background with `--accent-text` |
| `#dc2626`, `#b91c1c` | `--danger` |
| `#16a34a` | `--success` |
| `#f59e0b`, `#92400e` | `--warning-text` on `--warning-bg` |
| `rgb(15 23 42 / 35–45%)` scrims | `--scrim` |
| `rgb(0 0 0 / 15–25%)` dot outlines, shadows | `--border` for outlines; shadows stay on floating overlays only |

When done, this should return only `brand.css`, `colors.ts` and the email templates:
`grep -rnE "#[0-9a-fA-F]{3,6}\b|rgb\(" apps/web/src supabase/templates`

### 4. Components

- **Buttons:** 14px Geist 600, `--radius`, min-height stays 40px. Default buttons are
  `--surface-strong` with a `--border-control` border. `.primary` is `--accent` with
  `--accent-on` text, reserved for the action that advances the turn (End attack,
  Place armies, Start game). Disabled keeps the 0.45 opacity. Toggled (`.on`) uses
  `--accent-subtle` background with a 1px `--accent` inset ring.
- **Danger buttons** (Attack, Resign, Kick): `--danger` with `--danger-on`.
- **Inputs:** `--surface` background, `--border-control` border, `--radius`.
- **Panels, sidebar, drawer, dialogs:** `--surface`, 1px `--border`, `--radius-card`.
- **Your-turn state** (step bar or turn header): full `--accent` fill with
  `--accent-on` text when it's the viewer's turn; `--surface` otherwise. This is
  the loudest element in the game, on purpose.
- **Player strip and player list:** the current player's row gets a 2px `--accent`
  outline. Eliminated players are dimmed to 0.45 opacity. Online dot is
  `--success`, away is `--presence-off`.
- **Headings:** Geist 600 with `letter-spacing: -0.025em` (set in `brand.css`).
  Home title 48px, screen titles 30px, panel titles 18px.
- **Join codes:** `.num`, `letter-spacing: 0.15em`.
- **Copy voice:** plain and short. "Your turn", "Attack from Alaska", "Kai is away",
  log lines past tense with the subject first ("Mara took Brazil"). Digits for numbers.

### 5. Board

| Element | Style |
|---|---|
| `.ocean` | `fill: var(--sea)` |
| Coastline | If the SVG has a land-outline layer, give it `stroke: var(--coast)` at 1.5px under the territories. If not, skip it. |
| `.shape` (base) | `fill` from `COLOR_HEX`; unowned territories use `--land` (replace `#e8edf2` and `#dfe5ea` in `Board.tsx`). `stroke: var(--land-border)`, 2px. |
| `.shape.candidate` | `stroke: var(--foreground)`, 2px |
| `.shape.source` | `stroke: var(--accent)`, 3.5px |
| `.shape.target` | dashed `7 4` at 2.6px, `--danger` in the attack phase, `--foreground` in fortify |
| `.shape.dim` | opacity 0.35 |
| Sea-route lines | `stroke: var(--sea-link)`, keep the dash |
| Badge disc | `fill` = owner color (unowned: `--land`), `stroke: var(--land-border)` 2px, count in `COLOR_INK[owner]` with the `.num` font |
| Badge initial chip | `fill: var(--background)`, `stroke` = owner color 1.5px, letter in `--foreground`. Keep the player-name initial (SPEC 7.1). |
| Staged `+N` chip | `fill: var(--accent)`, text `--accent-on`. Staged armies are yours. |
| Focus ring on a badge | `--foreground` |

Rebuild `board.svg` only if `tools/map-build` bakes colors into it. If fills are set
at render time, leave the asset alone.

### 6. Player colors: engine and data

The old color IDs are replaced outright. The game hasn't launched, so there's no data
to convert and no legacy IDs to support; don't add any translation or fallback code.

New IDs: `crimson`, `cobalt`, `jade`, `berry`, `bone`, `sky`, plus `gray` for the
neutral seat (unchanged). There is no yellow, because amber is the accent, and no
black, because it disappears on the dark board.

1. `packages/engine/src/types.ts`:
   `type Color = 'crimson' | 'cobalt' | 'jade' | 'berry' | 'bone' | 'sky' | 'gray'`.
2. `packages/engine/src/decide.ts`:
   `SEAT_COLORS = ['crimson', 'cobalt', 'jade', 'berry', 'bone', 'sky']`.
3. `supabase/functions/game/validate.ts`: replace the `COLORS` list with the seven new IDs.
4. `local/SetupScreen.tsx` defaults: Player 1 `crimson`, Player 2 `cobalt`.
5. Replace every remaining old color literal (`'red'`, `'blue'`, `'green'`,
   `'yellow'`, `'purple'`, `'black'`) in engine tests, `testing/sim.ts` and
   web tests. `pnpm typecheck` will flag any you miss, since `Color` no longer
   accepts them.
6. Run the migration (`supabase db reset` locally clears any dev games with old IDs).
   Pass-and-play saves made on a dev machine before this change won't load. Clear
   the site's IndexedDB rather than adding compatibility code.

### 7. Emails

The two templates are finished. They use only inline styles, a dark ink layout,
and the code in a mono box with one amber button. Copy them over. Two things to check:

- `email-mark.png` must be deployed at `/brand/email-mark.png` on the site URL.
  Locally, `{{ .SiteURL }}` is `localhost:5173`, so the logo won't load in a real
  inbox during local testing. That's expected.
- Keep `{{ .Token }}` and `{{ .ConfirmationURL }}` exactly as written.

### 8. Verify

- `pnpm check && pnpm typecheck && pnpm test`.
- The hex `grep` from step 3 returns only the three allowed locations.
- Open the app. The tab shows the four-cell mark with the amber cell at the top right.
  Pass-and-play still loads offline after a reload with the network off.
- Start a new pass-and-play game with six players. The picker shows crimson, cobalt, jade, berry, bone and sky in that order, and a two-player game's neutral seat renders as gray land.

### 9. Update SPEC.md

- §7.1 Visual style: replace with "Dark, flat: ink ground, solid territory fills
  in owner color with dark gutters, neutral-gray coastlines, Geist and JetBrains Mono.
  One theme (dark) for v1. Amber is reserved for the current player's turn, selection
  and primary action." Keep the color-blind bullet.
- §2 Players: color list → crimson, cobalt, jade, berry, bone, sky (gray = neutral).
- §10 Deferred: "Dark mode" → "Light mode".

## Reference values

| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| background / sea / land-border | `#14161a` | | player crimson | `#c23b3b` (white text) |
| surface | `#1a1d23` | | player cobalt | `#2f63c4` (white text) |
| surface-strong | `#22262e` | | player jade | `#3fb98a` (ink text) |
| border | `#2e333c` | | player berry | `#a8327f` (white text) |
| border-control / coast | `#6b7280` | | player bone | `#e3e5e9` (ink text) |
| muted | `#9aa1ad` | | player sky | `#7cc4f2` (ink text) |
| foreground | `#ffffff` | | neutral (gray) / land | `#3a404b` (white text) |
| accent | `#e8a33d` (ink text) | | danger | `#e05252` (ink text) |
| success | `#3fb98a` | | warning | `#f2c57c` on `#2b2416` |

All text pairs are at least 4.5:1, and control borders and the coastline are at least 3:1. The six
player colors stay distinct under simulated deuteranopia, protanopia and tritanopia.
