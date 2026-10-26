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
      // Steady Aim, only before moving: what the turn's movement has done.
      ["movement.already-moved", "movement"],
      // Where and when a creature may move, and how: the GM's to waive with the rest of movement.
      ["movement.off-turn", "movement"],
      ["movement.teleport", "movement"],
      ["movement.occupied", "movement"],
      ["movement.no-speed", "movement"],
      ["movement.blocked-path", "movement"],
      // Hideous Laughter: standing up is movement the effect holds back.
      ["movement.cant-stand", "movement"],
      ["movement.altitude", "movement"],
      ["movement.jump", "movement"],
      ["movement.toward-fear", "movement"],
      ["movement.mount", "movement"],
      // Dropping Prone on another's turn, and moving past a climbing anchor's tether.
      ["movement.drop-prone", "movement"],
      ["movement.tether", "movement"],
      // A controlled mount's action: what it may take is the economy of its turn.
      ["mount.controlled", "economy"],
      ["economy.action-used", "economy"],
      ["action.underwater-only", "economy"],
      ["economy.bonus-action-used", "economy"],
      ["economy.reaction-used", "economy"],
      ["economy.not-your-turn", "economy"],
      ["economy.turn-start", "economy"],
      ["economy.attack-action", "economy"],
      ["economy.heavy-armor", "economy"],
      // Giving back a spent action, Bonus Action or Reaction lets a creature act twice.
      ["economy.spent-slot", "economy"],
      // No one acts while a wait-mode fight gathers initiative: the turn economy hasn't begun.
      ["initiative.gathering", "economy"],
      // Being incapacitated or down is "you have no actions": an economy rule.
      ["condition.incapacitated", "economy"],
      ["condition.down", "economy"],
      // Ending what someone else imposed skips the action or save its rules ask for; a raging Barbarian can't cast.
      ["condition.imposed", "economy"],
      ["condition.raging", "economy"],
      // An effect that takes away Reactions (Slow) is "you have no reaction", like Incapacitated.
      ["condition.no-reactions", "economy"],
      ["condition.no-spells", "economy"],
      // What an effect leaves its bearer able to do on a turn (Gaseous Form's no attacks, Abjure Foes' one thing,
      // Command's Flee): like Slow's no Reactions.
      ["condition.cant-attack", "economy"],
      ["condition.dash-only", "economy"],
      ["condition.one-thing-a-turn", "economy"],
      ["legendary.own-turn", "economy"],
      ["legendary.after-a-turn", "economy"],
      // An extra attack waits on the swing that opens it: a matter of what this turn has done.
      ["attack.light-needs-attack", "economy"],
      ["attack.cleave-needs-hit", "economy"],
      // Reckless Attack after the turn's first attack roll: what this turn has done.
      ["attack.after-first-roll", "economy"],
      // A Loading weapon fires once per action: what this action has already done.
      ["attack.loading", "economy"],
      // Running out of ammunition: what the character carries, like the hands rule.
      ["attack.no-ammunition", "economy"],
      // What the character's hands are holding, like what the action has already done.
      ["attack.two-handed", "economy"],
      // Casting in untrained armor: what the character can do at all, like the hands rule.
      ["spell.untrained-armor", "economy"],
      // A familiar that can't attack, and a command beyond its reach, are what summoning costs a creature.
      ["summon.cant-attack", "economy"],
      ["summon.command", "economy"],
      // A scroll whose spell the reader's lists lack: what the character can do at all.
      ["spell.scroll-unreadable", "economy"],
      // A later-turn spell action on the turn of its cast: what this turn has done.
      ["spell.later-turn", "economy"],
      // Sneak Attack or a smite taken alone, with no hit to add to.
      ["attack.rides-a-hit", "economy"],
      ["roll.answers-a-roll", "economy"],
      ["feature.no-uses-remaining", "resources"],
      ["feature.requires-effect", "resources"],
      // A form keeps its creature from casting, acting or attacking, or from an action printed for another form.
      ["form.no-spells", "economy"],
      ["form.no-actions", "economy"],
      ["form.no-attacks", "economy"],
      ["form.wrong-form", "economy"],
      // Action Surge with two uses, Stunning Strike: once on a turn, a spent per-turn limit.
      ["feature.once-per-turn", "resources"],
      ["legendary.no-actions-remaining", "resources"],
      // "Can't take this action again until the start of its next turn": spent for the round.
      ["legendary.once-per-round", "resources"],
      ["range.out-of-range", "targeting"],
      ["range.out-of-reach", "targeting"],
      ["range.underwater", "targeting"],
      ["target.grappled-by-source", "targeting"],
      ["target.too-large-to-grapple", "targeting"],
      // Help distracts an enemy: never the helper or an ally.
      ["target.not-an-enemy", "targeting"],
      // Hunter's Mark and Hex move from a creature at 0 Hit Points only: whom the action may target.
      ["target.mark-still-standing", "targeting"],
      ["cover.total", "targeting"],
      // Hiding in an enemy's sight: where the creature stands relative to the others, like cover.
      ["hide.seen", "targeting"],
      ["hide.exposed", "targeting"],
      ["light.too-bright", "targeting"],
      ["condition.charmed-charmer", "targeting"],
      ["target.too-many", "targeting"],
      // Whom a spell may pick: a creature of a type it targets, one the caster sees, all in one of its areas.
      ["target.wrong-type", "targeting"],
      ["target.unseen", "targeting"],
      ["target.outside-area", "targeting"],
      // A creature the action can't affect (Turn Undead on a goblin, a flask's Holy Water on a bandit).
      ["target.not-allowed", "targeting"],
      // A revival spell aimed at a creature it can't bring back (Revivify on one dead an hour).
      ["target.revival", "targeting"],
      ["attack.cleave-same-target", "targeting"],
      ["attack.cleave-too-far", "targeting"],
      // The hit can't carry the extra: no Advantage or ally for Sneak Attack, no melee weapon for a smite.
      ["attack.hit-option-unqualified", "targeting"],
      // "Don't police spell slots or prepared spells" relaxes exactly these.
      ["slots.none-remaining", "slots"],
      ["slots.below-spell-level", "slots"],
      ["slots.one-per-turn", "slots"],
      ["slots.not-prepared", "slots"],
      // Metamagic shapes a cast: spellcasting rules, its picks' creatures a cast's targeting, its own row a rider.
      ["metamagic.unknown", "slots"],
      ["metamagic.unfit", "slots"],
      ["metamagic.too-many", "slots"],
      ["metamagic.quickened", "slots"],
      ["metamagic.choice", "targeting"],
      ["metamagic.with-a-cast", "economy"],
      // "Check spell components" relaxes speech, hands and materials alone.
      ["spell.no-verbal", "components"],
      ["spell.no-free-hand", "components"],
      ["spell.no-material", "components"]
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
    // Untouched families keep the dial: relaxing movement must not relax the action economy.
    expect(effectiveModeFor(state.combat, "economy.action-used")).toBe("strict");
    expect(effectiveModeFor(state.combat, "cover.total")).toBe("strict");
  });

  it("has spell slots follow the campaign's dial like every other family", () => {
    const fresh = GameStateSchema.parse({ schemaVersion: 1 });
    expect(fresh.combat.ruleExceptions).toEqual({});
    expect(fresh.rulesPolicy).toEqual({ dial: "strict", exceptions: {} });
    expect(effectiveModeFor(fresh.combat, "slots.none-remaining")).toBe("strict");
    const advised = stateWith({ rulesMode: "assisted", ruleExceptions: {} });
    expect(effectiveModeFor(advised.combat, "slots.none-remaining")).toBe("assisted");
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
  it("is optional (one tap, never a mandatory modal) and audits as a plain GM override", () => {
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
