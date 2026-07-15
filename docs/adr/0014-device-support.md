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

The client is one responsive React/Vite browser application (ADR-004) with fluid layout (`clamp()`-based type/spacing) and explicit breakpoints for narrower viewports (`apps/client/src/styles.css`, `@media (max-width: 760px)` and `@media (max-width: 560px)`), rather than a separate mobile build. The map/token renderer proof unifies mouse, trackpad, and touch input on the same canvas: pointer events drive drag-to-pan and selection, wheel events drive desktop zoom, and native two-finger touch events drive pinch-to-zoom (`apps/client/src/scene/RendererProof.tsx`), with `touch-action: none` set on the canvas so the browser's native scroll/zoom gestures do not fight the custom gesture handling. High-DPI phone and tablet screens are handled via device-pixel-ratio-aware rendering (`autoDensity`, capped `resolution`) rather than a fixed desktop-resolution assumption. Every consequential action (claim, roll, future combat commands) reaches the same server command handlers regardless of input device, so parity is structural, not a matter of duplicating features per platform.

## Consequences and tradeoffs

Because there is one client, every new interaction must be designed to work with touch as well as pointer/keyboard from the start, rather than being retrofitted for mobile later; this is accepted as the cost of the no-reduced-mobile-feature-set requirement. The renderer, layout, and touch-gesture code is more involved than a desktop-only canvas would require (documented gesture/viewport/safe-area/virtual-keyboard requirements in BUILD_PLAN.md §21.4–21.6), but avoids maintaining a second client entirely.

## Mobile, security, and visibility impact

This ADR is primarily a mobile-UX decision: it commits the product to full-featured phone play, not a companion/reduced mode. It has no independent security impact beyond what ADR-005/ADR-011/ADR-012 already establish, since device type does not change authorization, projection, or roll authority — a phone session and a desktop session carrying the same token are treated identically by the server.

## Migration / reversibility

The exact supported browser/OS version matrix is not yet pinned: there is no `browserslist` configuration or explicit Vite `build.target` override in the repository (confirmed by inspection of `apps/client/vite.config.ts` and the package manifests), so the effective baseline is Vite 6's modern-ES-module default rather than a deliberately chosen matrix. BUILD_PLAN.md §21.5 names the intended baseline — current iOS Safari, current Android Chrome, current desktop Chrome/Edge/Firefox/Safari, and iPadOS Safari as a responsive midpoint — and requires that unsupported or resource-constrained browsers get an explicit capability message and accessible fallbacks rather than a blank canvas; neither the pinned version list nor the fallback UI exists yet. This ADR accepts full-parity responsive support as the committed direction while leaving the exact version matrix and degraded-browser messaging open, to be finalized before the Phase 1 exit gate (BUILD_PLAN.md §8, ADR-014 row).

## Validation evidence

`apps/client/src/scene/RendererProof.tsx` and `docs/product/phase-0-renderer-spike.md` demonstrate pointer drag/zoom and two-finger touch pinch on the same canvas, plus high-DPI rendering. `apps/client/src/styles.css` shows working responsive breakpoints down to a 320px minimum width. No physical iOS/Android device acceptance pass has been recorded yet (BUILD_PLAN.md GAP-001, open validation gap), and the phone/tablet/desktop prototyping and full touch-behavior checklist in BUILD_PLAN.md §21.4 remain partially open — this ADR records the accepted direction, not a closed validation gate.
