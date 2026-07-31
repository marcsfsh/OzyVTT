# Product vision

**Read this when:** scoping a new feature, deciding whether something is in scope, or
resolving a "should we build this?" question.

## What this is

A private, LAN-hosted D&D 5e virtual tabletop **and worldbuilding platform** for one trusted
GM and a small home group. Two first-class pillars:

1. **A combat-first table.** Players join directly from a phone or laptop on the same LAN,
   claim a character, and share one responsive combat experience.
2. **A worldbuilding Codex.** A typed-entity wiki (characters, locations, factions, items,
   …), an interactive atlas, a campaign journal and timeline, and a fantasy calendar — all
   two-layer (player-facing + GM-secret) and viewer-safe.

No accounts, no invitations, no cloud service — trust comes from being on the same network,
not from authentication.

## What matters most

The **core combat loop** is the product's first pillar: upload a battlemap, calibrate the
grid, run an encounter with initiative/turns/rounds, place and move tokens with server
authority, and mirror a player-safe view to a second screen (a TV or tablet at the table).

The **Codex** is the second, and it is a real worldbuilding tool (World Anvil / Kanka /
LegendKeeper class) rather than a notes pane — bounded to a single home group. It is not
support for the combat loop and is not subordinate to it; the two share a shell, a design
language, and the viewer-safety and role rules, and are otherwise independent.

Combat stays combat-first (favour the obvious GM action over another settings knob).

## Scope boundaries (say no to these)

Not a character *builder yet* (an interactive play sheet ships now; the guided builder is a
roadmap item — ADR-0021), not a voice/video service, not a public or multi-tenant SaaS, not
a macro/scripting language, not a 3D tabletop.

**"Not a campaign wiki" was a boundary and is no longer one.** The owner reversed it on
2026-07-24 (see `docs/ai-ledger/decision-log.md`) and the worldbuilding Codex is now a core
pillar, as CLAUDE.md has stated since. This section said otherwise for a week; the
contradiction is recorded rather than quietly deleted, because a scope boundary that turns
out to be wrong is exactly the kind of thing a later reader needs to be able to date.

These boundaries exist so the two pillars stay sharp instead of sprawling into a
general-purpose VTT.

When a request pushes on a boundary, name the boundary and offer the in-scope version of
what the user actually needs.

## Deployment shape

One LAN service. `npm run start` builds and serves the whole thing on `:3001`; players
join at `http://HOST-IP:3001`. Direct LAN HTTP is a trusted-LAN mode — never
port-forwarded; external access goes through a VPN or TLS reverse proxy. `data/` holds
local campaign data and is git-ignored.

## Roadmap pointers

`BUILD_PLAN.md` is the full roadmap; `README.md` describes the current milestone;
`docs/ai-ledger/current-state.md` tracks near-term work. Phase 2 (testing-MVP vertical slice) is under
active implementation; no phase exit gate has been claimed yet.
