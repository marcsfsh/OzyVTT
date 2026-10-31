Build the rest of area D of the polish pass, characters (the roster, making a character, levelling up and a party
member), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/D-characters/SPEC.md`, then `polish/D-characters/PLAN.md` sections 0 to 4. Phase D0 updates
`docs/design/polish/` from the zip and adds ADR-0051; do not commit the zip itself.

D sits inside the theme, the frame and the character sheet. Before D1, check that the theme's phases T1 to T3, the
frame's phases A1 to A3 and the character sheet's phase L2 (its band) are on the branch. If one is missing, stop at the
phase that needs it and tell me.

Work through phases D0 to D6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches. Leave `apps/client/src/sheet/` to the
character sheet's session except where the plan says otherwise.

The plan changes the client and docs only. If a step seems to need a server, schema, command or projection change,
stop and tell me. A party member must show only what another player already receives. Before calling a phase done, run
the checks in section 6 of the plan and look at the roster, the builder, the level dialog and a party member, as the GM
and as a player, at 1280 by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, against
`characters.html`. Tell me what you ran and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
