Build area I of the polish pass, Settings (a side list of its sections with a line of what each holds now and the
search at its top, rows with their control at the right, the encounter rules grouped by moment, and Access with its
rows and the credentials' table), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/I-settings/SPEC.md`, then `polish/I-settings/PLAN.md` sections 0 to 4. Phase I0 updates
`docs/design/polish/` from the zip and adds ADR-0057; do not commit the zip itself.

I sits inside the theme and the frame. Before I1, check that the theme's phases T1 to T3 and the frame's phases A1 and
A3 (Settings in the menu, the phone frame without a top bar) are on the branch. If one is missing, stop at the phase
that needs it and tell me.

Work through phases I0 to I5 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. Every setting keeps its name, its line, its choices and how it saves, and a player's Settings
stays Device alone. Before calling a phase done, run the checks in section 6 of the plan and look at Settings as the GM
(the list and its lines, a search and its pick, Players, Encounters in its four groups, Characters, Device, Access with
a credential, New credential) and as a player (Device alone), at 1280 by 800 with a mouse and at 390 by 844 with touch,
in Dusk and Dawn, against `settings.html`. Tell me what you ran and what you saw, including anything that failed before
you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
