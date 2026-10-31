# E3 Sound and the screen

Approved by the owner on 2026-10-30 after one round of mockups. The sound board (E3.2 in `../CATALOG.md`), the Sound
half of the GM's Table screen page that H left for later (`../H-table-screen/SPEC.md` rule 11), an encounter's own
sound, the scenes' See as the table screen, and Settings' table screen row. They inherit the theme
(`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`), the Table screen page (H 2.3, 2.4), Prep's workbench
(`../E-prep/SPEC.md` 2.2) and the folders at the side (`../E2-maps-tokens/SPEC.md` 2.1). `PLAN.md` beside this file is
the work to build it; `sound-and-the-screen.html` is the approved mockup, and `history/` holds the round as it was
shown. Every decision is built from settled parts; the mockup's Carried in section lists them.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) gave Prep's bar its search and New encounter on an
encounter's sound, stepped down while Go to the table is the page's Cup.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew the board's icon buttons and the player's controls
at 36 px on their Base lines, made Open the sound board a Base line button, Revoke this screen a danger action and
Cancel a ghost, and gave Shuffle and Starts when it goes live the theme's switch.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) set an encounter's sound title row at 20 px on a phone
(T 2.2), its sound rows at 44 px on a phone (T rule 8), and its sheets' titles at 20 px.

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the board's play icons at 15 px at a 1.8 stroke (T
2.5), the tabs at 44 px (T rule 1) and every tag in a 22 px box (T rule 7), and gave Dawn's amber, magenta and violet
words their text shades (T rule 9).

## 1. What it covers

| Id                  | Surface                      | Decided here                           |
| ------------------- | ---------------------------- | -------------------------------------- |
| E3.2                | The sound board              | Kinds at the side (2.1)                |
| E3.2                | What is playing              | One Playing bar with a scrubber (2.2)  |
| E3.2                | Putting a sound on the board | Kind chips (2.3)                       |
| E3.2, E 2.2         | An encounter's sound         | On the encounter's page (2.4)          |
| H5 (left for later) | See as the table screen      | Today's swap, drawn to the theme (2.5) |
| H5 (left for later) | Settings' table screen row   | Rule 3.5                               |

Replays (E3.3 to E3.5) come in a later round.

## 2. The decisions

### 2.1 The sound board puts the kinds at the side

- The page is H's Table screen page (H 2.3) with Sound chosen in its Display and Sound control: T's title row, Table
  screen, with "Music and sound play on the table screen only, never on players' devices." as its line and "1 screen
  connected" at its right. Prep's Sound opens the same page (`/viewer-controls/sound`).
