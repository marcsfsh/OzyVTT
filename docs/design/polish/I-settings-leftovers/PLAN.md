# I Settings' leftovers: building them

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan redraws Settings' side list as the settled side list, groups the API reference
as Settings' rows with each operation's command, puts an operation's request and response side by side, puts Token image
and Release on At the table's rows, and gives a credential its own page. It adds no rules, commands, routes, projections
or data. File paths and line numbers were read at `f5e166f`; the theme (T), the frame (A), Settings (I) and F's time and
tools (Z) land on the same branch first or alongside, so confirm every anchor before editing. Paths are under
`apps/client/src/` unless they start with `packages/`, `apps/server/`, `e2e/` or `docs/`.

This is I1, I2, I6 and I7 in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build
it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, U0 to U6, each
  about one commit.
- The reference is `settings-leftovers.html` in this folder. Open it in a browser (fonts load from Google Fonts;
  everything else is inline). It opens on the approved choices. Use the Page switch (The API reference, An operation,
  The commands, At the table, A credential's history, Settings' list). The other options are the ones the owner turned
  down; build only the chosen ones. `history/1-round-1.html` is the round as it was shown, with the time and tools check
  the owner confirmed.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code and its data is invented.
  Build with the existing components, hooks and primitives, and with the settled ones (Settings' frame and rows, the
  side list E2 and G built, the token picker). Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The API reference: each tag a group of Settings' rows.
2. An operation: the request and the response side by side.
3. The commands: each row names its command; the separate table goes.
4. At the table: Token image and Release as buttons on the row.
5. A credential's history: its own page.
6. Settings' side list: the settled side list.
7. Seven rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, A's dialogs (A6), Settings (I1 to I5), the side list (K1, X1) and F's time and tools (Z6, the
  Codex group). If a piece this needs is missing, stop at the phase that needs it and tell the user.
- CLAUDE.md applies in full. Every route stays: `GET /api/v1/openapi.json`, the command catalog the reference reads,
  `GET POST /api/v1/gm/integration-credentials`, `GET .../{id}/audit`, `POST .../{id}/rotate`, `POST .../{id}/revoke`,
  `POST /api/v1/game/claims/{actorId}/force-release`, and the token image routes. If any step seems to need a server,
  schema, command, route or projection change, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

- `settings/SettingsPage.tsx`: `SettingsPage` (60), the side list from I (its rows with a line each).
  `settings/sections.ts`: the sections and their lines.
- `integrations/ApiReference.tsx` (455 lines): `MethodMark` (43), `ApiReference` (47), the Operations and Commands
  switch (232 to 240), the operations list (298), `CommandsTable` (406). `integrations/api-rows.ts`, `openapi-model.ts`.
- `integrations/OperationDocument.tsx` (275 lines): `FieldTable` (33), `OperationDocument` (69).
- `settings/PlayersSection.tsx` (191 lines): At the table (95 on), the Actions menu (117 to 120, Force release and Set
  token image).
- `integrations/CredentialsTable.tsx` (405 lines): `AUDIT_WORDS` (18), `CredentialsTable` (47), the History dialog
  (219), `NewCredentialDialog` (269), `SecretDialog` (363). `settings/AccessSection.tsx` (145 lines).
- Tests: `integrations/api-reference.test.tsx`, `integrations/credentials-table.test.tsx`,
  `settings/settings-page.test.tsx`, `settings/table-settings.test.tsx`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                     | New or changed                                               | Built from                         |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------- |
| Settings' side list      | Changed: rows of the settled side list, with the Codex group | `SettingsPage`, the side list      |
| The grouped reference    | Changed: the table becomes a group of rows per tag           | `ApiReference`, Settings' rows     |
| A command on each row    | Changed: `CommandsTable` goes; each row names its command    | the command catalog                |
| An operation's two sides | Changed: request and response in two columns                 | `OperationDocument`, `FieldTable`  |
| Buttons at the table     | Changed: the Actions menu becomes two buttons                | `PlayersSection`                   |
| A credential's page      | New: `/settings/access/credentials/{id}`                     | `CredentialsTable`, the audit read |

