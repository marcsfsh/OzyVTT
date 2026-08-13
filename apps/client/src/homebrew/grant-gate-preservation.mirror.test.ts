/**
 * **THE HOMEBREW EDITOR MUST NOT DELETE `grants.when`.**
 *
 * `FeatureGrantsSchema` gained one optional `when` on 2026-08-13 so that a grant the SRD prints
 * under a condition could be authored as printed instead of as an over-grant. `GrantsEditor`
 * rebuilds the whole grants bag from `GRANT_KINDS` on every keystroke, and `GRANT_KINDS` names the
 * eleven id lists and nothing else - so before this file existed, an ordinary edit to any grant row
 * DELETED the gate and turned "Immunity to Charmed and Frightened *while your Rage is active*" into
 * permanent immunity. The field that was added to end the over-grant reintroduced it through the
 * GM's own UI.
 *
 * It is reachable from SHIPPED content, in three gestures:
 *
 *   1. `/duplicate` `structuredClone`s `path-of-the-berserker` into an editable draft, and
 *      `rewriteForNewId` only rewrites ids - so `mindless-rage` arrives carrying its gate;
 *   2. the GM opens that feature and touches one grant row;
 *   3. `validateForPublish` parses the result through `FeatureGrantsSchema`, which accepts an
 *      UNGATED block perfectly happily, because an ungated block is what most records are.
 *
 * Nothing downstream would have refused it. So the far end below is the whole road, ending where
 * the table reads it: a level-6 Barbarian who is NOT raging must still be Frightenable.
 *
 * ## Why a `.mirror.test.ts` in the CLIENT workspace
 *
 * The defect is in a client function and the proof is a server outcome, so the test has to hold both
 * ends. `vitest.config.ts`'s `node` project exists for exactly that (see its comment), and
 * `vocabulary-parity.mirror.test.ts` already imports `RiderEditor` and the server's own modules side
 * by side. The editor half is driven through `grantRowsOf` / `grantsFromRows` - the component's OWN
 * read and write, not a parallel path (`GrantsEditor` has no `FieldDef` for a harness to look up).
 * The RENDERED gesture - a GM adding a value to a grant row with the mouse - is
 * `pick-fields.test.tsx`, which is where the DOM lives.
 *
 * **Not driven here: the HTTP router.** `POST /duplicate`, `PUT /content/:id` and `POST /publish`
 * carry the body through unchanged - the store, the validator and the copy helper below are the
 * three things on that road that touch it, and all three are the real functions.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema, type GameState } from "@vtt/domain";
import { EffectInstanceSchema, type ActorDefinition } from "@vtt/schemas";
import { FeatureGrantsSchema } from "@vtt/content-srd-5.2.1";
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
import { grantRowsOf, grantsFromRows, type GrantRow } from "./RiderEditor";

const HERO = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";
const SOURCE_ID = "path-of-the-berserker";
const GATE = [{ type: "while-effect-tag", tags: ["raging"] }] as const;

// -------------------------------------------------------------------------------------------------
// THE ENUMERATION: every key the schema accepts, against every key the rebuild emits.
// -------------------------------------------------------------------------------------------------

/**
 * A grants bag with EVERY key `FeatureGrantsSchema` accepts populated, parsed through the schema
 * itself rather than hand-listed - so a twelfth key added tomorrow is in this fixture the moment it
 * exists, and the partition below has to account for it.
 */
const EVERY_KEY = FeatureGrantsSchema.parse({
  skills: ["athletics"], expertise: ["athletics"], tools: ["thieves-tools"], languages: ["giant"],
  armor: ["heavy-armor"], weapons: ["martial-weapons"], saves: ["str"],
  damageResistances: ["fire"], damageImmunities: ["poison"], conditionImmunities: ["charmed"],
  spells: [{ id: "bless" }],
  when: GATE
}) as Record<string, unknown>;

describe("the partition: every key is either a row the GM edits or a key the editor carries", () => {
  /** What `grantRowsOf` offers as an editable row, in the order `GRANT_KINDS` declares them. */
  const editable = grantRowsOf(EVERY_KEY).map((row) => row.kind);
  /** Everything else the schema accepts - what a rebuild deletes unless it is carried across. */
  const carried = Object.keys(EVERY_KEY).filter((key) => !editable.includes(key));

  it("accounts for every key of `FeatureGrantsSchema` exactly once", () => {
    expect(editable).toEqual([
      "skills", "expertise", "tools", "languages", "armor", "weapons", "saves",
      "damageResistances", "damageImmunities", "conditionImmunities", "spells"
    ]);
    // THE ANSWER TO "IS `when` THE ONLY ONE": yes, today, and this line is what says so tomorrow. A
    // second dropped key would be the same bug wearing a different name, so a new schema key lands
    // here and fails until someone decides whether it gets a row or gets carried.
    expect(carried, "a key the editor neither edits nor carries is silently deleted by every edit").toEqual(["when"]);
    expect([...editable, ...carried].sort()).toEqual(Object.keys(FeatureGrantsSchema.shape).sort());
  });

  it("round-trips all twelve through the component's own read and write, losing none", () => {
    const rebuilt = grantsFromRows(grantRowsOf(EVERY_KEY), EVERY_KEY)!;
    expect(Object.keys(rebuilt).sort()).toEqual(Object.keys(EVERY_KEY).sort());
    expect(rebuilt.when).toEqual(EVERY_KEY.when);
  });
});

