import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { startEncounter } from "../src/encounter.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { checkPlan } from "../src/ability-checks.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { saveRollSources } from "../src/saving-throws.js";
import { currentSpeedFeet, specialSpeedsOf } from "../src/speed.js";

// Species, backgrounds and origin feats as SRD 5.2.1 prints them (character-origins.md, feats.md), built
// through the real builder against the shipped bundles.

const library = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(library);
const policy = BuilderPolicySchema.parse({});
const IDS = {
  hero: "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10",
  foe: "10000000-0000-4000-8000-000000000102",
  map: "20000000-0000-5000-8000-000000000101",
  gmSession: "30000000-0000-4000-8000-00000000010a"
};

type Row = CharacterChoice;

/** A Fighter with STR 15 and CHA 13, whose origin picks the test supplies. */
function fighter(
  level: number,
  origin: Readonly<{ speciesId: string; backgroundId?: string; rows?: readonly Row[] }>
): CharacterCreateRequestInput {
  const background = origin.backgroundId ?? "soldier";
  return {
    name: "Probe",
    speciesId: origin.speciesId,
    backgroundId: background,
    classId: "fighter",
    level,
    ...(level >= 3 ? { subclassId: "champion" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 14, con: 12, int: 10, wis: 8, cha: 13 },
    backgroundBonusAllocation:
      background === "acolyte"
        ? [
            { ability: "wis", amount: 2 },
            { ability: "cha", amount: 1 }
          ]
        : [
            { ability: "str", amount: 2 },
            { ability: "con", amount: 1 }
          ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "fighter", kind: "skill", id: "survival" },
      { level: 1, classId: "fighter", kind: "skill", id: "perception" },
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
      ...(level >= 3 ? [{ level: 3, classId: "fighter", kind: "subclass", id: "champion" }] : []),
      ...(level >= 4
        ? [
            { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
            {
              level: 4,
              classId: "fighter",
              kind: "asi-or-feat",
              id: "asi",
              payload: { increases: [{ ability: "dex", amount: 2 }] }
            }
          ]
        : []),
      { level: 1, kind: "equipment", id: "fighter-a" },
      ...(background === "acolyte"
        ? [
            { level: 1, kind: "equipment", id: "acolyte-a" },
            { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
            { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } }
          ]
        : [
            { level: 1, kind: "equipment", id: "soldier-a" },
            { level: 1, kind: "tool", id: "gaming-set-dice" }
          ]),
      ...(origin.rows ?? [])
    ] as Row[]
  };
}

const tiefling = (legacy: string, ability = "cha"): readonly Row[] => [
  { level: 1, kind: "lineage", id: legacy },
  { level: 1, kind: "spellcasting-ability", id: ability, payload: { featureId: "tiefling-fiendish-legacy" } }
];
const elf = (lineage: string, ability = "wis"): readonly Row[] => [
  { level: 1, kind: "lineage", id: lineage },
  { level: 1, kind: "spellcasting-ability", id: ability, payload: { featureId: "elf-lineage" } },
  { level: 1, kind: "skill", id: "insight", payload: { featureId: "elf-keen-senses" } }
];

const build = (input: CharacterCreateRequestInput) => buildCharacterDefinition(input, library, policy);
const actionIds = (definition: ActorDefinition) => definition.actions.map((action) => action.id);
const spellOf = (definition: ActorDefinition, id: string) =>
  definition.spellcasting?.spells.find((spell) => spell.id === id);
const thrown = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

describe("species traits arrive at the character level the SRD prints", () => {
  it("Fiendish Legacy: the level 3 and level 5 spells wait for those levels", () => {
    const one = build(fighter(1, { speciesId: "tiefling", rows: tiefling("infernal") }));
    expect(spellOf(one, "fire-bolt")).toBeDefined();
    expect(spellOf(one, "hellish-rebuke")).toBeUndefined();
    expect(actionIds(one)).not.toContain("spell-hellish-rebuke-free");

    const three = build(fighter(3, { speciesId: "tiefling", rows: tiefling("infernal") }));
    expect(actionIds(three)).toContain("spell-hellish-rebuke-free");
    expect(spellOf(three, "darkness")).toBeUndefined();

    const five = build(fighter(5, { speciesId: "tiefling", rows: tiefling("infernal") }));
    expect(actionIds(five)).toEqual(expect.arrayContaining(["spell-hellish-rebuke-free", "spell-darkness-free"]));
  });

  it("Draconic Flight and Large Form arrive at character level 5", () => {
    const dragon = (level: number) =>
      build(fighter(level, { speciesId: "dragonborn", rows: [{ level: 1, kind: "lineage", id: "red-dragon" }] }));
    expect(actionIds(dragon(4))).not.toContain("draconic-flight");
    expect(actionIds(dragon(5))).toContain("draconic-flight");

    const goliath = (level: number) =>
      build(
        fighter(level, {
          speciesId: "goliath",
          rows: [
            { level: 1, kind: "giant-ancestry", id: "clouds-jaunt", payload: { featureId: "goliath-giant-ancestry" } }
          ]
        })
      );
    expect(actionIds(goliath(1))).not.toContain("large-form");
    expect(actionIds(goliath(5))).toContain("large-form");
  });
});

describe("Elven Lineage hands over its spells", () => {
  it("Drow: Dancing Lights, then Faerie Fire at 3 and Darkness at 5, each free once per Long Rest", () => {
    const five = build(fighter(5, { speciesId: "elf", rows: elf("drow") }));
    expect(spellOf(five, "dancing-lights")).toMatchObject({ level: 0, alwaysPrepared: true });
    for (const id of ["faerie-fire", "darkness"]) {
      expect(spellOf(five, id)).toMatchObject({ alwaysPrepared: true, freeActionId: `spell-${id}-free` });
      expect(five.actions.find((action) => action.id === `spell-${id}-free`)?.uses).toMatchObject({
        limit: 1,
        per: "long-rest"
      });
    }
    const two = build(fighter(2, { speciesId: "elf", rows: elf("drow") }));
    expect(spellOf(two, "faerie-fire")).toBeUndefined();
  });

  it("High Elf and Wood Elf get theirs too", () => {
    const high = build(fighter(5, { speciesId: "elf", rows: elf("high-elf") }));
    expect(["prestidigitation", "detect-magic", "misty-step"].map((id) => spellOf(high, id)?.id)).toEqual([
      "prestidigitation",
      "detect-magic",
      "misty-step"
    ]);
    const wood = build(fighter(5, { speciesId: "elf", rows: elf("wood-elf") }));
    expect(["druidcraft", "longstrider", "pass-without-trace"].map((id) => spellOf(wood, id)?.id)).toEqual([
      "druidcraft",
      "longstrider",
      "pass-without-trace"
    ]);
    expect(wood.speedFeet).toBe(35);
  });

  it("knows Common and two standard languages, not a fourth", () => {
    const built = build(fighter(1, { speciesId: "elf", rows: elf("wood-elf") }));
    expect(built.proficiencies?.languages).toEqual(["common", "dwarvish", "giant"]);
  });
});

describe("the spellcasting ability for species and Magic Initiate spells is the player's choice", () => {
  it("casts a Tiefling's legacy spell with the chosen Charisma, not Intelligence", () => {
    // CHA 13 (+1), PB 2: DC 11. With INT 10 it would be 10.
    const cha = build(fighter(3, { speciesId: "tiefling", rows: tiefling("infernal", "cha") }));
    expect(cha.actions.find((action) => action.id === "spell-hellish-rebuke-free")?.save?.dc).toBe(11);
    const int = build(fighter(3, { speciesId: "tiefling", rows: tiefling("infernal", "int") }));
    expect(int.actions.find((action) => action.id === "spell-hellish-rebuke-free")?.save?.dc).toBe(10);
  });

  it("casts Magic Initiate's spells with the ability chosen for the feat", () => {
    // Acolyte: WIS 8 + 2 = 10 (+0), INT 10 (+0), CHA 13 + 1 = 14 (+2). PB 2.
    const rows = (ability: string): Row[] => [
      { level: 1, kind: "spell", id: "healing-word", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: ability, payload: { featureId: "magic-initiate-cleric" } }
    ];
    const cha = build(
      fighter(1, { speciesId: "human", backgroundId: "acolyte", rows: [...humanRows, ...rows("cha")] })
    );
    expect(cha.actions.find((action) => action.id === "spell-sacred-flame")?.save?.dc).toBe(12);
    const wis = build(
      fighter(1, { speciesId: "human", backgroundId: "acolyte", rows: [...humanRows, ...rows("wis")] })
    );
    expect(wis.actions.find((action) => action.id === "spell-sacred-flame")?.save?.dc).toBe(10);
  });

  it("refuses a build that leaves the ability unchosen", () => {
    const input = fighter(1, { speciesId: "tiefling", rows: [{ level: 1, kind: "lineage", id: "infernal" }] });
    expect(thrown(() => build(input))).toMatch(/Fiendish Legacy: spellcasting ability" needs 1 pick/);
  });
});

/** A Human's own picks (Skillful and Versatile), so a background's feat is the one under test. */
const humanRows: readonly Row[] = [
  { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
  { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } }
];

describe("Magic Initiate's level 1 spell", () => {
  const acolyte = (spell: string) =>
    fighter(1, {
      speciesId: "human",
      backgroundId: "acolyte",
      rows: [
        ...humanRows,
        { level: 1, kind: "spell", id: spell, payload: { featureId: "magic-initiate-cleric" } },
        { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } }
      ]
    });

  it("must be a level 1 spell, not a cantrip", () => {
    expect(thrown(() => build(acolyte("spare-the-dying")))).toMatch(/below the minimum spell level \(1\)/);
  });

  it("is always prepared and cast once per Long Rest without a slot, by a Fighter with no slots at all", () => {
    const built = build(acolyte("healing-word"));
    expect(spellOf(built, "healing-word")).toMatchObject({
      alwaysPrepared: true,
      freeActionId: "spell-healing-word-free"
    });
    const free = built.actions.find((action) => action.id === "spell-healing-word-free");
    expect(free?.uses).toMatchObject({ limit: 1, per: "long-rest", pool: "magic-initiate-cleric" });
    expect(free?.healing).toBeDefined();
    // The use is spent by casting the spell; no separate counter casts nothing.
    expect(actionIds(built)).not.toContain("magic-initiate-cleric");
  });
});

describe("Breath Weapon replaces one attack of the Attack action", () => {
  const dragonborn = (level: number) =>
    build(fighter(level, { speciesId: "dragonborn", rows: [{ level: 1, kind: "lineage", id: "red-dragon" }] }));

  function onTurn(definition: ActorDefinition) {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: IDS.foe,
          name: "Foe",
          kind: "monster",
          visibility: "public",
          hp: { current: 99, maximum: 99 },
          armorClass: 5
        }
      ]
    }) as GameState;
    importActorDefinition(state, definition, IDS.hero, "public", catalog);
    startEncounter(
      state,
      {
        mapAssetId: IDS.map,
        entries: [
          { actorId: IDS.hero, score: 20 },
          { actorId: IDS.foe, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
    let command = 0;
    return (actionId: string) =>
      resolveDefinitionAction(
        state,
        effectiveActions(definition, hero, catalog).find((entry) => entry.id === actionId)!,
        {
          actorId: IDS.hero,
          targetIds: actionId.startsWith("breath-weapon") ? [] : [IDS.foe],
          commandId: `50000000-0000-4000-8000-0000000002${String(++command).padStart(2, "0")}`
        },
        {
          random: () => 4,
          newRollId: () => `40000000-0000-4000-8000-0000000002${String(command).padStart(2, "0")}`,
          gmSessionId: IDS.gmSession,
          now: () => "2026-07-28T00:00:00.000Z",
          definition,
          catalog
        }
      );
  }

  it("offers a 15-foot Cone beside the 30-foot Line, on one pool", () => {
    const actions = dragonborn(5).actions.filter((action) => action.id.startsWith("breath-weapon"));
    expect(actions.map((action) => [action.id, action.area])).toEqual([
      ["breath-weapon", { shape: "line", sizeFeet: 30, widthFeet: 5 }],
      ["breath-weapon-cone", { shape: "cone", sizeFeet: 15, widthFeet: null }]
    ]);
    for (const action of actions) expect(action.uses).toEqual({ limit: 3, per: "long-rest", pool: "breath-weapon" });
  });

  it("lets a Fighter 5 breathe and still swing once, or swing and then breathe", () => {
    const breatheFirst = onTurn(dragonborn(5));
    breatheFirst("breath-weapon-cone");
    expect(() => breatheFirst("item-greatsword")).not.toThrow();
    expect(() => breatheFirst("item-greatsword")).toThrowError(/no attacks remaining/);

    const swingFirst = onTurn(dragonborn(5));
    swingFirst("item-greatsword");
    expect(() => swingFirst("breath-weapon")).not.toThrow();
    expect(() => swingFirst("breath-weapon")).toThrowError(/no attacks remaining/);
  });

  it("is the whole Attack action for a Fighter 1, who has one attack", () => {
    const one = onTurn(dragonborn(1));
    one("breath-weapon");
    expect(() => one("item-greatsword")).toThrowError(/already used an action/);
  });
});

describe("Archery adds +2 to attack rolls with Ranged weapons", () => {
  const archer = (style: string) => {
    const input = fighter(1, { speciesId: "human", rows: humanRows });
    const choices = input.choices.map((row) => (row.kind === "fighting-style" ? { ...row, id: style } : row)) as Row[];
    return build({ ...input, choices });
  };

  function onTable(definition: ActorDefinition): { state: GameState; hero: Actor } {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: IDS.foe,
          name: "Foe",
          kind: "monster",
          visibility: "public",
          hp: { current: 40, maximum: 40 },
          armorClass: 30
        }
      ]
    }) as GameState;
    importActorDefinition(state, definition, IDS.hero, "public", catalog);
    const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
    // Soldier package A carries a Shortbow; equip it beside the Fighter's kit.
    hero.inventory = hero.inventory.map((item) => (item.id === "shortbow" ? { ...item, equipped: true } : item));
    startEncounter(
      state,
      {
        mapAssetId: IDS.map,
        entries: [
          { actorId: IDS.hero, score: 20 },
          { actorId: IDS.foe, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    return { state, hero };
  }

  const roll = (definition: ActorDefinition, actionId: string) => {
    const { state, hero } = onTable(definition);
    const action = effectiveActions(definition, hero, catalog).find((entry) => entry.id === actionId)!;
    const faces = [10];
    const deps: ResolveDependencies = {
      random: () => faces.shift() ?? 1,
      newRollId: () => "40000000-0000-4000-8000-000000000001",
      gmSessionId: IDS.gmSession,
      now: () => "2026-07-28T00:00:00.000Z",
      definition,
      catalog
    };
    return resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000001" },
      deps
    ).attack!.total;
  };

  it("on a Shortbow, and not on a melee swing", () => {
    // DEX 14 (+2) + PB 2 = +4 on the bow; d20 10.
    expect(roll(archer("defense"), "item-shortbow")).toBe(14);
    expect(roll(archer("archery"), "item-shortbow")).toBe(16);
    expect(roll(archer("archery"), "item-greatsword")).toBe(roll(archer("defense"), "item-greatsword"));
  });
});

