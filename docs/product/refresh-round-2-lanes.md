# Refresh round 2 — the implementation plan

**Status:** all five waves landed 2026-08-06 (see the per-wave sections below). Phase 3 QA in progress; phases 4-6 pending.
**Read this with** `docs/product/refresh-round-2-plan.md` (what the work is) and
`docs/product/refresh-round-2-decisions.md` (what was decided and why, and the acceptance bar).

---

## Why this is five waves and not one pass

The six-phase sequencing allots **three agents** to implementation. That number is right; the
assumption that they run once is not. Sixty-six rulings touch the whole client, and the phase-0
intake produced the number that decides the shape:

| File | Rulings that need it |
|---|---|
| `apps/client/src/styles.css` | **13** |
| `packages/ui/src/styles/design-tokens.css` | **9** |
| `apps/client/src/main.tsx` | **8** |
| `apps/client/src/scene/encounter-map.css` | 6 |
| `apps/client/src/codex/codex.css` | 6 |
| `apps/client/src/encounter/encounter-panel.css` | 5 |

**One file, one owner** is not a style preference here — parallel agents share one working tree with
no merge step, so two writers means one agent's work is destroyed silently, and round 1 learned that
the expensive way. Three files are claimed by nearly everything, so no single three-way split exists.

The resolution is to **partition by wave rather than by ruling**: each wave is three agents with a
provably disjoint file set, and a file may change owner between waves. Ruling 59 makes this legal —
*"if a phase is not finished, it gets another phase"* — and explicitly rules out trading scope for
time.

**Waves are ordered by dependency, not by importance.** Wave 2 must land before wave 5 because the
material does not exist yet (ruling 64). Wave 3 must land before the scale changes. Nothing in
waves 1–3 depends on a design decision that is still open.

---

## Wave 1 — bugs and copy

Independent of everything else. No identity, no foundation, no server. Ships user-visible repairs
first so the round has value before the large work starts.

| Lane | Owns | Does |
|---|---|---|
| **1A · the map** | `apps/client/src/scene/encounter-map.css`, `apps/client/src/viewer/viewer.css` | **A1 + two thirds of C5:** scope three descendant `svg` selectors to the direct child — one change fixes the fullscreen blow-up, the 2.5× toolbar-glyph mismatch and the "mis-coloured border" (an opaque tile, not a border). **A2:** the health ring paints a solid disc and the bar paints a stroke it was told not to have; restructure the band classes so they carry a colour custom property and each consumer maps it to the one property it needs. Four sites, two files. |
| **1B · the two dialogs** | `apps/client/src/codex/codex.css`, `apps/client/src/encounter/MonsterBrowser.tsx`, `apps/client/src/encounter/encounter-panel.css` | **A4:** the collapsed Codex rail has three columns on three different centres; put all three on the rail's own centre. **A5:** the monster-add confirmation is ~20,000px below the fold because the list is a declared scroller that cannot scroll — make the modal body the column and the list the region. Per-row busy state, not a global disable. |
| **1C · copy and affordances** | `apps/client/src/scenes/{SceneGallery.tsx, scene-gallery.css, ScenePanel.tsx, ScenePrepPanel.tsx, scene-prep.css}`, `apps/client/src/actors/PartyRosterTab.tsx`, `apps/client/src/replay/ReplayPanel.tsx`, `apps/client/src/dice/DicePanel.tsx` | **B1–B6** (ruling 66: "On this map" is in the **New-scene modal**, not the popup). **Ruling 62:** the roster heading becomes "Roster". **Ruling 16:** the count already exists — add the chevron and the click affordance, one CSS rule. |

**Director reconciles after wave 1.** The `eyebrow` ratchet is an exact-match count and three lanes
move it. No agent edits `apps/client/src/design-conventions-shape.ts`; lanes report deltas and the
director reconciles from a measured scan.

---

## Wave 2 — the foundation

**Nothing in wave 5 can start until this lands.** Ruling 64 established that the material does not
exist to be applied: five of the six landing-door pieces have zero call sites outside the landing,
and `Panel` reaches 5% of the app's panel-shaped surfaces.

