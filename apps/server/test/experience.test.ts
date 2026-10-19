import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { awardExperience } from "../src/experience.js";
import { projectPlayerView } from "../src/projections.js";
import { bootServer } from "./boot-server.js";

// SRD 5.2.1 Experience Points: the GM awards XP, and "when a character's XP total crosses certain thresholds, the
// character's level increases" (Character Advancement: level 2 at 300 XP, level 5 at 6,500). A character starting above
// level 1 "begins with the minimum amount of XP required to reach your starting level".

const LYRA = "74000000-0000-4000-8000-000000000001";
const BORIN = "74000000-0000-4000-8000-000000000002";
const GOBLIN = "74000000-0000-4000-8000-000000000003";
const DRAGON = "74000000-0000-4000-8000-000000000004";
const OWNER = "30000000-0000-4000-8000-0000000000a1";

const sheet = (level: number) =>
  ({
    name: "Hero",
    character: { classes: [{ id: "fighter", name: "Fighter", level }], feats: [] }
  }) as unknown as ActorDefinition;
const monsters = new Map(loadMonsterDefinitions().map((definition) => [definition.source.externalId, definition]));
const resolve = (id: string): ActorDefinition | undefined =>
  id === "lyra-sheet" ? sheet(1) : id === "borin-sheet" ? sheet(4) : monsters.get(id);

function table(): GameState {
  const pc = (id: string, name: string, definitionId: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 10, maximum: 10 },
    definitionId,
    ownerSessionId: id === LYRA ? OWNER : null
  });
  const monster = (id: string, name: string, definitionId: string) => ({
    id,
    name,
    kind: "monster",
    visibility: "public",
    hp: { current: 0, maximum: 10 },
    definitionId
  });
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      pc(LYRA, "Lyra", "lyra-sheet"),
      pc(BORIN, "Borin", "borin-sheet"),
      monster(GOBLIN, "Goblin", "goblin-warrior"),
      monster(DRAGON, "Adult Red Dragon", "adult-red-dragon")
    ]
  });
}
const actor = (state: GameState, id: string) => state.actors.find((entry) => entry.id === id)!;
const award = (state: GameState, fields: Partial<Parameters<typeof awardExperience>[1]>) =>
  awardExperience(state, { recipientIds: [LYRA], amount: 0, defeatedIds: [], inLairIds: [], ...fields }, resolve);

describe("Experience Points", () => {
  it("offers level 2 at 300 XP and not at 299", () => {
    const state = table();
    expect(award(state, { amount: 299 }).ready).toEqual([]);
    expect(actor(state, LYRA).experiencePoints).toBe(299);
    expect(award(state, { amount: 1 }).ready).toEqual([{ actorId: LYRA, name: "Lyra", level: 2 }]);
  });

  it("starts a character's total at the least XP its level needs", () => {
    const state = table();
    award(state, { recipientIds: [BORIN], amount: 100 });
    expect(actor(state, BORIN).experiencePoints).toBe(2700 + 100);
  });

  it("shares the defeated creatures' stat block XP evenly, at the lair XP for one in its lair", () => {
    const state = table();
    const shared = award(state, { recipientIds: [LYRA, BORIN], defeatedIds: [GOBLIN, DRAGON] });
    expect(shared.creatures).toBe(50 + 18000);
    expect(shared.each).toBe(9025);
    const lair = award(table(), { recipientIds: [LYRA, BORIN], defeatedIds: [DRAGON], inLairIds: [DRAGON] });
    expect(lair.creatures).toBe(20000);
  });

  it("takes XP back with a negative amount, never below 0", () => {
    const state = table();
    award(state, { amount: 100 });
    award(state, { amount: -500 });
    expect(actor(state, LYRA).experiencePoints).toBe(0);
  });

  it("refuses a player character as a defeated creature and a monster as a recipient", () => {
    expect(() => award(table(), { defeatedIds: [BORIN] })).toThrow(/creatures the party overcame/);
    expect(() => award(table(), { recipientIds: [GOBLIN] })).toThrow(/player characters/);
  });

  it("reaches the owner's projection", () => {
    const state = table();
    award(state, { amount: 450 });
    expect(projectPlayerView(state, OWNER, () => "online").actors[0]!.experiencePoints).toBe(450);
    expect(
      projectPlayerView(state, "30000000-0000-4000-8000-0000000000a2", () => "online").actors[0]!.experiencePoints
    ).toBeUndefined();
  });
});

describe("awarding XP over the API", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("is the GM's", async () => {
    const { server, gmToken, post, close } = await bootServer(table());
    cleanups.push(close);
    const player = server.auth.issuePlayerSession();
    const body = { commandId: randomUUID(), actorIds: [LYRA], amount: 300 };
    expect((await post(GAME_PATHS.awardExperience, player, body)).status).toBe(403);
    const answered = await post(GAME_PATHS.awardExperience, gmToken, { ...body, commandId: randomUUID() });
    expect(answered.status).toBe(200);
    expect((await answered.json()).data).toMatchObject({ each: 300, ready: [{ actorId: LYRA, level: 2 }] });
  });
});
