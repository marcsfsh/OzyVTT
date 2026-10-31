# F Time and tools

Approved by the owner on 2026-10-30 after one round of mockups. Prep templates (F6.1), the calendar (F4.4), a timeline
record (F4.6), backup and restore (F6.2), and autosave and history (F6.3) in `../CATALOG.md`, with rules that settle
setting your date and a player's Compendium in the Codex (F6.4). They sit inside the Codex's frame
(`../F-codex/SPEC.md`), the story's tabs (`../F-story-people/SPEC.md`) and Settings' frame (`../I-settings/SPEC.md`),
and inherit the theme (`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`) and the settled side list
(`../E2-maps-tokens/SPEC.md` 2.1, `../G-compendium-pages/SPEC.md` 2.1). `PLAN.md` beside this file is the work to build
it; `time-and-tools.html` is the approved mockup, and `history/` holds the round as it was shown. The owner put options
together for a session from a template and for the tools, and asked that every side list match the ones already settled;
this spec draws them that way.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) put the crumbs of Prep templates and the calendar on their
titles' line, drew Settings' own list as the settled side list (as `../I-settings-leftovers/SPEC.md` 2.6 says), and gave
a dialog on a phone its handle.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) drew the story's tabs as four tabs on a phone, put an
entry's phone header as ‹ TIMELINE, and stepped the Codex bar's New down when a page shows its own Cup.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew the Codex's tools as Cradles (T 2.4), the
timeline's entries with a grey edge, cyan when chosen (T rule 9), a session's template chips at 36 px and the calendar's
part under an eyebrow (Months), made Cancel a ghost, and set the reading measure at 680 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew a record's linked chips at 36 px (T 2.5), wrote
Played on as "Nov 8" (T rule 20), set Prep templates' and the calendar's title rows at 24 px and the sheets' titles at
20 px (T 2.2).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew a template's parts as their icon and word with no
box and the hashtag as the pages index's chip (T rule 19), Saved as a lamp and its word, the field labels and the
timeline's heads in the eyebrow (T 2.4), a phone sheet's close as the one close (T 2.2), the bar's search at 38 px, the
fields at 44 px on a phone, a template's drag handle at 44 px on a phone and its icons at 15 px (T 2.5), the tabs at 44
px (T rule 1), every tag in a 22 px box (T rule 7) and a pane's title at 20 px on a phone (T 2.2), and gave Dawn's
amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id   | Surface                            | Decided here                                                   |
| ---- | ---------------------------------- | -------------------------------------------------------------- |
| F6.1 | Prep templates                     | One page: templates and kinds at the side, today's panel (2.1) |
| F6.1 | Editing a template                 | The kinds at the side, dragged in (2.2)                        |
| F6.1 | A session from a template          | Today's panel, and the Sessions tab (2.3)                      |
| F4.4 | The calendar                       | Its own page, its parts at the side (2.4)                      |
| F4.6 | A timeline record                  | In the story's side column (2.5)                               |
| F6.2 | Backup, restore, bring in notes    | In Settings, each tool a row of its side list (2.6)            |
| F6.3 | Autosave and history               | In Settings, each tool a row of its side list (2.6)            |
| F6.4 | A player's Compendium in the Codex | Rule 3.5                                                       |

## 2. The decisions

### 2.1 Prep templates are one page

- More, Prep templates, opens one page under the Codex's bar: its crumb (More) on the title's line, then three columns.
- At the left (250 px), the settled side list (E2 2.1): TEMPLATES, each template a row with its icon, its name and its
  section count in VT323, the chosen one lit; New template as the quiet action at its foot. Under it, ADD A SECTION
  (2.2).
- In the middle, the chosen template: its name in display capitals with Default for new sessions as a switch, Duplicate
  and More (Rename, Set as default, Delete); one line ("6 sections · made session 2 · saved"); then its sections as rows
  (2.2). It saves as you go, as today. The starting template reads as today: it can't be changed; Duplicate it.
- At the right (340 px), today's panel (2.3).
- On a phone: the templates as chips with their counts, the chosen template's sections, then Add a section and New
  session from it.

### 2.2 Editing a template uses the kinds at the side

- Each section is a row: its handle, its title and prompt, what it holds as a tag, and More (Rename, Remove). Rows
  reorder by the handle or by Alt and an arrow key, as today.
- ADD A SECTION in the side list holds the seven kinds, each a row with its icon, its name and how many of it this
  template has: Text, Scenes, Checklist, Linked pages, Clocks, Quests in play, Encounters.
