/**
 * **THE BOTH-PATHS GUARD, on one row, end to end — and the census of everything it currently
 * refuses.**
 *
 * The rule the whole class/homebrew phase is held to is:
 *
 * > one unit of work = an engine reader + SRD content authoring it + a homebrew editor control +
 * > a test through BOTH paths. Ship vocabulary complete, or don't ship it.
 *
 * It exists because **built-but-unwired keeps shipping**. Eight times in one session a mechanism
 * landed that was exercised through exactly one consumer — an engine reader with no control, a
 * control with no SRD author — and a green suite plus a clean typecheck saw none of them. Parity is
 * not a property of either side; it is a property of the JOIN, and nothing in this repo used to
 * assert the join.
 *
 * ## Why this file is a `.mirror.test.ts`
 *
 * `vitest.config.ts` already declares a second, node-environment project for `*.mirror.test.ts`
 * whose stated purpose is that "these tests import the SERVER's own modules", and
 * `src/builder/server-offers.mirror.test.ts` already imports `../../../server/src/character-build.js`
 * by relative path. So the join needs no shared package, no cross-workspace helper module and no
 * server-side import of client code: the editor helpers stay in `authoring-harness.ts` beside the
 * form they drive, and the server modules are imported the way the precedent imports them.
 *
 * ## The shape, and what makes it not theatre
 *
 * One fixture per row of vocabulary, and three tests over it:
 *
 *   1. the **editor** can author it, through the real controls, to a publishable body;
 *   2. **SRD content** authors the same shape, and it is **not a lone record** — a count is asserted;
 *   3. **one assertion body** runs over both and ends at an engine outcome.
 *
 * Test 3 is the only one that matters, and 1 and 2 are what stop it being satisfiable by a fixture
 * literal. A far end is mandatory: the bar for every unit in this phase is a rolled number, a spent
 * counter, a refusal or rendered text — never "the value survived into the struct".
 *
 * Seven rows are pinned this way today: **a saving-throw action that rolls typed damage** (123
 * monster actions), **a monster's to-hit bonus** (U10 — 423 monster actions, and until that unit the
 * shape could not be published at all), **a two-band range** (U11 — 45 records, ending at the
 * long-range disadvantage die), **what an effect DOES** (U6 — and it is the one that crosses
 * carriers: the editor half authors an ITEM's effect, the SRD half reads a FEATURE's, and the two
 * reach the same kept die down two entirely different roads), **an always-prepared spell grant**
 * (U9 — 41 records, ending at a row on the character's own spell list), **uses read off the
 * class table's own column** (U7 — 19 records, ending at a count that moves 2 → 3 with the level
 * while the authored line never changes), and **a recharging action** (U8 — 86 records, ending at a
 * d6 the table watches and the two sentences it narrates).
 *
 * ## The census, and the standing warning about what it does NOT prove
 *
 * `unauthorable` below is the harness's own honest output: every key a later unit needs and the
 * editor cannot author today. It is asserted as an EXACT set, so the unit that closes a row deletes
 * its line here in the same commit.
 *
 * **A key existing is not parity, and U7 is the worked example.** `uses.scaling.type` had a control
 * — the "Uses are" select wrote it — while `class-resource` stayed unauthorable, because that
 * select had no such OPTION. No census over keys could have seen it. Key existence is what the
 * census can see; value round-tripping is what tests 1–3 see. Both halves are needed and neither
 * substitutes for the other — that is the audit's §N3 finding restated as code.
 */

import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type Actor, type GameState } from "@vtt/domain";
import { HOMEBREW_BODY_SCHEMAS } from "@vtt/content-srd-5.2.1/schemas";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../../../server/src/action-resolution.js";
import { importActorDefinition } from "../../../server/src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../../../server/src/character-build.js";
import { ContentLibrary, EMPTY_HOMEBREW_SLICE, type HomebrewContentSource } from "../../../server/src/content-library.js";
import { effectiveActions } from "../../../server/src/effective-actions.js";
import { equipmentCatalogOf } from "../../../server/src/equipment-derivation.js";
import { nextInitiativeTurn, startEncounter } from "../../../server/src/encounter.js";
import {
  applyField, authored, authoredRow, fieldsWithin, hasControl, publishVerdict, riderScopeOf, RIDER_EXEMPT, storedBody
} from "./authoring-harness";
import { grantRowsOf, grantsFromRows } from "./RiderEditor";
import { EMPTY_CONTEXT } from "./schema";
import { SCHEMAS } from "./schemas";
import type { Draft, FieldDef } from "./schema";
import type { HomebrewType } from "./types";

/** The values a `select` offers, whether its list is a literal or a function of the context. An
    option MISSING is what "the key exists and the value is still unauthorable" looks like — the
    census sees keys, and this is the other half of that sentence. */
const optionValues = (field: FieldDef | undefined): readonly string[] =>
  (typeof field?.options === "function" ? field.options(EMPTY_CONTEXT, {}) : field?.options ?? []).map((option) => option.value);

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

/**
 * ONE row of vocabulary, named once and spelled once: an action that forces a saving throw and rolls
 * typed damage. Five keys — `activation`, `save.ability`, `save.dc`, `damage[].formula`,
 * `damage[].type` — and the SRD's Aboleth authors exactly these five.
 */
const FIXTURE = {
  actionId: "consume-memories",
  actionName: "Consume Memories",
  activation: "action",
  description: "Intelligence Saving Throw: DC 16, one creature within 30 feet. Failure: 3d6 Psychic damage.",
  saveAbility: "int",
  saveDc: 16,
  formula: "3d6",
  damageType: "psychic",
  /** 4 + 5 + 6 — three faces fed to the resolver, so the far end is an exact number, not a range. */
  faces: [4, 5, 6],
  total: 15
} as const;

/* ------------------------------------------------------ path 1: the editor ------- */

/** The monster a GM builds in `/homebrew`, through the real form: `blankDraft`, each field's own
    `write`, `forStorage` on the way out, `bodyForPublish` into the body the save path sends. */
function authoredMonster(): Draft {
  const damagePart = authoredRow("monster", ["actions", "damage"], [
    ["formula", FIXTURE.formula],
    ["type", FIXTURE.damageType]
  ]);
  const action = authoredRow("monster", ["actions"], [
    ["name", FIXTURE.actionName],
    ["activation", FIXTURE.activation],
    ["description", FIXTURE.description],
    ["damage", [damagePart]],
    ["save.ability", FIXTURE.saveAbility],
    ["save.dc", FIXTURE.saveDc]
  ]);
  // The action's id is minted by `newRow`; the fixture's far end looks it up by name-derived id, so
  // pin it to the SRD's own slug rather than a random one.
  const withId = { ...action, id: FIXTURE.actionId };
  return authored("monster", "Memory Eater", [
    ["abilityScores.str", 21], ["abilityScores.dex", 9], ["abilityScores.con", 15],
    ["abilityScores.int", 18], ["abilityScores.wis", 15], ["abilityScores.cha", 18],
    ["armorClass", 17],
    ["hitPoints.maximum", 150],
    ["proficiencyBonus", 4],
    ["actions", [withId]]
  ]);
}

/* --------------------------------------------------------- path 2: the SRD ------- */

/** The same shape, read out of the shipped bundle through the server's own content view — not a
    fixture, not a hand-copied literal. */
const srdMonster = (): ActorDefinition => {
  const definition = new ContentLibrary().forAudience("gm").monster("aboleth");
  if (!definition) throw new Error("The SRD bundle no longer ships an Aboleth — this fixture needs a new carrier.");
  return definition;
};

/* -------------------------------------------------- the one assertion body ------- */

/**
 * Given a definition from EITHER path, resolve the fixture's action in a real fight and report what
 * the table would see. This is the whole point of the file: one body, two callers, and a far end
 * neither path can fake.
 */
function resolveTheFixture(definition: ActorDefinition) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.caster, name: definition.name, kind: "monster", visibility: "public", hp: { current: 150, maximum: 150 }, armorClass: 17, definitionId: "def-caster" },
      { id: IDS.target, name: "Target Dummy", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12 }
    ]
  });
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.caster, score: 20 }, { actorId: IDS.target, score: 10 }] }, () => 1, GEOMETRY);

  // Through the server's own action list, never `definition.actions` directly: that list is what the
  // table rolls from, and it is where a rider would fold in.
  const action = effectiveActions(definition, state.actors[0], undefined).find((entry) => entry.id === FIXTURE.actionId);
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

    // The five keys, in the body the save path sends. `authoredRow` already refuses a key with no
    // control; this is the second half — the value the control WROTE survived the round trip.
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

    // A row with one author is a row that can regress unnoticed everywhere else. Measured at the
    // time of writing: 123 bundled monster actions carry a save AND damage AND no attack roll.
    const carriers = new ContentLibrary().forAudience("gm").monsterSummaries()
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

      // The far end: 3d6 rolled as 4/5/6, and a save the target now owes at the authored DC.
      expect(resolution.damage, label).toEqual([{ formula: FIXTURE.formula, type: FIXTURE.damageType, total: FIXTURE.total }]);
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

/* ------------------------------ U10: a monster's to-hit bonus, through both paths -- */

/**
 * The row: `attack.bonus`, the flat printed to-hit a stat block carries.
 *
 * It is the sharpest carrier bug the audit found. `actionsField` served three carriers and wrote
 * `attack.ability` at all of them — the FEATURE shape, where the builder derives the number from the
 * character's own scores. `ActionSchema.attack` has no `ability` key and REQUIRES `bonus`, so a GM
 * who filled in "Uses: Strength" on a monster's Scimitar got `actions[].attack.bonus: Required` from
 * the publish gate, with no control anywhere in the form that could satisfy it. **A monster action
 * with an attack roll could not be published at all**, while 423 bundled monster actions author the
 * key.
 *
 * The Bandit is the carrier because it is the plainest one in the bundle: +3 to hit, reach 5, one
 * damage part, and no riders, multiattack or on-hit conditions to confuse the far end.
 */
