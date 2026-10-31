# C3, first round: building the GM's panel and what waits on the GM

Written on 2026-10-29 for `marcsfsh/OzyVTT`, branch `claude/friendly-babbage-g7gcge`, read at `f5e166f` ("Horizon update
U6: ADR-0046 and the handoff"). This plan rebuilds what waits on the GM (today's Needs you) as a list over the turn or
in its own tab, draws its items as cards, gives the panel's tabs unread counts, and replaces the words Needs you with a
bell everywhere. It adds no rules, commands, routes or data; one server toast changes its words. File paths and line
numbers were read at `f5e166f`; the theme (T), the frame (A) and the table's frame (C) land on the same branch first or
alongside, so confirm every anchor before editing. Paths are under `apps/client/src/` unless they start with `apps/`,
`packages/`, `e2e/`, `docs/` or `README.md`.

This is C3's first round in `../CATALOG.md`. `SPEC.md` beside this file is what was decided; this plan is how to build
it.

## 0. How to use this plan

- Read `SPEC.md`, then sections 1 to 4 here, before touching code. Section 5 is the work in six phases, Q0 to Q5, each
  about one commit.
- The reference is `gm-panel.html` in this folder. Open it in a browser (fonts load from Google Fonts; everything else
  is inline). It opens on the approved choices. Use the Page switch (Two waiting, Four kinds waiting, On the Log tab,
  Where the signal shows). In the frames, press the panel's tabs and the phone's Switch to see their counts drop, and
  Own tab or Over the turn in the list's head to move the list. The other options in the decision switches are the
  ones the owner turned down; build only the chosen ones. `history/` holds round 1 as it was shown.
- The mockup is the reference for layout, spacing and type. Its CSS and JS are mockup code; its fight is a stand-in.
  Build with the existing components, hooks and primitives. Section 8 lists where the plan departs from the mockup on
  purpose.
- The user's preferences for anything they read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's
  not X, it's Y" sentences, and avoid the words "genuinely" and "seriously". The Writing section of `docs/DESIGN.md`
  applies on top, and `writing.test.ts` checks it; `play-vocabulary.test.ts` pins some of the words this plan changes.

## 1. What the user decided

Section 2 of `SPEC.md` has the detail. In short:

1. The waiting list sits at the top of the Encounter tab, every item whole, or in its own first tab; the GM switches
   between the two from the list's head or Settings' Device section.
2. Each item is a card with today's words and buttons.
3. The panel's tabs are words with counts; a count is what arrived since the tab was last opened, and opening it drops
   the count.
4. The signal is a bell with its count, everywhere something waits on the GM; the words Needs you go.
5. Nine rules (`SPEC.md` section 3).

## 2. Rules that bind this work

- The branch is shared. Other sessions commit on `claude/friendly-babbage-g7gcge`. Fetch and pull before each phase and
  again before each push. Keep commits small and scoped to one phase. Never force-push, rebase or amend anything already
  pushed. If a pull conflicts in a file this plan touches, stop and ask the user before resolving it. A checkout of the
  branch may sit behind origin (one surveyed for this plan was 26 commits behind), so pull before reading any anchor.
- This builds on T1 to T3, on the table's frame C1 (the workbench and its panel), C2 (the Ladder) and C5 (the phone
  Switch), and for Q4 on A2 (the live chip). If one is missing, stop at the phase that needs it and tell the user. The
  Settings row (Q1) goes in today's `DeviceSection` if I has not landed, and moves with it if it has.
- CLAUDE.md applies in full. What waits on the GM comes from the GM's view (`needsItems` in `table/needs.ts` 46 to 87,
  from `pendingSaves`, `pendingReactions`, `pendingDamage`, `pendingRuleAsks`, `pendingInitiative`, `damageRolls`,
  `targetAsks`, `turnSteps` and `rest.requests`); who may answer and what each button sends do not change. No shared
  domain, schema, command, projection or route changes. The one server change is the words of the long rest toast in
  `apps/server/src/commands/resting.ts` 163 to 171. If a step seems to need more, stop and tell the user.
