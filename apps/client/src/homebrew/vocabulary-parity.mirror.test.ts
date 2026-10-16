/**
 * Both-paths guard for the rider vocabulary. Each row has a fixture and three tests: (1) the editor
 * authors it through the real controls to a publishable body; (2) SRD content authors the same
 * shape, with a minimum count asserted; (3) one assertion body runs over both and ends at an engine
 * outcome (a rolled number, a spent counter, a refusal, rendered text).
 *
 * A `.mirror.test.ts` so it runs in the node project that may import server modules.
 *
 * The `unauthorable` census lists every key a later change needs that the editor cannot author yet,
 * as an exact set. It sees keys, not values: a select missing an option is caught by the row tests.
 */

import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { HOMEBREW_BODY_SCHEMAS } from "@vtt/content-srd-5.2.1/schemas";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../../../server/src/action-resolution.js";
import { importActorDefinition } from "../../../server/src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../../../server/src/character-build.js";
import { computeServerOffers } from "../../../server/src/character-offers.js";
import { choiceOverrideDefenses, replaceableOffers } from "../../../server/src/choice-overrides.js";
import {
  ContentLibrary,
  EMPTY_HOMEBREW_SLICE,
  type HomebrewContentSource
} from "../../../server/src/content-library.js";
import { effectiveActions } from "../../../server/src/effective-actions.js";
import { equipmentCatalogOf } from "../../../server/src/equipment-derivation.js";
import { nextInitiativeTurn, startEncounter } from "../../../server/src/encounter.js";
import {
  applyField,
  authored,
  authoredRow,
  fieldsWithin,
  hasControl,
  publishVerdict,
  riderScopeOf,
  RIDER_EXEMPT,
  storedBody
} from "./authoring-harness";
import { blankDraft, forStorage } from "./defaults";
import { grantRowsOf, grantsFromRows } from "./riders/GrantsEditor";
import { EMPTY_CONTEXT } from "./schema";
import { SCHEMAS } from "./schemas";
import type { Draft, FieldDef } from "./schema";
import type { HomebrewType } from "./types";

/** The values a `select` offers, whether its options are a literal or a function of the context. */
const optionValues = (field: FieldDef | undefined): readonly string[] =>
  (typeof field?.options === "function" ? field.options(EMPTY_CONTEXT, {}) : (field?.options ?? [])).map(
    (option) => option.value
  );

const IDS = {
  caster: "10000000-0000-4000-8000-000000000101",
  target: "10000000-0000-4000-8000-000000000102",
  gmSession: "30000000-0000-4000-8000-00000000010a",
  map: "20000000-0000-5000-8000-000000000101",
  command: "50000000-0000-4000-8000-000000000101",
  roll: "40000000-0000-4000-8000-000000000101"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const RECORD_ID = "hb-parity-a1b2c3";

/* ---------------------------------------------------------------- the fixture ---- */

/** An action that forces a saving throw and rolls typed damage (`activation`, `save.ability`,
    `save.dc`, `damage[].formula`, `damage[].type`), as the SRD Aboleth authors it. */
const FIXTURE = {
  actionId: "consume-memories",
  actionName: "Consume Memories",
  activation: "action",
  description: "Intelligence Saving Throw: DC 16, one creature within 30 feet. Failure: 3d6 Psychic damage.",
  saveAbility: "int",
  saveDc: 16,
  formula: "3d6",
  damageType: "psychic",
  /** Faces fed to the resolver, so the far end is an exact number. */
  faces: [4, 5, 6],
  total: 15
} as const;

/* ------------------------------------------------------ path 1: the editor ------- */

/** The monster a GM builds through the real form, as the body the save path sends. */
function authoredMonster(): Draft {
  const damagePart = authoredRow(
    "monster",
    ["actions", "damage"],
    [
      ["formula", FIXTURE.formula],
      ["type", FIXTURE.damageType]
    ]
  );
  const action = authoredRow(
    "monster",
    ["actions"],
    [
      ["name", FIXTURE.actionName],
      ["activation", FIXTURE.activation],
      ["description", FIXTURE.description],
      ["damage", [damagePart]],
      ["save.ability", FIXTURE.saveAbility],
      ["save.dc", FIXTURE.saveDc]
    ]
  );
  // `newRow` mints a random id; pin the SRD's slug so the far end can find the action.
  const withId = { ...action, id: FIXTURE.actionId };
  return authored("monster", "Memory Eater", [
    ["abilityScores.str", 21],
    ["abilityScores.dex", 9],
    ["abilityScores.con", 15],
    ["abilityScores.int", 18],
    ["abilityScores.wis", 15],
    ["abilityScores.cha", 18],
    ["armorClass", 17],
    ["hitPoints.maximum", 150],
    ["proficiencyBonus", 4],
    ["actions", [withId]]
  ]);
}

/* --------------------------------------------------------- path 2: the SRD ------- */

/** The same shape read from the shipped bundle through the server's content view. */
const srdMonster = (): ActorDefinition => {
  const definition = new ContentLibrary().forAudience("gm").monster("aboleth");
  if (!definition) throw new Error("The SRD bundle no longer ships an Aboleth — this fixture needs a new carrier.");
  return definition;
};

/* -------------------------------------------------- the one assertion body ------- */

/** Resolves the fixture's action in a real fight for a definition from either path and reports what
    the table would see. */
function resolveTheFixture(definition: ActorDefinition) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.caster,
        name: definition.name,
        kind: "monster",
        visibility: "public",
        hp: { current: 150, maximum: 150 },
        armorClass: 17,
        definitionId: "def-caster"
      },
      {
        id: IDS.target,
        name: "Target Dummy",
        kind: "monster",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        armorClass: 12
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.caster, score: 20 },
        { actorId: IDS.target, score: 10 }
      ]
    },
    () => 1,
    GEOMETRY
  );

  // Through the server's action list, which is what the table rolls from and where riders fold in.
  const action = effectiveActions(definition, state.actors[0], undefined).find(
    (entry) => entry.id === FIXTURE.actionId
  );
  if (!action) throw new Error(`${definition.name} has no "${FIXTURE.actionId}" action.`);

  const queue = [...FIXTURE.faces];
  const resolution = resolveDefinitionAction(
    state,
    action,
    { actorId: IDS.caster, targetIds: [IDS.target], commandId: IDS.command },
    {
      random: () => {
        const face = queue.shift();
        if (face === undefined) throw new Error("dice queue empty");
        return face;
      },
      newRollId: () => IDS.roll,
      gmSessionId: IDS.gmSession,
      now: () => "2026-08-08T00:00:00.000Z",
      definition
    }
  );
  return { resolution, pendingSaves: state.combat.pendingSaves };
}

/* ---------------------------------------------------------------- the tests ------ */

describe("a saving-throw action that rolls typed damage — through both paths", () => {
  it("1. the editor can author it: every key goes through a real control, and the body publishes", () => {
    const draft = authoredMonster();
    const verdict = publishVerdict("monster", draft, RECORD_ID);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    // `authoredRow` already refuses keys with no control; this checks the written values survive.
    const body = storedBody("monster", draft, RECORD_ID) as { actions: Array<Record<string, unknown>> };
    expect(body.actions).toHaveLength(1);
    expect(body.actions[0]).toMatchObject({
      id: FIXTURE.actionId,
      name: FIXTURE.actionName,
      activation: FIXTURE.activation,
      save: { ability: FIXTURE.saveAbility, dc: FIXTURE.saveDc },
      damage: [{ formula: FIXTURE.formula, type: FIXTURE.damageType }]
    });
  });

  it("2. SRD content authors the same shape — and it is not a lone record", () => {
    const definition = srdMonster();
    const action = definition.actions.find((entry) => entry.id === FIXTURE.actionId);
    expect(action).toMatchObject({
      activation: FIXTURE.activation,
      save: { ability: FIXTURE.saveAbility, dc: FIXTURE.saveDc },
      damage: [{ formula: FIXTURE.formula, type: FIXTURE.damageType }]
    });

    // More than one SRD author, so a regression shows up across content.
    const carriers = new ContentLibrary()
      .forAudience("gm")
      .monsterSummaries()
      .flatMap((summary) => new ContentLibrary().forAudience("gm").monster(summary.id)?.actions ?? [])
      .filter((entry) => entry.save !== undefined && entry.attack === undefined && entry.damage.length > 0);
    expect(carriers.length).toBeGreaterThanOrEqual(100);
  });

  it("3. one assertion body over both: the same rolled damage and the same pending save", () => {
    const editorBody = storedBody("monster", authoredMonster(), RECORD_ID);
    const paths: ReadonlyArray<readonly [string, ActorDefinition]> = [
      ["SRD content", srdMonster()],
      ["the homebrew editor", HOMEBREW_BODY_SCHEMAS.monster.parse(editorBody)]
    ];

    for (const [label, definition] of paths) {
      const { resolution, pendingSaves } = resolveTheFixture(definition);

      // 3d6 rolled as 4/5/6, and a save owed at the authored DC.
      expect(resolution.damage, label).toEqual([
        { formula: FIXTURE.formula, type: FIXTURE.damageType, total: FIXTURE.total }
      ]);
      expect(resolution.damageTotal, label).toBe(FIXTURE.total);
      expect(resolution.save, label).toEqual({
        ability: FIXTURE.saveAbility,
        dc: FIXTURE.saveDc,
        targets: [{ targetId: IDS.target, targetName: "Target Dummy" }]
      });
      expect(pendingSaves, label).toHaveLength(1);
      expect(pendingSaves[0], label).toMatchObject({
        targetActorId: IDS.target,
        ability: FIXTURE.saveAbility,
        dc: FIXTURE.saveDc,
        proposedDamage: FIXTURE.total
      });
    }
  });
});

/* -------------------------------- a monster's to-hit bonus, through both paths -- */

/** `attack.bonus`, the flat printed to-hit a stat block carries (`ActionSchema.attack` requires it
    and has no `ability`). The Bandit is the plainest carrier: +3 to hit, one damage part, no riders. */
const BANDIT = {
  monsterId: "bandit",
  actionId: "scimitar",
  actionName: "Scimitar",
  description: "Melee Attack Roll: +3, reach 5 ft. 4 (1d6 + 1) Slashing damage.",
  bonus: 3,
  reachFeet: 5,
  formula: "1d6 + 1",
  damageType: "slashing",
  /** The d20, then the d6; both exact. */
  attackFace: 15,
  damageFace: 4,
  attackTotal: 18,
  damageTotal: 5,
  targetAc: 12
} as const;

function authoredBandit(): Draft {
  const damagePart = authoredRow(
    "monster",
    ["actions", "damage"],
    [
      ["formula", BANDIT.formula],
      ["type", BANDIT.damageType]
    ]
  );
  const action = authoredRow(
    "monster",
    ["actions"],
    [
      ["name", BANDIT.actionName],
      ["activation", "action"],
      ["description", BANDIT.description],
      ["damage", [damagePart]],
      ["attack.bonus", BANDIT.bonus],
      ["attack.reachFeet", BANDIT.reachFeet]
    ]
  );
  return authored("monster", "Road Bandit", [
    ["abilityScores.str", 11],
    ["abilityScores.dex", 12],
    ["abilityScores.con", 12],
    ["abilityScores.int", 10],
    ["abilityScores.wis", 10],
    ["abilityScores.cha", 10],
    ["armorClass", 12],
    ["hitPoints.maximum", 11],
    ["proficiencyBonus", 2],
    ["actions", [{ ...action, id: BANDIT.actionId }]]
  ]);
}

const srdBandit = (): ActorDefinition => {
  const definition = new ContentLibrary().forAudience("gm").monster(BANDIT.monsterId);
  if (!definition) throw new Error("The SRD bundle no longer ships a Bandit — this fixture needs a new carrier.");
  return definition;
};

/** Swings the fixture's melee attack at a dummy. No `distanceFeet`, so range rules stay out of it. */
function swing(definition: ActorDefinition) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.caster,
        name: definition.name,
        kind: "monster",
        visibility: "public",
        hp: { current: 11, maximum: 11 },
        armorClass: 12,
        definitionId: "def-caster"
      },
      {
        id: IDS.target,
        name: "Target Dummy",
        kind: "monster",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        armorClass: BANDIT.targetAc
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.caster, score: 20 },
        { actorId: IDS.target, score: 10 }
      ]
    },
    () => 1,
    GEOMETRY
  );

  const action = effectiveActions(definition, state.actors[0], undefined).find((entry) => entry.id === BANDIT.actionId);
  if (!action) throw new Error(`${definition.name} has no "${BANDIT.actionId}" action.`);

  const queue = [BANDIT.attackFace, BANDIT.damageFace];
  return resolveDefinitionAction(
    state,
    action,
    { actorId: IDS.caster, targetIds: [IDS.target], commandId: IDS.command },
    {
      random: () => {
        const face = queue.shift();
        if (face === undefined) throw new Error("dice queue empty");
        return face;
      },
      newRollId: () => IDS.roll,
      gmSessionId: IDS.gmSession,
      now: () => "2026-08-08T00:00:00.000Z",
      definition
    }
  );
}

describe("a monster's to-hit bonus — through both paths", () => {
  it("1. the editor can author it: `attack.bonus` goes through a real control, and the body publishes", () => {
    const draft = authoredBandit();
    const verdict = publishVerdict("monster", draft, RECORD_ID);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("monster", draft, RECORD_ID) as { actions: Array<Record<string, unknown>> };
    expect(body.actions[0]).toMatchObject({
      id: BANDIT.actionId,
      attack: { bonus: BANDIT.bonus, reachFeet: BANDIT.reachFeet }
    });
    // The feature-shaped `ability` must not be offered: `ActionSchema` would strip it silently.
    expect(hasControl("monster", "attack.ability", ["actions"])).toBe(false);
    expect(hasControl("equipment", "attack.bonus", ["actions"])).toBe(false);
    expect(hasControl("equipment", "attack.ability", ["actions"])).toBe(true);
  });

  it("2. SRD content authors the same shape — and it is not a lone record", () => {
    expect(srdBandit().actions.find((entry) => entry.id === BANDIT.actionId)).toMatchObject({
      attack: { bonus: BANDIT.bonus, reachFeet: BANDIT.reachFeet },
      damage: [{ formula: BANDIT.formula, type: BANDIT.damageType }]
    });

    const library = new ContentLibrary().forAudience("gm");
    const carriers = library
      .monsterSummaries()
      .flatMap((summary) => library.monster(summary.id)?.actions ?? [])
      .filter((entry) => entry.attack !== undefined);
    expect(carriers.length).toBeGreaterThanOrEqual(400);
  });

  it("3. one assertion body over both: the same d20 total against the same AC", () => {
    const editorBody = storedBody("monster", authoredBandit(), RECORD_ID);
    const paths: ReadonlyArray<readonly [string, ActorDefinition]> = [
      ["SRD content", srdBandit()],
      ["the homebrew editor", HOMEBREW_BODY_SCHEMAS.monster.parse(editorBody)]
    ];

    for (const [label, definition] of paths) {
      const resolution = swing(definition);
      // A natural 15 plus the authored +3 is 18, beating AC 12, so the hit rolls damage.
      expect(resolution.attack, label).toMatchObject({
        naturalRoll: BANDIT.attackFace,
        total: BANDIT.attackTotal,
        targetAc: BANDIT.targetAc,
        outcome: "hit"
      });
      expect(resolution.damage, label).toEqual([
        { formula: BANDIT.formula, type: BANDIT.damageType, total: BANDIT.damageTotal }
      ]);
    }
  });
});

/* --------------------------- the normal-range band, through both paths ---------- */

/** `attack.rangeNormalFeet`, the 80 in "range 80/320". Past it the engine adds a long-range
    disadvantage die (`attackRollSources`). Proved by contrast: the same shot inside and past the band,
    where only the far one rolls `2d20` keeping the lower. */
const CROSSBOW = {
  actionId: "light-crossbow",
  actionName: "Light Crossbow",
  description: "Ranged Attack Roll: +3, range 80/320 ft. 5 (1d8 + 1) Piercing damage.",
  bonus: 3,
  rangeFeet: 320,
  rangeNormalFeet: 80,
  formula: "1d8 + 1",
  damageType: "piercing",
  nearFeet: 50,
  farFeet: 200,
  /** Inside the band: 17 + 3 = 20 beats AC 12, and the d8 shows 5. */
  nearFaces: [17, 5],
  nearTotal: 20,
  nearDamage: 6,
  /** Past it: 2d20kl1 sees 17 and 6, keeps 6, and 6 + 3 = 9 misses. */
  farFaces: [17, 6],
  farNatural: 6,
  farTotal: 9,
  targetAc: 12
} as const;

function authoredCrossbow(): Draft {
  const damagePart = authoredRow(
    "monster",
    ["actions", "damage"],
    [
      ["formula", CROSSBOW.formula],
      ["type", CROSSBOW.damageType]
    ]
  );
  const action = authoredRow(
    "monster",
    ["actions"],
    [
      ["name", CROSSBOW.actionName],
      ["activation", "action"],
      ["description", CROSSBOW.description],
      ["damage", [damagePart]],
      ["attack.bonus", CROSSBOW.bonus],
      ["attack.rangeFeet", CROSSBOW.rangeFeet],
      ["attack.rangeNormalFeet", CROSSBOW.rangeNormalFeet]
    ]
  );
  return authored("monster", "Road Bandit", [
    ["abilityScores.str", 11],
    ["abilityScores.dex", 12],
    ["abilityScores.con", 12],
    ["abilityScores.int", 10],
    ["abilityScores.wis", 10],
    ["abilityScores.cha", 10],
    ["armorClass", 12],
    ["hitPoints.maximum", 11],
    ["proficiencyBonus", 2],
    ["actions", [{ ...action, id: CROSSBOW.actionId }]]
  ]);
}

/** Shoots from `feet` away, passing a real `distanceFeet` to the resolver. */
function shoot(definition: ActorDefinition, feet: number, faces: readonly number[]) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.caster,
        name: definition.name,
        kind: "monster",
        visibility: "public",
        hp: { current: 11, maximum: 11 },
        armorClass: 12,
        definitionId: "def-caster"
      },
      {
        id: IDS.target,
        name: "Target Dummy",
        kind: "monster",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        armorClass: CROSSBOW.targetAc
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.caster, score: 20 },
        { actorId: IDS.target, score: 10 }
      ]
    },
    () => 1,
    GEOMETRY
  );

  const action = effectiveActions(definition, state.actors[0], undefined).find(
    (entry) => entry.id === CROSSBOW.actionId
  );
  if (!action) throw new Error(`${definition.name} has no "${CROSSBOW.actionId}" action.`);

  const queue = [...faces];
  return resolveDefinitionAction(
    state,
    action,
    { actorId: IDS.caster, targetIds: [IDS.target], commandId: IDS.command },
    {
      random: () => {
        const face = queue.shift();
        if (face === undefined) throw new Error("dice queue empty");
        return face;
      },
      newRollId: () => IDS.roll,
      gmSessionId: IDS.gmSession,
      now: () => "2026-08-08T00:00:00.000Z",
      definition,
      distanceFeet: () => feet
    }
  );
}