const BANDIT = {
  monsterId: "bandit",
  actionId: "scimitar",
  actionName: "Scimitar",
  description: "Melee Attack Roll: +3, reach 5 ft. 4 (1d6 + 1) Slashing damage.",
  bonus: 3,
  reachFeet: 5,
  formula: "1d6 + 1",
  damageType: "slashing",
  /** The d20, then the d6. Both exact, so the far end is a number and not a range. */
  attackFace: 15,
  damageFace: 4,
  attackTotal: 18,
  damageTotal: 5,
  targetAc: 12
} as const;

function authoredBandit(): Draft {
  const damagePart = authoredRow("monster", ["actions", "damage"], [
    ["formula", BANDIT.formula],
    ["type", BANDIT.damageType]
  ]);
  const action = authoredRow("monster", ["actions"], [
    ["name", BANDIT.actionName],
    ["activation", "action"],
    ["description", BANDIT.description],
    ["damage", [damagePart]],
    // THE ROW. `authoredRow` throws when a key has no control, so before U10 this line — not an
    // assertion below it — is what failed, which is the honest place for the failure to be.
    ["attack.bonus", BANDIT.bonus],
    ["attack.reachFeet", BANDIT.reachFeet]
  ]);
  return authored("monster", "Road Bandit", [
    ["abilityScores.str", 11], ["abilityScores.dex", 12], ["abilityScores.con", 12],
    ["abilityScores.int", 10], ["abilityScores.wis", 10], ["abilityScores.cha", 10],
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

/** Swing the fixture's melee attack at a dummy and report the roll. No `distanceFeet`, so the range
    rules stay out of it entirely — this row is about the to-hit number and nothing else. */
function swing(definition: ActorDefinition) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.caster, name: definition.name, kind: "monster", visibility: "public", hp: { current: 11, maximum: 11 }, armorClass: 12, definitionId: "def-caster" },
      { id: IDS.target, name: "Target Dummy", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: BANDIT.targetAc }
    ]
  });
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.caster, score: 20 }, { actorId: IDS.target, score: 10 }] }, () => 1, GEOMETRY);

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
    // Before U10 this read `actions[].attack.bonus: Required` — and no control could answer it.
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("monster", draft, RECORD_ID) as { actions: Array<Record<string, unknown>> };
    expect(body.actions[0]).toMatchObject({
      id: BANDIT.actionId,
      attack: { bonus: BANDIT.bonus, reachFeet: BANDIT.reachFeet }
    });
    // The FEATURE key must not ride along. `ActionSchema` would strip `ability` in silence, which is
    // the failure mode this form exists to avoid — so a stat block is offered `bonus` INSTEAD.
    expect(hasControl("monster", "attack.ability", ["actions"])).toBe(false);
    expect(hasControl("equipment", "attack.bonus", ["actions"])).toBe(false);
    expect(hasControl("equipment", "attack.ability", ["actions"])).toBe(true);
  });

  it("2. SRD content authors the same shape — and it is not a lone record", () => {
    expect(srdBandit().actions.find((entry) => entry.id === BANDIT.actionId)).toMatchObject({
      attack: { bonus: BANDIT.bonus, reachFeet: BANDIT.reachFeet },
      damage: [{ formula: BANDIT.formula, type: BANDIT.damageType }]
    });

    // Measured at the time of writing: 423 bundled monster actions carry an attack bonus.
    const library = new ContentLibrary().forAudience("gm");
    const carriers = library.monsterSummaries()
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
      // The far end: a natural 15 plus the AUTHORED +3 is 18, which beats AC 12, and the hit rolls
      // its damage. Change the bonus and this number changes — it is the value, not a proxy for it.
      expect(resolution.attack, label).toMatchObject({
        naturalRoll: BANDIT.attackFace,
        total: BANDIT.attackTotal,
        targetAc: BANDIT.targetAc,
        outcome: "hit"
      });
      expect(resolution.damage, label).toEqual([{ formula: BANDIT.formula, type: BANDIT.damageType, total: BANDIT.damageTotal }]);
    }
  });
});

/* ------------------------- U11: the normal-range band, through both paths ---------- */

/**
 * The row: `attack.rangeNormalFeet` — the 80 in a printed "range 80/320".
 *
 * The reader already shipped and had no author but the bundle: `attackRollSources` in
 * `action-resolution.ts` pushes a `Long range (beyond N ft)` disadvantage when the measured distance
 * passes it, and `Range` alone only ever produces a REFUSAL ("beyond the 320 ft maximum range"). So
 * this is the one number in the attack group that the engine turns into a die, and a GM had no way
 * to say it. 45 bundled records author it.
 *
 * **The far end is the die, and it is proved by contrast.** The same shot is resolved twice from one
 * definition — inside the band and past it — and the second one rolls `2d20` keeping the lower, which
 * turns a natural 17 into a natural 6 and a hit into a miss. A test that only fired at long range
 * would pass on any disadvantage from any source; the near shot is what pins it to this value.
 */
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
  /** Inside the band: one d20 shows 17, +3 is 20, which beats AC 12 and rolls a 5 on the d8. */
  nearFaces: [17, 5],
  nearTotal: 20,
  nearDamage: 6,
  /** Past it: 2d20kl1 sees 17 and 6, keeps the 6, and +3 is 9 — a miss, so nothing is rolled after. */
  farFaces: [17, 6],
  farNatural: 6,
  farTotal: 9,
  targetAc: 12
} as const;

function authoredCrossbow(): Draft {
  const damagePart = authoredRow("monster", ["actions", "damage"], [
    ["formula", CROSSBOW.formula],
    ["type", CROSSBOW.damageType]
  ]);
  const action = authoredRow("monster", ["actions"], [
    ["name", CROSSBOW.actionName],
    ["activation", "action"],
    ["description", CROSSBOW.description],
    ["damage", [damagePart]],
    ["attack.bonus", CROSSBOW.bonus],
    ["attack.rangeFeet", CROSSBOW.rangeFeet],
    // THE ROW.
    ["attack.rangeNormalFeet", CROSSBOW.rangeNormalFeet]
  ]);
  return authored("monster", "Road Bandit", [
    ["abilityScores.str", 11], ["abilityScores.dex", 12], ["abilityScores.con", 12],
    ["abilityScores.int", 10], ["abilityScores.wis", 10], ["abilityScores.cha", 10],
    ["armorClass", 12],
    ["hitPoints.maximum", 11],
    ["proficiencyBonus", 2],
    ["actions", [{ ...action, id: CROSSBOW.actionId }]]
  ]);
}

/** Shoot from `feet` away. The distance is what makes this row readable at all, so unlike `swing`
    this one hands the resolver a real `distanceFeet`. */
function shoot(definition: ActorDefinition, feet: number, faces: readonly number[]) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.caster, name: definition.name, kind: "monster", visibility: "public", hp: { current: 11, maximum: 11 }, armorClass: 12, definitionId: "def-caster" },
      { id: IDS.target, name: "Target Dummy", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: CROSSBOW.targetAc }
    ]
  });
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.caster, score: 20 }, { actorId: IDS.target, score: 10 }] }, () => 1, GEOMETRY);

  const action = effectiveActions(definition, state.actors[0], undefined).find((entry) => entry.id === CROSSBOW.actionId);
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
    // The key is on both attack schemas, so every carrier that mounts an action can say it.
    for (const type of ["monster", "equipment", "class"] as const) {
      expect(hasControl(type, "attack.rangeNormalFeet", ["actions"]), type).toBe(true);
    }
  });

  it("2. SRD content authors the same shape — and it is not a lone record", () => {
    expect(srdBandit().actions.find((entry) => entry.id === CROSSBOW.actionId)).toMatchObject({
      attack: { bonus: CROSSBOW.bonus, rangeFeet: CROSSBOW.rangeFeet, rangeNormalFeet: CROSSBOW.rangeNormalFeet }
    });

    // Measured at the time of writing: 45 bundled monster actions carry a normal-range band.
    const library = new ContentLibrary().forAudience("gm");
    const carriers = library.monsterSummaries()
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
      // Inside 80 ft: a plain d20. Nothing contributed, so the resolution carries no `rollMode` at
      // all, and the 17 stands.
      const near = shoot(definition, CROSSBOW.nearFeet, CROSSBOW.nearFaces);
      expect(near.rollMode, label).toBeUndefined();
      expect(near.attack, label).toMatchObject({ naturalRoll: 17, total: CROSSBOW.nearTotal, outcome: "hit" });
      expect(near.damageTotal, label).toBe(CROSSBOW.nearDamage);

      // Past 80 ft and inside 320: the SAME action, the SAME first face, and a second die the near
      // shot never rolled. The lower is kept, so 17 becomes 6 and a hit becomes a miss.
      const far = shoot(definition, CROSSBOW.farFeet, CROSSBOW.farFaces);
      expect(far.rollMode?.mode, label).toBe("disadvantage");
      expect(far.rollMode?.disadvantage, label).toContain(`Long range (beyond ${CROSSBOW.rangeNormalFeet} ft)`);
      expect(far.attack, label).toMatchObject({ naturalRoll: CROSSBOW.farNatural, total: CROSSBOW.farTotal, outcome: "miss" });
      expect(far.damageTotal, label).toBe(0);
    }
  });
});

/* ---------- U6: what an effect DOES — an ITEM effect and a FEATURE effect --------- */

