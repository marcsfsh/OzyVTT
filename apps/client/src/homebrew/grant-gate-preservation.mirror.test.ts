/**
 * The homebrew editor must not delete `grants.when`. `GrantsEditor` rebuilds the grants bag from
 * `GRANT_KINDS` on every edit, so any key without a row must be carried through; otherwise editing a
 * duplicated Berserker's `mindless-rage` would turn "immune to Charmed and Frightened while raging"
 * into a permanent immunity, and `FeatureGrantsSchema` would accept the ungated block.
 *
 * The editor half uses `grantRowsOf`/`grantsFromRows` (the component's own read and write); the far
 * end is a level-6 Barbarian who is not raging and can still be frightened. The rendered gesture is
 * in `pick-fields.test.tsx`. The HTTP router is not driven; the store, validator and copy helper are
 * the real functions.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { EffectInstanceSchema, type ActorDefinition } from "@vtt/schemas";
import { FeatureGrantsFieldsSchema } from "@vtt/content-srd-5.2.1";
import { setCondition } from "../../../server/src/actor-conditions.js";
import { importActorDefinition } from "../../../server/src/actor-roster.js";
import { buildCharacterDefinition, type CharacterCreateRequestInput } from "../../../server/src/character-build.js";
import { ContentLibrary } from "../../../server/src/content-library.js";
import { addEffect } from "../../../server/src/effects.js";
import { equipmentCatalogOf } from "../../../server/src/equipment-derivation.js";
import { mintHomebrewId } from "../../../server/src/homebrew-ids.js";
import { copyName, HomebrewStore } from "../../../server/src/homebrew-store.js";
import { findCatalogRecord, rewriteForNewId } from "../../../server/src/homebrew-srd-copy.js";
import { validateForPublish } from "../../../server/src/homebrew-validate.js";
import { grantRowsOf, grantsFromRows, type GrantRow } from "./riders/GrantsEditor";

const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
const SOURCE_ID = "path-of-the-berserker";
const GATE = [{ type: "while-effect-tag", tags: ["raging"] }] as const;

// -------------------------------------------------------------------------------------------------
// Every key the schema accepts, against every key the rebuild emits.
// -------------------------------------------------------------------------------------------------

/** A grants bag with every key populated, parsed through the schema so a new key appears here
    automatically. Uses `FeatureGrantsFieldsSchema`, which lacks the cross-field refusal of `spells`
    beside `when`, so every key can be held at once. */
const EVERY_KEY = FeatureGrantsFieldsSchema.parse({
  skills: ["athletics"],
  expertise: ["athletics"],
  tools: ["thieves-tools"],
  languages: ["giant"],
  armor: ["heavy-armor"],
  weapons: ["martial-weapons"],
  saves: ["str"],
  damageResistances: ["fire"],
  damageImmunities: ["poison"],
  conditionImmunities: ["charmed"],
  spells: [{ id: "bless" }],
  when: GATE
}) as Record<string, unknown>;

describe("the partition: every key is either a row the GM edits or a key the editor carries", () => {
  /** What `grantRowsOf` offers as editable rows, in `GRANT_KINDS` order. */
  const editable = grantRowsOf(EVERY_KEY).map((row) => row.kind);
  /** Every other accepted key: deleted by a rebuild unless carried. */
  const carried = Object.keys(EVERY_KEY).filter((key) => !editable.includes(key));

  it("accounts for every key of the grants vocabulary exactly once", () => {
    expect(editable).toEqual([
      "skills",
      "expertise",
      "tools",
      "languages",
      "armor",
      "weapons",
      "saves",
      "damageResistances",
      "damageImmunities",
      "conditionImmunities",
      "spells"
    ]);
    // A new schema key fails here until it gets a row or is carried.
    expect(carried, "a key the editor neither edits nor carries is silently deleted by every edit").toEqual(["when"]);
    expect([...editable, ...carried].sort()).toEqual(Object.keys(FeatureGrantsFieldsSchema.shape).sort());
  });

  it("round-trips all twelve through the component's own read and write, losing none", () => {
    const rebuilt = grantsFromRows(grantRowsOf(EVERY_KEY), EVERY_KEY)!;
    expect(Object.keys(rebuilt).sort()).toEqual(Object.keys(EVERY_KEY).sort());
    expect(rebuilt.when).toEqual(EVERY_KEY.when);
  });
});

// -------------------------------------------------------------------------------------------------
// A gate in, a row edited, the gate still there.
// -------------------------------------------------------------------------------------------------

