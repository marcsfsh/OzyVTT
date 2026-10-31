# H. The table screen

Approved by the owner on 2026-10-29 after two rounds of mockups. Area H in `../CATALOG.md` is what the room sees on the
TV, and the GM's controls for it. It inherits the theme (`../T-theme/SPEC.md`) and the frame (`../A-frame/SPEC.md`),
which put the table screen's lamp in the GM's menu. `PLAN.md` beside this file is the work to build it;
`table-screen.html` is the approved mockup, and `history/` holds rounds 1 and 2 as they were shown. Round 2 asked one
question again, the TV in a fight, as three refinements of the turn ladder.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) put a screen's crumb on its title's line (2.3).

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) gave Prep's bar behind the menu all seven pages, its
search and New encounter, and put a screen's phone header as ‹ TABLE SCREEN with its name in the content.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew Revoke this screen in `--danger-text` on its Base
line and a screen's Open as a Base line button, and every phone control at 44 px; the preview's head keeps its plain
icons, as an overlay's head does.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) kept a menu row's rule inside its 48 px (T rule 8).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) stacked the phone header and Prep's strip on the phone
pages behind the menu and the preview, as Prep's own phone pages do; drew the menu's Dusk and Dawn switch as 36 px
segments (T 2.5), the screens' lamps at 8 px (T rule 19) and the preview's toast close as a 36 px square; and gave
Dawn's amber, magenta and violet words their text shades (T rule 9). The TV's own titles and NEXT tags keep their size
for reading across the room.

## 1. What it covers

| Id  | Surface                                   | Decided here                                   |
| --- | ----------------------------------------- | ---------------------------------------------- |
| H1  | Pair this screen                          | The horizon line (2.2)                         |
| H2  | Waiting states: paused, waiting for a map | The horizon line (2.2)                         |
| H3  | Live screen                               | The turn ladder, refined (2.1)                 |
| H4  | Turn on sound                             | Rule 3.7                                       |
| H5  | The GM's table screen page                | Screens first, then a screen as a remote (2.3) |
| H6  | The table screen in the GM's menu         | The frame's decision, unchanged (2.4)          |
| H7  | The preview                               | Picture in picture (2.4)                       |

Left for later: the Sound half of the GM's page, the scenes' "See as: screen", and Settings' own table screen rows. They
follow the rules in section 3 meanwhile.

## 2. The decisions

### 2.1 The TV in a fight is the turn ladder, refined

- The screen is the ladder at the left (400 px of 1280) and the map in the rest, with today's corner brackets.
- The ladder's head: the wordmark and the round on the VCR counter (PLAY and RND 02, or STOP and RND -- with no
  encounter), then the horizon line under it.
