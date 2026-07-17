# UX principles

**Read this when:** doing UI-heavy work — grid setup, map controls, initiative, character
selection, viewer mode, mobile layouts — or reviewing whether a feature "feels right."

## The three tests

1. **Combat-first.** Does this serve running a fight at the table? If it's not in the
   combat loop, it probably doesn't belong on the main surface.
2. **Just works.** The obvious action should be the correct action. A GM mid-encounter
   shouldn't hunt for a control or read a manual. Prefer a single clear action over a
   settings panel — e.g. "Present <map>" both starts presentation and pushes the map in
   one click.
3. **Everything needed, nothing unnecessary.** Add the capability the loop requires;
   resist the extra knob. Each new setting is a small tax on every future GM decision.

## Friction to flag in review

- Hidden or non-obvious controls; actions that need explanation to discover.
- Unclear state — the user can't tell what's presented, whose turn it is, or whether an
  action took effect.
- Too many settings where a good default would do.
- Weak mobile affordances (small touch targets, gestures that fight native scroll).
- Viewer-mode confusion — the GM can't tell what players are seeing, or player-only vs
  GM-only surfaces blur together.

## Role clarity is a UX property, not just security

GM surfaces and player/viewer surfaces must read as clearly different. A player should
never be unsure whether something is "for them," and the GM should always be able to tell
what the public viewer is exposing. See `viewer-mode.md` and `auth-roles.md`.

## Mobile is first-class

Phone and laptop have full functional parity — there is no reduced "mobile mode." A
control that only works with a mouse is a bug. See `mobile-ux.md`.

## When unsure

Favor the change that removes a decision from the GM's plate over the one that adds an
option. If a feature needs a tutorial, redesign it.
