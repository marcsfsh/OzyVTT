# Refresh round 2 — the client's rulings, in order

**Status:** discovery complete — **60 rulings, all settled.** Nothing here is implemented.
**Read this when:** implementing any part of round 2, or when a choice looks arbitrary and you are
about to "improve" it. Most of these rulings overrode a director recommendation, and several
deliberately reverse an earlier written decision.

---

## THE ACCEPTANCE BAR — read this first, every time

Round 2 is done when **all three** of these are true. Not the best of them, not two of them.
The client set this bar explicitly so that a long build could not drift away from it:

> "all 3. a session runs on a phone with nothing in the way. all 21 feedback items closed and
> verified. landing and app read as one product. This will need to survive any context collapsing or
> context compression, so it needs to be documented so that as we go on this long journey, we dont
> get derailed or sidetracked"

1. **A session runs on a phone with nothing in the way.** A real fight, a real player, a real phone.
   This is the test the other two cannot substitute for.
2. **All 21 feedback items are closed and verified.** Countable, provable item by item, against
   `docs/product/refresh-round-2-plan.md`. Verified means measured, not "should work now".
3. **The landing and the app read as one product.** Put the landing beside any app surface: nothing
   should say they were designed at different times. Checked on every surface, in all three themes.

**Nothing is deferred to buy time** (ruling 59). There is no round 3 to push work into. If a phase is
not finished, it gets another phase — "we ran out of phases" is not an outcome that exists.

---

The scope and sequencing live in `docs/product/refresh-round-2-plan.md`. **This file is the other
half: what the client actually decided, and why.** A ruling here beats a recommendation anywhere else,
including one written by the director in this same round.

Two conventions used throughout:

- **A quoted line is the client's own words.** It is the primary source; the paragraph under it is
  the director's reading, and if the two ever disagree, the quote wins.
- **A ruling that carries a constraint states it inline.** Those constraints are not commentary —
  they are the parts most likely to be lost, because they are the parts that make the pretty version
  harder to build.

---

## General block

### 1 — Ambition: a full identity pass

The look becomes a composition per surface, not utilities applied to existing boxes. The client also
asked for discovery dedicated to the identity pass, which is why this document has two halves.

**This reopens two written rulings.** Both are signed off below (21, 22). Neither may be quietly
edited; both need dated reversals in `docs/ai-ledger/decision-log.md`.

### 2 — Rest glow: a hybrid the director did not offer

> "Hero surfaces get glow, rest of the surfaces get the '80% of the visual difference' treatment"

Hero surfaces — Roster, Scenes, empty states, not-found, the builder gate — get the **full landing
door, rest glow included**. Every other surface gets **the material without the glow**: 2px rim,
scanline-over-gradient fill, inner bezel, cue triangle.

This keeps the restraint rule ("at most one glowing element per region at rest") exactly where it
earns its keep — the GM table, Codex and Homebrew, where several controls share one region.

### 3 — Arcade type on buttons and tabs

Retires the rule that the arcade face never sets a control label. Russo One, uppercase, tracked, on
every button and tab label.

**Watch:** tab labels are 13px today. Measure in all three themes. **Daybreak is where this fails if
it fails** — legibility outranks vibe there absolutely. If 13px arcade misses AA in daybreak, the
answer is a size bump on the tabs, **not** a quiet retreat to the body face.

### 4 — Segmented on-state: filled, and per-theme

> "dark mode gets the more purply/magenta color from styleguide, dusk mode gets the sunset orange,
> light mode gets cyan"

Mechanically this is a **state-only token whose value varies per theme** — `--state-on`, defined three
times in `packages/ui/src/styles/design-tokens.css`. The token means "on"; each theme picks the hue
that reads best against its own surfaces.

**Shipped values (wave 2, measured):** dark `#FF2E9A`, dusk `#FF9E4A`, light **`#0B6497`**.
All three clear 3:1 filled against every surface tier, as this ruling assumed.

> **Light moved, and the reason is the one thing that outranks the palette.** The obvious choice was
> the theme's usual cyan `#0F7FC0`. It clears 3:1 filled — but **no ink clears 4.5 on it**: white
> reads 4.36, body text 4.12. So the light value is the deeper cyan twin, which reads 6.39 against
> white. Still cyan, as the client asked. Do not "restore" it toward the lighter one; daybreak is
> where legibility is absolute. A side benefit: it loosens the focus-ring collision below.
>
> **All three are literals, not aliases.** Dusk deliberately matches today's `--caution` hue, because
> ruling 7 keeps the hue and lets shape carry the distinction — but it does not *reference* the
> caution token, so a future severity retune cannot silently move a state colour. That is what keeps
> this ruling and ruling 39 from fighting.

Three collisions came out of this, all resolved by ruling 7. Contrast was never the problem — all
three clear 3:1 filled:

- **Dusk's sunset orange is `--caution`**, the one deliberate exception to the magenta→blue axis,
  meaning *warning / not finished*. In dusk it would mean two things.
- **Light's cyan is the focus ring and `--line-hover`** — every hover border in the app.
- **Dark's magenta is the primary action and the Switch's own ON track**, which is precisely the
  "siblings, not merged" problem: fill the segmented magenta in dark and it becomes the Switch.

