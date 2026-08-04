# OzyVTT: Design Language

**Read this when:** building or changing any UI. This file holds the rules a UI change has to
obey. The settled decisions behind them, the signature motifs, motion feel, restraint rules
and the copy standard live in `design-decisions.md` — read that when you are inventing a new
surface, adding a primitive, or writing words a user will read.

A visual identity for a D&D 5e (2024) virtual tabletop. The aesthetic is
retrowave / synthwave in a magenta-to-blue range, grounded in deep indigo-black
surfaces with white and cool-grey text.

The identity lives in the system and the surface, not in literal scenery. The
things that carry it, in priority order, are: the magenta-to-blue color, the
perspective grid, neon linework (beams, edges, horizon rules), horizon and
low-poly landscape geometry, and the retro screen texture (scanlines, faint
static, subtle chromatic fringing on the wordmark only). The reference images
happened to show suns, palms, mountains, and skylines, but those objects are
not the point and should not be leaned on. A screen with no sun and no palm tree
is still fully on brand if the grid, the line, the texture, and the color are
right.

> The app and its design system are named **OzyVTT** (retrowave aesthetic codename
> "Neon Horizon" was the earlier working title). If you rename, update the
> `--brand-*` references and this heading.

---

## 0. Where this lives in the repo

- **Tokens:** `packages/ui/src/styles/design-tokens.css` is the authoritative set of values —
  color, type scale, spacing, radius, motion, `--tap-min`. This file states what each token
  *means*; that file states what it *is*. Self-hosted fonts are in
  `packages/ui/src/styles/fonts.css`. Import the barrel **once per app entry**
  (`import "@vtt/ui/styles.css";`); the entry list is `apps/client/vite.config.ts`
  `build.rollupOptions.input`.
- **Primitives:** `@vtt/ui`'s barrel is the roster — read `packages/ui/src/index.ts`, or open
  the dev-only `/styleguide` route, which renders every one with its states and a live theme
  switch. **Build from these; do not hand-roll a control that already exists.** A new
  primitive isn't done until it appears in `/styleguide`. Primitive CSS classes are
  `nh-`-namespaced.
- **Primitives never render a glyph as text** — not emoji, and not "text" symbols like
  `⚠` (U+26A0): Manrope has no glyph for it, so it silently falls back to a system
  face at the wrong size, and iOS/Android give it *emoji* presentation (a yellow
  triangle — a hue this palette does not own). An SVG glyph takes `currentColor` and
  renders identically everywhere.
- **Do not** hardcode hex values in components. If a value is missing, add a token
  to `design-tokens.css` first, then use `var(--…)`.

---

## 1. Design pillars

1. Neon is a state, not a wallpaper. Glow marks what is interactive, focused,
   selected, or live (the active turn, a targeted token, a rolling die). Resting
   surfaces stay dark and quiet.
2. Consistent moderate identity everywhere. The same restrained treatment runs
   across work screens and hero zones; hero zones are simply the boldest
   instances of it.
3. Legibility outranks vibe. Long sessions and dense stat blocks mean text
   contrast, spacing, and a sober body face win any conflict with mood. In the
   light theme this is absolute.
4. Sleek, cool, nostalgic. Clean and precise, with a nostalgic soul. Not loud,
   not playful, not warm-saturated.
5. One bold thing per view. Spend the boldness on a single signature moment (a
   glowing grid horizon on login, the glowing active-turn card) and keep
   everything around it disciplined.

---

## 2. Color

The whole system moves along one axis: magenta to violet to cyan, over a lifted
indigo/purple ground, with cool white text. Magenta leads and cyan supports (~60/40):
magenta is the primary brand and action color, cyan is selection, focus, and
positive. No green-teal. Red is permitted only as a magenta-adjacent rose for damage
and destruction.

**One deliberate exception: `--caution` is a warm orange** (ruling R8 / D21 — the reasoning
is in `design-decisions.md`). It is scoped to the caution pair and nothing else.

Semantic map (hue is a hint, never the only signal):

| Meaning | Token | Pairs with |
|---|---|---|
| Primary action / attention | `--magenta` | filled buttons, active tabs |
| Positive / heal / confirm | `--success` (cyan) | a check or plus icon |
| Caution / magic / special | `--caution` (warm orange, R8) | a warning icon |
| Damage / destroy / critical | `--danger` (rose-red) | a distinct icon and label |
| Info / neutral highlight | `--info` (indigo) | plain, low urgency |

**"Not finished" is caution, not danger.** Rose-red is reserved for damage and
destruction — an actual loss. A blocked Next, an incomplete review section, a locked
choice card: nothing has gone wrong, the flow is simply not done, so those use
`--caution`. Both the caution orange and the danger rose have a text-safe partner
(`--caution-hi`, `--danger-hi`) because the fill hue does not meet AA as small type —
use the `-hi` token for the words and the base token for edges and fills.

