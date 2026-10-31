# T. Consistency: the shared parts

Approved by the owner on 2026-10-30 after the consistency sweep. The sweep captured every side list, title row, menu,
phone sheet and dialog in the 23 approved mockups and laid them side by side; seven differences came out of it, and the
owner asked for all seven to be fixed. The fixes are made in each approved mockup and its spec, and four of them are now
rules every area follows: rules 13 to 16 in `../T-theme/SPEC.md`. A second sweep the same day covered the parts the
first one left out (section bars, phone headers, where the primary sits, tabs, toolbars, fields, tags, the frame); the
owner asked for all eleven of its fixes too, and section 5 records them (ADR-0073, theme rules 17 to 19 and amendments
to 2, 9, 12, 13 and 14). A third sweep on 2026-10-31 covered buttons, rows, the controls in rows, empty states, steps,
rolled numbers, boxes, the GM ONLY tag, colours, display titles, widths, dates and overlay edges, and checked the
theme's rules page by page; the owner asked for all twenty of its fixes, and section 6 records them (ADR-0074, theme
rule 20 and amendments to 2.2, 2.5 and rules 2, 7, 8, 9, 10 and 11). A fourth and final sweep the same day checked the
mockups as the third left them, in Dusk and Dawn, with eyebrows and notices added; the owner asked for all sixteen of
its fixes, and section 7 records them (ADR-0075, theme rule 21 and amendments to 2.2, 2.4, 2.5 and rules 8, 9, 19 and
20). A fifth sweep, asked for twenty-four findings, found twenty-five; the owner asked for all of them, and section 8
records them (ADR-0076, amendments to 2.2, 2.4, 2.5 and rules 4, 9 and 19). `consistency.html` beside this file shows
every shared part as the mockups now draw it, `history/1-sweep.html` to `history/5-sweep.html` are the five sweeps as
they were shown, the fourth and fifth with each fix before and after, `history/3-before-after.html` sets each of the
third sweep's fixes before and after, and `PLAN.md` is the work to build the shared parts once and use them everywhere.

## 1. What it covers

| Fix | Part                        | Out of line before                                  | Fixed in                             |
| --- | --------------------------- | --------------------------------------------------- | ------------------------------------ |
| 1   | Settings' side list         | Settings and Time and tools drew tall two-line rows | I, F's time and tools (ADR-0071)     |
| 2   | Faces on people's rows      | The Downtime tab's characters had no faces          | F3                                   |
| 3   | The crumb on the title line | Four pages put the crumb on its own line above      | F's time and tools, H, I's leftovers |
| 4   | A menu that names its thing | Four menus opened with a small eyebrow, or nothing  | F3, E2, C3's running round           |
| 5   | How a phone sheet opens     | Some had a handle and no close, some the reverse    | C3, C5, D, E2, E3, F, G, I           |
| 6   | No count in an eyebrow      | The Atlas said MAPS · 4                             | F3                                   |
| 7   | The Atlas tree's rows       | No icon; a word at the right where others count     | F3                                   |

## 2. The decisions

### 2.1 One side list (T rule 13)

- Every list at the side of a page is drawn one way, the way E2's folders (E2 2.1) and G's sources (G2 2.1) are: an
  eyebrow in capitals naming what the list holds, then one row a thing: its name, and at the right its count or state in
  VT323. A row that names a kind of thing (a folder, a kind, a map, a section) has its icon before the name, a person
  their face at 20 px; a row that filters (All maps, Active, Not on the board, a deadline) has none (second sweep, fix
  11). The chosen row is lit cyan with a 2 px edge at its left.
- The eyebrow never carries a count; the counts sit on the rows (MAPS, not MAPS · 4).
- A tree nests 16 px a level. What a thing is (a world, a battle map) goes in its own line where it opens, not on its
  row.
- Search results in a side list keep its rows, grouped under each section's eyebrow, the first one lit (Settings).
- On a phone the list is the first page with rows of 48 px, or a row of chips where the page keeps the content in view.
- Drawn this way now: Maps' folders, the token picker's folders, the sound board, the pages index, quests, the
  Compendium's sources and sharing, the templates, the calendar's parts, Settings with its Codex group and its search,
  the Atlas tree, and the Downtime tab's characters and deadlines.

### 2.2 The crumb sits on the title's line (T rule 14)

- A title row with a way back puts its crumb before the title on the same line, with the back chevron, in the crumb's
  label type ("‹ PEOPLE SISTER ILSA VARN"), as an encounter, a Codex page and a Compendium record already did.
- Now the same: Prep templates and the calendar ("‹ MORE"), a screen's remote ("‹ TABLE SCREEN"), an operation's page
  ("‹ ALL OPERATIONS") and a credential's page ("‹ ACCESS").
- On a phone a record may stack its crumb above its title, as a Codex page does; the header's Back does the going back.
- A section's own head (Settings' sections, Players, API) has no crumb: the side list says where you are.

### 2.3 A menu about one thing names it (T rule 15)