- Dragging a kind among the sections shows where it lands ("Drop Encounters here"); pressing a kind adds it at the end.
  While a kind is pressed or dragged, its row lights and the foot of the list says what it holds ("Encounters · Table
  encounters you pick to run.").
- On a phone, Add a section opens a sheet of the same kinds with their counts and what the chosen one holds.

### 2.3 A session from a template: today's panel, and the Sessions tab

- The template page's right column keeps today's panel: NEW SESSION FROM THIS TEMPLATE (Session, Played on, Copies these
  sections, Create session 4), then MADE FROM THIS TEMPLATE with each session and Re-apply, and today's line: "Editing
  the template never changes these sessions. Re-apply adds any new sections and keeps what was written."
- The story's Sessions tab gets PLAN SESSION 4 beside the sessions: Made from as chips (the default chosen), Copies
  these sections, Played on, and Create session 4.
- Re-apply keeps today's words and behaviour.

### 2.4 The calendar is its own page

- More, Calendar (and Edit calendar in the date bar) opens a page with its crumb on the title's line and Saved, a lamp
  and its word; it saves as you go.
- At the left, the settled side list: CALENDAR (Months 12, Eras 1, Weekdays 7, Year suffix DR), then DATES (Your date,
  Players' date), the chosen part lit.
- At the right, the chosen part: its name in display capitals with its action (Add month), one line ("12 months · a year
  of 360 days"), then its rows (Months: handle, name, days in VT323, remove).
- A change that moves dates players can see shows today's warning under the rows before it saves ("This moves dates
  players can see", the records it moves, and that the raw dates are kept).
- On a phone: the parts as chips, the chosen part's rows.

### 2.5 A timeline record opens in the side column

- Pressing a record on the timeline lights it and turns the story's side column into the record (F's swap): Back and its
  kind at the head with More; its date in VT323 cyan, weekday and session, who sees it; its text; what it links and its
  tags; Edit, Hide from players (or Show to players) and Delete.
- On a phone the record opens as the tab's page with Timeline to go back.

### 2.6 The Codex's tools move into Settings, each a row of its side list

Settings' list is drawn as the settled side list since ADR-0071 (`../I-settings-leftovers/SPEC.md` 2.6); the Codex group
sits in it as rows with their icons and counts.

- Settings' side list (I 2.1) gets a group under its sections: CODEX, "Backup and saving", with each tool a row with its
  icon, its name and what it holds now: Backup ("Never downloaded"), Restore ("Replaces everything"), Bring in notes
  ("Adds pages, hidden at first"), Autosave ("On · after 1 second") and Version history ("12 versions · about 3 KB").
- The chosen tool's page at the right is Settings' rows (I 2.2): Version history holds Keep version history, Save a
  version at most once every, and Delete old versions; Backup holds Download backup; Restore holds Choose a backup file;
  Bring in notes holds the GM-only or player-visible choice and Choose files; Autosave holds its switch and pause.
- The Codex bar's More opens Settings at the Codex group (Backup, and Autosave and history); Settings' search finds the
  tools.
- On a phone, Settings' list shows the Codex group; a tool opens as its page.

## 3. Rules for time and tools

1. The settled side list is one pattern. An eyebrow, one row a thing (its icon, its name, a count in VT323), the chosen
   lit with the cyan edge, a quiet action at the foot; several groups share one list. Settings keeps its own list (I
   2.1), with a line of what each holds now.
2. Prep stays the GM's. Templates and prep never reach a player.
3. A session keeps what was written. Editing a template never changes the sessions made from it; Re-apply only adds
   sections and keeps the writing.
4. Your date keeps its small dialog. Pressing your date in the date bar opens today's Your date as A's dialog: year,
   month, day and how it reads.
5. The Codex's Compendium reads as the Compendium. A player's Compendium in the Codex takes G's three panes (G 2.2),
   read only, with no monsters.
6. Restore asks first. Restore backup keeps today's confirm with every section's count; nothing changes on a bad file.
7. Nothing new in what the controls do. Every template, calendar, record, backup and history action keeps today's routes
   and words.
8. Phones: side lists become chips; templates read, edit and start sessions on a phone; 44 px hit areas.

## 4. Values

| Part           | Value                                                         |
| -------------- | ------------------------------------------------------------- |
| Side lists     | 250 px; rows 38 px; counts VT323 16 px (E2 2.1)               |
| Templates page | 250 px, the template, 340 px                                  |
| Section rows   | At least 52 px; the kind's tag 11 px capitals                 |
| Drop place     | 46 px, 1 px dashed cyan                                       |
| Calendar rows  | 42 px (48 px on a phone); days VT323 17 px                    |
| Record column  | 360 px                                                        |
| Settings' list | 290 px; rows 52 px; the Codex group under its eyebrow (I 2.1) |
