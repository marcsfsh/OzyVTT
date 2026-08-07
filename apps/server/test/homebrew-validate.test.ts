import { describe, expect, it } from "vitest";
import type { HomebrewContentType } from "@vtt/api-contract";
import { SpellListReferenceSchema, SubclassReferenceSchema, loadClasses, loadSpells, type SpellListReference } from "@vtt/content-srd-5.2.1";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { ContentLibrary, type ContentAudience, type HomebrewCatalogSlice, type HomebrewContentSource } from "../src/content-library.js";
import { EMPTY_AUTHORED_INDEX, type HomebrewAuthoredIndex } from "../src/homebrew-store.js";
import { findCatalogRecord, rewriteForNewId } from "../src/homebrew-srd-copy.js";
import { validateForPublish, type HomebrewValidationContext } from "../src/homebrew-validate.js";

/**
 * The publish gate.
 *
 * Every case below is a way a homebrew record can be wrong that the rest of the stack accepts and
 * then fails on SILENTLY - or, worse, loudly but at the wrong moment: in front of a player who
 * cannot finish a character rather than in front of the GM who made the mistake. Each test names the
 * downstream failure it prevents, because that is the only thing that justifies the check.
 */

const LEVEL_TABLE = Array.from({ length: 20 }, (_, index) => ({ level: index + 1, proficiencyBonus: 2 + Math.floor(index / 4) }));

const classBody = (overrides: Record<string, unknown> = {}) => ({
  id: "hb-blood-hunter-a1b2c3", name: "Blood Hunter", source: "homebrew",
  hitDie: "d10", statPriority: ["str", "con", "dex", "wis", "int", "cha"], primaryAbilities: ["str"],
  savingThrows: ["str", "con"], skillChoices: { choose: 2, from: ["athletics", "perception"] },
  subclassLevel: 3, levelTable: LEVEL_TABLE, ...overrides
});

/** Rows the GM has AUTHORED but not necessarily published - what breaks the publish deadlock. */
type Authored = Readonly<{ type: HomebrewContentType; id: string; classId?: string }>;
const authoredWith = (rows: readonly Authored[]): HomebrewAuthoredIndex => ({
  has: (type, id) => rows.some((row) => row.type === type && row.id === id),
  subclassIdsFor: (classId) => new Set(rows.filter((row) => row.type === "subclass" && row.classId === classId).map((row) => row.id))
});

/** A library whose GM slice carries `slice`, so cross-record checks resolve against real merged content. */
function contextWith(slice: Partial<HomebrewCatalogSlice> = {}, authored: HomebrewAuthoredIndex = EMPTY_AUTHORED_INDEX): HomebrewValidationContext {
  const full: HomebrewCatalogSlice = {
    classes: [], subclasses: [], species: [], backgrounds: [], feats: [],
    spells: [], equipment: [], monsters: [], spellLists: [], ...slice
  };
  const source: HomebrewContentSource = {
    revision: 1,
    publishedFor: (audience: ContentAudience) => audience === "gm" ? full : { ...full, classes: [], spells: [], spellLists: [] },
    monsterForInstance: () => undefined
  };
  return { catalog: new ContentLibrary(source).forAudience("gm"), spellLists: full.spellLists, authored };
}

const messages = (validity: { issues: ReadonlyArray<{ message: string }> }) => validity.issues.map((issue) => issue.message).join(" | ");

