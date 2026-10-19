import type { GameState } from "@vtt/domain";

/** The principal may not do this: a GM-only command from a player, or a player acting on a character that
 *  is not theirs. Always a 403 over HTTP. */
export class GameAccessDeniedError extends Error {}

/** What a principal is trying to initiate on an actor; lets a per-table policy vary by action class. */
export type InitiateKind = "attack" | "check" | "save" | "resource" | "inventory" | "edit" | "track" | "move";

/** Who is acting, reduced to what authorization reads: GM-grade (the GM and integrations) or a player session. */
export type Initiator = Readonly<{ role: "gm" }> | Readonly<{ role: "player"; sessionId: string }>;

export type InitiateVerdict = { ok: true } | { ok: false; message: string };

const NOT_YOURS = "You can only act on your own character.";

/** The single decision for "may this principal initiate this kind of action on this actor?". The GM
 *  (and integrations) may act on anyone; a player on their claimed player-character, and in play on a creature that
 *  character commands. A future per-table policy would be read here and nowhere else. */
export function canInitiateForActor(
  initiator: Initiator,
  state: GameState,
  actorId: string,
  kind: InitiateKind
): InitiateVerdict {
  if (initiator.role === "gm") return { ok: true };
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  // A missing actor and someone else's get the same answer, so a player cannot probe which ids exist.
  if (!actor) return { ok: false, message: NOT_YOURS };
  const commander = commanderOf(state, actor);
  const ownsCommander = commander !== undefined && !commander.archived && ownedBy(commander, initiator.sessionId);
  if (ownedBy(actor, initiator.sessionId)) {
    // A character under another creature's command (an aboleth's Dominate Mind) acts as that creature decides. Its
    // player still rolls its checks and saves and keeps its sheet.
    if (commander && !ownsCommander && COMMANDED_KINDS.has(kind))
      return { ok: false, message: `${actor.name} is under ${commander.name}'s command.` };
    return { ok: true };
  }
  // A creature the player's own character commands (a summoned spirit, a dominated ogre): that player acts for it in
  // play. Edits to its sheet stay with the GM.
  if (ownsCommander && actor.kind !== "player-character" && kind !== "edit" && kind !== "inventory")
    return { ok: true };
  return { ok: false, message: NOT_YOURS };
}

/** What a commanded creature's commander decides for it: what it does, where it moves and when its turn ends. */
const COMMANDED_KINDS: ReadonlySet<InitiateKind> = new Set(["attack", "move", "track"]);

const ownedBy = (actor: GameState["actors"][number], sessionId: string) =>
  actor.kind === "player-character" && actor.ownerSessionId === sessionId;

/** The creature that commands this one, while it is on the roster (see `Actor.control`). */
export function commanderOf(
  state: GameState,
  actor: Pick<GameState["actors"][number], "control">
): GameState["actors"][number] | undefined {
  const commanderId = actor.control?.by;
  return commanderId ? state.actors.find((candidate) => candidate.id === commanderId) : undefined;
}

/** Whether this player session's own character commands the creature (a summon, a dominated creature), so the player
 *  acts for it and is sent its stat block. A player character is never another player's to command. */
export function commandedBySession(
  state: GameState,
  actor: Pick<GameState["actors"][number], "control" | "kind">,
  sessionId: string | undefined
): boolean {
  if (sessionId === undefined || actor.kind === "player-character") return false;
  const commander = commanderOf(state, actor);
  return commander !== undefined && !commander.archived && ownedBy(commander, sessionId);
}

/** `canInitiateForActor` as a guard that throws a denial. `denial`
 *  words the refusal for the action at hand. */
export function requireActorAccess(
  initiator: Initiator,
  state: GameState,
  actorId: string,
  kind: InitiateKind,
  denial = NOT_YOURS
) {
  const verdict = canInitiateForActor(initiator, state, actorId, kind);
  if (verdict.ok) return;
  throw new GameAccessDeniedError(denial);
}

/** A GM-only step inside a shared rules path; the command gate usually refuses the player first. */
export function requireGm(initiator: Initiator, denial: string) {
  if (initiator.role !== "gm") throw new GameAccessDeniedError(denial);
}

/**
 * Whether a player may target this combatant: public ones only, and none hidden from them by sight or the fog
 * (`unseen`, from `playerSight`). The server must not trust client target ids, since resolving against a hidden actor
 * would leak its name/AC/outcome through the resolve ack (which bypasses the projection) and in direct mode damage
 * it. Gates the acted-upon actor; `canInitiateForActor` gates the acting one.
 */
export function canPlayerTarget(state: GameState, targetId: string, unseen: ReadonlySet<string> = new Set()): boolean {
  const target = state.actors.find((candidate) => candidate.id === targetId);
  return target !== undefined && target.visibility === "public" && !unseen.has(targetId);
}
