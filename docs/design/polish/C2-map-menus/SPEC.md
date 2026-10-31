# C2. The map's menus

Approved by the owner on 2026-10-30 after one round of mockups. C2 in `../CATALOG.md` is what opens from things on the
map and from its tools, inside the table's frame (`../C-table/SPEC.md`) and after C3 (`../C3-gm-panel/SPEC.md`,
`../C3-running/SPEC.md`), C4 and C6 (`../C4-C6-player/SPEC.md`). It inherits the theme (`../T-theme/SPEC.md`) and the
frame (`../A-frame/SPEC.md`). `PLAN.md` beside this file is the work to build it; `map-menus.html` is the approved
mockup, and `history/` holds the round as it was shown. Every decision is built from settled parts; the mockup's Carried
in section lists them.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) gave the phone sheets the horizon on their top edge,
drew the phone switch on base lines with no well, menu rows at 48 px (52 px in a phone sheet) and Base line buttons at
36 px, showed None in an empty choice field, named characters in the prompts it carries, and set the GM ONLY tag at its
one size.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew Mark used at 36 px, the option table's heads and
the tools' field labels in the eyebrow (T 2.4), Others can move this at 44 px on a phone, and a menu row's rule inside
its 48 px (T rule 8).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew a harmful condition as the one tag (T rule 7), the
panel's tabs with 14 px words (T rule 1), a tool's fields at 40 px, 44 px on a phone (T 2.5), and lamps at 8 px (T rule
19), and gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id         | Surface                                         | Decided here                     |
| ---------- | ----------------------------------------------- | -------------------------------- |
| C2.5, C2.7 | A token's menu, and Place here on the empty map | A's menu at the thing (2.1, 2.2) |
| C2.5       | How a creature moves                            | In the token's menu (2.3)        |
| C2.6       | A door                                          | A's menu (2.4)                   |
| C2.2       | Each tool's options                             | A menu from the tool (2.5)       |
| C2.3       | A drawing                                       | A's menu at the drawing (2.6)    |

The map itself (C2.1) and the staging tray (C2.4) are C's (C 2.1, rule 3.4). The prompt over the map is C4's
(`../C4-C6-player/SPEC.md` 2.1).

## 2. The decisions

### 2.1 Everything on the map opens as A's menu at the thing

- A token, a door, the empty map and a drawing open the same way: the other button with a mouse, a long press on a
  phone, or Enter on the focused thing. Each opens A's menu at the thing: the horizon edge along its top, its title,
  small capital heads, rows of at least 48 px, segmented rows where a choice is one of a few.
- The menu opens beside the thing and keeps clear of it: to its side where there is room, flipped to the other side or
  moved up to stay inside the map, scrolling itself only when nothing else fits (today's placement rule,
  `useMenuPlacement`). It never covers the panel.
- On a phone the menu opens from the foot of the Switch's view, above the bottom tabs, with 10 px gutters and the thing
  left in view above it (T's dialog on a phone). It is at most 70 % of the view's height and scrolls inside past that.
- One menu at a time. Escape, its close, or a press elsewhere on the map closes it, and the focus goes back to the
  thing.

### 2.2 A token's menu

- The GM's, for any creature: its name with "Monster · 15/21" (or the character's class line) beside it; How it moves
  (2.3); Height with the stepper, In the air and Set height; The token: Size, Health, Set token image, Hide from players
  (or Show to players) and Return to tray; The creature: Open stat block (or Open character sheet), Use reaction (or
  Reaction spent · Restore), and Hit points and conditions, which opens the creature's row in the dock (C3 2.2).
- A player's, for their own character: its name; How {name} moves (2.3); Conditions; Open character sheet; Use reaction.
- What C3 moved under the row (the amount with Damage and Heal, Damage type, Conditions for the GM) leaves the GM's
  menu. Carried or held creatures keep today's rows ("Carries {name}", "Held by {name}").