describe("tier 1 - the record's own schema", () => {
  it("reports the offending FIELD, not just a refusal", () => {
    const validity = validateForPublish("class", { id: "hb-half-formed-a1b2c3", name: "Half-Formed" }, contextWith());
    expect(validity.valid).toBe(false);
    // Machine-addressable so a form editor can point at the input rather than parse prose.
    expect(validity.issues.map((issue) => issue.path[0])).toContain("hitDie");
    expect(validity.issues.every((issue) => issue.recordId === null)).toBe(true);
  });

  it("passes a complete record and says so with no issues at all", () => {
    expect(validateForPublish("class", classBody(), contextWith())).toEqual({ valid: true, issues: [] });
  });

  it("stops after a schema failure rather than piling cross-reference noise on top", () => {
    const validity = validateForPublish("subclass", { id: "hb-x-a1b2c3", name: "X" }, contextWith());
    expect(validity.issues.every((issue) => issue.path[0] === "classId")).toBe(true);
    expect(messages(validity)).not.toContain("Publish the class");
  });

  /**
   * **The server end of the "homebrew items cannot be published" repair.**
   *
   * The client half — every one of the eleven reported authoring paths, driven through the real
   * editor machinery — lives in `apps/client/src/homebrew/publish-paths.test.ts`, and it runs
   * `HOMEBREW_BODY_SCHEMAS`, the same map tier 1 uses. These two cases pin the far end from here:
   * the exact bodies the repaired editor now produces are bodies this gate accepts, so the client's
   * green checklist and the server's answer cannot be about different things.
   */
  it("accepts a melee weapon whose ranges are null - the flagship authoring path", () => {
    const mace = {
      id: "hb-club-of-ruin-a1b2c3", name: "Club of Ruin", source: "homebrew",
      category: "weapon", costGp: 0, weightLb: 0, description: null,
      // Null ranges ARE a melee weapon: every SRD melee row carries exactly this shape. The report
      // was that a GM had to type a number into "Range" to get past this check.
      weapon: { category: "simple", damageDice: "1d6", damageType: "bludgeoning", rangeFeet: null, longRangeFeet: null }
    };
    expect(validateForPublish("equipment", mace, contextWith())).toEqual({ valid: true, issues: [] });
  });

  it("accepts armour seeded from one touched control, and an item with the optional enums absent", () => {
    const shape = (extra: Record<string, unknown>) => ({
      id: "hb-thing-a1b2c3", name: "Thing", source: "homebrew", category: "armor", costGp: 0, weightLb: 0, description: "A thing.", ...extra
    });
    // Three of the five armour keys are required with honest empties; touching "Adds Dexterity"
    // used to leave them missing and the GM got `dexModifierCap: Required`.
    expect(validateForPublish("equipment", shape({
      armor: { acBase: 14, addDexModifier: true, dexModifierCap: null, stealthDisadvantage: false, strengthRequired: null }
    }), contextWith()).valid).toBe(true);
    // `slot` and `rarity` are `.optional()`: ABSENT is right, `null` is a refusal. Returning either
    // select to "Not set" used to write the null.
    expect(validateForPublish("equipment", shape({}), contextWith()).valid).toBe(true);
    expect(validateForPublish("equipment", shape({ slot: null }), contextWith()).valid).toBe(false);
  });
});

describe("tier 2 - identity", () => {
  it("refuses an id that would brick campaign load on the next boot", () => {
    // > 60 characters passes `ContentIdSchema` (which allows 80) and then fails `GameStateSchema.parse`
    // once it has been written into a persisted ActorDefinition.
    const validity = validateForPublish("class", classBody({ id: `hb-${"a".repeat(70)}` }), contextWith());
    expect(validity.valid).toBe(false);
    expect(messages(validity)).toMatch(/60/);
  });

  it("refuses an id outside the reserved homebrew namespace", () => {
    expect(validateForPublish("class", classBody({ id: "blood-hunter" }), contextWith()).valid).toBe(false);
  });
});

describe("tier 3 - cross-record references", () => {
  it("refuses a subclass whose class does not exist at all - a typo that would strand it forever", () => {
    const validity = validateForPublish("subclass", { id: "hb-mutant-a1b2c3", name: "Mutant", source: "homebrew", classId: "hb-nothing-000000" }, contextWith());
    expect(messages(validity)).toContain(`No class "hb-nothing-000000" exists`);
    expect(validateForPublish("subclass", { id: "hb-mutant-a1b2c3", name: "Mutant", source: "homebrew", classId: "wizard" }, contextWith()).valid).toBe(true);
  });
});

/**
 * THE DEADLOCK, from both ends.
 *
 * A class asked for a PUBLISHED subclass and a subclass asked for a PUBLISHED class, so neither
 * could ever go first and a homebrew class could not be published at all - the headline feature,
 * unusable by any sequence of GM actions that did not involve hand-editing a `fromCatalog` slug.
 * Both rules now read AUTHORSHIP: a record that exists satisfies them, whatever state it is in.
 */