### 5 and 8 and 19 — Party visibility

> "GM can toggle between the three options; identity card, full read only, or sheet plus resources.
> intuitively and simply named for the GM to understand easily"

**Four states, not three** — the original feedback implied an off state and the client confirmed it.
GM-facing strings, settled:

`Off` · `Name and class` · `Full sheet` · `Sheet + resources`

**Default is `Name and class`** — the safe middle, not the fullest. Players get a useful party roster
out of the box; the GM opts in to more.

> **Enforced in `projectPlayerView` in `apps/server/src/projections.ts`, never client-side.** A
> visibility tier is a projection decision. Filtering in the client would make the setting decorative
> and the data still on the wire.

### `off` stops at the party surface — a director instruction corrected by measurement

The director specified `off` as "absent from the player's projection entirely — not a stub, not a
name with nulls." **Built exactly that way, it breaks the table**, and the lane measured it rather
than shipping it: `combat.initiative` still names the other player's character and `combat.tokens`
still carries their token, because both are projected by a different function the tier does not
touch — but `EncounterMap` bails on an actor it cannot find. **A player at `off` would see an ally's
name in the turn order and an empty square where they are standing.**

A GM choosing "Off" is saying *my players don't read each other's sheets*. They are not saying
*delete my players from the battle map*. That also matches D9's own wording — the setting disables
the read-only-sheet visibility on the My Character tab.

| tier | entry in `state.actors` | `classLine` | `definition` | resources | My Character tab |
|---|---|---|---|---|---|
| **off** | **present** | – | – | – | **no party list at all** |
| name-and-class | present | `"Wizard 7"` | – | – | identity cards |
| full-sheet | present | Y | Y | – | + read-only sheet |
| sheet-and-resources | present | Y | Y | Y | + live resources |

**The client must branch on `state.partyVisibility`, never on which fields happen to be present.** At
`off` the entries exist only so the map, the turn order and the tokens stay coherent; their presence
is not permission to list them.

**One new field, `PlayerActor.classLine`** ("Wizard 7"). The `name-and-class` tier is unrenderable
without it — `definition` is owner-only below `full-sheet` and `PlayerView` carries no definitions
list, so class was simply unreachable. Absent on the player's own character, where the owner already
holds the whole definition. **Unclaimed characters sit outside the gate entirely**, because the claim
screen reads `state.actors` and gating them would brick claiming.

### 6 — Combat log: a drawer from the right

Chosen with both named costs accepted. Both are the implementer's to solve:

- **It stays mounted while closed, which re-breaks pin-to-newest.**
  `apps/client/src/encounter/CombatLog.tsx` writes `scrollTop = scrollHeight` on every append, and a
  hidden element measures 0. Unmount the list while closed, or scroll on open. **Do not ship the
  drawer without solving this.**
- **It takes an edge**, so it covers the dock rather than floating over the map.

`packages/ui/src/primitives/Drawer.css` is already non-modal by design — no scrim, no focus trap, no
scroll lock — so the table stays live behind it, which is the whole requirement.

### 7 — Toggle collisions: differentiate by shape too

Keep all three per-theme hues **and** give the segmented on-state a silhouette that neither the Switch
nor the focus ring has: **the corner cut on the group, plus a leading tick.** The hue can then be
shared safely, because the shape carries the distinction. Resolves all three of ruling 4's collisions
at once.

> The chamfer goes on the **group**, never the option. `clip-path` clips hit-testing and the option
> carries the tap target. See ruling 14 for the general form of this trap.

### 9 and 11 — Codex: context becomes summonable

Neither pure master-detail nor pure document surface was right. The hybrid: **page list plus editor on
screen; the context column — connections, atlas pins, journal — moves behind a toggle or drawer.**
Writing gets full width and full height.

This is also most of D7's fix. Three separately-scrolling panels on one page becomes two, and the
"stitched-together" read comes largely from that third column's independent height.

### 10 and 24 — De-pilling: all four families, replaced by the chamfered rectangle

Going: status labels (11 classes, 3 of them dead CSS) · whole rows wearing a pill (6, including the
character bar) · tags and filter chips (5 hand-rolled plus 27 `Chip` sites) · counts (the dock
waiting-count, "N new", "N saved versions"). Roughly 23 hand-rolled classes and ~82 primitive call
sites; `packages/ui/src/primitives/Badge.css` and `packages/ui/src/primitives/Chip.css` are two files
reaching 118 sites, which is the leverage.

**Staying round: dots, swatches and avatars; and the gauges.** Shape is meaning there.

The replacement is **one silhouette from the largest button to the smallest count badge** — the same
cut corner as the "New Homebrew" button the client singled out as right.

### 12 — Scenes: one door, not two

> "opening the gallery gets added as a button in the menu that opens when you click the scene button
> on the map"

The bottom-right map Scenes popup gains a "view all scenes" entry; **the top-left scenes row is
removed**, returning 56px to the map.

*(This was settled in the original feedback. The director re-offered it as a choice in discovery,
which was a mistake — it is recorded here so nobody re-opens it a third time.)*

### 13 — The preview bar becomes a map-toolbar icon

