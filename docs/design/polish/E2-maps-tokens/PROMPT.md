Build E2 of the polish pass, maps and tokens (the Maps page as folders at the side with a map opening beside its
folder's list, filing maps from a map's menu and from Choose, the Tokens page in Party, Monsters and the GM's own groups,
and the token picker as folders, the library and a preview), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/E2-maps-tokens/SPEC.md`, then `polish/E2-maps-tokens/PLAN.md` sections 0 to 4. Phase K0 updates
`docs/design/polish/` from the zip and adds ADR-0063; do not commit the zip itself.

This sits inside Prep's frame. Before K1, check that the theme's T1 to T3, A's menu and dialog, and E's frame (E1) are
on the branch. If one is missing, stop at the phase that needs it and tell me.

Work through phases K0 to K6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

Phase K4 is the one server change I have approved: the GM's token groups as one GM-only state field with the four
commands the plan names, built like the staging defaults. Players and the table screen must never receive the groups;
prove it with projection tests and run `npm run map`. If any other step seems to need a server, schema, command, route
or projection change, stop and tell me. Before calling a phase done, run the checks in section 6 of the plan and look at
the Maps page, a map beside its list, a map's menu, Choose, the Tokens page with a new group, and the picker, at 1280 by
800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, against `maps-and-tokens.html`. Tell me what you ran
and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
