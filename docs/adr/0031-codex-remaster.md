# ADR-0031: The Codex remaster

## Status

Accepted, 2026-10-18. Replaces the Codex layout that grew up over earlier work: the left rail with its page tree,
the page split into a player tab and a GM tab, the Campaign dashboard, the Graph and the reveal audit. The Codex's
data stays in its own store, and every capability it had keeps a home (listed under Consequences).

## Context and decision drivers

The owner reviewed five mocked-up directions (A to E) for twelve moments of a campaign night on four screens: the
GM's laptop and phone, and a player's phone and laptop. Their feedback, recorded in the design notes, set the
drivers:

- A page reads as one document with a metadata panel beside it. Hidden material is boxed, labelled Hidden, with its
  action in the corner. Fixed left rails, page trees and a reading layout split by audience go.
- The GM controls who sees each piece, down to one character, and players see different things.
- Search is a dense table with real filters and a sort over several columns. Filters fly out and get out of the way.
- Time reads as a timeline, and the map is present without taking over.
- Phones are first-class (390 by 844 with touch), and every number and decision comes from the server.

## Considered options

1. **A to E as drawn.** Each direction answered some moments well and others badly: A's document and hidden blocks,
   B's chronicle spine, C's overview, table and per-character audience, D's map layers, E's timeline and stamps.
2. **F, a mix.** C's overview and search table, A's page and editor with Who sees it beside each field, C's
   per-character audiences with E's reveal stamps, a section bar in place of the rail, and the phone's tab bar.
3. **Keep the old shell and add per-character audiences.** The smallest change, and the one the owner's feedback
   ruled out: the rail and the split page were the parts they disliked.

## Decision

Option 2, F.

### A page or quest is player text plus hidden blocks, and the server assembles each reader's body

The GM body is replaced by hidden blocks: markdown with an optional title, anchored between paragraphs of the player
text (an anchor is the count of paragraphs before it). Each block has an audience (Hidden, Everyone, or some party
characters) and keeps a stamp for each audience it reached: the time, the active session and the players' published
date. The server assembles the body a reader receives through one function in `@vtt/domain`, so the client places
blocks by the same rule. A block a reader may not see leaves nothing: no marker, no blank line, no offset. Page fields
get the same idea with two audiences (Motives and Secret agenda start Hidden), and so do quest objectives. Content
writes move `rev`; audience writes do not, so an editor's autosave never races a reveal.

### The GM previews as everyone or as one character, and the preview only reads

`POST /codex/preview-session` takes an optional party character and mints a short-lived player session marked as a
preview. The Codex reads it as that character, and game commands refuse it. The client's See as players switch reads
the page or quest in place through that token, so a preview that shows something a player would not see is the same
bug as a leak.

### Session prep is typed sections copied from a template

A session's prep is an ordered list of typed sections (Text, Checklist, Linked pages, Scenes, Clocks, Quests in play,
Encounters). A prep template is the same list without content, and a new session owns its copy. The live board and
the recap are reads over the prep.

### A player's search and home are built from that player's own reads

A player's search reads no index: the filters, the sort and the cap run over records built from the player's own
projections, so a hit matches, quotes and ranks only on text the player reads. The GM's search says, per hit, whether
its matching line is hidden text. The player home lists what is new since a time the client sends.

### The client: a section bar, one document per record, and shared pieces

- The shell is a section bar on a laptop (Home, Search, Atlas, Story, Quests, Relationships, the search box with Ctrl
  K, New and the GM menu) and a tab bar on a phone (Home, Pages, Atlas, Campaign, Search, with Campaign's switch of
  Story, Quests, Relationships and Sessions). Sections plug into one registry, `CODEX_SECTIONS` in
  `codex/shell/sections.tsx`, as a GM view and a player view. A phone's top bar belongs to the view on screen.
- Every Codex address stays linkable. The retired addresses (graph, journal, calendar, downtime, audit) land where
  their content lives now and replace themselves in history.
