Build area A of the polish pass, the frame, on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/A-frame/SPEC.md`, then `polish/A-frame/PLAN.md` sections 0 to 4. Phase A0 updates `docs/design/polish/` from the
zip and adds ADR-0049; do not commit the zip itself.

Area A builds on the theme (piece T). Check that T's phases T1 to T3 are on the branch before you start A1 (A uses the
Base line, `Group` and the shared section bar) and that T5 is there before A6 (it uses `EmptyState`). If one is missing,
stop at the phase that needs it and tell me.

Work through phases A0 to A7 in order, one commit per phase, and push after each one. Other sessions commit on this
branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend anything already
pushed, and ask me before resolving a conflict in a file the plan touches. Leave `apps/client/src/sheet/` alone while the
character sheet (piece D1) is in progress.

The plan changes the client and docs only. If a step seems to need a server, schema, command or projection change,
stop and tell me. Search must call only the searches each role can already call, with the same token. Before calling a
phase done, run the checks in section 6 of the plan and look at the frame as the GM and as a player, at 1280 by 800 with
a mouse and at 390 by 844 with touch, in Dusk and Dawn, against `frame.html`. Tell me what you ran and what you saw,
including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
