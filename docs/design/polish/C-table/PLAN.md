# C The table's frame: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update U6: ADR-0046 and the handoff"). This plan rebuilds the table's frame: the laptop workbench, the turn order, how a turn is taken and the phone's table. It adds no rules, commands or data. File paths and line numbers were read at `f5e166f`; the theme (T), the frame (A) and the character sheet (D1) land on the same branch first or alongside, so confirm every anchor before editing. Paths are under `apps/client/src/` unless they start with `packages/`, `apps/server/`, `e2e/` or `docs/`.

This is area C's frame in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it. The groups inside the table (C2 to C6) get their own rounds afterwards.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in eight phases, C0 to C7, each about one commit.
- The reference is `table.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else is inline). It opens on the approved choices. Use Who (GM or player) and Moment (Lyra's turn, Goblin Boss's turn, before the fight); on the phone frame, the Map, Turn or Encounter, Log, Party and Notes segments work. The other options in the four decision switches are the ones the owner turned down; build only the chosen ones. `history/1-round-1.html` is the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its map, log and notes are stand-ins. Build with the existing components, hooks and primitives. Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md` applies on top, and `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The laptop table is Two docks: a 232 px left dock with the turn order and the tools under it, the map with nothing over it but its own things, and a 380 px panel at the right with End turn in its foot. The strip over the map goes.
2. The turn order is a Ladder: one row per combatant with face, name, initiative, hit points by role and conditions; the acting row carries the ink.
3. A turn is taken through Cost tabs: Action, Bonus Action, Reaction and Move (and Legendary for a creature with them); the chosen tab lists what it costs as rows. One design for the player and the GM.
4. A phone's table is a Switch: Map, Turn, Log and Party (the GM adds Notes) one at a time under the header, the order on top and End turn pinned.
5. Eight rules for the table (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- C builds on T and A. T1 to T3 (the Base line, `Group`, the section bar) and A1 to A3 (the menu, the live chip, the phone frame without a top bar) must be on the branch before C1. If they are not, stop at the phase that needs them and tell the user.
- D1 (the Ledger sheet) owns `sheet/`, apart from what this plan says about `sheet/turn-options.ts`, `sheet/ActionList.tsx` and `sheet/TurnCard.tsx`, which D1's plan leaves to the table. D1's phase L5 adds `range`, `hitOrDc` and `damage` to `TurnOption`; C4 uses them. If L5 is not on the branch at C4, add those three fields exactly as D1's plan section 4.5 describes, with its tests, so D1 finds them done.
- CLAUDE.md applies in full. The server decides every roll, turn, movement and use; every command in section 3 keeps going through the same hooks. Projections are the boundary: a player sees a foe's health band (`PlayerHp` band, `views.ts` 34 to 35) and never its hit points, and the Ladder must read only what each view already holds. No server code, shared domain, schema, command or HTTP route changes; `npm run map` should not report a change.
- `design-conventions.test.ts`: tokens (d), the breakpoint ladder (f; the table's widths are 980 and 1280, both on it), `.scroll-y` (h), the display face in capitals (i), one Eyebrow (c), toasts (e).
- The pane rule (`styles.css`): nothing that makes a containing block on `.app-pane` or its child. The map's controls and the tool options are inside the map's own box.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area; option rows at least 48 px.
- Motion keeps its light (ADR-0045): the order light that runs along the turn order and lights the turn's lamps (`table/TableStrip.tsx` 35 to 46, `useOrderLight`) moves to the Ladder on the vertical axis; the lamps' afterglow, the HP light and the inks stay.
- The encounter page in Prep (catalog E1.3) reuses `MapRail` and `TablePanel` (`docs/ARCHITECTURE.md` 1135 to 1136). Keep it working as it is; it changes in area E.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before calling a phase done, and look at the table at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The workbench

- `shell/TableView.tsx` (`TableView` 59 to 248): `PHONE_TABLE_QUERY = "(max-width: 979px)"` (50 to 51) gives `phone`; `usePhoneShell()` (64) gives the strip's phone header. `header` is `TableStrip` (95 to 100), `map` is `EncounterMap` (102 to 119), the "No map loaded yet" hero (120 to 140, the GM's "Prepare an encounter" and `JoinAddress layout="hero"`), the panel is `EncounterPanel` (157 to 228; the player's top slot holds `RestPrompt` and `PromptSlot`, 204 to 210), a claim-only player gets a picker (231 to 236). The DOM is `.table-bench > header + .table-bench-split(.map, .panel)` (237 to 247), with `StripEndContext` around the panel.
- `shell/table-view.css`: the laptop grid (5 to 19, `minmax(0, 1fr) 24.5rem` with areas "head panel" and "map panel"), `.table-bench-split { display: contents }` on a laptop (21 to 23), map 24 to 30, panel 31 to 52, the phone column under 980 px (54 to 75), `.is-claiming` (77 to 86), the empty hero (88 to 117).
- The phone column scrolls the map away to reach the panel: `table/scrollPast.ts` (`useScrollPast`, 4 to 45, moments "choosing" for targeting and "sheet" for a sheet or an owed prompt) and `table/scroll-past.css` (5 to 22, the map 24 rem).

### 3.2 The strip and the tiles

- `table/TableStrip.tsx` (`TableStrip` 27 to 114): `useOrderLight` (35 to 46, the only place the turn's lamps light); `VcrCounter` (55); the GM's phone header (64 to 81: counter, compact `LiveScenePicker`, `NowPlaying`, Join, the end slot, tiles as a second row); in a fight (82 to 94) the counter, `TurnTiles`, a `ToastOutlet` for table notices, the GM's `NowPlaying`, the player's `MeButton` and `.table-strip-end`, the portal target of the Encounter menu; idle (95 to 113) `idleStatus` (`table/status.ts:31`) and the GM's `JoinAddress layout="strip"`. `MeButton` 116 to 133 calls `focusTokenOnMap` (`scene/tableGeometry.ts:63`); `JoinButton` 135 to 148.
- `table/TurnTiles.tsx`: `turnTiles()` (23 to 49) returns `{ actorId, name, score, acting, next, acted, hidden }`; `TurnTiles` (57 to 121) draws `ActorPortrait`s with no hit points; a "GM turn" tile shows during `hiddenTurn`. `turnTiles` also gives `GmEncounterPanel`'s "Next: X" (553). CSS `table/table-strip.css`, `table/turn-tiles.css`.
- `encounter/FightMenu.tsx` 77 to 99: the "Encounter" menu (aria "Encounter options", 165 to 175), portalled through `table/stripSlot.tsx` (`StripEndContext`, `InStripEnd`, 8 to 13).
- Data: `packages/domain/src/views.ts`: `HealthBand` "healthy", "bloodied", "down" (32), `PlayerHp` exact or band (34 to 35), `PlayerInitiativeEntry` with `health`, `conditionIds`, `conditions` (171 to 179), `PlayerCombatView` with `round`, `turnActorId`, `hiddenTurn`, `initiative`, `turn` (`actionUsed`, `bonusActionUsed`, `actionInstance`, `bonusActionInstance`, `turnUses`, `movementUsedFeet`, `extraActionReady`) and `reactionsUsed` (275 to 304). The GM's side in `state.ts` (`InitiativeEntrySchema` 90 to 99; `round`, `turnActorId`, `initiative`, `turn` 1792 to 1802; `reactionsUsed` 1956; `legendaryUsed` 1958). The projection builds `health` with `healthBandOf` (`apps/server/src/projections.ts` 122 to 138).
- Words: `actors/actor-display.ts` `BAND_LABELS` (14) and `hpLabel` (18 to 21); `encounter/conditions.tsx` `healthBandFor` (66 to 75); `encounter/InitiativeList.tsx` `InitiativeRow` (50 to 72) and `ConditionDots` (25 to 42). The kit's `LifeBar` draws an exact bar or a band word.

### 3.3 The panel

- `table/TablePanel.tsx`: `PanelTab { id, label, content, scrolls }` (8 to 14), `TablePanel` (21 to 96; the kit `Tabs`, the foot slots 88 to 93), `useRememberedTab` (102 to 125). `table/footerSlot.tsx` (`InFooter`, phone only). CSS `table/table-panel.css`.
- GM, `encounter/GmEncounterPanel.tsx`: tabs (654 to 672) `fight` "Encounter" with the needs count (605 to 615), `order` (phone in a fight), `log`, `party`, `notes`, `token` while a token is chosen; key `vtt.table-tab.gm.{phone|laptop}` (674 to 679); label "The encounter · round N" or "The table" (684). The fight body (616 to 633): needs, `ActingConsole` (531 to 544), then the laptop-only disclosure "Turn order and tools" (621 to 626) holding `GmInitiativeRow`s (458 to 528). The foot `turnControls` (554 to 592): Previous, End turn, Next turn or Resume live play (245), "Next: {name}" (577), the Encounter menu through `InStripEnd` (579 to 590); `startControls` (593 to 600).
- Player, `encounter/PlayerEncounterPanel.tsx`: tab ids (319) `turn`, `sheet`, `log`, `party` in a fight and `me`, `log`, `party` otherwise; key `vtt.table-tab.player.{phone|laptop}` (320 to 325); `?panel=log` (328 to 337); tabs (658 to 683); the foot `PlayerEndTurn` (229 to 259, 686 to 692).

### 3.4 The map's tools

- `scene/MapRail.tsx` (`MapRail` 80 to 217): direct tools Select, Measure (needs a grid) and Ping (63 to 67); groups (92 to 105) Draw, Fog, Terrain, Traps, Weather, Walls, Light, View for the GM; Draw, Traps (found only), View for a player; `role="toolbar"` "Map tools" (138); Me (158 to 170, phone only); the options column (188 to 214). Groups in `scene/MapToolGroups.tsx`; `ViewGroup` (719 to 754) holds zoom in and out, Fit map, Fullscreen and Notifications. There is no control over the map.
- `scene/map-rail.css`: a 64 px column (11 to 18), Me hidden on a laptop (62 to 65), options 15 rem (66 to 76), the phone row (115 to 182).
- `scene/EncounterMap.tsx`: the rail (676 to 751), `.map-bench` (756 to 787), `trayShown` (558). `scene/MapTokenTray.tsx` (11 to 63, "Staging tray") renders above the stage inside `.encounter-map-interaction` (777 to 786). CSS `scene/encounter-map.css`.

### 3.5 Taking a turn

- GM: `encounter/ActingConsole.tsx` (15 to 237): the lamps (171 to 230, `.lamp-row` "This turn") send `turn:use { slot }` and `turn:use-reaction`; `MoveLamp` shows speed less `movementUsedFeet`; legendary actions (46 to 61, 127 to 169, `turn:use-legendary`); `ActionRunner` (233). `encounter/ActingCard.tsx` (16 to 63): region "Now acting · {name}", the name in chrome. `encounter/ActionRunner.tsx` (41 to 324): `content:monster-actions` (78), `resolveActionDirect` or `beginTargeting` (249 to 260), the target picker, the result card. `encounter/GmActionList.tsx` (190 to 288): action rows, `CommonActionChips`, `SpellList`, traits; not grouped by cost; `availabilityHint` (54 to 112).
- Player: `PlayerTurnEconomy` (`PlayerEncounterPanel.tsx` 119 to 226: `LampToggle`s Action, Bonus, Reaction, `MoveLamp`, "+1 action", "N ft over"; group "Your turn resources"); the runner (416 to 449) with `look={phone ? "card" : "list"}`, so a laptop shows `ActionList` and a phone `TurnCard`; `turnBody` (469 to 555, section "Your turn"). `encounter/PlayerTurnCard.tsx` (`nextTurnWords` 11 to 19; `PlayerTurnCard` 26 to 78 with the h2 "Your turn" and the waiting head "{name} is acting"). `encounter/PlayerActionRunner.tsx` (`look` and `filter` 241 to 253; pins 436 to 439; `TurnCard` or `ActionList` 491 to 518; `CommonActionChips` 530 to 542).
- `sheet/turn-options.ts`: `TurnCost` (8), `COST_GROUPS` (11 to 17: action, magic, bonus-action, reaction, other), `TurnOption` (19 to 49), `effectParts` (182 to 195), `turnOptions` (115 to 288). `sheet/ActionList.tsx` (`OptionRow` 15 to 55, `ActionList` 62 to 113 grouped by cost). `sheet/ActionsTab.tsx` already filters options by cost (`ACTION_SUBTABS` 23 to 31, `ACTION_FILTERS` 37 to 44), the precedent for Cost tabs; D1 removes those subtabs from the sheet.
- `sheet/TurnCard.tsx`: favourite tiles (`TILES = 6`, `MOST_PINS = 8`, 9 to 54), "All {n} options" and "Edit favourites" (219 to 226). Favourites are `favouriteOptionIds` and `optionUseCounts` (`views.ts` 155 to 157), set by `character:set-favourites`; `pinsOf` in `sheet/sheet-model.ts:171`.
- The lamps: `packages/ui/src/primitives/Lamp.tsx` (`Lamp` 31 to 67, `MoveLamp` 76 to 107); `encounter/LampToggle.tsx`; `encounter/lamp-toggle.css`. Common actions: `encounter/CommonActionChips.tsx` (`PRIMARY_BUILTINS` 6).
- Prompts: `table/PromptSlot.tsx` (167 to 403, region "Answer now", which C4 and C6 rename "Prompts"; the reaction card 233 to 256), kinds in `table/playerPrompts.ts`. The slot is capped at half the panel (65 % on a phone).

### 3.6 Tests that pin it

- Unit: `table/turn-tiles.test.ts`; `table/orderLight.test.tsx` (64 to 115, `.turn-tile-score`); `table/panel-tabs.test.tsx` (GM 112 to 183: "The encounter · round 2", tab names, "Now acting · Lyra", "Turn order and tools", End turn, "Next: Borin", the stored key; player 185 to 253: tabs, "Your turn", the lamps group, End turn alone in the foot, "Goblin 1 is acting"; the footer slot 255 to 289); `table/people-light.test.tsx:93`; `table/phone-sheet.test.tsx` 132 to 170; `sheet/turn-card.test.tsx` 66 to 163; `sheet/favourites.test.tsx:50`; `encounter/player-turn-economy.test.tsx` 50 to 70; `encounter/player-common-actions.test.tsx` 94 to 135; `encounter/monster-actions.test.tsx` 120 to 195; `table/prompt-slot.test.tsx` 106 to 199; `table/commanded-creature.test.tsx`; the "Map tools" toolbar in `scene/vision-areas.test.tsx`, `see-as.test.tsx`, `hazards.test.tsx`, `map-placement.test.tsx`; the tray in `drag-surfaces.test.tsx`. No unit tests for `TableView`, `TableStrip` or `MapRail` itself.
- `e2e/journeys.spec.ts`: the empty table's "Join address" (116 to 129) and "Prepare an encounter" (163); "The encounter · round 1" (279, 285, 442); End turn (282, 287, 289, 405, 444); "Your turn" (286 to 288, 388, 443 to 445); the phone's scroll past (290 to 302: `.table-bench-split`, `.table-strip` against the panel's tablist); "Staging tray" (305); the Turn tab (387); "Answer now" (397, "Prompts" after C4 and C6); the phone turn card (448 to 472: region "Your turn", the "Action · cantrip" tile, "All N options", the Guiding Bolt tile, the cast card, targets, "Roll Guiding Bolt"); "Map tools" (541, 590, 627); "The table" tabs (962 to 966, 1061 to 1062). `e2e/smoke.ts:171` scrolls `.table-bench-split` in `expectTokenUncovered`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The workbench grid | Changed: dock, map, panel; no strip | `TableView`, `table-view.css` |
| `table/TableDock.tsx` | New: the round head, the Ladder, the tools | `VcrCounter`, `TurnLadder`, `MapRail` |
| `table/TurnLadder.tsx` | New, replacing `TurnTiles`: rows (dock) and cards (phone) | `turnTiles()` extended with health and conditions, `LifeBar`, `BAND_LABELS`, `ConditionDots`, `useOrderLight` |
| `scene/MapControls.tsx` | New: centre on me, zoom out, zoom in, in glass at the map's bottom right | `focusTokenOnMap`, the View group's zoom |
| The tray chip | Changed: `MapTokenTray` behind a chip and a popover | `MapTokenTray` |
| `encounter/TurnTabs.tsx` | New: the cost tabs, the state line, the filtered rows | `LampToggle`'s commands, `MoveLamp`, `ActionList` with `filter`, `GmActionList` grouped by cost |
| The phone Switch | New: the segmented views, the cards on top, the pinned foot | the kit `SegmentedControl`, `useRememberedTab` |
| Turn heads and the foot | Restyled | `PlayerTurnCard`, `ActingCard`, `turnControls`, `PlayerEndTurn` |

## 5. Phases

### C0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `C-table/`, and leave the other pieces' folders as the zip has them.
2. Add `C-table/ADR-0050-table-frame.md` as `docs/adr/0050-table-frame.md`, Accepted, and its row to `docs/adr/README.md`. Note on ADR-0025's row that the turn order's place is changed by 0050. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### C1: the workbench and the strip's pieces

1. `TableView` on a laptop (980 px and up): a grid of the dock, the map and the panel. `table-view.css`: `grid-template-columns: 232px minmax(0, 1fr) 380px` at `min-width: 1280px`, and `72px minmax(0, 1fr) 380px` from 980 to 1279 px; one row; no "head" area. Under 980 px the phone layout stays as it is until C5.
2. `table/TableDock.tsx`: a column with the round head (`VcrCounter`, `PLAY ▸ RND 02` or `STOP ■ RND --`), a slot for the order (C2 fills it; until then render today's `TurnTiles` in a column) and a slot for the tools (C3). Before a fight it shows `idleStatus` as one description line under the head.
3. Move the strip's pieces: the picker is the top bar's live chip (A2), so drop it here; Me becomes a map control (C3); the Encounter menu's portal target (`.table-strip-end`, `StripEndContext`) moves to the head of the Encounter tab; `NowPlaying` and, before a fight, the GM's `JoinAddress` move to the Encounter tab; the strip's `ToastOutlet` goes, so table notices land in the corner like every other toast (A5). Keep `TableStrip`'s phone header until C5 removes it.
4. Tests: `panel-tabs.test.tsx` where it reads the Encounter menu; the journeys that pressed the menu or Join in the strip; the empty table's "Join address" (116 to 129) now in the Encounter tab on a laptop.

### C2: the Ladder

1. Extend `turnTiles()` (or add `turnLadder()` beside it) with each entry's health and conditions: for the GM, exact hit points from the actor; for a player, `PlayerInitiativeEntry.health` and `conditions`, read through the existing view types only. Keep `next`, `acting`, `acted` and `hidden`.
2. `table/TurnLadder.tsx`: rows for the dock (`SPEC.md` 2.2 and 4) and cards for the phone (150 by 64 px, one line that scrolls sideways). The GM's bar is `LifeBar` with the numbers; a player's foe shows its band word from `BAND_LABELS` (Healthy, Bloodied, Down) and never a bar. Conditions as `ConditionDots` turned into small tags. The acting row's tint, amber initiative and the ink at its left; NEXT under the next initiative. During `hiddenTurn` a row "The GM is taking a turn" is the acting row. Before a fight, the staged combatants with `--`.
3. Move `useOrderLight` from `TableStrip` to the Ladder on the vertical axis, with the lamps; its test's selector (`.turn-tile-score`) follows.
4. From 980 to 1279 px the rows show the face and initiative only, with the acting ink; a pointer or focus on a row shows it whole over the map's edge (a tooltip-like panel, not a popover that steals focus).
5. Tests: `turn-tiles.test.ts` becomes `turn-ladder.test.ts` (health by role: a player's foe has a band word and no number; conditions; hidden turn; before the fight); `orderLight.test.tsx`; `people-light.test.tsx`.

### C3: tools in the dock, the map's controls and the tray chip

1. `MapRail` gains a `layout` prop: "column" (today, kept for the encounter page in Prep), "grid" (the dock: two columns of icon and word, 46 px rows) and "row" (the phone). The toolbar keeps its name "Map tools" and its keyboard behaviour. A group's options open beside the dock, over the map's left edge, as today's 15 rem options column in glass.
2. `scene/MapControls.tsx`: centre on me (`focusTokenOnMap`; for the GM, centre on the acting token), zoom out and zoom in, in glass at the map's bottom right on every size (`SPEC.md` rule 6). The View group keeps Fit map, Fullscreen and Notifications. Remove the strip's `MeButton` and the rail's phone Me (158 to 170).
3. The tray (rule 4): `MapTokenTray` sits behind a chip at the map's top left ("Tray" and the count in VT323 amber) that opens it as a popover; dragging a token from the popover onto the map and tapping one to drop it at the centre still work. The chip shows only while tokens wait.
4. Tests: the "Map tools" tests by role; `drag-surfaces.test.tsx` for the tray; the journey at 305 opens the chip first; a test for the map controls (Me centres on the player's token).

### C4: Cost tabs

1. `turn-options.ts`: use D1's `range`, `hitOrDc` and `damage` (section 2). Add `costTab(option)`: action and magic go to Action, bonus-action to Bonus Action, reaction to Reaction, other to Action after the costed ones.
2. `encounter/TurnTabs.tsx`: four tabs as one segmented control (the kit's `SegmentedControl` with a lamp, a name and a state per option, or a radiogroup that draws the same way): Action, Bonus Action, Reaction and Move (the feet left from `MoveLamp`'s numbers; choosing it lists nothing and shows the movement line). A creature with Legendary Actions gets Legendary with the count left. Under the tabs, the state line: "Action · ready" or "used", with Mark used or Mark ready sending today's `turn:use` or `turn:use-reaction` (the lamps' commands), plus "+1 action" (`extraActionReady`) and "N ft over" where they apply. The tab opens on Action at the start of a turn, moves to the next unspent cost when one is spent, and otherwise stays where it was put.
3. The list: the chosen tab's options as `ActionList` rows with the columns (Name and its line, Range, Hit / DC, Damage), one header row, the row the button. Favourites (`pinsOf`) first with a small star. After the Action tab's list: the options that cost nothing, "Anyone can" with `CommonActionChips` as Base line chips, and Edit favourites (today's editor from `TurnCard`, in a dialog).
4. The player: `PlayerEncounterPanel`'s turn body uses `TurnTabs` on every size; retire `PlayerTurnEconomy`'s lamp row and the runner's `look="card"`. Off their turn: the waiting line from `nextTurnWords`, Action and Bonus Action marked NOT NOW, Reaction chosen.
5. The GM: `ActingConsole` uses `TurnTabs` for the acting creature. `GmActionList` groups by cost through the same filter: the monster's actions by their cost, its spells by casting time, its traits as an open group at the end of the Action tab. Legendary actions keep `turn:use-legendary`.
6. If `TurnCard` and its tiles are no longer used anywhere, delete them with their tests, keeping the favourites editor; otherwise leave them.
7. Tests: `panel-tabs.test.tsx` (the lamps group becomes the cost tabs; End turn alone in the foot), `player-turn-economy.test.tsx` (Mark used sends `turn:use`), `player-common-actions.test.tsx`, `monster-actions.test.tsx` (legendary tab), a new `turn-tabs.test.tsx` (the opening tab, moving on after a spend, the waiting state, favourites first), `turn-card.test.tsx` and `favourites.test.tsx` as step 6 decides; the journeys at 448 to 472 (choose Action, the Guiding Bolt row, its cast card, a target, the roll).

### C5: the phone Switch

1. Under 980 px: the header (A3's page header; `TableStrip`'s phone header is retired), the Switch, the Ladder's cards, the chosen view, and the panel's foot pinned above the bottom tabs. The Switch is the kit `SegmentedControl` used as the panel's tabs on a phone (it keeps `role` and names the views as the tabs did): Map, Turn (Me before a fight), Log, Party for a player; Map, Encounter, Log, Party, Notes for the GM. Remember the choice with `useRememberedTab` under today's phone keys; the views' ids are the tabs' ids plus `map`.
2. Map shows the tools as one row (`MapRail layout="row"`) over the map at full height with its controls. A chosen token's GM tab opens over the Map view as a sheet until C3.10 designs it.
3. Replace the scroll past with the Switch's moments: targeting ("choosing") turns to Map with the target picker pinned in the foot; an owed prompt or the start of the player's turn turns to Turn. Delete `useScrollPast`, `scroll-past.css` and the `.table-bench-split` phone column.
4. The GM's phone `order` tab goes; the "Turn order and tools" disclosure in the Encounter view shows on every size until C3 designs the row tools.
5. Tests: `phone-sheet.test.tsx`, `commanded-creature.test.tsx`, `panel-tabs.test.tsx` on a phone; the journey at 290 to 302 becomes: the Switch is visible, Map shows the map and its tray chip, Turn shows the cost tabs, End turn is uncovered in both; `smoke.ts:171` `expectTokenUncovered` chooses Map instead of scrolling.

### C6: heads, the foot and the acting token

1. YOUR TURN once (rule 2): `PlayerTurnCard`'s h2 "Your turn" stays the heading and is the only Bungee on the table; `ActingCard`'s name moves from chrome to Chakra Petch 600 capitals 19 px, with the acting line ("Acting · you run it", "Acting · from the player's device"); its region name stays "Now acting · {name}".
2. The foot (rule 1): End turn, Next turn or Resume live play as the Cup; the GM's Previous as a Base line icon control beside it; "Next: {name}" under it in 12.5 px `--text-muted`. Off their turn a player's foot says when their turn comes, with no button. Before a fight, Start the encounter.
3. The acting token's ring is amber on every map (rule 7); check `MapToken` and keep its light.
4. Tests: `panel-tabs.test.tsx` names; a check that the table renders the chrome face once.

### C7: docs and cleanup

1. `docs/DESIGN.md`: "Familiar first" (20 to 22) without "turn order across the top"; the workbench (190 to 204) for the dock, the Ladder, the map's controls and the 380 px panel, fixing today's disagreements (it says 360 px, a different rail list, a zoom control over the map and "a small map with Open map"); the phone shells (177 to 184) and the phone table (404 to 406, 440 to 443) for the Switch; the Lamp (291 to 296) for the cost tabs; the light (381: the sun frame slides along the Ladder, not the tiles).
2. `docs/ARCHITECTURE.md`: the table (1096 to 1121), the encounter pages' reuse (1135 to 1136, `MapRail` layouts), turn options and `TurnTabs` (1150 to 1160), the order light (1222 to 1227).
3. `docs/adr/README.md`: 0050 Accepted and built.
4. Remove what nothing uses: `TurnTiles` and its CSS, the strip's laptop rules, `scroll-past`, `PlayerTurnEconomy`'s row, `TurnCard` per C4 step 6.
5. `docs/design/polish/CATALOG.md`: C's frame moves to Built.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- Run a fight like the mockup's (the party against a Goblin Boss and two goblins on a map) and look as the GM and as a player, in Dusk and Dawn, at:
  - 1280 by 800 with a mouse: the dock's Ladder (hit points by role, conditions, the acting ink, NEXT), the tools grid and an open group's options, the map with nothing over it but the tray chip and its controls, the panel's cost tabs for Lyra and for the Goblin Boss (GM), End turn in the foot.
  - 1100 by 800: the narrow dock; a row shows whole on pointer and focus.
  - 390 by 844 with touch: the Switch's views, the cards on top, End turn in reach in every view, targeting turning to Map, an owed save turning to Turn; every control at least 44 px; no sideways scroll.
  - Before the fight, as both.
- With reduced motion and reduced transparency.
- Every behaviour in section 3.5 still reachable: use and restore each cost, move, a legendary action, attack and cast with targets, a reaction off-turn, end the turn and go back one (GM), favourites first and Edit favourites.

## 7. Left as they are, for later rounds

- The map's menus and each tool's options (C2), the GM's row tools and initiative editing (C3.5, C3.6), Needs you, starting an encounter and the encounter's other GM parts (C3), the Notes tab's own design (C3.9) and the Token tab (C3.10).
- Prompts, rests and the replay shelf (C4.3, C4.4, C4.6), the log and dice (C5), the encounter dialogs (C6).
- The encounter page in Prep and its map (area E).
- Every command, projection and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's wound words were first drawn as Unhurt and Wounded; the approved mockup uses the app's Healthy, Bloodied and Down, and so does the build.
- The mockup draws the Move tab without a view; in the app choosing it shows the movement line (feet used, left and over) and the dash state.
- The mockup does not draw favourites, Edit favourites, the Legendary tab, the narrow dock, the tool options column, the tray's popover or the phone's Token sheet; `SPEC.md` and section 5 place them.
- The mockup's Notes and Log views are stand-ins; C3.9 and C5 design them.
- The mockup's tokens, map and VCR digits are drawn; the app keeps its own.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `table.html`.

- `p4c-table.css`: the layouts (`.L.docks`, `.dock`), the order (`.ord.v.o-ladder`, `.ord.h.o-ladder`, `.c-ent`, `.hpb`, `.wword`, `.cond`), the tools (`.tools.grid`, `.tools.row`), the map (`.tmap`, `.ttok`, `.mctl`, `.tray`), the panel (`.tpan`, `.pfoot`), the turn (`.turn-h`, `.yourturn`, `.ctabs`, `.ctab`, `.cstate`, `.ahead`, `.arow`, `.chips2`, `.waitline`), the phone (`.P.switch`, `.segw`, `.pv-map`).
- `p6-table.js`: the fight (`C`, `LYRA`, `BOSS`), `ord()`, `turnBody()` (the `costs` branch), `footer()`, `tabNames()`, `laptop()` and `phone()` (the `docks` and `switch` branches), `partyBody()`, `logCol()`, and the rules in `renderStatic()`.
- `p4b-frame.css` and `p4-spec.css`: area A's frame and the theme spec's parts the table is drawn with.
- `audit-c.js`: the map image and the "Today" screenshots.
