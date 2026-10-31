# I Settings: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds Settings as a side list of its sections with the search at its top,
draws its rows to the theme, groups the encounter rules by moment, and redraws Access. It adds no settings, rules,
commands, routes on the server or data. File paths and line numbers were read at `f5e166f`; the theme (T) and the frame
(A) land on the same branch first or alongside, so confirm every anchor before editing. Paths are under
`apps/client/src/` unless they start with `apps/`, `packages/`, `e2e/` or `docs/`.

This is area I in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in six phases, I0 to I5, each
  about one commit.
- The reference is `settings.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else
  is inline). It opens on the approved choices. Use the Page switch (Opening Settings, Searching, Device, Characters,
  Encounters, Access, A new credential). The other options in the four decision switches are the ones the owner turned
  down; build only the chosen ones. On a phone the page has its own bar and a Close up, Whole and Turned laptop view.
  `history/` holds round 1 as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its credentials, characters
  and QR code are stand-ins. Build with the existing components, hooks and primitives. Section 8 lists where the plan
  departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top, and `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. Settings is a side list: the sections at the left, each with a line of what it holds now, the search at the top of
   the list, and the section at the right. On a phone the list is the first page and a section opens with Back.
2. A setting stays a row with its name and line at the left and its control at the right, drawn to the theme.
3. Encounters keeps its eight rows, grouped by moment: when a token is staged, when dice are rolled, on a player's turn,
   when a hit lands.
4. Access keeps its rows and the credentials' table; New credential keeps its dialog.
5. Nine rules for settings (`SPEC.md` section 3), starting with keeping every setting and its words.

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin (one surveyed for this plan was 26 commits behind), so pull before reading any anchor.
- I builds on T and A. T1 to T3 (the Base line, `Group`, the Titled section bar and the phone header) and A1 and A3 (the
  menu with Settings in it, the phone frame without a top bar) must be on the branch before I1. If they are not, stop at
  the phase that needs them and tell the user.
