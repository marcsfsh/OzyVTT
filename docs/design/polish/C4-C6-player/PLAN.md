# C4 and C6 A player in a fight: building it

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan moves the player's prompt onto the map, names each prompt by its kind only,
draws a reaction's answer as its roll row and the death saves as lamps, and opens what a cast or a feature asks, and a
spell's card, under its row. It adds no rules, commands, routes or data. File paths and line numbers were read at
`f5e166f`; the theme (T), the frame (A), the table's frame (C), C3 and C5 land on the same branch first or alongside, so
confirm every anchor before editing. Paths are under `apps/client/src/` unless they start with `apps/`, `packages/`,
`e2e/` or `docs/`.

This is C4 and C6 in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, P0 to P6,
  each about one commit.
- The reference is `a-player-in-a-fight.html` in this folder. Open it in a browser (fonts load from Google Fonts;
  everything else is inline). It opens on the approved choices. Use the Page switch (A prompt, A reaction, Dying,
  Choosing for a spell, The spell card). Lyra's player is on the laptop and the phone for the prompts, Mirena's player
  for the spell. The other options in the decision switches are the ones the owner turned down; build only the chosen
  ones. `history/` holds the round.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its fight is a stand-in.
  Build with the existing components, hooks and primitives, and with the settled ones (T's Base line and roll row, C's
  lamps, C3's card and row tools, A's glass and band). Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. A prompt sits on glass at the foot of the map (on a phone, at the foot of the Switch's open view); away from the
   table every prompt is A's band.
2. A prompt's eyebrow names its kind only: "answer now" and "roll now" go everywhere they appear.
3. A reaction's answer is its roll row, with keeping the reaction as a control under it.
4. Dying shows the death saves as lamps over the death save's roll row.
5. What a cast or a feature asks opens under its row, at the table and on the sheet.
6. The spell card opens under its row.
7. Eight rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3 (the roll row, Base line, glass), A's band (A rule 10), C1 to C5 (two docks, the Turn tab's
  cost tabs and lamps, the phone's Switch), C3's first round (the card) and second round (row tools under the row, the
  roll row in prompts). If one is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. The server decides who is asked and what they see: the prompts come from the player's own
  view (`table/playerPrompts.ts` 44 to 77, `encounter/RollCallPrompt.tsx` 41 to 64). Every command stays:
  `reaction:answer`, `reaction:dismiss`, `save:answer`, `death-save:roll`, `roll-call:answer`, `initiative:roll-self`,
  the turn's actions and casts with their `slotLevel`, `targetIds`, `shaping` and `spend`. No server, shared domain, schema, projection or
  route changes. If a step seems to need one, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the prompts and casts as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The prompt slot

- `table/PromptSlot.tsx`: `reactionWords` (30 to 113: each kind's title, line and the numbers Their roll, Your AC and
  With {spell}), `PromptCard` (115 to 155: eyebrow, title with meta, numbers, detail, body), `PromptSlot` (160 to 403):
  the entries (`playerPrompts` and the roll calls, 170 to 176), `titleOf` (186 to 203), the announcement "Answer now:
  {title}." and the focus (206 to 220), the outcome line (222 to 227), the cards: reaction "Reaction · answer now" (233
  to 256), death save with no eyebrow (257 to 283), save "Saving throw · answer now" (284 to 311), damage "Damage · roll
  now" (312 to 323), initiative "The encounter starts" (324 to 340), order "Your turn · answer now" (341 to 352), the
  roll call (353 to 368); the regions "Answer now" (375, 387), "N more after this" (389 to 393). `hasPlayerPrompt`
  (405 to 408).
- Mounted in the panel's top slot: `shell/TableView.tsx` 205 to 210 (with `RestPrompt`), passed as `top` in
  `encounter/PlayerEncounterPanel.tsx:697`. The map: `shell/TableView.tsx` 102 to 120 (`EncounterMap`), 237 to 247
  (`.table-bench-split`, `.table-bench-map`, `.table-bench-panel`); the map's stage `scene/EncounterMap.tsx` 776 to 800.
