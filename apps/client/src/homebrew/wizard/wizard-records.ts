/**
 * One complete record of each type, made the way a GM makes it in a wizard: every answer goes through the
 * wizard's own question (its `write`, which is the editor's unless the wizard says otherwise) or through the
 * composer a custom question calls. The wizard tests check these records against the editor and the server.
 *
 * Kept free of `vitest` and the DOM so the jsdom tests and the `*.mirror.test.ts` round trip can share it.
 */

import { blankDraft, blankFeature } from "../defaults";
import { setAt } from "../paths";
import type { Draft, FieldDef } from "../schema";
import type { HomebrewType } from "../types";
import { withBonus, withItemKind, typeLineOf } from "./equipment";
import { WIZARDS } from "./index";
import { editAction, newAction, withSaveTarget, withUsage, type MonsterAction } from "./monster-actions";
import {
  withChallenge,
  withHitDice,
  withSaves,
  withScore,
  withSense,
  withSkills,
  withSpeed,
  withStatblock
} from "./monster-build";
import { spellTextFor, withRange, withScaling } from "./spell-text";
import { isCustomQuestion } from "./types";

/** The wizard's question for `key`, looked up through its steps and their groups. */
export function wizardQuestion(type: HomebrewType, key: string): FieldDef {
  const walk = (fields: readonly FieldDef[]): FieldDef | undefined => {
    for (const field of fields) {
      if (field.key === key) return field;
      if (field.kind === "group" && field.rows) {
        const inner = walk(field.rows);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  for (const step of WIZARDS[type].steps) {
    const fields = (step.questions ?? []).filter((question) => !isCustomQuestion(question)) as FieldDef[];
    const found = walk(fields);
    if (found) return found;
  }
  throw new Error(`The ${type} wizard asks no question "${key}".`);
}

/** One answer, written the way the wizard's control writes it. */
export const answer = (type: HomebrewType, draft: Draft, key: string, value: unknown): Draft => {
  const question = wizardQuestion(type, key);
  return question.write ? question.write(value, draft) : setAt(draft, key, value);
};

/** Answers in order, as a GM gives them step by step. */
export const answers = (type: HomebrewType, draft: Draft, given: ReadonlyArray<readonly [string, unknown]>): Draft =>
  given.reduce<Draft>((next, [key, value]) => answer(type, next, key, value), draft);

const start = (type: HomebrewType, name: string): Draft => answer(type, blankDraft(type), "name", name);

/** The answers each record gives through questions the wizard borrows whole from the editor, so the editor's own
 *  controls can replay them and must land on the same record. */
export const BORROWED: Readonly<Record<HomebrewType, ReadonlyArray<readonly [string, unknown]>>> = {
  spell: [
    ["school", "evocation"],
    ["castingTime", "Action"],
    ["components.material", true],
    ["components.materialText", "a pinch of ash"],
    ["duration", "Instantaneous"],
    ["save.ability", "dex"],
    ["save.successDamage", "half"],
    ["damage.types", ["fire"]],
    ["target.type", "area"],
    ["shape.type", "sphere"],
    ["shape.size", 20],
    ["classes", ["sorcerer", "wizard"]]
  ],
  monster: [
    ["armorClass", 13],
    ["damageResistances", ["fire"]],
    ["conditionImmunities", ["frightened"]]
  ],
  equipment: [
    ["isMagic", true],
    ["weapon.category", "martial"],
    ["weapon.damageDice", "1d8"],
    ["weapon.damageType", "slashing"],
    ["weapon.properties", ["versatile"]],
    ["weapon.versatileDice", "1d10"],
    ["weapon.mastery", "sap"],
    ["rarity", "rare"],
    ["attunement.required", true],
    ["weightLb", 3]
  ],
  class: [
    ["summary", "A keeper of the old roads."],
    ["description", "Wardens walk the roads between towns and keep them safe."],
    ["hitDie", "d10"],
    ["primaryAbilities", ["wis"]],
    ["savingThrows", ["str", "wis"]],
    ["armorProficiencies", ["light", "medium", "shield"]],
    ["weaponProficiencies", ["simple", "martial"]],
    ["skillChoices.choose", 2],
    ["skillChoices.from", ["athletics", "survival", "perception"]],
    ["multiclassPrerequisites.minimums", [{ ability: "wis", minimum: 13 }]],
    ["subclassLevel", 3],
    ["subclassLabel", "Warden Path"]
  ],
  subclass: [
    ["summary", "Fighters who carry the first fire."],
    ["description", "They keep a coal burning for the road."],
    ["classId", "fighter"]
  ],
  species: [
    ["summary", "Kin of the cinder."],
    ["description", "Emberkin carry a spark of the first fire."],
    ["sizes", ["small", "medium"]],
    ["speedFeet", 30],
    ["darkvisionFeet", 60],
    ["languages", ["common"]]
  ],
  background: [
    ["summary", "You kept the streets lit."],
    ["description", "Every alley knows your ladder and your flame."],
    ["abilityOptions.from", ["dex", "con", "wis"]],
    ["skillProficiencies", ["perception", "stealth"]]
  ],
  feat: [
    ["summary", "You keep watch on the road."],
    ["description", "Long nights on the road have sharpened your senses."],
    ["category", "general"],
    ["prerequisite.level", 4],
    ["prerequisite.abilityScores", [{ ability: "wis", minimum: 13 }]]
  ],
  "spell-list": [
    ["summary", "The spells a Warden learns."],
    ["description", "Road magic and the old wards."],
    ["basedOn", ["ranger"]]
  ]
};

/* ------------------------------------------------------------------- spell ---- */

export function wizardSpell(): Draft {
  let draft = answers("spell", start("spell", "Ember Burst"), [
    ["level", 3],
    ["attackRoll", "save"],
    ["damage.roll", "6d6"]
  ]);
  draft = answers("spell", draft, BORROWED.spell);
  draft = withRange(draft, "feet", 120);
  draft = withScaling(draft, { perSlot: "1d6", targetsPerSlot: null, cantripTiers: false });
  return answer("spell", draft, "description", spellTextFor(draft));
}

/* ----------------------------------------------------------------- monster ---- */

/** The monster's actions as the action composer builds them: an attack, a breath, and a Multiattack naming the
 *  attack, with each text written from the answers. */
function monsterActions(): MonsterAction[] {
  const name = "ash hound";
  const bite: MonsterAction = {
    ...newAction("attack", "action"),
    name: "Bite",
    attack: { bonus: 5, reachFeet: 5 },
    damage: [{ formula: "1d8 + 3", type: "piercing" }]
  };
  const breath: MonsterAction = withUsage(
    withSaveTarget(
      {
        ...newAction("save", "action"),
        name: "Ash Breath",
        save: { ability: "dex", dc: 12, successDamage: "half", failureConditions: [] },
        damage: [{ formula: "4d6", type: "fire" }]
      },
      { kind: "area", shape: "cone", size: 15 }
    ),
    "recharge-5"
  );
  const multiattack: MonsterAction = {
    ...newAction("multiattack", "action"),
    multiattack: [{ actionId: String(bite.id), count: 2 }]
  };
  const all = [bite, breath, multiattack];
  return [multiattack, bite, breath].map((action) => editAction(action, action, all, name));
}

export function wizardMonster(): Draft {
  let draft = answers("monster", start("monster", "Ash Hound"), [
    ["size", "medium"],
    ["type", "monstrosity"],
    ["alignment", "unaligned"]
  ]);
  draft = withChallenge(draft, 2);
  draft = answers("monster", draft, BORROWED.monster);
  draft = answers("monster", draft, [
    ["armorDetail", "natural armor"],
    ["languages", "understands Common but can't speak"]
  ]);
  draft = withScore(draft, "str", 16);
  draft = withScore(draft, "dex", 14);
  draft = withScore(draft, "con", 14);
  draft = withScore(draft, "int", 4);
  draft = withScore(draft, "wis", 12);
  draft = withScore(draft, "cha", 6);
  draft = withHitDice(draft, 7);
  draft = withSpeed(draft, "walk", 40);
  draft = withSaves(draft, new Set(["dex"]));
  draft = withSkills(draft, new Map([["perception", "proficient"]]));
  draft = withSense(draft, "darkvision", 60);
  draft = withStatblock(draft, {
    traits: [{ name: "Ember Hide", description: "The hound sheds dim light in a 5-foot radius." }]
  });
  return { ...draft, actions: monsterActions() };
}

/* --------------------------------------------------------------- equipment ---- */

export function wizardEquipment(): Draft {
  let draft = withItemKind(start("equipment", "Ember Blade"), "weapon");
  draft = answers("equipment", draft, BORROWED.equipment);
  draft = withBonus(draft, ["attack-bonus", "damage-bonus"], 1);
  return answer("equipment", draft, "description", `${typeLineOf(draft)} The blade glows like a coal.`);
}

/* ------------------------------------------------------------------- class ---- */

/** A feature the class feature form adds at a level: the row, and its id on that level's table row. */
function withClassFeature(draft: Draft, level: number, name: string, description: string): Draft {
  const base = blankFeature();
  const feature = { ...base, name, description, level };
  const features = [...((draft.features as Draft[] | undefined) ?? []), feature];
  const table = (draft.levelTable as Draft[]).map((row, index) =>
    index + 1 === level
      ? { ...row, features: [...((row.features as string[] | undefined) ?? []), String(base.id)] }
      : row
  );
  return { ...draft, features, levelTable: table };
}

export function wizardClass(): Draft {
  const draft = answers("class", start("class", "Warden"), BORROWED.class);
  return withClassFeature(draft, 1, "Road Sense", "You can't become lost on a road you have walked.");
}

/* ---------------------------------------------------------------- subclass ---- */

export function wizardSubclass(): Draft {
  const draft = answers("subclass", start("subclass", "Path of Cinders"), BORROWED.subclass);
  const feature = {
    ...blankFeature(),
    name: "Kindled Strikes",
    description: "Your weapon attacks deal Fire damage.",
    level: 3
  };
  return { ...draft, features: [feature] };
}

/* ----------------------------------------------------------------- species ---- */

export function wizardSpecies(): Draft {
  const draft = answers("species", start("species", "Emberkin"), BORROWED.species);
  const trait = {
    ...blankFeature(),
    name: "Ember Blood",
    description: "You have Resistance to Fire damage."
  };
  return { ...draft, traits: [trait] };
}

/* -------------------------------------------------------------- background ---- */

export function wizardBackground(): Draft {
  const draft = answers("background", start("background", "Lamplighter"), BORROWED.background);
  // The write the Origin feat select makes.
  return { ...draft, originFeatId: "alert" };
}

/* -------------------------------------------------------------------- feat ---- */

export function wizardFeat(): Draft {
  const draft = answers("feat", start("feat", "Road Warden"), BORROWED.feat);
  const feature = {
    ...(draft.feature as Draft),
    name: "Road Warden",
    description: "You can't be surprised while you are conscious."
  };
  return { ...draft, feature };
}

/* -------------------------------------------------------------- spell list ---- */

export function wizardSpellList(): Draft {
  const draft = answers("spell-list", start("spell-list", "Warden Spells"), BORROWED["spell-list"]);
  // The write `SpellListContents` makes on a tap; the contents editor is a bespoke control.
  return { ...draft, add: ["fire-bolt"], remove: [] };
}

export const WIZARD_RECORDS: Readonly<Record<HomebrewType, () => Draft>> = {
  class: wizardClass,
  subclass: wizardSubclass,
  species: wizardSpecies,
  background: wizardBackground,
  feat: wizardFeat,
  spell: wizardSpell,
  "spell-list": wizardSpellList,
  equipment: wizardEquipment,
  monster: wizardMonster
};
