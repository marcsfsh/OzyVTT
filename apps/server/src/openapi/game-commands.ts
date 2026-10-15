import type { z } from "zod";
import { GAME_COMMANDS, type GameCommandType, type IntegrationScope } from "@vtt/api-contract";
import { gameCommands } from "../commands/index.js";

export type JsonSchema = { properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown };

const apiError = { $ref: "#/components/responses/ApiError" } as const;

/** Accepted principals: an integration credential with the given scope, or a GM session, as HTTP bearer tokens. */
export const gameSecurity = (scope: IntegrationScope) => [{ bearerAuth: [scope] }, { gmAuth: [] }];
/** Operations a player session can use (within its own-character limits) also list playerAuth. */
export const gameSecurityWithPlayer = (scope: IntegrationScope) => [
  { bearerAuth: [scope] },
  { gmAuth: [] },
  { playerAuth: [] }
];

export const mutationResponses = {
  "200": {
    description: "Command accepted, or replayed idempotently (`duplicate: true`) for a commandId already processed",
    content: { "application/json": { schema: { $ref: "#/components/schemas/GameMutationAcceptedResponse" } } }
  },
  "400": apiError,
  "401": apiError,
  "403": apiError,
  "409": {
    description:
      "Rejected by the game rules, a stale expectedRevision (`error.currentRevision` set), or a timeline navigation needing GM confirmation (`error.details.needsConfirm`)",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ApiErrorEnvelope" } } }
  }
} as const;

/** Commands whose reply carries more than the mutation acknowledgement, documented with their own schema. */
const RICHER_REPLIES: Partial<Record<GameCommandType, Readonly<{ schema: string; description: string }>>> = {
  "replay.launch": {
    schema: "EncounterArchiveLaunchResponse",
    description: "The launched scene and the cloned combatants"
  }
};

const pathNames = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);

/** The request body component a command's typed HTTP route documents. */
const bodyName = (operationId: string) => `${operationId[0]!.toUpperCase()}${operationId.slice(1)}Request`;

/** Each command's payload schema under its request body's component name, for the shared generator. */
export const commandBodySchemas = (): ReadonlyArray<readonly [string, z.ZodType]> =>
  gameCommands.map((command) => [bodyName(command.operationId), command.schema] as const);

/**
 * Every game command's typed HTTP operation, and its request body trimmed from the payload's generated schema.
 * Over HTTP the `commandId` is optional (the server mints one) and path parameters are taken out of the body.
 */
export function gameCommandDocs(generated: Readonly<Record<string, JsonSchema>>) {
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas: Record<string, JsonSchema> = {};
  for (const command of gameCommands) {
    const route = GAME_COMMANDS[command.type];
    const names = pathNames(route.path);
    // The payload keys the path supplies, which `pathParams` may rename.
    const fromPath = command.pathParams
      ? Object.keys(command.pathParams(Object.fromEntries(names.map((name) => [name, ""]))))
      : names;
    const name = bodyName(command.operationId);
    const payload = generated[name]!;
    const properties = Object.fromEntries(
      Object.entries(payload.properties ?? {}).filter(([key]) => !fromPath.includes(key))
    );
    const required = (payload.required ?? []).filter((key) => key !== "commandId" && !fromPath.includes(key));
    schemas[name] = { ...payload, properties, required };
    const parameters = names.map((parameter, index) => ({
      name: parameter,
      in: "path",
      required: true,
      schema: payload.properties?.[fromPath[index] ?? parameter] ?? { type: "string" }
    }));
    const richer = RICHER_REPLIES[command.type];
    paths[route.path] = {
      ...paths[route.path],
      [route.method]: {
        operationId: command.operationId,
        description: command.description,
        security: command.gmOnly ? gameSecurity(route.scope) : gameSecurityWithPlayer(route.scope),
        ...(parameters.length > 0 ? { parameters } : {}),
        requestBody: {
          // A body that only carries the optional commandId and expectedRevision may be left out.
          required: required.length > 0,
          content: { "application/json": { schema: { $ref: `#/components/schemas/${name}` } } }
        },
        responses: richer
          ? {
              ...mutationResponses,
              "200": {
                description: richer.description,
                content: { "application/json": { schema: { $ref: `#/components/schemas/${richer.schema}` } } }
              },
              "404": apiError
            }
          : mutationResponses
      }
    };
  }
  return { paths, schemas };
}
