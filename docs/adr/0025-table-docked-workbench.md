# ADR-0025: The table as a docked workbench

## Status

Accepted

## Context and decision drivers

The table grew a control at a time. By Phase 2 the map carried a floating toolbar, a staging tray, the scene
controls, the GM's target bar, the shape editor and an optional docked tracker, and the turn order lived in an
accordion beside it. A walkthrough of a first evening and the map design study (direction B, "Docked workbench")
found the costs: overlays covered the acting token and its drag path on a phone, a toast could sit on top of a
prompt, prompts were scattered across turn-order rows, two primaries competed for the same moment, and some
controls had two or three homes.

The drivers were the rules in docs/DESIGN.md (one primary per view, 44px targets, no page scroll, phones
first-class), the requirement that nothing covers the acting token, a drag path or a target, and keeping the
server-decides model untouched.

## Considered options

1. **Full-bleed map with a floating heads-up panel.** The most map on every device, but it keeps overlays on
   the map, the cause of the worst phone bug, and needs a bottom sheet with snap points that fights the map's
   pan and pinch.
2. **Turn cards with the map on demand.** Strong for decisions, weak for movement, and the largest rebuild.
3. **A docked workbench.** Every control gets one fixed home beside the map, and nothing floats over it but
   tokens and marks.

## Decision

Option 3. The table (`shell/TableView.tsx`) is a frame of docked regions:

- **The header bar** (`table/TableHeader.tsx`) above the map: the live scene and its menu (or the staged scene
  with Back to live and Make live), the status line, which also shows the newest notice through `ToastOutlet`,
  and for the GM the fog and vision chips, the TV control (`table/TvControl.tsx`) and the sound chip.
- **The tool rail** (`scene/MapRail.tsx`) beside the map: Select, Measure and Ping, then the groups (Draw, View,
  and for the GM Fog, Terrain, Walls and Light). A group's options open in a column beside the rail and the map
  narrows to make room. The selected drawing's editor takes that column too.
- **The panel** (`table/TablePanel.tsx`): what must be answered first (Needs you for the GM, the prompt slot for a
  player), one real tablist, and a footer with the view's one primary. The GM's tabs are Fight, Dice, Log and
  Token on a laptop; a player's are Turn, Order, Sheet, Dice and Log in a fight and Me, Party, Dice and Log
  between fights. The chosen tab is remembered per device. The role panels (`GmEncounterPanel`,
  `PlayerEncounterPanel`) build their tabs and footer, so one instance owns the turn controls whichever tab is
  shown.
- **Below 980px** the same parts stack: the header as one row, the rail as a tool row with the options as a
  second row, the map pane, a divider, then the panel, whose footer is the bar under the thumb. The divider
  (`table/PaneDivider.tsx`) is a separator with a value that a finger drags and the arrow keys move, remembered
  on the device. Choosing a target lowers it so the map takes most of the height, and the target picker's Cancel
  and Roll move into the bar (`table/footerSlot.tsx`) while the bar's own controls step aside.

The docked tracker, the dock picker, the accordion, Enlarge map, the floating toolbar and its phone Tools rail, the
scene controls over the map, the GM's target bar and the combat log drawer are gone. The staging tray is a row of
the map column, shown only while tokens wait in it.

## Consequences and tradeoffs

- The map loses width to the rail and the panel on a laptop (about 820 by 700 pixels at 1280 by 800) and height
  to the panel on a phone. Nothing ever covers a token, and the smoke suite checks that the acting token's centre
  hits the token at both widths.
- Tabs hide each other: calling a roll from Dice hides the order. Needs you and the footer stay in view on every
  tab, which keeps the decisions and the primary one tap away.
- A tab's content unmounts while hidden, as the accordion's did: a half-typed dice formula does not survive a tab
  change.

## Mobile, security, and visibility impact

Phones get the same features in the same build: the tool row scrolls sideways, every control keeps a 44px target,
and the footer pads itself by the device's safe area. No projection changed for this layout. The Token tab shows
the GM's own state; the player's panel reads only the player projection.

## Migration / reversibility

Client only. Stored dock preferences (`vtt.dock-position`, `vtt.dock-width`, `vtt.dock-open`) are ignored; the
tab choice is stored under `vtt.table-tab.<role>.<width>`. Reverting is a client revert.

## Validation evidence

- `table/panel-tabs.test.tsx`: the tablists per role and moment, panels tied to tabs, the remembered tab, and the
  footer's primary.
- `table/pane-divider.test.tsx`: the separator's value, keys, drag and memory.
- `table/needs-you.test.tsx`, `table/prompt-slot.test.tsx`, `table/tap-to-target.test.tsx`.
- `e2e/journeys.spec.ts`: the fight journey on the new layout at 390 by 844 with touch and at 1280 by 800, with
  the uncovered-token and uncovered-primary checks.