/**
 * The row: `EffectGrant.modifiers` — **the highest-value gap in the phase, and the one that
 * crosses carriers.**
 *
 * Until this unit, every effect a GM authored was a name, some tags, a duration and nothing that
 * changes a number: `effectsField` offered no control for `modifiers` at all, while the engine read
 * it in two places and the SRD authored it twice. Both SRD carriers are FEATURES — Reckless Attack
 * and Superior Defense, the only two records in the whole bundle set that carry `effects[].modifiers`
 * — and `equipment.v1.json` carries none, so this row cannot be proved on one carrier.
 *
 * **The two paths reach the same die down two genuinely different roads**, which is the point:
 *
 *  - the FEATURE road: `character-build.ts` synthesises an activation carrying `feature.effects[0]`,
 *    resolving it writes a live `EffectInstance` on the actor, and `attackRollSources` reads
 *    `attacker.effects[].modifiers` through `toRollModes`;
 *  - the ITEM road: nothing is written to the actor at all. `takeEffects` in
 *    `equipment-derivation.ts` reads the equipped item's effects as STANDING riders, normalising
 *    `attack-advantage` into `roll-mode` on the way, and `attackRollSources` collects them from
 *    `moment.attacker.carriers`.
 *
 * One sheet, one greataxe, one pair of faces, one assertion body: the swing rolls two d20s and keeps
 * the higher, 3 becomes 15, and a single-die roll would have kept the 3.
 */
const RECKLESS = {
  classId: "barbarian",
  featureId: "reckless-attack",
  /** The pair the SRD authors on ONE effect: the benefit and the cost, in one sentence. */
  srdModifiers: ["attack-advantage", "incoming-attack-advantage"],
  itemId: "hb-bracers-a1b2c3",
  itemName: "Bracers of the Headlong Rush",
  swingId: "item-greataxe",
  /** Two d20s then the greataxe's d12. The low face is FIRST, so "kept the higher" is visible. */
  advantageFaces: [3, 15, 8],
  /** The same swing with nothing helping it: one d20, and the 3 stands. */
  plainFaces: [3, 8],
  natural: 15,
  plainNatural: 3
} as const;

/**
 * A Halfling Barbarian 2 — the lowest level that has Reckless Attack, and Halfling because it is the
 * one SRD species with no ability bonus, no modifier and no choice of its own, so nothing below can
 * be blamed on the species. Built through the REAL builder against the REAL bundles.
 */
const BARBARIAN: CharacterCreateRequestInput = {
  name: "Ozar", speciesId: "halfling", backgroundId: "soldier", classId: "barbarian", level: 2,
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
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

type Table = Readonly<{ definition: ActorDefinition; state: GameState; hero: Actor; catalog: ReturnType<typeof equipmentCatalogOf> }>;

/** The Barbarian, on a map, with the hero first in the order — `attack-advantage` is gated to the
    bearer's OWN turn, so the order is part of the fixture rather than decoration. */
function barbarianTable(homebrew?: HomebrewContentSource): Table {
  const view = new ContentLibrary(homebrew).forAudience("gm");
  const catalog = equipmentCatalogOf(view);
  const definition = buildCharacterDefinition(BARBARIAN, view, BuilderPolicySchema.parse({}));
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [{ id: IDS.target, name: "Target Dummy", kind: "monster", visibility: "public", hp: { current: 200, maximum: 200 }, armorClass: 12 }]
  });
  importActorDefinition(state, definition, IDS.caster, "public", catalog);
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.caster, score: 20 }, { actorId: IDS.target, score: 10 }] }, () => 1, GEOMETRY);
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

/** THE assertion body. Swing the greataxe at the dummy and report the d20 the engine kept. */
const swingGreataxe = (table: Table, faces: readonly number[]) => resolveOn(table, RECKLESS.swingId, faces, [IDS.target]);

/** The item a GM builds in `/homebrew`: an effect whose ONE modifier is the row this unit adds. */
function authoredBracers(): Draft {
  // THE ROW, and it is nested two containers deep. `authoredRow` throws when a key has no control,
  // so before U6 this line — not an assertion below it — is what failed.
  const modifier = authoredRow("equipment", ["effects", "modifiers"], [["type", "attack-advantage"]]);
  const effect = authoredRow("equipment", ["effects"], [
    ["name", "Headlong Rush"],
    ["tags", ["reckless"]],
    ["duration.type", "encounter"],
    ["modifiers", [modifier]]
  ]);
  return authored("equipment", RECKLESS.itemName, [
    ["description", "Iron bracers that pull the wearer forward into the swing."],
    ["category", "wondrous"],
    ["slot", "hands"],
    ["isMagic", true],
    ["effects", [effect]]
  ]);
}

/** The Barbarian again, wearing the authored bracers — a real `ContentLibrary` with a real homebrew
    slice, so the item reaches the fight through the same merge a published record does. */
function barbarianWearingBracers(): Table {
  const record = HOMEBREW_BODY_SCHEMAS.equipment.parse(storedBody("equipment", authoredBracers(), RECKLESS.itemId));
  const table = barbarianTable({
    revision: 1,
    publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, equipment: [record] }),
    monsterForInstance: () => undefined
  });
  table.hero.inventory.push(InventoryItemSchema.parse({ id: RECKLESS.itemId, name: RECKLESS.itemName, quantity: 1, equipped: true, category: "wondrous" }));
  return table;
}

/** The SRD's own carrier, read out of the shipped bundle through the server's content view. */
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
      modifiers: [{ type: "attack-advantage" }]
    });

    // The row is looked up in the EFFECT's own fields, never the record's. A flat lookup would have
    // resolved it against the top-level `modifiersField` — the 21-variant FEATURE union, which an
    // effect cannot hold — and called the row authorable while it was not.
    expect(hasControl("equipment", "modifiers", ["effects"])).toBe(true);
    expect(hasControl("equipment", "damageTypes", ["effects", "modifiers"])).toBe(true);
    // ...and the two unions really are different, which is why this is its own list: `armor-class` is
    // a `FeatureModifier` and NOT an `EffectModifier`, so it is offered one level up and not here.
    const offered = (kind: string) =>
      (applyField("equipment", { rowId: "r" }, "type", kind, ["effects", "modifiers"]) as { type?: string }).type;
    expect(offered("attack-advantage")).toBe("attack-advantage");
    expect(() => applyField("equipment", {}, "armor-class", 1, ["effects", "modifiers"])).toThrow();
  });

  it("2. SRD content authors the same shape — and both carriers of it are FEATURES", () => {
    const feature = srdRecklessAttack();
    expect(feature.effects[0]).toMatchObject({ tags: ["reckless-attack"], modifiers: [{ type: "attack-advantage" }, { type: "incoming-attack-advantage" }] });
    expect(feature.effects[0].modifiers.map((modifier) => modifier.type)).toEqual([...RECKLESS.srdModifiers]);

    // Measured at the time of writing: exactly TWO records in the whole bundle set author
    // `effects[].modifiers`, Reckless Attack and Superior Defense, and both are Barbarian class
    // features. `equipment.v1.json` authors none — which is why this unit's editor half has to be an
    // ITEM and its SRD half a FEATURE, and why the assertion below has to run over both.
    const library = new ContentLibrary().forAudience("gm");
    const carriers = library.classSummaries()
      .flatMap((summary) => library.classRecord(summary.id)?.features ?? [])
      .filter((entry) => entry.effects.some((effect) => effect.modifiers.length > 0));
    expect(carriers.map((entry) => entry.id).sort()).toEqual(["reckless-attack", "superior-defense"]);
  });

  it("3. one assertion body over both: the swing rolls two d20s and keeps the higher", () => {
    const paths: ReadonlyArray<readonly [string, () => Table]> = [
      // The FEATURE carrier: enter Reckless Attack first, which writes the live effect.
      ["SRD content", () => { const table = barbarianTable(); resolveOn(table, RECKLESS.featureId, []); return table; }],
      // The ITEM carrier: nothing is entered. Wearing the bracers IS the effect.
      ["the homebrew editor", barbarianWearingBracers]
    ];

    for (const [label, tableOf] of paths) {
      const table = tableOf();
      const swung = swingGreataxe(table, RECKLESS.advantageFaces);
      // The far end: the die. Two d20s offered, the higher kept, and the roll card says why.
      expect(swung.rollMode?.mode, label).toBe("advantage");
      expect(swung.attack?.naturalRoll, label).toBe(RECKLESS.natural);
      expect(swung.attack?.outcome, label).toBe("hit");
    }

    // THE NEGATIVE CONTROL, and it is what makes the two above mean anything: the same sheet, the
    // same greataxe and the same first face, with neither carrier contributing. One die, and the 3
    // stands — so a test that only ever swung under advantage would have passed on advantage from
    // any source at all.
    const bare = swingGreataxe(barbarianTable(), RECKLESS.plainFaces);
    expect(bare.rollMode).toBeUndefined();
    expect(bare.attack?.naturalRoll).toBe(RECKLESS.plainNatural);
  });
});

/* ------------- U9: `grants.spells` — the eleventh of eleven grant arrays ---------- */

/**
 * The row: `FeatureGrantsSchema.spells` — "you always have this spell prepared".
 *
 * Ten of the eleven arrays `GrantsEditor` writes reached parity long ago. This one did not, and it
 * failed in the quietest possible way: the component **preserved** whatever `grants.spells` was
 * already in the body on its way past, so a duplicated SRD record kept its domain spells and a GM
 * could not add, remove or even see one. Preserving is not a control. 41 SRD records author it —
 * 19 class features, 14 species traits, 8 subclass features — and `character-build.ts` turns each
 * into a spell that is on the sheet, prepared, and uncharged against the prepared cap.
 *
 * **Two things measured here that the plan had wrong, and both change the control:**
 *
 *  1. the authored shape is `FeatureGrantsSchema.spells` — `{id, level?, alwaysPrepared, ability?}` —
 *     NOT `SpellcastingSchema.spells` (`{id, name, level, prepared, alwaysPrepared, actionId?,
 *     classId?}`), which is the BUILT sheet's shape and the reader's output rather than its input;
 *  2. `grants.spells` is read on the FEATURE road only. `takeGrants` in `equipment-derivation.ts`
 *     folds nine grant arrays for an equipped item and `spells` is not among them, so an item's
 *     spell grant would parse, store and do nothing. The carrier here is a FEAT.
 *
 * One sheet carries both paths: a Human Paladin 1 whose class feature grants Divine Smite (the SRD
 * half) and whose Human origin-feat pick is a homebrew feat granting Bless (the editor half).
 */