- Place here (C2.7), on the empty map, is the same menu with today's choices (Place a light here, a token from the
  tray), or its line "Everyone is on the map. Drag a token to move it.".

### 2.3 How it moves stays at the top of the token's menu

- How it moves is a segmented row at the top of the token's menu: Walk with its speed, then the creature's other speeds
  and ways (Climb, Swim, Fly, Jump, Teleport, and Forced for the GM), each naming the feet left this turn on the acting
  creature's turn ("Climb 15"). The chosen way is lit cyan; Prone makes every way a crawl, as today.
- Today's keys while a token is held and the path's label ("Climb · 10 of 15 ft") stay.

### 2.4 A door is A's menu

- Its title is Door with its state beside it ("Closed · locked · AC 15 · 18 HP"). Its rows are today's ways: Open the
  door (or Close the door), Pick the lock, Force it open, Pry it open with tools, Jam it with an Iron Spike, Seal it
  with Carpenter's Tools, Push an Immovable Rod's button, each only where today shows it.
- Under them, in `--text-muted`, who does it ("Goblin Boss does it. Each takes an action in an encounter.") and how to
  attack it or cast at it. The GM's Edit lock and strength opens today's editor in place inside the menu.

### 2.5 A tool's options are A's menu from the tool

- Pressing a tool that has options (Draw, Fog, Terrain, Traps, Weather, Walls, Light, View) turns it on and opens its
  options as A's menu beside its button: on a laptop to the right of the dock, level with the button and moved up to
  fit; on a phone under its button in the tools row, from the right edge with 10 px gutters.
- The menu holds today's controls for that tool, in today's order, with its title (Light) and a close. It keeps its name
  as a group ("Light"), so a screen reader and the tests find it as today.
- The tool stays on after its menu closes. Pressing the map does what the tool does (places the light, paints the area)
  and closes the menu; the tool's button stays lit and its title names the choice ("Light · Torch"). Pressing the tool
  again opens the menu; Select turns the tool off.

### 2.6 A drawing is A's menu at the drawing

- Choosing a drawing with Select opens A's menu beside it: its size and shape ("20 ft circle") with GM ink or Yours;
  Colour as swatches; Who sees this; Character when it is shown to one; Others can move this; and Remove in red.
- A drawing someone else owns shows only its size and shape and who drew it, as today.
- The drawing's editor leaves the options column.

## 3. Rules for the map's menus

1. One way to open what is on the map: the other button, a long press, or Enter, into A's menu at the thing; a tool's
   options are A's menu from the tool.
2. One menu at a time; a tool stays on after its menu closes.
3. Nothing new in what the controls do: every command, word and permission stays. A player reaches only their own token
   and their own drawings, and the server decides every move, door and light.
4. Hit points live in the row: the token's menu points to the creature's row (C3 2.2) for hit points and conditions.
5. The map keeps its room: a menu opens beside its thing and never over the panel; the map pans under it.
6. Phones: menus open from the foot of the Switch's view; a long press opens what the other button opens; every control
   keeps a 44 px hit area.

## 4. Values

| Part                 | Value                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A's menu             | 300 px wide on a laptop; 6 px 0; the 2 px horizon edge; title 15 px display capitals with its state in 12 px `--text-muted`; heads 11 px capitals 0.12em; rows at least 48 px, 13.5 px 600 with the value at the right in 12.5 px `--text-dim` |
| Segmented rows in it | 2 px 16px 8px; Base line controls 6 px apart, the chosen on a 2 px cyan base                                                                                                                                                                   |
| The height stepper   | Base line minus and plus with the height between them in VT323 17 px                                                                                                                                                                           |
| Swatches             | 22 px squares 5 px apart; the chosen ringed in cyan                                                                                                                                                                                            |
| Placement            | 8 px from the thing, inside the map with 10 px to spare; on a phone from the foot with 10 px gutters, at most 70 % of the view                                                                                                                 |
| A tool's menu        | Beside the tool's button, 300 px wide; the tool's button lit with the cyan rail as today                                                                                                                                                       |
