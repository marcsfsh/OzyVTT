Build C5 of the polish pass, log and dice (the log as one line per entry with a roll opening to its card, the composer
led by who hears it, the dice options as a sheet over the panel, and the GM's call for a roll from the waiting list), on
the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/C5-log-dice/SPEC.md`, then `polish/C5-log-dice/PLAN.md` sections 0 to 4. Phase L0 updates
`docs/design/polish/` from the zip and adds ADR-0060; do not commit the zip itself.

This sits inside the table's frame and after C3's first round. Before L1, check that the theme's T1 to T3 and the table's
C1 and C5 are on the branch; before L4, C3's first round (Q1 to Q4). If one is missing, stop at the phase that needs it
and tell me.

Work through phases L0 to L5 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. Who sees a line or a roll stays exactly as the server decides; a player must never get a
GM-only line or another player's whisper. Before calling a phase done, run the checks in section 6 of the plan and look
at the log, the composer, the dice sheet and a call for a roll, as the GM at 1280 by 800 with a mouse and as a player at
390 by 844 with touch, in Dusk and Dawn, against `log-and-dice.html`. Tell me what you ran and what you saw, including
anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
