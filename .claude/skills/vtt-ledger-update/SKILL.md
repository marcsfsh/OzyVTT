---
name: vtt-ledger-update
description: Use after meaningful work lands (implementation or QA) to record it in docs/ai-ledger so future sessions don't rediscover decisions or re-solve closed problems. Updates current-state, known-bugs, decision-log, and session-summary concisely. Not for every minor edit.
---

# vtt-ledger-update

Keep the project memory current so the next session starts informed. Run this **after** a
meaningful change lands or passes QA — not during routine edits. The ledger is the cheap
alternative to replaying long chat history.

## What goes where

| File | Update it when… | How |
| --- | --- | --- |
| `current-state.md` | what *exists now* changed — a feature shipped, a subsystem moved, active work advanced | Edit the relevant line to reflect reality. It's a snapshot, not a changelog — replace stale facts, don't append forever. |
| `known-bugs.md` | you found a defect/gap, or fixed a listed one | Add under *Known gaps* with a suspected cause; **remove** entries you fixed. Put "working as designed but surprising" under *Gotchas*. |
| `decision-log.md` | a durable decision was made that shouldn't be relitigated | One dated line: the decision + why. Architecture decisions with lasting weight also deserve a `docs/adr/` entry — note that. |
| `session-summary.md` | after any meaningful session | Prepend a short entry (newest first): what changed, why, follow-ups. A few lines. |

## Discipline

- **Concise + append-only for history.** `session-summary` and `decision-log` grow by
  prepending; don't rewrite past entries. `current-state` and `known-bugs` are *replaced* to
  stay true, not accreted.
- **Record, don't re-derive.** State what changed; don't re-explain the whole subsystem — that
  lives in `docs/ai-context/`.
- **Note context drift.** If implementation revealed a `docs/ai-context/` brief is now wrong,
  fix the brief (or flag it) as part of the update — stale context is worse than none.
- **Date decisions** (`YYYY-MM-DD`) so future readers can weigh them.
- **Compress periodically.** When `session-summary.md` gets long, fold settled facts into
  `current-state.md` and trim the old entries.

## Quick pass

After a change lands, ask in order: did *what exists* change (`current-state`)? did I
find/fix a defect (`known-bugs`)? did I decide something durable (`decision-log`)? — then
always add the one-paragraph `session-summary` entry. Most changes touch 1-2 of these, plus
the summary.