const GRANTED = {
  srdFeatureId: "paladins-smite",
  srdSpellId: "divine-smite",
  featId: "hb-wayfarers-blessing-a1b2",
  featName: "Wayfarer's Blessing",
  featSpellId: "bless"
} as const;

/** The feat a GM builds in `/homebrew`: the record shell through the real form, and the grant
    through `GrantsEditor`'s OWN write path.

    Why not `applyField`: `grants` is the one key still on `RIDER_EXEMPT`, because all eleven kinds
    are bespoke JSX inside `GrantsEditor` with no `FieldDef` to look up — writing through the
    exemption would be this test hand-building the body and proving nothing. `grantsFromRows` is the
    function the component itself calls, and the rendered affordance (a `CatalogPicker` over the
    merged spell catalog, not a `TagInput`) is driven in `pick-fields.test.tsx`. */
function authoredFeat(withGrant = true): Draft {
  const shell = authored("feat", GRANTED.featName, [
    ["category", "origin"],
    ["summary", "A blessing for the road."],
    ["description", "You always have the Bless spell prepared."]
  ]);
  const grants = withGrant ? grantsFromRows([{ rowId: "spells", kind: "spells", values: [GRANTED.featSpellId] }]) : undefined;
  // The feature's own name and description used to be hand-set here, because `FeatureEditor` had no
  // `FieldDef` anywhere and was invisible to the harness. R1 mounted its fields as the row shape of
  // the `custom: "features"` field, so they go through the real control at the feature's OWN scope —
  // `["feature"]`, singular, because a feat IS one `FeatureRecord` and not a list.
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", GRANTED.featName, ["feature"]);
  feature = applyField("feat", feature, "description", "You always have the Bless spell prepared.", ["feature"]);
  return { ...shell, feature: { ...feature, grants } };
}

/**
 * A Human Paladin 2 — level 2 because that is where `paladins-smite` sits, and Human because its
 * Versatile trait is the origin-feat slot the homebrew feat is taken in. Neither granted spell is
 * chosen anywhere in this ledger: both arrive as grants, which is the whole claim.
 */
const paladinInput = (): CharacterCreateRequestInput => ({
  name: "Sera", speciesId: "human", backgroundId: "soldier", classId: "paladin", level: 2,
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 13 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "paladin", kind: "skill", id: "athletics" },
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
} as CharacterCreateRequestInput);

/** The sheet, built by the REAL builder against the REAL bundles, with the authored feat merged in
    through a real homebrew slice — the same merge a published record takes. */
function paladinSheet({ withGrant }: { withGrant: boolean }): ActorDefinition {
  const record = HOMEBREW_BODY_SCHEMAS.feat.parse(storedBody("feat", authoredFeat(withGrant), GRANTED.featId));
  const homebrew: HomebrewContentSource = {
    revision: 1,
    publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, feats: [record] }),
    monsterForInstance: () => undefined
  };
  return buildCharacterDefinition(paladinInput(), new ContentLibrary(homebrew).forAudience("gm"), BuilderPolicySchema.parse({}));
}

/** THE assertion body: is this spell on the sheet, and is it there the way a GRANT puts it there? */
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

    // The round trip, through the component's own read: what was written comes back as the ids the
    // picker shows, so re-opening the record does not lose the grant (which is what "preserved on
    // write" looked like from the outside, right up until a GM tried to change one).
    expect(grantRowsOf(body.feature.grants as Record<string, unknown>)).toEqual([
      { rowId: "spells", kind: "spells", values: [GRANTED.featSpellId] }
    ]);

    // And the standing warning, stated where it applies: this key is NOT visible to the harness, so
    // the census cannot see it and `applyField` would wave it through. `grants` stays exempt because
    // all eleven kinds are bespoke JSX — U9 made the eleventh EDITABLE, not declarative.
    expect(RIDER_EXEMPT).toEqual(["grants"]);
    expect(hasControl("feat", "grants")).toBe(false);
  });

  it("2. SRD content authors the same shape — and it is 41 records, not a lone one", () => {
    const library = new ContentLibrary().forAudience("gm");
    const carriers: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) { for (const entry of node) walk(entry); return; }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const grants = record.grants as { spells?: unknown[] } | undefined;
      if (Array.isArray(grants?.spells) && grants.spells.length > 0) carriers.push(String(record.id ?? "?"));
      for (const value of Object.values(record)) walk(value);
    };
    for (const summary of library.classSummaries()) walk(library.classRecord(summary.id));
    for (const summary of library.speciesSummaries()) walk(library.speciesRecord(summary.id));
    for (const summary of library.subclassSummaries()) walk(library.subclassRecord(summary.id));

    // Measured at the time of writing: 41 — 19 class features, 14 species traits, 8 subclass
    // features. The Paladin's own carrier is one of them and is named, so the fixture below cannot
    // drift silently away from the bundle.
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
      // The far end: a row on the character's own spell list, ready to cast without preparing it.
      expect(spell, label).toMatchObject({ id: spellId, prepared: true, alwaysPrepared: true });
      // The name is resolved from the catalog rather than from the grant, so a picked id is a real
      // spell on the sheet and not a slug the player has to decode.
      expect(spell?.name, label).not.toBe(spellId);
    }

    // THE NEGATIVE CONTROL, and it drops the VALUE rather than the carrier: the same Paladin, taking
    // the same homebrew feat, whose only difference is that the GM picked no spell. Divine Smite is
    // still there — it is the class's — and Bless is gone, so it is the GRANT that put it on the
    // sheet and not the feat, the species, or any other part of the build.
    const without = paladinSheet({ withGrant: false });
    expect(preparedSpell(without, GRANTED.srdSpellId)).toBeDefined();
    expect(preparedSpell(without, GRANTED.featSpellId)).toBeUndefined();
  });
});

/* ---------- U7: `uses.scaling: class-resource` — the class table's own column ----- */

/**
 * The row: `FeatureUsesSchema.scaling` variant `class-resource` — *"you can Rage the number of
 * times shown in the Rages column of the Barbarian Features table."*
 *
 * It is the highest-count single gap in the `uses` family and the schema half has shipped all
 * along: `character-content.ts` declares the fourth discriminator, `character-build.ts`'s
 * `resolvedUseLimit` reads the printed column off `classResources` at the character's own level,
 * and **19 SRD features stand on it** — 16 class features and 3 subclass features. The select that
 * writes `uses.scaling.type` simply had no such option, so the one thing a homebrew class most
 * needs to say was the one thing it could not: without it a GM must re-type the printed column into
 * a `by-level` list sitting beside the printed column it copies, which is the second copy that
 * drifts.
 *
 * **The far end is a count that MOVES with the level, from one authored record.** Rage prints 2 at
 * level 1 and 3 at level 3, and neither number is anywhere in the feature — the feature names a
 * column. A test at one level would pass on a hard-coded 3.
 *
 * **The control is offered at FEATURE scope only, and that is a measurement rather than a
 * shortcut.** `scaledLimit` in `equipment-derivation.ts` answers `undefined` for `class-resource`
 * in writing — a built definition no longer carries a class table — so an item authored this way
 * grants no charges however the GM fills it in. The census row this unit deletes named `equipment`;
 * the 19 authors are class and subclass features, and the carrier the census named is the one
 * carrier that can never read it.
 */
const RAGES = {
  classId: "barbarian",
  featureId: "rage",
  resourceId: "rage",
  /** The Rages column, straight off `classes.v1.json`: 2 at levels 1-2, 3 at level 3. */
  atLevel1: 2,
  atLevel3: 3,
  featId: "hb-bottled-fury-a1b2",
  featName: "Bottled Fury",
  /** A column the BARBARIAN's table does not print — the Sorcerer's. The negative control. */
  wrongResourceId: "sorcery-points"
} as const;

/** The feat a GM builds in `/homebrew`, through the real controls: `RiderEditor` is mounted by
    `FeatureEditor` with the FEATURE itself as its value, so the `uses` block is written against the
    feature draft exactly the way the form writes it. `applyField` throws when a key has no control,
    so before U7 the `uses.scaling.id` line — not an assertion below it — is what failed. */
function authoredFuryFeat(resourceId: string): Draft {
  const shell = authored("feat", RAGES.featName, [
    ["category", "origin"],
    ["summary", "Fury you can keep in a bottle."],
    ["description", "You can bottle your fury as often as you can Rage."]
  ]);
  // Addressed INSIDE the `uses` group, and it has to be: `usesField`'s "Uses are" and
  // `modifiersField`'s "Which way" are both keyed `mode`, and the flat `fieldsOf` lookup finds the
  // modifier's first — which has no `write`, so it would `setAt` a literal `mode` key on the
  // feature and the publish gate would answer `Unrecognized key(s): 'mode'`. That is the same false
  // pass `fieldsWithin` exists for, met on a GROUP rather than a row.
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "mode", "class-resource", ["uses"]);
  feature = applyField("feat", feature, "uses.scaling.id", resourceId, ["uses"]);
  feature = applyField("feat", feature, "uses.per", "long-rest", ["uses"]);
  // Name and description go through the feature's OWN controls since R1 — `["feature"]` is the
  // feat's singular container, the same scope the `uses` block above is addressed at.
  feature = applyField("feat", feature, "name", RAGES.featName, ["feature"]);
  feature = applyField("feat", feature, "description", "You can bottle your fury as often as you can Rage.", ["feature"]);
  return { ...shell, feature };
}