describe("a class and its subclass publish in either order", () => {
  const subclassPick = {
    features: [{ id: "archetype", name: "Martial Archetype", description: "x", choice: { kind: "subclass", choose: 1, fromCatalog: "hb-blood-hunter-a1b2c3-subclasses" } }],
    levelTable: LEVEL_TABLE.map((row) => row.level === 3 ? { ...row, features: ["archetype"] } : row)
  };
  const mutant = { id: "hb-mutant-a1b2c3", name: "Mutant", source: "homebrew", classId: "hb-blood-hunter-a1b2c3" };

  it("publishes the CLASS first, on the strength of a subclass that is still a draft", () => {
    const drafted = authoredWith([{ type: "subclass", id: "hb-mutant-a1b2c3", classId: "hb-blood-hunter-a1b2c3" }]);
    expect(validateForPublish("class", classBody(subclassPick), contextWith({}, drafted))).toEqual({ valid: true, issues: [] });
    // With nothing naming it, the refusal survives - and says the subclass need not be published.
    const alone = validateForPublish("class", classBody(subclassPick), contextWith());
    expect(alone.valid).toBe(false);
    expect(messages(alone)).toContain("it does not have to be published, it only has to exist");
  });

  it("publishes the SUBCLASS first, on the strength of a class that is still a draft", () => {
    const drafted = authoredWith([{ type: "class", id: "hb-blood-hunter-a1b2c3" }]);
    expect(validateForPublish("subclass", mutant, contextWith({}, drafted))).toEqual({ valid: true, issues: [] });
  });

  it("counts a published subclass and a drafted one once each, never twice", () => {
    // The published copy is in BOTH the catalog and the authorship index; a naive sum would double
    // it and mask a class that really has too few options for a `choose: 2` pick.
    const published = SubclassReferenceSchema.parse(mutant);
    const both = contextWith({ subclasses: [published] }, authoredWith([{ type: "subclass", id: "hb-mutant-a1b2c3", classId: "hb-blood-hunter-a1b2c3" }]));
    const twoPicks = validateForPublish("class", classBody({
      ...subclassPick,
      features: [{ ...subclassPick.features[0], choice: { kind: "subclass", choose: 2, fromCatalog: "hb-blood-hunter-a1b2c3-subclasses" } }]
    }), both);
    expect(messages(twoPicks)).toContain("asks for 2 distinct pick(s) but offers only 1");
  });

  it("still wants the class published first for a CASTER subclass, which is an order and not a deadlock", () => {
    // The third-caster check needs the class's level table, which only a published class has here.
    // The class side waits for nothing now, so this order is always reachable.
    const caster = { ...mutant, spellcasting: { ability: "int", prepares: "prepared", spellListId: "wizard" } };
    const drafted = authoredWith([{ type: "class", id: "hb-blood-hunter-a1b2c3" }]);
    expect(messages(validateForPublish("subclass", caster, contextWith({}, drafted)))).toContain("Publish the class first");
  });
});

