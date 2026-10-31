Build F's third round of the polish pass, the story and people (quests with their statuses at the side, relationships
as a ring on glass, a faction's standing in its page's side column, and the chronicle's composer at the head of the
line with any session to file under), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/F-story-people/SPEC.md`, then `polish/F-story-people/PLAN.md` sections 0 to 4. Phase S0 updates
`docs/design/polish/` from the zip and adds ADR-0066; do not commit the zip itself.

This sits inside the Codex's frame. Before S1, check that the theme's T1 to T3, A's menu and dialog, F's frame (F1 to
F4) and F's finding and pages (N1 to N3) are on the branch. If one is missing, stop at the phase that needs it and tell
me.

Work through phases S0 to S6 in order, one commit per phase, and push after each one. Phase S5 builds the Downtime tab
from `polish/F3-atlas/SPEC.md` 2.5. Other sessions commit on this branch: fetch and pull before each phase and again
before each push, never force-push, rebase or amend anything already pushed, and ask me before resolving a conflict in
a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. A player must see only what they see today. Before calling a phase done, run the checks in
section 6 of the plan and look at the quests, the ring, a faction's standing and the composer, at 1280 by 800 with a
mouse and at 390 by 844 with touch, in Dusk and Dawn, as the GM and as a player, against `story-and-people.html`. Tell
me what you ran and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
