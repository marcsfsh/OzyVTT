# CLAUDE.md

OzyVTT is a private, LAN-hosted D&D 5e virtual tabletop and worldbuilding Codex for one GM and a
small home group. Read `README.md` for what it does and `docs/ARCHITECTURE.md` for how it works.
UI work follows `docs/DESIGN.md`. `docs/app-map.md` is a generated index of state, commands and
HTTP paths.

## Commands

Node 24+. Run from the repo root.

| Command           | What it does                                               |
| ----------------- | ---------------------------------------------------------- |
| `npm run dev`     | Client on `:5173`, server on `:3001`.                      |
| `npm run check`   | Typecheck every workspace.                                 |
| `npm test`        | All tests.                                                 |
| `npm run build`   | Build the client.                                          |
| `npm run map`     | Regenerate `docs/app-map.md`; a test fails if it is stale. |
| `npm run content` | Rebuild the SRD content bundles from their sources.        |
| `npm run lint`    | ESLint.                                                    |
| `npm run format`  | Prettier; CI runs `npm run format:check`.                  |

## Invariants

1. **The server decides.** Dice, snapping, turn order, visibility and rules checks happen on the
   server. Never move a game decision to the client or trust client input for authorization.
2. **Projections are the security boundary.** Players, the table viewer and the Codex player
   view each get a projection built for them (`projections.ts`, `viewer-*.ts`,
   `codex-projections.ts`). A new field that reaches any of them is a security change: include
   it only if everything it carries is already public to that audience. When in doubt, omit it.
3. **Players act only on their own character.** The GM may act on anything. Authorization is
   checked per command from the signed token.
4. **Phones are first-class.** UI changes must work at 390px wide with touch.

## Working here

- Verify for real: run `npm run lint`, `npm run check` and `npm test`, and for UI changes look at it running at
  phone and laptop widths. Say what you ran and what you saw.
- Comments explain why the code is the way it is, in a line or two. History belongs in git;
  plans, bugs and the roadmap belong in GitHub issues. Don't put ticket IDs in code.
- Keep commit messages short: a subject line and, if needed, a few lines of body.
- When docs and code disagree, fix the doc in the same change.
