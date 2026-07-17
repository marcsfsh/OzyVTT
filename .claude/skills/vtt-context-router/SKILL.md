---
name: vtt-context-router
description: Use at the start of a task to decide which docs/ai-context files to read, instead of loading the whole project brain. Maps task types (grid/maps, viewer, realtime, auth/roles, UI/mobile, scope, testing) to the 2-4 files worth reading first.
---

# vtt-context-router

Read narrowly. For a given task, open the **2-4** context files that actually apply, not the
whole tree — that's the point of the split. Escalate to reading source only when evidence
shows a brief is insufficient.

## Always, at session start

Skim `docs/ai-ledger/current-state.md` and `docs/ai-ledger/known-bugs.md` (both short) so you
know what exists and what's already broken. Everything below is task-triggered on top of that.

## Route by what the task touches

| The task is about… | Read first | Also if relevant |
| --- | --- | --- |
| Maps, grid calibration, tokens, annotations, the encounter canvas | `map-grid.md` | `mobile-ux.md` (touch), `viewer-mode.md` (if it projects to the viewer), `realtime.md` (new command) |
| The table viewer, second screen, pairing, "Present", what players see | `viewer-mode.md` | `auth-roles.md` (projection boundary), `map-grid.md` (scene rendering) |
| Socket commands/events, state broadcast, reconnection, idempotency/revision | `realtime.md` | `architecture.md`, `packages/domain` contract |
| GM auth/login, character claims, roles, per-command gating, what a player may do/see | `auth-roles.md` | `realtime.md` (role re-check per command) |
| UI, CSS, layout, responsive/mobile, gestures, touch | `mobile-ux.md` | `ux-principles.md`, the specific subsystem file for the surface |
| "Should we build this?", scope, product boundaries | `product-vision.md` | `ux-principles.md` |
| Whether a feature *feels* right / simple / GM-friendly | `ux-principles.md` | `mobile-ux.md` |
| Verifying a change, CI, what "done" means | `testing.md` | — |
| "Where does X live?", system shape, which package owns a contract | `architecture.md` | the specific subsystem file |
| Public HTTP API / integrations (`/api/v1`) | `architecture.md` | `realtime.md`, `auth-roles.md`, `packages/api-contract` |

## Rules

- **2-4 files, then start.** If you're opening a fifth context file, you're probably reading
  the encyclopedia — narrow the task or drop to the specific source file instead.
- **Context files are a map, not the territory.** They point at the real source paths; when a
  brief and the code disagree, the code wins — and note the drift for `vtt-ledger-update`.
- **Cross-cutting changes** (auth + viewer, realtime + maps) legitimately need two subsystem
  files. That's expected; just keep it to the ones actually touched.
- Durable rationale lives in `docs/adr/`; reach for an ADR only when you need the *why*, not
  for routine work.