- CLAUDE.md applies in full. Every setting keeps its command and payload (`settings/table-writes.ts` 19 to 39 and the
  sections' sends), its name and line (`settings/sections.ts`), and its words shared with the encounter's own options
  (`settings/table-words.ts`, `encounter/FightMenu.tsx`). No server code, shared domain, schema, command or HTTP route
  changes. A player's tree mounts only `sectionsFor("player")`. If a step seems to need a server change, stop and tell
  the user.
- ADR-0036 chose sections in a bar for Settings and turned down a left rail; ADR-0057 reverses that for Settings only.
  Other pages keep their section bars (`docs/DESIGN.md` 402 to 406).
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area. `design-conventions.test.ts` asks for
  media widths on the ladder (258 to 276), `.scroll-y` scrollers (331) and no message state (229 to 252).
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the pages as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

Paths in this section are under `apps/client/src/settings/` unless they say otherwise.

### 3.1 The page

- `SettingsPage.tsx` (270 lines): `SECTION_ICONS` (48 to 55), `gmViewOrNull` (63 to 69), the props (71 to 95), the phone
  query at 760 px (97), the section from the route or `homeSection(role)` (99 to 104), the leave confirm "Leave the
  table?" (110 to 122), the search's focus and `is-flashing` for 1300 ms (125 to 140), `pick` (136 to 140), `go` (141),
  `keepChosenInView` (143 to 149), the search element (151), the body (153 to 183, with the API's
  `SettingsSection id="api" gmOnly wide` and `ApiReference` 172 to 182), the player's page `settings cx-shell is-single`
  (186 to 192), and the GM's page (194 to 269): the phone header `cx-phonebar settings-phonebar` with "Settings", the
  primary slot and "Search settings" or "Close the search" (197 to 217); the laptop bar `cx-bar settings-bar` with the
  nav "Settings sections", `nh-tab` buttons with `aria-current="page"`, `StripInk`, the search and
  `settings-primary-slot` (219 to 238); the phone tab bar `cx-tabbar settings-tabbar` (240 to 256); the content
  `settings-content scroll-y` (or `is-frame` for the API) keyed by section (259 to 265). The bar's CSS is
  `codex/shell/shell.css` (`.cx-bar` 39, `.cx-phonebar` 101 to 126, `.cx-tabbar` 155 to 199).
- `sections.ts` (260 lines): `SETTINGS_SECTIONS` (21 to 38), `sectionsFor` (40 to 42), `homeSection` (45),
  `isSettingsSection` (47 to 48), `pathForSection` (50), `SETTING` (68 to 232), `settingsFor` (235 to 244),
  `searchSettings` (247 to 257), `settingAnchor` (260).
- `SettingRow.tsx` (75 lines): `PrimarySlot` (10) and `SettingsPrimary` (12 to 15, a portal), `SettingsSection` (21 to
  41: `section.settings-section--{id}`, the head with `h2#settings-{id}-title`, `GmOnlyTag` when `gmOnly`, the hint,
  `div.settings-panel` with `rim-gm`), `SettingRow` (48 to 75: `div#setting-{id}.setting-row(.is-stacked)`,
  `h3.setting- label` with its tag, `p.setting-hint`, `div.setting-control`). `GmOnlyTag` is
  `packages/ui/src/primitives/Reveal.tsx` 99 to 105.
- `SettingsSearch.tsx` (129 lines): `searchSettings` sliced to 8 (32), Ctrl or Meta K (34 to 44), the combobox "Search
  settings" with `aria-keyshortcuts` (63 to 98), the listbox "Matching settings" with `settings-search-option` rows, the
  empty `No setting matches "{q}".` `shell/SearchLauncher.tsx:7` stands the shell's Ctrl K down on Settings.
- CSS `settings.css` (385 lines): content 5 to 31, the slot 33 to 35, the phone tab bar 38 to 47, the phone bar's parts
  49 to 57, search 59 to 132, section and panel 134 to 171, rows 173 to 226, notes and sub panels 228 to 281, tables and
  lists 283 to 347, password 349 to 369, phone at 650 px 371 to 385.
- Routes (`router.ts`): `GM_TAB_PATHS.settings` (148), `/setup` to `/settings` (162), `litGmSection` null for Settings
  (247 to 254), `isGmOnlyPath` (289 to 290), `isKnownPath` (319 to 324). Mounted in `shell/GmShell.tsx` 246 to 259 and
  `shell/PlayerShell.tsx` 56 to 63; A1 moves the way in from the bar's gear (`shell/AppBar.tsx` 201 to 207) into the
  menu.

### 3.2 The sections

- `PlayersSection.tsx` (in `SettingsSection id="players" gmOnly`, 70): Join address with `components/JoinAddress.tsx`
  ("Players join at", Copy, "Show QR code" or "Hide QR code" 134, `QrCode` 142), What players see of each other (a
  `Select`, `table:set-party-visibility`, `PARTY_VISIBILITY_HELP` 31 to 36), At the table (the empty line, a list on a
  phone at 650 px, the table Character, Player, Actions with Force release and Set token image…, "Preview the table
  screen"; 96 to 175).
- `FightsSection.tsx` (55): the eight rows in today's order: Rules assistant (the dial, `settings-dial-help`, the group
  "What it checks" with six switches, 56 to 91), Players' hits (93 to 106), Players' initiative (108 to 121), Players'
  d20 rolls (123 to 133), Players' damage (135 to 145), Who picks targets (147 to 157), Health display (159 to 193), New
  tokens (195 to 210).
- `CharactersSection.tsx` (34): Who builds characters, Max party level (`Stepper`), Ability scores (the group "Ability
  score methods", the custom formula and Save formula, the guard toast 26 to 29), Hit point rolls, Random characters.
- `DeviceSection.tsx` (25, not GM only): Theme (`ThemeToggle`), Reduce transparency, How you roll (or the table's line
  `tableDiceLine`), Pinch zoom, Arrange new encounters (GM, with its tag), Leave table (player). Local stores, not
  commands (`preferences.ts`, `dice/roll-preference.ts`).
- `AccessSection.tsx` (27): New credential in `SettingsPrimary` (28 to 32), GM password with `ChangePasswordDialog` (61
  to 145), Sign out, Sign out every GM browser (destructive), Integration credentials with `CredentialsTable`.
- `integrations/CredentialsTable.tsx`: the empty state (149 to 157), the phone list at 650 px (159 to 171), the table
  `settings-table credentials-table` Name, Scopes, State, Last used, Expires, Actions (173 to 204) with Rotate, Revoke
  and History (133 to 141), the confirms (70 to 102), History (219 to 262), `NewCredentialDialog` (269 to 360: Name,
  "What it may reach" with `.credentials-scope-grid`, Expires, Cancel, Create credential), `SecretDialog` (363 to 405).
- Writes: `table-writes.ts` `send` (19 to 39) toasts on a failure only; there is no optimistic state, so a control shows
  what the state holds.

### 3.3 What the section lines can read

- `table-words.ts`: `dialLabel` (9 to 14), `PLAYER_HITS` (19 to 25), `PLAYER_INITIATIVE` (28 to 34), `DICE_MODE_PHRASE`
  (43 to 47), `optionLabel` (72 to 75). `encounter/FightMenu.tsx` 215, 238 and 261 already build lines like "Rules
  assistant: Enforce."; `dice/roll-preference.ts` 112 to 117 `tableDiceLine`.
- The GM's state (`packages/domain/src/state.ts`): `builderPolicy` (2457), `rulesPolicy` (2459), `playerDice` (2462),
  `targeting` (2464), `stagingDefaults` (2466), `partyVisibility` (2468), `combat.playerDamageMode` (1946),
  `playerInitiativeMode` (1949), `healthDisplay` (1952); claimed characters from `state.actors`.
- `PARTY_VISIBILITY_OPTIONS` (`PlayersSection.tsx` 19 to 24) and `ABILITY_METHODS` (`CharactersSection.tsx` 8 to 13)
  hold the labels; neither has a summary.

### 3.4 Tests that pin it

- `settings-page.test.tsx` (laptop only): the nav "Settings sections" and its buttons, Players current, h2 "Players",
  Encounters at `/settings/fights` with h3 "Rules assistant" (47 to 59); every setting's h3 and hint (61 to 74); "GM
  only" in the Encounters heading and the Arrange row, not in Device's (76 to 84); one `.nh-btn--primary` "New
  credential" inside `.settings-bar` (86 to 93); the search (95 to 117); At the table (119 to 143); Characters (145 to
  161); New tokens (163 to 170); Access (172 to 182); the player's page (196 to 233).
- `settings-groups.test.ts` (9 to 67), `table-settings.test.tsx` (42 to 136), `integrations/credentials-table.test.tsx`
  (56 to 136), `encounter/held-dice.test.tsx` 209 to 219, `play-vocabulary.test.ts` 241 to 257 (the dial's words and the
  section labels), `router.test.ts` (119, 127, 290, 302 to 309, 319 to 320, 337, 353 to 354, 362 to 369, 625, 662),
  `shell/app-bar.test.tsx` 81 and 134.
- e2e: `e2e/smoke.ts` 247 to 263 (`openGmSection(page, "Settings")`), `journeys.spec.ts` 251 to 256 (Device's pinch zoom
  switch and heading) and 1043 to 1044 (the section strip's ink on Settings).

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part                 | New or changed                                 | Built from                                                   |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| The title row        | Changed: T's title row, the primary as the Cup | `SettingsPage`, `PrimarySlot`                                |
| The side list        | New, replaces the bar and the phone tab bar    | `SETTINGS_SECTIONS`, `SECTION_ICONS`                         |
| The section lines    | New                                            | `sectionLine(id, state)` from `table-words.ts` and the state |
| Search in the list   | Changed: results fill the list                 | `SettingsSearch`, `searchSettings`                           |
| Rows and groups      | Restyled to T's Group                          | `SettingsSection`, `SettingRow`, `settings.css`              |
| Encounters by moment | Changed order, four headings                   | `FightsSection`                                              |
| Access               | Restyled                                       | `AccessSection`, `CredentialsTable`                          |

How the parts fit, so the phases agree:

- The address still names the section: `/settings/<section>` and `/settings/api/<operation>`. On a laptop `/settings`
  opens the role's first section, as today. On a phone (760 px and under) `/settings` shows the list of sections and a
  section's address shows that section with Back to `/settings`. A player keeps Device alone with no list.
- The list is a `nav` named "Settings sections" with one link per section (`aria-current="page"` on the one shown), its
  icon, its name and its line. The search field sits at the top of the list; while it holds text the links give way to
  the listbox "Matching settings" in the same place, and choosing works as today (`pick`, the row lit). Escape or an
  empty field brings the links back. Ctrl K stays.
- `sectionLine(id, gm, extras)` in a new `sectionLines.ts`, one line per section from the GM's state, joined with " · "
  and written with today's option words: Players "Join address · {party visibility} · {N} at the table"; Encounters
  "{dial} · {N} checks · hits {applied by the GM or applied immediately}"; Characters "{Players build or Only you build}
  · level {max} · {N} methods"; Device "{Dusk or Dawn} · {auto-roll or you roll} · pinch zoom {on or off}"; Access "{N}
  credentials active", from the credentials list Access already reads (fetch it once when the page opens); API a fixed
  line, "Every operation, with examples". Counts up to ten are words ("six checks"), as in the mockup.
- Each section's heading is its name and line in T's title style, without the GM ONLY tag on GM sections (rule 3.3).
  `GmOnlyTag` stays on Device's Arrange new encounters row.
- A table setting's row shows "Saved" for 1.5 s after its command succeeds (a small `useSavedFlash(id)` beside
  `useTableWrites`); a failure keeps today's toast, and the control shows the state as it is. Device's local choices
  apply at once with no flash.
- Encounters' groups are headings (`h3.settings-moment`) over T's Groups; the rows under them take `h4` labels (a
  `level` prop on `SettingRow`, default 3), and their order inside a group is `SPEC.md` 2.3's.

## 5. Phases

### I0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `I-settings/`, and leave the
   other pieces' folders as the zip has them.
2. Add `I-settings/ADR-0057-settings.md` as `docs/adr/0057-settings.md`, Accepted, and its row to `docs/adr/README.md`.
   Note on the row of 0036 that its section bar for Settings is reversed by 0057. Leave any missing earlier numbers
   free; do not renumber.
3. Run the full checks and record any failure that was already there.

### I1: the title row, the side list and its lines

1. `SettingsPage` on a laptop: T's title row with "Settings" and the primary slot at its right (New credential and
   Download OpenAPI land there as the Cup through `SettingsPrimary`, unchanged). Remove `settings-bar`, its `nh-tab`
   buttons and `StripInk`.
