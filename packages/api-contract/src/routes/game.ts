import { z } from "zod";
import {
  ActorMovementReplySchema,
  AvailableActionsReplySchema,
  BuilderOffersReplySchema,
  CharacterDraftReplySchema,
  NextLevelReplySchema,
  CraftingOffersReplySchema,
  ScenePreviewReplySchema,
  SoundBoardViewSchema,
  VisionPreviewReplySchema
} from "@vtt/domain";
import {
  ActorAvailableActionsSchema,
  ActorCraftingOffersSchema,
  ActorMovementSchema,
  BuilderOffersSchema,
  CharacterNextLevelSchema,
  ScenePreviewSchema,
  VisionPreviewSchema
} from "@vtt/domain/commands";
import {
  GAME_PATHS,
  GameCommandCatalogSchema,
  GameCommandEnvelopeSchema,
  GameLogSchema,
  GameMutationAcceptedSchema,
  GameSnapshotSchema
} from "../index.js";
import { named } from "./components.js";
import { anySession, defineRoute, gmGrade, json, noBody, ok, refused } from "./define.js";

/**
 * The live game's HTTP reads and its command tunnel (`game-http.ts`). Each read here is also a socket read
 * (`commands/reads.ts`), and its parameters are that read's own input schema. The typed command routes are
 * generated from the command table (`commands.ts` here, `defineCommand` in the server).
 */

/** What a refused game command or read answers with 409. */
export const GAME_CONFLICT =
  "Refused by the game's rules or state. A stale `expectedRevision` carries `error.currentRevision`. A turn change that would rewrite history carries `error.details.needsConfirm`; send the command again with the confirmation it names.";

/** How many combat log lines a read answers when it names no `limit`. */
export const DEFAULT_LOG_LIMIT = 250;
/** The combat log read's query: how many of the latest lines to answer. */
export const LogReadSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe(`How many of the latest lines to answer, 1 to 1000. Default ${DEFAULT_LOG_LIMIT}.`)
  })
  .strict();

/** `GET /game`'s query. */
export const GameSnapshotQuerySchema = z.object({
  view: z
    .enum(["gm", "player"])
    .optional()
    .describe(
      "`player` asks a GM session or a credential for the player-safe projection. A player session always gets that one."
    )
});

const SoundBoardDataSchema = named("SoundBoardData", z.strictObject({ view: SoundBoardViewSchema }));
named("BuilderOffersDraft", BuilderOffersSchema);

const ONE_ACTOR = "A player asked about a creature that is not theirs, or one that does not exist.";

export const getGameSnapshot = defineRoute({
  method: "get",
  path: GAME_PATHS.snapshot,
  operationId: "getGameSnapshot",
  tag: "Live game",
  summary: "Read the game state",
  description:
    "The game state projected for the caller, as the socket sends it. A GM session or a credential gets the GM view, with hidden combatants, notes and the turn history, unless `view=player` asks for the player-safe projection. A player session always gets the player-safe view. The weak ETag follows the revision, so a poll with `If-None-Match` is a cheap 304. Presence and a timed mark running out change the state without a new revision, so read again when those must be fresh.",
  access: anySession("game:read"),
  query: GameSnapshotQuerySchema,
  responses: {
    200: ok(GameSnapshotSchema, "The projected state and its revision.", {
      headers: { ETag: "A weak tag of the revision and the view." }
    }),
    304: noBody("Unchanged since the ETag sent in `If-None-Match`."),
    400: refused("`view` is neither `gm` nor `player`."),
    401: refused(),
    403: refused()
  }
});

export const getSoundBoard = defineRoute({
  method: "get",
  path: GAME_PATHS.sound,
  operationId: "getSoundBoard",
  tag: "Live game",
  summary: "Read the sound board",
  description:
    "The playlist, ambient layers, effect pads and scene sounds, what is playing and since when on `serverTime`'s clock, and each connected table screen's sound state. GM-grade only: players are never sent any of it, and a table screen receives only what is playing, through its event stream.",
  access: gmGrade("scene:read"),
  responses: {
    200: ok(SoundBoardDataSchema, "The sound board."),
    401: refused(),
    403: refused(),
    404: refused("This server runs without sound.")
  }
});

export const getCombatLog = defineRoute({
  method: "get",
  path: GAME_PATHS.log,
  operationId: "getCombatLog",
  tag: "Live game",
  summary: "Read the combat log",
  description:
    "The latest lines of the table's feed, oldest first. A GM session or a credential receives the GM-only lines too. A player session receives the public lines and its own private rolls.",
  access: anySession("combat:read"),
  query: LogReadSchema,
  responses: {
    200: ok(GameLogSchema, "The log lines."),
    400: refused(),
    401: refused(),
    403: refused()
  }
});

