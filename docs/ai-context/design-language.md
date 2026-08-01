# OzyVTT: Design Language

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

- **Tokens:** `packages/ui/src/styles/design-tokens.css` (the authoritative values)
  plus the self-hosted fonts in `packages/ui/src/styles/fonts.css`. Import the
  barrel once per app entry: `import "@vtt/ui/styles.css";` (done in `main.tsx`,
  `viewer-main.tsx`, and `styleguide-main.tsx`).
- **Primitives:** `@vtt/ui` exports the shared components — `Button`,
  `Field`/`Input`/`Select`/`Textarea`, `Panel`, `Tabs`, `Menu`, `Tooltip`,
  `Modal`, `Chip`, `Wordmark`, `Eyebrow`, `ToastProvider`/`useToast`,
  `ThemeToggle` (which *is* a `SegmentedControl` — it has no styling of its own),
  `useTheme`, plus the guided-flow set (`WizardShell`, `Steps`, `ChoiceCard`,
  `ChoiceGrid`, `AbilityScoreAllocator`, `DiceInputRow`, `NameField`, `FeatureList`,
  `ReviewSummary`) and the system's own SVG glyphs (`IconCheck`, `IconChevron`,
  `IconSearch`, `IconShuffle`, `IconDie`, `IconPencil`, `IconWarning`, `IconInfo`).
  **Primitives never render a glyph as text** — not emoji, and not "text" symbols like
  `⚠` (U+26A0): Manrope has no glyph for it, so it silently falls back to a system
  face at the wrong size, and iOS/Android give it *emoji* presentation (a yellow
  triangle — a hue this palette does not own). An SVG glyph takes `currentColor` and
  renders identically everywhere. Build new UI from these; do not hand-roll bespoke
  controls. Primitive CSS classes are `nh-`-namespaced.
- **Living reference:** the dev-only `/styleguide` route (`styleguide.html`)
  renders every token, type role, and primitive with its states and a live theme
  switch. A new primitive isn't done until it appears there.
- **Do not** hardcode hex values in components. If a value is missing, add a token
  to `design-tokens.css` first, then use `var(--…)`.

---

## Locked design decisions (authoritative)

These are settled. Build to them; do not reopen them without a stated reason.

Intensity and themes
- One consistent moderate level of the aesthetic across the whole app. Hero
  zones are the boldest instances by degree, not a separate treatment.
- The look is fixed. There is no user-facing effects dial. The only switches are
  theme and OS accessibility (reduced motion / reduced transparency).
- Three themes: dark, dusk (in-between), light. The lighter two are
  accessibility-first; in light mode, legibility and usability outrank aesthetic.

Color
- Magenta leads, cyan supports, roughly 60/40.
- Dark base is a lifted deep indigo/purple, not true black.
- Violet is used meaningfully but occasionally (special states, gradients). A
  brighter `--violet-hi` exists for violet text so it stays legible on dark
  surfaces.
- Damage and danger use the magenta-adjacent rose-red.

Texture and motifs
- Scanlines and faint static are a subtle everyday layer at the app-shell level,
  kept faint enough that text panels above them stay fully readable.
- The app wordmark carries a chrome-gradient fill; subtle chromatic fringing is
  an optional garnish on the wordmark only, never on functional or body text.
- The perspective grid is used sparingly (login, loading, empty states), not as
  a constant backdrop.
- The tactical battle-map grid stays neutral and quiet so map art and tokens
  dominate.

Type
- Display leans chunky 80s arcade, tiered so it never fights content: loudest on
  the wordmark and top-level titles (a heavy signage face with a chrome-gradient
  fill), a restrained bold face for section headers, a neutral legible body
  face. The look is arcade-cabinet and retro, deliberately not techno/sci-fi.
- Everyday UI text keeps some flavor (mono labels, uppercase eyebrows) with
  accessibility governing size and contrast.

Motion
- Tuned between snappy and glidey.
- Glow on live states switches on and off smoothly. No pulsing or breathing
  loops anywhere. One-shot cues (a crit flash, a jump-to flash, a bar filling
  once) are allowed because they settle rather than loop.

