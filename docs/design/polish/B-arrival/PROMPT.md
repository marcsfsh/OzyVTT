Build area B of the polish pass, arrival (the title screen, the GM's sign-in and first run, picking a character and
inviting players), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/B-arrival/SPEC.md`, then `polish/B-arrival/PLAN.md` sections 0 to 4. Phase B0 updates `docs/design/polish/`
from the zip and adds ADR-0052; do not commit the zip itself.

B sits inside the theme, the frame and the table. Before B1, check that the theme's phases T1 to T3 and the frame's
phases A1 to A3 are on the branch. Before B4 and B5, check that the table's phase C1 (the workbench) is on the branch.
If one is missing, stop at the phase that needs it and tell me.

Work through phases B0 to B6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command or projection change,
stop and tell me. The pick page shows only what the player's projection lists, and the lobby reads only what the GM's
view already holds. Before calling a phase done, run the checks in section 6 of the plan and look at the title screen,
sign-in, first run, the pick page and the lobby, signed out, as the GM and as a player, at 1280 by 800 with a mouse and
at 390 by 844 with touch, in Dusk and Dawn, against `arrival.html`. Tell me what you ran and what you saw, including
anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