Text: primary `--text`, secondary `--text-dim`, muted/placeholder `--text-muted`,
and `--text-on-neon` for ink on bright fills (its value flips per theme).

Accessibility (read this): this palette is heavy in the red-pink-magenta band, the
hardest region for red-green color vision deficiency, and green is deliberately
absent. Therefore every semantic state carries an **icon and/or text label**, never
color alone; body/label text meets WCAG AA in all three themes; neon fills use
`--text-on-neon`; never put saturated magenta text on saturated cyan or the reverse.

Themes: three themes share one structure and token set; only values change — one
place, three hours. Set with `data-theme="dark|dusk|light"` on the root element
(dark is the default). By name: **night** (dark) is the default drive — deepest
surfaces, strongest texture. **The sunset hour** (dusk, reimagined 2026-08-04 —
see `decision-log.md`) is deep ember twilight, not a washed-out dark: surfaces
lift to `#251A4E…#443381`, the muted pair was retuned to `#C2BBE0`, and every
text pair *gained* contrast from the deepening (re-measured numbers live beside
the tokens in `design-tokens.css`). **Daybreak** (light) turns glow into an
accent ring, drops texture to near-nothing, and deepens neon to ink — legibility
outranks aesthetic there without exception, and the wordmark drops its chrome
fill for solid ink. (The landing's sign is the one documented exception: its
`--landing-sign` steel re-skins per theme rather than dropping to ink — night
and the sunset hour share the blue-steel ramp, daybreak's is depth-tuned for the
pale sky, and the reasoning lives beside the tokens.)

---

## 3. Typography

Four roles, tiered so the loud retro character stays contained:

| Role | Family | Where |
|---|---|---|
| Wordmark | `--font-wordmark` (Bungee) | app name + top-level view titles only; chrome-gradient fill |
| Display | `--font-display` (Russo One) | section/panel headers, dice totals |
| Body / UI | `--font-body` (Manrope) | everything functional |
| Mono / data | `--font-mono` (Space Mono) | dice notation, modifiers, coordinates, timestamps, HP |

The arcade face never sets a paragraph or a control label. Controls use the body
face. Use `font-variant-numeric: tabular-nums` on anything that updates live.

The size scale is a token ladder (`--fs-*`) in `design-tokens.css` — use a role token, never
a hand-typed `px`. Eyebrows/small-caps and display headings each have a tracking token
(`--tracking-eyebrow`, `--tracking-display`); do not track out body text, and do not hand-type
a tracking value — that is the same role rendered four slightly different ways.

**Breakpoints are a fixed ladder, not per-file taste: 760 / 650 / 560**, plus
`min-width: 850/980/1280` where a layout earns another column — 1280 (added 2026-08-04)
is the laptop rung where two-column compositions spend a 1080p width: settings, the
shared-screen controls. Full rationale in `mobile-ux.md`.
A new number means two components change shape at widths a few dozen pixels apart for no
reason — reuse a rung, or change the ladder deliberately for everyone. **The ladder is
currently violated in several stylesheets**; see for yourself before adding to the pile:
`grep -rhoE "(max|min)-width: *[0-9]+px" apps/client/src packages/ui/src --include=*.css | sort | uniq -c | sort -rn`

---

## 4. Spacing, radius, elevation, touch targets

- Spacing is a 4px-based token ladder (`--space-*`); radius is `--radius-sm/md/lg/pill`.
  Both are in `design-tokens.css`. **The square standard (2026-08-04, decision log):
  `--radius-sm/md/lg` are 0** — surfaces sit square, and big-choice surfaces wear the
  `.chamfer` cut (§9) instead of a large radius. `--radius-pill` survives for gauges:
  HP/progress bars, status pills, chips and token rings stay round. Keep writing the
  radius tokens, never a literal — reversing the ruling must stay one edit.
- Elevation, in order of preference: a lighter surface token; a 1px border in
  `--line` or a low-alpha accent; a dark ambient shadow. Colored glow is state,
  not resting elevation.

### The 44px touch-target floor (authoritative)

**The rule:** an interactive control presents a hit area of at least `--tap-min`
(44px). Phone and laptop are the same build (mobile-ux.md), so there is no
"desktop-only" control that may be smaller. This is a floor, not a size: it governs
the *hit area*, never the paint.

**Where it holds today, and how to find out.** Every `@vtt/ui` primitive meets it, which is
the main reason to compose rather than hand-roll; so does the whole Codex in both roles, and
a handful of named app controls that carry it themselves (each states its route in a comment
beside it). **Do not quote a measured count from this file — run the tool:**
`node scripts/tap-audit.mjs 375`. It is route-driven (a new address is one line), it prints
per-surface counts, and it exits non-zero if anything is sub-floor *or* any surface goes
unmeasured. Run it at 320px too: the narrower width is the worse case, not the better one.