describe("a two-band range — through both paths", () => {
  it("1. the editor can author it: `attack.rangeNormalFeet` goes through a real control, and the body publishes", () => {
    const draft = authoredCrossbow();
    const verdict = publishVerdict("monster", draft, RECORD_ID);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("monster", draft, RECORD_ID) as { actions: Array<Record<string, unknown>> };
    expect(body.actions[0]).toMatchObject({
      attack: { bonus: CROSSBOW.bonus, rangeFeet: CROSSBOW.rangeFeet, rangeNormalFeet: CROSSBOW.rangeNormalFeet }
    });
    // The key exists on both attack schemas, so every action carrier can author it.
    for (const type of ["monster", "equipment", "class"] as const) {
      expect(hasControl(type, "attack.rangeNormalFeet", ["actions"]), type).toBe(true);
    }
  });

  it("2. SRD content authors the same shape — and it is not a lone record", () => {
    expect(srdBandit().actions.find((entry) => entry.id === CROSSBOW.actionId)).toMatchObject({
      attack: { bonus: CROSSBOW.bonus, rangeFeet: CROSSBOW.rangeFeet, rangeNormalFeet: CROSSBOW.rangeNormalFeet }
    });

    const library = new ContentLibrary().forAudience("gm");
    const carriers = library
      .monsterSummaries()
      .flatMap((summary) => library.monster(summary.id)?.actions ?? [])
      .filter((entry) => entry.attack?.rangeNormalFeet !== undefined);
    expect(carriers.length).toBeGreaterThanOrEqual(40);
  });

  it("3. one assertion body over both: inside the band it is one die, past it two and the lower kept", () => {
    const editorBody = storedBody("monster", authoredCrossbow(), RECORD_ID);
    const paths: ReadonlyArray<readonly [string, ActorDefinition]> = [
      ["SRD content", srdBandit()],
      ["the homebrew editor", HOMEBREW_BODY_SCHEMAS.monster.parse(editorBody)]
    ];

    for (const [label, definition] of paths) {
      // Inside the band: one d20, no `rollMode`, and the 17 stands.
      const near = shoot(definition, CROSSBOW.nearFeet, CROSSBOW.nearFaces);
      expect(near.rollMode, label).toBeUndefined();
      expect(near.attack, label).toMatchObject({ naturalRoll: 17, total: CROSSBOW.nearTotal, outcome: "hit" });
      expect(near.damageTotal, label).toBe(CROSSBOW.nearDamage);

      // Past it: the same first face plus a second die; the lower is kept, so the hit becomes a miss.
      const far = shoot(definition, CROSSBOW.farFeet, CROSSBOW.farFaces);
      expect(far.rollMode?.mode, label).toBe("disadvantage");
      expect(far.rollMode?.disadvantage, label).toContain(`Long range (beyond ${CROSSBOW.rangeNormalFeet} ft)`);
      expect(far.attack, label).toMatchObject({
        naturalRoll: CROSSBOW.farNatural,
        total: CROSSBOW.farTotal,
        outcome: "miss"
      });
      expect(far.damageTotal, label).toBe(0);
    }
  });
});

/* ------------ what an effect does: an item effect and a feature effect ------------ */

/**
 * `EffectGrant.modifiers`. The SRD authors it only on features (Reckless Attack, Superior Defense),
 * so the editor half is an item and the SRD half a feature. Both reach the die through the one rider
 * evaluator: a feature's effect as a live `EffectInstance` on the actor, an equipped item's as a carrier
 * while it is worn (`takeEffects`). Either way the swing keeps the higher of two d20s.
 */
const RECKLESS = {
  classId: "barbarian",
  featureId: "reckless-attack",
  /** The SRD pair on one effect: the benefit and the cost. */
  srdModifiers: [
    { type: "roll-mode", roll: "attack", mode: "advantage" },
    { type: "roll-mode", roll: "incoming-attack", mode: "advantage" }
  ],
  itemId: "hb-bracers-a1b2c3",
  itemName: "Bracers of the Headlong Rush",
  swingId: "item-greataxe",
  /** Two d20s then the d12, low face first so "kept the higher" is visible. */
  advantageFaces: [3, 15, 8],
  /** The same swing with nothing helping: one d20, and the 3 stands. */
  plainFaces: [3, 8],
  natural: 15,
  plainNatural: 3
} as const;

/** A Halfling Barbarian 2: the lowest level with Reckless Attack, and a species with no bonus,
    modifier or choice of its own. Built through the real builder against the real bundles. */
const BARBARIAN: CharacterCreateRequestInput = {
  name: "Ozar",
  speciesId: "halfling",
  backgroundId: "soldier",
  classId: "barbarian",
  level: 2,
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [
    { ability: "str", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "barbarian", kind: "skill", id: "perception" },
    { level: 1, classId: "barbarian", kind: "skill", id: "survival" },
    { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "greataxe" },
    { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "handaxe" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "barbarian-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ]
} as CharacterCreateRequestInput;

type Table = Readonly<{
  definition: ActorDefinition;
  state: GameState;
  hero: Actor;
  catalog: ReturnType<typeof equipmentCatalogOf>;
}>;

/** The Barbarian on a map, first in the order. */
function barbarianTable(homebrew?: HomebrewContentSource): Table {
  const view = new ContentLibrary(homebrew).forAudience("gm");
  const catalog = equipmentCatalogOf(view);
  const definition = buildCharacterDefinition(BARBARIAN, view, BuilderPolicySchema.parse({}));
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.target,
        name: "Target Dummy",
        kind: "monster",
        visibility: "public",
        hp: { current: 200, maximum: 200 },
        armorClass: 12
      }
    ]
  });
  importActorDefinition(state, definition, IDS.caster, "public", catalog);
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.caster, score: 20 },
        { actorId: IDS.target, score: 10 }
      ]
    },
    () => 1,
    GEOMETRY
  );
  return { definition, state, hero: state.actors.find((actor) => actor.id === IDS.caster)!, catalog };
}

let recklessCommand = 0;
const nextCommand = () => `50000000-0000-4000-8000-${String(++recklessCommand).padStart(12, "0")}`;

function resolveOn(table: Table, actionId: string, faces: readonly number[], targetIds: readonly string[] = []) {
  const action = effectiveActions(table.definition, table.hero, table.catalog).find((entry) => entry.id === actionId);
  if (!action) throw new Error(`${table.definition.name} has no "${actionId}" action.`);
  const queue = [...faces];
  let roll = 0;
  return resolveDefinitionAction(
    table.state,
    action,
    { actorId: IDS.caster, targetIds: [...targetIds], commandId: nextCommand() },
    {
      random: () => {
        const face = queue.shift();
        if (face === undefined) throw new Error("dice queue empty");
        return face;
      },
      newRollId: () => `40000000-0000-4000-8000-0000000001${String(roll++).padStart(2, "0")}`,
      gmSessionId: IDS.gmSession,
      now: () => "2026-08-09T00:00:00.000Z",
      definition: table.definition,
      catalog: table.catalog
    }
  );
}

/** Swings the greataxe at the dummy. */
const swingGreataxe = (table: Table, faces: readonly number[]) =>
  resolveOn(table, RECKLESS.swingId, faces, [IDS.target]);

/** An item whose effect carries advantage on attack rolls, authored through the real form. */
function authoredBracers(): Draft {
  // Nested two containers deep.
  const modifier = authoredRow(
    "equipment",
    ["effects", "modifiers"],
    [
      ["type", "roll-mode"],
      ["roll", "attack"],
      ["mode", "advantage"]
    ]
  );
  const effect = authoredRow(
    "equipment",
    ["effects"],
    [
      ["name", "Headlong Rush"],
      ["tags", ["reckless"]],
      ["duration.type", "encounter"],
      ["modifiers", [modifier]]
    ]
  );
  return authored("equipment", RECKLESS.itemName, [
    ["description", "Iron bracers that pull the wearer forward into the swing."],
    ["category", "wondrous"],
    ["slot", "hands"],
    ["isMagic", true],
    ["effects", [effect]]
  ]);
}

/** The Barbarian wearing the authored bracers, merged through a real homebrew slice. */
function barbarianWearingBracers(): Table {
  const record = HOMEBREW_BODY_SCHEMAS.equipment.parse(storedBody("equipment", authoredBracers(), RECKLESS.itemId));
  const table = barbarianTable({
    revision: 1,
    publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, equipment: [record] }),
    monsterForInstance: () => undefined
  });
  table.hero.inventory.push(
    InventoryItemSchema.parse({
      id: RECKLESS.itemId,
      name: RECKLESS.itemName,
      quantity: 1,
      equipped: true,
      category: "wondrous"
    })
  );
  return table;
}

/** The SRD carrier, read from the shipped bundle through the server's content view. */
const srdRecklessAttack = () => {
  const record = new ContentLibrary().forAudience("gm").classRecord(RECKLESS.classId);
  const feature = record?.features.find((entry) => entry.id === RECKLESS.featureId);
  if (!feature) throw new Error("The SRD bundle no longer ships Reckless Attack — this fixture needs a new carrier.");
  return feature;
};

describe("what an effect DOES — through both paths, across two carriers", () => {
  it("1. the editor can author it: an effect's `modifiers` goes through a real control, and the body publishes", () => {
    const draft = authoredBracers();
    const verdict = publishVerdict("equipment", draft, RECKLESS.itemId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("equipment", draft, RECKLESS.itemId) as { effects: Array<Record<string, unknown>> };
    expect(body.effects[0]).toMatchObject({
      name: "Headlong Rush",
      tags: ["reckless"],
      duration: { type: "encounter" },
      modifiers: [{ type: "roll-mode", roll: "attack", mode: "advantage" }]
    });

    // Looked up in the effect's own fields: a flat lookup would resolve the feature-scope
    // `modifiersField` and falsely report the row authorable.
    expect(hasControl("equipment", "modifiers", ["effects"])).toBe(true);
    expect(hasControl("equipment", "damageTypes", ["effects", "modifiers"])).toBe(true);
    // One vocabulary, but an effect refuses what the sheet stores: `armor-class` is not offered on one.
    const offered = (kind: string) =>
      (applyField("equipment", { rowId: "r" }, "type", kind, ["effects", "modifiers"]) as { type?: string }).type;
    expect(offered("roll-mode")).toBe("roll-mode");
    expect(() => applyField("equipment", {}, "armor-class", 1, ["effects", "modifiers"])).toThrow();
  });

  it("2. SRD content authors the same shape — and both carriers of it are FEATURES", () => {
    const feature = srdRecklessAttack();
    expect(feature.effects[0]).toMatchObject({
      tags: ["reckless-attack"],
      modifiers: RECKLESS.srdModifiers
    });

    // Only two bundled records (both Barbarian features) author `effects[].modifiers`.
    const library = new ContentLibrary().forAudience("gm");
    const carriers = library
      .classSummaries()
      .flatMap((summary) => library.classRecord(summary.id)?.features ?? [])
      .filter((entry) => entry.effects.some((effect) => effect.modifiers.length > 0));
    expect(carriers.map((entry) => entry.id).sort()).toEqual(["reckless-attack", "superior-defense"]);
  });

  it("3. one assertion body over both: the swing rolls two d20s and keeps the higher", () => {
    const paths: ReadonlyArray<readonly [string, () => Table]> = [
      // Feature carrier: entering Reckless Attack writes the live effect.
      [
        "SRD content",
        () => {
          const table = barbarianTable();
          resolveOn(table, RECKLESS.featureId, []);
          return table;
        }
      ],
      // Item carrier: wearing the bracers is the effect.
      ["the homebrew editor", barbarianWearingBracers]
    ];

    for (const [label, tableOf] of paths) {
      const table = tableOf();
      const swung = swingGreataxe(table, RECKLESS.advantageFaces);
      // Two d20s, the higher kept, and the roll card says why.
      expect(swung.rollMode?.mode, label).toBe("advantage");
      expect(swung.attack?.naturalRoll, label).toBe(RECKLESS.natural);
      expect(swung.attack?.outcome, label).toBe("hit");
    }

    // Negative control: same sheet and faces with no carrier contributing, so one die and the 3 stands.
    const bare = swingGreataxe(barbarianTable(), RECKLESS.plainFaces);
    expect(bare.rollMode).toBeUndefined();
    expect(bare.attack?.naturalRoll).toBe(RECKLESS.plainNatural);
  });
});

/* --------------- `grants.spells`: always-prepared spell grants ---------------- */

/**
 * `FeatureGrantsSchema.spells` (`{id, level?, alwaysPrepared, ability?}`): the builder puts each
 * granted spell on the sheet, prepared and not counted against the prepared cap. Read on the feature
 * road only (`takeGrants` ignores it for items), so the editor carrier is a feat. One sheet carries
 * both paths: a Human Paladin whose class feature grants Divine Smite (SRD) and whose origin feat is
 * a homebrew feat granting Bless (editor).
 */
const GRANTED = {
  srdFeatureId: "paladins-smite",
  srdSpellId: "divine-smite",
  featId: "hb-wayfarers-blessing-a1b2",
  featName: "Wayfarer's Blessing",
  featSpellId: "bless"
} as const;

/** A feat built through the real form, with the grant written through `GrantsEditor`'s own
    `grantsFromRows` (`grants` has no `FieldDef`). The `{}` is the bag rebuilt over: nothing to carry
    here; see `grant-gate-preservation.mirror.test.ts` for the non-empty case. */
function authoredFeat(withGrant = true): Draft {
  const shell = authored("feat", GRANTED.featName, [
    ["category", "origin"],
    ["summary", "A blessing for the road."],
    ["description", "You always have the Bless spell prepared."]
  ]);
  const grants = withGrant
    ? grantsFromRows([{ rowId: "spells", kind: "spells", values: [GRANTED.featSpellId] }], {})
    : undefined;
  // A feat's single feature is addressed at `["feature"]`.
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", GRANTED.featName, ["feature"]);
  feature = applyField("feat", feature, "description", "You always have the Bless spell prepared.", ["feature"]);
  return { ...shell, feature: { ...feature, grants } };
}

/** A Human Paladin 2 (where `paladins-smite` sits); Human's Versatile trait is the origin-feat slot.
    Neither granted spell is chosen anywhere in the ledger. */
const paladinInput = (): CharacterCreateRequestInput =>
  ({
    name: "Sera",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "paladin",
    level: 2,
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 13 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "paladin", kind: "skill", id: "medicine" },
      { level: 1, classId: "paladin", kind: "skill", id: "persuasion" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: GRANTED.featId, payload: { featureId: "human-versatile" } },
      { level: 1, classId: "paladin", kind: "weapon-mastery", id: "longsword" },
      { level: 1, classId: "paladin", kind: "weapon-mastery", id: "javelin" },
      { level: 2, classId: "paladin", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      { level: 1, classId: "paladin", kind: "spell", id: "cure-wounds" },
      { level: 1, classId: "paladin", kind: "spell", id: "heroism" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "paladin-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/** The sheet from the real builder, with the authored feat merged through a real homebrew slice. */
function paladinSheet({ withGrant }: { withGrant: boolean }): ActorDefinition {
  const record = HOMEBREW_BODY_SCHEMAS.feat.parse(storedBody("feat", authoredFeat(withGrant), GRANTED.featId));
  const homebrew: HomebrewContentSource = {
    revision: 1,
    publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, feats: [record] }),
    monsterForInstance: () => undefined
  };
  return buildCharacterDefinition(
    paladinInput(),
    new ContentLibrary(homebrew).forAudience("gm"),
    BuilderPolicySchema.parse({})
  );
}

/** Whether the spell is on the sheet the way a grant puts it there. */
const preparedSpell = (definition: ActorDefinition, id: string) =>
  (definition.spellcasting?.spells ?? []).find((spell) => spell.id === id);

describe("an always-prepared spell grant — through both paths", () => {
  it("1. the editor can author it: the picked spell becomes `{id, alwaysPrepared}` and the feat publishes", () => {
    const draft = authoredFeat();
    const verdict = publishVerdict("feat", draft, GRANTED.featId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("feat", draft, GRANTED.featId) as { feature: { grants?: { spells?: unknown } } };
    expect(body.feature.grants?.spells).toEqual([{ id: GRANTED.featSpellId, alwaysPrepared: true }]);

    // Round trip through the component's own read, so reopening the record keeps the grant.
    expect(grantRowsOf(body.feature.grants as Record<string, unknown>)).toEqual([
      { rowId: "spells", kind: "spells", values: [GRANTED.featSpellId] }
    ]);

    // `grants` is invisible to the harness (bespoke JSX), so it stays exempt.
    expect(RIDER_EXEMPT).toEqual(["grants"]);
    expect(hasControl("feat", "grants")).toBe(false);
  });

  it("2. SRD content authors the same shape — and it is 41 records, not a lone one", () => {
    const library = new ContentLibrary().forAudience("gm");
    const carriers: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const entry of node) walk(entry);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const grants = record.grants as { spells?: unknown[] } | undefined;
      if (Array.isArray(grants?.spells) && grants.spells.length > 0) carriers.push(String(record.id ?? "?"));
      for (const value of Object.values(record)) walk(value);
    };
    for (const summary of library.classSummaries()) walk(library.classRecord(summary.id));
    for (const summary of library.speciesSummaries()) walk(library.speciesRecord(summary.id));
    for (const summary of library.subclassSummaries()) walk(library.subclassRecord(summary.id));

    // 41 at the time of writing; the Paladin's own carrier is named so the fixture can't drift.
    expect(carriers.length).toBeGreaterThanOrEqual(40);
    expect(carriers).toContain(GRANTED.srdFeatureId);
  });

  it("3. one assertion body over both: each spell is on the sheet, prepared, and always prepared", () => {
    const definition = paladinSheet({ withGrant: true });
    const paths: ReadonlyArray<readonly [string, string]> = [
      ["SRD content", GRANTED.srdSpellId],
      ["the homebrew editor", GRANTED.featSpellId]
    ];

    for (const [label, spellId] of paths) {
      const spell = preparedSpell(definition, spellId);
      // A row on the character's own spell list, castable without preparing it.
      expect(spell, label).toMatchObject({ id: spellId, prepared: true, alwaysPrepared: true });
      // The name is resolved from the catalog, not the grant.
      expect(spell?.name, label).not.toBe(spellId);
    }

    // Negative control: the same feat with no spell picked. Divine Smite (the class's) remains and
    // Bless is gone, so the grant is what put it there.
    const without = paladinSheet({ withGrant: false });
    expect(preparedSpell(without, GRANTED.srdSpellId)).toBeDefined();
    expect(preparedSpell(without, GRANTED.featSpellId)).toBeUndefined();
  });
});

/* ------- `uses.scaling: class-resource`: the class table's own column ----- */

/**
 * `FeatureUsesSchema.scaling` variant `class-resource` ("Rage the number of times shown in the Rages
 * column"): `resolvedUseLimit` reads the column at the character's level. The far end is a count
 * that moves with level (2 at level 1, 3 at level 3) from one authored record. Feature scope only:
 * `scaledLimit` cannot resolve it on an item.
 */
const RAGES = {
  classId: "barbarian",
  featureId: "rage",
  resourceId: "rage",
  /** The Rages column in `classes.v1.json`: 2 at levels 1-2, 3 at level 3. */
  atLevel1: 2,
  atLevel3: 3,
  featId: "hb-bottled-fury-a1b2",
  featName: "Bottled Fury",
  /** A column the Barbarian table doesn't print (the Sorcerer's), for the negative control. */
  wrongResourceId: "sorcery-points"
} as const;

/** A feat built through the real controls; `RiderEditor` is mounted with the feature as its value, so
    the `uses` block is written against the feature draft as the form writes it. */
function authoredFuryFeat(resourceId: string): Draft {
  const shell = authored("feat", RAGES.featName, [
    ["category", "origin"],
    ["summary", "Fury you can keep in a bottle."],
    ["description", "You can bottle your fury as often as you can Rage."]
  ]);
  // Addressed inside the `uses` group: `modifiersField` also has a `mode` key, and a flat lookup would
  // find that one first and write a stray `mode` key.
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "mode", "class-resource", ["uses"]);
  feature = applyField("feat", feature, "uses.scaling.id", resourceId, ["uses"]);
  feature = applyField("feat", feature, "uses.per", "long-rest", ["uses"]);
  feature = applyField("feat", feature, "name", RAGES.featName, ["feature"]);
  feature = applyField("feat", feature, "description", "You can bottle your fury as often as you can Rage.", [
    "feature"
  ]);
  return { ...shell, feature };
}

