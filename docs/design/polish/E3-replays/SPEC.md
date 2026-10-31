# E3 Replays

Approved by the owner on 2026-10-30 after one round of mockups. The replays list (E3.3), watching a replay (E3.4),
renaming one (E3.5) in `../CATALOG.md`, and a player's replays under the sheet (C4.6). They sit inside Prep's frame
(`../E-prep/SPEC.md`) and inherit the theme (`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`), E's shelf cards (E
2.1), a thing beside its list (`../E2-maps-tokens/SPEC.md` 2.2), the Playing bar's scrubber
(`../E3-sound-screen/SPEC.md` 2.2) and the table's order (`../C-table/SPEC.md` 2.2). `PLAN.md` beside this file is the
work to build it; `replays.html` is the approved mockup, and `history/` holds the round as it was shown. The owner put
two options together for the list and asked to see the mix drawn in the next round's mockup; this spec is that mix. The
owner also asked that a replay's name have when it was fought to its right.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) gave a dialog on a phone its handle above its title and
close (T rule 16).

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) dropped the list's title row, drew the eye in the dim
text colour, gave Prep's bar its search and New encounter, put a replay's phone header as ‹ REPLAYS, and left a player's
menu button their face alone.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) wrote a replay's date and time as "Oct 30, 7:40 PM" (T
rule 20), drew the eye at 36 px on its Base line and the list's rows at 48 px, named the Goblin Boss in a step ("Dashes
after the Goblin Boss"), and made Cancel a ghost.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew a replay's token chips and a player's Watch at 36
px (T 2.5), wrote the oldest replay's date "Oct 2" (T rule 20), set the viewer's title rows at 24 px and its sheets'
titles at 20 px (T 2.2), and the list's column heads in the eyebrow (T 2.4).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the phone sheet's close as the one close (T 2.2),
a replay's eye at 15 px (T 2.5), the tabs at 44 px (T rule 1) and the replay's title at 20 px on a phone (T 2.2), and
gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id         | Surface                    | Decided here                                    |
| ---------- | -------------------------- | ----------------------------------------------- |
| E3.3       | The replays list           | A table, the chosen replay beside it (2.1)      |
| E3.4       | Watching a replay          | The whole fight beside the map (2.2)            |
| E3.4       | Moving through the turns   | A line of rounds (2.3)                          |
| E3.4, E3.5 | The GM's actions, renaming | Launch at the transport, the rest in More (2.4) |
| C4.6       | A player's replays         | Cards under the sheet (2.5)                     |

## 2. The decisions

### 2.1 The list is a table with the chosen replay beside it

- Under Prep's bar, with Replays lit: the list's toolbar opens with its count ("5 replays"). A list has no title row (T
  rule 17).
- At the left, the table, newest first, a column head sorting it:
  - Replay: the GM's name, with the encounter's name under it in muted text; with no GM name, the encounter's name.
  - Fought (the day), Turns and Length in VT323.
  - Whether players see it: the eye in the dim text colour; Only you is violet with the eye struck through (F rule 2, T
    rule 9).
  - The chosen row lit as a chosen row.
- At the right (500 px), the chosen replay:
  - Its name with More, then one line: when it was fought, its turns over its rounds and its length.
  - The map's picture at the first turn, with the tokens.
  - WHO FOUGHT as chips; for the GM, a hidden creature is violet and dashed.
  - Players see it as a switch, and Watch as the Cup.
- A player's list is the same table without the eye, the replay beside it as the party saw it (no hidden creature).
- With nothing kept, today's line: "No replays yet. Every encounter that ends is kept here." (a player: "Your GM hasn't
  shared an encounter yet.").
- On a phone: the table (the replay with its day, Turns, Length and the eye); a row opens the replay's page with the
  same parts as the right column.

### 2.2 Watching puts the whole fight beside the map

- The head row: Replays at its left, the name in display capitals, and when it was fought to the name's right ("Oct 30,
  2026, 7:40 PM · 15 turns · 22 min"); More at the right. A player's row reads "as the party saw it" there.
- At the left: the transport (2.3), then the map at that turn, with the order on glass at its top left: each creature as
  a chip with its hit points (a player sees monsters as bands), the acting one lit.
- At the right (400 px), THE WHOLE FIGHT: each turn a row under its round's heading, with its number in VT323, who acted
  and one line of what happened; the current turn lit. Pressing a turn goes to it. For the GM, a hidden creature's turns
  are violet with the GM tag; a player never receives them.
- On a phone: the name with its line under it, the transport, the map (150 px), then the whole fight as rows.

### 2.3 Moving through the turns is a line of rounds

- Previous turn, Play (Pause while playing) and Next turn as icon buttons of one size, then the line, then "Turn 08 of
  15" in VT323.
- The line: a rail with a section a round, labelled R1, R2 and on; a tick a turn; the part already watched in cyan and
  the knob at the current turn. Under it, marks: amber where damage was dealt, cyan where hit points came back, red
  where a creature went down.
- Pressing or dragging on the line goes to that turn. The arrow keys step as today; Play moves on every 2.5 seconds, as
  today.
- On a phone the row wraps: the buttons, the line at full width, the count.

### 2.4 The GM's actions: Launch at the transport, the rest in More

- Launch from turn {n} is the Cup at the end of the transport, naming the turn it launches. It keeps today's confirm
  ("Launch from this moment?") and today's refusals with their way out.
- More in the head row: Players see it (a check), Rename, Download JSON and Delete replay in the danger colour. Delete
  keeps today's confirm.
- Rename keeps today's small dialog and words, drawn as A's dialog ("Rename the replay", Name, "Players see this name
  once you share the replay.", Save name).
- In the list, the replay beside the table carries the same: Players see it as its switch, and More with Rename,
  Download JSON and Delete replay.
- On a phone: Launch at the transport; More's menu rises from the foot.

### 2.5 A player's replays are cards under the sheet

- Under the sheet, while no encounter runs: REPLAYS · {N}, then the shared replays as E's shelf cards two to a row: the
  map's picture, the name, the turns in VT323, and Watch. Past four, All replays · {N} opens the list.
- On a phone the same, under the Me tab.

## 3. Rules for replays

1. The server decides what a player sees. A player's replay is the server's player projection: no hidden creature, no GM
   line, monsters as bands. The GM's viewer marks hidden things with the GM tag.
2. A replay's name: for the GM, the GM's name or the encounter's; a player sees the GM's name or "Encounter", never the
   encounter's own name. When it was fought sits to the name's right.
3. Launch keeps its confirm and its refusals.
4. Players see it reads one way: the eye when shared; violet, dashed and the eye struck through when only the GM sees
   it.
5. Nothing new in what the controls do: listing, watching, launching, renaming, sharing, downloading and deleting keep
   today's routes and words.
6. Phones: the table and the cards keep 44 px rows, the transport stays in reach, menus rise from the foot.

## 4. Values

| Part            | Value                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------- |
| The list        | Table rows at least 54 px; the replay beside it 500 px                                   |
| The map picture | 290 px tall beside the table; 200 px on a phone                                          |
| Watching        | The whole fight 400 px; turn rows at least 40 px (44 px on a phone), numbers VT323 15 px |
| The line        | Rail 3 px; ticks 11 px; marks 8 px squares; the knob 14 px                               |
| Player's cards  | Two to a row; the picture 96 px (84 px on a phone)                                       |
