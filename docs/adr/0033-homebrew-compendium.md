# ADR-0033: The homebrew Compendium

## Status

Accepted. Amends ADR-0026: the wizards' steps stay, inside a new frame. `RecordDetail` and the wizard's own frame are
gone, and the full editor's sectioned form with them. The Compendium's record view holds the draft, and creating and
editing walk the same steps.

## Context and decision drivers

The Homebrew tab was a rail of the GM's own records beside one editor. A walkthrough as the GM on a laptop and a
phone, and three directions mocked up from it (A Page, B Compendium, C Studio), found the costs:

- homebrew stood apart from the SRD: a GM looking for a level 3 Evocation spell could not see Fireball and a
  homebrew spell side by side, and a copy lost its link to what it was copied from;
- a record had one player flag, shown to every player or to none, while the table reveals homebrew a piece at a
  time, often to one character first;
- an import forgot where its records came from, so a pack could not be credited or switched off, and its plan
  listed ids;
- the wizard's preview was its own drawing of a stat block and a card, which drifted from what the table, the
  builder and the sheet show;
- a save that met a newer copy offered Reload, which dropped what the other device had changed or what this one had;
- four bugs from the walkthrough (marcsfsh/OzyVTT#153 to #156): a full caster on a blank class had no slots, an
  action's kind change lost its answers, a saving throw could not go without damage, and an item named the spell it
  casts by its id.

The owner picked B, with C's creation wizard and a collapsible flyout for the table (the decisions file of the
remaster). The drivers were docs/DESIGN.md's page patterns and the server deciding everything. The projections stay the
security boundary.

## Considered options

1. **Keep the rail and restyle it.** Least change, but homebrew stays apart from the SRD and the flag stays one bit.
2. **A: one page per record with its rules in a drawer.** Clear for one record, slow for finding one among 339 spells.
3. **B: a Compendium of tables, SRD and homebrew together, a record docked beside its table.** Chosen.
4. **C: a studio with a board and releases.** Its creation steps and pinned preview were the best of
   the three; its board and release notes add a workflow the table does not have.

On the server:

- **Keep the flag and add a second "shown to" list.** Rejected: two fields that both decide who sees a record drift.
- **Filter one player catalog per request.** Rejected: derived reads (offers, a list's membership, the progression
  table) are built from the slice, so a list id or a count would leak through a derived field.
- **A pack switch as unpublish.** Rejected: switching back on would have to remember who saw what.

## Decision

Option 3, with C's studio for making and editing. The GM's tab is the Compendium (`apps/client/src/compendium/`).

- **Sections in a bar** (`CompendiumShell.tsx`): Overview, Tables, Sources and Sharing, the search (Ctrl K) and New
  homebrew; a phone has them as a tab bar at the bottom with New. Every view and every record has an address:
  `/compendium`, `/compendium/tables/<kinds>`, `/compendium/sources`, `/compendium/sharing` and
  `/compendium/<kinds>/<id>?tab=card|edit|sharing|history`, with the table's filters and sort riding in the query.
  The old `/homebrew` redirects.
- **Overview** counts sources and kinds (a count opens its table with that filter) and lists what needs the GM, each
  line with its button.
