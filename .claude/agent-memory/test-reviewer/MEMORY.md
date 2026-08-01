# test-reviewer — memory

Curated index of durable verification learnings for this repo. Keep this file short; put detail in
sibling topic files and link them here. Update after runs.

## Tooling / gotchas

- `npm run check` = typecheck only, no linter anywhere in the repo. `@vtt/web` builds with `tsc -b`; everything else is `tsc --noEmit`.
- CI order = `npm test && npm run check && npm run build`.
- `@vtt/web` has a Vitest + jsdom suite (`apps/client/vitest.config.ts`, setup in
  `apps/client/test/setup.ts`). It proves logic and the accessibility tree; it cannot prove layout,
  pointer geometry or the touch floor — `getScreenCTM` is deliberately not shimmed. Browser gate:
  `scripts/browser-verify.mjs`.
- `apps/server/test/` is not typechecked (`apps/server/tsconfig.json` `include: ["src"]`), so a type
  error in a server test never fails `npm run check`.
- Stale `*.tsbuildinfo` can mask type errors; a clean `npm run build` resolves it.

## Flaky spots / coverage gaps

- `packages/ui` has no `test` script and no test files — `npm run test` skips it silently via
  `--if-present`, so a green run says nothing about the shared primitives.

## Notes

_(add per-run findings)_
