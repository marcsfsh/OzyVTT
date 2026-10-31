# A The frame: building it

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update U6: ADR-0046 and the handoff"). This plan rebuilds the frame around the pages: the laptop top bar, the phone's header and bottom tabs, search, the news surfaces and the frame's dialogs and states. It adds no rules, commands or data. File paths and line numbers were read at `f5e166f`; the theme plan (T) and the character sheet (D1) land on the same branch first or alongside, so confirm every anchor before editing. Paths are under `apps/client/src/` unless they start with `packages/`, `e2e/` or `docs/`.

This is area A in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in eight phases, A0 to A7, each about one commit.
- The reference is `frame.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else is inline). It opens on the approved choices. Use Who (GM or Player), Page, Moment (at rest, search, menu, news, offline) and Encounter (running or none) to see each state. The other options in the four decision switches are the ones the owner turned down; build only the chosen ones. `history/1-round-1.html` is the round as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code, and its table and sheet are sketches: areas C and D own those pages. Build with the existing primitives, hooks and tokens. Section 8 lists where the plan departs from the mockup on purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md` applies on top, and `writing.test.ts` checks it.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The laptop top bar is One menu: the wordmark, the sections, a live chip while an encounter runs (the encounter picker on the GM's Play page), the search icon and one menu button with your face. The menu holds who is online, the table screen, the theme, settings and signing out (GM), or releasing the character and leaving the table (player).
2. A phone has no top bar. Each page's header row is its first row, and More is the fifth bottom tab: a sheet with search and the menu's rows.
3. Search is one dialog: one field and a segmented choice of where to look (Codex, Compendium for the GM, Rules, Go to), starting on the section you are in. Each place uses its section's own search.
4. News stays in the corner: toasts in the bottom right and above the phone's tabs; reconnecting and roll calls as bands under the laptop's top bar, or first on a phone.
5. Eleven rules for the frame (`SPEC.md` section 3), among them the live lamp, the theme switch leaving the bar, one Ctrl K, the Dialog pattern for confirmations, and the not found, crash and loading states.

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it.
- A builds on T. Phases T1 to T3 (the Base line, `Group` and the shared `shell/SectionBar.tsx`) must be on the branch before A1, and T5 (`EmptyState`) before A6. If they are not, stop at the phase that needs them and tell the user. Do not edit `sheet/` while D1 is in progress; nothing here needs it.
- CLAUDE.md applies in full. The server decides; projections are the security boundary. Search calls only the searches each role can call today, with the same token: the Codex search (`/api/v1/codex/search`, graded for GM or player), the Compendium searches (`requireGm`), the glossary read (`content:glossary`) and the client's own lists. A player never gets the Compendium place. No server code, shared domain, schema, command or HTTP route changes; `npm run map` should not report a change.
- `design-conventions.test.ts`: colours from tokens (d), the breakpoint ladder (f), `.scroll-y` (h), the display face in capitals (i), one Eyebrow (c), feedback through a toast (e). The phone frame keeps `PHONE_SHELL_QUERY` (`(max-width: 760px)`).
- The pane rule (`styles.css`): no transform, filter, backdrop-filter, perspective, will-change or `contain: paint` on `.app-pane` or its one child. The More sheet and the menu are overlays outside the pane.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area; fields at least 16 px on a touch screen.
- Motion follows Light rail (ADR-0045): the section ink on the horizon (`pageLight`), the presence light (group 14), the table screen lamp's burst and afterglow, the reconnect comet (group 9). Each keeps its light in its new place; nothing new loops.
- Accessible names change on purpose in A1, A3 and A4. Update the unit tests and the smoke helpers in the same phase, so every commit is green.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before calling a phase done, and look at it at 390 px and 1280 px in Dusk and Dawn (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The shell

- `main.tsx` 14 to 22: `AppErrorBoundary`, then `ToastProvider`, then `App`. The toast viewport renders as a sibling of `<main>`.
- `shell/App.tsx` 76 to 156: `main` is a grid of four rows (`styles.css` 14 to 35): row 1 `GmTopBar` or `PlayerTopBar` (94 to 102), row 2 `ReconnectBar` (104), row 3 `.app-pane` (108 to 147) whose first child is the player's `RollCallPrompts` off the table (111 to 113), then `Landing`, `GmShell` or `PlayerShell`, and row 4 the phone's `GmBottomTabs` or `PlayerBottomTabs` (150 to 153). `GmShell` receives `onSignOut` and `onRevokeAll` (134 to 135); `PlayerShell` receives `onLeave` (144).
- `styles.css` 33 to 35 sets `--bottom-tabs-h: 65px` on `main:has(> .app-bottom-tabs)`. The toast viewport is outside `main`, so it reads 0 and phone toasts sit over the bottom tabs (visible in the round 1 audit).
- `shell/pageLight.ts` 13 to 16 runs the section light along the first `[data-horizon]` in `main`: the top bar, `PlayerIdentity` or Play's strip.

### 3.2 The top bars and bottom tabs (`shell/AppBar.tsx`, 416 lines)

- `PHONE_SHELL_QUERY` and `usePhoneShell` (52 to 53). `SectionTabs` (76 to 114) draws the sections as the top bar's tabs or the bottom tabs. `TopBar` (134 to 141) is `header.app-bar` with `data-horizon` and the wordmark.
- `Connected` and `PresenceFace` (144 to 193): up to four online faces, labelled "N characters online", each warming with a burst when it joins.
- `SettingsButton` (201 to 207). `GmTopBar` (213 to 256): sections, `LiveScenePicker` on Play, `TvControl`, `Connected`, `SearchLauncher` with the Go to list (242 to 250), `ThemeSwitch`, `SettingsButton`. On a phone it returns null on Play (218) and otherwise keeps a compact `TvControl`, search, theme and settings.
- `Playing` (292 to 303) and `PlayerTopBar` (309 to 354): sections (with "Codex, N new"), Playing Lyra, search, theme, settings. On a phone at the table or log with a claimed character it returns `PlayerIdentity` (320 to 322).
- `GmBottomTabs` (259 to 271) and `PlayerBottomTabs` (357 to 375): the kit `Tabs` with icons and the ink on top.
- `shell/app-bar.css` (357 lines): bar 1 to 25, grow and divider 26 to 35, TvControl trigger 36 to 49, mark 50 to 52, sections 54 to 89, icons and screen lamp 91 to 122, faces 123 to 135, playing 136 to 151, section bar and Prep frame 153 to 212 (T3 moves these), bottom tabs 214 to 263, search launcher 265 to 306, phone 308 to 343, theme 344 to 353, lamp 354 to 357.

### 3.3 What the bar's pieces do

- `table/LiveScenePicker.tsx` 13 to 50: a Menu labelled "Encounters · {name} is live" or "Encounters"; the trigger shows "Encounter" and the name, or "No encounter live"; items Make X live (asks first during a fight), Open X, All encounters, New encounter. It never shows the round.
- `table/TvControl.tsx` 17 to 115: a Menu labelled `Table screen, {on | off | on, another map | status unknown}` with a lamp (burst on, afterglow off) and ON or OFF on a `Roll`. Items: Pause the table screen, Show the live encounter, Preview the table screen here or Hide the preview, Table screen settings (`/viewer-controls`).
- `packages/ui/src/theme/ThemeToggle.tsx`: `ThemeSwitch` (the bar's menu, 44 to 69) and `ThemeToggle` (a segmented control, used in Settings, Device). `THEMES` and `THEME_NAMES` in `theme/theme.ts`.
- Signing out: `shell/useSession.ts` 280 to 295 `endGmSession` posts `/api/v1/host/gm/sign-out`; exposed as `signOutGm` (336). Its only button today is in `settings/AccessSection.tsx` 38 to 49, with no confirmation.
- Leaving: `useSession.ts` 271 to 277 `leave`, wrapped by `leavePlayer` (339 to 342): client only. Confirmed in `settings/SettingsPage.tsx` 113 to 122 ("Leave the table?", "Leave table"); the button is in `settings/DeviceSection.tsx` 65 to 71.
- Releasing: `actors/MyCharacter.tsx` 117 to 138 `useReleaseCharacter(state)` confirms "Release {name}?" and sends `character:release`. Its menu item is in `sheet/SheetMenu.tsx` 128 to 133.

### 3.4 The phone's page headers

- GM Play: `table/TableStrip.tsx` 27 to 114 (phone branch 64 to 81): `header.table-strip.is-header` with `VcrCounter`, a compact `LiveScenePicker`, `NowPlaying` and `JoinButton` (136 to 148).
- Player table and log: `table/PlayerIdentity.tsx` 11 to 40, `header.player-identity`, labelled "Playing {name}", with `data-horizon`.
- Codex: `cx-phonebar` (`codex/shell/CodexFrame.tsx` 161 to 170) and its slot API in `codex/shell/PhoneBar.tsx` 11 to 40. Compendium: `PhoneHead` in `compendium/pieces.tsx` 87 to 111. Settings: `settings/SettingsPage.tsx` 197 to 216. T3 puts all of these and Prep on `SectionBar`'s phone header.
- Today each of these sits under the global phone bar, so most pages show two rows of chrome.

### 3.5 Search

- `shell/SearchLauncher.tsx` 17 to 107: the dialog of doors. `SCOPED_HEADS` (7 to 8) is `codex`, `compendium`, `scenes`, `settings`; Ctrl K opens the launcher elsewhere. Prep's pages live under `/encounters`, so `scenes` is stale and on Prep both the launcher and `FindBox` take Ctrl K (not checked in a browser).
- Codex: `codex/CommandPalette.tsx` 37 to 191, a Modal "Codex command palette" with commands (New page, New session, New quest, Log a journal entry, Log downtime, Go to each part) and search results from `useCodexSearch` (`codex/SearchResults.tsx` 26 to 60, 250 ms debounce) over `findApi.search` or `findApi.searchAsPlayer` (`codex/api-records.ts` 165 to 169). Ctrl K and `openSearch=1` in `CodexFrame.tsx` 69 to 87.
- Compendium: `compendium/SearchDialog.tsx` 17 to 161: name hits filtered on the client from `useTable` (`compendium/data.ts` 108 to 120), text hits from `homebrewApi.search` (200 ms debounce); both routes are GM only. Ctrl K and `openSearch=1` in `CompendiumShell.tsx` 67 to 84.
- Rules: `reference/RulesReference.tsx`, a `Drawer` over the glossary read once through `read("content:glossary")` and filtered on the client. `RulesButton` in `CompendiumShell.tsx` 183.
- Settings: `settings/SettingsSearch.tsx`, a client index (`searchSettings`, `sections.ts` 247 to 257, over `settingsFor(role)`); Ctrl K focuses it (35 to 45).
- Prep: `FindBox`, `scenes/ScenesShell.tsx` 55 to 93, a Combobox that filters the lists; Ctrl K focuses it (58 to 67).

### 3.6 News, dialogs and states

- Toasts: `packages/ui/src/primitives/Toast.tsx` (`ToastProvider` 58 to 155 with `.nh-toast-viewport`, `ToastCard`, `useToast`, `ToastOutlet` 234 to 254 used by `TableStrip`); `Toast.css` 1 to 26 (bottom right; on a phone centred above `--bottom-tabs-h`, newest only). `dice/roll-calls.css` 166 to 169 moves toasts to the top while a roll-call dock is up. `scene/toasts.tsx` 22 to 32 turns `table:event` into toasts.
- `shell/ReconnectBar.tsx` 8 to 59 (`p.reconnect-bar`, role status, WAIT tag, the comet when back); CSS `styles.css` 306 to 335.
- `encounter/RollCallPrompt.tsx` 66 to 83 `RollCallPrompts`: `aside.roll-call-dock` "Rolls the GM calls for", cards from `useRollCallCards` (41 to 60); CSS `dice/roll-calls.css` 145 to 169.
- `components/feedback.tsx`: `useConfirm` (42 to 90): Modal sm, secondary Cancel, confirm `primary` or `destructive` (`danger`), autofocused, an optional "don't ask again" switch. `usePrompt` (108 to 168). About 37 confirm calls in 29 files, 26 of them `danger`; 4 prompt calls in 3 files.
- `components/NotFoundView.tsx`: `NotFoundView` (8 to 23, a Cup "Go to the Codex" and a secondary "Go to the table"), `NotFoundPage` (30 to 38), `MissingRecordNotice` (44 to 50). Their styles are in `codex/codex.css` (146 to 165, 908 to 923, 995 to 1041), which only the lazy Codex chunks import, so a not-found page shown before the Codex has loaded is unstyled.
- `components/AppErrorBoundary.tsx` 7 to 34: `<main><section class="card" role="alert">` with an Eyebrow, the message and Reload. `components/lazySurface.tsx`: `SurfaceFallback` (7 to 13, an empty `.pane-frame` with a hidden "Loading") and `lazySurface(load, fallback)` (19 to 31).
- `shell/Landing.tsx:56` `LandingScene`: the arrival's sunset.

### 3.7 Tests that pin the frame

- `shell/app-bar.test.tsx`: GM sections and the bar's buttons ("Table screen, on", the image "1 character online", "Search, Ctrl K", "Settings") 70 to 82; no tab lit on a utility page 84 to 91; last location 93 to 103; "No encounter live" and the lamp's "Table screen settings" 105 to 114; no `.app-bar` on a phone at `/table` 116 to 121; one "GM sections" tablist on a phone with Settings still there 123 to 135; the launcher 138 to 169; player sections, "Playing Lyra", "No character yet" and the phone's Log tab 171 to 198; the reconnect bar 200 to 213.
- `shell/theme-switch.test.tsx` 15 to 43; `shell/reconnect-light.test.tsx` 27 to 38; `shell/light.test.tsx` 26 to 64 (a fixture with `.app-bar` and `data-horizon`); `table/live-scene-picker.test.tsx`; `settings/settings-page.test.tsx` 177 to 179 (Sign out) and 229 to 231 (Leave table); `codex/shell-navigation.test.tsx:88` (the not-found heading); toast tests in `packages/ui` (`behaviour.test.tsx:577`, `overlay-edge.test.tsx` 131 to 156, `cabinet.test.tsx:214`). `TvControl` has no test of its own.
- `e2e/smoke.ts`: `signInAsGm` waits for "GM sections" (211 to 217); `playerSection` and `gmSection` (219 to 240); `openGmSection` (242 to 268) opens Table screen through `getByLabel(/^Table screen,/)` then "Table screen settings", and Settings through the button "Settings"; on a phone it presses Prep first when the bar is hidden.
- `e2e/journeys.spec.ts`: Table screen at 151, 689 and 723; Settings at 1043; "Search, Ctrl K" with the dialog "Search" and Escape returning focus at 968 to 976; Release at 217 to 221; section tabs at 110 to 113, 143, 162, 218, 228, 753, 788, 829, 906, 941 to 942, 961, 979, 1040 and 1060. Playwright runs a phone project (390 by 844, touch) and a laptop project (1280 by 800).

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| `shell/FrameMenu.tsx` | New: the menu's rows, shared by the laptop menu and the More sheet | `Connected` faces, `TvControl`'s actions, `ThemeToggle`, `signOutGm`, `useReleaseCharacter`, the leave confirmation |
| `shell/MenuButton.tsx` | New: the face button in the bar | `Portrait`, the GM mark, the online count with the presence light |
| `shell/LiveChip.tsx` | New: the live chip; on the GM's Play page, the picker's trigger | `LiveScenePicker` (its menu kept), `VcrCounter` or its digits, the projection's turn |
| `GmTopBar`, `PlayerTopBar` | Changed: wordmark, sections, chip, search, menu button; null on a phone | |
| Bottom tabs | Changed: five, with More; the live lamp on Play or Table | `SectionTabs`, a More button outside the tablist |
| `shell/MoreSheet.tsx` | New: the phone's sheet above the tabs | `FrameMenu` plus a Search row |
| `shell/SearchDialog.tsx` | New, replacing `SearchLauncher` | The section searches, as hooks |
| Toasts, bands | Changed placement and style | `Toast.css`, `ReconnectBar`, `RollCallPrompts` |
| Confirm, not found, crash, loading | Restyled | `feedback.tsx`, `NotFoundView`, `AppErrorBoundary`, `lazySurface`, `LandingScene` |

## 5. Phases

### A0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `A-frame/`, and leave the other pieces' folders as the zip has them.
2. Add `A-frame/ADR-0049-frame-and-wayfinding.md` as `docs/adr/0049-frame-and-wayfinding.md`, Accepted, and its row to `docs/adr/README.md`. If 0047 or 0048 are not in the index yet, leave their numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### A1: the menu

1. `shell/FrameMenu.tsx`: `FrameMenu({ role, state, token, onSignOut, onLeave })` renders the rows of `SPEC.md` 2.1 as menu items, in order. GM: who you are; Who is here (the online faces moved from `Connected`, with their light, and "N of M"); Table screen (its lamp and ON or OFF; choosing it shows `TvControl`'s actions in place under the row, as one list); Theme (`ThemeToggle`); Settings; Sign out (confirm "Sign out on this device?" through `useConfirm`, then `signOutGm`). Player: who you are (portrait, name, class line, "and N more" with more than one character); Release {name} when exactly one character is claimed (`useReleaseCharacter`); Theme; Settings; Leave the table (move the confirmation from `SettingsPage.tsx` 113 to 122 into a `useLeaveTable` hook that both use).
2. Move `TvControl`'s state and actions into a hook (`useTableScreen`) and a `TableScreenRows` part, so the menu, the More sheet and `/viewer-controls` share them. The lamp keeps its burst and afterglow inside the row.
3. `shell/MenuButton.tsx`: a `Menu` trigger on a Base line with the face (the character's `Portrait` at 32 px, or the GM mark: violet, Chakra Petch 12 px capitals in a 32 px square), the GM's online count in VT323 18 px `--text-dim`, and a chevron; open keeps a 2 px cyan base. Labels: "GM menu, N players online" and "Menu, playing {first name}". When the count rises, `warm` the number and `pop` a cyan burst at it (the light `PresenceFace` plays today).
4. `GmTopBar` and `PlayerTopBar` on a laptop: wordmark, sections, `LiveChip` (A2 builds it; render nothing until then), grow, the search icon (`IconButton` "Search, Ctrl K"), `MenuButton`. Remove `TvControl`, `Connected`, `ThemeSwitch`, `SettingsButton` and `Playing` from the bar. Pass `onSignOut` and `onLeave` from `App.tsx` to the bars.
5. `app-bar.css`: remove the screen lamp trigger (36 to 49, 95 to 122, 354 to 357), faces (123 to 135), playing (136 to 151) and theme (344 to 353) rules; add the button's.
6. Tests: `app-bar.test.tsx` 70 to 82 and 171 to 198 (the bar's buttons are now "Search, Ctrl K" and the menu button; Table screen, the online faces, Settings, Theme and Playing are in the menu); a new `frame-menu.test.tsx` (GM rows and order, player rows, Release only with one character, Sign out and Leave confirm first, the Table screen row's actions); `theme-switch.test.tsx` against the menu's Theme. `e2e/smoke.ts` `openGmSection`: Table screen and Settings open the menu first (on a phone, More); update `journeys.spec.ts` 151, 689, 723 and 1043 through the helper.

### A2: the live chip and the live lamp

1. `shell/LiveChip.tsx`: shown while an encounter is live (`state.combat.activeEncounterId`). A lamp (lit while its fight runs, unlit before), the name, and the round in VT323 (`R03`) once the fight has started. For a player whose character acts now, "Your turn" in amber and an amber lamp; read the acting combatant from the same projection field `TableStrip`'s turn tiles read. A link to the table.
2. On the GM's Play page the chip is `LiveScenePicker`'s trigger: give `LiveScenePicker` a `chip` presentation (the chip as its trigger, a chevron, the same menu and dialogs). With nothing live, Play shows the chip with an unlit lamp and "No encounter live". Remove the bar's divider and the old picker trigger from the laptop bar.
3. The bottom tabs: the Play (GM) or Table (player) tab carries a 7 px lamp at the icon's top right while an encounter's fight runs, amber on the player's turn. Its tab label gains ", live" or ", your turn" for screen readers.
4. Tests: a `live-chip.test.tsx` (hidden with nothing live away from Play; the picker on Play; the round; "Your turn" for the acting player only); `live-scene-picker.test.tsx` for the chip presentation; `app-bar.test.tsx` 105 to 114.

### A3: the phone frame

1. `GmTopBar` and `PlayerTopBar` return null on a phone, on every page. Remove `PlayerIdentity` from `PlayerTopBar` (320 to 322) and render it as the first row of the player's table and log pages instead, inside the pane, so it stays their header (area C redesigns it). `pageLight` then finds the page's `[data-horizon]` header; check that each phone header carries it.
2. Every page's first row on a phone is a header: `SectionBar`'s phone header (from T3) for Prep, the Codex, the Compendium and Settings; `TableStrip` on Play; `PlayerIdentity` on the player's table and log; the sheet's own band on Sheet and on a character page. Any other page (the table screen controls, replays, the builder, a not found page, claiming a character) gets a plain `PhoneHeader` with its title: extract it from `SectionBar`'s phone header if T3 did not. List every route in the commit body with its header.
3. Bottom tabs: `SectionTabs` renders the tablist and, after it in the same `nav`, a More button (`aria-haspopup="dialog"`, `aria-expanded`) drawn like a tab with the dots icon. Five equal columns. While its sheet is open, More shows the ink and the chosen tab keeps `aria-selected` but draws no ink.
4. `shell/MoreSheet.tsx`: a sheet anchored above the tabs (`bottom: var(--bottom-tabs-h)`), with a scrim over the pane and the header only, its top edge on the horizon (`OverlayEdge`), a 40 by 4 px grab handle, rows of 52 px: who you are, Search (opens the search dialog), then `FrameMenu`'s rows. Focus moves into it and returns to More; Escape, the scrim and More close it. Build it on the kit's `Modal` or `Drawer` with a modifier class if one fits; it must leave the tabs above the scrim.
5. `styles.css`: `main`'s rows stay; row 1 is empty on a phone. Move `--bottom-tabs-h` to `:root:has(main > .app-bottom-tabs)` so the toast viewport and the sheet can read it.
6. Tests: `app-bar.test.tsx` 116 to 135 (no `.app-bar` on any phone page; the tablist plus More; Settings reached through More); a `more-sheet.test.tsx`; `smoke.ts` `openGmSection` and `playerSection` on a phone; the journeys that pressed the phone bar's Settings or search.

### A4: one search

1. Turn each section's search into a hook that returns rows, without its dialog: `useCodexSearchRows(query)` from `CommandPalette` and `useCodexSearch` (keep the palette's commands as rows after the results when the Codex is the place), `useCompendiumSearchRows(query)` from `compendium/SearchDialog.tsx` (GM only), `useRulesRows(query)` over the glossary read, and `useGoToRows(query, role)` over the sections and pages the bars list today (`GmTopBar` 242 to 250, `PlayerTopBar` 342 to 348) plus the settings index (`searchSettings(settingsFor(role))`).
2. `shell/SearchDialog.tsx`: a Modal (top on a laptop, 600 px; full screen on a phone with Cancel in the field). A 50 px field; under it the kit's `SegmentedControl` of places (Codex, Compendium for the GM, Rules, Go to); the rows of the chosen place (icon, name with the typed part in `--cyan-hi`, a line of what it is), the first one marked as Enter's target. Arrows move, Enter opens, Escape closes and returns focus. Ctrl+Left and Ctrl+Right in the field change the place. The starting place follows `SPEC.md` 2.3. A Rules row opens `RulesReference` at that entry (give it an `entry` prop).
3. One Ctrl K, bound once in `App.tsx`. Remove the bindings in `SearchLauncher` (31 to 41), `CodexFrame` (69 to 87), `CompendiumShell` (67 to 84), `SettingsSearch` (35 to 45) and `FindBox` (58 to 67). The Codex's and Compendium's search boxes in their bars open the dialog at their place; `openSearch=1` opens it too, so old links still work. `FindBox` and `SettingsSearch` stay as the filters of their pages.
4. Delete `SearchLauncher` and its CSS (`app-bar.css` 265 to 306), `CommandPalette`'s Modal and the Compendium's `SearchDialog` Modal once nothing renders them.
5. Tests: `app-bar.test.tsx` 138 to 169 (the dialog "Search"; Ctrl K opens it on every page, the Codex included; the starting place by page; a player has no Compendium place); unit tests for each rows hook (the player's Codex search calls `searchAsPlayer`); the journeys at 968 to 976 (Escape returns focus) and any that opened the Codex or Compendium search through Ctrl K.

### A5: news in the corner

1. Toasts: the viewport keeps the bottom right on a laptop (420 px, 16 px in). On a phone it sits 8 px in from each side, above `--bottom-tabs-h` now that the variable reaches it (A3). Remove `dice/roll-calls.css` 166 to 169, which moved toasts to the top.
2. Reconnecting: `ReconnectBar` keeps its words, WAIT tag and light; restyle it as a band (at least 48 px, `--glass-bg`, the 1 px line it lights). On a phone it is the first row.
3. Roll calls: `RollCallPrompts` becomes the band of `SPEC.md` rule 10: the ROLL tag (amber), what the GM asks for, and the roll button (the check's name and its bonus in VT323 on a 2 px amber base). Answered cards keep their result and Heroic Inspiration reroll until put away, as now. It stays in the pane's first row off the table.
4. Tests: the toast tests that assert placement; `reconnect-light.test.tsx`; the roll-call tests by role and name.

### A6: dialogs and states

1. `useConfirm` and `usePrompt`: Cancel becomes `variant="ghost"`; the action stays the Cup or `destructive` (a danger Base line after T1). On a phone both open from the bottom (`align="bottom"`). The question stays the title; check that each of the 37 confirm calls asks a question in one sentence and fix the ones that do not.
2. Not found (rule 7): `NotFoundView` becomes `EmptyState` (from T5) with "Nothing lives at this address." and one secondary button, Go to the table (`/table` for both roles). Move its styles and `MissingRecordNotice`'s from `codex/codex.css` to `styles.css`, so the page is styled before the Codex loads. Update `shell-navigation.test.tsx:88`.
3. Something broke (rule 8): `AppErrorBoundary` draws `LandingScene` (if it needs no provider; otherwise a copy of its backdrop) with one card: the Eyebrow "Something broke", the title, the message in a box with Copy (`navigator.clipboard.writeText` in the click, falling back to selecting the text) and Reload as the Cup.
4. Loading (rule 9): `lazySurface(load, fallback, name)` passes the surface's name; `SurfaceFallback` shows "Loading the {name}" in `--text-muted` after 400 ms (a timeout, cleared on unmount) and keeps its hidden "Loading" for screen readers. Name each lazy surface.
5. Rules reference (rule 5): `RulesReference` keeps its Drawer on a laptop (it is an `aside`, so the page stays usable) with its title on the horizon edge; on a phone it opens from the bottom. Add the Drawer's bottom side if the kit lacks it.
6. Tests: `feedback` tests for the ghost Cancel and the phone alignment; a not-found test; an error boundary test for Copy and Reload; a `lazySurface` test with fake timers.

### A7: docs and cleanup

1. `docs/DESIGN.md`: Layout (169 to 188) for the One menu bar, the live chip, the phone without a top bar and More; Toast (326 to 329) and Reconnecting (330 to 335) for the corner and the bands; Page patterns (404 to 406) for five bottom tabs; Phones and touch (463 to 487); the Look table's lamp row (43 to 45) for the live lamp.
2. `docs/ARCHITECTURE.md`: the frame (1084 to 1094), the picker (1099 to 1100), `PlayerIdentity` (1108 to 1110), `ToastOutlet` (1121), `CodexFrame` and the settings search (1164, 1177), themes (1187 to 1193: the theme now lives in the menu, More, Device and the landing page), the light (1211 to 1218, 1252 to 1253, 1259).
3. `docs/adr/README.md`: 0049 Accepted and built; 0037's row notes that its bar is changed by 0049.
4. Remove CSS and code nothing uses (`SettingsButton`, `Playing`, `Connected` if fully moved, the launcher, old phone bar rules).
5. `docs/design/polish/CATALOG.md`: A moves to Built.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- Look at the frame as the GM and as a player, in Dusk and Dawn, at:
  - 1280 by 800 with a mouse: the bar holds the wordmark, the sections, the live chip (with and without a live encounter, on Play and elsewhere), search and the menu button; the menu's rows; the search dialog on Play, Prep, the Codex and the Compendium, starting on the right place; a toast in the bottom right; reconnecting (stop the server for a few seconds) and a roll call on a page other than the table.
  - 390 by 844 with touch: every page's first row is its header, with no second bar above it; five bottom tabs; More's sheet above the tabs; the search dialog full screen; a toast above the tabs, not over them; every control at least 44 px; no sideways scroll.
- With reduced motion (the lamps and the presence light change at once) and reduced transparency.
- Keyboard: Ctrl K on every page opens the same dialog; Ctrl+arrows change the place; Escape returns focus; the menu opens and closes from the keyboard.
- Compare against `frame.html` with Who, Page, Moment and Encounter set to each state.

## 7. Left as they are, for their areas

- The table's own header on a phone (`TableStrip`, `PlayerIdentity`) and everything inside the table: area C.
- The sheet's band and menu: D1.
- Arrival and the landing page, which keep the wordmark and a theme switch: area B.
- The table screen controls page (`/viewer-controls`): area H; it shares `TableScreenRows` from A1.
- The Codex's and Compendium's search pages (`SearchView`, the full search with filters): areas F and G.
- Settings' rows for Sign out, Sign out every GM browser and Leave the table stay where they are, besides the menu: area I.
- Every command, projection and stored value.

## 8. Departures from the mockup, on purpose

- The mockup's "Tab: next place to look" becomes Ctrl+Left and Ctrl+Right: Tab keeps its usual job of moving focus, and the places stay a segmented control you can tab to.
- The mockup draws the Table screen row's actions as a list; the app shows the actions `TvControl` offers at that moment (Pause or Show the live encounter, Preview or Hide the preview, settings).
- The mockup's GM online count is a fixed "3"; the app counts claimed characters whose players are online, as `Connected` does.
- The mockup's table and sheet pages are sketches for the frame to sit on.
- The mockup's other options (Tidy, Live line, Header icons, Face menu, Doors, Palette, From the horizon, Status line) are the ones turned down.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `frame.html`.

- `p4b-frame.css`: the bar's pieces (`.live-chip`, `.me-btn`, `.online`), the menu and sheet (`.menu`, `.sheet`, `.who-row`, `.mrow`, `.msub`), search (`.srch`, `.sfield`, `.scopes`, `.srow2`, `.keys`), news (`.toast.corner`, `.band.call`, `.band.wait`, `.rollbtn`), the phone (`.ap-bottom.five`, `.btab .lamp`) and the settled cards' drawings (`.mini`).
- `p6-frame.js`: `topBar()` and its option branches, `liveChip()`, `meBtn()`, `menuRows()`, `searchOv()` with `scopeNow()` and `RESULTS`, `underBar()`, `phone()`, `laptop()`, and the settled rules in `renderStatic()`.
- `p4-spec.css`: the theme spec's parts the pages are drawn with (the Titled bar, Cradle groups, Base line controls).
- `audit-a.js`: the "Today" crops from the branch.