| Lane | Owns | Does |
|---|---|---|
| **2A · tokens and utilities** | `packages/ui/src/styles/design-tokens.css`, `packages/ui/src/styles/patterns.css` | Mint `--state-on` three times, once per theme (ruling 4). **Express the door as shareable utilities** — the 2px rim, the inner bezel, the cue triangle, and a chamfer that paints on a backing layer (rulings 2, 14, 49). Scrollbar treatment (ruling 44, tab bar exempt). A numeric face token with tabular figures (ruling 50). Daybreak values for all of it (ruling 29). |
| **2B · primitives** | `packages/ui/src/primitives/**` | Every button takes the cut corner **on a backing layer** (rulings 49 + 14). De-pill `Badge` and `Chip` (rulings 10, 24) — 117 call sites reached by editing two files. Segmented on-state: filled per theme, group chamfer, leading tick (rulings 4, 7), and it must stay visibly distinct from `Switch` (ruling C4). Alerts and toasts to a leading rule (39 — both are already close). Menus, popovers, tooltips to panel material with a brighter rim (52). Modal backdrop to darken-plus-vignette (41). `Skeleton` to a scanline sweep (42). Form controls: rim and corner cut, flat fill, focus ring untouched (31). |
| **2C · the icon set** | `packages/ui/src/primitives/icons.tsx`, `apps/client/src/codex/icons.tsx` | ~69 glyphs redrawn as **heavier silhouettes with mitred corners** (ruling 43). Fill-only throughout — no strokes. Some glyphs barely move and that is correct. **No call site changes**, so this lane collides with nothing. |

**The one thing 2B must not get wrong:** `clip-path` clips hit-testing, not just paint. Every button
is a tap target, so the corner is painted behind the label on every variant. The existing small-button
exemption is not a special case to preserve — it was the symptom that the technique was wrong.
**Re-run `scripts/tap-audit.mjs` after this wave.** It is the single change most able to silently
shrink hit areas app-wide.

---

## Wave 3 — the spacing tokenisation

Ruling 63. **Mechanical and zero-visual-change**: convert 904 hard-coded spacing declarations to the
existing ten-step scale. A declaration with no matching step stays hard-coded and is reported, not
rounded to fit — rounding is a visual change wearing a refactor's clothes.

| Lane | Owns | Declarations |
|---|---|---|
| **3A** | `apps/client/src/encounter/encounter-panel.css` | 413 |
| **3B** | `apps/client/src/styles.css`, `apps/client/src/scene/encounter-map.css` | 219 |
| **3C** | the tail — `maps/map-manager.css`, `integrations/api-reference.css`, `settings/settings.css`, `viewer/viewer.css`, `viewer/viewer-controls.css`, `codex/codex.css`, and the remainder | ~272 |

**Then the director changes the scale in one commit**, which is what makes "uniform" a claim anybody
can check (ruling 33).

**Verification is not optional and not by reasoning.** Each lane screenshot-diffs its files before and
after. A moved pixel in wave 3 is a bug, not a judgement call. Then all four of ruling 32's guardrails:
the route audit on all nine viewports with **no green cell going red**, every ratchet flat or
shrinking, the 44px floor intact, and the ~180px recovered on a player's phone still banked.

---

## Wave 4 — structure and information architecture

The layout changes. These are real behaviour, not paint.

| Lane | Owns | Does |
|---|---|---|
| **4A · shell, table, routes** | `apps/client/src/main.tsx`, `apps/client/src/router.ts` + its test, `apps/client/src/styles.css`, `apps/client/src/scene/{MapToolbar,EncounterMap}.tsx`, `apps/client/src/integrations/{ApiReference.tsx, api-reference.css}`, and the new My-Character surface | **~180px of map returned on a player's phone**: delete the top-left scenes row (D1, 56px), move the preview trigger into the map toolbar (ruling 13, 53.6px), delete the character bar (ruling 20, 69px). Add "view all scenes" to the map's Scenes menu. The My-Character tab as the player's first tab, with the builder door on it (ruling 18). Remove the duplicate "My sheet" — **but not before there is another route into the sheet view**, since the toggle is currently the only one. Mount the combat log as a Drawer (ruling 6). **A6 as a real address** at `/settings/api` (ruling 61). |
| **4B · the Codex** | `apps/client/src/codex/**` except `icons.tsx` | The context column becomes summonable (ruling 11) — a removal in `PageEditor` and an addition in Journal and Quests. Journal is a genuine re-composition; **atlas and calendar keep their own shapes** (ruling 57). Control-height alignment, and "Shown to players" becomes an icon-only eye **with an accessible name** (rulings 17, C6). Entity-kind colour as an accent drawn from outside the palette's meaning-bearing hues (ruling 46). **Inherited from wave 1:** the collapsed rail's hidden scrollbar needs a replacement affordance — see below. |
| **4C · the server** | `packages/domain/src/index.ts`, `apps/server/src/{game-operations,server,game-http,projections}.ts`, `packages/api-contract/src/index.ts`, `apps/client/src/settings/{SettingsPage.tsx, settings.css}`, and the two generated docs | `partyVisibility` as a four-tier setting (rulings 5, 8, 19). **The only server-side work in the round.** |

