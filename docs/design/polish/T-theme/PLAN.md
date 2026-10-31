# T The theme spec: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update U6: ADR-0046 and the handoff"). Light rail (phases 0 to 8) and the Horizon update (U1 to U6) are built on that branch. This plan changes the kit's secondary controls, adds a `Group` and an `EmptyState` primitive, gives every section the same bar and applies the spec's rules where the kit and the shells set them. It adds no rules, commands or data. File paths and line numbers were read at `f5e166f`; confirm them before editing.

This is the top of the polish hierarchy in `../CATALOG.md` (catalog id T). `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in eight phases, T0 to T7, each about one commit.
- The reference is `theme-spec.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else is inline). It opens on the approved choices: Titled, Records only, Mixed, Cradle and Base line. Its page switcher shows Settings, a Codex page, Encounters and a gallery of the box in six places. The other options in its switchers are the rounds the owner turned down; build only the chosen ones.
- The mockup is the reference for values, spacing and type. Its CSS and JS are mockup code. Build with the existing primitives and tokens and port the values. Section 8 lists where the plan departs from the mockup on purpose.
- This plan sets the shared parts and the rules where the kit and the shells own them. It does not redesign any page: each area (A to I in the catalog) gets its own round and plan, and those inherit what this one builds. Where a phase finds a page that breaks a rule and fixing it would redesign the page, section 7 leaves it to that page's area.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md` applies on top, and `apps/client/src/writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The section bar is Titled: the section's name, then its pages as words with the horizon ink, its search and its primary at the right end.
2. A page header is for records only. Lists and settings start with their content and at most one line of description.
3. Groups are Mixed: a group you act in is a box, a group you only read is open.
4. The box is the Cradle: a base and sides that fade before the top, no fill, the heading in the open top, the base lighting cyan while you work inside.
5. Secondary controls sit on a Base line: the label on a 1 px line that lights cyan on hover; a chosen option keeps a 2 px cyan line. Fields keep their box.
6. Twelve rules every area follows (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Another session commits design work on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- D1, the Ledger character sheet (`../D1-character-sheet/PLAN.md`), may be built on the same branch at the same time. Do not edit `apps/client/src/sheet/` while D1 is in progress; phase T7 does the sheet's part once D1's phase L7 is on the branch. If D1 has not started, T7 still waits for it, and D1's plan picks up `Group` and the Base line as it goes.
- CLAUDE.md applies in full. Nothing here touches the server, a projection, a command or stored data. Phones are first-class: check every phase at 390 px with touch.
- No server code, shared domain, schema, command or HTTP route changes. `npm run map` should not be needed; if it reports a change, something outside this plan moved.
- `apps/client/src/design-conventions.test.ts`: colours only from `packages/ui/src/styles/design-tokens.css` (check (d)); `@media` widths only from the ladder, min 561/651/761/850/980/1280 and max 560/650/760/849/979 (check (f)); scroll regions only through `.scroll-y` (check (h)); the display face always with uppercase (check (i)); one Eyebrow and no bare `eyebrow` class (check (c)); feedback through a toast (check (e)).
- The pane rule (`apps/client/src/styles.css`): no transform, filter, backdrop-filter, perspective, will-change or `contain: paint` on `.app-pane` or its one child. The Cradle's light is a `scaleX` on a pseudo-element of the group, which is allowed; never put it on the pane.
- `docs/DESIGN.md`: the page never scrolls; each region fits or scrolls itself. Every interactive control keeps a 44 px hit area. Fields stay at least 16 px on a touch screen (`expectPageFits` in `e2e/smoke.ts` checks it).
- Motion follows Light rail (ADR-0045): light runs along lines already on screen, ends within 500 ms and never loops. The Cradle's base and the Base line's hover are both light along a line that is already drawn. Both go instant under reduced motion; the glow goes under reduced transparency and in Dawn through the tokens that already do it (`--glow-on`).
- Accessible names stay. A heading that a test or a screen reader finds by role keeps its role and name when its look changes (section 3.6 lists them).
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before calling a phase done, and look at it at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The kit's controls

- `packages/ui/src/primitives/Button.css` (293 lines). Fill and edge are painted on `::before` (53 to 69) from the variables `--nh-fill`, `--nh-rim`, `--nh-rim-w`, `--nh-sheen` (the layer's `box-shadow`) and `--nh-glow` (its `filter`); a variant sets only those. `Button.tsx:35` makes secondary the default variant. Secondary (151 to 154) is `--surface-2` with a `--line-raised` edge, hover (184 to 188) `--surface-3` and `--line-raised-hover`. Ghost (164 to 166, 194 to 199) is text with a quiet fill on hover. Destructive (169 to 174, 200 to 206) is a 2 px danger edge on `--surface-1`. Disabled (211 to 221) is a flat `--surface-2` box. The Cup (86 to 148) is the primary and is not touched.
- `.nh-iconbtn` (234 to 293): no box at rest, a fill on hover, cyan fill when pressed.
- `primitives/Menu.css` 9 to 91: `.nh-menu-trigger` is a raised control painted on its own `::before` (`--raised`, `--line-raised`, `--raised-sheen`); the icon trigger (60 to 91) is a 1.75 rem square.
- `primitives/Chip.css` (121 lines): a chip is a face with a 1 px edge in its tone and a tint (4 to 21). Tones: harmful, beneficial, magical, info (22 to 41). The removable filter chip (46 to 51) and the pressable chip (88 to 121, pressed at 109 to 117 with the cue tick) are the ones you choose with.
- `primitives/SegmentedControl.css` (71 lines): a sunken well (`--track`, `--track-edge`, 3 to 12) whose chosen option is `--tab-on` with a 2 px cyan underline (53 to 57).
- `records/Dropdown.tsx:54` and `records/FilterFlyout.tsx:39` are `Button size="sm"` with `.is-on` while open. `Dropdown.css:5-8` and `FilterFlyout.css:2-5` paint `.is-on` as `border-color` and an inset `box-shadow` on the button itself, which sit under the opaque `::before`, so the open state is probably invisible today. Check in the browser before relying on it.
- `records/FilterFlyout.css` 45 to 66: `.nh-filterchip`, a 2 rem boxed face with `.is-on` cyan.
- Sort: `scenes/listTools.tsx` 126 to 164 builds its triggers from `Button` and follows the kit.
- A hand-made segmented control: `codex/shell/CodexFrame.tsx` 216 to 231 (the phone's Campaign switch) writes the `nh-segmented` markup by hand with `aria-current`.

### 3.2 Groups

- `settings/SettingRow.tsx` 21 to 41: `SettingsSection` renders a header (`h2`, `GmOnlyTag`, the hint) over `div.settings-panel`, which gets `rim-gm` for a GM section. `settings/settings.css` 161 to 171: the panel is a plate (`--material-lip`, `--material-plate`, a `--rim-color` edge). Inside it, `FightsSection.tsx` 68 to 70 nests a `settings-subpanel` with a `settings-subhead`, a box in a box.
- `packages/ui/src/styles/design-tokens.css` 912 to 914: the `.rim-gm` utility, a 3 px violet inset bar. Its one use is `SettingRow.tsx:38`. The `--rim-gm` token itself (313) is the violet that hidden content, the Codex's GM blocks and the relationship map use, and it stays.
- `codex/home/home.css` 51 to 63: `.cx-card`, a plate; `.cx-card.is-gm` adds a violet edge and the 3 px inset bar.
- `primitives/Panel.tsx` and `PanelHeader`: used only by `codex/BackupView.tsx:159-168`.
- `sheet/sheet.css` 194 to 201: `.cs-card`, the sheet's plate. 348 to 356: `.nh-btn.cs-gm-control` paints the kit button's `::before` violet directly.

### 3.3 Section bars

| Section | Where | Today |
| --- | --- | --- |
| Prep | `shell/AppBar.tsx` 386 to 416 (`PrepFrame`, `PrepBarSlot` at 381); `app-bar.css` 153 to 212 and 321 to 342 | `div.section-bar` with the kit `Tabs` as plain words and `section-bar-end` for the page's search or primary. No section name |
| Codex | `codex/shell/CodexFrame.tsx` 156 to 238; `codex/shell/shell.css` | `div.cx-bar` with hand-made `nh-tab` buttons with icons in a boxed group; the phone has `cx-phonebar` and `cx-tabbar` |
| Compendium | `compendium/CompendiumShell.tsx` 155 to 222 | `h1.cp-bar-title` then a boxed group of `nh-tab` buttons, the search box, `RulesButton` and a full-size primary; the phone has `cp-phone-sections` and `cp-phone-new` |
| Settings | `settings/SettingsPage.tsx` 195 to 268, `SECTION_ICONS` 48 to 55 | Borrows the Codex's `cx-bar`, `cx-phonebar` and `cx-tabbar` with icons; the primary lands in `settings-primary-slot` through `PrimarySlot` |

`PrepFrame` is already the shape the spec wants, less the name: it uses the kit's `Tabs`, whose ink is the horizon on the strip's line (ADR-0046).

### 3.4 In-content titles

- `codex/home/HomeView.tsx` 329 to 335: `.cx-home-titlerow`, the big CODEX title.
- `codex/pages/PagesIndex.tsx` 176 to 184: a title row with New page.
- `actors/PartyRosterTab.tsx` 269 to 279: `.party-heading.neon-beam` with the ROSTER `h2` and its primary.
- `replay/ReplayList.tsx` 86 to 96: `.replay-list-head.neon-beam`.
- Settings: each section's `h2` and `GmOnlyTag` (`SettingRow.tsx` 33 to 37).
- `.neon-beam` (`design-tokens.css` after 914) is also used by `actors/MyCharacter.tsx:312`, `sound/SoundBoard.tsx:115` and `viewer/ViewerControls.tsx:202`.
- The builder: an eyebrow over its title.

### 3.5 Steps and empty states

- `primitives/Steps.css` (181 lines): the current step is a magenta `--primary` disc with `--glow-magenta` (98 to 106), and the compact bar's fill is `--primary` (36 to 41). `primitives/WizardShell.css` 270 to 310 already draws the side rail's steps with square markers and cyan, as the spec wants, as an override inside `.nh-wizard-side`.
- `styles/patterns.css` 59 to 88: `.nh-empty`, a 12 rem block with an icon, a title and text. Used by `primitives/ChoiceGrid.tsx:257`, `primitives/RowEditor.tsx:155` (without its height), `integrations/CredentialsTable.tsx` 149 to 157, `actors/ClaimCharacter.tsx` and `builder/CharacterBuilder.tsx`.
- Empty lists with their own markup: `codex/atlas/AtlasView.tsx` 423 to 432 (`.atlas-firstmap`), `codex/atlas/PlayerAtlas.tsx:100` (an `h3` "No maps yet"), `scenes/SceneList.tsx` 212 to 217 (`.sc-empty`, with a primary), `replay/ReplayList.tsx` 100 to 107 (`.scene-empty`), the Codex's `cx-empty`, and the legacy `.empty` in `styles.css`.
- Primaries off the bar: `scenes/ScenesShell.tsx` 26 to 48, Prep's front page, sets New map (secondary) and New encounter (primary) above a Maps and Encounters tab strip under Prep's bar.

### 3.6 Tests that pin today's look or names

- `codex/home/home.test.tsx:195` finds the heading "Codex".
- `settings/settings-page.test.tsx` 54, 200 and 223 find the headings "Players" and "Device" at level 2.
- `e2e/journeys.spec.ts` finds `heading "Device"` level 2 (256), `heading "Shared screen"` level 2 (690) and `heading "Sound"` level 2 (725), and "Start an encounter" by role.
- `packages/ui/src/primitives/controls-light.test.tsx`, `button-ink.test.tsx` and `behaviour.test.tsx` pin parts of the button, chip and segmented control.
- `primitives/steps-vertical.test.tsx` pins the vertical steps.
- `records/records.test.tsx` pins the Dropdown, the Filters button and the filter chips.

## 4. The design

### 4.1 Tokens

Add to `design-tokens.css`, beside the line tokens, in both themes where the values differ:

| Token | Value | Use |
| --- | --- | --- |
| `--base-line` | `inset 0 -1px 0 var(--line-raised)` | A secondary control at rest |
| `--base-line-hover` | `inset 0 -2px 0 var(--cyan)` | Hover and press |
| `--base-line-on` | `inset 0 -2px 0 var(--cyan)` | A chosen chip or option |
| `--base-line-hidden` | a dashed 2 px violet base (a `linear-gradient` repeating on `background-image`, since an inset shadow cannot dash) | A hidden choice |
| `--cradle-base` | `2px` | The Cradle's base width |
| `--cradle-sides` | `linear-gradient(to bottom, transparent, var(--line-raised) 55%)` | The Cradle's sides |

`--glow-on`, `--ease-travel` and `--line-raised` exist; Dawn and reduced transparency already turn `--glow-on` off.

### 4.2 The Base line

- Secondary, at rest: `--nh-fill: transparent; --nh-rim: transparent; --nh-sheen: var(--base-line)`. The label is `--text`. Hover and press: `--nh-sheen: var(--base-line-hover)` and `--nh-glow` as a cyan drop to match `--glow-on` (none in Dawn and under reduced transparency, through the token). The `::before` keeps its `inset: -1px`, so the line sits on the button's bottom edge and the button does not change size.
- Ghost: no line at rest; the cyan line on hover. Use it for the quietest actions (Cancel beside a primary).
- Destructive: `--danger-text` label on a `--danger` base line; hover lights it 2 px with `--glow-drop-danger`.
- Disabled: `--text-muted` on a `--line` base, no hover.
- `.nh-iconbtn`: stays as it is. It is the plain icon of the top bar and the map. An icon button in content that the spec puts on a base line (a record's More) takes a new `.nh-iconbtn--base` modifier.
- The menu trigger, the Dropdown button and the Filters button: the secondary's base line. Open (`.is-on` and `aria-expanded="true"`) keeps `--base-line-on`, painted through the variables so it shows above `::before`.
- Chips you choose from (`.nh-chip--pressable`, the removable filter chip, `.nh-filterchip`): no edge and no tint; the label in `--text-dim` on `--base-line`; pressed is `--text` on `--base-line-on`, and the cue tick stays. Status chips with a tone (harmful, beneficial, magical, info) stay as they are: they say what a thing is and take no input.
- A hidden choice (Who sees it's Hidden) is `--violet-hi` on `--base-line-hidden`.
- The segmented control: no well. Its options sit 6 px apart, each on `--base-line`; the chosen option is `--text` on `--base-line-on` with no fill. Disabled options dim their ink and keep their line.
- The hit area stays 44 px everywhere. A `--sm` face keeps `.tap-target`.

### 4.3 The Cradle (`Group`)

New `packages/ui/src/primitives/Group.tsx` and `Group.css`, exported from `packages/ui/src/index.ts`.

```tsx
<Group title="Players' hits" kind="act" gmOnly actions={<Button size="sm">Edit</Button>}>
  ...rows
</Group>
```

- Props: `title` (rendered through the `Eyebrow` primitive so check (c) holds), `kind` (`"act"`, the default, or `"read"`), `actions` (at the right of the heading), `gmOnly` (renders `GmOnlyTag` after the title), `headingLevel` (default none: the eyebrow is a `p`; pass 2 or 3 when the group needs to be found as a heading), `className`, `children`. The element is a `section` with `aria-labelledby` on the title when there is one.
- `.nh-group` (act): `position: relative; border: 0; background: none; padding: 0 14px 12px`. The heading row sits in the open top, 14 px in.
- `.nh-group::before`: `inset: 6px 0 0`, `border: 1px solid transparent; border-top: 0; border-bottom-width: var(--cradle-base); border-image: var(--cradle-sides) 1`, `pointer-events: none`.
- `.nh-group::after`: the light, `left: 0; right: 0; bottom: 0; height: var(--cradle-base); background: var(--cyan); box-shadow: var(--glow-on); transform: scaleX(0); transition: transform 280ms var(--ease-travel)`. `.nh-group:is(:hover, :focus-within)::after { transform: scaleX(1) }`. Under `prefers-reduced-motion` the transition is none.
- `.nh-group--read`: no `::before` or `::after`, a 1 px `--line-strong` rule above it (`border-top`), the heading and the content with no side padding.
- Rows inside a group are divided by 1 px `--line` (rule 6). A group never holds a group: in CSS a `.nh-group` inside another draws no box of its own (no `::before` or `::after`), and the test asserts it.
- Groups stand 18 to 22 px apart: a `.nh-groups` stack with `gap: 20px`.
- The mockup's `p4-spec.css` (`.grp.box-cradle`) and the sheet's `p4-theme.css` (`.c3`) carry the same values.

### 4.4 The Titled section bar

New `apps/client/src/shell/SectionBar.tsx` and `section-bar.css`, built from `PrepFrame`'s bar:

```tsx
<SectionBar name="Codex" pages={pages} activeId={id} onChange={go} search={search} primary={primary} panel={panel} />
```

- Laptop (`min-width: 761px`, the other side of `PHONE_SHELL_QUERY` in `AppBar.tsx:52`, which the Codex and Settings already match): a 52 px bar under the top bar. From the left: the name (`h1`, Chakra Petch 600 capitals, 17 px, `--text`), a 1 px `--line-strong` divider 20 px tall with 16 px either side, the kit `Tabs` with the pages as words (Bai Jamjuree 600, 14 px; chosen `--text` with the horizon ink, others `--text-dim`), a flexible gap, the search field, then the primary (the Cup, `size="sm"`, 42 px in a 44 px box). The bar's bottom is the 1 px line the ink lies on.
- Phone: a header row (52 px) with the name in Chakra Petch 600 capitals at 18 px and up to two icon buttons (search, and the primary as an icon), then the pages as one strip of words with the same ink, scrolling sideways with a fade at the edge (the strip the Codex's `cx-tabbar` and `keepChosenInView` already do), then the content.
- No icons in the bar on any width. The `CodexIcon` icons stay in the Codex's own content.
- `PrepBarSlot` and `SettingsPrimary` keep working: the bar exposes one end slot through context, and both portal into it.

### 4.5 Records-only headers

- A list, a section or an overview has no title row. Its first line is its content, or one description line (14 px, `--text-dim`, the `GmOnlyTag` in front of it on a GM page).
- A record keeps its title row; that row's design belongs to the record's area.
- Keep accessible headings where a test or the outline needs one: the section bar's name is the page's `h1`; a settings section keeps an `h2` with its name, visually hidden (`.sr-only`), before its description line.

### 4.6 Steps and empty states

- `Steps.css`: current is a cyan outline (`border: 2px solid var(--cyan)`, no fill, no glow) with the number in VT323; done keeps its cyan tick; incomplete keeps the amber dashed mark. Markers are square everywhere (fold `WizardShell.css` 270 to 310 into `Steps.css` and delete the override). The compact bar's fill is `--cyan`. Nothing in Steps uses `--primary` or `--glow-magenta`.
- New `packages/ui/src/primitives/EmptyState.tsx`: `<EmptyState action={<Button>New encounter</Button>}>No encounters yet.</EmptyState>`. One line in `--text-dim` at 14 px and an optional secondary button under it, placed where the content would be, with no heading, icon or box. `.nh-empty` in `patterns.css` becomes its style; `.nh-empty-icon` and `.nh-empty-title` go.

## 5. Phases

### T0: install the handoff and the decision

1. Copy this package into `docs/design/polish/`. If D1's phase L0 has already installed the folder, replace `README.md`, `CATALOG.md` and `D1-character-sheet/` with the zip's copies (they now carry the theme) and add `T-theme/`. If it has not, also add `docs/design/polish` to `.prettierignore` and to ESLint's ignores beside `docs/design/light-rail`.
2. Add `T-theme/ADR-0048-theme-spec.md` as `docs/adr/0048-theme-spec.md`, Accepted, and its row to `docs/adr/README.md`. If 0047's row is not there yet, leave the number free for D1; do not renumber. If the duplicated rows 027 to 037 that follow 037 are still there, remove them.
3. Run the full checks and record any failure that was already there.

### T1: the Base line in the kit

1. Tokens (4.1).
2. `Button.css`: secondary, ghost, destructive and disabled as in 4.2, through the variables only. Add `.nh-iconbtn--base` and its prop on `IconButton` (`base?: boolean`).
3. `Menu.css`: the text trigger on the base line. The icon trigger (60 to 91) stays a square with no box, like `.nh-iconbtn`.
4. `Dropdown.css` and `FilterFlyout.css`: paint `.is-on` through `--nh-sheen: var(--base-line-on)` so it shows; check it in the browser before and after. `.nh-filterchip` as a chooser chip.
5. `Chip.css`: the pressable and removable chips as choosers (4.2). Leave the tones.
6. `SegmentedControl.css`: drop the well; options 6 px apart on base lines.
7. `codex/shell/CodexFrame.tsx` 216 to 231: replace the hand-made segmented markup with the kit's `SegmentedControl`, keeping `aria-current="page"` on the chosen part (add a `current` option to the primitive if it only does `aria-pressed`). Remove the matching rules in `shell.css`.
8. Sweep for app CSS that paints over a kit control (`.nh-btn` with `--nh-fill`, `background` or `border-color` on `::before`; `.nh-segmented` and `.nh-chip` overrides). Remove the ones that only restate today's look. List the rest in the commit body for their areas (section 7); `shell/landing.css` 369 to 371's violet inset on the arrival's secondary goes now under rule 7.
9. Tests: update `controls-light.test.tsx`, `button-ink.test.tsx`, `behaviour.test.tsx` and `records.test.tsx` where they assert fills or edges; add one asserting the secondary has no fill and a base line, and one that the Dropdown's open state is visible (computed `box-shadow` on `::before`).

### T2: the `Group` primitive

1. `Group.tsx`, `Group.css` and an export (4.3). A unit test: the title renders through `Eyebrow`; `gmOnly` renders the tag; `kind="read"` has no box; a group inside a group has no box; `aria-labelledby` points at the title.
2. Settings: `SettingsSection` renders its rows in one `Group` with no title (the section's name is in the bar and its hidden `h2`); `settings-panel` and its plate go from `settings.css`. `FightsSection`'s `settings-subpanel` becomes an open sub-heading inside the group with a 1 px `--line` rule, with no box of its own. Splitting a section into several named groups, as the mockup's Encounters page does, is area I's work.
3. Remove the `.rim-gm` utility (`design-tokens.css` 912 to 914) and the `rim-gm` class from `SettingRow.tsx:38`. The GM tag carries GM-only (rule 7).
4. `codex/home/home.css` 61 to 64: `.cx-card.is-gm` drops the inset bar and the violet edge; the card's `GmOnlyTag` says it. Whether the home's cards are Cradles or open groups is area F's call.
5. `codex/BackupView.tsx`: `Panel` and `PanelHeader` become `Group title="Download backup"`. If nothing else imports `Panel`, delete `Panel.tsx`, `Panel.css` and its export.
6. Tests: `settings-page.test.tsx` and `table-settings.test.tsx` where they find the panel; `home.test.tsx` if it checks the GM card's class.

### T3: the Titled section bar

1. `shell/SectionBar.tsx` and `section-bar.css` (4.4), with a unit test: the name is the `h1`, the pages are a tablist, the chosen one is `aria-selected`, the end slot takes a portal, no icons render.
2. Prep: `PrepFrame` renders `SectionBar name="Prep"`. Move the bar rules out of `app-bar.css` (153 to 212, 321 to 342) into `section-bar.css`.
3. Codex: `CodexFrame` renders `SectionBar name="Codex"` on laptop and phone; its search stays at the right end; drop the icons from the bar; `cx-bar`, `cx-phonebar` and `cx-tabbar` give way to the shared bar. The New page primary moves into the bar (it is in `PagesIndex` today; see T4).
4. Compendium: `CompendiumShell` renders `SectionBar name="Compendium"`; `h1.cp-bar-title` goes; the search and `RulesButton` sit at the right end before the primary, which becomes `size="sm"`; `cp-phone-new` becomes the header row's icon.
5. Settings: `SettingsPage` renders `SectionBar name="Settings"`; delete `SECTION_ICONS`; the `PrimarySlot` portal targets the bar's end slot.
6. Delete what the four shells no longer use (`.cx-bar*`, `.cx-tabbar*`, `.cp-bar*`, `.settings-bar`, `.settings-tabbar`, `.section-bar*` in `app-bar.css`).
7. Tests: the shells' tests that find tabs or the bar (`codex/shell/*.test.tsx`, `compendium/*.test.tsx`, `settings/settings-page.test.tsx`, `shell/*.test.tsx`); smoke journeys that click a section tab by name should still pass, since names stay.

### T4: records-only headers

1. Codex home: remove `.cx-home-titlerow` (`HomeView.tsx` 329 to 335); `home.test.tsx:195` finds the bar's `h1` "Codex" instead.
2. Pages index: remove its title row (`PagesIndex.tsx` 176 to 184); New page moves to the bar's end slot through the Codex shell's slot (add one like `PrepBarSlot` if it has none).
3. Roster: remove `.party-heading` (`PartyRosterTab.tsx` 269 to 279); its primary moves to Prep's bar through `PrepBarSlot`.
4. Replays: remove `.replay-list-head` (`ReplayList.tsx` 86 to 96).
5. `.neon-beam`: after 3 and 4 it is left on `MyCharacter.tsx:312` (area D), `SoundBoard.tsx:115` and `ViewerControls.tsx:202` (area E3 and H). Leave those for their areas and note it in the commit body; keep the utility until the last one goes.
6. Settings: each section's header becomes the description line (`GmOnlyTag` in front on a GM section) with the section's name as a visually hidden `h2`, so `settings-page.test.tsx` 54, 200 and 223 and `journeys.spec.ts` 256, 690 and 725 still find their headings. Run the smoke suite to prove it.
7. The builder: drop the eyebrow over its title; the title stays (a character in the making is a record).

### T5: the rules sweep in the kit

1. Steps (4.6): `Steps.css` without magenta; fold in `WizardShell.css` 270 to 310; `steps-vertical.test.tsx` and any test on the current step's colour. The encounter and map editors' steps (`EditorFrame.tsx`) follow from the kit.
2. `EmptyState` (4.6) with a unit test, and move these to it: `ChoiceGrid.tsx:257`, `RowEditor.tsx:155`, `CredentialsTable.tsx` 149 to 157, `ClaimCharacter.tsx`, `CharacterBuilder.tsx`, `AtlasView.tsx` 423 to 432, `PlayerAtlas.tsx:100`, `SceneList.tsx` 212 to 217 (its primary becomes a secondary: rule 2), `ReplayList.tsx` 100 to 107 and the Codex's `cx-empty`. Remove the legacy `.empty` from `styles.css` once nothing uses it. Keep each empty line's words.
3. One primary in a fixed place: on Prep's list pages, the primary moves to the bar's end through `PrepBarSlot`. `ScenesShell.tsx` 26 to 48 loses `sc-front-new`: New encounter goes to the bar as the primary and New map to the bar as a secondary before it. The Maps and Encounters tabs under the bar break rule 1; leave them for area E and say so in the commit body.
4. GM-only as a tag: after T2 the violet bars are gone from the kit and Settings. Leave the Codex's GM blocks and hidden dashed blocks as they are; they mark hidden content.

### T6: docs and an optional guard

1. `docs/DESIGN.md`:
   - Layout: the Titled section bar, records-only headers, widths (full, 880, 680), the phone stack.
   - Components: secondary controls on a Base line, chips you choose from, the segmented control without its well, `Group` (the Cradle and the open group), `EmptyState`, Steps in cyan. Fix any line that still says secondary controls are filled boxes or the segmented control is a well.
   - A Page patterns section with the table from `SPEC.md` section 4, pointing to `docs/design/polish/T-theme/SPEC.md` for the rules.
2. `docs/ARCHITECTURE.md`: the client shell's section bar (`shell/SectionBar.tsx`) and the kit's new primitives, where the shells and the kit are described.
3. `docs/adr/README.md`: 0048's row says Accepted and built.
4. `docs/design/polish/CATALOG.md`: T moves to Built.
5. Optional, if it stays small: a check (j) in `design-conventions.test.ts` that no app stylesheet sets `--nh-fill`, `--nh-rim` or paints `.nh-btn::before`, with an allowlist for the overrides section 7 leaves to their areas. Each area's plan removes its entries.

### T7: the sheet, after D1

Wait until D1's phase L7 is on the branch.

1. `sheet/sheet.css`: if `.cs-card` (194 to 201 at `f5e166f`; find it by name) is still there, replace it with `Group`, keeping the cards D1 placed. D1 may already use `Group`; then this step is a check.
2. Remove the `.nh-btn.cs-gm-control` override (348 to 356 at `f5e166f`). GM-only controls become plain secondaries in a group whose heading carries the GM tag.
3. Look at the sheet at 1280, 1100, 390 and in the Table panel, in Dusk and Dawn, against `../D1-character-sheet/ledger-sheet.html`.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- Look at Prep, the Codex (home, a page, the atlas), the Compendium, Settings (a GM section and Device), the table and a character sheet as the GM and as a player, in Dusk and Dawn, at:
  - 1280 by 800 with a mouse: the bar's name, words, search and primary on one line; secondary buttons, chips and segmented options on base lines that light on hover; Settings in one Cradle per section whose base lights while the pointer is inside.
  - 390 by 844 with touch: the header row, one strip of words, the content scrolling and the bottom tabs; every control at least 44 px; no sideways scroll; fields at least 16 px.
- With reduced motion (the Cradle and base lines light at once) and with reduced transparency (no glow).
- Keyboard: tab through a settings section; the Cradle lights on `:focus-within`; focus rings are unchanged.
- Compare against `theme-spec.html` with the page switcher on Settings, Codex page, Encounters and Gallery.

## 7. Left as they are, for their areas

- Look-alike controls in app CSS that the T1 sweep finds and that only a page redesign can retire: `encounter/encounter-panel.css` from about 915 (area C), the client's bare `button {}` and `.secondary` in `styles.css` (every area; each area moves its buttons to the kit).
- Prep's Maps and Encounters tabs under the bar (area E), and its list pages' toolbars.
- The Codex home's cards and its GM blocks (area F); hidden content keeps its dashed violet block everywhere.
- `.neon-beam` on My character, the sound board and the viewer controls (areas D, E3 and H).
- Every record's title row (each record's area designs it from `SPEC.md` 2.2).
- The character sheet's files until D1 is done (T7).
- Every command, projection and stored value.

## 8. Departures from the mockup, on purpose

- The mockup draws the Cradle with a `.grp` wrapper and its own heading markup. The app uses `Group`, whose heading is the `Eyebrow` primitive.
- The mockup splits Settings, Encounters into three named groups (Rules assistant, Players' hits, Initiative). The app's sections are one panel each today; T2 draws each as one Cradle and leaves the split to area I.
- The mockup's settings heading is a visible description line only. The app keeps a visually hidden `h2` for the outline and the tests.
- The mockup's bar search is a drawn field; the app keeps each section's own search component.
- The mockup's switchers (box, sub, page, view, theme) are mockup controls.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `theme-spec.html`.

- `p1-head.html`: the tokens, Dusk and Dawn.
- `p3-app.css`: the app frame: top bar, pane, phone.
- `p4-spec.css`: section bars (`.sb`; Titled adds `.sb-title`, then `.sb-tabs`, `.sb-tab` and `.sb-end`), the page header and description line (`.ph`, `.desc-line`), groups (`.grp`, `.grp-h`, `.grp-b`; the Cradle is `.box-cradle`; Mixed is `.g-mixed`), settings rows (`.srow`), the segmented control (`.segc`), tables, the record page and its side panel, the phone, and the Base line (`.sub-base`).
- `p6-spec.js`: the pages (`PAGES`), `grp()`, `settingsBody()`, `galleryBody()`, the decision texts and the rules and patterns.
- `p5-body.html`: the page switcher.
- `audit.js`: how the "today" crops were captured from the running branch.