describe("the Soldier's gaming set", () => {
  it("offers all four kinds, and package A carries the kind chosen", () => {
    const input = fighter(1, { speciesId: "human", rows: humanRows });
    const choices = input.choices.map((row) =>
      row.kind === "tool" ? { ...row, id: "gaming-set-three-dragon-ante" } : row
    ) as Row[];
    const built = build({ ...input, choices });
    const tools = (built.startingInventory ?? []).filter((item) => item.id.startsWith("gaming-set-"));
    expect(tools.map((item) => item.id)).toEqual(["gaming-set-three-dragon-ante"]);
    expect(built.proficiencies?.tools).toContain("gaming-set-three-dragon-ante");
  });
});

describe("species traits that act in play", () => {
  /** The character in a fight against one foe, with its effective actions resolvable on its own turn. */
  function table(definition: ActorDefinition) {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: IDS.foe,
          name: "Foe",
          kind: "monster",
          visibility: "public",
          hp: { current: 99, maximum: 99 },
          armorClass: 5
        }
      ]
    }) as GameState;
    importActorDefinition(state, definition, IDS.hero, "public", catalog);
    startEncounter(
      state,
      {
        mapAssetId: IDS.map,
        entries: [
          { actorId: IDS.hero, score: 20 },
          { actorId: IDS.foe, score: 10 }
        ]
      },
      () => 1,
      { width: 900, height: 600, calibration: null }
    );
    const hero = state.actors.find((actor) => actor.id === IDS.hero)!;
    const derivation = () => deriveEquipment(hero, definition, catalog);
    let command = 0;
    const use = (actionId: string) =>
      resolveDefinitionAction(
        state,
        effectiveActions(definition, hero, catalog).find((entry) => entry.id === actionId)!,
        {
          actorId: IDS.hero,
          targetIds: [],
          commandId: `50000000-0000-4000-8000-0000000003${String(++command).padStart(2, "0")}`
        },
        {
          random: () => 4,
          newRollId: () => `40000000-0000-4000-8000-0000000003${String(command).padStart(2, "0")}`,
          gmSessionId: IDS.gmSession,
          now: () => "2026-10-17T00:00:00.000Z",
          definition,
          catalog
        }
      );
    return { state, hero, derivation, use };
  }
  const advantageLabels = (claims: { advantage: ReadonlyArray<{ label: string }> }) =>
    claims.advantage.map((claim) => claim.label);

  it("Dwarven Resilience, Fey Ancestry and Brave: Advantage on saves against Poisoned, Charmed and Frightened", () => {
    for (const [speciesId, rows, conditionId, trait] of [
      ["dwarf", [], "poisoned", "Dwarven Resilience"],
      ["elf", elf("high-elf"), "charmed", "Fey Ancestry"],
      ["halfling", [], "frightened", "Brave"]
    ] as const) {
      const { hero, derivation } = table(build(fighter(1, { speciesId, rows })));
      expect(advantageLabels(saveRollSources(hero, "wis", derivation(), false, [conditionId]))).toEqual([
        expect.stringContaining(trait)
      ]);
      expect(saveRollSources(hero, "wis", derivation()).advantage).toEqual([]);
    }
  });

  it("Gnomish Cunning: Advantage on Intelligence, Wisdom and Charisma saves, and on no other", () => {
    const { hero, derivation } = table(
      build(
        fighter(1, {
          speciesId: "gnome",
          rows: [
            { level: 1, kind: "lineage", id: "rock-gnome" },
            { level: 1, kind: "spellcasting-ability", id: "int", payload: { featureId: "gnome-lineage" } }
          ]
        })
      )
    );
    for (const ability of ["int", "wis", "cha"] as const)
      expect(advantageLabels(saveRollSources(hero, ability, derivation()))).toEqual([
        expect.stringContaining("Gnomish Cunning")
      ]);
    expect(saveRollSources(hero, "dex", derivation()).advantage).toEqual([]);
  });

  it("Powerful Build: Advantage on the check to escape a grapple", () => {
    const definition = build(
      fighter(1, {
        speciesId: "goliath",
        rows: [
          { level: 1, kind: "giant-ancestry", id: "clouds-jaunt", payload: { featureId: "goliath-giant-ancestry" } }
        ]
      })
    );
    const { hero, derivation } = table(definition);
    const athletics = { ability: "str", skill: "athletics" } as const;
    expect(checkPlan(hero, definition, derivation(), athletics, { stakes: ["grappled"] }).rollMode.mode).toBe(
      "advantage"
    );
    expect(checkPlan(hero, definition, derivation(), athletics).rollMode.mode).toBe("normal");
  });

  it("Relentless Endurance: an Orc dropped to 0 stays at 1, once a Long Rest", () => {
    const { state, hero } = table(build(fighter(1, { speciesId: "orc" })));
    const hit = () =>
      applyDamageDetailed(
        state,
        IDS.hero,
        { amount: hero.hp.current, parts: [{ amount: hero.hp.current, type: "slashing" }] },
        { role: "gm" },
        { resolveDefinition: (id) => state.definitions.find((entry) => entry.id === id)?.definition }
      );
    const first = hit();
    expect(hero.hp.current).toBe(1);
    expect(first.events.map((event) => event.text)).toContain(
      "Probe drops to 1 Hit Point instead (Relentless Endurance)."
    );
    hit();
    expect(hero.hp.current).toBe(0);
    expect(hero.conditions.map((condition) => condition.id)).toContain("unconscious");
  });

  it("Adrenaline Rush: a Bonus Action Dash and Temporary Hit Points equal to the Proficiency Bonus", () => {
    const { hero, use } = table(build(fighter(1, { speciesId: "orc" })));
    use("adrenaline-rush");
    expect(hero.hp.temporary).toBe(2);
    expect(hero.effects.map((effect) => effect.tags)).toEqual([["dashing"]]);
  });

  it("Draconic Flight gives a Fly Speed equal to Speed, and Large Form 10 more feet and Advantage on Strength checks", () => {
    const dragon = table(
      build(fighter(5, { speciesId: "dragonborn", rows: [{ level: 1, kind: "lineage", id: "red-dragon" }] }))
    );
    dragon.use("draconic-flight");
    expect(specialSpeedsOf(dragon.hero, undefined, dragon.derivation()).fly).toBe(30);
    const goliathDefinition = build(
      fighter(5, {
        speciesId: "goliath",
        rows: [
          { level: 1, kind: "giant-ancestry", id: "clouds-jaunt", payload: { featureId: "goliath-giant-ancestry" } }
        ]
      })
    );
    const goliath = table(goliathDefinition);
    goliath.use("large-form");
    expect(currentSpeedFeet(goliath.hero, goliath.derivation())).toBe(45);
    expect(
      checkPlan(goliath.hero, goliathDefinition, goliath.derivation(), { ability: "str", skill: "athletics" }).rollMode
        .mode
    ).toBe("advantage");
  });
});