// -------------------------------------------------------------------------------------------------
// THE PAIR: a gate in, a row EDITED, the gate still there.
// -------------------------------------------------------------------------------------------------

/** `mindless-rage`'s block exactly as `subclasses.v1.json` ships it - raw, not schema-parsed, because
    raw is what `/duplicate` clones out of the bundle and what the editor is handed. */
const MINDLESS_RAGE_GRANTS = { conditionImmunities: ["charmed", "frightened"], when: GATE } as Record<string, unknown>;

describe("the editor's own read/write pair carries the gate across an edit", () => {
  it("reads the block as one row and hands the gate back untouched", () => {
    const rows = grantRowsOf(MINDLESS_RAGE_GRANTS);
    expect(rows).toEqual([{ rowId: "conditionImmunities", kind: "conditionImmunities", values: ["charmed", "frightened"] }]);

    // THE EDIT. One row touched, the way `GrantsEditor`'s `replace` touches it.
    const edited: GrantRow[] = rows.map((row) => ({ ...row, values: [...row.values, "paralyzed"] }));
    expect(grantsFromRows(edited, MINDLESS_RAGE_GRANTS)).toEqual({
      conditionImmunities: ["charmed", "frightened", "paralyzed"],
      when: GATE
    });
  });

  it("keeps the block alive on its gate alone when the last row is removed", () => {
    // Deliberate: a gate with no lists grants nothing, while dropping the gate on the way through
    // zero rows would leave the over-grant one "add a row" away.
    expect(grantsFromRows([], MINDLESS_RAGE_GRANTS)).toEqual({ when: GATE });
    expect(grantsFromRows([], {}), "an empty edit over an empty bag still writes no grants at all").toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// THE REACHABLE PATH: duplicate the Berserker, touch a row, publish, sit down at the table.
// -------------------------------------------------------------------------------------------------

const srdView = new ContentLibrary().forAudience("gm");

const directories: string[] = [];
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });

async function emptyStore() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-grant-gate-"));
  directories.push(directory);
  const store = new HomebrewStore(join(directory, "vtt.sqlite"));
  await store.initialize();
  return store;
}

type Body = Record<string, unknown>;
type Feature = Record<string, unknown>;

/** `POST /duplicate`, minus the router: the same two functions the route calls, in the same order. */
function duplicateBerserker() {
  const source = findCatalogRecord(srdView, SOURCE_ID)!;
  const copied = copyName(String((source.body as Body).name));
  const mintedId = mintHomebrewId(source.type, copied, () => false);
  return { id: mintedId, body: rewriteForNewId(source.type, { ...source.body, name: copied }, SOURCE_ID, mintedId) as unknown as Body };
}

/** The GM's gesture: open `mindless-rage` and add ONE condition to its condition-immunities row,
    through the component's own write. `preserve: false` is the control - the rebuild `GrantsEditor`
    used to do, reproduced by handing the write no memory of the body it is writing into. */
function touchOneGrantRow(body: Body, preserve = true): Body {
  const features = (body.features as Feature[]).map((feature) => {
    if (feature.id !== "mindless-rage") return feature;
    const grants = feature.grants as Body;
    const edited = grantRowsOf(grants)
      .map((row) => (row.kind === "conditionImmunities" ? { ...row, values: [...row.values, "paralyzed"] } : row));
    return { ...feature, grants: grantsFromRows(edited, preserve ? grants : {}) };
  });
  return { ...body, features };
}

/** `PUT /content/:id` then `POST /publish`: store the edited draft, validate it, promote it. */
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

/** A Halfling Berserker 6, on the duplicated subclass. Halfling because it is the one SRD species
    with no bonus, no modifier and no choice of its own, so nothing but the subclass is in play. */
const berserker = (subclassId: string): CharacterCreateRequestInput => ({
  name: "Ozar", speciesId: "halfling", backgroundId: "soldier", classId: "barbarian", level: 6,
  subclassId, abilityMethod: "standard-array",
  baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [{ ability: "str", amount: 2 }, { ability: "con", amount: 1 }],
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
} as unknown as CharacterCreateRequestInput);

/** The sheet on the table, seated by the SAME importer the roster uses - which is what copies a
    definition's baked `conditionImmunities` onto the actor, and therefore the only honest way to
    show what the control's over-grant costs. */
function tableWith(definition: ActorDefinition, catalog: ReturnType<typeof equipmentCatalogOf>): GameState {
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [] }) as GameState;
  importActorDefinition(state, definition, HERO, "public", catalog);
  return state;
}

