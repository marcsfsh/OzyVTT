# F. Finding and pages

Approved by the owner on 2026-10-30 after one round of mockups. The Codex's search page (F1.3), the command palette
(F1.4), a tag (F1.5), the pages index (F2.1), revealing to players (F2.5), version history (F2.6) and the page picker
(F2.8) in `../CATALOG.md`, inside the Codex's frame (`../F-codex/SPEC.md`). They inherit the theme
(`../T-theme/SPEC.md`), the frame (`../A-frame/SPEC.md`, its search dialog A 2.3 above all) and the maps' folders at the
side (`../E2-maps-tokens/SPEC.md` 2.1). `PLAN.md` beside this file is the work to build it; `finding-and-pages.html` is
the approved mockup, and `history/` holds the round as it was shown.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) gave a page its phone header as ‹ PEOPLE, the toolbar
its count in plain words and its sort icon, and the find field a muted placeholder.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) wrote version history's dates as "Oct 25, 9:40 PM" (T
rule 20), made Cancel a ghost, and set the reading measure at 680 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew the pages index's tag chips at 36 px (T 2.5) and
the version band as the one notice (T rule 21).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the results' title at 22 px (T 2.2), the fields at
44 px and the tabs at 44 px on a phone (T 2.5, rule 1) and every tag in a 22 px box (T rule 7), and gave Dawn's amber,
magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id         | Surface                         | Decided here                           |
| ---------- | ------------------------------- | -------------------------------------- |
| F1.3       | All the results                 | Results and the page (2.1)             |
| F2.1       | The pages index                 | Kinds at the side (2.2)                |
| F1.5       | A tag                           | In the side column (2.3)               |
| F2.5       | Revealing to players            | In the side column (2.4)               |
| F2.6       | Version history                 | In the side column, compact rows (2.5) |
| F1.4, F2.8 | The palette and the page picker | A's search dialog (rules 3.1, 3.2)     |

## 2. The decisions

### 2.1 All the results open as panes

- A's search dialog (A 2.3) is the way in; its last row, See all {N} results, opens the search page
  (`/codex/search?q=`).
- Three columns under the Codex's bar: at the left (220 px) Kinds (All and each kind with its count in VT323) and Who
  sees it (Everyone and Hidden, the GM's only: today's Revealed and Hidden); in the middle (420 px) the field with the
  count, then the results as rows (the kind's icon, the name with the typed part lit, the kind and the line that
  matched, who sees it, More); at the right the chosen page in its compact title row with the match lit in its text and
  its facts.
- The first result is chosen on arrival; arrows move through the results and Enter opens the page.
- A hit inside a hidden block says "Hidden block:" before its line and carries the "1 block hidden" tag.
- On a phone: the field, the kinds as chips, the results as rows; the chosen one opens under its row with the matched
  part and Open the page.

### 2.2 The pages index puts the kinds at the side

- Two columns, as the maps' folders (E2 2.1): at the left (240 px) KINDS (All pages and each kind with its count, the
  chosen one lit), then FOLDERS · ONLY YOU for the GM (today's folders with counts, New folder, each folder's menu as
  today), then TAGS as #name chips with their counts.
- At the right, the chosen kind's, folder's or tag's pages as rows: the kind's icon, the name and its line, its tags,
  who sees it, and More; the toolbar has Find a page by name, the count in plain words ("4 people"), Changed (the order,
  with the sort icon) and New page.
- A hidden page's name is violet with its Hidden tag (F rule 2).
- A player's index has the kinds and tags with plain counts, no folders, no Hidden marks and no New page, as today.
- On a phone: the kinds and then the tags as chips, the rows under them.

### 2.3 A tag opens in the side column

- Pressing a tag on a page turns the page's side column into the tag: Back (to the facts), "#thornwick · 4 pages", then
  everything that carries it in today's groups (pages, maps, pins, journal entries, sessions, quests), each group only
  when it has any, each item a row that opens it. The text stays where it is.
- A tag pressed in a list (the index, search) filters that list to the tag (2.2's TAGS).
- `/codex/tags/:tag` opens the pages index filtered to the tag.
- On a phone the tag is a tab beside Overview and Relations, named #thornwick.

### 2.4 Revealing opens in the side column

- Reveal on a hidden block, field or page turns the side column into the reveal: Back, "Reveal {name}" in violet, Who
  sees it (Everyone or each character as Base line chips; choosing characters is today's Chosen characters), What they
  will read (the text as players will get it), the stamp's line (the session and the players' date), and Reveal to
  everyone (or "Reveal to Borin and Lyra") as the Cup.
- Revealing closes the column; the block reads as revealed, as today.
- On a phone: a Reveal tab beside Overview and Relations with the same parts.

### 2.5 Version history opens in the side column, one compact line each

- More's Version history turns the side column into Versions · {N} with a close: each version one line of at least 44 px
  (its number in VT323, when, and what changed, cut with an ellipsis), the newest says Now, the chosen one lit; under
  them today's line on how often versions are saved.
- Choosing a version shows the page as it was, under a notice with its cyan edge (T rule 21): "Reading v3 from Oct 25 ·
  {what changed}", with Restore this version and Back to now. What has been added since is marked in the text as a cyan
  line.
- On a phone: a History tab; the chosen version opens under its row with its text and Restore this version.

## 3. Rules for finding and pages

1. The palette is A's search: Ctrl K in the Codex opens A's search dialog looking in the Codex, keeping today's last
   row, New page "{text}". The Codex's own palette goes.
2. Picking a page is search: linking a page (a relationship, a field, a pin) opens A's search dialog in the Codex,
   titled for what it links, offering only pages.
3. The side column swaps: a tag, a reveal and the versions each take the page's side column in turn, with Back at its
   head; the text stays where it is. One at a time.
4. Nothing new in what the controls do: every search, tag, reveal and restore keeps today's routes and words. A player's
   search and index list only what they can open; hidden pages and blocks never reach them.
5. Hidden reads one way (F rule 2), in every list and row.
6. A tag reads #name everywhere in the label face.
7. Phones: one column; the side column's parts become tabs on the page; dialogs and menus open from the foot; 44 px hit
   areas.

## 4. Values

| Part             | Value                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Search panes     | Kinds 220 px; results 420 px; rows at least 54 px; the match `--cyan-hi` on a 14% cyan wash           |
| Index            | Side list 240 px, rows 38 px, counts VT323 16 px; tag chips 28 px; page rows at least 54 px           |
| Side column      | 340 px (F 2.2); its head 32 px with Back; the Cup full width                                          |
| History rows     | At least 44 px, one line: the number VT323 18 px, when 12.5 px 600, what changed 12.5 px `--text-dim` |
| The version line | 8 px 24 px; a 8% cyan fill and a cyan 55% line under it; 13 px `--cyan-hi`                            |
