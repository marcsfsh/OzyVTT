import { describe, expect, it } from "vitest";
import { GameStateSchema, RuleFamilySchema, type GameState, type RuleFamily } from "@vtt/domain";
import { ActorDefinitionSchema, type ActorAction } from "@vtt/schemas";
import { loadActorFixture } from "@vtt/test-fixtures";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { RulesBlockedError } from "../src/game-store.js";
import {
  effectiveModeFor,
  familyModeFor,
  familyOf,
  overrideCovers,
  overrideReason,
  rememberOverride,
  RULE_IDS,
  type RuleId,
  type RulesOverride
} from "../src/rules-families.js";

// Two properties of the rule-family map:
// 1. Totality: every rule id is a typed entry with a family, so raising an unlisted id fails to compile.
// 2. Precedence: a family exception beats the dial, and an absent family follows it.

function stateWith(combat: Partial<GameState["combat"]>): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, combat });
}

describe("rule families", () => {
  it("gives every rule id a family from the wire vocabulary", () => {
    expect(RULE_IDS.length).toBeGreaterThanOrEqual(15);
    for (const rule of RULE_IDS) {
      expect(rule).toMatch(/^[a-z]+\.[a-z-]+$/);
      expect(RuleFamilySchema.safeParse(familyOf(rule)).success, rule).toBe(true);
    }
  });

  it("puts each rule id in the family a GM would expect to switch off", () => {
    const expected: ReadonlyArray<readonly [RuleId, RuleFamily]> = [
      ["movement.exceeds-speed", "movement"],
      ["movement.no-movement-remaining", "movement"],
      ["movement.stand-up-cost", "movement"],
      // Standing spends movement, which only your own turn has.
      ["movement.stand-up-off-turn", "movement"],
      ["economy.action-used", "economy"],
      ["economy.bonus-action-used", "economy"],
      ["economy.reaction-used", "economy"],
      ["economy.not-your-turn", "economy"],
      // No one acts while a wait-mode fight gathers initiative: the turn economy hasn't begun.
      ["initiative.gathering", "economy"],
      // Being incapacitated or down is "you have no actions" - economy, not a targeting rule.
      ["condition.incapacitated", "economy"],
      ["condition.down", "economy"],
      // Ending what someone else imposed skips the action or save its rules ask for; a raging Barbarian can't cast.
      ["condition.imposed", "economy"],
      ["condition.raging", "economy"],
      ["legendary.own-turn", "economy"],
      // An extra attack waits on the swing that opens it: a matter of what this turn has done.
      ["attack.light-needs-attack", "economy"],
      ["attack.cleave-needs-hit", "economy"],
      // A Loading weapon fires once per action: what this action has already done.
      ["attack.loading", "economy"],
      // Running out of ammunition: what the character carries, like the hands rule.
      ["attack.no-ammunition", "economy"],
      // What the character's hands are holding, like what the action has already done.
      ["attack.two-handed", "economy"],
      // Casting in untrained armor: what the character can do at all, like the hands rule.
      ["spell.untrained-armor", "economy"],
      // A scroll whose spell the reader's lists lack: what the character can do at all.
      ["spell.scroll-unreadable", "economy"],
      // Sneak Attack or a smite taken alone, with no hit to add to.
      ["attack.rides-a-hit", "economy"],
      ["feature.no-uses-remaining", "resources"],
      ["feature.requires-effect", "resources"],
      ["feature.no-spell-slot", "resources"],
      ["legendary.no-actions-remaining", "resources"],
      ["range.out-of-range", "targeting"],
      ["range.out-of-reach", "targeting"],
      ["range.underwater", "targeting"],
      ["target.grappled-by-source", "targeting"],
      ["target.too-large-to-grapple", "targeting"],
      ["cover.total", "targeting"],
      ["condition.charmed-charmer", "targeting"],
      ["attack.cleave-same-target", "targeting"],
      ["attack.cleave-too-far", "targeting"],
      // The hit can't carry the extra: no Advantage or ally for Sneak Attack, no melee weapon for a smite.
      ["attack.hit-option-unqualified", "targeting"],
      // Not thrown yet, but the family is already part of the wire vocabulary.
      ["slots.none-remaining", "slots"]
    ];
    for (const [rule, family] of expected) expect(familyOf(rule), rule).toBe(family);
    expect(expected.map(([rule]) => rule).sort()).toEqual([...RULE_IDS].sort());
  });
});

describe("effective mode", () => {
  it("follows the dial when the family has no exception", () => {
    const state = stateWith({ rulesMode: "assisted", ruleExceptions: {} });
    expect(effectiveModeFor(state.combat, "economy.action-used")).toBe("assisted");
    expect(familyModeFor(state.combat, "movement")).toBe("assisted");
  });

  it("lets a family exception beat the dial in both directions", () => {
    const state = stateWith({ rulesMode: "strict", ruleExceptions: { movement: "freeform", slots: "strict" } });
    expect(effectiveModeFor(state.combat, "movement.exceeds-speed")).toBe("freeform");
    expect(effectiveModeFor(state.combat, "slots.none-remaining")).toBe("strict");
    // Untouched families keep the dial - relaxing movement must not relax the action economy.
    expect(effectiveModeFor(state.combat, "economy.action-used")).toBe("strict");
    expect(effectiveModeFor(state.combat, "cover.total")).toBe("strict");
  });

  it("defaults spell slots to advisory so new enforcement cannot silently start blocking old saves", () => {
    const fresh = GameStateSchema.parse({ schemaVersion: 1 });
    expect(fresh.combat.ruleExceptions).toEqual({ slots: "assisted" });
    expect(fresh.rulesPolicy).toEqual({ dial: "strict", exceptions: { slots: "assisted" } });
    expect(effectiveModeFor(fresh.combat, "slots.none-remaining")).toBe("assisted");
  });
});

