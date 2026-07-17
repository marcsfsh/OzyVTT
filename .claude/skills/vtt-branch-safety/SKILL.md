---
name: vtt-branch-safety
description: Use before any major edit, commit, push, branch change, or destructive git operation in this repo, and whenever work spans multiple files or an autonomous/scheduled run acts on its own. Confirms the current branch and intended scope and prevents clobbering another agent's claude/* branch or sprawling into unrelated refactors.
---

# vtt-branch-safety

This repo is worked by multiple agents in parallel, each on its own `claude/*` branch.
The failure mode this skill prevents: editing, committing to, rebasing, or force-pushing
a branch or files that belong to someone else's in-flight work — or quietly expanding a
scoped task into an unrelated refactor.

## Preflight — run before major edits, commits, or pushes

```bash
git branch --show-current      # Am I where I expect to be?
git status --short             # What's already modified/staged?
git log --oneline -5           # Whose work is on this branch?
```

Confirm all three before proceeding:

1. **Right branch.** You are on your designated feature branch, not `main` and not
   another agent's branch. If you're on `main` or an unexpected branch, stop and create
   or switch to the correct branch before editing.
2. **Clean or expected tree.** Pre-existing changes you didn't make are a signal — don't
   bury them in your commit. Investigate whose they are first.
3. **Scope matches the packet.** The files you're about to touch match the task packet's
   *Relevant context* / *Out of scope*. Files outside that set need a deliberate decision,
   not drift.

## Hard rules

- **Never edit, rebase, reset, or force-push another agent's `claude/*` branch.** Push
  only to your own designated branch, always with `git push -u origin <branch>`.
- **Never `git checkout`/`switch` away** mid-task in a way that strands uncommitted work.
- **No unrelated refactors.** If you spot unrelated cleanup, note it for the ledger or a
  follow-up packet; don't fold it into the current change.
- **Destructive git is confirm-first.** `git reset --hard`, `git clean -fd`, force-push,
  branch deletion, history rewrites — confirm with the user unless the transcript already
  authorized this exact action. A scheduled/autonomous run (`/loop`) must not perform any
  of these on its own.
- **Protected paths.** Treat `data/` (local campaign data, git-ignored), `auth.json`, and
  anything under another agent's active work as off-limits unless the task is explicitly
  about them.

## If something looks wrong

Stop and surface it rather than working around it:

- On the wrong branch with uncommitted work → report the state, don't force it.
- Merge conflict that isn't mechanical → surface it, don't guess a resolution.
- A file you'd need to change is clearly another agent's in-flight work → ask via
  `AskUserQuestion` before touching it.

Branch safety is cheap insurance: three `git` reads up front beat untangling a clobbered
branch later.
