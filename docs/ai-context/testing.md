# Testing, CI & verification

**Read this when:** you changed code and need to prove it works, or you're deciding what
"verified" means for a change. Pairs with the `vtt-test-pass` discipline.

## Commands (run from repo root; npm workspaces, Node ≥24)

The command table is `CLAUDE.md`'s and a test holds it to `package.json`; this file owns what
counts as *enough*. Scope while iterating with `--workspace=@vtt/server`; run the full suite
before concluding. `npm run check` is typecheck only — **there is no linter in this repo**, so
nothing here catches style.

## The two documents that cannot go stale

Two documents are generated from code and guarded by tests, and they are the only documents in
this repo that a change cannot silently falsify:

- `docs/app-map.md` — `apps/server/test/app-map.test.ts` asserts the committed bytes equal a
  fresh `renderAppMap()`, **and** that every `GameState` field, command type and HTTP path
  appears in the render. Regenerate with `npm run map`.
- `docs/api-reference.md` — `packages/api-contract/test/reference.test.ts` does the same for
  the API, plus a documentation-obligation walk computed independently of the renderer, plus a
  cross-document phrase pin against ADR-0016. Its regeneration command is in the generated
  file's own header.

**Both halves are load-bearing.** Coverage proves the *renderer* is complete; byte-equality
transfers that guarantee onto the *committed file*. Either alone passes forever against the
other's failure mode. If you add a generated document, ship both.

`docs/ai-context/viewer-mode.md` uses a third pattern for prose that cannot be generated: its
Invariants section is worded to match the test titles that prove each invariant, **word for
word, in both directions** — change either side alone and the check fails. Whitespace is
normalised before comparing, so re-flowing the section is safe and only the words matter. The
grep loop below still needs each phrase on one line, so keep it as the fast local check and let
`npx vitest run test/docs-viewer-safety.test.ts --root apps/server` be the authority:

```
for p in "hides all presentation content while disabled" "rejects non-GM control" \
  "omits a gm-only combatant from both the player and the viewer lists" \
  "projects only public, non-expired annotations onto the shared screen" \
  "exact HP never reaches others" "keeping the map/fog but no tokens" \
  "reaches players and the viewer verbatim"; do
  grep -qF "$p" docs/ai-context/viewer-mode.md || echo "MISSING: $p"; done
```

## The checks that fail on a design or vocabulary regression

Three client suites enforce things a reviewer used to have to notice. They are ordinary
`npm test` failures — there is no separate command — and each names the fix in its message.

| Suite | What fails |
|---|---|
| `apps/client/src/play-vocabulary.test.ts` | A retired word in user copy anywhere under `apps/client/src` (minus a pinned exclusion list) or in `packages/ui/src/primitives`. Also pins the structured copy the scan cannot see: `CLAIM_WORD`, `ROLL_VISIBILITY_WORD`, `SETTINGS_GROUPS`, the rules dial, the GM tab labels. |
| `apps/client/src/codex/vocabulary.test.ts` | The same, for the Codex's own glossary. Both read one scanner, `apps/client/src/copy-scan.ts`. |
| `apps/client/src/design-conventions.test.ts` | A text glyph where an icon belongs, a raw `<input type="search"\|number">`, a second `.eyebrow`, a hand-typed colour, an inline feedback banner, an off-ladder breakpoint, a viewport-fraction cap on in-flow content, an undeclared scroll region (a bare `overflow-y: auto` in app CSS). |

Every allowlist in those files is **shrink-only**, and its size is pinned in
`apps/client/src/design-conventions-shape.ts` — so fixing a violation costs a deleted row plus
a decremented number, and *weakening* a check costs two deliberate edits in two files. The
dead-entry detectors mean a fixed violation fails until its row is removed. Do not add a row to
go green; the failure message tells you what to type instead.

Two limits, so a green run is not over-read: the scan reads copy, not code, so a literal inside
a JSX expression (`{claimed ? "Claimed" : "Available"}`) is invisible — those cases are pinned
at their definition instead; and a regex matches tokens, not senses, which is why the terms D28
KEEPS (fog Reveal/Hide, Initiative the score, Save the throw, Claim/Release) are asserted
PRESENT rather than merely left un-ruled.

## What CI runs

