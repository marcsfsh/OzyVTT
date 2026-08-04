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

Themes: three themes share one structure and token set; only values change. Set
with `data-theme="dark|dusk|light"` on the root element (dark is the default). In
light, glow becomes an accent ring, texture drops to near-nothing, and the wordmark
drops its chrome fill for solid ink. Legibility outranks aesthetic there without
exception.

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
`min-width: 850/980` where a layout earns a third column. Full rationale in `mobile-ux.md`.
A new number means two components change shape at widths a few dozen pixels apart for no
reason — reuse a rung, or change the ladder deliberately for everyone. **The ladder is
currently violated in several stylesheets**; see for yourself before adding to the pile:
`grep -rhoE "(max|min)-width: *[0-9]+px" apps/client/src packages/ui/src --include=*.css | sort | uniq -c | sort -rn`

---

## 4. Spacing, radius, elevation, touch targets

- Spacing is a 4px-based token ladder (`--space-*`); radius is `--radius-sm/md/lg/pill`.
  Both are in `design-tokens.css`. Avoid large soft blobs; chips and token rings may go pill.
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
  lifts to `--magenta-hi` + `--glow-magenta`. Secondary: transparent, 1px
  `--line-strong`, hover fills `--surface-3` with a low-alpha cyan border. Ghost:
  text only. Destructive: `--danger` border/text, fills on hover, always labelled.
  One primary action per view; labels are sentence case, body face.
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