const furyFeatureId = (draft: Draft) => String((draft.feature as { id?: unknown }).id ?? "");

/** A Human Barbarian at the level asked for. Human because its Versatile trait is the origin-feat
    slot the homebrew feat is taken in; Berserker at 3 because every 2024 class picks a subclass
    there. Built by the REAL builder against the REAL bundles. */
const barbarianInput = (level: 1 | 3, featId?: string): CharacterCreateRequestInput => ({
  name: "Ozar", speciesId: "human", backgroundId: "soldier", classId: "barbarian", level,
  ...(level >= 3 ? { subclassId: "path-of-the-berserker" } : {}),
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
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
} as CharacterCreateRequestInput);

/** The sheet, with the authored feat merged in through a real homebrew slice — the same merge a
    published record takes. */
function barbarianSheet(level: 1 | 3, feat?: Draft): ActorDefinition {
  const homebrew: HomebrewContentSource | undefined = feat
    ? {
      revision: 1,
      publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, feats: [HOMEBREW_BODY_SCHEMAS.feat.parse(storedBody("feat", feat, RAGES.featId))] }),
      monsterForInstance: () => undefined
    }
    : undefined;
  return buildCharacterDefinition(
    barbarianInput(level, feat ? RAGES.featId : undefined),
    new ContentLibrary(homebrew).forAudience("gm"),
    BuilderPolicySchema.parse({})
  );
}

/** THE assertion body: how many uses did the builder resolve for this action? */
const useLimit = (definition: ActorDefinition, actionId: string) =>
  definition.actions.find((entry) => entry.id === actionId)?.uses?.limit;

describe("uses read off the class table's own column — through both paths", () => {
  it("1. the editor can author it: the fifth mode and its column id go through real controls, and the feat publishes", () => {
    const draft = authoredFuryFeat(RAGES.resourceId);
    const verdict = publishVerdict("feat", draft, RAGES.featId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    const body = storedBody("feat", draft, RAGES.featId) as { feature: { uses?: unknown } };
    expect(body.feature.uses).toEqual({ scaling: { type: "class-resource", id: RAGES.resourceId }, per: "long-rest" });

    // The mode select reads its own answer back out of the shape, so re-opening the record shows
    // "A column on the class table" rather than "Not set" — `3b`(a)'s repair, on the fifth option.
    const mode = fieldsWithin("feat", ["uses"]).find((field) => field.key === "mode");
    expect(mode?.read?.(draft.feature as Draft)).toBe("class-resource");
    expect(optionValues(mode)).toContain("class-resource");

    // ...and an ITEM is not offered it, because `scaledLimit` can never resolve it there. The key
    // exists at item scope (the other three scalings share it); the OPTION does not.
    expect(hasControl("equipment", "uses.scaling.id")).toBe(false);
    expect(optionValues(fieldsWithin("equipment", ["uses"]).find((field) => field.key === "mode"))).not.toContain("class-resource");
  });

  it("2. SRD content authors the same shape — and it is 19 records, not a lone one", () => {
    const library = new ContentLibrary().forAudience("gm");
    const rage = library.classRecord(RAGES.classId)?.features.find((entry) => entry.id === RAGES.featureId);
    expect(rage?.uses).toEqual({ scaling: { type: "class-resource", id: RAGES.resourceId }, per: "long-rest" });

    const carriers: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) { for (const entry of node) walk(entry); return; }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      const uses = record.uses as { scaling?: { type?: string } } | undefined;
      if (uses?.scaling?.type === "class-resource") carriers.push(String(record.id ?? "?"));
      for (const value of Object.values(record)) walk(value);
    };
    for (const summary of library.classSummaries()) walk(library.classRecord(summary.id));
    for (const summary of library.subclassSummaries()) walk(library.subclassRecord(summary.id));

    // Measured at the time of writing: 19 — 16 in `classes.v1.json`, 3 in `subclasses.v1.json`.
    // Four of them are named, so the fixture below cannot drift silently away from the bundle.
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
      // The far end: a use count neither record states. 2 at level 1, 3 at level 3, off the same
      // authored line — which is what a `by-level` table beside the printed table would have had to
      // restate, and what an option-less select made unsayable.
      expect(useLimit(level1, actionId), label).toBe(RAGES.atLevel1);
      expect(useLimit(level3, actionId), label).toBe(RAGES.atLevel3);
    }

    // THE NEGATIVE CONTROL, and it drops the VALUE rather than the carrier: the same Barbarian
    // taking the same feat, whose only difference is that the column named is the SORCERER's. An
    // unmatched column resolves to 0 uses, so the feature carries no pool at all — while Rage,
    // reading a column this table really prints, still says 3.
    const wrongFeat = authoredFuryFeat(RAGES.wrongResourceId);
    const wrong = barbarianSheet(3, wrongFeat);
    expect(useLimit(wrong, RAGES.featureId)).toBe(RAGES.atLevel3);
    expect(wrong.actions.find((entry) => entry.id === furyFeatureId(wrongFeat))).toBeUndefined();
  });
});

/* --------------- U8: `recharge` — the d6 at the start of the creature's turn ------ */

/**
 * The row: `ActionUsesSchema.per: "recharge"` and its `recharge` threshold — the *(Recharge 5–6)*
 * every printed breath weapon carries.
 *
 * **The reader is the best-proved in the wave and it had no author but the bundle.** `encounter.ts`
 * rolls a d6 at the start of the owner's turn, clears the pool on a roll at or above the threshold,
 * and narrates BOTH outcomes by name — *"recharges (rolled 6)"* and *"stays spent (rolled 5, needs
 * 6+)"*; `rests.ts` clears recharge pools on a short rest and a fresh fight re-arms them.
 * `ActionUsesSchema` has carried the fifth `per` value, the threshold and a refinement PAIR
 * enforcing them together for as long as any of it shipped. 86 bundled monster actions author it
 * (67 at 5, 14 at 6, 5 at 4). **And no carrier had a control at all** — `actionsField` had no `uses`
 * block at any scope, so an action's own uses were unsayable on a monster, an item and a feature
 * alike.
 *
 * **Where the control went, and why not where the census said.** The census row named
 * `equipment.uses.recharge`, which is the ITEM's record-level `uses` — `FeatureUsesSchema`, whose
 * `per` has four values and no threshold key. Widening THAT was measured and rejected twice over:
 * an item's record-level `uses` is read by nothing at all today (`usesOf` has exactly two call
 * sites, an action's uses and a cast's, and the equipped loop never reads `record.uses` — that is
 * U24), and the same schema is shared with FEATURES, where `character-build.ts` folds a feature's
 * uses into an action at two sites and neither forwards a threshold. A feature authoring
 * `per: "recharge"` would build `{limit, per: "recharge"}`, which `ActionUsesSchema` refuses with
 * *"Recharge uses need the d6 threshold"* — a schema-valid record that makes its own bearer
 * unbuildable. So the control went to the ACTION's `uses`, which is the schema the engine actually
 * reads, on every carrier that mounts an action.
 *
 * The Ankheg is the carrier because it is the plainest recharge in the bundle: two actions, a
 * save-only Acid Spray at **Recharge 6**, so exactly one face on the die re-arms it and a test
 * cannot pass on a lucky range.
 */
const RECHARGE = {
  monsterId: "ankheg",
  srdActionId: "acid-spray",
  /** 6, so `5` is a miss by one and `6` is the only re-arm. */
  threshold: 6,
  saveAbility: "dex",
  saveDc: 12,
  formula: "4d6",
  damageType: "acid",
  /** 4d6, all fours — the resolver needs the faces before anything below can look at the counter. */
  damageFaces: [4, 4, 4, 4],
  drakeActionId: "ember-breath",
  drakeActionName: "Ember Breath (Recharge 6)"
} as const;

