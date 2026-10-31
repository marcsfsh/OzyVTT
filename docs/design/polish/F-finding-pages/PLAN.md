# F Finding and pages: building it

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the Codex's search page as panes, the pages index with the kinds,
folders and tags at the side, and a page's side column so a tag, a reveal and the versions each take it in turn. Ctrl
K's palette and the page picker become A's search dialog in the Codex. It adds no rules, commands, routes, projections
or data. File paths and line numbers were read at `f5e166f`; the theme (T), the frame (A) and the Codex's frame (F) land
on the same branch first or alongside, and F's frame rebuilds `GmPage.tsx` and `PlayerPage.tsx`, so confirm every anchor
before editing. Paths are under `apps/client/src/codex/` unless they start with `apps/client/src/` (written `src/`),
`packages/`, `apps/server/`, `e2e/` or `docs/`.

This is F1.3 to F1.5 and F2.1, F2.5, F2.6 and F2.8 in `../CATALOG.md`. `SPEC.md` beside this file is what was decided;
this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, N0 to N6, each
  about one commit.
- The reference is `finding-and-pages.html` in this folder. Open it in a browser (fonts load from Google Fonts;
  everything else is inline). It opens on the approved choices. Use the Page switch (Search, The pages index, A tag,
  Revealing, Version history). The GM is on both sizes. The other options are the ones the owner turned down; build only
  the chosen ones. `history/1-round-1.html` is the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its campaign is a stand-in.
  Build with the existing components, hooks and primitives, and with the settled ones (F's Wiki page and side column,
  A's search dialog, menu and dialog, E2's folders at the side, G's panes, T's Base line). Section 8 lists where the
  plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. All the results are panes: kinds and who sees them, the results, and the chosen page.