const furyFeatureId = (draft: Draft) => String((draft.feature as { id?: unknown }).id ?? "");

/** A Human Barbarian (Versatile is the origin-feat slot), Berserker at 3, from the real builder. */
const barbarianInput = (level: 1 | 3, featId?: string): CharacterCreateRequestInput =>
  ({
    name: "Ozar",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "barbarian",
    level,
    ...(level >= 3 ? { subclassId: "path-of-the-berserker" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "barbarian", kind: "skill", id: "perception" },
      { level: 1, classId: "barbarian", kind: "skill", id: "survival" },
      // Primal Knowledge (level 3) raises `class-skills` 2 -> 3.
      ...(level >= 3 ? [{ level: 3, classId: "barbarian", kind: "skill", id: "nature" }] : []),
      { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "greataxe" },
      { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "handaxe" },
      ...(level >= 3 ? [{ level: 3, classId: "barbarian", kind: "subclass", id: "path-of-the-berserker" }] : []),
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      ...(featId ? [{ level: 1, kind: "feat", id: featId, payload: { featureId: "human-versatile" } }] : []),
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "barbarian-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/** The sheet with the authored feat merged through a real homebrew slice. */
function barbarianSheet(level: 1 | 3, feat?: Draft): ActorDefinition {
  const homebrew: HomebrewContentSource | undefined = feat
    ? {
        revision: 1,
        publishedFor: () => ({
          ...EMPTY_HOMEBREW_SLICE,
          feats: [HOMEBREW_BODY_SCHEMAS.feat.parse(storedBody("feat", feat, RAGES.featId))]
        }),
        monsterForInstance: () => undefined
      }
    : undefined;
  return buildCharacterDefinition(
    barbarianInput(level, feat ? RAGES.featId : undefined),
    new ContentLibrary(homebrew).forAudience("gm"),
    BuilderPolicySchema.parse({})
  );
}

/** How many uses the builder resolved for this action. */
const limitOf = (definition: ActorDefinition, actionId: string) =>
  definition.actions.find((entry) => entry.id === actionId)?.uses?.limit;

describe("uses read off the class table's own column — through both paths", () => {
  it("1. the editor can author it: the fifth mode and its column id go through real controls, and the feat publishes", () => {
    const draft = authoredFuryFeat(RAGES.resourceId);
    const verdict = publishVerdict("feat", draft, RAGES.featId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("feat", draft, RAGES.featId) as { feature: { uses?: unknown } };
    expect(body.feature.uses).toEqual({ scaling: { type: "class-resource", id: RAGES.resourceId }, per: "long-rest" });

    // The mode select reads its value back from the shape, so reopening shows the right option.
    const mode = fieldsWithin("feat", ["uses"]).find((field) => field.key === "mode");
    expect(mode?.read?.(draft.feature as Draft)).toBe("class-resource");
    expect(optionValues(mode)).toContain("class-resource");

    // Not offered on an item: the key exists there, but the option does not.
    expect(hasControl("equipment", "uses.scaling.id")).toBe(false);
    expect(optionValues(fieldsWithin("equipment", ["uses"]).find((field) => field.key === "mode"))).not.toContain(
      "class-resource"
    );
  });

  it("2. SRD content authors the same shape — and it is 19 records, not a lone one", () => {
    const library = new ContentLibrary().forAudience("gm");
    const rage = library.classRecord(RAGES.classId)?.features.find((entry) => entry.id === RAGES.featureId);
    expect(rage?.uses).toEqual({ scaling: { type: "class-resource", id: RAGES.resourceId }, per: "long-rest" });

    const carriers: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const entry of node) walk(entry);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const uses = record.uses as { scaling?: { type?: string } } | undefined;
      if (uses?.scaling?.type === "class-resource") carriers.push(String(record.id ?? "?"));
      for (const value of Object.values(record)) walk(value);
    };
    for (const summary of library.classSummaries()) walk(library.classRecord(summary.id));
    for (const summary of library.subclassSummaries()) walk(library.subclassRecord(summary.id));

    // 19 at the time of writing (16 class, 3 subclass); four are named so the fixture can't drift.
    expect(carriers.length).toBeGreaterThanOrEqual(15);
    for (const id of ["rage", "wild-shape", "channel-divinity", "font-of-magic"]) expect(carriers).toContain(id);
  });

  it("3. one assertion body over both: the count is the printed column, and it moves with the level", () => {
    const feat = authoredFuryFeat(RAGES.resourceId);
    const bottled = furyFeatureId(feat);
    const paths: ReadonlyArray<readonly [string, string]> = [
      ["SRD content", RAGES.featureId],
      ["the homebrew editor", bottled]
    ];

    const level1 = barbarianSheet(1, feat);
    const level3 = barbarianSheet(3, feat);
    for (const [label, actionId] of paths) {
      // A count neither record states: 2 at level 1, 3 at level 3, from the same authored line.
      expect(limitOf(level1, actionId), label).toBe(RAGES.atLevel1);
      expect(limitOf(level3, actionId), label).toBe(RAGES.atLevel3);
    }

    // Negative control: the same feat naming the Sorcerer's column resolves to 0 uses, while Rage
    // still reads 3.
    const wrongFeat = authoredFuryFeat(RAGES.wrongResourceId);
    const wrong = barbarianSheet(3, wrongFeat);
    expect(limitOf(wrong, RAGES.featureId)).toBe(RAGES.atLevel3);
    expect(wrong.actions.find((entry) => entry.id === furyFeatureId(wrongFeat))).toBeUndefined();
  });
});

/* ---------------- `recharge`: the d6 at the start of the creature's turn ------ */

/**
 * `ActionUsesSchema.per: "recharge"` with its threshold, the "(Recharge 5–6)" on breath weapons.
 * `encounter.ts` rolls a d6 at the start of the owner's turn, re-arms on a roll at or above the
 * threshold and narrates both outcomes; `rests.ts` clears recharge pools on a short rest.
 *
 * The control is on the action's `uses`, not the record-level `FeatureUsesSchema`: an item's record
 * uses are not read, and a feature's are folded into actions without a threshold, which would make
 * the bearer unbuildable.
 *
 * The Ankheg's Acid Spray (Recharge 6) is the carrier: exactly one face re-arms it.
 */
const RECHARGE = {
  monsterId: "ankheg",
  srdActionId: "acid-spray",
  /** 6, so a 5 misses by one and only 6 re-arms. */
  threshold: 6,
  saveAbility: "dex",
  saveDc: 12,
  formula: "4d6",
  damageType: "acid",
  /** 4d6, all fours; the resolver consumes these before the counter is checked. */
  damageFaces: [4, 4, 4, 4],
  drakeActionId: "ember-breath",
  drakeActionName: "Ember Breath (Recharge 6)"
} as const;

function authoredDrake(): Draft {
  const damagePart = authoredRow(
    "monster",
    ["actions", "damage"],
    [
      ["formula", RECHARGE.formula],
      ["type", RECHARGE.damageType]
    ]
  );
  const edits: ReadonlyArray<readonly [string, unknown]> = [
    ["name", RECHARGE.drakeActionName],
    ["activation", "action"],
    ["description", "Dexterity Saving Throw: DC 12. Failure: 14 (4d6) Acid damage."],
    ["damage", [damagePart]],
    ["save.ability", RECHARGE.saveAbility],
    ["save.dc", RECHARGE.saveDc],
    // The count, then how it comes back, then the die.
    ["uses.limit", 1],
    ["uses.per", "recharge"],
    ["uses.recharge", RECHARGE.threshold]
  ];
  const action = authoredRow("monster", ["actions"], edits);
  return authored("monster", "Cinder Drake", [
    ["abilityScores.str", 17],
    ["abilityScores.dex", 11],
    ["abilityScores.con", 14],
    ["abilityScores.int", 3],
    ["abilityScores.wis", 13],
    ["abilityScores.cha", 6],
    ["armorClass", 14],
    ["hitPoints.maximum", 45],
    ["proficiencyBonus", 2],
    ["actions", [{ ...action, id: RECHARGE.drakeActionId }]]
  ]);
}

const srdAnkheg = (): ActorDefinition => {
  const definition = new ContentLibrary().forAudience("gm").monster(RECHARGE.monsterId);
  if (!definition) throw new Error("The SRD bundle no longer ships an Ankheg — this fixture needs a new carrier.");
  return definition;
};

type Narration = NonNullable<Parameters<typeof nextInitiativeTurn>[1]>;

/** Spends the action in a real fight, then gives the creature its next turn twice (a die one short of
    the threshold, then the threshold) and reports the spent counter, rolls, narration and re-armed pool. */
function spendThenRecharge(definition: ActorDefinition, actionId: string) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.caster,
        name: definition.name,
        kind: "monster",
        visibility: "public",
        hp: { current: 45, maximum: 45 },
        armorClass: 14,
        definitionId: "def-caster"
      },
      {
        id: IDS.target,
        name: "Target Dummy",
        kind: "monster",
        visibility: "public",
        hp: { current: 80, maximum: 80 },
        armorClass: 12
      }
    ]
  });
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
      entries: [
        { actorId: IDS.caster, score: 20 },
        { actorId: IDS.target, score: 10 }
      ]
    },
    () => 1,
    GEOMETRY
  );

  const action = effectiveActions(definition, state.actors[0], undefined).find((entry) => entry.id === actionId);
  if (!action) throw new Error(`${definition.name} has no "${actionId}" action.`);

  const queue = [...RECHARGE.damageFaces];
  resolveDefinitionAction(
    state,
    action,
    { actorId: IDS.caster, targetIds: [IDS.target], commandId: IDS.command },
    {
      random: () => {
        const face = queue.shift();
        if (face === undefined) throw new Error("dice queue empty");
        return face;
      },
      newRollId: () => IDS.roll,
      gmSessionId: IDS.gmSession,
      now: () => "2026-08-09T00:00:00.000Z",
      definition
    }
  );
  const actor = state.actors.find((entry) => entry.id === IDS.caster)!;
  const spent = actor.actionUses[actionId] ?? 0;

  /** The creature's next turn with a fixed d6: two advances, the dummy then back round. */
  const roundWith = (face: number): Narration => {
    const events: Narration = [];
    const deps = { resolveDefinition: () => definition, rollDie: () => face };
    nextInitiativeTurn(state, events, deps);
    nextInitiativeTurn(state, events, deps);
    return events;
  };

  const short = roundWith(RECHARGE.threshold - 1);
  const stillSpent = actor.actionUses[actionId] ?? 0;
  const hit = roundWith(RECHARGE.threshold);
  const armed = actor.actionUses[actionId] === undefined;

  return { actionName: action.name, spent, short, stillSpent, hit, armed };
}

describe("a recharging action — through both paths", () => {
  it("1. the editor can author it: `per: recharge` and its threshold go through real controls, and the body publishes", () => {
    const draft = authoredDrake();
    const verdict = publishVerdict("monster", draft, RECORD_ID);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("monster", draft, RECORD_ID) as { actions: Array<Record<string, unknown>> };
    expect(body.actions[0]).toMatchObject({
      id: RECHARGE.drakeActionId,
      uses: { limit: 1, per: "recharge", recharge: RECHARGE.threshold }
    });

    // An action's control on every carrier, not the record-level `uses` (no `recharge` key there).
    for (const type of ["monster", "equipment", "class"] as const) {
      expect(hasControl(type, "uses.recharge", ["actions"]), type).toBe(true);
    }
    expect(hasControl("equipment", "uses.recharge")).toBe(true); // reachable — inside an action row
    expect(fieldsWithin("equipment", ["uses"]).some((field) => field.key === "uses.recharge")).toBe(false);
  });

  it("1b. the two halves of one authored fact are held together by the form and by the schema", () => {
    // Choosing recharge seeds the SRD's commonest threshold.
    const seeded = authoredRow(
      "monster",
      ["actions"],
      [
        ["uses.limit", 1],
        ["uses.per", "recharge"]
      ]
    );
    expect(seeded.uses).toEqual({ limit: 1, per: "recharge", recharge: 5 });

    // Switching away deletes it, so the "threshold only with recharge" refusal is unreachable.
    const backToRest = applyField("monster", seeded, "uses.per", "long-rest", ["actions"]);
    expect(backToRest.uses).toEqual({ limit: 1, per: "long-rest" });

    // Emptying the number is one keystroke away; the refusal is the schema's own sentence.
    const emptied = applyField("monster", seeded, "uses.recharge", undefined, ["actions"]);
    const drake = authoredDrake();
    const half = {
      ...drake,
      actions: [{ ...emptied, id: RECHARGE.drakeActionId, name: RECHARGE.drakeActionName, description: "Half-said." }]
    };
    const verdict = publishVerdict("monster", half, RECORD_ID);
    expect(verdict.publishable).toBe(false);
    expect(verdict.why).toContain("Recharge uses need the d6 threshold");
  });

  it("2. SRD content authors the same shape — and it is 86 records, not a lone one", () => {
    const spray = srdAnkheg().actions.find((entry) => entry.id === RECHARGE.srdActionId);
    expect(spray?.uses).toEqual({ limit: 1, per: "recharge", recharge: RECHARGE.threshold });

    const library = new ContentLibrary().forAudience("gm");
    const carriers = library
      .monsterSummaries()
      .flatMap((summary) => library.monster(summary.id)?.actions ?? [])
      .filter((entry) => entry.uses?.per === "recharge");
    expect(carriers.length).toBeGreaterThanOrEqual(80);
    expect(carriers.every((entry) => typeof entry.uses?.recharge === "number")).toBe(true);
  });

  it("3. one assertion body over both: one short of the die it stays spent, on the die it comes back", () => {
    const editorBody = storedBody("monster", authoredDrake(), RECORD_ID);
    const paths: ReadonlyArray<readonly [string, ActorDefinition, string]> = [
      ["SRD content", srdAnkheg(), RECHARGE.srdActionId],
      ["the homebrew editor", HOMEBREW_BODY_SCHEMAS.monster.parse(editorBody), RECHARGE.drakeActionId]
    ];

    for (const [label, definition, actionId] of paths) {
      const seen = spendThenRecharge(definition, actionId);

      // 1. The use was really spent by the resolver.
      expect(seen.spent, label).toBe(1);

      // 2-3. A rolled die and its narration. One short of the threshold is the contrast that proves
      //      the re-arm is conditional.
      expect(
        seen.short.map((event) => event.text),
        label
      ).toContain(
        `${definition.name}'s ${seen.actionName} stays spent (rolled ${RECHARGE.threshold - 1}, needs ${RECHARGE.threshold}+).`
      );
      expect(seen.stillSpent, label).toBe(1);

      // 4. A re-armed pool and its narration.
      expect(
        seen.hit.map((event) => event.text),
        label
      ).toContain(`${definition.name}'s ${seen.actionName} recharges (rolled ${RECHARGE.threshold}).`);
      expect(seen.armed, label).toBe(true);
    }
  });
});

/* --------------- several picks on one record (`choices`), through both paths -- */

/**
 * `FeatureRecordSchema.choices`: one feature asking more than one question (Magic Initiate).
 * `featurePicks` reads `choice`/`choices` as one list (`choices` wins), the schema refuses both, and
 * the panel spells the list from its length via `writeChoiceBlocks`. The far end is the second pick
 * reaching a built sheet; the negative control drops the second block and the same ledger row is
 * refused by name.
 */
const SEVERAL = {
  srdFeatId: "magic-initiate-cleric",
  /** The SRD's two-pick shape: two cantrips and one level-1 spell from one list. */
  srdRows: [
    { kind: "cantrip", id: "guidance" },
    { kind: "cantrip", id: "thaumaturgy" },
    { kind: "spell", id: "bless" }
  ],
  hbFeatId: "hb-twin-disciplines-a1b2",
  /** Pinned because the ledger tags answers with the feature id (`feature:<id>`). */
  hbFeatureId: "twin-disciplines",
  hbFeatName: "Twin Disciplines",
  /** The editor half uses `from` lists (`fromCatalog` is unreachable from `applyField`). */
  hbCantrips: ["guidance", "sacred-flame"],
  hbSpells: ["bless", "cure-wounds"],
  hbRows: [
    { kind: "cantrip", id: "guidance" },
    { kind: "cantrip", id: "sacred-flame" },
    { kind: "spell", id: "bless" }
  ]
} as const;

/** A feat with two choice blocks, each authored at the `choices` row scope, then written through the
    field's own write. `withSecondPick: false` keeps only the cantrip block (negative control). */
function authoredTwinFeat(withSecondPick = true): Draft {
  const shell = authored("feat", SEVERAL.hbFeatName, [
    ["category", "origin"],
    ["summary", "Two disciplines, one teacher."],
    ["description", "You learn two cantrips and one level 1 spell."]
  ]);
  const cantrips = authoredRow(
    "feat",
    ["feature", "choices"],
    [
      ["kind", "cantrip"],
      ["choose", 2],
      // One comma-separated box; the block's `write` splits and slugs it.
      ["from", SEVERAL.hbCantrips.join(", ")]
    ]
  );
  const spell = authoredRow(
    "feat",
    ["feature", "choices"],
    [
      ["kind", "spell"],
      ["choose", 1],
      ["from", SEVERAL.hbSpells.join(", ")]
    ]
  );
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", SEVERAL.hbFeatName, ["feature"]);
  feature = applyField("feat", feature, "description", "You learn two cantrips and one level 1 spell.", ["feature"]);
  feature = applyField("feat", feature, "choices", withSecondPick ? [cantrips, spell] : [cantrips], ["feature"]);
  return { ...shell, feature: { ...feature, id: SEVERAL.hbFeatureId } };
}

/** A Human Paladin 2 taking `featId` in the Versatile slot, answering `rows` against the feat's
    feature (`tagId`, since offers are keyed `feature:<feature id>`). */
