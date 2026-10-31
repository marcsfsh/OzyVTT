# Polish catalog

Every surface in OzyVTT that the polish pass will design, grouped by what it is and the job it does. Read at `f5e166f`
on `claude/friendly-babbage-g7gcge`. Paths are relative to `apps/client/src/`; a path starting `ui/` is under
`packages/ui/src/`.

## How the hierarchy works

Designs go top down. Each level is designed before the levels under it, and each level inherits everything above it.

1. The theme, Light Rail / Horizon (T). Built and recorded in ADR-0045 and ADR-0046. Its design step gathers the rules
   every area shares: tokens and type, the kit, the page patterns and the conventions earlier pieces proved.
2. An area (A to I): a group of surfaces with one job. Its design sets the area's frame, its page pattern and the parts
   its pages share, in a short spec and one mockup.
3. A group inside an area (for example C2, the map): surfaces that share more than the area does.
4. A surface: one page, dialog, drawer or state. Its design applies the area's spec, and its plan is written from that.

Each piece follows the same steps: mockup rounds until the owner picks one, a handoff plan, the build, then the catalog
row moves to Built.

Status words: Designed (plan written), Built, Next (the next design round), Open (not started).

## Order of work

| Step | What                                                                              | Why this order                                             |
| ---- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1    | T, the theme spec (Designed, with its shared parts)                               | Gathers the rules D1 proved so every area starts from them |
| 2    | A, the frame (Designed)                                                           | Every surface sits in it                                   |
| 3    | C, the table (frame, C2 to C6 Designed)                                           | Combat first: the surface used most, by everyone           |
| 4    | D, characters (D2, D3 Designed)                                                   | Finishes what D1 started                                   |
| 5    | B, arrival (Designed)                                                             | The first thing a new player sees                          |
| 6    | E, prep (frame, E2, sound and replays Designed)                                   | The GM's weekly work                                       |
| 7    | F, the Codex (Designed: frame, finding, story, people, the Atlas, time and tools) | Read by everyone between sessions                          |
| 8    | G, the Compendium (frame and pages Designed)                                      | GM reference and homebrew                                  |
| 9    | H, the table screen (Designed)                                                    | Few surfaces, already close to the theme                   |
| 10   | I, settings (Designed, with its leftovers)                                        | Used least                                                 |

