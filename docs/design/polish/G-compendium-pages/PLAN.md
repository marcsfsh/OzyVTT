# G The Compendium's pages: building them

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds Sources with the sources at the side, Sharing with the kinds at the
side, a record's history as compact rows in a side column, merging as A's dialog, and a record's sharing in the side
column. It adds no rules, commands, routes, projections or data. File paths and line numbers were read at `f5e166f`; the
theme (T), the frame (A), the Compendium's frame (G) and F's finding and pages (N) land on the same branch first or
alongside, so confirm every anchor before editing. Paths are under `apps/client/src/compendium/` unless they start with
`apps/client/src/` (written `src/`), `packages/`, `apps/server/`, `e2e/` or `docs/`.

This is G4, G5 and G6 in `../CATALOG.md`, with the rules that settle G7, G9 and G11. `SPEC.md` beside this file is what
was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, X0 to X6, each
  about one commit.
- The reference is `compendium-pages.html` in this folder. Open it in a browser (fonts load from Google Fonts;
  everything else is inline). It opens on the approved choices. Use the Page switch (Sources, Sharing, A record's
  history, Two devices, A record's sharing). The other options are the ones the owner turned down; build only the chosen
  ones. `history/1-round-1.html` is the round as it was shown, with the Atlas check the owner confirmed.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code and its records are invented.
  Build with the existing components, hooks and primitives, and with the settled ones (G's frame, E2's folders at the
  side, F2's version history and side column, A's menu and dialog, T's Base line). Section 8 lists where the plan
  departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. Sources: the sources at the side, the chosen one at the right with In pickers, its kinds and what needs you.
2. Sharing: the kinds and Shared or Hidden at the side, each published record's Who sees it as a Base line control.
3. A record's history: the Codex's compact rows in a side column, a version read under a cyan band.
4. Two devices: A's dialog with This device and The other device for each field.
5. A record's sharing: Share in the side column, with who, what they will read, and the Cup.
6. Eight rules (`SPEC.md` section 3), which settle search's dialog, the catalog picker and the other kinds' editors.

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, the kit's menu and A's dialogs (A6), the Compendium's frame (G1 to G5), F's finding and pages
  (N2's side list, N4's revealing and N5's versions in the side column) and E2's folders (K1). If a piece this needs is
  missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every route stays: `GET /api/v1/homebrew/packs`, `PATCH /api/v1/homebrew/packs/{packId}`,
  `GET /api/v1/homebrew/packs/export`, `POST /api/v1/homebrew/packs/import`, `GET /api/v1/homebrew/overview`,
  `GET /api/v1/homebrew/content`, `POST .../content/{id}/publish`, `PUT .../content/{id}/audience`,
  `POST /api/v1/homebrew/sharing`, `GET .../content/{id}/revisions`, `.../revisions/{revisionId}` and
  `POST .../revisions/{revisionId}/restore`. If any step seems to need a server, schema, command, route or projection
  change, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

- `SourcesView.tsx` (523 lines): `SourcesView` (69), Import a pack and Export a selection (129 to 143), the phone's
  cards (178 on), the table (213 on), `ImportReview` (258), `ExportDialog` (406). `PackSwitch` and `packName` come from
  `pieces.tsx`.
- `SharingView.tsx` (366 lines): `SharingView` (35; published records only, 41 to 50), the phone list (99), the grid
  (126, "Who sees what"), `GridBox` (248), `BulkWhoSeesIt` (279, "Tick records to set them together"), `FocusedRecord`
  (320). `WhoSeesItSwitch` is `packages/ui/src/records/WhoSeesIt.tsx` (146).
- `OverviewView.tsx` (264 lines): Needs you (80, 144), read from `GET /api/v1/homebrew/overview` (`needsYou` rows carry
  `packId`; `byKind` carries the SRD's counts).
- `tableModel.ts`: `CompendiumRow` (11; `packId`, `kind`, `state`, `audience`, `characterIds`), `stateOf` (36).
- `record/RecordView.tsx` (678 lines): the tabs (`RECORD_TABS` in `routes.ts` 39: card, edit, sharing, history), the
  body's switch (541 to 610), `MergePanel` in place of the body when `record.conflict` is set (641).
- `record/HistoryTab.tsx` (296 lines): `HistoryTab` (23), the versions table (148), Restore (203), `BasedOn` (227) with
  Compare with the SRD (273). `record/history.ts`, `record/Compare.tsx` (60 lines).
- `record/Merge.tsx` (167 lines): `mergeRows` (24), `defaultKeeps` (41), `mergedDraft` (46), `MergePanel` (62), "Changed
  on two devices." (89), Keep what is ticked, Keep both changes and Choose field by field (152 to 163).
- `record/SharingTab.tsx` (113 lines): `audienceLock` (9; "Restore it before you share it.", "Publish it before you
  share it."), `audienceWord` (16), `SharingTab` (27).
- `routes.ts`: `/compendium/sources`, `/compendium/sharing`, `?tab=card|edit|sharing|history` (28 to 39).
- `compendium.css` (1315 lines): `.cp-sources`, `.cp-sharing-grid`, `.cp-historytab` and `.cp-basedon` (981),
  `.cp-merge` (1072 on).
- Tests: `compendium.test.tsx`, `record/history.test.ts`, `record/reopen-save.test.tsx`, `record/studio.test.tsx`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                     | New or changed                                                | Built from                           |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------ |
| Sources' side list       | Changed: the table becomes a side list and the chosen source  | `SourcesView`, E2's folders          |
| A source's kinds         | New: counted on the client from the homebrew rows             | `useHomebrewList`, `overview.byKind` |
| Sharing's side list      | Changed: the grid becomes kinds at the side and rows          | `SharingView`, N2's side list        |
| Characters' menu         | New: A's menu at the control with a box per character         | `GridBox`, A's menu                  |
| History's side column    | Changed: the table becomes F2's compact rows and the band     | `HistoryTab`, N5's versions          |
| The merge dialog         | Changed: the panel becomes A's dialog                         | `MergePanel`, A's dialog             |
| Share in the side column | Changed: the tab's parts move to the side column with the Cup | `SharingTab`, N4's revealing         |

How the parts fit, so the phases agree:

- Sources keeps the chosen source in the address: `/compendium/sources?source={srd|table|packId}`; with none, This table
  is chosen.
- A source's BY KIND counts come from the homebrew rows the Compendium already reads (`packId`, `kind`, `state`,
  `audience`), and the SRD's from `overview.byKind`. NEEDS YOU filters `overview.needsYou` by `packId`.
- Sharing keeps its filters in the address (`?kind=` and `?who=shared|hidden`), as the tables do.
- The side columns are the record's: History and Sharing keep `?tab=history` and `?tab=sharing`; the body stays the
  card, and the side column is that tab's part. Back closes the column and returns to `?tab=card`.
- A version being read is `&version={revisionId}`, so the browser's Back leaves it.
- The merge dialog opens from `record.conflict`, as the panel does today; closing it leaves `record.conflict` set and
  the record shows its amber line with Choose.

## 5. Phases

### X0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `G-compendium-pages/`, and leave
   the other pieces' folders as the zip has them.
2. Add `G-compendium-pages/ADR-0068-compendium-pages.md` as `docs/adr/0068-compendium-pages.md`, Accepted, and its row
   to `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### X1: Sources at the side

1. The side list (SRD 5.2.1, This table, each pack, Import a pack) and the chosen source at the right: its name, Export
   a selection and More (Rename and Credit through `PATCH .../packs/{packId}`), its line, In pickers (`PackSwitch`), BY
   KIND and NEEDS YOU.
2. A phone: the sources as chips, then the same parts, Export a selection and Import a pack at the foot.
3. Import a pack's review and Export a selection stay A's dialog (`ImportReview`, `ExportDialog`).
4. Tests: in `compendium.test.tsx`, choosing a source shows its counts and kinds, In pickers writes the pack, Needs you
   holds only that source's rows, the SRD has no switch.

### X2: Sharing with the kinds at the side

1. The side list (All homebrew, each kind, then Shared and Hidden with counts) and the published records as rows, each
   with `WhoSeesItSwitch` as a Base line control; Characters opens A's menu with a box per character and when it reached
   them; Choose in the toolbar is today's `BulkWhoSeesIt`.
2. A phone: the kinds as chips, the control under each name.
3. Tests: a kind narrows the rows, Shared and Hidden narrow them, a control writes `PUT .../audience`, Choose sets
   several through `POST /api/v1/homebrew/sharing`, a monster's row keeps the stat block line.

### X3: a record's history in the side column

1. The History tab keeps the card and opens VERSIONS · {N} in the side column: compact rows, choosing one reads it under
   the cyan band with Restore this version, Back to now and More (Compare with now); Based on with Compare and Open the
   SRD record under the rows.
2. A phone: the rows as the tab's body; choosing one opens it under the row with Restore this version.
3. Tests: `history.test.ts` and `compendium.test.tsx` (reading a version, Restore puts it in the editor's copy, Compare
   with now and Compare with the SRD show their fields, Back to now).

### X4: merging as A's dialog

1. `MergePanel`'s rows in A's dialog: "Changed on two devices", today's line, each field with This device and The other
   device as choices, Keep what is ticked as the Cup and Keep both changes; with nothing both changed, today's line and
   Keep both changes alone.
2. Closing it keeps the conflict: the record's amber line with Choose reopens it.
3. A phone: the dialog from the foot.
4. Tests: `reopen-save.test.tsx` (a conflict opens the dialog, each choice lands in the saved draft, closing keeps the
   amber line, Choose reopens it).

### X5: a record's sharing in the side column

1. The Sharing tab keeps the card and opens SHARE in the side column: Back, Everyone and each character as boxes with
   when it reached them, WHAT THEY WILL READ, the stat block line for a monster, where players meet it and Not sent to,
   and the Cup that says what it will do. On a draft the Cup sits under "Publish it before you share it." and publishes
   before it sets who sees it; on a deleted record `audienceLock`'s line replaces it.
2. A phone: the same parts as the tab's body.
3. Tests: ticking a character changes the Cup's words, the Cup writes `PUT .../audience`, a draft publishes first, a
   deleted record offers no Cup, a monster shows the stat block line.

### X6: docs and cleanup

1. `docs/DESIGN.md`: the Compendium's side lists and side columns, the merge dialog. `docs/ARCHITECTURE.md`: the
   addresses in section 4.
2. `docs/adr/README.md`: 0068 Accepted and built. `docs/design/polish/CATALOG.md`: G4 to G6 move to Built.
3. Remove what nothing uses: the sources table, the sharing grid and `GridBox` if the menu replaces it, `MergePanel`'s
   table, `.cp-sharing-grid` and `.cp-merge-table`.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With This table's homebrew (an item sent to one character, a spell for everyone, a draft monster, a hidden feat), one
  imported pack, and a homebrew copy of an SRD monster with three versions, look in Dusk and Dawn at:
  - 1280 by 800 with a mouse: each source; Sharing by kind and by Shared and Hidden, Characters' menu and Choose; the
    copy's History reading a version and comparing with the SRD; a conflict from a second browser; Share on a draft and
    on a published record.
  - 390 by 844 with touch: the same, with the chips, the tabs' bodies and the dialog from the foot; every control at
    least 44 px; no sideways scroll.
- As a player: the Compendium they see is unchanged; a shared monster shows no stat block.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- New homebrew (G rule 3.8) and Add to an encounter (G rule 3.7).
- The studio's steps for each kind beyond the frame rule 3.3 gives them.

## 8. Departures from the mockup, on purpose

- The mockup's Sharing rows include the draft monster; the page lists published records only, as today, since a draft
  cannot be shared.
- The mockup's Characters control does not draw its menu or name who on the row; section 2.2 of `SPEC.md` places both.
- The mockup draws the merge dialog over the Card tab and the history band without its More.
- The mockup's records and counts are invented; the app reads its own.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `compendium-pages.html`.

- `p6-body2.js`: the round's pages. `sourcesPage()` (the `rail` branches are the chosen Sources), `sharePage()`
  (`rail`), `histPage()` (`rows`), `mergePage()` (`dialog`), `rsharePage()` (`side`), and `recFrame()` and `recPhone()`,
  the record's frame from G's three panes.
- `p6-dec2.js`: the decisions, the Carried in list and the rules. `p6-body.js` and `p6-dec.js` are G's frame.
- `p4h-comp.css` and `p4h-f2.css`: G's parts and F2's version rows (`.u-ver`, `.u-band`), the side column and the chips.
- `audit-g2.js`: the "Today" screenshots.
