Build F's second round of the polish pass, finding and pages (the Codex's search page as panes, the pages index with
the kinds, folders and tags at the side, a page's tag, reveal and versions in its side column in turn, and Ctrl K's
palette and the page picker as A's search dialog), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/F-finding-pages/SPEC.md`, then `polish/F-finding-pages/PLAN.md` sections 0 to 4. Phase N0 updates
`docs/design/polish/` from the zip and adds ADR-0064; do not commit the zip itself.

This sits inside the Codex's frame. Before N1, check that the theme's T1 to T3, A's search dialog, menu and dialog, and
F's frame (F1 to F4) are on the branch. If one is missing, stop at the phase that needs it and tell me.

Work through phases N0 to N6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. A player's search, index and tags must list only what they can open today; hidden pages and
blocks never reach them. Before calling a phase done, run the checks in section 6 of the plan and look at search, the
pages index, a tag on a page, Reveal on a hidden block, the versions with one read and restored, Ctrl K and a page
picker, at 1280 by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, as the GM and as a player, against
`finding-and-pages.html`. Tell me what you ran and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
