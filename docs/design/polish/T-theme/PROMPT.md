Build piece T of the polish pass, the theme spec, on the branch `claude/friendly-babbage-g7gcge`.

The handoff is the attached polish zip. Unzip it outside the repository first and read `polish/README.md`, then
`polish/T-theme/SPEC.md`, then `polish/T-theme/PLAN.md` sections 0 to 4. Phase T0 copies the `polish/` folder into
`docs/design/polish/` and adds ADR-0048; do not commit the zip itself. If `docs/design/polish/` is already there from
the character sheet's work, update it from the zip as T0 says.

Work through phases T0 to T7 in order, one commit per phase, and push after each one. Another session commits design
work on this branch: fetch and pull before each phase and again before each push, never force-push, rebase or amend
anything already pushed, and ask me before resolving a conflict in a file the plan touches.

The character sheet (piece D1) may be in progress on the same branch. Leave `apps/client/src/sheet/` alone until D1's
phase L7 is pushed; T7 is the sheet's part and waits for it. If you reach T7 first, stop after T6 and tell me.

The plan changes the UI kit, the client and docs only. If a step seems to need a server, schema or command change, stop
and tell me. It builds the shared parts and does not redesign pages: when a page breaks a rule and fixing it would
redesign the page, leave it, as section 7 of the plan does, and list it in the commit body. Before calling a phase done,
run the checks in section 6 of the plan and look at Prep, the Codex, the Compendium and Settings at 1280 by 800 with a
mouse and at 390 by 844 with touch, in Dusk and Dawn, against `theme-spec.html`. Tell me what you ran and what you saw,
including anything that failed before you started.

For anything I'll read (commits, PR text, copy, comments): no emojis, no em dashes, no "it's not X, it's Y" sentences,
and avoid the words "genuinely" and "seriously".
