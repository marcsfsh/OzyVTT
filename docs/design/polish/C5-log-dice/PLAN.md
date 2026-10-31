# C5 Log and dice: building it

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the log as one line per entry with a roll opening to its card, the
composer led by who hears it, the dice options as a sheet over the panel, and the GM's call for a roll from the waiting
list. It adds no rules, commands, routes or data. File paths and line numbers were read at `f5e166f`; the theme (T), the
frame (A), the table's frame (C) and C3 land on the same branch first or alongside, so confirm every anchor before
editing. Paths are under `apps/client/src/` unless they start with `apps/`, `packages/`, `e2e/` or `docs/`.

This is C5 in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in six phases, L0 to L5, each
  about one commit.
- The reference is `log-and-dice.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything
  else is inline). It opens on the approved choices. Use the Page switch (The log, Its rolls, Saying and whispering, The
  dice options, Calling for a roll). The GM is on the laptop and Borin's player on the phone. The other options in the
  decision switches are the ones the owner turned down; build only the chosen ones. `history/` holds the round.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its fight is a stand-in.
  Build with the existing components, hooks and primitives, and with the settled ones (T's Cradle and Base line, C3's
  waiting card and bell). Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` and `play-vocabulary.test.ts` (which pins the four visibility phrases, 36 to 44 and
  213 to 238) check it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The log is one line per entry; pressing a roll's line opens it to its card in place.
2. A roll reads as today's card, drawn to the theme, with its tags.
3. The composer leads with who hears it, then the field and Send, the quick dice under it with More.
4. The dice options are a sheet over the panel.
5. The GM calls for a roll from the waiting list's head; the open call waits there as a card on players.
6. Eight rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin (one surveyed for this plan was 26 commits behind), so pull before reading any anchor.
- This builds on T1 to T3, C1 and C5 (the panel and the phone's Switch with its Log view), and C3's first round (Q1 to Q4:
  the waiting list, its head and cards, the bell, the Log tab's count). If one is missing, stop at the phase that needs
  it and tell the user.
- CLAUDE.md applies in full. The server decides who sees a line or a roll (`apps/server/src/combat-log.ts` 77 to 98,
  `roll-history.ts` 64 to 68, `server.ts` 563 to 567); the client only marks what its own view carries. Every command
  stays: `dice:roll`, `chat:send`, `chat:delete`, `roll-call:start`, `roll-call:answer`, `roll-call:close`,
  `save:answer`, `check:reroll`, `log:read`. No server, shared domain, schema, projection or route changes. If a step
  seems to need one, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the log and dice as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The log

- `TableView.tsx` 149 to 156 builds `<CombatLogPanel canRemove>`; the GM's Log tab (`encounter/GmEncounterPanel.tsx`
  634 to 646, 658) and the player's (`encounter/PlayerEncounterPanel.tsx` 642 to 655, 676, 681; the phone's
  `/table?panel=log`, `router.ts:263`, `shell/AppBar.tsx:277`).
- `encounter/CombatLog.tsx`: the store of the last 250 entries (15 to 62, `CAP` 26; `log:entry`, `log:removed`,
  `log:read` 51 to 54), the pin to the foot (71 to 74), the arrival light (75 to 87, `encounter/logArrivals.ts` 20 to
  30), the empty "No combat events yet." (88), the list (90 to 106; every kind but roll and chat is `entry.text` in
  `li.combat-log-entry.log-<kind>`, 100 to 104), `RollCard` (114 to 133: who, label, total, dice with `.is-dropped`,
  formula; the `aria-label` is the server's words), `ChatLine` (139 to 162: the whisper tag "Whisper to {name}" or
  "Whisper to the GM", `.is-whisper`, Remove this line and `chat:delete`), the hidden h2 "Combat log" (169 to 171).
- The entries (`packages/domain/src/views.ts` 412 to 446): kinds damage, heal, save, action, condition, reaction, turn,
  encounter, scene, history, roll, movement, effect, death-save, override, chat; fields `gmOnly`, `private`, `author`,
  `whisper`, `roll`.
- CSS `encounter/combat-log.css` 1 to 192 (roll card 115 to 161, chat 163 to 192), `table/table-panel.css` 183 to 192,
  218 to 231.

### 3.2 The composer

- `table/LogComposer.tsx`: the quick dice group "Quick rolls" with "Roll 1dN" (95 to 107), Who hears it (88 to 121), the
  field "Say, or /roll 1d20" labelled "Say something or roll" (123 to 130), Send (132), the foot with the visibility
  word and Dice options opening a Modal (136 to 148), `composerIntent` (22 to 32), sending (57 to 73), the toasts.
- CSS `table/log-composer.css` 1 to 77.

### 3.3 The dice options