- CSS `table/prompt-slot.css` 1 to 144, `table/table-panel.css` 13 to 18 and 137 (the slot's cap, 65 % on a phone).
- Away from the table: `shell/App.tsx` 108 to 113 renders `RollCallPrompts` (`encounter/RollCallPrompt.tsx` 66 to 87,
  the dock "Rolls the GM calls for" at 70) on every page but the table; other prompts do not follow. The server's note
  lines ("Lyra Emberwise may use Shield.", `apps/server/src/triggered-reactions.ts` 105 to 108,
  `damage-reactions.ts:81`) arrive as toasts and stay.

### 3.2 A reaction

- `encounter/ReactionPrompt.tsx` (695 lines): the header comment of every kind (1 to 40), `useLabel` "Cast {name}" or
  "Use {name}" (290), the head lines per kind (295 to 335), the answers per kind: a fall (468), an attack's new target
  (489), a roll waiting on the answer (525 to 568), damage responses (569 to 614), "Take the hit", "Let it go" or
  "Decline" then the use button (615 to 657), halving (658 to 678), the GM's dismiss (679 on). Shared with the GM's view (`viewer="gm"`), which C3 2.5 already draws.

### 3.3 Dying

- `encounter/DyingTracker.tsx` (195 lines): the held die and Confirm (17, 56 to 60, `death-save:roll` 77), the label
  Dying, Stable or Dead and the pips (117 to 135), the roll (`rollLabel` "Roll death save") and Confirm (153), the
  result (165 to 185). End turn's "Roll your death save first." is `endWaits` at `encounter/PlayerEncounterPanel.tsx:690`.

### 3.4 Casting and its asks

- At the table: `encounter/PlayerActionRunner.tsx` (762 lines): `pickOption` (440 to 459) opens `CastDetail` for a
  spell with a choice of slot or shaping, `SpellPickChooser` for picks, `ReadyChooser` for Ready; `castDetail` (460 to
  486) renders inline (487) or in its place (527); the target picker (572 to 600,
  `encounter/ActionTargetPicker.tsx` 66 to 180: tap a token, drag an area); the result card after.
- `sheet/CastDetail.tsx` 81 to 220 (the back button, "How to cast it" slot options, "Shape the spell", the next line,
  Cast at level N). On the sheet: `sheet/PlayFight.tsx` 227 and 272, `sheet/SpellsTab.tsx` 395.
- Dialogs: `encounter/HealTargetPicker.tsx` 66 (from `sheet/useSheetController.tsx` 208 to 225),
  `encounter/ShapeShiftDialog.tsx` 47 (`useSheetController.tsx:186`), `encounter/ReadyChooser.tsx` 40,
  `encounter/SpellPickChooser.tsx` 30, `encounter/SpellChoiceModals.tsx` 90 (`SpellSwapModal`, from
  `sheet/SpellsTab.tsx:734`), `encounter/equipment.tsx` 312 to 350 and 425 to 460 (an item's spell or form); Add
  equipment at 500 to 506 stays a dialog.

### 3.5 The spell card

- `encounter/spells.tsx`: spell names in a feature's text that open it (`SpellcastingText`, 112 to 142), `SpellCard` as a Modal (146 to 165),
  `SpellCardContent` (167 to 209). Opened from `sheet/SpellsTab.tsx:732`, `encounter/spells.tsx:140` and
  `builder/OfferPickers.tsx:139` (the builder keeps its own). CSS `encounter/spell-card.css` 1 to 72.

### 3.6 Tests that pin it

- `table/prompt-slot.test.tsx` (107 to 127: the region "Answer now" and the announcement; 128 to 147; 149 to 169; 171
  to 193), `encounter/reaction-slot.test.tsx`, `encounter/held-dice.test.tsx`, `encounter/saveLight.test.tsx`,
  `sheet/cast-targets.test.tsx`, `sheet/cast-outside-fight.test.tsx`, `sheet/cast-metamagic.test.tsx`,
  `sheet/loose-healing.test.tsx`, `sheet/spells-tab.test.tsx`, `sheet/conversions.test.tsx`, `table/needs-you.test.tsx`,
  `builder/character-builder.test.tsx`.
- e2e: `journeys.spec.ts:397` (the region "Answer now"), 448 to 472 (the phone's cast: the cast card, targets, "Roll
  Guiding Bolt").

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The slot over the map | Moved: from the panel's top to glass at the map's foot | `PromptSlot`, A's glass |
| The kind's eyebrow | Changed: no "answer now" or "roll now"; the region "Prompts" | `PromptCard`, `titleOf` |
| The band for every prompt | Widened: from calls to every prompt off the table | `RollCallPrompts`, A's band |
| A reaction's row | Changed: the use as a roll row, the rest under it | `ReactionPrompt`, the roll row |
| Lamps | Changed: the pips become lamps over the roll row | `DyingTracker`, C's lamps |
| Asks under the row | Moved: `CastDetail`, the target choice and the dialogs under the row | C3's row tools |
| The card under the row | Moved: `SpellCardContent` under the spell's row | `SpellCardContent` |

How the parts fit, so the phases agree:

- The slot: `PromptSlot` renders into the map's area (a positioned layer inside `.table-bench-map`, over the stage)
  instead of the panel's `top`. `RestPrompt` keeps the panel's top. With no map live, the slot falls back to the
  panel's top, as today. On a phone the layer sits at the foot of the Switch's open view.
- The eyebrow: every `PromptCard` takes the kind's word (Saving throw, Reaction, Death save, Damage, Initiative, The
  encounter starts, Your turn); the announcement becomes `${eyebrow}: ${title}.`; both regions' name becomes "Prompts".
- The band: one component reads `playerPrompts` and the roll calls on every page but the table and shows the first as
  A's band with the kind's tag; a roll (a call, a save, a death save, initiative, damage) rolls from the band through
  the same component the card uses; anything with more than one answer gets Go to the table.
- A reaction's row: for the player's view, `ReactionPrompt` renders the use as one roll row per use (its name, line and
  number from `reactionWords` and `useLabel`), and keeps the decline control's words under it. Today's numbers block
  folds into the row; `reactionWords` keeps producing it for the row's words.
- Lamps: `DyingTracker` draws Saves and Fails as lamps and its roll as the roll row; the held result and Confirm stay.
- Asks under the row: the Turn tab's option row gains an open state; `CastDetail`, the target choice and the chooser
  bodies render inside it. Each dialog's body becomes a component that renders under the row; the `Modal` wrapper goes
  (Add equipment's keeps it).
- The card under the row: the spell's name toggles `SpellCardContent` under its row; `SpellCard`'s Modal stays only
  where no row holds the name (the builder).

## 5. Phases

### P0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `C4-C6-player/`, and leave the
   other pieces' folders as the zip has them.
2. Add `C4-C6-player/ADR-0061-a-player-in-a-fight.md` as `docs/adr/0061-a-player-in-a-fight.md`, Accepted, and its row
   to `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### P1: the kind's eyebrow

1. Every eyebrow names its kind only; the death save gains Death save; the announcement and the regions as section 4
   says. Search the client, `e2e/` and `docs/` for "answer now", "Answer now" and "roll now" and remove each.
2. Tests: `prompt-slot.test.tsx` (the region "Prompts"; the announcement "Reaction: Goblin 1's attack would hit
   you."; no "answer now" in any card), `journeys.spec.ts:397`.

### P2: the slot over the map

1. The slot on glass at the map's foot, the zoom controls clear of it, the fallback with no map (section 4).
2. A phone: the glass at the foot of the Switch's open view.
3. Tests: `prompt-slot.test.tsx` (the slot renders in the map's layer when a map is live, and in the panel's top
   without one; one prompt at a time with the count), `needs-you.test.tsx` holds.

### P3: the band for every prompt

1. A's band off the table for every prompt kind, its tag, title, answer and count; the Sheet's stacked calls go.
2. Tests: a new `prompt-band.test.tsx` (a save's band rolls it; a reaction's band offers Go to the table; the count of
   the rest; nothing on the table itself), `roll-calls.test.tsx` holds for the card.

### P4: a reaction's row and the lamps

1. `ReactionPrompt` for the player as roll rows with the decline under them; the slot choice as a segmented row.
2. `DyingTracker` with lamps and the roll row; the result and Confirm.
3. Tests: `reaction-slot.test.tsx` (Cast Shield's row answers Use, Take the hit answers Decline, each kind's words
   hold), `held-dice.test.tsx` and `saveLight.test.tsx` hold, a death save's lamps light from `deathSaves`.

### P5: asks and cards under the row

1. At the table: the Turn tab's open row; `CastDetail`, the target choice, `SpellPickChooser` and `ReadyChooser` under
   it; Cancel and the row close it.
2. On the sheet: the cast, `HealTargetPicker`, `ShapeShiftDialog`, `SpellSwapModal` and the item's choices under their
   rows; their Modals go.
3. The spell card under the spell's name's row; the builder keeps its own.
4. Tests: `cast-targets.test.tsx`, `cast-outside-fight.test.tsx`, `cast-metamagic.test.tsx`, `loose-healing.test.tsx`,
   `spells-tab.test.tsx` and `conversions.test.tsx` (their names and payloads hold; the asks are found under the row,
   not in a dialog), `journeys.spec.ts` 448 to 472.

### P6: docs and cleanup

1. `docs/DESIGN.md`: the prompt over the map, the kind's eyebrow, the band for every prompt, the reaction's row,
   lamps, asks and cards under the row (309, 421 and 442 describe the slot today).
2. `docs/ARCHITECTURE.md`: where the slot renders, the band, the open row.
3. `docs/adr/README.md`: 0061 Accepted and built. `docs/design/polish/CATALOG.md`: C4 and C6 move to Built.
4. Remove what nothing uses: the slot's panel CSS, the pips, the dialogs' Modal wrappers, `RollCallPrompts`' dock.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a fight running (a tripwire's saving throw, a call for a roll, a Goblin Boss attack that Shield can turn, a
  character at 0 hit points, a cleric casting Cure Wounds), look in Dusk and Dawn at:
  - 1280 by 800 with a mouse, as a player: the card over the map with the count, the map panning under it; the
    eyebrows; Shield's row and Take the hit; the death save's lamps, the roll, Confirm and End turn's words; the band
    on the Sheet for a save and for a reaction; Cure Wounds' ask under its row with the slot and who, and the spell
    card under its row.
  - 390 by 844 with touch, as a player: the card at the foot of the Map and Turn views; the band on the Sheet; the ask
    and the card under their rows; every control at least 44 px; no sideways scroll.
- With reduced motion and reduced transparency (the glass turns solid).
- Every behaviour in section 3 still reachable, including the outcome line, Heroic Inspiration's reroll, initiative's
  reroll, Metamagic, areas on the map, the GM's dismiss, and a heal outside a fight.

## 7. Left as they are, for later rounds

- The rest prompt (C4.4), the phone identity header (C4.5), the replay shelf (C4.6), Add equipment's catalogue (C6.7),
  the token image picker (C6.8, with E2).
- The server's note lines and their toasts; every command, projection, HTTP route and stored value.

## 8. Departures from the mockup, on purpose

- The mockup draws the prompt over the Map view on the phone; the app shows it at the foot of whichever view is open.
- The mockup draws no zoom controls moving, no band away from the table, no held death save result or Confirm, no
  Metamagic or area, and no fallback without a map; sections 2 and 4 place them.
- The mockup draws Shield's row with the slot's count in words; the app takes the words from `reactionWords` and the
  slot from today's cost line.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `a-player-in-a-fight.html`.

- `p4o-c4.css`: the card (`.y-card`, `.y-card.danger`), glass (`.y-glass`), lamps (`.y-lamps`), the band (`.y-band`,
  `.y-band.ph`), who (`.y-who`), the spell card (`.y-spell`). The roll row is `.q-rollrow` and the open row
  `.q-dockopen` in `p4m-c3b.css`; `p4c-table.css`, `p4l-c3.css`, `p4m-c3b.css` and `p4n-c5.css` are C's frame, C3 and
  C5.
- `p6-body4.js`: `saveCard()`, `shieldCard()` (the `rollrow` branch), `dyingCard()` (the `lamps` branch), `placeLap()`
  and `placePhone()` (the `map` branch), `mirTurn()` and `chooseInner()` with `choosePage1()` (the `inplace` branch),
  `spellCells()` with `spellPage1()` (the `inplace` branch).
- `p6-dec4.js`: the decisions, the Carried in list and the rules. The earlier files are C's frame, C3 and C5, ported.
- `audit-c3.js`: the "Today" screenshots and the map.
