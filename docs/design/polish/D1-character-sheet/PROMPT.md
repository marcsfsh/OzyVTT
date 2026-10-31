Build piece D1 of the polish pass, the Ledger character sheet, on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read
`polish/README.md`, then `polish/D1-character-sheet/PLAN.md` sections 0 to 4. Phase L0 copies the `polish/` folder into
`docs/design/polish/` and adds ADR-0047; do not commit the zip itself.

Work through phases L0 to L7 in order, one commit per phase, and push after each one. Another session commits design
work on this branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend
anything already pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes client code and docs only. If a step seems to need a server, schema or command change, stop and tell
me. Before calling a phase done, run the checks in section 6 of the plan and look at the sheet at 1280 by 800 with a
mouse, at 1100 by 800, at 390 by 844 with touch and in the Table panel, in Dusk and Dawn. Tell me what you ran and what
you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