2. A new `SettingsList.tsx`: the 290 px list (`SPEC.md` 4) with `SettingsSearch` at its top and the section links with
   their icons, names and lines; the shown section lit. The content takes the rest, its column 880 px beside the list (T
   rule 11).
3. `sectionLines.ts` (section 4) with its own tests; the list re-renders its lines as the state changes.
4. Search in the list (section 4); `SettingsSearch` gets a `variant="list"` that draws its results in place of the links
   instead of a popover. The flash on the picked row stays.
5. Section headings without the GM ONLY tag on GM sections.
6. Tests: `settings-page.test.tsx` 47 to 59 (the nav keeps its name and the sections as links with `aria-current`), 76
   to 84 (the Encounters heading has no "GM only"; the Arrange row keeps it), 86 to 93 (the primary is in the title row;
   read it by role, not `.settings-bar`), 95 to 117 (the search's results show in the list); a new
   `section-lines.test.ts` (each line from a fixture state, counts as words, the hits words); `journeys.spec.ts` 1043 to
   1044 (Settings has no strip ink now; check the lit link instead).

### I2: the phone

1. At 760 px and under, `/settings` shows the list full screen under A3's header "Settings" with the search icon; the
   search is a field over the list. A section shows under a header with Back and its name, and New credential as the
   header's icon on Access. Remove `settings-tabbar`, `keepChosenInView` and their CSS.
2. `router.ts`: `/settings` stays known; nothing else changes. The player's page stays as it is.
3. Tests: a phone case in `settings-page.test.tsx` (`/settings` lists the six sections with their lines; a link opens
   its section with Back; Back returns to the list); `journeys.spec.ts` 251 to 256 goes straight to `/settings/device`
   and holds; `e2e/smoke.ts` `openGmSection` opens a section through the list on a phone.

### I3: rows, groups and Players

1. `SettingsSection` and `SettingRow` drawn as T's Group and rows (`SPEC.md` 2.2 and 4): the name, its line, the control
   at the right or under for `stacked`, the control's own line under it. The `rim-gm` edge goes.
2. On a phone a `SegmentedControl` whose choices do not fit one line shows them as a list of choices (an
   `orientation="auto"` on the control in `packages/ui`, or a wrapper in Settings if the primitive should not change;
   check its other users first).
3. `useSavedFlash` and "Saved" on table settings (section 4).
4. Players: `JoinAddress` in Settings shows the QR code beside the address on a laptop (a `settings` variant), with Copy
   and "Show it larger", which opens the code at 320 px in a dialog; a phone keeps Show QR code and Hide QR code. At the
   table keeps its table and its phone list.
5. Tests: `settings-page.test.tsx` 61 to 74 (labels and hints hold), 119 to 143; a test for the Saved flash after a
   command and none after a failure; `JoinAddress`'s own test for the variant.

### I4: Encounters by moment

1. `FightsSection` in four groups with their headings (`SPEC.md` 2.3): When a token is staged (New tokens, Health
   display), When dice are rolled (Players' initiative, Players' d20 rolls, Players' damage), On a player's turn (Rules
   assistant with its dial, its line and What it checks; Who picks targets), When a hit lands (Players' hits). Every
   control, line and command stays.
2. Tests: `table-settings.test.tsx` holds (its names and payloads do not change); `settings-page.test.tsx` 61 to 74
   reads the labels at any heading level; a test for the group order.

### I5: Access, docs and cleanup

1. Access: the three rows, then Integration credentials with `CredentialsTable` drawn to the theme (scopes as VT323
   tags, State as T's tags, Revoke red, a revoked row dimmed). `NewCredentialDialog` keeps its fields with the scopes in
   two columns; on a phone it opens full screen with Cancel and Create credential pinned at its foot.
2. `docs/DESIGN.md`: the page patterns (402 to 406: Settings is a side list; other pages keep their bars), 173 to 176
   and 188 (how Settings opens, from the menu), 447 to 448 (`GmOnlyTag` only where players could see the section).
3. `docs/ARCHITECTURE.md`: 1176 to 1185 (the side list, its lines and search), 1208 to 1210 (`StripInk` no longer on
   Settings).
4. `docs/adr/README.md`: 0057 Accepted and built. `docs/design/polish/CATALOG.md`: I moves to Built.
5. Remove what nothing uses: the settings bar's and tab bar's CSS, `settings-panel.rim-gm`, the search popover's styles
   if the list variant replaced them.
6. Tests: `integrations/credentials-table.test.tsx` holds (its column names and dialogs do not change).

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With three characters claimed and two credentials (one revoked), look in Dusk and Dawn at:
  - 1280 by 800 with a mouse, as the GM: the list and each section's line (change a setting and watch its line change),
    searching "roll" and picking a result, Players with the QR code and Show it larger, Encounters in its four groups,
    Characters, Device, Access with the table, New credential and its secret, the API reference in the new frame.
  - 390 by 844 with touch, as the GM: the list first, a section with Back, the search over the list, long option sets as
    lists, New credential full screen; every control at least 44 px; no sideways scroll.
  - As a player at both sizes: Device alone, Leave the table.
- With reduced motion and reduced transparency.
- Every behaviour in section 3 still reachable: every setting's write, the guard toast, Change GM password, Sign out,
  Sign out every GM browser, Rotate, Revoke and History, Preview the table screen, Force release, Set token image.

## 7. Left as they are, for later rounds

- The API reference and an operation's page (`integrations/ApiReference.tsx`, `OperationDocument.tsx`), Players' At the
  table actions, and a credential's History. They take the frame now and their own designs later.
- Every setting, command, projection, HTTP route and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's API line says "405 operations"; the app uses a fixed line rather than loading the reference to count.
- The mockup's search results show seven settings with "roll"; the app keeps today's limit of eight and today's ranking.
- The mockup draws the GM ONLY tag only on Device's row and the QR code as a stand-in; the app uses `GmOnlyTag` and
  `QrCode`.
- The mockup does not draw the Saved flash, the empty credentials, Change GM password's dialog, the secret, Show it
  larger, or the phone's pinned search; sections 4 and 5 place them.
- The mockup's characters, credentials and counts are stand-ins.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `settings.html`.

- `p4j-set.css`: the side list (`.i-split`, `.i-rail`, `.i-ri`, `.i-ri.on`, `.i-rres`), a section's head (`.i-head`),
  groups and rows (`.i-grp`, `.i-row`, `.i-row.stack`, `.i-txt`, `.i-ctl`, `.i-note`), the group headings (`.i-rhead`),
  the join address and QR code (`.i-join`, `.i-url`, `.i-qr`), the table's characters (`.i-tbl`, `.i-trow`), the
  credentials' table (`.i-table`, `.i-scopes`), the dialog (`.i-dlg`, `.i-lab`, `.i-fs`, `.i-swl`, `.i-dfoot`) and the
  phone sheet (`.i-sheet`). The other options' parts sit beside them.
- `p6-head.js`: the data (`SECS`, `SUM`, `ROWS`, `CHECKS`, `AT_TABLE`), the controls (`sw()`, `seg()`, `sel()`,
  `step()`), and the frames (`lapFrame()` and `phFrame()`, the `rail` branch, with `railList()`).
- `p6-body.js`: `rowsOf()` (the `row` branch), `homePage()`, `searchPage()`, `fightsBody()` (the `moment` branch),
  `accessBody()` and `cred()` (the `rows` branch).
- `p6-dec.js`: the decisions and the rules. `p2b-mobile.css` and `p6-tail.js`: the mockup page's own phone bar and
  laptop view; mockup code only.
- `audit-i.js`: the "Today" screenshots.
