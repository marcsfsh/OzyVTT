import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { actionAvailability, resolveDefinitionAction } from "../src/action-resolution.js";
import { castLine, castSpellOf } from "../src/cast-narration.js";
import { ContentLibrary } from "../src/content-library.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import {
  ALLY,
  build,
  catalog,
  clericInput,
  fight,
  FOE,
  HERO,
  view,
  wizardInput,
  WIZARD_SPELLS
} from "./spell-casters.js";

// SRD 5.2.1 Spells: every spell is cast, whatever it does. A cast that rolls nothing (Light, Mage Hand, Guidance)
// still takes its casting time's action, holds its Concentration, ends what casting ends, and names its targets.

const wizard = build(wizardInput(WIZARD_SPELLS));
const cleric = build(clericInput(["bless", "cure-wounds"]));

describe("a cast action for every spell on a sheet", () => {
  it("mints one for each cantrip and slot spell the builder puts on the sheet", () => {
    for (const definition of [wizard, cleric])
      for (const spell of definition.spellcasting!.spells)
        expect(spell.actionId, `${definition.name}: ${spell.id}`).toBe(`spell-${spell.id}`);
    expect(wizard.actions.find((action) => action.id === "spell-mage-hand")).toMatchObject({
      activation: "action",
      spellId: "mage-hand",
      damage: []
    });
  });

  it("offers a cantrip that rolls nothing on the turn list, aimed at what it names", () => {
    const { state, hero } = fight(cleric);
    const rows = actionAvailability(
      state,
      hero,
      effectiveActions(cleric, hero, catalog),
      cleric,
      false,
      undefined,
      catalog
    );
    // Guidance touches one willing creature; Thaumaturgy names no creature, so it aims at nobody.
    expect(rows.find((row) => row.id === "spell-guidance")).toMatchObject({ available: true, targeting: "single" });
    expect(rows.find((row) => row.id === "spell-thaumaturgy")).toMatchObject({ available: true, targeting: "none" });
  });
});

describe("casting a spell that rolls nothing, in a fight", () => {
  it("spends the Magic action, and refuses a second action spell that turn", () => {
    const { state, resolve } = fight(wizard);
    const resolution = resolve("spell-mage-hand", { targetIds: [] });
    expect(resolution).toMatchObject({ actionName: "Mage Hand", attack: null, save: null, damageTotal: 0 });
    expect(state.combat.turn.actionUsed).toBe(true);
    expect(() => resolve("spell-fire-bolt", {}, [15, 5])).toThrowError(/already used an action this turn/);
  });

  it("holds Concentration on Guidance, and touches one creature only", () => {
    const { resolve, hero } = fight(cleric, { ally: true });
    expect(() => resolve("spell-guidance", { targetIds: [HERO, ALLY] })).toThrowError(/targets one creature/);
    resolve("spell-guidance", { targetIds: [ALLY] });
    expect(hero.effects.map((effect) => effect.name)).toContain("Concentrating on Guidance");
  });

  it("ends the caster's Invisibility, which ends once its bearer casts a spell", () => {
    const { resolve, hero, state } = fight(wizard);
    addEffect(
      state,
      hero.id,
      makeEffect({
        id: "invisible-1",
        name: "Invisibility",
        tags: ["until-it-acts"],
        sourceActorId: hero.id,
        sourceName: hero.name,
        duration: { type: "rounds", remaining: 10 },
        linkedConditionIds: ["invisible"]
      })
    );
    const resolution = resolve("spell-mage-hand", { targetIds: [] });
    expect(resolution.effectsEnded).toEqual([expect.objectContaining({ name: "Invisibility" })]);
    expect(hero.effects.some((effect) => effect.id === "invisible-1")).toBe(false);
  });

  it("ends hiding when the spell has a Verbal component, and keeps it for one without", () => {
    const hide = (state: ReturnType<typeof fight>["state"], heroId: string) =>
      addEffect(
        state,
        heroId,
        makeEffect({
          id: "hidden-1",
          name: "Hidden",
          tags: ["hidden"],
          sourceActorId: heroId,
          sourceName: "Ansel",
          duration: { type: "manual" }
        })
      );
    const loud = fight(wizard);
    hide(loud.state, loud.hero.id);
    loud.resolve("spell-mage-hand", { targetIds: [] });
    expect(loud.hero.effects.some((effect) => effect.tags.includes("hidden"))).toBe(false);

    // Minor Illusion has Somatic and Material components and no Verbal one.
    const quiet = fight(wizard);
    hide(quiet.state, quiet.hero.id);
    quiet.hero.inventory.push({
      id: "component-pouch",
      name: "Component Pouch",
      quantity: 1,
      equipped: false,
      attuned: false
    });
    const illusion = view.spellRecord("minor-illusion")!;
    resolveDefinitionAction(
      quiet.state,
      {
        id: "spell-minor-illusion",
        name: "Minor Illusion",
        activation: "action",
        description: "x",
        damage: [],
        spellId: illusion.id
      },
      { actorId: HERO, targetIds: [], commandId: "cmd-quiet" },
      {
        random: () => 3,
        newRollId: () => "40000000-0000-4000-8000-000000000999",
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-16T00:00:00.000Z",
        definition: wizard,
        catalog
      }
    );
    expect(quiet.hero.effects.some((effect) => effect.tags.includes("hidden"))).toBe(true);
  });

  it("makes a dying creature Stable with Spare the Dying, and only one that is dying", () => {
    const { resolve, state } = fight(cleric, { ally: true });
    const ally = state.actors.find((actor) => actor.id === ALLY)!;
    // A character at 0 Hit Points is dying until it is Stable or dead.
    Object.assign(ally, { kind: "player-character", hp: { ...ally.hp, current: 0 } });
    ally.deathSaves = { successes: 0, failures: 1, stable: false };
    const resolution = resolve("spell-spare-the-dying", { targetIds: [ALLY] });
    expect(ally.deathSaves).toEqual({ successes: 0, failures: 0, stable: true });
    expect(resolution.tableNarration).toEqual([expect.objectContaining({ text: "Bran is stable." })]);
  });
});

