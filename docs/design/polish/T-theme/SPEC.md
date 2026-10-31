# T. The theme spec: Light Rail / Horizon

Approved by the owner on 2026-10-29 over four rounds of mockups. This is the top of the polish hierarchy in
`../CATALOG.md`: every area (A to I) inherits it before its own pages are designed, and an area's spec may add to it but
never contradict it. `PLAN.md` beside this file is the work to build it; `theme-spec.html` is the approved mockup, and
`history/` holds the four rounds. Rules 13 to 16 came back from the consistency sweep (`../T-consistency/SPEC.md`,
ADR-0072), rules 17 to 19 with amendments to 2, 9, 12, 13 and 14 from the second sweep (ADR-0073), rule 20 with
amendments to 2.2, 2.5 and rules 2, 7, 8, 9, 10 and 11 from the third sweep (ADR-0074), and rule 21 with amendments to
2.2, 2.4, 2.5 and rules 8, 9, 19 and 20 from the fourth sweep (ADR-0075), and amendments to 2.2, 2.4, 2.5 and rules 4, 9
and 19 from the fifth (ADR-0076), with the owner's say; section 6 records it.

## 1. The foundation, already built

These stand as recorded and are not reopened here:

- Dusk and Dawn, the tokens in `packages/ui/src/styles/design-tokens.css`, and the Look table in `docs/DESIGN.md`: each
  80s element has one job (the sun frame, the sunset, the horizon line, chrome lettering, lamps, the life bar, the VCR
  counter, the Cup, the neon grid, the reticle).
- Type roles: Chakra Petch 600 capitals for record, page and dialog titles and the primary's label; Bai Jamjuree for
  every other word; VT323 for game numbers; Bungee only as chrome (the wordmark, YOUR TURN, the acting name).
- Light rail (ADR-0045): light runs along lines already on screen; content fades in within 300 ms and the light ends
  within 500 ms; nothing loops.
- Horizon light and the Cup (ADR-0046): the primary is a plate holding a horizon; a chosen tab's ink is the horizon
  lying on its strip's line; overlays carry the horizon on their top edge.

## 2. The decisions

### 2.1 The section bar is Titled

- A 52 px bar under the top bar on every section that has pages: Prep, the Codex, the Compendium and Settings, and any
  section added later.
- From the left: the section's name in Chakra Petch 600 capitals at 17 px, a 1 px `--line-strong` divider, then the
  pages as words (Bai Jamjuree 600, 14 px). The chosen page is `--text` with the horizon ink on the bar's bottom line
  and its cast; the others are `--text-dim`. No icons and no box around the pages.
- The right end holds the section's search field, then its primary (the Cup at 42 px) when the section has one.
- On a phone the page's header row shows the section's name in Chakra Petch at 18 px with up to two icon buttons, and
  the pages run under it as one strip of words with the same ink, scrolling sideways with a fade when they do not fit.

### 2.2 A page header is for records only

- A list, a settings section or an overview starts with its content. The bar already names the page. At most one line of
  description sits at the top (14 px, `--text-dim`). The violet GM ONLY tag goes in front of it only on a page players
  can also open, when what it holds is the GM's alone (rule 7).
- A record (a Codex page or quest, an encounter, a map, a Compendium record, a character or creature) opens with its
  title row: the title in Chakra Petch 600 capitals at 24 px, its tags beside it, one 13 px line under it, and its
  actions at the right as secondary controls. The section's primary stays in the bar.
- On a phone a list's header row shows the section's name; a record's header row is Back and where it goes, and the
  record shows its title at the top of its content (rule 12). A title row's title is 20 px on a phone.
- A dialog's or a phone sheet's title is display capitals at 20 px. Its close is a plain icon, 18 px, in a 40 px button
  on a laptop and 44 px on a phone, as A's dialog draws it.
- A title that opens a record or a pane inside a page is 22 px on a laptop and 20 px on a phone.

### 2.3 Groups are Mixed

