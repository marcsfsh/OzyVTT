/**
 * API-to-editor parity guard, over the real router, store and publish gate.
 * - The census: every key the body schemas accept that no editor control can author must match a reasoned
 *   exemption row, and every row must still match something. Counts are pinned.
 * - The round trip: per type, a record authored through the real controls is POSTed, published, read back, and
 *   must deep-equal the editor's own body. `background` cannot round-trip yet (pinned below).
 * - Non-vacuity: the guard can fail: a removed row or a mangled value is reported.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOMEBREW_PATHS } from "@vtt/api-contract";
import type { HomebrewBodyType } from "@vtt/content-srd-5.2.1/schemas";
import {
  assertCanonicaliserSound,
  bootHomebrewApi,
  censusVerdict,
  comparableBody,
  EXEMPTIONS,
  firstDifference,
  isSystemForced,
  probeAddress,
  walkBodySchemas,
  type ApiFixture
} from "./api-parity-harness";
import { applyField, authored, authoredRow, publishVerdict, storedBody } from "./authoring-harness";
import type { Draft } from "./schema";
import type { HomebrewType } from "./types";

/* ------------------------------------------------------------------- the one walk ---- */

assertCanonicaliserSound();
const { addresses, stats } = walkBodySchemas();
const results = addresses.map(probeAddress);
const open = results.filter((result) => !result.covered && !isSystemForced(result.address));

/* ---------------------------------------------------------------------- the census ---- */

describe("the census: every API-authorable key the editor cannot reach, held to a reasoned row", () => {
  it("pins the walk: the plan's two schema-intrinsic counts, and this file's own expansion", () => {
    // `objectSchemas`/`declaredKeys` are properties of the schemas; the counts below are properties
    // of the canonicaliser. When a schema or control change moves them, re-pin in the same change.
    expect(stats).toEqual({ objectSchemas: 311, declaredKeys: 1649 });
    expect({
      asked: results.length,
      covered: results.filter((result) => result.covered).length,
      forced: results.filter((result) => !result.covered && isSystemForced(result.address)).length,
      open: open.length
    }).toEqual({ asked: 31784, covered: 17270, forced: 232, open: 14282 });
  });

  it("holds the open set to the exemption table exactly, in both directions", () => {
    const verdict = censusVerdict(open, EXEMPTIONS);
    // Direction 1: an open key no row covers.
    expect(verdict.unmatched, "open addresses with no exemption row").toEqual([]);
    // Direction 2: a row whose group no longer exists; delete it and re-pin the counts.
    expect(verdict.stale, "exemption rows matching nothing").toEqual([]);
  });
});

/* ------------------------------------------------------------------ the round trip ---- */

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };

/** One record per type, authored through the real controls (`authored`/`authoredRow` throw on a key
    with no control). Covered fields only; uncovered keys are the census's concern. */
const FIXTURES: Record<Exclude<HomebrewBodyType, "background">, () => Draft> = {
  monster: () => {
    const damage = authoredRow(
      "monster",
      ["actions", "damage"],
      [
        ["formula", "3d6"],
        ["type", "psychic"]
      ]
    );
    const action = authoredRow(
      "monster",
      ["actions"],
      [
        ["name", "Consume Memories"],
        ["activation", "action"],
        ["description", "Intelligence Saving Throw: DC 16, one creature within 30 feet."],
        ["damage", [damage]],
        ["save.ability", "int"],
        ["save.dc", 16]
      ]
    );
    return authored("monster", "Memory Eater", [
      ["size", "large"],
      // The two stat-block extension keys the publish gate requires.
      ["type", "aberration"],
      ["challengeRating", 10],
      ["speedFeet", 30],
      ["abilityScores.str", 21],
      ["abilityScores.dex", 9],
      ["abilityScores.con", 15],
      ["abilityScores.int", 18],
      ["abilityScores.wis", 15],
      ["abilityScores.cha", 18],
      ["armorClass", 17],
      ["hitPoints.maximum", 150],
      ["proficiencyBonus", 4],
      ["actions", [action]]
    ]);
  },
  equipment: () =>
    authored("equipment", "Iron Lantern of Vigil", [
      ["description", "A sturdy iron lantern that never gutters."],
      ["category", "weapon"],
      ["weapon.damageDice", "1d6"],
      ["weapon.damageType", "bludgeoning"]
    ]),
  class: () =>
    authored("class", "Warden", [
      ["summary", "A warden of the deep wood."],
      ["description", "Wardens stand between the wood and what comes for it."],
      ["hitDie", "d10"],
      ["primaryAbilities", ["str"]],
      ["savingThrows", ["str", "con"]],
      ["subclassLevel", 20],
      ["skillChoices.choose", 2],
      ["skillChoices.from", ["athletics", "survival", "perception"]]
    ]),
  subclass: () =>
    authored("subclass", "Circle of Embers", [
      ["classId", "druid"],
      ["summary", "Druids of the cinder."],
      ["description", "They keep the first fire."]
    ]),
  species: () => {
    const trait = authoredRow(
      "species",
      ["traits"],
      [
        ["name", "Cinder Ward"],
        ["description", "You are warded against one element at a time."]
      ]
    );
    return authored("species", "Emberkin", [
      ["summary", "Kin of the cinder."],
      ["description", "Emberkin carry a ward they re-tune whenever they rest."],
      ["sizes", ["medium"]],
      ["speedFeet", 30],
      ["traits", [trait]]
    ]);
  },
  feat: () => {
    const shell = authored("feat", "Wayfarer's Blessing", [
      ["category", "origin"],
      ["summary", "A blessing for the road."],
      ["description", "You always have the road's favor."]
    ]);
    let feature = shell.feature as Draft;
    feature = applyField("feat", feature, "name", "Wayfarer's Blessing", ["feature"]);
    feature = applyField("feat", feature, "description", "You always have the road's favor.", ["feature"]);
    return { ...shell, feature };
  },
  spell: () =>
    authored("spell", "Ember Coil", [
      ["level", 1],
      ["school", "evocation"],
      ["description", "A coil of embers lashes out."]
    ]),
  "spell-list": () => {
    const draft = authored("spell-list", "Warden Spells", [["description", "The warden list."]]);
    // The write `SpellListContents` performs on a tap; the component is bespoke.
    return { ...draft, add: ["fire-bolt"] };
  }
};

