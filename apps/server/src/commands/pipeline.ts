import type { z } from "zod";
import type { GameCommandType, IntegrationScope } from "@vtt/api-contract";
import type { ApiRoute } from "@vtt/api-contract/routes";
import type { ClientToServerEvents, GameState } from "@vtt/domain";
import { GameAccessDeniedError } from "../authorization.js";
import { isIncapacitated } from "../condition-rules.js";
import type { EffectNarration } from "../effects.js";
import { needsSettling, settleFalls as settleFallsIn } from "../falling.js";
import { compelledMoves, fleesNow } from "../granted-moves.js";
import { needsPlaneSettling, settlePlanes } from "../off-plane.js";
import { heldMoveReady, settleHeldMove } from "../held-moves.js";
import { offerNearbyReactions } from "../triggered-reactions.js";
import { movementCost } from "../terrain.js";
import { burstEndedZones } from "../spell-zones.js";
import { planNextTurn } from "../combat-history.js";
import { nextInitiativeTurn } from "../encounter.js";
import { holdsSummons, needsSummonSettling, settleSummons, summonHoldingTurnLeaves } from "../summons.js";
import { holdsAuras, settleZoneAuras, zoneAuraChanges } from "../zone-auras.js";
import type { GameStore, TimelineOps } from "../game-store.js";
import { issuesOf } from "../http-kit.js";
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

export type CommandSpec<Schema extends z.ZodType> = Readonly<{
  type: GameCommandType;
  /** One line for the command catalog (`GET /game/commands`). */
  summary: string;
  /** The typed HTTP route's OpenAPI operation id and its full description; its request body is `schema`. */
  operationId: string;
  description: string;
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
  /** The HTTP reply's documented shape, for a command whose reply carries more than the acknowledgement. */
  reply?: Readonly<{ schema: z.ZodType; description: string }>;
  /** The command itself. Whatever it returns is added to the reply after the revision and duplicate flag. */
  run(call: CommandCall<z.output<Schema>>, kit: Kit): Promise<GameReply | void>;
}>;
export type AnyCommand = CommandSpec<z.ZodType>;

export function defineCommand<Schema extends z.ZodType>(spec: CommandSpec<Schema>): AnyCommand {
  return spec;
}

/** A read served to the socket under `event` and over HTTP as its registry route, whose scope admits a credential. */
export type ReadSpec = Readonly<{
  event: keyof ClientToServerEvents;
  route: ApiRoute;
  gmOnly?: string;
  /** Validates the input; absent, the read takes none. */
  schema?: z.ZodType;
  malformed?: string;
  /** The read's input from an HTTP request: its path parameters unless given. */
  httpInput?: (request: Readonly<{ params: Record<string, string>; query: Record<string, unknown> }>) => unknown;
  run(principal: GamePrincipal, input: unknown, kit: Kit): GameReply;
}>;

/** The integration scope a read's route admits a credential with. */
export function readScope(read: ReadSpec): IntegrationScope {
  const access = read.route.access;
  if ("public" in access || !access.scope || access.scope === "per-command")
    throw new Error(`${read.event} needs a route that names one scope.`);
  return access.scope;
}

/** Socket.IO event names are the command type with its first `.` as `:`. */
export type SocketEventOf<Type extends string> = Type extends `${infer Area}.${infer Name}` ? `${Area}:${Name}` : never;
export function socketEventOf<Type extends GameCommandType>(type: Type) {
  return type.replace(".", ":") as SocketEventOf<Type>;
}

export function parse<Schema extends z.ZodType>(
  schema: Schema,
  raw: unknown,
  malformedMessage: string,
  preferIssueMessage = false
): z.output<Schema> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issues = issuesOf(result.error);
  const message = preferIssueMessage ? (issues[0]?.message ?? malformedMessage) : malformedMessage;
  throw new GameInputError(message, issues);
}

/** The reply a principal may receive. Wherever an action resolution sits in the reply (an ack bypasses the
 *  state projection), a player never gets a GM-only narration line or a target's Armor Class: monster stats
 *  are GM knowledge, and an attack's AC would hand one over per swing. */
export function projectReply(principal: GamePrincipal, reply: GameReply): GameReply {
  return isGmGrade(principal) ? reply : (forPlayer(reply) as GameReply);
}

function forPlayer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(forPlayer);
  if (value === null || typeof value !== "object") return value;
  const projected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "tableNarration" && Array.isArray(child)) {
      const readable = child.filter((line: { gmOnly?: boolean }) => line?.gmOnly !== true);
      if (readable.length === child.length) projected[key] = child;
      else if (readable.length > 0) projected[key] = readable;
      continue;
    }
    if (key === "targetAc") {
      projected[key] = null;
      continue;
    }
    projected[key] = forPlayer(child);
  }
  return projected;
}