Mood and combat
- Mood is sleek, cool, and nostalgic: clean and precise with a nostalgic soul,
  not loud or playful.
- When an encounter starts, the encounter and map panels shift hue slightly to
  signal live combat. A quiet state change, not an intensity spike, and it must
  not reduce legibility.

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

**One deliberate exception, ruling R8 (D21): `--caution` is a warm orange.** It used to
alias `--violet`, which invariant 8 reserves exclusively for GM-only content — so a
warning badge and a GM-secret block were the same hue, and the one colour that must mean
exactly one thing meant two. Orange is the only direction left that is neither loss-red,
brand magenta/cyan, nor GM-violet, so the "no yellow/orange" restraint yields to the
invariant rather than the other way round. It is scoped to the caution pair and nothing
else: `--caution: #FF9E4A` / `--caution-hi: #FFB877` on dark and dusk, `#B4560A` /
`#8F4406` on light, all measured against WCAG 2.1 in `design-tokens.css`.

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

Scale: `--fs-display 34`, `--fs-h1 26`, `--fs-h2 20`, `--fs-h3 16`, `--fs-body 15`,
`--fs-sm 13`, `--fs-xs 11`. Eyebrows/small-caps track `+0.08em`; display `+0.01em`;
do not track out body text. Those two values are tokens — `--tracking-eyebrow` and
`--tracking-display`. Use the token; a hand-typed `.05em`/`.06em`/`.07em` is the same
role rendered four slightly different ways.

Breakpoints are a fixed ladder, not per-file taste: **760 / 650 / 560** (plus
`min-width: 850/980` where a layout earns a third column). Full rationale in
`mobile-ux.md`. A new number in a new stylesheet means two components change shape at
widths 140px apart for no reason.

---

## 4. Spacing, radius, elevation, touch targets

- Spacing (`--space-*`), 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: `--radius-sm 4px`, `--radius-md 8px`, `--radius-lg 12px`, `--radius-pill`.
  Avoid large soft blobs. Chips and token rings may go pill.
- Elevation, in order of preference: a lighter surface token; a 1px border in
  `--line` or a low-alpha accent; a dark ambient shadow. Colored glow is state,
  not resting elevation.

### The 44px touch-target floor (authoritative)

**The rule:** an interactive control presents a hit area of at least `--tap-min`
(44px). Phone and laptop are the same build (mobile-ux.md), so there is no
"desktop-only" control that may be smaller. This is a floor, not a size: it governs
the *hit area*, never the paint.

**Where it actually holds today** — this is the honest scope, not an aspiration:

- **Every `@vtt/ui` primitive.** Measured 2026-07-26 at a 375px viewport across the
  whole `/styleguide` page: **0 controls below the floor**. New UI composed from
  `@vtt/ui` inherits it for free, which is the main reason to compose rather than
  hand-roll.
- **The whole Codex, both roles.** Re-measured 2026-08-01 in Chromium against a populated
  database, **34 surfaces**: the GM's twenty-one (every sidebar address plus the page
  editor, the session editor, the quest editor, the pin inspector *with its Appearance
  disclosure open*, the cross-type tag view, the quick-create dialog, the command
  palette, the nav drawer and the session-prep drawer) and the player's thirteen, on a
  real player session rather than the GM's preview modal. **1,160 interactive controls;
  16 below the floor at 375px and 24 at 320px — every one of them a graph node**, the
  accepted exception in the table below. Reproduce with `node scripts/tap-audit.mjs 375`
  (route-driven: a new address is one line) — the run exits non-zero if anything is
  sub-floor *or* any surface goes unmeasured, and it prints the per-surface counts that
  add up to the total.

  **The two widths do not agree, and that is the honest result rather than a rounding of
  it.** The graph's node sizes are data-driven and its layout is force-fitted to the
  canvas, so a narrower canvas pushes more nodes under the floor: 10 of the GM graph's
  nodes at 375px and 18 at 320px, plus 6 of the player's at both. A single number for
  both widths — which this file carried until today — could only ever be right for one
  of them. **Nothing outside the graph is sub-floor at either width.**

  **The figure before that — "17 surfaces, 805 controls, 0 below the floor" —
  was wrong in three ways and is corrected rather than quietly restated.** The
  script was GM-only, so the player Codex (its own root, drawer, reader and pin sheet)
  contributed nothing; two of its openers fell through a `count() > 0` guard with no
  else and silently measured the previous surface a second time; and the total was never
  0 — `.codex-list-item` on the player's Pages rail measured 43.6px (ten rows) and
  `.codex-marker-link-open`, in both shells, measured 35.6px. Both now carry
  `min-height: var(--tap-min)` and both measure 44.
