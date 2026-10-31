# C5. Log and dice

Approved by the owner on 2026-10-30 after one round of mockups. C5 in `../CATALOG.md` is the log everyone reads, the
composer, the dice and the GM's call for a roll, inside the table's frame (`../C-table/SPEC.md`) and after C3
(`../C3-gm-panel/SPEC.md`, `../C3-running/SPEC.md`). It inherits the theme (`../T-theme/SPEC.md`) and the frame
(`../A-frame/SPEC.md`). `PLAN.md` beside this file is the work to build it; `log-and-dice.html` is the approved mockup,
and `history/` holds the round as it was shown. Every decision is built from settled parts; the mockup's Carried in
section lists them.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) gave the dice sheet on a phone its handle above its title
and close (2.4).

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) gave the dice options' phone sheet the horizon on its
top edge, drew the phone switch with no well and Base line controls at 36 px, set the GM ONLY tag at its one size (T
rule 7), and the prompts name the character.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew Mark used and Own tab at 36 px, the dice options'
title at 20 px (T 2.2) and their stepper at 44 px on a phone, the log's round lines and the option table's heads in the
eyebrow (T 2.4), and Advantage is armed as the one notice (T rule 21).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) closed the dice options with the one close, a plain 18
px icon in 40 px, in place of Done (T 2.2); drew the steppers at 40 px, 44 px on a phone, with their numbers in VT323 22
px (T 2.5); drew the log's tags and a harmful condition as the one tag, VT323 16 px in a 22 px box (T rule 7); drew the
fields at 40 px, 44 px on a phone, the tabs with 14 px words and lamps at 8 px; set the call for a roll's WAITING and
success in the eyebrow (T 2.4); and gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id   | Surface            | Decided here                                  |
| ---- | ------------------ | --------------------------------------------- |
| C5.1 | The log            | One line each (2.1), a roll as its card (2.2) |
| C5.1 | The composer       | Field first (2.3)                             |
| C5.2 | The dice options   | A sheet over the panel (2.4)                  |
| C5.3 | Calling for a roll | From the waiting list (2.5)                   |

The player's own prompt for a call (C4.3) and the band away from the table (A rule 10) stay as they are; C4 designs the
prompt.

## 2. The decisions

### 2.1 The log is one line each

- The log is read, so it is an open group (T 2.3): one entry a line of at least 34 px on a 1 px `--line`, no boxes.
- A roll's line: its tags (rule 3.2), who (600) and what, and the total at the right in VT323 20 px. A turn's line is
  small capitals in `--text-muted` ("Round 2 · Borin Stoneguard's turn."), the current turn's in amber. A line of the
  server's words keeps them, with a number of damage in red VT323 and healing in gold (rule 3.4). A chat line is its
  author (600) and the text; a whisper carries its tag.
- Pressing a roll's line opens it in place to its card (2.2), lit with a 2 px cyan edge; pressing it again, or another
  line, closes it. One is open at a time.
- New lines arrive at the foot; the log follows them only while the reader is at the foot (rule 3.5).

### 2.2 A roll opens as its card

- The card: who (600) and what with the tags; the total in VT323 30 px; each die in a small VT323 box, the kept die
  edged cyan and a dropped die struck through; the formula in quiet VT323.
- The dice sheet's recent rolls (2.4) are the same cards.

### 2.3 The composer leads with who hears it

- One row: who hears it as a Base line control at the start (To the table, or Whisper to {name}; a player has To the
  table and Whisper to the GM), lit violet while a whisper; the field ("Say, or /roll 1d20"); and Send.
- Under it, the quick dice d4 to d20 as Base line controls on one row, and More, which opens the dice sheet (2.4).
- Slash commands, chat, whispers and quick rolls keep today's behaviour and words.

### 2.4 The dice options are a sheet over the panel

- More (and the sheet's place in a phone's Log view) opens a sheet over the panel, under the tabs, with the map left in
  view: its head "Dice options" and the close (T 2.2); then the roller as a Cradle (T 2.4): Roll dice with Visibility as
  a field at its head (the GM's two choices, a player's three), How you roll (Digital or Manual), the dice, Advantage,
  Disadvantage and the modifier as Base line controls with the armed line in amber; then More dice as an open group with
  Custom formula and Falling damage as rows that open in place; then Recent rolls as an open group of cards (2.2). The
  roll's visibility in words sits at its foot.
- The GM's Roll dice and Call for a roll switch goes: calls are made from the waiting list (2.5).
- On a phone the sheet rises over the Log view to the Switch: the handle, then Dice options and its close.

### 2.5 The GM calls for a roll from the waiting list

- The waiting list's head (C3, first round) carries Call for a roll as a Base line control beside the bell. It opens the
  form in place over the list, as a Cradle: today's line, Check or Saving throw, Ability, Skill, Needs, About and DC as
  fields, Who rolls as Base line chips (every character on), Results shown to players as a switch, and Call for the
  check (or the save) as the lit main button.
- The open call waits in the list as a grey card on players (C3's waiting card): "Wisdom (Perception) check · DC 15",
  "Waiting on players · 1 of 3 answered · results shown to players", then a row per character with the result in VT323
  and success in cyan or failure in red as it arrives, or Waiting in amber with Roll for them; Close at its foot. The
  bell does not count it.
- The situations chips and today's errors stay. On a phone the same in the Switch's Encounter view.

## 3. Rules for the log and dice

1. Nothing new in what the controls do: every command, word and visibility stays; a player never gets a GM-only line or
   another player's whisper.
2. GM only, marked: a line or roll only the GM sees carries the violet GM ONLY tag in the GM's log; a whisper carries
   WHISPER TO {NAME} (TO {NAME} on a line), or WHISPER TO THE GM.
3. A natural 20 carries NAT 20 in cyan, a natural 1 NAT 1 in red, in the log, the cards and the dice sheet.
4. Damage reads red, healing gold.
5. The log stays where the reader is: scrolled up, it holds still and a line at its foot says how many new lines wait;
   pressing it goes to the foot.
6. A line opens to its card (2.1).
7. Calls wait with what waits (2.5).
8. Phones: a player's Log is the Switch's Log view with the composer under it; the dice sheet and a call's form open in
   place.

## 4. Values

| Part           | Value                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A line         | At least 34 px; 13 px; the total VT323 20 px; a turn's line 26 px, 11 px capitals                                                    |
| An open line   | A 2 px cyan edge and a 6% cyan wash over the line and its card                                                                       |
| The card       | 8 px 10 px; 1 px `--line-strong`; the total VT323 30 px; dice 22 px boxes, VT323 15 px; the formula VT323 14 px                      |
| Tags           | VT323 16 px in a 22 px box (T rule 7); NAT 20 cyan, NAT 1 and danger red, whispers violet; GM ONLY 16 px in its 22 px box (T rule 7) |
| The composer   | 10 px 16 px; who hears it and Send on Base lines; the field 38 px; the dice share one row                                            |
| The dice sheet | Over the panel under its tabs; head 48 px; content 12 px 16 px; Cradles 18 px apart                                                  |
| The open call  | C3's waiting card with a grey rim; rows 44 px; results VT323 18 px                                                                   |
