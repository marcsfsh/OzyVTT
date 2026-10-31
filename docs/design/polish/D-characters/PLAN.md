# D Characters: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the roster, the builder's look, levelling up and a party member as
another player sees them. It adds no rules, commands or data. File paths and line numbers were read at `f5e166f`; the
theme (T), the frame (A) and the character sheet (D1) land on the same branch first or alongside, so confirm every
anchor before editing. Paths are under `apps/client/src/` unless they start with `packages/`, `apps/server/`, `e2e/` or
`docs/`.

This is area D in `../CATALOG.md`, apart from D1 (the sheet), which `../D1-character-sheet/` covers. `SPEC.md` beside
this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, D0 to D6, each
  about one commit.
- The reference is `characters.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else
  is inline). It opens on the approved choices. Use the Page switch (Roster, Making, Level up, Party member); the first
  three are drawn as the GM sees them and Party member as a player sees another character. The other options in the four
  decision switches are the ones the owner turned down; build only the chosen ones. `history/1-round-1.html` is the
  round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code and its characters are
  stand-ins. Build with the existing components, hooks and primitives. Section 8 lists where the plan departs from the
  mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top, and `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The roster is Bands: each character is drawn as the Ledger sheet's vitals band (identity, one plate of AC, Hit
   points, Speed and Passive Perception, who plays them, Open sheet, Level up and a More menu).
2. Making a character keeps Steps and detail: today's builder with its steps rail, choices and the chosen option's
   detail, drawn to the theme.
3. Levelling up is a Dialog over the sheet with the level's own short steps (Hit points, each choice the level brings,
   Review). It replaces the level page and the builder in level mode.