- Under the title row, the Playing bar (2.2), then two columns, as the maps' folders (E2 2.1):
  - At the left (240 px): ON THE BOARD with Playlist (its count), Ambience ("1 of 3": the layers on, of all) and Effects
    (its count), each with its icon; then LIBRARY with All sounds and Not on the board, each with its count. Counts in
    VT323; the chosen one lit as a chosen row.
  - At the right, the chosen one:
    - Playlist: MUSIC · 3 with Shuffle as a switch, today's line on the crossfade, and each track a row: play or pause,
      the name and its length (VT323) with "Playing" in cyan on the one playing, its level, and Move up, Move down and
      Take off the playlist as icons.
    - Ambience: each layer a row with its switch, name, "On · loops" or "Off", its level and Take off.
    - Effects: each effect a pad (its name with ▶ and its level), the one just fired edged cyan.
    - All sounds and Not on the board: the library (2.3), with Add sounds (today's upload) in its head and today's line
      on the file types.
- On a phone: the Playing bar, then Playlist, Ambience, Effects and Library as a row of Base line chips with their
  counts, the chosen one's rows under them.

### 2.2 One Playing bar, with a scrubber

- One row under the title row, as H's On the screen bar: PLAYING, the room's lamp, the track's name with "with Rain on
  leaves" (the layers that are on) after it in the dim colour, the scrubber, then Pause (or Play), Next track and Stop
  all as three icon buttons, then Master.
- The scrubber: the time in (VT323), the Base line slider with the cyan fill and the square thumb, and the track's
  length (VT323). It moves as the track plays; dragging it moves the track for every table screen (the one server
  change, PLAN phase W3). While paused it holds still.
- Master: the volume icon and the same slider with its value in VT323.
- The room's lamp: cyan while every connected table screen plays sound. When one waits for a tap on the screen it turns
  caution and the bar says so ("Kitchen tablet is waiting for a tap"); with none connected it reads "No table screen
  connected" in the dim colour. Today's "Can't play {sound}" stays, after the lamp, in the danger colour.
- Nothing playing: the bar keeps its place, PLAYING reads "Nothing playing", the scrubber is empty, and Play starts the
  playlist from its top, as today.
- On a phone: PLAYING and the lamp, the track on its own line, the scrubber across the width, then the three buttons (44
  px) and Master in one row.

### 2.3 A sound goes on the board with its kind chips

- Each library row: the name, its length (VT323) and format, then Music, Ambience and Effect as Base line chips, lit
  with a check where the sound is, then More (Rename, Delete with today's confirm).
- Pressing an unlit chip puts the sound on that part of the board at today's starting level; pressing a lit one takes it
  off, as Take off does. A sound can be in more than one part, as today.
- On a phone the same chips, 44 px high; More opens from the foot.

### 2.4 An encounter's sound sits on its page

- The board lists no encounters. Each encounter's workbench (E 2.2) holds its sound in its Light and sound tab, after
  the grid, walls and light: SOUND, when it was saved and what ("2 tracks · 1 ambient layer"), each track and layer as a
  line, Starts when it goes live as a switch, Play now, Replace with what plays now (or Save what plays now when none is
  saved), Clear in More, and Open the sound board.
- On a phone the same under the workbench's Light.

### 2.5 See as the table screen is today's swap

- See as opens from the workbench's More (E 2.2): You, the GM; The table screen; and each character.
- While it is on, the title row shows "See as: The table screen" as a menu to switch who, and the map swaps in place for
  what that audience gets, under a cyan line across the map, "What the table screen shows.", with Back to your view. The
  screen's view keeps the corner brackets.
- On a phone: the same line over the map, with Back.

## 3. Rules for sound and the screen

1. Sound comes out of the table screen only: the GM's device and the players' stay silent, as today; nothing on the page
   plays a sound on the device it is on.
2. One kind of control and one kind of slider in the Playing bar: the three icon buttons share one size and each has its
   name for a screen reader; the scrubber and Master share the Base line slider. No menus in the bar.
3. Levels: every level is the Base line slider with its value in VT323, 0 to 100, at least 44 px to grab on a phone.
4. Nothing new in what the controls do, except seeking: every play, pause, next, stop, arrange, upload, rename, delete
   and encounter sound keeps today's commands, routes and words.
5. Settings' Players section keeps Preview the table screen; it opens H's picture in picture (H 2.4).
6. One name: Table screen (H rule 2). "Shared display" goes from the sound page.
7. Phones: one column; the side list as chips; menus and dialogs from the foot; 44 px hit areas.

## 4. Values

| Part              | Value                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| The Playing bar   | 12 px 24 px; PLAYING 11 px capitals; the lamp 8 px; the track 15 px 600; the layers 13 px `--text-dim` |
| The scrubber      | Up to 460 px; the track 3 px; the thumb 12 px square; the times VT323 16 px                            |
| The bar's buttons | 40 px square on a laptop, 44 px on a phone; the icons 15 px                                            |
| Master            | The icon 18 px; the slider 130 px; the value VT323 15 px                                               |
| Side list         | 240 px; rows 38 px; counts VT323 16 px                                                                 |
| Rows              | At least 50 px; the length VT323 15 px; levels 150 px                                                  |
| Kind chips        | Base line controls, 36 px (44 px on a phone); lit with a 2 px cyan line and a check                    |
