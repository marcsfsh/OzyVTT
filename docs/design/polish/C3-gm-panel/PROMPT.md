Build the first round of C3 in the polish pass, the GM's panel and what waits on the GM (the waiting list over the
turn or in its own tab, cards, unread counts on the panel's tabs, and a bell in place of the words Needs you), on the
branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/C3-gm-panel/SPEC.md`, then `polish/C3-gm-panel/PLAN.md` sections 0 to 4. Phase Q0 updates
`docs/design/polish/` from the zip and adds ADR-0058; do not commit the zip itself.

This sits inside the table's frame. Before Q1, check that the theme's phases T1 to T3 and the table's phases C1, C2 and
C5 are on the branch, and before Q4 the frame's phase A2. If one is missing, stop at the phase that needs it and tell
me.

Work through phases Q0 to Q5 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs, and the words of one server toast. If a step seems to need any other server,
schema, command, route or projection change, stop and tell me. What waits on the GM, who may answer it and what every
button sends must stay exactly as they are. Before calling a phase done, run the checks in section 6 of the plan and
look at a fight with items waiting (a hit to apply, a target to choose, a rule ask, a save waiting on a player) at 1280
by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, against `gm-panel.html`. Tell me what you ran and
what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