export const getActorAvailableActions = defineRoute({
  method: "get",
  path: GAME_PATHS.actorAvailableActions,
  operationId: "getActorAvailableActions",
  tag: "Live game",
  summary: "Read what a combatant can do now",
  description:
    "Each of the combatant's actions with whether the rules allow it now, every rule it breaks as a rule id and a message, and the uses and open rolls it has left. It runs the evaluation `action.resolve` enforces, so the two cannot disagree. The answer also carries the sheet's derived numbers, the choices a character may make again and the spells it may swap. A GM-grade caller may read any combatant, and a player session only its claimed character. Rules that need a target are not checked here.",
  access: anySession("combat:read"),
  params: ActorAvailableActionsSchema,
  responses: {
    200: ok(AvailableActionsReplySchema, "The combatant's actions."),
    400: refused(),
    401: refused(),
    403: refused(ONE_ACTOR),
    404: refused()
  }
});

export const getActorMovement = defineRoute({
  method: "get",
  path: GAME_PATHS.actorMovement,
  operationId: "getActorMovement",
  tag: "Live game",
  summary: "Read a combatant's movement left this turn",
  description:
    "Whether a move is counted at all (a fight running, the combatant's turn, movement rules on), its budget after Exhaustion, Slow, Dash and the like, the feet already spent, and whether going over is refused or only warned. `token.move` charges the same budget, and a move costs its cheapest grid path, with difficult terrain and enemies' spaces counting double. A GM-grade caller may read any combatant, and a player session only its claimed character.",
  access: anySession("combat:read"),
  params: ActorMovementSchema,
  responses: {
    200: ok(ActorMovementReplySchema, "The combatant's movement this turn."),
    400: refused(),
    401: refused(),
    403: refused(ONE_ACTOR),
    404: refused()
  }
});