const initiateInput = (
  featId: string,
  tagId: string,
  rows: ReadonlyArray<{ kind: string; id: string }>
): CharacterCreateRequestInput =>
  ({
    name: "Sera",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "paladin",
    level: 2,
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 13 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "paladin", kind: "skill", id: "medicine" },
      { level: 1, classId: "paladin", kind: "skill", id: "persuasion" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: featId, payload: { featureId: "human-versatile" } },
      ...rows.map((row) => ({ level: 1, kind: row.kind, id: row.id, payload: { featureId: tagId } })),
      { level: 1, classId: "paladin", kind: "weapon-mastery", id: "longsword" },
      { level: 1, classId: "paladin", kind: "weapon-mastery", id: "javelin" },
      { level: 2, classId: "paladin", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      { level: 1, classId: "paladin", kind: "spell", id: "cure-wounds" },
      { level: 1, classId: "paladin", kind: "spell", id: "heroism" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "paladin-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/** The sheet, with the authored feat merged through a real homebrew slice when given. */
function initiateSheet(
  featId: string,
  tagId: string,
  rows: ReadonlyArray<{ kind: string; id: string }>,
  feat?: Draft
): ActorDefinition {
  const homebrew: HomebrewContentSource | undefined = feat
    ? {
        revision: 1,
        publishedFor: () => ({
          ...EMPTY_HOMEBREW_SLICE,
          feats: [HOMEBREW_BODY_SCHEMAS.feat.parse(storedBody("feat", feat, SEVERAL.hbFeatId))]
        }),
        monsterForInstance: () => undefined
      }
    : undefined;
  return buildCharacterDefinition(
    initiateInput(featId, tagId, rows),
    new ContentLibrary(homebrew).forAudience("gm"),
    BuilderPolicySchema.parse({})
  );
}

describe("several picks on one record (`choices`) — through both paths", () => {
  it("1. the editor can author it: two blocks through the block's own controls, spelled canonically", () => {
    const draft = authoredTwinFeat();
    const verdict = publishVerdict("feat", draft, SEVERAL.hbFeatId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    // Two blocks: plural spelling only, never both keys.
    const body = storedBody("feat", draft, SEVERAL.hbFeatId) as { feature: { choice?: unknown; choices?: unknown } };
    expect(body.feature.choice).toBeUndefined();
    expect(body.feature.choices).toEqual([
      { kind: "cantrip", choose: 2, from: [...SEVERAL.hbCantrips], repeatable: false },
      { kind: "spell", choose: 1, from: [...SEVERAL.hbSpells], repeatable: false }
    ]);

    // One block: the singular spelling.
    const oneBlock = storedBody("feat", authoredTwinFeat(false), SEVERAL.hbFeatId) as {
      feature: { choice?: unknown; choices?: unknown };
    };
    expect(oneBlock.feature.choices).toBeUndefined();
    expect(oneBlock.feature.choice).toEqual({
      kind: "cantrip",
      choose: 2,
      from: [...SEVERAL.hbCantrips],
      repeatable: false
    });

    // The `choice.*` aliases edit block 0 of a plural feature and keep the plural spelling.
    const feature = (draft.feature ?? {}) as Draft;
    const edited = applyField("feat", feature, "choice.choose", 3, ["feature"]);
    expect((edited.choices as Array<{ choose?: number }>)[0]?.choose).toBe(3);
    expect(edited.choice).toBeUndefined();

    const off = applyField("feat", feature, "choice", false, ["feature"]);
    expect("choice" in off).toBe(false);
    expect("choices" in off).toBe(false);
  });

  it("2. SRD content authors the same shape — three records, every one a Magic Initiate", () => {
    const library = new ContentLibrary().forAudience("gm");
    const carriers = library
      .featSummaries()
      .map((summary) => library.featRecord(summary.id))
      .filter((feat) => feat !== undefined && (feat.feature.choices?.length ?? 0) > 0)
      .map((feat) => feat!.id)
      .sort();
    // Exactly three at the time of writing, each with three picks (two cantrips, a level 1 spell, the
    // spellcasting ability) and no `choice` key.
    expect(carriers).toEqual(["magic-initiate-cleric", "magic-initiate-druid", "magic-initiate-wizard"]);

    const initiate = library.featRecord(SEVERAL.srdFeatId)!.feature;
    expect(initiate.choice).toBeUndefined();
    expect(initiate.choices).toHaveLength(3);
    expect(initiate.choices![0]).toMatchObject({ kind: "cantrip", choose: 2, fromCatalog: "cleric-spells" });
    expect(initiate.choices![1]).toMatchObject({ kind: "spell", choose: 1, fromCatalog: "cleric-spells" });
    expect(initiate.choices![2]).toMatchObject({
      kind: "spellcasting-ability",
      choose: 1,
      from: ["int", "wis", "cha"]
    });
  });

  it("3. one assertion body over both: every pick — the second included — is a spell on the sheet", () => {
    const paths: ReadonlyArray<readonly [string, ActorDefinition, ReadonlyArray<{ kind: string; id: string }>]> = [
      [
        "SRD content",
        initiateSheet(SEVERAL.srdFeatId, SEVERAL.srdFeatId, [
          ...SEVERAL.srdRows,
          { kind: "spellcasting-ability", id: "wis" }
        ]),
        SEVERAL.srdRows
      ],
      [
        "the homebrew editor",
        initiateSheet(SEVERAL.hbFeatId, SEVERAL.hbFeatureId, SEVERAL.hbRows, authoredTwinFeat()),
        SEVERAL.hbRows
      ]
    ];
    for (const [label, definition, rows] of paths) {
      for (const row of rows) {
        const spell = preparedSpell(definition, row.id);
        // The cantrips arrive always prepared, and so does the level-1 spell.
        expect(spell, `${label}: ${row.id}`).toMatchObject({ id: row.id, prepared: true });
        expect(spell?.name, `${label}: ${row.id}`).not.toBe(row.id);
      }
    }

    // Negative control: only the first block. The spell row now targets a missing pick and the build
    // refuses it by name.
    expect(() => initiateSheet(SEVERAL.hbFeatId, SEVERAL.hbFeatureId, SEVERAL.hbRows, authoredTwinFeat(false))).toThrow(
      `No feature "${SEVERAL.hbFeatureId}" offers a "spell" choice.`
    );
  });
});

/* ---------- a budget raised past the printed row (`extraPicks`), both paths --- */

/**
 * `extraPicks`: a feature or chosen option that raises a pick budget (Divine Order's Thaumaturge:
 * `{offer: "class-cantrips", amount: 1}`), resolved by the shared `extraPickAmount`. The far end is a
 * capacity: a fourth cantrip becomes legal for a Cleric 1, and the negative control sees it refused
 * by the cap. The scaling form (`class-resource-growth`) is proved via `computeServerOffers`, where
 * capacity follows the printed column. The SRD half is an inline option, the editor half a feat's
 * feature, so both fold points are covered.
 */
const RAISED = {
  /** Cleric 1 prints 3 cantrips; Light is the fourth. */
  printedCantrips: 3,
  cantrips: ["guidance", "sacred-flame", "thaumaturgy", "light"],
  capSentence: "Cleric knows 3 cantrips at level 1; got 4.",
  featId: "hb-whispered-lore-a1b2",
  featName: "Whispered Lore",
  /** A feat whose skill budget grows with the Rages column. */
  scaleFeatId: "hb-bottled-instinct-a1b2",
  scaleFeatName: "Bottled Instinct",
  /** Barbarian class-skills: 2 printed; at level 3 Primal Knowledge adds 1 and the Rages column grows
      by 1, so the offer reads 2 at level 1 and 4 at level 3 with the feat. */
  scaleColumn: "rage"
} as const;

/** A feat with one `extraPicks` row in Thaumaturge's shape; `newRow` seeds the flat amount at 1. */
function authoredLoreFeat(): Draft {
  const shell = authored("feat", RAISED.featName, [
    ["category", "origin"],
    ["summary", "Lore whispers one more trick."],
    ["description", "You know one extra cantrip from your class's list."]
  ]);
  const grant = authoredRow("feat", ["feature", "extraPicks"], [["offer", "class-cantrips"]]);
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", RAISED.featName, ["feature"]);
  feature = applyField("feat", feature, "description", "You know one extra cantrip from your class's list.", [
    "feature"
  ]);
  feature = applyField("feat", feature, "extraPicks", [grant], ["feature"]);
  return { ...shell, feature };
}

/** The scaling form: the mode select swaps the flat amount for the column rule. */
function authoredInstinctFeat(): Draft {
  const shell = authored("feat", RAISED.scaleFeatName, [
    ["category", "origin"],
    ["summary", "Instinct grows with fury."],
    ["description", "You gain extra skill proficiencies as your rage deepens."]
  ]);
  const grant = authoredRow(
    "feat",
    ["feature", "extraPicks"],
    [
      ["offer", "class-skills"],
      ["mode", "column-growth"],
      ["scaling.id", RAISED.scaleColumn]
    ]
  );
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", RAISED.scaleFeatName, ["feature"]);
  feature = applyField("feat", feature, "description", "You gain extra skill proficiencies as your rage deepens.", [
    "feature"
  ]);
  feature = applyField("feat", feature, "extraPicks", [grant], ["feature"]);
  return { ...shell, feature };
}

/** A merged content view carrying one authored feat, or the plain bundles when none is given. */
function raisedView(featId?: string, feat?: Draft) {
  const homebrew: HomebrewContentSource | undefined =
    featId && feat
      ? {
          revision: 1,
          publishedFor: () => ({
            ...EMPTY_HOMEBREW_SLICE,
            feats: [HOMEBREW_BODY_SCHEMAS.feat.parse(storedBody("feat", feat, featId))]
          }),
          monsterForInstance: () => undefined
        }
      : undefined;
  return new ContentLibrary(homebrew).forAudience("gm");
}

/** A Human Cleric 1 with four cantrips in the ledger. `order` decides what raises the cap: Thaumaturge
    (SRD option), Protector plus the authored feat (editor), or Protector alone (negative control). */
const clericInput = (order: "protector" | "thaumaturge", featId?: string): CharacterCreateRequestInput =>
  ({
    name: "Sister Ael",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "cleric",
    level: 1,
    abilityMethod: "standard-array",
    baseScores: { str: 10, dex: 12, con: 14, int: 8, wis: 15, cha: 13 },
    // Scores play no part in capacity.
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "cleric", kind: "skill", id: "history" },
      { level: 1, classId: "cleric", kind: "skill", id: "insight" },
      { level: 1, classId: "cleric", kind: "divine-order", id: order, payload: { featureId: "divine-order" } },
      ...RAISED.cantrips.map((id) => ({ level: 1, kind: "cantrip", id })),
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      ...(featId ? [{ level: 1, kind: "feat", id: featId, payload: { featureId: "human-versatile" } }] : []),
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "cleric-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A Human Barbarian at `level`, with the scaling feat when given, as `computeServerOffers` input. */
const instinctInput = (level: 1 | 3, featId?: string): CharacterCreateRequestInput =>
  ({
    name: "Ozar",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "barbarian",
    level,
    ...(level >= 3 ? { subclassId: "path-of-the-berserker" } : {}),
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [...(featId ? [{ level: 1, kind: "feat", id: featId, payload: { featureId: "human-versatile" } }] : [])]
  }) as CharacterCreateRequestInput;

/** One offer's `capacity` from `computeServerOffers`. */
const capacityOf = (
  input: CharacterCreateRequestInput,
  key: string,
  featId?: string,
  feat?: Draft
): number | undefined =>
  computeServerOffers(input, raisedView(featId, feat), BuilderPolicySchema.parse({})).offers.find(
    (offer) => offer.key === key
  )?.capacity;

describe("a budget raised past the printed row (`extraPicks`) — through both paths", () => {
  it("1. the editor can author it: offer, amount and the column rule go through real controls, exactly one of the pair stored", () => {
    const draft = authoredLoreFeat();
    const verdict = publishVerdict("feat", draft, RAISED.featId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);
    const body = storedBody("feat", draft, RAISED.featId) as { feature: { extraPicks?: unknown } };
    // Thaumaturge's shape, with no `scaling` key.
    expect(body.feature.extraPicks).toEqual([{ offer: "class-cantrips", amount: 1 }]);

    const scaled = storedBody("feat", authoredInstinctFeat(), RAISED.scaleFeatId) as {
      feature: { extraPicks?: unknown };
    };
    // The scaling form, with no `amount` key: the mode select keeps them exclusive.
    expect(scaled.feature.extraPicks).toEqual([
      { offer: "class-skills", scaling: { type: "class-resource-growth", id: RAISED.scaleColumn } }
    ]);

    // Switching back deletes the column rule and re-seeds the flat amount.
    const grant = authoredRow(
      "feat",
      ["feature", "extraPicks"],
      [
        ["offer", "class-skills"],
        ["mode", "column-growth"],
        ["scaling.id", RAISED.scaleColumn]
      ]
    );
    expect(applyField("feat", grant, "mode", "flat", ["feature", "extraPicks"])).toMatchObject({
      offer: "class-skills",
      amount: 1
    });
    expect("scaling" in applyField("feat", grant, "mode", "flat", ["feature", "extraPicks"])).toBe(false);

    // The column id is seeded empty, so a half-set scaling is refused by name.
    const half = authoredRow(
      "feat",
      ["feature", "extraPicks"],
      [
        ["offer", "class-skills"],
        ["mode", "column-growth"]
      ]
    );
    const feature = applyField(
      "feat",
      (authoredInstinctFeat().feature ?? {}) as Draft,
      "extraPicks",
      [half],
      ["feature"]
    );
    expect(publishVerdict("feat", { ...authoredInstinctFeat(), feature }, RAISED.scaleFeatId).publishable).toBe(false);

    // Inline options mount the same factory.
    expect(hasControl("class", "extraPicks", ["features", "choice.options"])).toBe(true);
    const option = authoredRow(
      "feat",
      ["feature", "choice.options"],
      [
        ["name", "Thaumaturge"],
        ["description", "You know one extra cantrip from the Cleric spell list."],
        [
          "extraPicks",
          [authoredRow("feat", ["feature", "choice.options", "extraPicks"], [["offer", "class-cantrips"]])]
        ]
      ]
    );
    expect(option).toMatchObject({ name: "Thaumaturge", extraPicks: [{ offer: "class-cantrips", amount: 1 }] });
  });

  it("2. SRD content authors the same shape — 8 grants, 6 on features and 2 on inline options", () => {
    const library = new ContentLibrary().forAudience("gm");
    const carriers: Array<{ id: string; grant: Record<string, unknown> }> = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const entry of node) walk(entry);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.extraPicks) && record.extraPicks.length > 0) {
        for (const grant of record.extraPicks)
          carriers.push({ id: String(record.id ?? "?"), grant: grant as Record<string, unknown> });
      }
      for (const value of Object.values(record)) walk(value);
    };
    for (const summary of library.classSummaries()) walk(library.classRecord(summary.id));

    // 8 at the time of writing: six features and two inline options (thaumaturge, magician).
    expect(carriers.length).toBe(8);
    expect(carriers.find((entry) => entry.id === "thaumaturge")?.grant).toEqual({ offer: "class-cantrips", amount: 1 });
    // Three of the eight scale off a printed column.
    const scaled = carriers.filter((entry) => entry.grant.scaling !== undefined);
    expect(scaled.map((entry) => entry.id).sort()).toEqual([
      "eldritch-invocations",
      "weapon-mastery",
      "weapon-mastery"
    ]);
    expect(carriers.find((entry) => entry.id === "eldritch-invocations")?.grant).toEqual({
      offer: "feature:eldritch-invocations",
      scaling: { type: "class-resource-growth", id: "eldritch-invocations" }
    });
  });

  it("3. one assertion body over both: the raised cap makes a fourth cantrip legal, and nothing else does", () => {
    const paths: ReadonlyArray<readonly [string, "protector" | "thaumaturge", string, Draft | undefined]> = [
      // SRD: the grant rides the chosen option (Thaumaturge); Alert raises nothing.
      ["SRD content", "thaumaturge", "alert", undefined],
      // Editor: the grant rides a chosen feat; Protector raises nothing.
      ["the homebrew editor", "protector", RAISED.featId, authoredLoreFeat()]
    ];
    for (const [label, order, featId, feat] of paths) {
      const definition = buildCharacterDefinition(
        clericInput(order, featId),
        raisedView(feat ? featId : undefined, feat),
        BuilderPolicySchema.parse({})
      );
      // All four cantrips on the sheet, prepared.
      for (const id of RAISED.cantrips) {
        expect(preparedSpell(definition, id), `${label}: ${id}`).toMatchObject({ id, prepared: true });
      }
    }

    // Negative control: nothing raises the cap, so the fourth cantrip is refused by the cap itself.
    expect(() =>
      buildCharacterDefinition(clericInput("protector", "alert"), raisedView(), BuilderPolicySchema.parse({}))
    ).toThrow(RAISED.capSentence);
  });

  it("4. the scaling form: an offer's capacity follows the printed column, from both paths", () => {
    // SRD: Eldritch Invocations. The table prints 1 at level 1 and 3 at level 2.
    expect(capacityOf(warlockInput(1), "feature:eldritch-invocations")).toBe(1);
    expect(capacityOf(warlockInput(2), "feature:eldritch-invocations")).toBe(3);

    // Editor: the skill budget grows with the Rages column (0 growth at level 1); at level 3 it adds
    // to Primal Knowledge's +1: 2 + 1 + 1.
    const feat = authoredInstinctFeat();
    expect(capacityOf(instinctInput(1, RAISED.scaleFeatId), "class-skills", RAISED.scaleFeatId, feat)).toBe(2);
    expect(capacityOf(instinctInput(3, RAISED.scaleFeatId), "class-skills", RAISED.scaleFeatId, feat)).toBe(4);
    // Without the feat the level-3 offer is 3.
    expect(capacityOf(instinctInput(3), "class-skills")).toBe(3);
  });
});

/** A Warlock at `level` with an empty ledger; `computeServerOffers` needs identity and scores only. */
const warlockInput = (level: 1 | 2): CharacterCreateRequestInput =>
  ({
    name: "Vex",
    speciesId: "human",
    backgroundId: "soldier",
    classId: "warlock",
    level,
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: []
  }) as CharacterCreateRequestInput;

/* ---- a settled pick re-opened (`replaces`, `replacesFeatureId`), both paths --- */

/**
 * `FeatureRecordSchema.replaces` ("choose one damage type whenever you finish a Short or Long Rest")
 * and `replacesFeatureId` (a feature superseding an earlier one). `replaces` is validated against the
 * offer-key namespace, turned into rest-time permissions by `replaceableOffers`, written by
 * `actor.rechoose`, cleared by `rests.ts` and read at damage time by `choiceOverrideDefenses`.
 *
 * The far end is a settled row answered again: the resistance moves to the new type and the feature
 * is named as the reason. The negative control drops only the clause. The SRD half is a subclass
 * feature (Fiendish Resilience); the editor half is a species trait, because `replaceableOffers`
 * walks `character.features` and a feat is recorded on `character.feats`.
 */
const REOPENED = {
  srcSubclassId: "fiend-patron",
  srdFeatureId: "fiendish-resilience",
  srdOffer: "feature:fiendish-resilience",
  speciesId: "hb-emberkin-a1b2",
  speciesName: "Emberkin",
  /** Pinned because the ledger tags its answer with the feature id. */
  traitId: "ember-ward",
  traitName: "Ember Ward",
  offer: "feature:ember-ward",
  /** The build's answer, and the re-choice that replaces it. */
  built: "fire",
  rechosen: "cold",
  /** `replacesFeatureId` carriers: the Fighter's second attack tier, and an authored class. */
  fighterReplaced: "extra-attack",
  fighterReplacing: "two-extra-attacks",
  classId: "hb-warden-a1b2",
  wardId: "ward",
  greaterWardId: "greater-ward"
} as const;

/** One inline option of the authored trait. The resistance goes through `grantsFromRows` (`grants`
    has no `FieldDef`); everything else is the option row's own control. */
const wardOption = (id: string, name: string): Draft => ({
  ...authoredRow(
    "species",
    ["traits", "choice.options"],
    [
      ["name", name],
      ["description", `You have Resistance to ${name} damage until you choose a different type.`]
    ]
  ),
  id,
  grants: grantsFromRows([{ rowId: "damageResistances", kind: "damageResistances", values: [id] }], {})
});

/** A species with one choice-asking trait and a short-rest `replaces` clause. `withClause: false` is
    the negative control. */
function authoredEmberkin(withClause = true): Draft {
  let trait = authoredRow(
    "species",
    ["traits"],
    [
      ["name", REOPENED.traitName],
      ["description", "Choose one damage type whenever you finish a Short or Long Rest."],
      ["choice", true],
      ["choice.kind", "damage-type"],
      ["choice.options", [wardOption(REOPENED.built, "Fire"), wardOption(REOPENED.rechosen, "Cold")]]
    ]
  );
  trait = { ...trait, id: REOPENED.traitId };
  if (withClause) {
    const clause = authoredRow(
      "species",
      ["traits", "replaces"],
      [
        ["offer", REOPENED.offer],
        ["when", "short-rest"]
      ]
    );
    trait = applyField("species", trait, "replaces", [clause], ["traits"]);
  }
  return authored("species", REOPENED.speciesName, [
    ["summary", "Kin of the cinder, warded against one element at a time."],
    ["description", "Emberkin carry a ward they re-tune whenever they rest."],
    ["sizes", ["medium"]],
    ["speedFeet", 30],
    ["traits", [trait]]
  ]);
}

/** A merged view carrying the authored species. */
const emberkinView = (species: Draft) => {
  const record = HOMEBREW_BODY_SCHEMAS.species.parse(storedBody("species", species, REOPENED.speciesId));
  return new ContentLibrary({
    revision: 1,
    publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, species: [record] }),
    monsterForInstance: () => undefined
  }).forAudience("gm");
};

