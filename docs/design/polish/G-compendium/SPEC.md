# G. The Compendium: its frame

Approved by the owner on 2026-10-29 after three rounds of mockups. Area G in `../CATALOG.md` is the rules content, SRD
and homebrew, and who sees it. Like the table (C), Prep (E) and the Codex (F), it is designed as one frame first: the
Compendium's bar, its home, browsing a kind, a record (an SRD record and a homebrew copy of it), and making homebrew.
Sources and export, the Sharing page, Compare and Merge, the editors for kinds other than monsters, search's own dialog
and the catalog picker come in later rounds inside this frame. It inherits the theme (`../T-theme/SPEC.md`) and the
frame (`../A-frame/SPEC.md`). `PLAN.md` beside this file is the work to build it; `compendium.html` is the approved
mockup, and `history/` holds rounds 1 to 3 as they were shown. Round 3 asked one question again, browsing and records
together.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) gave a dialog on a phone its handle above its title and
close (T rule 16).

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) made New homebrew words only, stepped it down when a
page shows its own Cup, kept Next as the editor's Cup with Done stepped down, and drew Sort as the sort icon and its
word.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) made Clear, Clear all and Show all Base line buttons,
drew the panes' chevrons at 36 px on their Base lines and table rows at 48 px, made the editor's Back a ghost, headed
its step with an eyebrow (Defences), and gave an empty kind its New homebrew button.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew the results' filter chips, the open records
button and the phone's Filters on Base lines (T 2.5), the audience and Climb, fly or swim at 36 px (44 px on a phone),
the editor's steppers at 44 px on a phone, the empty spell lists' New homebrew at 36 px, the note that players never get
a stat block as the one notice (T rule 21), and CR and Type in the eyebrow (T 2.4).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the home's kind cards as the Codex draws them (T
rule 19), the stat block without its name inside its record, the Sources line as a Cradle (T 2.4), the editor's stepper
numbers in VT323 22 px with the minus sign, the browsing fields at 40 px and the audience's icons at 15 px (T 2.5), a
phone sheet's close as the one close (T 2.2), every tag in a 22 px box (T rule 7) and a record's title at 22 px, 20 px
on a phone (T 2.2), and gave Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id  | Surface                                 | Decided here                                     |
| --- | --------------------------------------- | ------------------------------------------------ |
| G1  | The Compendium's frame                  | Rule 3.1                                         |
| G3  | Home (`/compendium`)                    | Shelves (2.1)                                    |
| G2  | Browsing a kind                         | The filter panel (2.2)                           |
| G6  | A record: its card, sharing and history | Three panes, with the open records as tabs (2.3) |
| G10 | Add a monster to an encounter           | Rule 3.7                                         |
| G7  | The edit studio                         | The studio, refined (2.4)                        |
| G8  | New homebrew                            | Rule 3.8                                         |

