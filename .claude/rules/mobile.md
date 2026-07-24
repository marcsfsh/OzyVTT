---
paths:
  - "apps/client/src/**/*.tsx"
  - "apps/client/src/**/*.css"
  - "packages/ui/**"
---

# Mobile parity (hard invariant — CLAUDE.md rule 5)

Phone and laptop are first-class. UI-affecting changes must work at a narrow viewport and
with touch.

- New draggable/zoomable surfaces set `touch-action: none`.
- Verify at a narrow viewport (and with touch) before calling UI work done — "should work"
  is not verification.

Full context: `docs/ai-context/mobile-ux.md`.