- A group you act in (settings rows, chips you choose from, a table you pick or edit in, the character sheet's cards) is
  a box: the Cradle (2.4).
- A group you only read (links, mentions, history, facts) is open: its heading in the eyebrow style and its content,
  with a 1 px `--line-strong` rule between one open group and the next.
- Whether a group has a box tells the reader whether it takes input.

### 2.4 The box is the Cradle

- No fill and no top. A 2 px `--line-raised` base, and 1 px sides that rise from it and fade out before the top
  (`linear-gradient(to bottom, transparent, var(--line-raised) 55%)`).
- The heading sits in the open top, 14 px in, in the eyebrow style (Bai Jamjuree 600, 11 px capitals, 0.12em,
  `--text-muted`). Content is padded 0 14 px 12 px. Groups stand 18 to 22 px apart.
- The eyebrow is one style wherever it appears: a group's heading, a table's column heads, a fact's label, a stat's
  label, a log's round line, a field's label, a timeline's column head, a counter's label and a status word. It takes a
  colour only where the colour carries a meaning (amber waiting, red dying, violet hidden, the stat block's magenta). A
  crumb keeps its 12 px label type.
- A bar of actions (the Codex's date bar, the Compendium's Sources) is a group you act in, so it is a Cradle too.
- Light: while the pointer is in the box or focus is inside it, the base lights `--cyan` (2 px, `--glow-on`) from the
  middle outward over 280 ms (`--ease-travel`), and goes out when you leave. Reduced motion makes it instant; reduced
  transparency and Dawn drop the glow, as their tokens already do.
- Never a box in a box. A table that takes input is one Cradle with its header row as the heading.
- The shape is the Cup's in grey: base and sides, open top. The Cup alone holds a horizon.

### 2.5 Secondary controls sit on a Base line

- Applies to every control that is not the primary and not a field: secondary buttons, icon buttons in content (the
  record's More button), chips you choose from, segmented options, dropdown triggers, Filters and Sort.
- The label (Bai Jamjuree 600, 13 to 14 px) sits on a 1 px `--line-raised` base line. No edge and no fill.
- Hover lights the base 2 px `--cyan`. A chosen chip or option keeps a 2 px `--cyan` base and `--text`; an unchosen chip
  is `--text-dim`. A hidden choice keeps its meaning: a violet label on a dashed 2 px violet base. A danger action
  (deleting, removing, revoking, releasing) keeps `--danger-text` on its Base line; in a menu it is a `--danger-text`
  row with the bin icon. Disabled is `--text-muted` on a `--line` base with no hover.
- The ghost, with no line until hover, is only for Cancel or Back beside a Cup.
- A segmented control is its options side by side, 6 px apart, each on its own base line, with no sunken well. Tabs are
  unchanged: words with the horizon ink on the strip's line.
- Fields keep their box: an input, a select, a search field and a number field take typing, and the box says so.
- The icon buttons in the top bar and on the map stay plain icons.
- Every control keeps a 44 px hit area. On a phone the face is the hit area: buttons, chips, icon buttons, segments,
  steppers, a toolbar's buttons, an add link and the Cup are at least 44 px tall, a chip's × takes the chip's height,
  and the header's icons and a sheet's close are 44 by 44. Base line buttons side by side stand 6 px apart, each on its
  own line. On a laptop a Base line button or an icon button has a 36 px face and grows its hit area with `.tap-target`.
- On a laptop a segment is 36 px, the Dusk and Dawn switch included. A stepper is 40 px (44 px on a phone), its number
  VT323 22 px and its minus the minus sign. A tab is 44 px with 14 px words. A content button's icon is 15 px at a 1.8
  stroke. A toast's close is a 36 px square.
- A field: the section bar's search 38 px, a form field 40 px on a laptop and 44 px on a phone. An icon button in
  content sits on its Base line, and a row's More is its dots.
- A switch is one setting on or off: the square 46 by 26 track, its knob cyan and glowing when on (`docs/DESIGN.md`).
  Picking several from a list is ticks.

## 3. Rules every area follows

1. One row of tabs. A surface has its section bar and at most one view switch, a segmented control under the top of its
   content. Never a strip inside a strip; a page never repeats its section bar's choices.
2. One primary, in a fixed place. Lists and sections: the right end of the section bar. Steps and forms: the bottom
   right of the step. The table: the panel's footer. A dialog: its footer. An empty list offers a secondary button that
   does the same thing. One Cup in view: when a page shows its own primary, the section bar's New steps down to a Base
   line button with its +, and the bar keeps its search; when a page shows two of its own, the step's or the open
   panel's keeps the Cup and the title row's steps down. A dialog's Cup sits over a scrim and doesn't count. The Cup is
   words only, apart from the caret of a Cup that opens a menu (the Codex's New); a Base line New carries its +.
3. Empty states: one line saying what is missing and one secondary button that fixes it, in the space the content would
   fill. No heading, icon or box.
4. Steps: one Steps rail everywhere. Done is a cyan check, current a cyan outline, a step that needs a choice an amber
   mark; numbers in VT323. No magenta. A mark is 24 px with its number in VT323 17 px.
5. A number you roll is the button: the whole row or cell, with no box drawn around the number. Hover tints the row and
   lights the number.
6. Boxes are Cradles (2.4), and a box never holds another box. Inside a box, rows are divided by 1 px `--line`.
7. GM-only is a tag: the violet GM ONLY tag on a group's or a row's heading, on a roll, or on the description of a page
   players can also open. A section only the GM opens (Prep, Settings' sections other than Device) carries none. One
   tag: VT323 16 px in a 22 px box. No violet bar on a box. Hidden content keeps its dashed violet block.
8. Density: rows are 44 px on a phone and with touch, table rows 48 px, compact rows 36 px for GM data with a mouse, and
   30 px only for the character sheet's skills with a mouse. Menu rows are 48 px, 52 px in a phone sheet, the rule
   between rows inside that height. A table's rows are 48 px on a laptop and on a phone.
9. Colour keeps one meaning: gold is hit points, red damage, danger and a harmful condition, cyan chosen, focused,
   proficient or targeted, `--party` blue the party and spell slots, violet GM-only and hidden, amber waiting or needing
   you, magenta an Action, homebrew, the stat block's rules, a door on the map and sound that waits to play. Who sees
   something is never magenta: shared reads in the dim text colour, hidden in violet. The horizon is the top of the app
   and of what opens above it, the chosen tab's ink and the primary's lines; a card never carries it. A word in amber,
   magenta or violet takes that colour's text shade (`--caution-text`, `--magenta-text`, `--violet-text`), as a danger
   word and a cyan word do; in Dawn the shades are darker so a word reads at 4.5:1, while lamps, edges and fills keep
   the colour.
10. Type: one or two display titles per view, the section bar's name aside. A step's, a column's or a card's head inside
    a page is an eyebrow or Bai Jamjuree 600. Bungee only as chrome.
11. Widths: workbenches, lists and tables use the full width. Settings and forms keep an 880 px column, centred, or set
    beside their side list where they have one. Reading text keeps a 680 px measure.
12. Phones: every page stacks a header row (a title and up to two icons), at most one strip of pages, the content
    scrolling, and the bottom tabs. A primary moves to the header as an icon or to the foot of the content. What the
    header names: on a section's page, the section (PREP, CODEX), with the strip naming the page; on a record, Back and
    where it goes (‹ PEOPLE, ‹ MONSTERS, ‹ TABLE SCREEN) with the record's own icons and no strip, the title opening the
    content with its line; on a page below the top that isn't a record (a Settings section, Prep templates), Back and
    the page's own name.
13. One side list. Every list at the side of a page reads one way (E2 2.1, G2 2.1): an eyebrow in capitals naming what
    it holds, with no count; each row its name and its count or state in VT323 at the right, a row that names a kind of
    thing with its icon before the name (a person's face at 20 px) and a row that filters (All, a status, a view, a
    deadline) with none; the chosen row lit cyan with the 2 px edge. A tree nests 16 px a level. What a thing is goes in
    its own line, not on its row. On a phone the list is the first page, rows 48 px, or a row of chips.
14. A crumb sits on the title's line. A title row with a way back puts its crumb before the title, on the same line,
    with the back chevron ("‹ PEOPLE SISTER ILSA VARN"). On a phone the crumb is the header's Back (rule 12).
15. A menu about one thing names it. It opens with the thing's name in display capitals and its line beside it ("GOBLIN
    BOSS Monster · 15/21"), then its groups under eyebrows. A menu that offers a choice (File it under, Move 2 maps to,
    Reveal to) opens with its eyebrow.
16. A phone sheet opens one way: the handle, then its title and the close button at the right over a hairline, then the
    content, with the primary pinned at its foot.
17. A list's toolbar reads one way: its find field where it has one, then its count in plain words ("6 maps", "4
    people", "2 active quests"), its filters, its sort as the sort icon and its word ("Modified", "By name"), then the
    list's own action as a Base line button. A list has no title row; the bar's lit page names it.
18. Fields: a choice field shows its icon if it has one, its value, and the caret at its right end. A find field shows
    the search icon and a muted placeholder, as the section bar's search does.
19. A state is a boxed tag in capitals (DRAFT, LIVE, ACTIVE), in the dim text colour, or cyan while it is live or
    active; a kind is its icon and its word (Character, Monster, Battle map); readiness is a lamp and words (Ready, No
    grid yet, Saved). Every tag, a condition and a source included, is VT323 16 px in a 22 px box; a lamp is 8 px. A
    kind with its count is a card: its icon and name, the count under them in VT323 30 px, its line.
20. Dates and times read one way: "Oct 30, 7:40 PM" and "Today, 8:41 PM", the year only when it isn't this one, in Bai
    Jamjuree with their capitals. VT323 stays for game numbers and the Codex's own calendar. A date field shows its date
    the same way ("Nov 8"). A chip's count follows its label after a space ("All 4").
21. A notice reads one way: a line about the page you are on (waiting, reading an old version, offline, a note on who
    sees something) is a 1 px frame with a 3 px edge at its left in its meaning's colour (amber waiting, cyan reading an
    old version, violet GM only), no fill, its words in `--text`. The dashed violet block is for hidden content only.

## 4. Page patterns

Each area builds its pages from these. The area's own round designs its pattern in detail.

| Pattern         | What it is                                                                                                            | Used by                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Workbench       | The map in the middle, tools on the left, one tabbed panel on the right, turn order across the top                    | C, the table; E1.3 encounter page                        |
| Sheet           | A vitals band, columns of what you read and roll, one tabbed region for what you do                                   | D1 character sheet; creatures                            |
| Record document | The record as its readers see it, with a panel beside it answering what the GM asks                                   | F2 Codex page; G6 Compendium record; E2.2 map page       |
| List as a table | Toolbar (filters, sort, count), then a sortable table; rows with two facts on a phone                                 | E1.2, E2.1, E3.1, E3.3; G2; I6; I7                       |
| Making as steps | Steps on the left, questions in the middle, a live preview on the right                                               | D3 builder and level flow; E1.4, E2.3 editors; G7 studio |
| Settings rows   | Cradle groups of rows: label and hint on the left, the control on the right, centred at 880 px                        | I, settings; F6 Codex tools                              |
| Arrival         | The sunset with one card or one pair of buttons                                                                       | B, arrival; H1 pair this screen                          |
| Dialog          | A title on the horizon edge, the content, a footer with the primary at the right; a bottom sheet on a phone (rule 16) | Every Modal and Drawer                                   |

## 5. Using this spec in an area round

- Start an area's round from these rules and patterns; mock only what the area adds.
- When an area finds a rule that belongs to every area, it comes back here first, with the owner's say, and the spec's
  version history records it.

## 6. Version history

- 2026-10-29: approved over four rounds, with rules 1 to 12.
- 2026-10-30: rules 13 to 16 added from the consistency sweep across every approved area (`../T-consistency/SPEC.md`,
  ADR-0072): one side list, the crumb on the title's line, a menu that names its thing, and one way a phone sheet opens.
  `../T-consistency/consistency.html` draws them; `theme-spec.html` stays as approved in round 4.
- 2026-10-30: the second sweep (`../T-consistency/SPEC.md` section 3, ADR-0073) added rules 17 (a list's toolbar), 18
  (fields) and 19 (states, kinds and readiness), and amended rule 2 (one Cup in view, words only), rule 9 (magenta's
  meanings), rule 12 (what a phone header names), rule 13 (which rows carry an icon) and rule 14 (the crumb on a phone).
- 2026-10-31: the third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) added rule 20 (dates, times and a chip's
  count) and amended 2.2 (when a description carries the GM ONLY tag), 2.5 (danger, the ghost, hit areas on a phone,
  icon buttons, switches and ticks), rule 2 (a menu's caret on the Cup), rule 7 (where the GM ONLY tag goes and its one
  size), rule 8 (menu and table rows), rule 9 (a harmful condition is red), rule 10 (heads inside a page) and rule 11 (a
  column beside a side list).
- 2026-10-31: the fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) added rule 21 (one notice) and amended
  2.2 (title sizes on a phone, in a dialog and in a sheet), 2.4 (one eyebrow), 2.5 (what counts as a control on a phone,
  and neighbours' lines), rule 8 (a menu's rule inside its row), rule 9 (no horizon on a card), rule 19 (a state's
  colour) and rule 20 (a date field).
- 2026-10-31: the fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) amended 2.2 (a dialog's close, a record's
  or a pane's title), 2.4 (the eyebrow's other places, a bar of actions as a Cradle), 2.5 (segments, steppers, tabs,
  icons in buttons, a toast's close, fields), rule 4 (one mark), rule 9 (text shades for amber, magenta and violet) and
  rule 19 (one tag, one lamp, Saved as readiness, one kind card).
