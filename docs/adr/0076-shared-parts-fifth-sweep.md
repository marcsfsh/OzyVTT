# ADR-0076: The shared parts, fifth sweep: Dawn's coloured words, one tag, one close, one stepper and the smaller parts

## Status

Accepted

## Context and decision drivers

ADR-0072 to ADR-0075 brought the shared parts of the 23 approved mockups into line over four sweeps. The owner asked for
one more and for twenty-four findings where the fourth found sixteen. The fifth sweep captured every page at laptop and
phone size, in Dusk and in Dawn, with every earlier part plus tags, faces, closes, tabs, fields, lamps, cards, keyboard
hints, text that is clipped, spills or wraps, and the contrast of every line against what is behind it: 5,490 captures
from 127 pages, each measured from its computed style (`docs/design/polish/T-consistency/history/5-sweep.html`, each
finding with its parts before and after). It found twenty-five:

- The table screen's phone pages behind the menu and the preview drew the laptop's bar under the header.
- In Dawn, amber words read at 2.3:1, magenta at 2.7:1 and violet at 3.6:1, under the 4.5:1 text needs.
- The Compendium's laptop home drew its own kind cards.
- The frame's turn order drew smaller faces on a thinner rim, with other initials.
- A record's stat block repeated the record's name under its title.
- The Codex's date bar and the Compendium's Sources line were full boxes with a fill.
- The Codex home drew a read-only group as a box.
- A harmful condition came in two type styles.
- Closes were a plain icon, an icon on a Base line, or the word Done.
- The Dusk and Dawn switch was 32 px in two places and 36 px in a third.
- Steppers came at two heights with three number sizes, one with a hyphen for minus.
- CLAIMED, GET and POST and a template's parts were boxed words in Bai Jamjuree.
- A hashtag was drawn two ways.
- A title opening a record or a pane ran from 17 to 22 px.
- Steps marks came at three sizes.
- Saved had its lamp in two editors and not in three others.
- The ruling card carried a violet rim on a box.
- Tags were 20 and 22 px.
- Icons in content buttons ran from 13 to 20 px.
- Tabs ran from 42 to 45 px, in two type sizes.
- Fields came at four heights.
- Lamps came at four sizes.
- Field labels, timeline heads, counters and status words had slipped the eyebrow.
- A toast's close was 36 or 28 px wide.
- A template's drag handle was 22 px on a phone.

The owner asked for all twenty-five to be fixed.

## Considered options

- Leave the mockups as the fourth sweep left them.
- Fix the twenty-five in the approved mockups and specs, and write the recurring ones into the theme spec.

## Decision

1. All twenty-five are fixed in the approved mockups and their specs. The shared values (tags, closes, steppers, tabs,
   fields, lamps, icons, titles, marks, eyebrows, kind cards, the bars' Cradle) are drawn once in every mockup's
   `mockup-src/p4v-parts.css`, as `p4t-touch.css` draws the phone's floor.
2. Words in amber, magenta and violet take new text shades, `--caution-text`, `--magenta-text` and `--violet-text`, as
   danger and cyan words already do; in Dawn the shades are darker, and lamps, edges and fills keep the colour.
3. The theme spec amends 2.2 (a dialog's close, a title in a page), 2.4 (the eyebrow's other places, a bar of actions),
   2.5 (segments, steppers, tabs, icons in buttons, a toast's close, fields), rule 4 (one mark), rule 9 (text shades)
   and rule 19 (one tag, one lamp, Saved as readiness, one kind card).
4. The shared parts are built once in the kit, as ADR-0072 set out: `docs/design/polish/T-consistency/PLAN.md` adds the
   fifth sweep's phase.

## Consequences and tradeoffs

- Dawn's amber, magenta and violet words are darker than their lamps and lines; the pair reads as one colour at two
  weights, as danger already does.
- Tags, steppers and tabs grow by 2 to 8 px in places, and a few rows and toolbars run a little taller.
- The Compendium's kind cards lose their boxed emblem, and its stat block loses a heading inside its record.

## Mobile, security, and visibility impact

- Every control on a phone keeps the 44 px floor, the template's drag handle included.
- No data, command, projection or route changes. The GM ONLY tag and the hidden marks keep their meaning.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- `docs/design/polish/T-consistency/history/5-sweep.html`: each finding, with its parts before and after the fix.
- `docs/design/polish/T-consistency/consistency.html`: every shared part as the approved mockups now draw it.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus a contrast check of every line in Dawn.