- **The named app controls that carry it themselves** (they are not primitives, and
  each states its route in a comment): `.encounter-map-icon` (map tools),
  `.combatant-choice` / `.encounter-players-roll-init` / `.manual-nat20` (the
  label is the hit area for a bare checkbox), `.combatant-remove`,
  `.encounter-add-monsters`, `.scene-card-grip`.

**Known exceptions** (real, measured, and not yet fixed — do not claim otherwise):

| Control | Measured @375 | Why it is still open |
|---|---|---|
| `DicePanel`'s two `<summary>` disclosures | 39px and 19.5px tall | Unclassed `<summary>` in `apps/client/src/dice/`; needs a scoped rule there. |
| `.encounter-map-swatches button` (color picker) | 24×24 | Inside a popover grid; 44px areas would overlap at the current 4.8px gap. |
| Raw `<input type="checkbox">` outside the named labels above | 13–20px | A replaced element cannot take `::after`; each one needs its wrapping `<label>` to carry `min-height`. |
| `.codex-graph-node` (Connection graph) | **@375: 14.2–18.4 wide × 11.2–49.5 tall, 16 nodes (GM 10, player 6). @320: 12.1–43.4 wide × 9.4–43.4 tall, 24 nodes (GM 18, player 6).** | **Accepted, not deferred.** Node size is data-driven and positions are force-laid, so a 44px area per node would overlap its neighbours at any realistic density — the floor and the layout are in direct conflict, and enforcing the floor destroys the thing being tapped. Mitigated three ways: the canvas pans and zooms (a node grows into the floor when you zoom in, which is what the gesture is for), every node is also reachable as a row in Pages and from the palette, and the graph is a *view onto* the connections rather than the only way to open one. **The count is data-dependent and width-dependent — do not quote it as a constant.** It scales with the campaign (`known-bugs.md` records the same lesson from "the Graph's 3"), and the narrower width is the WORSE case, not the better one: an earlier row here read "41–43px @320", which is the opposite of what the tool prints. Re-measured 2026-08-01 by `scripts/tap-audit.mjs` at both widths, GM and player. |

Two ways to meet it — pick by whether growing the paint hurts:

1. **Grow the paint** (`min-height: var(--tap-min)`) where a taller control is
   harmless or better: `.nh-btn`, `.nh-input`, `.nh-tab`, `.nh-menu-trigger`,
   `.nh-menu-item`, `.nh-stepper-btn` (also `width`), `.nh-feature-summary`,
   `.nh-choice`, `.nh-step-jump`, `.nh-namefield-suggestion`.
   Stacked lists (menus, disclosure rows) **must** use this — overlapping invisible
   extensions in a vertical list steal their neighbours' taps.
