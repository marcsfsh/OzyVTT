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
