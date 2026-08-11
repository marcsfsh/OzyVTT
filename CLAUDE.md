# CLAUDE.md

Constitutional index. This file loads into **every** session, so it holds only permanent
rules and pointers — never project detail, never an inventory. Detail lives in
`docs/ai-context/` (how it's built) and `docs/ai-ledger/` (what exists now). Read those on
demand; do not paste them here.

## Product identity

A private, LAN-hosted **D&D 5e virtual tabletop _and_ worldbuilding platform** for one
trusted GM and a small home group. Two first-class pillars: (1) a **combat-first table** —
players join from a phone or laptop, claim a character, and share one responsive combat
experience; and (2) a **worldbuilding Codex** — a typed-entity wiki, atlas, journal,
quests/sessions and fantasy calendar, all two-layer (player-facing + GM-secret).
No accounts, no cloud, no public SaaS.

Design philosophy: **"just works," everything needed and nothing unnecessary.** Favor the
obvious action over another settings knob.

**Scope boundaries (say no to these):** not a voice/video service, not a public or
multi-tenant SaaS, not a macro/scripting language, not a 3D tabletop. Boundaries change:
when one does, date the reversal in `docs/ai-ledger/decision-log.md` rather than quietly
editing it away.

## Commands

Node.js **24+** required. Run from the repo root.

| Command | What it does |
| --- | --- |
| `npm install` | Install workspace deps. |
| `npm run dev` | Client on `:5173` + authoritative server (dev API `:3001`). |
| `npm run check` | Typecheck every workspace that has a `check` script. Run before calling work done. |
| `npm run test` | Vitest, every workspace that has a `test` script. |
| `npm run build` | Build every workspace that has a `build` script (the client and the server; packages are consumed as TS sources). |
| `npm run start` | Build, then run the single LAN service on `:3001`. |
| `npm run docs` | Regenerate `docs/app-map.md`, `docs/api-reference.md` **and** `docs/product/vocabulary-parity-audit.md`. Required after any state/command/HTTP/OpenAPI or homebrew-form change — a test fails otherwise. |
| `npm run map` | Regenerate `docs/app-map.md` alone — the faster half of `npm run docs`. |

Workspaces are `apps/*` and `packages/*`: `apps/client` (the React/Vite UI) · `apps/server`
(the authoritative Express + Socket.IO service) ·
`packages/{api-contract,content-srd-5.2.1,dndbeyond-pdf,domain,rules-5e,schemas,test-fixtures,ui}`.
`package.json` `workspaces` is the source of truth and a test holds this line to it.
`docs/app-map.md` is generated and always current — start there.

## Non-negotiable rules

1. **Branch safety.** Confirm the current branch and intended scope before major edits.
   Never edit, rebase, or force-push another agent's `claude/*` branch, and don't expand a
   task into unrelated refactors. See `vtt-branch-safety`.
2. **Server authority.** The server owns authoritative state and every game decision —
   snapping, visibility, dice, turn order, what is revealed. Never move one to the client;
   never trust client input for authorization.
3. **Projection is the security boundary.** A recipient gets a projection computed for
   their role, never filtered state. This is the hardest invariant in the repo and it has
   two enforcement points: `apps/server/src/projections.ts` + `viewer-*.ts` for the table
   and the public screen (`docs/ai-context/viewer-mode.md`), and
   `apps/server/src/codex-projections.ts` for the Codex (`docs/ai-context/codex.md`).
   Adding a field to either is a viewer-safety change. When in doubt, omit it.
4. **Role boundaries.** A player may act only on their claimed character; the GM may act on
   anything. See `docs/ai-context/auth-roles.md`.
5. **Mobile parity.** Phone and laptop are first-class. UI-affecting changes must work at a
   narrow viewport and with touch. See `docs/ai-context/mobile-ux.md`.
6. **Real verification.** "Should work now" is not verification. State the commands you ran
   and what you observed. `docs/ai-context/testing.md` defines the bar.

## Where context lives

- **Read at session start:** this file and `docs/ai-ledger/current-state.md` (what ships
  today, what's in flight, what's broken). Nothing else.
- **`docs/ai-context/`** — one brief per subsystem: invariants and pointers into code, not
  restated code. Use `vtt-context-router` to pick the 2-4 that apply; don't read the tree.
- **`docs/ai-ledger/`** — `known-bugs.md`, `decision-log.md` on demand; history in `docs/archive/`.
- **`docs/adr/`**, **`docs/product/`**, **`BUILD_PLAN.md`** — durable decisions and roadmap.
- **`docs/app-map.md`** and **`docs/api-reference.md`** are generated and freshness-tested.
  Never hand-edit either; regenerate with the commands above.

## How to work

- **Meaningful work** (new feature, UX change, architecture, bug cluster, multi-file):
  brief it as a task packet → inspect existing code before adding structure → implement
  bounded to the packet → verify for real → update the ledger.
- **Small work** (copy tweak, one-line fix, small CSS): just do it, verify, one-line
  summary. Don't ceremony-tax trivial changes.
- **Risky work** (destructive commands, broad deletes, branch changes, auth/viewer/codex/
  realtime): slow down, confirm scope, keep it reversible.

## Keeping the docs true

Where a document and the code disagree, **the code is truth and the document is a defect**. Fix
or delete the claim in the same change; update documents **in place**.

**Some documentation truth is a test — know which.** `apps/server/test/docs-{paths,commands,ledger,tooling,viewer-safety}.test.ts`
fail when a claim stops being true, each naming its own fix; fix the claim, never skip one to go green.
**The guarantee is narrower than "the docs are checked":** every *path* in all 92 live documents resolves,
but *claims* are checked in six only — `CLAUDE.md`, `current-state.md`, `known-bugs.md`, `viewer-mode.md`, `.claude/README.md`, the router.

`.claude/` holds the skills, subagents, path-scoped rules and hooks that support this workflow
— see **`.claude/README.md`** for the roster. Use a skill when its trigger matches; don't force
it. The hooks in `.claude/settings.json` fail open and are not a substitute for the judgment above.
