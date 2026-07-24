# Product vision

**Read this when:** scoping a new feature, deciding whether something is in scope, or
resolving a "should we build this?" question.

## What this is

A **private, LAN-hosted, combat-first D&D 5e virtual tabletop** for one trusted GM and a
small home group. Players join directly from a phone or laptop on the same LAN, claim a
character, and share one responsive combat experience. No accounts, no invitations, no
cloud service — trust comes from being on the same network, not from authentication.

## What matters most

The **core combat loop** is the product: upload a battlemap, calibrate the grid, run an
encounter with initiative/turns/rounds, place and move tokens with server authority, and
mirror a player-safe view to a second screen (a TV or tablet at the table). Everything
else is support for that loop.

## Scope boundaries (say no to these)

Not a character builder, not a campaign wiki, not a voice/video service, not a public or
multi-tenant SaaS, not a macro/scripting language, not a 3D tabletop. These boundaries
exist so the combat loop stays sharp instead of sprawling into a general-purpose VTT.

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
