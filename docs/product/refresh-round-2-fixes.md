# Refresh round 2 — phase 4 fix plan

**Status:** planned 2026-08-07, not started. Written from three adversarial QA passes (phase 3), with
**every finding re-measured before it was scheduled**. Two implementation lanes, provably disjoint
file sets, no merge step.

**Read `docs/product/refresh-round-2-decisions.md` before touching anything here.** Its acceptance bar
governs the ranking below, and a ruling there beats a recommendation anywhere else — including one
written by the director in this same round, and including a rationale comment sitting in the code.

---

## Why this document exists in this shape

Phase 3's reviewers found real defects and also reported several that did not survive contact with a
measurement. Two were disproved outright before this plan began (the table sky, probed for as a
`.pane-sky` element when it is painted as background layers on `.table-layout`; and six
"border-radius: pill survivors" in the encounter panel, of which one was actually round). **A plan
that schedules work for a defect that does not exist is worse than no plan** — two agents spend a wave
on it and report success.

So §1 is the verification table, and nothing reaches a lane without a line in it.

**Three findings changed under measurement.** Where the measurement disagrees with the finding as
written, the measurement wins and the row says so.

---

## §1 — Verification table

Measured 2026-08-07 against the running dev server (client `:5173`, API `:3001`), Chromium 1194, GM
signed in per session (navigate first, then "Enter as GM" — the token is memory-only). A fight was
active on `/table` throughout.

