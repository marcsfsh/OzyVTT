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

`RendererProof.tsx` has **zero import sites** (verify:
`grep -rn "RendererProof" apps/client --include=*.tsx --include=*.ts --include=*.html`). It is
the only importer of the PixiJS dependency declared in `apps/client/package.json`, and the only
place in the client that configures high-DPI rendering.

## The decision this records

**SVG/DOM is the renderer.** A future move to Canvas/WebGL would be a new decision with a new
ADR, made because SVG measurably failed at a stated density — not because ADR-0003 was still
open.

## Consequences

- PixiJS is a dependency the shipped app does not use, and `RendererProof.tsx` is dead code.
  Removing both is a straightforward cleanup and is **not done by this record** — it is a code
  change, and `docs/ai-ledger/current-state.md` carries it as a known gap instead.
- The image-pixel-space convention (`docs/ai-context/map-grid.md`) depends on `getScreenCTM`.
  Any renderer change must replace that convention, not just the drawing layer.
