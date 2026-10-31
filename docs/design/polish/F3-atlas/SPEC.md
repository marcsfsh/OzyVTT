# F3 The Atlas, and the Downtime tab

Approved by the owner on 2026-10-30 after one round of mockups. The Atlas (F3.1), a pin and its editor (F3.2), moving
between maps and adding one (F3.3) in `../CATALOG.md`, and what the story's Downtime tab holds (F4.7, placed by
`../F-story-people/SPEC.md` 2.5). They sit inside the Codex's frame (`../F-codex/SPEC.md`) and inherit the theme
(`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`), the folders at the side (`../E2-maps-tokens/SPEC.md` 2.1) and
the map picker (E2 2.5). `PLAN.md` beside this file is the work to build it; `the-atlas.html` is the approved mockup,
and `history/` holds the round as it was shown. The owner put two options together for the Atlas and asked to see the
mix drawn in the next round's mockup; this spec is that mix. Seeing it, the owner asked that a pin's page also set the
party's position and hide the pin from players, as its menu does. The consistency sweep (`../T-consistency/SPEC.md`,
ADR-0072) then drew the tree's rows, the pin's menu head and the Downtime tab's characters as every other side list and
menu are; 2.1, 2.2 and 2.5 carry it.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) named the Atlas's and the story's phone header CODEX,
muted Filter pins's placeholder, and stepped the bar's New down when a page shows its own Cup.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) made Delete pin a `--danger-text` row with the bin,
gave a map with no pins its Add a pin button (T rule 3), drew the pin's menu rows at 48 px (52 px on a phone), made
Cancel a ghost, and set the reading measure at 680 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) gave the pin editor on a phone the header Editing, the
pin's name with Saved and no strip (T rule 12), drew a downtime that waits as the one notice (T rule 21), and set its
sheets' titles at 20 px (T 2.2).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew Saved as a lamp and its word (T rule 19), the
Downtime tab's counters in the eyebrow (T 2.4), the fields at 44 px on a phone (T 2.5), the tabs at 44 px (T rule 1),
every tag in a 22 px box (T rule 7) and a pin's title at 20 px on a phone (T 2.2), and gave Dawn's amber, magenta and
violet words their text shades (T rule 9).

## 1. What it covers

| Id   | Surface                         | Decided here                                            |
| ---- | ------------------------------- | ------------------------------------------------------- |
| F3.1 | The Atlas                       | Maps at the side, the map, the pins at the right (2.1)  |
| F3.2 | A pin                           | Its page in the right column; a right-click menu (2.2)  |
| F3.2 | Editing a pin                   | Tabs in the right column (2.3)                          |
| F3.3 | Moving between maps, adding one | A tree at the side; Add a map uses the map picker (2.4) |
| F4.7 | The Downtime tab                | Characters at the side (2.5)                            |

## 2. The decisions

### 2.1 The Atlas: maps at the side, the map, the pins at the right

- Three columns under the Codex's bar:
  - At the left (250 px), MAPS as a tree drawn as the settled side list: every map nested under the map it sits in, each
    row the map icon, its name and its pin count in VT323, the current one lit as a chosen row. What a map is (world,
    regional, battle) sits in its line on the map's glass. Under it ON THE MAP, the layers (People, Hidden pins,
    Factions) as rows reading on or off, then Add a map.
  - In the middle, the map: where you are as crumbs on glass at its top left (The Sunhold Reaches › The Thornwood), with
    the map's line under them ("Regional map · 5 pins · 1 hidden"), and zoom as two Base line controls on glass at its
    bottom right.
  - At the right (360 px), PINS · {N} with Add a pin and More, Filter pins, and each pin as a row: its icon in its
    colour, its name and what it is, and More (or its Hidden tag). Under them: "Right-click a pin for its menu, or the
    map to add a pin there."
- The party's pin keeps its amber mark under it. A hidden pin is dashed and violet (F rule 2).
- On a phone: the maps as a row of chips (the current one lit), the map filling the screen, and the pins as a sheet from
  the foot (Pins · 5, Add a pin, the rows).

### 2.2 A pin opens as its page in the right column

- Choosing a pin, from the list or on the map, lights it on the map and turns the right column into the pin: All pins at
  its head with Edit pin and More; the linked page's face, name and line ("Place · village · the party is here"); then
  two rows with a switch each, The party's position and Players see it; its first paragraphs; Facts; Journal with its
  count; and Open the whole page. A pin with no page shows its own label, kind, tags and journal.
