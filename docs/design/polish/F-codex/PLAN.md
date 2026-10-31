# F The Codex's frame: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds the Codex's bar, its home, reading and writing a page (with a new
Preview switch), and the story's three tabs. It adds no rules, commands or data. File paths and line numbers were read
at `f5e166f`; the theme (T) and the frame (A) land on the same branch first or alongside, so confirm every anchor before
editing. Paths are under `apps/client/src/codex/` unless they start with `apps/client/src/` (written `src/`),
`packages/`, `apps/server/`, `e2e/` or `docs/`.

This is area F's frame in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in seven phases, F0 to F6, each
  about one commit.
- The reference is `codex.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else is
  inline). It opens on the approved choices. Use the Page switch (Home, A page as the GM, A page as a player, Writing a
  page, The story). Inside the frames, the writer's Preview switch (and Write and Preview on the phone) works, and so do
  the story's Chronicle, Timeline and Sessions tabs. The other options in the four decision switches are the ones the
  owner turned down; build only the chosen ones. On a phone the page has its own bar and a Close up, Whole and Turned
  laptop view. `history/1-round-1.html` is the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its campaign is a stand-in.
  Build with the existing components, hooks and primitives. Section 8 lists where the plan departs from the mockup on
  purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top, and `writing.test.ts` checks it. The Codex has its own word list too (`vocabulary.test.ts`): never
  "public", "secret", "reveal audit", "marker" or "graph", and never "Shown to players" or "Hidden from players".

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. Home is the Dashboard: today's home drawn to the theme.
2. A page reads as a Wiki: the text at the left with hidden parts in violet, the facts, relationships, tags and journal
   as open groups at the right. A player gets the same page with the hidden parts left out.
3. Writing is In place, with a Preview switch in the title row that shows the page as players get it.
4. The story keeps a design per tab: the chronicle's line for Chronicle, a horizontal timeline for Timeline, and session
   cards for Sessions.
5. Ten rules for the Codex (`SPEC.md` section 3), starting with the Titled bar.

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- F builds on T and A. T1 to T3 (the Base line, `Group`, the Titled section bar) and A1 to A3 (the menu, the phone frame
  without a top bar) must be on the branch before F1. If they are not, stop at the phase that needs them and tell the
  user.
- CLAUDE.md applies in full. Projections are the boundary: a player's Codex is built on the server
  (`apps/server/src/codex-projections.ts`: `projectPlayerPage` 197 to 225 strips hidden fields and needs
  `revealedToPlayers` and `firstShownAt`; `assembled()` 137 to 185 drops blocks the reader is not in and fails closed on
  an unstamped block; `plainUnopenableLinks` 91 to 110). Preview and See as players read that projection through a
  preview session (`POST` `CODEX_PATHS.previewSession`); they never build a player's view in the client from the GM's
  data. No server code, shared domain, schema, command or HTTP route changes. If a step seems to need one, stop and tell
  the user.
- `design-conventions.test.ts` scans the Codex's CSS and TSX: token colours only (208), media queries only on the ladder
  (260; the Codex's phone query is 760 px), `.scroll-y` (331), the display face in capitals (350), one Eyebrow (164).
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area. "A preview is the real thing" (411):
  Preview follows it.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages at 390 px and 1280 px in Dusk and Dawn, as the GM and as a player (the
  `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The frame

- `CodexShell.tsx` (42 to 274): routes (`codexSectionOf`, `recordIdOf` 64 to 66), retired addresses (70 to 72), the
  whole-Codex preview (`preview` 78, `openPreview` 94 to 106 through `codexApi.createPreviewSession`; a full Modal
  "Player Codex preview" titled "What players see" or "What {name}'s player sees" with `<PlayerCodex token embedded/>`,
  247 to 260), `menus()` (188 to 198: `NewMenu`, `GmMenu`), the palette and `QuickCreate` (226 to 245). Mounted at
  `src/shell/GmShell.tsx:219`; Prep's `PrepFrame` is not used here.
