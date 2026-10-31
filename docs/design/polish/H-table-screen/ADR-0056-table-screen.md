# ADR-0056: The table screen: the turn ladder, the horizon line, screens as remotes, and picture in picture

## Status

Accepted

## Context and decision drivers

Area H of the polish pass (`docs/design/polish/H-table-screen/`) is what the room sees on the TV, and the GM's controls
for it. Running the branch at `f5e166f` with a TV paired, the old road presented, an encounter started and a roll made
showed:

- The live screen was a strip of turn tiles across the top, the map at the left and a column at the right with the
  acting card and the latest roll. On a phone held upright the acting card became a narrow column and its name ran
  down one letter at a time; on a TV the name broke mid-word.
- Pairing was a card on the sky; a paused screen said "Presentation paused" over two lines on a phone; waiting for a
  map sat inside the live layout with its strip and side column.
- The GM's page was called Shared screen while the TV and the lamp said Table screen and the preview's window said
  Table Viewer. It was two columns: the focus, ping and measure tools with a small map at the left, and the address,
  the pairing form, four buttons and the paired screens at the right.
- The lamp's menu offered Pause, Preview the table screen here and Table screen settings; the preview was a floating
  window that could be dragged, resized and popped out.

The owner chose over two rounds of mockups with six options for each question in round 1, kept in
`docs/design/polish/H-table-screen/history/`. Round 2 asked one question again, the TV in a fight, as three
refinements of the turn ladder chosen in round 1.

## Considered options

- The TV in a fight: Strip and column (today's), Full map, Turn ladder, Lower third, Spotlight, Scoreboard; then the
  ladder refined, a rolling ladder (the acting creature always on top), and the ladder floating over the map as glass.
- Pairing and waiting: Card (today's), Attract screen, Steps, Horizon line, Table clock, Marquee.
- The GM's controls: Two columns (today's), Steps, Remote, Screens first, Settings list, On the screen and next. The
  owner chose Screens first for the page and Remote for a screen opened from it.
- In the menu and the preview: In the menu (the frame's decision, with today's floating window), Row with a picture,
  Picture in picture, Side panel, On the live chip, Watch it full size.

## Decision

1. The live screen is the turn ladder, refined: the turn order down the left in initiative order, the acting row grown
   into a card with the name in chrome letters kept whole, NEXT marked in cyan, a GM turn for a hidden creature, the
   latest roll at the ladder's foot, and the map beside it with nothing over it. With no encounter running the ladder
   names the map. On a phone held upright it stacks: the ladder, the roll, the map.
2. Pairing, paused and waiting for a map are the horizon line: black, the line across the middle, what this is above
   it and the code or the words below it.
3. The GM's page is Table screen: what is on the screen as a bar, then each paired screen as a card with its live
   picture and a card to pair another. Opening a screen makes it a remote: a large live picture to press for focus,
   ping and measure, with what is on the screen and the other screens beside it.
4. The menu keeps the frame's Table screen row; Preview it here docks a picture in picture at the bottom right that
   stays on every page until closed.
5. Eleven rules for the table screen, listed in `docs/design/polish/H-table-screen/SPEC.md` section 3, starting with
   the TV showing only what it already gets and one name, Table screen.

## Consequences and tradeoffs

- The map loses the strip's height and gains the ladder's width: at 16:9 the map area goes from about 920 by 625 to 880
  by 720, and on a 4:3 screen the ladder takes a larger share. The fit-to-map camera already handles both.
- A long turn order scrolls inside the ladder with the turn rather than shrinking; the acting row and the next always
  show.
- The screens' pictures and the remote are drawn in the GM's page with the TV's own parts, from the presentation the
  page already reads: the same projection the TV gets, with its latest roll. Every connected screen shows the same
  picture; a screen that is not connected shows none. The docked preview keeps today's preview session and frame.
- The remote reaches every paired screen, as focus, ping and measure do today. A screen cannot be pointed at alone,
  and the remote says so.
- The picture in picture is client state on the GM's device; it does not follow the GM to another device.

## Mobile, security, and visibility impact

- Every GM control keeps a 44 px hit area; on a phone the screens are cards and rows, the remote pins Pause and Present
  a map at its foot, and the picture in picture sits above the tabs. The TV needs no pointer.
- No data, command, projection or route changes. The TV keeps receiving exactly today's projection: hidden creatures
  stay a GM turn, health bands show only when the GM shows them to everyone, and only public rolls appear. Pairing,
  revoking and the preview session work as today.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/H-table-screen/table-screen.html`.
- The plan's checks on a 1280 by 720 TV window, a 4:3 window and a phone held upright, the GM's pages at 1280 by 800 and
  390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
