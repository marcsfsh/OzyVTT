# F. The Codex: its frame

Approved by the owner on 2026-10-29 in one round of mockups. Area F in `../CATALOG.md` is the campaign's memory, written
by the GM and read by everyone. Like the table (C) and Prep (E), it is designed as one frame first: the Codex's own bar,
its home, reading a page (as the GM and as a player), writing a page, and the story's three tabs. The Atlas, quests,
relationships, version history, templates, backup and the Codex's Compendium reader come in later rounds inside this
frame. It inherits the theme (`../T-theme/SPEC.md`) and the frame (`../A-frame/SPEC.md`). `PLAN.md` beside this file is
the work to build it; `codex.html` is the approved mockup, and `history/` holds round 1 as it was shown.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) put a record's phone header as Back and where it goes,
stepped the bar's New down when a page shows its own Cup, drew the bar's More after New (rule 8) and the story's four
tabs in this mockup.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) set the reading measure at 680 px (T rule 11), gave See
as players the theme's switch, and drew every phone control at 44 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) took the horizon off the next session's card, whose
Cup carries it (T rule 9), gave the writer's toolbar 44 px on a phone, and set a page's facts in the eyebrow (T 2.4).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the date bar as a Cradle (T 2.4), Recently changed
as an open group like its neighbours (T 2.3), a page's fields at 40 px (T 2.5), the tabs at 44 px (T rule 1), every tag
in a 22 px box (T rule 7) and a page's title at 20 px on a phone (T 2.2), and gave Dawn's amber, magenta and violet
words their text shades (T rule 9).

## 1. What it covers

| Id         | Surface                           | Decided here                          |
| ---------- | --------------------------------- | ------------------------------------- |
| F1.1       | The Codex's frame                 | Rule 3.1                              |
| F1.2       | Home                              | Dashboard (2.1)                       |
| F2.2       | A page, as the GM and as a player | Wiki (2.2)                            |
| F2.3, F2.4 | Writing a page                    | In place, with a Preview switch (2.3) |
| F2.7       | What players see                  | Rule 3.4                              |
| F4.1       | The story's Chronicle tab         | Chronicle (2.4)                       |
| F4.2       | The story's Timeline tab          | Timeline (2.4)                        |
| F4.3       | The story's Sessions tab          | Sessions (2.4)                        |

Left for F's later rounds: search and the command palette's own design (F1.3, F1.4), tags (F1.5), the pages index
(F2.1), reveal and version history (F2.5, F2.6), the page picker (F2.8), the Atlas (F3), the calendar editor, the
composer, the record dialog and downtime (F4.4 to F4.7), quests and relationships (F5), and the Codex tools (F6). They
follow the rules in section 3 meanwhile.

## 2. The decisions

### 2.1 Home is the Dashboard

- Today's home, drawn to the theme, starting with its content (T 2.2): the date bar (Yours: the campaign's date in VT323
  cyan with Hidden; Players: their date or Not shared yet; Publish and Edit calendar, with today's words), then two
  columns.
- At the left: the counts by kind as five cards (People, Places, Factions, Things, Lore: the number in VT323, then how
  many are revealed and how many hidden), and Recently changed as an open group of rows (the kind's icon, the name, the
  change and when, and who sees it: Everyone, or Hidden in violet).
- At the right, 330 px: the next session (its number and date, Open the prep, Start session N as the Cup), Where the
  party is, and the Reveal check (what players have seen named but cannot open).
- A player's home is the same pattern with only what they have been shown, and today's New since your last visit.
- On a phone: the date bar, the kinds as rows, the next session.

### 2.2 A page reads as a Wiki

- The record's title row (T 2.2): the kind as a crumb (People), the title, then a line with its kind and who sees it
  ("Revealed to everyone", and for the GM what is hidden: "1 block, 1 field"); its actions as Base line controls: See as
  players (a switch), Edit, and More.
- The text at the left in a reading measure (680 px, 15 px, 1.65), [[links]] in cyan with a thin line under them (rule
  3.5). A hidden block sits where it is in the text, in violet with a dashed edge, its title, a Hidden tag and Reveal
  (rule 3.2).
- At the right, 340 px, open groups (they are only read, T 2.3): Facts (each field; a hidden field in violet with its
  tag), Relationships, Tags, and In the journal with Add a journal note for the GM.
- A player gets the same page with every hidden part left out by the server, no Edit, and nothing that says something is
  missing (rule 3.3).