- **Tables** (`CompendiumTable.tsx`, the GM's `TablesView.tsx`): one table per kind with the SRD's rows and the
  homebrew together, the kind's own columns (`kinds.tsx`), a Kind dropdown, Source, Filters as the Codex's flyout,
  the Codex's multi-column Sort dialog, a Problems column and filter, and the GM's State, Who sees it and Modified.
  The players' Compendium draws the same table over their own read. The pure rules of filtering and sorting are in
  `tableModel.ts`.
- **A record** (`record/RecordView.tsx`) opens beside its table on a wide laptop with Card, Edit, Sharing and History.
  On Edit, or narrower, it takes the width and the table folds into a flyout that keeps its kind and filters; picking
  a row there opens that record. This departs from the page pattern's metadata panel: B gives a record's state, who
  sees it and its history each a tab, so the docked sheet stays narrow enough to keep its table in view. An SRD
  record opens read only with Make a homebrew copy, which asks for the name first.
- **The studio** (`record/Studio.tsx`) draws the wizard's steps (ADR-0026) down the left with readiness, the step's
  questions in the middle and the preview pinned on the right from 980 pixels; Steps or All questions; a readiness
  ring in the header; Review last, with what is left by step and Go to it. `wizard/steps.ts` gives every editor field
  no step asks one home step (More answers), so nothing the old full editor asked lost its place. A phone gets a
  strip of steps and the preview as a bar over the bottom tabs. `useHomebrewRecord` holds the draft, its autosave,
  Publish and every state change once, so the tabs are views of one draft.
- **Previews are the page**: `CompendiumCard` draws a spell with the sheet's spell card, an item with the sheet's
  `ItemCard`, a class, subclass, species, background or feat with the builder's detail, and a monster with the stat
  block the bestiary uses (`encounter/StatBlock.tsx`, which replaces the wizard's `StatBlockPreview`). A draft
  becomes those components' input through `homebrew/summaries.ts`, which a mirror test holds equal to the server's
  catalog summary for every kind. See as reads the card through `see-as/content`, the server's read for Everyone or
  one character.
- **Sharing** (`SharingView.tsx`) is a grid of published records against Hidden, Everyone and each party character,
  with Who sees it for ticked rows in one write; a record's Sharing tab holds its row, where each audience meets it
  and since when. The Compendium is a record surface, so it says who sees a record in the Codex's words through the
  `WhoSeesItSwitch` in `@vtt/ui`.
- **Sources** lists the SRD, this table and each imported pack with their counts and credit, and each pack has its
  switch. Import is a review
  table from the server's dry run with a decision per record; export is a selection under a pack name.
- **History** is a table of versions (each publish, numbered) and the edits between them: when and from which device
  each was written, and the fields it changed; two ticked rows compare field by field with the changed words marked, and Restore puts the older
  back as changes not live. A copy compares with its source. A save that meets a newer copy opens a merge table of
  every field either device changed, both kept by default, or chosen field by field.
- **Players** get a Compendium section in the Codex (`player/CodexCompendium.tsx`, registered in the Codex's section
  registry), read only, over `GET /content/compendium` with their own token: the SRD and the homebrew shared with
  their characters, no monsters. Homebrew is marked where it meets players (the builder and the gear picker) and, for
  the GM, in the bestiary and pickers, with Hidden marked (`homebrew/marks.tsx`).

On the server (written with the server's notes):

- **Who sees a record is an audience** on the row: Hidden, Everyone, or a set of party characters, with a reveal stamp
  each time the published record reached an audience it did not reach before. A draft is always Hidden, and
  unpublishing hides. Every player read is built for one reader (`ContentLibrary.forAudience`): the GM's catalog, a
  reader's (the characters a player session claimed, or the ones a Codex preview names), or play. A player command
  that adds a record checks it against the player's own catalog.
- **Packs are kept as packs** (`homebrew_packs`): this table's own and each imported pack, with a name, credit, import
  time and a switch. Off takes a pack's published records out of every catalog without unpublishing them; play keeps
  them, so a character keeps its items. Import is decided per record from a dry run. A published record is never
  replaced.
- **History is read**: every write leaves a row with its event and device, marked when its body is changes not live; a stale `expectedRev`
  answers 409 with the fields the stored copy changed and both values.
- **Names first, and references by name**: ids are minted from real names, a duplicate keeps what it was
  based on, a record document names every record its body mentions, and every publish issue is a sentence
  (`packages/content-srd-5.2.1/src/homebrew-issues.ts`, which the editor's checklist now uses too).
- The deprecated `visibleToPlayers` field and `/visibility` route are removed now that the client uses `audience`.

## Consequences and tradeoffs

- One rendering per thing: the bestiary and the Compendium draw the same stat block, and the Compendium's cards are
  the builder's and the sheet's own. A change to how a spell or a monster prints
  shows everywhere at once.
- Tables read every kind's rows for names (a subclass's class, a background's feat); each read is cached per token
  and refreshed by the content-free ping, so the cost is one fetch per kind per change.
- The studio's More answers keeps fields the wizard does not ask behind a fold on the step that owns them; a GM who
  wants every field at once uses All questions.
- Monsters are created from a blank or a copy; seeding a new row from the table's filters (a new monster at the
  filtered CR) is not built.

## Mobile, security, and visibility impact

The audience is the largest security change of the remaster, pinned by `homebrew-audiences.test.ts` through the real
server: a record shown to one character is absent byte for byte from the others' reads, the builder's offers, the
Compendium and the socket. The client never filters a GM shape down for a player: the players' Compendium reads only
the player route, and See as reads the server's own read for that reader. Players never get a pack name, an audience
or a reveal date. The player item summary gained `rarity` and `attunement`, which its printed line already carried
(`magic-item-far-end.test.tsx`).

Phones get every feature: the section tab bar, lists with the two facts that matter, a record full screen with its
tabs, the step strip and the preview bar, the sort dialog and the review cards. Targets are 44 pixels and nothing
scrolls the page sideways at 390 pixels.

## Migration / reversibility

Homebrew store migration 3 turns a shown record into Everyone with one stamp and the rest into Hidden, gives history
rows their events, and puts every record in this table's pack. An old pack file imports into a pack of its own.
`/homebrew` redirects to `/compendium`. The client removed `HomebrewPanel`, `HomebrewRail`, `CreateRecordModal`,
`PackActions`, `RecordDetail`, `WizardView`, `StatBlockPreview` and the duplicate-source catalog; their behaviour
tests moved to the Compendium.

## Validation evidence

- `compendium/preview-parity.mirror.test.ts`: the card drawn from a draft equals the server's summary of the published
  record for every kind, and a monster's preview prints as the bestiary prints it.
- `compendium/compendium.test.tsx`, `record/studio.test.tsx`, `record/reopen-save.test.tsx`,
  `record/history.test.ts`, `model.test.ts` and `player/codex-compendium.test.tsx` cover the tables, See as, copies,
  New homebrew, the sharing grid, import review, the studio's steps, the merge and the players' read.
- The four bugs each have a test that fails without its fix: `level-table-slots.test.tsx` (#153),
  `wizard/action-kind-switch.test.tsx` (#154), `wizard/save-without-damage.test.tsx` (#155) and
  `cast-row-names.test.tsx` (#156).
- Screenshots of every moment of the mockup on the GM's and a player's laptop and phone were compared with B and C.
