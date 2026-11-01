# ADR-0054: The Codex's frame: the dashboard, wiki pages, writing in place with a preview, and a design per story tab

## Status

Accepted

## Context and decision drivers

Area F of the polish pass (`docs/design/polish/F-codex/`) is the campaign's memory, written by the GM and read by everyone.
Running the branch at `f5e166f` with twelve pages, three quests, three sessions and four chronicle entries showed:

- The Codex had its own boxed strip of seven pages with icons, its own search box, New and a GM menu, under the app bar.
- Home was a dashboard of counts, the next session, a reveal check and recent changes.
- A page read as text at the left and a panel of fields, relationships, tags and journal at the right, with hidden parts
  in violet.
- Writing happened in place, with a fields panel that set who sees each field; nothing showed the page as players would
  get it while writing, short of leaving the writer and switching See as players on.
- The story had three tabs, Chronicle, Timeline and Sessions, each drawn its own way.

The owner chose from one round of mockups with six options for each question, kept in
`docs/design/polish/F-codex/history/`.

## Considered options

- Home: Dashboard (today's), Front page, Index, Next session, Shelf, Search first.
- Reading a page: Wiki (today's), Band, Book, Tabs, Dossier, Two layers.
- Writing a page: In place (today's), With a preview (side by side), Fields first, Blocks, Quick note, Focus.
- The story: Chronicle, Sessions, Calendar, Timeline, Journal, Board.

## Decision

1. The Codex takes the theme's Titled section bar; its search is the bar's field and New its primary.
2. Home stays the dashboard, drawn to the theme.
3. A page reads as a wiki: the text at the left with hidden parts in violet, the facts, relationships, tags and journal
   as open groups at the right. A player gets the same page with the hidden parts left out.
4. Writing stays in place, and gains a Preview switch in the title row that shows the page as players get it.
5. The story keeps one design per tab: the chronicle's line for Chronicle, a horizontal timeline for Timeline, and
   session cards for Sessions.
6. Ten rules for the Codex, listed in `docs/design/polish/F-codex/SPEC.md` section 3.

## Consequences and tradeoffs

- The Codex looks like the rest of the app's sections, and its pages keep the layout the GM already knows.
- Writing no longer needs a trip out of the writer to check what players will read.
- Three tabs with three designs is more to build than one shared pattern; each fits what its tab is for.

## Mobile, security, and visibility impact

- Every control keeps a 44 px hit area. On a phone the pages run as a strip of words, writing pins Done, and Preview is a
  Write and Preview segmented control.
- No data, command or projection changes. Preview saves the draft, then shows the player's projection of the page through
  the same preview session See as players uses; it never shows a player anything. A player keeps the Compendium in the
  Codex's strip, their only way to the rules.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- The approved mockup: `docs/design/polish/F-codex/codex.html`.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, as the GM and as a player, plus the full checks and
  the smoke suite.
