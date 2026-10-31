# ADR-0075: The shared parts, fourth sweep: eyebrows, notices, titles, the last hit areas and the third sweep's leftovers

## Status

Accepted

## Context and decision drivers

ADR-0072 to ADR-0074 brought the shared parts of the 23 approved mockups into line over three sweeps. The owner asked
for one last, final sweep of the mockups as the third sweep left them. It captured every page at laptop and phone size,
in Dusk and in Dawn, with the third sweep's parts plus eyebrows, notices and the icons inside buttons: 4,731 captures
from 127 pages, each measured from its computed style (`docs/design/polish/T-consistency/history/4-sweep.html`, each
finding with its parts before and after). Dawn drew the same parts at the same sizes. It found sixteen differences:

- Level up's step marks were 46 px squares, because the rule for a step also reached the mark inside it.
- The Compendium's filter chips, its open records button and the phone's Filters were boxes, cyan with a ring when on.
- Settings' "Today, 8:41 PM" broke over two lines in the credentials table.
- The Atlas's pin editor on a phone kept the Codex strip and a second Back; a faction's page kept CODEX and the strip.
- A dozen phone controls drawn with their own classes stayed under 44 px.
- Base line buttons at 28, 30, 32 and 39 px; the credentials' three actions with their lines run together.
- The Codex's next session card carried the horizon on its top edge.
- Settings' list still drew Token image and Release as ghosts.
- Prep's To make it ready stayed a display title on a phone.
- Dialog and sheet titles at 15, 16, 18, 19 and 20 px.
- Title rows at 22 px beside 24 px on a laptop, and 19 px beside 20 px on a phone.
- Small capitals in eight styles besides the eyebrow.
- Notices drawn six ways, one of them the dashed violet box that marks hidden content.
- "Oct 2, 2026" in a list of this year's dates, and "2026-11-08" in a date field.
- Phone rows at 34 to 40 px, and menu rows at 49 px.
- The SAMPLE tag in party blue.

The owner asked for all sixteen to be fixed.

## Considered options

- Leave the mockups as the third sweep left them.
- Fix the sixteen in the approved mockups and specs, and write the recurring ones into the theme spec.

## Decision

1. All sixteen are fixed in the approved mockups and their specs. The phone's 44 px floor for the parts drawn with their
   own classes joins the rest in every mockup's `mockup-src/p4t-touch.css`.
2. The theme spec gains rule 21 (one notice) and amends 2.2 (a title row's title 20 px on a phone; a dialog's and a
   phone sheet's title 20 px), 2.4 (one eyebrow everywhere), 2.5 (steppers, a toolbar's buttons, an add link and a
   chip's × on a phone; Base line buttons 6 px apart), rule 8 (a menu's rule inside its row), rule 9 (no horizon on a
   card), rule 19 (a state's colour) and rule 20 (a date field).
3. The shared parts are built once in the kit, as ADR-0072 set out: `docs/design/polish/T-consistency/PLAN.md` adds the
   fourth sweep's phase.

## Consequences and tradeoffs

- Small capitals grow by up to 1.5 px in the option table, the tools' labels, the lamps and the log; a few rows run a
  little wider.
- Notices lose their tinted fills, so they read quieter; their edge carries the meaning.
- The Codex's next session card stands out less; its Cup carries the horizon, as every primary's does.

## Mobile, security, and visibility impact

- Every control on a phone meets the 44 px hit area, the steppers, toolbars and a chip's × included.
- No data, command, projection or route changes. The note that players never get a stat block keeps saying so, now as a
  notice rather than a hidden-content box.

## Migration / reversibility

- Client and docs only. Reversible by reverting the client commits.

## Validation evidence

- `docs/design/polish/T-consistency/history/4-sweep.html`: each finding, with its parts before and after the fix.
- `docs/design/polish/T-consistency/consistency.html`: every shared part as the approved mockups now draw it.
- The plan's checks at 1280 by 800 and 390 by 844 in Dusk and Dawn, plus the full checks and the smoke suite.