- `dice/DicePanel.tsx`: the GM's mode switch "Roll dice or call for a roll" (163 to 174, 84), the heading and Visibility
  (186 to 201, `ROLL_VISIBILITY_WORD` 30 to 35, the choices 41 to 44), How you roll (203 to 216,
  `dice/roll-preference.ts` 161 to 170), quick rolls (217 to 223), Advantage, Disadvantage and the modifier (224 to 241),
  Custom formula (242 to 264, `withD20Mode` 57 to 62), Falling damage (265 to 285), Recent rolls (286 to 350: the badge,
  NAT 20 or NAT 1, the meta line, dice, the formula and the total). Opened from the composer's Modal
  (`TableView.tsx:142`) and from the sheet (`sheet/CharacterSheet.tsx` 677 to 680, 806 to 809, `sheet/LatestRoll.tsx`
  52 to 58).
- CSS `dice/dice-panel.css` 1 to 266.

### 3.4 Calling for a roll

- `dice/RollCallPanel.tsx` (125 to 292): the heading, its line, Check or Saving throw, Ability, Skill, Needs, About, DC,
  Who rolls, the reveal switch, Call for the check or the save, the errors; Open calls with each row's result or
  Waiting, the situations and Roll for them, and Close. `dice/roll-call-words.ts` 20 to 38, `dice/CallSituations.tsx`.
- The player's card: `encounter/RollCallPrompt.tsx` 89 to 224 in `table/PromptSlot.tsx` 351 to 366, and away from the
  table `shell/App.tsx` 110 to 113; it stays (C4).
- CSS `dice/roll-calls.css` 1 to 180.

### 3.5 Tests that pin it

- `table/log-composer.test.tsx` (28, 41 to 51, 54 to 62, 66 to 85, 88 to 96, 100 to 105, 111 to 115),
  `encounter/combat-log-chat.test.tsx` 36 to 59, `table/people-light.test.tsx` 60 to 111, `dice/dice-panel.test.tsx` 26
  to 109, `dice/roll-calls.test.tsx` 79 to 346, `table/prompt-slot.test.tsx` 171 to 193, `table/panel-tabs.test.tsx`
  114 to 249 (the Log tab holds "Quick rolls" and "Dice options"), `shell/app-bar.test.tsx` 193 to 196,
  `play-vocabulary.test.ts`.
- e2e: `journeys.spec.ts` 477 to 530 (a roll call through the API; its toast and "Done"), 963 to 966, 1062.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The log's lines | Changed: one line each, tags, damage in red | `CombatLog`, the entries' kinds |
| The open card | Changed: a roll's line opens to `RollCard` | `RollCard` |
| Holding still | New: the log follows the foot only while at it | `CombatLog`'s pin (71 to 74) |
| The composer | Changed: who hears it first, the dice under it, More | `LogComposer` |
| The dice sheet | Changed: a sheet over the panel, no call mode | `DicePanel`, the panel's overlay |
| Calls in the list | Moved: the form and open calls into the waiting list | `RollCallPanel`, C3's list and waiting card |

How the parts fit, so the phases agree:

- A line: a roll entry renders as a button row (its tags, who, what, the total) whose `aria-expanded` opens `RollCard`
  under it; its accessible name stays the server's words. Other kinds render as today's text with numbers marked: a
  damage entry's amount in red VT323 and a heal's in gold, by matching the number the server put in `text` for those
  kinds only (the entries carry no separate amount; if a kind's text has no number, it renders as written).
- Tags: GM ONLY when the GM's entry has `gmOnly` (or `private` for the roller's own self-only roll, which reads "Hidden
  from players"); WHISPER TO {NAME} from `whisper`; NAT 20 and NAT 1 from the roll's kept d20, as `DicePanel` already
  works it out.
- Holding still: the list keeps its place while the reader is scrolled up more than one line from the foot, and shows
  "{N} new lines" as a Base line control at its foot that scrolls down; at the foot it follows as today.
- The composer: Who hears it becomes a Base line control that opens today's choices as a menu (its `aria-label` stays
  "Who hears it"); the field, Send and the quick dice keep their names; More opens the dice sheet (its name "Dice
  options" stays for tests and screen readers).
- The dice sheet: `DicePanel` renders inside a sheet over the panel's body (under the tabs, over the Log tab, the map left
  in view) on the table, and as today on the character sheet. Its mode switch goes on the table; `RollCallPanel` leaves
  it.
- Calls: C3's waiting list head gains Call for a roll; `RollCallPanel`'s form renders in place over the list; each open
  call renders as a waiting card on players with today's rows (results, Waiting, situations, Roll for them) and Close.
  The bell's count leaves calls out.

## 5. Phases

### L0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `C5-log-dice/`, and leave the
   other pieces' folders as the zip has them.
