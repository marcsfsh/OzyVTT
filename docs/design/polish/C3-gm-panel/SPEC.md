# C3, first round: the GM's panel, and what waits on the GM

Approved by the owner on 2026-10-29 after one round of mockups. This is the first of two rounds for C3 (running the
encounter) in `../CATALOG.md`, inside the table's frame (`../C-table/SPEC.md`: Two docks, the Ladder, Cost tabs and the
phone's Switch). It inherits the theme (`../T-theme/SPEC.md`) and the frame (`../A-frame/SPEC.md`). `PLAN.md` beside
this file is the work to build it; `gm-panel.html` is the approved mockup, and `history/` holds round 1 as it was shown.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew the phone switch on base lines with no well and
the cards' buttons at 36 px, and the waiting lines name the character ("past Lyra's speed", "hit Mirena for 7. Mirena
keeps Bless").

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew Mark used and the waiting list's Own tab at 36 px
(T 2.5), the composer's dice at 44 px on a phone, and the option table's heads in the eyebrow (T 2.4).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew a ruling's card with the amber rim every card that
needs the GM carries (T rule 7), a harmful condition as the one tag, the panel's tabs with 14 px words (T rule 1) and
lamps at 8 px (T rule 19), and gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id    | Surface                                                                                        | Decided here                                       |
| ----- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| C3.1  | The GM panel's tabs                                                                            | Words and counts (2.3)                             |
| C3.2  | What waits on the GM (today's Needs you)                                                       | Top of Encounter or its own tab (2.1), cards (2.2) |
| C3.12 | The items in it (a hit to apply, a target to choose, a ruling, a save, what waits on a player) | Cards (2.2)                                        |
| All   | The signal that something waits on the GM                                                      | The bell (2.4)                                     |

Left for C3's second round: the prompts' own controls (rolling a save, the reaction prompt, death saves and stabilizing,
the order of what happens), starting an encounter (C3.3), the row tools (C3.6), the options menu (C3.7), adding monsters
(C3.8), and the Notes, Token and Party tabs' contents (C3.9 to C3.11). They follow section 3 meanwhile.

## 2. The decisions

### 2.1 The waiting list sits at the top of Encounter, or in its own tab: the GM's switch

- The list of what waits on the GM sits at the top of the Encounter tab, above the acting creature, with every item
  whole; the turn scrolls under it. The list scrolls on its own only when it is taller than half the panel.
- The GM can move it to its own tab, the first in the row, which carries the bell (2.4) and holds the list alone; the
  Encounter tab is then the turn alone.
- The switch: in the list's head, at its right, a Base line control: "Own tab" (with a chevron) while the list is over
  the turn, "Over the turn" while it is in its tab. And in Settings, Device (I), a GM-only row "Waiting list" with "Top
  of Encounter" and "Its own tab". The choice is kept on the device, as the last tab is today.
- On a phone the same: at the top of the Switch's Encounter view, or as a first choice in the Switch with the bell.

### 2.2 Each item is a card

- A card: a 3 px amber rim at its left, the creature's face (22 px) and the title (14 px, 600), its line (12.5 px, dim),
  and its buttons as Base line controls with the main one lit (cyan line and wash, a number in VT323: Apply 9).
- A ruling has the amber rim, as every item that waits on the GM (the fifth sweep). An item that waits on a player has a
  grey rim and its one button, Answer for {name}; it is listed after what waits on the GM.
- Every item keeps today's title, line, buttons and command (section 3.4).

### 2.3 The panel's tabs are words with counts

- One row: Encounter, Log, Party, Notes, and Token while a token is chosen (the frame's rule), the chosen one on the
  horizon ink. With the list in its own tab, that tab comes first.
- A tab whose entries grew since the GM last opened it carries the count after its word in quiet VT323: new lines on
  Log, new entries on Notes (Tonight's and the Codex's). Party and Token show state, not entries, and carry no count.
  Opening the tab drops the count to nothing; it counts again from there. The tab with the list carries the bell instead
  (2.4), which drops only as items are answered.
- On a phone the Switch's choices carry the same counts and the bell.

### 2.4 The signal is a bell with its count

- A bell (16 px, amber) with the count on a small amber badge at its top right, in VT323 on the void. No words: it
  replaces "Needs you" wherever it appears.
- It counts what the GM owes; items that wait on a player are not counted.
- It shows wherever something waits on the GM: the list's head; the Encounter tab (or the list's own tab); the acting
  row in the turn order when its creature has something waiting (the count of its items); the top bar's live chip while
  the GM is on another section mid-fight; a phone's Play tab and the Switch's choice that holds the list; between
  fights, over a long rest to approve; and in the Compendium's home over the records that need the GM.
- With nothing waiting there is no bell at all. When something new arrives the bell rings once with its burst, as a lamp
  lights (ADR-0045), and screen readers hear the newest title.

## 3. Rules for what waits on the GM

1. The list's place is the GM's (2.1), kept on the device.
2. A count is news (2.3); the bell is what is owed (2.4).
3. One signal: the bell replaces the words Needs you everywhere, and lines of help that say "waits in Needs you" name
   the list instead ("waits in the list over the turn", or "in the waiting list" while it has its own tab).
4. The words and the buttons stay: Apply N, Change, Dismiss; Choose the target, Turn down; Allow, Deny; Answer for
   {name}; Roll for the rest; Approve, Not now; and the prompts inside items as they are today.
5. Oldest first: items keep today's order by kind and arrival.
6. The list is never squeezed (2.1).
7. End turn is never blocked by the list; it steps down from the Cup only where it does today.
8. Phones: the Switch keeps Map, Encounter, Log, Party and Notes (the frame dropped today's Order tab), with the counts
   and the bell.
9. Items waiting on players are quieter and come last (2.2).

## 4. Values

| Part                   | Value                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The list over the turn | 10 px 16 px 12 px; a 7% amber wash fading down; 1 px `--line-strong` under it; cards 8 px apart                                                      |
| The list's head        | 36 px; the bell, "N waiting on players" in 11 px capitals when there are any, and the switch at the right (36 px, 12.5 px)                           |
| Card                   | 10 px 12 px 10 px 14 px; 1 px `--line-strong`; a 3 px rim (amber, `--line-raised` waiting); face 22 px; title 14 px 600; line 12.5 px; buttons 36 px |
| Main button            | A 2 px cyan line and a 10% cyan wash; the number VT323 18 px in `--cyan-hi`                                                                          |
| Tabs                   | 44 px; 0 7 px; 14 px words; counts VT323 15 px `--text-muted`                                                                                        |
| Bell                   | 16 px, stroke 2, `--caution`; badge 15 px, VT323 13 px on `--void`, at its top right                                                                 |
| Phone                  | The Switch's choices 44 px on base lines, no well; the list over the turn 8 px 12 px 10 px                                                           |
