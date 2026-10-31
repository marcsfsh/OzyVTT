# E. Prep: its frame

Approved by the owner on 2026-10-29 in one round of mockups. Area E in `../CATALOG.md` gets a session ready before
anyone arrives. Like the table (C), it is designed as one frame first: what Prep opens on, an encounter's page, making a
new encounter and setting a map's grid. The tokens page, the sound board, replays and the map list's own details come in
later rounds inside this frame. It inherits the theme (`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`) and the
table's frame (`../C-table/SPEC.md`). `PLAN.md` beside this file is the work to build it; `prep.html` is the approved
mockup, and `history/` holds round 1 as it was shown.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) headed a new encounter's two columns and the grid's
step with eyebrows (T rule 10), gave its switches the theme's 46 by 26 track, and drew every phone control at 44 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) set To make it ready in the eyebrow on a phone too (T
rule 10) and Setting a grid's title rows at 24 px (T 2.2).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the tabs at 44 px (T rule 1) and every tag in a 22
px box (T rule 7), and gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id         | Surface                                  | Decided here     |
| ---------- | ---------------------------------------- | ---------------- |
| E1.1, E1.2 | Prep's front page and the encounter list | Shelf (2.1)      |
| E1.3       | An encounter's page                      | Workbench (2.2)  |
| E1.4       | Making an encounter                      | Draft page (2.3) |
| E1.5       | The encounters drawer                    | Rule 3.7         |
| E1.6       | The encounter action dialogs             | Rule 3.8         |
| E2.3       | Setting a map's grid                     | Steps (2.4)      |

Left for E's later rounds: the map list and a map's page beyond its grid (E2.1, E2.2, E2.4), the tokens page (E3.1), the
sound board (E3.2) and replays (E3.3 to E3.5). They follow rule 3.7 meanwhile.

## 2. The decisions

### 2.1 Prep opens on a Shelf

- Prep's Titled bar (T 2.1) names the section; Encounters is its first page and New encounter is the bar's Cup.
- The page starts with its toolbar: the count ("6 encounters") at the left; at the right the states as chips (All,
  Draft, Prepared, Ended), the order (Your order, as today), and New map as a Base line control.
- The encounters as cards, four to a row at 1280 px (cards from 270 px, 16 px apart):
  - the map as the card's picture (16 by 10), with the state tag at its top left (rule 3.3);
  - the name (Bai Jamjuree 600, 15 px), the map's name, who is in it (the party's faces and the monsters as chips), and
    whether it is ready (rule 3.2).
- A card is a link to the encounter's page; its More menu (duplicate, rename, delete, make live) sits at the card's top
  right on hover and focus, and always on touch.
- Your order still works: the cards drag to reorder, and the More menu keeps Move earlier and Move later. Today's row
  drag never finds its target (the rows carry `data-scene-id` and the code reads `encounterId`); the build fixes it.
- On a phone: two cards to a row with the picture, the name and the ready line; the toolbar is the count with Filter and
  Sort icons.

### 2.2 An encounter's page is the Workbench

- The record's title row (T 2.2): Encounters as a crumb, the name in Chakra Petch capitals with its state tag, one line
  (the map, who is in it, when it changed) and its actions as Base line controls: Duplicate, Edit the map, and More.
- Under it, the table's own frame (C 2.1): the tools as a 232 px dock at the left (the same grid of icon and word), the
  map with its Tray chip and map controls, and a 380 px panel at the right.
- The panel's tabs: Who is in it (with the count; today's Tokens tab and Who they face), Rules (today's fight settings
  and dice) and Light and sound (the map's grid with Set the grid, then today's walls and light, then sound). Its foot
  holds what is ready (rule 3.2) over Make live as the Cup, or Go to the table while it is live.
- The title row's line names the Codex pages that stage it (today's In the Codex). See as and History move into the More
  menu, beside Rename, Duplicate and Delete encounter.
