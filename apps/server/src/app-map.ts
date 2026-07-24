import { GameStateSchema } from "@vtt/domain";
import { API_VERSION, GAME_COMMAND_SCOPES, REALTIME_PROTOCOL_VERSION, openApiDocument } from "@vtt/api-contract";

/**
 * Renders the always-fresh "app map" - a generated orientation aid for humans and AI agents. Pure:
 * it reads the live runtime sources of truth (the domain `GameState` schema, the api-contract
 * command/scope map, and the served OpenAPI document) and returns deterministic markdown. The
 * freshness test (`apps/server/test/app-map.test.ts`) fails whenever any of those surfaces changes
 * without regenerating via `npm run map`, so the doc can never silently drift from the code.
 *
 * It deliberately reports only machine-derivable surfaces plus a small curated file index; the
 * narrative "how it's built" lives in `docs/ai-context/` and is not duplicated here.
 */

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);

/** Command types grouped by their namespace (the segment before the first dot) for scannability. */
function namespaceOf(commandType: string): string {
  const dot = commandType.indexOf(".");
  return dot === -1 ? commandType : commandType.slice(0, dot);
}

export function renderAppMap(): string {
  const stateFields = Object.keys(GameStateSchema.shape).sort();
  const commands = Object.entries(GAME_COMMAND_SCOPES)
    .map(([type, scope]) => ({ type, scope: String(scope) }))
    .sort((a, b) => a.type.localeCompare(b.type));
  const namespaces = [...new Set(commands.map((command) => namespaceOf(command.type)))].sort();
  const httpPaths = Object.entries(openApiDocument.paths)
    .map(([path, item]) => ({
      path,
      methods: Object.keys(item as Record<string, unknown>).filter((key) => HTTP_METHODS.has(key)).map((method) => method.toUpperCase()).sort()
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const lines: string[] = [];
  lines.push("# App map (generated - do not edit by hand)");
  lines.push("");
  lines.push("Regenerate with `npm run map`. A freshness test (`apps/server/test/app-map.test.ts`) fails");
  lines.push("if this drifts from the code, so it is always current. This is an orientation aid: it maps the");
  lines.push("machine-derivable surfaces of the app (state shape, command catalog, HTTP paths) plus a curated");
  lines.push("file index. For narrative context read `CLAUDE.md`, `docs/ai-ledger/current-state.md`, and");
  lines.push("`docs/ai-context/`; the `vtt-orientation` skill routes you here first.");
  lines.push("");
  lines.push(`- API version \`${API_VERSION}\` · realtime protocol \`${REALTIME_PROTOCOL_VERSION}\``);
  lines.push(`- ${stateFields.length} GameState fields · ${commands.length} commands · ${httpPaths.length} HTTP paths`);
  lines.push("");

  lines.push("## GameState shape");
  lines.push("");
  lines.push("Top-level fields of the authoritative `GameState` (`packages/domain` `GameStateSchema`), the");
  lines.push("single JSON blob the server persists and projects per role.");
  lines.push("");
  for (const field of stateFields) lines.push(`- \`${field}\``);
  lines.push("");

  lines.push("## Commands");
  lines.push("");
  lines.push("The mutation surface shared by both transports (Socket.IO + HTTP `/api/v1`); each requires the");
  lines.push("listed integration scope (`GAME_COMMAND_SCOPES` in `packages/api-contract`). Adding one walks the");
  lines.push("pipeline: domain `ClientToServerEvents` -> `game-commands.ts` schema -> this map + an OpenAPI");
  lines.push("operation -> `game-operations.ts` handler + registry -> `server.ts` socket line -> `game-http.ts`");
  lines.push("route -> projection decision.");
  lines.push("");
  lines.push(`Namespaces: ${namespaces.map((namespace) => `\`${namespace}\``).join(", ")}.`);
  lines.push("");
  lines.push("| Command | Scope |");
  lines.push("| --- | --- |");
  for (const command of commands) lines.push(`| \`${command.type}\` | \`${command.scope}\` |`);
  lines.push("");

  lines.push("## HTTP surface");
  lines.push("");
  lines.push("Every path in the served OpenAPI document (`GET /api/v1/openapi.json`, byte-identical to");
  lines.push("`@vtt/api-contract`).");
  lines.push("");
  for (const entry of httpPaths) lines.push(`- \`${entry.methods.join(" ")} ${entry.path}\``);
  lines.push("");

  lines.push("## Where things live");
  lines.push("");
  lines.push("Curated pointers (verify line numbers before relying on them - code moves):");
  lines.push("");
  lines.push("- **Wire contract (single source):** `packages/domain/src/index.ts` - `GameState`, projections (`PlayerView`/`GmView`), `ClientToServerEvents`/`ServerToClientEvents`.");
  lines.push("- **Persisted/importable schemas:** `packages/schemas/src/index.ts` - `Actor`, `ActorDefinition`.");
  lines.push("- **Command Zod schemas:** `apps/server/src/game-commands.ts`.");
  lines.push("- **Command handlers + registry:** `apps/server/src/game-operations.ts`.");
  lines.push("- **Scopes + OpenAPI:** `packages/api-contract/src/index.ts`.");
  lines.push("- **Projections (GM/player security boundary):** `apps/server/src/projections.ts`.");
  lines.push("- **Public viewer projection:** `apps/server/src/viewer-encounter.ts`, `viewer-presentation.ts`.");
  lines.push("- **Persistence (SQLite):** `apps/server/src/game-store.ts`.");
  lines.push("- **Rules engine:** `apps/server/src/{action-resolution,saving-throws,hit-points,rests,condition-rules}.ts`.");
  lines.push("- **Shared 5e math:** `packages/rules-5e/src/{dice,combat,character}.ts`.");
  lines.push("- **SRD content bundles:** `packages/content-srd-5.2.1`.");
  lines.push("- **Client entry points:** `apps/client/src/{main,viewer-main,styleguide-main}.tsx`.");
  lines.push("- **Design system:** `packages/ui/src/index.ts` (+ the `/styleguide` route).");
  lines.push("");

  return lines.join("\n");
}
