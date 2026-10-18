# ADR-0031: Session prep as typed sections, and a player's search and home from their own reads

## Status

Accepted, 2026-10-18.

## Context and decision drivers

Prep was one free-text body per session. The owner asked for a prep template builder the GM can reuse, and the
table's Tonight tab needs structure it can read: the scenes with the current one, the cast, the clues to tick and
the clocks. After play the GM writes a recap, and the clues ticked, the lines logged and the hidden blocks revealed
during the session are what that recap is made from.

At the same time search gained filters, a sort and a matching line, and the home gained "New since your last
visit". Each could leak to a player through what it matches, quotes, counts or sorts on.

The drivers: a template change never rewrites a session already prepared; a tick at the table and an open editor
never overwrite each other; prep stays GM-only; and a player's search and home can never say more than that
player's own reads.

## Considered options

1. **Keep free-text prep and parse it.** Headings and lists in the body become the board. A heading typo would
   change what Tonight shows, and nothing could link a clue to a hidden block by id.
2. **Sessions point at a template and store answers per template section.** Editing a template would change every
   session made from it, and deleting one would orphan their prep.
3. **A session owns a copy of typed sections.** A template is the same list with no content; a new session copies
   it.

For search and home: a second player index kept in step with the projections, or records built at read time from
the player's own projections.

## Decision

Option 3. A session's prep is an ordered list of typed sections: Text, Checklist, Linked pages, Scenes, Clocks,
Quests in play and Encounters. A prep template is the same list without content. A new session copies its
template's sections (the default template unless it names another) and owns the copy. Re-applying a template keeps
the content of each section that still matches, and keeps any other section that holds something. One built-in
starting template ships in code and is read-only; the GM duplicates it to make their own.

Ticking a clue and setting the current scene are edits of the prep, so they move the session's `rev`. An editor that
still holds the old prep gets a conflict and shows the table's version (the client says so), where it would
otherwise overwrite a tick. A checklist item links a page, a quest or one hidden block by id. The live board
(`GET /board`) and the recap's sources (`GET /sessions/{id}/happened`) are reads over the prep, the journal and the
blocks' reveal stamps.

The client edits prep on the session page under Story's Sessions, reads it through on a phone with editing one
menu item away, and edits templates under the GM menu (read-only on a phone). The table's Tonight tab is the board:
tapping a scene makes it current, and ticking a clue whose link players can't read offers to reveal it to everyone
or to chosen characters, through the block's own audience route. Nothing is revealed by the tick itself.

A player's search reads no index. `PlayerCodexReads` builds a record for each page, entry, map, pin, quest and
session from the player's own projections, and the filters, sort and cap run over those. A hit matches, quotes and
ranks only on text the player reads. The player home lists what is new or changed since a time the client sends,
from the same dates.

## Consequences and tradeoffs

- Editing or deleting a template never changes a session. A GM who wants a template's new sections in a session
  re-applies it.
- Prep is in no player read, and its text goes only to the GM's search row.
- The board has no state of its own beyond tick times and the current scene, so the session page and Tonight can't
  disagree.
- Whatever a projection decides is what a player's search and home see, with no second rule to keep in step. The
  cost is a read-time build over the player's records, which the Codex's size keeps small.

## Mobile, security, and visibility impact

Every board and template route is GM-only. A player's search and home derive from reads the players'
`codex:changed` fingerprint already hashes, so a GM-only write leaves them unchanged. On a phone the session page
reads the prep as cards and a checklist, and Tonight's scenes wrap to the width.

## Migration / reversibility

Codex store migration 5 turns each session's free-text prep into one Text section titled "Prep notes". A backup
from before keeps restoring; its free text becomes the same section.

## Validation evidence

Server: the prep, template, board and happened routes are covered in `apps/server/test` with the projection tests.
Client: `apps/client/src/codex/story/sessions.test.tsx`, `apps/client/src/codex/templates/templates.test.tsx` and
`apps/client/src/table/tonight.test.tsx`.