describe("per-turn override memory", () => {
  it("remembers the whole family, so the same kind of block stops re-prompting this turn", () => {
    const state = stateWith({ rulesMode: "strict" });
    expect(overrideCovers(state.combat.turn, "economy.action-used")).toBe(false);
    rememberOverride(state, "economy.action-used");
    expect(overrideCovers(state.combat.turn, "economy.action-used")).toBe(true);
    expect(overrideCovers(state.combat.turn, "economy.bonus-action-used")).toBe(true);
    // ...and only that family. Allowing one economy break must not wave through a range violation.
    expect(overrideCovers(state.combat.turn, "range.out-of-range")).toBe(false);
  });

  it("remembers movement overrides", () => {
    const state = stateWith({ rulesMode: "strict" });
    rememberOverride(state, "movement.exceeds-speed");
    expect(overrideCovers(state.combat.turn, "movement.exceeds-speed")).toBe(true);
    expect(overrideCovers(state.combat.turn, "movement.stand-up-cost")).toBe(true);
    expect(state.combat.turn.rulesOverriddenFamilies).toEqual(["movement"]);
  });

  it("does not accumulate duplicates", () => {
    const state = stateWith({ rulesMode: "strict" });
    rememberOverride(state, "economy.action-used");
    rememberOverride(state, "economy.reaction-used");
    expect(state.combat.turn.rulesOverriddenFamilies).toEqual(["economy"]);
  });
});

describe("override reason", () => {
  it("is optional - one tap, never a mandatory modal - and audits as a plain GM override", () => {
    expect(overrideReason(undefined)).toBe("GM override");
    expect(overrideReason(null)).toBe("GM override");
    expect(overrideReason({})).toBe("GM override");
    expect(overrideReason({ reason: "   " })).toBe("GM override");
    expect(overrideReason({ reason: "House rule" })).toBe("House rule");
  });
});

describe("an override waives only its own family", () => {
  // The Hero has spent this turn's action and the War Cry's one use: an economy block and a resources block.
  const HERO = "10000000-0000-4000-8000-0000000000c1";
  const WAR_CRY: ActorAction = {
    id: "war-cry",
    name: "War Cry",
    activation: "action",
    description: "A shout that rallies allies.",
    damage: [],
    uses: { limit: 1, per: "long-rest" }
  };
  const definition = ActorDefinitionSchema.parse({
    ...(loadActorFixture("monster") as object),
    actions: [WAR_CRY]
  });
  const spentTurn = () =>
    GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: HERO,
          name: "Hero",
          kind: "monster",
          visibility: "public",
          hp: { current: 7, maximum: 7 },
          actionUses: { "war-cry": 1 }
        }
      ],
      combat: {
        active: true,
        round: 1,
        turnActorId: HERO,
        rulesMode: "strict",
        initiative: [{ actorId: HERO, score: 10 }],
        turn: {
          actionUsed: true,
          bonusActionUsed: false,
          actionInstance: null,
          bonusActionInstance: null,
          turnUses: {},
          movementUsedFeet: 0
        }
      }
    });
  let command = 0;
  const shout = (state: GameState, override: RulesOverride) =>
    resolveDefinitionAction(
      state,
      WAR_CRY,
      {
        actorId: HERO,
        targetIds: [],
        commandId: `50000000-0000-4000-8000-${String(++command).padStart(12, "0")}`,
        override
      },
      {
        random: () => 1,
        newRollId: () => "40000000-0000-4000-8000-000000000001",
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-15T00:00:00.000Z",
        definition
      }
    );
  const blockedRule = (run: () => unknown): string | null => {
    try {
      run();
      return null;
    } catch (error) {
      return error instanceof RulesBlockedError ? error.rule : String(error);
    }
  };

  it("leaves a resources block standing under an economy override, and the other way round", () => {
    expect(blockedRule(() => shout(spentTurn(), { families: ["economy"] }))).toBe("feature.no-uses-remaining");
    expect(blockedRule(() => shout(spentTurn(), { families: ["resources"] }))).toBe("economy.action-used");
  });

  it("resolves once every blocking family is named, and remembers each for the turn", () => {
    const state = spentTurn();
    const resolution = shout(state, { families: ["economy", "resources"] });
    expect(resolution.overridden?.rule).toBe("feature.no-uses-remaining");
    expect([...(state.combat.turn.rulesOverriddenFamilies ?? [])].sort()).toEqual(["economy", "resources"]);
  });

  it("treats an override naming no family as the GM's own ruling on the whole command", () => {
    expect(blockedRule(() => shout(spentTurn(), { reason: "The GM said so" }))).toBeNull();
  });
});
