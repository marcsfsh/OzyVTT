# ADR-0058: The GM's panel and what waits on the GM: a list over the turn or in its tab, unread counts, and a bell

## Status

Accepted

## Context and decision drivers

The first of two rounds for C3 of the polish pass (`docs/design/polish/C3-gm-panel/`), inside the table's frame
(ADR-0050). Running the branch at `f5e166f` with a fight on Lyra's turn, a player's Fire Bolt waiting for its target
and a Magic Missile hit waiting to be applied showed:

- Needs you sat at the top of the Encounter tab, above the acting creature, and was squeezed to one clipped line: its
  two cards scrolled inside a box 21 px tall. On every other tab it was gone, and only an amber count on the Encounter
  tab said it was there.
- The words "Needs you" headed the list, and also appeared in the Compendium's home, the encounter settings' help,
  three result cards and a server message. The owner finds them too narrative for an attention signal.
- The panel's tabs were words; only the Encounter tab carried a number, the count of what waited.
- ADR-0025 still described Needs you above the tabs on every tab; the code had moved it into the Encounter tab.

The owner chose from one round of mockups with six options for each question, kept in
`docs/design/polish/C3-gm-panel/history/`, and asked for two changes to the picks: a switch between the list over the
turn and in its own tab, and counts that drop when their tab is opened.

## Considered options

- Where the list sits: Top of Encounter (today's), Its own tab, Above every tab, By End turn, In the left dock, A drawer.
- One item: Card (today's), One line each, Ticket, Fold out, Grouped by what you do, Grouped by creature.
- The panel's tabs: Words (today's), Words and counts, Icons over words, Icons only, Rail at the side, Encounter and a
  menu.
- The signal: Amber lamp, Needs attention, Bell, Count only, Diamond, Amber ink.

## Decision

1. The list sits at the top of the Encounter tab with every item whole, or in its own first tab; the GM switches
   between the two from the list's head or Settings' Device section, and the choice is kept on the device.
2. Each item is a card with today's words, buttons and commands.
3. The panel's tabs are words with counts: a count is how many entries arrived on that tab since the GM last opened it,
   and it drops when the tab opens.
4. The signal that something waits on the GM is a bell with its count, wherever something waits; the words Needs you
   go.
5. Nine rules, listed in `docs/design/polish/C3-gm-panel/SPEC.md` section 3.

## Consequences and tradeoffs

- The bell counts what the GM owes and drops as items are answered; tab counts are news and drop when read. The two
  never share a tab.
- A tab's count needs to know when the GM last opened it: client state on the device, like the remembered tab, so a
  second device keeps its own reading.
- The list over the turn can push the turn down when much waits; it scrolls only past half the panel, so the turn always
  shows below it, and the GM can move the list to its tab.
- Every place that said Needs you changes its words, including a server message and the Compendium's home, so tests
  that read those words change with them.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; on a phone the Switch carries the counts and the bell, and the list can be a
  first choice of its own.
- No data, command, projection or route changes, except the words of one server toast. What waits, who may answer it
  and what each button sends are unchanged.

## Migration / reversibility

- Client and docs, and one server string. Reversible by reverting the commits.

## Validation evidence

- The approved mockup: `docs/design/polish/C3-gm-panel/gm-panel.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, with items waiting, plus the full checks and the
  smoke suite.