describe("a stat block's at-will cast of a spell that rolls nothing", () => {
  const library = new ContentLibrary();
  const mage = library.monsterForInstance("mage")!;
  const gmCatalog = equipmentCatalogOf(library.forAudience("gm"));

  it("resolves Light, spending the mage's action", () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: HERO, name: "Mage", kind: "monster", hp: { current: 40, maximum: 40 }, definitionId: "mage" },
        { id: FOE, name: "Goblin", kind: "monster", hp: { current: 7, maximum: 7 } }
      ]
    });
    startEncounter(
      state,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: HERO, score: 20 },
          { actorId: FOE, score: 5 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const light = effectiveActions(mage, state.actors[0], gmCatalog).find((action) => action.spellId === "light")!;
    const resolution = resolveDefinitionAction(
      state,
      light,
      { actorId: HERO, targetIds: [], commandId: "cmd-light" },
      {
        random: () => 3,
        newRollId: () => "40000000-0000-4000-8000-000000000998",
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-16T00:00:00.000Z",
        definition: mage as ActorDefinition,
        catalog: gmCatalog
      }
    );
    expect(resolution.actionName).toBe("Light");
    expect(state.combat.turn.actionUsed).toBe(true);
  });
});

describe("the table's line for a cast", () => {
  it("names the spell and the targets the table may see, never the caster twice", () => {
    const caster = { id: "a", name: "Lyra" };
    const targets = [
      { id: "a", name: "Lyra" },
      { id: "b", name: "Borin" },
      { id: "c", name: "Kael" },
      { id: "d", name: "Shade" }
    ];
    expect(castLine(caster, "Bless", targets, (id) => id === "d")).toEqual({
      text: "Lyra casts Bless on Borin and Kael.",
      actorIds: ["a", "b", "c"]
    });
    expect(castLine(caster, "Light", [], () => false).text).toBe("Lyra casts Light.");
  });

  it("tells a spell's later action from a new cast", () => {
    const spellRecord = (id: string) => view.spellRecord(id);
    expect(castSpellOf({ id: "spell-spiritual-weapon", spellId: "spiritual-weapon" }, spellRecord)?.name).toBe(
      "Spiritual Weapon"
    );
    expect(castSpellOf({ id: "spell-spiritual-weapon-then-attack", spellId: "spiritual-weapon" }, spellRecord)).toBe(
      null
    );
  });
});
