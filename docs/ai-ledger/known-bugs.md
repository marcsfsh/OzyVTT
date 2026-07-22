# Known bugs & gaps

**Read this when:** starting work in an area, or before claiming something is "done" —
check you're not re-discovering a known issue or tripping a known gap. Add entries as you
find them; remove them when fixed (note the fix in `session-summary.md`).

Format: `[area] — description — suspected cause / status`.

_Last seeded: 2026-07-17. Seeded from code survey + BUILD_PLAN gaps; not yet a live triage._

## Known gaps

- **[ux] ~~Maps/scenes/encounter IA redesign~~ — RESOLVED 2026-07-22 (scene-centric IA, this PR).**
  The upload → browse → prepare → start experience was rethought scene-first: a new **Scenes** hub tab
  is the prep home (a gallery of scene cards — thumbnail, LIVE/staging badge, go-live, private staging,
  duplicate, drag-reorder, rename, remove); the standalone **Map Setup tab was retired** (its library +
  3×3 calibration fold into the hub via "Manage maps"); **going live also presents the scene's map to
  the shared screen**; and the Encounter tab starts combat on the live scene's map. See
  `docs/product/scene-centric-ia.md` and `session-summary.md` (2026-07-22). Remaining polish (not
  blocking): persisted server thumbnails; the Encounter quick-switch strip could slim further; a
  physical touch-device pass.

- **[mobile] No physical iOS/Android acceptance pass yet** — responsive layout + Pointer
  Events are built and parity is mandated (ADR-0014), but real-device acceptance and a
  degraded-browser fallback UI do not exist. `BUILD_PLAN` GAP-001. Don't claim device
  coverage you haven't actually run.
- **[api] ~~Public API drift~~ — closed 2026-07-18 (PR F on `claude/open-api-core-m75t9d`).**
  EVERY game command is now reachable over `/api/v1` (see `current-state.md`) — combat core plus
  scenes, character claims, token cosmetics, and HTTP player-session issuance. Nothing is
  socket-only anymore; Socket.IO remains the push channel, HTTP the pull/command channel.
- **[api] Credential `gameId` binding is dead plumbing** — `CreateIntegrationCredentialRequest`
  accepts a `gameId`, and `IntegrationCredentialStore.verify` enforces it, but no caller ever
  passes a `gameId` through (`api-v1.ts` / `game-http.ts` wiring), so a credential minted with a
  non-null `gameId` is permanently unusable (generic 403) and `rotate` can't clear it. Predates
  the game API; harmless while everyone leaves it null (this is a single-game product). Either
  thread a real game id through verification or drop the field in a future contract pass.
  Found by architecture review 2026-07-18. **Mitigated 2026-07-18:** the VTT Setup credential
  form no longer offers the field, so the footgun is API-only; the contract keeps accepting it
  for now.

## Gotchas that look like bugs (but aren't)

- **[build] Stale `tsbuildinfo` can mask type errors** — web `check`/`build` are incremental
  (`tsc -b`); a clean `npm run build` resolves confusing results.
- **[auth] Player tokens are not revocable** — only GM sessions have logout/revoke-all; a
  30-day player token stays valid by design. Losing `data/auth.json` or browser storage
  loses GM access/claims with no reset (needs host access).
- **[viewer] Pairing codes are in-memory + single-use** — lost on server restart by design;
  a paired display keeps its persisted token, but new pairings must be re-minted.
- **[maps] Live drag preview can briefly differ from saved geometry** — the client preview
  mirrors server snapping but the server is authoritative; ephemeral annotations
  (measurements ~5s, pings ~4s) rely on a re-broadcast at expiry to resync the viewer.

## How to use this file

Real defects go under **Known gaps** with a suspected cause. If something is working as
designed but surprising, it belongs under **Gotchas** so nobody "fixes" it by accident.
