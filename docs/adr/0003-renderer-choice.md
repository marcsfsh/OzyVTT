# ADR-0003 closing record: the renderer question, resolved by the code

## Status

Closed — 2026-08-01. Records an outcome; supersedes nothing and decides nothing new.
**Closes** ADR-0003 ("Choose a mature Canvas/WebGL renderer after the interaction spike"),
which had no file and stood as *Proposed* in `docs/adr/README.md`.

## What happened

ADR-0003 deferred the renderer choice pending an interaction spike. The spike was written
(`docs/product/phase-0-renderer-spike.md`, PixiJS in a React lifecycle component,
`apps/client/src/scene/RendererProof.tsx`) and then **abandoned rather than concluded**. The
map that shipped is DOM/SVG on every surface: `apps/client/src/scene/EncounterMap.tsx` for the
table, `apps/client/src/viewer/ViewerApp.tsx` for the public screen, and
`apps/client/src/codex/MapSurface.tsx` for the atlas. The two interactive surfaces convert
screen→image coordinates with `getScreenCTM` via `imagePointFromClient`
(`apps/client/src/scene/mapImage.tsx`) — an SVG API with no canvas equivalent — so the choice
is now load-bearing rather than incidental. The viewer does its own screen→image maths against
the SVG `viewBox`, which is a different mechanism but the same commitment.

`apps/client/src/scene/RendererProof.tsx` had **zero import sites**: it was the only importer of
the PixiJS dependency declared in `apps/client/package.json`, and the only place in the client
that configured high-DPI rendering. Both were removed on 2026-08-05 — see Consequences.

## The decision this records

**SVG/DOM is the renderer.** A future move to Canvas/WebGL would be a new decision with a new
ADR, made because SVG measurably failed at a stated density — not because ADR-0003 was still
open.

## Consequences

- **The dependency and the spike file are gone (2026-08-05).** `apps/client/src/scene/RendererProof.tsx`
  was deleted and `pixi.js` dropped from `apps/client/package.json` and the lockfile, after
  re-confirming the file had no import site and was named by none of the four HTML entry points.
  This record still names the deleted path, because the removal is what it records — which is why
  `apps/server/test/docs-paths.test.ts` carries that path in its `REMOVED_ON_PURPOSE` list rather
  than treating it as a stale claim.
- The image-pixel-space convention (`docs/ai-context/map-grid.md`) depends on `getScreenCTM`.
  Any renderer change must replace that convention, not just the drawing layer.