- Who is in it lists the party and the monsters as rows (face or badge, name, a line such as "CR 1/4 · one roll for the
  group · on the map", and More), then Add monsters.
- On a phone: the title row, a segmented control of Map, Who, Rules and Light, the chosen view, and Make live pinned
  above the bottom tabs. The map view uses C's phone map: the tools as one row under it.

### 2.3 Making an encounter is a Draft page

- New encounter opens the new encounter's page at once (2.2), titled "Untitled encounter" with a Draft tag. Nothing asks
  for a name first.
- Until it has a map, the page shows its checklist where the map would be: "To make it ready" with four steps (Pick a
  map, Add who is in it, Place the tokens, Make it live), each with a short line, the current one marked as T rule 4's
  current step. Beside it, Pick a map: the GM's battle maps as a grid of thumbnails with their grid size, and Upload a
  map.
- An encounter needs a battle map on the server, so the record is made when the map is picked, as today's first step
  does with Continue. The page then becomes that encounter's workbench, and the checklist's remaining steps become the
  panel's ready lines. Leaving before a map is picked leaves nothing behind.
- The name is the map's name until the GM renames it in place from the title row, as today.
- An encounter that is not ready stays a Draft on the shelf until it is.
- Today's steps after the map (Tokens and monsters, Walls and light, Sound, Review) become the workbench's panel tabs
  and ready lines; their links open the encounter's page on the matching tab.
- On a phone: the same page, one column: the checklist, then the maps two to a row.

### 2.4 Setting a map's grid keeps its Steps

- Today's four steps (Upload, Grid, Check the alignment, Name and use), drawn to the theme: the record's title row with
  Maps as a crumb and Cancel; the Steps rail (T rule 4, 240 px) with each done step's answer under it; the step's form
  (380 px); the map at the right; Back and Next naming the next step as the Cup in the foot.
- The Grid step: a segmented control of Printed squares and No grid printed; for printed squares, one instruction (drag
  across three by three printed squares, corner to corner) in a Cradle with the result as a ready line ("Marked: 70 px
  squares, 5 feet each"); the map shows the marked block and the grid it makes in cyan.
- On a phone: the step as "Step 2 of 4 · Grid", the map on top, the form under it, and Back and Next pinned.

## 3. Rules for Prep

1. One Cup in Prep's bar. New encounter is the bar's Cup on Prep's lists. On a record (an encounter, a map) it steps
   down to a Base line control, so the record's own action (Make live, Next, Save) is the only Cup.
2. Ready in one set of words. Every encounter says "Ready to go" with a cyan lamp, or what is missing in amber, in the
   words today's ready list uses ("No grid yet", "3 tokens wait in the tray"), each with Go to it where it opens.
3. One state tag, worked out from today's facts with nothing stored: Live, Encounter parked and Replay as today; Ended
   when its fight has ended; Prepared when it is ready to go; Draft otherwise. VT323 tags; only Live is lit, and Draft
   has a dashed edge.
4. The map leads. Wherever an encounter or a map is listed, its map is the picture, 16 by 10, never stretched.
5. The map is the table's map. Preparing uses the table's map (C): the same tools, Tray chip and map controls, so what
   the GM sets is what the table shows.
6. Maps and Encounters are two pages in the bar. The toggle between them on today's front page goes.
7. The other lists follow. Maps, Tokens and Replays take the shelf's toolbar now; their own designs come later. The
   encounters drawer in the map editor lists encounters as the shelf's cards, one column.
8. Duplicate, rename, delete and the confirm before making an encounter live use A's Dialog pattern.
9. On a phone the pages run under Prep's header as a strip of words (T 2.1), and Make live is pinned above the tabs.

## 4. Values

| Part           | Value                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Toolbar        | 36 px Base line controls, 12 px between; the count 13 px `--text-muted`                                         |
| Shelf          | Cards from 270 px, 16 px apart, four to a row at 1280 px; two on a phone, 10 px apart                           |
| Card           | 1 px `--line-strong`, `--s1` to `--bg`; picture 16 by 10; body 10 px 12 px 12 px; name 15 px; state tag 8 px in |
| Encounter page | Title row 16 px 24px; dock 232 px; panel 380 px; panel foot 12 px 16 px with the Cup full width                 |
| Draft page     | Checklist column 420 px; steps 52 px with 24 px marks; maps four to a row                                       |
| Grid steps     | Rail 240 px; form 380 px; foot 12 px 24 px; the marked block a 2 px dashed cyan edge on a 12% cyan fill         |
