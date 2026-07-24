---
name: vtt-test-pass
description: Use when you've made implementation changes and need to prove the app still runs, or to decide the minimum verification before calling work done on this repo. Defines the verification tiers and the live Playwright smoke so "verified" is never a vague phrase.
---

# vtt-test-pass

Turn "should work now" into a concrete, run-it verification. Pick the lightest tier that
actually covers the change — and then run it. `docs/ai-context/testing.md` has the tooling
detail; this skill is the procedure for choosing and reporting.

## Pick the tier (lightest that covers the change)

| Change | Minimum verification |
| --- | --- |
| Types/refactor, no runtime behavior | **Quick:** `npm run check` |
| Logic in server/packages | **Change-focused:** `npm run check && npm test` (scope with `--workspace=@vtt/server` while iterating, full before done) |
| Anything going into a PR | **CI-parity:** `npm test && npm run check && npm run build` — exact CI order |
| UI / client behavior | CI-parity **+ live app**: `npm run dev`, exercise the flow at a desktop width **and** a narrow/touch viewport |
| Projections / viewer | the above **+ viewer-safety pass**: pair `/viewer.html` and confirm nothing GM-only leaks |

Remember: `@vtt/web` has **no unit tests** — client correctness rides on `check` + `build`
**plus** an actual browser pass. Don't skip the manual look for UI work.

## Live Playwright smoke (the project bar for UI PRs)

UI PRs get a live smoke: **seed a map + calibration + encounter via the
API**, then drive the map inside the full-viewport **"Enlarge map"** overlay (so drags land
on-screen), exercising the changed flow (e.g. dock the panel to each edge, inline-edit an
initiative score, calibrate a gridless grid, switch scenes). Verify GM, player, and paired
`/viewer.html` surfaces where the change touches them.

## Report what you actually ran

State the commands and their results, plus what you drove manually — e.g.:

```
Verified:
- npm run check ✓   npm test ✓ (server 26/26)   npm run build ✓
- npm run dev: docked panel to all 4 edges, stayed fixed on resize; zoom cluster relocated
- Paired /viewer.html: grid overlay visible to GM, not leaking GM-only tokens
Not covered: physical iOS/Android device (BUILD_PLAN GAP-001)
```

## Rules

- **Run it, don't assert it.** A tier you didn't execute isn't verification.
- **Name what you didn't cover** — silent gaps read as "fully tested." Call out physical-device
  and degraded-browser gaps explicitly (they don't exist yet — see `known-bugs.md`).
- A red `check`/`test`/`build`, or a broken manual flow, means **not done** — fix or report,
  don't round up to pass.
