import { GAME_COMMANDS, type GameCommandType } from "@vtt/api-contract";
import type { ClientToServerEvents } from "@vtt/domain";
import { actionCommands } from "./actions.js";
import { actorHealthCommands } from "./actor-health.js";
import { actorCommands } from "./actors.js";
import { characterSheetCommands } from "./character-sheet.js";
import { characterCommands } from "./characters.js";
import { effectCommands } from "./effects.js";
import { encounterCommands } from "./encounter.js";
import { experienceCommands } from "./experience.js";
import { createKit, type CommandContext, type GamePrincipal } from "./kit.js";
import { mapCommands } from "./map.js";
import { createCommandRunner, runRead, type AnyCommand, type ReadSpec, type SocketEventOf } from "./pipeline.js";
import { reactionCommands } from "./reactions.js";
import { restingCommands } from "./resting.js";
import { craftingCommands } from "./crafting.js";
import { gameReads, viewFor } from "./reads.js";
import { rollCommands } from "./rolls.js";
import { rulingCommands } from "./rulings.js";
import { saveCommands } from "./saves.js";
import { sceneCommands } from "./scenes.js";
import { soundCommands } from "./sound.js";
import { summonCommands } from "./summons.js";
import { tableSettingCommands } from "./table-settings.js";
import { objectCommands } from "./objects.js";
import { visionCommands } from "./vision.js";

export { describeFailure, failureReply, NOT_JOINED_REPLY, SESSION_ENDED_REPLY } from "./failures.js";
export { isGmGrade, type CommandContext, type GamePrincipal } from "./kit.js";
export { readScope, socketEventOf, type AnyCommand, type GameReply } from "./pipeline.js";

/** Every game command, each defined once: its socket event and typed HTTP route derive from its type, its
 *  scope and route come from `GAME_COMMANDS`, and both transports run it through the same pipeline. */
export const gameCommands: readonly AnyCommand[] = [
  ...encounterCommands,
  ...actorCommands,
  ...actorHealthCommands,
  ...restingCommands,
  ...craftingCommands,
  ...characterCommands,
  ...characterSheetCommands,
  ...actionCommands,
  ...saveCommands,
  ...rollCommands,
  ...experienceCommands,
  ...reactionCommands,
  ...effectCommands,
  ...rulingCommands,
  ...tableSettingCommands,
  ...sceneCommands,
  ...mapCommands,
  ...summonCommands,
  ...soundCommands,
  ...visionCommands,
  ...objectCommands
];
export { gameReads };

// The domain's socket contract and the tables agree, at compile time: every command has a typed event, and
// every event is a command, a read or the session join.
type Assert<Condition extends true> = Condition;
export type CommandEventsAreTyped = Assert<
  SocketEventOf<GameCommandType> extends keyof ClientToServerEvents ? true : false
>;
export type EveryEventIsServed = Assert<
  Exclude<
    keyof ClientToServerEvents,
    SocketEventOf<GameCommandType> | (typeof gameReads)[number]["event"] | "session:join"
  > extends never
    ? true
    : false
>;

export type GameCommands = ReturnType<typeof createGameCommands>;

/** The commands and reads bound to one server, for the socket handlers and the HTTP API alike (ADR-0016). */
export function createGameCommands(context: CommandContext) {
  const types = gameCommands.map((command) => command.type);
  const routed = Object.keys(GAME_COMMANDS);
  if (
    types.length !== routed.length ||
    new Set(types).size !== types.length ||
    !routed.every((type) => types.includes(type as GameCommandType))
  )
    throw new Error("Every command in GAME_COMMANDS needs exactly one definition in the command table.");
  const kit = createKit(context);
  const { dispatch } = createCommandRunner(context, kit, gameCommands);
  return {
    commands: gameCommands,
    reads: gameReads as readonly ReadSpec[],
    dispatch,
    read: (read: ReadSpec, principal: GamePrincipal, input: unknown) => runRead(read, principal, input, kit),
    view: (principal: GamePrincipal, requested?: "gm" | "player") => viewFor(kit, principal, requested)
  };
}
