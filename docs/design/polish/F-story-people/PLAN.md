# F The story and people: building it

Written on 2026-10-30 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the quests as statuses at the side, relationships as a ring on glass,
a faction's standing in its page's side column, the chronicle's composer at the head of the line with any session to
file under, and gives downtime a tab on the story. It adds no rules, commands, routes, projections or data. File paths
and line numbers were read at `f5e166f`; the theme (T), the frame (A), the Codex's frame (F) and F's finding and pages
land on the same branch first or alongside, so confirm every anchor before editing. Paths are under
`apps/client/src/codex/` unless they start with `apps/client/src/` (written `src/`), `packages/`, `apps/server/`, `e2e/`
or `docs/`.

This is F4.5, F4.7 and F5.1 to F5.3 in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how
to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, S0 to S6, each
  about one commit. Phase S5 builds the Downtime tab as `../F3-atlas/SPEC.md` 2.5 decided.
- The reference is `story-and-people.html` in this folder. Open it in a browser (fonts load from Google Fonts;
  everything else is inline). It opens on the approved choices. Use the Page switch (Quests, Relationships, A faction's
  standing, Adding to the chronicle, Downtime and deadlines). Relationships' chosen option is A ring on glass, the sixth
  button, which puts two of the round's options together. The other options are the ones the owner turned down; build
  only the chosen ones. `history/1-round-1.html` is the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its campaign is a stand-in.
  Build with the existing components, hooks and primitives, and with the settled ones (F's Wiki page and side column,
  E2's folders at the side, T's glass and Base line). Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top; `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. Quests put their statuses at the side; a quest opens as a page.
2. Relationships are a ring across the whole page with the controls on glass.
3. A faction's standing opens in its page's side column.
4. The composer opens at the head of the chronicle, filed under any session, with Add here on each session.
5. Downtime is a fourth tab on the story, with the characters at the side (decided in the Atlas round,
   `../F3-atlas/SPEC.md` 2.5).
6. Seven rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin, so pull before reading any anchor.
- This builds on T1 to T3, the kit's menu and A's dialogs (A6), F's frame (F1 to F4) and F's finding and pages (N1 to
  N3: the index's side list and the side column's swap). If a piece this needs is missing, stop at the phase that needs
  it and tell the user.
- CLAUDE.md applies in full. Every route stays: `/api/v1/codex/quests` and its objectives, blocks and reveal,
  `/api/v1/codex/connections`, `/api/v1/codex/standing` and its reveal, `/api/v1/codex/journal` with deadline, downtime,
  milestone and apply-downtime, `/api/v1/codex/sessions` and `/api/v1/codex/calendar`. If any step seems to need a
  server, schema, command, route or projection change, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 Quests

- `quests/QuestsView.tsx` (823 lines): the filters (around 120: "Filter quests", status and audience), the quest page
  (590 on: crumbs, objectives at 647, "About this quest" at 682), `GmQuests` (713), `PlayerQuests` (767);
  `quests/QuestWriter.tsx` (424 lines). Tests: `quests/quests.test.tsx` (321 lines), `codex/quests.test.tsx`.

### 3.2 Relationships and standing

- `relationships/RelationshipsView.tsx` (530 lines): `Web` (99 on, its SVG at 134 to 178), the standing dialog's mount
  (373), the views Web, Factions grid and Over time (388 to 390), `RelationshipsView` (397), the Factions grid (450 on).
  `relationships/relationships.css`. Tests: `relationships/relationships.test.tsx` (225 lines).
- `StandingAdjuster.tsx` (157 lines): the dialog, `STANDING_REASON_MAX` (23). `chronicle.ts` (88 to 104): the seven
  words `STANDING_TIERS` and "Standing reads as a word, never bar length or colour."

### 3.3 The story

- `story/sections.tsx` (1004 lines): `EntryComposer`'s mount (244), `StoryDowntime` (262 to 270, "The Downtime card"),
  the Chronicle's side column with `DateBar` (319) and the Downtime card's two places (332, 352: an old Downtime address
  leads with it). `story/EntryComposer.tsx` (433 lines): the active session as the default (71, 109), the Session field
  (380 to 390), the explicit null for no session (188). `story/Downtime.tsx` (304 lines): `downtimeTotals`,
  `GmDowntime`, `PlayerDowntime`. `story/Chronicle.tsx` (550 lines).
- `routes.ts`: "downtime" is a retired section that lands on the story (27, 58, 81, 105).
- Tests: `story/chronicle.test.tsx`, `story/sessions.test.tsx`, `story/timeline.test.tsx`.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                     | New or changed                                                | Built from                                      |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------- |
| Quests' side list        | Changed: the drawer becomes statuses at the side              | The index's side list (N2), `QuestsView`        |
| The quest page           | Changed: drawn as a Wiki page                                 | F 2.2, `QuestsView`                             |
| The ring                 | Changed: `Web` draws a ring                                   | `Web`                                           |
| The glass                | New: Centre on, the views and the ties on glass over the ring | T's glass, `RelationshipsView`                  |
| Standing in the column   | Changed: `StandingAdjuster`'s body in the side column         | The side column's swap (N3), `StandingAdjuster` |
| The composer at the head | Changed: `EntryComposer` inline, Filed under, Add here        | `EntryComposer`, `Chronicle`                    |
| The Downtime tab         | New: a fourth tab, characters at the side (F3 2.5)            | `storyTabs`, `StoryDowntime`                    |

How the parts fit, so the phases agree:

- Quests' chosen group is in the address (`?status=active`, `?who=hidden`), so a quest and Back return to it.
- The ring: up to eight ties placed evenly from the top, clockwise, in the order the ties panel lists them; a ninth and
  more fold into "+N more", which lights the list. Labels sit at each line's middle on the page colour. The view still
  reads the same connections it does today.
- The side column's swap gains a `standing` part beside N3's `tag`, `reveal` and `versions`.
- The composer keeps one draft; Add here on a session sets the draft's `sessionId` and scrolls the composer into view.
  The session menu lists sessions newest first, then Not in a session (an explicit null, as today).
- The Downtime tab's address is `/codex/story?tab=downtime`; the retired `downtime` section lands on it.

## 5. Phases

### S0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `F-story-people/`, and leave the
   other pieces' folders as the zip has them.
2. Add `F-story-people/ADR-0066-story-and-people.md` as `docs/adr/0066-story-and-people.md`, Accepted, and its row to
   `docs/adr/README.md`. Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### S1: quests with their statuses at the side

1. The side list (STATUS, WHO SEES IT for the GM) with counts, the toolbar, and the quests as rows with progress; the
   quest page as a Wiki page with Objectives and the side column of Facts and Linked pages.
2. A player's list: the statuses with plain counts, no Who sees it, nothing hidden.
3. A phone: the statuses as chips, the rows under them.
4. Tests: `quests.test.tsx` updated (each status lists only its quests, the counts, the group in the address, a player
   sees no hidden quest or objective).

### S2: relationships as a ring on glass

1. `Web` draws the ring with named lines and dashed violet hidden ties; the glass for Centre on, the views and the ties;
   choosing a tie lights its line; "+N more" past eight.
2. Factions grid and Over time under the same glass.
3. A phone: the ring and the ties as a sheet from the foot.
4. Tests: `relationships.test.tsx` (each tie drawn and named, a hidden tie marked for the GM and absent for a player,
   the ninth tie folds into the more, choosing a row lights its line).

### S3: a faction's standing in the side column

1. The side column's `standing` part: the word and numbers, steps, the seven words (choosing one moves the number to its
   middle), Why it moved, Record change. Opened from the faction page's facts and from the Factions grid's cell.
2. A phone: the Standing tab.
3. Tests: steps and a word set the number; Record writes once and closes the column; the reason keeps its 120 limit.

### S4: the composer at the head of the line

1. `EntryComposer` inline at the top of the Chronicle with the kinds, Filed under (session and date menus), the text,
   Hidden note and Link a page, and the kind's Cup; Add here on each session heading while composing.
2. A phone: the same at the top of the Chronicle tab.
3. Tests: `chronicle.test.tsx` (the active session is the default, choosing Session 1 files it there, Not in a session
   sends null, Add here on a session files it under that session, each kind shows its own fields).

### S5: the Downtime tab

1. The fourth tab on the story, as `../F3-atlas/SPEC.md` 2.5 says: the characters with their days and the deadlines at
   the left (the side list of N2), the chosen character's downtime at the right with Log downtime, and what waits to be
   confirmed with Confirm. The Downtime card leaves the Chronicle's side column; the retired `downtime` address lands on
   the tab. The reference is `../F3-atlas/the-atlas.html`, page The Downtime tab.
2. A phone: the characters as chips, what waits, the rows, Log downtime, then the deadlines.
3. Tests: each character's days add up as `downtimeTotals` does; choosing a character shows only their entries; Confirm
   applies through today's route; the old address lands on the tab.

### S6: docs and cleanup

1. `docs/DESIGN.md`: quests by status, the ring on glass, standing in the side column, the composer at the head of the
   line. `docs/ARCHITECTURE.md`: the side column's `standing` part and the addresses.
2. `docs/adr/README.md`: 0066 Accepted and built. `docs/design/polish/CATALOG.md`: F4.5 and F5.1 to F5.3 move to Built.
3. Remove what nothing uses: the quests' drawer, the old web layout, the standing dialog, the composer's dialog.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With four quests (one hidden), five ties on one page (one hidden), two factions with standing and three sessions, look
  in Dusk and Dawn at:
  - 1280 by 800 with a mouse: each status; a quest's page; the ring centred on a faction and on a person; a tie chosen;
    the standing moved by a step and by a word; an entry added to the active session, to Session 1, and to no session.
  - 390 by 844 with touch: the same, with the chips, the ties sheet, the Standing tab and the composer; every control at
    least 44 px; no sideways scroll.
- As a player: quests, the ring and the chronicle show only what they see today.
- With reduced motion and reduced transparency.

## 7. Left as they are, for later rounds

- The calendar editor and a timeline record (rule 3.6), sessions' prep pages.
- The Atlas (F3) and the Codex tools (F6).

## 8. Departures from the mockup, on purpose

- The mockup draws five ties; section 4 says how more than eight fold.
- The mockup does not draw the player's quests, Factions grid and Over time under the glass, or the Standing entry in
  the facts; sections 2 and 4 place them.
- This mockup's Downtime tab is the round's draft; build the one in `../F3-atlas/the-atlas.html` instead.
- The mockup's quests, ties, standing and sessions are stand-ins.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `story-and-people.html`.

- `p4k-f3.css`: quest rows and cards (`.y-qrow`, `.y-obj`, `.y-qcard`), the ring (`.y-web`, `.y-node`, `.y-lab`), ties
  (`.y-tie`), standing (`.y-word`, `.y-tiers`, `.y-tier`, `.y-steps`), the composer (`.y-comp`, `.y-area`, `.y-more`),
  downtime (`.y-dt`, `.y-dl`, `.y-days`). `p4g-codex.css` is F's frame; `p4h-f2.css` F's finding and pages.
- `p6-body3.js`: `questsPage()` (the `rail` branch), `relsPage()` (the `glass` branch, which `ringglass` draws),
  `standingPage()` (`side`), `composePage()` (`inline`, with `sessMenu()` and `addHere()`), `downtimePage()` (`tab`);
  the stand-in quests, ties, tiers and downtime at its head.
- `p6-dec3.js`: the decisions, the Carried in list and the rules. The earlier files are F's frame and F2.
- `audit-p.js`: the "Today" screenshots.
