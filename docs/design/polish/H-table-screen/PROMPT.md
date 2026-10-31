Build area H of the polish pass, the table screen (the TV's live screen as the turn ladder, its pairing and waiting
screens on the horizon line, the GM's table screen page as screens that open as remotes, and the preview as a picture
in picture), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/H-table-screen/SPEC.md`, then `polish/H-table-screen/PLAN.md` sections 0 to 4. Phase H0 updates
`docs/design/polish/` from the zip and adds ADR-0056; do not commit the zip itself.

H sits inside the theme and the frame. Before H2, check that the theme's phase T1 is on the branch; before H4, check
that T1 to T3 and the frame's phase A1 (the menu with the Table screen row) are there. If one is missing, stop at the
phase that needs it and tell me.

Work through phases H0 to H6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. The TV must keep receiving exactly what it receives today: hidden creatures stay a GM turn,
health bands show only when the GM shows them to everyone, and only public rolls appear. Before calling a phase done,
run the checks in section 6 of the plan and look at the TV in a fight at 1280 by 720 and 1920 by 1080, on a 4:3 window
and on a phone held upright, the pairing, paused and waiting screens, and the GM's screens page, a screen's remote and
the picture in picture at 1280 by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, against
`table-screen.html`. Tell me what you ran and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