- `docs/DESIGN.md`: the page never scrolls; every control keeps a 44 px hit area.
- Run `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build` and `npm run smoke` before
  calling a phase done, and look at the table as section 6 says (the `verify` skill has the steps).

## 3. What is on the branch now

### 3.1 The panel

- `encounter/GmEncounterPanel.tsx`: the tabs (654 to 672: Encounter `fight`, Order on a phone in a fight, Log, Party,
  Notes when its slots are given, Token while a token is chosen), the label "The encounter · round N" or "The table"
  (684), the remembered tab per device `vtt.table-tab.gm.phone|laptop` (674 to 679, `table/TablePanel.tsx` 102 to 125),
  the Encounter tab's count `.table-tab-count` with ", N waiting on you" for screen readers (605 to 615, the count from
  `shell/TableView.tsx:170`), the Encounter tab in a fight (616 to 627: Needs you, `ActingConsole`, and on a laptop the
  "Turn order and tools" details) and before one (628 to 633: Needs you, `StartFight`), the foot (554 to 600, 689 to
  694). The comment at 82 is stale.
- `table/TablePanel.tsx`: the light that runs to Log when a line arrives on another tab (43 to 58), the foot slot (88 to
  93). Needs you is not passed as the `top` slot, so it shows on the Encounter tab only (`panel-tabs.test.tsx:144`).
- CSS `table/table-panel.css`: dead `.table-panel > .needs-you` rules (12 to 17, 132 to 135), the tabs (21 to 50, 151
  to 156), the foot (72 to 120, 158 to 166), `.table-tab-count` (168 to 180).

### 3.2 Needs you

- `table/needs.ts` `needsItems` (46 to 87) pushes, in order: order (`turnSteps`), reaction, save (without a `callId`),
  target, damage, damage-roll, dying, ask, initiative, rest. Nothing re-sorts them.
- `table/NeedsYou.tsx`: each item's title and line (the words are listed in `SPEC.md` 3.4 and in the code), the tones
  `li.needs-card--{caution|info|danger|gm}` with `data-needs={kind}`, an item waiting on a player hidden behind "Answer
  for {name}" (68 to 77), the shell `section.needs-you` with `h2` IconBell "Needs you · N" (360 to 409; nothing renders
  when empty), the polite announcement "Needs you: {newest title}." (373 to 386). Mounted only from
  `shell/TableView.tsx:169`.
