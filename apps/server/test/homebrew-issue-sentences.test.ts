import { describe, expect, it } from "vitest";
import type { HomebrewContentType } from "@vtt/api-contract";
import {
  loadBackgrounds,
  loadClasses,
  loadEquipment,
  loadFeats,
  loadMonsterDefinitions,
  loadSpecies,
  loadSpells,
  loadSubclasses
} from "@vtt/content-srd-5.2.1";
import { ContentLibrary } from "../src/content-library.js";
import { EMPTY_AUTHORED_INDEX } from "../src/homebrew-store.js";
import { validateForPublish } from "../src/homebrew-validate.js";
import { fieldLabel } from "@vtt/content-srd-5.2.1/homebrew-issues";

// Every issue the publish gate returns is a sentence a GM reads (the Writing rules): no schema text, slugs, ids or
// backticks, and a path the client places on the step that owns it. The gate's rules are unchanged; only the words.

const context = () => ({
  catalog: new ContentLibrary().forAudience("gm"),
  spellLists: [],
  authored: EMPTY_AUTHORED_INDEX
});

/** Dashes and curly quotes, written as escapes so this file holds none of them. */
const BANNED_MARKS = new RegExp("[\\u2013\\u2014\\u2018\\u2019\\u201c\\u201d]");

/** What no message may carry: a backtick, a quoted slug or id, Zod's own words, a dash or curly quote. */
function problemsWith(message: string): string[] {
  const found: string[] = [];
  if (message.includes("`")) found.push("a backtick");
  if (/hb-[a-z0-9-]+/.test(message)) found.push("a homebrew id");
  if (/"[a-z0-9]+(?:-[a-z0-9]+)+"/.test(message)) found.push("a quoted slug");
  if (
    /\b(Invalid input|Invalid option|Invalid string|Too small|Too big|Unrecognized key|expected [a-z]+,|received )/i.test(
      message
    )
  )
    found.push("schema text");
  if (BANNED_MARKS.test(message)) found.push("a dash or curly quote");
  if (!/^[A-Z0-9]/.test(message)) found.push("no capital at the start");
  if (!/[.]$/.test(message)) found.push("no full stop at the end");
  if (/\bdistinct pick\(s\)|\bslug\b|\bbag\b|\bfromCatalog\b|\brider\b/.test(message)) found.push("storage words");
  return found;
}

/** One SRD record of each kind as an authorable body at a homebrew id. */
function seeds(): Array<{ type: HomebrewContentType; body: Record<string, unknown> }> {
  const as = (type: HomebrewContentType, record: object, id: string) => ({
    type,
    body: { ...structuredClone(record), id, source: "homebrew" } as Record<string, unknown>
  });
  const monster = structuredClone(loadMonsterDefinitions()[0]!) as unknown as Record<string, unknown>;
  return [
    as(
      "class",
      loadClasses().find((entry) => entry.id === "wizard")!,
      "hb-wizardly-a1b2c3"
    ),
    as("subclass", loadSubclasses()[0]!, "hb-sub-a1b2c3"),
    as("species", loadSpecies()[0]!, "hb-kin-a1b2c3"),
    as("background", loadBackgrounds()[0]!, "hb-past-a1b2c3"),
    as("feat", loadFeats()[0]!, "hb-knack-a1b2c3"),
    as("spell", loadSpells()[0]!, "hb-hex-a1b2c3"),
    as(
      "equipment",
      loadEquipment().find((item) => item.weapon)!,
      "hb-blade-a1b2c3"
    ),
    {
      type: "monster",
      body: {
        ...monster,
        id: "hb-m-0a1b2c3d4e5f",
        source: { ...(monster.source as object), externalId: "hb-m-0a1b2c3d4e5f" }
      }
    },
    { type: "spell-list", body: { id: "hb-list-a1b2c3", name: "Tide List", source: "homebrew", add: ["fireball"] } }
  ];
}

/** Broken versions of a body: each top-level field blanked, emptied, mistyped or removed, plus a stray key. */
function broken(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [{ ...body, strayField: 1 }, {}];
  for (const key of Object.keys(body)) {
    if (key === "id") continue;
    const { [key]: _gone, ...without } = body;
    out.push(without);
    const value = body[key];
    out.push({ ...body, [key]: typeof value === "string" ? "" : typeof value === "number" ? -999 : "x" });
    if (Array.isArray(value)) out.push({ ...body, [key]: [{}] });
    if (value && typeof value === "object" && !Array.isArray(value)) out.push({ ...body, [key]: { stray: true } });
  }
  return out;
}