How the parts fit, so the phases agree:

- A command matches an operation by the catalog's route for it; an operation with none says "No command".
- A credential's page is `/settings/access/credentials/{id}`; the side list keeps Access lit there.
- The section's line (I 2.1) moves into each section's head; search keeps finding by it.

## 5. Phases

### U0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `I-settings-leftovers/`, and
   leave the other pieces' folders as the zip has them.
2. Add `I-settings-leftovers/ADR-0071-settings-leftovers.md` as `docs/adr/0071-settings-leftovers.md`, Accepted, and its
   row to `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### U1: Settings' side list

1. The side list: search at its top, SECTIONS with icons and counts, then CODEX; the chosen lit; each section's line in
   its head. A phone's first page is the same list.
2. Tests: `settings-page.test.tsx` (the rows and counts, the chosen row, search still finds by a section's line).

### U2: the grouped reference with commands

1. The field, then each tag as a group of Settings' rows with the method, summary, path, command and who can call it;
   Tags, Filters and Sort in the field's menu; `CommandsTable` and the switch go.
2. A phone: rows stacked.
3. Tests: `api-reference.test.tsx` (a group per tag, a row names its command or No command, finding by a command).

### U3: an operation's two sides

1. REQUEST and RESPONSE · 200 side by side with their examples; other responses under it; who can call it in the line.
2. A phone: Request and Response as a Base line control.
3. Tests: both sides render the document's fields; the control switches on a phone.

### U4: buttons at the table

1. Token image and Release on each row; Release keeps its confirm; Token image opens the token picker.
2. Tests: `table-settings.test.tsx` (the buttons call today's routes, Release confirms).

### U5: a credential's page

1. The page with its line, Rotate and Revoke as rows, and its history as rows; the table's name opens it; History goes.
2. Tests: `credentials-table.test.tsx` (the page reads the audit, a refusal is amber, Rotate shows the secret once).

### U6: docs and cleanup

1. `docs/DESIGN.md`: Settings' side list, the reference's rows, a credential's page. `docs/ARCHITECTURE.md`: the
   credential's address.
2. `docs/adr/README.md`: 0071 Accepted and built. `docs/design/polish/CATALOG.md`: I1, I2, I6 and I7 move to Built.
3. Remove what nothing uses: the side list's line styles, `CommandsTable`, the History dialog, the Actions menu.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a player at the table and three credentials (one used, refused once and rotated; one revoked), look in Dusk and
  Dawn at:
  - 1280 by 800 with a mouse: Settings' side list on every section; the reference, finding by a command, an operation;
    At the table's buttons; a credential's page.
  - 390 by 844 with touch: the same; every control at least 44 px; no sideways scroll.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- New credential's dialog and the secret's dialog keep today's design, drawn as A's dialog.

## 8. Departures from the mockup, on purpose

- The mockup's operations, commands and credentials are invented; the app reads its own.
- The mockup does not draw the field's menu (Tags, Filters, Sort), an operation's other responses, Release's confirm or
  Rotate's secret; sections 2.1, 2.2, 2.4 and 2.5 place them.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `settings-leftovers.html`.

- `p6-head.js`: `railList()` (Settings' side list as the settled one) and `tableCtl()` (At the table's buttons).
- `p6-body2.js`: `groupsBody()` and `opRowG()` (the grouped reference with commands), `opPage()` (the `split` branch),
  `atPage()` (the `buttons` branch), `credPage()` (the `page` branch).
- `p4j-set.css`: Settings' frame, rows, and the matched side list (`.i-rail.m`, `.i-plist.m`), the method tag
  (`.i-meth`) and code (`.i-code`, `.i-pre`). `p4h-f2.css`: the side list's rows (`.u-ri`).
- `p6-dec2.js`: the decisions, the Carried in list and the rules. `p6-body.js` is Settings' approved sections.
- `audit-k.js`: the "Today" screenshots.
