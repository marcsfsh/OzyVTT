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

Chrome sun: retrowave in a magenta-to-blue range over deep indigo surfaces, with white and
cool-grey text. The identity comes from the sun, square panels with a chrome lip, the perspective
grid and neon linework, used with restraint.

- The sun (`--grad-sun`) is the one warm thing, and it means "press this" or "this is now": the
  primary button's frame, the current turn, the glyph beside the current name. Never decoration on
  a resting surface, and never a fill behind words.
- Every surface is square. A panel is a flat plate with a 1px edge and the 2px chrome lip along its
  top (`--material-lip`); nested panels take the plate alone. Controls are raised (`--raised`).
- Neon marks state: interactive, focused, selected or live. Resting surfaces stay dark.
- At most one glowing element per region at rest, and one bold moment per view.
- Chrome lettering belongs to the title screen alone. Every other heading is solid Bungee with the
  hard heading shadow.
- Nothing pulses or loops. One-shot cues (a crit flash, a bar filling) are fine.
- Legibility wins every conflict with mood. In the light theme, without exception.

## Colour

Never hard-code a colour in a component; add a token first and use `var(--...)`.

| Meaning                        | Token                                                   |
| ------------------------------ | ------------------------------------------------------- |
| Press this, this is now        | `--grad-sun` (frames, the turn glyph, the sheet's pips) |
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

| Role     | Token                         | Use                                                         |
| -------- | ----------------------------- | ----------------------------------------------------------- |
| Wordmark | `--font-wordmark` (Bungee)    | The app name                                                |
| Display  | `--font-display` (Bungee)     | Headings, the primary button, the current name, stat values |
| Label    | `--font-label` (Bai Jamjuree) | Tabs, uppercase labels, chips, secondary buttons            |
| Body     | `--font-body` (Tomorrow)      | Names, descriptions, paragraphs                             |
| Numbers  | `--font-numeric` (Tomorrow)   | HP, AC, initiative, modifiers, dice, every game number      |
| Mono     | `--font-mono` (Space Mono)    | Code only                                                   |

Use the `--fs-*` size tokens. Tomorrow's digits are proportional, so a number that updates live
reserves its widest value with `min-width` in `ch` and aligns to the end of that box.

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
- The table is a docked workbench (ADR-0025): nothing floats over the map but tokens and marks. A
  tool's options open beside the rail, a prompt takes the panel's prompt slot, and a notice takes the
  status line.
- Spacing uses the 4px `--space-*` ladder. Surfaces are square (`--radius-sm/md/lg` are 0),
  gauges and chips included; `--radius-pill` is for token rings, dots, avatars and swatches.

## Phones and touch

Phone and laptop have the same features in the same build. A control that only works with a
mouse is a bug.

- Every interactive control has a hit area of at least `--tap-min` (44px). All `@vtt/ui`
  primitives meet it; compose from them before hand-rolling a control. Map tokens and Codex
  graph nodes are the accepted exceptions: their size is data, and the canvas zooms.
- Draggable or zoomable surfaces use Pointer Events with `setPointerCapture` and set
  `touch-action: none`. On the encounter map a second finger aborts the gesture in progress and
  commits nothing.
- Every element with `touch-action: none` takes its ref from `useDragSurface` (`@vtt/ui`), which
  cancels its touchmove. Without it, a drag that lifts mid-motion starts a browser fling, and the
  browser spends the next tap on stopping it. `drag-surfaces.test.tsx` fails on a surface without it.
- A focused input inside a locked region must stay visible above the on-screen keyboard.
- `prefers-reduced-motion` freezes animations; reduced transparency replaces blur with a solid
  surface.

## Components

Build from `@vtt/ui`. A new primitive goes into `packages/ui` with `nh-` prefixed CSS and a test
next to it.

- One primary button per view: the sun frame, its label in Bungee. Labels are sentence case and
  name their result ("Roll initiative", "End turn").
- A tab bar or segmented control is a sunken track; the chosen option is raised with a cyan
  underline, because cyan is selection.
- Chips and badges are a tinted strip with a 3px bar in their tone on the leading edge.
- Hover owns the surface lift; selection owns the edge, the glow and the check mark.
- Disabled controls dim colour, border and background individually, never with group opacity,
  and keep the reason for being disabled at full strength.
- Who-can-see-this decisions use the `RevealSwitch` and `VisibilityBadge` primitives.
- Feedback is a toast. Destructive actions are labelled and confirmed.
- Icons are SVG. Never render an emoji or a text symbol such as `⚠` as an icon.

## Page patterns

The owner chose these across the reviews of the sheet, the battlemap, the Codex and the homebrew mockups. A new page
or an overhaul builds from them. A page that needs something else says why in its ADR.

- Sections go in a bar. A page with several areas lists them in a section bar at the top, with the search box
  (Ctrl K) and the view's one primary action at its right end. A phone lists the same sections in a tab bar at the
  bottom, under the thumb, and keeps the app's own tabs at the top. Navigation never uses a fixed left rail or a page
  tree. The table's tool rail holds tools, and a tool's options open in a column beside it.
- A record reads as one document. The middle of the page shows the record the way the people who use it will see it:
  a Codex page as players read it, a stat block as the table prints it, a scene as its map. A metadata panel on the
  right answers what the GM asks about it: its state, who sees it, where it is used, what it links to and its history.
  On a phone the panel's content follows the document, and a detail opens in a sheet from the bottom.
- A preview is the real thing. It renders with the component the real page uses, at that page's proportions, so what
  the GM checks is what people get. See as players switches the page in place to what Everyone or one chosen
  character receives, through the server's read for that audience.
- Lists are tables. A table's columns are what matters for that kind of record. The type is a dropdown of checkboxes,
  every type ticked by default, where tabs would otherwise go. Filters open as a flyout from a Filters button, close
  out of the way and leave chips that show what is filtered. Sort opens a dialog that sorts by several columns in
  order, as a spreadsheet does, and a Modified filter takes any date range. On a phone a table becomes a list with
  the two facts that matter most on each row, under the same dropdowns.
- Making something is a set of steps. A new record lists its steps down the left, each marked done, current or
  missing something. Its questions fill the middle and its preview is pinned on the right. The same outline is the
  full editor afterwards, so there is one set of questions to learn. While a record is open, the list it came from
  folds into a flyout that the GM can open again. On a phone the steps are a strip across the top, and the preview is
  a bar over the bottom tabs that opens full screen.
- Who sees it. An audience control offers Hidden, Everyone and, where the server supports it, chosen characters. It
  sits inline with the title or the field it governs, and its label sits under the switch so the switch stays put
  when the label changes. Hidden is violet with the crossed eye and the word Hidden. Revealed content says who it is
  revealed to.
- A front page starts with what needs the GM, each line carrying its action. Recent changes come next, with who sees
  each one, and then a way to start each kind of thing.
- Decisions the GM owes wait in one Needs you list, each with its buttons, and each view has one primary action.
- Time is a timeline. History is a list of versions with Compare and Restore, and a save conflict shows both sides
  and keeps both by default.
- A lookup across two sets is a grid: rows against columns with a mark in each cell, such as factions against
  factions or records against characters.
- A map is present without taking over. Anything placed on a map has two ways in: a button and then a click on the
  map, or a right-click at the spot, which is a long press on a phone.

## The character sheet

ADR-0030 records the layout and which views come from which mockup. A change to the sheet keeps these:

- The header holds the numbers read most, and the status strip under it holds every live state with its time left.
  A new live state goes in the strip. Its chips wrap to another line, and a state the laptop's band or the phone's
  Vitals already show leaves the strip.
- Six tabs: Play, Checks, Spells, Gear, Features and Notes. A phone has them as a bar at the bottom. From 980px a
  laptop gives the checks a left column and the Hit Points a right column, so its middle tabs leave out Checks. In the
  table's panel the tabs are a segmented strip, styled apart from the panel's own tabs.
- A detail (a cast, an item, a spell to copy) is one component placed by `SheetDetail`: the right column on a laptop,
  a drawer on a phone. A player's cast on a phone takes the place of the card or list it came from.
- A turn-card tile names its cost in words and colours its 3px leading edge by it: `--magenta` for an Action,
  `--indigo` for a spell, `--cyan` for a Bonus Action and `--caution` for a Reaction. The laptop's list sits under
  headings that name the cost, so its edge names the kind: `--magenta` for an attack or a feature, `--indigo` for a
  spell and `--cyan` for an item.
- An option that can't be used now stays in its list, disabled, with the server's reason at full strength.
- Every control only the GM has is violet with a `GmOnlyTag` beside its group, wherever it sits.
- Rest controls are hidden in a fight, where the server refuses them.
- The latest-roll line shows only rolls made from this sheet (`sheet-roll-ids.ts`).

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
- Hints, messages and help text are complete sentences. Labels, chips and status lines may be
  fragments joined with `·`.
- Say what is true without setting it against what isn't: no "X, not Y", "X rather than Y",
  "X instead of Y" or "not only X but also Y".
- No three-part rhetorical series ("fast, simple and safe"). When there are three things to
  say, use two sentences or a list.
- Never tell the reader that something is important or worth noticing. State the fact.
- No clause tacked on with "-ing" at the end of a sentence ("..., turning the hit into a miss").
  Write a second sentence with its own subject and verb.
- Plain words: use, get, start, end, help, show, is, has. Avoid comprehensive, crucial,
  enhance, leverage, robust, seamless, streamline, utilize and vital.
- Refer to a character by name. The app doesn't know a character's pronouns, so copy never says
  "he", "she" or "her": "Roll for Lyra", "Damage waits on Lyra's reaction".
- Straight quotes and apostrophes. No emojis.
- Rules words follow SRD 5.2.1: "level 3 spell slot", "Bonus Action", "saving throw".
- The same rules apply to code comments.

`apps/client/src/writing.test.ts` checks the rules a pattern can find on every string a person reads, in the client,
the UI kit, the server messages and the OpenAPI descriptions. It checks the product's own summaries and descriptions
in the SRD bundles too; the SRD text they quote is left as published. It also fails on an em dash, an en dash or a curly quote
anywhere in the code, comments, tests and docs; code that has to match one writes its escape (`\u2014`). Each exemption
in that file carries its reason. Contrasts, "-ing" clauses and three-part series are left to review.
