---
name: vtt-task-packet
description: Use at the start of meaningful work on this repo — a new feature, UX change, architecture work, or a bug cluster likely to touch multiple files — to turn a rough request into a compact task brief before implementing. Skip it for one-line fixes, copy tweaks, and small isolated CSS changes.
---

# vtt-task-packet

Turn a rough request into a single **compact object of intent** before writing code.
The packet preserves clarity and keeps later steps (implement, QA, ledger) anchored to
one agreed brief instead of re-deriving scope from chat history.

## When to use

Use for meaningful work: new features, UX changes, architecture work, bug clusters, or
anything likely to touch multiple files. **Do not** use for trivial work — a one-line
fix, a copy tweak, or a small isolated CSS change goes straight to implementation with a
one-line summary.

## How to build the packet

1. **Read first, ask second.** Skim the relevant `docs/ai-context/` file(s) and the
   existing implementation for the area the request touches. Most "questions" are
   answered by the code.
2. **Clarify only what's material.** Ask the user a question *only* when the missing
   detail would change the build, scope, UX, or how you'd verify it. Don't interrogate
   over things a sensible default settles — state the default instead.
3. **Fill the template below.** Keep each field tight; the packet is a brief, not a spec
   dump. Name specific files under *Relevant context* so implementation reads 2-4 files,
   not the whole tree.
4. **Make acceptance criteria observable.** Each one should be checkable by running or
   looking at something, so `vtt-qa-check` can score it later.
5. **Always populate Constraints with this repo's hard invariants when they apply:**
   server authority (no game logic on the client), viewer safety (nothing GM-only on the
   public viewer), GM/player role boundaries, mobile+touch parity, and branch safety.

## Template

```text
TASK PACKET

Title:            Short name of the work.
User intent:      Plain-English description of what the user wants.
Problem:          What is broken, missing, confusing, or insufficient.
Desired outcome:  What should be true when the work is complete.
Relevant context: Specific files to read first (2-4 from docs/ai-context + source).
Constraints:      Rules that must not be violated (invariants above + any task-specific).
Acceptance criteria: Observable requirements that determine done.
Verification:     Commands + browser/mobile checks to run (see docs/ai-context/testing.md).
Docs/memory updates: Which docs/ai-ledger files to update afterward.
Out of scope:     What not to expand into.
Risk notes:       Likely regressions, blockers, or design concerns.
```

## Output

Present the filled packet to the user, then hand off:

```text
vtt-task-packet -> implement (bounded to the packet) -> vtt-qa-check if needed -> update docs/ai-ledger
```

A good packet is short enough to read at a glance and specific enough that someone else
could implement and verify it without re-reading the whole conversation.
