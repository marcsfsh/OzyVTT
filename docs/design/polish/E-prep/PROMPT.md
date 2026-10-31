Build the frame of area E of the polish pass, prep (Prep's front page, an encounter's page, making an encounter and
setting a map's grid), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/E-prep/SPEC.md`, then `polish/E-prep/PLAN.md` sections 0 to 4. Phase E0 updates `docs/design/polish/` from the
zip and adds ADR-0053; do not commit the zip itself.

E sits inside the theme, the frame and the table. Before E1, check that the theme's phases T1 to T3 and the frame's
phases A1 to A3 are on the branch. Before E2, check that the table's phases C1 to C3 (the workbench, the Ladder, the
tools dock and the map's controls) are on the branch. If one is missing, stop at the phase that needs it and tell me.

Work through phases E0 to E5 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command or projection change,
stop and tell me. Before calling a phase done, run the checks in section 6 of the plan and look at Prep's front page, an
encounter's page, a new draft and the map's grid steps at 1280 by 800 with a mouse and at 390 by 844 with touch, in
Dusk and Dawn, against `prep.html`. Tell me what you ran and what you saw, including anything that failed before you
started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
