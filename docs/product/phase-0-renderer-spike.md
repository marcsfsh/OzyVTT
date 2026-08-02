> ## ⚠ SUPERSEDED — 2026-08-01
>
> **What this is:** the Phase 0 WebGL renderer spike (PixiJS in a React lifecycle component).
> Kept in place, not archived, because `docs/adr/0003-renderer-choice.md`,
> `docs/adr/0014-device-support.md` and `docs/ai-context/map-grid.md` all cite it.
> **Current through:** the spike's own date. **The question it was built to settle is closed.**
> **What actually happened:** the shipped map surface is DOM/SVG on every surface, not WebGL.
> The spike was abandoned rather than concluded, and `docs/adr/0003-renderer-choice.md` is the
> closing record. `apps/client/src/scene/RendererProof.tsx` still exists and still compiles, but
> it has **zero import sites** — PixiJS is a dependency nothing renders.
> **So the "Still required before ADR-003 is accepted" list below is not an open work list.**
> ADR-0003 was closed by the code, not by that evidence. Its device-testing items survive as
> BUILD_PLAN GAP-001 (the physical-device pass), which is still genuinely open.
> **Read this for:** what the WebGL path demonstrated, and the measured 519 kB baseline.
> **Do not read this for:** how the map renders now. That is `docs/ai-context/map-grid.md`.
> **Paths, line numbers and counts inside this file are as of the date above and are not maintained.**

# Phase 0 renderer and input spike

## Purpose

Validate a mature WebGL renderer before placing encounter state or game rules on top of it. This is a deliberately local-only proof; the grid and tokens are not live domain entities and never mutate game state.

## Candidate

PixiJS, initialized directly from a React lifecycle component.

## Implemented proof behavior

- Canvas/WebGL initialization with device-pixel-ratio capped at 2.
- Square grid and token rendering with independent selected-token treatment.
- Mouse/trackpad wheel zoom and pointer panning.
- Two-finger pinch zoom on a touch device.
- Accessible DOM wrapper and live status text for critical feedback.
- Server startup now lists usable IPv4 LAN URLs alongside localhost.

## Evidence recorded so far

- Type checking and production build succeed.
- The renderer is isolated from authoritative state, socket commands, and persistence.
- Production build emits a 519 kB minified entry chunk containing PixiJS; this is a baseline measurement, not yet a performance pass.

## Still required before ADR-003 is accepted

- Test on the actual intended iOS Safari and Android Chrome devices.
- Test a map at expected maximum dimensions and at least 100 tokens.
- Test panning, zoom, selection, independent targeting, drag proposal, and multi-cell tokens.
- Measure interaction/frame performance and decide whether renderer code should load only after entering a scene.
- Validate direct-IP connection from a phone and laptop on the same LAN, including the displayed URL.