function authoredDrake(): Draft {
  const damagePart = authoredRow("monster", ["actions", "damage"], [
    ["formula", RECHARGE.formula],
    ["type", RECHARGE.damageType]
  ]);
  const edits: ReadonlyArray<readonly [string, unknown]> = [
    ["name", RECHARGE.drakeActionName],
    ["activation", "action"],
    ["description", "Dexterity Saving Throw: DC 12. Failure: 14 (4d6) Acid damage."],
    ["damage", [damagePart]],
    ["save.ability", RECHARGE.saveAbility],
    ["save.dc", RECHARGE.saveDc],
    // THE ROW, authored the way a GM meets it: the count, then how it comes back, then the die.
    // `authoredRow` throws when a key has no control, so before U8 the first of these three lines —
    // not an assertion below it — is what failed, on every carrier.
    ["uses.limit", 1],
    ["uses.per", "recharge"],
    ["uses.recharge", RECHARGE.threshold]
  ];
  const action = authoredRow("monster", ["actions"], edits);
  return authored("monster", "Cinder Drake", [
    ["abilityScores.str", 17], ["abilityScores.dex", 11], ["abilityScores.con", 14],
    ["abilityScores.int", 3], ["abilityScores.wis", 13], ["abilityScores.cha", 6],
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

/**
 * THE assertion body. Spend the action in a real fight, then hand the creature its next turn twice
 * — once with a die one short of the threshold and once with the threshold itself — and report what
 * the table would see. Four far ends in one pass: a spent counter, a rolled die, a narrated refusal
 * and a re-armed pool.
 */
function spendThenRecharge(definition: ActorDefinition, actionId: string) {
  const state: GameState = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: IDS.caster, name: definition.name, kind: "monster", visibility: "public", hp: { current: 45, maximum: 45 }, armorClass: 14, definitionId: "def-caster" },
      { id: IDS.target, name: "Target Dummy", kind: "monster", visibility: "public", hp: { current: 80, maximum: 80 }, armorClass: 12 }
    ]
  });
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.caster, score: 20 }, { actorId: IDS.target, score: 10 }] }, () => 1, GEOMETRY);

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

  /** Give the creature its next turn with a fixed d6. Two advances: the dummy, then back round. */
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
    expect(body.actions[0]).toMatchObject({ id: RECHARGE.drakeActionId, uses: { limit: 1, per: "recharge", recharge: RECHARGE.threshold } });

    // The control is an ACTION's, on every carrier that mounts one — and it is NOT the record's
    // `uses` block, whose `FeatureUsesSchema` has no `recharge` key to write into.
    for (const type of ["monster", "equipment", "class"] as const) {
      expect(hasControl(type, "uses.recharge", ["actions"]), type).toBe(true);
    }
    expect(hasControl("equipment", "uses.recharge")).toBe(true);   // reachable — inside an action row
    expect(fieldsWithin("equipment", ["uses"]).some((field) => field.key === "uses.recharge")).toBe(false);
  });

  it("1b. the two halves of one authored fact are held together by the form and by the schema", () => {
    // Picking the die SEEDS the SRD's commonest threshold rather than leaving the pair half-said —
    // so the ordinary path never reaches the refusal at all.
    const seeded = authoredRow("monster", ["actions"], [["uses.limit", 1], ["uses.per", "recharge"]]);
    expect(seeded.uses).toEqual({ limit: 1, per: "recharge", recharge: 5 });

    // ...and switching away DELETES it, so the schema's other refusal — "the recharge threshold only
    // applies when per is recharge" — cannot be reached from the form either.
    const backToRest = applyField("monster", seeded, "uses.per", "long-rest", ["actions"]);
    expect(backToRest.uses).toEqual({ limit: 1, per: "long-rest" });

    // The refinement is still load-bearing, because emptying the number is one keystroke away on a
    // real form. The refusal a GM meets there is the schema's own sentence, named.
    const emptied = applyField("monster", seeded, "uses.recharge", undefined, ["actions"]);
    const drake = authoredDrake();
    const half = { ...drake, actions: [{ ...emptied, id: RECHARGE.drakeActionId, name: RECHARGE.drakeActionName, description: "Half-said." }] };
    const verdict = publishVerdict("monster", half, RECORD_ID);
    expect(verdict.publishable).toBe(false);
    expect(verdict.why).toContain("Recharge uses need the d6 threshold");
  });

  it("2. SRD content authors the same shape — and it is 86 records, not a lone one", () => {
    const spray = srdAnkheg().actions.find((entry) => entry.id === RECHARGE.srdActionId);
    expect(spray?.uses).toEqual({ limit: 1, per: "recharge", recharge: RECHARGE.threshold });

    // Measured at the time of writing: 86 bundled monster actions come back on a die.
    const library = new ContentLibrary().forAudience("gm");
    const carriers = library.monsterSummaries()
      .flatMap((summary) => library.monster(summary.id)?.actions ?? [])
      .filter((entry) => entry.uses?.per === "recharge");
    expect(carriers.length).toBeGreaterThanOrEqual(80);
    // Every one of them carries the threshold, which is the refinement pair doing its job on real
    // content rather than on a fixture.
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

      // 1. a spent counter — the use was really taken by the resolver, not set by this test.
      expect(seen.spent, label).toBe(1);

      // 2. a rolled die and 3. a narration that says why, in the table's own words. One short of
      //    the threshold is the contrast that makes the re-arm mean something: without it, an
      //    action that came back every turn regardless would pass.
      expect(seen.short.map((event) => event.text), label)
        .toContain(`${definition.name}'s ${seen.actionName} stays spent (rolled ${RECHARGE.threshold - 1}, needs ${RECHARGE.threshold}+).`);
      expect(seen.stillSpent, label).toBe(1);

      // 4. a re-armed pool, and the line the table reads when it happens.
      expect(seen.hit.map((event) => event.text), label)
        .toContain(`${definition.name}'s ${seen.actionName} recharges (rolled ${RECHARGE.threshold}).`);
      expect(seen.armed, label).toBe(true);
    }
  });
});

/* -------------- U12: several picks on ONE record (`choices`) — through both paths -- */

/**
 * The row: `FeatureRecordSchema.choices` — one feature that asks MORE THAN ONE question.
 *
 * The purest built-but-unwired case of the session: `featurePicks` has read the plural spelling on
 * both consumers since Magic Initiate shipped (`character-build.ts` builds one offer per pick,
 * `build-payload.ts` mirrors it), three feat records author it, the wire type carries it, the
 * class-mechanics overlay accepts it — and the census's own worked example was that
 * `applyField("class", draft, "choices", …)` THREW, because the panel edited exactly one `choice`.
 * A homebrew Magic Initiate was unauthorable: its level-1 spell had nowhere to go.
 *
 * **The `choice`/`choices` relationship, taken from the reader.** `featurePicks` reads the pair as
 * ONE list with two spellings — `choices` wins when non-empty — and the schema's `oneChoiceForm`
 * refinement REFUSES a record carrying both. So the panel never asks the GM to pick a spelling:
 * every write funnels through `writeChoiceBlocks`, which spells the list canonically from its
 * length (one block → `choice`, several → `choices`, zero → neither). That is what the SRD itself
 * authors — every one-pick record is singular, all three plural records have two picks, none has
 * both keys — and it makes the refused both-keys shape unauthorable rather than merely caught.
 *
 * **The far end is the SECOND pick reaching a built character's sheet.** The first pick was always
 * reachable through `choice`; the plural read is what makes pick 2 exist at all, so the negative
 * control drops the second block and watches the same ledger row be REFUSED by name.
 */
const SEVERAL = {
  srdFeatId: "magic-initiate-cleric",
  /** The SRD's own two-pick shape: two cantrips and one level-1 spell, both off one list. */
  srdRows: [
    { kind: "cantrip", id: "guidance" },
    { kind: "cantrip", id: "thaumaturgy" },
    { kind: "spell", id: "bless" }
  ],
  hbFeatId: "hb-twin-disciplines-a1b2",
  /** The feature's own id, pinned the way U10's fixture pins an action id: the ledger tags its
      answers with the FEATURE id (`feature:<id>` is the offer key), and a random minted id would
      put the tag out of reach of the fixture. */
  hbFeatureId: "twin-disciplines",
  hbFeatName: "Twin Disciplines",
  /** The editor half drives `from` lists — `fromCatalog` is the bespoke pair, unreachable from
      `applyField` by R1's standing ruling — so the options are named ids off the same real spells. */
  hbCantrips: ["guidance", "sacred-flame"],
  hbSpells: ["bless", "cure-wounds"],
  hbRows: [
    { kind: "cantrip", id: "guidance" },
    { kind: "cantrip", id: "sacred-flame" },
    { kind: "spell", id: "bless" }
  ]
} as const;

/** The feat a GM builds in `/homebrew`: TWO choice blocks, each authored through the block's own
    controls at the `choices` row scope, then the list written through the field's own write —
    which is where the canonical spelling lives. `withSecondPick: false` is the negative control's
    version: the same feat whose plural list holds only the cantrip block. */
function authoredTwinFeat(withSecondPick = true): Draft {
  const shell = authored("feat", SEVERAL.hbFeatName, [
    ["category", "origin"],
    ["summary", "Two disciplines, one teacher."],
    ["description", "You learn two cantrips and one level 1 spell."]
  ]);
  const cantrips = authoredRow("feat", ["feature", "choices"], [
    ["kind", "cantrip"],
    ["choose", 2],
    // Typed the way a GM types it: one box of commas. The block's own `write` splits and slugs.
    ["from", SEVERAL.hbCantrips.join(", ")]
  ]);
  const spell = authoredRow("feat", ["feature", "choices"], [
    ["kind", "spell"],
    ["choose", 1],
    ["from", SEVERAL.hbSpells.join(", ")]
  ]);
  let feature = shell.feature as Draft;
  feature = applyField("feat", feature, "name", SEVERAL.hbFeatName, ["feature"]);
  feature = applyField("feat", feature, "description", "You learn two cantrips and one level 1 spell.", ["feature"]);
  feature = applyField("feat", feature, "choices", withSecondPick ? [cantrips, spell] : [cantrips], ["feature"]);
  return { ...shell, feature: { ...feature, id: SEVERAL.hbFeatureId } };
}

/** A Human Paladin 2 taking `featId` in the Human Versatile slot, answering `rows` against the
    feat's FEATURE (`tagId` — offers are keyed `feature:<feature id>`, and the SRD's initiates name
    feat and feature identically) — the same carrier shape U9 proved, because Versatile is the one
    slot that takes any origin feat. */
const initiateInput = (featId: string, tagId: string, rows: ReadonlyArray<{ kind: string; id: string }>): CharacterCreateRequestInput => ({
  name: "Sera", speciesId: "human", backgroundId: "soldier", classId: "paladin", level: 2,
  abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 10, con: 14, int: 8, wis: 12, cha: 13 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "dwarvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "paladin", kind: "skill", id: "athletics" },
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
} as CharacterCreateRequestInput);

