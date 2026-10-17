import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ActorSchema, GameStateSchema, type Actor } from "@vtt/domain";
import { aggregateRollMode } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import {
  loadClasses,
  loadConditions,
  loadEquipment,
  loadFeats,
  loadGlossary,
  loadMonsterDefinitions,
  loadSpecies,
  loadSpells,
  loadSubclasses
} from "@vtt/content-srd-5.2.1";
import { abilityCheckClaims, checkPlan } from "../src/ability-checks.js";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinAction, builtinActionsFor } from "../src/builtin-actions.js";
import { autoFailsPhysicalSaves, exhaustionPenalty } from "../src/condition-rules.js";
import { startEncounter } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { hasEvasion, magicResistanceOf, saveRollSources } from "../src/saving-throws.js";
import { currentSpeedFeet, speedZeroed } from "../src/speed.js";
import { wardingAura } from "../src/paladin-auras.js";
import { applyDamageDetailed, healActor } from "../src/hit-points.js";
import { monsterTraitKinds, renderSrdCoverage, spellState, srdCoverageRows, traitKind } from "../src/srd-coverage.js";
import {
  CONDITION_COVERAGE,
  GLOSSARY_COVERAGE,
  MONSTER_TRAIT_COVERAGE,
  RECORD_OVERRIDES
} from "../src/srd-coverage-curated.js";

describe("the SRD coverage manifest", () => {
  it("matches the committed docs/srd-coverage.md exactly (regenerate with `npm run map`)", () => {
    const committed = readFileSync(fileURLToPath(new URL("../../../docs/srd-coverage.md", import.meta.url)), "utf8");
    expect(committed).toBe(renderSrdCoverage());
  });

  it("classifies every condition, glossary entry and monster trait kind, saying how", () => {
    const unclassified = srdCoverageRows().filter((row) => row.note === "not classified");
    expect(unclassified.map((row) => `${row.group}: ${row.id}`)).toEqual([]);
    for (const curated of [CONDITION_COVERAGE, GLOSSARY_COVERAGE, MONSTER_TRAIT_COVERAGE, RECORD_OVERRIDES])
      for (const [key, row] of Object.entries(curated)) expect(row.note.trim(), key).not.toBe("");
  });

  it("names only records that exist, so a renamed record can't keep a stale row", () => {
    const conditions = new Set(loadConditions().map((condition) => condition.id));
    expect(Object.keys(CONDITION_COVERAGE).filter((id) => !conditions.has(id))).toEqual([]);
    const glossary = new Set(loadGlossary().map((entry) => entry.id));
    expect(Object.keys(GLOSSARY_COVERAGE).filter((id) => !glossary.has(id))).toEqual([]);
    const kinds = new Set(
      loadMonsterDefinitions().flatMap((definition) =>
        ((definition.extensions["open5e.srd-2024"] as { traits?: { name: string }[] } | undefined)?.traits ?? []).map(
          (trait) => traitKind(trait.name)
        )
      )
    );
    expect(Object.keys(MONSTER_TRAIT_COVERAGE).filter((kind) => !kinds.has(kind))).toEqual([]);
    const features = [
      ...loadClasses().flatMap((record) => record.features),
      ...loadSubclasses().flatMap((record) => record.features),
      ...loadSpecies().flatMap((species) => [...species.traits, ...species.lineages.flatMap((line) => line.traits)]),
      ...loadFeats().map((feat) => feat.feature)
    ];
    const keys = new Set([
      ...loadSpells().map((spell) => `spell:${spell.id}`),
      ...features.map((feature) => `feature:${feature.id}`),
      ...loadEquipment().map((item) => `item:${item.id}`),
      ...loadMonsterDefinitions().flatMap((definition) =>
        definition.actions.map((action) => `action:${definition.name}/${action.id}`)
      )
    ]);
    expect(Object.keys(RECORD_OVERRIDES).filter((key) => !keys.has(key))).toEqual([]);
  });
});

