<!-- Keep this short and honest. Delete any section that doesn't apply. -->

## Summary

<!-- What does this change do, and why? One or two sentences. -->

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] UX / UI
- [ ] Refactor / internal
- [ ] Docs / tooling

## What changed

<!-- The notable changes, by area: client / server / domain / api-contract / ui / content / docs. -->

## Screenshots / recordings

<!-- Required for any UI-affecting change: show it at a desktop width AND a narrow/touch viewport,
     and note the theme(s). Delete this section if the change isn't UI-facing. -->

## Verification

<!-- "Should work now" is not verification. State what you actually ran. -->

- [ ] `npm run check` green
- [ ] `npm run test` green
- [ ] `npm run build` green
- [ ] UI change: looked at it running (browser + narrow/touch viewport), cycled themes

Notes:

## Invariants (tick the ones this change touches)

- [ ] **Server authority** — no game decision (snapping, visibility, dice, turn order) moved to the client; no client input trusted for authorization.
- [ ] **Viewer safety** — the public table viewer exposes no GM-only combatants, hidden tokens, GM controls, or management metadata (re-checked any new field on a viewer projection).
- [ ] **Role boundaries** — a player acts only on their claimed character; GM-only commands stay gated per command.
- [ ] **Mobile parity** — works at a narrow viewport and with touch (no mouse-only control).
- [ ] **API parity** — any new game capability goes through the shared operations layer (both transports), and the served OpenAPI doc stays byte-identical to `@vtt/api-contract`.

## Docs / ledger

- [ ] Regenerated the generated docs if the contract or command surface changed — `npm run docs`
      (covers both `docs/app-map.md` and `docs/api-reference.md`).
- [ ] Updated `docs/ai-ledger/` **in place** if this was meaningful work — replaced what stopped
      being true rather than appending. Most PRs change nothing here.
- [ ] Deleted, rather than softened, any documentation claim this PR made false.
- [ ] If a check under `apps/server/test/docs-*.test.ts` went red, fixed the claim it named —
      did not delete, skip or weaken the check.

## Follow-ups / out of scope

<!-- Anything deliberately deferred. -->
