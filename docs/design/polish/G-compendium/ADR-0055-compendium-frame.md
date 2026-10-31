# ADR-0055: The Compendium's frame: shelves, three panes for browsing and records, and the refined studio

## Status

Accepted

## Context and decision drivers

Area G of the polish pass (`docs/design/polish/G-compendium/`) is the rules content, SRD and homebrew, and who sees it.
Running the branch at `f5e166f` with the SRD 5.2.1 bundle and a homebrew copy of the Goblin Boss showed:

- The Compendium had its own boxed strip (Browse, Homebrew, Sources, Sharing), its own search box, a Rules button and
  New homebrew, under the app bar.
- It opened on a Homebrew overview: a Sources table, Needs you, and a By kind table of counts.
- Browsing was one table for every kind, with Kind, Source, Filters and Sort as menus over it.
- A record opened beside a narrowed list, with tabs for Card, Edit, Sharing and History; only one record was open at a
  time, and moving between a monster, its copy and a spell meant finding each again.
- Editing was a studio of steps with a live stat block; the steps said nothing about their answers.

The owner chose over three rounds of mockups with six options for each question, kept in
`docs/design/polish/G-compendium/history/`. In round 2 each question offered two families of three, built from the two
options kept from round 1. Round 3 asked one question again: how the chosen filter panel and records opened beside the
list work as one place to browse, after a first join (one strip of tabs with the results as its first tab, a filter
rail labelled sideways) needed more work.

## Considered options

- Home: Ledger (today's), Shelves, Your homebrew, Search first, Rulebook, Next session; then Shelves and Search first,
  each refined with two variants (Two shelves, Homebrew shelf; Pinned, Search over shelves).
- Browsing a kind: Table (today's), Kinds rail, Cards, Filter panel, Grouped, Query line; then Filter panel and Query
  line, each refined with two variants (Kinds and filters, Filters above; Query and counts, Saved views).
- A record: Beside the list (today's), Its own page, Drawer, Card, One scroll, Side by side; then Beside the list and
  Drawer, each refined with two variants (Three panes, Open tabs; Stacked drawers, From below).
- Browsing and records together (round 3): Three panes, One sidebar, Filters fold into the list, Preview then keep, Walk
  the results, Side by side.
- Making homebrew: Studio (today's), One form, On the card, One question, Against the SRD, Write it out; then Studio and
  One form, each refined with two variants (Card as the steps, Steps across the top; Folding sections, Paired with the
  card).

## Decision

1. The Compendium takes the theme's Titled section bar; its search is the bar's field and New homebrew its primary.
2. Home is Shelves: the nine kinds as cards with their counts, homebrew and a few records, Needs you across the top and
   the sources at the foot.
3. Browsing is a filter panel with a count beside every choice, and the active filters as chips over the table.
4. Browsing and records are three panes: the filter panel, the results and the record side by side, all live. The open
   records are tabs over the record only, and a record's Card, Sharing and History are a switch in its head, so there
   are never more than two rows of tabs. Each pane folds to an edge read across. Going back to the full-width table
   keeps the open records. Edit opens the studio over the panes with the open records' tabs kept.
5. Making homebrew stays the studio, with each step's answer shown in the rail and what differs from the SRD marked in
   the preview.
6. Eleven rules for the Compendium, listed in `docs/design/polish/G-compendium/SPEC.md` section 3.

## Consequences and tradeoffs

- Prep work that moves between several records (a monster, a copy of it, a spell) no longer loses the list or the
  filters; each record stays a tab away, and ticking a filter never hides the record being read.
- The open tabs are client state in the browser tab; they are not saved to the campaign and do not follow the GM to
  another device.
- Facet counts are worked out in the client from the records it already has; a kind with many filters costs more to
  count, which the plan measures.
- Three panes on a laptop (250 px, 300 px and the rest) leave the record about 730 px at 1280 px wide; the stat block
  fits, and the filters stay beside the list they change. Folding a pane gives the record more room.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area. On a phone the filters are a sheet, records open full screen with the open
  records as a strip, and editing pins Back and Next.
- No data, command, projection or route changes. Who sees a record and a draft's rule against sharing are unchanged; a
  player never gets a monster's stat block. The player's Compendium reader inside the Codex is not changed by this
  work.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/G-compendium/compendium.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