**4C carries three obligations no other lane has.** It is the **only** lane that regenerates docs, so
it owns `docs/app-map.md` and `docs/api-reference.md` and no other lane may run `npm run docs`. It is
a **viewer-safety change** — the tiers are enforced in `projectPlayerView`, never client-side, and the
"this is mine" branch must stay untouched so a player always gets their own full sheet. And it needs
a **viewer-safety audit before it merges**, because adding a field to a player projection is the
repo's hardest invariant.

---

## Wave 5 — the identity

Depends on wave 2 for the material and wave 3 for the spacing. Applies rulings 2, 21, 22, 25–30,
34–40, 45, 47, 48, 51, 53, 55, 56, 58 and the retirement of `.surface-glass` (revised ruling 23).

| Lane | Owns | Does |
|---|---|---|
| **5A · shell and chrome** | `apps/client/src/styles.css` | Tab bar gets its own material and no glow (26). Connection strip folds into it (48). Role hue across the whole chrome — **never on the viewer** (51). Table sky behind the chrome, never behind the map (22). The dock attached to the shell (53). Scanlines on the outermost panel only (28). Entry animation to 1.75–2.0s, both elements staged — **and the jump diagnosed, not padded** (27). The scanline wipe on tab and page transitions **only** (25). The roll result flares (35). |
| **5B · feature surfaces** | `apps/client/src/{encounter,codex,scenes,settings,homebrew,replay,actors,builder,maps}/**.css` | The material at ~119 hand-rolled panel sites (2, 64). List rows to hairline rules (47). The character sheet: quiet body, hero header, **zero added height** (45). Empty and error surfaces (55, 56). One reveal language everywhere (58). Retire `.surface-glass` as the material replaces it (23). |
| **5C · map, viewer, motion** | `apps/client/src/scene/{encounter-map.css, annotation.css}`, `apps/client/src/viewer/**`, `apps/client/src/encounter/InitiativeList.css` | Map stage rim and corner ticks, `pointer-events: none` (30). Selected tokens get corner brackets, not a ring — they must not collide with the health ring 1A just fixed (37). Full identity on the map instruments **with fog's edge left hard** (38). The turn-change pulse, verified **on a phone, out of the GM's seat** (36). The shared screen: more identity, less density, and **exempt from the tightened scale** (34). |

---

## Wave 1 — landed 2026-08-06

Three lanes, thirteen files, no collisions. Committed separately so a bad lane could be reverted alone.

**The route audit went 18 → 10 failing cells.** Not 14 → 10: the "14" on record was an undercount,
and the baseline was re-measured on a worktree at the pre-wave commit rather than taken on trust.
`/scenes` went **fully green** (three landscape cells, cleared by the copy trim alone), `/roster` went
4 fails → 1 with the survivor improving Y+88 → Y+31, and `/replays/:id` went 4 → 3 with Y+139 → Y+63.
**No green cell went red.** `/replays` player at 844×390 reads FAIL Y+1 and did so in the baseline
too — worth stating because it looks like a new regression and is not. Two `/scenes/maps` cells got
1px worse while staying red; noise, not a finding.

Ratchet (c) reconciled from a measured scan: eyebrow uses **11 → 8**, files **10 → 7**. No other
counter moved. Typecheck clean, 575 client tests green.

**What the lanes found that the plan had wrong** — recorded because each was a measurement beating an
instruction, which is the outcome the rules ask for:
- The Codex rail does **not** overflow 5px at 1280×900 as planned; it does not overflow there at all,
  but it hides 75px at 1366×768 and 143px at 1280×700. See the debt below.
- Ruling 15's third selector (`:100`, enlarged mode) had **zero measured damage** — enlarged mode was
  broken entirely by `:34`. Scoping it is hygiene, not a fix, and "three lines, not two" should not be
  read as three separate bugs.
- The monster list's problem was never a missing height cap: it was a declared scroller that could not
  scroll, because its `flex: 1 1 auto` had no flex parent.
- The Scenes trim delivers 2.99 card rows, not 3. See the debt below.

---

## Wave 2 — the material exists now

**Lane 2A landed the vocabulary.** `--state-on` (three themes), `--rim-w`, a reworked `.chamfer`,
`.rim`, `.bezel`, `.cue`, scrollbar tokens, `--font-numeric`, and a de-pilled `.nh-card`. The contract
names shipped exactly as specified, so nothing downstream has to be renamed.

**Three things every later lane needs, and cannot see from its own files:**

