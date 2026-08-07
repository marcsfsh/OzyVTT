# ADR-014: Device support

## Status

Accepted — 2026-07-15 (browser-version baseline still open; see Migration / reversibility).

## Context and decision drivers

ADR-001 commits to a browser application with full phone/desktop functional parity, and the product's stated audience joins directly from a phone or laptop on the LAN (README.md). Scope boundaries explicitly exclude a reduced mobile feature set (BUILD_PLAN.md §9.3: "reject any architecture that requires a reduced mobile feature set"). Touch, pointer, and mouse input must all reach the same combat actions, and the map/token renderer must remain usable at typical phone/tablet/desktop viewport sizes and pixel densities.

## Considered options

- Desktop-first with a reduced or read-only mobile mode: least implementation work, but directly contradicts the explicit functional-parity requirement and would leave players unable to play from a phone.
- Native mobile apps alongside a desktop web client: could optimize per-platform UX, but doubles the build/release surface for a single-host hobby-scale product and conflicts with the "single browser application" platform decision (ADR-001).
- One responsive browser client handling pointer, mouse, and touch input uniformly, with layout and interaction that adapt to viewport rather than device class: matches ADR-001, keeps one codebase and one command/event contract, and lets the same session/claim/dice flows (ADR-005, ADR-011, ADR-012) work unmodified regardless of device.

## Decision

The client is one responsive React/Vite browser application (ADR-004) with fluid layout (`clamp()`-based type/spacing) and explicit breakpoints for narrower viewports (`apps/client/src/styles.css`, `@media (max-width: 979px)` for the phone table's frame, plus `760px` and `560px`), rather than a separate mobile build. The shipped map surfaces unify mouse, trackpad, and touch input on one SVG stage (ADR-0003, which closed the renderer question in SVG's favour): Pointer Events drive drag-to-pan, token drag and selection; a non-passive `wheel` listener drives desktop zoom; and `touch-action: none` on the stage stops the browser's native scroll/zoom from fighting the custom gesture handling (`apps/client/src/scene/EncounterMap.tsx`, `apps/client/src/viewer/ViewerApp.tsx`, `apps/client/src/codex/MapSurface.tsx`). Two-finger pinch is a pointer-count gesture where it exists — the atlas map and the connection graph (`apps/client/src/codex/RelationshipGraph.tsx`) — while the encounter map and the shared screen reach the same zoom through explicit on-screen controls; that asymmetry is a real gap in the touch story, not a device-class decision. High-DPI phone and tablet screens need no per-device configuration at all now that the map is vector: it resolves at the display's own density, and no device-pixel-ratio setting survives anywhere in the client. Every consequential action (claim, roll, future combat commands) reaches the same server command handlers regardless of input device, so parity is structural, not a matter of duplicating features per platform.

## Consequences and tradeoffs

Because there is one client, every new interaction must be designed to work with touch as well as pointer/keyboard from the start, rather than being retrofitted for mobile later; this is accepted as the cost of the no-reduced-mobile-feature-set requirement. The renderer, layout, and touch-gesture code is more involved than a desktop-only canvas would require (documented gesture/viewport/safe-area/virtual-keyboard requirements in BUILD_PLAN.md §21.4–21.6), but avoids maintaining a second client entirely.

## Mobile, security, and visibility impact

This ADR is primarily a mobile-UX decision: it commits the product to full-featured phone play, not a companion/reduced mode. It has no independent security impact beyond what ADR-005/ADR-011/ADR-012 already establish, since device type does not change authorization, projection, or roll authority — a phone session and a desktop session carrying the same token are treated identically by the server.

## Migration / reversibility

The exact supported browser/OS version matrix is not yet pinned: there is no `browserslist` configuration or explicit Vite `build.target` override in the repository (confirmed by inspection of `apps/client/vite.config.ts` and the package manifests), so the effective baseline is Vite 6's modern-ES-module default rather than a deliberately chosen matrix. BUILD_PLAN.md §21.5 names the intended baseline — current iOS Safari, current Android Chrome, current desktop Chrome/Edge/Firefox/Safari, and iPadOS Safari as a responsive midpoint — and requires that unsupported or resource-constrained browsers get an explicit capability message and accessible fallbacks rather than a blank canvas; neither the pinned version list nor the fallback UI exists yet. This ADR accepts full-parity responsive support as the committed direction while leaving the exact version matrix and degraded-browser messaging open, to be finalized before the Phase 1 exit gate (BUILD_PLAN.md §8, ADR-014 row).

## Validation evidence

`apps/client/src/scene/EncounterMap.tsx` and `apps/client/src/codex/MapSurface.tsx` demonstrate pointer drag/zoom on the shipped SVG stage, the latter with a two-finger pinch driven by pointer count. `docs/product/phase-0-renderer-spike.md` records the abandoned WebGL spike that first demonstrated those gestures; its renderer proof and the PixiJS dependency were deleted on 2026-08-05 (ADR-0003), so the evidence for this ADR is now the shipped surfaces rather than the spike. `apps/client/src/styles.css` shows working responsive breakpoints (`@media (max-width: 979px)`, `(max-width: 760px)` and `(max-width: 560px)`) down to the 320px minimum width the body carries. The 979 rung is the phone table's, added in Phase C: below it the table is a frame — a map band over a tabbed sheet — and above it the two-column laptop composition. Every client `@media` width is a rung of the one ladder (`design-language.md` §3); the off-ladder allowlist reached zero on 2026-08-05. No physical iOS/Android device acceptance pass has been recorded yet (BUILD_PLAN.md GAP-001, open validation gap), and the phone/tablet/desktop prototyping and full touch-behavior checklist in BUILD_PLAN.md §21.4 remain partially open — this ADR records the accepted direction, not a closed validation gate.
