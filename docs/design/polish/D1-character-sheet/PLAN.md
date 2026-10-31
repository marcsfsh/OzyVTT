# D1 Character sheet: the Ledger

Written on 2026-10-28 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update U6: ADR-0046 and the handoff"). Light rail (phases 0 to 8) and the Horizon update (U1 to U6) are built on that branch. This plan rearranges the character sheet; it adds no rules, commands or data. File paths and line numbers were read at `f5e166f`; confirm them before editing.

This is the first piece of the polish pass in `../CATALOG.md` (catalog id D1). The catalog's theme level, Light Rail / Horizon, already governs it.

## 0. How to use this plan

- Read sections 1 to 4 before touching code. Section 5 is the work in eight phases, L0 to L7, each about one commit.
- The reference is `ledger-sheet.html` in this folder: the approved layout at laptop, phone and Table panel sizes, in Dusk and Dawn, drawn to the values in section 4. Open it in a browser (fonts load from Google Fonts; everything else is inline). Its controls work: tap a number to roll, and Damage and Heal change the hit points.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code. Build with the existing components, hooks and `@vtt/ui` primitives, and port the values. Section 8 lists where the plan departs from the mockup on purpose.
- `history/` holds the four rounds that led here: Classic, Cockpit and Scroll; Console, Hotbar, Lanes and Focus; Beyond, Foundry and Paper; then Strip, Grouped and Ledger. Context only; the choice is made.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md` applies on top, and `apps/client/src/writing.test.ts` checks it.

## 1. What the user decided

The user disliked the sheet everywhere it appears. Over four rounds they asked for three things: a layout a player who has used another VTT recognises, navigation that is easy, and a look that is neither noisy nor mismatched. They chose the Ledger, a refinement of the D&D Beyond arrangement that stops copying it.

1. A vitals band runs across the top of the sheet on every screen. It holds the portrait, name, class line and condition chips, then one plate with AC, hit points (number, life bar, Damage, Heal and Temp), initiative, speed, proficiency and Heroic Inspiration, then Rest with the hit dice under it. The phone pins a compact version of the same band, with the same cells in the same order.
2. On a laptop, three columns sit under the band. The first lists the six abilities as rows, each with its score, its check modifier and its saving throw, like the left edge of a paper sheet, with Senses under them. The second lists the skills. The third is one tabbed box: Actions, Spells, Gear, Features and Notes.
3. On a phone, the band and the tabs stay pinned and the body scrolls under them. The tabs are Main, Actions, Spells, Gear, Features and Notes. Main holds what the laptop's first two columns hold.
4. There is one row of tabs and nothing nested inside it. The Play and Checks tabs and the Actions subtabs go away; their contents move to the places in section 4.3.
5. A number you roll is its own button: the ability row, the save cell, the skill row and the initiative cell. No box is drawn around the number. The action and spell rows stay whole-row buttons, as they are now.
6. On a laptop with a mouse, skill rows are compact (30 px) so all eighteen fit beside the abilities at 1280 by 800. Phones, touch screens and the Table panel keep 44 px rows. This amends the compact-row rule in `docs/DESIGN.md` (phase L1).
7. Colour keeps its meaning: gold is hit points, `--party` blue is spell slots, cyan marks proficiency. The horizon appears on the app bar and under the chosen tab, and the Cup stays the one primary in a view.
8. The sheet follows the theme spec (`../T-theme/SPEC.md`), approved after this plan was first written. A group you act in (the stats plate, Abilities, Skills, Tools, the conditions card) is a Cradle box: a base and sides that fade before the top, with no fill, whose base lights cyan while you work inside. A group you only read (Senses) is open: its heading and a rule. The tabbed box is a region, so it has no frame. Secondary buttons and chips sit on a Base line. The `Group` primitive and the Base line come from the theme plan's phases T1 and T2; if they have landed, use them, and if not, build the sheet's cards so they switch to `Group` without moving anything (see section 2).

## 2. Rules that bind this work

- The branch is shared. Another session commits design work on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- CLAUDE.md applies in full. The server decides: every roll, HP change, rest, slot and use keeps going through the hooks and commands listed in section 3.4, unchanged. Projections are untouched: the sheet shows what it shows today, rearranged. Players act only on their own character. Phones are first-class: check every phase at 390 px with touch.
- No server code, shared domain, schema, command or HTTP route changes. `npm run map` should not be needed; if it reports a change, something outside this plan moved.
- `apps/client/src/design-conventions.test.ts`: colours only from `packages/ui/src/styles/design-tokens.css` (check (d)); `@media` widths only from the ladder, min 561/651/761/850/980/1280 and max 560/650/760/849/979 (check (f)); scroll regions only through `.scroll-y` (check (h)); the display face always with uppercase (check (i)); no bare `eyebrow` class (check (c)). Pointer and hover media features are not widths and are allowed.
- The pane rule (`apps/client/src/styles.css`): no transform, filter, backdrop-filter, perspective, will-change or `contain: paint` on `.app-pane` or its one child.
- `docs/DESIGN.md`: the page never scrolls; each region fits or scrolls itself. Every interactive control keeps a 44 px hit area, except the compact skill rows that phase L1 allows. Fields stay at least 16 px on a touch screen (`expectPageFits` in `e2e/smoke.ts` checks it).
- Rules words follow SRD 5.2.1: "Level 1", "Bonus Action", "Reaction", "saving throw", "Short Rest", "Long Rest", "Hit Point Dice". The mockup's labels already do.
- Motion stays as built (ADR-0045): the HP count-up, the life bar light, the inspiration comet, pip light, the LevelBox pop and the tab ink. Everything new that moves goes through the existing helpers and `canMove()`.
- The theme plan (`../T-theme/PLAN.md`) changes the kit's secondary controls and adds the `Group` primitive. If its phases T1 and T2 are on the branch, draw the sheet's boxes with `Group` and its secondary buttons stay the kit's. If they are not, draw the boxes with a `.cs-card` class that T's phase T7 swaps for `Group`, and leave the buttons as the kit draws them.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before calling a phase done, and look at it at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The component

`apps/client/src/sheet/CharacterSheet.tsx` (944 lines) is the one sheet for every place it sits.

- Props (95 to 139): `actor`, `role`, `state`, `presentation` ("page", "dialog" or "panel", default "dialog"), `phone`, `hidePlay`, `combat`, `onJumpToInitiative`, `attackMode`, `top`, `end`, `doors`, `token`, `headerEnd`, `onLevel`, `onClose`.
- The frame (180 to 201): `WIDE_QUERY = "(min-width: 980px)"` (line 84) through `useMediaQuery`. `layout` is "panel" for the panel presentation, "wide" at 980 px or more unless the sheet floats, otherwise "narrow". `phoneViews` (a player on narrow, or in the panel on a phone) turns on the Vitals, the turn card look, the phone spell list and the Level box.
- Wide (597 to 684): `header.cs-band` with the portrait, name and identity line, `.cs-band-stats` (StatTiles for AC, Init, Speed, Proficiency, Passive Perception and Heroic Inspiration), `.cs-band-life` (LifeBar and Change HP), the GM tag, `RestMenu` outside a fight, the menu and Close. Then `StatusStrip`, the toast row (dialog), `LatestRoll`, `top`, and `.cs-cols`: Checks on the left, the tabs in the middle, `HpCard`, `HitPointDice`, `GmTools` and the detail host on the right, and an optional docked dice column.
- Narrow (727 to 777): `header.cs-head` with the portrait, name, an AC StatTile and an HP button (hidden while Vitals show), `LevelBox`, menu and Close, then a life bar; the tab strip under it; then `StatusStrip`, toast row, `LatestRoll`, `top` and the body.
- Panel (685 to 726): a `.cs-compact` row (HP, AC, Init and Dying chips, Level box, menu), the strip, `LatestRoll`, `top`, the body. No name or portrait.
- The body (552 to 587): `div.cs-body.scroll-y`, `role=tabpanel`.
- Overlays (780 to 845): the typed-die prompt, heal and shape-shift pickers, the "Hit Points" modal (`align=bottom`, with `.cs-vitals-strip` on narrow, then `HpCard withSet`), the "Dice log" modal, `IdentityEditor`, `RollSettings`, `TokenLibrary`.
- Wrappers: dialog is `Modal size="full"` (violet for the GM); popped out is `FloatingSheet` (900 to 944); page and panel are bare.
- Details (`SheetDetail`): a portal into `.cs-detail-host` on wide; a drawer for the GM on narrow; otherwise in place. Gear uses a drawer unless wide (line 419).

### 3.2 Tabs today

`sheet/SheetTabs.tsx`: `SheetTabId` is play, actions, checks, spells, gear, features, notes and gm (line 15); labels in `TAB_META` (17 to 26). `sheetTabs()` (35 to 47) drops Spells without spells, Checks when wide, Play and Actions with `hidePlay`, and swaps Notes for GM on the GM's narrow sheet. `SheetTabStrip` (111 to 134) wraps the `Tabs` primitive. `SheetTabBar` (56 to 108) and every `.cs-tabbar*` rule are unused. The remembered tab key is `vtt.sheet.tab.${layout}` (`useRememberedTab` in `table/TablePanel.tsx` 102 to 125, used at CharacterSheet 209 to 215); a fight opens on Actions.

- Play (`sheet/PlayTab.tsx`, `PlayCalm` 581 to 673): `DeathSavesCard`, `SavesOwed`, then `Vitals` (phone) or Rest with `RestButtons` and `HitPointDice` (not wide), `FoodAndWater`, `PinnedChecks` (per device, `vtt.sheet.pinned-checks.<id>`), `SlotsLeft`, the Uses list and `FreeCasts`. In a fight the Actions tab shows `PlayFight` (`sheet/PlayFight.tsx`).
- Actions (`sheet/ActionsTab.tsx`): a nested `Tabs` strip (All, Attack, Action, Bonus Action, Reaction, Other, Saving throws), `SheetActionList` outside a fight and `PlayFight` in one. Rows come from `ActionList.tsx`: each row is one button with the name, a line from `turn-options.ts` and a verb on the right (Attack, Cast, Off turn, On your turn, Unavailable).
- Checks (`sheet/ChecksTab.tsx` 368 to 511): `AbilityGrid` (199 to 231), the Saving throws list (151 to 196), the Exhaustion note, `RollModeNotes`, `CheckSituations` (93 to 122), Skills with Edit proficiencies (`ProficiencyEditor` 272 to 360), the skill rows (`SkillButton` 60 to 89, `useSkillRows` 30 to 57), Tools chips, `ToolUses`, Hunter's Mark buttons, `HelpAnAlly`, `SensesAndDefences` (238 to 267). `abilityRows()` (128 to 145) already works out each ability's score, check and save for both lists.
- Spells (`sheet/SpellsTab.tsx`), Gear (`sheet/GearTab.tsx`), Features (`sheet/FeaturesTab.tsx`), Notes (`sheet/NotesTab.tsx`) and GM (`sheet/GmTools.tsx` plus Notes, narrow only).

### 3.3 Where the sheet is mounted

| Where | File:line | How |
| --- | --- | --- |
| `/me`, My character | `actors/MyCharacter.tsx:291` | page, player, `top=<RestPrompt>`, doors, `onLevel` |
| `/characters/:id`, GM | `shell/LayerView.tsx:117` | page, GM |
| `/characters/:id`, player | `shell/LayerView.tsx:142` | page, player, `top=<RestPrompt>` |
| `sheet.html` | `sheet-main.tsx:60` | page, player, `headerEnd=<ThemeSwitch>` |
| Table panel | `encounter/PlayerEncounterPanel.tsx:367` | panel; `phone` below 980 px; `hidePlay` in a fight (the panel's Turn tab runs actions) |
| GM initiative row | `encounter/GmEncounterPanel.tsx:702` | dialog, GM |
| Token context menu | `scene/EncounterMap.tsx:1114` | dialog, GM or player |
| GM Token tab | `table/TokenTab.tsx:34` | dialog, GM |
| Party strip | `actors/PartyStrip.tsx:104` | dialog |
| Party roster | `actors/PartyRosterTab.tsx:373` | dialog, GM |

Related surfaces with their own markup: `PartyMemberSheet` (`actors/MyCharacter.tsx` 47 to 111), `PlayerIdentity` (`table/PlayerIdentity.tsx`, the phone header on Table and Log), `encounter/PlayerTurnCard.tsx` and `rest/RestPrompt.tsx`.

### 3.4 Behaviour this plan must keep

- Rolls: `useSheetRolls.ts`. A check sends `check:roll` (after the typed-face prompt in manual mode), a save sends `save:roll`, rerolls send `check:reroll` or `save:roll {reroll: true}`, tool uses send `check:roll {use}`, loose dice send `dice:roll`. Results reach `LatestRoll` through `useSessionRoll` and `sheet-roll-ids.ts`; refusals arrive as toasts.
- Actions and casts: `useSheetController.tsx` (`sendThroughServer`, `castSpellAction`, `routeAttack`, targeting in `encounter/targeting.ts`, `action:ask-target`), owed saves through `save:answer`, death saves through `death-save:roll`.
- Hit points: `HpAdjust` sends `actor:apply-damage`, `actor:heal`, `actor:set-temp-hp`; the GM also has `actor:set-hp`, `actor:revive`, `actor:set-armor-class`.
- Rest: `useRest` sends `actor:rest` and `rest:ask`; `HitPointDice` sends `actor:spend-hit-dice`; `RestPrompt` sends `rest:mark-done` and `rest:resume`. Rest controls are hidden in a fight.
- Slots and uses: `character:set-slot`, `actor:spend-uses`, `actor:restore-uses`, `actor:convert`, and the spell edits (`character:set-prepared`, `character:finish-preparing`, `character:swap-spell`, `character:add-to-spellbook`, `actor:rechoose`).
- Conditions: `StatusStrip` through `useConditionCommands` (`actor:set-condition`, `rules:ask`); effects end with `effect:end`.
- Heroic Inspiration: `actor:set-heroic-inspiration` (GM) and `actor:give-heroic-inspiration`.
- Every edit goes through `useSheetEdit` and its one busy flag.

### 3.5 CSS and tests today

- `apps/client/src/sheet/sheet.css`: 2328 lines. Its only media query is `max-width: 560px` at line 1596, and it touches only dead rules. The section map: frame 5 to 108, atoms 147 to 409, phone header 411 to 553, wide band 555 to 575, panel 577 to 598, status 600 to 660, latest roll 662 to 709, tabs 711 to 773, wide columns 775 to 803, checks 805 to 1057, HP and Hit Point Dice 1059 to 1143, Play 1145 to 1271, Vitals 1273 to 1338, action list 1340 to 1424, spells 1675 to 1851, gear 1852 to 1965, features 1966 to 2018, turn card 2019 to 2165. The sheet also leans on `encounter/hp-adjust.css`, `encounter/encounter-panel.css`, `shell/table-view.css:120` and `actors/my-character.css`.
- Unit tests render narrow by default: `apps/client/test/setup.ts:51` stubs `matchMedia` to never match; `sheet-frame.test.tsx` switches to wide with `onLaptop()`.
- Tests that pin today's structure: `sheet/sheet-frame.test.tsx` (tab lists, the remembered key, the Vitals and Live states regions, the HP button label, Level box, menu items, the GM dialog's GM tools region), `sheet/sheet-checks.test.tsx` (opens the Checks tab), `sheet/actions-tab.test.tsx` (subtab order), `sheet/monster-rest.test.tsx` (the GM's Play Rest group), `table/phone-sheet.test.tsx` and `table/commanded-creature.test.tsx` (panel tabs), `actors/party-strip-level.test.tsx`, `drag-surfaces.test.tsx` (`.cs-float-grip`, `.cs-float-resize`). Tests that render one tab's component directly (spells, features, gear pieces, turn card and the rest) should not notice the move.
- Smoke (`e2e/journeys.spec.ts`): the sheet region and menu (202 to 229), the phone turn card (412 to 475), "presses the tab Checks if visible" then "Prying with the Crowbar (Advantage)" and `/^Roll Athletics,/` (768 to 803), a tool use and the Gear tab's Crafting region (805 to 875), Gear containers (876 to 921).

## 4. The design

### 4.1 Frames by width

| Frame | When | Shape |
| --- | --- | --- |
| Ledger, three columns | `layout === "wide"` and `min-width: 1280px` | Band in one row; columns 250 px, 250 px and the box |
| Ledger, two columns | `layout === "wide"` below 1280 px | Band in two rows (identity, Rest and menu on the first; the stats plate full width on the second); a 280 px first column that stacks Abilities, Skills, Senses and Tools and scrolls itself; the box beside it |
| Pinned | `layout === "narrow"` (phone, floating sheet, small dialog) | Compact band and the tab strip fixed at the top; the body scrolls under them |
| Panel | `layout === "panel"` | The same as Pinned, inside the Table panel's own Me or Sheet tab |

The JS choice of wide, narrow and panel stays as it is. The 1280 px step is CSS only, inside `.cs--wide`.

### 4.2 The band

- Wide: `header.cs-band` becomes a grid of three: identity `minmax(0, 1fr)`, the stats plate `auto`, the end `auto`, with a 14 px gap, `10px 20px` padding, a 1 px `--line-strong` bottom edge and the glass surface.
- Identity: the portrait at 52 px; the name in `.cs-name` (Chakra Petch 600 capitals, 22 px); the identity line at 13 px in `--text-dim`; the `StatusStrip` chips under it (conditions, Concentration, effects, Exhaustion and Add; `inspiration={false}`, since the plate has its own cell).
- The stats plate: a Cradle box (the theme's `Group`, no heading), cells divided by 1 px `--line`. At 1280 px or more the cells are AC 62 px, Hit points 396 px, Initiative 84 px, Speed 80 px, Proficiency 84 px and Inspiration 92 px. Each cell has its label in the sheet's existing eyebrow style and its value in VT323 at 32 px.
  - AC keeps "Set by GM" and the GM's `ArmorClassEditor` route.
  - Hit points: the label and Temp on the first line; the current value (VT323 34 px, `--hp-text`) and the maximum (20 px, `--text-muted`) with the controls on the right; the `LifeBar` (8 px) under them. The controls are `HpControls` with Damage, Heal and Temp, untyped: an amount field 52 px wide and three secondary buttons with a 36 px face inside a 44 px hit area (`.tap-target`). The current value is a button that opens today's "Hit Points" modal, which keeps the damage type, the GM's Set Hit Points and Revive. Its accessible name keeps today's wording.
  - Initiative stays as it behaves today. If the header makes it a control (`onJumpToInitiative`), the whole cell is that button; otherwise it is text.
  - Speed keeps the lowered-speed caution ("of N ft").
  - Inspiration is a square: lit cyan with a tick when held. For the GM it toggles through the existing command; for a player it shows the state. The inspiration comet runs as it does now.
- The end: `RestMenu` (outside a fight) with "Hit Point Dice 5/7 d6" under it. The hit dice line is a button that opens `HitPointDice` in a small modal, so dice can be spent where the rules allow (`canSpend`). Then the GM tag, the menu, Close and `headerEnd`.
- Passive Perception leaves the band for the Senses card.
- Narrow and panel: a compact band in the same order. Row one: portrait 40 px, the name (Chakra Petch 600 capitals, 18 px, one line with an ellipsis), the identity line at 12 px, `LevelBox`, the Rest button (outside a fight) and the menu. Row two: a plate with AC 50 px, Hit points (the rest of the width; a button showing the number, Temp and a 6 px life bar, which opens the "Hit Points" modal), Initiative 58 px and Speed 54 px. In the panel the band replaces `.cs-compact`, so the panel gains the name.

### 4.3 Where each of today's parts goes

| Today | Ledger |
| --- | --- |
| Band StatTiles: AC, Init, Speed, Proficiency | The stats plate |
| Passive Perception tile | Senses card |
| Heroic Inspiration tile | Inspiration cell |
| LifeBar and Change HP | Hit points cell |
| RestMenu | Band end |
| StatusStrip | Under the identity line (wide); the first card of Main (narrow) |
| Right column: HpCard | The "Hit Points" modal only |
| Right column: HitPointDice | The hit dice button's modal, and Rest |
| Right column: GmTools | A GM tab at the end of the box, on every frame |
| Right column: detail host | Details open in place inside the box, with Back; Gear keeps its drawer |
| Docked dice column | At 1280 px or more, a fourth column after the box (the box keeps at least 480 px); below that, the menu item opens the Dice log modal |
| Play: DeathSavesCard | The top of the Abilities card while dying (wide); the top of Main (narrow) |
| Play: SavesOwed | A prompt line at the top of the Abilities card; an owed save also takes its ability's Save cell |
| Play: Vitals | Replaced by the compact band and Main |
| Play: RestButtons and HitPointDice | The band's Rest control and hit dice modal |
| Play: FoodAndWater | Gear, after Coins |
| Play: PinnedChecks | A Pinned group at the top of the Skills card, with Edit; pins stay per device |
| Play: SlotsLeft | The top of the Actions tab |
| Play: Uses and FreeCasts | A Limited use group at the end of the Actions tab |
| Actions subtabs | Gone. One list grouped by `COST_GROUPS`, as a table (4.5) |
| Actions: Saving throws subtab | The Save cells in the Abilities card |
| Checks: AbilityGrid and Saving throws | The Abilities card |
| Checks: Exhaustion note, RollModeNotes | Under the Abilities card's heading |
| Checks: CheckSituations | Toggle chips at the top of the Skills card |
| Checks: Edit proficiencies | A link in the Skills card's heading |
| Checks: skill rows | The Skills card |
| Checks: Tools, ToolUses, Hunter's Mark, HelpAnAlly | A Tools card under Senses (wide); after Skills in Main (narrow) |
| Checks: SensesAndDefences | Senses in the Senses card; defences and proficiencies at the top of Features |
| LatestRoll | The top of the first column (wide); under the tab strip (narrow) |
| `top` (RestPrompt) | Between the band and the columns |
| `end` | The end of the box body |

### 4.4 The columns (wide)

- The body: `12px 20px 14px` padding, a 12 px gap, `grid-template-columns: 250px 250px minmax(0, 1fr)` at 1280 px or more. Each column is a fixed frame whose cards scroll inside it with `.scroll-y` when they do not fit.
- Abilities card: a heading row ("Ability", "Check", "Save" in the eyebrow style), then six rows built from `abilityRows()`. A row is 52 px: the name at 15 px semibold with the score under it (VT323 17 px, `--text-muted`) and the check modifier (VT323 34 px) in a 60 px column, all one button that rolls the check; then a 76 px Save cell, a second button with the proficiency square and the save (VT323 20 px). The buttons keep today's accessible names ("Roll a Strength check, ...", "Roll a Dexterity saving throw, ..."). An owed save, an automatic failure and roll-mode tags show in the row as they do today.
- Senses card: rows of a VT323 22 px number in a 28 px column and a 14 px label (Passive Perception, Investigation and Insight), then the senses as text (Darkvision 60 ft). The rows are 28 px; nothing in them is interactive.
- Skills card: the heading with Edit, the situation chips, the Pinned group, then the eighteen skills. A skill row is one button: the proficiency square, the ability abbreviation (10 px semibold, `--text-muted`, a 28 px column), the name (14 px, semibold when proficient) and the bonus (VT323 21 px, right). Rows are `--row-h` (44 px); under `(hover: hover) and (pointer: fine)` they are `--row-h-dense` (30 px), and `(any-pointer: coarse)` restores 44 px. Dense applies inside `.cs--wide` only.
- The box: a region, with no frame, holding `SheetTabStrip` (the `Tabs` primitive and its horizon ink) and the body (`.cs-body.scroll-y`, `role=tabpanel`), padded `12px 14px 16px`.
- Two columns (980 to 1279 px): `grid-template-columns: 280px minmax(0, 1fr)`; the first column stacks LatestRoll, Abilities, Skills, Senses and Tools and scrolls itself.

### 4.5 The tabs

| Frame | Tabs |
| --- | --- |
| Wide | Actions, Spells, Gear, Features, Notes; GM last for the GM |
| Narrow and panel | Main, Actions, Spells, Gear, Features, Notes; GM last for the GM |
| Panel with `hidePlay` (a fight) | Main, Spells, Gear, Features, Notes (the panel's Turn tab runs actions) |

- Spells still drops out for a character without spells.
- The remembered tab: read a stored "play" or "checks" as "main" on narrow and as "actions" on wide. A fight still opens on Actions.
- Main (narrow): StatusStrip, then a Cradle box of Proficiency, Heroic Inspiration and Hit Point Dice, then the Abilities card, the Skills card, Senses and Tools. Death saves and owed saves come first when they apply.
- Actions: `SlotsLeft` at the top, then one list grouped by cost (Action, Magic action from items, Bonus Action, Reaction, No action), then Limited use. In a fight, `PlayFight` as now.
- The action table. Each row stays the one button `ActionList.tsx` draws, laid out in columns: Name (15 px semibold, with the existing tags, and a 12.5 px line under it in `--text-muted`), Range (76 px), Hit / DC (52 px, VT323), Damage (136 px, VT323 dice and the type at 11 px), then the verb (Attack, Cast, Off turn, On your turn, Unavailable) right-aligned in `--text-dim`. One header row per list, not per group. On narrow the columns are Name, Hit / DC (54 px) and Damage (92 px, dice only): the range and damage type join the line under the name, and the verb shows only when it is not the plain verb (Off turn, On your turn, Unavailable).
- `turn-options.ts` gains three display fields on `TurnOption`, built from the parts that already make `effect`: `range` (`reachWords` or the spell's range text), `hitOrDc` (`signed(attackBonus)`, or "DC 15" with the ability) and `damage` (`damageWords`, or the spell effect at its level, plus healing). `line` and `effect` stay for the turn card.
- Spells: the same content in a table: Name (with C and R tags), Time (Action, Bonus Action, Reaction), Range, Hit / DC, Effect, then today's button (Cast, Prepare or Ritual). Level headings keep their `SlotPips`. On narrow: Name with time and range on its line, Hit / DC, Effect and the button.
- Gear, Features, Notes and GM keep their content. Features gains Proficiencies and defences at the top. Gear gains Food and water after Coins.

### 4.6 Values

| Part | Value |
| --- | --- |
| Band padding, gap | 10px 20px; 14px |
| Portrait (wide, narrow) | 52px; 40px |
| Name (wide, narrow) | Chakra Petch 600 capitals 22px; 18px |
| Stats plate cells, 1280 px+ | 62 / 396 / 84 / 80 / 84 / 92 px |
| Stat value | VT323 32px; HP current 34px in `--hp-text`, maximum 20px in `--text-muted` |
| HP controls | amount 52px wide; buttons 36px face, 44px hit area |
| Life bar (wide, narrow) | 8px; 6px |
| Columns, 1280 px+ | 250px, 250px, `minmax(0, 1fr)`; gap 12px |
| First column, 980 to 1279 px | 280px |
| Ability row | 52px; modifier column 60px; Save cell 76px |
| Skill row | 44px; 30px dense (wide, fine pointer, no coarse pointer) |
| Senses row | 28px |
| Action table columns (wide) | Range 76px, Hit / DC 52px, Damage 136px |
| Action table columns (narrow) | Hit / DC 54px, Damage 92px |
| Table row | at least 48px |
| Compact band plate (narrow) | AC 50px, HP the rest, Init 58px, Speed 54px |

Boxes: Abilities, Skills, Tools, the conditions card and the stats plates are Cradle boxes (`Group`); Senses is an open group with a 1 px `--line-strong` rule above it. `p4-theme.css` in the mockup shows both. The mockup's colours map to the app's tokens: its `--glass-s1` is the sheet's plate surface (`--surface-1` on glass), its `--line`, `--line-strong` and `--line-raised` are the app's, its `--hp-text`, `--party` and `--cyan-hi` are the app's. Use the existing eyebrow style where the mockup draws 10 to 11 px capitals.

## 5. Phases

### L0: install the handoff and the decision

1. Copy this package into `docs/design/polish/` (the `README.md`, `CATALOG.md` and `D1-character-sheet/`). Add `docs/design/polish` to `.prettierignore` and to ESLint's ignores beside `docs/design/light-rail`, so it stays as written.
2. Add `D1-character-sheet/ADR-0047-ledger-character-sheet.md` as `docs/adr/0047-ledger-character-sheet.md`, Accepted, and its row to `docs/adr/README.md`. Mark 030's row "look and layout superseded by 037 and 047" and 044's row "tabs as built changed by 047". While in that file, remove the duplicated rows 027 to 037 that follow 037.
3. Run the full checks and record any failure that was already there.

### L1: the dense row token and its rule

1. `packages/ui/src/styles/design-tokens.css`: add `--row-h-dense: 30px;` beside `--row-h-compact`, with a comment: the character sheet's skill rows on a laptop with a mouse only.
2. `docs/DESIGN.md`, Phones and touch: add the one exception after the 44 px rule, worded as in ADR-0047.
3. Tests: none of the tokens tests should change; run `themes.test.ts` and the conventions test.

### L2: the band

1. New `sheet/SheetBand.tsx` with `SheetBand` (wide) and `SheetBandCompact` (narrow and panel), built from `StatTile`, `LifeBar`, `HpControls`, `RestMenu`, `LevelBox`, `SheetMenu`, `StatusStrip` and `ActorPortrait`. Move the hit dice into a small modal opened from the band.
2. `CharacterSheet.tsx`: render the band in all three frames; remove `.cs-band-stats`, `.cs-band-life`, the narrow `.cs-head` stats and the panel's `.cs-compact`. Keep the "Hit Points" modal and open it from the HP number. Drop the right column's `HpCard` and `HitPointDice` (GmTools moves in L4).
3. `sheet.css`: a new Band section replacing 411 to 598 (phone header, wide band, panel row), with the values in 4.6.
4. Tests: `sheet-frame.test.tsx` (Heroic Inspiration now in the band's Inspiration cell; the HP button label; the Hit Points modal; Level box placement), `sheet-checks.test.tsx` (Speed in the HP modal stays), `table/phone-sheet.test.tsx` ("1/1 HP" in the compact band).

### L3: the Ledger columns

1. New `sheet/AbilityLedger.tsx` from `abilityRows()`, with the owed-save, auto-fail and roll-mode behaviour of `SavingThrowList` and `AbilityGrid`. New `SkillsCard`, `SensesCard` and `ToolsCard` in `ChecksTab.tsx` (or beside it), moving today's pieces as section 4.3 says. `PinnedChecks` moves into `SkillsCard`.
2. `CharacterSheet.tsx`: the wide body is the Ledger grid; `LatestRoll` at the top of the first column; the detail place on wide becomes "in place" inside the box (Gear keeps the drawer); `.cs-detail-host` goes; the docked dice column follows 4.3.
3. `sheet.css`: the Ledger section (columns, Abilities card, Skills card with the dense media queries, Senses, Tools). It replaces 775 to 1057 where they overlap.
4. Tests: `sheet-frame.test.tsx` wide (`getByLabelText("Checks")` becomes the first column's label; keep a "Checks" region name for the first two columns so the test reads the same), `sheet-checks.test.tsx` wide paths.

### L4: one row of tabs

1. `SheetTabs.tsx`: add `main`; drop `play` and `checks`; `sheetTabs()` per 4.5; the GM tab on every frame; the stored-tab migration. Delete `SheetTabBar` and the `.cs-tabbar*` rules (dead code).
2. `PlayTab.tsx`: move each part of `PlayCalm` to its new home (4.3) and delete what is left of `PlayCalm`; keep `useRest`, `RestButtons`, `RestMenu`, `GmLongRest`, `DeathSavesCard`, `EconomyPips` and `StatTile` exported where they are used.
3. Main on narrow and panel: StatusStrip, the Proficiency, Inspiration and Hit Point Dice plate, then the cards from L3.
4. Tests: `sheet-frame.test.tsx` tab lists for every frame, the remembered key ("gear" still round-trips), GM tab placement; `monster-rest.test.tsx` (the GM's Rest now in the band); `table/phone-sheet.test.tsx` and `commanded-creature.test.tsx` (panel tabs); `sheet-checks.test.tsx` (open Main instead of Checks).

### L5: the Actions and Spells tables

1. `turn-options.ts`: add `range`, `hitOrDc` and `damage` to `TurnOption`, with a unit test in `turn-options.test.ts` for a weapon, a spell attack, a save spell and a heal.
2. `ActionsTab.tsx`: remove the subtab strip; render `SlotsLeft`, the cost groups and Limited use (the Uses list and FreeCasts, read-only as on Play today, with Use where `Uses.tsx` offers it). `ActionList.tsx`: lay each row out in the columns of 4.5 inside the same button; one header row per list.
3. `SpellsTab.tsx`: the table layout. The segmented filter, caster lines, prepare step, slot pips and buttons stay.
4. `sheet.css`: the action list (1340 to 1424) and spells (1675 to 1851) sections.
5. Tests: `actions-tab.test.tsx` (no subtabs; groups and their order; saving throws now under Abilities), `spells-tab.test.tsx`, `cast-*` tests where they find rows by role, `turn-card.test.tsx` untouched.

### L6: narrow, panel and the related surfaces

1. Pin the compact band and the tab strip: the narrow and panel frames are a fixed band, a fixed strip and the scrolling body (no sticky positioning needed).
2. Check the floating sheet, the full-size dialog (violet for the GM), the standalone `sheet.html` and the Table panel in and out of a fight.
3. Bring `PartyMemberSheet` and `PlayerIdentity` to the band's look: the same cells and order (AC, Hit points with its life bar, Initiative and Speed where they show them), so the character reads the same everywhere.
4. Smoke: `e2e/journeys.spec.ts` 768 to 803 still finds the situation chip and `Roll Athletics` (on a phone, through Main); update any locator that named Play or Checks.

### L7: docs and cleanup

1. `docs/DESIGN.md`, The character sheet: rewrite to the Ledger (band, frames, tabs, Main, the tables, dense skill rows). Fix the stale line about the magenta primary.
2. `docs/ARCHITECTURE.md` 1148 to 1161: the frames, the band, Main, no Play or Checks, Actions without subtabs.
3. `docs/design/IMPLEMENTATION.md` Phase 5: one line saying the sheet's layout is now ADR-0047's and pointing to `docs/design/polish/D1-character-sheet/`. Leave the handoff folders under `docs/design/light-rail/` as written.
4. `docs/design/mockups/index.html`: mark the four `sheet-*` views as superseded by the Ledger mockup.
5. Remove CSS that nothing uses any more (the old Checks grid, Vitals, panel compact row) and classes with no rules (`cs-head-life`, `cs-rest-trigger`, `cs-actions-tab`, `cs-subtabs`).
6. Update `CATALOG.md` in `docs/design/polish/`: D1 built.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- Look at the sheet as a player and as the GM, in Dusk and Dawn, at:
  - 1280 by 800 with a mouse: the band in one row, three columns, all eighteen skills and all six abilities in view without a scrollbar, the box scrolling itself.
  - 1100 by 800: two columns, the band in two rows, nothing wider than the screen.
  - 390 by 844 with touch: the compact band and tabs pinned, Main first, every row at least 44 px, no sideways scroll, fields at least 16 px.
  - The Table panel at 392 px, in and out of a fight, and the floating sheet.
- With reduced motion and with reduced transparency.
- Every behaviour in 3.4 still reachable from the new places: roll a check, a save and a skill; change HP and temp HP; rest and spend Hit Point Dice; spend and restore a slot; use a limited use; add and end a condition; cast and attack in and out of a fight; level up from the menu.

## 7. Left as they are

- `TurnCard.tsx`, `PlayerActionRunner.tsx`, `PlayerTurnCard.tsx` and the table's Turn tab: they belong to the table (catalog area C) and get their own piece.
- `RestPrompt` and the GM's rest dialog: area C.
- The builder and level flow: catalog D3.
- Every command, projection and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's numbers in the action and spell tables are roll buttons on a base line. In the app each action row stays one button, as `ActionList.tsx` draws it now, because a tap starts targeting in a fight and the server's loose route outside one. The numbers sit in columns inside that button, with no box.
- The mockup's roll toast stands in for the app's own feedback: `LatestRoll` and the existing toasts.
- The mockup's phone band opens Damage, Heal and Temp inline. The app opens today's "Hit Points" modal from the HP cell, which also holds the damage type and the GM's controls.
- The mockup has no Pinned checks, situations, Tools card, Limited use detail or GM tab, because its character has none; section 4.3 places them.
- The mockup draws 10 to 11 px capitals for labels; use the sheet's eyebrow style.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `ledger-sheet.html`.

- `p4-refined.css`: the band (`.vb*`), the compact band (`.mv3*` in `p4-calm.css`), the ability ledger (`.abl*`), the dense skill rows, the Ledger grid (`.rl`, `.rf*`).
- `p4-calm.css`: skill rows (`.sk3`), senses (`.sn3`), tables (`.t3*`), slot boxes (`.sl3`).
- `p4-theme.css`: the theme spec on the sheet: Cradle boxes (`.c3`), open groups (`.c3.read`) and Base line controls.
- `p6d-parts4.js`: `Q.band`, `Q.band2`, `Q.abLedger`, `Q.trio`, `Q.features2`.
- `p6c-parts3.js`: the action and spell tables, gear, features and notes.
- `p7-main.js`: `ledgerL` (wide and narrow), the frames and the interactions.
