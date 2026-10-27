import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { startEncounter } from "../src/encounter.js";
import { CommandRejectedError } from "../src/game-store.js";
import { projectPlayerView } from "../src/projections.js";
import { answerReaction } from "../src/reactions.js";

// SRD 5.2.1 reactions that change an attack's target, or its target's AC, as it is made: the Goblin Boss's Redirect
// Attack ("The goblin and that ally swap places, and the ally becomes the target of the attack instead"), an
// Arrow-Catching Shield ("you can take a Reaction to become the target of the attack instead") and a Shield
// Guardian's Protection ("The wearer gains a +5 bonus to AC, including against the triggering attack").

const IDS = {
  fighter: "11000000-0000-4000-8000-000000000001",
  boss: "11000000-0000-4000-8000-000000000002",
  goblin: "11000000-0000-4000-8000-000000000003",
  catcher: "11000000-0000-4000-8000-000000000004",
  ally: "11000000-0000-4000-8000-000000000005",
  guardian: "11000000-0000-4000-8000-000000000006",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  player: "30000000-0000-4000-8000-0000000000b1",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
type Who = Exclude<keyof typeof IDS, "gmSession" | "player" | "map">;

const monster = (id: string) => loadMonsterDefinitions().find((entry) => entry.source.externalId === id)!;

function definition(name: string, actions: readonly object[], size = "medium"): ActorDefinition {
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: name.toLowerCase() },
    name,
    size,
    abilityScores: { str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 14 },
    proficiencyBonus: 2,
    armorClass: 12,
    hitPoints: { maximum: 40 },
    speedFeet: 30,
    actions
  });
}

const BOW = {
  id: "shortbow",
  name: "Shortbow",
  activation: "action",
  description: "A test action.",
  attack: { bonus: 5, rangeFeet: 320, rangeNormalFeet: 80 },
  damage: [{ formula: "1d6 + 3", type: "piercing" }]
};
const SWORD = {
  id: "longsword",
  name: "Longsword",
  activation: "action",
  description: "A test action.",
  attack: { bonus: 5, reachFeet: 5 },
  damage: [{ formula: "1d8 + 3", type: "slashing" }]
};
const DEFINITIONS: Readonly<Record<Who, ActorDefinition>> = {
  fighter: definition("Corin", [SWORD, BOW]),
  boss: monster("goblin-boss"),
  goblin: definition("Snik", [], "small"),
  catcher: definition("Hale", [
    {
      id: "catch-the-attack",
      name: "Arrow-Catching Shield",
      activation: "reaction",
      description: "A test action.",
      damage: [],
      reaction: { trigger: "other-targeted-by-attack", response: "become-target", rangeFeet: 5, ranged: true }
    }
  ]),
  ally: definition("Bran", []),
  guardian: monster("shield-guardian")
};
const ACTORS: Readonly<Record<Who, Readonly<{ name: string; kind: string; armorClass: number }>>> = {
  fighter: { name: "Corin", kind: "player-character", armorClass: 16 },
  boss: { name: "Goblin Boss", kind: "monster", armorClass: 17 },
  goblin: { name: "Snik", kind: "monster", armorClass: 13 },
  catcher: { name: "Hale", kind: "player-character", armorClass: 18 },
  ally: { name: "Bran", kind: "player-character", armorClass: 12 },
  guardian: { name: "Shield Guardian", kind: "monster", armorClass: 17 }
};

/** The combatants in a live encounter on a measured map, the first one's turn; `cells` places them on a row. */
function buildGame(order: readonly Who[], cells: Readonly<Partial<Record<Who, number>>>): GameState {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: order.map((who) => ({
      id: IDS[who],
      name: ACTORS[who].name,
      kind: ACTORS[who].kind,
      visibility: "public",
      hp: { current: 60, maximum: 60 },
      armorClass: ACTORS[who].armorClass,
      definitionId: `def-${who}`,
      size: who === "goblin" || who === "boss" ? "small" : "medium",
      speedFeet: 30
    })),
    definitions: order.map((who) => ({ id: `def-${who}`, definition: DEFINITIONS[who] }))
  });
  startEncounter(
    game,
    { mapAssetId: IDS.map, entries: order.map((who, index) => ({ actorId: IDS[who], score: 20 - index })) },
    () => 1,
    { width: 900, height: 600, calibration: null },
    lookup(game)
  );
  game.combat.tokens = game.combat.tokens.map((token) => {
    const who = (Object.keys(IDS) as Who[]).find((key) => IDS[key] === token.actorId)!;
    return { ...token, position: { x: 25 + 50 * (cells[who] ?? 0), y: 25 } };
  });
  return game;
}

