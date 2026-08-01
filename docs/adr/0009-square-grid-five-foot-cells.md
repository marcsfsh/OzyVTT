# ADR-0009 closing record: square grid, five-foot cells

## Status

Accepted by implementation — recorded 2026-08-01. **Closes** ADR-0009 ("Square grid /
five-foot cells for MVP; measurement conventions pending spike"), which had no file and stood
as *Proposed … pending spike* in `docs/adr/README.md`.

> **Skeleton — structure only.** Plan A owns this file's existence and its numbering
> (D13 + MASTER-PLAN §9 O-1). Plan B §5.4 (Developer 2) writes the prose. Plan A §8 Q1 and
> REVIEW-A resolve the one open conflict: ADR-0009 and ADR-0013 get **separate** four-digit
> files, so that every index row points at its own document.

## What happened

_Awaiting Plan B §5.4 (Developer 2): calibration is `{origin, cellSizePx, rotationRadians,
distancePerCell}`; the square-grid path derives `cellSizePx` from a 3×3 drag and locks rotation
to 0 (`apps/server/src/grid-calibration.ts`). Measurement conventions are settled in code
(`apps/server/src/annotations.ts`)._

## Recorded outcome

_Awaiting Plan B §5.4 (Developer 2). `docs/ai-context/map-grid.md` is the live description; the
spike is not pending._

## What is still open

_Awaiting Plan B §5.4 (Developer 2)._
