Build E3 of the polish pass, sound and the screen (the sound board as kinds at the side under one Playing bar with a
scrubber, kind chips in the library, each encounter's sound on its own page, and See as the table screen as today's
swap from More), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/E3-sound-screen/SPEC.md`, then `polish/E3-sound-screen/PLAN.md` sections 0 to 4. Phase W0 updates
`docs/design/polish/` from the zip and adds ADR-0065; do not commit the zip itself.

This sits inside the Table screen page and Prep's workbench. Before W1, check that the theme's T1 to T3, A's menu and
dialog, E's frame and H's Table screen page are on the branch. If one is missing, stop at the phase that needs it and
tell me.

Work through phases W0 to W6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

Phase W3 is the one server change I have approved: the `sound.seek` command and its route, built like
`sound.next-track`, so the scrubber moves the playing track for every table screen. It is GM-only; prove a player is
refused, and run `npm run map`. If any other step seems to need a server, schema, command, route or projection change,
stop and tell me. Before calling a phase done, run the checks in section 6 of the plan and look at each part of the
board, the Playing bar (playing, paused, nothing playing, a scrub), the kind chips, an encounter's sound on its page,
and See as the table screen, at 1280 by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, against
`sound-and-the-screen.html`. Tell me what you ran and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
