# test-reviewer — memory

Curated index of durable verification learnings for this repo. Keep this file short; put detail in
sibling topic files and link them here. Update after runs.

## Tooling / gotchas

- `npm run check` = typecheck only (`tsc --noEmit`); no lint tooling exists.
- CI order = `npm test && npm run check && npm run build`.
- `@vtt/web` (client) has no unit tests — client correctness needs a live browser + narrow-viewport
  pass. Stale `*.tsbuildinfo` can mask type errors; a clean `npm run build` resolves it.

## Flaky spots / coverage gaps

_(none recorded yet)_

## Notes

_(add per-run findings)_
