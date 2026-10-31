# C4 and C6. A player in a fight

Approved by the owner on 2026-10-30 after one round of mockups. C4 and C6 in `../CATALOG.md` are a player's moments in a
fight: what they must answer while others act (C4.3) and what a cast or a feature asks of them, with the spell's card
(C6.1 to C6.7). They sit inside the table's frame (`../C-table/SPEC.md`) and after C3 (`../C3-gm-panel/SPEC.md`,
`../C3-running/SPEC.md`) and C5 (`../C5-log-dice/SPEC.md`). They inherit the theme (`../T-theme/SPEC.md`) and the frame
(`../A-frame/SPEC.md`). `PLAN.md` beside this file is the work to build it; `a-player-in-a-fight.html` is the approved
mockup, and `history/` holds the round as it was shown. Every decision is built from settled parts; the mockup's Carried
in section lists them.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew the phone switch with no well, Base line buttons
at 36 px, menu rows at 48 px and every phone control at 44 px; the prompts name the character, and the GM ONLY tag has
its one size.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew Mark used at 36 px (T 2.5) and set the option
table's heads, a death save's Saves and Fails and the spell card's facts in the eyebrow at 11 px (T 2.4).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew a harmful condition as the one tag (T rule 7), the
panel's tabs with 14 px words (T rule 1) and lamps at 8 px (T rule 19), and gave Dawn's amber, magenta and violet words
their text shades (T rule 9).

## 1. What it covers

| Id                 | Surface                       | Decided here                                      |
| ------------------ | ----------------------------- | ------------------------------------------------- |
| C4.3               | The prompt slot               | Over the map (2.1), the card names its kind (2.2) |
| C4.3               | A reaction                    | The answer is the row (2.3)                       |
| C4.3               | Dying                         | Lamps over the roll row (2.4)                     |
| C6.1 to C6.5, C6.7 | What a cast or a feature asks | Under its row (2.5)                               |
| C6.6               | The spell card                | Under its row (2.6)                               |

The player's panel tabs and Turn tab (C4.1, C4.2) are C's (C 2.1 to 2.4). The rest prompt (C4.4), the phone identity
header (C4.5) and the replay shelf (C4.6) stay as they are. Add equipment's catalogue (C6.7) keeps A's dialog; the token
image picker (C6.8) waits for E2.

## 2. The decisions

### 2.1 A prompt sits over the map