`.github/workflows/ci.yml` (job "Test, type-check, and build"), Node 24:
`npm ci` → `npm test` → `npm run check` → `npm run build`. Read-only contents permission,
15-min timeout, cancels superseded runs. **CI is the gate for anything reaching `main`, and
that workflow is the only statement of which refs it fires on — read the `on:` block rather
than trusting a copy. Whatever it covers, it does not cover the browser pass below; nothing
automated does.**

## What "verified" means here

- **Quick:** `npm run check` (typecheck only).
- **Change-focused:** `npm run check && npm test`.
- **CI-parity before pushing:** `npm test && npm run check && npm run build` — CI's exact
  order.
- **UI changes additionally need a real browser.** jsdom loads no stylesheet and computes no
  layout, so nothing above proves layout, pointer geometry, focus behaviour or the touch
  floor. The repo's browser gate is `scripts/browser-verify.mjs`: seed with
  `node scripts/seed-codex.mjs` against a throwaway `DATA_DIR`, then run it — every check
  either passes with the fact it observed or fails with what it saw instead. It drives
  Playwright, which is **deliberately not a repo dependency**: point `PLAYWRIGHT_PKG` at any
  install and never run `playwright install`. Because it needs a browser and a live server it
  is not wired into `npm test`, so it is a thing you run, not a thing that runs.
- **Projection or viewer changes additionally need a viewer-safety pass:** pair
  `/viewer.html` and confirm nothing GM-only appears. For Codex changes, use the GM's player
  preview (`POST /api/v1/codex/preview-session`) rather than reasoning about it.
- **Touch targets:** `node scripts/tap-audit.mjs 375` measures the 44px floor across GM and
  player surfaces — the Codex and the play shell's routes; a new address is one line in its
  surface tables — and exits non-zero if anything is sub-floor *or* any surface goes
  unmeasured. Quote its output; do not quote a number from a document.
- **The layout law (design-language.md §7):** `node scripts/no-scroll-audit.mjs` drives the
  route × role table (landing, viewer entry, a real GM session, a real player session) at
  1280×900, 1280×720 and 390×844 and exits non-zero if any route's document scrolls on
  either axis *or* any route goes unmeasured. Same terms as the tap audit: needs a browser
  and a live dev server, so it is a thing you run, not a thing that runs. The shell lock
  took the whole table green (staged pane regions absorb unconverted surfaces), so any red
  cell is a regression; the (g)/(h) ratchets carry the remaining conversion debt.

Say what you ran and what you saw. A tier you did not execute is not verification, and
"should work now" is not a result.

## Tooling & gotchas

- **Vitest 4** everywhere tests exist; `apps/server/test/` has integration-style tests that
  boot Express/Socket.IO (the highest-signal suite). `rules-5e`/`schemas`/`api-contract`
  are focused unit tests.
- **`@vtt/web` has a test suite**: Vitest + **jsdom** + Testing Library, configured in
  `apps/client/vitest.config.ts` with shims in `apps/client/test/setup.ts`.
  **What it does and does not prove.** jsdom omits several APIs this app uses. `setup.ts` shims
  native `<dialog>` `showModal`/`close`, `setPointerCapture`, `scrollIntoView`, `scrollTo`,
  `ResizeObserver` and `matchMedia` so components can render. **`SVGSVGElement.getScreenCTM` is
  deliberately NOT shimmed** — faking a coordinate matrix would invent geometry rather than
  test it.

  A test passing under a shim is evidence about *this app's logic*, never about a browser.
  Concretely, these cannot be verified here and still need a real browser pass:
  - **Layout and pointer geometry** — `MapSurface` panning/zoom, `RelationshipGraph`
    hit-testing, and the 44px touch floor (`getScreenCTM` is absent; jsdom reports zero-size
    boxes anyway).
  - **Modal behaviour beyond "it rendered"** — the `showModal` shim only sets `.open`, i.e.
    `show()` semantics. The browser's focus trap, Escape-to-close and click-outside are **not**
    represented, so a Modal could be broken in those respects while tests pass.
  - **Anything CSS-dependent** — no stylesheet is loaded, so visibility, breakpoints and
    theming are invisible to these tests.
- **No ESLint/Prettier.** "check" is TypeScript-only; don't assume a linter will catch style.
- Web `check`/`build` are incremental (`tsc -b`); a stale `tsbuildinfo` can mask errors — a
  clean `npm run build` resolves confusing type results.
- **A green `npm test` does not mean every workspace ran.** The root script is
  `--if-present`, so a workspace with no `test` script is skipped silently — see
  `docs/ai-ledger/current-state.md` under *Known broken*.
