Build C4 and C6 of the polish pass, a player in a fight (the prompt on glass over the map and named by its kind only, a
reaction's answer as its roll row, the death saves as lamps, and what a cast asks, with the spell's card, opening under
its row), on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/C4-C6-player/SPEC.md`, then `polish/C4-C6-player/PLAN.md` sections 0 to 4. Phase P0 updates
`docs/design/polish/` from the zip and adds ADR-0061; do not commit the zip itself.

This sits inside the table's frame and after C3 and C5. Before P1, check that the theme's T1 to T3, A's band and the
table's C1 to C5 are on the branch; before P4, C3's second round (the roll row in prompts); before P5, C3's row tools
under the row. If one is missing, stop at the phase that needs it and tell me.

Work through phases P0 to P6 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. Who is asked and what they see stays exactly as the server decides; the band away from the
table shows only what the player's own view already holds. "Answer now" and "roll now" go from every card, region,
announcement and test. Before calling a phase done, run the checks in section 6 of the plan and look at a saving throw,
Shield, a death save, the band on the Sheet, and Cure Wounds' ask and card, as a player at 1280 by 800 with a mouse and
at 390 by 844 with touch, in Dusk and Dawn, against `a-player-in-a-fight.html`. Tell me what you ran and what you saw,
including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