describe("tier 3 - cross-record references, continued", () => {
  it("refuses a background whose origin feat does not resolve - today that rejects seven wizard steps in", () => {
    const validity = validateForPublish("background", { id: "hb-hermit-a1b2c3", name: "Hermit", source: "homebrew", originFeatId: "hb-nothing-000000" }, contextWith());
    expect(messages(validity)).toContain("Publish the origin feat");
  });

  it("refuses a typo'd fromCatalog slug - the pick would otherwise silently DISAPPEAR", () => {
    // At build time an unresolvable slug is swallowed into `unresolvable` on both sides and the pick
    // vanishes while the build succeeds. Right for partial SRD content, wrong for the GM's own typo.
    const validity = validateForPublish("class", classBody({
      features: [{ id: "expertize", name: "Expertize", description: "x", choice: { kind: "skill", choose: 2, fromCatalog: "skillz" } }],
      levelTable: LEVEL_TABLE.map((row) => row.level === 2 ? { ...row, features: ["expertize"] } : row)
    }), contextWith());
    expect(messages(validity)).toContain("resolves to nothing");
  });

  it("refuses a starting-equipment id that resolves to nothing - it grants no attack and no AC, silently", () => {
    const validity = validateForPublish("class", classBody({
      startingEquipment: [{ id: "a", label: "A", items: [{ id: "moonblade", name: "Moonblade" }] }]
    }), contextWith());
    expect(messages(validity)).toContain("would grant nothing");
    // The same option pointing at a real catalog id is fine.
    expect(validateForPublish("class", classBody({
      startingEquipment: [{ id: "a", label: "A", items: [{ id: "longsword", name: "Longsword" }] }]
    }), contextWith()).valid).toBe(true);
  });

  it("refuses a choice that offers fewer distinct options than it demands", () => {
    // The build-time completeness check is EXACT equality, never "at most", so this is uncompletable.
    const validity = validateForPublish("class", classBody({
      features: [{ id: "style", name: "Style", description: "x", choice: { kind: "fighting-style", choose: 3, from: ["a", "b"] } }],
      levelTable: LEVEL_TABLE.map((row) => row.level === 1 ? { ...row, features: ["style"] } : row)
    }), contextWith());
    expect(messages(validity)).toContain("asks for 3 distinct pick(s) but offers only 2");
  });

  it("refuses a choice-bearing feature that no level row grants - the wizard offers a pick the build cannot match", () => {
    // CAPACITY DIVERGENCE, and it was the editor's default shape. `grantedAtLevels` reaches the wire
    // empty, the wizard reads that as "granted once" and OFFERS the pick (blocking Create until it
    // is answered), and `character-build.ts` builds its offers from the LEVEL TABLE alone - so the
    // character fails Create with `No feature "..." offers a "skill" choice` and can never be made.
    const validity = validateForPublish("class", classBody({
      features: [{ id: "orphan", name: "Orphaned Talent", description: "x", choice: { kind: "skill", choose: 1, fromCatalog: "skills" } }]
    }), contextWith());
    expect(validity.valid).toBe(false);
    expect(messages(validity)).toContain("no level in the table grants it");
    // The named fix works: put the feature in the table and it publishes.
    expect(validateForPublish("class", classBody({
      features: [{ id: "orphan", name: "Orphaned Talent", description: "x", choice: { kind: "skill", choose: 1, fromCatalog: "skills" } }],
      levelTable: LEVEL_TABLE.map((row) => row.level === 2 ? { ...row, features: ["orphan"] } : row)
    }), contextWith()).valid).toBe(true);
  });

  it("leaves a plain ungranted feature alone - it is dead display text, not an uncreatable character", () => {
    expect(validateForPublish("class", classBody({
      features: [{ id: "flavour", name: "Flavour", description: "Never granted, asks nothing." }]
    }), contextWith()).valid).toBe(true);
  });

  it("counts a repeated grant against capacity, and exempts a repeatable choice", () => {
    const repeatedAtThreeLevels = (repeatable: boolean) => validateForPublish("class", classBody({
      features: [{ id: "boon", name: "Boon", description: "x", choice: { kind: "boon", choose: 1, from: ["a", "b"], repeatable } }],
      levelTable: LEVEL_TABLE.map((row) => [2, 6, 10].includes(row.level) ? { ...row, features: ["boon"] } : row)
    }), contextWith());
    expect(messages(repeatedAtThreeLevels(false))).toContain("asks for 3 distinct pick(s) but offers only 2");
    expect(repeatedAtThreeLevels(true).valid).toBe(true);
  });

  it("refuses a lineage pick whose kind is not the literal string \"lineage\"", () => {
    // Any other kind validates, records the pick, and then silently never grants the lineage's traits.
    const species = (kind: string) => ({
      id: "hb-gith-a1b2c3", name: "Gith", source: "homebrew", speedFeet: 30,
      lineages: [{ id: "yanki", name: "Yanki" }, { id: "zerai", name: "Zerai" }],
      traits: [{ id: "heritage", name: "Heritage", description: "x", choice: { kind, choose: 1, fromCatalog: "hb-gith-a1b2c3-lineages" } }]
    });
    expect(messages(validateForPublish("species", species("subrace"), contextWith()))).toContain("silently never granted");
    expect(validateForPublish("species", species("lineage"), contextWith()).valid).toBe(true);
  });

  it("refuses a choice authored on a LINEAGE trait, which the catalog flattens with no lineage tag", () => {
    const validity = validateForPublish("species", {
      id: "hb-gith-a1b2c3", name: "Gith", source: "homebrew", speedFeet: 30,
      lineages: [{ id: "yanki", name: "Yanki", traits: [{ id: "psi", name: "Psi", description: "x", choice: { kind: "cantrip", choose: 1, from: ["mage-hand"] } }] }]
    }, contextWith());
    expect(messages(validity)).toContain("Lineage traits cannot carry choices yet");
  });

  it("refuses a monster with no challenge rating or creature type - the picker would show \"CR 0 unknown\"", () => {
    const monster = (extensions: Record<string, unknown>) => ({
      id: "hb-m-4f19c8b02de7", schemaId: "vtt.actor-monster", schemaVersion: 1,
      source: { name: "Homebrew", version: "1", externalId: "hb-m-4f19c8b02de7" },
      name: "Bone Colossus", size: "large",
      abilityScores: { str: 18, dex: 10, con: 16, int: 6, wis: 10, cha: 6 },
      proficiencyBonus: 3, armorClass: 15, hitPoints: { maximum: 90 }, speedFeet: 30, extensions
    });
    expect(messages(validateForPublish("monster", monster({}), contextWith()))).toMatch(/challenge rating/);
    expect(validateForPublish("monster", monster({ "open5e.srd-2024": { challengeRating: 5, type: "undead" } }), contextWith()).valid).toBe(true);
  });

  it("reads the SAME extension bag the bestiary reads, so nothing it passes can list as \"CR 0 - unknown\"", () => {
    // The guard used to prefer `vtt.statblock`, a key no consumer has ever read: a creature carrying
    // only that bag published clean and then listed as exactly the "CR 0 - unknown" the guard claims
    // to prevent. The assertion is the INVARIANT rather than the key - if the guard passes it, the
    // list must be able to show it - so re-keying either side without the other fails here.
    const monster = (bag: string) => ({
      id: "hb-m-4f19c8b02de7", schemaId: "vtt.actor-monster", schemaVersion: 1,
      source: { name: "Homebrew", version: "1", externalId: "hb-m-4f19c8b02de7" },
      name: "Bone Colossus", size: "large",
      abilityScores: { str: 18, dex: 10, con: 16, int: 6, wis: 10, cha: 6 },
      proficiencyBonus: 3, armorClass: 15, hitPoints: { maximum: 90 }, speedFeet: 30,
      extensions: { [bag]: { challengeRating: 5, type: "undead" } }
    });
    let passed = 0;
    for (const bag of ["vtt.statblock", "open5e.srd-2024"]) {
      const body = monster(bag);
      if (!validateForPublish("monster", body, contextWith()).valid) continue;
      passed += 1;
      const listed = contextWith({ monsters: [ActorDefinitionSchema.parse(body)] })
        .catalog.monsterSummaries().find((row) => row.id === "hb-m-4f19c8b02de7")!;
      expect(listed.challengeRating, `${bag} passed the gate and then listed as CR ${listed.challengeRating}`).toBe(5);
      expect(listed.type, `${bag} passed the gate and then listed as "${listed.type}"`).toBe("undead");
    }
    // And the guard is not simply refusing everything.
    expect(passed).toBe(1);
  });

  it("refuses a monster whose content id disagrees with its record id - its live tokens would resolve to nothing", () => {
    const validity = validateForPublish("monster", {
      id: "hb-m-4f19c8b02de7", schemaId: "vtt.actor-monster", schemaVersion: 1,
      source: { name: "Homebrew", version: "1", externalId: "hb-m-deadbeef0000" },
      name: "Bone Colossus", size: "large",
      abilityScores: { str: 18, dex: 10, con: 16, int: 6, wis: 10, cha: 6 },
      proficiencyBonus: 3, armorClass: 15, hitPoints: { maximum: 90 }, speedFeet: 30,
      extensions: { "vtt.statblock": { challengeRating: 5, type: "undead" } }
    }, contextWith());
    expect(messages(validity)).toContain("disagrees with its record id");
  });
});

