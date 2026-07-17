---
name: vtt-ux-review
description: Use after UI-heavy work on this repo — grid setup, map controls, initiative, character selection, viewer mode, mobile layouts — to review whether the feature actually feels simple, obvious, and GM-friendly. Outputs prioritized friction points and concrete simplifications, not a full re-review.
---

# vtt-ux-review

Judge how the feature *feels*, against this project's philosophy — separate from correctness
(`vtt-qa-check` covers whether it works). Best run after UI-heavy work; skip for logic-only or
non-visual changes. Read `docs/ai-context/ux-principles.md` and `mobile-ux.md` first.

## The three tests (from ux-principles.md)

1. **Combat-first** — does this serve running a fight at the table, or is it a general-VTT
   detour? If it's not in the combat loop, does it belong on the main surface at all?
2. **Just works** — is the obvious action the correct action? Could a GM mid-encounter use
   this without hunting for a control or reading a manual? Prefer one clear action over a
   settings panel.
3. **Everything needed, nothing unnecessary** — is every added control/setting earning its
   place, or is a good default hiding behind a knob?

## Friction checklist

Flag any of these, with the specific control/screen:

- **Hidden or non-obvious controls** — actions you'd have to be told about to find.
- **Unclear state** — the GM can't tell what's presented, whose turn it is, or whether an
  action took effect; the player can't tell what's "for them."
- **Setting sprawl** — options where a sensible default would do; toggles that will confuse
  more than they help.
- **Weak mobile affordances** — small touch targets, gestures that fight native scroll
  (missing `touch-action: none`), controls that only work with a mouse. Phone = laptop parity.
- **Viewer confusion** — the GM can't tell what the public viewer is exposing, or GM vs
  player/viewer surfaces blur together. (Role clarity is a UX property, not just security.)
- **Discoverability tax** — if it needs a tutorial, it needs a redesign.

## Output

A short, **prioritized** list — most-friction first — each item as:
`[surface] friction → concrete simplification`. Recommend the change that *removes a decision
from the GM's plate* over the one that adds an option. If the feature is already clean, say so
in one line; don't invent friction.

This is advisory design feedback — propose simplifications; don't silently re-implement. Hand
concrete fixes back to `vtt-implement`.