2. **Grow only the area** with the `.tap-target` utility, which centres a
   `--tap-min` box on the control via `::after`. Use it where the light visual
   weight is the point: `.nh-btn--sm` (32px paint), `.nh-iconbtn` (36px),
   `.nh-segmented-option`, `.nh-switch` (22px), `.nh-chip-remove` (18px),
   `.nh-chip--pressable` (32px), `.nh-toast-close` (20px), `.nh-modal-close`,
   `.nh-menu-trigger--icon` (28px). Never on a control that already uses `::after`
   for a visual (the active tab's underline) — give those a `min-height` instead.

**Route 2 has a gap budget.** A `::after` box overhangs the paint by
`(44 − paint) / 2` per side, so **neighbouring controls must be gapped by at least
the sum of their overhangs** or the later sibling silently steals the earlier one's
taps. Worked examples in the codebase: `.nh-card-tools` gaps by `--space-4` (28px
squares, 8px overhang each); a pressable-chip row gaps by `--space-3` (32px paint,
6px overhang each); `.encounter-map-tools` gets away with 4.8px because its paint is
40px (2px overhang each).

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

## 6. Signature motifs, texture, and the tabletop surface

Abstract motifs — grid, line, horizon geometry, screen texture. Keep all of this
off screens that hold dense text.

- **Perspective grid** (`.grid-floor`): a receding grid floor meeting a horizon,
  thin lines at 8-16% alpha. Reserve for login, loading, empty states.
- **Neon linework:** a bright horizon rule, occasional edge beams framing a hero
  zone, and the everyday 2px panel accent hairline. A line glows only when it is
  a hero element or an active state.
- **Screen texture** (`.scanlines`, `.static-noise`): faint horizontal lines +
  low-opacity grain at the app-shell level, behind solid panels. The wordmark
  fill (`.wordmark-name`) is chrome-gradient + bevel; optional `.chromatic`
  fringing is wordmark-only. All texture is off in light theme / reduced transparency.
- **Battle map:** the tactical grid overlay stays neutral and quiet. Empty/unloaded
  map = the perspective grid horizon with a `--grad-bloom` glow (the hero moment).
  Fog of war: `--void` at high alpha.
- **Tokens on the grid:** circular 2px ring; selected `--cyan` + `--glow-cyan`;
  active turn `--magenta` + steady stronger glow (no pulse); targeted a one-shot
  `--danger` flash; team coding allies cyan / enemies magenta / neutrals indigo.
- **HP bars:** track `--surface-3`; fill is state, not a fixed hue — healthy (>50%)
  cyan, bloodied (25-50%) magenta, critical (<25%) danger, temp-HP a violet
  segment; always show the number in mono with `tabular-nums`.
- **Combat state (hue shift):** encounter + map panels take `.combat-active` (a
  quiet magenta tint) while an encounter is live; eases in/out, never pulses.

---

## 7. Motion and interaction feel

- One easing (`--ease-settle`); a second (`--ease-drawer`) only for large sliding
  surfaces. Durations: press 100ms, hover 140ms, base 200ms, enter 260ms, reveal
  560ms. Transition specific properties, never `all`.
- Animate context changes (view switches, tabs, dialogs, drawers) at the
  container level; leave frequently re-rendered lists alone (token list,
  initiative rows, chat).
- Selection and focus are the neon moments. Keyboard focus = a visible cyan ring
  on every interactive element; never remove focus outlines without replacing them.
- Depth through blur on sticky/floating surfaces; reduced-transparency replaces
  blur with a solid surface.
- A Cmd/Ctrl-K command palette is the search/jump/run surface. **Shipped
  Codex-scoped, deliberately not global** (D20, 2026-07-31): it is mounted only by
  `CodexShell` and the player shell, so ⌘K means nothing on the Encounter tab, and a
  test locks that — "make it global" is the obvious next step and is a separate
  decision, not an oversight. Its chrome is `Modal align="top"`, which is the only
  primitive change it needed; see `/styleguide#palette`, documented there as a
  composition rather than a component.
- Honor `prefers-reduced-motion` globally: neutralize entrances/drift/smooth
  scroll and present end states statically. Never gate information behind motion.

---

## 8. Restraint rules ("not too overt")

1. At most one glowing element per region at rest. A *region* is one working area,
   not one screen: a faceted picker is one region, so its filter and its answer
   cannot both glow. When two candidates compete, the glow goes to the **answer**
   (the selected card), never to the control that narrowed the list — which is why
   `.nh-segmented-option[aria-pressed]` reads as pressed with `--surface-3` + `--text`
   and no glow at all.
2. Texture stays off dense text; the everyday grain lives at the shell level.
3. Neon is for edges and states; fills are dark (surface tokens).
4. The color-ramp bloom appears once per view at most.
5. Stack texture, don't pile it: one grid, at most one of scanlines/static, one bloom.
6. Body text is always `--text` on a surface token; never neon paragraphs.
7. If in doubt, remove one accent.
8. Nothing pulses.

---

## 9. Voice and copy

Speak plainly, second person, about actions the player controls. Actions name
their result ("Roll initiative", "End turn", "Apply damage") and keep their name
through the flow ("Save encounter" → "Encounter saved"). Errors say what happened
and how to fix it. Sentence case throughout; all-caps only for small eyebrow
labels.

### The rule

**Say what the control does, or what belongs in the field. Nothing else.**

Copy describes the software, not the fiction. The Codex is a worldbuilding tool,
which makes it the surface most likely to start narrating; it may not. A GM
reading a hint wants to know what a control affects, what is required, what
players can see, and what cannot be changed later.

1. **No scene-setting or roleplay voice.** Not "the table", "the party's own
   words", "the hook", "tonight", "the truth behind…". Empty states name the
   record they lack, not a mood.
2. **No em-dashes in anything a user reads.** Not as an aside, not as a
   connector, not in place of a colon. One clause, or two short sentences. An
   aside that carries a real constraint earns its own sentence. This covers
   assembled labels and "no value" glyphs too: the Codex uses `·` between label
   fragments and the word "None" for an absent value. (Em-dashes in code
   comments are fine — the rule is about what reaches the screen.)
3. **No ellipsis placeholders.** A placeholder is a plain noun phrase naming the
   content, or a concrete example value. `…` survives only where it carries
   information: "New page…" means the action opens a dialog, "Saving…" means
   work in progress.
4. **No rhetorical framing, no invitations, no cleverness.** No questions except
   in a confirm dialog, which has to ask. No exclamation marks.
5. **A hint carries information or it is deleted.** If removing the banned
   constructions leaves a sentence that only restates the field name, delete the
   hint. Padding it back to look deliberate is worse than the silence.
6. **No LLM register.** No "simply", "just", "easily", "powerful", "seamlessly",
   "leverage", "note that", "keep in mind", "lets you", "allows you to". No
   throat-clearing before the sentence that matters, and no summary sentence
   restating what was just said.

### Calibration

| Instead of | Write |
| --- | --- |
| "The hook as the table heard it…" | "What players have been told about this quest" |
| "The truth behind the hook, who is really behind it, how it ends…" | "Details players cannot see" |
| "Beats, encounters, the questions you want answered tonight…" | "Prep notes for this session" |
| "Search what you know…" | "Search pages" |
| "Its kind brings the fields it needs. You can change it later." | "The kind determines which fields appear. You can change it later." |
| "Move this map elsewhere in the atlas. Everything under it travels along." | "Move this map elsewhere in the atlas. Any maps nested under it move with it." |
| "Days can't be edited — they're what the clock already moved by. A typo is a delete and re-log." | "Days cannot be changed after logging. Delete the entry and log it again to correct it." |
| "Longer pauses mean fewer saved versions, and more work at risk if the tab closes." | "Longer intervals save fewer versions and risk losing more unsaved work." |
| "Nothing bearing down on the party." | "No deadlines yet." |
| "Couldn't load the Codex — check your connection to the table." | "Couldn't load the Codex. Check your connection and try again." |

Already correct, and left alone: "Shown after the year, e.g. DR or AE" ·
"Use / to nest, e.g. NPCs/Villains".

**Plainer never means vaguer.** Destructive and disclosure copy keeps every
number and consequence it had: the restore confirm states its record counts, the
reveal-ahead warning names both dates, the kind-change confirm names each field
at risk and softens its recovery promise when version history is off. Cut the
flourish, keep the fact.

The glossary in `apps/client/src/codex/vocabulary.test.ts` fails the build on
retired words. Reaching for a plainer phrase is exactly when one slips back in.

---

## 10. Building new UI on this system (checklist)

1. `import "@vtt/ui/styles.css"` at the app entry (already done for the three
   existing entries); reference `var(--…)` tokens, never hex.
2. Compose from `@vtt/ui` primitives; if you need a new one, add it to `@vtt/ui`
   (with `nh-`-namespaced CSS) and to `/styleguide`, not inline in a feature.
3. Run the Section 8 checklist; verify AA contrast in all three themes; confirm
   reduced-motion and reduced-transparency behavior.
4. Meet the 44px touch floor (§4) and say which route you took.
5. For a UI-affecting change, look at it running (`npm run dev`) at a desktop
   width and a narrow/touch viewport, and cycle the themes.