let counter = 0;
const nextId = () => `52000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
const lookup = (game: GameState) => (definitionId: string) =>
  game.definitions.find((entry) => entry.id === definitionId)?.definition;
const dice = (faces: number[]) => () => faces.shift() ?? 1;
/** Five feet a cell along the row the tokens stand on. */
const distance = (game: GameState) => (a: string, b: string) => {
  const at = (id: string) => game.combat.tokens.find((token) => token.actorId === id)?.position?.x;
  const [x, y] = [at(a), at(b)];
  return x === undefined || y === undefined ? null : (Math.abs(x - y) / 50) * 5;
};
const actor = (game: GameState, who: Who) => game.actors.find((candidate) => candidate.id === IDS[who])!;
const cellOf = (game: GameState, who: Who) =>
  (game.combat.tokens.find((token) => token.actorId === IDS[who])!.position!.x - 25) / 50;

function attack(game: GameState, actionId: string, target: Who, faces: number[]) {
  const action = DEFINITIONS.fighter.actions.find((candidate) => candidate.id === actionId)!;
  return resolveDefinitionAction(
    game,
    action,
    { actorId: IDS.fighter, targetIds: [IDS[target]], commandId: nextId(), commit: true },
    {
      random: dice(faces),
      newRollId: nextId,
      gmSessionId: IDS.gmSession,
      now: () => "2026-10-19T00:00:00.000Z",
      definition: DEFINITIONS.fighter,
      resolveDefinition: lookup(game),
      distanceFeet: distance(game)
    }
  );
}

function answer(game: GameState, use: boolean, faces: number[], redirectTo?: string) {
  return answerReaction(
    game,
    nextId(),
    game.combat.pendingReactions[0]!.id,
    use,
    undefined,
    { role: "gm" },
    {
      resolveDefinition: lookup(game),
      random: dice(faces),
      newRollId: nextId,
      gmSessionId: IDS.gmSession,
      now: () => "2026-10-19T00:00:00.000Z",
      distanceFeet: distance(game)
    },
    redirectTo ? { redirectTo } : {}
  );
}

describe("Redirect Attack: the Goblin Boss hands an attack to a Small or Medium ally within 5 feet", () => {
  const ambush = () => buildGame(["fighter", "boss", "goblin"], { fighter: 0, boss: 1, goblin: 2 });

  it("holds the attack before its roll, with the action spent, and offers the ally", () => {
    const game = ambush();
    const resolution = attack(game, "longsword", "boss", [15]);
    expect(resolution.waitingOnReaction).toBe(true);
    expect(resolution.attack ?? null).toBeNull();
    expect(game.combat.turn.actionUsed).toBe(true);
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "attack-targeted",
      actorId: IDS.boss,
      actionName: "Redirect Attack",
      targetActorId: IDS.boss,
      redirectChoices: [{ actorId: IDS.goblin, name: "Snik" }]
    });
  });

  it("swaps the two, and the attack rolls at the ally", () => {
    const game = ambush();
    attack(game, "longsword", "boss", []);
    const outcome = answer(game, true, [15, 4], IDS.goblin);
    expect(outcome.resolution?.attack).toMatchObject({ targetName: "Snik", total: 20, outcome: "hit" });
    expect([cellOf(game, "boss"), cellOf(game, "goblin")]).toEqual([2, 1]);
    expect(actor(game, "goblin").hp.current).toBeLessThan(60);
    expect(actor(game, "boss").hp.current).toBe(60);
    expect(game.combat.reactionsUsed).toContain(IDS.boss);
  });

  it("rolls at the boss when it lets the attack come", () => {
    const game = ambush();
    attack(game, "longsword", "boss", []);
    const outcome = answer(game, false, [15, 4]);
    expect(outcome.resolution?.attack).toMatchObject({ targetName: "Goblin Boss" });
    expect([cellOf(game, "boss"), cellOf(game, "goblin")]).toEqual([1, 2]);
  });

  it("isn't offered with no ally within 5 feet", () => {
    const game = buildGame(["fighter", "boss", "goblin"], { fighter: 0, boss: 1, goblin: 4 });
    const resolution = attack(game, "longsword", "boss", [15, 4]);
    expect(resolution.attack).toMatchObject({ targetName: "Goblin Boss" });
    expect(game.combat.pendingReactions).toEqual([]);
  });

  it("refuses an ally the prompt didn't offer", () => {
    const game = ambush();
    attack(game, "longsword", "boss", []);
    expect(() => answer(game, true, [15, 4], IDS.fighter)).toThrow(CommandRejectedError);
  });
});

describe("Arrow-Catching Shield: its wielder takes a ranged attack meant for a creature within 5 feet", () => {
  const volley = () => buildGame(["fighter", "catcher", "ally"], { fighter: 0, catcher: 7, ally: 8 });

  it("is offered before a ranged attack's roll and makes the wielder the target", () => {
    const game = volley();
    attack(game, "shortbow", "ally", []);
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "attack-targeted",
      actorId: IDS.catcher,
      targetActorId: IDS.ally,
      targetName: "Bran"
    });
    const outcome = answer(game, true, [10, 3]);
    expect(outcome.resolution?.attack).toMatchObject({ targetName: "Hale", total: 15, outcome: "miss" });
    expect(actor(game, "ally").hp.current).toBe(60);
  });

  it("isn't offered against a melee attack", () => {
    const game = buildGame(["fighter", "catcher", "ally"], { fighter: 7, catcher: 9, ally: 8 });
    attack(game, "longsword", "ally", [10, 3]);
    expect(game.combat.pendingReactions).toEqual([]);
  });

  it("shows the wielder's player the creature the attack was meant for", () => {
    const game = volley();
    actor(game, "catcher").ownerSessionId = IDS.player;
    attack(game, "shortbow", "ally", []);
    const [prompt] = projectPlayerView(game, IDS.player, () => null).combat.pendingReactions;
    expect(prompt).toMatchObject({ kind: "attack-targeted", targetName: "Bran" });
    expect(prompt).not.toHaveProperty("parkedAttack");
  });
});

describe("Shield Guardian's Protection: +5 AC for the amulet's wearer within 5 feet", () => {
  function guarded(guardianCell: number) {
    const game = buildGame(["fighter", "ally", "guardian"], { fighter: 0, ally: 1, guardian: guardianCell });
    actor(game, "guardian").control = { by: IDS.ally, side: "party" };
    return game;
  }

  it("is offered when a hit on the wearer would miss with it, and turns the hit into a miss", () => {
    const game = guarded(2);
    // 10 + 5 = 15 hits AC 12; AC 17 would turn it.
    const resolution = attack(game, "longsword", "ally", [10]);
    expect(resolution.waitingOnReaction).toBe(true);
    expect(game.combat.pendingReactions[0]).toMatchObject({
      kind: "attack-would-hit",
      actorId: IDS.guardian,
      targetActorId: IDS.ally,
      acBonus: 5
    });
    const outcome = answer(game, true, []);
    expect(outcome.resolution?.attack).toMatchObject({ targetName: "Bran", outcome: "miss" });
    expect(actor(game, "ally").effects).toContainEqual(
      expect.objectContaining({
        name: "Protection",
        armorClassBonus: 5,
        sourceActorId: IDS.guardian,
        duration: expect.objectContaining({ type: "until-source-next-turn" })
      })
    );
  });

  it("isn't offered with the wearer beyond 5 feet of the guardian", () => {
    const game = guarded(5);
    attack(game, "longsword", "ally", [10, 3]);
    expect(game.combat.pendingReactions).toEqual([]);
  });
});
