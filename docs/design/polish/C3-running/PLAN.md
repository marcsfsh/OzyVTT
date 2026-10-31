# C3, second round: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the start of an encounter as one form, moves a creature's tools under
its row in the order, hangs the encounter's options from the panel's tabs, lays Add monsters out as the Compendium's
browse, and makes each roll in a waiting card its own button. It adds no rules, commands, routes or data. File paths
and line numbers were read at `f5e166f`; the theme (T), the frame (A), the table's frame (C), C3's first round, the
Compendium (G) and Settings (I) land on the same branch first or alongside, so confirm every anchor before editing.
Paths are under `apps/client/src/` unless they start with `apps/`, `packages/`, `e2e/` or `docs/`.

This is C3's second round in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build
it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, R0 to R6, each
  about one commit.
- The reference is `running.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else is
  inline). It opens on the approved choices. Use the Page switch (Before the fight, A creature chosen, The encounter's
  options, Adding monsters, Prompts waiting). The other options in the decision switches are the ones the owner turned
  down; build only the chosen ones. Its Carried in section lists the settled parts every choice is built from.
  `history/` holds the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its fight is a stand-in.
  Build with the existing components, hooks and primitives, and with the settled ones (T's Cradle and Base line, C3's
  cards, G's filter panel and stat block, I's rows). Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top, and `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. Starting an encounter is one form of Cradles, In this encounter named once.
2. A creature's tools open under its row in the order; the dock widens while a row is open.
3. The encounter's options are a menu from a More button at the end of the panel's tabs.
4. Adding monsters is a dialog laid out as the Compendium's browse, with the one stat block.
5. In a waiting card, a roll is the button.
6. Seven rules (`SPEC.md` section 3), starting with nothing new in the controls.

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin (one surveyed for this plan was 26 commits behind), so pull before reading any anchor.
- This builds on T1 to T3; C1, C2 and C5 (the workbench, the Ladder in the left dock, the phone Switch); C3's first
  round (Q1 to Q4); G3 and G4 for R4 (the filter panel and the results, which R4 reuses); and I3 for R3's rows. If one
  is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every command, payload and authorization stays as it is: `encounter:start`,
  `actor:apply-damage`, `actor:heal`, `actor:set-temp-hp`, `actor:set-hp`, `actor:revive`, `actor:set-condition`,
  `actor:set-attitude`, `effect:end`, `encounter:remove-combatant`, the menu's `encounter:set-*` commands,
  `encounter:add-combatant`, `actor:add-from-definition`, `save:answer`, `death-save:roll`, `actor:stabilize`,
  `reaction:answer`. No server, shared domain, schema, projection or route changes. If a step seems to need one, stop and
  tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area. `design-conventions.test.ts` asks for
  media widths on the ladder and `.scroll-y` scrollers.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the table as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 Starting an encounter

- `encounter/GmEncounterPanel.tsx` puts the setup on the Encounter tab between fights (628 to 633); the label "The
  table" (684); the default ticks (89 to 97, 171 to 184); who plays (111 to 112); the initiative defaults (115 to 123);
  the staging details (395 to 421); the blocked notes (447 to 453); the foot (593 to 600).
- `encounter/StartFight.tsx` (105 to 124): "Start an encounter" and its lede; spell areas; In this encounter (208 to
  248: rows from `placeOf` 22 to 27, the checkbox "{name} is in this encounter", `is-out`); Who plays (252 to 282: "Where
  {name} is played", At the table or On their device, "Claimed on a player's device", the rule line); Initiative (284 to
  303: two switches, `diceLine` 85 to 88); Surprised (305 to 326); `rollsLine` (46 to 56); the phone card (128 to 192).
