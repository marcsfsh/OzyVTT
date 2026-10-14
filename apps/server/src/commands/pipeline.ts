import type { z } from "zod";
import type { GameCommandType, IntegrationScope } from "@vtt/api-contract";
import type { ClientToServerEvents, GameState } from "@vtt/domain";
import { GameAccessDeniedError } from "../authorization.js";
import type { GameStore, TimelineOps } from "../game-store.js";
import { GameInputError } from "./failures.js";
import { isGmGrade, principalTag, type CommandContext, type GamePrincipal, type Kit } from "./kit.js";

/** A command's reply: the accepted revision and idempotent-duplicate flag, plus whatever the command adds. */
export type GameReply = Readonly<Record<string, unknown>>;

/** The store's answer to one write: the state after it, and whether the commandId had already run. */
export type Committed = Readonly<{ state: GameState; duplicate: boolean }>;

/** Journal fields a command may set itself; the rest come from the request. */
type JournalOverrides = Readonly<{ actorId?: string; type?: string }>;

export type CommandCall<Request> = Readonly<{
  principal: GamePrincipal;
  request: Request;
  /** `store.execute` under this command's journal header. The committed state is published before this
   *  returns, unless the commandId had already run. */
  execute: (mutate: (state: GameState) => void, journal?: JournalOverrides) => Promise<Committed>;
  /** As `execute`, for a command that reads or rewrites the turn timeline. */
  executeTimeline: (
    plan: (state: GameState, timeline: TimelineOps) => void,
    journal?: JournalOverrides
  ) => Promise<Committed>;
  /** Runs another command under the same principal, through the same pipeline. */
  dispatch: (type: GameCommandType, payload: unknown) => Promise<GameReply>;
}>;

export type CommandSpec<Schema extends z.ZodTypeAny> = Readonly<{
  type: GameCommandType;
  /** One line for the command catalog (`GET /game/commands`). */
  summary: string;
  schema: Schema;
  /** The refusal for a payload the schema rejects. */
  malformed: string;
  /** Answer a malformed payload with the schema's first issue instead (its refinements explain the problem). */
  issueMessage?: true;
  /** Refuse a player before the payload is read; the string is the refusal. */
  gmOnly?: string;
  /** Refuse a GM-grade principal before the payload is read; the string is the refusal. */
  playerOnly?: string;
  /** Maps typed-route path parameters into the payload; by default each joins under its own name. */
  pathParams?: (params: Readonly<Record<string, string>>) => Record<string, unknown>;
  /** The command itself. Whatever it returns is added to the reply after the revision and duplicate flag. */
  run(call: CommandCall<z.output<Schema>>, kit: Kit): Promise<GameReply | void>;
}>;
export type AnyCommand = CommandSpec<z.ZodTypeAny>;

export function defineCommand<Schema extends z.ZodTypeAny>(spec: CommandSpec<Schema>): AnyCommand {
  return spec;
}

/** A read served to the socket under `event` and over HTTP as `GET path`. */
export type ReadSpec = Readonly<{
  event: keyof ClientToServerEvents;
  path: string;
  scope: IntegrationScope;
  gmOnly?: string;
  /** Validates the input; absent, the read takes none. */
  schema?: z.ZodTypeAny;
  malformed?: string;
  /** The read's input from an HTTP request: its path parameters unless given. */
  httpInput?: (request: Readonly<{ params: Record<string, string>; query: Record<string, unknown> }>) => unknown;
  run(principal: GamePrincipal, input: unknown, kit: Kit): GameReply;
}>;

/** Socket.IO event names are the command type with its first `.` as `:`. */
export type SocketEventOf<Type extends string> = Type extends `${infer Area}.${infer Name}` ? `${Area}:${Name}` : never;
export function socketEventOf<Type extends GameCommandType>(type: Type) {
  return type.replace(".", ":") as SocketEventOf<Type>;
}

export function parse<Schema extends z.ZodTypeAny>(
  schema: Schema,
  raw: unknown,
  malformedMessage: string,
  preferIssueMessage = false
): z.output<Schema> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
  const message = preferIssueMessage ? (issues[0]?.message ?? malformedMessage) : malformedMessage;
  throw new GameInputError(message, issues);
}

/** The reply a principal may receive. A player never gets a GM-only narration line, wherever an action
 *  resolution sits in the reply (an ack bypasses the state projection). */
export function projectReply(principal: GamePrincipal, reply: GameReply): GameReply {
  return isGmGrade(principal) ? reply : (withoutGmOnlyNarration(reply) as GameReply);
}

function withoutGmOnlyNarration(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutGmOnlyNarration);
  if (value === null || typeof value !== "object") return value;
  const projected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "tableNarration" && Array.isArray(child)) {
      const readable = child.filter((line: { gmOnly?: boolean }) => line?.gmOnly !== true);
      if (readable.length === child.length) projected[key] = child;
      else if (readable.length > 0) projected[key] = readable;
      continue;
    }
    projected[key] = withoutGmOnlyNarration(child);
  }
  return projected;
}

type StoreCommand = Parameters<GameStore["execute"]>[0];

/** The one path every command takes, whichever transport carried it: authorize the role, parse the payload,
 *  run the command (whose writes commit and publish through `execute`), and project the reply. */
export function createCommandRunner(context: CommandContext, kit: Kit, commands: readonly AnyCommand[]) {
  const byType = new Map(commands.map((command) => [command.type, command]));

  async function dispatch(type: GameCommandType, principal: GamePrincipal, raw: unknown): Promise<GameReply> {
    const command = byType.get(type);
    if (!command) throw new Error(`No command is registered for ${type}.`);
    if (command.gmOnly !== undefined && !isGmGrade(principal)) throw new GameAccessDeniedError(command.gmOnly);
    if (command.playerOnly !== undefined && isGmGrade(principal)) throw new GameAccessDeniedError(command.playerOnly);
    const request = parse(command.schema, raw, command.malformed, command.issueMessage) as {
      commandId: string;
      expectedRevision?: number;
      actorId?: string;
    };
    let committed: Committed | undefined;
    const header = (journal: JournalOverrides = {}): StoreCommand => ({
      id: request.commandId,
      type: journal.type ?? command.type,
      actorId: journal.actorId ?? request.actorId,
      expectedRevision: request.expectedRevision,
      payload: request,
      principal: principalTag(principal)
    });
    const publish = async (result: Committed) => {
      committed = result;
      if (!result.duplicate) await context.publishGameState(result.state);
      return result;
    };
    const extras = await command.run(
      {
        principal,
        request,
        execute: async (mutate, journal) => publish(await context.store.execute(header(journal), mutate)),
        executeTimeline: async (plan, journal) => publish(await context.store.executeTimeline(header(journal), plan)),
        dispatch: (next, payload) => dispatch(next, principal, payload)
      },
      kit
    );
    const accepted = committed ? { revision: committed.state.revision, duplicate: committed.duplicate } : {};
    return projectReply(principal, { ...accepted, ...extras });
  }

  return { dispatch };
}

/** Runs one read for a principal: the role gate, then the input, then the read. */
export function runRead(read: ReadSpec, principal: GamePrincipal, input: unknown, kit: Kit): GameReply {
  if (read.gmOnly !== undefined && !isGmGrade(principal)) throw new GameAccessDeniedError(read.gmOnly);
  const parsed = read.schema ? parse(read.schema, input, read.malformed ?? "The request is malformed.") : undefined;
  return read.run(principal, parsed, kit);
}
