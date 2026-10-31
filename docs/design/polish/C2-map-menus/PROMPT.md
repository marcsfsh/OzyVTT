Build C2 of the polish pass, the map's menus (A's menu at every thing on the map, how a creature moves at the top of
the token's menu, a door's ways as the menu's rows, each tool's options as a menu from the tool, and a drawing's menu),
on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/C2-map-menus/SPEC.md`, then `polish/C2-map-menus/PLAN.md` sections 0 to 4. Phase M0 updates
`docs/design/polish/` from the zip and adds ADR-0062; do not commit the zip itself.

This sits inside the table's frame and after C3, C4 and C6. Before M1, check that the theme's T1 to T3, A's menu and the
table's C1 to C5 are on the branch; before M2, C3's second round (a creature's tools under its row and the Token tab).
If one is missing, stop at the phase that needs it and tell me.

Work through phases M0 to M6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. Who may open which menu, and what each row does, stays exactly as the server decides; a
player reaches only their own token and their own drawings. Before calling a phase done, run the checks in section 6 of
the plan and look at a token's menu, moving, a door, a tool's menu and a drawing's menu, as the GM at 1280 by 800 with a
mouse and as a player at 390 by 844 with touch, in Dusk and Dawn, against `map-menus.html`. Tell me what you ran and
what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
