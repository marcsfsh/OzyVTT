Build the polish pass's shared parts (one side list, the crumb on the title's line, a menu that names its thing, one way
a phone sheet opens, one Cup in view, what a phone header names, a list's toolbar, fields, states and kinds, buttons and
hit areas, rows and the controls in them, steps, overlays, type, colour, dates and copy, one eyebrow, one notice, title
sizes and the last hit areas, and Dawn's coloured words, one tag, one close, one stepper, tabs, fields and lamps), on
the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/T-consistency/SPEC.md`, then 2.2, 2.4, 2.5 and rules 2, 4, 7 to 12 and 13 to 21 in `polish/T-theme/SPEC.md`,
then `polish/T-consistency/PLAN.md` sections 0 to 4. Phase O0 updates `docs/design/polish/` from the zip and adds
ADR-0072, ADR-0073, ADR-0074, ADR-0075 and ADR-0076; do not commit the zip itself.

These parts sit under every area. Before O1, check that the theme's T1 to T3 and A's dialogs and menus (A6) are on the
branch. If one is missing, stop at the phase that needs it and tell me.

Work through phases O0 to O13 in order, one commit per phase, and push after each one. Each phase builds its part once
in the kit and converts the surfaces already on the branch; leave a surface that is not built yet to its own piece, and
list what you converted and what you left in the commit body. Other sessions commit on this branch: fetch and pull
before each phase and again before each push, never force-push, rebase or amend anything already pushed, and ask me
before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. Before calling a phase done, run the checks in section 6 of the plan and look at the parts it
converted, side by side with others of their kind, at 1280 by 800 with a mouse and at 390 by 844 with touch, in Dusk and
Dawn, against `consistency.html` and, for the third to fifth sweeps' parts, `history/3-before-after.html`,
`history/4-sweep.html` and `history/5-sweep.html`. Tell me what you ran and what you saw, including anything that failed
before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
