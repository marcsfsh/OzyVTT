Build the frame of area G of the polish pass, the Compendium (its bar, a home of shelves, browsing with a filter panel,
records opened as tabs beside the results, and the refined studio for making homebrew), on the branch
`claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/G-compendium/SPEC.md`, then `polish/G-compendium/PLAN.md` sections 0 to 4. Phase G0 updates
`docs/design/polish/` from the zip and adds ADR-0055; do not commit the zip itself.

G sits inside the theme and the frame. Before G1, check that the theme's phases T1 to T3 and the frame's phases A1 to A3
are on the branch. If one is missing, stop at the phase that needs it and tell me.

Work through phases G0 to G6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. Who sees a record, a draft's rule against sharing, and the player's Compendium reader inside
the Codex must stay exactly as they are. Before calling a phase done, run the checks in section 6 of the plan and look
at the Compendium's home, browsing monsters and spells with filters on, opening three records as tabs (an SRD monster,
a homebrew copy of it, a spell), the folded filters opened over the list, and editing the copy in the studio, at 1280 by
800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, against `compendium.html`. Tell me what you ran and what
you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
