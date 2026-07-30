# Testing, CI & verification

**Read this when:** you changed code and need to prove it works, or you're deciding what
"verified" means for a change. Pairs with the `vtt-test-pass` discipline.

## Commands (run from repo root; npm workspaces, Node ≥24)

| Command | What it does |
| --- | --- |
| `npm run check` | **Typecheck only** — fans `tsc` across every workspace with a `check` script. Fastest full-repo signal. Web uses `tsc -b` (project references); server/packages use `tsc --noEmit`. |
| `npm test` | `vitest run` (one-shot) in every workspace with tests: `@vtt/web` (14), `@vtt/server` (771), `@vtt/content-srd-5.2.1` (80), `@vtt/rules-5e` (108), `@vtt/api-contract` (36), `@vtt/schemas` (19), `@vtt/dndbeyond-pdf` (12), `@vtt/domain` (11). |
| `npm run build` | `tsc -b && vite build` for the client; `tsc` for the server. |
| `npm run dev` | Client (`vite --host 0.0.0.0`, `:5173`) + server (`tsx watch`, `:3001`) concurrently. |
| `npm start` | Build, then run the single LAN service. |

Scope to one package: `npm test --workspace=@vtt/server`.

## What CI runs

`.github/workflows/ci.yml` (job "Test, type-check, and build"), on push/PR to `main`,
Node 24: `npm ci` → `npm test` → `npm run check` → `npm run build`. Read-only contents
permission, 15-min timeout, cancels superseded runs. `docs/product/continuous-integration.md`
documents the same local-equivalent sequence.

## What "verified" means here

- **Quick:** `npm run check` (typecheck).
- **Change-focused:** `npm run check && npm test`.
- **CI-parity before pushing:** `npm test && npm run check && npm run build` — mirrors CI
  order exactly.
- **UI changes also need a real look:** run the app (`npm run dev`) and exercise the
  affected flow at a desktop width *and* a narrow/touch viewport (see `mobile-ux.md`), and
  confirm viewer safety when projections/viewer are touched (see `viewer-mode.md`).
  "Should work now" without running anything is not verification.

## Tooling & gotchas

- **Vitest 4** everywhere tests exist; `apps/server/test/` has integration-style tests that
  boot Express/Socket.IO (the highest-signal suite). `rules-5e`/`schemas`/`api-contract`
  are focused unit tests. No `vitest.config.*` — Vitest defaults.
- **`@vtt/web` now HAS a test script** (added 2026-07-28, Codex overhaul M3): Vitest + **jsdom** +
  Testing Library, configured in `apps/client/vitest.config.ts` with shims in `apps/client/test/setup.ts`.
  **What it does and does not prove.** jsdom omits several APIs this app uses. `setup.ts` shims **six**
  so components can render: native `<dialog>` `showModal`/`close`, `setPointerCapture`,
  `scrollIntoView`, `scrollTo`, `ResizeObserver`, `matchMedia`. **`SVGSVGElement.getScreenCTM` is
  deliberately NOT shimmed** — faking a coordinate matrix would invent geometry rather than test it.

  A test passing under a shim is evidence about *this app's logic*, never about a browser. Concretely,
  these cannot be verified here and still need a real browser pass:
  - **Layout and pointer geometry** — `MapSurface` panning/zoom, `RelationshipGraph` hit-testing, and
    the 44px touch floor (`getScreenCTM` is absent; jsdom reports zero-size boxes anyway).
  - **Modal behaviour beyond "it rendered"** — the `showModal` shim only sets `.open`, i.e. `show()`
    semantics. The browser's focus trap, Escape-to-close and click-outside are **not** represented, so a
    Modal could be broken in those respects while tests pass.
  - **Anything CSS-dependent** — no stylesheet is loaded, so visibility, breakpoints and theming are
    invisible to these tests.

  UI work therefore still requires running the app.
- **No ESLint/Prettier.** "check" is TypeScript-only; don't assume a linter will catch style.
- Web `check`/`build` are incremental (`tsc -b`); a stale `tsbuildinfo` can mask errors — a
  clean `npm run build` resolves confusing type results.
- `@vtt/domain` and `@vtt/ui` are typecheck-only; `content-srd-5.2.1` has no scripts.