type StoreCommand = Parameters<GameStore["execute"]>[0];

/** The one path every command takes, whichever transport carried it: authorize the role, parse the payload,
 *  run the command (whose writes commit and publish through `execute`), and project the reply. */
/** The table itself answers for a creature that can no longer answer. It is GM-grade and holds no person's session. */
const TABLE_PRINCIPAL: GamePrincipal = { kind: "gm", sessionId: "00000000-0000-4000-8000-000000000000" };

/** A reactor that can't take a reaction any more: at 0 hit points, or with a condition that includes Incapacitated. */
function cannotReact(state: GameState, actorId: string): boolean {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  return actor === undefined || actor.hp.current <= 0 || isIncapacitated(actor);
}

export function createCommandRunner(context: CommandContext, kit: Kit, commands: readonly AnyCommand[]) {
  const byType = new Map(commands.map((command) => [command.type, command]));

  /**
   * A reaction prompt whose creature dropped (0 HP, Unconscious, Stunned) since it opened is withdrawn: the table
   * declines it, so a held attack finishes with its own die and nobody waits on an answer that can't come. A prompt
   * whose attack can't be finished any more is dropped.
   */
  async function settleDownedReactions() {
    for (let guard = 0; guard < 10; guard++) {
      const state = context.readState();
      if (!state.combat.active) return;
      const owed = state.combat.pendingReactions.find((entry) => cannotReact(state, entry.actorId));
      if (!owed) return;
      try {
        await dispatch(
          "reaction.answer",
          TABLE_PRINCIPAL,
          { commandId: context.newId(), reactionId: owed.id, use: false },
          false
        );
      } catch {
        await dispatch("reaction.dismiss", TABLE_PRINCIPAL, { commandId: context.newId(), reactionId: owed.id }, false);
      }
    }
  }

  /**
   * Where creatures stand once a command has done its work, as its own commit told like any other: a creature made to
   * flee takes its Reaction's move (`compelledMoves`), one that left the plane leaves the map and one back from it
   * returns (`settlePlanes`), and whoever is in the air and can no longer stay there comes down (SRD Flying, Falling).
   * Every way it happens (a condition, an effect ending, a broken Concentration) moves the token the same way.
   */
  async function settleFalls() {
    const state = context.readState();
    const lookup = { resolveDefinition: (definitionId: string) => kit.resolveDefinitionIn(state, definitionId) };
    if (
      !fleesNow(state) &&
      !needsPlaneSettling(state) &&
      !heldMoveReady(state) &&
      !needsSettling(state, { ...lookup, catalog: kit.equipmentCatalog() })
    )
      return;
    const distance = await kit.creatureDistance();
    const mapAssetId = state.combat.mapAssetId;
    const geometry = mapAssetId ? await kit.context.tokenGeometryFor(mapAssetId) : null;
    const id = context.newId();
    let events: EffectNarration[] = [];
    const result = await context.store.execute({ id, type: "positions.settle", principal: "table" }, (draft) => {
      const deps = kit.fallDeps(draft, distance, id);
      const sameMap = geometry !== null && draft.combat.mapAssetId === mapAssetId;
      const heldId = draft.combat.heldMove?.actorId;
      const held = sameMap
        ? settleHeldMove(draft, geometry, {
            zones: kit.zoneDeps(draft, geometry),
            costFeet: (from, to) => {
              const heldId = draft.combat.heldMove?.actorId;
              return heldId ? (movementCost(draft, geometry, heldId, from, to)?.feet ?? null) : null;
            }
          })
        : [];
      // A held move that went on to its end can open another creature's reaction to it (a nalfeshnee's Pursuit).
      const pursued =
        heldId && held.length > 0 && draft.combat.heldMove?.actorId !== heldId
          ? offerNearbyReactions(draft, heldId, "ends-move-near", {
              newId: context.newId,
              now: () => new Date().toISOString(),
              resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
              catalog: kit.equipmentCatalog(),
              distanceFeet: (a, b) => distance(draft, a, b),
              commandId: id
            })
          : [];
      const planes = sameMap ? settlePlanes(draft, geometry) : [];
      events = [...held, ...pursued, ...compelledMoves(draft, deps), ...planes, ...settleFallsIn(draft, deps)];
    });
    if (result.duplicate) return;
    await context.publishGameState(result.state);
    kit.publishRolls(result.state, id);
    kit.publishNarrations(events);
  }

  /**
   * Summoned creatures whose time is up, that dropped to 0 Hit Points, whose summoner died or that strayed too far leave
   * the map and the roster, and a creature whose command lapsed stops obeying (`summons.ts`), as their own write. One
   * that holds the turn ends it first, as its End Turn would, so the turn passes on through the turn's own steps.
   */
  async function settleSummoned() {
    const before = context.readState();
    if (before.combat.historyCursor !== null || !holdsSummons(before)) return;
    const geometry = await kit.liveGeometry();
    const distance = await kit.creatureDistance();
    const leash = (state: GameState) => (a: string, b: string) => distance(state, a, b);
    if (!needsSummonSettling(before, leash(before))) return;
    if (summonHoldingTurnLeaves(before, leash(before))) {
      const turnEvents: EffectNarration[] = [];
      const passed = await context.store.executeTimeline(
        { id: context.newId(), type: "turn.end", principal: "table" },
        (draft, timeline) => {
          planNextTurn(draft, timeline, false, (advancing) =>
            nextInitiativeTurn(advancing, turnEvents, kit.turnAdvanceDeps(advancing, geometry, distance))
          );
        }
      );
      if (!passed.duplicate) {
        await context.publishGameState(passed.state);
        kit.context.logTurnBegin(passed.state);
        kit.publishNarrations(turnEvents);
      }
    }
    let events: EffectNarration[] = [];
    const result = await context.store.execute(
      { id: context.newId(), type: "summons.settle", principal: "table" },
      (draft) => {
        events = settleSummons(draft, {
          distanceFeet: leash(draft),
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
          catalog: kit.equipmentCatalog()
        });
      }
    );
    if (result.duplicate) return;
    await context.publishGameState(result.state);
    kit.publishNarrations(events);
  }

  /**
   * A spell area that acts as its spell ends (Delayed Blast Fireball's bead) is left bursting by whatever ended the
   * spell; the table then raises its saves with the server's dice and the live map, as its own write.
   */
  async function settleBurstingZones() {
    const before = context.readState();
    if (!before.combat.spellZones.some((zone) => zone.bursting) || before.combat.historyCursor !== null) return;
    const geometry = await kit.liveGeometry();
    let events: EffectNarration[] = [];
    const result = await context.store.execute({ id: context.newId(), type: "spell-zone.burst" }, (draft) => {
      events = burstEndedZones(draft, kit.zoneDeps(draft, geometry));
    });
    await context.publishGameState(result.state);
    kit.publishNarrations(events);
  }

  /**
   * What a spell's area gives the creatures in it (Holy Aura, Pass without Trace) follows them in and out: after a
   * command moves a token, an area or ends a spell, the table settles who holds it, as its own write when anything
   * changed.
   */
  async function settleZoneAurasAfter() {
    const before = context.readState();
    if (!holdsAuras(before) || before.combat.historyCursor !== null) return;
    const geometry = await kit.liveGeometry();
    const changes = zoneAuraChanges(before, kit.zoneDeps(before, geometry));
    if (changes.leaving.length === 0 && changes.entering.length === 0) return;
    const result = await context.store.execute({ id: context.newId(), type: "spell-zone.auras" }, (draft) => {
      settleZoneAuras(draft, kit.zoneDeps(draft, geometry));
    });
    await context.publishGameState(result.state);
  }

  async function dispatch(
    type: GameCommandType,
    principal: GamePrincipal,
    raw: unknown,
    settle = true
  ): Promise<GameReply> {
    const command = byType.get(type);
    if (!command) throw new Error(`No command is registered for ${type}.`);
    if (command.gmOnly !== undefined && !isGmGrade(principal)) throw new GameAccessDeniedError(command.gmOnly);
    if (command.playerOnly !== undefined && isGmGrade(principal)) throw new GameAccessDeniedError(command.playerOnly);
    if (principal.kind === "player" && principal.preview)
      throw new GameAccessDeniedError("A preview of the players' view only reads. Act from your own session.");
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
        dispatch: (next, payload) => dispatch(next, principal, payload, false)
      },
      kit
    );
    const accepted = committed ? { revision: committed.state.revision, duplicate: committed.duplicate } : {};
    const reply = projectReply(principal, { ...accepted, ...extras });
    if (settle && committed && !committed.duplicate) {
      await settleBurstingZones();
      await settleZoneAurasAfter();
      await settleDownedReactions();
      await settleSummoned();
      await settleFalls();
    }
    return reply;
  }

  return { dispatch };
}

/** Runs one read for a principal: the role gate, then the input, then the read. */
export function runRead(read: ReadSpec, principal: GamePrincipal, input: unknown, kit: Kit): GameReply {
  if (read.gmOnly !== undefined && !isGmGrade(principal)) throw new GameAccessDeniedError(read.gmOnly);
  const parsed = read.schema ? parse(read.schema, input, read.malformed ?? "The request is malformed.") : undefined;
  return read.run(principal, parsed, kit);
}
