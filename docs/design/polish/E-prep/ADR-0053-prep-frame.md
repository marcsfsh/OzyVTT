# ADR-0053: Prep's frame: a shelf of encounters, the table's workbench, drafts made at once and the grid's steps

## Status

Accepted

## Context and decision drivers

Area E of the polish pass (`docs/design/polish/E-prep/`) gets a session ready before anyone arrives. Running the branch
at `f5e166f` with one map and one encounter showed:

- Prep opened on two large buttons (New map, New encounter), a Maps and Encounters toggle, filters, then a table of
  encounters with eight columns.
- An encounter's page had its own rail, staging tray and panel, close to the table's but drawn its own way.
- Making an encounter walked five steps before anything existed.
- Setting a map's grid was a four-step editor with its own look.

The owner chose from one round of mockups with six options for each question, kept in
`docs/design/polish/E-prep/history/`.

## Considered options

- Prep's front page: List (today's table), Up next, Shelf (cards led by the map), Split, Running order, Board.
- An encounter's page: Workbench (the table's frame), Document, Checklist, Map first, Tabs, Side column.
- Making an encounter: Steps (today's), Quick start (a dialog), One page, Draft page, Map gallery, Side sheet.
- Setting a map's grid: Steps (today's), Drag a square, Two points, Count squares, Sliders, On the map page.

## Decision

1. Prep opens on a shelf of encounter cards, each led by its map, with the states as chips and New encounter in the bar.
2. An encounter's page is the table's workbench: the tools dock, the map with its tray chip, and a panel with who is in
   it, its rules, and light and sound, with Make live at its foot.
3. New encounter opens the new encounter's page at once, which lists what is left to make it ready and starts with
   picking a map; the record is made when the map is picked, as today.
4. Setting a map's grid keeps its four steps, drawn to the theme.
5. Nine rules for Prep, listed in `docs/design/polish/E-prep/SPEC.md` section 3.

## Consequences and tradeoffs

- Preparing an encounter looks like playing it, so the GM learns one map, one set of tools and one panel.
- A new encounter opens as its own page from the first click and the five steps go; the steps after the map become the
  page's panel tabs.
- The shelf shows fewer facts per encounter than today's table; the state, the map, who is in it and what is missing
  stay, and the rest is on the encounter's page.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area. On a phone the shelf is two cards to a row, the encounter's page uses C's phone
  Switch, and Make live is pinned above the tabs.
- Prep is GM-only and stays so. No data, command or projection changes. An encounter still needs a battle map to be
  made, so the record is created when the map is picked, with today's `encounter:create`. Draft and Ended are worked out
  from today's facts, as the list's readiness already is.

## Migration / reversibility

- Client and docs only. The editor's `?step=` links open the encounter's page. Reversible by reverting the client
  commits.

## Validation evidence

- The approved mockup: `docs/design/polish/E-prep/prep.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