/** An Emberkin Fighter 1 who has already answered the ward. */
const emberkinInput = (): CharacterCreateRequestInput =>
  ({
    name: "Ash",
    speciesId: REOPENED.speciesId,
    backgroundId: "soldier",
    classId: "fighter",
    level: 1,
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "damage-type", id: REOPENED.built, payload: { featureId: REOPENED.traitId } },
      { level: 1, classId: "fighter", kind: "skill", id: "history" },
      { level: 1, classId: "fighter", kind: "skill", id: "survival" },
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longsword" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "javelin" },
      { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A Fiend-Patron Warlock 10 (where Fiendish Resilience arrives) with the damage type already chosen. */
const resilientWarlock = (damageType: string): CharacterCreateRequestInput =>
  ({
    name: "Vex",
    speciesId: "human",
    backgroundId: "acolyte",
    classId: "warlock",
    level: 10,
    subclassId: REOPENED.srcSubclassId,
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation: [
      { ability: "cha", amount: 2 },
      { ability: "wis", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      // The Acolyte's origin feat, Magic Initiate (Cleric), asks for three picks.
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
      { level: 1, classId: "warlock", kind: "skill", id: "deception" },
      ...[
        "agonizing-blast",
        "devils-sight",
        "eldritch-mind",
        "repelling-blast",
        "armor-of-shadows",
        "ascendant-step",
        "fiendish-vigor"
      ].map((id) => ({
        level: 1,
        classId: "warlock",
        kind: "eldritch-invocation",
        id,
        payload: { featureId: "eldritch-invocations" }
      })),
      { level: 1, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "agonizing-blast" } },
      { level: 1, kind: "cantrip", id: "eldritch-blast", payload: { featureId: "repelling-blast" } },
      { level: 3, classId: "warlock", kind: "subclass", id: REOPENED.srcSubclassId },
      // The settled row.
      { level: 10, kind: "damage-type", id: damageType, payload: { featureId: REOPENED.srdFeatureId } },
      ...[4, 8].flatMap((at) => [
        { level: at, classId: "warlock", kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: at, kind: "ability-score", id: "con", payload: { featureId: "ability-score-improvement" } },
        { level: at, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } }
      ]),
      { level: 1, kind: "cantrip", id: "eldritch-blast" },
      { level: 1, kind: "cantrip", id: "prestidigitation" },
      { level: 1, kind: "cantrip", id: "minor-illusion" },
      { level: 1, kind: "spell", id: "hex" },
      { level: 1, kind: "spell", id: "hold-person" },
      { level: 5, kind: "spell", id: "fly" },
      { level: 1, kind: "equipment", id: "warlock-a" },
      { level: 1, kind: "equipment", id: "acolyte-a" }
    ]
  }) as CharacterCreateRequestInput;

/** What the build says the character resists, what they may take back on a rest, and the result of
    re-answering. `choiceOverrideDefenses` gets the override `actor.rechoose` would write; the command
    itself needs a live store. */
function reopen(
  definition: ActorDefinition,
  view: ReturnType<ContentLibrary["forAudience"]>,
  offer: string,
  rechosen: string
) {
  const offers = replaceableOffers(definition, view);
  const overrides = { [offer]: { id: rechosen, per: "short-rest" as const } };
  const after = choiceOverrideDefenses(definition, overrides, (ref) => view.featureRecord(ref));
  return { built: definition.damageResistances, offers, after };
}

describe("a settled pick the character may re-make (`replaces`) — through both paths", () => {
  it("1. the editor can author it: the clause goes through real controls, and the record publishes", () => {
    const draft = authoredEmberkin();
    const verdict = publishVerdict("species", draft, REOPENED.speciesId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("species", draft, REOPENED.speciesId) as { traits: Array<Record<string, unknown>> };
    // Fiendish Resilience's shape: `when` seeded by the row, `offer` typed.
    expect(body.traits[0].replaces).toEqual([{ offer: REOPENED.offer, when: "short-rest", amount: 1 }]);
    // No rows means no key; an empty list is dropped rather than shipped as `[]`.
    const noRows = storedBody("species", authoredEmberkin(false), REOPENED.speciesId) as {
      traits: Array<Record<string, unknown>>;
    };
    expect("replaces" in noRows.traits[0]).toBe(false);

    // The clause is offered on every feature carrier...
    for (const [type, within] of [
      ["class", ["features"]],
      ["subclass", ["features"]],
      ["species", ["traits"]],
      ["feat", ["feature"]]
    ] as const) {
      expect(hasControl(type, "replaces", within), `${type}: ${within.join(" > ")} > replaces`).toBe(true);
    }
    // ...but not on inline options: no SRD record authors it there.
    expect(hasControl("feat", "replaces", ["feature", "choice.options"])).toBe(false);
  });

  it("1b. `replacesFeatureId` is offered where it is READ, and nowhere else", () => {
    // Read only by `grantedClassFeatures` from a class's own level table; inert on other carriers
    // (Champion's `superior-critical` authors it and a level-15 Champion keeps both features).
    const gate = (type: HomebrewType, within: readonly string[]) =>
      fieldsWithin(type, within).find((field) => field.key === "replacesFeatureId");
    expect(gate("class", ["features"])?.visibleWhen?.({}, blankDraft("class"))).toBe(true);
    for (const [type, within] of [
      ["subclass", ["features"]],
      ["species", ["traits"]],
      ["background", ["features"]],
      ["feat", ["feature"]]
    ] as const) {
      expect(gate(type, within)?.visibleWhen?.({}, blankDraft(type)), `${type} shows "Supersedes"`).toBe(false);
    }
    // A feature naming itself would delete itself; `options` gets the record, not the row, so
    // `validate` names it.
    const field = gate("class", ["features"])!;
    expect(field.validate?.("f1", { id: "f1" }, EMPTY_CONTEXT)).toContain("cannot supersede itself");
    expect(field.validate?.("f1", { id: "f2" }, EMPTY_CONTEXT)).toBeNull();
  });

  it("2. SRD content authors the same shape — 2 replaceable picks and 7 superseding features", () => {
    const library = new ContentLibrary().forAudience("gm");
    const clauses: Array<{ id: string; clause: Record<string, unknown> }> = [];
    const supersedes: Array<{ id: string; replaced: string }> = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        for (const entry of node) walk(entry);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.replaces)) {
        for (const clause of record.replaces)
          clauses.push({ id: String(record.id ?? "?"), clause: clause as Record<string, unknown> });
      }
      if (typeof record.replacesFeatureId === "string")
        supersedes.push({ id: String(record.id ?? "?"), replaced: record.replacesFeatureId });
      for (const value of Object.values(record)) walk(value);
    };
    for (const summary of library.classSummaries()) walk(library.classRecord(summary.id));
    for (const summary of library.subclassSummaries()) walk(library.subclassRecord(summary.id));
    for (const summary of library.featSummaries()) walk(library.featRecord(summary.id));

    // Two clauses at the time of writing, both on subclass features, each naming its own feature's pick.
    expect(clauses.map((entry) => entry.id).sort()).toEqual(["circle-of-the-land-spells", "fiendish-resilience"]);
    expect(clauses.find((entry) => entry.id === REOPENED.srdFeatureId)?.clause).toEqual({
      offer: REOPENED.srdOffer,
      when: "short-rest",
      amount: 1
    });
    expect(clauses.find((entry) => entry.id === "circle-of-the-land-spells")?.clause).toMatchObject({
      when: "long-rest"
    });

    // Seven superseding features: two Fighter attack tiers and four Unarmored Movement steps (read by the builder),
    // and Champion's (not read; see 1b).
    expect(supersedes.map((entry) => `${entry.id} → ${entry.replaced}`).sort()).toEqual([
      "superior-critical → improved-critical",
      "three-extra-attacks → two-extra-attacks",
      "two-extra-attacks → extra-attack",
      "unarmored-movement-10 → unarmored-movement-6",
      "unarmored-movement-14 → unarmored-movement-10",
      "unarmored-movement-18 → unarmored-movement-14",
      "unarmored-movement-6 → unarmored-movement"
    ]);
  });

  it("3. one assertion body over both: the settled answer is offered again, and re-answering it moves the resistance", () => {
    const srdView = new ContentLibrary().forAudience("gm");
    const editorSpecies = authoredEmberkin();
    const editorView = emberkinView(editorSpecies);
    const paths: ReadonlyArray<
      readonly [string, ActorDefinition, ReturnType<ContentLibrary["forAudience"]>, string, string]
    > = [
      [
        "SRD content",
        buildCharacterDefinition(resilientWarlock(REOPENED.built), srdView, BuilderPolicySchema.parse({})),
        srdView,
        REOPENED.srdOffer,
        "Fiendish Resilience"
      ],
      [
        "the homebrew editor",
        buildCharacterDefinition(emberkinInput(), editorView, BuilderPolicySchema.parse({})),
        editorView,
        REOPENED.offer,
        REOPENED.traitName
      ]
    ];

    for (const [label, definition, view, offer, featureName] of paths) {
      const { built, offers, after } = reopen(definition, view, offer, REOPENED.rechosen);
      // The build baked the character's own answer onto the sheet.
      expect(built, label).toContain(REOPENED.built);

      // The settled row is answerable again, on the named rest, over the original pick's options.
      const reopened = offers.find((candidate) => candidate.offer === offer);
      expect(reopened, `${label}: ${offer} should be re-choosable`).toBeTruthy();
      expect(reopened!.per, label).toBe("short-rest");
      expect(reopened!.label, label).toBe(featureName);
      expect(reopened!.options, label).toEqual(expect.arrayContaining([REOPENED.built, REOPENED.rechosen]));

      // Re-answering moves the resistance, with the feature named as the reason.
      expect(after.resistances, label).toContain(REOPENED.rechosen);
      expect([...after.suppressed], label).toContain(REOPENED.built);
      expect(after.sources.get(REOPENED.rechosen), label).toBe(featureName);
    }

    // Negative control: the same species and answered pick with no `replaces` row. Fire stays and
    // nothing is re-choosable.
    const bare = authoredEmberkin(false);
    const bareView = emberkinView(bare);
    const bareSheet = buildCharacterDefinition(emberkinInput(), bareView, BuilderPolicySchema.parse({}));
    expect(bareSheet.damageResistances).toContain(REOPENED.built);
    expect(replaceableOffers(bareSheet, bareView)).toEqual([]);
  });

  it("4. `replacesFeatureId`: the class stops granting what its successor replaces, from both paths", () => {
    const classFeatureIds = (definition: ActorDefinition, sourceId: string) =>
      (definition.character?.features ?? [])
        .filter((ref) => ref.kind === "class" && ref.sourceId === sourceId)
        .map((ref) => ref.id);

    // SRD: at 11 the sheet lists Two Extra Attacks and not Extra Attack.
    const srdView = new ContentLibrary().forAudience("gm");
    const fighter5 = classFeatureIds(
      buildCharacterDefinition(fighterInput(5), srdView, BuilderPolicySchema.parse({})),
      "fighter"
    );
    const fighter11 = classFeatureIds(
      buildCharacterDefinition(fighterInput(11), srdView, BuilderPolicySchema.parse({})),
      "fighter"
    );
    expect(fighter5).toContain(REOPENED.fighterReplaced);
    expect(fighter11).toContain(REOPENED.fighterReplacing);
    expect(fighter11).not.toContain(REOPENED.fighterReplaced);

    // Editor: level 2 grants the second feature alone.
    const view = wardenView(authoredWarden());
    const level1 = classFeatureIds(
      buildCharacterDefinition(wardenInput(1), view, BuilderPolicySchema.parse({})),
      REOPENED.classId
    );
    const level2 = classFeatureIds(
      buildCharacterDefinition(wardenInput(2), view, BuilderPolicySchema.parse({})),
      REOPENED.classId
    );
    expect(level1).toEqual([REOPENED.wardId]);
    expect(level2).toEqual([REOPENED.greaterWardId]);

    // Negative control: "Supersedes" left at "Nothing", so level 2 grants both.
    const bare = wardenView(authoredWarden(false));
    expect(
      classFeatureIds(buildCharacterDefinition(wardenInput(2), bare, BuilderPolicySchema.parse({})), REOPENED.classId)
    ).toEqual([REOPENED.wardId, REOPENED.greaterWardId]);
  });
});

/** A class with two features, the second superseding the first. Grants are written through the
    class's own `levelTable` field: the level chips are bespoke (a two-target write a `FieldDef` can't
    express), so the rows below are what the chips would produce. */
function authoredWarden(supersede = true): Draft {
  const ward = {
    ...authoredRow(
      "class",
      ["features"],
      [
        ["name", "Ward"],
        ["description", "A ward against harm."]
      ]
    ),
    id: REOPENED.wardId
  };
  let greater: Draft = {
    ...authoredRow(
      "class",
      ["features"],
      [
        ["name", "Greater Ward"],
        ["description", "A better ward against harm."]
      ]
    ),
    id: REOPENED.greaterWardId
  };
  if (supersede) greater = applyField("class", greater, "replacesFeatureId", REOPENED.wardId, ["features"]);
  const draft = authored("class", "Warden", [
    ["summary", "A warden of the deep wood."],
    ["description", "Wardens stand between the wood and what comes for it."],
    ["hitDie", "d10"],
    ["primaryAbilities", ["str"]],
    ["savingThrows", ["str", "con"]],
    // No subclass before 20, so a level-2 build asks nothing unanswered.
    ["subclassLevel", 20],
    ["skillChoices.choose", 2],
    ["skillChoices.from", ["athletics", "survival", "perception"]],
    ["features", [ward, greater]]
  ]);
  return applyField(
    "class",
    draft,
    "levelTable",
    (draft.levelTable as Array<Record<string, unknown>>).map((row, index) => ({
      ...row,
      features: index === 0 ? [REOPENED.wardId] : index === 1 ? [REOPENED.greaterWardId] : []
    }))
  );
}

const wardenView = (warden: Draft) => {
  const record = HOMEBREW_BODY_SCHEMAS.class.parse(storedBody("class", warden, REOPENED.classId));
  return new ContentLibrary({
    revision: 1,
    publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, classes: [record] }),
    monsterForInstance: () => undefined
  }).forAudience("gm");
};

