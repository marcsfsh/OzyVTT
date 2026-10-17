import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, PartyVisibilitySchema, type GameState } from "@vtt/domain";
import { MAX_COUNTED_OPTIONS, type ActorDefinition } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { createGameCommands, type CommandContext } from "../src/commands/index.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter } from "../src/encounter.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { GameStore } from "../src/game-store.js";
import { createInitialGameState, PLACEHOLDER_ACTOR_IDS } from "../src/initial-game-state.js";
import { countOptionUse } from "../src/option-uses.js";
import { projectGmView, projectPlayerView } from "../src/projections.js";
import { projectPlayerReplay } from "../src/replay-projection.js";
import { createStateReader } from "../src/state-reader.js";
import { moveEncounterToken, type TokenMapGeometry } from "../src/token-placement.js";
import { projectViewerEncounter } from "../src/viewer-encounter.js";
import { bootServer } from "./boot-server.js";

// The sheet's turn card: the options a player pins to it and how often each option resolved. Both are stored on
// the character, set and counted by the server, and reach only the character's owner and the GM.

const { fighter: BORIN, wizard: LYRA } = PLACEHOLDER_ACTOR_IDS;
const FOE = "10000000-0000-4000-8000-0000000000f0";
const MAP = "20000000-0000-5000-8000-000000000001";
const OWNER = "30000000-0000-4000-8000-00000000000a";
const OTHER = "30000000-0000-4000-8000-00000000000b";
const GM = { kind: "gm", sessionId: "30000000-0000-4000-8000-0000000000ff" } as const;
const GRID = {
  width: 900,
  height: 600,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
} as const satisfies TokenMapGeometry;
const cell = (column: number, row: number) => ({ x: (column + 0.5) * 50, y: (row + 0.5) * 50 });
const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));

const FOE_DEFINITION = {
  schemaId: "vtt.actor-character",
  schemaVersion: 1,
  source: { name: "test", version: "1" },
  name: "Foe",
  size: "medium",
  abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  proficiencyBonus: 2,
  armorClass: 5,
  hitPoints: { maximum: 200, formula: "20d10" },
  initiativeBonus: 0,
  speedFeet: 30,
  actions: [],
  token: { disposition: "hostile", footprint: { width: 1, height: 1 } },
  extensions: {}
} as unknown as ActorDefinition;

/** Borin and Lyra claimed by two players, with Lyra's pins and counts set. */
function pinnedTable(): GameState {
  const state = createInitialGameState();
  for (const actor of state.actors) {
    if (actor.id === LYRA) actor.ownerSessionId = OWNER;
    if (actor.id === BORIN) actor.ownerSessionId = OTHER;
  }
  const lyra = state.actors.find((actor) => actor.id === LYRA)!;
  lyra.favouriteOptionIds = ["spell-fire-bolt", "spell-misty-step"];
  lyra.optionUseCounts = { "spell-fire-bolt": 14, "spell-magic-missile": 6 };
  return GameStateSchema.parse(state);
}