Left for later rounds: Sources and export (G4), the Sharing page (G5), Compare and Merge inside a record (G6), the
editors for kinds other than monsters (G7; they take 2.4's frame meanwhile), search's dialog (G9) and the catalog picker
(G11). They follow the rules in section 3 meanwhile.

## 2. The decisions

### 2.1 Home is Shelves

- The Compendium opens on its kinds, three to a row, with what needs the GM across the top and the sources at the foot.
- Needs you is a strip with an amber edge: "Needs you · 2", then each record that needs the GM with its kind's icon, its
  name, why in one line ("A draft. Publish it before you share it.", "Its Shortbow has no range."), its state tag or its
  problem count in amber, and Open. When nothing needs the GM, the strip is one quiet line in today's words.
- The nine kinds as cards: Classes, Subclasses, Species, Backgrounds, Feats, Spells, Items, Monsters and Spell lists.
  Each card has the kind's icon beside its name, its count (SRD and homebrew together) in VT323, a line with its
  homebrew and drafts in magenta ("2 homebrew · 1 draft") or "SRD only" or "None yet" in quiet ink, and under a hairline
  up to three of its records, homebrew first in magenta; a kind with none says so ("No spell lists yet.") with + New
  homebrew beside it (T rule 3). Pressing a card opens Browse on that kind.
- The sources are one line at the foot, a Cradle (T 2.4): SRD 5.2.1 with its count and that it is always in pickers,
  This table with its count and whether it is in pickers, then Import a pack and Export.
- On a phone: Needs you as a box, then the kinds two to a row without their records.

### 2.2 Browsing is the filter panel

- Browse is a filter panel at the left (270 px) and the kind's table at the right.
- The panel's head: Filters, how many are on, and Clear. Then the kind's filters, each choice with a count of the
  records it would show given the other filters:
  - Source: SRD 5.2.1 and This table, as checkboxes.
  - The kind's range (CR for monsters, level for spells) as a small chart of how many records sit at each value, with a
    two-handle range under it and its two ends as fields.
  - The kind's main list (type for monsters, school for spells, rarity for items) as checkboxes, six shown and "Show all
    N".
  - The rest folded as rows with their current value (Size, Who sees it, Problems and the kind's other filters); a row
    opens in place.
- Over the table: Kind as a menu, each active filter as a chip with its remove button, Clear all, the count ("8 of
  332"), Sort, and, while records are open, a button that says how many ("3 records open") and brings them back (2.3).
  Open records are marked Open in the table.
- The table keeps today's columns for each kind. Homebrew is tagged magenta, who sees it reads as rule 3.3, and problems
  are amber.
- On a phone: the kind as a menu, Filters with how many are on (it opens the panel as a sheet from the bottom with Show
  N at its foot), Sort, the active filters as chips, and the records as rows (name, CR and type, AC).

### 2.3 Browsing and records are three panes

The owner chose Open tabs for a record in round 2 and asked for it to be joined with the filter panel; round 3 compared
six ways to join them, and the owner chose Three panes.

- With a record open, Browse is three panes side by side, all live: the filter panel (250 px), the results (300 px) and
  the record (the rest).
- The filter panel keeps 2.2's groups and counts. Ticking a choice changes the results beside the record at once: the
  count in the results' head changes and the rows that joined are marked for a moment. The record stays as it is.
- The results are a list: each record's kind icon, name, size and type, its key value (CR for a monster, level for a
  spell) and the Homebrew tag. The open record is lit; the arrow keys move through the list, and Enter opens the lit
  one. A record that is open but no longer in the results stays open; the list says so in a line at its top.
- Each pane has a head: the filter panel's says Filters, how many are on and Clear; the results' says how many ("8
  monsters") and the sort. Each has a fold button: a folded pane leaves its head as a narrow edge with its icon and its
  count, read across, and pressing it opens the pane again.
- The open records are tabs over the record pane only (40 px): each with its kind's icon, its name and Close. Opening a
  record from the results adds its tab and shows it, or shows its tab if it is already open. Records opened from
  anywhere else (search, a link in a card, Your copies, Based on) open as tabs here too. Closing a tab shows the tab
  beside it; closing the last one returns Browse to 2.2 at full width. The open tabs last while the browser tab is open.
- Going back to the table at full width (the results' fold, or Browse in the section bar) keeps the open records; the
  table's "3 records open" button brings the three panes back with the last record shown.
- The record (T 2.2's title row):
  - Its name with More; one line with its kind, size and type for a monster, the source tag, a homebrew record's state
    tag and Saved, and its key numbers in VT323 (AC, HP and CR for a monster).
  - Then its actions as Base line controls and the Cup, and at the right of the same line its parts as a small switch:
    Card, Sharing and History for homebrew (Compare stays inside History); Card and Your copies (with their count, the
    homebrew made from it) for an SRD record. There are never more than two rows of tabs: the section bar and the open
    records.
  - An SRD record's actions: Add to an encounter (for a monster) and Make a homebrew copy as the Cup. A homebrew
    record's: who sees it (Hidden, Everyone, Characters), Edit, and Publish as the Cup while it is a draft.
- Edit opens the studio (2.4) over the three panes, with the open records' tabs kept over it and the record's tab saying
  Editing; Done returns to the three panes and the record's Card.
- On a phone: the results are a list with Filters (a sheet from the bottom with "Show N monsters"), the active filters
  as chips and a button with how many records are open. A record opens full screen under the Compendium header with the
  open records as a strip of chips under it, then its title row with its parts as a switch, and its main action pinned
  at the foot (Make a homebrew copy, or Publish with who sees it and Edit beside it).

### 2.4 Making homebrew is the studio, refined

- The studio keeps today's way of working: one step at a time, with every question on one page as the other mode.
- The title row: the kind as a crumb and the record's name; a line with its state tag, the Homebrew tag and "Based on
  Goblin Boss" for a copy; the actions: Steps and All questions as a segmented control, Saved (a cyan lamp while
  autosave has the latest), Done as the Cup, and More.
- The steps rail (250 px): each step with its number or a done mark, its name, and its current answer in one line ("AC
  17 · HP 27 · 30 ft.", "10 15 12 10 8 10", "Multiattack, Scimitar, Shortbow"). The step you are on is lit; a step with
  a problem has an amber mark.
- The middle: the step's name, one line of what its answers make ("These answers make its AC, HP and Speed lines."), its
  questions as fields and Base line options, and Back and Next at the foot (Next names the next step and is the Cup).
- The preview (400 px): Preview, then for a copy a "Mark what differs" switch, and the live stat block with what differs
  from the record it was copied from in amber.
- On a phone: the header Editing, the record's name and Saved, the step's name with "Step 2 of 9" and a bar of the
  steps, then Questions, Card and Steps as a segmented control, the questions, and Back and Next pinned at the foot.

## 3. Rules for the Compendium

1. The Compendium takes the Titled bar (T 2.1): Compendium, then its pages as words (Home, Browse, Sources, Sharing).
   Search the SRD and homebrew is the bar's field (Ctrl K, as today), Rules a Base line control, and New homebrew the
   Cup. Today's Homebrew page is Home. On a phone the pages run under the Compendium header as a strip of words, with
   Search and New homebrew as the header's icons.
2. Where a record comes from reads one way: an SRD record carries a quiet SRD 5.2.1 tag in VT323; homebrew carries a
   magenta Homebrew tag, and homebrew counts are magenta wherever they show.
3. Who sees it reads as in the Codex (F rule 3.2): Hidden is violet with a dashed edge and the eye struck through,
   Everyone is quiet ink, and Characters names them. The control is Hidden, Everyone and Characters as Base line
   options.
4. A draft has a dashed state tag and Publish as its Cup. A draft cannot be shared, and its sharing says "Publish it
   before you share it.", as today.
5. One stat block, everywhere it shows (the card, the studio's preview, Prep and the table): the SRD's order and words,
   the name in display capitals (inside a record, whose title already names it, it starts with its line), the six
   abilities as a row of cells with VT323 numbers, and the section heads (Actions, Bonus Actions, Reactions) in small
   capitals over a magenta line.
6. Numbers are VT323: counts, CR, AC, HP and ability scores.
7. Every record opens with T 2.2's title row (2.3). Add to an encounter keeps today's menu of the prep's encounters.
8. New homebrew stays a small dialog with today's words (name, kind, blank or a copy of a record, "It starts as a draft
   only you can see."). The record it makes opens as a tab in the studio.
9. Players never get a monster's stat block, whoever it is shared with, and the sharing says so wherever a monster is
   shared.
10. A problem reads amber: an amber mark and its count on the record, in the table's Problems column and in Needs you.
11. The other Compendium pages take this frame now and their own designs later.

## 4. Values

| Part               | Value                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs you strip    | 2 px 14 px; 1 px caution at 45% over `--line-strong`; a 3 px caution edge at the left                                                                      |
| Kind cards         | Three to a row, 12 px apart; 12 px 14 px; the icon 15 px beside the name 14 px 600; the count VT323 30 px under them; the records 12.5 px under a hairline |
| Filter panel       | 270 px, 16 px sides; groups 10 px 0 12 px with a hairline between; choices 30 px high, counts VT323 15 px                                                  |
| CR chart           | 36 px high, bars 2 px apart, the chosen range cyan; the range 4 px with 14 px handles                                                                      |
| Three panes        | Filters 250 px, results 300 px, the record the rest; 1 px `--line-strong` between                                                                          |
| A folded pane      | Its head as an edge 44 px wide: the icon and the count, read across                                                                                        |
| Pane heads         | 42 px; 12 px capitals with the count in VT323 17 px                                                                                                        |
| Strip of open tabs | 40 px over the record only; tabs up to 260 px, 12 px 10 px; the open tab on the page's ground with a 2 px cyan line on top                                 |
| Results list       | Rows 46 px: name 14 px, size and type 12 px, key value VT323                                                                                               |
| Record             | The title row as T 2.2, 12 px 20 px; key numbers VT323 18 px; its parts' switch 32 px; the body up to 720 px, 16 px 22 px                                  |
| Studio             | Steps rail 250 px, steps 58 px high with their answer 12 px; the middle 18 px 26 px; the preview 400 px                                                    |
