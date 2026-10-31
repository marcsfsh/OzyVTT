# C3, second round: running the encounter

Approved by the owner on 2026-10-29 after one round of mockups. This is the second of C3's two rounds in
`../CATALOG.md`, inside the table's frame (`../C-table/SPEC.md`) and after C3's first round (`../C3-gm-panel/SPEC.md`:
the waiting list, cards, tabs with counts, the bell). It inherits the theme (`../T-theme/SPEC.md`) and the frame
(`../A-frame/SPEC.md`), and it reuses Prep's ready words (`../E-prep/SPEC.md` 3.2), the Compendium's stat block and
browse panes (`../G-compendium/SPEC.md` 2.3, 3.5) and Settings' encounter rows (`../I-settings/SPEC.md` 2.3). `PLAN.md`
beside this file is the work to build it; `running.html` is the approved mockup, and `history/` holds the round as it
was shown.

The owner asked that sub-areas keep to what is settled. Every decision here is built from settled parts; the mockup's
Carried in section lists them.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) headed the encounter's options with the encounter's name
and line, and gave the phone sheets the handle, the title and a close; 2.2 and 2.3 carry it.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) gave a creature's tools and the encounter's options the
horizon on their sheets' top edge, drew the phone switch with no well, the menu's items at 48 px and Base line controls
at 36 px, and the dying prompt says "stabilizes Lyra".

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew Mark used and Own tab at 36 px, every dialog's
and sheet's title at 20 px (the encounter's options, Add monsters, a creature's sheet; T 2.2), End the encounter's row
at 48 px with its rule inside (T rule 8), and the option table's heads in the eyebrow (T 2.4).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the close of a creature's tools at 18 px (T 2.2),
a harmful condition as the one tag (T rule 7), the fields at 40 px, 44 px on a phone (T 2.5), the panel's tabs with 14
px words (T rule 1) and lamps at 8 px (T rule 19), and gave Dawn's amber, magenta and violet words their text shades (T
rule 9).

## 1. What it covers

| Id          | Surface                               | Decided here                     |
| ----------- | ------------------------------------- | -------------------------------- |
| C3.3        | Starting an encounter                 | One form (2.1)                   |
| C3.6, C3.10 | A creature's tools, and the Token tab | Under its row (2.2)              |
| C3.7        | The encounter's options               | A menu on the panel's tabs (2.3) |
| C3.8        | Adding monsters                       | The Compendium's panes (2.4)     |
| C3.12       | The controls inside a waiting card    | The roll is the button (2.5)     |
| C3.9, C3.11 | The Notes and Party tabs              | Rules 3.5 and 3.6                |

## 2. The decisions

### 2.1 Starting an encounter is one form

