# Design

The rules a UI change has to follow. Token values live in `packages/ui/src/styles/design-tokens.css`, the primitives
are exported from `packages/ui/src/index.ts` and the default avatars are in `packages/ui/src/avatars/`.
[ADR-0037](adr/0037-arcade-cabinet-redesign.md) records why the app looks this way. The static mockups in
`docs/design/mockups/` show every view below in both themes (`<view>-dusk.html` and `<view>-dawn.html`), with real
default avatars in portraits and tokens. The pictures and game values are sample fixtures, not seeded campaign data.
`docs/design/IMPLEMENTATION.md` records the branch audit, feature dependencies and implementation contracts. Read its
phase section before implementing that phase. Runtime behavior, audience boundaries, accessibility and phase gates
come from these documents and the existing code; the mockups supply visual values within those constraints. Mockup
CSS is reference material, not production code. A missing state uses the same primitives and existing behavior.

## Product principles

- Combat first. The table surface serves running an encounter; anything else earns its place.
- Rank before you place. For each screen, write down what the person needs there, in order. The order decides size
  and position: on the table the map comes first, whose turn it is second and any decision someone owes third.
  Anything past the first five goes behind one click, in a menu, a tab or the next page.
- Familiar first. A player who knows another VTT or D&D Beyond should recognise the layout before reading a word: the
  map in the middle, tools on the left, one tabbed sidebar on the right, turn order across the top, and a character
  header with hit points and AC. Break a convention only with a reason in an ADR.
- The obvious action is the correct one. Each view has one primary action, and its label names its result.
- Everything needed, nothing more. Each new setting is a small tax on every future decision. Settings that shape an
  encounter belong to the encounter in Prep, not to the table.
- Role clarity is part of the UX. A player should never wonder whether something is for them, and the GM should
  always be able to tell what players and the table screen can see.

## Look

An arcade cabinet at dusk and at dawn. There are two themes and nothing else:

- Dusk, the dark one: tinted glass panels over a blue-hour sky with a rose afterglow, white and grey ink, full neon.
- Dawn, the light one: soft lilac-grey paper, plum-grey ink, gentler edges and slightly muted accents. No pure white,
  no harsh black.

Neon appears only where it means something, and each 80s element has one job.

| Element                                  | Its job            | Where it appears                                                                                                                                   |
| ---------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sun frame (`--grad-sun`, 3px, with glow) | Now: who is acting | The acting tile in the turn order, the acting creature's portrait in the sidebar or turn card, its token ring, and the "is acting" line on a phone |
| Sunset scene                             | Arrival            | The title and join screens only. Dusk paints it at night; Dawn paints it as daybreak.                                                              |
| Horizon line (`--grad-horizon`, 2px)     | The top of the app | The bottom edge of every top bar, laptop and phone                                                                                                 |
| Chrome lettering (`.chrome`)             | Who is acting      | The wordmark, the acting creature's name and YOUR TURN. Nowhere else. Dawn prints it as solid ink with the same pink and cyan split.               |
| Cabinet lamp                             | Available, or on   | Action, Bonus, Reaction and Move on the turn panel; the table screen status; a live encounter                                                      |
| Life bar                                 | Hit points         | Every hit point readout                                                                                                                            |
| VCR counter                              | The round          | PLAY and RND 03 during an encounter, STOP and RND -- between encounters, at the start of the turn order and beside YOUR TURN                       |
| Arcade button                            | Press this         | The one primary action in a view                                                                                                                   |
| Neon grid (`--grid-neon`)                | Map squares        | The grid drawn over a map image                                                                                                                    |
| Reticle                                  | The target         | The creature an attack or spell is aimed at                                                                                                        |
| Scanlines                                | The CRT            | One overlay over the whole app at 25%, in Dusk only                                                                                                |

- Nothing pulses or loops. One-shot cues (a crit flash, a bar filling) are fine.
- Glow belongs to four things: the sun frame, a lit lamp, the selected item and the primary button. Resting surfaces
  never glow. Dawn keeps only the sun frame's glow and the primary's pressed edge.
- Every surface is square. `--radius-pill` is for tokens, presence dots and swatches.
- A panel is a flat plate with a 1px edge. There is no chrome lip and no rim.
- Legibility wins every conflict with mood. Reduced transparency turns Dusk's glass solid and drops scanlines and glows.

## Colour and themes

Never hard-code a colour in a component; add a token first and use `var(--...)`. Both themes share one token set and
one set of meanings; only values change.

