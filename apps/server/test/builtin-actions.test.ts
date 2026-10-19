import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { BUILTIN_ACTIONS, BUILTIN_TARGETING, builtinActionsFor, builtinBaseId } from "../src/builtin-actions.js";
import { EffectAddSchema } from "@vtt/domain/commands";

// The builtin catalog is engine behavior expressed in the content vocabulary: every entry must parse
// through ActionSchema (via a wrapper definition) so the catalog can never drift from the schema,
// and its ids are a frozen replay contract.
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
      "dash",
      "disengage",
      "dodge",
      "end-an-effect",
      "escape-grapple",
      "extinguish-fire",
      "help",
      "help-check",
      "hide",
      "improvised-weapon",
      "improvised-weapon-thrown",
      "influence",
      "magic",
      "ready",
      "search",
      "shake-awake",
      "study",
      "unarmed-grapple",
      "unarmed-shove-prone",
      "unarmed-shove-push",
      "unarmed-strike",
      "utilize"
    ]);
  });

  // A feature's Bonus Action forms are journaled by id like the catalog's, and resolve through the same schema.
  it("derives the Bonus Action forms a feature gives as `<id>-bonus` rows that parse through ActionSchema", () => {
    const rogueMonk = ActorDefinitionSchema.parse({
      schemaId: "vtt.actor-character",
      schemaVersion: 1,
      source: { name: "test", version: "1" },
      name: "Rogue Monk",
      size: "medium",
      abilityScores: { str: 10, dex: 16, con: 10, int: 10, wis: 14, cha: 10 },
      proficiencyBonus: 2,
      armorClass: 15,
      hitPoints: { maximum: 12 },
      speedFeet: 30,
      actions: [],
      token: { disposition: "friendly" },
      character: {
        classes: [{ id: "rogue", name: "Rogue", level: 2 }],
        features: [
          { id: "cunning-action", kind: "class", sourceId: "rogue" },
          { id: "martial-arts", kind: "class", sourceId: "monk" }
        ]
      }
    });
    const forms = builtinActionsFor(rogueMonk).filter((action) => action.activation === "bonus-action");
    expect(forms.map((action) => action.id)).toEqual([
      "dash-bonus",
      "disengage-bonus",
      "hide-bonus",
      "unarmed-strike-bonus",
      "unarmed-grapple-bonus",
      "unarmed-shove-prone-bonus",
      "unarmed-shove-push-bonus"
    ]);
    expect(forms.every((action) => BUILTIN_TARGETING[action.id] === BUILTIN_TARGETING[builtinBaseId(action.id)])).toBe(
      true
    );
    const parsed = ActorDefinitionSchema.safeParse({ ...rogueMonk, actions: forms });
    expect(parsed.success, parsed.success ? undefined : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  // The GM's house effect takes the same vocabulary a granted effect does, gates included.
  it("EffectAddSchema takes the shared effect modifiers and refuses what an effect cannot give back", () => {
    const accepts = (modifier: object) =>
      EffectAddSchema.safeParse({
        commandId: "50000000-0000-4000-8000-000000000001",
        actorId: "10000000-0000-4000-8000-000000000001",
        name: "Test",
        modifiers: [modifier]
      }).success;
    expect(
      accepts({
        type: "roll-mode",
        roll: "save",
        mode: "advantage",
        when: [{ type: "on-saving-throw" }, { type: "ability-is", abilities: ["dex"] }]
      })
    ).toBe(true);
    expect(accepts({ type: "damage-resistance", damageTypes: ["fire"] })).toBe(true);
    expect(accepts({ type: "attack-bonus", amount: 1, when: [{ type: "while-effect-tag", tags: ["raging"] }] })).toBe(
      true
    );
    expect(accepts({ type: "armor-class", amount: 2 })).toBe(false);
    expect(accepts({ type: "attack-advantage" })).toBe(false);
  });
});
