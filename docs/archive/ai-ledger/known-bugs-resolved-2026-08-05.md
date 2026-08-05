> ## ⚠ ARCHIVED — 2026-08-05
>
> **What this is:** Resolved entries lifted out of `docs/ai-ledger/known-bugs.md`, whose own rule at the top of the file says to remove an entry when it is fixed.
> **Current through:** 2026-08-05
> **Superseded by:** `docs/ai-ledger/known-bugs.md` — every entry that remains there is reproducible at HEAD.
> **Read this for:** the reasoning behind a non-obvious fix, and what a defect looked like before it was understood.
> **Do not read this for:** what is broken now. Nothing here is open.
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

## Resolved entries

One entry, resolved 2026-08-05. It is archived rather than deleted because the mechanism is
invisible from the markup and the same mistake is easy to make again: the cause was not the
banner it was originally attributed to, and the check that should have caught it structurally
cannot.

Its fix was verified by a browser script rather than a regression test, which is why it belongs
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
