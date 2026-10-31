Build area C's frame of the polish pass, the table, on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/C-table/SPEC.md`, then `polish/C-table/PLAN.md` sections 0 to 4. Phase C0 updates `docs/design/polish/` from the
zip and adds ADR-0050; do not commit the zip itself.

The table sits inside the frame and the theme. Before C1, check that the theme's phases T1 to T3 and the frame's phases
A1 to A3 are on the branch (C uses the Base line, `Group`, the live chip and the phone frame without a top bar). If one
is missing, stop at the phase that needs it and tell me. The option rows reuse the action columns the character sheet
plan adds to `turn-options.ts` (D1 phase L5); if they are not there yet, add them exactly as that plan says, so the two
pieces meet.

Work through phases C0 to C7 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches. Leave `apps/client/src/sheet/` alone while the
character sheet (piece D1) is in progress, except for `turn-options.ts` as above.

The plan changes the client and docs only. If a step seems to need a server, schema, command or projection change,
stop and tell me. A player must keep seeing a foe's wound word, never its hit points. Before calling a phase done, run
the checks in section 6 of the plan and look at the table as the GM and as a player, before and during a fight, at 1280
by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, against `table.html`. Tell me what you ran and what
you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
