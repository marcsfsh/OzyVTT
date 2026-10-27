---
name: verify
description: Verify an OzyVTT change before calling it done, committing or opening a PR. Picks the checks the change needs, runs them, and for UI work screenshots the affected pages at phone and laptop size. Use after changing code or when asked to test or verify.
---

# Verify a change

Run what the change needs, in this order, and fix the first failure before going on. Report each
command with its result, and name anything you skipped and why.

| The change touches                                   | Run                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Anything                                             | `npm run lint`, `npm run format:check`, `npm run check`, `npm test`   |
| `GameState`, commands, routes, actor schema or rules | `npm run map`, and commit what it rewrites                            |
| SRD sources or the content scripts                   | `npm run content`                                                     |
| The UI                                               | `npm run build`, `npm run smoke`, then look at it (below)             |
| npm scripts, `e2e/`, server startup or Docker        | `npm run start` and open `http://localhost:3001`; check Windows below |

While iterating, run the touched workspace's tests first: `npm test --workspace=@vtt/web -- <name>`.

## Look at it

The smoke suite checks layout rules but never shows you the page. After `npm run build`:

```
node .claude/skills/verify/screens.mjs [--as gm|player] [--theme dusk|dawn|both] [--reduce-transparency] /table /codex ...
```

It starts a throwaway server on a temporary data directory, signs in, and writes a phone
(390x844, touch) and a laptop (1280x800) picture of each path to `e2e/test-results/screens/`, in Dusk and Dawn
unless `--theme` names one. `--reduce-transparency` turns on the device setting, for the solid surfaces.
Read every picture. Check what the change was meant to do, then what `docs/DESIGN.md` asks of that
surface. For a flow (a dialog, a drag, a second device), add a journey to `e2e/journeys.spec.ts`
with the helpers in `e2e/smoke.ts`.

## The smoke suite

- It serves `apps/client/dist`, so a stale build tests old code.
- Each viewport gets its own server (ports 3201 and 3202; `SMOKE_PORT` moves them) with a fresh data
  directory, and its journeys run in order.
- One journey: `npm run smoke -- --grep "<title>"`. A failure keeps a trace in `e2e/test-results/`;
  open it with `npx playwright show-trace <file>`.
- A new machine needs Chromium once: `npx playwright install chromium`.

## Windows

The GM runs `npm run start` on Windows. When a change touches npm scripts, `e2e/` or server startup,
read it for POSIX-only shell (`VAR=value cmd`, `rm -rf`, `&`, single-quoted arguments) and for paths
built with `/` instead of `node:path`.