describe("the HTTP round trip: the editor reproduces the record the API stored, field for field", () => {
  let api: ApiFixture;
  beforeAll(async () => {
    api = await bootHomebrewApi();
  });
  afterAll(async () => {
    await api.close();
  });

  for (const type of Object.keys(FIXTURES) as ReadonlyArray<keyof typeof FIXTURES>) {
    it(`${type}: POST → publish (the real four-tier gate) → GET → editor rebuild → deep-equal`, async () => {
      const draft = FIXTURES[type]();
      const verdict = publishVerdict(type as HomebrewType, draft, "hb-a1-probe");
      expect(verdict.why, `${type} client checklist`).toBe("");
      expect(verdict.publishable, `${type} client checklist`).toBe(true);

      const posted = storedBody(type as HomebrewType, draft, "hb-a1-probe");
      const created = await fetch(`${api.base}${HOMEBREW_PATHS.content}`, {
        method: "POST",
        headers: GM,
        body: JSON.stringify({ record: { type, ...posted } })
      });
      expect(created.status, `${type} create`).toBe(201);
      const record = (await created.json()).data.record as { id: string };

      // Stronger than a Zod parse: the identity and referential tiers run too.
      const published = await fetch(`${api.base}${HOMEBREW_PATHS.contentById.replace("{id}", record.id)}/publish`, {
        method: "POST",
        headers: GM
      });
      expect(published.status, `${type} publish`).toBe(200);

      const fetched = await fetch(`${api.base}${HOMEBREW_PATHS.contentById.replace("{id}", record.id)}`, {
        headers: GM
      });
      const stored = (await fetched.json()).data.record.record as Record<string, unknown>;
      const editor = storedBody(type as HomebrewType, draft, record.id) as Record<string, unknown>;
      const difference = firstDifference(comparableBody(type, stored), comparableBody(type, editor));
      expect(
        difference === null,
        difference
          ? `${type} differs at \`${difference.path}\`: api=${JSON.stringify(difference.api)} editor=${JSON.stringify(difference.editor)}`
          : ""
      ).toBe(true);
    });
  }

  it("background: round-trips through the editor, the spread chips writing the bare arrays the schema stores", () => {
    const bare = authored("background", "Lamplighter", [
      ["summary", "You kept the streets lit."],
      ["description", "Every alley knows your ladder and your flame."],
      ["originFeatId", "alert"],
      ["abilityOptions.from", ["str", "dex", "wis"]]
    ]);
    // A new background starts with the SRD's two splits.
    const untouched = publishVerdict("background", bare, "hb-a1-probe");
    expect(untouched.publishable, untouched.why).toBe(true);

    // Unpressing +1 / +1 / +1 leaves only the +2 / +1 split, as a number array.
    const twoOne = applyField("background", bare, "abilityOptions.spreads", ["2-1"]);
    const verdict = publishVerdict("background", twoOne, "hb-a1-probe");
    expect(verdict.publishable, verdict.why).toBe(true);
    expect((verdict.parsed.data as { abilityOptions?: { spreads?: number[][] } }).abilityOptions?.spreads).toEqual([
      [2, 1]
    ]);
  });
});

/* ------------------------------------------------------- the guard cannot rot green ---- */

describe("non-vacuity, by constructed failure, so the guard cannot rot into a green no-op", () => {
  it("(control) removing an exemption row whose addresses still have no control fails the census, naming them", () => {
    const withoutGrants = EXEMPTIONS.filter((row) => row.at !== "actions[].grants.**");
    const verdict = censusVerdict(open, withoutGrants);
    // `modifiers[].**` still covers the nested modifiers slice, but the grant's own keys orphan.
    expect(verdict.unmatched.length).toBe(803);
    expect(verdict.unmatched.some((line) => line.includes("monster.actions[].grants.name"))).toBe(true);
  });

  it("(control, the other direction) a row matching nothing is reported stale, naming the row", () => {
    const fake = { at: "actions[].neverAKey", types: "*" as const, reason: "probe", status: "probe" };
    const verdict = censusVerdict(open, [...EXEMPTIONS, fake]);
    expect(verdict.stale).toEqual(["*.actions[].neverAKey (probe)"]);
    expect(verdict.unmatched).toEqual([]);
  });

  it("(value) a stored body the editor did not write fails the comparison at the differing path", () => {
    const draft = FIXTURES.monster();
    const editor = storedBody("monster", draft, "hb-a1-probe") as Record<string, unknown>;
    const mangled = { ...editor, armorClass: (editor.armorClass as number) + 1 };
    const difference = firstDifference(comparableBody("monster", mangled), comparableBody("monster", editor));
    expect(difference).toEqual({ path: "armorClass", api: 18, editor: 17 });
    // A key present on one side only is named too.
    const extra = firstDifference(
      comparableBody("monster", { ...editor, sneaky: true }),
      comparableBody("monster", editor)
    );
    expect(extra).toEqual({ path: "sneaky", api: true, editor: undefined });
  });
});