/** `mindless-rage`'s block raw from `subclasses.v1.json`, as `/duplicate` clones it. */
const MINDLESS_RAGE_GRANTS = { conditionImmunities: ["charmed", "frightened"], when: GATE } as Record<string, unknown>;

describe("the editor's own read/write pair carries the gate across an edit", () => {
  it("reads the block as one row and hands the gate back untouched", () => {
    const rows = grantRowsOf(MINDLESS_RAGE_GRANTS);
    expect(rows).toEqual([
      { rowId: "conditionImmunities", kind: "conditionImmunities", values: ["charmed", "frightened"] }
    ]);

    // One row edited, as `GrantsEditor`'s `replace` does it.
    const edited: GrantRow[] = rows.map((row) => ({ ...row, values: [...row.values, "paralyzed"] }));
    expect(grantsFromRows(edited, MINDLESS_RAGE_GRANTS)).toEqual({
      conditionImmunities: ["charmed", "frightened", "paralyzed"],
      when: GATE
    });
  });

  it("keeps the block alive on its gate alone when the last row is removed", () => {
    // A gate with no lists grants nothing; dropping it here would leave the over-grant one row away.
    expect(grantsFromRows([], MINDLESS_RAGE_GRANTS)).toEqual({ when: GATE });
    expect(grantsFromRows([], {}), "an empty edit over an empty bag still writes no grants at all").toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// The reachable path: duplicate the Berserker, edit a row, publish, play.
// -------------------------------------------------------------------------------------------------

const srdView = new ContentLibrary().forAudience("gm");

const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});

async function emptyStore() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-grant-gate-"));
  directories.push(directory);
  const store = new HomebrewStore(join(directory, "vtt.sqlite"));
  await store.initialize();
  return store;
}

type Body = Record<string, unknown>;
type Feature = Record<string, unknown>;

/** `POST /duplicate` without the router: the same two functions the route calls, in order. */
function duplicateBerserker() {
  const source = findCatalogRecord(srdView, SOURCE_ID)!;
  const copied = copyName(String((source.body as Body).name));
  const mintedId = mintHomebrewId(source.type, copied, () => false);
  return {
    id: mintedId,
    body: rewriteForNewId(source.type, { ...source.body, name: copied }, SOURCE_ID, mintedId) as unknown as Body
  };
}

/** Adds one condition to `mindless-rage`'s condition-immunities row through the component's write.
    `preserve: false` is the control: the write is given no memory of the existing bag. */
function touchOneGrantRow(body: Body, preserve = true): Body {
  const features = (body.features as Feature[]).map((feature) => {
    if (feature.id !== "mindless-rage") return feature;
    const grants = feature.grants as Body;
    const edited = grantRowsOf(grants).map((row) =>
      row.kind === "conditionImmunities" ? { ...row, values: [...row.values, "paralyzed"] } : row
    );
    return { ...feature, grants: grantsFromRows(edited, preserve ? grants : {}) };
  });
  return { ...body, features };
}

/** `PUT /content/:id` then `POST /publish`: store, validate, promote. */
async function publish(body: Body, id: string) {
  const store = await emptyStore();
  store.importRecord(id, "subclass", body as never, false, "homebrew:duplicate");
  const merged = new ContentLibrary(store);
  const validity = validateForPublish("subclass", store.get(id)!.body, {
    catalog: merged.forAudience("gm"),
    spellLists: store.publishedFor("gm").spellLists,
    authored: store.authoredIndex()
  });
  store.setState(id, "published", undefined);
  return { store, validity, view: merged.forAudience("gm") };
}

/** A Halfling Berserker 6 on the duplicated subclass; Halfling adds no bonus, modifier or choice. */
const berserker = (subclassId: string): CharacterCreateRequestInput =>
  ({
    name: "Ozar",
    speciesId: "halfling",
    backgroundId: "soldier",
    classId: "barbarian",
    level: 6,
    subclassId,
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
      { level: 3, classId: "barbarian", kind: "skill", id: "nature" },
      { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "greataxe" },
      { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "handaxe" },
      { level: 1, classId: "barbarian", kind: "weapon-mastery", id: "javelin" },
      { level: 3, classId: "barbarian", kind: "subclass", id: subclassId },
      { level: 4, classId: "barbarian", kind: "asi-or-feat", id: "ability-score-improvement" },
      { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
      { level: 4, kind: "ability-score", id: "str", payload: { featureId: "ability-score-improvement" } },
      { level: 1, kind: "tool", id: "gaming-set-dice" },
      { level: 1, kind: "equipment", id: "barbarian-a" },
      { level: 1, kind: "equipment", id: "soldier-a" }
    ]
  }) as unknown as CharacterCreateRequestInput;

/** The sheet seated by the roster's own importer, which copies baked `conditionImmunities` onto the actor. */
function tableWith(definition: ActorDefinition, catalog: ReturnType<typeof equipmentCatalogOf>): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [] }) as GameState;
  importActorDefinition(state, definition, HERO, "public", catalog);
  return state;
}

