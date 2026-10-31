# ADR-0063: Maps and tokens: folders at the side, a map beside the list, filing by menu and Choose, token groups, and a picker with folders and a preview

## Status

Accepted

## Context and decision drivers

E2 of the polish pass, with the Tokens page (E3.1) and the token picker (C6.8) (`docs/design/polish/E2-maps-tokens/`),
inside Prep's frame (ADR-0053). Running the branch at `f5e166f` with six maps and eight token images showed:

- The Maps page was a table (picture, name, type, grid, size, folder, used in, modified) under filters; folders lived in
  a column and the row's menu.
- A map's page was its picture with Grid, Type and folder, Where it is used, and File and history in a column.
- The Tokens page was one flat list of creatures naming their picture in words, each with Set token image….
- The token picker was a dialog: search, a folder menu, Upload into folder, Previously used and the library as tiles.

The owner asked that sub-areas keep to the settled design, and chose from one round of mockups with five options for
each question, kept in `docs/design/polish/E2-maps-tokens/history/`, each built only from settled parts. The owner also
asked that the GM can make token groups beyond Party and Monsters.

## Considered options

- The map list: Today's table, The shelf, The shelf by folder, Folders at the side, Rows with pictures.
- A map's page: Today's page, The workbench, The record, Beside the list, What uses it first.
- Folders: In its menu, On its page, Drag onto a folder, Choose several, The folder on the card.
- The Tokens page: Today's table, Faces, Party and monsters, The library, Two panes.
- The token picker: A's dialog, A side sheet, Under its row, Folders and a preview, Theirs first.

## Decision

1. The map list is folders at the side, the maps as E's shelf cards beside them.
2. A map opens beside its folder's list, inside the same layout.
3. A map's menu files it, and Choose files several at once.
4. The Tokens page groups creatures into Party, Monsters and any group the GM makes.
5. The token picker is a wide dialog: folders, the library, and a preview with Use for {name}.
6. Token groups are a new GM-only stored value with commands to make, rename and delete a group and to move a creature
   into one.
7. Eight rules, listed in `docs/design/polish/E2-maps-tokens/SPEC.md` section 3.

## Consequences and tradeoffs

- Folders become a place to browse, not only a field; a folder still exists only while a map is in it, so New folder
  leads straight into choosing its maps.
- Moving several maps no longer means opening each one.
- Token groups add state the server keeps and the GM view carries; players and the table screen never receive it.
- Every place that sets a token's picture shows the same picker, so the preview answers how it will look before it is
  used.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area; folders become chips, a map opens under its row, and menus, the Choose bar and
  the picker open from the foot.
- Security: the token groups field is excluded from the player and table-screen projections, and its commands are
  GM-scoped. Nothing else changes in data, routes or projections.

## Migration / reversibility

- The groups field defaults to empty, so a saved game without it loads unchanged. Removing it later drops only the
  grouping; creatures fall back to Party and Monsters by kind.
- The rest is client and docs, reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/E2-maps-tokens/maps-and-tokens.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus projection tests that players and the table
  screen never receive the groups, the full checks and the smoke suite.