Every area's frame is designed. The inner rounds run inside those frames. Designed so far: C's groups (C3, running the
encounter; C5, log and dice; C4 with C6, a player in a fight; C2, the map's menus), E2 (maps and tokens) and F's finding
and pages, E3.2 with what H left for later (sound and the screen), F's story and people, the Atlas (F3) with the
Downtime tab, G's pages, E's replays, F's time and tools, and I's leftovers. The consistency sweep then brought every
area's shared parts into line (T rules 13 to 21, over five sweeps). Next: the surfaces settled only by a rule, drawn,
starting with the Compendium's dialogs.

D1, the character sheet, was designed before the hierarchy existed. Its conventions feed the theme step.

## T. Theme: Light Rail / Horizon

Job: one look and one motion language for every surface. Status: Designed (`T-theme/SPEC.md`, `T-theme/PLAN.md`,
ADR-0048), on top of what is Built (ADR-0037, ADR-0045, ADR-0046). The spec settles the section bar (Titled), page
headers (records only), groups (Mixed), the box (Cradle) and secondary controls (Base line), with twenty rules and the
page patterns.

| Id  | Part                        | Where                                                                                                                                                                                                          | Notes                                                                                           |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| T1  | Tokens, themes, type        | `ui/styles/design-tokens.css`, `ui/styles/fonts.css`, `ui/theme/`                                                                                                                                              | Dusk and Dawn; Chakra Petch, Bai Jamjuree, VT323, Bungee for chrome only                        |
| T2  | Light                       | `ui/styles/light-rail.css`, `ui/motion/`                                                                                                                                                                       | Inks, comets, casts, the Cup press                                                              |
| T3  | The kit: actions            | `ui/primitives/Button.tsx` (the Cup, secondary, link, icon)                                                                                                                                                    |                                                                                                 |
| T4  | The kit: fields             | `ui/primitives/forms.tsx`, `NumberField`, `Stepper`, `Slider`, `Switch`, `Combobox`, `TagInput`, `NameField`, `FieldGrid`, `RowEditor`, `Checklist`, `MarkdownEditor`, `DiceInputRow`, `AbilityScoreAllocator` |                                                                                                 |
| T5  | The kit: navigation         | `Tabs`, `StripInk`, `SegmentedControl`, `Steps`, `WizardShell`                                                                                                                                                 | One row of tabs per surface (from D1)                                                           |
| T6  | The kit: overlays           | `Modal`, `Drawer`, `Menu`, `OverlayEdge`, `Toast`, `Tooltip`                                                                                                                                                   |                                                                                                 |
| T7  | The kit: plates and states  | `Panel`, `ChoiceCard`, `ChoiceGrid`, `FeatureList`, `ReviewSummary`, `Alert`, `Skeleton`, `SaveState`, `ui/styles/patterns.css` (`.nh-table`, `.nh-card`, `.nh-empty`)                                         |                                                                                                 |
| T8  | The kit: readouts           | `Badge`, `Chip`, `Tag`, `Lamp`, `LifeBar`, `Meter`, `VcrCounter`, `Roll`, `Kbd`, `QrCode`                                                                                                                      |                                                                                                 |
| T9  | The kit: identity           | `Avatar`, `Portrait`, `avatars/`, `Wordmark`, `icons.tsx`                                                                                                                                                      |                                                                                                 |
| T10 | The kit: audience and lists | `Reveal`, `records/WhoSeesIt`, `FilterFlyout`, `Dropdown`, `SortDialog`                                                                                                                                        |                                                                                                 |
| T11 | Page patterns               | `docs/DESIGN.md` Page patterns                                                                                                                                                                                 | Workbench, record document, list as a table, making as steps, the sheet, settings rows, arrival |

Conventions D1 added to the theme, now in the spec: the vitals band, a rolled number as its own button with no box,
dense rows only with a mouse, colours that keep one meaning.

The consistency sweep (`T-consistency/SPEC.md`, `T-consistency/PLAN.md`, ADR-0072) laid every approved area's side
lists, title rows, menus, phone sheets and dialogs side by side and fixed seven differences in the approved mockups and
specs. Four became rules 13 to 16: one side list, the crumb on the title's line, a menu that names its thing, and one
way a phone sheet opens. A second sweep (ADR-0073) covered section bars, phone headers, primaries, tabs, toolbars,
fields and tags, fixed eleven more, added rules 17 to 19 (a list's toolbar, fields, states and kinds) and amended rules
2, 9, 12, 13 and 14. A third sweep (ADR-0074) covered buttons, rows and the controls in them, empty states, steps,
rolled numbers, boxes, the GM ONLY tag, colours, display titles, widths, dates and overlay edges, fixed twenty more,
added rule 20 (dates, times and a chip's count) and amended 2.2, 2.5 and rules 2, 7, 8, 9, 10 and 11. A fourth sweep
(ADR-0075) checked the mockups as the third left them, in Dusk and Dawn, with eyebrows and notices added, fixed sixteen
more, added rule 21 (one notice) and amended 2.2, 2.4, 2.5 and rules 8, 9, 19 and 20. A fifth sweep (ADR-0076) added
tags, faces, closes, tabs, fields, lamps, cards and the contrast of every line, fixed twenty-five more, gave amber,
magenta and violet words text shades that pass in Dawn, and amended 2.2, 2.4, 2.5 and rules 4, 9 and 19. Status:
Designed; its plan builds each shared part once in the kit.

## A. Frame and wayfinding

Job: get anyone to any surface and tell them what is happening. Status: Designed (`A-frame/SPEC.md`, `A-frame/PLAN.md`,
ADR-0049). The laptop top bar is One menu, a phone has More as its fifth tab and no top bar, search is one Scoped field,
and news stays in the corner, with eleven rules for the frame's other surfaces.

| Id  | Surface                      | Opens at                 | Who        | Files                                                   |
| --- | ---------------------------- | ------------------------ | ---------- | ------------------------------------------------------- |
| A1  | GM top bar                   | always                   | GM         | `shell/AppBar.tsx` (`GmTopBar`), `shell/app-bar.css`    |
| A2  | Player top bar               | always                   | Player     | `shell/AppBar.tsx` (`PlayerTopBar`, `Playing`)          |
| A3  | Phone bottom tabs            | phone                    | GM, player | `shell/AppBar.tsx` (`GmBottomTabs`, `PlayerBottomTabs`) |
| A4  | Prep section bar             | any Prep page            | GM         | `shell/AppBar.tsx` (`PrepFrame`, `PrepBarSlot`)         |
| A5  | Search launcher              | Search icon, Ctrl K      | all        | `shell/SearchLauncher.tsx`                              |
| A6  | Rules reference drawer       | Search, Compendium       | all        | `reference/RulesReference.tsx`                          |
| A7  | Theme switch                 | top bar, landing, Device | all        | `ui/theme/ThemeToggle.tsx`                              |
| A8  | Reconnect bar                | connection drops         | all        | `shell/ReconnectBar.tsx`                                |
| A9  | Toasts                       | after an action          | all        | `ui/primitives/Toast.tsx`, `scene/toasts.tsx`           |
| A10 | Confirm and prompt dialogs   | about 30 actions         | all        | `components/feedback.tsx` (`useConfirm`, `usePrompt`)   |
| A11 | Roll-call row on other pages | GM calls for a roll      | Player     | `encounter/RollCallPrompt.tsx` (`RollCallPrompts`)      |
| A12 | Not found and missing record | unknown address          | all        | `components/NotFoundView.tsx`                           |
| A13 | Error boundary               | a crash                  | all        | `components/AppErrorBoundary.tsx`                       |
| A14 | Loading placeholder          | first load               | all        | `components/lazySurface.tsx`                            |

## B. Arrival

Job: get a person into the right seat. Status: Designed (`B-arrival/SPEC.md`, `B-arrival/PLAN.md`, ADR-0052): the logo
in the sky above a smaller sun, signing in on a card in place of the buttons, the party as a lineup before the sunset,
and the GM's empty table as a lobby.

| Id  | Surface                | Opens at                   | Who    | Files                                                               |
| --- | ---------------------- | -------------------------- | ------ | ------------------------------------------------------------------- |
| B1  | Landing (title screen) | signed out                 | all    | `shell/Landing.tsx`, `shell/landing.css`                            |
| B2  | GM sign-in             | Enter as GM                | GM     | `shell/Landing.tsx`                                                 |
| B3  | Set up the GM password | first run                  | GM     | `shell/Landing.tsx`                                                 |
| B4  | Reset the GM password  | Forgot the password        | GM     | `shell/Landing.tsx` (`ResetSteps`)                                  |
| B5  | Entry animation        | sign-in                    | all    | `shell/Landing.tsx` (`useEntryAnimation`)                           |
| B6  | Pick your character    | unclaimed player, no map   | Player | `actors/ClaimCharacter.tsx`, `actors/claim-character.css`           |
| B7  | Claim panel            | unclaimed player, map live | Player | `actors/ClaimCharacter.tsx` in `shell/TableView.tsx`                |
| B8  | Join the table sheet   | phone strip Join           | GM     | `table/TableStrip.tsx` (`JoinButton`), `components/JoinAddress.tsx` |
| B9  | Builder closed gate    | `/builder` when off        | Player | `shell/LayerView.tsx`                                               |

## C. The table

Job: run and play the encounter. Status: frame Designed (`C-table/SPEC.md`, `C-table/PLAN.md`, ADR-0050): Two docks on a
laptop, the turn order as a Ladder, the turn through Cost tabs and a Switch on phones. Its groups, inside that frame: C2
(the map's menus), C3 (running the encounter, two rounds), C5 (log and dice), and C4 with C6 (a player in a fight)
Designed. The largest area; designed as one frame, then the groups.

### C1. Workbench frame

| Id   | Surface               | Opens at                | Who | Files                                                                   |
| ---- | --------------------- | ----------------------- | --- | ----------------------------------------------------------------------- |
| C1.1 | Table workbench       | `/table`, `/`           | all | `shell/TableView.tsx`, `shell/table-view.css`, `table/scrollPast.ts`    |
| C1.2 | Table strip           | top of the table        | all | `table/TableStrip.tsx`, `table/TurnTiles.tsx`, `table/table-strip.css`  |
| C1.3 | Table panel shell     | beside or under the map | all | `table/TablePanel.tsx`, `table/table-panel.css`, `table/footerSlot.tsx` |
| C1.4 | No map yet            | no live map             | all | `shell/TableView.tsx`                                                   |
| C1.5 | Live encounter picker | top bar or strip        | GM  | `table/LiveScenePicker.tsx`                                             |
| C1.6 | Now Playing           | strip                   | GM  | `sound/NowPlaying.tsx`                                                  |

### C2. The map

Designed (`C2-map-menus/SPEC.md`, `C2-map-menus/PLAN.md`, ADR-0062): a token, a door, the empty map and a drawing open
as A's menu at the thing, how a creature moves sits at the top of the token's menu, and each tool's options are A's menu
from the tool. The map (C2.1) and the tray (C2.4) are C's. Each question in a round offers five options, each built from
settled parts.

| Id   | Surface                   | Opens at                  | Who                     | Files                                                                                                                      |
| ---- | ------------------------- | ------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| C2.1 | Encounter map             | table, encounter page     | all                     | `scene/EncounterMap.tsx`, `scene/MapToken.tsx`, `scene/FogOverlay.tsx`, `scene/VisionLayer.tsx`, `scene/encounter-map.css` |
| C2.2 | Map rail and tool options | beside the map            | all                     | `scene/MapRail.tsx`, `scene/MapToolGroups.tsx`, `scene/map-rail.css`                                                       |
| C2.3 | Shape inspector           | select a drawing          | all                     | `scene/ShapeEditor.tsx`                                                                                                    |
| C2.4 | Staging tray              | tokens not placed         | GM                      | `scene/MapTokenTray.tsx`                                                                                                   |
| C2.5 | Token menu                | right-click or long press | GM; player on own token | `scene/TokenContextMenu.tsx`, `scene/token-menu.css`                                                                       |
| C2.6 | Door menu                 | press a door              | all                     | `scene/DoorMenu.tsx`                                                                                                       |
| C2.7 | Map spot menu             | right-click empty map     | GM                      | `scene/MapSpotMenu.tsx`                                                                                                    |

### C3. Running the encounter (GM)

First round Designed (`C3-gm-panel/SPEC.md`, `C3-gm-panel/PLAN.md`, ADR-0058): the waiting list over the turn or in its
own tab (the GM's switch), cards, the panel's tabs with unread counts, and a bell in place of the words Needs you,
everywhere. Second round Designed (`C3-running/SPEC.md`, `C3-running/PLAN.md`, ADR-0059): one form to start, a
creature's tools under its row, the options as a menu on the panel's tabs, Add monsters as the Compendium's panes, and
the roll as the button in waiting cards. The Notes and Party tabs follow F and D.

| Id    | Surface                      | Opens at                 | Who        | Files                                                                                                                                                   |
| ----- | ---------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3.1  | GM panel tabs                | panel                    | GM         | `encounter/GmEncounterPanel.tsx`                                                                                                                        |
| C3.2  | Needs you                    | top of Encounter         | GM         | `table/NeedsYou.tsx`                                                                                                                                    |
| C3.3  | Start the encounter          | Encounter, no fight      | GM         | `encounter/StartFight.tsx`, `scenes/ScenePrepPanel.tsx`, `encounter/EncounterBudget.tsx`                                                                |
| C3.4  | Acting console               | Encounter, in a fight    | GM         | `encounter/ActingConsole.tsx`, `encounter/ActingCard.tsx`, `encounter/ActionRunner.tsx`, `encounter/GmActionList.tsx`, `encounter/ActionResultCard.tsx` |
| C3.5  | Turn order and tools         | Encounter or Order tab   | GM         | `encounter/GmInitiativeRow.tsx`, `encounter/ConfirmRow.tsx`, `encounter/SpellAreas.tsx`                                                                 |
| C3.6  | Row tools                    | expand a row             | GM         | `encounter/RowTools.tsx`, `encounter/HpAdjust.tsx`, `encounter/EffectChips.tsx`                                                                         |
| C3.7  | Encounter options menu       | strip end                | GM         | `encounter/FightMenu.tsx`                                                                                                                               |
| C3.8  | Add monsters                 | options menu, prep panel | GM         | `encounter/MonsterBrowser.tsx`, `encounter/StatBlock.tsx`                                                                                               |
| C3.9  | Notes tab (Tonight, Codex)   | panel                    | GM         | `table/NotesTab.tsx`, `table/TonightTab.tsx`, `table/CodexTab.tsx`                                                                                      |
| C3.10 | Token tab                    | press a token            | GM         | `table/TokenTab.tsx`                                                                                                                                    |
| C3.11 | Party tab and Rest the party | panel                    | GM, player | `actors/PartyStrip.tsx`, `rest/PartyRest.tsx`, `rest/LongRestUnderWay.tsx`                                                                              |
| C3.12 | Inline prompt cards          | queue                    | GM         | `encounter/PendingDamagePrompt.tsx`, `encounter/DamageRollPrompt.tsx`, `encounter/RuleAsk.tsx`, `encounter/WaitNote.tsx`                                |

### C4. Playing a character (player)

Designed with C6 (`C4-C6-player/SPEC.md`, `C4-C6-player/PLAN.md`, ADR-0061): a prompt on glass over the map, its eyebrow
naming only its kind, a reaction's answer as its roll row, and the death saves as lamps. C4.1 and C4.2 are C's; C4.4 and
C4.5 stay as they are, and C4.6 is Designed with replays (`E3-replays/SPEC.md` 2.5). Each question in a round offers
five options, each built from settled parts.

| Id   | Surface                | Opens at             | Who    | Files                                                                                                                                                                              |
| ---- | ---------------------- | -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C4.1 | Player panel tabs      | panel                | Player | `encounter/PlayerEncounterPanel.tsx`                                                                                                                                               |
| C4.2 | Turn tab and turn card | in a fight           | Player | `encounter/PlayerTurnCard.tsx`, `encounter/PlayerActionRunner.tsx`, `sheet/TurnCard.tsx`, `encounter/CommandedCreatures.tsx`                                                       |
| C4.3 | Prompt slot            | something owed       | Player | `table/PromptSlot.tsx`, `encounter/ReactionPrompt.tsx`, `encounter/SavePrompt.tsx`, `encounter/InitiativePrompt.tsx`, `encounter/DyingTracker.tsx`, `encounter/RollCallPrompt.tsx` |
| C4.4 | Rest prompt            | a party rest         | Player | `rest/RestPrompt.tsx`                                                                                                                                                              |
| C4.5 | Phone identity header  | phone, Table and Log | Player | `table/PlayerIdentity.tsx`                                                                                                                                                         |
| C4.6 | Replay shelf           | under the sheet      | Player | `replay/ReplayShelf.tsx`                                                                                                                                                           |

### C5. Log and dice

Designed (`C5-log-dice/SPEC.md`, `C5-log-dice/PLAN.md`, ADR-0060): the log one line each with a roll opening to its
card, the composer led by who hears it, the dice options as a sheet over the panel, and calls for a roll from the
waiting list. Each question in a round offers five options, each built from settled parts.

| Id   | Surface          | Opens at        | Who | Files                                               |
| ---- | ---------------- | --------------- | --- | --------------------------------------------------- |
| C5.1 | Log and composer | Log tab         | all | `encounter/CombatLog.tsx`, `table/LogComposer.tsx`  |
| C5.2 | Dice panel       | composer, sheet | all | `dice/DicePanel.tsx`, `dice/dice-panel.css`         |
| C5.3 | Call for a roll  | GM dice panel   | GM  | `dice/RollCallPanel.tsx`, `dice/CallSituations.tsx` |

### C6. Encounter dialogs

Designed with C4 (`C4-C6-player/SPEC.md`, ADR-0061): what a cast or a feature asks opens under its row, and so does the
spell card. Add equipment's catalogue keeps A's dialog; C6.8, the token picker, is Designed with E2
(`E2-maps-tokens/SPEC.md`, ADR-0063).

| Id   | Surface                                       | Opens at                            | Who | Files                                                          |
| ---- | --------------------------------------------- | ----------------------------------- | --- | -------------------------------------------------------------- |
| C6.1 | Heal: who                                     | a heal outside a fight              | all | `encounter/HealTargetPicker.tsx`                               |
| C6.2 | Shape-shift                                   | Wild Shape, Polymorph               | all | `encounter/ShapeShiftDialog.tsx`, `encounter/ShapeChoices.tsx` |
| C6.3 | Ready                                         | the Ready action                    | all | `encounter/ReadyChooser.tsx`                                   |
| C6.4 | Spell pick                                    | a feature that casts a picked spell | all | `encounter/SpellPickChooser.tsx`                               |
| C6.5 | Spell swap                                    | Spells tab                          | all | `encounter/SpellChoiceModals.tsx`                              |
| C6.6 | Spell card                                    | a spell name                        | all | `encounter/spells.tsx`, `encounter/spell-card.css`             |
| C6.7 | Add equipment, choose an item's form or spell | Gear tab                            | all | `encounter/equipment.tsx`                                      |
| C6.8 | Token image picker                            | token menu, sheet, Tokens           | all | `tokens/TokenLibrary.tsx`                                      |

## D. Characters

Job: who you play, from making them to looking them up. Status: D1 Designed; D2 and D3 Designed (`D-characters/SPEC.md`,
`D-characters/PLAN.md`, ADR-0051): the roster as bands, the builder's steps and detail, levelling in a dialog and a
party member as a band.

### D1. The character sheet: Designed (`D1-character-sheet/PLAN.md`, ADR-0047; boxes and controls per T)

| Id   | Surface                               | Opens at                 | Who    | Files                                                                                             |
| ---- | ------------------------------------- | ------------------------ | ------ | ------------------------------------------------------------------------------------------------- |
| D1.1 | Sheet page                            | `/me`, `/characters/:id` | all    | `sheet/CharacterSheet.tsx`, `sheet/sheet.css`, `actors/MyCharacter.tsx`, `shell/LayerView.tsx`    |
| D1.2 | Sheet window                          | `sheet.html`             | Player | `sheet-main.tsx`                                                                                  |
| D1.3 | Sheet in the Table panel              | Me, Sheet tabs           | Player | `encounter/PlayerEncounterPanel.tsx`                                                              |
| D1.4 | Sheet dialog and floating sheet       | rows, cards, token menu  | all    | `sheet/CharacterSheet.tsx` (`Modal`, `FloatingSheet`)                                             |
| D1.5 | Sheet menu, Roll settings, Edit names | sheet menu               | all    | `sheet/SheetMenu.tsx`, `sheet/IdentityEditor.tsx`                                                 |
| D1.6 | Hit Points and Dice log sheets        | the band                 | all    | `sheet/CharacterSheet.tsx`, `sheet/HitPoints.tsx`                                                 |
| D1.7 | Detail: cast, item, copy a spell      | a row                    | all    | `sheet/SheetDetail.tsx`, `sheet/CastDetail.tsx`, `sheet/ItemCard.tsx`, `sheet/SpellbookPanel.tsx` |
| D1.8 | Start a project                       | Gear, crafting           | all    | `crafting/SheetCrafting.tsx`                                                                      |

### D2. The party

| Id   | Surface                                   | Opens at             | Who        | Files                                                      |
| ---- | ----------------------------------------- | -------------------- | ---------- | ---------------------------------------------------------- |
| D2.1 | Roster (Prep, Party)                      | `/roster`            | GM         | `actors/PartyRosterTab.tsx`, `actors/party-roster.css`     |
| D2.2 | Import preview                            | roster               | GM         | `actors/PartyRosterTab.tsx` (`ImportPreview`)              |
| D2.3 | Import a D&D Beyond PDF                   | roster, claim screen | GM, player | `actors/PdfImportModal.tsx`, `actors/pdf-import.css`       |
| D2.4 | My character, nothing claimed             | `/me`                | Player     | `actors/MyCharacter.tsx`                                   |
| D2.5 | The rest of the party, party member sheet | sheet menu           | Player     | `actors/MyCharacter.tsx` (`PartyList`, `PartyMemberSheet`) |
| D2.6 | Release confirm                           | sheet menu           | Player     | `actors/MyCharacter.tsx` (`useReleaseCharacter`)           |

### D3. Making and levelling

| Id   | Surface                  | Opens at                | Who                   | Files                                                                                                                                              |
| ---- | ------------------------ | ----------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| D3.1 | Character builder        | `/builder`              | GM; player if allowed | `builder/CharacterBuilder.tsx`, `builder/AbilitiesStep.tsx`, `builder/OfferPickers.tsx`, `builder/StepDetail.tsx`, `builder/character-builder.css` |
| D3.2 | Level flow and its gates | `/characters/:id/level` | GM; player if allowed | `builder/LevelFlow.tsx`, `builder/LevelStep.tsx`                                                                                                   |
| D3.3 | Roll a random character  | roster, My character    | GM; player if allowed | `builder/RandomCharacter.tsx`                                                                                                                      |

## E. Prep

Job: get a session ready before anyone arrives. Status: frame Designed (`E-prep/SPEC.md`, `E-prep/PLAN.md`, ADR-0053): a
shelf of encounter cards, an encounter's page on the table's workbench, a new encounter's page with its checklist, and
the map's grid steps. Maps and tokens Designed (`E2-maps-tokens/SPEC.md`, `E2-maps-tokens/PLAN.md`, ADR-0063): folders
at the side, a map beside its folder's list, filing by a map's menu and Choose, the Tokens page in Party, Monsters and
the GM's own groups, and the token picker with folders and a preview. The sound board (ADR-0065) and replays (ADR-0069)
Designed in their own rounds.

### E1. Encounters

| Id   | Surface                  | Opens at                          | Who | Files                                                                                                          |
| ---- | ------------------------ | --------------------------------- | --- | -------------------------------------------------------------------------------------------------------------- |
| E1.1 | Prep front page          | `/encounters`                     | GM  | `scenes/ScenesShell.tsx`, `scenes/scenes.css`                                                                  |
| E1.2 | Encounter list           | `/encounters`, `/encounters/list` | GM  | `scenes/SceneList.tsx`, `scenes/SceneListToolbar.tsx`, `scenes/listTools.tsx`                                  |
| E1.3 | Encounter page           | `/encounters/:id`                 | GM  | `scenes/SceneDocument.tsx`, `scenes/SceneEncounterTab.tsx`, `scenes/ScenePreview.tsx`, `scenes/scene-page.css` |
| E1.4 | Encounter editor         | `/encounters/new`, `?step=`       | GM  | `scenes/SceneEditor.tsx`, `scenes/EditorFrame.tsx`, `scenes/StagingTray.tsx`                                   |
| E1.5 | Encounters drawer        | editor, list                      | GM  | `scenes/pieces.tsx` (`SceneListFlyout`)                                                                        |
| E1.6 | Encounter action dialogs | row menu                          | GM  | `scenes/sceneActions.tsx`                                                                                      |

### E2. Maps

E2.1 and E2.2 Designed (`E2-maps-tokens/SPEC.md`, ADR-0063); E2.3 is E's Steps; E2.4 waits for F3.

| Id   | Surface                         | Opens at                         | Who | Files                                                                     |
| ---- | ------------------------------- | -------------------------------- | --- | ------------------------------------------------------------------------- |
| E2.1 | Map list                        | `/encounters/maps`               | GM  | `maps/MapList.tsx`, `maps/MapListToolbar.tsx`                             |
| E2.2 | Map page                        | `/encounters/maps/:id`           | GM  | `maps/MapDocument.tsx`, `maps/mapActions.tsx`                             |
| E2.3 | Map editor and grid calibration | `/encounters/maps/new`, `?step=` | GM  | `maps/MapEditor.tsx`, `maps/CalibrationSteps.tsx`, `maps/calibration.css` |
| E2.4 | Map picker                      | encounter steps, Atlas           | GM  | `maps/MapPicker.tsx`                                                      |

### E3. Tokens, sound and replays

E3.1 Designed with E2 (`E2-maps-tokens/SPEC.md`, ADR-0063), with the token picker (C6.8). E3.2 Designed
(`E3-sound-screen/SPEC.md`, `E3-sound-screen/PLAN.md`, ADR-0065): the sound board as kinds at the side under one Playing
bar with a scrubber, kind chips, and each encounter's sound on its page. E3.3 to E3.5 Designed with C4.6
(`E3-replays/SPEC.md`, `E3-replays/PLAN.md`, ADR-0069): the list as a table with the chosen replay beside it, the whole
fight beside the map, a line of rounds with Launch at its end, and a player's replays as cards under the sheet.

| Id   | Surface         | Opens at                 | Who        | Files                                                                                                     |
| ---- | --------------- | ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------- |
| E3.1 | Tokens page     | `/prep/tokens`           | GM         | `tokens/TokensPage.tsx`, `tokens/tokens-page.css`                                                         |
| E3.2 | Sound board     | `/viewer-controls/sound` | GM         | `sound/SoundBoard.tsx`, `sound/SoundLibraryPanel.tsx`, `sound/SoundSections.tsx`, `sound/sound-board.css` |
| E3.3 | Replays list    | `/replays`               | GM, player | `replay/ReplayList.tsx`, `replay/replay.css`                                                              |
| E3.4 | Replay viewer   | `/replays/:id`           | GM, player | `replay/ReplayViewer.tsx`, `replay/ReplayStage.tsx`                                                       |
| E3.5 | Rename a replay | list menu                | GM         | `replay/ReplayList.tsx` (`RenameReplay`)                                                                  |

## F. The Codex

Job: the campaign's memory, written by the GM and read by everyone. Status: frame Designed (`F-codex/SPEC.md`,
`F-codex/PLAN.md`, ADR-0054): the Titled bar, the dashboard home, wiki pages, writing in place with a Preview switch,
and the story's Chronicle, Timeline and Sessions tabs each with its own design. F1.3 to F1.5, F2.1, F2.5, F2.6 and F2.8
Designed (`F-finding-pages/SPEC.md`, `F-finding-pages/PLAN.md`, ADR-0064): search as panes, the pages index with the
kinds, folders and tags at the side, a page's tag, reveal and versions in its side column, and one search dialog for the
palette and the picker. F4.5, F4.7 (where it sits) and F5.1 to F5.3 Designed (`F-story-people/SPEC.md`,
`F-story-people/PLAN.md`, ADR-0066): quests by status at the side, relationships as a ring on glass, a faction's
standing in its page's side column, the composer at the head of the line, and a Downtime tab. F3.1 to F3.3 and the
Downtime tab's contents Designed (`F3-atlas/SPEC.md`, `F3-atlas/PLAN.md`, ADR-0067): the maps as a tree at the side, the
pins at the right with a pin's page and menu, the pin editor in tabs, and the Downtime tab's characters at the side.
F4.4, F4.6 and F6.1 to F6.4 Designed (`F-time-tools/SPEC.md`, `F-time-tools/PLAN.md`, ADR-0070): prep templates as one
page with the kinds at the side, Plan session on the Sessions tab, a calendar page, a record in the side column, and the
Codex's tools in Settings.

### F1. Frame and finding

| Id   | Surface         | Opens at           | Who        | Files                                                                                                                        |
| ---- | --------------- | ------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| F1.1 | Codex frame     | `/codex...`        | GM, player | `codex/CodexShell.tsx`, `codex/PlayerCodex.tsx`, `codex/shell/CodexFrame.tsx`, `codex/shell/PhoneBar.tsx`, `codex/codex.css` |
| F1.2 | Home            | `/codex`           | GM, player | `codex/home/HomeView.tsx`                                                                                                    |
| F1.3 | Search          | `/codex/search`    | GM, player | `codex/search/SearchView.tsx`, `codex/SearchResults.tsx`                                                                     |
| F1.4 | Command palette | search box, Ctrl K | GM, player | `codex/CommandPalette.tsx`                                                                                                   |
| F1.5 | Tag             | `/codex/tags/:tag` | GM, player | `codex/TagView.tsx`                                                                                                          |

### F2. Pages

| Id   | Surface          | Opens at               | Who        | Files                                                                                                                                   |
| ---- | ---------------- | ---------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| F2.1 | Pages index      | `/codex/pages`         | GM, player | `codex/page/PagesIndex.tsx`                                                                                                             |
| F2.2 | Page             | `/codex/pages/:id`     | GM, player | `codex/page/GmPage.tsx`, `codex/page/PlayerPage.tsx`, `codex/page/MetaPanel.tsx`, `codex/shared/HiddenBlock.tsx`, `codex/page/page.css` |
| F2.3 | Page writer      | `?mode=edit`           | GM         | `codex/page/PageWriter.tsx`, `codex/page/DocEditor.tsx`, `codex/page/RelationshipEditor.tsx`                                            |
| F2.4 | New page         | New menu               | GM         | `codex/QuickCreate.tsx`                                                                                                                 |
| F2.5 | Reveal           | a page, quest, Tonight | GM         | `codex/shared/RevealPanel.tsx`                                                                                                          |
| F2.6 | Version history  | a page                 | GM         | `codex/RevisionHistory.tsx`                                                                                                             |
| F2.7 | What players see | GM menu                | GM         | `codex/CodexShell.tsx`                                                                                                                  |
| F2.8 | Page picker      | link fields            | GM         | `codex/shared/PagePicker.tsx`                                                                                                           |

### F3. Places

| Id   | Surface             | Opens at       | Who        | Files                                                                                                                                         |
| ---- | ------------------- | -------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F3.1 | Atlas               | `/codex/atlas` | GM, player | `codex/atlas/AtlasView.tsx`, `codex/atlas/AtlasMap.tsx`, `codex/atlas/AtlasPanel.tsx`, `codex/atlas/PlayerAtlas.tsx`, `codex/atlas/atlas.css` |
| F3.2 | Pin view and editor | a pin          | GM, player | `codex/atlas/PinView.tsx`, `codex/atlas/PinEditor.tsx`                                                                                        |
| F3.3 | Add a map           | Atlas          | GM         | `codex/atlas/MapDetails.tsx`                                                                                                                  |

### F4. Time and story

| Id   | Surface                   | Opens at          | Who        | Files                                                                                                                 |
| ---- | ------------------------- | ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| F4.1 | Story (Chronicle)         | `/codex/story`    | GM, player | `codex/story/sections.tsx`, `codex/story/Chronicle.tsx`, `codex/story/EntryCard.tsx`, `codex/story/story.css`         |
| F4.2 | Timeline                  | `/codex/timeline` | GM, player | `codex/story/Timeline.tsx`                                                                                            |
| F4.3 | Sessions and session page | `/codex/sessions` | GM, player | `codex/story/Sessions.tsx`, `codex/story/SessionPage.tsx`, `codex/story/PrepEditor.tsx`, `codex/story/PrepReader.tsx` |
| F4.4 | Calendar and your date    | date bar          | GM         | `codex/CalendarEditor.tsx`, `codex/shared/DateBar.tsx`                                                                |
| F4.5 | Add to the chronicle      | Story             | GM         | `codex/story/EntryComposer.tsx`                                                                                       |
| F4.6 | Record dialog             | a timeline record | GM, player | `codex/story/sections.tsx` (`RecordDialog`)                                                                           |
| F4.7 | Downtime and clocks       | Story             | GM, player | `codex/story/Downtime.tsx`                                                                                            |

### F5. People and quests

| Id   | Surface                 | Opens at               | Who        | Files                                                                                    |
| ---- | ----------------------- | ---------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| F5.1 | Quests                  | `/codex/quests`        | GM, player | `codex/quests/QuestsView.tsx`, `codex/quests/QuestWriter.tsx`, `codex/quests/quests.css` |
| F5.2 | Relationships           | `/codex/relationships` | GM, player | `codex/relationships/RelationshipsView.tsx`, `codex/relationships/relationships.css`     |
| F5.3 | Standing with a faction | Factions grid          | GM         | `codex/StandingAdjuster.tsx`                                                             |

### F6. Codex tools

| Id   | Surface                 | Opens at            | Who        | Files                                                                     |
| ---- | ----------------------- | ------------------- | ---------- | ------------------------------------------------------------------------- |
| F6.1 | Prep templates          | `/codex/templates`  | GM         | `codex/templates/TemplatesView.tsx`, `codex/templates/TemplateEditor.tsx` |
| F6.2 | Backup and restore      | `/codex/backup`     | GM         | `codex/BackupView.tsx`                                                    |
| F6.3 | Autosave and history    | `/codex/settings`   | GM         | `codex/CodexSettings.tsx`                                                 |
| F6.4 | Codex Compendium reader | `/codex/compendium` | GM, player | `compendium/player/CodexCompendium.tsx`, `compendium/CompendiumCard.tsx`  |

## G. The Compendium

Job: the rules content, SRD and homebrew, and who sees it. Status: frame Designed (`G-compendium/SPEC.md`,
`G-compendium/PLAN.md`, ADR-0055): the Titled bar, a home of shelves, browsing and records as three panes (filters,
results and the record, with the open records as tabs), and the studio with each step's answer in its rail. G4 to G6
Designed (`G-compendium-pages/SPEC.md`, `G-compendium-pages/PLAN.md`, ADR-0068): the sources and Sharing's kinds at the
side, a record's history as compact rows and its sharing in the side column, and merging as A's dialog. Its rules settle
search's dialog (G9), the catalog picker (G11) and the other kinds' editors (G7).

| Id  | Surface                                        | Opens at                  | Who | Files                                                                                                                                                                                                       |
| --- | ---------------------------------------------- | ------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Compendium frame                               | `/compendium...`          | GM  | `compendium/CompendiumShell.tsx`, `compendium/compendium.css`                                                                                                                                               |
| G2  | Browse tables                                  | `/compendium/tables`      | GM  | `compendium/TablesView.tsx`, `compendium/CompendiumTable.tsx`, `compendium/kinds.tsx`                                                                                                                       |
| G3  | Homebrew overview                              | `/compendium`             | GM  | `compendium/OverviewView.tsx`                                                                                                                                                                               |
| G4  | Sources and export                             | `/compendium/sources`     | GM  | `compendium/SourcesView.tsx`                                                                                                                                                                                |
| G5  | Sharing                                        | `/compendium/sharing`     | GM  | `compendium/SharingView.tsx`                                                                                                                                                                                |
| G6  | Record: card, sharing, history, compare, merge | `/compendium/<kind>/<id>` | GM  | `compendium/record/RecordView.tsx`, `compendium/record/CardTab.tsx`, `compendium/record/SharingTab.tsx`, `compendium/record/HistoryTab.tsx`, `compendium/record/Compare.tsx`, `compendium/record/Merge.tsx` |
| G7  | Edit studio and homebrew wizards               | `?tab=edit`               | GM  | `compendium/record/Studio.tsx`, `homebrew/wizard/`, `homebrew/FieldRenderer.tsx`, `homebrew/homebrew.css`                                                                                                   |
| G8  | New homebrew                                   | New                       | GM  | `compendium/NewRecordDialog.tsx`                                                                                                                                                                            |
| G9  | Search the SRD and homebrew                    | Ctrl K                    | GM  | `compendium/SearchDialog.tsx`                                                                                                                                                                               |
| G10 | Add a monster to an encounter                  | a monster record          | GM  | `compendium/record/AddToScene.tsx`                                                                                                                                                                          |
| G11 | Catalog picker                                 | homebrew fields           | GM  | `homebrew/CatalogPicker.tsx`                                                                                                                                                                                |

## H. The table screen

Job: what the room sees on the TV, and the GM's controls for it. Status: Designed (`H-table-screen/SPEC.md`,
`H-table-screen/PLAN.md`, ADR-0056): the turn ladder on the TV, the horizon line for pairing and waiting, the GM's
screens as cards that open as remotes, and the preview as a picture in picture. The sound page, the scenes' See as:
screen and Settings' table screen row Designed with E3.2 (`E3-sound-screen/SPEC.md`, ADR-0065).

| Id  | Surface                                     | Opens at                 | Who | Files                                                                                  |
| --- | ------------------------------------------- | ------------------------ | --- | -------------------------------------------------------------------------------------- |
| H1  | Pair this screen                            | viewer, unpaired         | TV  | `viewer/ScreenPairing.tsx`                                                             |
| H2  | Waiting states (connecting, paused, no map) | viewer                   | TV  | `viewer/ViewerApp.tsx`                                                                 |
| H3  | Live screen                                 | presenting               | TV  | `viewer/ViewerApp.tsx`, `viewer/ScreenParts.tsx`, `viewer/screen-parts.css`            |
| H4  | Turn on sound                               | autoplay blocked         | TV  | `viewer/TableSound.tsx`                                                                |
| H5  | Table screen controls (was Shared screen)   | `/viewer-controls`       | GM  | `viewer/ViewerControls.tsx`, `viewer/PairScreenForm.tsx`, `viewer/viewer-controls.css` |
| H6  | Table screen lamp menu                      | top bar                  | GM  | `table/TvControl.tsx`                                                                  |
| H7  | Table screen preview                        | lamp menu, Shared screen | GM  | `viewer/ViewerPreviewPanel.tsx`                                                        |

## I. Settings

Job: set the table up once and change it rarely. Status: Designed (`I-settings/SPEC.md`, `I-settings/PLAN.md`,
ADR-0057): a side list of the sections with a line of what each holds now, rows with their control at the right, the
encounter rules grouped by moment, and Access with its rows and the credentials' table. F's time and tools add a Codex
group to its side list (ADR-0070). I1, I2, I6 and I7 Designed (`I-settings-leftovers/SPEC.md`,
`I-settings-leftovers/PLAN.md`, ADR-0071): the side list drawn as the settled one, the API reference as grouped rows
with each operation's command, an operation's two sides, buttons at the table, and a credential's page.

| Id  | Surface                     | Opens at               | Who        | Files                                                                                                          |
| --- | --------------------------- | ---------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| I1  | Settings frame and search   | `/settings`            | GM, player | `settings/SettingsPage.tsx`, `settings/SettingRow.tsx`, `settings/SettingsSearch.tsx`, `settings/settings.css` |
| I2  | Players                     | `/settings/players`    | GM         | `settings/PlayersSection.tsx`                                                                                  |
| I3  | Encounters                  | `/settings/fights`     | GM         | `settings/FightsSection.tsx`                                                                                   |
| I4  | Characters                  | `/settings/characters` | GM         | `settings/CharactersSection.tsx`                                                                               |
| I5  | Device                      | `/settings/device`     | GM, player | `settings/DeviceSection.tsx`                                                                                   |
| I6  | Access and credentials      | `/settings/access`     | GM         | `settings/AccessSection.tsx`, `integrations/CredentialsTable.tsx`                                              |
| I7  | API reference and operation | `/settings/api`        | GM         | `integrations/ApiReference.tsx`, `integrations/OperationDocument.tsx`                                          |

## Notes from the survey

- No floating dice overlay or turn banner exists; rolls land on their cards and the turn shows on tiles, the turn card
  and the TV's Acting now card.
- `sheet/SheetTabBar` and its `.cs-tabbar*` rules are dead code (removed in D1).
- `docs/adr/README.md` repeats rows 027 to 037 (fixed in D1, phase L0).
- `docs/DESIGN.md`'s character sheet section is already stale (rewritten in D1, phase L7).