export const getCharacterNextLevel = defineRoute({
  method: "get",
  path: GAME_PATHS.characterNextLevel,
  operationId: "getCharacterNextLevel",
  tag: "Live game",
  summary: "Read what a character's next level brings",
  description:
    "Short plain lines for the sheet: the Proficiency Bonus when it rises, the features the level grants, the picks it asks for, its spell slots, prepared spells and cantrips, a Wizard's two spellbook spells and the Hit Points it adds. It is read from the character builder's own survey at the next level against the character's choices ledger. The level goes to the class the Level page offers first, the class of the last level taken, which the answer names. The GM may ask about any character; a player session only about its claimed character, and only while the table's builder policy lets players build. A character at the table's highest level, or one not built here, is a 409.",
  access: anySession("game:read"),
  params: CharacterNextLevelSchema,
  responses: {
    200: ok(NextLevelReplySchema, "What the next level brings."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused(),
    409: refused("The character is at the table's highest level, or was not built here.")
  }
});

export const getActorCraftingOffers = defineRoute({
  method: "get",
  path: GAME_PATHS.actorCraftingOffers,
  operationId: "getActorCraftingOffers",
  tag: "Live game",
  summary: "Read what a character could start crafting",
  description:
    "SRD 5.2.1 Crafting: for each tool the character is proficient with, what its Craft line makes, each with its raw materials (half the price, a Potion of Healing's 25 GP) and its 8-hour days of work (the price in GP divided by 10, rounded up); the prepared spells it can scribe on a Spell Scroll with proficiency in Arcana or with Calligrapher's Supplies, at the Spell Scroll Costs table's days and gold; and the magic items it can craft with Arcana proficiency and a tool it is proficient with, at the Magic Item Crafting table's days and gold by rarity (halved for a consumable). Whether a tool is carried, and the purse. `crafting.start` checks each again. The GM may ask about any character; a player session only about its claimed character.",
  access: anySession("game:read"),
  params: ActorCraftingOffersSchema,
  responses: {
    200: ok(CraftingOffersReplySchema, "What the character could start crafting now."),
    400: refused(),
    401: refused(),
    403: refused(ONE_ACTOR),
    404: refused()
  }
});

export const getCharacterDraft = defineRoute({
  method: "get",
  path: GAME_PATHS.characterDraft,
  operationId: "getCharacterDraft",
  tag: "Live game",
  summary: "Read the caller's parked character build",
  description:
    "The character builder's choices so far, as `POST /game/characters/draft/save` left them, and when, or null. A player session reads its own build, and the GM reads the GM's on whichever device signed in. Nobody reads anyone else's.",
  access: anySession("game:read"),
  responses: {
    200: ok(CharacterDraftReplySchema, "The caller's parked build, or null."),
    401: refused(),
    403: refused()
  }
});

export const getBuilderOffers = defineRoute({
  method: "get",
  path: GAME_PATHS.builderOffers,
  operationId: "getBuilderOffers",
  tag: "Live game",
  summary: "Read what a character build may pick",
  description:
    "What the content asks a character-builder draft to pick, from the survey `POST /game/characters` validates against, so a builder offers exactly what a create accepts. Each offer names its builder step, its options with their names and spell levels, its capacity after every feature that raises it, the level its rows are stamped with, and the options this build cannot usefully take. There is one offer per grant level, so each Ability Score Improvement is its own. The answer also carries the answers the build still accepts, dropping any it no longer offers, and the ledger rows they make, which a create sends as `choices`. Send the answers by offer key, or a stored ledger as `choices` to read a character back for a rebuild. A multiclass draft adds `classLevels`, the class each level went to, with index 0 as level 1. A later class's own picks are filed under keys suffixed with its id (`class-cantrips:wizard`) and stamped with the level it reached them at. The GM may always read it; a player session while the table's builder policy lets players build.",
  access: anySession("game:read"),
  query: z.object({ draft: BuilderOffersSchema.describe("The draft, JSON-encoded.") }),
  jsonQuery: ["draft"],
  responses: {
    200: ok(BuilderOffersReplySchema, "The draft's offers, its accepted answers and their ledger rows."),
    400: refused(),
    401: refused(),
    403: refused("The table's builder policy does not let players build."),
    409: refused("The draft names content this table does not have, or class levels that do not add up.")
  }
});

export const previewVision = defineRoute({
  method: "get",
  path: GAME_PATHS.visionPreview,
  operationId: "previewVision",
  tag: "Live game",
  summary: "See through a creature's eyes",
  description:
    "What one creature sees on the live scene, or the whole party without an `actorId` (ADR-0023): the area as image-pixel polygons (`[x0, y0, x1, y1, ...]`) whose union is what it sees, and the creatures it perceives. It is the computation that decides what each player and the table screen receive. GM-grade only; empty while the scene's dynamic vision is off.",
  access: gmGrade("scene:read"),
  query: VisionPreviewSchema,
  responses: {
    200: ok(VisionPreviewReplySchema, "Where the creature or the party sees now."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused()
  }
});

export const previewScene = defineRoute({
  method: "get",
  path: GAME_PATHS.scenePreview,
  operationId: "previewScene",
  tag: "Live game",
  summary: "See a scene as the table screen or a player would",
  description:
    "What one audience would receive of a prepared or live scene if it were live now: with no `actorId` the table screen (`screen`: its encounter and turn order, as the presentation carries them), with a party character's `actorId` the player who holds that character (`player`: the combat of their projection and the creatures it names). The same projections build it over a copy of the state, so fog, dynamic vision and hidden creatures apply as they will, and nothing is changed. GM-grade only.",
  access: gmGrade("scene:read"),
  params: ScenePreviewSchema.pick({ sceneId: true }),
  query: ScenePreviewSchema.pick({ actorId: true }),
  responses: {
    200: ok(ScenePreviewReplySchema, "What that audience would receive."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused("No scene or party character has that id.")
  }
});

export const listGameCommands = defineRoute({
  method: "get",
  path: GAME_PATHS.commands,
  operationId: "listGameCommands",
  tag: "Live game",
  summary: "List the game commands",
  description:
    "Every command type the tunnel accepts, with the credential scope it needs and one line on what it does, sorted by type.",
  access: anySession("system:read"),
  responses: {
    200: ok(GameCommandCatalogSchema, "The command catalog."),
    401: refused(),
    403: refused()
  }
});

export const submitGameCommand = defineRoute({
  method: "post",
  path: GAME_PATHS.commands,
  operationId: "submitGameCommand",
  tag: "Live game",
  summary: "Send any game command",
  description:
    "The command tunnel: sends any command in the catalog with its socket payload, through the validation, authorization and execution the app's own calls take. The scope it needs is the command's own (see `GET /game/commands`). Leave out `commandId` to have one minted, and send the same one again to retry safely.",
  access: { gm: true, player: true, scope: "per-command" },
  body: json(GameCommandEnvelopeSchema, {
    example: {
      type: "actor.apply-damage",
      commandId: "2b7e4c1a-9f3d-4e8b-a6c2-1d5f0e9b7a34",
      payload: { actorId: "8d3f2a61-4c7b-4e9a-b1d2-6f0e3c5a9b17", amount: 7 }
    }
  }),
  responses: {
    200: ok(GameMutationAcceptedSchema, "The command ran, or a resent `commandId` replayed its outcome."),
    400: refused(),
    401: refused(),
    403: refused(),
    404: refused("No command has that type."),
    409: refused(GAME_CONFLICT)
  }
});

export const GAME_ROUTES = [
  getGameSnapshot,
  getSoundBoard,
  getCombatLog,
  getActorAvailableActions,
  getActorMovement,
  getCharacterNextLevel,
  getActorCraftingOffers,
  getCharacterDraft,
  getBuilderOffers,
  previewVision,
  previewScene,
  listGameCommands,
  submitGameCommand
] as const;