- `scenes/ScenePrepPanel.tsx`: the map line and Change (153 to 169), the grid note (171 to 180), `StagingTray` (197 to
  207), the budget (208), Add characters (210 to 242), Add monsters (219, 269 to 276), Recent (245 to 265), the tray
  toggle and toasts (122 to 134). `scenes/StagingTray.tsx` (54 to 125: its own "In this encounter" heading, "N staged · M
  on the map", New tokens, rows with RevealSwitch and remove). `encounter/EncounterBudget.tsx` (6 to 55).
- CSS: `encounter/start-fight.css` 1 to 229, `scenes/scene-prep.css` 1 to 203 (budget 177 to 190),
  `scenes/staging-tray.css` 1 to 155, `encounter/encounter-panel.css` 223 to 245, `table/table-panel.css` 159 to 167.

### 3.2 A creature's tools

- Rows live in the panel's details "Turn order and tools" on a laptop (`GmEncounterPanel.tsx` 621 to 626) and an Order
  tab on a phone (657); C2 moves the order to the left dock and C5 drops the Order tab. One row open at a time (136 to
  137, 510 to 513).
- `encounter/GmInitiativeRow.tsx` (140 to 231): the row's button `.initiative-expand` with "Manage {name} · HP,
  conditions, effects, reaction, sheet"; flags "−N pending" and "Dying s/f" (174 to 181); the initiative edit (38 to 90,
  `initiative:set`).
- `encounter/RowTools.tsx`: a popover "Tools for {name}" (47 to 49) with `HpAdjust` (50 to 59; `HpAdjust.tsx` with
  Amount, Damage, KO, Heal, Temp, Set, Max, Revive, Damage type), conditions (60 to 72; `conditions.tsx`), attitude (73
  to 94), `EffectChips` (95), cover (`CoverControl.tsx` 43 to 66), In its lair (`LairControl.tsx`), `PickControl`, tie
  and Alert swaps (103 to 169), the buttons (170 to 231), and `ConfirmRow` for Take out of the encounter (232 to 249).
- `table/TokenTab.tsx` (20 to 33) with `TokenControls` (`scene/TokenContextMenu.tsx` 258 to 360): Damage and Heal,
  Size, Health, Conditions, Open sheet, Set token image…, Show or Hide, reaction, Return to tray.
- CSS: `encounter/encounter-panel.css` 408 to 495 (row, tools, popover), 855 to 911, 1131 to 1145, 1231 to 1242;
  `hp-adjust.css`, `conditions.css`, `effect-chips.css`, `confirm-row.css`.

### 3.3 The encounter's options

- `encounter/FightMenu.tsx`: mounted in the turn footer and portaled to the strip's end (`GmEncounterPanel.tsx` 579 to
  590, `table/stripSlot.tsx` 10 to 13); the trigger "Encounter ▾" with "Encounter options" (162 to 179); a menu (52 to
  68) with Rules assistant (205 to 227), Players' hits (228 to 250), Players' initiative (251 to 273), Health display
  (274 to 295), Health is (296 to 318), Underwater (319 to 335), Add to the encounter (336 to 407), Experience Points
  (408 to 430), End the encounter (431 to 441); the confirms in `GmEncounterPanel.tsx` 292 to 328.
- CSS `encounter/fight-menu.css` 1 to 219.

### 3.4 Adding monsters

- `encounter/MonsterBrowser.tsx`: the Modal "Add monsters" / "Add monsters from the bestiary" (142 to 149), the search
  (151 to 158), the filters (32 to 39, 160 to 191), Roll hit points (193), the tray line (194 to 196), the rows (206 to
  237), the stat block preview (12 to 29, `StatBlock.tsx` 122 to 200), the feedback and `actor:add-from-definition`.
- CSS `encounter/monster-browser.css` 1 to 142, `encounter/stat-block.css` 1 to 97.

### 3.5 The prompts' controls