- The rows, in initiative order from the top, one per turn: the initiative in VT323, the portrait, and the name in full.
  - The acting row grows into a card: a caution edge at its left and a caution wash, its initiative in caution, a larger
    portrait, "Acting now" in caution capitals, and the name in chrome letters, kept whole (it wraps between words and
    shrinks before a word breaks).
  - The next row carries a NEXT tag with a cyan edge.
  - A hidden creature's turn is a GM turn row: a dashed violet portrait with the eye struck through, "GM turn" in dim
    ink and its initiative. When it is the GM turn that is acting, the acting card says "Acting now" and "GM turn" with
    the same portrait.
  - Before the first turn of a round, no row is lit and the head's line under the round says "Waiting for the first
    turn", as today's card does.
  - Names are written in full (today's tiles shortened a character to their first name).
- The ladder's foot: Latest roll, who and what ("Borin · Longsword attack"), the total in VT323 with today's NAT tag for
  a natural 20 or 1, and the dice beside it in quiet VT323. With no roll yet it says "No roll to show yet." Nothing
  covers the map.
- The ladder keeps today's drag handle on its edge for setting the screen up, and the width it was given.
- With a map on the screen and no encounter running, the ladder keeps its head, names the map under "No encounter
  running" in chrome letters where the turn would be, and its foot says "No roll to show yet."
- On a phone held upright the screen stacks: the head, the rows (the acting row as its card), the latest roll as one row
  with the total at its right, then the map filling the rest.

### 2.2 Pairing and waiting are the horizon line

- Black (the void), with the horizon line across the screen at 46% of its height. What this is sits above the line, its
  detail below it. There is no sun and no sky, so the screen stays quiet in a dark room.
- Pair this screen: "Table screen" in small capitals and "Pair this screen" as the heading above the line; the code
  below it in VT323 (two groups of three), then "On the GM's device, open Table screen settings and type this code."
  and, quieter, "The code changes every 10 minutes. This screen shows only what the GM presents." Getting a code and the
  pairing errors keep today's words, below the line.
- Connecting: "Table screen" and "Connecting…" (or "Reconnecting…") above the line, today's message below it.
- Paused: "Connected" and "Paused" above the line; "The GM will begin when the table is ready." below it.
- Waiting for a map: "Connected" and "Waiting for a map" above the line; "The GM controls what appears here." below it.
  It takes the whole screen; today's strip and side column do not show while there is no map.
- Each heading stays on one line on a TV. On a phone held upright the same screen with smaller type; a heading may wrap
  between words.

### 2.3 The GM's page is the screens, and a screen opens as a remote

- The page is Table screen (Shared screen goes, rule 3.2) under T's title row, with Display and Sound as a segmented
  control and "1 screen connected" at its right, as today.
- Under it, what is on the screen as one bar: On the screen, the lamp and ON (or Paused), the map's name and what it is
  ("Live encounter · round 2"), then Pause the table screen and Present a map. Present a map is a menu of today's
  actions: present the map the page is offered (Present {map}, or Show {map} instead when another is on), and Show the
  live encounter. While paused, the bar's first action is Present {map}, as today.
- Then the screens as cards, three to a row: each paired screen with its live picture (what the screens show, drawn
  small), a lamp for connected or not, its name, and "Connected · sound on" or "Last seen Oct 25". Pressing a card opens
  that screen. A screen that is not connected shows "Not connected" where its picture would be.
- The last card is Pair another screen, with a dashed edge: one line of how ("Open this address on the screen. It shows
  a six-digit code; type it here."), the address as a menu of the server's addresses with Copy address, the code and the
  screen's name as fields, Pair screen as the Cup, and Open a screen here (today's link that opens the table screen in a
  new window on this device).
- A revoked screen has no card; it cannot connect again.
- One line under the cards: "Open a screen to point at the map it shows: focus, ping and measure."
- A screen open is a remote:
  - Its head: "Table screen" as a crumb back to the screens on the line of the screen's name, before it, "Connected ·
    sound on · paired Oct 12", and Revoke this screen.
  - At the left, Focus view, Ping a point and Measure as a segmented control over a large live picture of the screen
    (880 px wide at 1280), edged cyan. With Ping a point, pressing the picture pings there at once; with Focus view it
    focuses there at the zoom beside the control; with Measure each press adds a point, and Show measurement and Clear
    measurement sit under the picture with the displayed distance. The line under the picture says what a press does:
    "Press the picture to ping that point. Every paired screen shows it." Today's typed point fields stay for the
    keyboard, folded under "Type a point".
  - At the right (300 px): On the screen (the lamp, the map, Pause the table screen, and Present a map with its actions)
    and Other screens, each a row with its lamp, name, state and Open.
- On a phone: the screens page is Display and Sound, On the screen with Pause and Present a map, the connected screens
  as cards with their pictures, the others as rows, and Pair another screen as a row that opens the pairing form as a
  sheet. A screen open has Table screen in the header with Back (T rule 12), then its name and its line at the top of
  the content, the picture, the tools, the hint, On the screen and Other screens, with Pause and Present a map pinned at
  the foot.

### 2.4 In the menu, and the preview as picture in picture

- The GM's menu keeps the frame's decision (A): the Table screen row with its lamp and ON or OFF, and its actions in
  place under it: Pause the table screen, Preview it here and Table screen settings.
- Preview it here docks the screen as a picture in picture at the bottom right (420 px wide at 1280): a bar with the
  lamp, "Table screen" and ON, then Pause, Pop out and Close as icons, over the live picture. It stays on every page
  until it is closed, can be dragged to another corner, and hides on the table screen page, where the remote is the
  preview. Pop out opens it in its own window, as today. The first time it docks, a toast says "The preview stays here
  on every page. Drag it to another corner."
- On a phone it sits at the bottom right over the page (250 px), above the tabs, with the lamp, Pause and Close.

## 3. Rules for the table screen

1. The TV shows only what it already gets: the map, the tokens the party can see with health bands only when the GM
   shows them to everyone, the turn order with a GM turn for a hidden creature, the round, the latest public roll, pings
   and the measurement. Nothing here adds a field to the projection.
2. One name: Table screen. The TV, the GM's menu, the settings page, the preview and the help all say Table screen.
   Shared screen, Shared display and Table Viewer go.
3. Read from across the room: names at least 20 px on a 1080p TV, numbers in VT323 at 28 px or more, the acting name in
   chrome letters kept whole, and nothing on the TV that needs a pointer.
4. A long order: when the turn order is longer than the ladder, the acting row and the next stay in view and the rest
   scroll with the turn; the ladder never shrinks its names to fit.
5. Opening a screen: every paired screen shows the same thing, so focus, ping and measure in a screen's remote reach
   every screen, and the remote says so. A screen's own rows are its name, whether it is connected and can play sound,
   when it was paired, and Revoke.
6. The preview: Preview it here docks the picture in picture; it stays on every page until closed and hides on the table
   screen page.
7. Turn on sound: when the TV blocks sound until a tap, one quiet button at the bottom left says Tap to turn on sound,
   edged magenta while something waits to play, as today.
8. The screen's own controls fade: fullscreen, zoom, Fit the map, Follow GM view and the Live or Reconnecting pill fade
   after a few seconds without input, as today; Reconnecting stays.
9. On a phone held upright the live screen stacks (2.1), every name kept whole, and nothing scrolls sideways.
10. The logo never sits on the sun: wherever a sun or the horizon shows on the TV, the wordmark stands clear of it, as
    on the title screen (B).
11. The Sound half of the page, the scenes' See as: screen, and Settings' table screen rows take this frame now and
    their own designs later.

## 4. Values

Sizes on the TV are at 1280 by 720, the mockup's frame; a 1080p TV draws them half as large again.

| Part                 | Value                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ladder               | 400 px; `--bg`; 1 px `--line-strong` at its right                                                                                                                                                                           |
| Ladder head          | 14 px 18 px; the wordmark at 30 and 34 px; VCR PLAY 13 px, RND VT323 40 px; the horizon line 3 px under it                                                                                                                  |
| Rows                 | 70 px; 0 16 px 0 8 px; a hairline under each; the initiative VT323 30 px right aligned in 42 px; the portrait 46 px; the name 20 px                                                                                         |
| NEXT tag             | 3 px 6 px; 1 px cyan edge; VT323 17 px in `--cyan-hi`                                                                                                                                                                       |
| Acting row           | 124 px; a 5 px caution edge at its left; caution at 12%; the initiative VT323 36 px in caution; the portrait 76 px; Acting now 13 px capitals; the name in chrome at 28 px                                                  |
| GM turn row          | The portrait's edge dashed in `--violet`, the eye struck through; the name in `--text-dim`                                                                                                                                  |
| Ladder foot          | 14 px 18 px 16 px; 1 px `--line-strong` on top; `--s1` to `--bg`; who and what 18 px; total VT323 58 px; dice VT323 24 px                                                                                                   |
| Phone, upright       | Head 10 px 14 px; rows 42 px, initiative 22 px, portrait 30 px, name 16 px; acting row 84 px, portrait 56 px, name 22 px; the roll one row, total 46 px                                                                     |
| Horizon screens      | `--void`; the line at 46%, 3 px with its glow; above it the eyebrow 13 px and the heading 40 px display capitals, 30 px over the line; below it 34 px under the line; the code VT323 132 px; the line 19 px; the note 15 px |
| Horizon, phone       | Heading 28 px; code 64 px; line 15 px; note 13 px                                                                                                                                                                           |
| Tap to turn on sound | 24 px from the bottom left; 44 px high; 0 14 px; 1 px `--magenta`; 15 px                                                                                                                                                    |
| Screen cards         | Three to a row, 16 px apart; 12 px; the picture 16:9 at the card's width; the row under it 44 px                                                                                                                            |
| The remote           | The picture 880 px wide, a 1 px cyan edge with a 18 px cyan glow at 30%; the side 300 px                                                                                                                                    |
| Picture in picture   | 420 px (phone 250 px), 20 px from the corner (phone 10 px); the bar 38 px with the horizon line on top; the picture 16:9                                                                                                    |
