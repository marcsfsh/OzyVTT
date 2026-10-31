Build the second round of C3 in the polish pass, running the encounter (one form to start a fight, a creature's tools
under its row in the order, the encounter's options as a menu on the panel's tabs, Add monsters as the Compendium's
panes, and each roll in a waiting card as its own button), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/C3-running/SPEC.md`, then `polish/C3-running/PLAN.md` sections 0 to 4. Phase R0 updates
`docs/design/polish/` from the zip and adds ADR-0059; do not commit the zip itself.

This sits inside the table's frame and after C3's first round, and it reuses the Compendium's filter panel and Settings'
rows. Before R1, check that the theme's T1 to T3, the table's C1, C2 and C5, and C3's first round (Q1 to Q4) are on the
branch; before R3, Settings' I3; before R4, the Compendium's G3 and G4. If one is missing, stop at the phase that needs
it and tell me.

Work through phases R0 to R6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. Every setting, word and command stays as it is today; only where things sit and how they are
drawn change. Before calling a phase done, run the checks in section 6 of the plan and look at the start of a fight, a
creature's tools, the menu, Add monsters and the waiting rolls at 1280 by 800 with a mouse and at 390 by 844 with touch,
in Dusk and Dawn, against `running.html`. Tell me what you ran and what you saw, including anything that failed before
you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
