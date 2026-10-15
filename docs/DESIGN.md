# Design

The rules a UI change has to follow. Token values live in
`packages/ui/src/styles/design-tokens.css`; the primitives are exported from
`packages/ui/src/index.ts`.

## Product principles

- Combat first. The table surface serves running a fight; anything else earns its place.
- The obvious action is the correct one. A GM mid-encounter should not hunt for a control or
  read a manual. Prefer one clear action to a settings panel.
- Everything needed, nothing more. Each new setting is a small tax on every future decision.
- Role clarity is part of the UX. A player should never wonder whether something is for them,
  and the GM should always be able to tell what players and the table screen can see.

## Look

Retrowave in a magenta-to-blue range over deep indigo surfaces, with white and cool-grey text.
The identity comes from colour, the perspective grid, neon linework and a faint screen texture,
used with restraint.

- Neon marks state: interactive, focused, selected or live. Resting surfaces stay dark.
- At most one glowing element per region at rest, and one bold moment per view.
- Nothing pulses or loops. One-shot cues (a crit flash, a bar filling) are fine.
- Legibility wins every conflict with mood. In the light theme, without exception.

## Colour

Never hard-code a colour in a component; add a token first and use `var(--...)`.

| Meaning                        | Token                                                   |
| ------------------------------ | ------------------------------------------------------- |
| Primary action, attention      | `--magenta` (text uses `--magenta-text`)                |
| Positive, heal, confirm, focus | `--success` / `--cyan` (text uses `--cyan-hi`)          |
| Caution, "not finished"        | `--caution` (warm orange; text uses `--caution-hi`)     |
| Damage, destroy                | `--danger` (rose; text uses `--danger-text`)            |
| Information                    | `--info` / `--indigo` (text uses `--indigo-text`)       |
| GM-only content                | `--violet` (reserved for this; text uses `--violet-hi`) |

A hue painted as words uses its text token, which clears 4.5:1 on that theme's surfaces; the hue
itself is for edges and fills.

Every state carries an icon or a text label as well as a colour. The palette sits in the band
that is hardest for red-green colour blindness, and green is absent on purpose.

There are three themes, set with `data-theme="dark|dusk|light"` on the root: night (default),
sunset and daybreak. They share one token set; only values change.

## Type

| Role     | Token                        | Use                                             |
| -------- | ---------------------------- | ----------------------------------------------- |
| Wordmark | `--font-wordmark` (Bungee)   | App name and top-level view titles only         |
| Display  | `--font-display` (Russo One) | Section headers, dice totals                    |
| Body     | `--font-body` (Manrope)      | Everything functional, including control labels |
| Mono     | `--font-mono` (Space Mono)   | Dice notation, modifiers, coordinates, HP       |

Use the `--fs-*` size tokens and `tabular-nums` on anything that updates live.

## Layout

- The page never scrolls. A surface is a fixed frame (tab bar, headers, toolbars) plus regions,
  and each region either fits or scrolls itself with the `.scroll-y` class. Wide content (tables,
  tab strips) gets its own horizontal scroller.
- One primary scroller per pane. The canvas region (map stage, Codex main pane, wizard body)
  fills the leftover space with `flex: 1; min-height: 0`.
- Targets: a 1080p-class laptop, where layouts spend the width on rails and docks, and a
  390x844-class phone in portrait, where they spend the height. The width floor is 320px.
- Breakpoints come from one ladder: `max-width` 760 / 650 / 560, and `min-width` 850 / 980 / 1280
  where a layout earns another column. The table viewer reflows on aspect ratio instead, because
  a TV is always landscape.
- Spacing uses the 4px `--space-*` ladder. Surfaces are square (`--radius-sm/md/lg` are 0);
  `--radius-pill` is for gauges, chips and token rings.

## Phones and touch

Phone and laptop have the same features in the same build. A control that only works with a
mouse is a bug.

- Every interactive control has a hit area of at least `--tap-min` (44px). All `@vtt/ui`
  primitives meet it; compose from them before hand-rolling a control. Map tokens and Codex
  graph nodes are the accepted exceptions: their size is data, and the canvas zooms.
- Draggable or zoomable surfaces use Pointer Events with `setPointerCapture` and set
  `touch-action: none`. On the encounter map a second finger aborts the gesture in progress and
  commits nothing.
- A focused input inside a locked region must stay visible above the on-screen keyboard.
- `prefers-reduced-motion` freezes animations; reduced transparency replaces blur with a solid
  surface.

## Components

Build from `@vtt/ui`. A new primitive goes into `packages/ui` with `nh-` prefixed CSS and a test
next to it.

- One primary button per view. Labels are sentence case and name their result ("Roll
  initiative", "End turn").
- Hover owns the surface lift; selection owns the edge, the glow and the check mark.
- Disabled controls dim colour, border and background individually, never with group opacity,
  and keep the reason for being disabled at full strength.
- Who-can-see-this decisions use the `RevealSwitch` and `VisibilityBadge` primitives.
- Feedback is a toast. Destructive actions are labelled and confirmed.
- Icons are SVG. Never render an emoji or a text symbol such as `⚠` as an icon.

## Writing

Say what the control does or what belongs in the field, and nothing else.

- Plain second person, sentence case. Errors say what happened and how to fix it.
- No scene-setting or roleplay voice in UI copy, including the Codex.
- No em dashes in anything a user reads. Use `·` between label fragments and "None" for an
  absent value.
- No ellipsis placeholders, except where it means "opens a dialog" or "in progress".
- No exclamation marks and no questions outside a confirm dialog.
- No filler such as "simply", "just", "easily", "lets you" or "note that". A hint that carries
  no information is deleted.