2. Add `C5-log-dice/ADR-0060-log-and-dice.md` as `docs/adr/0060-log-and-dice.md`, Accepted, and its row to
   `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### L1: the log's lines and the open card

1. One line each, the open card, the tags and the marked numbers (section 4).
2. Holding still and the count of new lines.
3. Tests: a new `combat-log-lines.test.tsx` (a roll's line opens and closes its card; one open at a time; GM ONLY on a
   `gmOnly` entry; a whisper's tag; NAT 20 and NAT 1; damage marked red; the log holds still when scrolled up and the
   count brings it back), `combat-log-chat.test.tsx` holds, `people-light.test.tsx` holds.

### L2: the composer

1. Who hears it first, the field and Send, the quick dice under them with More (section 4).
2. A phone: the same in the Switch's Log view.
3. Tests: `log-composer.test.tsx` (its names and payloads hold; More opens "Dice options").

### L3: the dice sheet

1. `DicePanel` in a sheet over the panel on the table, without the call mode; the roller as a Cradle, More dice as rows
   that open in place, Recent rolls as cards; the visibility at its foot.
2. A phone: the sheet rises over the Log view to the Switch.
3. Tests: `dice-panel.test.tsx` (holds; no mode switch on the table), `panel-tabs.test.tsx` (the Log tab's "Dice
   options").

### L4: calls from the waiting list

1. Call for a roll in the waiting list's head, the form in place, the open call as a waiting card (section 4); the bell
   leaves calls out.
2. Tests: `roll-calls.test.tsx` (the form's names and payloads hold from the list's head; the open call's rows, Roll for
   them and Close in the card; the player's card unchanged), `needs-you.test.tsx` (a call does not count in the bell),
   `journeys.spec.ts` 477 to 530 holds.

### L5: docs and cleanup

1. `docs/DESIGN.md`: the log, the composer, the dice sheet and calls.
2. `docs/ARCHITECTURE.md`: the log's lines and holding still; the dice sheet; calls in the waiting list.
3. `docs/adr/README.md`: 0060 Accepted and built. `docs/design/polish/CATALOG.md`: C5 moves to Built.
4. Remove what nothing uses: the Dice options Modal on the table, the mode switch, the composer's old foot.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a fight running (an attack with advantage, a natural 20, a GM-only roll, a whisper, chat), look in Dusk and Dawn
  at:
  - 1280 by 800 with a mouse, as the GM: the lines, opening and closing a roll's card, the tags, holding still while
    scrolled up and the new lines' count; whispering to a character and rolling from the quick dice; the dice sheet
    (Advantage armed, the modifier, a custom formula, falling damage, recent rolls); a Wisdom (Perception) check called
    from the waiting list, its answers arriving, Roll for them and Close.
  - 390 by 844 with touch, as a player: the Log view, a whisper to the GM, the dice sheet with a player's three
    visibilities, and answering the GM's call; every control at least 44 px; no sideways scroll.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable, including Remove this line, slash commands and their errors, the
  sheet's dice log and its Table and Mine filter, and the situations chips.

## 7. Left as they are, for later rounds

- The player's prompt for a call (C4.3), the band away from the table (A), the sheet's own dice log (D1).
- Every command, projection, HTTP route and stored value.

## 8. Departures from the mockup, on purpose

- The mockup marks damage numbers in three lines; the app marks them in damage and heal entries only.
- The mockup draws the open call with three characters and one answer; the app draws today's rows for every character
  called.
- The mockup does not draw the new lines' count, Remove this line, the custom formula or falling damage opened, or the
  call's errors and situations; sections 4 and 5 place them.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `log-and-dice.html`.

- `p4n-c5.css`: lines (`.w-line`, `.w-line.open`, `.w-opencard`), the card (`.w-card`, `.w-die`), tags (`.tag.nat`,
  `.tag.wh`), the composer (`.w-comp`, `.w-dz`, `.w-send`), calls (`.w-call`, `.w-res`, `.w-wait`, `.w-fields`). The
  other options' parts sit beside them. `p4c-table.css`, `p4l-c3.css` and `p4m-c3b.css` are C's frame and C3.
- `p6-body3.js`: `LOG` (the fight), `lineOf()` and `logBody()` (the `lines` branch), `rollEl()` (the `card` branch),
  `composer()` (the `line` branch), `rollerCr()`, `folds()` and `recent()` with `dicePage()` (the `sheet` branch),
  `callForm()` and `openCall()` with `callPage()` (the `list` branch), and the player's phone (`plPhone()`).
- `p6-dec3.js`: the decisions, the Carried in list and the rules. The earlier files are C's frame and C3, ported.
- `audit-c3.js`: the "Today" screenshots and the map.