The themes are `data-theme="dusk"` and `data-theme="dawn"`, named Dusk and Dawn wherever a person reads them. Dusk's
values live in `:root`, so it is what renders before anything is chosen. With nothing stored, the app follows
`prefers-color-scheme`: light gives Dawn, anything else Dusk. A device that saved one of the retired themes keeps its
side of the choice: a stored `dark` becomes `dusk` and a stored `light` becomes `dawn`, rewritten on first read.
An existing `dusk` or `dawn` stays as saved. A missing or invalid value follows the system preference at startup;
if that cannot be read, use Dusk. Storage read and write failures never prevent the selected theme from rendering.
The three HTML no-flash scripts and `getStoredTheme` must use this same decision table. An explicit saved choice wins;
no live system-change subscription is required in this redesign.

Dusk:

- The app's ground is `--sky`: `radial-gradient(120% 55% at 78% 108%, rgba(255, 94, 120, 0.32), transparent 62%),
linear-gradient(180deg, #151a2d 0%, #1d1f36 48%, #2a2140 100%)`.
- Bars and panels use the `--glass-*` tokens with `backdrop-filter: blur(16px) saturate(1.15)`; edges are white at low
  alpha.
- Under reduced transparency (the app setting or `prefers-reduced-transparency`), each glass token falls back to its
  corresponding solid value and the blur goes. Add the device setting in phase 1; it does not exist on the audited
  branch. Use `vtt.reduce-transparency` with `on` / `off`, default off, and an app-root attribute. Reduction is active
  when that setting is on OR the media query requests it. Apply it in all three entry points; no backdrop-filter
  support also uses solid surfaces. The setting cannot override an OS request for reduction.

Dawn:

- No scanlines and no coloured glow; the sun frame keeps its warm glow and the primary its pressed edge.
- Chrome lettering is solid ink with a 1px pink and cyan split at 35%.
- The join screen's sunset becomes daybreak: pale lilac to peach to pink over a pink grid, mountains with a teal rim.

In both: pictures keep their own colours (map art, avatars, the sun frame), the map stays as drawn on its dark
surround, a control over the map is a plate in the theme's surface, and lamps stay filled squares.

| Meaning                                                    | Token                         | Dusk solid (glass)                   | Dawn      |
| ---------------------------------------------------------- | ----------------------------- | ------------------------------------ | --------- |
| Bars                                                       | `--bg`                        | `#151728` (`rgba(18, 20, 34, 0.7)`)  | `#ebe7ef` |
| Wells, inputs                                              | `--void`                      | `#131524` (`rgba(10, 12, 22, 0.55)`) | `#e3dee8` |
| Panels and sidebars                                        | `--surface-1`                 | `#1b1e31` (`rgba(26, 29, 46, 0.62)`) | `#f3f0f5` |
| Controls and cards at rest                                 | `--surface-2`                 | `#25283f` (`rgba(44, 48, 72, 0.5)`)  | `#f7f5f9` |
| Hover                                                      | `--surface-3`                 | `#2b2f49` (`rgba(60, 66, 96, 0.45)`) | `#e8e3ee` |
| Row dividers                                               | `--line`                      | `rgba(255, 255, 255, 0.07)`          | `#e0dbe6` |
| Panel edges                                                | `--line-strong`               | `rgba(255, 255, 255, 0.12)`          | `#d3ccdc` |
| Control edges                                              | `--line-raised`               | `rgba(255, 255, 255, 0.2)`           | `#b9b0c8` |
| Text                                                       | `--text`, `--heading-ink`     | `#eef0f8`                            | `#2a2537` |
| Secondary text                                             | `--text-dim`                  | `#c3c7d9`                            | `#4f4862` |
| Labels and hints                                           | `--text-muted`                | `#b0b4ca`                            | `#655d77` |
| Press this: the primary, the Action lamp                   | `--magenta`, `--primary-base` | `#ff2f92`                            | `#f0559b` |
| The primary's label                                        | `--primary-ink`               | `#12020a`                            | `#12020a` |
| The primary's pressed edge                                 | `--primary-edge`              | `#8a0f4d`                            | `#b0306e` |
| Pink as words                                              | `--magenta-text`              | `#ff8cc0`                            | `#b0306e` |
| Selection, focus, targeting, active effects, Reaction lamp | `--cyan`, `--state-on`        | `#4fe3ff`                            | `#2a8fa8` |
| Cyan as words                                              | `--cyan-hi`                   | `#6fe8ff`                            | `#1d6a80` |
| Ink on a cyan fill                                         | `--text-on-neon`              | `#04141c`                            | `#04141c` |
| The party: token rings, portrait edges, spell slot pips    | `--party` (also `--indigo`)   | `#7aa2ff`                            | `#4a72d9` |
| Party blue as words                                        | `--indigo-text`               | `#a8c2ff`                            | `#3a5aa8` |
| Enemies: token rings, portrait edges                       | `--hostile` (also `--danger`) | `#ff5d50`                            | `#d9493f` |
| Red as words                                               | `--danger-text`               | `#ff9d94`                            | `#a8352c` |
| Hit points left, Bonus lamp                                | `--hp`, `--lamp-bonus`        | `#ffd54d`                            | `#d9a43a` |
| Gold as words (the HP label, damage numbers)               | `--hp-text`                   | `#ffd54d`                            | `#7a5718` |
| Hit points lost                                            | `--hp-lost`                   | `rgba(120, 30, 50, 0.6)`             | `#ecd6dc` |
| Waiting, caution, a choice still owed                      | `--caution`                   | `#ffb733`                            | `#d08a2a` |
| Caution as words                                           | `--caution-hi`                | `#ffcb7a`                            | `#8a5612` |
| GM-only                                                    | `--violet`                    | `#bb90ff`                            | `#8a62d6` |
| GM-only as words                                           | `--violet-hi`                 | `#d9c2ff`                            | `#6a46b0` |
| Now                                                        | `--grad-sun`                  | `#ffe14d`, `#ff8a1f`, `#ff2f92`      | the same  |
| Map grid                                                   | `--grid-neon`                 | `rgba(43, 228, 255, 0.24)`           | the same  |

- Every state carries an icon or a text label as well as a colour. Party blue and enemy red differ in lightness as well
  as hue. Green appears only inside pictures (map art, avatars) and never carries a meaning.
- `--hp` and `--lamp-bonus` share a value and not a meaning, so they stay two tokens.
- Contrast: normal text must clear 4.5:1 on its rendered background, including glass after compositing. The audited
  solid palette clears that threshold: the lowest Dusk pair is `--magenta-text` on `--surface-3`, 6.08:1; Dawn's is
  `--magenta-text` on `--void`, 4.54:1. The primary label clears 5.8:1 and `--text-on-neon` on `--cyan` clears 4.5:1.
  These solid checks do not prove contrast on arbitrary glass, layered tints, map controls or chrome lettering.
- Dawn's `--cyan` on `--void` is 2.84:1, below the 3:1 control-edge threshold. Keep the approved cyan fill and use
  `--focus-ring` and `--state-on-edge` for essential outlines: both alias `--cyan` in Dusk and `--cyan-hi` in Dawn.
  The selected fill gets that contrasting edge. Check the edge against the adjacent surface and label against fill.
- Update `packages/ui/src/theme/themes.test.ts` for Dusk as root and Dawn as the only override. Remove assertions about
  retired Night/Day and the old warm Dawn; keep text, label, edge and hue checks, and add `--hp-text`. Add glass
  compositing checks and browser checks on the actual layers. The existing colour parser drops alpha, so it cannot
  validate translucent tokens without extension. No test threshold is lowered to fit the mockups.

## Type

| Role                 | Token                              | Face                          | Use                                                                                                                                 |
| -------------------- | ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Wordmark             | `--font-wordmark`, `--font-script` | Bungee and Mr Dafoe           | OZY in chrome and vtt in neon script. The wordmark only.                                                                            |
| Display              | `--font-display`                   | Bungee                        | Record titles (a creature, a character, an encounter, a page), page titles and the primary button. One or two per view.             |
| UI                   | `--font-label`, `--font-body`      | Bai Jamjuree 500, 600 and 700 | Everything else: labels, body, tabs, buttons and names.                                                                             |
| Numbers and readouts | `--font-numeric`                   | VT323                         | Every game number at 15px or more (HP, AC, initiative, to-hit, DC, XP, dice), the VCR counter, and tags such as NEXT, WAIT and HIT. |
| Code                 | `--font-mono`                      | Space Mono                    | The API reference only.                                                                                                             |

- Fonts are self-hosted with `@fontsource`. VT323 and Mr Dafoe come from `@fontsource/vt323` and
  `@fontsource/mr-dafoe`; Tomorrow is retired once nothing uses it.
- VT323 is monospaced, so a number that changes live keeps its width.
- Labels are sentence case. Uppercase belongs to Bungee titles and VT323 tags, which are always short.
- Sizes: titles 22 to 34px; body 14 to 16px; labels 12px semibold in `--text-muted`; numbers 18 to 40px.

## Layout

The shells:

- GM, laptop. A 56px top bar: the wordmark; Play, Prep, Codex and Compendium; the live encounter picker on Play; then, on
  the right, the table screen lamp, who is connected, search (Ctrl K), the theme switch (the current theme's mark,
  which opens Dusk and Dawn) and settings (a toothed gear, so it never reads as the theme's sun). Each section has a 52px bar under it
  for its pages, with the section's search or its primary at the right end.
- GM, phone. The same four sections as a bottom tab bar. The top bar belongs to the page on screen. In an encounter, Play
  stacks the VCR counter and encounter picker, the turn order, the map, and the acting creature's card (portrait and
  chrome name, life bar, pending card, lamps, an Actions row that opens the full list) above End turn. Under the strips
  the map (its tools above it) has a fixed height and scrolls away; the panel below is one screen tall, so scrolled to
  the end its tabs sit under the turn order. Its content scrolls only once the map has gone. No handle resizes the map.
- Player, laptop. The wordmark; Table, Sheet and Codex; the claimed character on the right; settings.
- Player, phone. Bottom tabs Table, Sheet, Codex and Log on every screen. In an encounter, Table holds the turn card and a
  small map with Open map.

Prep holds Encounters, Party (the roster), Maps, Tokens, Sound and Replays, in that order in its section bar. Its front
page pins New map and New encounter side by side at the top, then the Maps and Encounters tabs, each a sortable table. The table screen's controls open from the
table screen button in the top bar. The rules reference opens from search and from the Compendium. Settings is the gear.

The table (Play), as a docked workbench (ADR-0025):

- Tool rail, 64px, on the left: Select, Measure, Area and Draw, a divider, then Walls, Light and Fog. Players get
  Select, Measure and Ping.
- Turn order, 64px, across the top of the map: the VCR counter, then a tile per combatant with portrait, name and
  initiative. The acting tile has the sun frame, the next one carries a NEXT tag beside its portrait, tiles that have
  acted dim their portrait decoration to 45%; their name and initiative keep readable contrast. Hidden combatants
  show a dashed violet portrait and the crossed eye, to the GM only. An Encounter
  menu at the end holds adding combatants, rerolling and ending the encounter.
- The map fills the rest. Nothing floats over it except tokens, marks, the reticle and a zoom control in the bottom
  right corner.
- Sidebar, 360px, on the right, with tabs Encounter, Log, Party and Notes (players get Turn, Log and Party). During an encounter,
  Encounter shows the acting creature: portrait and chrome name; the life bar with AC and speed; a pending card when the game waits on
  someone; the four lamps; its actions grouped under Action, Bonus action and Reaction, each heading marked in its lamp
  colour; and End turn pinned at the bottom with who is next.

Before an encounter, the same frame changes in three places:

- The strip above the map shows the VCR counter at STOP, "No encounter running" with how many of the party and how many
  enemies are on the map, and the join address with a Copy button.
- The map shows every token with its plain ring; nobody wears the sun frame.
- Encounter shows Start an encounter: In this encounter lists the staged combatants, ticked, with hidden creatures marked; the two
  initiative switches; Who plays, each party character At the table or On their device (ADR-0042), a claimed one held
  on its device; Surprised as one chip per combatant, with the rule underneath; and START THE ENCOUNTER pinned at the
  bottom over a live count and an accurate description of who rolls. With players rolling, say that the players roll
  for their claimed characters; do not promise an automatic roll for everyone. The list is the staged combatants,
  including tokens still in the tray, with Add combatants available. The switches start from the
  encounter's Encounter settings (ADR-0039). On a phone, Start an encounter is a card under the map with the combatants' faces and
  rows (In this encounter, Who plays when the party is in it, Initiative, Surprised), each opening a sheet, above the primary; the header holds the
  STOP counter, the encounter picker and a Join button.

The table screen (the shared TV) is for reading across a room. Gameplay has no controls; pairing, fullscreen and
optional local map framing remain available as device utilities.

- A top band: the wordmark, the VCR counter at 52px, and the turn order with 64px portraits, the acting tile in the sun
  frame and NEXT beside the next visible portrait. When the server says `hiddenTurn`, show GM turn without a hidden
  actor's identity or portrait; the next visible tile is only the next visible combatant, not a promise about hidden turns.
- The map fitted (never cropped) on the left, and a 540px column on the right: an Acting now card (a 112px portrait in
  the sun frame, ACTING NOW, the name in chrome, who is next) and the latest roll at TV size. Nothing covers the map.
  The existing TV feed has no rolls. In phase 7 reserve this card with "Roll display is not available yet.";
  phase 8's viewer-roll ADR and implementation complete it. Never fetch a GM or player feed from the TV.
- It shows only what the table screen's projection holds: no hidden combatants, no enemy hit points, the players' fog.
- Names 20 to 22px, numbers in VT323 from 28 to 80px.

Unchanged rules:

- The page never scrolls. A surface is a fixed frame (bars, headers, toolbars) plus regions, and each region either
  fits or scrolls itself with the `.scroll-y` class. Wide content gets its own horizontal scroller.
- One primary scroller per pane. The canvas region fills the leftover space with `flex: 1; min-height: 0`.
- Targets: a 1080p-class laptop and a 390x844-class phone in portrait. The width floor is 320px.
- Breakpoints come from one ladder: `max-width` 760 / 650 / 560, and `min-width` 850 / 980 / 1280 where a layout earns
  another column. The table viewer reflows on aspect ratio, because a TV is always landscape.
- Spacing uses the 4px `--space-*` ladder.

## Pictures and default avatars

Every creature and character shows a picture: its own image, or one of the twenty default avatars in
`packages/ui/src/avatars/` (Horizon, Moonrise, Palm, D20, Blades, Claws, Orbit, Pyramid, Bolt, Cassette, Shades, Joystick, Gem, Flame, Waves, Pines, Horns, Paw, Vortex and Static). Each is a 64 by 64 SVG that keeps what matters inside the inscribed circle, so it works square as a portrait and round as a token.

Characters built with a class also have twelve class avatars, one per SRD 5.2.1 class, in the same folder as
`class-<class id>.svg` (`class-barbarian.svg` to `class-wizard.svg`).

- A character built with a class shows its main class's avatar: the class with the most levels, and on a tie the one
  taken first. It does so only where the viewer's projection includes that character's classes. When What players see
  of each other hides class, other players get the general pick, so the picture never tells them more than the
  setting allows. A homebrew class has no avatar of its own and falls back to the general pick.
- Every other actor gets a general default, picked by actor id: hash the id and take it modulo the nineteen general
  avatars (every one but Static), using the fixed order and hash in IMPLEMENTATION.md. An actor keeps its picture,
  and the pick reveals nothing a projection does not
  already send. Never pick by monster definition: two goblins sharing a picture would tell players they are the same
  kind of creature when the GM has hidden it.
- Static is reserved for an explicit anonymous-identity state supplied by a projection. The audited projections have
  no such flag: do not infer it from a missing class, definition, artwork, fog or `visibility`. A fully hidden actor
  is absent, so no Static tile is inserted for it. Until an explicit state exists, use the nineteen-avatar fallback.
- The sun frame marks who is acting and wraps whatever picture the creature has. Horizon is a default like the others
  and means nothing on its own.
- When two visible creatures share a picture, their tokens and tiles show initials in a small corner badge. Preserve
  `table/numbering.ts` names as well, so matching initials remain distinguishable. A token's name sits in a dark plate
  under it. Use a dedicated readable ink for that plate in both themes.
- Portrait and token edges: 2px `--party` for the party, `--hostile` for enemies, dashed `--violet` for anything hidden
  from players.

## Components

Build from `@vtt/ui`. A new primitive goes into `packages/ui` with `nh-` prefixed CSS and a test next to it. Sizes come
from the mockups.

- Primary (arcade) button: 52px tall (42px visual face in a section bar, within a 44px minimum hit area), `--primary-base` fill, `--primary-ink` label in Bungee
  at 16 to 18px, a 5px solid `--primary-edge` shadow under it and a soft pink glow. The label names the result: END
  TURN, MAKE LIVE, PLAY AS BORIN.
- Secondary button: at least 44px, a 1px `--line-raised` edge, `--surface-2` fill, Bai Jamjuree 14px semibold, with an
  optional 18px icon.
- Link button: cyan text without a box, at least 44px tall.
- Icon button: 44 by 44, always with an `aria-label`.
- Chip: 36px visual face with a 1px edge on a laptop, within a 44px hit area when interactive; 44px on a phone. A removable filter chip has a cyan edge and an x.
- Tag: VT323 uppercase at 15 to 18px, one or two words. NEXT has a white fill, WAIT an amber fill, HIT a yellow fill and
  MISS a grey fill; TAKEN, READY, SRD and HOMEBREW (yellow outline) mark status; HIDDEN FROM PLAYERS is dashed violet.
- Lamp: a square light. Lit means available or on and glows in its colour; unlit is `--surface-3` with a 1px edge and
  the value `--`. Action is magenta, Bonus yellow and Reaction cyan; Move is a gauge of white squares, one per 5 ft.
- Life bar: a segmented bar in a 1px well, lit segments `--hp` and lost ones `--hp-lost`. For exact HP use
  `clamp(ceil(maximum / 2), 1, 22)` segments and a clipped fill proportional to current/maximum. The VT323 number and
  accessible label give exact values, including temporary HP separately. At maximum zero, avoid division by zero.
  A projection that supplies only a health band shows the band label and existing band indicator, never invented
  HP numbers or an exact-looking life bar. Death saves and conditions stay available beside it.
- Switch: square, 46 by 26 visual track inside a hit area at least 46 by 44. Off is a grey knob on the left; on is a cyan knob on the right with a cyan edge and glow.
- Segmented control: a sunken well; the chosen option is raised with a cyan underline. Options are 40px tall on a
  laptop within a 44px hit area, and 44px on a phone.
- Row: a full-width button at least 52px tall with the name on the left, the key number in VT323 on the right and a
  one-line detail under the name in `--text-dim`.
- Table: a sticky 12px header in `--text-muted` and 48px rows. The selected row is tinted cyan with a 2px cyan edge on
  its leading side.
- Pending card: a 1px `--caution` edge on a faint amber tint, a WAIT tag, what happened and what it waits on, and one
  action appropriate to that pending state. Declining a reaction uses `reaction:answer` with `use: false` and lets
  the normal resolution proceed. `reaction:dismiss` drops held results in most cases; label it "Dismiss, settled by
  hand" and explain that consequence. Never wire "Resolve without waiting" to dismiss.
- Reaction prompt: a 2px cyan edge with glow; the title in Bungee with a slight RGB split; a three-box readout when
  those values are available (their roll, your AC, the result with the reaction); one line on the cost; the primary
  and one secondary. Shield is one sample state. Preserve all existing reaction kinds and server outcomes. Omit a
  withheld attack roll; do not recover it from a stat block or show a predicted hit/miss as an authoritative result.
- Roll card: the roller's portrait and who did what to whom; the total in VT323 at 40px with the dice beside it in grey
  and the outcome tag at the right; damage under a dashed rule, in yellow, with its type and dice.
- Chat line: the sender's portrait, their name in bold and the message in `--text-dim`, with no card around it, so
  messages read lighter than rolls.
- Message box: pinned at the bottom of the log. A row of quick dice (d4, d6, d8, d10, d12, d20) above one input with a
  dice icon and a send button. Text that parses as a dice formula (2d6+3) rolls; anything else is sent as a message.
  Until table chat exists (ADR-0037, phase 8), the input takes formulas only and its placeholder says "Roll dice, like
  2d6+3".
- Who sees it: an audience chip with the eye and Everyone (or names), or the violet crossed eye and Hidden. A hidden
  block is a dashed violet box with Reveal in its corner; a revealed block says who it reached and when, with Hide
  again.
- Focus: every control shows a 2px `--focus-ring` outline with a 2px offset on keyboard focus (`:focus-visible`). It is never
  removed or hidden.
- Toast: bottom right on a laptop, just above the bottom tabs on a phone. A `--surface-2` plate with a 1px
  `--line-raised` edge, a VT323 tag for its kind (DONE, or ERROR in `--danger-text`), one line of text, and Undo when the
  action can be undone. It stays 5 seconds, pauses on hover or focus, and is announced politely (`aria-live="polite"`).
  Destructive actions are labelled and confirmed.
- Reconnecting: when the connection drops, show a bar under the top bar with a WAIT tag and "Reconnecting. Wait before
  making changes." Controls that need the server are disabled with that reason; reading the last snapshot still
  works. Preserve unsent text as a local draft. Existing in-flight commands may time out; do not automatically
  replay them with new command IDs or announce success before an acknowledgement. When
  the connection returns the bar says "Back at the table" for 2 seconds, then goes.
- Empty states: one line saying what is missing and one button that fixes it, in the space the content would fill. For
  example, the log says "No rolls yet." above the dice, and an encounter without a map says "No map yet." with Pick a map.
  No illustrations; the sunset belongs to arrival screens.
- Icons are 20px stroked SVG. Never render an emoji or a text symbol as an icon.

## Motion

Light rail ([ADR-0045](adr/0045-light-rail-motion.md)) is the one motion language for change. The engine is
`packages/ui/src/motion/lightRail.ts` and the parts are drawn by `packages/ui/src/styles/light-rail.css`. The ADR lists
the moments and the phases that build them; a surface whose moment is not built yet keeps the motion it has.

1. Light travels from the old place to the new one. It drains out of the old place, runs as one comet, bursts and
   fills where it lands. A wash is optional.
2. Light rides lines that are already there: the horizon, a tab strip's edge, the top edge of a surface, a bar or a
   rail of pips. A line is never added for the light alone.
3. Content never waits. It starts fading in within 60 ms and is complete within 300 ms. The light around it ends
   within 500 ms. A sequence that lights several things in order, like a long rest or the start of an encounter, may
   run to 700 ms.
4. One pass per change. Light never loops or pulses. A moment plays again only when the thing happens again.
5. The page itself only fades. Light lives in bars, strips and overlays, so the pane keeps its no-transform rule and
   fixed overlays stay put. A wash in the pane animates opacity alone.
6. Waiting is still. Something waiting on a person shows WAIT on a grey, unlit line (`--unlit`) and doesn't move.
   When it resolves, light runs along that line.
7. Lists that reorder slide. When items change places, each slides from where it was in 240 ms, and light runs along
   the rail between the old place and the new one.
8. Each 80s element keeps its job. Status uses its own lines, and chrome lettering catches light only when it names
   who is acting (YOUR TURN). A condition chip arriving and concentration breaking are the only places for the pink
   and cyan split.
9. Dawn has no glow. The burst is a flash on the line, and the wash is half as strong.
10. Reduced motion skips the light, and content swaps instantly. Reduced transparency drops the wash and the glow.

Light presents state that has arrived from the server, and only what the viewer's projection already holds. It never
plays on first mount, and `canMove()` holds it while a whole snapshot lands (a connect, a reconnect, a switch of
encounter). On a new turn the sun frame slides to the next tile over 200 ms and the turn order scrolls it into view.
A life bar's lost segments flash white once (two frames) when damage lands, ahead of the light along the bar.

| Token             | Value                            | Used for                                  |
| ----------------- | -------------------------------- | ----------------------------------------- |
| `--dur-drain`     | 130 ms                           | The old place letting go                  |
| `--dur-comet`     | 230 ms                           | The trip, whatever the distance           |
| `--dur-fill`      | 140 ms                           | The new place lighting                    |
| `--dur-burst`     | 200 ms                           | The flash on arrival                      |
| `--dur-wash`      | 260 ms                           | Light falling onto what changed           |
| `--dur-content`   | 200 ms                           | The content fade                          |
| `--delay-content` | 60 ms                            | When the content fade starts              |
| `--delay-fill`    | 170 ms                           | When the new place starts to fill         |
| `--delay-burst`   | 210 ms                           | When the burst lands                      |
| `--delay-wash`    | 200 ms                           | When the wash starts                      |
| `--dur-count`     | 300 ms                           | A roll's total counting up                |
| `--ease-travel`   | `cubic-bezier(0.45, 0, 0.25, 1)` | The comet, slow to start and slow to stop |

## Page patterns

- Sections go in a bar. A section with several pages lists them in its bar with the search or the primary at the
  right end. A phone lists the app's sections as bottom tabs and the page's own views as a segmented strip under its
  header.
- A record reads as one document. The middle of the page shows the record as the people who use it see it: a Codex page
  as players read it, a stat block as the table prints it, an encounter as its map. A panel on the right answers what the GM
  asks about it: who sees it, where it is used, what it links to and its history. On a phone that panel folds into one
  row at the end of the document.
- A preview is the real thing, drawn by the component the real page uses. See it as switches the page in place to what
  Everyone or one chosen character receives, through the server's read for that audience.
- Lists are tables. Filters open from a Filters button and leave removable chips; sort names its order on its button.
  On a phone a table becomes rows with the two facts that matter most.
- Making something is a set of steps: steps down the left, each marked done (cyan check), current (cyan outline) or
  needing a choice (amber !); questions in the middle; a live preview on the right. On a phone the steps are a strip of
  chips and the preview is a bar above Next.
- Prep is a list, a preview and a setup column: encounters on the left with their status (a Live lamp, Ready, Needs a map,
  Draft, defined in IMPLEMENTATION.md using `factsOf` and `needsOf`), the whole staged map in the middle (fitted, never cropped), and on the right the encounter (monsters, XP and a difficulty meter against the
  party's budget), its Encounter settings (ADR-0039) and a Ready to go checklist, with Make live at the bottom.
- Decisions owed wait in one place: a pending card on the GM's Encounter tab, a prompt at the top of a player's Table tab.
- Time is a timeline. History is a list of versions with Compare and Restore.
- A map is present without taking over. Anything placed on a map has two ways in: a button and then a click on the map,
  or a right-click at the spot, which is a long press on a phone.

## The character sheet

- On a laptop the header holds the numbers read most: portrait, name in Bungee, species, class, level, subclass and
  background; AC, initiative, speed and proficiency in VT323 boxes; the life bar with Change HP; and Rest as one menu
  with Short rest and Long rest. The phone uses the compact UI-font identity with AC and HP; its rest row has the two
  separate buttons drawn in sheet-phone. Rest controls are hidden in an encounter. Keep the other vitals and HP editing
  reachable from the compact header's details sheet, without forcing laptop-sized boxes into it.
- Laptop: abilities as 2 by 3 tiles (name, modifier in VT323 at 34px, score under it), saving throws and senses; then
  skills with a cyan square for proficiency; then Spells, Gear, Features and Notes as tabs.
- Phone: Checks, Spells, Gear, Features and Notes as a segmented strip. Checks shows abilities 3 by 2, saves 3 by 2 and
  skills.
- Spells group by level with that level's slot pips in `--party`. On a laptop a spell's cost, range and effect sit
  in a column right beside its name, never at the far edge of the panel. Tags say REACTION, BONUS, RITUAL and CONC; an active
  effect shows in cyan with its time left.
- In an encounter a player's phone shows the turn card on Table: YOUR TURN in chrome with the VCR counter, the four lamps,
  any active effect, slot pips, actions grouped by cost and End turn. Off-turn it shows who is acting in the sun frame,
  only an available Reaction lamp lit, any prompt the player owes at the top, and the small map. A spent reaction,
  incapacitation or server refusal keeps it unlit. Extra actions and movement beyond 30 ft must remain legible.
- An option that can't be used now stays in its list, disabled, with the server's reason at full strength.
- GM-only data and restricted-control groups have a violet `GmOnlyTag`. Individual controls retain their semantic
  colours: the view's primary stays magenta, targeting stays cyan, and danger actions retain their warning treatment.
- The latest-roll line shows only rolls made from this sheet (`sheet-roll-ids.ts`).

## The Codex

- No left rail. The section bar lists Home, Pages, Atlas, Story and Quests; a phone uses the bottom tabs and the page's
  own header.
- A page or quest reads as one document with its hidden blocks in place and its metadata panel beside it. A hidden
  block is a dashed violet box with the crossed eye, the word Hidden and Reveal in its corner. A revealed one says who
  it reached and when ("Revealed to Lyra Emberwise", SESSION 4) with Hide again.
- Who sees it is Everyone, Hidden or chosen characters. A field has two audiences, Everyone or Hidden, chosen on its
  own row.
- See it as is a wrapping grid in the side panel: GM, Everyone and each character, using as many rows as needed.
  The mockup's party size is a fixture. Preserve the server-backed preview for every audience.
- Links in body text are cyan and underlined. The words are Hidden, Revealed, Reveal, Hide again, See it as and Who
  sees it.

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
- The page itself never zooms on a touch screen. The zoom guard (`apps/client/src/lib/zoom-guard.ts`) stops a
  stray pinch or double tap, and one finger still scrolls every region. An element with `touch-action: none`
  handles its own fingers, so the battle map and the atlas still pinch to zoom. Settings > Device has "Let pinch
  zoom the page" for anyone who needs the page larger, off by default and kept per device.
- On a touch screen every field a person types in or picks from is at least 16px (`--fs-field-touch`), because
  iOS zooms the page into a focused field with smaller text. The floor in `design-tokens.css` sees to it, so a
  field's own rule may stay smaller for a laptop.
- A focused input inside a locked region must stay visible above the on-screen keyboard.
- `prefers-reduced-motion` freezes animations and skips the light; reduced transparency replaces
  blur with a solid surface.

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
