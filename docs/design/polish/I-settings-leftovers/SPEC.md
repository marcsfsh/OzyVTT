# I Settings' leftovers

Approved by the owner on 2026-10-30 after one round of mockups. The API reference and an operation's page (I7), the
commands, a player's actions in Players' At the table (I2), and a credential's history (I6) in `../CATALOG.md`. They sit
inside Settings' frame (`../I-settings/SPEC.md`) and inherit the theme (`../T-theme/SPEC.md`), the frame
(`../A-frame/SPEC.md`) and the settled side list (`../E2-maps-tokens/SPEC.md` 2.1, `../G-compendium-pages/SPEC.md` 2.1).
`PLAN.md` beside this file is the work to build it; `settings-leftovers.html` is the approved mockup, and `history/`
holds the round as it was shown. The owner asked that Settings' own side list match the side lists already settled
elsewhere; 2.6 redraws it, amending I 2.1 and F's time and tools 2.6.

The consistency sweep (`../T-consistency/SPEC.md`, ADR-0072) put the crumbs of an operation's page and a credential's
page on their titles' line (2.2, 2.5), drew search results as the side list's rows, and gave New credential's sheet its
handle.

The second sweep (`../T-consistency/SPEC.md` section 5, ADR-0073) made New credential words only and gave the API
reference's field its search icon and a muted placeholder.

The third sweep (`../T-consistency/SPEC.md` section 6, ADR-0074) drew its groups as Cradles, Release and Revoke in
`--danger-text` on their Base lines, Token image as a Base line button, a credential's history in Bai Jamjuree ("Oct 30,
6:05 PM"), GET and POST in the dim text colour, and its ticks and column as I's.

The fourth sweep (`../T-consistency/SPEC.md` section 7, ADR-0075) drew Settings' list's Token image on its Base line and
Release in `--danger-text` (T 2.5), kept the credentials' dates on one line, and set a credential's history title at 20
px on a phone and the sheets' titles at 20 px (T 2.2).

The fifth sweep (`../T-consistency/SPEC.md` section 8, ADR-0076) drew GET and POST as VT323 tags (T rule 7), the bar's
search at 38 px, the fields at 44 px on a phone (T 2.5) and an operation's title at 20 px on a phone (T 2.2), and gave
Dawn's amber, magenta and violet words their text shades (T rule 9).

## 1. What it covers

| Id  | Surface                          | Decided here                                        |
| --- | -------------------------------- | --------------------------------------------------- |
| I7  | The API reference                | Each tag a group of Settings' rows (2.1)            |
| I7  | An operation's page              | The request and the response side by side (2.2)     |
| I7  | The commands                     | Each row names its command (2.3)                    |
| I2  | At the table: a player's actions | Token image and Release as buttons on the row (2.4) |
| I6  | A credential's history           | A credential's own page (2.5)                       |
| I1  | Settings' side list              | The settled side list (2.6)                         |

## 2. The decisions

### 2.1 The API reference groups each tag as Settings' rows

- The API section keeps I's head ("API", its line) and Download OpenAPI as the Cup. Under it, one field: "Find a path, a
  summary or a command".
- Each tag is a group under its eyebrow with its count in VT323 (ACTORS 46), and each operation is one of Settings' rows
  (I 2.2): its method as a tag and its summary, its path in VT323 under them; at the right, its command (2.3), who can
  call it, and the arrow that opens its page.
- Today's Tags, Filters and Sort stay as the field's own menu (More at its end), with today's words.
- On a phone: the field, then the groups, each row stacked (method and summary, path, command).

### 2.2 An operation's page puts the request and the response side by side

- All operations as its crumb on the title's line, then the summary in display capitals, the method and the path with
  Copy, then one line of what it does.
- Two columns: REQUEST (each field with its type, required, and notes on hover or press) with the example request under
  it; RESPONSE · 200 (its fields) with the example response. Other responses (400, 401, 403, 409) follow under the
  response as rows.
- Who can call it and the operation's id sit in its line under the title.
- On a phone, Request and Response · 200 are a Base line control over one column.

### 2.3 Each row names its command

- An operation the live-game socket also takes says so at the right of its row: "As a command" and its type in VT323
  (actor.add). One it doesn't take says "No command".
- Today's separate Commands table goes; the field finds a command by its type. An operation's page names its command in
  its line.
- On a phone the command is the row's last line.

### 2.4 At the table: Token image and Release as buttons on the row

- Each claimed character's row in At the table keeps its face, its name and class, and whether its player is connected,
  then Token image and Release as Base line buttons at its right.
- Release keeps today's confirm (Force release) and its words. Token image opens the token picker (E2 2.5).
- On a phone the two buttons are icons of 44 px with their names as labels for screen readers.

### 2.5 A credential opens as its own page

- In Access, a credential's name opens its page; History on the row goes. The row keeps Rotate and Revoke.
- The page: Access as its crumb on the title's line, then the name in display capitals, one line (state, scopes,
  created, expires); then Rotate and Revoke as Settings' rows; then HISTORY · {N}: each event a row with what happened
  (Created, Used, Refused a wrong secret in amber, Rotated, Revoked), its detail, and when in VT323.
- Rotate shows the new secret once, as today; the history never shows a secret.
- On a phone the page is the same, rows stacked.

### 2.6 Settings' side list is the settled side list

- The list keeps the search at its top ("Search settings", Ctrl K). Under it, SECTIONS: each section a row with its
  icon, its name and a count where one helps (Players 3 at the table, Encounters 6 checks, Access 2 credentials, API
  405), the chosen lit with the cyan edge, as E2's folders and G's sources are. Then CODEX (F's time and tools 2.6):
  Backup, Restore, Bring in notes, Autosave (On), Version history (12).
- I 2.1's line of what each section holds now moves to the section's own head, under its title.
- On a phone, Settings' first page is the same list, rows 48 px.

## 3. Rules for Settings' leftovers

1. The reference reads the server. It keeps reading the OpenAPI document and the command catalog live, so it can't
   drift.
2. Download OpenAPI stays the API section's Cup.
3. Release asks first, with today's confirm.
4. A secret is shown once. Rotate shows the new secret once; the history never shows one.
5. One side list. Settings' list is drawn as every other side list (2.6).
6. Nothing new in what the controls do. Every route, command, release, token image and credential action keeps today's
   words.
7. Phones: rows stack, the operation's two sides become a control, buttons keep 44 px.

## 4. Values

| Part           | Value                                                     |
| -------------- | --------------------------------------------------------- |
| Settings' list | 290 px; rows 38 px (48 px on a phone); counts VT323 16 px |
| Operation rows | Settings' rows, at least 64 px; the path VT323 15 px      |
| Method tag     | At least 46 px wide; VT323 16 px in a 22 px box           |
| The two sides  | Two equal columns, 20 px apart                            |
| History rows   | At least 52 px; when VT323 16 px; a refusal in amber      |
