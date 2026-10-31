# A. The frame and wayfinding

Approved by the owner on 2026-10-29 in one round of mockups. Area A in `../CATALOG.md`: everything around the pages that
gets anyone to any surface and tells them what is happening. It inherits the theme spec (`../T-theme/SPEC.md`) and adds
to it without contradicting it. `PLAN.md` beside this file is the work to build it; `frame.html` is the approved mockup,
and `history/` holds round 1 as it was shown.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) settled what a phone header names on a record (2.2):
Back and where it goes, with the title in the content, as T 2.2 says.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew every phone control at 44 px and the header's
icons 44 by 44, as section 4 says.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew the Reconnecting band as the one notice (T rule
21), kept a menu row's rule inside its 48 px (T rule 8) and gave search's Cancel its 44 px on a phone.

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew the frame's turn order with the table's faces, 38
px on a 2 px rim (34 px on a phone), with G2, GB and B; the menu's Dusk and Dawn switch as 36 px segments (T 2.5); the
panel's tabs at 44 px (T rule 1); lamps at 8 px (T rule 19); and a toast's close as a 36 px square. It also gave Dawn's
amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id            | Surface                                     | Decided here                      |
| ------------- | ------------------------------------------- | --------------------------------- |
| A1, A2        | The GM's and a player's top bar on a laptop | One menu (2.1)                    |
| A3            | The phone's bottom tabs and header row      | Fifth tab (2.2)                   |
| A4            | Prep's section bar                          | Already decided by T (Titled)     |
| A5, A6        | Search and the rules reference              | Scoped field (2.3), rule 3.5      |
| A7            | The theme switch                            | Rule 3.3                          |
| A8, A9, A11   | Reconnecting, toasts, roll calls            | Corner (2.4), rules 3.10 and 3.11 |
| A10           | Confirm and prompt dialogs                  | Rule 3.6                          |
| A12, A13, A14 | Not found, a crash, loading                 | Rules 3.7, 3.8, 3.9               |

## 2. The decisions

### 2.1 The laptop top bar is One menu

- From the left: the wordmark, the sections as words with the horizon ink (GM: Play, Prep, Codex, Compendium; a player:
  Table, Sheet, Codex), then the live chip, a flexible gap, the search icon and the menu button.
- The live chip shows while an encounter runs: a lamp, the encounter's name and the round on the VCR counter (`R03`).
  For a player it adds "Your turn" in amber when it is theirs, and its lamp turns amber. It is a control on a Base line,
  and it takes you to the table.
- On the GM's Play page the chip is the encounter picker: it carries a chevron and opens today's picker. With nothing
  live, Play shows a chip with an unlit lamp and "No encounter live" that opens the picker. Elsewhere, with nothing
  live, there is no chip.
- The menu button is your face on a Base line: the character's portrait for a player, the violet GM mark for the GM. The
  GM's button also shows how many players are online, in VT323 beside the mark; a player connecting lights the number as
  today's faces light (ADR-0045, group 14).
- The menu opens under the button, its top edge on the horizon:
  - GM: who you are, Who is here (the online faces and "3 of 3"), Table screen (its lamp and ON or OFF; choosing it
    opens its actions in place: Pause the table screen or Show the live encounter, Preview it here, Table screen
    settings), Theme (Dusk and Dawn as a segmented control), Settings, Sign out.
  - Player: who you are and what you play, Release {name} (when one character is claimed; with more, the sheet's menu
    releases each), Theme, Settings, Leave the table.
- The table screen lamp, the presence faces, the theme switch and the settings icon leave the bar.

### 2.2 On a phone, More is the fifth tab

- There is no top bar on a phone. Each page's header row is its first row: a title and at most two icons (T rule 12).
  The icons belong to the page: its search and its primary.
- The bottom tabs: GM Play, Prep, Codex, Compendium, More; a player Table, Sheet, Codex, Log, More. Five tabs at 390 px
  are 78 px each, with the icon over the word.
- More opens a sheet above the tabs (the tabs stay in view and More stays lit): who you are, Search, then the laptop
  menu's rows in the same order.
- Headers by page: a section with pages uses the Titled bar's phone header (T 2.1). Play and the player's Table show the
  encounter's name and round; the GM's title opens the picker. A record shows Back and where it goes, with its own
  icons, and its title opens the content (T rule 12, amended by ADR-0073); the sheet shows the character's name and hit
  points. The wordmark does not appear on a phone page; arrival keeps it.
- While an encounter runs, the Play or Table tab carries a lit lamp, amber on the player's turn (rule 3.2).

### 2.3 Search is a Scoped field

