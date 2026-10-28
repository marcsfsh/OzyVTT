# CLAUDE.md

OzyVTT is a private, LAN-hosted D&D 5e virtual tabletop and worldbuilding Codex for one GM and a
small home group. `docs/ARCHITECTURE.md` explains how it fits together: read the section for the
area you change. `docs/DESIGN.md` holds the UI and writing rules.

## Commands

Node 24+. Run from the repo root.

| Command           | What it does                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`     | Client on `:5173`, server on `:3001`.                                                        |
| `npm run check`   | Typecheck every workspace and the smoke suite.                                               |
| `npm test`        | All tests. One file: `npm test --workspace=@vtt/server -- <name>`.                           |
| `npm run lint`    | ESLint.                                                                                      |
| `npm run format`  | Prettier. CI runs `npm run format:check`; a hook formats each file Claude edits.             |
| `npm run build`   | Build the client.                                                                            |
| `npm run smoke`   | Browser journeys at a 390px phone and a 1280px laptop against the built client. Build first. |
| `npm run map`     | Regenerate `docs/app-map.md`, `docs/srd-coverage.md` and the actor JSON Schema.              |
| `npm run content` | Rebuild the SRD content bundles from their sources.                                          |

## Invariants

1. **The server decides.** Dice, snapping, turn order, visibility and rules checks happen on the
   server. Never move a game decision to the client or trust client input for authorization.
2. **Projections are the security boundary.** Players, the table viewer and the Codex player view
   each get a projection built for them. A new field that reaches any of them is a security change:
   include it only if everything it carries is already public to that audience.
   `.claude/rules/projections.md` loads with those files.
3. **Players act only on their own character.** The GM may act on anything. Authorization is
   checked per command from the signed token.
4. **Phones are first-class.** UI changes must work at 390px wide with touch.

## Gotchas

- After changing `GameState`, a command, an HTTP route, the actor schema or the rules, run
  `npm run map`: a test fails while its output is stale. To find a command's scope, an HTTP path or
  a state field, grep `docs/app-map.md`.
- `apps/server/data/` (or `DATA_DIR`) holds the GM's live campaign and password hash. It is
  git-ignored and has no other copy, so never delete or reset it. Tests and the smoke suite use
  temporary directories.
- A schema change is a new numbered migration in the owning store. Never edit a shipped migration:
  tests start from empty databases, so they pass while every existing campaign breaks.
- The GM hosts on Windows with `npm run start`, or in Docker. Keep scripts and paths portable: no
  POSIX-only shell syntax or inline `VAR=value` in npm scripts, `node:path` for file paths, and no
  two file names that differ only in case. A new package the server imports at runtime also needs
  its `COPY` lines in the `Dockerfile`.
- Copy, server messages, OpenAPI descriptions and code comments follow the Writing section of
  `docs/DESIGN.md`. `apps/client/src/writing.test.ts` checks what a pattern can find.

## Working here

- Before calling work done, run `npm run lint`, `npm run check` and `npm test`. For UI changes also
  run `npm run build` and `npm run smoke`, and look at it at phone and laptop widths (the `verify`
  skill has the steps). Say what you ran and what you saw.
- Comments say why the code is the way it is, in a line or two, with no ticket IDs. History belongs
  in git; plans, bugs and the roadmap belong in GitHub issues.
- When docs and code disagree, fix the doc in the same change.
- Motion is Light rail (ADR-0045). Its plan and approved mockup are in `docs/design/light-rail/`; port the mockup's
  numbers and ideas, not its files.
- Commit messages are a short subject and, if needed, a few lines of body.
