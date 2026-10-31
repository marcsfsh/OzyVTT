Build the frame of area F of the polish pass, the Codex (its bar, home, reading a page, writing a page with a Preview
switch, and the story's Chronicle, Timeline and Sessions tabs), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/F-codex/SPEC.md`, then `polish/F-codex/PLAN.md` sections 0 to 4. Phase F0 updates `docs/design/polish/` from the
zip and adds ADR-0054; do not commit the zip itself.

F sits inside the theme and the frame. Before F1, check that the theme's phases T1 to T3 and the frame's phases A1 to A3
are on the branch. If one is missing, stop at the phase that needs it and tell me.

Work through phases F0 to F6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command or projection change,
stop and tell me. A player must see only what the Codex's projection already sends them, and Preview must show exactly
that. Before calling a phase done, run the checks in section 6 of the plan and look at the Codex's home, a page as the
GM and as a player, writing with Preview on and off, and the story's three tabs, at 1280 by 800 with a mouse and at
390 by 844 with touch, in Dusk and Dawn, against `codex.html`. Tell me what you ran and what you saw, including anything
that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
