# CLAUDE.md

Constitutional index for working on this repo. Keep it short and stable — this
file is loaded into every session, so it holds only permanent rules and pointers,
not project detail. Detail lives in `docs/ai-context/` (how the app is built) and
`docs/ai-ledger/` (what exists now / what's decided). Read those on demand; do not
paste them here.

## Product identity

A private, LAN-hosted **D&D 5e virtual tabletop _and_ worldbuilding platform** for one
trusted GM and a small home group. Two first-class pillars: (1) a **combat-first** table —
players join from a phone or laptop, claim a character, and share the same responsive combat
experience; and (2) a **worldbuilding Codex** — a typed-entity wiki (characters, locations,
factions, items, …), an interactive atlas, a campaign journal/timeline, and a fantasy calendar,
all two-layer (player-facing + GM-secret) and viewer-safe. No accounts, no cloud, no public SaaS.

Design philosophy: **"just works," everything needed and nothing unnecessary.** Combat stays
combat-first (favor the obvious GM action over another settings knob); the Codex is a real
worldbuilding tool (World Anvil / Kanka / LegendKeeper class) but bounded to a single home group.

**Scope boundaries (do not drift into these):** not a character *builder yet* (an interactive
play sheet ships now; the guided builder is a roadmap update — ADR-0021), voice/video service,
public/multi-tenant SaaS, macro language, or 3D tabletop. (The worldbuilding wiki was formerly
out of scope; it is now a core pillar — see decision-log 2026-07-24.)

## Commands

Node.js **24+** required.

| Command | What it does |
| --- | --- |
| `npm install` | Install workspace deps. |
| `npm run dev` | Client on `:5173` + authoritative server (dev API `:3001`). |
| `npm run check` | Per-workspace typecheck (`tsc --noEmit`). Run before calling work done. |
| `npm run test` | Per-workspace tests. |
| `npm run build` | Build all workspaces. |
| `npm run start` | Build, then run the single LAN service on `:3001`. |

Monorepo layout (see `docs/ai-context/architecture.md` for detail):
`apps/client` (React/Vite), `apps/server` (Express + Socket.IO, authoritative),
`packages/{domain,rules-5e,schemas,api-contract,ui,content-srd-5.2.1,test-fixtures}`.

## Non-negotiable rules

1. **Branch safety.** Confirm the current branch and intended scope before major
   edits. Never edit, rebase, or force-push another agent's `claude/*` branch, and
   don't expand a task into unrelated refactors. See `vtt-branch-safety`.
2. **Server authority.** The server owns `GameState`. Never move a game decision
   (snapping, visibility, dice, turn order) to the client, and never trust client
   input for authorization.
3. **Viewer safety.** The public table viewer must never expose GM-only combatants,
   hidden tokens, GM controls, or management metadata. Treat this as a hard
   invariant on any change touching projections or the viewer. See
   `docs/ai-context/viewer-mode.md`.
4. **Role boundaries.** A player may act only on their claimed character; the GM may
   act on anything. See `docs/ai-context/auth-roles.md`.
5. **Mobile parity.** Phone and laptop are first-class. UI-affecting changes must
   work at a narrow viewport and with touch. See `docs/ai-context/mobile-ux.md`.
6. **Real verification.** "Should work now" is not verification. State what you ran
   (`npm run check` / `npm run test`, and the browser/mobile check when UI changed).

## Where context lives — read only what the task touches

`docs/ai-context/` (how it's built):
`product-vision.md` · `ux-principles.md` · `architecture.md` · `map-grid.md` ·
`viewer-mode.md` · `mobile-ux.md` · `realtime.md` · `auth-roles.md` · `testing.md` ·
`design-language.md`

`docs/ai-ledger/` (living state — read at session start, update after real work):
`current-state.md` · `decision-log.md` · `known-bugs.md` · `session-summary.md`

Durable decisions and roadmap: `docs/adr/`, `docs/product/`, `BUILD_PLAN.md`.
**For a task, read 2-4 relevant files, not the whole tree.**

## How to work

- **Meaningful work** (new feature, UX change, architecture, bug cluster, multi-file):
  brief it as a task packet first → inspect existing code before adding structure →
  implement bounded to the packet → verify for real → update the ledger.
- **Small work** (copy tweak, one-line fix, small CSS): just do it, verify, one-line
  summary. Don't ceremony-tax trivial changes.
- **Risky work** (destructive commands, broad deletes, branch changes, auth/viewer/
  realtime): slow down, confirm scope, keep it reversible.

The skill system that supports this workflow (task packets, context routing, QA,
ledger updates, scheduling) lives in `.claude/`. See **`.claude/README.md`** for the current
roster of skills, subagents, path-scoped rules, and hooks (design rationale in
`docs/claude-code-tooling-outline.md`). Use a skill when its trigger matches; don't force it.

Lightweight hooks in `.claude/settings.json` enforce a few of these rules
automatically (destructive-command guard, sensitive-area reminders, a
completion-hygiene nudge) — see `.claude/hooks/README.md`. They fail open and are
not a substitute for the judgment above.