The "Preview what players see" anchor row is deleted; its trigger joins Draw / Fog / View in the map
toolbar. **Returns 53.6px to the map.** Nothing else has to change: the payload is already a
`position: fixed` draggable panel, so it never depended on the row that launched it.

### 14 — Advantage/Disadvantage: chamfer on a backing layer

The instruction as given was impossible. Small buttons are exempt from the chamfer at
`packages/ui/src/primitives/Button.css` **because `clip-path` clips hit-testing** — a chamfered small
button cuts its own 44px tap area.

Resolution: **the button stays unclipped; a layer behind the label carries the `clip-path` and paints
the corner cut.** Paint gets the silhouette, the tap area stays whole.

> This is the general escape hatch for "chamfer + small" anywhere it recurs. **Never put `clip-path`
> on an element that is, or contains, a tap target.**

### 15 — The dice tray: four levers, one of them constrained

Taken: fix the 372/388 content-width mismatch · cut the 24px pane gap to 8 · compact the
falling-damage entry · **"tighten the headers but don't collapse."**

The client's stated symptom — *"the roll log shows just under four rolls and scrolls horizontally"* —
is caused by the width mismatch. That lever is the one that fixes the complaint.

> **The headers are constrained and the constraint must not be quietly broken.** The three section
> headers are the accordion's own click targets in a stacked list, so the 44px tap floor applies and
> `min-height: var(--tap-min)` cannot come off. **"Tighten" therefore means visual weight only** —
> lighter type, less internal padding, a rule instead of a filled bar — and **that returns 0px of
> height.** The real vertical gain has to come from the header-to-content spacing.
> Report the number actually recovered. Do not report a header shrink that did not happen.

*("Remove the gaps between the dice / combat-log / encounter areas" had no referent: those three are
sections of one accordion and are already flush. The levers above are what actually costs the space.)*

### 16 — Recent monsters: a disclosure row with a count

`Recent (6)` plus a chevron. Reads as a click target at a glance and on touch, and keeps the
click-to-expand behaviour the client asked to keep.

### 17 — "Shown to players" becomes an eye icon with no label

State is carried by the magenta the client kept. Removing the label removes the optical-centring
complaint at the root rather than tuning it.

> **Needs an `aria-label` and a tooltip.** An icon-only toggle with no accessible name is a
> regression, not a simplification.

### 18 — The builder door goes in both places

On the claim screen beside the D&D Beyond PDF import (`apps/client/src/actors/ClaimCharacter.tsx`)
**and** as an action on the My Character tab. The claim screen catches a first-time player at the
moment of need; the tab catches a second character later.

Levelling (`apps/client/src/builder/LevelFlow.tsx`) gates on the same policy, so the same reasoning
applies — if the policy is open, the level-up door should be reachable from My Character too.

### 20 — The character bar over the map is removed entirely

The My Character tab replaces it. **Returns 69px**, and disposes of its teal bubble border as a
de-pilling instance, because the element is gone.

**Running total of map real estate recovered on a player's phone: ~180px** (56 + 53.6 + 69).

---

## Identity block

### 21 — Chrome metal: hero surfaces only

Reverses the bar in part, not in whole. The original ruling's operative words were *"never a panel
header"*, and that still holds. Hero surfaces — the same list as ruling 2 — may use it. Ordinary
panel headers may not.

### 22 — The table sky: behind the chrome, never behind the map

Reverses the no-sky ruling in part. Its stated reason — the map is the content, and a sky competes
with tokens and fog — survives intact and now reads as a **scoping** rule: dock, sheet and margins get
the horizon; the map stage stays a clean dark plate.

> **21 and 22 must land in `docs/ai-ledger/decision-log.md` as dated reversals, not quiet edits.**
> The no-sky entry was explicitly flagged at the time as something an agent must not "fix" later. An
> agent reading only the old entries will revert this work unless the reversal is on the record.

### 23 — ~~`.surface-glass` is deleted~~ **SUPERSEDED. It renders. It stays until the material replaces it.**

**The original ruling rested on two claims the director made and both were false.** It is not 285
declarations — it is **6, across 2 rule blocks**, with 4 markup call sites. And it has not "never
rendered": there *was* a real import-order override, it was diagnosed, and it was **already fixed in
commit `029dc87`** before this round began. `.surface-glass` paints at HEAD on the settings groups and
on both shared-screen control columns.

The client chose "delete it" on the basis that nobody had ever seen it. That basis did not exist.

**Revised ruling: `.surface-glass` stays until ruling 2's panel material actually replaces it**, and
its retirement belongs to the identity lane, not the mechanical one. Deleting it early would strip a
real `color-mix` + `blur(8px) saturate(1.15)` from three live surfaces — one of them
`apps/client/src/viewer/viewer-controls.css`, the shared screen ruling 34 just gave *more* identity.

> **The lesson generalises and is why this is written out rather than quietly edited:** a decision
> justified by "this costs nothing" must have the nothing verified before it is offered, not after.

### 25 — Page motion: a scanline wipe

> "Scanline wipe, but dont overdo it"

**The qualifier is the spec, not a mood.** It means:

- **≤180ms**, one band, one pass. No repeat, no trailing bloom, no second band.
- **Tab and page transitions only.** Not panel expands, not drawer opens, not list updates, not
  accordion sections. If it fires on every state change it has been overdone by definition.
