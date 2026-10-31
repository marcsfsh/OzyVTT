# D. Characters: the roster, making, levelling and the party

Approved by the owner on 2026-10-29 in one round of mockups. Area D in `../CATALOG.md` is who you play, from making them
to looking them up. The sheet itself is D1, the Ledger (`../D1-character-sheet/`). This spec covers D2 (the party) and
D3 (making and levelling). It inherits the theme (`../T-theme/SPEC.md`) and the frame (`../A-frame/SPEC.md`). `PLAN.md`
beside this file is the work to build it; `characters.html` is the approved mockup, and `history/` holds round 1 as it
was shown.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) gave Level up and a party member on a phone the handle, the
title and a close (2.3, 2.4).

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) set the roster's names in Bai Jamjuree 600 (T rule 10),
gave the builder's and Level up's rails Prep's marks and cyan edge (T rule 4), drew Poisoned red as a harmful condition
(T rule 9), named the builder's head action Done, and drew every phone control at 44 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew Level up's marks as their 20 px boxes (its step
rule had reached them; T rule 4), its choice at 44 px on a phone, the builder's class facts in the eyebrow (T 2.4), and
the Sample tag in the dim text colour as a state (T rule 19).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the Steps marks at 24 px with their numbers in
VT323 17 px (T rule 4), the tabs at 44 px (T rule 1) and the tags at 16 px in their 22 px box (T rule 7), and gave
Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id               | Surface                                                          | Decided here                  |
| ---------------- | ---------------------------------------------------------------- | ----------------------------- |
| D2.1             | The roster (Prep, Party)                                         | Bands (2.1)                   |
| D2.2, D2.3, D3.3 | Import preview, Import a D&D Beyond PDF, Roll a random character | Rules 3.1 and 3.7             |
| D2.4             | My character with nothing claimed                                | Rule 3.8                      |
| D2.5             | A party member as another player sees them                       | Band (2.4)                    |
| D2.6             | The release confirmation                                         | A's Dialog pattern (A rule 6) |
| D3.1             | The character builder                                            | Steps and detail (2.2)        |
| D3.2             | Levelling up or down                                             | Dialog (2.3)                  |

## 2. The decisions

### 2.1 The roster is Bands

- Prep's Titled bar (T 2.1) names the page; New character is its primary (rule 3.1). The page starts with its content:
  the sample line (rule 3.3), a toolbar (how many characters at the left; Roll a random character and Import at the
  right), then one band per character, then the archived group (rule 3.5).
- Each character is a band, drawn as the Ledger sheet's vitals band in a Cradle (it takes input), stacked 12 px apart:
  - Identity: the face (64 px), the name in Chakra Petch 600 capitals at 18 px, the class line (class and level,
    species, background) at 13 px, then tags: Sample, and any condition with its tone.
  - The plate: AC, Hit points (current and maximum, gold), Speed and Passive Perception, each a label over a VT323
    value, divided by 1 px `--line`.
  - The end: who plays (rule 3.4) over the actions: Open sheet and Level up as Base line buttons, and a More menu
    (Played at the table, Release, Archive, Delete).
- On a phone the band stacks: identity, then the plate (AC, Hit points, Speed), then who plays and Open sheet with the
  More menu.

### 2.2 Making a character keeps Steps and detail

- Today's builder, drawn to the theme: a record page whose title row says "Create a character" and the step ("Step 3 of
  7 · Class and level"), with Done as a Base line control at its right.
- Three columns: the Steps rail (240 px; T rule 4: done is a cyan check, current a cyan outline with the ink at its
  left, a step that needs a choice an amber mark; each done step shows its answer under its name), the question (its
  heading in the eyebrow style, then the choices as Base line tiles in a grid, the chosen one with a 2 px cyan line and
  a tick), and the chosen option's detail (360 px: its name in Chakra Petch, a sentence, its facts as a definition list,
  and what it brings at level 1).
- The foot: Back as a ghost, the step's own small choice (Level 1), and Next with the next step's name as the Cup. What
  still blocks Next is said in amber beside it, as today.
- On a phone: the header row (A) with Close, a progress line under it ("Step 3 of 7 · Class and level" with the answer
  so far at the right and a line of seven marks), the choices in one column with the chosen one opening to show its
  detail, and the foot pinned with Back and Next.

### 2.3 Levelling up is a Dialog

