# E2. Maps and tokens

Approved by the owner on 2026-10-30 after one round of mockups. E2 and E3.1 in `../CATALOG.md`, with the token picker
(C6.8): Prep's Maps page, one map's page, filing maps in folders, the Tokens page, and choosing a token's picture. They
sit inside Prep's frame (`../E-prep/SPEC.md`) and inherit the theme (`../T-theme/SPEC.md`) and the frame
(`../A-frame/SPEC.md`). `PLAN.md` beside this file is the work to build it; `maps-and-tokens.html` is the approved
mockup, and `history/` holds the round as it was shown. Every decision is built from settled parts; the mockup's Carried
in section lists them. The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) headed a map's menu and a creature's
menu as the map's menus are (2.3, 2.4), and gave a dialog on a phone its handle.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) put a choice field's caret at its right end, drew a
map's kind in its line as the map icon and its word, and wrote a folder's count as "3 maps in Act 1".

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) made the token picker's Cancel a ghost, the phone
folder chips "All maps 6" at 44 px, menu rows 48 px and token rows 48 px, and headed a new encounter's columns with
eyebrows.

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the token picker's close as the one close, a plain
18 px icon in 40 px, 44 px on a phone (T 2.2), and a folder's and a state's tag as VT323 16 px in a 22 px box (T rule
7), and gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id         | Surface                | Decided here                                  |
| ---------- | ---------------------- | --------------------------------------------- |
| E2.1       | The map list           | Folders at the side (2.1)                     |
| E2.2       | A map's page           | Beside the list, in the folders (2.2)         |
| E2.1, E2.2 | Filing maps in folders | A map's menu, and Choose for several (2.3)    |
| E3.1       | The Tokens page        | Party, Monsters and the GM's own groups (2.4) |
| C6.8       | The token picker       | Folders and a preview (2.5)                   |

Setting a map's grid (E2.3) keeps E's Steps (E 2.4). The map picker in an encounter's steps and the Atlas (E2.4) waits
for F3. The sound board and replays (E3.2 to E3.5) come in later rounds.

## 2. The decisions

### 2.1 The map list is folders at the side

- Under Prep's Titled bar (New encounter its Cup), the page is two columns: the folders at the left (240 px) and the
  maps at the right.
- The folders: an eyebrow FOLDERS, then All maps, each folder and No folder, each with its count in VT323 at the right;
  the chosen one lit as a chosen row (a 2 px cyan edge, a 8% cyan wash); New folder at the foot.
- The maps as E's shelf cards, three to a row at 1280 px: the map as the picture (16 by 10), its folder as a VT323 tag
  at the top left (left out while one folder is shown), the name, the grid as a ready line ("70 px squares" lit cyan, or
  "No grid yet" in amber, E rule 2), and the encounter that uses it with ▸.
- The toolbar over the cards: the count, then the types (All, Battle maps, Regional, World) as Base line controls,
  Modified (the order), Choose (2.3) and New map.
- New folder asks for its name in A's dialog, then turns Choose on with Move to {name} ready, since a folder exists once
  a map is in it, as today.
- On a phone: the folders as a row of Base line chips with their counts and New folder, the toolbar as the count with
  Filter, Sort and Choose, and the cards two to a row.

### 2.2 A map opens beside the list, in the folders

- Opening a map keeps the folders at the left (200 px) and its folder's maps as a list beside them (300 px: the picture,
  the name, the grid), the open one lit; the map's page fills the rest.
- The map's page: E's record title row (the name in display capitals with its type tag, one line with its folder, grid,
  use and when it changed, and Set the grid (again), New encounter on this map and More as Base line controls); under it
  the map, and a 270 px column with Grid (Edit), Type and folder (two fields), and Where it is used (each encounter as a
  small card with its state tag). File and history moves into More.
- New encounter steps down from the bar's Cup while a map is open (E rule 1).
- On a phone: the folder chips, then the folder's maps as rows; the open map opens under its row with its picture, its
  facts (type, folder, size, where it is used) and Open its page and Set the grid again. Open its page shows today's
  page in E's record frame.

### 2.3 Filing maps: a map's menu, and Choose for several