- **Moves no layout.** The wipe is paint; nothing translates. This is why it beat the slide.
- **`prefers-reduced-motion` falls back to a plain opacity fade**, not to nothing.

An implementer who adds the wipe to a fifth surface has broken this ruling, not extended it.

### 26 — The tab bar gets its own material, and no glow

Rim, bezel and fill, so the bar reads as a piece of chrome rather than a strip of background.
Consistent with ruling 2's split, and it leaves the region's glow budget unspent — which matters
because the tab bar sits next to regions that do glow.

### 27 — The entry animation: 1.75–2.0s, both elements, staged

> "didnt realize it was a glitch. maybe keep it closer to 1.75-2s. both."

**This supersedes the original 2–2.5s figure.** That number was the client's estimate of how much
*slower* the entry needed to feel, set while assuming the jumpiness was inherent to the timing. It is
not — it is a defect. With the defect fixed, less time is needed to feel deliberate.

**The binding number is 1.75–2.0s. The 3s ceiling is dead; do not treat it as headroom.**

Staging: the grid rushes first, the sun crests as the app resolves. Two beats, so neither element has
to move unnaturally slowly to fill the run.

> **The glitchy, jumpy feel is a defect to diagnose, not a timing knob.** If the fix is "make it
> longer", the diagnosis has not happened. Find what jumps — a reflow mid-run, a late-loading font, a
> transform-origin shift, a non-composited property — and fix that.

### 28 — Scanlines on the outermost panel only

Nested panels keep rim and bezel and drop the scanline fill. Removes the moiré risk where surfaces
stack — most of the Codex and the dice tray — at no cost to texture, since every screen has an
outermost panel.

### 29 — Daybreak gets a daylight translation, not an exemption

Same shapes, same structure, ink-on-paper values: the neon rim becomes a hard dark line, the scanline
becomes a faint paper texture, the glow becomes a coloured shadow. **The identity is carried by
geometry, not by luminance** — the only formulation that survives "legibility outranks vibe".

This is the theme where every measurement in the identity work must be re-taken, and where ruling 3's
arcade-type watch will fail first if it fails at all.

### 30 — The map stage: a 2px rim plus corner ticks

The stage is framed as an instrument. Nothing is painted behind tokens, fog or measurement, so ruling
22 is untouched.

> The ticks are decorative and must be `pointer-events: none`. The map's own hit-testing is not
> negotiable.

### 31 — Form controls: rim and corner cut, no texture

Fields take the 2px rim and the chamfered corner; the fill stays flat. **Nothing textured ever sits
behind text a person is reading or editing.**

### 32 and 33 — Density: paint *plus* a uniform tightening pass

The client overrode the director's "paint only". Their call, taken with the cost stated: round 1's
layout results go back in play. One spacing scale, tightened once, applied everywhere — and because
it is one scale, it must be **one commit that changes the scale**, not per-surface hand-tuning.
Otherwise "uniform" is a claim nobody can check.

> **Four guardrails, none optional:**
> - **Re-run `scripts/no-scroll-audit.mjs` on all 9 viewports.** It is already red on 14 cells;
>   **no cell may go from green to red.** A tightening pass that creates a new scroller has failed,
>   however good it looks.
> - **All six ratchets in `apps/client/src/design-conventions-shape.ts` stay at their current numbers
>   or shrink.** Never add an allowlist row.
> - **The tap floor is not density.** 44px is a floor, not a spacing value. Nothing here may take a
>   control under it — ruling 15 is the same instinct hitting the same wall.
> - **The ~180px recovered on a player's phone is banked, not spendable.** Density may not quietly
>   hand it back as padding elsewhere.

### 34 — The shared screen: more identity, less density

Bigger type, full sky, drama the interactive screens cannot afford. It is the only surface nobody
touches and the only one read from across a room.

> **This collides with ruling 33, and the collision is resolved here.** "Uniform" means uniform across
> the *app*. **The public viewer is exempt from the tightened scale and takes its own, looser one.**
> An implementer who applies the app scale to `apps/client/src/viewer/viewer.css` has followed 33 and
> broken 34. Viewer surfaces are also the projection boundary: any change there is a viewer-safety
> change.

### 35 — The roll result flares; the dice do not tumble

One-shot bloom on the total, ~250ms. The reasoning generalises and is worth keeping: **rolling is the
app's most repeated action, so any beat between the click and the answer is charged forty times a
session.** A flare costs nothing because it plays *on* the answer rather than before it.

Freeze under `prefers-reduced-motion` — the result still changes colour, it just does not bloom.

### 36 — Turn change: the row lights and the token pulses once

One pulse, no repeat: an event, not an alarm. It ties the initiative list to the map, which is the
point — a player looking at the map misses a list-only highlight, and that is the exact moment they
most need to notice.

> Verify **on a phone, out of the GM's seat.** The player's turn-change is the case that matters, and
> the class of case round 1's build lanes systematically failed to check.

### 37 — Selected tokens get corner brackets, not a ring