2. The pages index puts the kinds, the GM's folders and the tags at the side.
3. A tag on a page opens in the page's side column; in a list it filters the list.
4. Revealing opens in the side column.
5. Version history opens in the side column, one compact line a version; choosing one shows the page as it was.
6. Ctrl K's palette and the page picker are A's search dialog in the Codex.
7. Seven rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, A's search dialog (A4), the kit's menu and A's dialogs (A6) and F's frame (F1 to F4: the
  Codex's Titled bar, the Wiki page with its side column and phone tabs). E2's folders column (K1) is the model for the
  index's side list; if K1 is on the branch, share its component rather than writing a second one. If a piece this needs
  is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every route stays as it is: `GET /api/v1/codex/search`, the pages and folders routes,
  `PUT .../blocks/{blockId}/audience`, `PUT .../fields/{key}/audience`, `GET /api/v1/codex/pages/{id}/revisions`,
  `POST .../revisions/{revisionId}/restore` and `DELETE /api/v1/codex/page-revisions`. A player's search, index and tags
  read only the player feeds they read today. If any step seems to need a server, schema, command, route or projection
  change, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 Finding

- `search/SearchView.tsx` (501 lines): `SearchView` (120 on), the region "Search" (169), the Type, Visibility and
  Modified menus and Sort, the table of results, the Kinds chips on a phone (445). Route `/codex/search?q=`.
- `SearchResults.tsx` (143 lines): `useCodexSearch` (26), `searchHitKindLabel` (81), `searchHitTitle` (87),
  `searchHitKey` (101), `SearchResultRow` (113).
- `CommandPalette.tsx` (191 lines): `CommandPalette` (37), "Search the Codex" (130), its last row New page "{text}".
  Mounted at `CodexShell.tsx:227` and `PlayerCodex.tsx:125`.
- `TagView.tsx` (216 lines): `TagView` (52), its groups Pages (99), Maps (116), Pins (143), Journal entries (164),
  Sessions (181) and Quests (198). Mounted by `shell/sections.tsx` (`GmTags` 36, `PlayerTags` 56). The route is
  `routes.ts` 22, 74, 147, 175 (`tagPath`).
- Tests: `search/search.test.tsx` (276 lines), `palette.test.tsx` (415 lines), `navigation.test.tsx`,
  `player-gm-only-address.test.tsx`.

### 3.2 The pages index

- `page/PagesIndex.tsx` (337 lines): `RevealedCount` (36), `PagesIndex` (65), "Find a page by name" (188), the tags
  (194), the kinds with revealed and hidden counts, the Folders section (252, "Your own filing. Players never see it."),
  "New folder name" (268), Every page. Mounted by `page/PageSection.tsx` (9 for the GM, 15 for a player).
- Tests: `page/index.test.tsx` (51 to 199: counts, filters, folders, tags), `list-filters.test.tsx`.

### 3.3 A page's side column and its overlays

- `page/GmPage.tsx`: `revealing` (109), the overlays (233 to 251: `RevealPanel` and `RevisionHistory`), the block's
  Reveal (273, 354), More (331 to 337, Version history at 333), the side column's Relationships (413) and tags (418),
  the phone tabs Overview and Relations (71, 457 to 480), `aside.cx-page-meta` "About this page" (530).
- `page/PlayerPage.tsx`: tags (174, 189), `aside.cx-page-meta` (196).
- `page/MetaPanel.tsx` (237 lines): `metaFields` (22), `RelationshipList` (85), `FieldList` (111), `OnTheAtlas` (134),
  `MentionedOn` (202), `TagChips` (224, `#tag` buttons that call `onPick`).
- `shared/RevealPanel.tsx` (128 lines): its Modal (54), "Reveal {name}" (59), "Who sees it" (80), "What they will read"
  (116). Used at `GmPage.tsx:234`, `quests/QuestsView.tsx:543`, `src/tonight/TonightTab.tsx:508` and
  `src/table/CodexTab.tsx:158`; tested in `shared/shared.test.tsx` (84 to 130).
- `RevisionHistory.tsx` (60 lines): the Modal "Version history" (30), the line on how often versions are saved (31 to
  39), each version's `v{rev}`, when and title with Restore (44 to 54). Used at `GmPage.tsx:246` and
  `page/PageWriter.tsx:465`. A revision (`packages/domain/src/codex-wire.ts:326`) carries its title, player text,
  blocks, banner and tags.
- `shared/PagePicker.tsx` (136 lines): `PagePicker` (15), "Find a page" (88). Used at
  `relationships/RelationshipEditor.tsx:239`, `relationships/RelationshipsView.tsx:432`, `prep/PrepEditor.tsx:227` and
  `631`, `quests/QuestWriter.tsx:361`; tested in `shared/shared.test.tsx` (137 to 158).
- Tests: `page/page.test.tsx` (99: the hidden block's Reveal), `page/writer.test.tsx`, `quests.test.tsx`,
  `relationships/relationships.test.tsx`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                       | New or changed                                                | Built from                                        |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| Search panes               | Changed: the table becomes kinds, results and the chosen page | `SearchView`, `useCodexSearch`, `SearchResultRow` |
| The index's side list      | Changed: kinds, folders and tags at the left                  | `PagesIndex`, E2's folders column                 |
| The side column's swap     | New: one slot in the page's side column, with Back            | `GmPage`, `PlayerPage`, `MetaPanel`               |
| A tag in the column        | Changed: `TagView`'s groups as the column's body              | `TagView`                                         |
| The reveal in the column   | Changed: `RevealPanel`'s body without its Modal               | `RevealPanel`                                     |
| Versions in the column     | Changed: compact rows, the version line, reading a version    | `RevisionHistory`                                 |
| The palette and the picker | Changed: A's search dialog in the Codex                       | A's search dialog, `CommandPalette`'s rows        |

How the parts fit, so the phases agree:

- The swap is one piece of page state:
  `side: { kind: "facts" } | { kind: "tag", tag } | { kind: "reveal", target } | { kind: "versions", revisionId? }`. The
  column renders the facts or the one part, with Back to the facts at its head; opening another part replaces the open
  one. Escape and Back both return to the facts. On a phone each open part is a tab after Overview and Relations, named
  `#tag`, Reveal or History, and Back closes the tab.
- The tag's address: a tag pressed on a page sets `?tag=` on the page's address, so the browser's Back closes it. A tag
  pressed in a list sets `?tag=` on that list. `/codex/tags/:tag` redirects to `/codex/pages?tag=`.
- The index's address keeps the chosen group: `?kind=person`, `?folder=Villains` or `?tag=thornwick`, so a page and Back
  return to it.
- The search page's chosen result is in the address (`?q=ash&hit={key}` from `searchHitKey`), so Back returns to it. The
  chosen page pane reads the page through the same feed the page itself uses (the GM's or the player's).
- Reading a version: the main column renders the revision's title, player text and blocks with the page's renderer, the
  version line above it. What changed is worked out in the client by comparing each revision with the next newer one
  (the newest with the page now): renamed, added or took out a block (by its title), changed the text, changed the tags,
  changed the banner. Where a block or paragraph exists now and not in the version, a cyan "Added since: {block or the
  paragraph's first words}" line marks the place.
- The palette and the picker: A's search dialog takes a scope (the Codex) and a mode. The palette mode keeps today's
  rows and last row New page "{text}"; the picker mode offers only pages, is titled for what it links (for example "Link
  a page to Centre on") and calls the picker's `onChange` with the chosen page's id.

## 5. Phases

### N0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `F-finding-pages/`, and leave
   the other pieces' folders as the zip has them.
2. Add `F-finding-pages/ADR-0064-finding-and-pages.md` as `docs/adr/0064-finding-and-pages.md`, Accepted, and its row to
   `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### N1: search as panes

1. `SearchView` becomes three panes under the Codex's bar: Kinds (All and each kind with its count) and Who sees it
   (Everyone and Hidden, today's Visibility filter; the GM's only), the field with the count and the results as rows
   (`SearchResultRow` restyled: the kind's icon, the name with the match lit, the kind and the matched line, who sees
   it, More), and the chosen page in its compact title row with the match lit and its facts. Modified and Sort move into
   the results' More.
2. The first result is chosen on arrival; arrows move the choice, Enter opens the page. A hit inside a hidden block
   reads "Hidden block:" before its line with the "1 block hidden" tag.
3. A's search dialog's last row, See all {N} results, opens `/codex/search?q=`.
4. A phone: the field, the kinds as chips, the rows; the chosen row opens under itself with the matched part and Open
   the page.
5. Tests: `search.test.tsx` updated (the kinds' counts filter the rows, the chosen pane shows the match, Enter opens,
   arrows move, a hidden block's hit reads so for the GM, a player's results hold no hidden page or block).

### N2: the pages index with kinds at the side

1. `PagesIndex` becomes two columns: the side list (KINDS with counts, FOLDERS · ONLY YOU for the GM with today's
   folders, counts, New folder and each folder's menu, TAGS as `#name` chips with counts) and the chosen group's rows
   (the kind's icon, the name and its line, its tags, who sees it, More) under the toolbar (Find a page by name, the
   count in plain words such as "4 people", Changed with the sort icon, New page), as T rule 17 says.
2. A hidden page's name is violet with its Hidden tag. A player's index keeps the kinds and tags with plain counts, no
   folders, no Hidden and no New page.
3. `/codex/tags/:tag` redirects to `/codex/pages?tag=`; `TagView` stops mounting as a section.
4. A phone: the kinds and then the tags as chips, the rows under them.
5. Tests: `index.test.tsx` updated (each kind's count, a folder shows only its pages, a tag filters the rows, the chosen
   group survives a page and Back, a player sees no folder or hidden page), `navigation.test.tsx` (the tag address lands
   on the filtered index).

### N3: the side column swaps, and a tag in it

1. The swap's state in `GmPage` and `PlayerPage`, the column's head with Back, and Escape.
2. `TagChips`' `onPick` on a page opens the tag in the column: "#thornwick · 4 pages", then `TagView`'s groups that have
   anything, each item a row that opens it. A player's tag lists only what their feeds carry, as `PlayerTags` does now.
3. A phone: the `#tag` tab after Overview and Relations.
4. Tests: `page.test.tsx` (pressing a tag keeps the text and shows its pages; Back returns to the facts; a second part
   replaces the first), the player's tag holds no hidden page.

### N4: revealing in the side column

1. `RevealPanel` splits into its body (Who sees it, What they will read, the stamp's line, the Cup) and its Modal. On a
   page the body opens in the side column, titled "Reveal {name}" in violet, for a block, a field or the page; the Cup
   reads Reveal to everyone or "Reveal to {names}".
2. Revealing writes once through today's audience routes, closes the column and leaves the block reading as revealed.
3. Quests, Tonight and the table's Codex tab keep the Modal with the same body until their own rounds place them.
4. A phone: the Reveal tab with the same parts.
5. Tests: `shared.test.tsx` (the body's choices and payload hold in both hosts), `page.test.tsx` (Reveal on a hidden
   block opens the column, Reveal writes once and closes it), `quests.test.tsx` still passes.

### N5: versions in the side column

1. More's Version history opens Versions · {N} in the column: one line a version (the number, when, what changed), the
   newest reading Now, today's line on how often versions are saved under them.
2. Choosing a version renders it in the main column under the version line ("Reading v3 from Oct 25 · {what changed}",
   Restore this version, Back to now), with Added since marks. Restore calls today's route and returns to now.
3. `PageWriter`'s Version history opens the same column on the page.
4. A phone: the History tab; the chosen version opens under its row with its text and Restore this version.
5. Tests: a new `page/versions.test.tsx` (the rows newest first with Now, what changed from two revisions, reading one
   shows its text and the line, Restore posts once and returns to now, Back to now restores the page).

### N6: the palette, the picker, docs and cleanup

1. Ctrl K in the Codex opens A's search dialog in the Codex with today's rows and last row; `CommandPalette` goes.
2. Every `PagePicker` caller opens A's search dialog in picker mode, titled for what it links, offering only pages;
   `PagePicker` goes.
3. `palette.test.tsx` and the picker's tests in `shared.test.tsx` move to the dialog (Ctrl K opens it, New page "{text}"
   creates, the picker offers only pages and returns the chosen id); `relationships.test.tsx` and `quests.test.tsx`
   still pass.
4. `docs/DESIGN.md`: search as panes, the index's side list, the side column's swap. `docs/ARCHITECTURE.md`: the side
   column's state, the addresses (`?tag=`, `?kind=`, `?folder=`, `?hit=`), one search dialog.
5. `docs/adr/README.md`: 0064 Accepted and built. `docs/design/polish/CATALOG.md`: F1.3 to F1.5, F2.1, F2.5, F2.6 and
   F2.8 move to Built.
6. Remove what nothing uses: the search table and its menus, the tag section, the index's old column, the history Modal,
   the palette and the picker.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With twelve pages (two hidden, one with a hidden block), three tags, two folders and four versions on one page, look
  in Dusk and Dawn at:
  - 1280 by 800 with a mouse: search for a word with arrows and Enter; the index by kind, folder and tag; a tag on a
    page; Reveal on a hidden block to everyone and to two characters; the versions, reading one, Restore and Back to
    now; Ctrl K and a relationship's page picker.
  - 390 by 844 with touch: the same, with the chips, the rows opening under themselves, the page's tabs (`#tag`, Reveal,
    History) and the dialog from the foot; every control at least 44 px; no sideways scroll.
- As a player: search, the index and a tag list only pages they can open; no folders, Hidden, Reveal or History.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- Quests, relationships, the story and the people (F's later rounds), and where Reveal sits there.
- The Atlas and its pins (F3), the Codex's tools, and every route and projection.

## 8. Departures from the mockup, on purpose

- The mockup's version rows say "Hid the Goals field". A revision carries its title, text, blocks, banner and tags, so
  what changed names only those; a change to a field or to who sees a block reads "Saved" until a revision carries it.
- The mockup draws Reveal for a block. The same column serves a field and the page, titled for each.
- Quests, Tonight and the table's Codex tab keep the reveal as a dialog (N4.3) because they have no page side column
  yet.
- The mockup does not draw the picker mode of A's search dialog or the player's search; sections 2 and 4 place them.
- The mockup's pages, tags and versions are stand-ins.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `finding-and-pages.html`.

- `p4h-f2.css`: the match (`.u-hl`), rows (`.u-row`), chips and tags (`.u-chips`, `.u-tagc`), the dialog (`.u-dlg`,
  `.u-fld`, `.u-res`), the side list (`.u-rail`, `.u-ri`), menus (`.u-menu`, `.u-mi`), the reveal's parts (`.u-who`,
  `.u-opt`, `.u-radio`, `.u-stamp`), the version line and rows (`.u-band`, `.u-ver.c`, `.u-add`). `p4g-codex.css` is F's
  frame.
- `p6-body2.js`: `searchPage()` (the `panes` branch), `indexPage()` (`rail`), `tagPage()` (`panes`), `revealPage()`
  (`side`) and `historyPage()` (`side`); the stand-in pages, tags, hits and versions at its head.
- `p6-dec2.js`: the decisions, the Carried in list and the rules. The earlier files are F's frame.
- `audit-f.js`: the "Today" screenshots.
