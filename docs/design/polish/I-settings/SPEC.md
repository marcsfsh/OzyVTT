# I. Settings

Approved by the owner on 2026-10-29 after one round of mockups. Area I in `../CATALOG.md` is setting the table up once
and changing it rarely. It inherits the theme (`../T-theme/SPEC.md`) and the frame (`../A-frame/SPEC.md`), which put
Settings in the GM's menu and the player's menu. `PLAN.md` beside this file is the work to build it; `settings.html` is
the approved mockup, and `history/` holds round 1 as it was shown.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) drew the side list and its search results as the settled
side list (as `../I-settings-leftovers/SPEC.md` 2.6 says) and gave New credential's sheet its handle.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) made New credential words only.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew Settings' groups as Cradles with the players' rows
inside their group (T 2.4), danger in `--danger-text` on its Base line, Rotate and History as Base line buttons, a
player's More as its dots, the scopes, the ability score methods and the assistant's checks as ticks, the last use as
"Today, 8:41 PM", and the column at 880 px.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) kept the credentials' dates on one line, drew Rotate,
Revoke and History at 36 px and 6 px apart (T 2.5), the steppers, the scopes and the switch rows at 44 px on a phone,
and New credential's title at 20 px (T 2.2).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew a dialog's close as the one close, a plain 18 px
icon in 40 px, 44 px on a phone (T 2.2), the bar's search at 38 px and the fields at 44 px on a phone (T 2.5), and gave
Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id  | Surface                   | Decided here         |
| --- | ------------------------- | -------------------- |
| I1  | Settings frame and search | The side list (2.1)  |
| I2  | Players                   | Rows (2.2), rule 3.8 |
| I3  | Encounters                | By moment (2.3)      |
| I4  | Characters                | Rows (2.2)           |
| I5  | Device                    | Rows (2.2), rule 3.4 |
| I6  | Access and credentials    | Rows (2.4)           |

Left for later: the API reference and an operation's page (I7), Players' At the table actions, and a credential's
History. They take this frame now and follow the rules in section 3.

## 2. The decisions

### 2.1 Settings is a side list

Amended by ADR-0071 (`../I-settings-leftovers/SPEC.md` 2.6): the list is drawn as the settled side list, one row a
section with its icon and a count, and each section's line moves to its head.

- Settings is T's title row with "Settings" and, at its right, the section's own primary as the Cup (New credential on
  Access, Download OpenAPI on API). No section bar runs across the top.
- At the left, a list of the sections (290 px): the search field at its top ("Search settings" with Ctrl K), then each
  section as a row with its icon, its name and one line of what it holds now:
  - Players: "Join address · name and class · 3 at the table"
  - Encounters: "Enforce · six checks · hits applied by the GM"
  - Characters: "Players build · level 20 · four methods"
  - Device: "Dusk · auto-roll · pinch zoom off"
  - Access: "2 credentials active"
  - API: "Every operation, with examples" (a fixed line) The section shown is lit with a cyan edge at its left. The
    lines change as the settings change.
- The section at the right: its heading and its line, then its rows (2.2), in one column of 880 px beside the list.
- Searching: typing in the field turns the list into the matching settings, under their sections' eyebrows, each a row
  of the side list with the match marked; the first is lit. Choosing one opens its section with the row lit, as today.
  Escape or clearing the field brings the sections back.
- On a phone: Settings opens on the list (the header "Settings" with the search icon; the rows with their lines). A
  section opens full screen with Back and its name in the header, and Access's New credential as the header's icon. The
  search is a field over the list.
- A player's Settings stays Device alone with no list (rule 3.4).

### 2.2 A setting is a row with its control at the right

- T's Group holds a section's rows. Each row: the name (15 px), its line under it (13 px, dim), and the control at the
  right; a wide control (the join address, the table's characters, the ability methods, the rules assistant's checks)
  goes under the line. A line about the current choice sits under the control in quiet ink, as today.
