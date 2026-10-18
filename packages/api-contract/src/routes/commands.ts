import { z } from "zod";
import { API_NAMESPACE, GAME_COMMANDS, GameMutationAcceptedSchema, type GameCommandType } from "../index.js";
import { defineRoute, json, ok, refused, type Access, type ApiRoute } from "./define.js";
import { GAME_CONFLICT } from "./game.js";

/**
 * A game command's typed HTTP route, generated from its definition in the server's command table (`defineCommand`)
 * and its route and scope in `GAME_COMMANDS`. The JSON body is the command's payload without the keys the path
 * supplies, and with `commandId` optional: the server mints one when it is left out.
 */

/** What the route needs from a command's definition. */
export type CommandDefinition = Readonly<{
  type: GameCommandType;
  operationId: string;
  summary: string;
  description: string;
  /** The payload schema both transports parse. */
  schema: z.ZodType;
  gmOnly?: string;
  playerOnly?: string;
  pathParams?: (params: Readonly<Record<string, string>>) => Record<string, unknown>;
  /** A reply richer than the mutation acknowledgement. */
  reply?: Readonly<{ schema: z.ZodType; description: string }>;
}>;

const HttpCommandIdSchema = z
  .uuid()
  .optional()
  .describe("The command's idempotency key. Leave it out to have one minted; send the same one again to retry safely.");

const pathNames = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);

/** The object under a payload's refinements. */
function payloadObject(schema: z.ZodType): z.ZodObject {
  let current: z.ZodType = schema;
  for (let depth = 0; depth < 4 && !(current instanceof z.ZodObject); depth += 1)
    current = (current.def as { in?: z.ZodType }).in ?? current;
  if (!(current instanceof z.ZodObject)) throw new Error("A command's payload must be an object.");
  return current;
}

export function gameCommandRoute(command: CommandDefinition): ApiRoute {
  const route = GAME_COMMANDS[command.type];
  const payload = payloadObject(command.schema);
  const names = pathNames(route.path);
  // The payload keys the path supplies, which `pathParams` may rename.
  const supplied = command.pathParams
    ? Object.keys(command.pathParams(Object.fromEntries(names.map((name) => [name, "1"]))))
    : names;
  const params = Object.fromEntries(
    names.map((name, index) => {
      const key = supplied[index] ?? name;
      const schema = payload.shape[key] as z.ZodType | undefined;
      if (!schema) throw new Error(`${command.type}: its payload has no ${key} for the path's {${name}}.`);
      return [name, schema];
    })
  );
  const shape = Object.fromEntries(
    Object.entries(payload.shape)
      .filter(([key]) => !supplied.includes(key))
      .map(([key, schema]) => [key, key === "commandId" ? HttpCommandIdSchema : (schema as z.ZodType)])
  );
  const strict = (payload.def.catchall as z.ZodType | undefined)?.def.type === "never";
  const body = strict ? z.strictObject(shape) : z.object(shape);
  // Zod's own test for a required key, as the document's `required` lists it.
  const required = Object.values(shape).some((schema) => schema._zod.optin !== "optional");
  const access: Access = command.playerOnly
    ? { player: true }
    : command.gmOnly
      ? { gm: true, scope: route.scope }
      : { gm: true, player: true, scope: route.scope };
  return defineRoute({
    method: route.method,
    path: route.path,
    operationId: command.operationId,
    tag: route.path.startsWith(`${API_NAMESPACE}/encounters`) ? "Fight replays" : "Live game",
    summary: command.summary.replace(/\.$/, ""),
    description: command.description,
    access,
    ...(names.length > 0 ? { params: z.object(params) } : {}),
    body: json(body, { required }),
    responses: {
      200: command.reply
        ? ok(command.reply.schema, command.reply.description)
        : ok(
            GameMutationAcceptedSchema,
            "The command ran, or a resent `commandId` replayed its outcome with `duplicate: true`."
          ),
      400: refused(),
      401: refused(),
      403: refused(),
      409: refused(GAME_CONFLICT)
    }
  });
}
