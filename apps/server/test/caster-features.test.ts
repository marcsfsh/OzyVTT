import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { applyDamageDetailed } from "../src/hit-points.js";

// SRD 5.2.1 class features that change how a caster's spells work.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const HERO = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e6a";
const FOE = "5d0f3c1e-8a52-4c1b-9b7e-0c6a1f2d3e6b";

/** A generated character of the class and level on a table with one foe, out of a fight. */
function tableWith(classId: string, level: number, subclassId?: string) {
  const definition = buildCharacterDefinition(
    generateCharacterRequest({ classId, level, ...(subclassId ? { subclassId } : {}) }, library, policy, () => 1)
      .request,
    library,
    policy
  );
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: FOE, name: "Foe", kind: "monster", visibility: "public", hp: { current: 60, maximum: 60 } }]
  });
  importActorDefinition(state, definition, HERO, "public", catalog);
  const resolveDefinition = (id: string): ActorDefinition | undefined =>
    id === `import-${HERO}` ? definition : undefined;
  return { state, definition, resolveDefinition, hero: state.actors.find((actor) => actor.id === HERO)! };
}

let minted = 0;
const newId = () => `70000000-0000-4000-8000-${String(++minted).padStart(12, "0")}`;

// Relentless Hunter (Ranger 13): "Taking damage can't break your Concentration on Hunter's Mark."
describe("Relentless Hunter", () => {
  const concentrating = (level: number, tag: string) => {
    const table = tableWith("ranger", level);
    addEffect(
      table.state,
      FOE,
      makeEffect({
        id: newId(),
        name: tag === "hunters-mark" ? "Hunter's Mark" : "Entangled",
        tags: [tag],
        sourceActorId: HERO,
        concentration: true,
        duration: { type: "rounds", remaining: 600 }
      })
    );
    applyDamageDetailed(
      table.state,
      HERO,
      { amount: 20 },
      { role: "gm" },
      {
        resolveDefinition: table.resolveDefinition,
        newId,
        catalog
      }
    );
    return table.state.combat.pendingSaves.length;
  };

  it("opens no Concentration save for a Ranger 13 holding only Hunter's Mark", () => {
    expect(concentrating(13, "hunters-mark")).toBe(0);
  });

  it("still opens one for another spell, and for a Ranger 12", () => {
    expect(concentrating(13, "entangle")).toBe(1);
    expect(concentrating(12, "hunters-mark")).toBe(1);
  });
});

/** Resolves one of the hero's actions with queued dice. */
function cast(table: ReturnType<typeof tableWith>, actionId: string, faces: number[], targetIds: string[] = []) {
  const action = effectiveActions(table.definition, table.hero, catalog).find((entry) => entry.id === actionId);
  if (!action) throw new Error(`no ${actionId}`);
  const deps: ResolveDependencies = {
    random: () => faces.shift() ?? 1,
    newRollId: newId,
    gmSessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-19T00:00:00.000Z",
    definition: table.definition,
    resolveDefinition: table.resolveDefinition,
    catalog
  };
  return resolveDefinitionAction(table.state, action, { actorId: HERO, targetIds, commandId: newId() }, deps);
}

// Contact Patron (Warlock 9): "you can cast the spell without expending a spell slot to contact your patron, and you
// automatically succeed on the spell's saving throw."
describe("Contact Patron", () => {
  it("opens no save for the free Contact Other Plane, and the slot cast still makes one", () => {
    const table = tableWith("warlock", 9);
    const free = cast(table, "spell-contact-other-plane-free", []);
    expect(table.state.combat.pendingSaves).toEqual([]);
    expect(free.warnings?.join(" ")).toMatch(/Contact Patron: .* succeeds on the Intelligence saving throw/);
    const slotted = tableWith("warlock", 9);
    cast(slotted, "spell-contact-other-plane", []);
    expect(slotted.state.combat.pendingSaves.map((save) => save.targetActorId)).toEqual([HERO]);
  });
});

