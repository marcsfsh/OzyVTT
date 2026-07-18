import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { BUILTIN_ACTIONS } from "../src/builtin-actions.js";
import { EffectAddSchema } from "../src/game-commands.js";

/**
 * The builtin catalog is engine behavior expressed in the content vocabulary: every entry must parse
 * through ActionSchema (via a wrapper definition) so the catalog can never drift from the schema,
 * and its ids are a frozen replay contract.
 */
describe("builtin action catalog", () => {
  it("every entry parses through ActionSchema", () => {
    const wrapper = {
      schemaId: "vtt.actor-monster",
      schemaVersion: 1,
      source: { name: "builtin", version: "1" },
      name: "Builtin Carrier",
      size: "medium",
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      armorClass: 10,
      hitPoints: { maximum: 1 },
      speedFeet: 30,
      actions: BUILTIN_ACTIONS
    };
    const parsed = ActorDefinitionSchema.safeParse(wrapper);
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("keeps the frozen id set (journal replay contract)", () => {
    expect(BUILTIN_ACTIONS.map((action) => action.id).sort()).toEqual([
      "dash", "disengage", "dodge", "escape-grapple", "help", "hide", "influence", "magic",
      "ready", "search", "study", "unarmed-grapple", "unarmed-shove-prone", "unarmed-shove-push", "unarmed-strike", "utilize"
    ]);
  });

  // The modifier union is duplicated across schemas / EffectAddSchema / OpenAPI; this pins the
  // command-side copy against every schema variant so the two can't drift.
  it("EffectAddSchema accepts every EffectModifierSchema variant", () => {
    const samples = [
      { type: "damage-bonus", amount: 2, appliesTo: "melee" },
      { type: "damage-resistance", damageTypes: ["fire"] },
      { type: "attack-advantage" },
      { type: "incoming-attack-advantage" },
      { type: "attack-disadvantage" },
      { type: "incoming-attack-disadvantage" },
      { type: "save-advantage", ability: "dex" },
      { type: "save-advantage" },
      { type: "save-disadvantage", ability: "str" }
    ];
    for (const sample of samples) {
      const parsed = EffectAddSchema.safeParse({ commandId: "50000000-0000-4000-8000-000000000001", actorId: "10000000-0000-4000-8000-000000000001", name: "Test", modifiers: [sample] });
      expect(parsed.success, parsed.success ? JSON.stringify(sample) : JSON.stringify(parsed.error.issues)).toBe(true);
    }
  });
});
