/**
 * **THE API↔EDITOR PARITY GUARD — unit A1, and the reason the capability units land under a red
 * light instead of a promise.**
 *
 * The client ruled the guard must be an HTTP round-trip (decision log 2026-08-10): the real router,
 * the real store, the real publish gate, and a deep-equal between the API-stored body and the
 * editor-reproduced one. `docs/product/plan-api-program.md` §2 is the spec this file implements;
 * `api-parity-harness.ts` beside it holds the machinery so the audit generator can import it too.
 *
 * Three tests, exactly as planned:
 *
 *   - **T1, the census.** Walk the nine `HOMEBREW_BODY_SCHEMAS` into 4,660 editor-addressable
 *     questions, probe each against the real form model, and hold the 1,737 open answers to the
 *     exemption table in both directions — a gap with no reasoned row fails, a row whose gap closed
 *     fails, and the counts are pinned so a control landing on even one type moves a number.
 *   - **T2, the round trip.** For each type: author a record through the REAL controls, POST it
 *     over the wire, run the four-tier publish gate, read back the stored body, and assert the
 *     editor reproduces it field for field. Eight types round-trip today; `background` cannot —
 *     that is D3's measured defect, pinned here until its unit lands.
 *   - **T3, the guard's own non-vacuity.** Negative cases built locally: a deleted exemption row
 *     must fail the census naming the address; a value the editor did not write must fail the
 *     comparison naming the path. A guard that cannot fail is decoration.
 *
 * Plus the freshness pin ruling 19 demands: `docs/product/vocabulary-parity-audit.md` is GENERATED
 * from this guard's census (`npm run docs`), and this file fails when the two disagree.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOMEBREW_PATHS } from "@vtt/api-contract";
import type { HomebrewBodyType } from "@vtt/content-srd-5.2.1/schemas";
import {
  assertCanonicaliserSound, bootHomebrewApi, censusVerdict, comparableBody, EXEMPTIONS,
  firstDifference, isSystemForced, probeAddress, renderParityAudit, walkBodySchemas, type ApiFixture
} from "./api-parity-harness";
import { applyField, authored, authoredRow, publishVerdict, storedBody } from "./authoring-harness";
import type { Draft } from "./schema";
import type { HomebrewType } from "./types";

/* ------------------------------------------------------------------- the one walk ---- */

assertCanonicaliserSound();
const { addresses, stats } = walkBodySchemas();
const results = addresses.map(probeAddress);
const open = results.filter((result) => !result.covered && !isSystemForced(result.address));

/* ------------------------------------------------------------------ T1: the census ---- */

describe("T1 — the census: every API-authorable key the editor cannot reach, held to a reasoned row", () => {
  it("pins the walk — the plan's two schema-intrinsic counts, and this file's own expansion", () => {
    // 162/709 are properties of the schemas (plan §2.3); the other four are properties of THIS
    // canonicaliser, pinned on the day it was written so the next agent measures the same thing.
    expect(stats).toEqual({ objectSchemas: 162, declaredKeys: 709 });
    expect({
      asked: results.length,
      covered: results.filter((result) => result.covered).length,
      forced: results.filter((result) => !result.covered && isSystemForced(result.address)).length,
      open: open.length
    }).toEqual({ asked: 4660, covered: 2817, forced: 106, open: 1737 });
  });

  it("holds the open set to the exemption table exactly, in both directions", () => {
    const verdict = censusVerdict(open, EXEMPTIONS);
    // Direction 1: a key the schemas accept, the editor cannot author, and no row carries — the
    // failure this guard exists to produce. The message names the address and how the probe failed.
    expect(verdict.unmatched, "open addresses with no exemption row").toEqual([]);
    // Direction 2: a row whose group no longer exists — the control landed, delete the row in the
    // same commit (and re-pin the counts above).
    expect(verdict.stale, "exemption rows matching nothing").toEqual([]);
  });
});

/* -------------------------------------------------------------- T2: the round trip ---- */

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };

/**
 * One representative record per type, authored through the REAL controls — `authored`/`authoredRow`
 * throw on any key with no control, so a fixture line failing is itself a parity failure. Kept
 * deliberately covered-fields-only: what the editor cannot author is T1's census, not T2's body.
 */