- A card's More (on hover and focus, always on touch) opens A's menu, headed with the map's name in display capitals and
  its line ("Battle map · Act 1"), as the map's menus are (C2): Set the grid, New encounter on this map, Rename, then
  FOLDER with the current folder marked "here", Move to {folder} for each other folder, Move to a new folder and Take
  out of its folder (today's items).
- Choose in the toolbar turns on choosing: each card carries a box at its top right, a chosen card is ringed in cyan,
  the toolbar says "2 of 6 chosen" with Choose all and Done, and a bar at the foot of the maps reads "2 maps chosen"
  with Move to. Move to opens A's menu of folders ("1 is here" beside a folder that holds some of them) with New
  folder…. Done or Escape ends choosing.
- On a phone the menu and the bar open from the foot.

### 2.4 The Tokens page: Party, Monsters and the GM's groups

- The creatures as rows in groups: Party (the characters), Monsters (everyone else) and any group the GM makes. Each
  group is an open group (T 2.3) with its name and count; a group the GM made says "Your group" with its own More
  (Rename, Delete group).
- A row: the creature's token as the map draws it (round, in the party's or the foe's ring; a dashed ring with ? for the
  default picture), its name, its kind, its picture's name and folder, Set token image and More. More opens A's menu
  headed with the creature's name in display capitals and its line ("Monster · Act 2 villains"), then Set token image
  and GROUP: Party, Monsters, each group the GM made (the current one marked "here") and New group….
- New group in the toolbar asks for a name in A's dialog. Party and Monsters cannot be renamed or deleted; deleting a
  group returns its creatures to Party or Monsters by their kind. A creature in no group of the GM's sits in Party or
  Monsters by its kind.
- Groups are the GM's alone: stored with the game, never sent to players or the table screen.
- On a phone: the same groups, each row the token, the name, the picture's name and More; New group in the toolbar.

### 2.5 The token picker is folders and a preview

- Set token image, wherever it opens (the Tokens page, the token's menu (C2), the Token tab, the sheet, Settings), opens
  A's dialog titled "Token image · {name}": the token library's folders at the left (All folders, each folder, Unfiled,
  with counts), the library in the middle (search, then Upload an image and the images as tiles, the chosen one ringed
  in cyan, the GM's eye on each), and at the right the token as it will look, large, with its name, the picture's name
  and folder, and who sees that folder. Cancel and Use for {name} (the Cup) at its foot.
- Previously used images lead the library while there are any, as today.
- A player's picker has the same parts with only what they are offered and their own uploads, and no eye.
- On a phone: from the foot, the preview at the top, the folders as chips, the library three to a row, and Done.

## 3. Rules for maps and tokens

1. Nothing new in what the controls do, but groups: every command and route stays (upload, rename, type, folder and grid
   for a map; a token's image and what players are offered). The token groups (2.4) are the one new stored value with
   their commands.
2. Token groups are GM-only: no player or table-screen projection carries them.
3. Folders in one place: the folder list at the side is where maps are filed and found; a map's menu and Choose move
   maps between the same folders.
4. One Cup: New encounter on Prep's lists; with a map open it steps down (E rule 1).
5. A missing grid is said once: "No grid yet" in amber wherever a map is listed or shown.
6. A token looks as it does on the map, wherever its picture shows.
7. Players and the library: an offered image carries the cyan eye, a held-back one the eye struck through; a player's
   picker leaves the held-back ones out.
8. Phones: folders as chips, a map under its row, menus, the Choose bar and the picker from the foot, 44 px hit areas.

## 4. Values

| Part         | Value                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Folders      | 240 px on the list, 200 px beside an open map; rows 40 px, 13.5 px 600; counts VT323 16 px                               |
| Map cards    | E's: from 270 px, 16 px apart, three to a row at 1280 px; the folder tag VT323 16 px, 22 px high, 8 px in                |
| The open map | List 300 px of 68 px rows; the record's column 270 px                                                                    |
| Choose       | The box 22 px, cyan when chosen; a chosen card ringed 2 px cyan; the bar 8 px 12 px on glass, the count VT323 20 px cyan |
| Token rows   | 48 px; the token 40 px round, 2 px ring; group heads 11 px capitals                                                      |
| The picker   | 1100 px wide on a laptop; folders 200 px, preview 260 px; tiles from 104 px with an 84 px token                          |
