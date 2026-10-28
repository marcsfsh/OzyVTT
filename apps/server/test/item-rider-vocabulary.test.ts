import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { AXE_BERSERK_TAG } from "../src/berserker-axe.js";
import { makeEffect } from "../src/effects.js";
import { initiativeRollFor, startEncounter } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { brightLightEndings } from "../src/light-endings.js";
import { liveDefinitionIn } from "../src/live-abilities.js";
import { saveRollSources } from "../src/saving-throws.js";
import {
  actionOf,
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  resolveAt,
  tableOf,
  wizardInput,
  write,
  type Table
} from "./equipment-table.js";
import { HERO, visionGame } from "./vision-fixtures.js";

// The rider vocabulary magic items needed (SRD 5.2.1): Hit Points per level and Disadvantage with other weapons
// (Berserker Axe), long range set aside and a sworn enemy one at a time (Oathbow), clawed Unarmed Strikes and demons
// (Demon Armor), a flat Necrotic hit with Temporary Hit Points (Sword of Life Stealing), a defence that lapses
// (Cloak of Displacement), flight in the dark (Cloak of the Bat), a hurled hammer's thunderclap and its giant-strength
// gate (Hammer of Thunderbolts), an Initiative aura (Weapon of Warning) and a Proficiency Bonus (Ioun Mastery).

const monster = (id: string) => loadMonsterDefinitions().find((entry) => entry.source.externalId === id)!;

/** The table's foe takes this stat block. */
function foeIs(table: Table, id: string): ActorDefinition {
  const definition = monster(id);
  table.state.definitions.push({ id: `def-${id}`, definition } as (typeof table.state.definitions)[number]);
  table.actor(IDS.foe).definitionId = `def-${id}`;
  return definition;
}