describe("the gate's issue sentences", () => {
  it("never shows schema text, slugs, ids or backticks, over every field of every kind broken every way", () => {
    let checked = 0;
    const offenders: string[] = [];
    for (const { type, body } of seeds()) {
      for (const candidate of broken(body)) {
        const validity = validateForPublish(type, candidate, context());
        for (const issue of [...validity.issues, ...validity.warnings]) {
          checked += 1;
          const problems = problemsWith(issue.message);
          if (problems.length > 0)
            offenders.push(`${type} ${JSON.stringify(issue.path)}: ${problems.join(", ")}: ${issue.message}`);
        }
      }
    }
    // The sweep must actually produce issues, or it proves nothing.
    expect(checked).toBeGreaterThan(200);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("names the field and the part of the record that owns it", () => {
    const feat = {
      id: "hb-alert-a1b2c3",
      name: "Alert",
      source: "homebrew",
      category: "general",
      feature: { id: "alert", name: "Keen Watch", description: "" }
    };
    const validity = validateForPublish("feat", feat, context());
    expect(validity.issues).toContainEqual({
      path: ["feature", "description"],
      message: "Fill in the description for Keen Watch.",
      recordId: null
    });
    expect(fieldLabel(["levelTable", 0, "spellSlots"])).toBe("spell slots");
    expect(fieldLabel(["hitPoints", "maximum"])).toBe("Hit Points");
    expect(fieldLabel(["darkvisionFeet"])).toBe("darkvision");
  });

  it("refuses a caster class whose level 1 row has no spell slots, and accepts the SRD's casters (#153)", () => {
    const wizard = loadClasses().find((entry) => entry.id === "wizard")!;
    const blank = {
      ...structuredClone(wizard),
      id: "hb-tidecaller-a1b2c3",
      name: "Tidecaller",
      source: "homebrew",
      levelTable: wizard.levelTable.map(({ spellSlots: _slots, ...row }) => row)
    };
    const refused = validateForPublish("class", blank, context());
    expect(refused.issues).toContainEqual({
      path: ["levelTable", 0, "spellSlots"],
      message:
        "Tidecaller casts spells, but its level 1 row gives no spell slots. Fill in the slots, or pick how it casts again.",
      recordId: null
    });
    // Every SRD class that casts, as a copy, gives slots from level 1, pact slots included.
    for (const entry of loadClasses().filter((candidate) => candidate.spellcasting)) {
      const copy = { ...structuredClone(entry), id: `hb-${entry.id}-a1b2c3`, source: "homebrew" };
      const slotIssues = validateForPublish("class", copy, context()).issues.filter((issue) =>
        issue.message.includes("gives no spell slots")
      );
      expect(slotIssues, entry.id).toEqual([]);
    }
  });

  it("publishes a saving throw with no damage, and places an empty damage row on its action (#155)", () => {
    const base = structuredClone(loadMonsterDefinitions().find((definition) => definition.legendary)!);
    const id = "hb-m-00aa11bb22cc";
    const undertow = {
      id: "undertow",
      name: "Undertow",
      activation: "other",
      description:
        "Legendary Action. Dexterity Saving Throw: DC 15, one creature within 30 feet. Failure: The target has the Prone condition.",
      save: { ability: "dex", dc: 15, failureConditions: ["prone"] },
      damage: [],
      legendary: { cost: 1 }
    };
    const monster = (damage: unknown[]) => ({
      ...base,
      id,
      name: "Drowned Abbess",
      source: { ...base.source, externalId: id },
      actions: [...base.actions, { ...undertow, damage }]
    });
    const clean = validateForPublish("monster", monster([]), context());
    expect(clean.issues.filter((issue) => issue.path[0] === "actions")).toEqual([]);
    const blank = validateForPublish("monster", monster([{ formula: "", type: "fire" }]), context());
    const index = base.actions.length;
    expect(blank.issues).toContainEqual({
      path: ["actions", index, "damage", 0, "formula"],
      message: "Fill in the dice for Undertow, or remove that damage row.",
      recordId: null
    });
  });
});
