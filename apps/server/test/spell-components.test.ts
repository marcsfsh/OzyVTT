import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition, InventoryItem } from "@vtt/schemas";
import { actionAvailability, resolveDefinitionAction } from "../src/action-resolution.js";
import { ContentLibrary } from "../src/content-library.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { startEncounter } from "../src/encounter.js";
import { effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { standsInSilence } from "../src/silence.js";
import { ALLY, build, catalog, clericInput, fight, FOE, HERO, wizardInput } from "./spell-casters.js";

// SRD 5.2.1 Spells, "Components": a Verbal component needs a caster who can speak (not in Silence), a Somatic one a
// free hand, and a Material one a Component Pouch or a Spellcasting Focus, or the material itself when it has a worth
// or the spell consumes it, which the cast then uses up.

const wizard = build(wizardInput(["chromatic-orb", "magic-missile", "shield", "mage-armor"]));
const cleric = build(clericInput(["bless", "cure-wounds", "revivify", "gentle-repose"]));
const row = (id: string, name: string, quantity = 1, equipped = false): InventoryItem => ({
  id,
  name,
  quantity,
  equipped,
  attuned: false
});
const strictComponents = (state: GameState) => {
  state.combat = { ...state.combat, ruleExceptions: { components: "strict" } };
};
const bindHands = (state: GameState, actorId: string) =>
  addEffect(
    state,
    actorId,
    makeEffect({ id: "manacles", name: "Manacles", tags: ["hands-bound"], duration: { type: "manual" } })
  );

describe("a Verbal component", () => {
  it("is refused to a caster who can't speak, and a spell without one is cast", () => {
    const { state, resolve, hero } = fight(wizard);
    strictComponents(state);
    addEffect(
      state,
      hero.id,
      makeEffect({ id: "gag", name: "Gag", tags: ["cant-speak"], duration: { type: "manual" } })
    );
    expect(() => resolve("spell-magic-missile", {})).toThrowError(
      /Ansel can't speak while Gag lasts, and Magic Missile has a Verbal component/
    );
  });

  it("is refused where Silence's sphere stands, measured on the map", () => {
    const { state, resolve, hero } = fight(wizard);
    strictComponents(state);
    const calibration = {
      kind: "square",
      origin: { x: 0, y: 0 },
      cellSizePx: 50,
      rotationRadians: 0,
      distancePerCell: 5
    } as const;
    const geometry = { width: 1000, height: 600, calibration };
    state.combat = {
      ...state.combat,
      tokens: state.combat.tokens.map((token) =>
        token.actorId === HERO ? { ...token, position: { x: 125, y: 125 }, sizeCells: 1 } : token
      ),
      annotations: [
        {
          id: "silence-cast",
          kind: "shape",
          shape: "circle",
          geometry: { origin: { x: 125, y: 125 }, target: { x: 325, y: 125 } },
          visibility: "public",
          ownerSessionId: null,
          createdAt: 0
        } as never
      ]
    };
    const priest = state.actors.find((actor) => actor.id === FOE)!;
    addEffect(
      state,
      priest.id,
      makeEffect({
        id: "silence-cast:concentration",
        name: "Concentrating on Silence",
        tags: ["concentrating"],
        concentration: true,
        castId: "silence-cast",
        spell: { id: "silence", level: 2 },
        duration: { type: "rounds", remaining: 100 }
      })
    );
    expect(standsInSilence(state, hero.id, geometry, catalog)).toBe(true);
    expect(() => resolve("spell-magic-missile", { silenced: true })).toThrowError(
      /No sound can be made where Ansel stands, and Magic Missile has a Verbal component/
    );
  });
});

describe("a Somatic component", () => {
  it("needs a hand the caster can free, and a weapon in hand is stowed for it", () => {
    const { state, resolve, hero } = fight(cleric);
    strictComponents(state);
    // Mace and Shield equipped: the Mace is stowed with the cast's free object interaction.
    expect(hero.inventory.filter((item) => item.equipped).map((item) => item.name)).toEqual(
      expect.arrayContaining(["Mace", "Shield"])
    );
    expect(() => resolve("spell-cure-wounds", { targetIds: [HERO] }, [4])).not.toThrow();
    const bound = fight(cleric);
    strictComponents(bound.state);
    bindHands(bound.state, bound.hero.id);
    expect(() => bound.resolve("spell-cure-wounds", { targetIds: [HERO] }, [4])).toThrowError(
      /no free hand for Cure Wounds's Somatic component: Manacles binds both hands/
    );
  });
});

describe("a Material component", () => {
  it("is served by a Component Pouch or the class's focus, and refused with neither", () => {
    const { state, resolve, hero } = fight(wizard);
    strictComponents(state);
    // The Wizard's spellbook is its focus ("an Arcane Focus or your spellbook"), and so is its kit's Arcane Focus staff.
    hero.inventory = hero.inventory.filter((item) => item.id !== "spellbook" && item.id !== "arcane-focus-staff");
    expect(() => resolve("spell-mage-armor", { targetIds: [HERO] })).toThrowError(
      /Mage Armor has a Material component \(a piece of cured leather\), and Ansel carries no Component Pouch or Spellcasting Focus/
    );
    hero.inventory.push(row("component-pouch", "Component Pouch"));
    expect(() => resolve("spell-mage-armor", { targetIds: [HERO] })).not.toThrow();
  });

  it("needs a priced material itself, keeps one the spell doesn't consume, and uses up one it does", () => {
    const orb = fight(wizard);
    strictComponents(orb.state);
    expect(() => orb.resolve("spell-chromatic-orb", { damageType: "fire" }, [15])).toThrowError(
      /Chromatic Orb needs diamond worth 50\+ GP\. Add it to Ansel's gear/
    );
    orb.hero.inventory.push(row("diamond", "Diamond"));
    orb.resolve("spell-chromatic-orb", { damageType: "fire" }, [15, 3, 3, 3]);
    expect(orb.hero.inventory.find((item) => item.id === "diamond")?.quantity).toBe(1);

    const raise = fight(cleric, { ally: true });
    strictComponents(raise.state);
    raise.hero.inventory.push(row("diamond-300", "Diamond (300 GP)"));
    const fallen = raise.state.actors.find((actor) => actor.id === ALLY)!;
    fallen.hp = { ...fallen.hp, current: 0 };
    raise.resolve("spell-revivify", { targetIds: [ALLY] });
    expect(raise.hero.inventory.some((item) => item.id === "diamond-300")).toBe(false);
  });

  it("pays Gentle Repose's 2 Copper Pieces from the purse", () => {
    const { state, resolve, hero } = fight(cleric);
    strictComponents(state);
    hero.currency = { ...hero.currency, cp: 1 };
    // Its target is a corpse.
    const corpse = state.actors.find((actor) => actor.id === FOE)!;
    corpse.hp = { ...corpse.hp, current: 0 };
    expect(() => resolve("spell-gentle-repose", { targetIds: [FOE] })).toThrowError(
      /Gentle Repose uses up 2 Copper Pieces, and Mira's purse holds 1 CP/
    );
    hero.currency = { ...hero.currency, cp: 5 };
    resolve("spell-gentle-repose", { targetIds: [FOE] });
    expect(hero.currency.cp).toBe(3);
  });

  it("names what is missing on the turn list, and the GM can override it", () => {
    const { state, resolve, hero } = fight(wizard);
    strictComponents(state);
    const rows = actionAvailability(
      state,
      hero,
      effectiveActions(wizard, hero, catalog),
      wizard,
      false,
      undefined,
      catalog
    );
    expect(rows.find((option) => option.id === "spell-chromatic-orb")).toMatchObject({
      available: false,
      reason: "It needs diamond worth 50+ GP. Add it to your gear."
    });
    const resolution = resolve(
      "spell-chromatic-orb",
      { damageType: "fire", override: { families: ["components"], reason: "It's in the pack." } },
      [15, 3, 3, 3]
    );
    expect(resolution.overridden).toEqual({ rule: "spell.no-material", reason: "It's in the pack." });
  });
});

describe("a stat block's components", () => {
  const library = new ContentLibrary();
  const gmCatalog = equipmentCatalogOf(library.forAudience("gm"));

  function silenced(slug: string, spellId: string) {
    const definition = library.monsterForInstance(slug)! as ActorDefinition;
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: HERO, name: definition.name, kind: "monster", hp: { current: 40, maximum: 40 }, definitionId: slug },
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
    state.combat = { ...state.combat, ruleExceptions: { components: "strict" } };
    const cast = effectiveActions(definition, state.actors[0], gmCatalog).find((action) => action.spellId === spellId)!;
    return () =>
      resolveDefinitionAction(
        state,
        cast,
        { actorId: HERO, targetIds: [HERO], commandId: `cmd-${slug}`, silenced: true },
        {
          random: () => 3,
          newRollId: () => "40000000-0000-4000-8000-000000000997",
          gmSessionId: "30000000-0000-4000-8000-00000000000a",
          now: () => "2026-10-16T00:00:00.000Z",
          definition,
          catalog: gmCatalog
        }
      );
  }

  it("casts what needs no spell components in Silence, and a Verbal spell of its list is refused there", () => {
    // The imp's Invisibility is cast "requiring no spell components".
    expect(silenced("imp", "invisibility")).not.toThrow();
    expect(silenced("mage", "light")).toThrowError(/has a Verbal component/);
  });
});