/** The foe's own action at one target, `feet` away. */
function foeAttacks(table: Table, actionId: string, targetId: string, faces: number[], feet = 5) {
  const definition = table.resolve(table.actor(IDS.foe).definitionId!)!;
  table.state.combat = { ...table.state.combat, turn: { ...table.state.combat.turn, actionUsed: false } };
  let id = 0;
  return resolveDefinitionAction(
    table.state,
    definition.actions.find((action) => action.id === actionId)!,
    { actorId: IDS.foe, targetIds: [targetId], commandId: `61000000-0000-4000-8000-${String(++id).padStart(12, "0")}` },
    {
      random: () => faces.shift() ?? 1,
      newRollId: () => `62000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
      gmSessionId: IDS.gmSession,
      now: () => "2026-10-26T00:00:00.000Z",
      definition,
      catalog,
      resolveDefinition: table.resolve,
      distanceFeet: () => feet
    }
  );
}

const disadvantages = (resolution: ReturnType<typeof resolveAt>) => resolution.rollMode?.disadvantage ?? [];

/** A fight among these combatants, in this order. */
function fightAll(table: Table, actorIds: readonly string[]): void {
  startEncounter(
    table.state,
    { mapAssetId: IDS.map, entries: actorIds.map((actorId, index) => ({ actorId, score: 20 - index })) },
    () => 1,
    { width: 900, height: 600, calibration: null },
    table.resolve,
    Date.now(),
    catalog
  );
}

describe("Berserker Axe", () => {
  it("raises its attuned bearer's Hit Point maximum by 1 a level, and gives it back when the Attunement ends", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    const before = table.actor(IDS.fighter).hp.maximum;
    write(table, IDS.fighter, catalogRow("berserker-axe", { baseId: "greataxe", attuned: true }), "gm");
    expect(table.actor(IDS.fighter).hp.maximum).toBe(before + 5);
    write(table, IDS.fighter, edit(table, IDS.fighter, "berserker-axe", { attuned: false }), "gm");
    expect(table.actor(IDS.fighter).hp.maximum).toBe(before);
  });

  it("gives Disadvantage on attacks with other weapons, and none with itself", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("berserker-axe", { baseId: "greataxe", attuned: true }), "gm");
    write(table, IDS.fighter, catalogRow("dagger"), "gm");
    fight(table, IDS.fighter);
    expect(disadvantages(resolveAt(table, IDS.fighter, "item-dagger", [12, 2], {}, 5))).toContain("Berserker Axe");
    table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false };
    expect(disadvantages(resolveAt(table, IDS.fighter, "item-berserker-axe", [12, 6], {}, 5))).not.toContain(
      "Berserker Axe"
    );
  });

  it("holds a berserk bearer to the Attack action against the nearest creature it sees", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("berserker-axe", { baseId: "halberd", attuned: true }), "gm");
    fightAll(table, [IDS.fighter, IDS.wizard, IDS.foe]);
    table.state.combat.tokens = [
      { actorId: IDS.fighter, x: 0 },
      { actorId: IDS.wizard, x: 1 },
      { actorId: IDS.foe, x: 2 }
    ].map(({ actorId, x }) => ({
      ...(table.state.combat.tokens.find((token) => token.actorId === actorId) ?? table.state.combat.tokens[0]!),
      actorId,
      position: { x: 25 + 50 * x, y: 25 }
    }));
    table
      .actor(IDS.fighter)
      .effects.push(
        makeEffect({ id: "berserk", name: "Berserk", tags: [AXE_BERSERK_TAG], duration: { type: "manual" } })
      );
    const at = (a: string, b: string) => {
      const x = (id: string) => table.state.combat.tokens.find((token) => token.actorId === id)!.position!.x;
      return (Math.abs(x(a) - x(b)) / 50) * 5;
    };
    const swing = (actionId: string, targetId: string) =>
      resolveDefinitionAction(
        table.state,
        actionOf(table, IDS.fighter, actionId),
        { actorId: IDS.fighter, targetIds: [targetId], commandId: "63000000-0000-4000-8000-000000000001" },
        {
          random: () => 10,
          newRollId: () => "63000000-0000-4000-8000-000000000002",
          gmSessionId: IDS.gmSession,
          now: () => "2026-10-26T00:00:00.000Z",
          definition: table.definition(IDS.fighter),
          catalog,
          resolveDefinition: table.resolve,
          distanceFeet: at
        }
      );
    expect(() => swing("item-berserker-axe", IDS.foe)).toThrow(/berserk/);
    expect(swing("item-berserker-axe", IDS.wizard).attack?.targetId).toBe(IDS.wizard);
  });
});

describe("Oathbow", () => {
  const sworn = () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-b"), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("oathbow", { baseId: "longbow", attuned: true }), "gm");
    fightAll(table, [IDS.fighter, IDS.foe, IDS.wizard]);
    resolveAt(table, IDS.fighter, "item-oathbow-sworn-enemy", [], { targetIds: [IDS.foe] });
    table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false };
    return table;
  };

  it("shoots its sworn enemy at long range with Advantage and no Disadvantage for the range", () => {
    const table = sworn();
    const shot = resolveAt(table, IDS.fighter, "item-oathbow", [12, 3, 4, 2, 5, 6, 1], {}, 300);
    expect(shot.rollMode?.advantage).toContain("Oathbow");
    expect(disadvantages(shot).some((label) => label.startsWith("Long range"))).toBe(false);
  });

  it("gives Disadvantage with every other weapon while its sworn enemy lives", () => {
    const table = sworn();
    expect(disadvantages(resolveAt(table, IDS.fighter, "item-longbow", [12, 3], {}, 30))).toContain("Oathbow");
    table.actor(IDS.foe).hp = { ...table.actor(IDS.foe).hp, current: 0 };
    table.state.combat.turn = { ...table.state.combat.turn, actionUsed: false };
    expect(disadvantages(resolveAt(table, IDS.fighter, "item-longbow", [12, 3], {}, 30))).not.toContain("Oathbow");
  });

  it("names only one sworn enemy at a time", () => {
    const table = sworn();
    table.actor(IDS.fighter).actionUses = {};
    expect(() => resolveAt(table, IDS.fighter, "item-oathbow-sworn-enemy", [], { targetIds: [IDS.wizard] })).toThrow(
      /only one Sworn Enemy at a time/
    );
  });
});

describe("Demon Armor", () => {
  it("makes its wearer's Unarmed Strike 1d8 Slashing with +1 to attack and damage", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("demon-armor", { baseId: "chain-mail", attuned: true }), "gm");
    fight(table, IDS.fighter);
    const plain = resolveAt(table, IDS.fighter, "unarmed-strike", [12, 5], {}, 5);
    expect(plain.damage[0]).toMatchObject({ type: "slashing", total: 5 + 4 });
    expect(plain.bonusDamage).toEqual([expect.objectContaining({ amount: 1 })]);
    expect(plain.attack?.total).toBe(12 + 4 + 3 + 1);
  });

  it("gives Disadvantage on attacks against a demon and on saves against what a demon forces", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("demon-armor", { baseId: "chain-mail", attuned: true }), "gm");
    foeIs(table, "balor");
    fight(table, IDS.fighter);
    expect(disadvantages(resolveAt(table, IDS.fighter, "item-greatsword", [12, 3, 3, 3, 3, 3, 3], {}, 5))).toContain(
      "Demon Armor"
    );
    const fighter = table.actor(IDS.fighter);
    const derivation = deriveEquipment(fighter, table.definition(IDS.fighter), catalog);
    const against = (tags: string[]) =>
      saveRollSources(fighter, "dex", derivation, false, [], "fiend", {}, tags).disadvantage.map(
        (claim) => claim.label
      );
    expect(against(["demon"])).toContain("Demon Armor");
    expect(against(["devil"])).not.toContain("Demon Armor");
  });
});

describe("Sword of Life Stealing", () => {
  const strike = (foe: string, natural: number) => {
    const table = tableOf({ [IDS.fighter]: fighterInput() });
    write(table, IDS.fighter, catalogRow("sword-of-life-stealing", { baseId: "longsword", attuned: true }), "gm");
    foeIs(table, foe);
    fight(table, IDS.fighter);
    const resolution = resolveAt(table, IDS.fighter, "item-sword-of-life-stealing", [natural, 4, 4], {}, 5);
    return { table, resolution };
  };

  it("deals 15 Necrotic more on a rolled 20 against a living creature, and gives its wielder that many Temporary Hit Points", () => {
    const { table, resolution } = strike("bandit", 20);
    expect(resolution.damage).toContainEqual(expect.objectContaining({ type: "necrotic", total: 15 }));
    expect(table.actor(IDS.fighter).hp.temporary).toBe(15);
  });

  it("adds nothing against an Undead, or on a hit that isn't a rolled 20", () => {
    expect(strike("skeleton", 20).resolution.damage.some((part) => part.type === "necrotic")).toBe(false);
    expect(strike("bandit", 19).resolution.damage.some((part) => part.type === "necrotic")).toBe(false);
  });
});

describe("Cloak of Displacement", () => {
  const cloaked = () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("cloak-of-displacement", { attuned: true }), "gm");
    foeIs(table, "bandit");
    fightAll(table, [IDS.foe, IDS.wizard]);
    return table;
  };

  it("gives attack rolls against its wearer Disadvantage", () => {
    const table = cloaked();
    expect(foeAttacks(table, "scimitar", IDS.wizard, [12, 3]).rollMode?.disadvantage).toContain(
      "Target: Cloak of Displacement"
    );
  });

  it("stops from the moment its wearer takes damage until its next turn, and while its Speed is 0", () => {
    const table = cloaked();
    applyDamageDetailed(
      table.state,
      IDS.wizard,
      { amount: 2, parts: [{ amount: 2, type: "fire" }] },
      { role: "gm" },
      { resolveDefinition: table.resolve, catalog }
    );
    expect(
      table.actor(IDS.wizard).effects.find((effect) => effect.name.startsWith("Cloak of Displacement"))
    ).toMatchObject({ duration: { type: "until-bearer-next-turn" } });
    expect(foeAttacks(table, "scimitar", IDS.wizard, [12, 3]).rollMode?.disadvantage ?? []).not.toContain(
      "Target: Cloak of Displacement"
    );
    const grappled = cloaked();
    grappled
      .actor(IDS.wizard)
      .conditions.push({ id: "grappled" } as (typeof grappled.state.actors)[number]["conditions"][number]);
    expect(foeAttacks(grappled, "scimitar", IDS.wizard, [12, 3]).rollMode?.disadvantage ?? []).not.toContain(
      "Target: Cloak of Displacement"
    );
  });
});

describe("Cloak of the Bat", () => {
  it("ends its flight in Bright Light and keeps it in Darkness", () => {
    const flying = makeEffect({
      id: "bat",
      name: "Cloak of the Bat",
      duration: { type: "manual" },
      endsInBrightLight: true,
      modifiers: [{ type: "special-speed", movement: "fly", feet: 40 }]
    });
    const dark = visionGame({ ambient: "dark", actors: { [HERO]: { effects: [flying] } } });
    const bright = visionGame({ ambient: "bright", actors: { [HERO]: { effects: [flying] } } });
    expect(brightLightEndings(dark, {})).toEqual([]);
    expect(brightLightEndings(bright, {})).toEqual([{ actorId: HERO, effectId: "bat" }]);
  });

  it("offers its wearer a Polymorph into a Bat only, keeping its mental scores", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("cloak-of-the-bat", { attuned: true }), "gm");
    const cast = actionOf(table, IDS.wizard, "item-cloak-of-the-bat-cast-polymorph");
    expect(cast.shapeShift).toMatchObject({ onlyForms: ["bat"], keeps: expect.arrayContaining(["mental"]) });
    expect(cast.sight?.inDimLightOrDarkness).toBe(true);
    expect(actionOf(table, IDS.wizard, "item-cloak-of-the-bat-grip").grants?.endsInBrightLight).toBe(true);
  });

  it("turns its wearer into a Bat with no save, and into nothing else", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    write(table, IDS.wizard, catalogRow("cloak-of-the-bat", { attuned: true }), "gm");
    // The bestiary answers for a form as the server's lookup does.
    const lookup = (id: string) =>
      table.resolve(id) ?? loadMonsterDefinitions().find((entry) => entry.source.externalId === id);
    const cast = (form: string) =>
      resolveDefinitionAction(
        table.state,
        actionOf(table, IDS.wizard, "item-cloak-of-the-bat-cast-polymorph"),
        { actorId: IDS.wizard, targetIds: [IDS.wizard], commandId: "64000000-0000-4000-8000-000000000001", form },
        {
          random: () => 10,
          newRollId: () => "64000000-0000-4000-8000-000000000002",
          gmSessionId: IDS.gmSession,
          now: () => "2026-10-26T00:00:00.000Z",
          definition: table.definition(IDS.wizard),
          catalog,
          resolveDefinition: lookup
        }
      );
    expect(() => cast("cat")).toThrow(/can't take that form/);
    cast("bat");
    expect(table.actor(IDS.wizard).effects.find((effect) => effect.form)?.form).toMatchObject({
      keeps: expect.arrayContaining(["mental"])
    });
    expect(table.state.combat.pendingSaves).toEqual([]);
  });
});

describe("Hammer of Thunderbolts", () => {
  const armed = (gauntlets: boolean) => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("hammer-of-thunderbolts", { baseId: "warhammer", attuned: true }), "gm");
    if (gauntlets) write(table, IDS.fighter, catalogRow("gauntlets-of-ogre-power", { attuned: true }), "gm");
    return table;
  };

  it("hurls itself for a charge, and its thunderclap asks the target and each creature within 30 feet but its wielder", () => {
    const table = armed(false);
    fightAll(table, [IDS.fighter, IDS.foe, IDS.wizard]);
    const hurl = resolveAt(table, IDS.fighter, "item-hammer-of-thunderbolts-hurl", [15, 5], {}, 20);
    expect(hurl.attack?.outcome).toBe("hit");
    const saving = table.state.combat.pendingSaves.map((save) => save.targetActorId).sort();
    expect(saving).toEqual([IDS.foe, IDS.wizard].sort());
    expect(table.state.combat.pendingSaves[0]).toMatchObject({ ability: "con", dc: 17, conditionIds: ["stunned"] });
  });

  it("with Gauntlets of Ogre Power attuned, raises their Strength by 4 and asks a Giant's death save on a rolled 20", () => {
    const live = (table: Table) =>
      liveDefinitionIn(table.state, table.actor(IDS.fighter).definitionId!, table.definition(IDS.fighter), catalog);
    const wizardTable = tableOf({ [IDS.wizard]: wizardInput() });
    write(wizardTable, IDS.wizard, catalogRow("gauntlets-of-ogre-power", { attuned: true }), "gm");
    write(wizardTable, IDS.wizard, catalogRow("hammer-of-thunderbolts", { baseId: "warhammer", attuned: true }), "gm");
    expect(
      liveDefinitionIn(
        wizardTable.state,
        wizardTable.actor(IDS.wizard).definitionId!,
        wizardTable.definition(IDS.wizard),
        catalog
      ).abilityScores.str
    ).toBe(23);
    // A Strength already 19 takes nothing from the gauntlets, so they bestow nothing to raise.
    const bane = armed(true);
    expect(live(bane).abilityScores.str).toBe(19);
    foeIs(bane, "hill-giant");
    fight(bane, IDS.fighter);
    resolveAt(bane, IDS.fighter, "item-hammer-of-thunderbolts", [20, 4, 4], {}, 5);
    expect(bane.state.combat.pendingSaves).toContainEqual(expect.objectContaining({ ability: "con", dc: 17 }));
    const plain = armed(false);
    foeIs(plain, "hill-giant");
    fight(plain, IDS.fighter);
    resolveAt(plain, IDS.fighter, "item-hammer-of-thunderbolts", [20, 4, 4], {}, 5);
    expect(plain.state.combat.pendingSaves).toEqual([]);
  });
});

describe("Weapon of Warning", () => {
  it("gives its bearer and an ally within 30 feet Advantage on Initiative, and an ally farther none", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("weapon-of-warning", { baseId: "longsword", attuned: true }), "gm");
    const mode = (actorId: string, feet: number) =>
      initiativeRollFor(table.state, actorId, false, {
        resolveDefinition: table.resolve,
        catalog,
        distanceFeet: () => feet
      }).mode;
    expect(mode(IDS.fighter, 100)).toBe("advantage");
    expect(mode(IDS.wizard, 20)).toBe("advantage");
    expect(mode(IDS.wizard, 40)).toBe("normal");
  });

  it("wakes an ally sleeping naturally as the encounter begins", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput(), [IDS.wizard]: wizardInput() });
    write(table, IDS.fighter, catalogRow("weapon-of-warning", { baseId: "longsword", attuned: true }), "gm");
    table.actor(IDS.wizard).conditions.push({ id: "unconscious" });
    startEncounter(
      table.state,
      {
        mapAssetId: IDS.map,
        entries: [
          { actorId: IDS.fighter, score: 15 },
          { actorId: IDS.wizard, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null },
      table.resolve,
      Date.now(),
      catalog,
      undefined,
      undefined,
      () => 10
    );
    expect(table.actor(IDS.wizard).conditions.some((condition) => condition.id === "unconscious")).toBe(false);
  });
});

describe("Ioun Stone of Mastery", () => {
  it("raises its bearer's Proficiency Bonus by 1, and the spell save DC built from it", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    const live = () =>
      liveDefinitionIn(table.state, table.actor(IDS.wizard).definitionId!, table.definition(IDS.wizard), catalog);
    const before = live();
    write(table, IDS.wizard, catalogRow("ioun-stone", { attuned: true, variantId: "mastery" }), "gm");
    const after = live();
    expect(after.proficiencyBonus).toBe(before.proficiencyBonus + 1);
    expect(after.spellcasting?.saveDc).toBe((before.spellcasting?.saveDc ?? 0) + 1);
  });
});