**Known exceptions** (real, measured, and not yet fixed — do not claim otherwise):

| Control | Why it is still open |
|---|---|
| `DicePanel`'s two `<summary>` disclosures | Unclassed `<summary>` in `apps/client/src/dice/`, which has no stylesheet of its own; needs a scoped rule there. |
| Raw `<input type="checkbox">` — now exactly two: `.manual-nat20` (`encounter/EncounterPanel.tsx`) and `.integration-scope` (`integrations/IntegrationsPanel.tsx`) | A replaced element cannot take `::after`; each one needs its wrapping `<label>` to carry `min-height`. Narrowed 2026-08-03 — the monster browser's GM-only checkbox went with D2's tray-level reveal control, so this row names its whole remaining population rather than a class. |
| `.codex-graph-node` (Connection graph) | **Accepted, not deferred.** Node size is data-driven and positions are force-laid, so a 44px area per node would overlap its neighbours at any realistic density — the floor and the layout are in direct conflict, and enforcing the floor destroys the thing being tapped. Mitigated three ways: the canvas pans and zooms (a node grows into the floor when you zoom in, which is what the gesture is for), every node is also reachable as a row in Pages and from the palette, and the graph is a *view onto* the connections rather than the only way to open one. The number of sub-floor nodes is data-dependent and width-dependent — it scales with the campaign, so it is a tool output, never a constant in a document. |

An earlier version of this section quoted a single measured total for both widths and a
scope that silently excluded the player shell. It was wrong in three ways and is corrected
rather than quietly restated — which is why the numbers are gone and the command is here
instead. A measurement belongs to the tool that produces it.

Two ways to meet the floor — pick by whether growing the paint hurts:

1. **Grow the paint** (`min-height: var(--tap-min)`) where a taller control is
   harmless or better — buttons, inputs, tabs, menu triggers and items, steppers,
   disclosure summaries, choice cards, step jumps, name-field suggestions.
   Stacked lists (menus, disclosure rows) **must** use this — overlapping invisible
   extensions in a vertical list steal their neighbours' taps.