- The two switches do what the menu's items do: turning The party's position on sets the party's position at this pin
  (Set party position here) and turning it off clears it from this pin; Players see it is Hide from players and Show to
  players.
- A right-click on a pin (a long press on a phone) opens A's menu at the pin, headed as the map's menus are (C2): its
  name in display capitals and its line ("Ruin · 3 pins"). Then: Open its page, Edit pin, Set party position here, Hide
  from players (or Show to players), Move pin, and Delete pin in the danger colour. A right-click on the map keeps
  today's Add a pin here.
- On a phone the pin opens as a tall sheet over the map with the same parts; the menu opens from the foot.

### 2.3 Editing a pin uses tabs in the right column

- Edit pin turns the right column into the editor: Back, EDIT PIN · {name} and Saved, a lamp and its word (it saves as
  you go, as today), then Look, Links, Encounters and Who sees it as tabs, one at a time, and Done as the Cup.
  - Look: Label, Icon (the pin icons as Base line controls), Colour (today's swatches).
  - Links: Linked pages (with Link a page and New page), Opens a map.
  - Encounters: Encounters staged here, with Link an encounter.
  - Who sees it: Players see it, The party's pin, Tags.
- On a phone the editor takes the screen as writing a page does: the header Editing, the pin's name with Saved, the same
  tabs and Done, with no strip and one way back.

### 2.4 Maps are a tree at the side; Add a map uses the picker

- The tree in 2.1 is how you move: pressing a map opens it; the crumbs on the map go up. A pin that opens a map says so
  in its line ("Opens Riverford crossing") and its menu offers Open the map inside.
- A map with no pins says "No pins on this map yet." with + Add a pin under it (T rule 3); a right-click on the map, or
  holding it on a phone, still adds a pin there.
- Add a map opens E2's map picker (folders, the library and a preview) for the picture, then asks its name, kind and
  where it sits (today's Details fields). A map's More holds Rename, Sits inside, Kind, Reveal and Delete map.

### 2.5 The Downtime tab puts the characters at the side

- Under the story's tabs (Chronicle, Timeline, Sessions, Downtime): at the left (280 px) CHARACTERS, each with their
  face at 20 px and this month's days in VT323, the chosen one lit; then DEADLINES, each with its days left ("2d"),
  amber when close.
- At the right, the chosen character: their face, name and "6 days of downtime this month", Log downtime as the Cup,
  then DOWNTIME, each entry a row (the in-world date, the days in VT323, what it was spent on, and More).
- What waits to be confirmed shows above the rows with its lamp in amber and Confirm, as today's confirmation does.
- On a phone: the characters as chips with their days, what waits, the rows, Log downtime, then the deadlines.

## 3. Rules for the Atlas and downtime

1. One right column: the pins, a pin's page and the editor take it in turn, with All pins or Back at its head.
2. A pin has its own menu on a right-click or a long press; the map's own menu keeps Add a pin here. Its page carries
   the same party and players actions as switches.
3. Hidden reads one way (F rule 2) for pins, maps and downtime; players never receive them.
4. Nothing new in what the controls do: every map, pin, link, reveal, party position and downtime keeps today's routes
   and words.
5. Dates are the campaign's: downtime days and deadlines count on its calendar.
6. Players' Atlas keeps their view: the tree of maps they can open, the pins they can see, and a pin's page as they read
   it, with no Edit, no menu items that change anything, and no hidden layer.
7. Phones: the map fills the screen; the pins and a pin as sheets from the foot; the editor full screen; 44 px hit
   areas.

## 4. Values

| Part            | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| Columns         | Maps 250 px; pins 360 px; the map the rest                              |
| Tree rows       | 38 px; the map icon 15 px; nested 16 px a level; pin counts VT323 16 px |
| Pin rows        | At least 44 px; the icon 22 px in its colour                            |
| Pins on the map | 30 px (24 px on a phone); their names 12 px 600 on a dark plate         |
| A pin's page    | The face 44 px; the name 22 px Chakra Petch capitals; switch rows 44 px |
| The pin's menu  | 270 px; rows 48 px (52 px on a phone)                                   |
| Downtime        | Side list 280 px; entry rows at least 48 px; days VT323 19 px           |