- `RollControls.tsx` (241 to 386: Roll, the typed die field, Adv and Disadv as "GM's choice", Confirm, Reroll, extras);
  `SavePrompt.tsx` (252 to 357); `ReactionPrompt.tsx` (292 to 693; the opportunity attack 374 to 466);
  `DyingTracker.tsx` (116 to 193); `StabilizeControl.tsx` (88 to 126); `TurnOrder.tsx` (48 to 85);
  `DamageRollPrompt.tsx` (69 to 79).
- CSS `encounter/prompts.css` 1 to 345 and 395 to 422, `dying-tracker.css`, `stabilize-control.css`.

### 3.6 Tests that pin it

- Start: `encounter/start-fight.test.tsx` (68, 103 to 111, 122 to 123, 153 to 156, 166 to 172),
  `table/panel-tabs.test.tsx` 168 to 183, `scenes/fight-settings.test.tsx` 49 to 61,
  `encounter/encounter-budget.test.tsx` 24 to 45.
- Rows: `encounter/damage-type.test.tsx` (75 to 195, 243 to 307: "Manage name", dialog "Tools for name", Damage, Heal,
  KO, "Damage type"), `remove-combatant.test.tsx` 55 to 74, `condition-chips.test.tsx` 44 to 180,
  `cover-control.test.tsx` 14 to 31.
- Menu: `fight-menu-placement.test.tsx` 28 to 99 (geometry), `settings/table-settings.test.tsx` 115 to 122 (menu
  "Encounter options"), `sheet/experience.test.tsx` 99 to 103.
- Monsters: `stat-block-xp.test.tsx` 28 to 35, `stat-block-print.test.tsx`; no unit test renders `MonsterBrowser`.
- Prompts: `save-damage.test.tsx` 118 to 238, `save-gm-applies.test.tsx` 33 to 38, `held-dice.test.tsx` 85 to 173,
  `roll-answers.test.tsx` 74 to 212, `reaction-prompt.test.tsx` 43 to 166, `reaction-slot.test.tsx` 43 to 75,
  `opportunity-extras.test.tsx` 57 to 70, `stabilize-control.test.tsx` 34 to 55, `turn-order.test.tsx` 19 to 45,
  `damage-roll-prompt.test.tsx` 28 to 44, `table/needs-you.test.tsx` 88 to 248.
- e2e: `e2e/smoke.ts` 277 to 302 (`stageFight`: region and dialog "In this encounter", "{name} is in this encounter",
  "Add characters or monsters", "Add monsters", dialog "Add monsters from the bestiary", searchbox "Search monsters",
  Add, "{monster} is in the staging tray."), `journeys.spec.ts` 270 to 282 and 435 to 441.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The start form | Changed: one In this encounter, Cradles, Prep's not ready lines | `StartFight`, `ScenePrepPanel`, `StagingTray`, `EncounterBudget` |
| The open row | Changed: in place in the dock | `GmInitiativeRow`, `RowTools`, C2's dock |
| The Token tab | Changed: the token's own controls | `TokenTab`, `TokenControls` |
| The encounter's menu | Moved to the panel's tabs | `FightMenu`, A's menu |
| The monsters' dialog | Changed: G's panes | `MonsterBrowser`, G's `FilterPanel` and results, `StatBlock` |
| The roll row | New, in `RollControls` | `RollControls`, `SavePrompt`, `DyingTracker`, `ReactionPrompt` |

How the parts fit, so the phases agree:

- One In this encounter: the start form's list is `StartFight`'s rows, with each row's tick and a More (Show to players
  or Hide from players, Remove from this list) taken from `StagingTray`'s row; the tray's New tokens choice moves to the
  list's head. `StagingTray` stays for the encounter's page in Prep (E) and leaves the start form. Keep the region name
  "In this encounter" on the one list, so `smoke.ts` `stageFight` finds it; the "Add characters or monsters" details go,
  and `stageFight` presses Add monsters at the list's head.
