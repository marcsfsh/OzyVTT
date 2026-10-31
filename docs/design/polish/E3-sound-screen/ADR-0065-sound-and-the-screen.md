# ADR-0065: Sound and the screen: kinds at the side, one Playing bar with a scrubber, kind chips, an encounter's sound on its page, and today's See as

## Status

Accepted

## Context and decision drivers

The sound board (E3.2) and what the table screen's page left for later (ADR-0056: its Sound half, the scenes' See as the
table screen, and Settings' table screen row), in `docs/design/polish/E3-sound-screen/`, inside the Table screen page
(ADR-0056) and Prep's workbench (ADR-0053). Running the branch at `f5e166f` with eleven sounds and three encounters
showed:

- The sound board was two columns of framed sections under a Now playing bar: Music, Ambience and Effects at the left,
  the Library and Encounter sound at the right, under the heading Shared display.
- The Now playing bar had a badge for each screen, Pause as the primary, Next track, Stop all and a long Master slider.
- Each library row had Music, Ambience and Effect buttons.
- Encounter sound was a section of rows on the board, and again on each encounter's page.
- See as was a menu in the encounter's title row that swapped the map for the screen's stage under a cyan line.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/E3-sound-screen/history/`, each built only from settled parts. The owner also
asked that the Playing bar be simplified, made consistent, and given a scrubber.

## Considered options

- The board: Today's board, A mixing desk, Kinds at the side, Board and library, Three decks.
- What is playing: Today's bar, A bar like On the screen, The VCR counter, A now playing card, Pinned at the foot.
- Putting a sound on: Today's buttons, Kind chips, A's menu at the sound, Drag onto the board, Add from the section.
- An encounter's sound: Today's rows, Encounter cards, A list and the chosen one, A strip under the head, On the
  encounter's page.
- See as the table screen: Today's swap, The screen in place, Picture in picture, Side by side, The whole screen.

## Decision

1. The sound board puts Playlist, Ambience, Effects and the library at the side, the chosen one at the right.
2. One Playing bar under the title row: the room's lamp, the track, a scrubber, three icon buttons and Master.
3. A library sound goes on the board with its Music, Ambience and Effect chips.
4. Each encounter's sound sits on its own page, under Light and sound; the board lists none.
5. See as the table screen keeps today's swap under the cyan line, opened from More.
6. Seven rules, listed in `docs/design/polish/E3-sound-screen/SPEC.md` section 3.

## Consequences and tradeoffs

- One part of the board shows at a time; the Playing bar keeps what plays in view whichever part is chosen.
- Dragging the scrubber needs one new command, `sound.seek`, which moves the playing track for every table screen. It is
  the one server change, approved by the owner.
- An encounter's sound is set where the encounter is prepared; the board no longer lists every encounter.

## Mobile, security, and visibility impact

- On a phone the side list becomes chips and the bar stacks; every control keeps 44 px.
- `sound.seek` is GM-only with the scope of the other sound commands (`encounter:write`). The table screen's sound
  projection keeps its fields; only the position it reports changes. Players receive no sound, as today.

## Migration / reversibility

- No stored value changes shape: seeking rewrites when the current track started. Reversible by reverting the commits.

## Validation evidence

- The approved mockup: `docs/design/polish/E3-sound-screen/sound-and-the-screen.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, the seek tests, plus the full checks and the smoke
  suite.