Rhymes with ruling 30's corner ticks, and sidesteps a collision: **tokens can already wear an HP
ring**, and two concentric rings on one token is unreadable at phone token sizes. Brackets and rings
never compete for the same edge.

### 38 — Map tools: full identity, fog included — with a hard constraint

> "full identity, fog included - but do what you can to make the fog option to be distinct /
> unmistakable within that framework"

The client took the richer option *and* named its risk, so the risk is the ruling:

- **The fog edge stays a hard, high-contrast boundary.** Identity goes in the fill — texture,
  gradient — never in a soft feather. "Is this square hidden?" must never become a judgement call; it
  is a rules-visible fact.
- **Fog stays unmistakable against the other two instruments.** Ruler and ping are thin neon strokes;
  fog is a mass. Different weight, different behaviour, no shared silhouette.
- **The GM's see-through fog and the player's opaque fog stay obviously different states.** A GM who
  cannot tell at a glance what their players can see will reveal something by accident. This is a
  projection-adjacent visual, not decoration.

### 39 — Alerts and toasts: material plus a coloured leading rule

Severity moves out of the fill and onto a 2px leading bar, so text sits on a neutral ground in every
theme. That is what makes it survive daybreak — coloured-text-on-tint is the combination that fails
there first.

The severity hues are unchanged. `--caution` in particular keeps its meaning (*warning / not
finished*) and must not be borrowed by the segmented on-state in dusk.

### 40 — Interaction: the rim brightens and the cue triangle appears

The landing door's own behaviour, carried inward — which is the literal answer to *"a strong
disconnect between the landing experience and the app"*. **Disabled drops both the rim and the
texture and keeps a flat box**, so inert reads as a material state rather than only as reduced
opacity.

> Hover does not exist on half the table's devices. **The press state must carry the same information
> as hover, not less.** A control whose only affordance is `:hover` is the `packages/ui/src/primitives/Steps.tsx`
> bug already on the known-open list, repeated.

### 41 — The modal scrim: darken plus a vignette

The dialog sits in a pool of light. **A scanline scrim was rejected on ruling 28's own grounds** — it
would lie directly over the scanlined surface beneath it, which is where moiré lives. The dialog is
the outermost panel while open and carries the scanline; the scrim must not.

### 42 — Loading: a scanline sweep, not a shimmer

The placeholder reads as a screen drawing itself.

> **This is not ruling 25's wipe and must not become it.** Same vocabulary, different element,
> different meaning: the wipe says *navigation*, the sweep says *waiting*. The sweep loops while
> loading; the wipe fires once. Reusing one animation for both is the "overdone" that ruling 25
> forbids. Under `prefers-reduced-motion` the sweep stops and the placeholder holds a static tone.

### 43 — Icons: the **heavier silhouette**, not a stroke — calibrated, not maximised

> "heavier stroke, hard corners, but dont overdo it or make it overly distracting. but dont err so far
> on the side of caution that you underdo it either"

**The instruction could not be executed as written, because the premise was false.** All ~69 glyphs
in `packages/ui/src/primitives/icons.tsx` and `apps/client/src/codex/icons.tsx` are **filled
silhouettes** — `fill="currentColor"`, zero `stroke` attributes in either file. There is no
`stroke-width` to raise and no rounded join to mitre.

The two real options were drawn from eight of the app's own glyphs and shown to the client at display
size and at the real 17px, on both grounds. **They chose the heavier silhouette.**

**The ruling:** every glyph keeps its shape and stays filled; the drawing changes — **thicker limbs,
silhouette corners mitred to points, negative space tightened.** The stroked-outline conversion is
rejected.

The reasoning is worth keeping, because it is about risk rather than taste: **the heavier silhouette
is a change of degree — the outline was a change of kind.** An outline set replaces the drawing
convention, so it either works everywhere or it reads as foreign beside the marks that stay filled no
matter what: the health ring, the status dots, the gauges (all protected by ruling 24). It is also
the thinnest of the three, which puts it at most risk in daybreak; the heavier silhouette puts *more*
ink on a light ground and so reads stronger there, not weaker.

The client's calibration still binds, restated for a fill-only set:

- **The floor:** the change must be obvious in a side-by-side at 100%. If a reviewer has to be told
  which is which, it was underdone. **Cleared:** ink coverage up a median **+38.2%** across the UI set
  and **+25.7%** across the Codex set; painted limb at 17px 1.420px → 1.980px.
- **The ceiling, as the director first wrote it, was never satisfiable and has been restated.** The
  rule said a glyph's limb must not exceed the stem of the label beside it. Measured, **the old set
  already breached that** — 1.420px of limb against a 1.337px button-label stem, 106%, before this
  lane touched anything. A floor requiring more weight and a ceiling already exceeded cannot both
  hold. **The operative ceiling is parity at real paired sizes**, which is where the set now sits:
  94% at button size, 95–117% on the map toolbar. It is only above 100% where the glyph carries no
  adjacent label at all.

Some glyphs barely move and that is correct — this is a weight change, not a redraw quota. Fog gains
weight while **holding its band gaps** so they never fuse; Play is a solid triangle with no limb to
thicken. **Three glyphs correctly lost ink** (Warning, Info, the Codex quest mark): on a counterform
glyph the bang or the stroke *is* the counter, so widening it removes fill. Coverage is the wrong
metric there and all three read bolder.

