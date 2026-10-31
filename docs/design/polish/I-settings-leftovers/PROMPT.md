Build I's second round of the polish pass, Settings' leftovers (Settings' side list drawn as the settled side list, the
API reference as grouped rows with each operation's command, an operation's request and response side by side, Token
image and Release as buttons at the table, and a credential's own page), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/I-settings-leftovers/SPEC.md`, then `polish/I-settings-leftovers/PLAN.md` sections 0 to 4. Phase U0 updates
`docs/design/polish/` from the zip and adds ADR-0071; do not commit the zip itself.

This sits inside Settings. Before U1, check that the theme's T1 to T3, A's dialogs (A6), Settings (I1 to I5), the side
list (K1, X1) and F's time and tools (Z6) are on the branch. If one is missing, stop at the phase that needs it and tell
me.

Work through phases U0 to U6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. A secret must still be shown only once. Settings' side list must read as every other side
list. Before calling a phase done, run the checks in section 6 of the plan and look at Settings' side list, the
reference, an operation, At the table and a credential's page, at 1280 by 800 with a mouse and at 390 by 844 with touch,
in Dusk and Dawn, against `settings-leftovers.html`. Tell me what you ran and what you saw, including anything that
failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
