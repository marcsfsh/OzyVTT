# ADR-0045: Light rail motion

## Status

Accepted on 2026-10-28 with the owner's choice of Light rail, after two rounds of mockups. Built in phases; the
Motion section of `docs/DESIGN.md` holds the rules every phase follows. The plan (`PLAN.md`, with every moment, its
file and its trigger) and the approved mockup are committed in `docs/design/light-rail/`.

## Context and decision drivers

Page and tab changes played a scanline wipe over the pane. It read as a CRT, and it was the only motion that said
something had changed. Most changes at the table (a turn passing, hit points falling, a lamp being spent, a roll
landing) had no motion at all, and the few that did each used their own idea.

The owner ran three rounds of options. Round one compared Chroma settle, Horizon glint and Tape shuttle. Round two
compared four takes on the glint: Glint refined, Light rail, Horizon bloom and Chrome catch. The third round was the
approved Light rail mockup, with 88 moments in 18 groups.

Drivers: one motion language for change across the app; the server decides, so motion shows state that has already
arrived; the pane's no-transform rule, which keeps fixed overlays in place; phones first-class; and each 80s element
keeps its one job.

## Considered options

1. Keep the scanline wipe and add nothing. Rejected: it reads as a CRT, and change elsewhere stays silent.
2. Chroma settle or Tape shuttle everywhere (round one). Rejected as the whole language; Chroma settle stays for one
   job.
3. A horizon glint (round two: Glint refined, Horizon bloom or Chrome catch). Rejected as the whole language; Chrome
   catch stays for one job.
4. Light rail. Chosen.

## Decision

- **Light rail is the one motion language for change.** Light travels along a line that is already on screen, from
  where something was to where it is going. The old place drains, a comet runs, a burst lands and the new place
  fills. A wash may fall onto what changed. The content itself only fades.
- **Two effects from earlier rounds stay, each in one place.** Chrome catch, a sweep of the horizon's colours across
  letters, appears only on YOUR TURN, because chrome lettering shows who is acting. Chroma settle, a pink and cyan
  split that settles, appears only when a condition chip arrives or concentration breaks.
- **Status gets its own lines**: the reconnect bar's line and a plate's top edge. The horizon keeps its one job of
  marking the top of the app.
- **Timing.** Content starts fading in within 60 ms and is complete within 300 ms. The light around it ends within
  500 ms. A sequence that lights several things in order (a long rest, the start of an encounter) may run to 700 ms.
  Nothing waits on light, and nothing loops.
- **Two moments are new features as well as motion.** Damage numbers rise from a token when damage lands, and the
  table screen glides when it follows the GM's camera (320 ms, with a wash as it settles). A damage number lasts
  900 ms, the one exception to the 500 ms rule, because it is a value someone reads. The same value stays in the
  result card and the log.
- **Time passing animates effect durations only.** No world clock is added.
- **One engine.** `packages/ui/src/motion/lightRail.ts` draws the parts with the Web Animations API, in the
  colours and timings of the tokens in `design-tokens.css`; `styles/light-rail.css` says how each part looks. The
  parts are throwaway `.lr-part` elements, hidden from assistive tech and the pointer, removed when they finish.
- **When not to animate.** `canMove()` is false under reduced motion, without the Web Animations API, while the page
  is hidden, and while the motion gate is held. `useSession` holds the gate from a connect or reconnect until one
  frame after the first snapshot has rendered, across a switch of encounter or map, and for a frame when a tab comes
  back from the background. Nothing animates on first mount.

## Consequences and tradeoffs

- The timing rule in `docs/DESIGN.md` changes from 120 to 200 ms to the content and light limits above.
- Decorative light never blocks input: parts take no pointer events, and the content is usable as soon as it is
  rendered.
- The scanline wipe is retired, along with the loops that break "nothing loops" (the skeleton sweep and both pings).
- Light lives in bars, strips, plates and overlays. Inside the pane only a wash may appear, and it animates opacity
  alone, so no fixed overlay is trapped.
- Every moment measures the DOM once after the change has rendered. A moment creates about six small elements at
  most and animates transform, opacity or clip-path.

## Mobile, security, and visibility impact

No new data reaches any audience: every moment presents a value the viewer's projection already holds. Damage
numbers appear only where that viewer already has exact hit points: always for the GM, for a player on their own
character and on creatures shown with numbers, and on the table screen as its health display allows. Where a
creature shows as a band, the burst and the band's drain play with no number. Every moment is checked at 390 px
with touch; on a phone the section tabs are at the bottom and their light runs along the top horizon at the tapped
tab's x.

## Migration / reversibility

The light is tokens plus one engine. Reduced motion turns it off, reduced transparency drops the wash and the glow,
and removing a moment's call leaves the component as it was. No data or schema changes.

## Validation evidence

Phase 0 adds the tokens, the engine, its hooks and the gate, with unit tests for the comet's path and its length
cap, drain and fill origins, flip deltas, the timings against the tokens and `canMove()` under reduced motion,
without the API, while hidden and while held. A smoke journey switches sections and tabs with motion on and checks
for console errors and leftover parts.