- The Encounter tab before a fight, under the panel's tabs, in this order, each a Cradle (T 2.4) except the difficulty:
  - Spell areas, only when there are any (today's).
  - In this encounter, with Add monsters and Add characters at its head as Base line controls: the map as one line
    ("Map: The old road" with Change), then one row per creature (its face, its name, today's line "Party, on the map"
    or "Monster, in the tray", and the tick "{name} is in this encounter"). A row's More holds Show to players or Hide
    from players, and Remove from this list; the list's head carries the New tokens choice. The staging box and its
    second "In this encounter" go.
  - Who plays: one row per character with At the table and On their device as Base line options; a claimed character
    reads "Claimed on a player's device"; the line under it, "At the table, you answer every prompt for the character
    and roll its dice."
  - Initiative: the two switches with their labels, and the dice line under them.
  - Surprised: one Base line chip per creature in the encounter, and today's line.
  - Difficulty, an open group (T 2.3): "This encounter is worth 300 XP: Below Low for 3 characters" and the thresholds
    in 12 px.
  - The not ready lines in Prep's words (E 3.2) where today's blocked notes are ("3 tokens wait in the tray" with Go to
    it; "Pick a battle map first.").
- The foot: Start the encounter as the Cup, with "Rolls initiative for all 6" under it.
- On a phone the same form in the Switch's Encounter view, with Start the encounter pinned.

### 2.2 A creature's tools open under its row

- Choosing a creature's row in the left dock's order, or its token on the map, lights the row in cyan and opens its
  tools under it, in place. The dock widens from 232 px to 330 px while a row is open, and closes back when the row
  closes. One row is open at a time.
- The tools, in Cradles under the row: Hit points (the bar, the Amount field, Damage, KO, Heal, Temp, Set and Max as
  Base line controls with Damage lit, and Damage type as a field); Conditions and effects (their chips and Add);
  Position (Cover as options, Attitude toward the party for a creature that is not a character, In its lair when it has
  one); then This creature as an open group: Spend reaction, Hold breath, Open sheet, and Take out of the encounter in
  red, which asks first (A's dialog). A hit waiting to be applied to it shows as an amber line naming the waiting list.
- The Token tab keeps what belongs to the token: its size, its image, Show or Hide from players, Return to the tray.
- On a phone, choosing a creature opens its tools as a sheet over the Map view (60% of the height, the map above it):
  the handle, then the creature's head with its close at the right.

### 2.3 The encounter's options are a menu on the panel's tabs

- A More button at the end of the panel's row of tabs opens the menu, lit while open. It is a menu (A's menu pattern),
  headed as the map's menus are (C2) with the encounter's name in display capitals and its line ("Old road · Encounter ·
  round 2"), then in today's order and words, with the rules written as Settings writes them (I 2.3): How it runs (Rules
  assistant, Players' hits, Players' initiative, Health display, Health is, Underwater), Add to the encounter (the
  roster, Recent, Add monsters), Experience Points when a monster has fallen, and End the encounter in red, which asks
  first.
- On a phone the More icon sits in the header and opens the same as a sheet: the handle, the encounter's name and line,
  and its close.

### 2.4 Adding monsters is the Compendium's panes

- Add monsters opens a wide dialog laid out as the Compendium's browse (G 2.3): the search at its head; the filter panel
  with counts (Source, CR, Type, Size and the rest folded); the results as G's result rows (name, "CR 1/4 (50 XP) ·
  Small humanoid · AC 15 · HP 10", the CR in VT323); and the chosen monster's stat block (G 3.5) with its source tag and
  "Add to Old road" as the dialog's Cup.
- The foot: Roll hit points (off uses the average) as a switch, and "Adds land in the staging tray · Shown to players"
  from the tray's own choice, as today.
- Adding keeps today's command and feedback; the dialog stays open for the next.
- On a phone the dialog is a full screen sheet: the search, Filters and Sort, the rows, the chosen monster's stat block
  under them, and Add {name} pinned.

### 2.5 In a waiting card, the roll is the button

- Theme rule 5: a roll is a row, its name and line at the left and its number at the right in VT323 30 px; the whole row
  is the button (a 2 px cyan base and a light cyan wash). Before the roll it says what pressing does ("press to roll")
  and shows the die (d20); after an automatic or typed roll it shows the total and "press to confirm".
- A monster's save: "Dexterity save +2 · DC 14", with today's line under it (Rolled d20 17 · Success, no damage); the
  damage on a failure as a field above the row; Adv, Disadv, Reroll and Choose to fail (or Legendary Resistance) as Base
  line controls under it.
- A death save: the dying pips, then "Death save · d20" as the row; Who gives the aid as a field with First aid,
  Healer's Kit, Spare the Dying and Mark stable under it.
- An opportunity attack: "Scimitar +4 · against AC 17" as the row, with Adv, Disadv, Reroll and Let them go.
- The typed die field stays where the table lets the GM type ("or type your d20", Use).

## 3. Rules for running the encounter

1. Nothing new in the controls: every option keeps today's settings, words and commands; only where they sit and how
   they are drawn change.
2. One In this encounter: the start of a fight names who is in it once.
3. A row opens in the order; the dock widens while it is open (2.2).
4. Confirms are A's dialog, with today's words: Take out of the encounter, End the encounter, Award the encounter's XP.
5. The Party tab: its rows are the party as D draws a party member (`../D-characters/SPEC.md` 2.4); Rest the party stays
   a Base line control that opens today's Rest dialog. Its own design comes with D's.
6. The Notes tab: Tonight and the Codex read as the Codex reads (F); their own design comes with F's later rounds.
7. Phones keep the Switch, the order's cards and the pinned foot; a creature's tools and Add monsters open as sheets.

## 4. Values

| Part                     | Value                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Cradle                   | T 2.4; heading 11 px capitals; content 0 14 px 12 px; groups 18 px apart                                              |
| Creature row             | 48 px (40 px compact); face 30 px; name 13.5 px 600; line 12 px muted; tick 22 px                                     |
| The open row in the dock | The dock 330 px; the tools 10 px 10 px 12 px on a 4% cyan wash; the row lit cyan with a 2 px edge                     |
| Hit points               | Amount field 64 px, VT323 22 px; controls 36 px; the bar 5 px                                                         |
| The menu                 | 330 px; A's menu; headings 11 px capitals; items 48 px; End the encounter in `--danger-text` over a hairline          |
| The monsters' dialog     | 40 px from the table's sides and 30 px from its top and foot; filters 220 px, results 300 px, the stat block the rest |
| The roll row             | At least 52 px; 0 12 px; a 2 px cyan base and a 6% cyan wash; the number VT323 30 px                                  |