describe("spell lists - the empty list is the failure that matters", () => {
  const listBody = (overrides: Record<string, unknown> = {}) => ({ id: "hb-necro-a1b2c3", name: "Necromancer List", source: "homebrew", ...overrides });

  it("refuses an EMPTY list at publish, because downstream it is a hard character.create rejection", () => {
    // `resolveCatalogChoice` refuses to return an empty option list and the server turns that into a
    // build rejection - so the GM must hear this from the publish button, not a player from the wizard.
    const validity = validateForPublish("spell-list", listBody(), contextWith());
    expect(validity.valid).toBe(false);
    expect(messages(validity)).toContain("cannot be created at all");
  });

  it("accepts a list that draws real spells, by id or by basing on an existing list", () => {
    expect(validateForPublish("spell-list", listBody({ add: ["fireball"] }), contextWith()).valid).toBe(true);
    expect(validateForPublish("spell-list", listBody({ basedOn: ["wizard"] }), contextWith()).valid).toBe(true);
    // An `add` naming no real spell adds nothing, so the list is still empty.
    expect(validateForPublish("spell-list", listBody({ add: ["nonexistent-spell"] }), contextWith()).valid).toBe(false);
  });

  it("refuses a basedOn cycle, which would otherwise be ignored in silence", () => {
    const peer: SpellListReference = SpellListReferenceSchema.parse({ id: "hb-peer-a1b2c3", name: "Peer", source: "homebrew", basedOn: ["hb-necro-a1b2c3"], add: ["fireball"] });
    const validity = validateForPublish("spell-list", listBody({ basedOn: ["hb-peer-a1b2c3"] }), contextWith({ spellLists: [peer] }));
    expect(messages(validity)).toContain("loops back to itself");
  });

  it("refuses a caster that names no list at all - the builder would look for one named after the class", () => {
    const validity = validateForPublish("class", classBody({ spellcasting: { ability: "int", prepares: "prepared" } }), contextWith());
    expect(messages(validity)).toContain("names no spell list");
  });

  it("refuses a caster pointed at a list with no spells, and accepts one pointed at a real list", () => {
    const casting = (spellListId: string) => classBody({ spellcasting: { ability: "int", prepares: "prepared", spellListId } });
    expect(messages(validateForPublish("class", casting("hb-empty-a1b2c3"), contextWith()))).toContain("could not be created at all");
    // The SRD wizard list resolves, so a homebrew class drawing from it publishes cleanly.
    expect(validateForPublish("class", casting("wizard"), contextWith()).valid).toBe(true);
  });

  it("resolves a caster against a PUBLISHED homebrew list, overlay and all", () => {
    const list = SpellListReferenceSchema.parse({ id: "hb-blood-a1b2c3", name: "Blood", source: "homebrew", add: ["fireball"] });
    const context = contextWith({ spellLists: [list] });
    expect(validateForPublish("class", classBody({ spellcasting: { ability: "int", prepares: "prepared", spellListId: "hb-blood-a1b2c3" } }), context).valid).toBe(true);
  });
});