**Scope was 97 glyphs, not the ~69 this ruling estimated** — the Codex registry holds 68, not ~40.
Two files, no call sites, no export or signature changed.

**Two glyphs had never rendered at all** and were fixed in passing: the Codex `graveyard` cross and
the `sessions` ruled lines were wound the same direction as their parent under nonzero fill, so they
were invisible. They are counters now.

This is the best candidate for **phase 6, the director's polish pass**. It is a dial, and dials are
set by looking.

### 44 — Scrollbars: a thin neon track, always visible

Not hover-revealed. **Discoverability is the functional half of this ruling** — "is this region
scrollable?" has been a recurring real problem in this app, and a permanently visible track answers it
without inventing an affordance.

> Style the track and thumb. Never replace the scroller with a custom widget — keyboard and assistive
> behaviour comes from the real one.

### 45 — The character sheet: quiet body, hero header

The name/class/portrait block is treated as a hero surface; everything below stays structural — rims
and rules, **no texture behind numbers a player reads mid-fight**.

> **The hero header must cost zero height.** It re-treats a block that already exists. Under the
> density pass the sheet is being tightened, and a hero moment that quietly adds 40px has taken back
> what that pass just won.

### 46 — Codex entity kinds: colour as an accent only

The kind badge and a leading rule take the hue; nothing sits behind text. Makes a long page list
scannable without a second colour vocabulary.

> **The palette already assigns meanings.** Magenta is *act*, `--caution` is *warning / not
> finished*, cyan is focus in daybreak, `--state-on` is *on*. **Entity-kind hues must come from
> outside that set, or a badge will read as a state.** If the kind list outgrows the free hues, kinds
> share a hue and the icon disambiguates — do not borrow a meaning-bearing colour to stretch the set.

### 47 — List rows: hairline rules, no fill

A 1px rule between rows; the selected row takes ruling 7's leading tick. This is the most repeated
layout in the app — roster, Codex page list, replays, monster browser — so it has the widest reach.

**Zebra was rejected for a specific reason, not a taste one:** an alternating horizontal tint sits
underneath ruling 2's scanline texture, and two horizontal rhythms at different periods is where
interference appears.

### 48 — The connection strip folds into the tab bar's material

One piece of chrome instead of two stacked bands. Removes a horizontal seam at the top of every screen
and contributes real height to the density pass rather than just paint. The strip is still status, not
navigation — sharing a material must not make it look tappable.

### 49 — Every button takes the cut corner

The chamfer is the app's silhouette, not a signal about importance; importance is already carried by
fill and colour. Consistent with ruling 24, which put the same corner on badges, chips and counts.

> **This promotes ruling 14 from an escape hatch to the default implementation.** `clip-path` clips
> hit-testing, and *every button is a tap target* — so **the corner is painted on a backing layer on
> every button**, not just small ones. The existing `sm` exemption in
> `packages/ui/src/primitives/Button.css` is not a special case to preserve; it was the symptom that
> the technique was wrong, and it disappears once the paint moves off the interactive element.
> **Re-run `scripts/tap-audit.mjs` after this lands** — it is the single change most able to silently
> shrink hit areas app-wide.

### 50 — Game numbers: a distinct face with tabular figures — **the face is Space Mono, and the stated example was wrong**

HP, AC, initiative and dice totals. Applies to *game* numbers, not every digit; counts and page
numbers stay in the body face so the distinction keeps meaning something.

**Two corrections from wave 2, both measured:**

- **The arcade face cannot do this.** Russo One ships **no `tnum` feature** — `font-variant-numeric:
  tabular-nums` changes nothing on it, and its `1` is 60% the width of its `0`. Bungee likewise. The
  only tabular non-body face already on disk is **Space Mono**, so `--font-numeric` is Space Mono 700.
  A purpose-built arcade numeric face would be a new font dependency, which is a bigger change than
  this ruling authorises.
- **The `44` → `9` example is not a tabular problem.** That loses a digit, so the row moves whatever
  the figures do. Tabular buys `44` ↔ `11` and an exact `1ch`. What actually stops the reflow is a
  **`min-width` in `ch` units** reserving the widest expected value — the mechanism is documented
  beside the token. The ruling's intent (numbers that change must not shift the row) stands; the
  mechanism named in it does not deliver it alone.

### 51 — The whole chrome carries the role hue

Tab bar, connection strip and panel rims, not just a single rim. The reason is operational: **the
client runs a GM window and a player window side by side, and acting as the wrong role is the mistake
this prevents.**

> - **A role hue is not a security boundary.** Projection is. Nothing may become GM-only *because* it
>   is tinted; the tint sits on top of a boundary enforced in `apps/server/src/projections.ts`.
> - **The public viewer takes no role hue at all.** It is the shared screen, it has no role, and a GM
>   tint on the screen the players look at would be actively wrong.
> - **Role hues must not collide with `--state-on` or `--caution`.** If the free hues are spoken for,
>   the role signal changes *value* rather than hue.

### 52 — Menus, popovers and tooltips: panel material, brighter rim

They read as panels that arrived, and the brighter rim carries "on top" without a drop shadow. One
rule for all three. They are usually the outermost panel while open, so by ruling 28 they do take the
scanline.