- Rows are at least 64 px, 12 px 16 px, with a hairline between.
- On a phone the control goes under the line, and options too long for one line become a list of choices.

### 2.3 The encounter rules are grouped by moment

- Encounters keeps its eight rows and their words, in four groups with a heading each:
  - When a token is staged: New tokens, Health display.
  - When dice are rolled: Players' initiative, Players' d20 rolls, Players' damage.
  - On a player's turn: Rules assistant (with Enforce, Advise and Off, its line, and What it checks with its six
    switches), Who picks targets.
  - When a hit lands: Players' hits.
- The headings are small capitals over each group.

### 2.4 Access keeps its rows

- Access is two groups: the three rows (GM password with Change GM password; Sign out; Every GM browser with Sign out
  every GM browser in red), then Integration credentials with the table under its line: Name, Scopes (each as a small
  VT323 tag), State (Active in cyan, Revoked quiet), Last used, Expires, and Rotate, Revoke (red) and History. A revoked
  credential's row is dimmed.
- New credential is the Cup in the title row. Its dialog keeps today's fields: Name, What it may reach with the fourteen
  scopes as ticks in two columns, Expires, then Cancel and Create credential; the secret shows once after, as today.
- On a phone: the rows stacked, the credentials as rows with their state, last use, expiry and scopes, and New
  credential as a full screen sheet with Cancel and Create credential pinned at its foot.

## 3. Rules for settings

1. Settings keeps its sections and its words: Players, Encounters, Characters, Device, Access and API, with today's
   names, lines and choices, which the encounter's own options share (one setting, one name). No setting is added or
   removed.
2. A change saves when it is made, as today; the row shows Saved for a moment, and a failed write puts the choice back
   and says why.
3. GM only, where it helps: the GM's sections are never shown to a player, so their headings drop the GM ONLY tag. It
   stays on a GM row inside a section players see (Device's Arrange new encounters).
4. The player's Settings is Device alone, with no list, and Leave the table as its last row, as today. The frame's menu
   also holds Leave the table.
5. Search finds a setting by its name, its line and its other words, and a pick opens the section with the row lit, as
   today.
6. One kind of control for one kind of choice: two to four short choices are Base line options; on and off is a switch
   with its own label; a longer list is a menu; a number is a stepper.
7. Danger reads red and asks first: Sign out every GM browser and Revoke are red, and each asks before it acts, as
   today.
8. The join address is the first thing: Players leads, as today, because the join address is what the GM opens at every
   session. Its QR code shows beside the address on a laptop, and its button says Show it larger.
9. The API reference, Players' At the table actions and a credential's History take this frame now and their own design
   later.

## 4. Values

| Part                       | Value                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Side list                  | 290 px; 1 px `--line-strong` at its right; the search field 12 px 12 px 8 px                                                                 |
| A section in the list      | 52 px; 6 px 16 px; icon 18 px; name 14.5 px; its line 12 px muted, one line with an ellipsis; lit: cyan at 8% and a 3 px cyan edge           |
| A result in the list       | The same row with its section as the line and the match marked in cyan at 28%                                                                |
| The section                | Its heading 24 px display capitals and its line 13.5 px; the column 880 px, 18 px 28 px                                                      |
| Group                      | The Cradle (T 2.4): a 2 px `--line-raised` base, sides that fade before the open top, no fill; the players' table inside it on 1 px `--line` |
| Row                        | 64 px or more; 12 px 16 px; name 15 px; line 13 px dim; the control's line 12.5 px muted                                                     |
| Group heading (Encounters) | 11 px capitals, 0.12em, muted; 18 px over the group, 8 px under                                                                              |
| QR code                    | 112 px beside the address; the address VT323 26 px                                                                                           |
| Credentials' table         | Header 11 px capitals; rows 8 px 10 px with a hairline; scopes VT323 15 px in a 1 px tag                                                     |
| Phone                      | The list's rows 52 px; a section's column 12 px 14 px; New credential's foot pinned                                                          |
