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
 * Three rows are pinned this way today: **a saving-throw action that rolls typed damage** (123
 * monster actions), **a monster's to-hit bonus** (U10 — 423 monster actions, and until that unit the
 * shape could not be published at all), and **a two-band range** (U11 — 45 records, ending at the
 * long-range disadvantage die).
 *
 * ## The census, and the standing warning about what it does NOT prove
 *
 * `unauthorable` below is the harness's own honest output: every key a later unit needs and the
 * editor cannot author today. It is asserted as an EXACT set, so the unit that closes a row deletes
 * its line here in the same commit.
 *
 * **A key existing is not parity.** `uses.scaling.type` has a control (the "Uses are" select writes
 * it) and `class-resource` is still unauthorable, because the select has no such OPTION. Key
 * existence is what the census can see; value round-tripping is what tests 1–3 see. Both halves are
 * needed and neither substitutes for the other — that is the audit's §N3 finding restated as code.
 */

import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { HOMEBREW_BODY_SCHEMAS } from "@vtt/content-srd-5.2.1/schemas";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../../../server/src/action-resolution.js";
import { ContentLibrary } from "../../../server/src/content-library.js";
import { effectiveActions } from "../../../server/src/effective-actions.js";
import { startEncounter } from "../../../server/src/encounter.js";
import {
  applyField, authored, authoredRow, hasControl, publishVerdict, riderScopeOf, RIDER_EXEMPT, storedBody
} from "./authoring-harness";
import { SCHEMAS } from "./schemas";
import type { Draft } from "./schema";
import type { HomebrewType } from "./types";

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

/* ------------------------------------------------------------- the mechanism ----- */

describe("the guard itself refuses what the editor cannot author", () => {
  it("`choices` throws, naming the form — the canonical SRD-only row", () => {
    // The worked example the plan names: `choices` (plural) is read by `character-build.ts` and
    // authored by three feat records, and `FeatureEditor`'s choice panel is 651 lines of hand-written
    // JSX with ZERO `FieldDef`s — so the harness cannot see it, and says so instead of passing.
    // R1 + U12 delete this expectation; until then it is what stops a class unit shipping one-ended.
    expect(() => applyField("class", {}, "choices", [])).toThrow(
      'No field "choices" in the class form — the test is addressing a field that does not exist.'
    );
  });

  it("a row scope is looked up in the ROW's own fields, not the whole form's", () => {
    // The second face of the same hole. An effect row has no `modifiers` control today (U6 adds it);
    // a flat lookup would resolve it against the top-level `modifiersField` and wave the row through
    // — a false pass on the single highest-value row in the phase.
    expect(hasControl("equipment", "modifiers")).toBe(true);
    expect(hasControl("equipment", "modifiers", ["effects"])).toBe(false);
    expect(() => applyField("equipment", {}, "modifiers", [], ["effects"])).toThrow(
      'No field "modifiers" in the equipment form (effects row) — the test is addressing a field that does not exist.'
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
    for (const type of carriers) {
      for (const key of ["modifiers", "uses", "actions", "effects", "tags"]) {
        expect(hasControl(type, key), `${type}.${key}`).toBe(true);
      }
      expect(hasControl(type, "grants"), `${type}.grants`).toBe(false);
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

    const riderSites: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["type", ["actions", "damage"]],       // every action's damage parts
      ["damageType", ["modifiers"]],         // the `extra-damage` rider — the mace's +1d6 lightning
      ["damageTypes", ["modifiers", "when"]] // the `damage-type-is` gate
    ];
    const carriers = (Object.keys(SCHEMAS) as HomebrewType[]).filter((type) => riderScopeOf(type) !== null);
    for (const type of carriers) {
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
     * Read with the standing warning in the header: this sees KEYS. `uses.scaling.type` is absent
     * from the list because the "Uses are" select writes it — and `class-resource` is still
     * unauthorable, because that select has no such option. U7's test is what catches that.
     */
    const owed: ReadonlyArray<readonly [HomebrewType, string, readonly string[], string]> = [
      // [type, key, container path, the unit that closes it]
      ["equipment", "grants.spells", [], "U9 — 41 SRD records author an always-prepared spell"],
      ["equipment", "uses.scaling.id", [], "U7 — `class-resource`, 19 SRD features"],
      ["equipment", "uses.recharge", [], "U8 — `recharge`, 86 monster actions"],
      ["equipment", "weapon.mastery", [], "U38 — 38 SRD weapons, gated on all eight slugs reaching"],
      ["monster", "multiattack", ["actions"], "U21 — 126 SRD records author it"],
      ["equipment", "modifiers", ["effects"], "U6 — every GM-authored effect is mechanically empty"],
      ["class", "choices", [], "U12 (after R1) — 3 feat records, a hard compile error from twelve class modules"],
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