### 53 — The dock is part of the shell

Panel material, attached to the frame with no gap and no shadow, so the map and the dock read as one
instrument. Also cheaper under the density pass — an attached panel needs no surrounding margin.

### 54 — The theme switch goes in both places

Settings and the connection strip. The client took the option the director flagged as "two doors to
one preference", and the distinction that makes it defensible is recorded: **Scenes was two doors to a
destination; this is one preference with a real quick-access case** — the room gets dark mid-session,
which is what dusk exists for.

> - **Settings stays the canonical home.** The strip control is a shortcut, not a second setting.
> - **The strip control is an icon with no label**, and must not become the most prominent thing in
>   the app's most persistent row.
> - It is still a tap target: the 44px floor applies, in a row ruling 48 is also tightening.

### 55 — Empty surfaces get one door each, hero-treated

No dashed boxes, no "nothing here yet" — each empty screen says the single next thing to do. Extends
the existing scene-surface empty state (one line, one door) to every surface that can be empty.
**A guided first-run wizard was rejected as build cost for a screen seen once.**

Cheap by construction: an empty surface has no content for a hero treatment to compete with, which is
why it was already on ruling 2's hero list.

### 56 — Error surfaces: designed frame, technical detail behind a disclosure

Reads as handled rather than broken, gives a clear next action, and keeps the detail one tap away for
whoever is debugging. This matters more than it sounds: a cold deep link to `/settings` was crashing
8 out of 8 times until recently, so these screens get met mid-session, not in a test.

### 57 — Two Codex shapes, each earned

Journal and quests are documents and take ruling 11's list-plus-editor with summonable context. **The
atlas and the calendar get their own compositions** — a map is spatial, a calendar is a grid, and
forcing either into a document shape fights what it is.

Two shapes is the ceiling, not a licence for five. Per-surface composition is what produced the
"stitched-together panels" complaint in the first place.

### 58 — One reveal language everywhere

Ruling 17's eye icon and magenta become the app-wide signal for "players can see this" — identical
glyph, colour and position on Codex pages, tokens, scenes and journal entries.

> **This is a safety property, not tidiness.** Reveal is the control where a GM misreading the state
> leaks something to the table. Consistency is what makes it unmisreadable. It is still not the
> boundary — the boundary is the projection — but it is what stands between a GM's intent and their
> players' screens, and it should look the same every time they meet it.

### 59 — Nothing defers; the work takes as long as it takes

The client declined the cut order entirely, including the director's recommendation to defer the
density pass. **There is no round 3 to push work into and no scope to trade against time.** If a phase
is not finished, it gets another phase.

### 60 — The acceptance bar is all three tests

Recorded at the top of this document, because the client asked for it to survive context loss and the
top of a session-start-linked document is the only place that reliably does.

---

## Addendum — decisions raised during implementation

Discovery closed at 60. These came out of the bug-fix plan, which flagged them as questions it had no
authority to answer. They are client rulings and carry the same weight as the sixty above.

### 61 — A6: a real new tab, and the password prompt is accepted

The obstacle was real and is not a bug: **the GM token is deliberately memory-only and never
persisted**, so any new tab starts with no credential. The client accepted the honest consequence.

`/settings/api` becomes a real address — bookmarkable, deep-linkable, full window width — and "open in
a new tab" lands on the app's own GM sign-in card, which takes the password once.

> **The three alternatives were rejected on the same grounds and should not be revisited:** the token
> in the URL (lands in history and referrers), the token in `localStorage` (a direct reversal of the
> memory-only decision, for a documentation page), and a `window.opener` `postMessage` handshake (new
> mechanism, new attack surface, still copies the credential into a second document). Authenticating
> on the *player* token the way `sheet.html` does was measured and works — and was rejected because it
> silently fails on a GM-only browser, which is the exact machine the GM reads this page on.

The *shape* of the reference is a separate problem and is not closed by this: at roughly 31,700px it
is a 36-screen document with no navigation, and full width does not make that readable. It needs a
table of contents, per-group collapse or a filter — design work, not a bug fix.

### 62 — The roster heading becomes "Roster"

A naming drift, not a copy trim: the tab is labelled `Roster` — recorded as the deliberately settled
word, matching its address and the party strip — while the page heading said `The party`. **The
heading is the drift, so the heading moves.** This touches the play-vocabulary lock, so it lands as a
naming change with the lock's corpus re-measured, not as helper text.

---

## Phase 0 — premises that turned out to be false

A read-only intake mapped every ruling to the files it touches. It found four rulings resting on
premises that are not true of this codebase. **Finding one is a success, not a failure** — a ruling
written from a wrong premise is the most expensive thing to discover late. All four are corrected in
place above or here; none was quietly dropped.

### 63 — Density: tokenise first, then tighten. Ruling 33's premise was largely false.

The spacing scale exists — ten steps, `--space-1` through `--space-16`, in
`packages/ui/src/styles/design-tokens.css`. But **65% of the client's CSS bypasses it**: 904
hard-coded spacing declarations, concentrated in exactly the surfaces the client complained about
(`apps/client/src/encounter/encounter-panel.css` 413, `apps/client/src/styles.css` 150). The ui
primitives are genuinely tokenised (14% bypass); almost nothing else is.

