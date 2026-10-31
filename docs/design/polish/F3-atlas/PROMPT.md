Build F3 of the polish pass, the Atlas (the maps as a tree at the left, the map, the pins at the right, a pin opening as
its page in the right column with its party and players switches, a right-click menu on pins, the pin editor in tabs,
and Add a map through the map picker), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/F3-atlas/SPEC.md`, then `polish/F3-atlas/PLAN.md` sections 0 to 4. Phase V0 updates `docs/design/polish/` from
the zip and adds ADR-0067; do not commit the zip itself.

This sits inside the Codex's frame. Before V1, check that the theme's T1 to T3, A's menu and dialog, F's frame (F1 to
F4), F's finding and pages (N2) and E2's picker (K5) are on the branch. If one is missing, stop at the phase that needs
it and tell me.

Work through phases V0 to V6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. A player must see only what they see today. Before calling a phase done, run the checks in
section 6 of the plan and look at the tree, a pin from the list and from the map, the pin's menu, the editor's tabs and
adding a map, at 1280 by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, as the GM and as a player,
against `the-atlas.html`. Tell me what you ran and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
