Build G's second round of the polish pass, the Compendium's pages (Sources with the sources at the side, Sharing with
the kinds at the side, a record's history as compact rows in a side column, merging as A's dialog, and a record's
sharing in the side column), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/G-compendium-pages/SPEC.md`, then `polish/G-compendium-pages/PLAN.md` sections 0 to 4. Phase X0 updates
`docs/design/polish/` from the zip and adds ADR-0068; do not commit the zip itself.

This sits inside the Compendium's frame. Before X1, check that the theme's T1 to T3, A's dialogs (A6), the Compendium's
frame (G1 to G5), F's finding and pages (N2 and N5) and E2's folders (K1) are on the branch. If one is missing, stop at
the phase that needs it and tell me.

Work through phases X0 to X6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. A player must see only what they see today, and never a monster's stat block. Before calling a
phase done, run the checks in section 6 of the plan and look at each source, Sharing by kind, a copy's history, a
conflict from a second browser, and Share on a draft and on a published record, at 1280 by 800 with a mouse and at 390
by 844 with touch, in Dusk and Dawn, against `compendium-pages.html`. Tell me what you ran and what you saw, including
anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