So "one commit that changes the scale" would have moved ~42% of the app's spacing and **0% of the
table and the encounter panel** — shipping a *non-uniform* tightening while reporting a uniform one.

**The client took the honest version: a mechanical lane converts the 904 declarations to the scale
first, then one commit changes it.** Large, but every step is reviewable and the result is uniform
for real. Ruling 32's four guardrails are unchanged and apply to both halves.

### 64 — Ruling 2's material is a build, not a reuse

Two measurements, both of which change the size of the identity work:

- **`Panel` reaches 5% of the app.** The primitive has **6 real call sites, all in the Codex**.
  There are **≥119 hand-rolled panel-shaped rules across 20 stylesheets** that would not inherit
  anything from editing `Panel.css`. The material has to be a shareable utility applied at ~119
  sites, not a primitive edit.
- **Five of the six landing-door pieces have zero reach outside the landing.** The 2px rim, the inner
  bezel, the cue triangle and the chamfer utility have **no call sites at all** beyond `.choices`;
  `.sign` has one, and it is the styleguide. Only the scanline (11 app surfaces) and the neon beam
  (7) already travel.

**Consequence: "carry the landing door inward" means expressing the rim, bezel, cue and chamfer as
shareable utilities before any surface can take them.** That is a foundation lane that must land
before the identity lanes, not alongside them.

### 65 — Ruling 15's corrections: right conclusion, wrong three things

The 44px floor holds — the headers are real click targets in a stacked flex column and
`min-height: var(--tap-min)` cannot come off. Three factual corrections the implementer needs:

- **They are the dock's headers, not the dice tray's.** Turn order / Dice / Combat log, in
  `apps/client/src/encounter/DockAccordion.tsx`. The dice tray has two `<details>` of its own.
- **They only exist at ≥980px.** Below the rung the dock renders a `Tabs` bar instead — so on a phone
  there are no stacked headers and no header height to recover. Ruling 15's vertical arithmetic is
  laptop-only, which matters because acceptance test #1 is a phone.
- **The 24px gap is not the accordion's** — `.dock-accordion` is already `gap: .5rem`. The live 24px
  gaps are `.table-layout` and `.table-sidebar` in `apps/client/src/styles.css`, and cutting those
  changes the map/dock relationship, not the dice tray's internals.

### 66 — Ruling 16 is half shipped, and B6 names the wrong surface

`Recent (6)` **already renders the count**. What is missing is the chevron and the click affordance:
the `<summary>` in `apps/client/src/scenes/scene-prep.css` has no border, no background and no
list-marker handling, which is precisely the "does not look collapsed" symptom. Scope is one CSS rule
plus a chevron, not a re-plumb.

Separately: **"On this map" is in the New-scene modal, not the Scenes popup.** A lane told to edit the
popup will not find it.

---

## Director's rulings made without spending a client question

These were decided by the director on the record, because they are contracts rather than taste:

- **The focus ring does not change in this pass.** It already passes contrast in all three themes, and
  ruling 4 recorded that it is double-duty as `--line-hover` in daybreak. Restyling it would move two
  things at once for flavour.
- **The tab bar is exempt from ruling 44's always-visible scrollbar.** `packages/ui/src/primitives/Tabs.css`
  deliberately hides its scrollbar and replaces it with an edge-fade mask, and its own comment records
  why: the fade is *the only thing telling a phone user there are more tabs*. Ruling 44's stated
  justification is discoverability — so hiding the scrollbar where a better discoverability signal
  already exists **serves** the ruling rather than breaking it. Everywhere else, ruling 44 applies.
- **The scene card's top-left corner stays with the LIVE / Staging badge; D6's counts go bottom-left.**
  D6 asked for counts "in the thumbnail's top-left, opposite the drag controls", but
  `packages/ui/src/styles/patterns.css` already puts the live-state badge there. State outranks a
  count, and the intent — counts inside the thumbnail, away from the tools — survives the move.
  Note also that `.nh-card-tools`' gap is the *measured minimum* that keeps two 44px hit areas apart;
  the density pass must not tighten it.
- **The remaining C and D items need no further discovery** — they are mechanical: the scenes popup's
  nested borders · the gallery cards (the client fully specified them: drop the filename, counts into
  thumbnail badges opposite the drag handle) · the revoked-displays list · the map toolbar's
  background-vs-glyph mismatch, whose other two thirds die with the `apps/client/src/scene/encounter-map.css`
  scoping fix · the Codex control-height alignment · the duplicate "My sheet" button.

---

## Process notes

- **60 questions over 20 rounds**, two per round from round 4 onward at the client's request.
- **Where a ruling overrode a director recommendation, the ruling says so.** That is deliberate: the
  overrides are the ones most at risk of being "corrected" by someone reading only the reasoning.
- **A quoted line is the client's own words and outranks the paragraph beneath it.**
- **The client's qualifiers are specs, not moods.** "Don't overdo it" (ruling 25) and "don't underdo
  it either" (ruling 43) were both turned into checkable rules on purpose. Anything vague enough to
  be argued about later has been given a number or a test.