2. **Grow only the area** with the `.tap-target` utility, which centres a
   `--tap-min` box on the control via `::after`. Use it where the light visual
   weight is the point — small buttons, icon buttons, segmented options, switches,
   chip removes, toast and modal closes. Never on a control that already uses `::after`
   for a visual (the active tab's underline) — give those a `min-height` instead.

**Route 2 has a gap budget.** A `::after` box overhangs the paint by
`(44 − paint) / 2` per side, so **neighbouring controls must be gapped by at least
the sum of their overhangs** or the later sibling silently steals the earlier one's
taps. Worked examples live in the codebase — `.nh-card-tools`, a pressable-chip row,
and `.encounter-map-tools`, which gets away with a small gap only because its paint is
already close to the floor. That last one is why the map toolbar sizes its `IconButton`s
UP to 2.5rem (`scene/encounter-map.css`) instead of taking the primitive's 2.25rem: the
2px-a-side overhang fits the bar's gap, a 4px-a-side one would not.

New controls inherit this by composing `@vtt/ui` primitives. A hand-rolled control
must state which of the two routes it took. **Verify by measuring, not by eye**, and
not with `getBoundingClientRect()` alone — that misses the `::after`. At a 375px
viewport, take `max(rect.height, parseFloat(getComputedStyle(el, "::after").height))`,
and confirm the area is genuinely reachable by walking `document.elementFromPoint`
outward from the control's centre until it stops returning the control.

---

## 5. Components (see `@vtt/ui` + `/styleguide`)

- **Buttons.** Primary: magenta fill, `--text-on-neon`, no glow at rest; hover
  lifts to `--magenta-hi` + `--glow-drop-magenta`. Secondary: transparent, 1px
  `--line-strong`, hover fills `--surface-3` with a low-alpha cyan border. Ghost:
  text only. Destructive: `--danger` border/text, fills on hover (`--glow-drop-danger`),
  always labelled. Primary and destructive wear the chamfer cut (§9) — except `sm`
  buttons, whose `.tap-target` hit area the cut would clip — so their glow rides
  drop-shadow filters and their focus ring is inset. One primary action per view;
  labels are sentence case, body face.
- **Inputs.** Well `--surface-3`, 1px `--line`, `--text-muted` placeholder. Focus
  shifts the border to `--cyan` with a soft `--glow-cyan` (the main place cyan
  appears in a resting form). Validation uses icon + text.
- **Panels.** `--surface-1`, 1px `--line`, `--radius-md`. Optional 2px top accent
  hairline to label a kind (magenta = combat, cyan = notes). No glow at rest.
- **Modals.** Native `<dialog>` + scrim blur, `--surface-2`, `--radius-lg`, one
  top accent hairline, one primary action, focus return.
- **Tabs.** Rest `--text-dim`; active `--text` with a 2px `--magenta` underline
  (or left bar) and a faint steady glow.
- **Tooltips / chips.** Tooltip `--surface-2`, `--line`, small, no glow. Condition
  chips: pill, `--surface-3`, 1px accent border by category (harmful `--danger`,
  magical/concentration `--violet`, beneficial `--cyan`), each with an icon +
  short label so category reads without color.
- **Selected vs hover.** Hover owns the surface lift (`--surface-2`); selection owns
  the edge, the glow, and the check mark. A selected state must never take hover's
  fill, or "the pointer is here" and "this is my answer" become the same pixels.
- **Disabled.** Dim **per property** — `color`, `border-color`, `background` — never
  with a group `opacity`. Group alpha composites the whole subtree, so a child cannot
  opt back out of it (`.child { opacity: 1 }` inside an `opacity: .55` parent is a
  no-op), and the one thing a disabled control most needs to say — *why* it is
  disabled — is exactly what gets dimmed below AA. The reason text stays at full
  strength in `--caution-hi`.

---

## 6. Building new UI on this system (checklist)

1. `import "@vtt/ui/styles.css"` at the app entry (already done for every existing entry);
   reference `var(--…)` tokens, never hex.
2. Compose from `@vtt/ui` primitives; if you need a new one, add it to `@vtt/ui`
   (with `nh-`-namespaced CSS) and to `/styleguide`, not inline in a feature.
3. Run the restraint checklist in `design-decisions.md`; verify AA contrast in all three
   themes; confirm reduced-motion and reduced-transparency behavior.
4. Meet the 44px touch floor (§4) and say which route you took.
5. For a UI-affecting change, look at it running (`npm run dev`) at a desktop
   width and a narrow/touch viewport, and cycle the themes.
6. If you are writing words a user reads, `design-decisions.md` §Voice and copy is the
   standard, and two locks fail the build on a retired word off one shared scanner
   (`apps/client/src/copy-scan.ts`): `codex/vocabulary.test.ts` for the Codex, and
   `apps/client/src/play-vocabulary.test.ts` for everything else.

## 6b. Adding a new play surface (the seven lines that stop re-fragmentation)

A new surface is where a design system quietly forks. Most of this list is already a test —
the point of writing it down is that you meet the checks on purpose instead of discovering
them, and that the two steps no test can demand are remembered.

1. **Words from the glossary** (`design-decisions.md` §Voice and copy). `play-vocabulary.test.ts`
   scans everything under `apps/client/src` minus a pinned exclusion list, so your new directory
   is scanned the moment it exists — there is no list to join.
2. **Compose from `@vtt/ui`.** A new primitive goes to `packages/ui` *and* to `/styleguide`; the
   completeness check fails on an export with no demo. A hand-rolled lookalike fails
   `design-conventions.test.ts` (glyphs, raw inputs, `.eyebrow`, hex, inline feedback).
3. **Every "who sees this" decision is the Reveal family** — `RevealSwitch` / `VisibilityBadge`
   from `@vtt/ui`, never the words re-typed. Feedback is a toast, not a per-component banner.
   Confirms use the verb triad and mean it.
4. **Give it an address**: the router table, the `router.test.ts` lock, **and one line in
   `scripts/tap-audit.mjs`'s route list** — that last one is the step no test can demand, which
   is why it is written here.
5. **Breakpoints from the ladder** (§3). An off-ladder query fails with the nearest rung named.
6. **A narrow-viewport and touch pass before you call it done** (§4, `mobile-ux.md`).
7. **Docs in the same commit** — the brief whose behaviour you changed, and the ledger.
8. **The surface fits the locked viewport and declares its scroll regions** (§7). The page
   never scrolls; every region either fits or scrolls itself via `.scroll-y`. Run
   `node scripts/no-scroll-audit.mjs` against your route at 1280×720-class and 390×844
   before calling it done. *(Status: standard adopted 2026-08-04; the shell lock is in
   force — the body is locked and `<main>` is the frame — so no surface can scroll the
   document; a surface not yet recomposed scrolls one staged `.pane-stage` region until its
   phase lands. The ratchet checks and the route audit are in repo — §10.)*

---

## 7. Layout — THE SCREEN IS THE PAGE

> **Status: adopted 2026-08-04 (decision log); the shell is locked (refresh phase A1).**
> `body` holds `height: 100dvh; overflow: hidden` and `<main>` is the frame
> (`apps/client/src/styles.css`); the standalone shared-screen viewer
> (`apps/client/src/viewer/viewer-page.css`), the standalone sheet entry and the
> Modal/Drawer primitives were already conforming. **The document never scrolls; a surface
> not yet recomposed scrolls one temporary pane region** (`.pane-stage` + `.scroll-y`,
> phase-tagged per wrapper in `apps/client/src/main.tsx`) until its phase lands. Sections
> marked *(refresh)* below describe the standard those surfaces adopt as B/C implement them.

**The law.** The app page never scrolls. A surface is a **frame** (chrome that never moves:
tab bar, headers, toolbars, transport rows) plus **regions**, and every region either fits
its box or scrolls *itself*. There is no third option; "the page grew" is a defect. The
landing proved the feel; the shared-screen viewer has run this way since it shipped — the
standard is a promotion of what already works, not an invention.

**Targets.** One build, two postures. Laptop: 16:9, 1080p-class — compositions must spend
the **width** (rails, docks, side columns), because locking the height while keeping one
narrow centre column just hides the same content behind an internal scrollbar. Phone:
390×844-class portrait — compositions spend the **height**; width collapses per the ladder
(§3). Floors: width 320px (already declared on `body`); height **600px** *(refresh)* — below
it the frame stays fixed and regions scroll harder, and nothing may become unreachable.

**The vocabulary.**

- **Frame** — never scrolls, never shrinks below its intrinsic height. The app shell's frame
  is `[connection strip when present][tab bar][content pane]` — a 100dvh grid in
  `apps/client/src/styles.css`; the strip is grid row 1 and height-animates in (the old
  `position: fixed` strip and its `:has()` padding dance retired with the lock).
- **Region** — a box inside the frame. A region that can outgrow its box carries `.scroll-y`
  (`packages/ui/src/styles/design-tokens.css`) — the one blessed scroll treatment: quiet thin
  scrollbar, `scrollbar-gutter: stable`. *(refresh: `.scroll-y` becomes the mandatory marker;
  a bare `overflow-y: auto` in app CSS is the tell of an undeclared region.)*
- **Canvas** — the one region per surface that flex-fills leftover space (`flex: 1;
  min-height: 0`): the map stage, the codex main pane, a wizard's step body. The map's
  enlarged/docked modes and the viewer's stage are the proof this works.
- **Wide content** — tables, level grids, tab strips, folder chips — always its own
  `overflow-x` container. The locked page never scrolls sideways either.

**Composition rules.**

1. One primary scroller per pane. Nested same-axis scrollers only across a frame boundary
   (a modal over a page, a drawer over a pane) — never two siblings guessing.
2. The `NNvh`/fixed-rem internal cap idiom (19rem roll list, 16rem log, 40–94vh caps — the
   codebase's pre-standard substitute for a frame) converts to `flex: 1; min-height: 0`
   inside a real column *(refresh — the census enumerates every site)*. A leftover cap
   inside a locked frame reintroduces double-scroll.
3. Anchors and `scroll-padding` belong to regions, not the root: the
   `html { scroll-behavior… scroll-padding-top }` recipe is retired from the shared tokens —
   the styleguide entry keeps its own copy (`styleguide.css`), and scrolling regions declare
   their own padding (the wizard layer and `.pane-stage` do). `--header-h` retired with it.
4. Density: `comfortable` rows are ≥44px (`--tap-min`) and the default everywhere;
   `compact` (36px paint, `.tap-target` route 2) exists only inside GM data regions
   (initiative rows, level tables, log lines) and never on a phone *(the pair is the
   `--row-h`/`--row-h-compact` tokens; components adopt them as they recompose)*.
5. Keyboard: a focused input inside a locked region must stay visible above the on-screen
   keyboard — the region scrolls to it; the frame never moves. A shell-level `focusin`
   helper (`apps/client/src/main.tsx`) nudges the focused field into view within its own
   region, and regions carry `scroll-padding` + safe-area bottoms (`.pane-stage`, the
   wizard/Modal practice). iOS/Android remain unverified on device (GAP-001).
6. Gestures: `touch-action: none` on draggables stands (mobile-ux.md). New rule — once a
   draggable's *container* scrolls, re-verify drag-vs-scroll at 390px; a drag that used to
   rubber-band the dead page now fights a live scroller.
7. Motion at the view level: tab swap = `anim-view` (200ms settle) — **opacity-led at the
   pane** (`pane-in`, styles.css): an animated transform there is a containing block that
   traps `position: fixed` overlays, the Blink lesson the old `.table-layout` fill-mode
   patch learned one arm at a time. The landing→app entry transition (dip → cascade) is
   one-shot state in `main.tsx`, its classes dropped when it settles. Layer push =
   `sheet-up`/`dialog-in`; drawers = `--ease-drawer`; the ignition flicker stays the
   landing's. Nothing moves on scroll; reduced-motion freezes (or skips) all of it — the
   arcade feel comes from *placement snapping into a frame*, not parallax.

**Layout tokens** *(in `design-tokens.css` §Layout since 2026-08-04, seeded from the live
values they replace)*: `--app-bar-h` (the tab bar row), `--pane-gap` (frame gutter),
`--rail-w` (nav/list rails, 220–280px), `--dock-w` (the table's side dock, 22rem),
`--row-h`/`--row-h-compact`. Consume these; do not invent siblings ad hoc. (`--header-h`
and its one consumer, the root scroll recipe, retired when the shell locked.)

---

## 8. Surface blueprints *(refresh)*

> How each surface recomposes under §7. Grades from the measured census (2026-08-04, in the
> engagement record): **trivial** = wrap the existing content in one declared region;
> **recompose** = re-place existing pieces into a frame; **redesign** = the pieces themselves
> change. Reference implementations (already conforming, adopt-don't-rebuild): landing ·
> shared-screen viewer · wizard layer · Modal/Drawer · the map's docked/enlarged/fullscreen
> modes · every capped picker list.

| Surface | Grade | Frame | Regions (scroll marked ▤) |
|---|---|---|---|
| App shell | **done (A1)** — unlocked all below | connection row · tab bar | content pane (canvas for the active surface; unconverted surfaces ride a staged `.pane-stage` ▤ until their phase) |
| Table, GM — laptop | recompose | tab bar · scene row · party strip | **map canvas** (flex-fill; the `72vh` cap and the `--setup-h` map-measuring plumbing retire) · side dock: turn tracker ▤ / dice ▤ / log ▤ — one flexes, the others collapse (the in-combat `<details>` idiom, made deliberate) |
| Table, GM — phone | **redesign** | tab bar · slim scene/party row | map as a fixed **band**; beneath it one tabbed sheet: Turn ▤ / Dice ▤ / Log ▤ (three stacked panels cannot share 844px with a map) |
| Table, player | recompose / phone follows GM pattern | tab bar · YouArePlaying | claim picker or sheet pane ▤ · map canvas · shelf ▤ |
| Feed panels | trivial | — | roll list ▤ and log list ▤ go `flex:1` inside the dock |
| Scenes gallery | **done (A2)** | heading · command bar | card grid ▤ — the region is the grid's WRAPPER, never the grid (a grid with a definite block size stops sizing its auto rows from its cards); ≤560 goes two compact columns instead of 1:1 squares; the ⋯ menu's Move earlier/later is the reorder route a scrolling grid cannot autoscroll to |
| Scene prep / staging | trivial | — | already capped lists; rides the table dock |
| Maps library + calibration | **redesign** | back · heading · upload row | list rail ▤ · calibration pane: the long top-to-bottom sequence becomes a step layout (mode → canvas → fields → verify) with the interactive canvas always visible |
| Roster | **done (A2)** | heading · actions | queue + gallery + archived ▤ (cards take a 15rem cell so a claimed character's three actions fit; the archived `<summary>` carries the 44px floor) |
| Codex shell | recompose | its own top bar | sidebar (sticky already) · main pane ▤ — per-view `NNvh` caps convert; the body editor owns its height (`resize: vertical` retires) |
| Homebrew | recompose | modebar | rail ▤ (already) · record detail ▤; level table keeps its own x-scroll inside |
| Settings | **done (A2)** | heading | the group column ▤; at ≥1280 it is two columns — The table \| Mine + Players — so a 1080p width is spent instead of scrolled |
| Shared-screen controls | recompose (light) | heading | two columns ≥1280: tools (preview pinned visible) ▤ · access ▤ |
| Replays list | **done (A2)** | heading (the player's Back to the table is a row in it) | the rows ▤ — the list is the surface now, not a `.card`, so the rows are the cards standing on it |
| Replay viewer | recompose | header · transport | stage canvas · side lists ▤ (phone: side lists become tabs) |
| Builder / level flow | **done (A2)** | wizard head/foot | step body ▤ — the scroller moved from the layer to `.nh-wizard-body` (`.scroll-y` in the primitive's markup), the footnote rides the step, and the detail pane sticks to the region's top |
| Sheet layer | **done (A2)** | sheet header · rollbar · page actions (a bottom row **inside** the sheet — they were the whole of this route's overflow) | sheet pane ▤ (`.scroll-y` in the markup, all four presentations) — `sheet.html` passes no page actions and keeps its 100dvh column |
| Player `/replays` | **done (A1)** | — | the replay list alone — the `main.tsx` view condition excludes the table now (the census's stacking anomaly); the audit's player `/replays` row is its regression check |
| Landing / viewer / sheet entry | done | — | — |

---

## 9. What the landing taught the system *(status: in force as shared utilities since 2026-08-04)*

- **Glass tiers.** Two named tiers of one treatment, both in `design-tokens.css`:
  `.surface-frost` (chrome tier, over app surfaces) and `.surface-glass` (scene tier,
  panels standing on a canvas — a live map, a sky; the landing's `--landing-glass` is its
  scene-local ancestor). Both go solid under reduced transparency. Do not grow a third.
- **The sky is for content-light surfaces, and it is a LITERAL sky** *(reversal, 2026-08-04 —
  this bullet used to read "no sun, no horizon, no stars"; the decision log carries the dated
  entry)*. `.pane-scene` + a `.pane-sky` child + `.scanlines` (`apps/client/src/styles.css`)
  paint the drive: a tiled starfield, a sun cresting a lit horizon, and a receding perspective
  grid floor, all off `--sky-*` tokens with no hand-typed colour, so night, the sunset hour and
  daybreak come free. Settings, the roster, the scenes gallery and the replays list stand on it;
  **the table never does** (texture only — a horizon behind a battle map competes with the map,
  and the map is the canvas). Three rules make it a work screen rather than a title screen, and
  each one is load-bearing:
  - **The horizon is a fixed inset from the pane's bottom** (`--sky-horizon-inset`, 7rem /
    5.75rem ≤760px), never the landing's percentage — a percentage drifts up into content as the
    pane grows. Every other layer is measured against that one number.
  - **The sun is a crest, not a disc** — and the crown is **exactly half the diameter**, so what
    stands above the line is a hemisphere. Its box is only the crown and `--sky-sun-mask` cuts
    that to the top of a circle centred on the line, so the landing's clipping sky band and its
    slat gradient are both unnecessary — the horizon does the cutting and the hidden half is
    exactly the slatted half. `--sky-sun-d` is **derived** (`calc(--sky-sun-crown * 2)`) rather
    than typed: the first cut set the two independently and the mask's cap flattened into a
    chord — a measured 394×54px slab, 8.8% taper, hard vertical sides. Two numbers that must
    hold a ratio should not both be typed.
  - **The bright band is RESERVED.** Row-scanned over every pixel of the bare sky for a run of
    ≥4 consecutive failing pixels, the band failing AA for `--text-muted` is ≤157px at 1920×1080
    and ≤130px at 390×844 in all three hours, so `.pane-scene > .scroll-y` pads
    `--sky-horizon-inset + --sky-sun-crown` (176px / 144px) at the bottom — taller by 19px and
    14px. Legibility is a structure, not an opacity dial: a surface that adds bare copy inherits
    it. **The run rule is the caveat and it is load-bearing:** it sets point features aside. A
    star is one 1–1.5px near-white dot, it can land anywhere in the pane, and no bottom reserve
    can bound it — per-pixel, the failing band is the whole pane in night and the sunset hour
    (0 in daybreak, where `--sky-star` is transparent). The residual is narrower than a glyph
    stem; if it ever needs answering the answer is `--sky-star`'s alpha, not a taller reserve.
    Read the guarantee as "no *band* of unsafe sky above the reserve", never as "every pixel".
  Never put `transform`, `filter`, `backdrop-filter`, `perspective`, `will-change` or
  `contain: paint` on `.pane-scene` — any one makes it the containing block for every fixed
  overlay. The floor's perspective is on a pseudo-element inside the clipped `.pane-sky`, which
  also stops its ~500px-per-side spill from growing `document.scrollHeight`. Under reduced
  transparency the wash and horizon stay (they are what tells the hours apart) and the floor and
  sun go. `.surface-glass` is worn by settings' panels alone today — the other three put plain
  `.nh-card`s on the sky, because a gallery of cards reads as glass-on-glass when every card is
  translucent. Whether those three should take the tier is an open look question, not a settled
  rule. An empty state on such a surface is a scene moment, not a dashed box:
  `.scene-empty` is one line and, where there is an action to offer, one chamfered primary
  door (a surface that fills itself, like the replays list, offers none).
- **Scanline tile.** A full-viewport `repeating-linear-gradient` rasterizes unevenly; the
  landing found it and the shared `.scanlines::after` utility now paints the same one-gap
  `background-size` tile the landing does (`apps/client/src/styles.css`, documented at
  both rules).
- **Noise opacity is a token.** `--landing-noise-opacity` re-skins the landing per theme;
  the shared `.static-noise` reads `--noise-opacity` the same way.
- **Clipped panels glow via `drop-shadow`.** `box-shadow` cannot follow a `clip-path`
  chamfer, and neither does the outer focus ring — a chamfered control's focus is an
  INSET outline. The door treatment is generalized as the `.chamfer` utility +
  `--chamfer-cut` polygon + the `--glow-drop-*` filter twins of the glow set: for
  panels, cards, feature tiles, status tags and the primary/destructive buttons
  (`Button.css`; `sm` buttons exempt — the cut would clip their `.tap-target` hit area).
  Never on a control that relies on `.tap-target`.
- **Role rims** *(built 2026-08-04)*. Magenta is the player's, violet is the GM's:
  `--rim-player` / `--rim-gm` (+ washes and drop-shadow glow twins) and the `.rim-player` /
  `.rim-gm` utilities. Worn by the two tab bars — frame row 2 is on screen on every route in
  both roles, and the two roles' bars were otherwise identical — and by the two GM-only settings
  groups, which tells the GM which half of a page a player is never handed. **The rim attaches to
  the GM-SECRET TREATMENT** (the 3px start edge + faint wash that `.scene-preview-banner`,
  `.party-queue`, `.scene-builder` and the codex's GM blocks already wear), **never to a claim
  that the hue means GM** — §2 assigns `--violet` to magical/concentration and ~50 rules use it
  for NPC strokes, condition dots, legendary actions and presence. A rim is never the only
  signal: every site that wears one names its role in words a screen reader reaches. Keep rims
  off selection state, whose axis is cyan. The edge is an **inset box-shadow**, not a border:
  this file loads before every app stylesheet, so a shared `border-inline-start` loses at equal
  specificity to a consumer's own `border` shorthand (measured — both rim sites computed
  `border-left-width: 0px`), and a shadow also costs no layout and does not scroll away inside
  the tab bar's own x-scroller.
- **The sign principle** *(built 2026-08-04)*. A hero title wears a metal the scene does not
  (blue-steel on the magenta drive) and carries legibility in its chrome *structure*, not an
  outline. `--sign-chrome` / `--sign-stroke` / `--sign-glow` + the `.sign` utility. Reserved for
  a full-page moment that IS the screen — the landing today, and no second call site in play.
  **Never a panel header**, never a section heading, never `.nh-panel-title`: one edit there puts
  the metal on every panel in the app and it stops meaning anything. The values deliberately
  duplicate `--landing-sign`/`--landing-stroke`/`--landing-title-glow`; the landing should alias
  them once the entry-animation lane lands.
- **Neon linework** *(built 2026-08-04)*. The sky's horizon, lent to the chrome:
  `--rule-beam` / `--rule-beam-v` / `--rule-beam-glow` (derived from `--cyan`/`--magenta`, so
  daybreak's deepened inks come free) and the `.neon-beam` utility, which draws a 1px lit rule on
  an element's bottom edge. **It is scene language, not state language,** and that is the whole
  restraint — pillar 1 keeps neon for what is interactive, focused, selected or live. A beam
  marks a STRUCTURAL boundary only: the four scene surfaces' heading row against their region,
  and the table dock's inner edge (`--rule-beam-v` through `border-image`, the one boundary on
  that surface where the map stops and the panels begin). It never lands on a control, never
  marks a state, and never replaces a resting `--line` border just because one was there — which
  is why it runs at about half the horizon's intensity and its glow is a whisper. The app's two
  tab bars also take the **chrome-tier** scanline: `--scanline-color` is the chrome strength
  (.22/.14/.05) and `.scanlines` halves it with `opacity: .5` for the scene tier, so the sky sits
  at .11 and the bar at .22 — two strengths of one texture, and daybreak drops both.

---

## 10. Enforcement & migration *(in force since 2026-08-04 — nothing here weakens an existing check)*

- **In repo:** `scripts/no-scroll-audit.mjs` — a real GM login and a real player join, then
  the route × role table (19 rows: landing, viewer entry, every GM address including
  resolved `/replays/:id` and `/characters/:id(/level)`, the player's four) at 1280×900,
  1280×720 and 390×844, failing (exit non-zero) on any document scroll, either axis, or any
  unmeasured route. Scripted-manual on the same terms as `tap-audit.mjs` (needs a browser
  and a live dev server, honestly outside vitest) — `docs/ai-context/testing.md` has the
  row. The A1 shell lock took the whole table green — unconverted surfaces scroll a staged
  pane region, not the document — so any red cell is a regression; the (g)/(h) ratchets
  below carry the remaining conversion debt.
- **Static checks (in repo, ratchet style):** `design-conventions.test.ts` — **(g)**
  viewport units in app CSS: `100dvh`/`100svh` and paired/`:fullscreen` `100vh` are
  structural; every other occurrence answers to a reasoned `VIEWPORT_CONFORMING` row or a
  phase-tagged, shrink-only `VIEWPORT_LEGACY` row (target 0); **(h)** declared scroll
  regions: a bare `overflow(-y): auto|scroll` in app CSS must be a `SCROLL_ALLOW` legacy
  site (shrink-only, target 0 — the end state is every region carrying `.scroll-y` in
  markup). Both follow the `design-conventions-shape.ts` pin discipline.
- **Phase order (the refresh):** A — the shell lock + every *trivial* surface (one
  commit-sized region each); B — the *recompose* surfaces (table laptop, codex, homebrew,
  replay viewer, viewer-controls); C — the two *redesigns* (table phone, map calibration).
  The checks and audits above landed at A's foundation; docs and ledger move per commit,
  as always.
- The styleguide's Layout sections mirror §7–§9 for authors; the census and the refresh
  plan live in the engagement record until implementation, then their durable facts land
  here.