- `shell/CodexFrame.tsx` (31 to 240): Ctrl K (69 to 79), `?openSearch=1` (82 to 87), the search box
  `button.cx-searchbox` "Search the Codex" (142 to 153), the laptop bar `.cx-bar` with `nav.cx-bar-sections` "Codex
  sections" and `.cx-bar-tab`s from `CODEX_BAR` with `StripInk` (172 to 191), the phone `header.cx-phonebar` (161 to
  170), `nav.cx-tabbar` "Codex sections" (194 to 214), `nav.cx-campaign` "Campaign" (215 to 231, remembered in
  `codex-campaign-part`).
- `shell/GmMenus.tsx`: `NewMenu` (5 to 35: New page through `QuickCreate`, New quest, New session), `GmMenu` (41 to 85:
  Prep templates, Backup, Autosave and history, See as players: Everyone, See as {name}).
- `routes.ts`: `CODEX_BAR` (120 to 128: Home, Search, Atlas, Story, Quests, Relationships, Compendium; Pages lights
  nothing), `barItemOf` (134 to 156), `CODEX_PHONE_TABS` (159 to 165: Home, Pages, Atlas, Campaign, Search),
  `CAMPAIGN_PARTS` (192 to 197), `SECTION_TITLE` (215 to 230), `pagePath(id, "edit")` (`?mode=edit`, 255),
  `sessionPath` 261. `shell/sections.tsx` `CODEX_SECTIONS` 105 to 123. `shell/context.ts` `CODEX_PHONE_QUERY` (9).
- `PlayerCodex.tsx` (21 to 145): a player's frame, also embedded in the preview Modal.
- CSS: `shell/shell.css` (`.cx-bar` 39, `.cx-searchbox` 56 to 90, `.cx-phonebar` 101 to 130, `.cx-campaign` 132 to 150,
  `.cx-tabbar` 155 to 205), `codex.css` (legacy `codex-` classes, the palette 634 to 690, the preview Modal 902).

### 3.2 Home

- `home/HomeView.tsx`: `GmHome` (218 to 443) reads `GET` `CODEX_PATHS.home` (`CodexHomeSchema`,
  `packages/domain/src/codex-wire.ts` 1418 to 1455: `collections`, `recent` with `change` and `audience`,
  `revealCheck`). The date bar (246 to 256), the title `h1.cx-page-title` "Codex" with `.cx-count` (329 to 335), the
  tiles `.cx-home-tiles` (338 to 363), the next session card "Next · Session N" with Open prep and Start session N (364
  to 391), Recently changed `table.cx-table` (393 to 434: Record, Change, Who sees it, When), `PartyCard` (59 to 138),
  `RevealCheck` (170 to 205, "See every Hidden record"), phone rows `.cx-grouprow` (289 to 318). `PlayerHome` (473 to
  637): Latest recap, New since your last visit (546 to 580), Open quests, Clocks.
- `shared/DateBar.tsx`: `GmDateBar` (48 to 168: group "The two dates", "Yours", the date button "Your date is X. Change
  it.", Hidden, Players or Not shared yet, Publish, Hide the date from players, Edit calendar), `PlayerDateBar` (170 to
  186). CSS `shared/shared.css` 293 to 357; `home/home.css`.

### 3.3 Reading a page

- `page/GmPage.tsx` `GmPage` (103 to 554): the read (109), `editing` from `?mode=edit` (118), See as (120 to 124:
  `usePreviewToken(token, seeAs.on && !editing, viewer)`), block audience (147 to 163), the page's reveal (165 to 188),
  `PageWriter` when editing (273 to 295), the page audience Menu (311 to 340: "Revealed to everyone" or "Hidden"),
  `.cx-visline` with `VisibilityCounts` (341 to 346), More (347 to 355: Version history, Show in Relationships, Delete
  page), hidden blocks through `HiddenBlock` (357 to 383), the body (385 to 422), the meta panel (424 to 444), the phone
  (446 to 508: Overview, Relations, Mentions), the laptop head `header.cx-page-head` (510 to 553: `PageCrumbs`,
  `h1.cx-page-title`, `KindChip`, `SeeAsControl`, Edit, More; the See as banner `.cx-seeas-banner` hides the meta panel,
  536 to 549).