// Potent Cantrip (Evoker 3): "When you cast a cantrip at a creature and you miss with the attack roll or the target
// succeeds on a saving throw against the cantrip, the target takes half the cantrip's damage (if any)".
describe("Potent Cantrip", () => {
  const missWith = (level: number) => {
    const table = tableWith("wizard", level, level >= 3 ? "evoker" : undefined);
    const cantrip = effectiveActions(table.definition, table.hero, catalog).find(
      (action) => action.attack !== undefined && action.spellId && library.spellRecord(action.spellId)?.level === 0
    )!;
    expect(cantrip).toBeDefined();
    // A natural 1 misses; every damage die shows 6.
    return cast(table, cantrip.id, [1, ...Array<number>(10).fill(6)], [FOE]);
  };

  it("deals half a missed cantrip's damage for an Evoker 3", () => {
    const result = missWith(3);
    expect(["miss", "fumble"]).toContain(result.attack?.outcome);
    expect((result.bonusDamage ?? []).some((part) => part.amount > 0 && /\(miss\)/.test(part.source ?? ""))).toBe(true);
  });

  it("deals nothing on a miss for a Wizard 2", () => {
    const result = missWith(2);
    expect((result.bonusDamage ?? []).filter((part) => /\(miss\)/.test(part.source ?? ""))).toEqual([]);
  });
});

// Empowered Evocation (Evoker 10): "Whenever you cast a Wizard spell from the Evocation school, you can add your
// Intelligence modifier to one damage roll of that spell."
describe("Empowered Evocation", () => {
  const evocation = (level: number) => {
    const table = tableWith("wizard", level, "evoker");
    const spell = effectiveActions(table.definition, table.hero, catalog).find((action) => {
      const record = action.spellId ? library.spellRecord(action.spellId) : undefined;
      return record?.school === "evocation" && action.damage.length > 0 && action.attack === undefined;
    })!;
    expect(spell).toBeDefined();
    return cast(table, spell.id, Array<number>(20).fill(3), [FOE]);
  };

  it("adds the Intelligence modifier to an Evoker 10's Evocation spell, and not before", () => {
    expect(evocation(10).warnings?.join(" ")).toMatch(/Empowered Evocation: \+\d+ \w+ \(INT\)/);
    expect(evocation(9).warnings?.join(" ") ?? "").not.toMatch(/Empowered Evocation/);
  });
});

// Elemental Affinity (Draconic Sorcery 6): "when you cast a spell that deals damage of that type, you can add your
// Charisma modifier to one damage roll of that spell": a spell, so a Flame Tongue's Fire gets none.
describe("Elemental Affinity", () => {
  it("adds the Charisma modifier to spells of the type only", () => {
    const record = library.featureRecord({ kind: "subclass", sourceId: "draconic-sorcery", id: "elemental-affinity" });
    const options =
      (record?.choice as { options?: ReadonlyArray<{ modifiers?: ReadonlyArray<{ when?: unknown[] }> }> } | undefined)
        ?.options ?? [];
    for (const option of options)
      expect(option.modifiers?.[0]?.when).toContainEqual({
        type: "spell-level-is",
        levels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
      });
    expect(options.length).toBe(5);
  });
});

// Mystic Arcanum's later rows each name their own level ("Choose one level 7 Warlock spell").
describe("Mystic Arcanum's text", () => {
  it("names each row's own spell level", () => {
    const features = library.classRecord("warlock")!.features;
    for (const level of [6, 7, 8, 9])
      expect(features.find((feature) => feature.id === `mystic-arcanum-level-${level}-spell`)?.description).toContain(
        `Choose one level ${level} Warlock spell`
      );
  });
});

// Improved Elemental Fury, Improved Potent Spellcasting (Druid 15): "When you cast a Druid cantrip with a range of 10
// feet or greater, the spell's range increases by 300 feet."
describe("Improved Potent Spellcasting", () => {
  const wispRange = (level: number, improved: boolean) => {
    const table = tableWith("druid", level);
    const character = table.definition.character!;
    if (improved)
      character.features = [
        ...(character.features ?? []),
        { id: "improved-potent-spellcasting", kind: "option", sourceId: "improved-elemental-fury" }
      ];
    // Starry Wisp: a Druid cantrip with a 60-foot ranged spell attack.
    table.definition.actions.push({
      id: "spell-starry-wisp",
      name: "Starry Wisp",
      activation: "action",
      description: "",
      damage: [{ formula: "1d8", type: "radiant" }],
      spellId: "starry-wisp",
      attack: { bonus: 7, rangeFeet: 60 }
    } as (typeof table.definition.actions)[number]);
    return effectiveActions(table.definition, table.hero, catalog).find((action) => action.id === "spell-starry-wisp")!
      .attack!.rangeFeet;
  };

  it("adds 300 feet to a Druid 15's cantrip of 10 feet or more, and nothing without the feature", () => {
    expect(wispRange(15, true)).toBe(360);
    expect(wispRange(14, false)).toBe(60);
  });
});
