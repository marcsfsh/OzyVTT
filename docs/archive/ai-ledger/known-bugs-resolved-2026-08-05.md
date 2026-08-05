> ## ⚠ ARCHIVED — 2026-08-05
>
> **What this is:** Resolved entries lifted out of `docs/ai-ledger/known-bugs.md`, whose own rule at the top of the file says to remove an entry when it is fixed.
> **Current through:** 2026-08-05
> **Superseded by:** `docs/ai-ledger/known-bugs.md` — every entry that remains there is reproducible at HEAD.
> **Read this for:** the reasoning behind a non-obvious fix, and what a defect looked like before it was understood.
> **Do not read this for:** what is broken now. Nothing here is open.
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

## Resolved entries

Two entries, both resolved 2026-08-05, both on the phone table. They are archived rather than
deleted because in each case the mechanism is invisible from the markup and the same mistake is
easy to make again: the first was attributed to the wrong cause entirely (a banner, not the layout
mode) and the check that should have caught it structurally cannot see that class of defect; the
second cannot be implemented the obvious way, because the state it reports lives inside the thing
that unmounts.

Both fixes were verified by a browser pass rather than a regression test, which is why they belong
here and not in the live list — C4 in `apps/server/test/docs-ledger.test.ts` says so explicitly
("if the fix was verified by a browser pass or a script rather than a test, that is branch 1 or 2
— the evidence belongs in the archive entry or the gotcha, not here").

### [table/mobile] At 390×844 the battle map paints over the player's dock, and their own actions cannot be tapped

**The entry as it stood** (measured 2026-08-05 on a genuine phone-width first paint, not a resize):

> `section.table` ends at y=459, but `.encounter-map-stage` renders at **460–684** — it is
> `position: relative`, so it paints above the sidebar's static content — while `.dock-accordion`
> occupies 483–776 and the open `.dock-section-body` 527–672. `elementFromPoint` at the centre of
> the player's own "Dagger" row returns the map's `<image>`, and a real `touchscreen.tap` there
> opens nothing (the targeting card never appears). The cause is above the stage: the "YOU'RE
> PLAYING …" banner wraps to roughly 390px tall and eats the whole map column, so the stage
> overflows below its own section, whose `overflow` is `visible`. **The page itself never scrolls**
> (0/0 both axes), so `scripts/no-scroll-audit.mjs` passes while the surface is unusable — it
> measures document scroll, not occlusion.

**The cause was the layout mode, not the banner.** The banner's height was a symptom of the same
thing rather than the driver. Below the 980 rung `.table-layout` stayed a **grid**, and both of its
children carry `min-height: 0` — which the two-column frame genuinely needs, so the map can shrink.
Stacked, that same declaration makes each grid row shrinkable to zero, so the grid squeezed the two
auto rows into the pane: `grid-template-rows` resolved to `410.75px 360.75px` at 390×844 while
`section.table` still held 833px of content. `overflow: visible` then let the surplus paint over
whatever was beneath it. A fixed-height frame is the right shape for two columns sharing one
height; it is the wrong shape for a stack in a region that scrolls itself, where nothing should
shrink.

**The fix**, in two rules, both under `@media (max-width: 979px)`:

- `apps/client/src/styles.css` — `.table-layout` becomes `display: flex; flex-direction: column`,
  and both children take `flex: none`. Nothing shrinks; the region scrolls.
- `apps/client/src/scene/encounter-map.css` — with no frame left to take a leftover from, the map
  states its own height (`.encounter-map-stage { flex: none; height: 14rem }`) instead of
  flex-filling a column that has no height of its own. Flex-filling would have fallen back to
  `min-height: 12rem`, and that number is a **floor for a short frame**, not a height anyone chose
  for a phone.

**Verification** — `node scripts/tap-audit.mjs`, run twice against the same dev server with only
these two CSS rules reverted and re-applied:

| | before | after |
| --- | --- | --- |
| `player-play-table (/table)` unresolved | **3** | **0** |
| the three `button.encounter-dock-choice` | `reach=0` | `reach=29` |
| every other surface header (45 of them) | — | byte-identical |
| controls measured / below the 44px floor | 1090 / 124 | 1090 / 124 |

`reach=0` is the audit's occlusion signal: `elementFromPoint` at the control's own centre returns
something else. `reach=29` exceeds the buttons' own 28px height, so they are fully hit-testable.
The two incidental deltas in the diff are benign and expected from a stated map height: one map
token measured 17.2→15.8px, and one `button.legendary-offer` reach 31→33.

**What this did not fix**, and what to watch:

- **The 124 controls below the 44px floor are untouched** — identical before and after. That is a
  sizing number, not an occlusion number, and it is the ratchet's business.
- The three dock-choice buttons are **still 28×28**. They became reachable, not compliant.
- `scripts/no-scroll-audit.mjs` still cannot see this class of defect. It measures document scroll,
  and this surface never scrolled (0/0 both axes) while being unusable. **The tap audit's
  `unresolved` count is the check that sees occlusion** — that is the durable lesson here.
- The map band at 14rem is an interim shape. C1 (the table recompose) replaces it with the map band
  and the tabbed sheet properly; these two rules are what makes the phone usable until it lands.

---

### [encounter/ask] A waiting question was invisible while the player was anywhere but the tracker

**The entry as it stood** (driven 2026-08-05 with two live sessions):

> `DockAccordion` unmounts a collapsed body, so with the player on **Dice** the pinned
> `MyPendingAsks` row is not in the DOM at all (measured: 0 nodes) and nothing else stands in for it
> — the three headers read "Turn order / Dice / Combat log" with no count on any of them. […] Not a
> correctness defect (the player asked the question, and the state is right on both sides); it is the
> attention model the accordion's unmount cost, and **the fix is a count on the section header rather
> than a new surface.**

**Fixed as the entry itself specified** — a count on the header, not a new surface. It rides the
Turn label in **both** dock trees: the accordion header at ≥980 and the phone sheet's tab label
below it (`apps/client/src/encounter/DockAccordion.tsx`).

The mechanism is the interesting part, because the obvious implementation cannot work. Everything
that *knows* the count lives inside a body that may be unmounted — and that unmount **is** the bug,
so reading the count from the panel would only ever report it while the panel was already visible.
The count is therefore read at the dock itself from `state:updated` through a module store, the same
idiom `CombatLog.tsx` uses in that directory.

The badge carries `.nh-sr-only` text, so the accessible name is "Turn order 2 questions waiting on
the GM" rather than a bare numeral (`DockAccordion.tsx:93`).

**Why this is archived rather than deleted:** the fix was verified by a browser pass, not by a
regression test, so C4 in `apps/server/test/docs-ledger.test.ts` sends the evidence here. The half
of the original entry that was *already right* is worth keeping too — focus was never stolen
(`document.activeElement` byte-identical before and after the GM answered, on both sections), and an
**Allow** always reached the player through the table event toast. Only a **Deny** was silent, and
only outside the Log. That asymmetry is what made it an attention defect rather than a state one.