- Opened from the sheet's menu (Level up or down) and the roster's Level up, over the sheet, which stays behind it.
- The dialog (620 px; the Dialog pattern: its title on the horizon edge, "Level 8 for Borin") has the level's own steps
  along its top as a short row: Hit points, then one step for each choice the level brings (an Ability Score
  Improvement, a subclass, spells, a new class), then Review. Each step uses the Steps marks (done, current, needs a
  choice). Levels that bring no choice have two steps: Hit points and Review.
- Hit points: Take the average or Roll the Hit Point Die, as a segmented control, and the change shown as "67 to 76, 6
  plus 3 for Constitution".
- An Ability Score Improvement: Raise ability scores or Take a feat as a segmented control; the six scores as Base line
  cells, the chosen ones on the cyan line with their new value and +2 or +1; a feat as a list of rows.
- Review: what changes (hit points, scores, features gained, Proficiency Bonus), then Apply level 8 as the Cup.
- Up or down: the dialog opens on the next level up. Its More menu holds Level down to 6 (with today's note on what is
  kept), and Take a new class for a multiclass level goes in the first step when the rules allow one.
- On a phone the dialog is a sheet from the bottom: the handle, then the name with its steps as "2 of 3" and the close,
  the foot pinned.

### 2.4 A party member opens as a Band

- From the sheet's menu (The rest of the party) a player picks a member; the member opens in a dialog drawn as the
  Ledger's band. On a phone it is a sheet from the bottom: the handle, the member's head with the close at its right.
- The dialog shows only what the projection sends another player (rule 3.9): the face, the name (the dialog's title),
  the class line, any conditions as tags; the plate of AC, Hit points as given (exact or the health band's word) and
  Speed; the six abilities in a row (modifier over score); then, where the GM allows resources, Hit Point Dice and spell
  slots on one line.
- Groups in it are open (they are only read, T 2.3); the dialog is the only box.

## 3. Rules for characters

1. One primary in the bar: New character is the Cup at the end of Prep's bar on the Party page. Roll a random character
   and Import (a D&D Beyond PDF, a JSON file) are Base line controls in the roster's toolbar; Import is a menu of the
   two.
2. The join address leaves the roster. Players join from the table's Encounter tab before a fight and from the menu's
   Who is here (A).
3. Samples are a line: one description line names the sample characters, with Remove sample characters on a Base line;
   each sample carries a Sample tag.
4. Who plays: each character shows who plays them with a lamp: on a player's device (cyan), at the table (gold) or open
   to claim (unlit). Played at the table, releasing a claim and archiving move into the character's More menu.
5. Archived characters are one closed open group at the end ("Archived · 1"), hidden from players as now.
6. Steps are the theme's (T rule 4) in the builder and in the level dialog.
7. Roll a random character, Import and the import preview are Dialogs (A rule 6): the title on the horizon edge, the
   content, Cancel as a ghost and the Cup at the right; a sheet from the bottom on a phone.
8. A player with no character sees T rule 3's empty state on Sheet: "You aren't playing anyone yet." and a Pick a
   character button.
9. Only what the party may see: a party member shows the class line, hit points as the projection gives them, AC, Speed,
   abilities, conditions, and hit dice and spell slots where the GM allows. Never skills, spells, gear or notes.
10. Words from the rules: Level 1, Hit Point Die, Ability Score Improvement, Proficiency Bonus, Short Rest (SRD 5.2.1).

## 4. Values

| Part                | Value                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Band                | Cradle; 10 px 14 px 12 px padding; 12 px between bands; face 64 px; name Bai Jamjuree 600 16 px; class line 13 px               |
| Band plate          | Cells 2 px 14 px, divided by 1 px `--line`; label in the eyebrow style; value VT323 26 px (hit points gold)                     |
| Who plays           | Lamp 8 px; 13 px `--text-dim`                                                                                                   |
| Builder             | Rail 240 px, steps 52 px with 24 px marks; question padded 18 px 24 px; tiles from 190 px, at least 64 px tall; detail 360 px   |
| Builder foot        | 12 px 24 px; the Cup 50 px                                                                                                      |
| Level dialog        | 620 px, 70 px from the top; steps row 44 px with 24 px marks, numbers VT323 17 px; body 16 px 18 px; foot with Back and the Cup |
| Score cells         | Six equal cells on Base lines; the chosen on the 2 px cyan line with the new value and the change in cyan VT323                 |
| Party member dialog | 560 px; face 64 px; plate as the band's; abilities row of six, modifier VT323 26 px over the score                              |