describe("tier 4 - shapes that parse and are then read by nothing", () => {
  it("refuses a third-caster subclass rather than shipping a character with zero slots", () => {
    // A subclass's own `levelTable` is dead data today: not read by the builder, not projected, not on
    // the wire summary. A loud \"not supported yet\" beats a caster with no slots and no spell picker.
    const eldritchKnight = { id: "hb-ek-a1b2c3", name: "Eldritch Knight", source: "homebrew", classId: "fighter", spellcasting: { ability: "int", prepares: "prepared", spellListId: "wizard" } };
    expect(messages(validateForPublish("subclass", eldritchKnight, contextWith()))).toContain("Third-caster subclasses are not supported yet");
    // The same subclass on a class that DOES have slots is fine - nothing is being overlaid.
    expect(validateForPublish("subclass", { ...eldritchKnight, classId: "wizard" }, contextWith()).valid).toBe(true);
  });

  it("refuses an extra-damage rider that names neither dice nor an ability modifier", () => {
    // `extra-damage` carries TWO independent ways to say how much - `formula` (dice) and
    // `abilityModifier` (the bearer's own, resolved at the roll, which is how Agonizing Blast is
    // said). Either alone is a real printed effect, so neither can be `required`, and a
    // `.superRefine` inside a `z.discriminatedUnion` is not legal in Zod 3. So the pairing is
    // enforced HERE: with neither field the rider parses, stores, publishes, collects at exactly
    // the right moment - and adds zero. That silence is the failure this whole area exists to end.
    const withRider = (modifier: Record<string, unknown>) => ({
      id: "hb-blaster-a1b2c3", name: "Blaster", source: "homebrew", category: "general",
      feature: { id: "hb-blaster-a1b2c3", name: "Blaster", description: "A homebrew feat.", modifiers: [modifier] }
    });
    const empty = validateForPublish("feat", withRider({ type: "extra-damage", damageType: "force" }), contextWith());
    expect(empty.valid).toBe(false);
    expect(messages(empty)).toContain("neither a dice `formula` nor an `abilityModifier`");
    // The offending field is addressable, like every other issue in this file.
    expect(empty.issues[0].path).toEqual(["feature", "modifiers", 0]);

    // Either half ALONE publishes: dice only (the original shape), and ability only (Agonizing Blast).
    expect(validateForPublish("feat", withRider({ type: "extra-damage", formula: "1d6", damageType: "fire" }), contextWith()).valid).toBe(true);
    expect(validateForPublish("feat", withRider({ type: "extra-damage", abilityModifier: "cha", damageType: "force" }), contextWith()).valid).toBe(true);
  });
});

