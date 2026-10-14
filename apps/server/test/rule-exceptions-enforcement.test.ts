import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState, type RuleExceptions } from "@vtt/domain";
import { applyMovementRules } from "../src/movement-rules.js";
import { setCondition } from "../src/actor-conditions.js";
import { RulesBlockedError } from "../src/game-store.js";

// A GM can switch one rules family off without switching the rest off with it. These exercise the
// movement and economy enforcement sites directly, without HTTP or map assets.

const IDS = {
  hero: "10000000-0000-4000-8000-0000000000e1",
  goblin: "10000000-0000-4000-8000-0000000000e2"
} as const;

/** A live fight where the hero is up, has a 30 ft speed, and has already spent all of it. */
function fight(
  ruleExceptions: RuleExceptions,
  movementUsedFeet = 30,
  conditions: ReadonlyArray<{ id: string }> = []
): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 20, maximum: 20 },
        speedFeet: 30,
        conditions
      },
      { id: IDS.goblin, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 7, maximum: 7 } }
    ],
    combat: {
      active: true,
      round: 1,
      turnActorId: IDS.hero,
      rulesMode: "strict",
      ruleExceptions,
      initiative: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.goblin, score: 5 }
      ],
      tokens: [
        { actorId: IDS.hero, position: { x: 100, y: 100 }, sizePx: 40 },
        { actorId: IDS.goblin, position: { x: 900, y: 900 }, sizePx: 40 }
      ],
      turn: { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet }
    }
  });
}

/** One 30 ft step (5 px per foot), which overruns a hero who has already spent their whole Speed. */
const step = (game: GameState, override: Readonly<{ reason?: string }> | null = null) =>
  applyMovementRules(game, {
    actorId: IDS.hero,
    from: { x: 100, y: 100 },
    to: { x: 250, y: 100 },
    distance: (a, b) => Math.abs(b.x - a.x) / 5,
    override,
    resolveDefinition: () => undefined,
    newPromptId: () => "70000000-0000-4000-8000-000000000f99",
    now: () => 0,
    commandId: "80000000-0000-4000-8000-000000000f99"
  });

describe("per-family rule exceptions at the enforcement sites", () => {
  it("blocks an overrun move under a strict dial with no exceptions (today's behaviour, unchanged)", () => {
    expect(() => step(fight({}))).toThrow(RulesBlockedError);
  });

  it("lets the overrun through when the GM switches movement policing off, without touching the dial", () => {
    const game = fight({ movement: "freeform" });
    expect(() => step(game)).not.toThrow();
    // Off means off: not a warning either, and the budget is not accumulated.
    expect(step(game).warning).toBeNull();
  });

  it("warns instead of blocking when movement is set to advise", () => {
    const outcome = step(fight({ movement: "assisted" }));
    expect(outcome.warning).toMatch(/movement left/);
  });

  it("keeps policing everything else when movement is off", () => {
    // Standing from Prone is a movement cost, so it follows the movement family too...
    const relaxed = fight({ movement: "freeform" }, 30, [{ id: "prone" }]);
    expect(() => setCondition(relaxed, IDS.hero, "prone", false, undefined, { role: "gm" })).not.toThrow();
    // ...while the same table with movement left on still blocks it.
    const strict = fight({}, 30, [{ id: "prone" }]);
    expect(() => setCondition(strict, IDS.hero, "prone", false, undefined, { role: "gm" })).toThrow(
      /Standing up costs/
    );
  });

  it("remembers a movement override for the rest of the turn, so the next step is not re-blocked", () => {
    const game = fight({});
    // The GM allows the first overrun with no reason at all.
    const allowed = step(game, {});
    expect(allowed.overridden).toBe("GM override");
    expect(game.combat.turn.rulesOverriddenFamilies).toEqual(["movement"]);
    // The next step needs no second Allow...
    expect(() => step(game)).not.toThrow();
    // ...but the memory is scoped to movement: another family is untouched by it.
    expect(game.combat.turn.rulesOverridden).toBe(true);
  });

  it("remembers a stand-up override the same way (movement overrides used to be forgotten entirely)", () => {
    const game = fight({}, 30, [{ id: "prone" }]);
    setCondition(
      game,
      IDS.hero,
      "prone",
      false,
      undefined,
      { role: "gm" },
      { override: { reason: "he's had enough" } }
    );
    expect(game.combat.turn.rulesOverriddenFamilies).toEqual(["movement"]);
    expect(() => step(game)).not.toThrow();
  });
});
