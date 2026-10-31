Build E3 of the polish pass, replays (the list as a table with the chosen replay beside it, watching with the whole
fight beside the map, a line of rounds with Launch at its end and the date to the right of the name, and a player's
shared replays as cards under the sheet), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/E3-replays/SPEC.md`, then `polish/E3-replays/PLAN.md` sections 0 to 4. Phase Y0 updates `docs/design/polish/`
from the zip and adds ADR-0069; do not commit the zip itself.

This sits inside Prep's frame. Before Y1, check that the theme's T1 to T3, A's dialogs (A6), Prep's frame (E1), E2's
lists (K1, K2) and the sound round's Playing bar (W2) are on the branch. If one is missing, stop at the phase that needs
it and tell me.

Work through phases Y0 to Y6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. A player must see only what they see today: no hidden creature, no GM line, and never the
encounter's own name. Before calling a phase done, run the checks in section 6 of the plan and look at the list with a
chosen replay, watching and seeking on the line, Launch's confirm, More and Rename, and a player's list, viewer and
cards, at 1280 by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, as the GM and as a player, against
`replays.html`. Tell me what you ran and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