/** Enters Rage as the shipped `rage` action does: one effect with the tag the gate reads. */
const rage = (state: GameState) =>
  addEffect(
    state,
    HERO,
    EffectInstanceSchema.parse({
      id: "rage-1",
      name: "Rage",
      tags: ["raging"],
      duration: { type: "encounter" }
    })
  );

const frighten = (state: GameState, definition: ActorDefinition, catalog: ReturnType<typeof equipmentCatalogOf>) =>
  setCondition(
    state,
    HERO,
    "frightened",
    true,
    undefined,
    { role: "gm" },
    { resolveDefinition: () => definition, catalog }
  );

describe("FAR END: the Berserker a GM duplicated, edited and published is still Frightenable", () => {
  it("carries the gate out of the SRD bundle and through `/duplicate` - the first two links", () => {
    const { body } = duplicateBerserker();
    const feature = (body.features as Feature[]).find((entry) => entry.id === "mindless-rage")!;
    // `toMatchObject`: the parsed record has the unused lists present and empty.
    expect(feature.grants).toMatchObject({ conditionImmunities: ["charmed", "frightened"], when: GATE });
  });

  it("keeps it through the edit, the store and the publish gate, and the table agrees", async () => {
    const { id, body } = duplicateBerserker();
    const edited = touchOneGrantRow(body);
    const { validity, view } = await publish(edited, id);
    expect(validity, "a body the editor produced must publish - the gate is not what makes it invalid").toEqual({
      valid: true,
      issues: [],
      warnings: []
    });

    // Read back through the merged catalog the builder consults.
    const published = view.featureRecord({ kind: "subclass", sourceId: id, id: "mindless-rage" })!;
    expect(published.grants).toMatchObject({
      conditionImmunities: ["charmed", "frightened", "paralyzed"],
      when: GATE
    });

    // The gate is `while-effect-tag: raging`, and this Barbarian is not raging.
    const definition = buildCharacterDefinition(berserker(id), view, BuilderPolicySchema.parse({}));
    const catalog = equipmentCatalogOf(view);
    expect(definition.conditionImmunities ?? [], "a gated grant must never be baked into the sheet").not.toContain(
      "frightened"
    );

    const calm = tableWith(definition, catalog);
    expect(frighten(calm, definition, catalog), "no refusal: the gate fails, so the condition lands").toEqual([]);
    expect(calm.actors[0].conditions.map((condition) => condition.id)).toEqual(["frightened"]);

    // The immunity is real: the same sheet refuses the condition once raging.
    const raging = tableWith(definition, catalog);
    rage(raging);
    expect(frighten(raging, definition, catalog)[0]!.text).toBe("Ozar is immune to Frightened - not applied.");
    expect(raging.actors[0].conditions).toEqual([]);
    // The condition added in the edit is gated by the same `when`.
    expect(
      setCondition(
        raging,
        HERO,
        "paralyzed",
        true,
        undefined,
        { role: "gm" },
        { resolveDefinition: () => definition, catalog }
      )[0]!.text
    ).toBe("Ozar is immune to Paralyzed - not applied.");
  });

  it("CONTROL: the same road with the gate dropped makes that Barbarian permanently immune", async () => {
    // Reproduces the bug by giving the write an empty bag.
    const { id, body } = duplicateBerserker();
    const { validity, view } = await publish(touchOneGrantRow(body, false), id);
    expect(
      validity.valid,
      "nothing downstream refuses the over-grant - that is why the editor must not create it"
    ).toBe(true);
    expect(
      (view.featureRecord({ kind: "subclass", sourceId: id, id: "mindless-rage" })!.grants as Body).when
    ).toBeUndefined();

    const definition = buildCharacterDefinition(berserker(id), view, BuilderPolicySchema.parse({}));
    // Ungated, so the builder bakes the immunity into the sheet.
    expect(definition.conditionImmunities ?? []).toContain("frightened");
    const catalog = equipmentCatalogOf(view);
    const calm = tableWith(definition, catalog);
    expect(frighten(calm, definition, catalog)[0]!.text).toBe("Ozar is immune to Frightened - not applied.");
    expect(
      calm.actors[0].conditions,
      "a level-6 Barbarian who is not raging, and cannot be Frightened ever again"
    ).toEqual([]);
  });
});
