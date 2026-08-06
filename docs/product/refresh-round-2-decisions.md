# Refresh round 2 — the client's rulings, in order

**Status:** discovery in progress. Nothing here is implemented.
**Read this when:** implementing any part of round 2, or when a choice looks arbitrary and you are
about to "improve" it. Most of these rulings overrode a director recommendation, and several
deliberately reverse an earlier written decision.

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

### 23 — `.surface-glass` is deleted, not revived

All 285 declarations go. **It has never rendered** — a stylesheet import-order bug has silently
overridden it since it was written — so deleting it is a zero-visual-change refactor and can ride in
the mechanical lane rather than the identity lane. Ruling 2's material is the app's one panel
vocabulary.

> Verify the zero-change claim by screenshot diff, not by reasoning. If any pixel moves, the no-op
> diagnosis was wrong somewhere and the deletion stops until that is explained.

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

---

## Director's rulings made without spending a client question

These were decided by the director on the record, because they are contracts rather than taste:

- **The focus ring does not change in this pass.** It already passes contrast in all three themes, and
  ruling 4 recorded that it is double-duty as `--line-hover` in daybreak. Restyling it would move two
  things at once for flavour.
- **The remaining C and D items need no further discovery** — they are mechanical: the scenes popup's
  nested borders · the gallery cards (the client fully specified them: drop the filename, counts into
  thumbnail badges opposite the drag handle) · the revoked-displays list · the map toolbar's
  background-vs-glyph mismatch, whose other two thirds die with the `apps/client/src/scene/encounter-map.css`
  scoping fix · the Codex control-height alignment · the duplicate "My sheet" button.

---

## Process notes

- **Two questions per round** from round 4 onward, at the client's request; option text kept short.
- **The round count floats.** What is fixed is the open-decision list, not a counter.
- **Where a ruling overrode a director recommendation, the ruling says so.** That is deliberate: the
  overrides are the ones most at risk of being "corrected" by someone reading only the reasoning.
