# ADR-0034: OpenAPI generated from the route registry

## Status

Accepted, 2026-10-18.

## Context and decision drivers

The OpenAPI document at `/api/v1/openapi.json` was half generated. Zod produced the components that had a
schema behind them, but `apps/server/src/openapi/document.ts` (about 3,200 lines) wrote every path, parameter,
security list and response by hand, and `descriptions.ts` (about 1,800 lines) held the prose for each field, keyed
by a dotted path into a schema. Each router declared its own request schemas beside them. Three copies of one route
drifted: seven mounted routes had no operation (the token image library, the map grid read and the map folder
rename), some operations named the wrong callers (the player-only commands offered a GM session and a scoped
credential, players were missing from the fight replays they can read), and a field's prose could outlive the field.

The drivers: one declaration per operation; a document that cannot claim what the server does not do; prose kept
beside the field it describes, where a rename carries it along; and a new route that is hard to add without its
documentation.

## Considered options

1. **Keep the hand-written document and test it harder.** More contract tests over `document.ts`. Every route
   would still be written twice, and the tests could only catch the drift they were written for.
2. **Generate the document from the Express routers.** Read the mounted routes and annotate the handlers. Express
   knows methods and paths, but nothing of bodies, answers or scopes, so the annotations become a second
   declaration in the routers.
3. **A route registry in the contract package, which both the routers and the document read.** Each operation is
   one Zod-typed declaration; the routers mount and parse from it, and the document is built from it alone.
4. **A third-party generator** (such as `zod-openapi` or `@asteasolutions/zod-to-openapi`). Each would add a
   dependency for what `z.toJSONSchema` already does, and its route format would still need the scope and
   role rules this API has.

## Decision

Option 3. `packages/api-contract/src/routes/` declares every HTTP operation with `defineRoute`: method, path,
operation id, tag, summary, description, access (public, a GM session, a player session, a paired screen, and the
integration scope), path and query parameters, the request body, and every answer by status, with examples where
they help. A game command's route is generated from its `defineCommand` entry and `GAME_COMMANDS`: the payload
schema without the keys the path supplies, the command's summary and description, and its `gmOnly` or
`playerOnly` rule. Socket-only envelopes stay where they were.

`packages/api-contract/src/openapi/` builds the OpenAPI 3.1 document from a list of routes. Every schema in it is
generated with `z.toJSONSchema`, and every description comes from a Zod `.describe()` or from the route. The
server builds the document once at startup from the registry and the command table (`apps/server/src/api-routes.ts`).
`routes/components.ts` names the components. A response's data must be named there, and the builder refuses a
route list that disagrees with itself: a duplicate operation id, a path parameter missing from `params`, two tags
on one path.

The routers mount with `mount(router, route, ...handlers)` and parse bodies, queries and parameters with the
route's schemas. The two Codex query strings with hand-written messages (`search` and `home`) keep their parsers,
and a test holds them to the registry's schemas.

## Consequences and tradeoffs

- `document.ts`, `descriptions.ts` and `game-commands.ts` under `apps/server/src/openapi/` are gone, and its
  `components.ts` moved to the registry. The prose moved onto the Zod schemas in `@vtt/domain`, `@vtt/schemas`, the
  SRD content package and the contract.
- The document now lists 297 paths and 335 operations; the seven missing ones are in it. Operation ids and paths are
  unchanged.
- The document is stricter about callers and answers: player-only commands offer only a player session; players
  may list the fight replays the GM shared and read a map's image; the servers entry is `/`, since every path
  already starts with `/api/v1`. A map's PATCH, scale and calibration-complete answers are their own
  `MapCatalogEntryData` component.
- A homebrew record on the wire is `HomebrewSavedRecord`: a body that matches its `HomebrewRecord` branch, or an
  unfinished draft with its `type`. The old document claimed every saved body was complete.
- `@vtt/api-contract` now depends on `@vtt/domain`, `@vtt/schemas` and the SRD content schemas through its
  `routes` and `schemas` entry points. Its root entry still depends only on Zod, so the client's imports are unchanged.
- Building the document takes about half a second at startup.

## Mobile, security, and visibility impact

No projection changed. The registry documents who may call each route, and the routers still check authorization
per request from the signed token. `credential-walk.test.ts` pins every route's answer to each kind of credential and
checks each 401 and 403 against the document. The document now lists the player-only commands as player-only, which
matches what the server already enforced.

## Migration / reversibility

Clients reading the document see the same paths and operation ids. A client that relied on the `servers` URL
`/api/v1` built doubled paths before; `/` is correct. Reverting means restoring the deleted files from git, which
would bring the drift back.

## Validation evidence

- `apps/server/test/api-routes.test.ts`: Express's own route table and the registry list the same routes; every
  documented example passes its schema; every read without path parameters answers each kind of caller (GM, player,
  scoped credential, none) with a documented status and body; a set of writes and the reads they make possible do
  too.
- `apps/server/test/codex-queries.test.ts`: the Codex search and home parsers accept and refuse what the documented
  schemas do.
- `apps/server/test/openapi-document.test.ts`, `openapi-components.test.ts`, `credential-walk.test.ts` and the
  per-surface HTTP tests read the generated document.
