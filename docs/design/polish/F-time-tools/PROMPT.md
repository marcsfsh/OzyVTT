Build F's fifth round of the polish pass, time and tools (prep templates as one page with the templates and the kinds of
section in the settled side list, Plan session on the Sessions tab, the calendar as its own page, a timeline record in
the story's side column, and the Codex's backup and saving tools in Settings), on the branch
`claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/F-time-tools/SPEC.md`, then `polish/F-time-tools/PLAN.md` sections 0 to 4. Phase Z0 updates
`docs/design/polish/` from the zip and adds ADR-0070; do not commit the zip itself.

This sits inside the Codex's frame and Settings. Before Z1, check that the theme's T1 to T3, A's dialogs (A6), the
Codex's frame (F1 to F4), the side column's swap (N3), the story (S1 to S5), Settings (I1 to I3) and the side list (K1,
X1) are on the branch. If one is missing, stop at the phase that needs it and tell me.

Work through phases Z0 to Z7 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches.

The plan changes the client and docs only. If a step seems to need a server, schema, command, route or projection
change, stop and tell me. Templates and prep must stay the GM's. Every side list must read as the settled one (E2's, and
Settings' with its line). Before calling a phase done, run the checks in section 6 of the plan and look at the templates
page, adding a section by its kind, Plan session, the calendar page, a record in the side column and each Codex tool in
Settings, at 1280 by 800 with a mouse and at 390 by 844 with touch, in Dusk and Dawn, against `time-and-tools.html`.
Tell me what you ran and what you saw, including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