- At the table the prompt slot leaves the top of the panel and sits on glass at the foot of the map: centred, at most
  420 px wide (the map's width less 32 px where that is narrower), 18 px above the map's foot. It keeps clear of the
  map's zoom controls; where the map is too narrow for both, the controls rise above the card.
- The glass is A's: `--void` at 84 % with a 10 px blur (solid `--bg` under reduced transparency), a 1 px `--line-strong`
  edge and a soft shadow. Inside it is C3's card (2.2). It is at most 60 % of the map's height and scrolls inside past
  that. The map pans and zooms under it, and tokens beside it stay pressable.
- One prompt shows; the rest are counted under it ("1 more after this: The GM calls for a roll"), in the order the
  server holds them. An outcome line stays a moment after its prompt closes, as today.
- A new prompt keeps today's behaviour: it is announced, and its heading takes the focus unless the player is typing.
- On a phone the card sits on the same glass at the foot of whichever Switch view is open (C 2.4), above the panel's
  foot, with 10 px gutters: over the map in the Map view, as the mockup draws it, and over the Turn, Log or Party view
  otherwise. The view does not change on its own.
- Away from the table (the Sheet, the Codex, Settings and the rest), the leading prompt is A's band (A rule 10), widened
  from calls for a roll to every prompt: the kind's tag (ROLL, SAVE, REACTION, DYING, DAMAGE, INITIATIVE), the title,
  and its answer as the band's button. A roll's band rolls it, as the call's band does today; a reaction, a turn order
  or anything else with more than one answer gets Go to the table, where its card waits. The band counts the rest ("2
  more"). A toast for the same moment does not replace it.

### 2.2 The card names its kind

- A prompt's eyebrow says what it is and nothing more: Saving throw, Reaction, Death save, Damage, Initiative, The
  encounter starts, Your turn. No words that hurry the player: "answer now" and "roll now" go everywhere they appear.
- The slot is the region "Prompts" (today "Answer now"). Its announcement reads the eyebrow and the title ("Saving
  throw: DC 13 Dexterity saving throw."), in place of "Answer now: {title}.".
- The death save gains the eyebrow Death save; its title stays "You are dying" with today's count beside it.

### 2.3 A reaction's answer is its roll row

- The card: the eyebrow Reaction, today's title ("Goblin Boss's attack would hit you") and one line of what happened
  ("The roll is 15 against your AC 11."), the roll only where the player already saw it, as today.
- Using the reaction is a roll row (theme rule 5, C3 2.5), the whole row the button: its name says the answer and what
  it turns on ("Cast Shield · AC 16 against 15"), its line says what follows and what it spends ("The attack misses · a
  level 1 spell slot, 3 left"), and the number it turns on sits at the right in VT323 (16, the AC with Shield). Where a
  kind has no such number, the right holds what the row rolls (d20, 1d10) or nothing.
- Keeping the reaction is a Base line control under the row, with what follows: "Take the hit · it hits you" for an
  attack that would hit; today's words for the rest (Decline, Let them go, Let it go, Take 12).
- A kind with more than one use gets a row for each (an ally to turn the attack on, a die to add or take off); a
  reaction spell with a choice of slot carries the slot as a segmented row above the use row (2.5).
- Today's numbers block (Their roll, Your AC, With Shield) folds into the row's name and number; the GM's own prompts
  stay as C3 2.5 draws them.

### 2.4 Dying shows lamps over the roll row

- The card: a red rule, the eyebrow Death save, "You are dying" with "0 successes · 1 failure" beside it, and today's
  line about Unconscious.
- Successes and failures are the cost tabs' lamps (C 2.3): Saves and Fails, three 16 px squares each, an unlit lamp on
  `--line-raised`, a success lit cyan with the reaction lamp's glow, a failure lit red. They replace the pips.
- The death save is a roll row: "Death save · d20", "10 or higher is a success · press to roll", d20 at the right.
  Pressing it rolls (Digital) or takes the typed die (Manual) as today; the held die's result then shows in the row
  ("Rolled 7 · Failure") and Confirm applies it, as today.
- End turn steps down and says "Roll your death save first.", as today. Once stable or dead, the lamps stay and the row
  goes.

### 2.5 What a cast or a feature asks opens under its row

- At the table, pressing a turn option that asks for something (a spell slot, a target, a spell to pick, Metamagic, the
  Ready action's spell) opens the ask under its row in the Turn tab, the row lit as chosen (a 7 % cyan wash) and the ask
  on a 4 % cyan wash, the way a creature's tools open under its row (C3 2.2). Cancel, or pressing the row again, closes
  it; one is open at a time, and opening another closes it.
- Inside: the ask as a line ("Choose who regains hit points."), who as Base line chips (each with the creature's name; a
  heal's chips may carry hit points), the spell slot as a segmented row ("Level 1 · 4 left · 2d8"), today's shaping
  options, today's line on what happens next in `--text-muted`, and the main control naming what it spends ("Cast at
  level 1"). Choosing a target on the map stays as today and lights the matching chip; an area keeps today's words
  ("Drag on the map to place it.").
- On the sheet, the same asks open under the row that started them: a spell's cast (today the right column's cast
  detail), who a heal is for (C6.1), shape-shift (C6.2), Ready (C6.3), a picked spell (C6.4), a spell swap under the
  spell's row in Spells (C6.5), and an item's form or spell under the item's row in Gear (C6.7). They leave their
  dialogs.
- On a phone the same, in the Switch's Turn view and on the sheet; the list scrolls the open row into view.

### 2.6 The spell card opens under its row

- Pressing a spell's name in the turn or on the sheet opens its card under its row: the level, school and classes in
  italics, the four cells (Casting time, Range, Components, Duration), the text, At Higher Levels and the source line,
  as today's card holds them. Pressing the name again closes it. Opening a cast's ask on the same row closes the card,
  and the other way round.
- The builder's offers (D) keep their own place for reading a spell and show the same content.

## 3. Rules for a player in a fight

1. A prompt stays in view: over the map at the table, and as A's band everywhere else. It leaves when it is answered or
   the GM dismisses it.
2. The card names its kind (2.2): no "answer now", "roll now" or other words that hurry the player.
3. One at a time: one prompt shows and the rest are counted.
4. Nothing new in what the controls do: the server rolls, holds the attack until the answer, and decides who is asked
   and what they see. Every command, word and timing stays.
5. End turn waits for the prompt that holds the player's own turn, and says why.
6. What it spends, said: a reaction's row names the slot, a cast's button names the level.
7. One spell card: a spell reads the same wherever it opens.
8. Phones: the prompt sits at the foot of the Switch's view or as the band; asks and cards open under their rows.

## 4. Values

| Part          | Value                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The glass     | At most 420 px wide, centred, 18 px above the map's foot (a phone: 10 px gutters, 10 px up); `--void` 84 % and a 10 px blur; 1 px `--line-strong`; shadow 0 18px 40px rgba(0, 0, 0, 0.5); at most 60 % of the map's height |
| The card      | C3's: 10 px 12px 12px 14px; a 3 px left rule, amber (red for dying); eyebrow 11 px capitals 0.12em; title 15 px 600; line 12.5 px `--text-dim`                                                                             |
| The roll row  | C3 2.5's: at least 52 px; 0 12px; a 6 % cyan wash and a 2 px cyan base; name 13.5 px 600; line 12 px; the number VT323 32 px                                                                                               |
| Under the row | Take the hit and the other answers as Base line controls, 6 px apart                                                                                                                                                       |
| Lamps         | 16 px squares 8 px apart, Saves and Fails 18 px apart; labels 11 px capitals 0.12em                                                                                                                                        |
| An open row   | The row on a 7 % cyan wash; the ask under it 10 px 10px 12px on a 4 % cyan wash with a 1 px `--line-strong` foot                                                                                                           |
| The band      | A's: 52 px on a laptop; on a phone the words take the first line and the answers the second                                                                                                                                |