4. A party member opens as a Band in a dialog, showing only what the projection sends another player.
5. Ten rules for characters (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- D builds on T, A and D1. T1 to T3 (the Base line, `Group`, the section bar), A1 to A3 (the menu, the live chip, the
  phone frame without a top bar) and D1's phase L2 (the band) must be on the branch before D1 here. If they are not,
  stop at the phase that needs them and tell the user.
- D1 (the Ledger sheet) owns `sheet/`. This plan touches `sheet/` only where it says so: the sheet menu's level items
  (D4) and the band's cells, which the roster reuses (D1). D1's phase L6 step 3 brings `PartyMemberSheet` to the band's
  look; this plan's D5 is the same work with the approved layout. Whichever lands second checks the other's commit and
  keeps one version.
- CLAUDE.md applies in full. The server decides every roll, level and claim; every command in section 3 keeps going
  through the same hooks. Projections are the boundary: a party member reads only `PlayerActor` fields the player's view
  already holds, gated by the tier (`apps/server/src/projections.ts` 943 to 975, gates 1062 to 1081). No server code,
  shared domain, schema, command or HTTP route changes. If a step seems to need one, stop and tell the user.
- `design-conventions.test.ts`: tokens (d), the breakpoint ladder (f), `.scroll-y` (h), the display face in capitals
  (i), one Eyebrow (c), toasts (e).
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area; option rows at least 48 px. "Making
  something is a set of steps" (415 to 417) holds for the builder and the level dialog.
- `play-vocabulary.test.ts` bans "unclaimed", "taken" and "fight" in copy (47 to 48, 59) and pins "Release" in
  `MyCharacter.tsx` (118) and `CLAIM_WORD` (210 to 211). Who plays reads from `CLAIM_WORD`.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The roster

- `actors/PartyRosterTab.tsx` (462 lines; `PartyRosterTab` 27 to 415), mounted at `shell/GmShell.tsx:211` with
  `onCreateCharacter={() => navigate("/builder")}`. `neverPlayed` (18 to 20) decides Delete or Archive.
- Data (41 to 60): `rosterActors(state.actors)` filtered to player characters, split into `active`, `archived` and
  `samples`; `levelable(actor)` from `builder/level-ledger.ts` 16 and 33.
- Handlers (all through `command()`): `setArchived` 62 to 76 (`actor:set-archived`), `markAtTable` 79 to 82
  (`actor:set-played-at-table`; `actors/playedAtTable.ts` 5 to 15), `setSheetPreview` 84 to 87, `remove` 90 to 104
  (`actor:remove`), `removeSamples` 107 to 125 (`actor:remove-samples`, the reply's `kept[]` toasted), `resolveImport`
  127 to 151, `importSheet` 153 to 181 (`actor:import-definition`), and force release through
  `actors/useForceRelease.tsx` 9 to 37 (`character:force-release`, with `inFight` on a second confirm).
- `card()` 183 to 264: avatar with `presenceDot`; Archived or Sample badge (199 to 203); the meta line (207 to 209)
  `{playedWord} · HP {current}/{maximum} · AC {armorClass}` from raw `actor.armorClass`; the Played at the table switch
  (212 to 219); the archived card's `RevealSwitch` (221 to 229); actions (231 to 261) View sheet, Level up or down (to
  `/characters/:id/level`), Archive, Restore, Force release claim, Delete.
- The page (269 to 357): `.party-heading` with `<h2>Roster</h2>` and Create a character, Roll a random character, Import
  from D&D Beyond (PDF), Import JSON; `<JoinAddress>` (297); the samples note `role="note"` (298 to 308); the Waiting
  for approval queue (309 to 332); the empty state (334 to 345); the gallery (348);
  `<details className="party-archived">` "Archived (n)" (349 to 357); the dialogs (362 to 412). `ImportPreview` 420
  to 462.
- CSS: `actors/party-roster.css` (192 lines); the card and gallery also in `packages/ui/src/styles/patterns.css` 91 to
  104 and `encounter/encounter-panel.css` 641 to 650. The roster is the only TSX user of `nh-card`.
- Helpers in `actors/actor-display.ts`: `presenceDot` 6 to 8, `hpLabel` 19 to 22, `ClaimState` and `CLAIM_WORD` 24 to
  31, `claimStateOf` 34 to 37, `classLine` 40 to 44.
- Speed and Passive Perception are not on the roster. `Actor.speedFeet` exists and `speedOf` is at
  `sheet/sheet-model.ts` 52 to 73. Passive Perception comes only from `derived`, the per-actor `actor:available-actions`
  read (`sheet/useSheetDefinition.ts` 156 to 240), or `extension.passivePerception`. The sheet's band reads them at
  `sheet/CharacterSheet.tsx` 603 to 640 (`StatTile` from `sheet/PlayTab.tsx` 33 to 47).
- The Prep bar: `PrepBarSlot` and `PrepFrame` in `shell/AppBar.tsx` 380 to 416 (a portal into `.section-bar-end`); today
  only `ScenesShell.tsx` 193 to 205 uses it.

### 3.2 Import and random

- `actors/PdfImportModal.tsx` (10 to 238): `size="lg"`, its own header (Eyebrow IMPORT and an h2), Choose PDF file,
  editable Name, AC, Max HP and Speed, a summary list; confirm sends `actor:import-definition` (GM) or
  `character:submit-import` (player). Opened from the roster (405) and `ClaimCharacter.tsx:190`.
- `builder/RandomCharacter.tsx` (`RandomCharacterModal` 16 to 164): `size="sm"`, title "Roll a random character", Cancel
  and Roll it up, sends `character:generate`. Opened from the roster (362) and `MyCharacter.tsx:278`.

### 3.3 The builder

- `builder/CharacterBuilder.tsx`: the `rebuild` prop (71 to 96: actor, name, seed, recorded method, held classes, mode
  up or down, notice); the steps (137 to 145; up mode adds "level" before review); `stepReasons` (245 to 253);
  `stepsForShell` (286 to 292); submit (310 to 365, `character:rebuild` or `character:create`); Save and close and
  Escape (398 to 421); `body()` per step (499 to 760); `<WizardShell>` (810 to 936: title "Create a character" or "Level
  up {name}", eyebrow "Character builder", `stepsPlacement="side"`, the footer's Back, blocked reason and
  `Next: {short}`).
- `builder/build-payload.ts`: `STEP_IDS`, `STEP_LABELS`, `STEP_SHORT` (577 to 598), `stepBlockedReason` (604).
- `packages/ui/src/primitives/WizardShell.tsx`: the head with Save (112 to 125), the side nav (126), the split body with
  `aside.nh-wizard-detail` (131 to 164), the footer (166 to 198). `Steps.tsx` (8 to 139): `StepItem`, the compact "Step
  i of n" progress under 760 px, `ol.nh-steps--vertical`, `.nh-step-jump`.
- `builder/StepDetail.tsx` (detail for class, species, background, subclass and feat; `stepDetail` 257 to 266),
  `builder/OfferPickers.tsx` (`OfferPicker` 60 to 142, `AsiOffer` 149 to 302), `builder/AbilitiesStep.tsx`
  (`HitPointsSection` 417 to 530).
- CSS `builder/character-builder.css`: page and step 5 to 24, offers and notes 25 to 90, ASI rows 93 to 128, the level
  page 130 to 292, class levels 294 to 324, the random dialog 326 to 359, `.cb-level-earlier` 374 to 384.

### 3.4 Levelling

- The route `/characters/:id/level` (`router.ts` `layerOf` 345 to 348, `isKnownPath` 311 to 312); `shell/LayerView.tsx`
  64 to 73 renders `LevelFlow`; close and done go to `/characters/:id`.
- `builder/LevelFlow.tsx` (49 to 321): gates (105 to 140: missing actor, the player's builder closed,
  `classOrderUnknown`, no identity or ledger, a refused read); with a `target` it reads offers (90 to 103) and renders
  `CharacterBuilder` in rebuild mode (154 to 186, seeded by `draftFromLedger`, with the `hpRollGap` notice); otherwise
  the level page (189 to 320: the levels rail, "Level N goes to" with Take a new class, the cap note, the "Leveling down
  to N" preview, and Level up to N, Level down to N, Back to the sheet). Helpers `classesOf` 341, `classChoices` 357 to
  390, `Gate` 392.
- `builder/LevelStep.tsx`: `levelUpOffers` (13 to 19), `classAtLevel` (22 to 26), `featuresAt` (29 to 45), `LevelStep`
  (47 to 108: "X becomes level N", the earlier steps nav, "New at Class N", the choices and hit points).
- Apply sends `character:rebuild` (POST `/game/actors/{id}/rebuild`); level down is the same command at the lower level.
- Entry points: `sheet/SheetMenu.tsx` (24 to 41, 63 to 74: Level up to N, Level down to N, one `onLevel`), wired at
  `sheet/CharacterSheet.tsx` 232 to 254 (`mayLevel`, `levelUpTarget` in `sheet/sheet-model.ts` 136 to 147); the phone's
  `sheet/LevelBox.tsx` 85 to 98; the roster (236, 380), `PartyStrip.tsx:112`, `LayerView` (123, 150),
  `PlayerShell.tsx:52`, `PlayerEncounterPanel.tsx:392`. What the next level brings comes from `sheet/useNextLevel.ts`
  (`character:next-level`).

### 3.5 A party member and nothing claimed

- `actors/MyCharacter.tsx`: `partyVisibilityOf` (35 to 38); `PartyMemberSheet` (47 to 111, not exported: a `size="md"`
  Modal titled with the name, the class line, HP by `hpLabel`, AC, Speed, the abilities when `definition` is present,
  conditions, and hit dice and spell slots only with `resources`); `useReleaseCharacter` (117 to 138); `PartyList` (144
  to 222: a row is a button only at the full-sheet or sheet-and-resources tier and when claimed); `MyCharacter` (232 to
  344: claimed, the sheet with "The rest of the party" in its menu, 266 to 270 and `SheetMenu.tsx` 116 to 121; nothing
  claimed, 310 to 343: "My character", Create a character, Roll a random one, "You haven't claimed a character yet.", Go
  to the table, The party).
- The projection: `PlayerActor` in `packages/domain/src/views.ts` 107 to 163 (party fields 93); `PlayerHp` (34 to 35) is
  exact for player characters (`projections.ts` 52 to 56); the band word is for monsters. `classLine` from the
  name-and-class tier up, `definition` from full-sheet, hit dice, spell slots and action uses from sheet-and-resources.
  The tiers are at `packages/domain/src/state.ts` 2307 to 2315.

### 3.6 Tests that pin it

- `actors/party-roster.test.tsx`: `card(name)` is the heading's closest `li`; the Played at the table switch (52 to 68);
  `neverPlayed` (70 to 75); Delete or Archive (77 to 83); Sample and the `role="note"` with "Borin, Lyra are sample
  characters", Remove sample characters (85 to 102); the kept toast (104 to 117); Force release claim and its two
  dialogs (119 to 138). Nothing asserts the Roster heading or the toolbar.
- `builder/character-builder.test.tsx`: the pickers (526 to 900), `LevelFlow` (901 to 1048: "Level 4 goes to", Take a
  new class, Level up to 4, Level down to 2, `.cb-level-preview p`, "Mira's classes were added by hand"), Random (1050
  to 1082), level up (1085 to 1167: h1 "Level up Mira", "Mira becomes level 4: Cleric 4.", "Level 4 improvement",
  `.nh-step-jump`, Back to level 4, "Earlier steps").
- Others: `level-ledger.test.ts`; `sheet/sheet-frame.test.tsx` 256 to 304 (LevelBox, menu items Level up to 8 and Level
  down to 6); `party-strip-level.test.tsx` 59 to 73; `router.test.ts` 77, 84, 94, 294, 340; `packages/ui`
  `steps-vertical.test.tsx` 19 to 39; `party-visibility.test.tsx` (the strip only). No unit tests cover
  `PdfImportModal`, `PartyMemberSheet` or `MyCharacter`.
- e2e: `journeys.spec.ts` 241 to 247 (`.party-roster-body` and the heading `PARTY[0]`); the Prep Party page visits at
  960 and 1035 with the ink-line check at 993 to 1030; the join address from the Table (117 to 128). `smoke.ts:19`
  `PARTY`, 224 to 232 `joinAndClaim`, 236 `PREP_PAGES`. No e2e covers the builder, levelling, import or a party member.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                         | New or changed                                                                            | Built from                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `actors/RosterBand.tsx`      | New: one character's band                                                                 | D1's band cells, `ActorPortrait`, `CLAIM_WORD`, `Lamp`, `armorClassOf`, `exactHp`, `speedOf`                |
| The roster page              | Changed: Prep's bar primary, the samples line, the toolbar, the bands, the archived group | `PartyRosterTab`, `PrepBarSlot`, T's `Group`                                                                |
| `builder/LevelDialog.tsx`    | New, replacing `LevelFlow`'s page and the builder's level mode                            | `levelUpOffers`, `classChoices`, `HitPointsSection`, `AsiOffer`, `OfferPicker`, the kit `Steps` and `Modal` |
| The builder                  | Restyled to the theme                                                                     | `WizardShell`, `Steps`, `StepDetail`                                                                        |
| `actors/PartyMemberBand.tsx` | New, replacing `PartyMemberSheet`'s body                                                  | the band cells, `partyVisibilityOf`                                                                         |
| Nothing claimed              | Changed: T's empty state on Sheet                                                         | `MyCharacter`, T's empty state                                                                              |

## 5. Phases

### D0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `D-characters/`, and leave the
   other pieces' folders as the zip has them.
2. Add `D-characters/ADR-0051-characters.md` as `docs/adr/0051-characters.md`, Accepted, and its row to
   `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### D1: the roster's bands

1. `actors/RosterBand.tsx`: identity (the face at 64 px, the name in Chakra Petch 600 capitals 18 px as the band's
   heading, the class line from `classLine` with species and background, then tags: Sample, and each condition with its
   tone), the plate (AC from `armorClassOf`, Hit points current over maximum in gold from `exactHp`, Speed from
   `speedOf`, Passive Perception), and the end (who plays over Open sheet, Level up and the More menu). Reuse D1's band
   cells; if L2 made them a component, use it with a `compact` look.
2. Passive Perception: read it as the sheet does, through the existing `actor:available-actions` read in
   `useSheetDefinition`, one read per band once it is on screen, and show a dash until it arrives. If that proves slow
   with a full roster, show the three other cells and tell the user; do not add a field to `GmView`.
3. Who plays (rule 4): a `Lamp` and the words from `CLAIM_WORD` and `playedAtTable`: on a player's device (cyan, with
   the session's name where `ownerSessionId` gives it), at the table (gold), open to claim (unlit).
4. The More menu holds Played at the table (a checked menu item, disabled while claimed as `atTableBlocked` says),
   Release (today's Force release claim with its two confirms), Archive or Delete by `neverPlayed`, and for an archived
   band Restore and Show to players (today's `RevealSwitch`).
5. Level up shows only when `levelable(actor)` and not archived; until D4 it goes to `/characters/:id/level` as today.
6. A phone (under 640 px): identity, then the plate of AC, Hit points and Speed, then who plays and Open sheet with the
   More menu, as `SPEC.md` 2.1 says.
7. Tests: `party-roster.test.tsx`: `card(name)` reads the band (an `li` or `article` named by its heading); the switch
   tests become the More menu's Played at the table item; Force release claim becomes Release with the same dialogs; a
   test that a band shows AC, hit points and Speed and that who plays reads "At the table", "Open to claim" or the
   player's device.

### D2: the roster page

1. Prep's Titled bar names the page Party; New character is its Cup through `PrepBarSlot` (rule 1). Remove the
   `.party-heading` h2 and its four buttons.
2. The toolbar under the samples line: the count ("4 characters") at the left; Roll a random character and Import as
   Base line controls at the right, Import a menu of From a D&D Beyond PDF and From a JSON file (the hidden input
   stays).
3. The samples line (rule 3): one description line naming the samples ("Borin and Lyra are sample characters.") with
   Remove sample characters on a Base line; keep `role="note"` so the test's reading still holds, or update it.
4. Remove `<JoinAddress>` from the roster (rule 2); the Table and Settings keep theirs.
5. The Waiting for approval queue stays above the bands as an open group with a count, its rows restyled to Base line
   controls (Preview, Approve, Turn away).
6. The archived group (rule 5): one closed open group "Archived · n" at the end, holding archived bands.
7. The empty state: T rule 3's empty state with New character and Roll a random character.
8. Roll a random character, the PDF import and the import preview are Dialogs (rule 7, A rule 6): the title on the
   horizon edge, Cancel as a ghost and the Cup at the right, a sheet from the bottom on a phone. `PdfImportModal` loses
   its own Eyebrow header.
9. Tests: `party-roster.test.tsx` (the samples line, the toolbar's Import menu, no join address); `journeys.spec.ts` 241
   to 247 reads the bands; the Prep Party page visits still pass the ink-line check.

### D3: the builder drawn to the theme

1. `WizardShell`'s head is a record page's title row: "Create a character" and the step ("Step 3 of 7 · Class and
   level"), with Done as a Base line control at its right (the third sweep, T-consistency 6.4). In a rebuild, until D4
   removes it, keep Close.
2. The rail (240 px) uses T rule 4's Steps: done a solid cyan box with a dark tick, current a cyan outline with a 3 px
   cyan edge at its left, needs a choice an amber box, as Prep's rail; a done step shows its answer under its name. This
   changes `Steps.tsx`'s vertical look in `packages/ui`; check `steps-vertical.test.tsx`.
3. The question: its heading in the eyebrow style, the choices as Base line tiles (from 190 px, at least 64 px tall),
   the chosen tile on a 2 px cyan line with a tick.
4. The detail (360 px): the option's name in Chakra Petch, a sentence, its facts as a definition list, and what it
   brings at Level 1. `StepDetail.tsx` keeps its content; its CSS follows.
5. The foot: Back as a ghost, the step's own small choice (Level 1) where it has one, and Next with the next step's name
   as the Cup; the blocked reason in amber beside it as today.
6. A phone: the header row (A3) with Close, the progress line ("Step 3 of 7 · Class and level", the answer so far at the
   right, seven marks), one column of choices with the chosen one opening to its detail ("Show details" stays), and the
   foot pinned.
7. Tests: `character-builder.test.tsx`'s pickers keep their names (`Next: Background`, `.nh-wizard-detail`, Show
   details); a test that a done step shows its answer.

### D4: the level dialog

1. `builder/LevelDialog.tsx`: a Modal of 620 px (the Dialog pattern; a sheet from the bottom on a phone), titled "Level
   8 for Borin". It opens over the sheet; the sheet stays behind it.
2. Its steps (rule 6) along its top: Hit points, then one step per choice the level brings, then Review. Build the list
   from `levelUpOffers` and `classChoices` for the target level (`targetClassLevels`): an ASI or feat (`AsiOffer`), a
   subclass, spells and other offers (`OfferPicker`). A level with no choice has Hit points and Review. On a phone the
   steps read "2 of 3" and the step's name.
3. Hit points: `HitPointsSection` with Take the average or Roll the Hit Point Die as a segmented control, the server's
   roll as today, and the change shown as "67 to 76, 6 plus 3 for Constitution".
4. An Ability Score Improvement: Raise ability scores or Take a feat as a segmented control; the six scores as Base line
   cells, the chosen on the cyan line with the new value and +2 or +1; a feat as a list of rows. `AsiOffer`'s logic
   stays.
5. Review: what changes (hit points, scores, features gained from `featuresAt`, Proficiency Bonus), then Apply level 8
   as the Cup. Apply sends `character:rebuild` with the payload `CharacterBuilder` builds today: seed a draft with
   `draftFromLedger`, apply the level's answers and call the same payload builder in `build-payload.ts`, so the server
   sees the same request.
6. Multiclass: Take a new class goes in the first step when `classChoices` allows one, with today's shortfall notes.
7. Level down: the dialog's More menu holds Level down to N; choosing it shows today's "Leveling down to N" preview and
   what is kept, with Apply as the Cup. It sends the same `character:rebuild` at the lower level.
8. Wire it: the sheet menu's level items and the phone's `LevelBox` open the dialog on the sheet (this is the one change
   in `sheet/`, tell D1's session in the commit); the roster's Level up opens the sheet with the dialog; the route
   `/characters/:id/level` renders the sheet with the dialog open, so links and the other entry points keep working.
   Keep `LevelFlow`'s gates as the dialog's empty states (the player's builder closed, `classOrderUnknown`, no identity
   or ledger, a refused read).
9. Retire the level page and the builder's level mode: `LevelFlow`'s page, `LevelStep`, `CharacterBuilder`'s
   `rebuild.mode` up and down, and their CSS (`character-builder.css` 130 to 292 and 374 to 384). Keep
   `CharacterBuilder`'s rebuild for anything else that uses it; check with grep first.
10. Tests: rewrite `character-builder.test.tsx` 901 to 1048 and 1085 to 1167 for the dialog: a level with no choice has
    two steps; a level with an ASI has three and Apply waits for it; Take a new class; level down from the More menu
    sends `character:rebuild` at the lower level; the gates. `sheet-frame.test.tsx` 256 to 304 and
    `party-strip-level.test.tsx` 59 to 73 open the dialog; `router.test.ts` keeps the level route.

### D5: a party member and nothing claimed

1. `actors/PartyMemberBand.tsx` in a 560 px Modal (a sheet from the bottom on a phone), titled with the name,
   `ariaLabel` "{name}'s sheet" as today. It shows only `PlayerActor` fields under the tier `partyVisibilityOf` gives
   (rule 9): the face, the class line, conditions as tags; the plate of AC, Hit points as `hpLabel` gives them and
   Speed; the six abilities in a row (modifier over score) when `definition` is present; Hit Point Dice and spell slots
   on one line only with `resources`. Groups inside are open; the dialog is the only box.
2. This is D1's L6 step 3 with the approved layout. If L6 is already on the branch, change its result to this layout; if
   not, tell D1's session in the commit.
3. Nothing claimed (rule 8): Sheet shows T rule 3's empty state, "You aren't playing anyone yet." with Pick a character
   (to the claim page), and Create a character and Roll a random one as Base line controls under it while the GM allows
   the builder. The party list stays under it as an open group.
4. Tests: a new `party-member.test.tsx`: at each tier the dialog shows only that tier's fields (no abilities without
   `definition`, no hit dice or slots without `resources`, never skills, spells, gear or notes); the nothing-claimed
   state's words and button. `play-vocabulary.test.ts` still passes.

### D6: docs and cleanup

1. `docs/DESIGN.md`: Prep's Party (186) as bands; a short section for the roster and a party member beside the sheet's
   band (426 to 447); "Making something is a set of steps" (415 to 417) names the level dialog's short steps.
2. `docs/ARCHITECTURE.md`: characters (116 to 141: the roster's More menu holds Played at the table and Release; the
   join address leaves the roster); the builder and levelling (946 to 969, 1262 to 1264: the level dialog replaces the
   level page, the route opens it); the Prep bar (1084 to 1090: the Party page uses `PrepBarSlot`). Fix 155, which says
   players get "a health band with no exact HP": player characters' hit points are exact (`projections.ts` 52 to 56);
   the band is for monsters.
3. `docs/adr/README.md`: 0051 Accepted and built. Note on ADR-0042's row that the switch moved into the More menu
   (0051).
4. Remove what nothing uses: the roster's card CSS (`party-roster.css` 158 to 192 and the `nh-card` rules if no one else
   uses them), the level page's CSS, `LevelStep`.
5. `docs/design/polish/CATALOG.md`: D2 and D3 move to Built.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With the sample party and one more character (one claimed by a player, one played at the table, one archived), look as
  the GM and as a player, in Dusk and Dawn, at:
  - 1280 by 800 with a mouse: the roster's bands, the samples line, the toolbar and its Import menu, the archived group,
    each band's More menu; the builder at three steps; the level dialog for a level with no choice and for one with an
    Ability Score Improvement, then Review and Apply; level down from its More menu; a party member at each tier.
  - 390 by 844 with touch: the same, with the bands stacked, the builder's progress line and pinned foot, the level
    dialog and the party member as sheets from the bottom; every control at least 44 px; no sideways scroll.
  - A player with nothing claimed.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable: create, roll, import a PDF and a JSON file, approve and turn away an
  import, mark played at the table, release with both confirms, archive, restore, show an archived character to players,
  delete, remove samples, level up with each kind of choice, take a new class, level down.

## 7. Left as they are, for later rounds

- The sheet itself (D1) and its tabs.
- Claiming a character (B6, B7) and the join sheet (B8): area B.
- What a level brings and every rule behind it; the payloads; every command, projection and stored value.

## 8. Departures from the mockup, on purpose

- The mockup draws Passive Perception on every band from stand-in numbers; the app reads it per band (D1 step 2) and
  shows a dash until it arrives.
- The mockup draws the More menu's items as a list; the app keeps today's confirms (Release, Release mid-encounter,
  Delete) and the archived character's Show to players.
- The mockup does not draw the Waiting for approval queue, the empty roster, the import dialogs, Take a new class, the
  level dialog's gates or level down's preview; section 5 places them.
- The mockup's characters, faces and numbers are stand-ins.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `characters.html`.

- `p4d-chars.css`: the roster bands (`.d-band`, `.d-plate`, `.d-plays`, `.d-tool`), the builder (`.d-make`, `.d-steps`,
  `.d-step`, `.d-choices`, `.d-detail`, `.d-pfoot`, `.d-prog`), the level dialog (`.d-dlg`, `.d-lvl`, `.d-segc`,
  `.d-abil`, `.d-chg`), the party member (`.d-pm`, `.d-ab`, `.d-res`), and the phone (`.d-ph`).
- `p6-chars.js`: the party (`CH`), `plate()`, `plays()`, `acts()`, `rosterTool()`, `archived()`, `rosterBody()` and
  `roster()` (the `bands` branch), `steps()`, `classGrid()`, `wizardDetail()`, `qfoot()` and `builder()` (the `detail`
  branch), `hpChoice()`, `asiChoice()` and `level()` (the `dialog` branch), `memberBand()` and `member()` (the `band`
  branch), and the rules in `renderStatic()`.
- `p4b-frame.css` and `p4-spec.css`: area A's frame and the theme spec's parts the pages are drawn with.
- `audit-d.js`: the "Today" screenshots.