- The open row: C2's `GmInitiativeRow` in the dock gains an open state that renders `RowTools`' contents in place under
  it (no popover, no backdrop), and the dock's width follows (232 px, 330 px while a row is open). The row's button
  keeps its name ("Manage {name} · …") and aria-expanded; the region keeps "Tools for {name}" as a `region` in place of
  the dialog. Choosing a token on the map opens its row too.
- The menu: `FightMenu` renders from a More `IconButton` ("Encounter options") at the end of the panel's tab row instead
  of the strip's end; its contents keep their order and commands; its selects read as I's rows.
- The monsters' dialog: `MonsterBrowser` keeps its Modal, title, search and command, and lays its body out as G's three
  panes: G's `FilterPanel` (from G3) configured for monsters with its counts, G's compact results rows, and `StatBlock`
  for the chosen row with "Add to {encounter}" as the dialog's primary. Today's per-row Add stays reachable from the
  keyboard on each result.
- The roll row: `RollControls` renders the roll as one button row (label, line, number) instead of a Roll or Confirm
  button beside a summary; its accessible name says what it does ("Roll Dexterity save +2 against DC 14", "Confirm 19").
  The typed die field, Adv and Disadv, Reroll and extras follow it as Base line controls.

## 5. Phases

### R0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `C3-running/`, and leave the
   other pieces' folders as the zip has them.