const wardenInput = (level: 1 | 2): CharacterCreateRequestInput =>
  ({
    name: "Ash",
    speciesId: "halfling",
    backgroundId: "soldier",
    classId: REOPENED.classId,
    level,
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: REOPENED.classId, kind: "skill", id: "perception" },
      { level: 1, classId: REOPENED.classId, kind: "skill", id: "survival" },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A Halfling Champion at `level`, the SRD's `replacesFeatureId` carrier. */
const fighterInput = (level: 5 | 11): CharacterCreateRequestInput =>
  ({
    name: "Borin",
    speciesId: "halfling",
    backgroundId: "soldier",
    classId: "fighter",
    level,
    subclassId: "champion",
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
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
      ...["greatsword", "flail", "longbow", "rapier", "handaxe"]
        .slice(0, level >= 9 ? 5 : 4)
        .map((id) => ({ level: 1, classId: "fighter", kind: "weapon-mastery", id })),
      { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
      ...(level >= 7
        ? [
            {
              level: 7,
              classId: "fighter",
              kind: "fighting-style",
              id: "great-weapon-fighting",
              payload: { featureId: "additional-fighting-style" }
            }
          ]
        : []),
      ...(
        [
          [4, "str"],
          [6, "con"],
          [8, "con"]
        ] as const
      )
        .filter(([at]) => at <= level)
        .flatMap(([at, ability]) => [
          { level: at, classId: "fighter", kind: "asi-or-feat", id: "ability-score-improvement" },
          { level: at, kind: "ability-score", id: ability, payload: { featureId: "ability-score-improvement" } },
          { level: at, kind: "ability-score", id: ability, payload: { featureId: "ability-score-improvement" } }
        ]),
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/* ---- the spell window and the ASI ceiling, through both paths ---- */

/**
 * `FeatureChoiceSchema.maxSpellLevel`/`minSpellLevel` (the window a spell pick is answered inside)
 * and `maximum` (the score an ability-score pick may reach).
 *
 * Bounds compare against an option's spell level, which only a catalog carries (`optionLevels` comes
 * from `resolveCatalogChoice`; a typed `from` list reads as level 0). `fromCatalog` is unreachable
 * from `applyField`, so the editor half proves the floor (which does refuse over a typed list) and the
 * SRD half proves both bounds. The ASI ceiling has no such asymmetry: epic boons use a plain `from`
 * list of abilities.
 */
const WINDOW = {
  /** The SRD's exact-level pick: min and max both 6 over `warlock-spells`. */
  arcanumFeatureId: "mystic-arcanum-level-6-spell",
  arcanumLabel: "Mystic Arcanum Level 6 Spell",
  belowFloor: "hex",
  aboveCeiling: "power-word-kill",
  inWindow: "true-seeing",
  windowLevel: 6,
  featId: "hb-borrowed-mystery-a1b2",
  featureId: "borrowed-mystery",
  featName: "Borrowed Mystery",
  /** The authored floor; 5 so the refusal names a number unique in the build. */
  authoredFloor: 5,
  /** The ASI ceiling: one score the boon pushes past 20. */
  boonFeatId: "hb-boon-of-the-keen-mind-a1b2",
  boonFeatureId: "boon-of-the-keen-mind",
  boonFeatName: "Boon of the Keen Mind",
  srdBoonId: "boon-of-the-night-spirit",
  raised: "wis",
  ceiling: 30,
  withCeiling: 21
} as const;

/** A feat with one spell pick and the given window. */
function authoredMystery(window: { min?: number; max?: number }): Draft {
  const shell = authored("feat", WINDOW.featName, [
    ["category", "origin"],
    ["summary", "A mystery beyond your years."],
    ["description", "You learn one spell of a level you should not yet reach."]
  ]);
  const edits: Array<readonly [string, unknown]> = [
    ["kind", "spell"],
    ["choose", 1],
    ["from", "bless, cure-wounds"]
  ];
  if (window.max !== undefined) edits.push(["maxSpellLevel", window.max]);
  if (window.min !== undefined) edits.push(["minSpellLevel", window.min]);
  const block = authoredRow("feat", ["feature", "choices"], edits);
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", WINDOW.featName, ["feature"]);
  feature = applyField("feat", feature, "description", "You learn one spell of a level you should not yet reach.", [
    "feature"
  ]);
  feature = applyField("feat", feature, "choices", [block], ["feature"]);
  return { ...shell, feature: { ...feature, id: WINDOW.featureId } };
}

/** An epic boon in the SRD's shape: one ability-score pick with a ceiling. `ceiling: undefined` is the
    negative control. */
function authoredBoon(ceiling?: number): Draft {
  const shell = authored("feat", WINDOW.boonFeatName, [
    ["category", "epic-boon"],
    ["summary", "Your mind sharpens past mortal limits."],
    ["description", "Increase one ability score of your choice by 1, to a maximum of 30."]
  ]);
  const edits: Array<readonly [string, unknown]> = [
    ["kind", "ability-score"],
    ["choose", 1],
    ["from", "str, dex, con, int, wis, cha"]
  ];
  if (ceiling !== undefined) edits.push(["maximum", ceiling]);
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", WINDOW.boonFeatName, ["feature"]);
  feature = applyField(
    "feat",
    feature,
    "description",
    "Increase one ability score of your choice by 1, to a maximum of 30.",
    ["feature"]
  );
  feature = applyField("feat", feature, "choices", [authoredRow("feat", ["feature", "choices"], edits)], ["feature"]);
  return { ...shell, feature: { ...feature, id: WINDOW.boonFeatureId } };
}

/** A merged view carrying one authored feat under `recordId`. */
const featView = (draft: Draft, recordId: string) =>
  new ContentLibrary({
    revision: 1,
    publishedFor: () => ({
      ...EMPTY_HOMEBREW_SLICE,
      feats: [HOMEBREW_BODY_SCHEMAS.feat.parse(storedBody("feat", draft, recordId))]
    }),
    monsterForInstance: () => undefined
  }).forAudience("gm");

/** A Halfling Open Hand Monk 19 (where an Epic Boon arrives) with Wisdom already 20: 15, +2 at 4, +2
    at 8, +1 at 12. Remaining points go to Dex, so only the boon can raise Wisdom further. */
const boonMonk = (boonId: string, tagId: string): CharacterCreateRequestInput =>
  ({
    name: "Shan",
    speciesId: "halfling",
    backgroundId: "criminal",
    classId: "monk",
    level: 19,
    subclassId: "warrior-of-the-open-hand",
    abilityMethod: "standard-array",
    baseScores: { str: 12, dex: 14, con: 13, int: 10, wis: 15, cha: 8 },
    backgroundBonusAllocation: [
      { ability: "dex", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, classId: "monk", kind: "skill", id: "acrobatics" },
      { level: 1, classId: "monk", kind: "skill", id: "insight" },
      { level: 3, classId: "monk", kind: "subclass", id: "warrior-of-the-open-hand" },
      ...(
        [
          [4, "wis", "wis"],
          [8, "wis", "wis"],
          [12, "wis", "dex"],
          [16, "dex", "dex"]
        ] as const
      ).flatMap(([at, first, second]) => [
        { level: at, classId: "monk", kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: at, kind: "ability-score", id: first, payload: { featureId: "ability-score-improvement" } },
        { level: at, kind: "ability-score", id: second, payload: { featureId: "ability-score-improvement" } }
      ]),
      // The Epic Boon slot; `tagId` is the feature id the offer key is built from.
      { level: 19, classId: "monk", kind: "feat", id: boonId, payload: { featureId: "epic-boon" } },
      { level: 19, kind: "ability-score", id: WINDOW.raised, payload: { featureId: tagId } },
      { level: 1, kind: "equipment", id: "monk-a" },
      { level: 1, kind: "equipment", id: "criminal-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A Fiend-Patron Warlock 11 (first Mystic Arcanum) with the given arcanum: the SRD's exact-level pick. */
const arcanumWarlock = (arcanum: string): CharacterCreateRequestInput =>
  ({
    ...resilientWarlock(REOPENED.built),
    level: 11,
    choices: [
      ...resilientWarlock(REOPENED.built).choices,
      { level: 11, kind: "spell", id: arcanum, payload: { featureId: WINDOW.arcanumFeatureId } }
    ]
  }) as CharacterCreateRequestInput;

describe("the spell window and the ASI ceiling — through both paths", () => {
  it("1. the editor can author all three numbers, and on any block — not only the first", () => {
    const draft = authoredMystery({ min: WINDOW.authoredFloor });
    expect(publishVerdict("feat", draft, WINDOW.featId).why).toBe("");
    const body = storedBody("feat", draft, WINDOW.featId) as { feature: { choice?: Record<string, unknown> } };
    expect(body.feature.choice).toMatchObject({ kind: "spell", choose: 1, minSpellLevel: WINDOW.authoredFloor });

    // Each key resolves on the class form and on a feat's singular container...
    for (const key of ["maxSpellLevel", "minSpellLevel", "maximum"]) {
      expect(hasControl("class", key), `class.${key}`).toBe(true);
      expect(hasControl("feat", key, ["feature", "choices"]), `feat: feature > choices > ${key}`).toBe(true);
      // ...and as the first block's alias.
      expect(hasControl("feat", `choice.${key}`, ["feature"]), `feat: feature > choice.${key}`).toBe(true);
    }

    // Every block, not just block 0 (Magic Initiate's shape: cantrips at 0, the spell at 1).
    const initiate = ((): Draft => {
      const cantrips = authoredRow(
        "feat",
        ["feature", "choices"],
        [
          ["kind", "cantrip"],
          ["choose", 2],
          ["from", "guidance, light"],
          ["maxSpellLevel", 0]
        ]
      );
      const spell = authoredRow(
        "feat",
        ["feature", "choices"],
        [
          ["kind", "spell"],
          ["choose", 1],
          ["from", "bless"],
          ["maxSpellLevel", 1]
        ]
      );
      const shell = authored("feat", "Twin Mysteries", [
        ["category", "origin"],
        ["summary", "Two mysteries."],
        ["description", "Two mysteries."]
      ]);
      let feature = applyField("feat", shell.feature as Draft, "name", "Twin Mysteries", ["feature"]);
      feature = applyField("feat", feature, "description", "Two mysteries.", ["feature"]);
      return { ...shell, feature: applyField("feat", feature, "choices", [cantrips, spell], ["feature"]) };
    })();
    const plural = storedBody("feat", initiate, WINDOW.featId) as {
      feature: { choices?: Array<Record<string, unknown>> };
    };
    expect(plural.feature.choices?.map((block) => block.maxSpellLevel)).toEqual([0, 1]);
    // The first-block alias still reaches block 0 of the plural record.
    expect(
      (
        applyField("feat", initiate.feature as Draft, "choice.maxSpellLevel", 3, ["feature"]).choices as Array<{
          maxSpellLevel?: number;
        }>
      ).map((block) => block.maxSpellLevel)
    ).toEqual([3, 1]);

    // The window shows for spell kinds and for any block already holding a bound; the ceiling for the
    // ability-score kind. Visibility rules only: an authored value survives on any kind.
    const blockField = (key: string) =>
      fieldsWithin("feat", ["feature", "choices"]).find((field) => field.key === key)!;
    for (const key of ["maxSpellLevel", "minSpellLevel"]) {
      expect(blockField(key).visibleWhen?.({ kind: "spell" }, {}), key).toBe(true);
      expect(blockField(key).visibleWhen?.({ kind: "cantrip" }, {}), key).toBe(true);
      expect(blockField(key).visibleWhen?.({ kind: "skill" }, {}), key).toBe(false);
      expect(blockField(key).visibleWhen?.({ kind: "skill", minSpellLevel: 2 }, {}), key).toBe(true);
    }
    expect(blockField("maximum").visibleWhen?.({ kind: "ability-score" }, {})).toBe(true);
    expect(blockField("maximum").visibleWhen?.({ kind: "spell" }, {})).toBe(false);
    expect(blockField("maximum").visibleWhen?.({ kind: "spell", maximum: 25 }, {})).toBe(true);

    // An inverted window is refused by the schema's cross-field refinement.
    const upsideDown = publishVerdict("feat", authoredMystery({ min: 6, max: 2 }), WINDOW.featId);
    expect(upsideDown.publishable).toBe(false);
    expect(upsideDown.why).toContain("minSpellLevel 6 is above maxSpellLevel 2");
  });

  it("2. SRD content authors the same shapes — 17 ceilings, 11 floors, 7 epic boons", () => {
    const library = new ContentLibrary().forAudience("gm");
    const found: Array<{
      id: string;
      kind: string;
      max?: number;
      min?: number;
      maximum?: number;
      fromCatalog?: string;
    }> = [];
    // Choice blocks have no id, so the enclosing feature's id travels with the walk.
    const walk = (node: unknown, owner: string) => {
      if (Array.isArray(node)) {
        for (const entry of node) walk(entry, owner);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const held = typeof record.id === "string" ? record.id : owner;
      if (
        typeof record.kind === "string" &&
        (record.maxSpellLevel !== undefined || record.minSpellLevel !== undefined || record.maximum !== undefined)
      ) {
        found.push({
          id: held,
          kind: record.kind,
          max: record.maxSpellLevel as number | undefined,
          min: record.minSpellLevel as number | undefined,
          maximum: record.maximum as number | undefined,
          fromCatalog: record.fromCatalog as string | undefined
        });
      }
      for (const value of Object.values(record)) walk(value, held);
    };
    const carriers = <T>(list: readonly { id: string }[], read: (id: string) => T) => {
      for (const entry of list) walk(read(entry.id), "?");
    };
    carriers(library.classSummaries(), (id) => library.classRecord(id));
    carriers(library.subclassSummaries(), (id) => library.subclassRecord(id));
    carriers(library.featSummaries(), (id) => library.featRecord(id));

    // Every floor but Evocation Savant's has `min === max`: a floor exists to make a pick exact ("a level 6
    // spell", not "6 or lower"); the savant's "level 1 or 2" keeps cantrips out of a spellbook.
    const ceilings = found.filter((entry) => entry.max !== undefined);
    const floors = found.filter((entry) => entry.min !== undefined);
    const maxima = found.filter((entry) => entry.maximum !== undefined);
    expect(ceilings).toHaveLength(17);
    expect(floors.map((entry) => entry.id).sort()).toEqual([
      "evocation-savant",
      // Magic Initiate's "level 1 spell" is exact too.
      "magic-initiate-cleric",
      "magic-initiate-druid",
      "magic-initiate-wizard",
      "mystic-arcanum-level-6-spell",
      "mystic-arcanum-level-7-spell",
      "mystic-arcanum-level-8-spell",
      "mystic-arcanum-level-9-spell",
      "signature-spells",
      "spell-mastery",
      "spell-mastery"
    ]);
    expect(floors.filter((entry) => entry.min !== entry.max)).toEqual([
      expect.objectContaining({ id: "evocation-savant", min: 1, max: 2 })
    ]);
    expect(maxima).toHaveLength(7);
    expect(maxima.every((entry) => entry.maximum === WINDOW.ceiling && entry.kind === "ability-score")).toBe(true);

    // Every window author draws on a spell catalog, and every ceiling author on a typed list of abilities.
    expect(ceilings.every((entry) => /-spells(-of-[a-z]+)?$/.test(entry.fromCatalog ?? ""))).toBe(true);
    expect(maxima.every((entry) => entry.fromCatalog === undefined)).toBe(true);
  });

  it("3. one assertion body over both: a pick outside the window is refused, naming the bound it broke", () => {
    const srdView = new ContentLibrary().forAudience("gm");
    const editorView = featView(authoredMystery({ min: WINDOW.authoredFloor }), WINDOW.featId);
    const mysteryRows = [{ kind: "spell", id: "bless" }];
    const paths: ReadonlyArray<readonly [string, () => unknown, RegExp]> = [
      // SRD: a level-6 arcanum spent on a level-1 spell.
      [
        "SRD content",
        () => buildCharacterDefinition(arcanumWarlock(WINDOW.belowFloor), srdView, BuilderPolicySchema.parse({})),
        new RegExp(`"${WINDOW.belowFloor}" is level 1, below the minimum spell level \\(${WINDOW.windowLevel}\\)`)
      ],
      // Editor: the authored floor refuses an answer from the GM's own list.
      [
        "the homebrew editor",
        () =>
          buildCharacterDefinition(
            initiateInput(WINDOW.featId, WINDOW.featureId, mysteryRows),
            editorView,
            BuilderPolicySchema.parse({})
          ),
        new RegExp(`"bless" is level 0, below the minimum spell level \\(${WINDOW.authoredFloor}\\)`)
      ]
    ];
    for (const [label, build, message] of paths) {
      expect(build, label).toThrowError(message);
    }

    // Negative control: no window, so the spell lands on the sheet.
    const open = featView(authoredMystery({}), WINDOW.featId);
    const sheet = buildCharacterDefinition(
      initiateInput(WINDOW.featId, WINDOW.featureId, mysteryRows),
      open,
      BuilderPolicySchema.parse({})
    );
    expect(preparedSpell(sheet, "bless")).toMatchObject({ id: "bless", prepared: true });

    // The SRD carrier also proves the ceiling: `power-word-kill` breaks it, and the real level-6
    // spell lands at level 6.
    expect(() =>
      buildCharacterDefinition(arcanumWarlock(WINDOW.aboveCeiling), srdView, BuilderPolicySchema.parse({}))
    ).toThrowError(
      new RegExp(`"${WINDOW.aboveCeiling}" is level 9, above the maximum spell level \\(${WINDOW.windowLevel}\\)`)
    );
    const arcanum = preparedSpell(
      buildCharacterDefinition(arcanumWarlock(WINDOW.inWindow), srdView, BuilderPolicySchema.parse({})),
      WINDOW.inWindow
    );
    expect(arcanum).toMatchObject({ id: WINDOW.inWindow, level: WINDOW.windowLevel });
  });

  it("4. one assertion body over both: the ceiling carries a 20 to 21, and without it the pick is refused", () => {
    const srdView = new ContentLibrary().forAudience("gm");
    const paths: ReadonlyArray<readonly [string, ActorDefinition]> = [
      [
        "SRD content",
        buildCharacterDefinition(boonMonk(WINDOW.srdBoonId, WINDOW.srdBoonId), srdView, BuilderPolicySchema.parse({}))
      ],
      [
        "the homebrew editor",
        buildCharacterDefinition(
          boonMonk(WINDOW.boonFeatId, WINDOW.boonFeatureId),
          featView(authoredBoon(WINDOW.ceiling), WINDOW.boonFeatId),
          BuilderPolicySchema.parse({})
        )
      ]
    ];
    for (const [label, definition] of paths) {
      // A score past the ASI ceiling: Wisdom was 20 before the boon.
      expect(definition.abilityScores[WINDOW.raised], label).toBe(WINDOW.withCeiling);
    }

    // Negative control: no ceiling, so 20 holds and the pick past it is refused rather than lost.
    expect(() =>
      buildCharacterDefinition(
        boonMonk(WINDOW.boonFeatId, WINDOW.boonFeatureId),
        featView(authoredBoon(), WINDOW.boonFeatId),
        BuilderPolicySchema.parse({})
      )
    ).toThrowError(/WIS would be 21; .* cannot raise a score above 20/);
  });
});

/* ---- `fromPicks`: the options are the character's own earlier answers ---- */

/**
 * `FeatureChoiceSchema.fromPicks` (`{offer, where?}`): the options are the ledger, narrowed by a
 * closed predicate ("one of your known Warlock cantrips that deals damage"). Resolved by the shared
 * `resolvePickChoice`.
 *
 * Proved by contrast: one ledger answers the three predicates three ways, and Sacred Flame (a
 * damaging cantrip from Magic Initiate, not a Warlock cantrip) is in none of them. `resolvePickChoice`
 * also looks up spell levels, so an authored floor over `fromPicks` really refuses.
 */
const LEDGER = {
  /** Chosen so the predicates disagree: Chill Touch is Touch range, True Strike makes no attack roll,
      and only Eldritch Blast satisfies all three. */
  cantrips: ["eldritch-blast", "chill-touch", "true-strike"],
  dealsDamage: ["chill-touch", "eldritch-blast", "true-strike"],
  attackRoll: ["chill-touch", "eldritch-blast"],
  ranged: ["eldritch-blast"],
  /** A damaging cantrip from Magic Initiate, not the class, so no invocation may target it. */
  otherSource: "sacred-flame",
  /** The three SRD invocations and the predicate each asks. */
  srdOffers: [
    ["feature:agonizing-blast", "deals-damage"],
    ["feature:repelling-blast", "attack-roll"],
    ["feature:eldritch-spear", "ranged-damage"]
  ],
  invocations: [
    "agonizing-blast",
    "repelling-blast",
    "eldritch-spear",
    "devils-sight",
    "eldritch-mind",
    "armor-of-shadows",
    "ascendant-step"
  ],
  featId: "hb-borrowed-blast-a1b2",
  featureId: "borrowed-blast",
  featName: "Borrowed Blast",
  /** Prepared spells in the same ledger, for the spell-level half. */
  spells: [
    ["hex", 1],
    ["hold-person", 2],
    ["fly", 5]
  ],
  spellLevels: { hex: 1, "hold-person": 2, fly: 3 },
  floor: 2,
  belowFloor: "hex",
  inWindow: "fly"
} as const;

/** A feat with one pick over answers the character already gave. Passing `from` is the negative
    control: the same feat with a typed list instead. */
function authoredBorrowedBlast(
  over: Readonly<{ where?: string; offer?: string; kind?: string; min?: number; from?: string }> = {}
): Draft {
  const shell = authored("feat", LEDGER.featName, [
    ["category", "origin"],
    ["summary", "A trick borrowed from a spell you already know."],
    ["description", "Choose one of the cantrips you already know."]
  ]);
  const edits: Array<readonly [string, unknown]> = [
    ["kind", over.kind ?? "cantrip"],
    ["choose", 1]
  ];
  if (over.from !== undefined) edits.push(["from", over.from]);
  else {
    edits.push(["fromPicks.offer", over.offer ?? "class-cantrips"]);
    if (over.where) edits.push(["fromPicks.where", over.where]);
  }
  if (over.min !== undefined) edits.push(["minSpellLevel", over.min]);
  const block = authoredRow("feat", ["feature", "choices"], edits);
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", LEDGER.featName, ["feature"]);
  feature = applyField("feat", feature, "description", "Choose one of the cantrips you already know.", ["feature"]);
  feature = applyField("feat", feature, "choices", [block], ["feature"]);
  return { ...shell, feature: { ...feature, id: LEDGER.featureId } };
}

/** A Fiend-Patron Warlock 10 knowing the fixture's cantrips, with `featId` in the origin-feat slot when
    given. At 10 the Invocations column has room for the three `fromPicks` invocations plus four others. */
const blastWarlock = (featId?: string, cantrips: readonly string[] = LEDGER.cantrips): CharacterCreateRequestInput =>
  ({
    name: "Vex",
    speciesId: "human",
    backgroundId: "acolyte",
    classId: "warlock",
    level: 10,
    subclassId: "fiend-patron",
    abilityMethod: "standard-array",
    baseScores: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    backgroundBonusAllocation: [
      { ability: "cha", amount: 2 },
      { ability: "wis", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: featId ?? "alert", payload: { featureId: "human-versatile" } },
      // The Acolyte's origin feat, Magic Initiate (Cleric), is where Sacred Flame comes from.
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: LEDGER.otherSource, payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, classId: "warlock", kind: "skill", id: "arcana" },
      { level: 1, classId: "warlock", kind: "skill", id: "deception" },
      ...LEDGER.invocations.map((id) => ({
        level: 1,
        classId: "warlock",
        kind: "eldritch-invocation",
        id,
        payload: { featureId: "eldritch-invocations" }
      })),
      // Each invocation's own answer is Eldritch Blast, which satisfies every predicate, so swapping
      // the ledger below never invalidates an answer.
      ...["agonizing-blast", "repelling-blast", "eldritch-spear"].map((featureId) => ({
        level: 1,
        kind: "cantrip",
        id: "eldritch-blast",
        payload: { featureId }
      })),
      { level: 3, classId: "warlock", kind: "subclass", id: "fiend-patron" },
      // Fiendish Resilience arrives at 10 and must be answered, or the build refuses.
      { level: 10, kind: "damage-type", id: "fire", payload: { featureId: "fiendish-resilience" } },
      ...[4, 8].flatMap((at) => [
        { level: at, classId: "warlock", kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: at, kind: "ability-score", id: "con", payload: { featureId: "ability-score-improvement" } },
        { level: at, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } }
      ]),
      // The ledger: untagged rows, which is what a named budget reads.
      ...cantrips.map((id) => ({ level: 1, kind: "cantrip", id })),
      ...LEDGER.spells.map(([id, level]) => ({ level, kind: "spell", id })),
      { level: 1, kind: "equipment", id: "warlock-a" },
      { level: 1, kind: "equipment", id: "acolyte-a" }
    ]
  }) as CharacterCreateRequestInput;

/** One offer's option ids from the server's computation, sorted (membership is what matters). */
function offeredIds(survey: ReturnType<typeof computeServerOffers>, key: string): readonly string[] {
  const offer = survey.offers.find((candidate) => candidate.key === key);
  if (!offer) throw new Error(`No offer "${key}" in this build — the fixture no longer asks that question.`);
  return [...offer.options].sort();
}

const surveyOf = (input: CharacterCreateRequestInput, view: ReturnType<ContentLibrary["forAudience"]>) =>
  computeServerOffers(input, view, BuilderPolicySchema.parse({}));

describe("a pick over the character's own earlier answers (`fromPicks`) — through both paths", () => {
  it("1. the editor can author it: the budget and the predicate go through real controls, and it excludes the other three sources", () => {
    const draft = authoredBorrowedBlast({ where: "attack-roll" });
    const verdict = publishVerdict("feat", draft, LEDGER.featId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("feat", draft, LEDGER.featId) as { feature: { choice?: Record<string, unknown> } };
    // Agonizing Blast's shape, with this feat's predicate.
    expect(body.feature.choice).toMatchObject({
      kind: "cantrip",
      choose: 1,
      fromPicks: { offer: "class-cantrips", where: "attack-roll" }
    });
    // No other source key: the reader tests `fromPicks` first and would silently drop the other.
    for (const key of ["from", "fromCatalog", "options"]) {
      expect(key in (body.feature.choice ?? {}), `choice.${key} rode along`).toBe(false);
    }
    // `where` is optional; the budget alone offers every answer.
    const open = storedBody("feat", authoredBorrowedBlast({}), LEDGER.featId) as {
      feature: { choice?: { fromPicks?: unknown } };
    };
    expect(open.feature.choice?.fromPicks).toEqual({ offer: "class-cantrips" });

    // Resolves on the class form at the block's scope, and as the first block's alias.
    for (const key of ["fromPicks", "fromPicks.offer", "fromPicks.where"]) {
      expect(hasControl("class", key), `class.${key}`).toBe(true);
      expect(hasControl("feat", key, ["feature", "choices"]), `feat: feature > choices > ${key}`).toBe(true);
    }
    for (const key of ["choice.fromPicks", "choice.fromPicks.offer", "choice.fromPicks.where"]) {
      expect(hasControl("feat", key, ["feature"]), `feat: feature > ${key}`).toBe(true);
    }
    // Group children are re-aliased, not leaked: `fromPicks.offer` at feature scope would write a key
    // no reader reads.
    expect(hasControl("feat", "fromPicks.offer", ["feature"])).toBe(false);

    // Every block, not just block 0.
    const twinned = ((): Draft => {
      const first = authoredRow(
        "feat",
        ["feature", "choices"],
        [
          ["kind", "cantrip"],
          ["choose", 1],
          ["fromPicks.offer", "class-cantrips"],
          ["fromPicks.where", "deals-damage"]
        ]
      );
      const second = authoredRow(
        "feat",
        ["feature", "choices"],
        [
          ["kind", "spell"],
          ["choose", 1],
          ["fromPicks.offer", "class-spells"]
        ]
      );
      const shell = authored("feat", "Twin Echoes", [
        ["category", "origin"],
        ["summary", "Two echoes."],
        ["description", "Two echoes."]
      ]);
      let feature = applyField("feat", shell.feature as Draft, "name", "Twin Echoes", ["feature"]);
      feature = applyField("feat", feature, "description", "Two echoes.", ["feature"]);
      return { ...shell, feature: applyField("feat", feature, "choices", [first, second], ["feature"]) };
    })();
    const plural = storedBody("feat", twinned, LEDGER.featId) as {
      feature: { choices?: Array<{ fromPicks?: unknown }> };
    };
    expect(plural.feature.choices?.map((block) => block.fromPicks)).toEqual([
      { offer: "class-cantrips", where: "deals-damage" },
      { offer: "class-spells" }
    ]);

    // Exclusivity both ways: the ledger source clears a typed list and vice versa.
    const listed = applyField("feat", { kind: "cantrip", choose: 1 }, "from", "guidance, light", [
      "feature",
      "choices"
    ]);
    const swapped = applyField("feat", listed, "fromPicks.offer", "class-cantrips", ["feature", "choices"]);
    expect(swapped).toEqual({ kind: "cantrip", choose: 1, fromPicks: { offer: "class-cantrips" } });
    expect(applyField("feat", swapped, "from", "guidance", ["feature", "choices"])).toEqual({
      kind: "cantrip",
      choose: 1,
      from: ["guidance"]
    });

    // `where` is closed because the schema is: four slugs the resolver reads by name.
    const whereField = fieldsWithin("feat", ["feature", "choices"]).find((field) => field.key === "fromPicks.where");
    expect(optionValues(whereField)).toEqual(["deals-damage", "attack-roll", "ranged", "ranged-damage"]);
  });

  it("2. SRD content authors the same shape — three invocations, three predicates, one budget", () => {
    const library = new ContentLibrary().forAudience("gm");
    const found: Array<{ id: string; source: Record<string, unknown> }> = [];
    const walk = (node: unknown, owner: string) => {
      if (Array.isArray(node)) {
        for (const entry of node) walk(entry, owner);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const held = typeof record.id === "string" ? record.id : owner;
      if (record.fromPicks) found.push({ id: held, source: record.fromPicks as Record<string, unknown> });
      for (const value of Object.values(record)) walk(value, held);
    };
    for (const summary of library.classSummaries()) walk(library.classRecord(summary.id), "?");
    for (const summary of library.subclassSummaries()) walk(library.subclassRecord(summary.id), "?");
    for (const summary of library.featSummaries()) walk(library.featRecord(summary.id), "?");

    // Exactly three at the time of writing: Warlock invocations over one budget, each asking a different question.
    expect(found.map((entry) => `${entry.id}: ${entry.source.offer} where ${entry.source.where}`).sort()).toEqual([
      "agonizing-blast: class-cantrips where deals-damage",
      "eldritch-spear: class-cantrips where ranged-damage",
      "repelling-blast: class-cantrips where attack-roll"
    ]);
  });

  it("3. one assertion body over both: the list is exactly the answers this character gave, narrowed by the predicate", () => {
    const srdView = new ContentLibrary().forAudience("gm");
    const editorView = featView(authoredBorrowedBlast({ where: "attack-roll" }), LEDGER.featId);

    const paths: ReadonlyArray<readonly [string, ReturnType<typeof computeServerOffers>, string, readonly string[]]> = [
      // SRD: Repelling Blast, whose "requires an attack roll" matches the feat's predicate.
      ["SRD content", surveyOf(blastWarlock(), srdView), "feature:repelling-blast", LEDGER.attackRoll],
      // Editor: the authored feat over the same ledger.
      [
        "the homebrew editor",
        surveyOf(blastWarlock(LEDGER.featId), editorView),
        `feature:${LEDGER.featureId}`,
        LEDGER.attackRoll
      ]
    ];
    for (const [label, survey, key, expected] of paths) {
      // Sacred Flame deals damage and makes no attack roll, yet it is absent from every list because it
      // is not a known Warlock cantrip.
      const offered = offeredIds(survey, key);
      expect(offered, label).toEqual([...expected]);
      expect(offered, label).not.toContain(LEDGER.otherSource);
    }

    // Same ledger, three predicates, three lists.
    const srd = surveyOf(blastWarlock(), srdView);
    expect(offeredIds(srd, "feature:agonizing-blast")).toEqual([...LEDGER.dealsDamage]);
    expect(offeredIds(srd, "feature:repelling-blast")).toEqual([...LEDGER.attackRoll]);
    expect(offeredIds(srd, "feature:eldritch-spear")).toEqual([...LEDGER.ranged]);

    // Change the known cantrips and every list moves, with no content record changing. Eldritch Spear wants damage at
    // 10+ feet, so the reach of Mage Hand and Minor Illusion alone is not enough.
    const other = surveyOf(blastWarlock(undefined, ["eldritch-blast", "mage-hand", "minor-illusion"]), srdView);
    expect(offeredIds(other, "feature:agonizing-blast")).toEqual(["eldritch-blast"]);
    expect(offeredIds(other, "feature:eldritch-spear")).toEqual(["eldritch-blast"]);

    // Negative controls: without the predicate the list widens to every class cantrip...
    const wide = surveyOf(blastWarlock(LEDGER.featId), featView(authoredBorrowedBlast({}), LEDGER.featId));
    expect(offeredIds(wide, `feature:${LEDGER.featureId}`)).toEqual([...LEDGER.cantrips].sort());
    // ...and with a typed list the ledger is not read at all.
    const typed = surveyOf(
      blastWarlock(LEDGER.featId),
      featView(authoredBorrowedBlast({ from: "guidance, light" }), LEDGER.featId)
    );
    expect(offeredIds(typed, `feature:${LEDGER.featureId}`)).toEqual(["guidance", "light"]);
  });

  it("4. the editor end can finally prove a SPELL LEVEL — the hole the census measured and left open", () => {
    /** Spell bounds compare against `optionLevels`. A typed `from` list has none, but
        `resolvePickChoice` looks every answer up in the spell catalog, so a window over `fromPicks`
        really applies from the editor end. */
    const view = featView(
      authoredBorrowedBlast({ kind: "spell", offer: "class-spells", min: LEDGER.floor }),
      LEDGER.featId
    );
    const survey = surveyOf(blastWarlock(LEDGER.featId), view);
    const offer = survey.offers.find((candidate) => candidate.key === `feature:${LEDGER.featureId}`)!;
    // The levels are present for a list no catalog holds.
    expect(offer.optionLevels).not.toBeNull();
    expect(Object.fromEntries([...offer.optionLevels!].sort())).toEqual(LEDGER.spellLevels);

    // A level-1 spell is below the authored floor, named by its real level.
    const below = { ...blastWarlock(LEDGER.featId) };
    below.choices = [
      ...below.choices,
      { level: 10, kind: "spell", id: LEDGER.belowFloor, payload: { featureId: LEDGER.featureId } }
    ] as typeof below.choices;
    expect(() => buildCharacterDefinition(below, view, BuilderPolicySchema.parse({}))).toThrowError(
      new RegExp(`"${LEDGER.belowFloor}" is level 1, below the minimum spell level \\(${LEDGER.floor}\\)`)
    );

    // Negative control: the same floor over a typed list reads every option as level 0, so it refuses
    // the GM's own options.
    const listed = featView(
      authoredBorrowedBlast({ kind: "spell", from: "hex, fly", min: LEDGER.floor }),
      LEDGER.featId
    );
    const listedOffer = surveyOf(blastWarlock(LEDGER.featId), listed).offers.find(
      (candidate) => candidate.key === `feature:${LEDGER.featureId}`
    )!;
    expect(listedOffer.optionLevels).toBeNull();

    // A level-3 spell is inside the window when levels are real.
    const inside = { ...blastWarlock(LEDGER.featId) };
    inside.choices = [
      ...inside.choices,
      { level: 10, kind: "spell", id: LEDGER.inWindow, payload: { featureId: LEDGER.featureId } }
    ] as typeof inside.choices;
    expect(() => buildCharacterDefinition(inside, view, BuilderPolicySchema.parse({}))).not.toThrow();
  });
});

/* ---- `FeatureOption.requires`: an option gated on an earlier answer ---- */

/**
 * `FeatureOptionSchema.requires` (`{offer, id}`): an inline option is legal only if the ledger holds
 * a particular earlier answer (Improved Blessed Strikes, Nature's Ward). Both consumers gate on it.
 *
 * The far end is the option list: unmet gates remove options, and when the survivors exactly fill
 * the capacity they are adopted with no pick shown. So the survivors are read from `survey.granted`.
 * The SRD half is Nature's Ward (a subclass feature); the editor half is a species with two traits,
 * since `feature:<id>` must name a pick on the same record.
 */
const GATED = {
  srdFeatureId: "natures-ward",
  srdOffer: "feature:natures-ward",
  srdGate: "feature:circle-of-the-land-spells",
  /** The SRD table: which land grants which resistance. */
  lands: [
    ["arid", "fire"],
    ["polar", "cold"],
    ["temperate", "lightning"],
    ["tropical", "poison"]
  ],
  speciesId: "hb-echokin-a1b2",
  speciesName: "Echokin",
  /** Pinned because the ledger tags its answer with the feature id, which the gate names. */
  heritageId: "echo-heritage",
  wardId: "echo-ward",
  gate: "feature:echo-heritage",
  answers: [
    ["emberborn", "ember-ward", "fire"],
    ["frostborn", "frost-ward", "cold"]
  ]
} as const;

/** One gated option. `requires` uses the option row's controls; the resistance goes through `grantsFromRows`. */
const echoOption = (id: string, name: string, gate: string | null, resistance: string): Draft => ({
  ...authoredRow(
    "species",
    ["traits", "choice.options"],
    [
      ["name", name],
      ["description", `Your heritage answered this for you, so you have Resistance to ${resistance} damage.`],
      ...(gate
        ? ([
            ["requires.offer", GATED.gate],
            ["requires.id", gate]
          ] as Array<readonly [string, unknown]>)
        : [])
    ]
  ),
  id,
  grants: grantsFromRows([{ rowId: "damageResistances", kind: "damageResistances", values: [resistance] }], {})
});

/** A species with a heritage-asking trait and a second trait whose two options are each gated on one
    answer. `gated: false` is the negative control. */
function authoredEchokin(gated = true): Draft {
  const heritage = {
    ...authoredRow(
      "species",
      ["traits"],
      [
        ["name", "Echoed Heritage"],
        ["description", "Choose the echo you were born under."],
        ["choice", true],
        ["choice.kind", "heritage"],
        ["choice.from", "emberborn, frostborn"]
      ]
    ),
    id: GATED.heritageId
  };
  const ward = {
    ...authoredRow(
      "species",
      ["traits"],
      [
        ["name", "Echoed Ward"],
        ["description", "The echo you were born under wards you."],
        ["choice", true],
        ["choice.kind", "echo-ward"],
        [
          "choice.options",
          GATED.answers.map(([answer, optionId, resistance]) =>
            echoOption(
              optionId,
              `${resistance[0].toUpperCase()}${resistance.slice(1)} Ward`,
              gated ? answer : null,
              resistance
            )
          )
        ]
      ]
    ),
    id: GATED.wardId
  };
  return authored("species", GATED.speciesName, [
    ["summary", "Kin of an echo, warded by the heritage they were born under."],
    ["description", "Echokin carry one ward, and never choose it twice."],
    ["sizes", ["medium"]],
    ["speedFeet", 30],
    ["traits", [heritage, ward]]
  ]);
}

const echokinView = (species: Draft) =>
  new ContentLibrary({
    revision: 1,
    publishedFor: () => ({
      ...EMPTY_HOMEBREW_SLICE,
      species: [HOMEBREW_BODY_SCHEMAS.species.parse(storedBody("species", species, GATED.speciesId))]
    }),
    monsterForInstance: () => undefined
  }).forAudience("gm");

/** An Echokin Fighter 1 who has answered the heritage. */
const echokinInput = (heritage: string): CharacterCreateRequestInput =>
  ({
    name: "Ash",
    speciesId: GATED.speciesId,
    backgroundId: "soldier",
    classId: "fighter",
    level: 1,
    abilityMethod: "standard-array",
    baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
    backgroundBonusAllocation: [
      { ability: "str", amount: 2 },
      { ability: "con", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      // The earlier answer the ward reads.
      { level: 1, kind: "heritage", id: heritage, payload: { featureId: GATED.heritageId } },
      { level: 1, classId: "fighter", kind: "skill", id: "history" },
      { level: 1, classId: "fighter", kind: "skill", id: "survival" },
      { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
      ...["longsword", "javelin", "greatsword"].map((id) => ({
        level: 1,
        classId: "fighter",
        kind: "weapon-mastery",
        id
      })),
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "fighter-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as CharacterCreateRequestInput;

/** A Circle-of-the-Land Druid 10 (where Nature's Ward arrives) whose land was answered at 3. */
const landDruid = (land: string): CharacterCreateRequestInput =>
  ({
    name: "Rowan",
    speciesId: "human",
    backgroundId: "acolyte",
    classId: "druid",
    level: 10,
    subclassId: "circle-of-the-land",
    abilityMethod: "standard-array",
    baseScores: { str: 12, dex: 14, con: 13, int: 10, wis: 15, cha: 8 },
    backgroundBonusAllocation: [
      { ability: "wis", amount: 2 },
      { ability: "int", amount: 1 }
    ],
    hp: { mode: "average" },
    choices: [
      { level: 1, kind: "language", id: "dwarvish" },
      { level: 1, kind: "language", id: "giant" },
      { level: 1, kind: "skill", id: "stealth", payload: { featureId: "human-skillful" } },
      { level: 1, kind: "feat", id: "alert", payload: { featureId: "human-versatile" } },
      { level: 1, kind: "cantrip", id: "guidance", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "cantrip", id: "sacred-flame", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spell", id: "bless", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, kind: "spellcasting-ability", id: "wis", payload: { featureId: "magic-initiate-cleric" } },
      { level: 1, classId: "druid", kind: "skill", id: "nature" },
      { level: 1, classId: "druid", kind: "skill", id: "perception" },
      { level: 1, kind: "primal-order", id: "warden", payload: { featureId: "primal-order" } },
      { level: 3, classId: "druid", kind: "subclass", id: "circle-of-the-land" },
      // The earlier answer, seven levels before the feature that reads it.
      { level: 3, kind: "land", id: land, payload: { featureId: "circle-of-the-land-spells" } },
      { level: 7, kind: "elemental-fury", id: "primal-strike", payload: { featureId: "elemental-fury" } },
      ...[4, 8].flatMap((at) => [
        { level: at, classId: "druid", kind: "asi-or-feat", id: "ability-score-improvement" },
        { level: at, kind: "ability-score", id: "con", payload: { featureId: "ability-score-improvement" } },
        { level: at, kind: "ability-score", id: "dex", payload: { featureId: "ability-score-improvement" } }
      ]),
      { level: 1, kind: "cantrip", id: "druidcraft" },
      { level: 1, kind: "cantrip", id: "produce-flame" },
      { level: 1, kind: "equipment", id: "druid-a" },
      { level: 1, kind: "equipment", id: "acolyte-a" }
    ]
  }) as CharacterCreateRequestInput;

/** Which inline options survived the gate: adopted options join `granted` with `origin.kind ===
    "option"` and the parent's id as source. */
const survivorsOf = (survey: ReturnType<typeof computeServerOffers>, parentId: string): readonly string[] =>
  survey.granted
    .filter((entry) => entry.origin?.kind === "option" && entry.origin.sourceId === parentId)
    .map((entry) => entry.record.id)
    .sort();

describe("an option gated on an earlier answer (`requires`) — through both paths", () => {
  it("1. the editor can author it: the gate goes through real controls on the OPTION row", () => {
    const draft = authoredEchokin();
    const verdict = publishVerdict("species", draft, GATED.speciesId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("species", draft, GATED.speciesId) as {
      traits: Array<{ choice?: { options?: Array<Record<string, unknown>> } }>;
    };
    // Nature's Ward's shape: one gate per option, each naming a different answer to the same pick.
    expect(body.traits[1].choice?.options?.map((option) => option.requires)).toEqual([
      { offer: GATED.gate, id: "emberborn" },
      { offer: GATED.gate, id: "frostborn" }
    ]);
    // No gate means no key; a half-cleared clause must not survive as `{}`.
    const open = storedBody("species", authoredEchokin(false), GATED.speciesId) as typeof body;
    expect(open.traits[1].choice?.options?.every((option) => !("requires" in option))).toBe(true);
    expect(
      applyField("species", { id: "o1", requires: { offer: GATED.gate } }, "requires.offer", "", [
        "traits",
        "choice.options"
      ])
    ).toEqual({ id: "o1" });

    // Looked up in the option's own fields; `choice.kind` is unreachable there.
    for (const key of ["requires", "requires.offer", "requires.id"]) {
      expect(hasControl("feat", key, ["feature", "choice.options"]), `feat: option > ${key}`).toBe(true);
      expect(hasControl("species", key, ["traits", "choice.options"]), `species: option > ${key}`).toBe(true);
    }
    expect(hasControl("feat", "choice.kind", ["feature", "choice.options"])).toBe(false);
    // Not a feature key: `FeatureRecordSchema` has no `requires`.
    expect(hasControl("feat", "requires", ["feature"])).toBe(false);

    // "Which answer" suggests the record's own option ids and typed-list ids.
    const idField = fieldsWithin("species", ["traits", "choice.options"]).find((field) => field.key === "requires.id")!;
    const suggested =
      typeof idField.suggestions === "function"
        ? idField.suggestions(EMPTY_CONTEXT, forStorage(draft))
        : (idField.suggestions ?? []);
    expect([...suggested].sort()).toEqual(["ember-ward", "emberborn", "frost-ward", "frostborn"]);
  });

  it("2. SRD content authors the same shape — 26 gated options over 7 features", () => {
    const library = new ContentLibrary().forAudience("gm");
    const gates: Array<{ owner: string; option: string; offer: string; id: string }> = [];
    // Track the owner explicitly: the last non-option object with an id (choice blocks have none).
    const walk = (node: unknown, owner: string) => {
      if (Array.isArray(node)) {
        for (const entry of node) walk(entry, owner);
        return;
      }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const held = typeof record.id === "string" ? record.id : owner;
      for (const [key, value] of Object.entries(record)) {
        if (key !== "options" || !Array.isArray(value)) {
          walk(value, held);
          continue;
        }
        for (const entry of value as Array<Record<string, unknown>>) {
          const clause = entry?.requires as Record<string, unknown> | undefined;
          if (clause)
            gates.push({
              owner: held,
              option: String(entry.id ?? "?"),
              offer: String(clause.offer),
              id: String(clause.id)
            });
          walk(entry, held);
        }
      }
    };
    for (const summary of library.classSummaries()) walk(library.classRecord(summary.id), "?");
    for (const summary of library.subclassSummaries()) walk(library.subclassRecord(summary.id), "?");
    for (const summary of library.featSummaries()) walk(library.featRecord(summary.id), "?");

    // Twenty-six at the time of writing, each naming a `feature:<id>` pick of its own record: the land's later
    // spell rows (four lands at 5, 7 and 9) and six invocations needing another, beside the earlier eight.
    expect(gates).toHaveLength(26);
    expect([...new Set(gates.map((gate) => gate.owner))].sort()).toEqual([
      "circle-of-the-land-spells-5",
      "circle-of-the-land-spells-7",
      "circle-of-the-land-spells-9",
      "eldritch-invocations",
      "improved-blessed-strikes",
      "improved-elemental-fury",
      "natures-ward"
    ]);
    expect(gates.every((gate) => gate.offer.startsWith("feature:"))).toBe(true);
    // Nature's Ward: four options, four lands, one budget.
    expect(
      gates.filter((gate) => gate.owner === GATED.srdFeatureId).map((gate) => `${gate.id} → ${gate.option}`)
    ).toEqual(GATED.lands.map(([land]) => `${land} → natures-ward-${land}`));
  });

  it("3. one assertion body over both: the option list is the earlier answer, and no second question is asked", () => {
    const srdView = new ContentLibrary().forAudience("gm");
    const editorView = echokinView(authoredEchokin());
    const paths: ReadonlyArray<
      readonly [string, () => ReturnType<typeof computeServerOffers>, () => ActorDefinition, string, string, string]
    > = [
      [
        "SRD content",
        () => surveyOf(landDruid("polar"), srdView),
        () => buildCharacterDefinition(landDruid("polar"), srdView, BuilderPolicySchema.parse({})),
        GATED.srdFeatureId,
        "natures-ward-polar",
        "cold"
      ],
      [
        "the homebrew editor",
        () => surveyOf(echokinInput("frostborn"), editorView),
        () => buildCharacterDefinition(echokinInput("frostborn"), editorView, BuilderPolicySchema.parse({})),
        GATED.wardId,
        "frost-ward",
        "cold"
      ]
    ];

    for (const [label, survey, build, parentId, survivor, resistance] of paths) {
      const computed = survey();
      // The list narrowed to the one legal option...
      expect(survivorsOf(computed, parentId), label).toEqual([survivor]);
      // ...which is adopted, so nothing is asked...
      expect(
        computed.offers.map((offer) => offer.key),
        label
      ).not.toContain(`feature:${parentId}`);
      // ...and its grant reaches the sheet.
      expect(build().damageResistances, label).toContain(resistance);
    }

    // The answer drives it: a different earlier row gives a different survivor.
    for (const [land, resistance] of GATED.lands) {
      const built = buildCharacterDefinition(landDruid(land), srdView, BuilderPolicySchema.parse({}));
      expect(survivorsOf(surveyOf(landDruid(land), srdView), GATED.srdFeatureId), land).toEqual([
        `natures-ward-${land}`
      ]);
      expect(
        (built.damageResistances ?? []).filter((type) => GATED.lands.some(([, held]) => held === type)),
        land
      ).toEqual([resistance]);
    }
    for (const [heritage, survivor, resistance] of GATED.answers) {
      const built = buildCharacterDefinition(echokinInput(heritage), editorView, BuilderPolicySchema.parse({}));
      expect(survivorsOf(surveyOf(echokinInput(heritage), editorView), GATED.wardId), heritage).toEqual([survivor]);
      expect(built.damageResistances, heritage).toEqual([resistance]);
    }

    // Negative control: no gates, so both options are offered as a real pick, nothing is adopted, and
    // no resistance reaches the sheet yet.
    const ungated = echokinView(authoredEchokin(false));
    const survey = surveyOf(echokinInput("frostborn"), ungated);
    expect(survivorsOf(survey, GATED.wardId)).toEqual([]);
    const offered = survey.offers.find((offer) => offer.key === `feature:${GATED.wardId}`);
    expect([...(offered?.options ?? [])].sort()).toEqual(["ember-ward", "frost-ward"]);
    expect(() =>
      buildCharacterDefinition(echokinInput("frostborn"), ungated, BuilderPolicySchema.parse({}))
    ).toThrowError(/needs 1 pick\(s\) of kind "echo-ward"/);
  });
});

/* ------------------------------------------------------------- the mechanism ----- */

describe("the guard itself refuses what the editor cannot author", () => {
  /** `FeatureEditor` is a custom field, so its choice-panel controls are visible to `fieldsOf` only
      through `featureFields()`. Asserted in two halves: the keys resolve on the class form, and the
      values a control writes reach the body the save path sends. */
  it("the choice panel is reachable from `fieldsOf`, and what it writes reaches the wire", () => {
    // The three bespoke controls (level chips, source switcher, catalog pair) are excluded; see
    // `featureFields()`.
    for (const key of [
      "name",
      "description",
      "choice",
      "choice.kind",
      "choice.choose",
      "choice.from",
      "choice.repeatable"
    ]) {
      expect(hasControl("class", key, ["features"]), `class: features > ${key}`).toBe(true);
    }
    expect(hasControl("class", "choice.fromCatalog", ["features"])).toBe(false);

    // On a feat, the cheapest publishable `FeatureRecord` carrier. `authoredRow` refuses keys with no control.
    const feature = authoredRow(
      "feat",
      ["feature"],
      [
        ["name", "Divine Order"],
        ["description", "You gain one of the following options of your choice."],
        ["choice", true],
        // Typed as a GM types it; the field's `write` slugs it (`ContentIdSchema`).
        ["choice.kind", "ASI or Feat"],
        ["choice.choose", 2],
        ["choice.from", "Protector, thaumaturge"],
        ["choice.repeatable", true]
      ]
    );
    const draft: Draft = {
      ...authored("feat", "Divine Order", [
        ["category", "general"],
        ["summary", "Pick an order."],
        ["description", "Pick your order."]
      ]),
      feature
    };

    const verdict = publishVerdict("feat", draft, RECORD_ID);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("feat", draft, RECORD_ID) as { feature: { choice?: Record<string, unknown> } };
    expect(body.feature.choice).toEqual({
      kind: "asi-or-feat",
      choose: 2,
      from: ["protector", "thaumaturge"],
      repeatable: true
    });

    // Turning the switch off removes the key; `choice` is optional with no "off" value.
    expect("choice" in applyField("feat", feature, "choice", false, ["feature"])).toBe(false);

    // A choice key on a feature with none seeds the same shape the switch does.
    expect(applyField("feat", { id: "f1" }, "choice.choose", 3, ["feature"]).choice).toEqual({
      kind: "feat",
      choose: 3,
      repeatable: false
    });

    expect(hasControl("feat", "choices", ["feature"])).toBe(true);
  });

  /** An inline option is a real row scope, so `FeatureOption.requires` is a `FieldDef` beside `name`
      and `description`. */
  it("an inline option is a real row scope inside a bespoke component", () => {
    const option = authoredRow(
      "feat",
      ["feature", "choice.options"],
      [
        ["name", "Thaumaturge"],
        ["description", "You know one extra cantrip from the Cleric spell list."]
      ]
    );
    const feature = [
      ["name", "Divine Order"],
      ["description", "You gain one of the following options of your choice."],
      ["choice.kind", "divine-order"],
      ["choice.options", [option]]
    ].reduce<Draft>(
      (row, [key, value]) => applyField("feat", row, key as string, value, ["feature"]),
      authoredRow("feat", ["feature"], [])
    );

    const draft: Draft = {
      ...authored("feat", "Divine Order", [
        ["category", "general"],
        ["summary", "Pick an order."],
        ["description", "Pick your order."]
      ]),
      feature
    };
    expect(publishVerdict("feat", draft, RECORD_ID).why).toBe("");

    const body = storedBody("feat", draft, RECORD_ID) as {
      feature: { choice?: { options?: Array<Record<string, unknown>> } };
    };
    expect(body.feature.choice?.options).toHaveLength(1);
    expect(body.feature.choice?.options?.[0]).toMatchObject({
      name: "Thaumaturge",
      description: "You know one extra cantrip from the Cleric spell list."
    });

    // Looked up in the option's own fields: an option has no level and no `choice.kind`.
    expect(hasControl("feat", "name", ["feature", "choice.options"])).toBe(true);
    expect(hasControl("feat", "choice.kind", ["feature", "choice.options"])).toBe(false);
    expect(hasControl("feat", "requires", ["feature", "choice.options"])).toBe(true);
  });

  it("a row scope is looked up in the ROW's own fields, not the whole form's", () => {
    // An action row has no `modifiers` of its own; a flat lookup would resolve it against the
    // record's `modifiersField` and falsely pass.
    expect(hasControl("equipment", "modifiers")).toBe(true);
    expect(hasControl("equipment", "modifiers", ["actions"])).toBe(false);
    expect(() => applyField("equipment", {}, "modifiers", [], ["actions"])).toThrow(
      'No field "modifiers" in the equipment form (actions row) — the test is addressing a field that does not exist.'
    );
  });

  it("`grants` is the ONLY key still waved through, and it is waved through with a reason", () => {
    // `GrantsEditor` has no `FieldDef`; every other rider key is a real control.
    expect(RIDER_EXEMPT).toEqual(["grants"]);
    const carriers = (Object.keys(SCHEMAS) as HomebrewType[]).filter((type) => riderScopeOf(type) !== null);
    expect(carriers).toEqual(["class", "subclass", "species", "background", "feat", "equipment", "monster"]);

    /** A stat block carries only `actions` and `tags`: `ActorDefinitionSchema` has no record-level
        `modifiers`, `uses` or `effects`. Asked of the record's own fields via `fieldsWithin(type, [])`,
        because an action row has its own `uses` and the flat lookup would find it. */
    const onTheRecord = (type: HomebrewType, key: string) => fieldsWithin(type, []).some((field) => field.key === key);
    const RECORD_RIDERS = ["modifiers", "uses", "actions", "effects", "tags"];
    for (const type of carriers) {
      const mounted = type === "monster" ? ["actions", "tags"] : RECORD_RIDERS;
      for (const key of RECORD_RIDERS) {
        expect(onTheRecord(type, key), `${type}.${key}`).toBe(mounted.includes(key));
      }
      expect(hasControl(type, "grants"), `${type}.grants`).toBe(false);
    }

    // A creature's uses live on its actions (`ActionSchema.uses`), mounted on every action carrier.
    for (const type of carriers) {
      for (const key of ["uses.limit", "uses.per", "uses.recharge", "uses.pool"]) {
        expect(hasControl(type, key, ["actions"]), `${type}: actions > ${key}`).toBe(true);
      }
    }
  });

  it("every damage-type key is authorable, at its own scope, on every carrier that mounts riders", () => {
    /**
     * Whether a GM can reach each damage-type key at its own scope, on every rider carrier (the rider
     * vocabulary is shared, so a regression would hit all of them). `vocabularies.test.ts` checks the
     * offered list. The `GrantsEditor` damage kinds are exempt here and covered by
     * `pick-fields.test.tsx`.
     */
    const recordSites: ReadonlyArray<readonly [HomebrewType, string]> = [
      ["spell", "damage.types"],
      ["equipment", "weapon.damageType"],
      ["monster", "damageResistances"],
      ["monster", "damageImmunities"],
      ["monster", "damageVulnerabilities"]
    ];
    for (const [type, key] of recordSites) {
      expect(hasControl(type, key), `${type}.${key} — the GM has no way to say it`).toBe(true);
    }

    const carriers = (Object.keys(SCHEMAS) as HomebrewType[]).filter((type) => riderScopeOf(type) !== null);
    // Every action carrier mounts damage parts, stat blocks included.
    for (const type of carriers) {
      expect(hasControl(type, "type", ["actions", "damage"]), `${type}: actions > damage > type`).toBe(true);
    }

    // A stat block has no record-level `modifiersField`, so this is six carriers, not seven.
    const riderSites: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["damageType", ["modifiers"]], // the `extra-damage` rider — the mace's +1d6 lightning
      ["damageTypes", ["modifiers", "when"]] // the `damage-type-is` gate
    ];
    for (const type of carriers.filter((entry) => entry !== "monster")) {
      for (const [key, within] of riderSites) {
        expect(hasControl(type, key, within), `${type}: ${within.join(" > ")} > ${key}`).toBe(true);
      }
    }

    // The written value reaches the save body too.
    const weapon = applyField("equipment", { name: "Mace of Storms" }, "weapon.damageType", "lightning");
    expect((storedBody("equipment", weapon, RECORD_ID).weapon as { damageType?: string }).damageType).toBe("lightning");
    // So does a mastery, which the editor offers as a closed select of the eight the engine runs.
    const hookblade = applyField("equipment", { name: "Hookblade" }, "weapon.mastery", "graze");
    expect((storedBody("equipment", hookblade, RECORD_ID).weapon as { mastery?: string }).mastery).toBe("graze");
    // An open slug stays open to the wire: `DamageTypeIdSchema` is a string, so "void" is valid.
    const homebrewType = authoredRow(
      "equipment",
      ["actions", "damage"],
      [
        ["formula", "1d6"],
        ["type", "void"]
      ]
    );
    expect(homebrewType).toMatchObject({ formula: "1d6", type: "void" });
  });

  it("the census: every key a later unit needs and the editor cannot author today", () => {
    /** Keys a planned change needs that the editor cannot author yet. Delete a line when its control
        lands; a control appearing without one fails this test. Keys only: an unreachable value of a
        reachable key is caught by the row tests above. */
    const owed: ReadonlyArray<readonly [HomebrewType, string, readonly string[], string]> = [
      // [type, key, container path, the unit that closes it]
      ["monster", "multiattack", ["actions"], "126 SRD records author it"],
      ["class", "widensPicks", [], "Bard row 55, Magical Secrets"]
    ];
    const stillOwed = owed.filter(([type, key, within]) => !hasControl(type, key, within));
    expect(
      stillOwed.map(([type, key, within]) => `${type}.${within.length > 0 ? `${within.join(".")}[].` : ""}${key}`)
    ).toEqual(owed.map(([type, key, within]) => `${type}.${within.length > 0 ? `${within.join(".")}[].` : ""}${key}`));
  });
});
