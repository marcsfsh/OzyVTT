---
name: vtt-ledger-update
description: Use after meaningful, verified work lands to bring project memory back in line with reality. Updates the state page, the bug list and the decision log IN PLACE. Most sessions change nothing; that is the expected outcome, not a failure.
---

# vtt-ledger-update

Project memory exists so the next session starts informed. It earns that only by being
**true**, and it stays true by **shrinking as often as it grows**. Run this after verified
work lands — not during edits, not for a typo.

## The default is: change nothing

Ask one question first: **did anything a future session would act on differently actually
change?** Usually the answer is no. A refactor that preserved behaviour, a test added, a
comment fixed, a doc corrected — none of these change the ledger. **Writing nothing is a
correct outcome and the common one.** Do not add an entry to prove you were here.

## What goes where

| File | Update it when… | How |
| --- | --- | --- |
| `current-state.md` | what *exists now* changed — a capability shipped, a structural gap opened or closed | **Edit the line that is now wrong, or delete it.** Hard cap: 150 lines. It covers ships-today / in-flight / known-broken and nothing else. |
| `known-bugs.md` | you found a real defect, or fixed a listed one | Add under *Known gaps* with the evidence that it is real. **When you fix one, DELETE the entry** — do not mark it fixed and leave it. If you want the fix remembered, the regression test is the memory. Put "working as designed but surprising" under *Gotchas*, and anything needing a browser or a runtime repro before it can be called under *Unverified*. |
| `decision-log.md` | a durable decision was made that should not be relitigated | Prepend a dated entry: the decision and why. **If it supersedes an earlier one, go back and mark the earlier one superseded, naming this one.** Architecture decisions with lasting weight also want a `docs/adr/` entry. |
| `docs/archive/` | you are about to write a dated narrative of what a session did | That is history. It goes here, not in the ledger. |

## Discipline

- **Correct in place. Always.** If a line is wrong, fix it or delete it — never append a newer
  line beside it and leave the reader to work out which one is current. This applies to
  `decision-log.md` too: a superseded decision keeps its text and its date, and **gains a
  marker** naming what replaced it and where. An unmarked superseded decision is the worst
  artifact this repo can produce, because it reads as current.
- **Delete on fix.** A "known bug" that is fixed is not a bug; it is a changelog entry in the
  wrong file. Any entry claiming to be fixed must cite a test that exists — and if it cites a
  test, delete the entry and keep the test.
- **No counts in prose.** Test totals, file totals, measured pixel counts and roster sizes go
  stale within days and nothing checks them. Name the command that produces the number
  instead.
- **Record, don't re-derive.** State what changed. How the subsystem works belongs in
  `docs/ai-context/`; why it was decided belongs in `decision-log.md`.
- **Date decisions** (`YYYY-MM-DD`). Do not date state — a dated line in `current-state.md`
  is a changelog row wearing a snapshot's clothes, and that is precisely how that file grew
  into a release-notes archive.
- **Fix the context brief too.** If implementation revealed a `docs/ai-context/` brief is
  wrong, correct it in the same change. A stale brief is worse than no brief.

## Quick pass

After verified work lands, ask in order:

1. Did *what exists* change? → edit the wrong line in `current-state.md`.
2. Did I fix a listed bug? → **delete** its entry. Did I find a real one? → add it with
   evidence.
3. Did I decide something durable? → prepend it to `decision-log.md`, **and mark whatever it
   supersedes**.
4. Did nothing above apply? → **write nothing and say so.**

If the ledger got longer this session and nothing shipped, something has gone wrong.