const FIXTURES: Record<Exclude<HomebrewBodyType, "background">, () => Draft> = {
  monster: () => {
    const damage = authoredRow("monster", ["actions", "damage"], [["formula", "3d6"], ["type", "psychic"]]);
    const action = authoredRow("monster", ["actions"], [
      ["name", "Consume Memories"],
      ["activation", "action"],
      ["description", "Intelligence Saving Throw: DC 16, one creature within 30 feet."],
      ["damage", [damage]],
      ["save.ability", "int"],
      ["save.dc", 16]
    ]);
    return authored("monster", "Memory Eater", [
      ["size", "large"],
      // The two statblock-extension keys the publish gate hard-requires (F2's defect measures the
      // CONTRACT's silence about them; the editor's controls exist and are exercised here).
      ["type", "aberration"],
      ["challengeRating", 10],
      ["speedFeet", 30],
      ["abilityScores.str", 21], ["abilityScores.dex", 9], ["abilityScores.con", 15],
      ["abilityScores.int", 18], ["abilityScores.wis", 15], ["abilityScores.cha", 18],
      ["armorClass", 17],
      ["hitPoints.maximum", 150],
      ["proficiencyBonus", 4],
      ["actions", [action]]
    ]);
  },
  equipment: () => authored("equipment", "Iron Lantern of Vigil", [
    ["description", "A sturdy iron lantern that never gutters."],
    ["category", "weapon"],
    ["weapon.damageDice", "1d6"],
    ["weapon.damageType", "bludgeoning"]
  ]),
  class: () => authored("class", "Warden", [
    ["summary", "A warden of the deep wood."],
    ["description", "Wardens stand between the wood and what comes for it."],
    ["hitDie", "d10"],
    ["primaryAbilities", ["str"]],
    ["savingThrows", ["str", "con"]],
    ["subclassLevel", 20],
    ["skillChoices.choose", 2],
    ["skillChoices.from", ["athletics", "survival", "perception"]]
  ]),
  subclass: () => authored("subclass", "Circle of Embers", [
    ["classId", "druid"],
    ["summary", "Druids of the cinder."],
    ["description", "They keep the first fire."]
  ]),
  species: () => {
    const trait = authoredRow("species", ["traits"], [
      ["name", "Cinder Ward"],
      ["description", "You are warded against one element at a time."]
    ]);
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
  spell: () => authored("spell", "Ember Coil", [
    ["level", 1],
    ["school", "evocation"],
    ["description", "A coil of embers lashes out."]
  ]),
  "spell-list": () => {
    const draft = authored("spell-list", "Warden Spells", [
      ["description", "The warden list."]
    ]);
    // The membership write `SpellListContents.tsx:88` performs on a tap: `{ ...draft, add, remove }`.
    // The component is bespoke (its `^add`/`^remove` exemption rows say so), so this line IS its
    // write path, cited rather than re-invented.
    return { ...draft, add: ["fire-bolt"] };
  }
};

describe("T2 — the HTTP round trip: the editor reproduces the record the API stored, field for field", () => {
  let api: ApiFixture;
  beforeAll(async () => { api = await bootHomebrewApi(); });
  afterAll(async () => { await api.close(); });

  for (const type of Object.keys(FIXTURES) as ReadonlyArray<keyof typeof FIXTURES>) {
    it(`${type}: POST → publish (the real four-tier gate) → GET → editor rebuild → deep-equal`, async () => {
      const draft = FIXTURES[type]();
      const verdict = publishVerdict(type as HomebrewType, draft, "hb-a1-probe");
      expect(verdict.why, `${type} client checklist`).toBe("");
      expect(verdict.publishable, `${type} client checklist`).toBe(true);

      const posted = storedBody(type as HomebrewType, draft, "hb-a1-probe");
      const created = await fetch(`${api.base}${HOMEBREW_PATHS.content}`, {
        method: "POST", headers: GM, body: JSON.stringify({ record: { type, ...posted } })
      });
      expect(created.status, `${type} create`).toBe(201);
      const record = (await created.json()).data.record as { id: string };

      // Stronger than a Zod parse: identity and referential tiers included (plan §2.2 step 3).
      const published = await fetch(`${api.base}${HOMEBREW_PATHS.contentById.replace("{id}", record.id)}/publish`, {
        method: "POST", headers: GM
      });
      expect(published.status, `${type} publish`).toBe(200);

      const fetched = await fetch(`${api.base}${HOMEBREW_PATHS.contentById.replace("{id}", record.id)}`, { headers: GM });
      const stored = (await fetched.json()).data.record.record as Record<string, unknown>;
      const editor = storedBody(type as HomebrewType, draft, record.id) as Record<string, unknown>;
      const difference = firstDifference(comparableBody(type, stored), comparableBody(type, editor));
      expect(
        difference === null,
        difference ? `${type} differs at \`${difference.path}\`: api=${JSON.stringify(difference.api)} editor=${JSON.stringify(difference.editor)}` : ""
      ).toBe(true);
    });
  }

  it("background: CANNOT round-trip today — D3's measured defect, pinned until its unit lands", () => {
    // There is no editor path to a publishable background AT ALL, for two stacked reasons this pin
    // holds apart. This is the honest T2 for the type: when D3 lands, both halves fail, and the
    // unit replaces them with the real round trip in the same commit.
    const bare = authored("background", "Lamplighter", [
      ["summary", "You kept the streets lit."],
      ["description", "Every alley knows your ladder and your flame."]
    ]);

    // Half 1 — the requirement: `abilityOptions.spreads` is schema-required non-empty, so leaving
    // it alone is already unpublishable.
    const untouched = publishVerdict("background", bare, "hb-a1-probe");
    expect(untouched.publishable).toBe(false);
    expect(untouched.why).toContain("Fix spreads — array must contain at least 1");

    // Half 2 — D3's own mechanism ("Tapping 'Add a spread' makes a background unpublishable"):
    // the ONLY control for the required key mints `{ amounts, label }`, a shape the schema
    // refuses. So satisfying half 1 through the real control swaps the refusal for the minted
    // shape's own — the regression target D3's implementer needs. `authoredRow` goes through the
    // row field's real `newRow`/writes.
    const spread = authoredRow("background", ["abilityOptions.spreads"], [["label", "Standard"]]);
    const tapped = applyField("background", bare, "abilityOptions.spreads", [spread]);
    const verdict = publishVerdict("background", tapped, "hb-a1-probe");
    expect(verdict.publishable).toBe(false);
    expect(verdict.why, "the tapped refusal is the minted SHAPE's, not the empty array's")
      .toContain("Fix spreads — expected array, received object");
  });
});

/* --------------------------------------------------- T3: the guard cannot rot green ---- */

describe("T3 — non-vacuity, by constructed failure (plan §2.2: 'asserted in the file, so the guard cannot rot into a green no-op')", () => {
  it("(control) removing an exemption row whose addresses still have no control fails the census, naming them", () => {
    const withoutGrants = EXEMPTIONS.filter((row) => row.at !== "actions[].grants.**");
    const verdict = censusVerdict(open, withoutGrants);
    // The exact failure a later agent would see. Not all of C4's addresses orphan — the
    // `modifiers[].**` row legitimately floats under `actions[].grants.modifiers[].` and keeps
    // that slice (`EffectGrantSchema` has no `spells`, so nothing else intersects) — but the
    // grant's own keys have nowhere to go, and the census names them.
    expect(verdict.unmatched.length).toBe(111);
    expect(verdict.unmatched.some((line) => line.includes("monster.actions[].grants.name"))).toBe(true);
  });

  it("(control, the other direction) a row matching nothing is reported stale, naming the row", () => {
    const fake = { at: "actions[].neverAKey", types: "*" as const, reason: "probe", owner: "probe" };
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
    // And a key present on one side alone is named too, not swallowed by a values-only walk.
    const extra = firstDifference(comparableBody("monster", { ...editor, sneaky: true }), comparableBody("monster", editor));
    expect(extra).toEqual({ path: "sneaky", api: true, editor: undefined });
  });
});

/* ------------------------------------------------------------- the generated audit ---- */

describe("the generated audit (ruling 19)", () => {
  it("docs/product/vocabulary-parity-audit.md matches this guard's census — regenerate with `npm run docs`", () => {
    const committed = readFileSync(
      fileURLToPath(new URL("../../../../docs/product/vocabulary-parity-audit.md", import.meta.url)),
      "utf8"
    );
    expect(committed).toBe(renderParityAudit({ stats, results, exemptions: EXEMPTIONS }));
  });
});

// The open set is scope, not decoration: a unit that lands a control deletes its exemption row and
// re-pins the counts IN THE SAME COMMIT (see `EXEMPTIONS` in `api-parity-harness.ts`).
