---
name: vtt-test-pass
description: Use when you've made implementation changes and need to prove the app still runs, or to decide the minimum verification before calling work done on this repo. Defines the verification tiers and the browser pass so "verified" is never a vague phrase.
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

`@vtt/web` **has** a Vitest + jsdom suite — run it and extend it. But jsdom loads no stylesheet
and computes no layout, so a green client suite proves logic and the accessibility tree and
**nothing about layout, pointer geometry, focus behaviour or touch targets**. Those still need a
browser: `scripts/browser-verify.mjs`. See `docs/ai-context/testing.md`.

## The browser pass (the bar for UI work)

The repo's browser gate is `scripts/browser-verify.mjs`. Seed a throwaway campaign
(`node scripts/seed-codex.mjs` against a `DATA_DIR` you can delete), run the server, run the
script; every check reports the fact it observed or what it saw instead. It drives Playwright
from an **external install** — Playwright is deliberately not a repo dependency, so point
`PLAYWRIGHT_PKG` at one and never run `playwright install`.

For map/encounter work the script does not cover, drive the map inside the full-viewport
**"Enlarge map"** overlay so drags land on-screen, and verify GM, player and paired
`/viewer.html` where the change touches them. Full detail: `docs/ai-context/testing.md`.

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