- Ctrl K, the search icon on a laptop and Search in More open one dialog: a field, and under it a segmented control of
  where to look: Codex, Compendium (GM only), Rules, Go to.
- It starts on the section you are in: the Codex from the Codex; the Compendium from the Compendium, Prep and Play (the
  GM); Rules from the Table and the Sheet (a player); Go to everywhere else. Tab moves to the next place; arrows move
  through results and Enter opens one.
- Each place uses that section's own search and its own authorization, so a player sees exactly what the Codex shows
  them today. Go to lists the sections and pages and filters them as you type.
- Results are rows on 1 px `--line` dividers: an icon, the name with the typed part in `--cyan-hi`, and a line of what
  it is. The row you would open has a cyan tint and a 2 px cyan edge at its left.
- On a laptop the dialog sits at the top centre, 600 px wide; on a phone it fills the screen with Cancel in the field.
- A section's own search field in its bar opens the same dialog, already looking there.

### 2.4 News stays in the Corner

- A toast rises in the bottom right on a laptop (420 px wide, 16 px in) and above the bottom tabs on a phone (8 px in
  from each side). Its top edge is the horizon, as an overlay's is.
- Reconnecting is a band under the top bar on a laptop. A phone has no top bar, so there it is the first row, above the
  page's header (rule 3.11).
- A roll call away from the table is a band in the same place (rule 3.10).

## 3. Rules for the frame

1. The same frame on every page. On a laptop the top bar is the same on every page for each role, and the section bar is
   the only bar under it. On a phone the bottom tabs never change and the header row belongs to the page.
2. The live lamp. While an encounter runs, the Play or Table tab on a phone and the live chip on a laptop carry a lit
   cyan lamp, amber on the player's turn.
3. The theme switch leaves the top bar. The menu, More, Settings and Device, and the landing page keep it.
4. One Ctrl K. It opens the same search on every page (2.3). Sections no longer take the key for their own search.
5. The rules reference opens from search's Rules and from the Compendium: a drawer on the right on a laptop, a sheet
   from the bottom on a phone, its title on the horizon edge. On a laptop the page behind it stays usable.
6. Confirm and prompt dialogs follow the Dialog pattern: the question as the title on the horizon edge, one sentence,
   Cancel as a ghost, and the action at the right: the Cup, or a danger Base line for deleting or releasing. A sheet
   from the bottom on a phone.
7. Not found is T rule 3's empty state: one line where the page would be ("Nothing lives at this address.") and one
   secondary button, Go to the table, under the frame you came from. A record that has gone keeps today's notice over
   the list it fell back to.
8. Something broke: the arrival's sunset with one card: the eyebrow SOMETHING BROKE, the title, the error message in a
   box with Copy, and Reload as the primary. Nothing else on screen.
9. Loading: the frame and the section bar draw at once, and the page fills in. After 400 ms with nothing, one line in
   `--text-muted` says what is loading ("Loading the Codex"). No spinner and nothing that loops.
10. A roll call away from the table is an amber band: the ROLL tag, what the GM asks for, and the roll as its button
    (the name and the bonus in VT323 on a 2 px amber base). It stays until rolled. On the table it belongs to the panel
    (area C).
11. Reconnecting keeps its words and its amber WAIT tag. Nothing moves while it waits; when the table answers, light
    runs along its line once and it says "Back at the table" for two seconds.

## 4. Values

| Part                | Value                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Top bar (laptop)    | 56 px, glass, the horizon along its bottom edge; wordmark, sections 15 px Bai Jamjuree 600                                   |
| Live chip           | 36 px face in a 44 px hit area, Base line; lamp 8 px; name 13 px 600; round VT323 17 px `--cyan-hi`                          |
| Menu button         | Face 32 px (GM mark violet, Chakra Petch 12 px), online count VT323 18 px `--text-dim`, chevron; open keeps a 2 px cyan base |
| Menu                | 310 px, 10 px from the right, 4 px under the bar; rows 48 px on 1 px `--line`; who row 14 px padding                         |
| Phone header row    | 48 px, title Chakra Petch 600 capitals 18 px, two 44 px icons                                                                |
| Phone bottom tabs   | 64 px, five equal tabs, icon 20 px over the word 12 px, the ink on top                                                       |
| More sheet          | From the bottom, above the tabs; rows 52 px; a 40 by 4 px grab handle                                                        |
| Search dialog       | 600 px at 84 px from the top (laptop); field 50 px, 17 px text; scopes 6 px apart on Base lines; rows at least 50 px         |
| Toast               | 420 by at least 52 px, 16 px from the bottom right; phone 74 px from the bottom                                              |
| Bands under the bar | At least 48 px; roll call tinted `--caution` at 9 %                                                                          |