| # | Finding | Verdict | The measurement that decides it |
|---|---|---|---|
| 1 | GM cannot end a fight on a landscape phone | **CONFIRMED** | `/table`, GM, in combat. **844×390**: `.encounter-menu` inline `max-height: 0px`, box **24px** tall (`clientHeight` 22) over **`scrollHeight` 1028**. Scrolled to its own bottom, "End the fight" rect y=355 h=39 → `elementFromPoint` returns **`DIV.encounter-menu-backdrop`**, `isSelfOrChild: false`. **667×375**: identical — `max-height: 0px`, 24px, backdrop hit. Cause reproduced at `EncounterPanel.tsx:695-703`: `top = Math.min(rect.bottom + gap, innerHeight - margin)`, then `maxHeight = max(0, innerHeight - top - margin)`. At 390 tall the button's bottom is 382, so top=382 and maxHeight=0. **No upward branch exists.** |
| 2 | "Next turn" already scrolled out on arrival | **CONFIRMED — and the cause is two things, not one** | **844×390 on arrival**: `.dock-tabs-body` `scrollTop: 93` of max 103, `clientHeight: 78`. Turn row rect 282→326; scroller client top **326** → the row sits **44px above the scroller's own top edge**, i.e. fully clipped. `elementFromPoint` at the Next-turn centre → **`DIV.nh-tabs.nh-tabs--horizontal`** (the dock's head strip), `reachesSelf: false`. **Second, independent cause found:** `.dock-tabs-body` spans 326→**404** in a **390px** viewport, so its last 14px is off-screen. Forcing `scrollTop: 0` puts the row at 375→**419** — centre outside the viewport, `elementFromPoint` returns **null**, still unreachable. Reachable only in the band `scrollTop ≈ 20–60`. **A fix that only stops the auto-scroll leaves the button unreachable at rest.** 667×375 identical. 390×844 and 320×568 fine (`scrollTop: 0`, max 0). |
| 3 | Same cause at 320×568 | **CONFIRMED** | `max-height: 94.81px`, `clientHeight: 93`, `scrollHeight: 1028` → **9.0%** of the menu visible at a time. Operable: "End the fight" hit-tests to **`BUTTON.encounter-end`**, `isSelfOrChild: true`. |
| 4 | `⋯` has `title` but no `aria-label` | **CONFIRMED** | `EncounterPanel.tsx:977` — `title="Fight options - rules assistant, environment, roster, end"`, no `aria-label`. Accessible-name dump on `/table` shows `⋯ \| aria=`; its sibling `+` at `:976` has `aria-label="Add monsters to this fight"`. |
| 5 | `partyVisibility` does not remove the party surface | **CONFIRMED** | `main.tsx:709-710` mounts `PartyStrip` on `!previewScene && !state.combat.active && (mode === "gm" ? … : playerHasClaimed ? … : null)` — **no reference to the tier**. `grep -rn partyVisibility apps/client/src` → 2 files (`actors/MyCharacter.tsx`, `settings/SettingsPage.tsx`); `PartyStrip` is not one. `PartyStrip.tsx:49` renders `hpLabel(actor.hp)` in a visible `.party-strip-hp` span **and** in each row's `aria-label`; `actor-display.tsx:27-30` returns exact HP for any actor whose `hp` has no `kind` field — which the projection's own field table (`projections.ts:171`) marks **Y at `off`** for a PC. Contradicts three written promises: `SettingsPage.tsx:89` ("no party list"), `game-operations.ts:119` (the GM-only audit line) and `projections.ts:188-189` ("`off` is … NO PARTY SURFACE"). **The projection itself is correct** — this is a client-side leak of a tier the server applied. **No client test exists**: `grep -rln "partyVisibility\|PartyStrip"` across client tests returns nothing; the server has `apps/server/test/party-visibility.test.ts`. |
| 6 | `PartyStrip` doc comment states a false reason | **CONFIRMED** | `PartyStrip.tsx:20-21` says "the projection carries no definition for anyone else's character". `projections.ts:174` marks `definition` **Y at `full-sheet` and `sheet-and-resources`**. Behaviour is safe (stricter than the tier allows); only the stated reason is false. |
| 7 | The `off` audit line overstates what is withheld | **CONFIRMED** | `game-operations.ts:119`: "Players no longer see anything of each other's characters beyond the tokens on the map." `projections.ts:166-171` marks `armorClass, initiative, speedFeet`, `definitionId, conditions, deathSaves` and `hp (exact for a PC)` as **Y at `off`**. Deliberate and documented; the copy is what is wrong. → **client decision, §5.** |
| 8 | Ruling 58 broken at the Codex page tree | **CONFIRMED** | `/codex/pages`, GM, 1280×900: **7 tree rows, 6 carry `.nh-reveal-mark`, 1 does not** — "Recon measurement page", `svgCount: 0`, no reveal element of any kind. Cause at `NotebookTree.tsx:172`: `{page.revealedToPlayers && <VisibilityBadge revealed />}` — gated on the value being **true**. Every other call site renders unconditionally with `revealed={…}` (`PagesView.tsx:216`, `QuestsView.tsx:110`, `SessionsView.tsx:104`, `SessionConsole.tsx:64`); `TagView`/`CampaignHome` guard only on the field being **defined**, which is a different and legitimate guard. So on the page tree a GM cannot distinguish *hidden from players* from *no reveal state*. Ruling 58 calls this a **safety property**. |
| 9 | Ruling 21 (`.sign`, chrome metal) never built | **CONFIRMED** | `.sign` is defined once (`design-tokens.css:1242`) and has **one call site in the repo: `StyleGuide.tsx:1574`**. Roster, Scenes, empty states, not-found and the builder gate carry none. → **not scheduled, §6** — see the reason there. |
| 10 | Ruling 2 (rest glow) partial | **CONFIRMED** | `.rim-lit` has **zero app call sites** — defined at `design-tokens.css:1016/1051`, used only at `StyleGuide.tsx:1510`. The glow ships at **four** places via `filter: var(--rim-glow)`: `codex.css:1636` (`.codex-main-empty`), `encounter-panel.css:995` (`.sheet-header` — ruling 45's hero header), `replay.css:127` (`.replay-stage-missing` — an error surface), `character-builder.css:189` (`.cb-level-gate` — the builder gate). Of ruling 2's five named hero surfaces, **Roster, Scenes and not-found have none**. |
| 11 | Ruling 24 pill survivors | **CONFIRMED, with one item removed** | Live at 1280×900: **`.roll-badge` — 30 instances, all `border-radius: 999px`, all visible, 83×19**, on `/table`'s roll log (dock → Dice section). `.codex-graph-legenditem` — 2 instances, `999px`, **54×44, a real tap target**. Source-confirmed with **no later override in the same file** (checked; the encounter-panel trap does not recur): `.party-strip-entry` (`styles.css:803`, live component, renders out of combat), `viewer.css:191/219/231`, `NameField.css:20` (`.nh-namefield-suggestion` — a chip), `Combobox.css:11` (`.nh-combobox-chip` — a chip, where `Chip.css:15` is already `border-radius: 0`). `design-tokens.css:491`'s comment still licenses "status pills, chips", contradicting rulings 10/24. **REMOVED: `Combobox.css:28`.** That is `.nh-combobox-clear`, a 20×20 remove ✕ — the exact analogue of `.nh-chip-remove`, which `Chip.css:54-57` **protects by name** ("The remove ✕ STAYS ROUND … the same family as the dot and the swatch the same ruling protects"). Not a survivor. |
| 12 | Ruling 47 missed `/replays` | **CONFIRMED** | `/replays`, GM, 1280×900: **7 `.nh-card.replay-row`**. The element's own border is transparent — **the card chrome is on `::before`**: `content: ""`, `inset: -1px`, `background-color: rgb(22,17,43)` (a fill) and `border: 1px solid rgb(46,42,78)` = `--line`. So each row is a **filled box with a full four-sided rim**. Ruling 47 names replays explicitly. The `RULING 47` comment at `replay.css:66-67` correctly covers the *viewer's* side lists (converted); the replays *list* 15 lines below is kept as cards on purpose (`replay.css:81-84`, `ReplayPanel.tsx:442-444`). **The comment makes it read as done.** |
| 13 | Ruling 28 — one nested material texture | **CONFIRMED** | `/settings`, 1280×900: `.api-reference` `closest(".settings-group")` → `settings-group settings-group--table surface-glass`. **Both `::before`s compute `repeating-linear-gradient(…)`.** Ruling 28: nested panels keep rim and bezel, drop the scanline fill. |
| 14 | Rulings 55/56 partial | **CONFIRMED, with the count corrected** | `/settings`: the credentials empty state is `.nh-empty` with **`border-style: dashed`**, an emoji icon (`🔌`), the title "No credentials yet" and **`hasButton: false` — no door element at all** (the instruction is body text). Ruling 55 retires all three: no dashed boxes, no "nothing here yet", one door each. The dashed border is **global** — `patterns.css:33`, `border: 1px dashed var(--line-strong)`, with 6+ call sites. `/codex`: **5 cards measured, 4 have no door** (`.codex-dashcard-empty` ×4: "No party pin yet…", "No deadlines yet.", "No downtime waiting for confirmation.", "Nothing tagged yet."); the fifth, `.codex-console-empty`, **does** have one. QA3 said five; it is four. |
| 15 | Revised ruling 23 is inverted | **CONFIRMED, exactly as stated** | `/settings`: all three `.settings-group`s carry `.surface-glass` **and** the material (`::before` = `repeating-linear-gradient`), and **`backdrop-filter` computes `none`** — the class rides along doing nothing. `/viewer-controls`: both `.viewer-col`s compute **`blur(8px) saturate(1.15)`** — a real blur — with **no material** (`::before` background `none`, no `rim`/`bezel`/`chamfer`/`cue` class). Revised ruling 23: `.surface-glass` stays *until the material replaces it*. The sites it has replaced still wear it; the sites it hasn't are the only ones where it works. |
| 16 | Mobile — badge overlaps `CODEX`, `SETTINGS` cut | **PARTLY WRONG** | Player, 390×844, first screen after joining. Range-measured: the text run **"Codex" ends at x=297.1**; the `.nh-badge` box **starts at x=297.1**. **Overlap is exactly 0px — and so is the gap.** The tab's `scrollWidth === clientWidth`, so nothing inside it is clipped. The real defect is **zero separation**, not an overlap. `SETTINGS`: rect x=369→468 in a 390px viewport → **21px of 99px visible**, but `textClipped: false` and the strip is `.nh-tabs--horizontal.is-scrollable` (484px of content, scroll-snap) — it is *scrolled*, not *cut*. |
| 17 | Tray tap-to-place has never worked | **CONFIRMED — paired before/after** | GM, `/table`. **Mouse click** on the first `.tray-token`: tray count **9 → 9**, and the `click` event's target was **`.encounter-map-interaction`**, not the chip — the chip's own capture-phase listener never fired. **Touch tap** (`touchscreen.tap`): **9 → 9**. **Keyboard Enter** on the focused chip: **9 → 8, placement worked.** Mechanism: `.encounter-map-interaction` is the root wrapper carrying `onPointerDown={beginGesture}` (`EncounterMap.tsx:559`); the staging tray is **inside it** (`:565`, confirmed `inter.contains(chip) === true`); each chip carries `data-token-id` (`:570`); `beginGesture` reads `target.closest("[data-token-id]")` (`:387`) and, for `tool === "select"` with a known token (`:395-397`), calls `event.currentTarget.setPointerCapture(...)` — **capture lands on the wrapper, so the click retargets there** and `onClick={() => placeAtCenter(...)}` never runs. Enter works because a focused `<button>` dispatches its click directly. The tray's own copy promises this: `EncounterMap.tsx:566` and `StagingTray.tsx:88`. |
| 18 | Tray first row 5px behind the tab bar | **CONFIRMED** | **On a clean load** at 844×390: `.frame-tabbar` 0→44, tray 30→144, first chip row **39**→83 → **5px hidden**, and `elementFromPoint` at the chip's top edge returns **`BUTTON.nh-tab`**. *(An earlier reading of this showed 0px — it was taken after the keyboard test had placed a token and reflowed the tray. The clean measurement is the one that counts.)* |
| 19 | Ruling 22's dated reversal is missing | **CONFIRMED** | `docs/ai-ledger/decision-log.md` has **no entry dated later than 2026-08-04** (grep for `2026-08-0[5-9]`/`2026-08-1[0-9]` → no matches). The no-sky half stands unqualified at `:1470-1476` and says in terms: "it is a director ruling and **must not be 'fixed' later** by an agent reconciling the two." |
| 20 | `current-state.md` still says "decided, not started" | **CONFIRMED** | `docs/ai-ledger/current-state.md:130` — "**Refresh round 2 — decided, not started (2026-08-06).**" The three product docs were corrected (`plan` / `decisions` / `lanes` all read "waves 1-5 landed 2026-08-06; phase 3 QA in progress"). |

### Tally

**18 confirmed outright** · **1 confirmed with its scope corrected** (11 — one of eight items removed;
14's count corrected from five to four) · **1 partly wrong** (16 — no overlap exists; a spacing defect
does) · **0 stale** · **0 not reproducible**.

Phase 3's reviewers were substantially right this round. The three corrections are recorded above and
carried into the lanes.

---

## §2 — Severity, ranked against the acceptance bar

The bar is three tests and the first is **"a session runs on a phone with nothing in the way."**
Anything that stops a GM running a fight on a phone outranks everything else here, regardless of how
interesting the defect is.

**P0 — direct hits on acceptance test 1.** A GM on a landscape phone cannot end a fight (1), cannot
advance a turn (2), and cannot place a staged token by tapping it on any pointer device (17). Each of
these is a session-stopper on the exact hardware the bar names.

| Rank | # | Why it ranks here |
|---|---|---|
| **P0** | 1, 3 | The fight-options menu is a 24px box at landscape. Rules assistant, health display, add-monsters and end-the-fight are all behind it. 320×568 is the same bug at 9% visibility. |
| **P0** | 2 | "Next turn" — the everything-else-follows control — is unreachable at rest *and* after the auto-scroll at 844×390 and 667×375. |
| **P0** | 17 | Tap-to-place is the touch route the tray's own copy promises. It has never worked on mouse or touch. On a phone there is no keyboard, so the tray has **no** working tap path. |
| **P1** | 5 | A privacy tier the GM set is honoured by the server and then undone by the client. Not a projection breach — the boundary holds — but it defeats the setting and contradicts three promises the GM reads. |
| **P1** | 8 | Ruling 58 is a stated safety property: reveal is where a GM misreading state leaks to the table. One row in seven carries no mark at all. |
| **P2** | 18, 4 | Mobile reach and an unnamed control. Small, cheap, on the phone path. |
| **P2** | 12, 13, 14, 15, 11, 10 | Ruling delivery. Real, verifiable, mostly one-line. None blocks a session. |
| **P2** | 16 | Reduced to what measurement supports: a 0px gap. |
| **P3** | 6, 19, 20 | Documentation truth. 19 and 20 are owed by the director (§7). |

---

## §3 — Lane A: "the phone can run a fight"

**Owns the interaction and layout logic of the encounter panel and the map surface.** This is the
smaller file list and the larger job — the three P0s live here, and each needs a four-viewport
verification pass.

### Files owned by Lane A — no other agent may touch these

```
apps/client/src/encounter/EncounterPanel.tsx
apps/client/src/encounter/encounter-panel.css
apps/client/src/scene/EncounterMap.tsx
apps/client/src/scene/encounter-map.css
```

Plus **one new colocated test file** under `apps/client/src/encounter/`, named for the menu-placement
behaviour it covers (A1). Colocated `*.test.tsx` is this repo's convention.

`encounter-panel.css` also defines `.dock-tabs-body`, `.dock-tabs-head` and `.encounter-topbar`, so
the whole dock-scroller problem is inside one file that Lane A owns outright.

### A1 — Findings 1 and 3: the fight-options menu must flip and clamp (P0)

**Mechanism.** `place()` at `EncounterPanel.tsx:695-703` computes one candidate position — below the
button — then clamps `top` into the viewport and derives `maxHeight` from whatever is left. When the
button sits near the bottom, "whatever is left" is zero. There is no upward branch and no floor.

**Two working counter-examples already in this repo — copy one, do not invent a third:**

- `packages/ui/src/primitives/Menu.tsx:90-107` — walks ancestors to find the real clipping bounds,
  measures `roomBelow` and `roomAbove`, and toggles `nh-menu--up` when
  `height > roomBelow && roomAbove > roomBelow`. This is the one that got `nh-menu--up` this round.
- `apps/client/src/scene/TokenContextMenu.tsx:44-56` — measures natural height by temporarily
  clearing `max-height` (so a stale cap cannot pin it), then either pins to `MARGIN` when the content
  exceeds the room or clamps normally. Note the comment there: an earlier pass capping the box is
  exactly the failure mode this menu now has.

The encounter menu needs both halves: choose the side with more room, and give the chosen side a
real `maxHeight` with a sane floor rather than `max(0, …)`.

**Verify.** GM, `/table`, in combat, menu open:

- **844×390** and **667×375** — `maxHeight` is a substantial fraction of the viewport, not 0. "End
  the fight" hit-tests to `BUTTON.encounter-end` with `isSelfOrChild: true`, and the click actually
  ends the fight.
- **320×568** — visible fraction materially better than the measured 9.0%.
- **390×844** and **1280×900** — no regression; the menu still opens *downward* where there is room
  (a menu that flips up when it does not need to is its own bug).
- Escape still closes; the backdrop still closes; `aria-haspopup="menu"` / `role="menu"` unchanged.

### A2 — Finding 2: the turn row must not depend on either scroll position (P0)

**Mechanism — and this is where the finding as written is incomplete.** Two independent causes:

1. The auto-scroll at `EncounterPanel.tsx:717`
   (`activeRowRef.current?.scrollIntoView({ block: "nearest" })`) drives `.dock-tabs-body` to
   `scrollTop: 93` of max 103, putting the turn row 44px above the scroller's client top.
2. **Even at `scrollTop: 0` the button is unreachable** — `.dock-tabs-body` spans 326→404 in a 390px
   viewport, so the row lands at 375→419 with its centre outside the viewport
   (`elementFromPoint` → `null`). Reachable only at `scrollTop ≈ 20–60`.

**So do not "fix the auto-scroll".** Take the turn row out of the scroll equation entirely: make
`.encounter-topbar` **`position: sticky; top: 0`** within `.dock-tabs-body` (both selectors are in
`encounter-panel.css`, both Lane A's). Sticky pins it to the scroller's client top — y≈326, inside
the viewport — at every scroll position, so neither cause can reach it. Keep the auto-scroll: bringing
the active combatant into view is a real feature (report #2) and is not what broke this.

Check that nothing between `.encounter-topbar` and `.dock-tabs-body` establishes a new scroll or
clipping context, or sticky will silently do nothing.

**Do not attempt the 14px overflow this wave.** `.dock-tabs-body` extending to 404 in a 390px viewport
traces to `.table-sidebar` in `apps/client/src/styles.css` — **Lane B's file**. Sticky removes the
acceptance-bar failure without it. Recorded as a follow-up in §6.

**Verify.** GM, `/table`, in combat:

- **844×390** and **667×375** — on arrival, and again after tapping Next turn twice: the turn row is
  visible, `elementFromPoint` at the Next-turn centre returns the button (`reachesSelf: true`), and a
  real click advances the round. Test at `scrollTop` 0, mid, and max.
- **390×844**, **320×568**, **1280×900** — no regression; the active-row auto-scroll still works.
- Out of combat, both roles — the dock still lays out correctly (the topbar only exists in combat, but
  the sticky rule must not leak).

### A3 — Finding 17: the tray must stop being a map token (P0)

**Mechanism.** `.encounter-map-interaction` (`EncounterMap.tsx:559`) is the pointer-gesture root, the
staging tray is inside it (`:565`), and each chip carries `data-token-id` (`:570`). `beginGesture`
resolves `target.closest("[data-token-id]")` (`:387`), matches the chip, and — because the unplaced
token is in `tokensById` — takes the token-drag branch at `:395-397` and calls
`setPointerCapture` on the **wrapper**. Pointer capture retargets the resulting `click` to the capture
element, so the chip's `onClick` never fires. Proven by the paired before/after in §1: mouse 9→9,
touch 9→9, keyboard 9→**8**.

**The handler is fine.** `placeAtCenter` works — the keyboard path proves it. Only the pointer path is
broken, so fix the pointer path.

**Preferred fix:** an early return in `beginGesture`, before the `data-token-id` lookup, when the
event originates inside the tray — `if (target.closest(".encounter-token-tray")) return;`. The tray is
a known, bounded subtree and this leaves every map gesture untouched. Removing `data-token-id` from
the chips is the alternative, but it is load-bearing for the drag-out path — check before choosing it.

**Verify.** GM, `/table`, tray non-empty:

- **Mouse click** on a chip at 1280×900 → tray count decrements by exactly 1, token appears at map
  centre.
- **Touch tap** at 844×390 and 390×844 → same.
- **Keyboard Enter** → still works (do not regress the one path that did).
- **Drag a chip onto the map** → still works, at mouse and touch. This is the regression risk: the
  guard must not disarm the drag.
- **Drag a placed token back into the tray** → still works.
- Long-press on a *map* token still opens the context menu (the tray guard must not shadow it).

### A4 — Finding 18: the tray's first row must clear the tab bar (P2)

**Mechanism.** At 844×390 the tray box starts at y=30 while `.frame-tabbar` occupies 0→44; the first
chip row lands at 39 and loses its top 5px to the bar, which wins the hit test
(`elementFromPoint` → `BUTTON.nh-tab`). A top offset or clearance on `.encounter-token-tray` at the
landscape rung, in `encounter-map.css`.

**Verify.** 844×390 and 667×375: first chip row `top >= 44`, `elementFromPoint` at its top edge
returns `BUTTON.tray-token`. 390×844 / 320×568 / 1280×900 unchanged.

### A5 — Finding 4: name the `⋯` button (P2)

Add `aria-label="Fight options"` at `EncounterPanel.tsx:977`, matching its sibling `+` at `:976`.
**Verify:** accessible name is "Fight options", not "⋯".

---

## §4 — Lane B: "the rulings land"

**Owns everything outside the encounter panel and the map surface.** More files, but almost all of them
are one-line edits; the two pieces of real work are B1 (gating plus the missing test) and B2.

### Files owned by Lane B — no other agent may touch these

```
apps/client/src/main.tsx
apps/client/src/actors/PartyStrip.tsx
apps/client/src/codex/NotebookTree.tsx
apps/client/src/codex/codex.css
apps/client/src/codex/DashCard.tsx
apps/client/src/styles.css
apps/client/src/viewer/viewer.css
apps/client/src/replay/replay.css
apps/client/src/replay/ReplayPanel.tsx
apps/client/src/integrations/api-reference.css
apps/client/src/integrations/IntegrationsPanel.tsx
apps/client/src/settings/SettingsPage.tsx
packages/ui/src/primitives/NameField.css
packages/ui/src/primitives/Combobox.css
packages/ui/src/primitives/Tabs.css
packages/ui/src/styles/patterns.css
packages/ui/src/styles/design-tokens.css
```

Plus **one new colocated test file** under `apps/client/src/actors/`, covering party visibility (B1).

### B1 — Findings 5 and 6: `partyVisibility` must reach the party surface (P1)

**Mechanism.** The tier is projected correctly and then ignored by the renderer. Two edits:

1. **Gate the mount.** `main.tsx:709-710` must consult the tier for the player arm. The tier is
   already on the projection and already has a reader to copy: `partyVisibilityOf(state)` at
   `actors/MyCharacter.tsx:46`. At `off`, a player gets **no party surface** — that is what
   `projections.ts:186-189` says the tier means, in those words. The **GM arm is unaffected**: the tier
   governs what a player sees of *another player's* character and nothing else.
2. **Match the render to the tier.** Even above `off`, `PartyStrip` should show only what the tier
   carries — `name-and-class` is not a licence to print exact HP. Check `SettingsPage.tsx:89-92`'s
   four help strings, which are the promises the GM reads, and render to those.

**Also fix the doc comment (finding 6).** `PartyStrip.tsx:20-21` claims the projection carries no
definition for anyone else's character. `projections.ts:174` marks `definition` **Y at `full-sheet`
and above**. The behaviour is right; only the reason is false. Per CLAUDE.md, the code is truth and
the document is the defect — fix it in place.

**Write the missing test.** There is no client test for this feature at all. Colocated `*.test.tsx`
is this repo's convention (e.g. `apps/client/src/codex/prep-clock-reveal.test.tsx`). Cover, at
minimum: at `off` a player gets no party surface and **no other character's HP string appears in the
DOM or in any `aria-label`**; at each higher tier the surface shows what that tier promises; the GM
arm is unchanged at every tier.

**Verify.** GM sets each of the four tiers on `/settings`; a player session (out of combat, character
claimed) is checked at each. At `off`: no `.party-strip`, and a DOM/`aria-label` sweep finds no other
character's HP. At `name-and-class`: names and classes, no exact HP. Both roles, 390×844 and 1280×900.
Plus `npm run test` — `apps/server/test/party-visibility.test.ts` must stay green.

### B2 — Finding 8: the reveal mark must be unconditional on the page tree (P1)

**Mechanism.** `NotebookTree.tsx:172` renders `{page.revealedToPlayers && <VisibilityBadge revealed />}`
— gated on the value being **true**, so a hidden page gets nothing. **The counter-example is every
other call site**, and the nearest is `PagesView.tsx:216`: `<VisibilityBadge revealed={page.revealedToPlayers} />`.
`VisibilityBadge` already renders both states — `packages/ui/src/primitives/Reveal.tsx:105` — and its
off state is the struck-through eye. Pass the value instead of gating on it.

The comment above that line argues the badge would be noise on a dense tree. That argument does not
survive ruling 58, which makes this a safety property and asks for the *same* mark every time. If the
density concern is real it is a styling question, not a rendering one.

**Verify.** `/codex/pages`, GM: **all 7 tree rows carry `.nh-reveal-mark`**, hidden rows carry the
struck-through eye with its own accessible name, revealed rows are unchanged. Re-run the exact tally
from §1 (`total`, `withMark`, `withoutMark`) and expect `withoutMark: 0`. Check 390×844 for row
crowding. `packages/ui/src/primitives/reveal.test.tsx` stays green.

### B3 — Finding 15: put `.surface-glass` where it still does work (P2)

**Mechanism.** Revised ruling 23 keeps `.surface-glass` **until the material replaces it**. Measured,
the current state is exactly inverted: on `/settings` all three groups carry glass *and* the material
with `backdrop-filter: none` (dead weight), while `/viewer-controls`'s two `.viewer-col`s compute a
real `blur(8px) saturate(1.15)` with no material (doing the job).

**Remove `.surface-glass` from the three `.settings-group`s** in `SettingsPage.tsx` — the material has
replaced it there. **Leave `viewer-controls` alone**; ruling 34 gave the shared screen *more* identity
and revised ruling 23 exists to protect exactly those two columns.

**Verify.** `/settings`, all three themes: no visual change (it was computing `none`), and the groups
keep rim/bezel/material. `/viewer-controls`: `backdrop-filter` still computes `blur(8px) saturate(1.15)`
on both columns.

### B4 — Finding 13: one nested material texture (P2)

`.api-reference` sits inside `.settings-group--table` and both `::before`s compute a repeating
gradient. Ruling 28: nested panels keep rim and bezel, drop the scanline fill. Drop the scanline layer
on `.api-reference::before` in `integrations/api-reference.css`.

**Verify.** `/settings`: `.api-reference::before` no longer computes `repeating-linear-gradient`; rim
and bezel remain; the parent group's texture is untouched. Re-sweep the seven routes QA3 measured
clean to confirm this is the only nested instance.

### B5 — Finding 14: empty surfaces get a door, and lose the dashed box (P2)

Three separate edits:

1. **The dashed border is global** — `patterns.css:33`, `border: 1px dashed var(--line-strong)`, 6+
   call sites. Ruling 55 says no dashed boxes. Fixing it here fixes every `.nh-empty` at once; check
   each call site after (`ClaimCharacter.tsx:50`, `IntegrationsPanel.tsx:102`,
   `CharacterBuilder.tsx:789/906`, `HomebrewPanel.tsx:313`, `StyleGuide.tsx:1146`).
2. **`/settings`'s credentials empty state** (`IntegrationsPanel.tsx:102`) — emoji icon, the exact
   retired "No credentials yet" phrasing, and **no door element at all**. Ruling 55: one door each,
   saying the single next thing to do.
3. **Four `.codex-dashcard-empty` cards have no door** (`DashCard.tsx:45` renders the `empty` prop,
   defaulting to the literal "Nothing here yet." that ruling 55 retires by name). The fifth,
   `.codex-console-empty`, already has one — leave it. Where a dashcard genuinely has no action, say
   so in the ruling's voice rather than inventing a door.

**Verify.** `/settings` and `/codex`: no `.nh-empty` computes `border-style: dashed`; the credentials
state has a real door; the four dashcards each have a door or a deliberate no-action line. Re-run the
§1 probe (`hasDoor`, `borderStyle`) and check 390×844.

### B6 — Finding 12: `/replays` rows become list rows (P2)

**Mechanism.** The rows are `.nh-card.replay-row`; the card chrome is on `::before` (`inset: -1px`,
`background-color: rgb(22,17,43)`, `border: 1px solid var(--line)`) — a filled box with a full rim.
Ruling 47 names replays by name and asks for a 1px rule between rows and no fill. The pattern to copy
is 15 lines up in the same file: `.replay-initiative li` at `replay.css:68`, converted this round —
`border-bottom: 1px solid var(--line)`, `border-radius: 0`, `gap: 0`.

**Two comments must change with the code**, or the next reader concludes it is done: the "the list IS
the surface … the rows are the cards on it" rationale at `ReplayPanel.tsx:442-444`, and the parallel
note at `replay.css:81-84`. That rationale was written this round and is coherent — see §5, where the
question behind it is flagged — but ruling 47 names the surface and the decisions document is explicit
that a ruling beats an in-round recommendation.

**Verify.** `/replays`, both roles: rows compute no `::before` fill and no four-sided rim; a 1px rule
separates them; the row is still the control and still meets the 44px tap floor. 390×844 and 844×390.
*(The `/replays` row-menu occlusion is known and separate — §6.)*

### B7 — Finding 11: the last pill survivors (P2)

De-pill, per ruling 24, in the files listed above:

| Site | What it is | Note |
|---|---|---|
| `styles.css:871` `.roll-badge` | 30 live instances on the table's roll log | Ruling 10's first-named family on the most-used surface. Highest-visibility item here. |
| `styles.css:803` `.party-strip-entry` | a whole row wearing a pill | Live component; renders out of combat, both roles. |
| `codex.css:682` `.codex-graph-legenditem` | 54×44 tap target | Its `i` swatch at `:685` is `border-radius: 50%` — **protected**, leave it. |
| `viewer.css:191/219/231` | round, connection, health | Shared screen. |
| `NameField.css:20` `.nh-namefield-suggestion` | a chip | `Chip.css:15` is already `border-radius: 0` — match it. |
| `Combobox.css:11` `.nh-combobox-chip` | a chip | Same. |
| `design-tokens.css:491` | the comment | Still licenses `--radius-pill` for "status pills, chips", contradicting rulings 10/24. **This is the licence a future agent will cite** — correct it to what survives: gauges, HP/progress bars, token rings, dots, swatches, avatars, and the remove ✕. |

**Do not touch `Combobox.css:28`** (`.nh-combobox-clear`). It is a 20×20 remove ✕, the same family as
`.nh-chip-remove`, which `Chip.css:54-57` protects by name.

**Verify.** Per site, `getComputedStyle(...).borderRadius === "0px"`: `/table` with the dock's Dice
section open (expect 30 `.roll-badge`, none at 999px), `/codex/graph`, `/table` out of combat for the
party strip, the shared screen, and any surface using `NameField` / `Combobox`. Protected round shapes
— dots, swatches, avatars, `Switch` track, `Skeleton` circle, both remove ✕s — must stay round.

### B8 — Finding 10: the rest glow reaches its hero surfaces (P2)

`.rim-lit` exists, is correct, and has zero app call sites. Ruling 2's list is Roster, Scenes, empty
states, not-found, the builder gate; the builder gate and one empty state have the glow, **Roster,
Scenes and not-found have none**. Apply `.rim-lit` — the utility minted for exactly this — to the three
that are missing it, rather than adding more `filter: var(--rim-glow)` one-offs.

Ruling 2's restraint rule is the constraint: at most one glowing element per region at rest. Hero
surfaces get the glow; everything else gets the material without it. Do not widen the list.

**Verify.** Roster, Scenes and not-found each compute a rest glow; the GM table, Codex and Homebrew
gain none. Three themes. Check that `.rim-lit`'s `isolation: isolate` (`design-tokens.css:1012`) does
not trap a popover on the surfaces it is added to — that is the same class of bug as §6's known
`/replays` issue, and this is the moment to not create a fourth instance.

### B9 — Finding 16: give the tab badge a gap (P2)

**Reduced to what the measurement supports.** There is no overlap — the "Codex" text run ends at
x=297.1 and the badge box begins at x=297.1. The defect is **0px separation**. Add a small gap between
a tab's label and its badge in `Tabs.css`.

**Do not** treat `SETTINGS` as clipped: `textClipped: false`, and the strip is `is-scrollable` with
scroll-snap by design. That is §6 territory.

**Verify.** Player, 390×844, first screen: gap between label and badge is non-zero; no tab's
`scrollWidth` exceeds its `clientWidth`; the strip still scroll-snaps. GM's 8-tab bar at 390×844 unchanged.

---

## §5 — Needs a client decision (flagged, not scheduled)

**Do not schedule these. Do not let an agent resolve them by choosing.**

1. **Finding 7 — the `off` audit line overstates what is withheld.** `game-operations.ts:119` tells
   the GM players see nothing "beyond the tokens on the map"; `off` still delivers AC, initiative,
   speed, conditions, death saves and **exact HP**, all deliberately (`projections.ts:181-189` argues
   the case: removing the entry breaks the battle map). So the tier is right and the sentence is
   wrong. The decision is whether `off` should mean *no sheet* (current behaviour, copy needs
   rewriting) or *less than it currently sends* (a projection change, and a viewer-safety change).
   **Related:** `SettingsPage.tsx:89`'s "and nothing else — no party list" is the same overstatement,
   and B1 makes the "no party list" half true. Decide the copy after B1 lands, so it is written
   against real behaviour.
2. **Finding 12's underlying question — is a list standing on a scene an exception to ruling 47?**
   B6 is scheduled because ruling 47 names replays and the decisions document says a ruling beats an
   in-round recommendation. But the counter-rationale at `ReplayPanel.tsx:442-444` is coherent: when
   the list *is* the surface rather than sitting inside a card, the rows may be the cards on it. If
   the converted result reads worse, that is a client question, not an agent's call to revert.
3. **Finding 14's tone on genuinely actionless empty states.** Ruling 55 asks for one door each. Some
   dashcards ("No deadlines yet.") have no next action that is not a lie. Whether those get a door to
   somewhere adjacent or a deliberate no-action line is a voice decision.

---

## §6 — Not scheduled, and why

A plan that schedules everything is not a plan.

| Item | Why not |
|---|---|
| **Finding 9 — ruling 21, `.sign` on hero surfaces** | Ruling 21's own words are **permissive**: "Hero surfaces … **may** use it. Ordinary panel headers may not." Not building it is not a violation. It is also the one ruling with **no delivered instance to copy** — `.sign` is `background-clip: text` + `-webkit-text-stroke` + a glow filter, applied to display type, and getting it wrong is a legibility regression across three themes. This is a design pass with a client look, not a mechanical fix, and it does not belong in a parallel wave. **Corollary:** the director owes **no reversal** for ruling 21 (§7) — you cannot reverse a ruling that was never built. |
| **Finding 2's 14px dock overflow** | Real and measured — `.dock-tabs-body` reaches 404 in a 390px viewport. But the fix is in `.table-sidebar` (`apps/client/src/styles.css`), **Lane B's file**, and A2's sticky pin removes the acceptance-bar failure without it. Scheduling it would put a P0 across a lane boundary. Record it and take it next wave, with the measurement above. |
| **The `/replays` row-menu occlusion** | Known and real: the material's `isolation: isolate` traps a popover inside its own row. **Not scopeable in this wave** — fixing it properly means auditing every isolating surface (`design-tokens.css:1012` puts `isolation: isolate` on `.chamfer, .rim, .bezel, .rim-lit, .cue`, which is most of the app). It needs its own packet. B8 carries a guard against creating a fourth instance. |
| **Finding 16's "SETTINGS cut to one character"** | Does not reproduce as a clipping defect: `textClipped: false`, `scrollWidth === clientWidth`. The tab is scrolled out of a deliberately scrollable, scroll-snapped strip. Only the 0px gap is scheduled (B9). |
| **`Combobox.css:28`** | Protected by the same reasoning `Chip.css:54-57` writes out for `.nh-chip-remove`. Removed from finding 11's list. |
| **The route audit's 8 red cells and the tap audit's 7 controls** | Long-standing, recorded, accepted. Not this wave's work. |
| **A physical-device pass** | None exists, and none is possible from here. Every "phone" claim in this plan is an emulated viewport with touch enabled. Say so; do not let it be read as a real-hardware pass. |

---

## §7 — Owed by the director, not by a lane

Neither agent should touch these; both are ledger writes, and `docs/ai-ledger/` is not in either
lane's file list.

1. **Ruling 22's dated reversal**, in `docs/ai-ledger/decision-log.md`. The newest entry there is
   **2026-08-04** and the no-sky ruling stands unqualified at `:1470-1476`, explicitly flagged at the
   time as something an agent must not "fix" later. Until the reversal is dated and on the record, an
   agent reading only the old entries will revert the sky work. Ruling 22 reverses it **in part** —
   dock, sheet and margins get the horizon; the map stage stays a clean dark plate — and the reversal
   should say so in those terms. **Ruling 21 needs no reversal: it was never built (finding 9).**
2. **`docs/ai-ledger/current-state.md:130`** still reads "Refresh round 2 — **decided, not started**
   (2026-08-06)." The three product docs were corrected; this one was missed. Note that
   `apps/server/test/docs-ledger.test.ts` holds claims in this file, so correct it rather than
   loosening the test.

---

## §8 — Working agreement for the two lanes

- **One file, one owner.** The lists in §3 and §4 are exhaustive and disjoint. Verify with
  `git diff --name-only` before finishing: every path must appear in your own lane's list.
- **No merge step.** Both agents work the same tree. A file touched by both loses one agent's work
  silently. If a fix turns out to need a file the other lane owns, **stop and report it** — do not
  edit across the line, and do not "just add one line".
- **`docs/` is off limits to both lanes** except this file. §7 is the director's.
- **Do not run `npm run docs`.** No state, command, HTTP or OpenAPI surface changes in this plan; if
  one turns out to be needed, that is a scope change worth reporting.
- **`npm run check` and `npm run test` before calling anything done.** Both must be green. Test names
  to watch: `apps/server/test/party-visibility.test.ts` (B1),
  `packages/ui/src/primitives/reveal.test.tsx` (B2), and the `docs-*` suite (nobody should be
  touching it).
- **Verification means measured.** "Should work now" is not verification (CLAUDE.md rule 6). State
  the viewport, the role, the state, the command, and the number you observed. Every fix above names
  the specific viewport/role/state that would catch its regression — those are the minimum, not the
  ceiling.
- **The P0s come first.** If Lane A runs out of room, A4 and A5 defer before A1–A3 do.

---

## §9 — What landed (2026-08-07)

**Phase 5 and phase 6 are done.** Both lanes ran to completion, the director's pass followed, and
everything below was measured on the combined tree rather than in each lane's own window.

### Gates, on the combined tree

`npm run check` **exit 0**. `npm run test` **exit 0** — 161 files, **2215 tests, 0 failures**, 1
skipped (pre-existing), across all nine workspaces. *(Note for whoever runs these next: `npm run test
| tail` reports the exit code of `tail`, not of vitest. Redirect to a file and read `$?`.)*
Ratchet `design-conventions.test.ts` **34/34, no count moved by either lane.**
Route audit **8 failing cells — the baseline, unchanged**, all on the same four long-standing
surfaces (`/scenes/maps`, `/roster`, `/homebrew`, `/replays/:id`). **No `/table` cell is red in
either role.**

### The three P0s, verified by the director independently of the lane that fixed them

Emulated viewports with touch enabled. **No physical-device pass exists and none is possible from
here** — §6 said so and it is still true.

| | 844×390 before → after | 667×375 | 390×844 |
|---|---|---|---|
| Fight menu | `max-height: 0px`, **2.1%** visible → **297.6px, 28.8%, flips up** | 282.6px, 27.3% | **421px, 40.8%, still opens down** |
| "End the fight" hit test | `DIV.encounter-menu-backdrop` → **`BUTTON.encounter-end`** | same | same |
| "Next turn" hit test | `nh-tabs` / `null` → **`BUTTON.encounter-primary`** at arrival, `scrollTop` 0 **and** max | same | same |
| Tray first chip | y=39, hits `BUTTON.nh-tab` → **y=63, hits `BUTTON.tray-token`** | y=63 | y=63 |
| Touch tap-to-place | 9→9 (never worked) → **7→6** | **9→8** | **8→7** |

A touch tap on "Next turn" at 844×390 advances the active combatant three times running and rolls
the round 1→2. Escape closes the menu; the `⋯` is named "Fight options".

### Three places the plan itself was wrong, and the lane was right

1. **A3's preferred fix would have disarmed the drag.** The plan prescribed an early return for
   tray-origin presses *and* named "the guard must not disarm the drag" as the regression risk —
   those are the same code path. Lane A measured the drag working at HEAD and fixed the far end
   instead (a press that travelled ≤8px is a tap). **The plan contradicted itself and the lane
   caught it.**
2. **A4's cause was not a layout offset.** The tray sits under the tab bar because the landscape
   pane *scrolls*, by a varying amount — so a static offset is right at exactly one scroll position.
   The overflow is **38px at 844×390 and 53px at 667×375, not the 14px §6 recorded**, and it runs
   through the map band rather than `.table-sidebar`.
3. **Finding 14's count was wrong twice.** QA3 said five doorless dashcards, the plan corrected it to
   four, and the truth is **two** — `seeAll` renders whether or not a card has content.

### Decisions §5 flagged, and what happened to them

- **§5.1 (the `off` audit line)** — still open, deliberately. B1 landed, so "no party list" is true
  now; the sentence about "nothing beyond the tokens on the map" still overstates what `off`
  withholds. **Recommended: rewrite the copy, do not change the projection.** `off` means *no sheet*,
  and the field table's rule 2 is why the rest stays.
- **§5.2 (`/replays` rows)** — implemented as ruled. Lane B's honest read: **better as a list, slightly
  worse as a row** — without the card's fill, a row's three controls have no ground under them at
  390×844. If it reads worse to the client, the middle is `background: var(--surface-1)` on the row,
  keeping the rule and dropping the rim. **Not** a return to `.nh-card`.
  A measured bonus: dropping `.nh-card` removed its `isolation: isolate`, and with it §6's known
  row-menu occlusion. Paired at identical geometry, the open menu's first item hit-tested to the next
  row's Watch button before and to itself after.
- **§5.3 (tone for actionless empty states)** — **resolved against the director's own recommendation.**
  The recommendation was a deliberate no-action line; measured, both cards have a real destination
  where the action actually lives (pins are placed in the Atlas; tags are typed on a page), and the
  old copy already named the next step in prose. Making an instruction clickable is not inventing a
  door. Tags takes its door on the empty state only, because `tags` is unbounded and a populated card
  IS the full list — which is `DashCard`'s own contract, not an exception to it.

### Phase 6 — three things no QA pass caught, because they are only visible on a whole surface

1. **Ruling 2 was undelivered on Roster and Scenes.** The door on a gallery surface is not a panel —
   it is the one action that takes you in. `--nh-glow` at rest on that button only.
2. **Nine magenta "Go live" buttons made the door invisible.** The same defect the client named on the
   initiative panel, on a surface nobody re-checked. Magenta is the edge now, not the field.
   After: 9 primaries on `/scenes`, **exactly 1 filled and 1 glowing**, plus the live card's glow in
   the grid — one glowing element per region, which is ruling 2's restraint rule exactly.
3. **The add-new tile was the last dashed box in the app.** Missed because it is not an `.nh-empty`.
   Swept after: **0 dashed borders** on `/scenes`, `/scenes/maps`, `/roster`, `/settings`, `/homebrew`.

### Owed forward — real, measured, and nobody's yet

| Item | The measurement |
|---|---|
| **`/replays` row-menu isolation** | Fixed **by accident** via B6. The general bug remains: `isolation: isolate` is on `.chamfer, .rim, .bezel, .rim-lit, .cue` (`design-tokens.css:1012`), which is most of the app. Still needs its own packet. |
| **Landscape pane, out of combat** | Overflows **81px** at 844×390 and 667×375 — the encounter-setup panel is taller than the sheet floor. Pre-existing; Lane A's band ceiling cut 38px off it. |
| **Player's landscape table** | Overflows **52px in combat, 302px out of it**: an unclaimed player gets `ClaimCharacter` in the sheet and it does not fit at 375–390px of height. `actors/ClaimCharacter.tsx`. Worth a packet. |
| **The `12.75rem` constant** | `encounter-map.css`'s band ceiling is read off boxes in `styles.css` (44 tab bar + 132 sheet floor + 20 padding + 8 gap). If any of those move, it moves. Said at the site. |
| **§6's "14px dock overflow"** | Superseded: it is **38px / 53px**, through the map band, and it is now zero. |
| **Ruling 21 (`.sign`)** | Still unbuilt, still not a violation (its wording is permissive), still needs the client's eye rather than an agent's. No reversal is owed — you cannot reverse what was never built. |

**Tap audit reads 10 below the floor (was 7).** Not a regression: the three new ones are
`g.encounter-token` at 20.1×20.1 / 60.4 / 71.7 — an exact 1:3:3.5 grid ratio, i.e. the map's own
scale at a 375px viewport. Nothing in this phase touched token geometry, and the band ceiling is
inert at the audit's 375×**900**. The live scene changed during the session when the fight was
restarted and probe tokens were placed. **This is a data difference, not code.**
