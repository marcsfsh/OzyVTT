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
  `ThemeToggle`, `useTheme`. Build new UI from these; do not hand-roll bespoke
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
positive. No green-teal. No yellow/orange. Red is permitted only as a
magenta-adjacent rose for damage and destruction.

Semantic map (hue is a hint, never the only signal):

| Meaning | Token | Pairs with |
|---|---|---|
| Primary action / attention | `--magenta` | filled buttons, active tabs |
| Positive / heal / confirm | `--success` (cyan) | a check or plus icon |
| Caution / magic / special | `--caution` (violet) | a warning icon |
| Damage / destroy / critical | `--danger` (rose-red) | a distinct icon and label |
| Info / neutral highlight | `--info` (indigo) | plain, low urgency |

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
do not track out body text.

---

## 4. Spacing, radius, elevation

- Spacing (`--space-*`), 4px base: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- Radius: `--radius-sm 4px`, `--radius-md 8px`, `--radius-lg 12px`, `--radius-pill`.
  Avoid large soft blobs. Chips and token rings may go pill.
- Elevation, in order of preference: a lighter surface token; a 1px border in
  `--line` or a low-alpha accent; a dark ambient shadow. Colored glow is state,
  not resting elevation.

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
- A Cmd/Ctrl-K command palette is the intended global search/jump/run surface.
- Honor `prefers-reduced-motion` globally: neutralize entrances/drift/smooth
  scroll and present end states statically. Never gate information behind motion.

---

## 8. Restraint rules ("not too overt")

1. At most one glowing element per region at rest.
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
through the flow ("Save encounter" → "Encounter saved"). Empty states invite
action; errors say what happened and how to fix it. Sentence case throughout;
all-caps only for small eyebrow labels.

---

## 10. Building new UI on this system (checklist)

1. `import "@vtt/ui/styles.css"` at the app entry (already done for the three
   existing entries); reference `var(--…)` tokens, never hex.
2. Compose from `@vtt/ui` primitives; if you need a new one, add it to `@vtt/ui`
   (with `nh-`-namespaced CSS) and to `/styleguide`, not inline in a feature.
3. Run the Section 8 checklist; verify AA contrast in all three themes; confirm
   reduced-motion and reduced-transparency behavior.
4. For a UI-affecting change, look at it running (`npm run dev`) at a desktop
   width and a narrow/touch viewport, and cycle the themes.