/** Enter Rage as the shipped `rage` action does: one effect carrying the tag the gate reads. */
const rage = (state: GameState) => addEffect(state, HERO, EffectInstanceSchema.parse({
  id: "rage-1", name: "Rage", tags: ["raging"], duration: { type: "encounter" }
}));

const frighten = (state: GameState, definition: ActorDefinition, catalog: ReturnType<typeof equipmentCatalogOf>) =>
  setCondition(state, HERO, "frightened", true, undefined, { role: "gm" }, { resolveDefinition: () => definition, catalog });

describe("FAR END: the Berserker a GM duplicated, edited and published is still Frightenable", () => {
  it("carries the gate out of the SRD bundle and through `/duplicate` - the first two links", () => {
    const { body } = duplicateBerserker();
    const feature = (body.features as Feature[]).find((entry) => entry.id === "mindless-rage")!;
    // `toMatchObject`, not `toEqual`: the catalog hands back a PARSED record, so the ten lists the
    // Berserker does not use are present and empty - which is also why an edit here reads eleven
    // rows and rebuilds eleven keys, with `when` the only thing outside that rebuild.
    expect(feature.grants).toMatchObject({ conditionImmunities: ["charmed", "frightened"], when: GATE });
  });

  it("keeps it through the edit, the store and the publish gate, and the table agrees", async () => {
    const { id, body } = duplicateBerserker();
    const edited = touchOneGrantRow(body);
    const { validity, view } = await publish(edited, id);
    expect(validity, "a body the editor produced must publish - the gate is not what makes it invalid").toEqual({ valid: true, issues: [] });

    // The published record, read back through the merged catalog the builder actually consults.
    const published = view.featureRecord({ kind: "subclass", sourceId: id, id: "mindless-rage" })!;
    expect(published.grants).toMatchObject({
      conditionImmunities: ["charmed", "frightened", "paralyzed"],
      when: GATE
    });

    // THE FAR END, on a real sheet. The gate is `while-effect-tag: raging`, and this Barbarian is not.
    const definition = buildCharacterDefinition(berserker(id), view, BuilderPolicySchema.parse({}));
    const catalog = equipmentCatalogOf(view);
    expect(definition.conditionImmunities ?? [], "a gated grant must never be baked into the sheet").not.toContain("frightened");

    const calm = tableWith(definition, catalog);
    expect(frighten(calm, definition, catalog), "no refusal: the gate fails, so the condition lands").toEqual([]);
    expect(calm.actors[0].conditions.map((condition) => condition.id)).toEqual(["frightened"]);

    // ...and the immunity is REAL, not merely absent: the same sheet, one Rage later, refuses it.
    const raging = tableWith(definition, catalog);
    rage(raging);
    expect(frighten(raging, definition, catalog)[0]!.text).toBe("Ozar is immune to Frightened - not applied.");
    expect(raging.actors[0].conditions).toEqual([]);
    // The condition the GM ADDED in the edit is gated by the same one `when`, which is the whole
    // point of one gate over the block rather than one per list.
    expect(setCondition(raging, HERO, "paralyzed", true, undefined, { role: "gm" }, { resolveDefinition: () => definition, catalog })[0]!.text)
      .toBe("Ozar is immune to Paralyzed - not applied.");
  });

  it("CONTROL: the same road with the gate dropped makes that Barbarian permanently immune", async () => {
    // This is the shipped behaviour before this fix, reproduced exactly by passing an empty bag to
    // the write - the rebuild with no memory of the body it is writing into.
    const { id, body } = duplicateBerserker();
    const { validity, view } = await publish(touchOneGrantRow(body, false), id);
    expect(validity.valid, "nothing downstream refuses the over-grant - that is why the editor must not create it").toBe(true);
    expect((view.featureRecord({ kind: "subclass", sourceId: id, id: "mindless-rage" })!.grants as Body).when).toBeUndefined();

    const definition = buildCharacterDefinition(berserker(id), view, BuilderPolicySchema.parse({}));
    // Ungated, so the builder BAKES it: the immunity is now a fact about the sheet, and no Rage ends it.
    expect(definition.conditionImmunities ?? []).toContain("frightened");
    const catalog = equipmentCatalogOf(view);
    const calm = tableWith(definition, catalog);
    expect(frighten(calm, definition, catalog)[0]!.text).toBe("Ozar is immune to Frightened - not applied.");
    expect(calm.actors[0].conditions, "a level-6 Barbarian who is not raging, and cannot be Frightened ever again").toEqual([]);
  });
});
