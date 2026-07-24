---
paths:
  - "apps/server/src/grid-*.ts"
  - "apps/server/src/map-*.ts"
  - "apps/server/src/token-placement.ts"
  - "apps/server/src/annotations.ts"
  - "apps/server/src/fog.ts"
  - "apps/client/src/maps/**"
  - "apps/client/src/scene/**"
  - "apps/client/src/scenes/**"
---

# Maps & grid geometry (hard invariant)

The server owns **all** snapping and geometry. Client map math is **preview-only** and works
in image-pixel space (`imagePointFromClient`); the server result is authoritative and the
client preview must mirror it, never replace it.

Full context: `docs/ai-context/map-grid.md`.