- A page reads as one document with its blocks in place, the metadata panel beside it and a Timeline of its reveals at
  its end. Edit opens the same address in the writer (`?mode=edit`), where a block is written in place and each field
  has its own Who sees it switch.
- Shared pieces live in `codex/shared/`: the hidden block, the Reveal panel, the page picker and the date bar. The Who
  sees it control and its chip and the flyout filter panel started there and moved to `packages/ui/src/records/` once
  the Compendium, Scenes and Settings used them too. Hidden is violet with the crossed eye and the word Hidden;
  a revealed thing says who it is revealed to.
- Search is a table over `GET /codex/search` with its filters in the address. The reveal audit is now Search filtered
  to Hidden plus Home's reveal check. Relationships centre on a page with three views: Web, Factions grid (with the
  party's standing) and Over time.
- The table gets a Codex tab beside the map for both roles, reading through each role's own routes.
- The Atlas is the map with a side panel (pins as a table, maps inside, details). Pins and labels keep their size on
  screen at every zoom, viewing a pin is separate from editing it, and layers show people, hidden pins and faction
  ground. Set party position is a button and then a click on the map, or the spot menu on a right-click or a long
  press, through `POST /codex/party`.
- Story has three views. Chronicle is the session spine with the calendar beside it: both dates with Publish, the
  month, clocks, downtime and Add to the chronicle. Timeline zooms through Ages, Year and Month. Sessions keeps its
  list in a flyout; a session's page holds its prep sections and, after play, the recap step, where what happened
  sits beside the recap players read. A phone reads Story as the timeline and reads a session's prep through, with
  editing one menu item away.
- Prep templates are a library and an editor of typed sections under the GM menu, read-only on a phone.
- The table's Tonight tab is the live board: the scenes with the current one, the cast, the clue checklist, clocks,
  quests, fights to make live and Log what happens. Ticking a clue whose link players can't read offers to reveal it
  to everyone or to chosen characters through the block's own audience route; the tick itself reveals nothing.

## Consequences and tradeoffs

- Where each old capability lives now: backup, autosave and history and Prep templates in the GM menu; revision
  restore in a page's More menu; the reveal audit as Search filtered to Hidden and Home's reveal check; downtime,
  deadlines and milestones in Story's chronicle; tags as chips on Pages and on each page, opening the tag view; quick
  create under New and from a missing `[[link]]`; the command palette on the search box and Ctrl K; the player preview
  as See as players in place and in the GM menu; faction standing in the Factions grid.
- Every list row and control keeps the 44-pixel tap height, so the GM's tables are less dense than the mockup drew.
- The data has no campaign name, so Home's title reads Codex. A quest has no start date, giver or reward fields, and
  an objective no done date, so the quest panel shows status and progress only.
- Blank objectives are not saved: a blank line for everyone would reach players as an empty row.

## Mobile, security, and visibility impact

- Phones get the tab bar, a top bar per view, blocks as cards with their audience menu at the top, the factions grid in
  its own sideways scroller, and every right-click action on a long press.
- A player screen reads only player routes; the client never filters a GM shape for a player. A new field in any
  player projection follows the projection rule in CLAUDE.md.
- A reveal to one character pings only that character's player, and moves no date, ETag or ping for anyone else.

## Migration / reversibility

Codex migration 4 turns each GM body into Hidden blocks after the player text, one per `##` heading, and GM fields
into Hidden fields; migration 5 turns each session's free-text prep into one Text section. Nothing a player reads
changes. The backup format is version 2, and a version 1 backup restores through the same conversion. Going back
would need a reverse migration that folds blocks into one GM body, which loses audiences and stamps.

## Validation evidence

- Server: per-reader projection tests compare a preview byte for byte with a real player read, and the search and
  home tests check that nothing hidden is matched, quoted, counted or sorted on.
- Client: view tests for Home, Search, the page and the writer, revealing, quests, relationships and the table's Codex
  tab, each over the shared API fakes in `apps/client/test/codex-fakes.ts`, plus tests for each shared piece.
- Screenshots of each moment on the four screens, compared with the mockup.