1. **`.chamfer` paints BEHIND the content.** An element with its own background gets a square fill
   under a cut outline. For any filled surface use **`.chamfer.chamfer`** — the doubled class wins at
   (0,2,0), zeroes `background` and `border-color`, and moves the fill to **`--material-fill`**.
   Setting `background` on a chamfered element is the mistake this note exists to prevent.
2. **`::after` is spoken for twice** — `.tap-target`'s 44px hit area and `.scanlines`' 11 consumers.
   The material uses `::before` only. **Reaching for `::after` on anything carrying `.tap-target`
   destroys a hit area.**
3. **`.chamfer` / `.rim` / `.bezel` / `.cue` all set `isolation: isolate`,** which makes the element a
   stacking context. Any surface relying on an absolutely-positioned popover escaping above a sibling
   needs a `z-index` lift once it takes the material. `.nh-card` already had this for its open menu;
   wave 5's surfaces will not.

**A regression 2A introduced and caught before shipping**, recorded because the next person to touch
scrollbars will meet it: `scrollbar-color` inherits and `scrollbar-width` does not. Declaring both on
`:root` made every `.scroll-y` compute `auto` while the inherited colour disabled `::-webkit` sizing,
and **every scroll gutter in the app went 10px → 15px**. The fix is `*, *::before, *::after`. Related:
when `scrollbar-width` is not `auto`, Chromium **ignores** `::-webkit-scrollbar` entirely, so the
standard properties are what paint and the webkit block is a fallback that must be kept in step.

**Owed, and owned by nobody yet:** `apps/client/src/styleguide/StyleGuide.tsx` needs a section
demoing `.chamfer` / `.rim` / `.bezel` / `.cue` / `.numeric`. Without one the material is the only
part of the design vocabulary with no reference entry, which is how a utility ends up re-invented
per surface. **Assign it to wave 5A.**

---

## Debts a wave hands to a later one

Recorded here because a debt agreed in a commit message and nowhere else is a debt nobody pays.

- **Wave 1B → wave 4B: the Codex rail's scroll affordance.** Aligning the rail's three columns cost
  it its visible scrollbar. Measured overflow with the bar hidden: **0px above 850px of viewport
  height, 75px at 1366×768, 143px at 1280×700.** Scrolling by wheel, trackpad, touch and keyboard
  still works and focus still scrolls into view — the affordance is gone, not the capability. The
  director accepted the trade because the misalignment was present at *every* height while the hidden
  overflow only bites below ~843px.
  **It is also now an exception to ruling 44** (thin neon track, always visible), and the second one —
  the tab bar is the first. The difference is that the tab bar has a fade mask standing in for the
  scrollbar and the rail has nothing. 4B owns `SidebarNav.tsx` and can add one; it must be
  **conditional on real overflow**, because an unconditional fade claims "there is more" at the
  heights where there is not.
- **Wave 1C → wave 5A: the 176px sky reserve.** The Scenes copy trim delivers 2.99 card rows, not the
  three the client expected. The lever that would deliver three is the gallery's reserved horizon
  band — 27% of the card region, and 2.6× the whole copy trim. It is a design-language rule, so
  reversing it is a client decision, and it belongs with the wave 5 work where the sky is already
  being touched. **Do not quietly shrink it in the density pass.**

---

## What the director does between waves

Not optional, and not delegable — several of these are the failure modes round 1 shipped.

1. **Reconcile the ratchets from a measured scan.** Lanes report deltas; deltas from different lanes
   do not simply add. No agent edits `design-conventions-shape.ts` or `design-conventions.test.ts`.
2. **Run the route audit on all nine viewports.** It is red on 14 cells today. **No green cell may go
   red.** Do not delete a viewport to go green.
3. **Re-run the tap audit** after wave 2 (the chamfer) and wave 3 (the density pass) specifically.
4. **Verify in the states nobody designed for.** Round 1's lanes each verified portrait at the widths
   in their own brief and shipped three critical failures in landscape, at 320px and out of combat.
   Landscape and short panes are not edge cases; they are where this app breaks.
5. **After wave 5, write the two dated reversals** into `docs/ai-ledger/decision-log.md` — chrome
   metal on hero surfaces, and the table sky behind the chrome. Rulings 21 and 22 are only safe once
   they are on the record; an agent reading the old entries will otherwise revert them believing it
   is fixing a mistake.

---

## The bar this has to clear

Unchanged, and reproduced here because it is the thing a long build drifts away from:

1. **A session runs on a phone with nothing in the way.**
2. **All 21 feedback items closed and verified** — measured, not "should work now".
3. **The landing and the app read as one product**, on every surface, in all three themes.

All three. Nothing deferred to buy time.