/** A fight on a gridded map with Borin's turn first and a foe beside him. */
function fight(state: GameState = createInitialGameState()): GameState {
  importActorDefinition(state, FOE_DEFINITION, FOE, "public", catalog);
  startEncounter(
    state,
    {
      mapAssetId: MAP,
      entries: [
        { actorId: BORIN, score: 20 },
        { actorId: LYRA, score: 15 },
        { actorId: FOE, score: 10 }
      ]
    },
    () => 1,
    GRID
  );
  moveEncounterToken(state, BORIN, cell(2, 2), GRID);
  moveEncounterToken(state, LYRA, cell(6, 6), GRID);
  moveEncounterToken(state, FOE, cell(3, 2), GRID);
  return state;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The command layer over a real store, with a gridded map and every die a 4. */
async function commandsFor(state: GameState) {
  const directory = await mkdtemp(join(tmpdir(), "vtt-favourites-"));
  const store = new GameStore(join(directory, "game.sqlite"), state);
  await store.initialize();
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const unused = () => {
    throw new Error("not read here");
  };
  const commands = createGameCommands({
    store,
    readState: createStateReader(store).read,
    contentLibrary: new ContentLibrary(),
    combatLog: { append: () => {} },
    mapCatalog: { get: () => undefined },
    tokenCatalog: { get: () => undefined, touchLastUsed: () => {}, rememberForDefinition: () => {} },
    tokenGeometryFor: async () => GRID,
    publishGameState: async () => {},
    presentSceneMap: async () => {},
    broadcastTableEvent: () => {},
    appendLog: () => {},
    logTurnBegin: () => {},
    logTimelineOutcome: () => {},
    scheduleAnnotationExpiry: () => {},
    gmView: unused,
    playerView: unused,
    random: () => 4,
    newId: () => randomUUID()
  } as unknown as CommandContext);
  const actor = (actorId: string) => store.snapshot.actors.find((candidate) => candidate.id === actorId)!;
  return { commands, store, actor };
}

describe("pinning options to the turn card", () => {
  async function pins(principal: { kind: "gm" | "player"; sessionId: string }, actorId: string, optionIds: string[]) {
    const state = createInitialGameState();
    state.actors.find((actor) => actor.id === LYRA)!.ownerSessionId = OWNER;
    const t = await commandsFor(state);
    const run = (ids: string[], who = principal) =>
      t.commands.dispatch("character.set-favourites", who, { commandId: randomUUID(), actorId, optionIds: ids });
    await run(optionIds);
    return { ...t, run };
  }

  it("stores the owner's pins in order, and an empty list clears them", async () => {
    const t = await pins({ kind: "player", sessionId: OWNER }, LYRA, ["spell-misty-step", "spell-fire-bolt", "dash"]);
    expect(t.actor(LYRA).favouriteOptionIds).toEqual(["spell-misty-step", "spell-fire-bolt", "dash"]);
    await t.run([]);
    expect(t.actor(LYRA)).not.toHaveProperty("favouriteOptionIds");
  });

  it("lets the GM pin for any character and refuses another player", async () => {
    const t = await pins(GM, BORIN, ["item-greatsword", "second-wind"]);
    expect(t.actor(BORIN).favouriteOptionIds).toEqual(["item-greatsword", "second-wind"]);
    await expect(t.run(["item-flail"], { kind: "player", sessionId: OWNER })).rejects.toThrow(
      "You can only act on your own character."
    );
    expect(t.actor(BORIN).favouriteOptionIds).toEqual(["item-greatsword", "second-wind"]);
  });

  it("refuses an option the character doesn't have, or one that stays off the turn list", async () => {
    const t = await pins(GM, LYRA, []);
    await expect(t.run(["item-greatsword"])).rejects.toThrow(
      "That option can't be pinned: it isn't one of Lyra Emberwise's options now."
    );
    // Arcane Recovery is used when a Short Rest ends, never on a turn.
    await expect(t.run(["arcane-recovery"])).rejects.toThrow("isn't one of Lyra Emberwise's options now");
    expect(t.actor(LYRA)).not.toHaveProperty("favouriteOptionIds");
  });

  it("takes at most 8 options, each once", async () => {
    const t = await pins(GM, LYRA, []);
    const nine = ["dash", "disengage", "dodge", "help", "hide", "influence", "magic", "ready", "search"];
    await expect(t.run(nine)).rejects.toThrow("Pin at most 8 options.");
    await expect(t.run(["dash", "dash"])).rejects.toThrow("Each option may be pinned once.");
    await t.run(nine.slice(0, 8));
    expect(t.actor(LYRA).favouriteOptionIds).toHaveLength(8);
  });
});

describe("counting the options a character uses", () => {
  it("counts a resolved action once, its preview not at all", async () => {
    const t = await commandsFor(fight());
    const swing = (commit: boolean) =>
      t.commands.dispatch("action.resolve", GM, {
        commandId: randomUUID(),
        actorId: BORIN,
        actionId: "item-greatsword",
        targetIds: [FOE],
        attackNatural: 15,
        commit
      });
    await swing(false);
    expect(t.actor(BORIN)).not.toHaveProperty("optionUseCounts");
    await swing(true);
    expect(t.actor(BORIN).optionUseCounts).toEqual({ "item-greatsword": 1 });
  });

  it("counts a use outside a fight, and a reaction taken", async () => {
    const outside = await commandsFor(createInitialGameState());
    for (let use = 0; use < 2; use++)
      await outside.commands.dispatch("action.use", GM, {
        commandId: randomUUID(),
        actorId: LYRA,
        actionId: "spell-fire-bolt"
      });
    expect(outside.actor(LYRA).optionUseCounts).toEqual({ "spell-fire-bolt": 2 });

    // The foe walks out of Borin's reach and Borin swings the greatsword as an opportunity attack.
    const state = fight();
    const reactionId = "60000000-0000-4000-8000-000000000001";
    state.combat.pendingReactions.push({
      id: reactionId,
      kind: "leaves-reach",
      actorId: BORIN,
      actionId: "opportunity-attack",
      actionName: "Opportunity Attack",
      sourceActorId: FOE,
      sourceName: "Foe",
      targetActorId: FOE,
      triggerCommandId: "50000000-0000-4000-8000-0000000000ff",
      proposedDamage: 0,
      proposedDamageParts: [],
      critical: false,
      weighed: null,
      acBonus: null,
      rollsAttack: true,
      parkedAttack: null,
      createdAt: 0
    });
    const inFight = await commandsFor(state);
    await inFight.commands.dispatch("reaction.answer", GM, {
      commandId: randomUUID(),
      reactionId,
      use: true,
      actionId: "item-greatsword",
      commit: true,
      attackNatural: 15
    });
    expect(inFight.actor(BORIN).optionUseCounts).toEqual({ "item-greatsword": 1 });
  });

  it("keeps a bounded number of options, the least used giving way", () => {
    const state = createInitialGameState();
    for (let index = 0; index < MAX_COUNTED_OPTIONS; index++)
      for (let use = 0; use <= index; use++) countOptionUse(state, LYRA, `option-${index}`);
    countOptionUse(state, LYRA, "spell-fire-bolt");
    const counts = state.actors.find((actor) => actor.id === LYRA)!.optionUseCounts!;
    expect(Object.keys(counts)).toHaveLength(MAX_COUNTED_OPTIONS);
    expect(counts).not.toHaveProperty("option-0");
    expect(counts).toMatchObject({ "option-1": 2, "spell-fire-bolt": 1 });
    expect(() => GameStateSchema.parse(state)).not.toThrow();
  });
});

describe("who receives the pins and counts", () => {
  // The values ride only under these two keys; the option ids themselves are on the sheet a full tier sends.
  const SECRETS = ["favouriteOptionIds", "optionUseCounts"];

  it("sends them to the owner and the GM", () => {
    const state = pinnedTable();
    const mine = projectPlayerView(state, OWNER, () => null).actors.find((actor) => actor.id === LYRA)!;
    expect(mine).toMatchObject({
      favouriteOptionIds: ["spell-fire-bolt", "spell-misty-step"],
      optionUseCounts: { "spell-fire-bolt": 14, "spell-magic-missile": 6 }
    });
    const gm = projectGmView(state, () => null).actors.find((actor) => actor.id === LYRA)!;
    expect(gm.favouriteOptionIds).toEqual(["spell-fire-bolt", "spell-misty-step"]);
  });

  it("keeps them from another player at every party tier, the full sheet with resources included", () => {
    for (const tier of PartyVisibilitySchema.options) {
      const state = { ...pinnedTable(), partyVisibility: tier };
      const view = projectPlayerView(state, OTHER, () => null);
      const lyra = view.actors.find((actor) => actor.id === LYRA)!;
      expect(lyra, tier).not.toHaveProperty("favouriteOptionIds");
      expect(lyra, tier).not.toHaveProperty("optionUseCounts");
      const serialized = JSON.stringify(view);
      for (const secret of SECRETS) expect(serialized, `${tier}: ${secret}`).not.toContain(secret);
    }
    // At the top tier the other player does get Lyra's resources, which shows the tier was really applied.
    const top = projectPlayerView({ ...pinnedTable(), partyVisibility: "sheet-and-resources" }, OTHER, () => null);
    expect(top.actors.find((actor) => actor.id === LYRA)).toHaveProperty("spellSlots");
  });

  it("keeps them from the table screen and a shared replay", () => {
    const state = fight(pinnedTable());
    const viewer = projectViewerEncounter(state);
    expect(viewer.encounter.tokens.map((token) => token.actorId)).toContain(LYRA);
    const at = new Date(0).toISOString();
    const replay = projectPlayerReplay(1, {
      archiveSchemaVersion: 3,
      startedAt: null,
      endedAt: at,
      turnCount: 1,
      turns: [{ index: 0, kind: "turn", label: "Round 1", revision: 0, at, state }],
      log: [],
      journal: [],
      finalState: state,
      postEncounterState: state,
      rolls: [],
      definitions: [],
      attribution: null
    });
    expect(replay.turns[0]!.actors.map((actor) => actor.id)).toContain(LYRA);
    for (const shown of [viewer, replay])
      for (const secret of SECRETS) expect(JSON.stringify(shown), secret).not.toContain(secret);
  });

  it("keeps them out of every Codex read a player makes", async () => {
    // Lyra's pins and counts stay on the actor while a new player claims Lyra.
    const state = pinnedTable();
    state.actors.find((actor) => actor.id === LYRA)!.ownerSessionId = null;
    const booted = await bootServer(state);
    cleanups.push(booted.close);
    const player = booted.server.auth.issuePlayerSession();
    expect((await booted.post(GAME_PATHS.claims, player, { commandId: randomUUID(), actorId: LYRA })).status).toBe(200);
    // The owner's own game view carries them, so the walk below is looking at a table where they exist.
    const own = await fetch(`${booted.base}${GAME_PATHS.snapshot}`, { headers: { authorization: `Bearer ${player}` } });
    expect(await own.text()).toContain("favouriteOptionIds");
    for (const path of ["pages", "connections", "maps", "journal", "sessions", "quests", "standing", "timeline"]) {
      const response = await fetch(`${booted.base}/api/v1/codex/${path}`, {
        headers: { authorization: `Bearer ${player}` }
      });
      expect(response.status, path).toBe(200);
      const body = await response.text();
      for (const secret of SECRETS) expect(body, `${path}: ${secret}`).not.toContain(secret);
    }
    const search = await fetch(`${booted.base}/api/v1/codex/search?q=Lyra`, {
      headers: { authorization: `Bearer ${player}` }
    });
    const found = await search.text();
    for (const secret of SECRETS) expect(found, secret).not.toContain(secret);
  });
});