describe("a duplicated SRD record still passes its own gate", () => {
  it("accepts every SRD class taken through the real duplicate path", () => {
    // Duplicate-an-SRD-record is the headline authoring path, so a rule that rejected bundled content
    // would make the feature unusable. Driven through `findCatalogRecord`/`rewriteForNewId` rather
    // than a hand-written clone, because THAT is the pair that has to produce a publishable body -
    // and it is where the `from`/`options` round-trip trap lives.
    const context = contextWith();
    for (const entry of loadClasses()) {
      const source = findCatalogRecord(context.catalog, entry.id)!;
      const newId = `hb-${entry.id}-a1b2c3`;
      const validity = validateForPublish("class", rewriteForNewId("class", source.body, entry.id, newId), context);
      // The ONE thing a copy legitimately loses: nothing calls itself a subclass of it yet. That is
      // the loud, actionable message the GM should get from the publish button - and it is satisfied
      // by a DRAFT subclass, so it never becomes the deadlock it used to be.
      const unexpected = validity.issues.filter((issue) => !String(issue.message).includes("no subclass names"));
      expect(unexpected, `${entry.id}: ${messages({ issues: unexpected })}`).toEqual([]);
    }
  });

  it("re-points a copy's self-referential slugs at ITSELF, and leaves shared references alone", () => {
    const context = contextWith();
    const wizard = findCatalogRecord(context.catalog, "wizard")!;
    const copy = rewriteForNewId("class", wizard.body, "wizard", "hb-chronomancer-a1b2c3") as Record<string, any>;
    const slugs = (copy.features as any[]).map((feature) => feature.choice?.fromCatalog).filter(Boolean);
    // REWRITTEN: keeping `wizard-subclasses` would offer Wizard's subclasses, and the build then hard-
    // rejects ("Evocation is a wizard subclass, not a Chronomancer one").
    expect(slugs).toContain("hb-chronomancer-a1b2c3-subclasses");
    expect(slugs).not.toContain("wizard-subclasses");
    // KEPT: a spell list is shared vocabulary, not a possession. Re-pointing it at an empty new list
    // would make the copy uncreatable for no gain.
    expect(slugs).toContain("wizard-spells");
    expect(copy.spellcasting.spellListId).toBe("wizard");
    expect(copy.source).toBe("homebrew");
    // Intra-record ids are untouched, or `ClassReferenceSchema`'s own level-table cross-check fails.
    expect((copy.levelTable as any[])[0].features).toEqual((wizard.body as any).levelTable[0].features);
  });

  it("re-points a copied species at its own lineages", () => {
    const context = contextWith();
    const elf = findCatalogRecord(context.catalog, "elf")!;
    const copy = rewriteForNewId("species", elf.body, "elf", "hb-shadar-kai-a1b2c3") as Record<string, any>;
    // Keeping `elf-lineages` would resolve against ELF's lineage rows, so any lineage the GM adds to
    // the copy would never be offered - silently.
    expect((copy.traits as any[]).map((trait) => trait.choice?.fromCatalog)).toContain("hb-shadar-kai-a1b2c3-lineages");
    expect(validateForPublish("species", copy, context)).toEqual({ valid: true, issues: [] });
  });

  it("keeps every SRD spell list non-empty, so an SRD caster copy is always creatable", () => {
    const spells = loadSpells();
    for (const entry of loadClasses()) {
      if (!entry.spellcasting?.spellListId) continue;
      expect(spells.some((spell) => spell.classes.includes(entry.spellcasting!.spellListId!)), entry.id).toBe(true);
    }
  });
});