- On a phone: the header is Back and where the page sits (‹ PEOPLE) with Edit and More, and no strip (T rule 12); then
  the title with its line, Overview, Relations and Mentions as tabs (today's), and the overview with the facts in two
  columns over the text.

### 2.3 Writing is In place, with a Preview switch

- Edit turns the page into its writer in place: the title row keeps the title and its line, and its actions become
  Preview (a switch), Saved (a cyan lamp while autosave has the latest) and Done as the Cup.
- The toolbar over the text: bold, italic, heading, list, [[]] link, then Hidden block in violet and Put it on a map.
  The text is one bordered field; the hidden block shows as it reads, with Reveal.
- At the right, a Cradle: Fields, who sees each. Each field is its label, its value and Everyone or Hidden as a pair of
  Base line options (Hidden in violet), then Add a field.
- Preview: turning the switch on saves what is written (as autosave does) and shows the page exactly as a player gets
  it, through the same read See as players uses: the Wiki layout of 2.2 with the hidden parts left out, under a violet
  line that says "Preview: the page as players get it. Hidden blocks and hidden fields are left out. Turn Preview off to
  keep writing." A page players cannot open says so, in today's words. Its menu picks the reader (Everyone or one
  character), as See as players does. Turning it off goes back to the writer where the caret was.
- On a phone: the header Editing with the title and Saved, Write and Preview as a segmented control under it, the text,
  and the toolbar and Done pinned at the foot (Done alone in Preview).

### 2.4 The story keeps a design for each tab

- The story's tabs stay Chronicle, Timeline and Sessions, as words with the horizon ink (T 2.5), with Filters at the
  right.
- Chronicle (today's, drawn to the theme): one vertical line of sessions, newest first, the next one in amber and played
  ones in cyan, each with its number, a Planned or Played tag, its real date and one line; the session's entries under
  it (journal notes, quests started and completed, a hidden one tagged). At the right, 330 px: the date bar, the month
  as a small calendar with today outlined, and Add to the chronicle.
- Timeline: a horizontal line across the top in the horizon gradient, from the first session to the next dated event
  ahead, with a mark for each session, today's date and each dated event (the next in amber); a card under each point
  with its date and one line, future ones with a dashed edge. Today's Ages, Year and Month stay as the scale.
- Sessions: the next session leads as a card (its number and date, its prep in one line, Open the prep and Start session
  N), then the played sessions as cards two to a row: number and date, Recap shared or hidden, the recap's first line,
  what happened in it, and who came.
- On a phone each tab is one column: the chronicle's line, the timeline's cards stacked with today outlined, the
  sessions' cards.
- A session's own page (its prep and recap) keeps today's layout, drawn to the theme; its design comes in F4's own
  round.

## 3. Rules for the Codex

1. The Codex takes the Titled bar (T 2.1): Codex, then its pages as words (Home, Pages, Atlas, Story, Quests,
   Relationships); Search the Codex is the bar's field (Ctrl K opens the palette, as today) and New (a menu of page,
   quest and session) its Cup, then More. Search leaves the strip because it is the field. For the GM the Compendium
   leaves the strip too (it is its own section); a player has no Compendium section, so for a player Compendium stays as
   the strip's last page. On a phone the pages run under the Codex header as a strip of words, with Search and New as
   the header's icons, and today's Campaign tab and its segmented parts go.
2. Hidden reads one way. Anything only the GM sees is violet with a dashed edge and an eye struck through, with Reveal
   beside it where it can be revealed: a hidden block, a hidden field, a hidden page in a list. Everything else says
   Everyone in quiet ink.
3. A player gets the same page, smaller: the GM's layout with the hidden parts left out (the server never sends them),
   no Edit, and nothing that says something is missing.
4. See as players is a switch in a page's title row; while it is on, the page draws exactly as a player gets it, under a
   violet line that says so. Writing's Preview is the same view.
5. Links are cyan with a thin line under them; a link to a hidden page reads violet for the GM and as plain text for a
   player.
6. The campaign's date is VT323 cyan wherever it shows, with whether players have it.
7. Every Codex record (page, quest, session) opens with T 2.2's title row.
8. The GM menu becomes the bar's More (a Base line icon after New): Prep templates, Backup, Autosave and history, and
   See the Codex as players (Everyone, or one character), which opens today's whole-Codex preview.
9. On a phone, writing hides the page strip and pins Done.
10. The other Codex pages take this frame now and their own designs later.

## 4. Values

| Part         | Value                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Date bar     | 10 px 14 px; a Cradle (T 2.4); the date VT323 20 px cyan                                                   |
| Kind cards   | Five equal, 12 px apart; 12 px 14 px; the count VT323 30 px                                                |
| Home columns | The left fills; the right 330 px; 18 px apart                                                              |
| Page         | Title row as T 2.2; text 680 px, 15 px / 1.65; side 340 px, 28 px from the text                            |
| Hidden block | 1 px dashed violet at 75%, violet 7% fill, 10 px 14px 12px; its title 12 px capitals in violet             |
| Writer       | Toolbar 6 px 8 px, 32 px buttons; text field 14 px 16 px; fields Cradle 360 px                             |
| Preview line | 8 px 24 px; violet 8% fill and a violet 55% line under it; 13 px violet                                    |
| Chronicle    | The line 2 px, cyan to violet; session marks 12 px squares, entries 6 px; side 330 px                      |
| Timeline     | The line 2 px in the horizon gradient with its glow; marks 14 px squares; cards four to a row              |
| Sessions     | The next session as the lead card, its Cup carrying the horizon; played sessions two to a row, 14 px apart |
