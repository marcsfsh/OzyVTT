---
name: ux-review
description: Review an OzyVTT screen or flow as the GM, a player and the table screen would use it, at phone and laptop size, against docs/DESIGN.md. Reports findings and does not change code.
disable-model-invocation: true
argument-hint: "[feature, flow or pages]"
---

# UX review

Review $ARGUMENTS as the people who use it. Report what you find; don't change code.

1. Read the Product principles and Page patterns in `docs/DESIGN.md`, and its section for this
   surface if it has one (the sheet, the Codex).
2. Name the main job, such as "start a fight on a prepared scene", and who does it: the GM, a player
   or the table screen.
3. Screenshot each step at both sizes with `node .claude/skills/verify/screens.mjs` (`--as player` for
   a player's view) and read every picture. When a step needs a click or a drag to reach, drive it
   with a short Playwright script built on `e2e/smoke.ts`.
4. Walk the job as a GM in the middle of a fight. Note every hunt for a control, every read before
   acting and every step a default could have saved. Beyond what `docs/DESIGN.md` asks, check that
   controls stay put as state changes, and that empty, loading, error and reconnecting states say
   what to do next.

Report:

- A verdict on the first line: pass, pass with notes, or fix required.
- Findings, most severe first. For each: the step, role and size where you saw it (with the
  picture's path), the principle or rule it breaks, and the smallest change that fixes it.
- What works and should stay.

Don't propose a new setting, mode or confirmation unless it removes more friction than it adds.
