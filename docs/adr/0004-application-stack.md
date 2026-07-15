# ADR-004: Application language and stack

## Status

Accepted — 2026-07-15.

## Context and decision drivers

The product is a single-host, browser-based, combat-first D&D 5e VTT for one GM and a small home group (ADR-001, ADR-002). The team is small, the server must remain authoritative over shared domain code, and the client must run acceptably on phones, tablets, and desktops without a native build. The stack must support a strict server/client trust boundary, versioned schemas, transactional persistence, and a public API surface later (ADR-016) without a rewrite.

## Considered options

- Polyglot server (e.g. a non-JavaScript backend) with a JavaScript/TypeScript client: allows a different persistence/runtime ecosystem, but forces two type systems and duplicated command/event/schema definitions across a network boundary.
- JavaScript without static types: fastest to start, but the shared command/event/schema contracts between `apps/client`, `apps/server`, and `packages/domain` are exactly the kind of cross-boundary contract static types are meant to protect.
- TypeScript end to end with a workspace of shared packages: one language and type system across client, server, and domain code; contracts in `packages/domain` and `packages/schemas` are imported, not re-implemented, on both sides of the socket.

## Decision

Use TypeScript end to end in an npm workspace (`apps/*`, `packages/*`), Node.js 24+ as the server runtime, React 19 with Vite for the browser client, Express 5 and Socket.IO 4 on the server, Zod for runtime schema validation, and Node's built-in `node:sqlite` for persistence (ADR-006). PixiJS is the current renderer-spike dependency for the map/token canvas (ADR-003 remains open on renderer selection). Shared contracts — commands, events, projections, and actor/content schemas — live in `packages/domain`, `packages/schemas`, and `packages/rules-5e` and are imported by both `apps/client` and `apps/server`, never duplicated.

## Consequences and tradeoffs

One language and one dependency graph simplify shared-contract maintenance and let the domain/rules packages be unit-tested without a browser or an HTTP server. Node 24 becomes the minimum supported runtime because of `node:sqlite` (tracked as RISK-001: the API is still release-candidate/experimental and must be reviewed before production packaging or Node upgrades). Workspace packages currently ship TypeScript source rather than compiled output, so the supported launch path still depends on the `tsx` loader even after the client build (tracked as GAP-004); ordered package compilation is required before self-host packaging.

## Mobile, security, and visibility impact

The stack choice does not itself grant privilege: Express/Socket.IO route all consequential actions through the same authorization and projection layer regardless of client framework. React with Vite produces a standard responsive web bundle usable on phone and desktop browsers (ADR-014); no native app or platform-specific runtime is required to reach full functional parity.

## Migration / reversibility

Individual layers are replaceable without breaking the domain contract: the renderer is still a spike (ADR-003), the persistence adapter is isolated behind the `GameStore` boundary (ADR-006), and the realtime transport is Socket.IO today but could be replaced by another WebSocket implementation without changing command/event shapes (ADR-005). Replacing the language or workspace structure itself would require re-deriving every shared contract and is not expected before Version 1.

## Validation evidence

`apps/server` and `apps/client` build and type-check through `npm run check`; `apps/server/package.json` and `apps/client/package.json` pin the concrete dependency versions (Express 5, Socket.IO 4, React 19, Vite 6, Zod 3, TypeScript 5). `apps/server/test/game-store.test.ts` and the `packages/rules-5e` and `packages/schemas` test suites exercise the shared TypeScript contracts directly, without a browser.
