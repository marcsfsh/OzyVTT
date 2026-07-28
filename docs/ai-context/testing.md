# Testing, CI & verification

**Read this when:** you changed code and need to prove it works, or you're deciding what
"verified" means for a change. Pairs with the `vtt-test-pass` discipline.

## Commands (run from repo root; npm workspaces, Node ≥24)

| Command | What it does |
| --- | --- |
| `npm run check` | **Typecheck only** — fans `tsc` across every workspace with a `check` script. Fastest full-repo signal. Web uses `tsc -b` (project references); server/packages use `tsc --noEmit`. |
| `npm test` | `vitest run` (one-shot) in every workspace with tests: `@vtt/web`, `@vtt/server`, `@vtt/api-contract`, `@vtt/rules-5e`, `@vtt/schemas`, `@vtt/domain`, `@vtt/dndbeyond-pdf`. |
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
  **What it does and does not prove:** jsdom omits several APIs this app uses — native `<dialog>`
  `showModal`/`close`, `setPointerCapture`, `scrollIntoView`, `scrollTo`, `ResizeObserver`, `matchMedia`,
  `SVGSVGElement.getScreenCTM`. `setup.ts` shims them so components can render, but a test passing under
  a shim is evidence about *this app's logic*, not about a browser. **Anything depending on real layout
  or pointer geometry — `MapSurface` panning, `RelationshipGraph` hit-testing, the 44px touch floor —
  cannot be verified here and still needs a real browser pass.** UI work therefore still requires running
  the app.
- **No ESLint/Prettier.** "check" is TypeScript-only; don't assume a linter will catch style.
- Web `check`/`build` are incremental (`tsc -b`); a stale `tsbuildinfo` can mask errors — a
  clean `npm run build` resolves confusing type results.
- `@vtt/domain` and `@vtt/ui` are typecheck-only; `content-srd-5.2.1` has no scripts.