- `page/SeeAs.tsx`: `SeeAsControl` (12 to 77: Switch "See as players" and Menu "See as: {name}"), `usePreviewToken` (83
  to 104).
- `page/PlayerPage.tsx`: `PlayerPageBody` (62 to 201: `getForPlayer`, `playerDocument`,
  `CodexMarkdown audience="player"`, the new-block light 95 to 117, "{X}'s player can't open this page. It is Hidden."
  121 to 128), `PlayerPage` (227 to 299, "New on this page since you last read it").
- `shared/HiddenBlock.tsx` (20 to 102: `section.cx-block.is-{audience}`, Reveal "Reveal {name}", Hide again; CSS
  `shared/shared.css` 11 to 105: hidden `--rim-gm` dashed with `--violet-hi`, everyone `--indigo`, characters `--cyan`).
  `page/MetaPanel.tsx` (`FieldList` 111 to 131 with `.cx-meta-row.is-hidden`; `RelationshipList` 85; `OnTheAtlas` 134;
  `MentionedOn` 202; `TagChips` 224). `PageTimeline.tsx` ("In the journal", "Add a journal note").
  `page/RevealTimeline.tsx`. `page/pageParts.tsx` (`PageCrumbs` 28, `KindChip` 45, `VisibilityCounts` 121 to 160,
  `DocText` 163). `CodexMarkdown.tsx` (`[[links]]` 69 to 125 as `.codex-md-link`, `-missing`, `-inert`, or plain text
  for a player).
- CSS `page/page.css` (`.cx-visline` 87, `.cx-seeas` 93, the banners 101 to 116, `.cx-page-cols` 120 to 136,
  `.cx-page-meta` 160, `.cx-meta-row.is-hidden` 202 to 209, `.cx-timeline` 318 to 358).

### 3.4 Writing a page