- The items' bodies: `encounter/PendingDamagePrompt.tsx` (Apply N, Change, Dismiss → `damage:resolve`),
  `DamageRollPrompt.tsx` (Send the damage → `damage:report`), `RuleAsk.tsx` (`PendingAsksForGm` 94 to 146 is not
  mounted; the GM's Allow and Deny are in `NeedsYou` → `rules:answer`), `ReactionPrompt.tsx`, `SavePrompt.tsx`,
  `DyingTracker.tsx`, `StabilizeControl.tsx`, `TurnOrder.tsx`, and the shared `RollControls.tsx` (241 to 386).
- CSS `table/needs-you.css` (1 to 88: the section with max-height 45%, the magenta heading 12 to 25, the 3 px rims 33 to
  49, the buttons 65 to 74), `encounter/prompts.css`, `encounter/rule-ask.css`.

### 3.3 The words Needs you

- Client: `table/NeedsYou.tsx` 378, 391; `encounter/GmEncounterPanel.tsx:611` ("waiting on you");
  `settings/table-words.ts:62` (`TARGETING_HELP.gm`, shown at `settings/FightsSection.tsx:156`);
  `encounter/ActingConsole.tsx:96`; `encounter/ActionResultCard.tsx` 108, 111, 188, 191, 274;
  `compendium/OverviewView.tsx` 80 to 82, 144 to 146 ("Needs you", "Nothing needs you. Every record is published as
  written."). Comments: `GmEncounterPanel.tsx` 53, 82, `DamageRollPrompt.tsx:20`, `GmInitiativeRow.tsx:94`,
  `TablePanel.tsx:31`.
- Server: `apps/server/src/commands/resting.ts` 163 to 171 ("Answer it under Needs you on the Table."). `README.md:166`.
- If G (the Compendium) has landed, its shelves' strip carries Needs you too (G `SPEC.md` 2.1); it takes the bell.

### 3.4 Tests that pin it

- `table/needs-you.test.tsx`: the region `/Needs you · 4/` (94), titles and lines (95 to 102), Apply 9, Allow, Change
  and Apply 12 with their commands (112 to 130), "Waiting on Lyra · Shield" and Answer for Lyra (173 to 177), the order
  `["damage","dying","ask","rest"]` (181), nothing when empty (195), the target ask (232 to 249).
- `table/panel-tabs.test.tsx`: "Encounter2, 2 waiting on you" (113), the laptop tabs (128), the Encounter tab's
  contents (131 to 136), Needs you hidden on Log and the localStorage key (144 to 145), the phone's Order tab (162),
  between fights (174 to 181).
- Others: `damage-roll-prompt.test.tsx` 30 to 45, `rule-ask.test.tsx` 93 to 106, `scene/attack-light.test.tsx` 183 to
  198, `turn-order.test.tsx` 35 and 45, `stabilize-control.test.tsx` 37 and 55, `reaction-prompt.test.tsx` 43 to 130,
  `triggered-prompt.test.tsx` 48 to 69, `save-gm-applies.test.tsx` 33 to 38, `scenes/scenes-tab.test.tsx:80`,
  `apps/server/test/game-clock.test.ts:180`, `play-vocabulary.test.ts:162` (a pinned sentence), `writing.test.ts`.
- e2e: `journeys.spec.ts` 270, 278 to 282, 287, 863, 962 to 966, 1061 to 1062 (tabs and the start of a fight); none
  reads Needs you.

## 4. The design

`SPEC.md` sections 2 to 4 hold the design and its values. The parts to build:

| Part | New or changed | Built from |
| --- | --- | --- |
| The waiting list | Changed: never squeezed; a switch in its head; words become the bell | `NeedsYou`, `needs-you.css` |
| Its own tab | New, by the GM's choice | `GmEncounterPanel` tabs, `TablePanel` |
| The place preference | New, per device | `settings/preferences.ts`, `DeviceSection` |
| Cards | Restyled | `NeedsYou` items, the prompts inside them |
| Tab counts | New: unread since last opened | `TablePanel`, the log, Notes' entries |
| `AttentionBell` | New, one component for every place | `.table-tab-count`, the lamp light (ADR-0045) |

How the parts fit, so the phases agree:

- The place preference is `waitingList: "turn" | "tab"` in `settings/preferences.ts` beside `vtt.auto-arrange`, kept in
  localStorage `vtt.waiting-list` (read and write in try and catch; default "turn"), with a hook the panel and Settings
  share.
- With "turn", the Encounter tab renders the list first, then the turn, in one column where the list takes its natural
  height up to half the panel (then it scrolls) and the turn scrolls under it. With "tab", the panel's tabs start with a
  tab whose label is the bell and its count (its accessible name "Waiting, N"), holding the list alone; the Encounter
  tab is the turn alone. The remembered tab still applies; if the remembered tab is the list's tab and the GM moves the
  list back, the panel shows Encounter.
- Unread counts: the panel keeps, per device, the last count it saw on each counted tab (`vtt.table-tab-seen.gm`:
  Log's entry count, Notes' entry count). A tab shows the difference while it is not open; opening it stores the
  current count. Log counts its lines in the encounter's log; Notes counts Tonight's items and the Codex tab's entries
  it already lists. Party and Token carry no count. The light that runs to Log stays.
- `AttentionBell({ count, burst })` draws the bell with its badge (`SPEC.md` 4), `aria-label` "Waiting, N" when used
  alone, and lights once with the lamp's burst (ADR-0045) when the count rises. It renders nothing at 0. Its count is
  `needsItems(state).filter(owed).length`, where owed leaves out items waiting on a player (`NeedsYou` 68 to 77 marks
  them today).
- Waiting-on-player items move after the GM's own; within each, today's order holds.
- The screen reader announcement keeps its politeness and becomes "Waiting: {newest title}."

## 5. Phases

### Q0: install the handoff and the decision

1. Update `docs/design/polish/` from the zip: replace `README.md` and `CATALOG.md`, add `C3-gm-panel/`, and leave the
   other pieces' folders as the zip has them.
2. Add `C3-gm-panel/ADR-0058-gm-panel-and-attention.md` as `docs/adr/0058-gm-panel-and-attention.md`, Accepted, and its
   row to `docs/adr/README.md`. Note on the row of 0025 that its Needs you is changed by 0058 (its lines 40 to 45 and 76
   to 77 were already stale). Leave any missing earlier numbers free; do not renumber.
3. Run the full checks and record any failure that was already there.

### Q1: the list's place and the switch

1. The preference and its hook (section 4).
2. The Encounter tab with "turn": the list first, never squeezed (replace the 45% max-height with half the panel and
   let the turn below scroll on its own); with "tab": the list's own first tab, and the Encounter tab without it.
3. The switch in the list's head: a Base line control "Own tab" (with a chevron) or "Over the turn" that writes the
   preference and shows the other place.
4. Settings, Device: a GM-only row "Waiting list", hint "Where what waits on you shows on the Table: over the turn, or
   in its own tab.", with "Top of Encounter" and "Its own tab" as Base line options. Add its entry to
   `settings/sections.ts` (`audience: "gm"`, words "needs attention queue waiting list tab").
5. A phone: the same two places in the Switch's Encounter view or as a first choice of its own.
6. Tests: `panel-tabs.test.tsx` (the list over the turn by default; with "tab", the first tab holds the list and
   Encounter does not; the switch moves it; the remembered tab falls back to Encounter), `settings-page.test.tsx` and
   `settings-groups.test.ts` for the new row (not in a player's list).

### Q2: the cards

1. Each item as a card (`SPEC.md` 2.2 and 4): the face, the title, the line, the buttons with the main one lit; the
   ruling's violet rim and the waiting grey rim kept; the prompts inside items keep their controls (C3's second round
   designs them).
2. Waiting-on-player items after the GM's own (section 4).
3. Tests: `needs-you.test.tsx` (titles, lines and commands hold; a waiting item sorts after an owed one; 181's order
   holds when none waits), the prompts' own tests unchanged.

### Q3: tab counts

1. Unread counts on Log and Notes (section 4), drawn after the word in quiet VT323; none on Party and Token. On a phone
   the Switch's choices carry them.
2. The Encounter tab's `.table-tab-count` gives way to `AttentionBell` (Q4 draws it; until then keep the count).
3. Tests: `panel-tabs.test.tsx` (three new log lines show 3 on Log; opening Log drops it; a new line after shows 1; the
   count survives a reload on the same device).

### Q4: the bell, everywhere

1. `AttentionBell` (section 4) in `packages/ui` beside the lamps, or in `table/` if nothing outside the client needs it.
2. Places: the list's head (in place of "Needs you · N"), the Encounter tab or the list's own tab, the acting row in the
   Ladder when its creature has items (the count of its items), the top bar's live chip while the GM is on another
   section mid-fight (A2), a phone's Play tab and the Switch's choice with the list, a long rest to approve between
   fights, and the Compendium's home over the records that need the GM.
3. The words: `table-words.ts:62` ("Players tap an action and it waits for you in the list over the turn. You pick the
   target, then it resolves."), `ActingConsole.tsx:96`, `ActionResultCard.tsx` 108, 111, 188, 191 and 274 (name the list,
   "the waiting list"), `OverviewView.tsx` 80 to 82 and 144 to 146 (the bell, and "Nothing waits on you. Every record is
   published as written."), the server toast in `resting.ts` 163 to 171 ("{name} asks for a Long Rest. Answer it in the
   waiting list on the Table."), `README.md:166`, the announcement (section 4), and the comments in section 3.3.
4. Tests: `needs-you.test.tsx` 94 (the region is named "Waiting, 4"), `panel-tabs.test.tsx` 113 (the tab reads
   "Encounter, 2 waiting"), `play-vocabulary.test.ts:162`, `apps/server/test` for the toast if one reads it, and a test
   that the bell renders nothing at 0 and bursts once when the count rises.

### Q5: docs and cleanup

1. `docs/DESIGN.md`: the GM's sidebar (199 to 203), the pending card (305 to 308), rule 6 "Waiting is still" (360 to
   361), "Decisions owed wait in one place…" (421): the list's two places, the bell, the counts.
2. `docs/ARCHITECTURE.md`: 1098 to 1104 (the tabs, the list's place, the counts), 880 to 888 and 894 to 898 where they
   name Needs you.
3. `docs/adr/README.md`: 0058 Accepted and built. `docs/design/polish/CATALOG.md`: C3's first round moves to Built.
4. Remove what nothing uses: the dead `.table-panel > .needs-you` rules, the 45% rule, the stale comment at
   `GmEncounterPanel.tsx:82`. Leave `PendingAsksForGm` for C3's second round to decide.

## 6. Verification for every phase

- `npm run lint`, `npm run check`, `npm test`, `npm run format:check`, `npm run build`, `npm run smoke`.
- With a fight running and items waiting (a player's hit to apply with Players' hits "Applied by the GM", a target to
  choose with Who picks targets "The GM", a rule ask, and a save waiting on a player), look in Dusk and Dawn at:
  - 1280 by 800 with a mouse: the list over the turn with every card whole and the turn scrolling under it; Own tab and
    back; Settings' row doing the same; the counts on Log and Notes rising and dropping; the bell on the tab, the list's
    head, the acting row and the live chip from Prep; answering each item and the bell counting down; between fights,
    a long rest to approve.
  - 390 by 844 with touch: the Switch with its counts and bell, the list in Encounter and as its own choice, every
    control at least 44 px, no sideways scroll.
- With reduced motion (the bell's burst stays still) and reduced transparency.
- Every behaviour in section 3 still reachable: each item's buttons and commands, Answer for {name}, the reaction and
  save prompts, death saves and stabilizing, the order of what happens, Roll for the rest, Approve and Not now.

## 7. Left as they are, for C3's second round

- The prompts' own controls, starting an encounter (C3.3), the row tools (C3.6), the options menu (C3.7), adding
  monsters (C3.8), and the Notes, Token and Party tabs' contents (C3.9 to C3.11).
- Every command, projection, HTTP route and stored value.

## 8. Departures from the mockup, on purpose

- The mockup draws Party with no count and Notes with 2 and Log with 3; the app counts what arrives.
- The mockup's list switch says Own tab and Over the turn; the Settings row the mockup does not draw is section 5's.
- The mockup draws four kinds; the app's list has today's ten.
- The mockup's fight and its words for the stand-in ruling and save are stand-ins; the app keeps today's words.

## 9. Where each idea lives in the mockup

The mockup is built from `mockup-src/` by `sh mockup-src/build.sh`, which writes `gm-panel.html`.

- `p4l-c3.css`: the bell (`.k-sig.bell`), the list over the turn (`.k-zone`, `.k-lhead`, `.k-place`), cards (`.k-card`,
  `.k-btn`, `.k-btn.main`), the tabs with counts (`.k-tabs`, `.k-c`), the phone's Switch (`.k-segs`), and the signal
  board (`.k-board`, `.k-spec`). The other options' parts sit beside them. `p4c-table.css` is C's approved frame.
- `p6-head.js`: the table frame ported from C (`topBar()`, `ord()`, `turnBody()`, `tools()`), the fight's data (`C`),
  and the state.
- `p6-body.js`: `sig()` (the `bell` branch), the items (`IT`) and `card()`, `listHead()` with the switch, `tabDefs()`
  and `tabsRow()` with the unread counts, `gmPanel()` (the `top` and `tab` places), `phoneTable()`, and
  `signalPage()`.
- `p6-dec.js`: the decisions and the rules. `p2b-mobile.css` and `p6-tail.js`: the mockup page's own phone bar, laptop
  view and the in-frame clicks (`data-tab`, `data-place`); mockup code only.
- `audit-c3.js`: the "Today" screenshots and the map.