// A handful of the curated claims, checked against the engine so the manifest can't drift from what the server does.
describe("the curated claims hold in the engine", () => {
  const HERO = "10000000-0000-4000-8000-000000000001";
  const FOE = "10000000-0000-4000-8000-000000000002";

  const creature = (conditions: ReadonlyArray<{ id: string; level?: number }> = []): Actor =>
    ActorSchema.parse({
      id: HERO,
      name: "Hero",
      kind: "player-character",
      visibility: "public",
      hp: { current: 20, maximum: 20 },
      armorClass: 12,
      speedFeet: 30,
      conditions
    });
  const sheet = (over: Record<string, unknown> = {}): ActorDefinition =>
    ({
      name: "Hero",
      armorClass: 12,
      proficiencyBonus: 4,
      abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      hitPoints: { maximum: 20 },
      actions: [],
      extensions: {},
      proficiencies: { saves: [], skills: [] },
      ...over
    }) as unknown as ActorDefinition;
  const withFeature = (id: string) => sheet({ character: { classes: [], feats: [], features: [{ id }] } });
  const withTrait = (name: string) =>
    sheet({ proficiencies: undefined, extensions: { "open5e.srd-2024": { traits: [{ name, description: name }] } } });
  const state = (curated: { state: string }) => curated.state;

  it("Prone: the Prone creature's attack roll has Disadvantage", () => {
    expect(state(CONDITION_COVERAGE.prone!)).toBe("enforced");
    const game = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { ...creature([{ id: "prone" }]), definitionId: "hero" },
        { ...creature(), id: FOE, name: "Foe", kind: "monster" }
      ]
    });
    startEncounter(
      game,
      {
        mapAssetId: "20000000-0000-5000-8000-000000000001",
        entries: [
          { actorId: HERO, score: 20 },
          { actorId: FOE, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const faces = [12, 4];
    const resolution = resolveDefinitionAction(
      game,
      builtinAction("unarmed-strike")!,
      {
        actorId: HERO,
        targetIds: [FOE],
        commandId: "50000000-0000-4000-8000-000000000001",
        builtin: true,
        rollMode: null,
        override: null
      },
      {
        random: () => faces.shift() ?? 1,
        newRollId: () => "40000000-0000-4000-8000-000000000001",
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-17T00:00:00.000Z",
        definition: sheet()
      }
    );
    expect(resolution.rollMode?.mode).toBe("disadvantage");
    expect(resolution.rollMode?.disadvantage).toContain("Attacker is Prone");
  });

  it("Poisoned and Restrained: Disadvantage on checks and on Dexterity saves", () => {
    expect(state(CONDITION_COVERAGE.poisoned!)).toBe("enforced");
    expect(state(CONDITION_COVERAGE.restrained!)).toBe("enforced");
    const poisoned = creature([{ id: "poisoned" }]);
    const claims = abilityCheckClaims(poisoned, deriveEquipment(poisoned, undefined, undefined), { ability: "dex" });
    expect(claims.disadvantage.map((claim) => claim.source)).toContain("condition-poisoned");
    const restrained = creature([{ id: "restrained" }]);
    const save = saveRollSources(restrained, "dex", deriveEquipment(restrained, undefined, undefined));
    expect(save.disadvantage.map((claim) => claim.source)).toContain("target-restrained");
  });

  it("Paralyzed and Exhaustion: failed saves, Speed 0, and 2 off each D20 Test per level", () => {
    expect(state(CONDITION_COVERAGE.paralyzed!)).toBe("enforced");
    expect(state(CONDITION_COVERAGE.exhaustion!)).toBe("enforced");
    const paralyzed = creature([{ id: "paralyzed" }]);
    expect(autoFailsPhysicalSaves(paralyzed)).toBe("paralyzed");
    expect(speedZeroed(paralyzed)).toBe(true);
    const tired = creature([{ id: "exhaustion", level: 3 }]);
    expect(exhaustionPenalty(tired)).toBe(-6);
    expect(currentSpeedFeet(tired, deriveEquipment(tired, undefined, undefined))).toBe(15);
  });

  it("Deafened is guided: nothing in the engine reads it", () => {
    expect(state(CONDITION_COVERAGE.deafened!)).toBe("guided");
    const deafened = creature([{ id: "deafened" }]);
    const derivation = deriveEquipment(deafened, undefined, undefined);
    expect(speedZeroed(deafened)).toBe(false);
    expect(autoFailsPhysicalSaves(deafened)).toBeNull();
    expect(abilityCheckClaims(deafened, derivation, { ability: "wis" }).disadvantage).toEqual([]);
  });

  it("Advantage and Disadvantage on the same roll cancel", () => {
    expect(state(GLOSSARY_COVERAGE.advantage!)).toBe("enforced");
    const mode = aggregateRollMode([{ source: "a", label: "A" }], [{ source: "b", label: "B" }]).mode;
    expect(mode).toBe("normal");
  });

  it("Magic Resistance and Greater Magic Resistance are read from the stat block's traits", () => {
    expect(state(MONSTER_TRAIT_COVERAGE["Magic Resistance"]!)).toBe("enforced");
    expect(state(MONSTER_TRAIT_COVERAGE["Greater Magic Resistance"]!)).toBe("enforced");
    expect(magicResistanceOf(withTrait("Magic Resistance"))).toBe("advantage");
    expect(magicResistanceOf(withTrait("Greater Magic Resistance"))).toBe("succeeds");
  });

  it("features the engine reads by id: Evasion, Cunning Action and Jack of All Trades", () => {
    for (const key of ["feature:evasion", "feature:cunning-action", "feature:jack-of-all-trades"])
      expect(state(RECORD_OVERRIDES[key]!), key).toBe("enforced");
    expect(hasEvasion(withFeature("evasion"))).toBe(true);
    expect(builtinActionsFor(withFeature("cunning-action")).map((action) => action.name)).toEqual(
      expect.arrayContaining(["Cunning Action: Dash", "Cunning Action: Disengage", "Cunning Action: Hide"])
    );
    const bard = creature();
    const plain = checkPlan(bard, sheet(), deriveEquipment(bard, sheet(), undefined), {
      ability: "int",
      skill: "arcana"
    });
    const jack = checkPlan(bard, withFeature("jack-of-all-trades"), deriveEquipment(bard, undefined, undefined), {
      ability: "int",
      skill: "arcana"
    });
    expect(jack.modifier - plain.modifier).toBe(2);
  });

  it("Aura of Courage wards Frightened off an ally the map shows in the Paladin's aura", () => {
    expect(state(RECORD_OVERRIDES["feature:aura-of-courage"]!)).toBe("enforced");
    const paladin = { ...creature(), id: FOE, name: "Paladin", definitionId: "paladin" };
    const ally = { ...creature(), definitionId: "ally" };
    const game = GameStateSchema.parse({ schemaVersion: 1, actors: [paladin, ally] });
    const definitions: Record<string, ActorDefinition> = { paladin: withFeature("aura-of-courage"), ally: sheet() };
    const context = { resolveDefinition: (id: string) => definitions[id], distanceFeet: () => 10 };
    expect(wardingAura(game, game.actors[1]!, "frightened", context)).toBe("Paladin's Aura of Courage");
    expect(wardingAura(game, game.actors[1]!, "frightened", { ...context, distanceFeet: () => 15 })).toBeNull();
  });

  it("a spell's hit leaves its rider: Chill Touch bars healing, read by the healing path", () => {
    const touch = loadSpells().find((spell) => spell.id === "chill-touch")!;
    expect(spellState(touch)).toBe("enforced");
    const touched = ActorSchema.parse({
      ...creature(),
      hp: { current: 5, maximum: 20 },
      effects: [{ id: "chill", name: "Chill Touch", tags: touch.effect!.grant!.tags, duration: { type: "manual" } }]
    });
    const game = GameStateSchema.parse({ schemaVersion: 1, actors: [touched] });
    healActor(game, HERO, 10, { role: "gm" });
    expect(game.actors[0]!.hp.current).toBe(5);
  });

  it("a halved Speed: Slow's failed save carries the tag the Speed reader halves by", () => {
    const slow = loadSpells().find((spell) => spell.id === "slow")!;
    expect(spellState(slow)).toBe("enforced");
    const slowed = ActorSchema.parse({
      ...creature(),
      speedFeet: 30,
      effects: [{ id: "slow", name: "Slow", tags: slow.effect!.failureEffect!.tags, duration: { type: "manual" } }]
    });
    expect(currentSpeedFeet(slowed, deriveEquipment(slowed, undefined, undefined))).toBe(15);
  });

  it("a drain: a wraith's Life Drain lowers the Hit Point maximum by the damage taken", () => {
    const wraith = loadMonsterDefinitions().find((entry) => entry.source.externalId === "wraith")!;
    const drain = wraith.actions.find((action) => action.id === "life-drain")!.drain;
    const game = GameStateSchema.parse({ schemaVersion: 1, actors: [creature()] });
    applyDamageDetailed(game, HERO, { amount: 7, parts: [{ amount: 7, type: "necrotic" }], drain }, { role: "gm" });
    expect(game.actors[0]!.hp).toMatchObject({ current: 13, maximum: 13 });
  });

  it("a cure: Heal ends Blinded on the creature it heals", () => {
    const heal = loadSpells().find((spell) => spell.id === "heal")!;
    expect(spellState(heal)).toBe("enforced");
    expect(heal.effect!.endsConditions).toContain("blinded");
  });

  it("a trait kind the bundle runs as a mechanic is never curated reference", () => {
    const running = [...monsterTraitKinds()].filter(([, kind]) => kind.running > 0).map(([name]) => name);
    expect(running.length).toBeGreaterThan(0);
    expect(running.filter((name) => MONSTER_TRAIT_COVERAGE[name]?.state === "reference")).toEqual([]);
  });
});