- The editor is the project's own (growing `Textarea`s and `applyMarkdownFormat` from `@vtt/ui`), in
  `page/DocEditor.tsx` (90 to 521: the `[[` picker "Link to a page", the `/` menu "Add a block", the toolbar
  `role="toolbar"` "Writing tools" 313 to 362 with Bold, Italic, Heading, Bullet list, Link to another page,
  `.cx-write-hiddenbtn` Hidden block, Put it on a map and the hint; on a phone a shorter set with More formatting; "Page
  text" 434 to 438; draft blocks 455 to 516).
- `page/PageWriter.tsx` (83 to 538): `save` (120 to 168: block remove, add and update, then `PATCH` the page with
  `expectedRev`), autosave (`useCodexAutosave` 169 to 178, the 409 message), field audience (`PUT` per field, 195 to
  203), the fields panel `section.cx-writefields` "Fields" (269 to 325, `FieldAudienceToggle`, Add a field), details
  (327 to 403), `RelationshipEditor` (405 to 424), save controls (443 to 455: `SaveState`, Save when autosave is off,
  Done), the header's `AudienceChip` (513 to 515). No Preview today. CSS `page/page.css` 441 to 665.
- `page/document.ts`: `gmDocument` 18, `draftDocument` 56, `saveShape` 76, `playerDocument` 113.
- The only Edit and View toggle today is `@vtt/ui` `MarkdownEditor` (270 to 280, `SegmentedControl` "Edit or read"),
  used by session prep and the recap, and it renders the GM's view.

### 3.5 The story

- `story/sections.tsx`: `useGmStory` (140 to 177; the chronicle through `GET` `/timeline`, the calendar),
  `GmStorySection` (364 to 445: `StoryBar view="chronicle"`, `GmChronicle`, the date bar, downtime, Add),
  `GmTimelineSection` (503 to 567: Zoom `TIMELINE_ZOOMS`, `?zoom=`, `TimelineAside`), `GmSessionsSection` (580 to 745:
  `GET` `/sessions`, New session, "No sessions yet"), `GmPhoneStory` 300, the player's sections 813, 859, 913.
- `story/Sessions.tsx`: `StoryBar` (286 to 324, `nav.nh-segmented` "Story views": Chronicle, Timeline, Sessions),
  `SessionsFlyout` 57, `SessionRows` 125, `PlayerSessionPage` 168.
- `story/Chronicle.tsx`: `Spine` (118 to 230: `ol.story-spine` "Sessions and what happened", "Not in a session",
  Planned, Recap hidden), `CalendarMonth` 233, `Clocks` 310, `GmChronicle` (370 to 464: `aside.story-calcol` "Calendar"
  with the date bar, the month, clocks, downtime and `button.story-addbox` "Add to the chronicle"),
  `PlayerChronicle` 467. `story/EntryCard.tsx` 27.
- `story/Timeline.tsx`: `TIMELINE_ZOOMS` (19 to 23: Ages, Year, Month), `Timeline` 62 (Ages: dated events and the
  campaign's mark; Year: months with events and sessions; Month: days with the world and party lanes).
- `story/SessionPage.tsx` (77 on: Prep and Recap, Start session N or Share the recap, Session N options, "Made from
  {template}", Recap shared or hidden). Left as it is apart from the theme (`SPEC.md` 2.4).
- CSS `story/story.css` (chronicle 101 to 404, timeline 550 to 948, sessions 949 to 1141).

### 3.6 Tests that pin it

- `shell-navigation.test.tsx`: `navigation "Codex sections"` and `it.each(CODEX_BAR)` with one section lit (43, 65, 73);
  the GM menu (94); the whole-Codex preview (119: dialog "Player Codex preview"); the New menu (132); retired addresses
  (142); the phone (189 to 246: tabs Home, Pages, Atlas, Campaign, Search; `navigation "Campaign"`; h2 "Codex"; "GM
  menu", "New").
- `vocabulary.test.ts` (banned words 21 to 46, 126; navigation labels 137 to 163). `navigation.test.tsx`,
  `palette.test.tsx` (Ctrl K 178, the search box 192), `player-gm-only-address.test.tsx`.
- `home/home.test.tsx` (the two dates 176; "People" "8 revealed · 2 hidden" 186; Recently changed 205; the next session
  259; Reveal check 274 to 297; the player 327 to 454; the phone 456 to 490).
- `page/page.test.tsx` (the hidden block region and Reveal 99; `.cx-visline` 110; `.cx-meta-row.is-hidden` 119; See as
  345 to 387; player safety 388 to 437; the phone 441). `page/writer.test.tsx` ("Page title", "Saving…", Done, Hidden
  block, "Who sees Goals & motives: Hidden", Add a field). `shared/shared.test.tsx`, `shared/pieces.test.tsx`.
- `story/chronicle.test.tsx` (the spine 150; the two dates 863 to 932; the month 934), `story/timeline.test.tsx` (124 to
  192: group "Zoom"; the player's story 194), `story/sessions.test.tsx`, `composer-align.test.ts` (reads
  `story/story.css`).
- e2e: the Codex is only a GM section tab (`journeys.spec.ts` 940, 1039 to 1060 with the strip's ink; `smoke.ts:239`).
  No Codex journey.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                       | New or changed                                               | Built from                                                     |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| The Codex's bar            | Changed: T's Titled section bar, the search field, New, More | `CodexFrame`, `CODEX_BAR`, `NewMenu`, `GmMenu`                 |
| The phone header and strip | Changed: the strip of words; Campaign goes                   | `CodexFrame`, `CODEX_PHONE_TABS`                               |
| Home                       | Restyled                                                     | `GmHome`, `DateBar`, `PlayerHome`                              |
| A page                     | Restyled: the title row, hidden parts, open groups           | `GmPage`, `HiddenBlock`, `MetaPanel`, `PlayerPage`             |
| The writer                 | Restyled, with Preview                                       | `PageWriter`, `DocEditor`, `usePreviewToken`, `PlayerPageBody` |
| The story's tabs           | Chronicle restyled; Timeline and Sessions redrawn            | `GmChronicle`, `Timeline`, `GmSessionsSection`                 |

## 5. Phases

### F0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `F-codex/`, and leave the other
   pieces' folders as the zip has them.
2. Add `F-codex/ADR-0054-codex-frame.md` as `docs/adr/0054-codex-frame.md`, Accepted, and its row to
   `docs/adr/README.md`. Note on ADR-0031's row that its frame is changed by 0054. Leave any missing earlier numbers
   free; do not renumber.
3. Run the full checks and record any failure that was already there.

### F1: the Codex's bar

1. `CodexFrame` on a laptop draws T's Titled section bar: Codex, then the pages as words with the horizon ink
   (`StripInk` stays): Home, Pages, Atlas, Story, Quests, Relationships, and for a player Compendium last. `CODEX_BAR`
   follows; `barItemOf` lights Pages for `/codex/pages` and a page, Story for story, timeline and sessions, and nothing
   for search.
2. The right end: the search field (today's `cx-searchbox` drawn as T's field, "Search the Codex" with Ctrl K, opening
   the palette), New as the Cup with its menu (`NewMenu`), then More as a Base line icon (`GmMenu`'s items: Prep
   templates, Backup, Autosave and history, See the Codex as players with Everyone and each character). A player's bar
   ends with the search field.
3. A phone (under 760 px): the header shows the section's or record's title with Search and New as icons (A3's page
   header); the pages run under it as one strip of words (T 2.1). `CODEX_PHONE_TABS` and `CAMPAIGN_PARTS` go with
   `nav.cx-campaign` and its stored part; Story, Quests and Relationships are pages in the strip.
4. Tests: `shell-navigation.test.tsx` (the bar's names and one lit; no Search tab; Compendium for a player only; the
   More menu's items; the phone's strip in place of the tabs and "Campaign"), `vocabulary.test.ts` labels (137 to 163),
   `palette.test.tsx` (192), `journeys.spec.ts` 1039 to 1060 (the ink is on the new bar).

### F2: home

1. `GmHome`: drop the `h1` "Codex" (the bar names it; T 2.2) and keep its count as the date bar's line or the kinds'
   sum. The date bar keeps its words and controls, drawn as one row with the date in VT323 cyan.
2. The left column: the kinds as five cards (the kind's icon and name, the number in VT323, "3 revealed · 1 hidden"),
   then Recently changed as an open group of rows (icon, name, change and when, the audience chip as rule 3.2 draws it).
   The right column (330 px): the next session (Open prep, Start session N as the Cup), Where the party is, Reveal
   check, as open groups.
3. `PlayerHome` takes the same columns with its own cards (Latest recap, New since your last visit, Open quests,
   Clocks).
4. The phone: the date bar, the kinds as rows, the next session.
5. Tests: `home/home.test.tsx` keeps its names ("The two dates", the kinds' regions and counts, Recently changed, "Next
   · Session 6", Reveal check); update what read the `h1`.

### F3: reading a page

1. The laptop head becomes T 2.2's title row: `PageCrumbs` as the crumb, the title, then one line with `KindChip`, the
   page audience control and `VisibilityCounts`; the actions as Base line controls: `SeeAsControl`'s switch, Edit and
   More.
2. Rule 3.2 for every hidden part: `HiddenBlock`'s hidden audience, `.cx-meta-row.is-hidden`, hidden rows in lists and
   the audience chips share one look (violet, dashed edge, the struck eye, Reveal beside it where it reveals). Everyone
   is quiet ink; a block shown to some characters keeps cyan.
3. The body in a reading measure (680 px, 15 px, 1.65; T rule 11); `[[links]]` cyan with a thin line (rule 3.5), a link
   to a hidden page violet for the GM.
4. The meta panel (340 px) as open groups: Facts, Relationships, On the Atlas, Mentioned on, Tags, In the journal, the
   timeline.
5. `PlayerPage` takes the same layout; nothing is drawn where a hidden part was.
6. The phone keeps Overview, Relations and Mentions, drawn as T's tabs, with the facts in two columns over the text.
7. Tests: `page/page.test.tsx` keeps its names (the block region and Reveal, `.cx-visline` text, the hidden meta row,
   See as, player safety); `shared/shared.test.tsx` for the hidden block.

### F4: writing with Preview

1. `PageWriter`'s header becomes the title row with its actions: Preview (a switch with a reader menu: Everyone or one
   character), `SaveState` (a cyan lamp and Saved), Save when autosave is off, and Done as the Cup.
2. `DocEditor`'s toolbar as Base line icons with Hidden block in violet; the text as one field; drafts of hidden blocks
   drawn as they read.
3. The fields panel (360 px) as a Cradle "Fields, who sees each": each field's label, its value, and
   `FieldAudienceToggle` drawn as Everyone and Hidden on Base lines (Hidden in violet). Details and `RelationshipEditor`
   stay under it.
4. Preview: switching it on flushes autosave (the same flush Done uses), then renders `PlayerPageBody` with a preview
   token from `usePreviewToken` for the chosen reader (lift `!editing` from `GmPage`'s call while Preview is on), in the
   Wiki layout, under the violet line `SPEC.md` 2.3 gives. A page players cannot open shows today's sentence. Switching
   it off returns to `DocEditor` with the caret where it was. If the flush fails (a 409), Preview stays off and today's
   message shows.
5. The phone: Write and Preview as a segmented control under the header; Done pinned; the toolbar pinned above Done
   while writing.
6. Tests: `page/writer.test.tsx` (the names stay; a new test: Preview flushes, asks `createPreviewSession` for the
   reader, shows the player's body without the hidden block and field, and returns to the editor); `page/page.test.tsx`
   See as tests still pass.

### F5: the story's tabs

1. `StoryBar` becomes T's tabs (words with the horizon ink; it keeps its name "Story views") with Filters at the right.
2. Chronicle: `Spine` and `GmChronicle` drawn to the theme: one line (2 px, cyan to violet), the next session's mark
   amber and played ones cyan, Planned and Played as tags, entries under each with their icons and hidden ones tagged;
   the right column (330 px) with the date bar, the month (today outlined), clocks, downtime and Add to the chronicle.
3. Timeline: `Timeline` draws each zoom on a horizontal line in the horizon gradient across the top (Month: the days of
   the month; Year: the months; Ages: the eras), with a mark for each session, today's date and each dated event (future
   ones amber), and a card under each point (its date and one line; future ones with a dashed edge). The Zoom control
   (Ages, Year, Month) stays at the right of the tabs; `TimelineAside` stays as the right column where it has content.
4. Sessions: `GmSessionsSection` leads with the next session as a card with the horizon edge (number, date, its prep in
   one line, Open the prep, Start session N), then the played sessions as cards two to a row (number and date, Recap
   shared or Recap hidden, the recap's first line, its entries, who came). New session stays in the tab row. The session
   page is restyled only.
5. The player's story takes the same three designs with only what they have been shown.
6. A phone: one column per tab.
7. Tests: `story/chronicle.test.tsx` (the spine's names stay), `story/timeline.test.tsx` (group "Zoom"; a test for the
   line's marks: sessions, today, a future event), `story/sessions.test.tsx` (article "Session 6", "Start session 7"),
   `composer-align.test.ts`.

### F6: docs and cleanup

1. `docs/DESIGN.md`: "The Codex" (449 to 461) for the bar, home, the page, the writer's Preview and the story's tabs,
   fixing what is stale there (its page list at 451 and "See it as is a wrapping grid" at 458); "Who sees it" (321
   to 323) for rule 3.2.
2. `docs/ARCHITECTURE.md`: the Codex's client (1163 to 1174: the bar, Preview through the preview session); the
   projection boundary (225 to 227) names Preview.
3. `docs/adr/README.md`: 0054 Accepted and built.
4. Remove what nothing uses: `.cx-bar-tab`, `.cx-tabbar`, `.cx-campaign` and the stored part, the home tiles' old CSS,
   `SessionRows` if unused.
5. `docs/design/polish/CATALOG.md`: F's frame moves to Built.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a campaign like the mockup's (a dozen pages, some hidden, one with a hidden block and a hidden field, three
  quests, three sessions, chronicle entries), look in Dusk and Dawn at:
  - 1280 by 800 with a mouse, as the GM: the bar (each page lit once, the search field and Ctrl K, New's menu, More's
    items and the whole-Codex preview), home, a page with its hidden parts and See as players, writing with Preview on
    for Everyone and for one character and off again, a hidden page's Preview, and the story's three tabs at each zoom.
  - The same as a player: home, the same page with nothing hidden showing, the story; Compendium in the strip.
  - 390 by 844 with touch: the strip, home, a page's tabs, Write and Preview, the story's tabs; every control at least
    44 px; no sideways scroll.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable: the palette, QuickCreate, version history, reveal and hide, field
  audiences, the link picker and the block menu, autosave and its conflict message, the calendar editors, downtime,
  session prep and recap.

## 7. Left as they are, for later rounds

- Search, the palette and tags (F1.3 to F1.5), the pages index (F2.1), reveal and version history (F2.5, F2.6), the page
  picker (F2.8), the Atlas (F3), the calendar editor, composer, record dialog and downtime (F4.4 to F4.7), a session's
  own page, quests and relationships (F5), and the Codex tools (F6). They take the bar now and their own designs later.
- Every command, projection and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's rules say Search and the Compendium leave the strip and the GM menu moves into the frame's menu. The
  build keeps the Compendium in a player's strip (their only way to the rules) and puts the GM menu's items in the bar's
  More (`SPEC.md` rules 3.1 and 3.8).
- The mockup's date bar says "Your date"; the app keeps today's "Yours" and its button's words.
- The mockup's Preview shows the stand-in page as if saved; the app saves first and reads the player's projection, so a
  block that has never been revealed stays out, as it does for a player.
- The mockup does not draw the reader menu on Preview, the timeline's Year and Ages zooms, the session page, the
  player's home or the reveal animation; section 5 places them.
- The mockup's campaign, dates and portraits are stand-ins.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `codex.html`.

- `p4g-codex.css`: hidden parts (`.f-hid`, `.f-all`, `.f-block`, `.f-reveal`, `.f-hidval`), the page (`.f-prose`,
  `.f-link`, `.f-facts`, `.f-rel`, `.f-tags`, `.f-jn`), home (`.f-dbar`, `.f-kinds`, `.f-kindc`, `.f-row`, `.f-lead`),
  the writer (`.f-tb`, `.f-edit`, `.f-caret`, `.f-fieldrow`, `.f-who`, `.f-pvbar`), the story (`.f-tl`, `.f-node`,
  `.f-cal`, `.f-hl`, `.f-scard`). `p4f-prep.css` holds E's shared parts (`.e-btn`, `.e-grp`, `.e-open`, `.e-rec`,
  `.e-tabs`, `.e-seg`).
- `p6-head.js`: the campaign (`KINDS`, `PAGES`, `ILSA`, `SESSIONS`, `QUESTS`), the parts (`hid()`, `all()`, `block()`,
  `facts()`, `rels()`, `journal()`, `prose()`), and the frame (`codexBar()`, `lap()`, `ph()`).
- `p6-body.js`: `home()` (the `dash` branch), `page()` (the `wiki` branch, as the GM and a player), `write()` (the
  `inplace` branch with `S.prev`), `story()` (the `chron`, `line` and `sessions` branches, and `storyTabs()`).
- `p6-dec.js`: the decisions and the rules. `p2b-mobile.css` and `p6-tail.js`: the mockup page's own phone bar, laptop
  view and the in-frame clicks; mockup code only.
- `audit-f.js`: the "Today" screenshots.