- A menu about one thing opens with its name in display capitals and its line beside it, as the map's menus do ("GOBLIN
  BOSS Monster · 15/21"); its groups follow under eyebrows. When the line does not fit beside the name it drops under
  it.
- Now the same: a pin's menu ("THE RUINED KEEP Ruin · 3 pins"), a map's menu in Maps ("RUINED KEEP Battle map · Act 1"),
  a creature's menu in Tokens ("FLAMESKULL Monster · Act 2 villains") and the encounter's options ("OLD ROAD Encounter ·
  round 2", its first group now How it runs).
- A menu that offers a choice keeps its eyebrow as its head: File it under, Move 2 maps to, Reveal to, Add to the
  chronicle.

### 2.4 A phone sheet opens one way (T rule 16)

- Every sheet on a phone opens with the handle, then its title and the close button at the right over a hairline, then
  the content, with its primary pinned at the foot.
- A sheet whose head is a thing (a creature, a party member) keeps that head as its title, with the close at its right.
- Now the same: a creature's tools and the encounter's options (C3), the dice options (C5), Level up and a party member
  (D), the token picker (E2), a replay's actions (E3), adding a section (F), the Compendium's filters (G), two devices
  (G's pages) and New credential (I). A party member's sheet loses its Close at the foot for the close at its head.
- On a laptop a dialog keeps A's head: the title on the horizon edge and the close at the right.

### 2.5 The Atlas's list (fixes 6 and 7)

- MAPS, without a count. Each map's row: the map icon, its name, its pin count in VT323; nesting by indent.
- What the map is moves to its line on the map's glass, under the crumbs: "Regional map · 5 pins · 1 hidden".

### 2.6 Faces on people's rows (fix 2)

- A person in a side list carries their face at 20 px before their name, as the party's rows do elsewhere. The Downtime
  tab's characters do now.

## 3. Rules

These are rules of `../T-theme/SPEC.md`; an area's spec may add to them but never contradict them.

13. One side list.
14. A crumb sits on the title's line.
15. A menu about one thing names it.
16. A phone sheet opens one way.
17. A list's toolbar reads one way (second sweep).
18. Fields: the caret at the right end, the find field's icon and muted placeholder (second sweep).
19. A state is a boxed tag, a kind is its icon and word, readiness is a lamp and words (second sweep).
20. Dates and times read one way, and a chip's count follows its label (third sweep).
21. A notice reads one way (fourth sweep).

The second sweep also amended rule 2 (one Cup in view, words only), rule 9 (magenta's meanings), rule 12 (what a phone
header names), rule 13 (which rows carry an icon) and rule 14 (the crumb on a phone). The third sweep amended 2.2 (when
a description carries the GM ONLY tag), 2.5 (danger, the ghost, hit areas on a phone, icon buttons, switches and ticks),
rule 2 (a menu's caret on the Cup), rule 7 (where the GM ONLY tag goes and its one size), rule 8 (menu and table rows),
rule 9 (a harmful condition is red), rule 10 (heads inside a page) and rule 11 (a column beside a side list). The fourth
sweep amended 2.2 (title sizes on a phone, in a dialog and in a sheet), 2.4 (one eyebrow), 2.5 (what counts as a control
on a phone, and neighbours' lines), rule 8 (a menu's rule inside its row), rule 9 (no horizon on a card), rule 19 (a
state's colour) and rule 20 (a date field). The fifth sweep amended 2.2 (a dialog's close, a title in a page), 2.4 (the
eyebrow's other places, a bar of actions), 2.5 (segments, steppers, tabs, icons in buttons, a toast's close, fields),
rule 4 (one mark), rule 9 (text shades) and rule 19 (one tag, one lamp, Saved, one kind card).

## 4. Values

| Part                | Value                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Side list           | Rows 38 px (48 px on a phone); icon 15 px or face 20 px; count VT323 16 px; chosen edge 2 px                      |
| Its eyebrow         | 11 px capitals, letter spacing 0.12em, 10 px above and 6 px below, no count                                       |
| A tree              | 16 px a level                                                                                                     |
| A crumb             | Label type 12 px with a 14 px chevron, 12 px before the title, on the title's baseline                            |
| A menu's head       | Name 15 px display capitals; line 12 px muted, 10 px after the name or under it when narrow                       |
| A sheet's handle    | 40 by 4 px, `--line-raised`, centred 6 to 8 px from the top                                                       |
| A sheet's head      | 48 to 56 px; the title 20 px display capitals; the close a 44 px hit area at the right; a hairline                |
| A dialog's title    | 20 px display capitals                                                                                            |
| A title row         | The title 24 px display capitals on a laptop, 20 px on a phone                                                    |
| An eyebrow          | Bai Jamjuree 600, 11 px capitals, 0.12em, `--text-muted`; a crumb keeps its 12 px label type                      |
| A tag               | VT323 16 px in a 22 px box, for a state, a condition, a source and a folder                                       |
| A dialog's close    | A plain 18 px icon in a 40 px button, 44 px on a phone                                                            |
| A title in a page   | 22 px on a laptop, 20 px on a phone                                                                               |
| A stepper           | 40 px (44 px on a phone); its number VT323 22 px; the minus sign                                                  |
| A step's mark       | 24 px; its number VT323 17 px                                                                                     |
| A tab               | 44 px; 14 px words                                                                                                |
| A field             | The section bar's search 38 px; a form field 40 px, 44 px on a phone                                              |
| A lamp              | 8 px; the turn's action lamps 11 px                                                                               |
| A kind card         | Its icon and name, the count under them in VT323 30 px, its line                                                  |
| A coloured word     | `--caution-text`, `--magenta-text`, `--violet-text`; in Dawn `#875400`, `#a3246b`, `#6a44bf`                      |
| A notice            | A 1 px frame of its colour at 45% over `--line-strong`, a 3 px edge at its left, no fill, its words `--text`      |
| A list's toolbar    | Count 13 px `--text-dim` in plain words; sort a Base line button with the sort icon and its word                  |
| A choice field      | Its icon 15 px, the value, the caret 15 px at the right end                                                       |
| A find field        | The search icon 15 px; the placeholder `--text-muted`                                                             |
| A Base line button  | 36 px face on a laptop with `.tap-target`; 44 px on a phone; 6 px apart; a ghost only for Cancel or Back by a Cup |
| An icon button      | 36 px on its Base line in content; 44 by 44 on a phone, the header's icons and a sheet's close too                |
| A danger action     | `--danger-text` on the Base line; in a menu a `--danger-text` row with the bin icon                               |
| A switch            | A 46 by 26 track inside its 1 px edge, an 18 px knob, cyan with `--glow-on` when on; ticks of 18 px for several   |
| Menu rows           | 48 px, the rule between rows inside it; 52 px in a phone sheet                                                    |
| Table rows          | 48 px                                                                                                             |
| Settings' column    | 880 px, beside the side list                                                                                      |
| The reading measure | 680 px                                                                                                            |
| The GM ONLY tag     | VT323 16 px in a 22 px violet box                                                                                 |
| A date and a time   | "Oct 30, 7:40 PM", "Today, 8:41 PM", the year only when it isn't this one; Bai Jamjuree                           |

## 5. The second sweep

The owner asked for another sweep before the next round. It captured the section bars, phone headers, tabs, segmented
controls, fields, toolbars, tags, cards, glass over maps, the top bar and the phone's tabs from every page of the 23
approved mockups, and where every primary sits; `history/2-sweep.html` is the sweep as it was shown. Segmented controls,
switches, group heads, cards, glass, state tags and the phone's tabs already matched.

| Fix | Part                               | Out of line before                                                             | Fixed in                          |
| --- | ---------------------------------- | ------------------------------------------------------------------------------ | --------------------------------- |
| 1   | One primary in view                | 18 Codex and Compendium pages showed the bar's Cup and their own               | F, F3, G, E3, H                   |
| 2   | What a phone header names          | Section pages named their page; records named four different things            | F, F3, G's pages, H, E3's replays |
| 3   | Strips a later round changed       | The story's tabs without Downtime; H's Prep tabs; the Codex bar's More         | F, F3, H                          |
| 4   | A list with a title row            | Replays repeated its tab as REPLAYS                                            | E3's replays                      |
| 5   | A list's count and sort            | Three ways to count, three ways to sort                                        | F, G, G's pages, E2               |
| 6   | Fields                             | The caret before the value; bright placeholders; a find field without its icon | E2, F, F3, I's leftovers          |
| 7   | The Cup with an icon               | New credential and New homebrew carried a +                                    | I, I's leftovers, G, G's pages    |
| 8   | Who sees a replay                  | A magenta eye for shared, a muted one for only you                             | E3's replays                      |
| 9   | A map's kind                       | Battle map drawn as a boxed state                                              | E2                                |
| 10  | A player watching a replay         | "Playing Lyra" in the menu button; no lit page on the laptop                   | E3's replays                      |
| 11  | Which side list rows carry an icon | Rule 13 asked an icon of every row                                             | T rule 13                         |

### 5.1 One primary in view (T rule 2)

- When a page shows its own Cup (Start session 3, Log downtime, Publish, Make a homebrew copy, Watch, Go to the table),
  the section bar's New steps down to a Base line button with its + (+ New, + New homebrew, + New encounter). The bar
  keeps its search on every page.
- When a page shows two of its own, the step's or the open panel's keeps the Cup and the title row's steps down: the
  Compendium's editor keeps Next and steps Done down; a record's sharing keeps "Publish and share with" and steps
  Publish down.
- Quests' New quest in its toolbar is a Base line button, as the pages index's New page is.
- Prep's bar on Sound, Replays and the table screen's Prep has its search and New encounter again, with all seven pages.
- A dialog's Cup sits over a scrim and doesn't count.

### 5.2 What a phone header names (T rule 12)

- A section's page names the section: CODEX on the Atlas and the story too, with the strip naming the page.
- A record's header is Back and where it goes, with the record's own icons and no strip: ‹ PEOPLE (a Codex page, with
  Edit and More), ‹ TIMELINE (an entry), ‹ MONSTERS (an SRD or homebrew record), ‹ TABLE SCREEN (a screen), ‹ REPLAYS (a
  replay). The record's title opens its content with its line; a Codex page loses its stacked crumb.
- A page below the top that isn't a record keeps Back and its own name (‹ DEVICE, ‹ PREP TEMPLATES, ‹ CALENDAR).
- This settles A 2.2 ("a record shows its title") against T 2.2 ("at the top of its content"): the content.

### 5.3 Strips a later round changed

- The story's tabs are Chronicle, Timeline, Sessions and Downtime everywhere, a phone's included (Time and tools drew
  them as a segmented control; they are tabs).
- The table screen's Prep bar has all seven pages.
- The Codex bar's More after New, which F's spec places (F rule 8), is in every Codex mockup.
- The table panel's tabs in A's and C's frames were checked and left: the Token tab shows only while a token is chosen
  (C rule 8), and the bell and counts only when something waits or is unread, which those frames don't draw.

### 5.4 A list has no title row; its toolbar reads one way (T rules 17, 1)

- Replays loses REPLAYS; its toolbar opens with "5 replays".
- Counts: "4 people", "2 active quests", "4 homebrew records", "3 maps in Act 1", "8 of 332".
- Sort: the sort icon and its word (Changed, Modified, By name).

### 5.5 Fields (T rule 18)

- Maps' type and folder fields put the caret at the right end.
- Find a page by name, Find a quest, Filter pins and the API reference's field have a muted placeholder; the API
  reference's field gets its search icon.

### 5.6 The Cup, a replay's eye, a map's kind, a player's menu button (T rules 2, 9, 19; A 2.1)

- New credential and New homebrew are words only.
- A replay's eye is the dim text colour when players see it; violet and struck through when only you do.
- A map's page shows its kind in its line as the map icon and "Battle map".
- A player's menu button is their face alone, as A 2.1 says, and watching a replay lights Table on the laptop as on the
  phone, where a player's replays sit under the Me tab (E3 2.5).

## 6. The third sweep

The owner asked for one last sweep of what neither earlier sweep covered, checking the theme's rules page by page. It
captured every button, row, control in a row, empty state, steps rail, rolled number, box, GM ONLY tag, hidden block,
coloured word, display title, capped width, number, date and overlay from every page of the 23 approved mockups: 4,343
captures from 127 pages, each measured from its computed style. `history/3-sweep.html` is the sweep as it was shown, and
`history/3-before-after.html` sets each fix before and after. Rolled numbers, sliders and steppers, hidden blocks and
their tags, scrims, the horizon on dialogs, menus and toasts, the Cup's heights against each area's values, waiting
cards and the verbs for deleting, removing and taking out already matched. The first two sweeps' parts, captured again,
rebuilt `consistency.html` byte for byte.

| Fix | Part                          | Out of line before                                                              | Fixed in                                                |
| --- | ----------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Settings' groups              | Full boxes with a fill; the players' table a box inside a box                   | I, I's leftovers, F's time and tools                    |
| 2   | Arrival's Cups                | An arrow after the words                                                        | B                                                       |
| 3   | Phone controls                | 239 of 301 buttons and Cups under 44 px                                         | Every area with a phone                                 |
| 4   | Danger                        | A red outline, a bare red word, grey ghosts, two menu reds                      | I, I's leftovers, H, F3                                 |
| 5   | Ghost buttons                 | Standing in for secondaries; Cancel and Back beside a Cup drawn two ways        | E2, E3, F, F3, G, G's pages, H, I, I's leftovers        |
| 6   | Display titles                | The roster's names and steps' heads in display type                             | D, E, E2, G, G's pages, F's time and tools              |
| 7   | The builder's Steps rail      | Its own done mark, a horizon edge, a dashed amber mark                          | D                                                       |
| 8   | Phone sheets' top edge        | Cyan or amber on three sheets                                                   | C2, C3, C3's running, C4 and C6, C5                     |
| 9   | The phone table's switch      | Inside a boxed well                                                             | C2, C3, C3's running, C4 and C6, C5                     |
| 10  | Switches                      | A 38 by 22 track with no glow                                                   | B and every piece with Prep's parts                     |
| 11  | Picking several               | Switches in Settings                                                            | I, I's leftovers                                        |
| 12  | Icon buttons and a row's More | Icons with no line; Actions as a word                                           | E3's sound and replays, G, G's pages, I                 |
| 13  | Row heights                   | Menu rows 40 to 49 px, table rows 40 to 60 px, phone rows under 44 px           | C2 to C5, E2, E3, F, F3, G, G's pages, I                |
| 14  | Base line buttons             | 34 px in the table's panels and a session's template chips; 38 and 40 px        | C, C2 to C5, D, E3's replays, F's time and tools, I     |
| 15  | Colours                       | Poisoned amber, a magenta timeline, GET cyan and POST party blue                | D, F's time and tools, I's leftovers                    |
| 16  | Dates, times and counts       | Five ways to write a date and time, one in VT323, one lowercase; "All maps · 6" | E2, E3's replays, F, G's pages, I, I's leftovers        |
| 17  | Empty states                  | An instruction with no button                                                   | F3, F's time and tools, G, G's pages                    |
| 18  | Copy                          | "her" and "him" for characters, "Choose…", Save and close                       | C2, C3, C3's running, C4 and C6, C5, D, E3's replays    |
| 19  | The GM ONLY tag               | Two sizes; rule 7 asked for it where no page draws it                           | C2, C4 and C6, C5; T rule 7                             |
| 20  | Widths                        | Settings' column 860 px; the Codex's measure 640 px                             | I, I's leftovers, F's time and tools, every Codex piece |

### 6.1 Settings' groups are Cradles (fix 1; T 2.4, rule 6)

- Settings' groups, its leftovers' and the Codex's tools' are the Cradle: a 2 px base, sides that fade before the open
  top, no fill. I's values table says so.
- The players at the table sit in the Join address group divided by 1 px `--line`, with no box of their own.

### 6.2 Buttons (fixes 2, 3, 4, 5, 12 and 14; T 2.5, rule 2)

- The Cup is words only; arrival's five lose their arrow. A Cup that opens a menu (the Codex's New) keeps its caret.
- On a phone every button, chip, icon button, segment and Cup is at least 44 px tall, and the header's icons and a
  sheet's close are 44 by 44. Every mockup's `p4t-touch.css` draws this once for its phone frames.
- On a laptop a Base line button is 36 px: the table's panels and a session's template chips grow from 34 px, the
  builder's head and replays' chips settle from 38 px, Save formula from 40 px. A step's foot keeps its Back as tall as
  its Cup (C's values).
- A danger action is its label in `--danger-text` on the Base line: Sign out every GM browser, Revoke (the credentials'
  table and a credential's page), Revoke this screen, Release. A menu's delete is a `--danger-text` row with the bin
  (Delete pin, Delete replay).
- The ghost is only for Cancel or Back beside a Cup. Cancel and Back are ghosts in every foot; Rotate, History, Token
  image, Clear, Clear all, Show all 14, Open the sound board and a screen's Open sit on the Base line.
- An icon button in content is 36 px on its Base line: sound's rows and player, replays' eye and the Compendium's pane
  chevrons. A row's More is its dots; Settings' players lose the word Actions. The table screen's preview keeps plain
  icons in its head, as an overlay's head does.

### 6.3 Rows and the controls in them (fixes 9, 10, 11 and 13; T 2.5, rule 8)

- Menu rows are 48 px, 52 px in a phone sheet. A table's rows are 48 px on a laptop and a phone. On a phone the Codex's
  lists, the Compendium's filter options, replay steps and a faction's tiers are at least 44 px. The table screen's turn
  order on a phone is the TV's own display and keeps its rows.
- The phone table's switch is words on base lines, the chosen on 2 px cyan, with no well, as C draws it.
- One switch: the square 46 by 26 track with an 18 px knob, cyan with its glow when on (`docs/DESIGN.md`).
- Picking several from a list is ticks: Settings' fourteen scopes, its four ability score methods and the rules
  assistant's six checks, as C3 ticks who is in an encounter and the Compendium its filters.

### 6.4 Steps, sheets, titles, colours, dates, empty states and copy (fixes 6, 7, 8 and 15 to 18)

- The builder's and Level up's rails take Prep's marks: done a solid cyan box with a dark tick, the current step a 3 px
  cyan edge and a 2 px cyan outline, a choice needed a solid amber box.
- Every phone sheet carries the horizon on its top edge: a creature's tools, the encounter's options and the dice
  options too.
- The roster's names are Bai Jamjuree 600. A step's or a column's head is an eyebrow: To make it ready, Pick a map,
  Grid, Defences, Months.
- A harmful condition is red, as Prone is on the table. The timeline's entries take a `--line-raised` edge, cyan when
  chosen. GET and POST are the dim text colour; DELETE keeps `--danger-text`.
- A date and its time read "Oct 30, 7:40 PM" and "Today, 8:41 PM", the year only when it isn't this one, in Bai Jamjuree
  with their capitals (T rule 20). Maps' phone chips read "All maps 6".
- An empty list says what is missing and offers its button: "No pins on this map yet." with + Add a pin; "No spell lists
  yet." with + New homebrew.
- Characters by name: "stabilizes Lyra", "past Lyra's speed", "hit Mirena for 7. Mirena keeps Bless", and a replay's
  "Dashes after the Goblin Boss". An empty choice field shows "None". Leaving a making flow with its draft kept is Done.

### 6.5 The GM ONLY tag and widths (fixes 19 and 20; T rules 7, 11)

- One GM ONLY tag: VT323 16 px in a 22 px violet box, the log's included. It marks what only the GM sees on a surface
  players also see (a row, a group, a roll); a section only the GM opens carries none.
- Settings' column is 880 px, set beside its side list; the Codex's reading measure is 680 px.

### 6.6 Two corrections to the sweep as shown

- Finding 12 named the table screen's plain icons. They are the preview's head and the phone header, which stay plain as
  overlay heads and headers do; the header's + grows to 44 px with fix 3.
- Finding 13 named the table screen's turn order on a phone. It is the TV's own display, which takes no touch, so it
  keeps its rows.

## 7. The fourth sweep

The owner asked for one last, final sweep of the mockups as the third sweep left them. It captured every page of the 23
approved mockups at laptop and phone size, in Dusk and in Dawn, with the third sweep's parts plus eyebrows, notices and
the icons inside buttons: 4,731 captures from 127 pages, each measured from its computed style. Dawn drew the same parts
at the same sizes. `history/4-sweep.html` is the sweep as it was shown, each finding with its parts before and after the
fix, drawn from a preview copy of the mockups. Switches, the GM ONLY tag, the horizon on overlays, danger actions, the
Cradle, the Steps rails in the builder, Prep and the Compendium, empty states, widths, section bar and phone header
names, menu heads and copy already matched. The owner asked for all sixteen fixes.

| Fix | Part                       | Out of line before                                                                    | Fixed in                                                                  |
| --- | -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Level up's step marks      | 46 px squares: the step's rule reached the mark inside it                             | D                                                                         |
| 2   | The Compendium's chips     | Filter chips, the open records button and the phone's Filters boxed, a ring when on   | G                                                                         |
| 3   | A date in a table          | "Today, 8:41 PM" broke over two lines                                                 | I, I's leftovers                                                          |
| 4   | Phone headers on records   | The pin editor kept the Codex strip and a second Back; a faction kept CODEX and strip | F3, F's story and people                                                  |
| 5   | Phone controls             | A dozen parts with their own classes under 44 px                                      | A, B, C2, C3, C5, D, F, G, I; `p4t-touch.css` in every mockup             |
| 6   | Base line buttons          | 28 to 32 px and 39 px; neighbours' lines run together                                 | C, C2 to C5, E3's replays, F's finding and pages and time and tools, G, I |
| 7   | The horizon on a card      | The Codex's next session card                                                         | Every Codex piece                                                         |
| 8   | Ghosts                     | Token image and Release on Settings' list                                             | I's leftovers                                                             |
| 9   | A column's head on a phone | To make it ready in display type                                                      | E                                                                         |
| 10  | Dialog and sheet titles    | 15, 16, 18 and 19 px beside 20 px                                                     | C3's running, C5, E3, F's story and people and time and tools, F3, G, I   |
| 11  | Title rows                 | 22 px on a laptop and 19 px on a phone                                                | E, E3's replays and sound, F's time and tools, I's leftovers              |
| 12  | Eyebrows                   | Eight styles, 9.5 to 11.5 px, 0.08 to 0.14em                                          | B, C to C5, D, E3's replays, F, G and every piece sharing their parts     |
| 13  | Notices                    | Six ways: bands, an amber box, an amber edge, a dashed violet box, amber words        | A, C5, F's finding and pages, F3, G, G's pages                            |
| 14  | Dates                      | "Oct 2, 2026" in this year's list; "2026-11-08" in a field                            | E3's replays, F's time and tools                                          |
| 15  | Rows                       | Phone rows 34 to 40 px; menu rows 49 px                                               | E3's sound, G's pages, I; every menu                                      |
| 16  | The SAMPLE tag             | Party blue                                                                            | D                                                                         |

### 7.1 Steps, chips and buttons (fixes 1, 2, 5, 6 and 8; T 2.5, rule 4)

- Level up's rule for a step reaches only the steps (`.dsteps > span`), so each mark is its own 20 px box, as Prep's,
  the builder's and the Compendium's are.
- The Compendium's filter chips sit on a Base line with their ×; the open records button ("3 records open", "3 open")
  and the phone's Filters are Base line buttons with their counts, a 2 px cyan base while on.
- On a phone the parts that drew their own size meet the 44 px floor: search's Cancel, arrival's Dusk and Dawn, C2's
  Others can move this, the composer's dice, every stepper, Level up's choice, the writer's toolbar, the audience,
  Climb, fly or swim, and a chip's ×, which takes the chip's height. `p4t-touch.css` draws them with the rest.
- On a laptop every Base line button is 36 px: Mark used, Own tab, a replay's token chips and Watch, the tag chips, a
  record's linked chips, the audience, the empty spell lists' New homebrew, and the credentials' Rotate, Revoke and
  History, which stand 6 px apart so each keeps its own line.
- Settings' list draws a player's Token image on its Base line and Release in `--danger-text`, as At the table does.

### 7.2 Headers and titles (fixes 4, 9, 10 and 11; T 2.2, rules 10 and 12)

- The pin editor on a phone reads as writing a page: the header Editing, the pin's name with Saved, its tabs and Done,
  with no strip and one way back. A faction's page on a phone has the header ‹ PAGES and no strip, as a Codex page has.
- To make it ready is an eyebrow on a phone too.
- Every dialog's and phone sheet's title is 20 px display capitals.
- A title row's title is 24 px on a laptop (Setting a grid, a replay, Prep templates, the calendar) and 20 px on a phone
  (an encounter's sound, a credential's history).

### 7.3 Eyebrows, notices, colour and dates (fixes 7, 12, 13, 14 and 16; T 2.4, rules 9, 19, 20 and 21)

- One eyebrow: Bai Jamjuree 600, 11 px capitals, 0.12em, `--text-muted`, for the option table's heads, a spell card's
  facts, the map tools' labels, the builder's facts, a death save's Saves and Fails, the log's round lines, replays'
  column heads, a Codex page's facts, the Compendium's CR and Type, and arrival's AC, HP, Speed and Players join at.
  Colour stays where it carries a meaning; a crumb keeps its 12 px label type.
- One notice (rule 21): a 1 px frame with a 3 px edge at its left in its meaning's colour, no fill, its words in
  `--text`, as the Compendium's Needs you draws it. Reconnecting and Advantage is armed are amber, reading an old
  version cyan, the note that players never get a stat block violet; a downtime that waits keeps amber.
- A card never carries the horizon: the next session's card keeps its cyan tint, and its Cup carries the horizon.
- The replays list writes "Oct 2"; a date field shows "Nov 8". SAMPLE is a state in the dim text colour.

### 7.4 Rows (fixes 3 and 15; rule 8)

- A table's date cell stays on one line, so "Today, 8:41 PM" no longer stands its row taller.
- On a phone an encounter's sound rows, a record's sharing options, the new credential's scopes and Settings' switch
  rows are at least 44 px.
- A menu row's rule sits inside its 48 px.

### 7.5 A correction to the sweep as shown

- Finding 13 named a record changed on two devices among the amber boxes. Its notice sits under the phone's sheet, where
  nothing shows it; it takes the one notice with the rest, and the sheet itself says what changed.

### 7.6 Noticed, and left as it is

- The approved mockups declare no character encoding, so a browser opening one from disk has to guess; once in this
  sweep it guessed wrong and drew "›" as "â€º". The app's `index.html` declares UTF-8, so only the mockups are open to
  it. The sweep's captures check the encoding on every load.

## 8. The fifth sweep

The owner asked for one more sweep, and for twenty-four findings where the last found sixteen. It captured every page of
the 23 approved mockups at laptop and phone size, in Dusk and in Dawn, with every earlier part plus tags, faces, closes,
tabs, fields, lamps, cards, keyboard hints, text that is clipped, spills or wraps, and the contrast of every line
against what is behind it: 5,490 captures from 127 pages, each measured from its computed style. It found twenty-five.
`history/5-sweep.html` is the sweep as it was shown, each finding with its parts before and after the fix, drawn from a
preview copy of the mockups. The fourth sweep's fixes held, no text is clipped, every line passes contrast in Dusk, and
keyboard hints and cards read one way. The owner asked for all twenty-five fixes.

| Fix | Part                        | Out of line before                                                                   | Fixed in                                                                                    |
| --- | --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1   | The table screen on a phone | The laptop's PREP bar under the header, its search over its tabs                     | H                                                                                           |
| 2   | Dawn's coloured words       | Amber 2.3:1, magenta 2.7:1, violet 3.6:1                                             | Every mockup (text shades)                                                                  |
| 3   | Kind cards                  | The Compendium's laptop home drew its own                                            | G                                                                                           |
| 4   | The frame's turn order      | 28 px faces on a 1 px rim, other initials                                            | A                                                                                           |
| 5   | The stat block's name       | Repeated under the record's title, larger                                            | G, G's pages                                                                                |
| 6   | Bars of actions             | Full boxes with a fill                                                               | F, F's story and people, G                                                                  |
| 7   | A read-only group           | Recently changed drawn as a box                                                      | F                                                                                           |
| 8   | A condition                 | Prone in Bai Jamjuree 10.5 px, Poisoned a VT323 tag                                  | C, C2 to C5                                                                                 |
| 9   | Closes                      | Plain, on a Base line, or the word Done                                              | C3's running, C5, E2, E3's replays, F's time and tools, G, G's pages, I                     |
| 10  | The Dusk and Dawn switch    | 32 px in arrival and A's menu, 36 px in Settings                                     | A, B, H                                                                                     |
| 11  | Steppers                    | 32 and 40 px; numbers 19, 22 and 24 px; a hyphen for minus                           | C5, G                                                                                       |
| 12  | Boxed Bai Jamjuree words    | CLAIMED, GET and POST, a template's parts                                            | B, I's leftovers, F's time and tools                                                        |
| 13  | A hashtag                   | A boxed tag in time and tools, a Base line chip in the pages index                   | F's time and tools                                                                          |
| 14  | Titles in a page            | 17 to 22 px on a phone, 21 and 22 px on a laptop                                     | E3's replays, F, F's finding and pages, F3, F's time and tools, G, G's pages, I's leftovers |
| 15  | Steps marks                 | 22, 24 and 26 px; numbers 14, 16 and 17 px                                           | D                                                                                           |
| 16  | Saved                       | Muted words in the Atlas and time and tools                                          | F3, F's time and tools                                                                      |
| 17  | The ruling card             | A violet rim on a box                                                                | C3; the same code in C2, C3's running, C4 and C6 and C5                                     |
| 18  | Tags                        | 20 and 22 px                                                                         | C5, D, E, E2, E3's sound, every Codex piece, F3, G, G's pages                               |
| 19  | Icons in content buttons    | 13, 16 and 20 px                                                                     | B, E3's sound and replays, F's time and tools, G, G's pages                                 |
| 20  | Tabs                        | 42, 44 and 45 px; 13 and 14 px words                                                 | A, C to C5, D, E, E3's sound and replays, every Codex piece, F3                             |
| 21  | Fields                      | The search 36 and 38 px; form fields 32, 36, 38 and 40 px                            | C2, C3's running, C5, F, F's finding and pages, F's time and tools, F3, G, I, I's leftovers |
| 22  | Lamps                       | 7, 8, 9 and 10 px                                                                    | A, B, C to C5, H                                                                            |
| 23  | Eyebrows                    | Field labels and timeline heads at 0.1em, counters at 10.5 and 12.5 px, status words | F's time and tools, F's story and people, F3, C5                                            |
| 24  | A toast's close             | 36 by 26 px and 28 by 26 px                                                          | A, H                                                                                        |
| 25  | A template's drag handle    | 22 by 16 px on a phone                                                               | F's time and tools                                                                          |

### 8.1 Pages and colour (fixes 1 and 2; rules 9 and 12)

- The table screen's phone pages behind the menu and the docked preview stack the header and Prep's strip, as Prep's own
  phone pages do.
- Amber, magenta and violet words take their text shades, `--caution-text`, `--magenta-text` and `--violet-text`, as a
  danger word and a cyan word already do. In Dusk the shades are the colours themselves; in Dawn they are `#875400`,
  `#a3246b` and `#6a44bf`, each 5:1 or better on Dawn's grounds. Lamps, edges and fills keep the colour. Each mockup's
  `p1-head.html` defines them, and every rule and inline style that colours a word uses them.

### 8.2 Parts drawn one way (fixes 3 to 13, 15 to 22, 24 and 25; T 2.2, 2.4, 2.5, rules 4, 7 and 19)

- One kind card: its icon and name, the count under them in VT323 30 px, its line; the Compendium keeps its examples.
- The frame's turn order draws the table's faces, 38 px on a 2 px rim and 34 px on a phone, with G2, GB and B.
- Inside its record the stat block starts with its line; the record's title names it.
- The Codex's date bar and the Compendium's Sources line are Cradles; Recently changed is open, as its neighbours are.
- One tag: VT323 16 px in a 22 px box, for a state, a condition, a source, a folder and the log's tags.
- One close: a plain 18 px icon in a 40 px button, 44 px on a phone; the dice options close with it.
- The Dusk and Dawn switch is 36 px segments; arrival keeps its plate over the art.
- One stepper: 40 px, 44 px on a phone, its number VT323 22 px, the minus sign.
- CLAIMED, GET and POST are VT323 tags; a template's parts are their icon and word; a hashtag is the pages index's chip.
- One step mark: 24 px with its number in VT323 17 px.
- Saved is a lamp and its word; the ruling card's rim is amber.
- A content button's icon is 15 px at 1.8; a tab 44 px with 14 px words; the bar's search 38 px; a form field 40 px, 44
  px on a phone; a lamp 8 px; a toast's close a 36 px square; a template's drag handle 44 px on a phone.
- Every mockup's `mockup-src/p4v-parts.css` draws these shared values once, as `p4t-touch.css` draws the phone's floor.

### 8.3 Titles and eyebrows (fixes 14 and 23; T 2.2, 2.4)

- A title that opens a record or a pane is 22 px on a laptop and 20 px on a phone.
- The eyebrow covers time and tools' field labels and timeline heads, the downtime's DAYS and DAYS LEFT, and the call
  for a roll's WAITING and success.

### 8.4 A correction to the sweep as shown

- Finding 22 counted the lamps that say ready, live or waiting. The turn's action lamps (Action, Bonus Action, Reaction)
  are their own part, 11 px with their glow as C's values give, and stay.
- The sweep's preview darkened the three colours throughout Dawn to show the words; the fix gives words their own shades
  and leaves lamps, edges and fills as they were.
- Finding 14 listed H. Its large titles are the TV's own screens (Pair this screen, Paused), read across the room, and
  keep their size; so do the TV's NEXT tags under finding 18.
- Finding 9 listed C2 and C4 and C6. They carry the dice options' code but show no page with it, so only C5's close
  changed; their code closes the same way.
- Settings' ability score methods row shares a class with the API reference's GET and POST tags; it stays a row of
  ticks.