/** The sheet, with the authored feat merged in through a real homebrew slice when one is given. */
function initiateSheet(featId: string, tagId: string, rows: ReadonlyArray<{ kind: string; id: string }>, feat?: Draft): ActorDefinition {
  const homebrew: HomebrewContentSource | undefined = feat
    ? {
      revision: 1,
      publishedFor: () => ({ ...EMPTY_HOMEBREW_SLICE, feats: [HOMEBREW_BODY_SCHEMAS.feat.parse(storedBody("feat", feat, SEVERAL.hbFeatId))] }),
      monsterForInstance: () => undefined
    }
    : undefined;
  return buildCharacterDefinition(initiateInput(featId, tagId, rows), new ContentLibrary(homebrew).forAudience("gm"), BuilderPolicySchema.parse({}));
}

describe("several picks on one record (`choices`) — through both paths", () => {
  it("1. the editor can author it: two blocks through the block's own controls, spelled canonically", () => {
    const draft = authoredTwinFeat();
    const verdict = publishVerdict("feat", draft, SEVERAL.hbFeatId);
    expect(verdict.why).toBe("");
    expect(verdict.publishable).toBe(true);

    // TWO blocks → the plural spelling, and never both keys: `featurePicks` reads `choices` first
    // and the schema refuses a record carrying both, so the form derives the spelling from the
    // count instead of asking the GM to know it.
    const body = storedBody("feat", draft, SEVERAL.hbFeatId) as { feature: { choice?: unknown; choices?: unknown } };
    expect(body.feature.choice).toBeUndefined();
    expect(body.feature.choices).toEqual([
      { kind: "cantrip", choose: 2, from: [...SEVERAL.hbCantrips], repeatable: false },
      { kind: "spell", choose: 1, from: [...SEVERAL.hbSpells], repeatable: false }
    ]);

    // ONE block → the singular spelling, which is how every existing draft already reads. The
    // panel's own seed (the switch) and a one-element `choices` write land on the same body.
    const oneBlock = storedBody("feat", authoredTwinFeat(false), SEVERAL.hbFeatId) as { feature: { choice?: unknown; choices?: unknown } };
    expect(oneBlock.feature.choices).toBeUndefined();
    expect(oneBlock.feature.choice).toEqual({ kind: "cantrip", choose: 2, from: [...SEVERAL.hbCantrips], repeatable: false });

    // The `choice.*` keys stay live as the FIRST block's controls — R1's surface, un-stranded:
    // editing through them reaches block 0 of a plural feature and keeps the plural spelling.
    const feature = (draft.feature ?? {}) as Draft;
    const edited = applyField("feat", feature, "choice.choose", 3, ["feature"]);
    expect((edited.choices as Array<{ choose?: number }>)[0]?.choose).toBe(3);
    expect(edited.choice).toBeUndefined();

    // ...and the switch is the whole question, however it is spelled: off removes BOTH keys.
    const off = applyField("feat", feature, "choice", false, ["feature"]);
    expect("choice" in off).toBe(false);
    expect("choices" in off).toBe(false);
  });

  it("2. SRD content authors the same shape — three records, every one a Magic Initiate", () => {
    const library = new ContentLibrary().forAudience("gm");
    const carriers = library.featSummaries()
      .map((summary) => library.featRecord(summary.id))
      .filter((feat) => feat !== undefined && (feat.feature.choices?.length ?? 0) > 0)
      .map((feat) => feat!.id)
      .sort();
    // Measured at the time of writing: exactly three, each authoring two picks and no `choice` key.
    expect(carriers).toEqual(["magic-initiate-cleric", "magic-initiate-druid", "magic-initiate-wizard"]);

    const initiate = library.featRecord(SEVERAL.srdFeatId)!.feature;
    expect(initiate.choice).toBeUndefined();
    expect(initiate.choices).toHaveLength(2);
    expect(initiate.choices![0]).toMatchObject({ kind: "cantrip", choose: 2, fromCatalog: "cleric-spells" });
    expect(initiate.choices![1]).toMatchObject({ kind: "spell", choose: 1, fromCatalog: "cleric-spells" });
  });

  it("3. one assertion body over both: every pick — the second included — is a spell on the sheet", () => {
    const paths: ReadonlyArray<readonly [string, ActorDefinition, ReadonlyArray<{ kind: string; id: string }>]> = [
      ["SRD content", initiateSheet(SEVERAL.srdFeatId, SEVERAL.srdFeatId, SEVERAL.srdRows), SEVERAL.srdRows],
      ["the homebrew editor", initiateSheet(SEVERAL.hbFeatId, SEVERAL.hbFeatureId, SEVERAL.hbRows, authoredTwinFeat()), SEVERAL.hbRows]
    ];
    for (const [label, definition, rows] of paths) {
      for (const row of rows) {
        const spell = preparedSpell(definition, row.id);
        // The far end: a row on the character's own spell list. The cantrips arrive always-prepared,
        // the level-1 spell as an ordinary prepared spell — and neither is anywhere else in the build.
        expect(spell, `${label}: ${row.id}`).toMatchObject({ id: row.id, prepared: true });
        expect(spell?.name, `${label}: ${row.id}`).not.toBe(row.id);
      }
    }

    // THE NEGATIVE CONTROL, and it is the census's old throw inverted: the same feat authored with
    // only its FIRST block, the same ledger. The spell row now targets a pick that does not exist,
    // and the build refuses it BY NAME — the second pick exists exactly when the plural list says so.
    expect(() => initiateSheet(SEVERAL.hbFeatId, SEVERAL.hbFeatureId, SEVERAL.hbRows, authoredTwinFeat(false)))
      .toThrow(`No feature "${SEVERAL.hbFeatureId}" offers a "spell" choice.`);
  });
});

/* ------------------------------------------------------------- the mechanism ----- */