2. Add `C3-running/ADR-0059-running-the-encounter.md` as `docs/adr/0059-running-the-encounter.md`, Accepted, and its row
   to `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### R1: the start form

1. `StartFight` as `SPEC.md` 2.1: the Cradles, the map line, the one list with its rows' More and the New tokens choice,
   Who plays, Initiative, Surprised, the difficulty as an open group, the not ready lines in Prep's words where the
   blocked notes are.
2. The phone: the same form in the Switch's Encounter view (today's summary card goes), Start the encounter pinned.
3. Tests: `start-fight.test.tsx` (its names hold), `panel-tabs.test.tsx` 168 to 183, a test that one region is named In
   this encounter, `smoke.ts` `stageFight` (Add monsters at the list's head).

### R2: tools under the row

1. The open row in the dock (section 4), its tools in Cradles (`SPEC.md` 2.2), Take out of the encounter through A's
   dialog with today's words.
2. The Token tab keeps the token's own controls (`SPEC.md` 2.2); its damage, healing and conditions go.
3. A phone: the tools as a sheet over the Map view.
4. Tests: `damage-type.test.tsx` (the region "Tools for name" in place of the dialog), `remove-combatant.test.tsx`,
   `condition-chips.test.tsx`, `cover-control.test.tsx`, a test that the dock widens while a row is open and that
   choosing a token opens its row.

### R3: the menu on the tabs

1. `FightMenu` from a More `IconButton` "Encounter options" at the end of the panel's tabs (section 4); its rows in I's
   words; the strip slot it used goes if nothing else uses it.
2. A phone: the More icon in the header opens it as a sheet.
3. Tests: `settings/table-settings.test.tsx` 115 to 122 (the menu "Encounter options" from the new trigger),
   `fight-menu-placement.test.tsx` (its geometry under the tabs), `experience.test.tsx` 99 to 103.

### R4: monsters in the Compendium's panes

1. `MonsterBrowser` as section 4 with G's parts; the stat block for the chosen row; "Add to {encounter}" as the
   dialog's primary; Roll hit points and the tray line in its foot.
2. A phone: a full screen sheet with the search, Filters and Sort, the rows, the chosen stat block and Add {name}
   pinned.
3. Tests: a new `monster-browser.test.tsx` (filters change the rows and counts; choosing a row shows its stat block;
   Add sends `actor:add-from-definition` with today's payload; the tray line), `smoke.ts` `stageFight` (dialog and
   searchbox names hold).

### R5: the roll row

1. `RollControls`' roll row (section 4) in `SavePrompt`, `DyingTracker` and `ReactionPrompt`; the damage field above a
   save's row; Adv, Disadv, Reroll, Choose to fail and the extras as Base line controls after it.
2. Tests: `held-dice.test.tsx`, `roll-answers.test.tsx`, `save-damage.test.tsx`, `reaction-prompt.test.tsx`,
   `opportunity-extras.test.tsx`, `stabilize-control.test.tsx` (the buttons' names change to the row's: update them to
   the new accessible names and keep every flow).

### R6: docs and cleanup

1. `docs/DESIGN.md`: the GM's table (starting a fight, a creature's tools, the menu, adding monsters, the roll row).
2. `docs/ARCHITECTURE.md`: the encounter panel's sections that name the strip's menu, the row popover and the monsters'
   dialog.
3. `docs/adr/README.md`: 0059 Accepted and built. `docs/design/polish/CATALOG.md`: C3's second round moves to Built.
4. Remove what nothing uses: the row popover's backdrop and placement CSS, the strip slot for the menu, the staging box's
   start-form copy, the phone's start card.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With the old road staged (three characters, a Goblin Boss and two Goblin Warriors, two in the tray), look in Dusk and
  Dawn at:
  - 1280 by 800 with a mouse: the start form (ticks, More, New tokens, Who plays, the switches, Surprised, the difficulty,
    the not ready line and Go to it), Start the encounter; in the fight, opening a creature's row (and from its token),
    damage with a type, a condition, cover, Take out of the encounter and its dialog; the menu from the tabs and each
    of its rows; Add monsters with filters, the stat block and Add; a monster's save, a death save with First aid, and
    an opportunity attack, each by its roll row.
  - 390 by 844 with touch: the form and Start; a creature's tools as a sheet over the map; the menu as a sheet; Add
    monsters full screen; the roll rows; every control at least 44 px; no sideways scroll.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable, including the initiative edit, Act before, Swap initiative (Alert), In its
  lair, effect chips' End, Award the encounter's XP, Recent, Add characters, the typed die and the GM's Adv and Disadv.

## 7. Left as they are, for later rounds

- The Party and Notes tabs' own designs (with D and F), the map's menus (C2), and the player's prompts (C4).
- Every command, projection, HTTP route and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's open row draws its tools without the creature's head; the app keeps today's name and initiative on the row
  above them.
- The mockup's monsters dialog draws six results and four filters; the app uses G's panel for monsters with every facet.
- The mockup draws the roll row for three prompts; the app uses it for every `RollControls` roll in a waiting card.
- The mockup does not draw the map line's Change, the row's More, Act before, Swap initiative, In its lair, Experience
  Points, the typed die field or the phone's start form in full; sections 4 and 5 place them.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `running.html`.

- `p4m-c3b.css`: the Cradle (`.q-cr`), open groups (`.q-og`), rows (`.q-row`), Base line controls (`.q-bl`), fields
  (`.q-fld`), ready lines (`.q-ready`), the open row in the dock (`.q-dockopen`, `.q-chosenrow`, `.ttok.q-chosen`), the
  menu (`.q-menu`, `.q-mi`), the monsters' dialog and panes (`.q-dlg`, `.q-panes`, `.q-fpane`, `.q-mrow`), the stat block
  (`.q-sb`), and the roll row (`.q-rollrow`). The other options' parts sit beside them. `p4c-table.css` is C's frame and
  `p4l-c3.css` C3's first round.
- `p6-body2.js`: `startBody()` (the `form` branch), `toolsInner()` and `toolsDock()` (the `row` branch), `encMenu()` and
  `rulesRows()` (the `menu` branch), `filters()`, `monRows()` and `statBlock()` (the `panes` branch), `promptCards()`
  (the `rollrow` branch), and the pages.
- `p6-dec2.js`: the decisions, the Carried in list and the rules. `p6-head.js`, `p6-body.js` and `p6-dec.js` are C's
  frame and C3's first round, ported.
- `audit-c3.js`: the "Today" screenshots and the map.