describe("the guard itself refuses what the editor cannot author", () => {
  /**
   * **R1's far end, and it is the only one a refactor with no user-visible change can have.**
   *
   * `fieldsOf` walks the form schema. `FeatureEditor` is mounted as a `custom` field, so before R1
   * it had no fields to walk and **every control in the choice panel was invisible to `applyField`
   * in both directions** — `extraPicks`, `choices`, `replaces`, `fromPicks`, the spell window and
   * the ASI ceiling all live in that panel, and each of the five units behind this refactor would
   * have had to ship with the fourth part of the rule ("a test through BOTH paths") structurally
   * unavailable. Converting is what puts the pick family under the guard.
   *
   * Asserted in two halves, because a presence check on its own proves nothing: the KEY is
   * reachable from the class form (the form the census below asks its questions of), and the VALUE
   * a control writes survives `forStorage` + `bodyForPublish` into the body the save path sends —
   * through the field's own `write`, including the slugging a GM's typing goes through.
   */
  it("R1: the choice panel is reachable from `fieldsOf`, and what it writes reaches the wire", () => {
    // Half one. Every one of these threw `No field "…" in the class form` before R1, and the three
    // that stay bespoke are named beside `featureFields()` with the reason: the level chips write
    // two draft keys in one edit, and the source switcher and the catalog pair are driven by a UI
    // mode held in React state that no `read` can recover from the draft.
    for (const key of ["name", "description", "choice", "choice.kind", "choice.choose", "choice.from", "choice.repeatable"]) {
      expect(hasControl("class", key, ["features"]), `class: features > ${key}`).toBe(true);
    }
    expect(hasControl("class", "choice.fromCatalog", ["features"])).toBe(false);

    // Half two, on a FEAT: the cheapest publishable carrier of a `FeatureRecord`, because a feat IS
    // one feature and needs no level table to grant it. `authoredRow` mints the row with the field's
    // own `newRow` and refuses any key with no control, so the reduce below is the assertion.
    const feature = authoredRow("feat", ["feature"], [
      ["name", "Divine Order"],
      ["description", "You gain one of the following options of your choice."],
      ["choice", true],
      // Typed the way a GM types it, not the way the column stores it — `ContentIdSchema` is
      // `/^[a-z0-9-]+$/`, and the slugging lives in the field's `write` where the panel's own
      // handler used to keep it.
      ["choice.kind", "ASI or Feat"],
      ["choice.choose", 2],
      ["choice.from", "Protector, thaumaturge"],
      ["choice.repeatable", true]
    ]);
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

    // The switch is the SHAPE and not a flag — `FeatureRecordSchema.choice` is `.optional()` and
    // has no "off" value to hold, so turning it off has to remove the key rather than write one.
    expect("choice" in applyField("feat", feature, "choice", false, ["feature"])).toBe(false);

    // ...and a choice key written on a feature that has none seeds the same three the switch does,
    // so the harness cannot build a half-made shape no form could produce.
    expect(applyField("feat", { id: "f1" }, "choice.choose", 3, ["feature"]).choice)
      .toEqual({ kind: "feat", choose: 3, repeatable: false });

    // R1 made the lookup possible and U12 made `choices` real: the census's old worked example —
    // this exact call throwing — is inverted in U12's own section above, and the key resolves at
    // the feature scope the census asks its questions of.
    expect(hasControl("feat", "choices", ["feature"])).toBe(true);
  });

  /**
   * The other half of R1's reach: an inline option — the third way a choice states its list, and
   * the depth `FeatureOption` lives at. It matters for U16, whose control half is "the option row
   * already mounts `RiderEditor`; these need the choice panel too": the option row is now a real
   * row scope, so `FeatureOption.requires` lands as one `FieldDef` beside `name` and `description`
   * rather than as more hand-written JSX invisible to this file.
   */
  it("R1: an inline option is a real row scope inside a bespoke component", () => {
    const option = authoredRow("feat", ["feature", "choice.options"], [
      ["name", "Thaumaturge"],
      ["description", "You know one extra cantrip from the Cleric spell list."]
    ]);
    const feature = [
      ["name", "Divine Order"],
      ["description", "You gain one of the following options of your choice."],
      ["choice.kind", "divine-order"],
      ["choice.options", [option]]
    ].reduce<Draft>((row, [key, value]) => applyField("feat", row, key as string, value, ["feature"]), authoredRow("feat", ["feature"], []));

    const draft: Draft = {
      ...authored("feat", "Divine Order", [
        ["category", "general"],
        ["summary", "Pick an order."],
        ["description", "Pick your order."]
      ]),
      feature
    };
    expect(publishVerdict("feat", draft, RECORD_ID).why).toBe("");

    const body = storedBody("feat", draft, RECORD_ID) as { feature: { choice?: { options?: Array<Record<string, unknown>> } } };
    expect(body.feature.choice?.options).toHaveLength(1);
    expect(body.feature.choice?.options?.[0]).toMatchObject({
      name: "Thaumaturge",
      description: "You know one extra cantrip from the Cleric spell list."
    });

    // The row is looked up in the OPTION's own fields, never the feature's — the same guard the
    // effect-`modifiers` row above relies on. An option carries no level and no `choice.kind`.
    expect(hasControl("feat", "name", ["feature", "choice.options"])).toBe(true);
    expect(hasControl("feat", "choice.kind", ["feature", "choice.options"])).toBe(false);
    // U16's own row, still owed: an option cannot yet say which earlier answer legalises it.
    expect(hasControl("feat", "requires", ["feature", "choice.options"])).toBe(false);
  });

  it("a row scope is looked up in the ROW's own fields, not the whole form's", () => {
    // The second face of the same hole, and it used to be shown on the EFFECT row — which U6 closed
    // with a control of its own. An ACTION row is the case that remains and it is the same shape: an
    // action carries a name, a cost, damage, an attack and a save, and no `modifiers` of its own. A
    // flat lookup would resolve it against the record's top-level `modifiersField` and wave the row
    // through, which is a false pass rather than a missing test.
    expect(hasControl("equipment", "modifiers")).toBe(true);
    expect(hasControl("equipment", "modifiers", ["actions"])).toBe(false);
    expect(() => applyField("equipment", {}, "modifiers", [], ["actions"])).toThrow(
      'No field "modifiers" in the equipment form (actions row) — the test is addressing a field that does not exist.'
    );
  });

  it("`grants` is the ONLY key still waved through, and it is waved through with a reason", () => {
    // `GrantsEditor` writes eleven parallel arrays whole-body and has no `FieldDef` to look up. Every
    // other member of the old six-key escape hatch is now a real control on every carrier that mounts
    // riders — which is the whole repair: effect `modifiers`, `uses.*`, `recharge` and `attack.bonus`
    // all live inside those six, so the harness would have passed in silence on its own headline rows.
    expect(RIDER_EXEMPT).toEqual(["grants"]);
    const carriers = (Object.keys(SCHEMAS) as HomebrewType[]).filter((type) => riderScopeOf(type) !== null);
    expect(carriers).toEqual(["class", "subclass", "species", "background", "feat", "equipment", "monster"]);

    /**
     * **A STAT BLOCK CARRIES TWO OF THE FIVE, and this test used to claim it carried all five.**
     *
     * `RecordDetail` enables exactly `["actions", "tags"]` on a monster and that is not a UI
     * preference: `ActorDefinitionSchema` has no record-level `modifiers`, `uses` or `effects`, and
     * being a plain `z.object` it drops them in silence. `riderFieldsForTest("statblock")` built all
     * six anyway, so `hasControl("monster", "uses")` answered `true` for a key no stat block can
     * hold — a false PASS on the harness's own question, left standing because `usesField`'s comment
     * said U8 would make it true. **U8 measured the opposite and narrowed the claim instead.**
     */
    // Asked of the RECORD's own fields, not of the flat lookup. `hasControl(type, key)` answers "is
    // this key reachable anywhere in the form", which is the right question for the census and the
    // wrong one here: an action row carries a `uses` block of its own now, so the flat walk finds
    // `uses` on a monster while no monster RECORD mounts one. `fieldsWithin(type, [])` flattens
    // through groups and not through rows, which is exactly the record scope.
    const onTheRecord = (type: HomebrewType, key: string) => fieldsWithin(type, []).some((field) => field.key === key);
    const RECORD_RIDERS = ["modifiers", "uses", "actions", "effects", "tags"];
    for (const type of carriers) {
      const mounted = type === "monster" ? ["actions", "tags"] : RECORD_RIDERS;
      for (const key of RECORD_RIDERS) {
        expect(onTheRecord(type, key), `${type}.${key}`).toBe(mounted.includes(key));
      }
      expect(hasControl(type, "grants"), `${type}.grants`).toBe(false);
    }

    // ...and a creature's uses are not missing, they are one level down — on its ACTIONS, which is
    // where `ActionSchema.uses` really lives and where all 86 recharge authors are. Every carrier
    // that mounts an action mounts them, because every carrier's actions read the same schema.
    for (const type of carriers) {
      for (const key of ["uses.limit", "uses.per", "uses.recharge", "uses.pool"]) {
        expect(hasControl(type, key, ["actions"]), `${type}: actions > ${key}`).toBe(true);
      }
    }
  });

  it("every damage-type key is authorable, at its own scope, on every carrier that mounts riders", () => {
    /**
     * **`3d`'s half of the guard.** The census in `vocabularies.test.ts` asks whether each control
     * offers the whole vocabulary and shows it; this asks the harness's own question — *can a GM
     * reach the key at all* — at the SCOPE each one really lives at, so a false pass off the flat
     * lookup is impossible (that is what `fieldsWithin` is for, and the effect-`modifiers` case above
     * is the same hole this avoids).
     *
     * The three rider sites are asserted on **every carrier**, not just on equipment: the rider
     * vocabulary is one vocabulary mounted by items, class features, species traits, feats and
     * monsters alike, so a damage-type control that regressed there would regress on all of them at
     * once and a single-carrier check would notice on none.
     *
     * **What this cannot see, stated rather than left implied:** the ninth site is `GrantsEditor`'s
     * "Which" box for the `damageResistances` and `damageImmunities` grant kinds, and `grants` is the
     * one key still on `RIDER_EXEMPT` because that component has no `FieldDef` to look up. The
     * harness would wave it through, so `pick-fields.test.tsx` drives it through the rendered form
     * instead. U9 is what retires the exemption.
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
    // Every carrier that mounts an action mounts its damage parts, stat blocks included.
    for (const type of carriers) {
      expect(hasControl(type, "type", ["actions", "damage"]), `${type}: actions > damage > type`).toBe(true);
    }

    // The record's OWN modifier list, which is six carriers and not seven: a stat block does not
    // mount `modifiersField` (see the narrowing above — `ActorDefinitionSchema` has nowhere to put
    // one), so asserting it here would be asserting a control that never renders.
    const riderSites: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["damageType", ["modifiers"]],         // the `extra-damage` rider — the mace's +1d6 lightning
      ["damageTypes", ["modifiers", "when"]] // the `damage-type-is` gate
    ];
    for (const type of carriers.filter((entry) => entry !== "monster")) {
      for (const [key, within] of riderSites) {
        expect(hasControl(type, key, within), `${type}: ${within.join(" > ")} > ${key}`).toBe(true);
      }
    }

    // ...and the value a control writes reaches the body the save path sends. Key existence is what
    // the census can see; a round trip is the other half, and neither substitutes for the other.
    const weapon = applyField("equipment", { name: "Mace of Storms" }, "weapon.damageType", "lightning");
    expect((storedBody("equipment", weapon, RECORD_ID).weapon as { damageType?: string }).damageType).toBe("lightning");
    // An open slug stays open all the way to the wire: a homebrew "void" type is the reason
    // `DamageTypeIdSchema` is a max-40 string and not an enum, and closing it would have been the
    // inverse of the bug the client reported.
    const homebrewType = authoredRow("equipment", ["actions", "damage"], [["formula", "1d6"], ["type", "void"]]);
    expect(homebrewType).toMatchObject({ formula: "1d6", type: "void" });
  });

  it("the census: every key a later unit needs and the editor cannot author today", () => {
    /**
     * **This list is scope, not decoration.** Each entry is a row the phase plan already owns; the
     * unit that ships the control deletes its line here in the same commit, and a control that
     * appears without a unit fails this test on the way in.
     *
     * Read with the standing warning in the header: this sees KEYS, and a key can be reachable
     * while a VALUE of it is not. `uses.scaling.type` was never on this list — the "Uses are"
     * select always wrote it — and `class-resource` was unauthorable all the same, for want of an
     * option. U7's own test is what caught that, and no row here could have.
     */
    const owed: ReadonlyArray<readonly [HomebrewType, string, readonly string[], string]> = [
      // [type, key, container path, the unit that closes it]
      ["equipment", "weapon.mastery", [], "U38 — 38 SRD weapons, gated on all eight slugs reaching"],
      ["monster", "multiattack", ["actions"], "U21 — 126 SRD records author it"],
      ["class", "extraPicks", [], "U13 — the extra-cantrip case that started the area, 8 SRD authors"],
      ["class", "replaces", [], "U14 — wired through a command, actor state, rests and a projection"],
      ["class", "widensPicks", [], "U17 — Bard row 55, Magical Secrets"],
      ["class", "fromPicks", [], "U16 — 3 records"],
      ["class", "maxSpellLevel", [], "U15 — 16 records; the schema half already ships in full"],
      ["class", "minSpellLevel", [], "U15 — 4 records, Warlock's Mystic Arcanum"]
    ];
    const stillOwed = owed.filter(([type, key, within]) => !hasControl(type, key, within));
    expect(stillOwed.map(([type, key, within]) => `${type}.${within.length > 0 ? `${within.join(".")}[].` : ""}${key}`))
      .toEqual(owed.map(([type, key, within]) => `${type}.${within.length > 0 ? `${within.join(".")}[].` : ""}${key}`));
  });
});
