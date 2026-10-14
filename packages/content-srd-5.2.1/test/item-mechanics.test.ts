import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ITEM_MECHANICS_LANES } from "../scripts/item-mechanics/index.js";
import {
  applyItemMechanics,
  CARRIER_RIDER_DISPOSITION_MIRROR,
  CHECKED_SLUG_KEYS,
  OPEN_BY_DESIGN
} from "../scripts/item-mechanics/overlay.js";
import type { ItemMechanics, ItemMechanicsLane } from "../scripts/item-mechanics/overlay.js";
import { ITEM_REFUSED_MODIFIER_MESSAGE } from "../src/character-content.js";
import { loadMagicItems } from "../src/index.js";
import { PROBE_TAG } from "./fixtures/item-mechanics-etl-probe.js";

/**
 * The item mechanics seam: hand-authored riders from `scripts/item-mechanics/` merged into the
 * generated bundle at build time. Assertions end at the bytes `build-magic-items.ts` writes, at a
 * thrown refusal, or at that script's stdout. Runtime effects are covered in
 * `apps/server/test/item-riders.test.ts`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const BUNDLE = join(packageRoot, "bundles/magic-items.v1.json");

/** The exact string `build-magic-items.ts` writes, reproduced from a row list. */
const emit = (rows: readonly unknown[]): string => `${JSON.stringify(rows, null, 1)}\n`;

const rows = loadMagicItems();
const committed = readFileSync(BUNDLE, "utf8");

/** One probe lane. `categories` defaults to the row's own so a test about X is not about categories. */
const lane = (
  entries: Record<string, ItemMechanics>,
  categories: readonly string[] = ["wondrous-item"],
  name = "C7-probe"
): ItemMechanicsLane => ({ lane: name, categories, entries });

// Inference-budget guard, as in `bundle.test.ts`: `ItemMechanics` is a `Pick` off the schema's input
// type, and a truncated inference would silently drop compile-time checks on every lane's riders.
type Has<T, K extends keyof T, Expected> = 0 extends 1 & T[K]
  ? never
  : [T[K]] extends [never]
    ? never
    : T[K] extends Expected
      ? true
      : never;
const _inferenceBudget: [
  Has<ItemMechanics, "modifiers", ReadonlyArray<unknown> | undefined>,
  Has<ItemMechanics, "casts", ReadonlyArray<unknown> | undefined>,
  Has<ItemMechanics, "grantsFeatIds", ReadonlyArray<unknown> | undefined>,
  Has<ItemMechanics, "cursed", boolean | undefined>
] = [true, true, true, true];
void _inferenceBudget;

describe("the item mechanics overlay", () => {
  it("is inert until a lane fills it: the empty overlay re-emits the committed bundle byte for byte", () => {
    // `emit` is the script's own serialization, so an empty overlay must reproduce the file exactly.
    expect(emit(rows)).toBe(committed);
    expect(emit(applyItemMechanics(rows, []))).toBe(committed);
  });

  it("lands a rider on the real row, and on no other row, in the emitted bundle", () => {
    // These riders live only in this test and are deliberately implausible so the test stays meaningful
    // once a lane authors this row for real.
    const merged = applyItemMechanics(rows, [
      lane({
        "cloak-of-protection": { tags: ["overlay-probe"], modifiers: [{ type: "armor-class", amount: -3 }] }
      })
    ]);

    const landed = merged.find((row) => row.id === "cloak-of-protection")!;
    expect(landed.modifiers).toEqual([{ type: "armor-class", amount: -3, whileArmored: false, when: [] }]);
    // The merge re-parses the touched row, so it comes back in the bundle's output form.
    expect(landed.modifiers).not.toEqual(rows.find((row) => row.id === "cloak-of-protection")!.modifiers);

    // Compared against the inert emission rather than the committed file, which lanes also author into.
    const inert = emit(applyItemMechanics(rows, []));
    const emitted = emit(merged);
    expect(emitted).not.toBe(inert);
    expect(inert.split("overlay-probe")).toHaveLength(1);
    expect(emitted.split("overlay-probe")).toHaveLength(2);
    expect(merged.filter((row, index) => row !== rows[index]).map((row) => row.id)).toEqual(["cloak-of-protection"]);
  });

  it("fails closed on a key that matches no row, naming the lane and the key", () => {
    // A typo'd id would otherwise ship as a rider that does nothing.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protecton": { tags: ["typo"] } })])).toThrow(
      "item-mechanics: 1 refusal across 1 lane(s) and 1 entry; the bundle is NOT written.\n" +
        "  [C7-probe] cloak-of-protecton - no row in magic-items.v1.json carries this id, so the riders keyed to it would author nothing at all\n" +
        "Fix it in scripts/item-mechanics/ - a rider that cannot land is a rider that silently authors nothing, which is the failure this overlay exists to make loud."
    );
    // Several bad keys are reported together - a lane fixes its module once, not once per run.
    expect(() =>
      applyItemMechanics(rows, [lane({ "not-an-item": { tags: ["a"] }, "also-not": { tags: ["b"] } })])
    ).toThrow(/2 refusals across 1 lane\(s\) and 2 entries[\s\S]*not-an-item[\s\S]*also-not/);
  });

  it("refuses two lanes keyed to one item, naming both - the collision an object spread would have eaten", () => {
    // An object spread would collapse two lanes keyed to one id before the merge saw them.
    const first = lane(
      { "cloak-of-protection": { modifiers: [{ type: "armor-class", amount: 1 }] } },
      ["wondrous-item"],
      "C7c"
    );
    const second = lane(
      { "cloak-of-protection": { modifiers: [{ type: "save-bonus", amount: 1 }] } },
      ["wondrous-item"],
      "C7d"
    );

    expect(Object.keys({ ...first.entries, ...second.entries })).toEqual(["cloak-of-protection"]);

    // The list shape keeps both, so the merge can see the collision and refuse it by name.
    expect(() => applyItemMechanics(rows, [first, second])).toThrow(
      '[C7d] cloak-of-protection - already authored by lane "C7c". Two lanes on one item silently collapse to one when composed, so the seam refuses instead; one item belongs to one lane'
    );
  });

  it("refuses an entry outside its lane's declared categories, naming both categories", () => {
    // `Potion of Climbing` is a `consumable`; this lane owns weapons and armour.
    expect(() =>
      applyItemMechanics(rows, [
        lane({ "potion-of-climbing": { tags: ["misfiled"] } }, ["weapon", "armor", "shield", "ammunition"], "C7a")
      ])
    ).toThrow(
      '[C7a] potion-of-climbing - is a "consumable" and lane "C7a" owns "weapon", "armor", "shield", "ammunition". The lane split is by category (plan §3); author this item in the lane that owns it'
    );
  });

  it("refuses an entry outside its lane's declared SLOTS - the boundary category cannot draw", () => {
    // Both lanes own `wondrous-item`, so only `slots` separates them. `bag-of-holding` is slot `wondrous`.
    expect(() =>
      applyItemMechanics(rows, [
        {
          lane: "C7c",
          categories: ["wondrous-item"],
          slots: ["neck", "shoulders", "head", "feet", "hands", "belt"],
          entries: { "bag-of-holding": { tags: ["misfiled"] } }
        }
      ])
    ).toThrow(
      '[C7c] bag-of-holding - has slot "wondrous" and lane "C7c" owns "neck", "shoulders", "head", "feet", "hands", "belt". Two lanes share the "wondrous-item" category, so the slot is what divides them (plan §3); author this item in the lane that owns it'
    );

    // `slots` narrows; it cannot widen a lane past its categories.
    expect(() =>
      applyItemMechanics(rows, [
        {
          lane: "C7c",
          categories: ["wondrous-item"],
          slots: ["neck", "ring"],
          entries: { "ring-of-protection": { tags: ["misfiled"] } }
        }
      ])
    ).toThrow(/is a "ring" and lane "C7c" owns "wondrous-item"/);

    // A lane that declares no slots is checked by category alone.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": { tags: ["fine"] } })])).not.toThrow();

    // Present-but-empty admits no row at all, so it is refused at the lane the way `categories` is.
    expect(() =>
      applyItemMechanics(rows, [
        {
          lane: "C7c",
          categories: ["wondrous-item"],
          slots: [],
          entries: { "cloak-of-protection": { tags: ["x"] } }
        }
      ])
    ).toThrow('lane "C7c" declares an empty "slots" list, which matches no row at all');
  });

  it("fails closed on an entry that names no rider at all, and on one whose riders are empty", () => {
    // An empty entry is indistinguishable from a forgotten one, and so is a present-but-empty rider list.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": {} })])).toThrow(
      "[C7-probe] cloak-of-protection - the entry names no rider; record a named absence as a comment beside it, not as an empty entry"
    );

    for (const empty of [{ modifiers: [] }, { tags: [] }, { casts: [] }, { grantsFeatIds: [] }] as ItemMechanics[]) {
      const key = Object.keys(empty)[0];
      expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": empty })]), key).toThrow(
        `[C7-probe] cloak-of-protection - "${key}" is present but empty, which authors nothing. Drop the key, or author the rider you meant`
      );
    }
    // `grants: {}` and `cursed: false` also leave the row byte-identical.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": { grants: {} } })])).toThrow(
      '[C7-probe] cloak-of-protection - "grants" is present but empty, which authors nothing'
    );
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": { cursed: false } })])).toThrow(
      '[C7-probe] cloak-of-protection - "cursed" is present but false, which is the default, which authors nothing'
    );
    expect(emit(applyItemMechanics(rows, []))).toBe(committed);
  });

  it("refuses a top-level key it does not know, instead of silently dropping the typo", () => {
    // The merge picks the known rider keys out of an entry (so lanes cannot set ETL-owned columns like
    // `slot`), which means a misspelled key would never reach `.strict()`. It is refused explicitly.
    expect(() =>
      applyItemMechanics(rows, [
        lane({
          "cloak-of-protection": {
            modifers: [{ type: "armor-class", amount: 1 }],
            modifiers: [{ type: "armor-class", amount: 1 }]
          } as unknown as ItemMechanics
        })
      ])
    ).toThrow('[C7-probe] cloak-of-protection - "modifers" is not a rider key');

    // ETL-owned parsed columns are refused by the same check.
    for (const owned of ["slot", "rarity", "attunement", "category", "description"]) {
      expect(
        () =>
          applyItemMechanics(rows, [
            lane({
              "cloak-of-protection": {
                modifiers: [{ type: "armor-class", amount: 1 }],
                [owned]: "anything"
              } as unknown as ItemMechanics
            })
          ]),
        owned
      ).toThrow(`"${owned}" is not a rider key`);
    }
  });

  it("refuses a rider type no consumer reads yet, pointing at the disposition table", () => {
    // A lane may only author riders that a consumer reads today (`CARRIER_RIDER_DISPOSITION`).
    expect(CARRIER_RIDER_DISPOSITION_MIRROR["spell-attack-bonus"]).toBe("unread");
    expect(() =>
      applyItemMechanics(rows, [
        lane({
          "cloak-of-protection": { modifiers: [{ type: "spell-attack-bonus", amount: 1 }] }
        })
      ])
    ).toThrow(
      '[C7-probe] cloak-of-protection - modifiers.0 is "spell-attack-bonus", which CARRIER_RIDER_DISPOSITION (apps/server/src/character-build.ts) marks "unread": the rider reaches derivation and no consumer applies it yet, so it would change nothing at the table. Record it as a named absence in a comment, with the unit that unblocks it'
    );
    // Its readable sibling is not refused, so the check is about the disposition and not the family.
    expect(() =>
      applyItemMechanics(rows, [
        lane({
          "cloak-of-protection": { modifiers: [{ type: "spell-save-dc", amount: 1 }] }
        })
      ])
    ).not.toThrow();
  });

  it("keeps the disposition mirror honest against the server's own table", () => {
    // `CARRIER_RIDER_DISPOSITION` is not exported and `apps/server` depends on this package, so
    // `overlay.ts` keeps a copy and this test reads the server file as text to hold the copy to it.
    const serverFile = readFileSync(join(packageRoot, "../../apps/server/src/character-build.ts"), "utf8");
    const block = serverFile.split("const CARRIER_RIDER_DISPOSITION")[1]?.split("\n};")[0] ?? "";
    const table = Object.fromEntries(
      [...block.matchAll(/^\s*"?([a-z-]+)"?:\s*"([a-z-]+)"/gm)].map((match) => [match[1], match[2]])
    );
    expect(Object.keys(table).length, "the disposition table was not found in character-build.ts").toBeGreaterThan(10);
    expect(table).toEqual({ ...CARRIER_RIDER_DISPOSITION_MIRROR });
  });

  it("cross-checks every slug that points into another bundle, and says which id it meant", () => {
    // Spell, feat, damage-type and other id slugs are open in the schema, so a typo would parse and
    // silently do nothing. The overlay cross-checks them against the bundles.
    const refusals: Array<readonly [ItemMechanics, string]> = [
      [
        { casts: [{ spellId: "fyre-ball" }] },
        'casts.0.spellId names "fyre-ball", which is no spell this content ships (bundles/spells.v1.json); did you mean "fireball"?'
      ],
      [
        { grantsFeatIds: ["not-a-real-feat"] },
        'grantsFeatIds.0 names "not-a-real-feat", which is no feat this content ships (bundles/feats.v1.json)'
      ],
      [
        { grants: { spells: [{ id: "not-a-spell" }] } },
        'grants.spells.0.id names "not-a-spell", which is no spell this content ships (bundles/spells.v1.json)'
      ],
      [
        { grants: { damageResistances: ["frost"] } },
        'grants.damageResistances.0 names "frost", which is no damage type this content ships (src/enums.ts DAMAGE_TYPE_IDS)'
      ],
      [
        { grants: { skills: ["basket-weaving"] } },
        'grants.skills.0 names "basket-weaving", which is no skill this content ships (bundles/skills.v1.json)'
      ],
      [
        { grants: { languages: ["mermish"] } },
        'grants.languages.0 names "mermish", which is no language this content ships (bundles/languages.v1.json)'
      ],
      [
        { grants: { conditionImmunities: ["asleep"] } },
        'grants.conditionImmunities.0 names "asleep", which is no condition this content ships (src/enums.ts CONDITION_IDS)'
      ],
      // Nested inside a rider gate.
      [
        {
          modifiers: [
            {
              type: "attack-bonus",
              amount: 1,
              when: [{ type: "on-attack-roll" }, { type: "spell-id-is", spellIds: ["magic-missle"] }]
            }
          ]
        },
        'modifiers.0.when.1.spellIds.0 names "magic-missle", which is no spell this content ships (bundles/spells.v1.json); did you mean "magic-missile"?'
      ],
      [
        {
          modifiers: [{ type: "save-bonus", amount: 1, when: [{ type: "while-condition", conditionIds: ["cursed"] }] }]
        },
        'modifiers.0.when.0.conditionIds.0 names "cursed", which is no condition this content ships (src/enums.ts CONDITION_IDS)'
      ],
      [
        { modifiers: [{ type: "spell-save-dc", amount: 1, classId: "wizzard" }] },
        'modifiers.0.classId names "wizzard", which is no class this content ships (bundles/classes.v1.json); did you mean "wizard"?'
      ],
      // `damage[].type` is a damage type; `modifiers[].type` is a discriminator.
      [
        {
          actions: [
            {
              id: "probe",
              name: "Probe",
              activation: "action",
              description: "Probe.",
              damage: [{ formula: "1d6", type: "frost" }]
            }
          ]
        },
        'actions.0.damage.0.type names "frost", which is no damage type this content ships (src/enums.ts DAMAGE_TYPE_IDS)'
      ]
    ];
    for (const [mechanics, message] of refusals) {
      expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": mechanics })]), message).toThrow(message);
    }

    // Correctly spelled riders land, so the check is about resolution and not shape.
    expect(() =>
      applyItemMechanics(rows, [
        lane({
          "cloak-of-protection": {
            casts: [{ spellId: "fireball" }],
            grants: {
              skills: ["arcana"],
              damageResistances: ["cold"],
              languages: ["elvish"],
              spells: [{ id: "shield" }]
            },
            modifiers: [
              {
                type: "attack-bonus",
                amount: 1,
                when: [{ type: "on-attack-roll" }, { type: "spell-id-is", spellIds: ["magic-missile"] }]
              }
            ]
          }
        })
      ])
    ).not.toThrow();
  });

  it("names the slugs it deliberately leaves open, so a gap in the walker is a decision", () => {
    // Checked and open-by-design slug keys are disjoint and both listed in `overlay.ts`.
    expect(CHECKED_SLUG_KEYS.filter((key) => OPEN_BY_DESIGN.includes(key))).toEqual([]);
    expect(CHECKED_SLUG_KEYS).toContain("spellId");
    expect(OPEN_BY_DESIGN).toContain("tags");
    // No bundle lists valid tags, so any tag is allowed.
    expect(() =>
      applyItemMechanics(rows, [lane({ "cloak-of-protection": { tags: ["not-in-any-bundle"] } })])
    ).not.toThrow();
  });

  it("surfaces the schema's refusal of an item-carrier modifier instead of swallowing it", () => {
    // The schema refuses `ITEM_REFUSED_MODIFIER_TYPES` on items; the seam re-parses so the refusal names
    // the item.
    expect(() =>
      applyItemMechanics(rows, [
        lane({
          "amulet-of-health": { modifiers: [{ type: "ability-score", ability: "con", amount: 4 }] }
        })
      ])
    ).toThrow(
      `[C7-probe] amulet-of-health - the schema refuses the merged row. modifiers.0.type: ${ITEM_REFUSED_MODIFIER_MESSAGE}`
    );

    // A cursed item must require attunement; `boots-of-elvenkind` requires none.
    expect(rows.find((row) => row.id === "boots-of-elvenkind")!.attunement?.required).toBe(false);
    expect(() => applyItemMechanics(rows, [lane({ "boots-of-elvenkind": { cursed: true } })])).toThrow(
      "[C7-probe] boots-of-elvenkind - the schema refuses the merged row. cursed: A cursed item must require attunement - attunement is both what springs the curse and what reveals it."
    );

    // The bundle's own schema is the overlay's only validator.
    expect(() =>
      applyItemMechanics(rows, [
        lane({
          "cloak-of-protection": { modifiers: [{ type: "armor-class", amount: 99 }] }
        })
      ])
    ).toThrow(/cloak-of-protection - the schema refuses the merged row\. modifiers\.0\.amount:/);
  });

  it("holds every SHIPPED lane to a real item id, its own categories and a name of its own", () => {
    // Every shipped lane must pass the merge without running the build.
    expect(() => applyItemMechanics(rows, ITEM_MECHANICS_LANES)).not.toThrow();
    const names = ITEM_MECHANICS_LANES.map((entry) => entry.lane);
    expect(names, "two lanes cannot share a name - the refusals identify a lane by it").toEqual([...new Set(names)]);
    for (const entry of ITEM_MECHANICS_LANES) {
      expect(entry.categories.length, `${entry.lane} declares no categories`).toBeGreaterThan(0);
      // `slots` is optional; declared, it may not be empty (that narrows to no row at all).
      if (entry.slots !== undefined)
        expect(entry.slots.length, `${entry.lane} declares an empty slots list`).toBeGreaterThan(0);
      for (const id of Object.keys(entry.entries))
        expect(
          rows.map((row) => row.id),
          `${entry.lane} / ${id}`
        ).toContain(id);
    }
    // Each declared slot must occur within the lane's own categories, or the narrowing is a typo.
    for (const entry of ITEM_MECHANICS_LANES) {
      for (const slot of entry.slots ?? []) {
        expect(
          rows.some((row) => entry.categories.includes(row.category) && row.slot === slot),
          `${entry.lane} declares slot "${slot}", which no row in its own categories carries`
        ).toBe(true);
      }
    }
  });
});

describe("the ETL's overlay hook", () => {
  /**
   * Runs the real generator (`node --import tsx`, as the npm script does) with `--out=` pointed at a
   * scratch directory, because only a real run shows the ETL applies the overlay at all.
   */
  const run = (...flags: readonly string[]): string =>
    execFileSync("node", ["--import", "tsx", "scripts/build-magic-items.ts", ...flags], {
      cwd: packageRoot,
      encoding: "utf8"
    });

  const scratch = mkdtempSync(join(tmpdir(), "item-mechanics-"));

  it("re-emits the committed bundle byte for byte on a real run", { timeout: 120_000 }, () => {
    const out = join(scratch, "inert.json");
    const stdout = run(`--out=${out}`);
    expect(stdout).toContain("wrote 268 magic items");
    expect(stdout).toMatch(/rows changed by the overlay: \d+/);
    // A source or parser change that moves the bundle without regenerating it fails here.
    expect(readFileSync(out, "utf8")).toBe(committed);
  });

  it("applies the overlay it is given - a probe lane's rider reaches the emitted file", { timeout: 120_000 }, () => {
    const out = join(scratch, "probe.json");
    const stdout = run(`--out=${out}`, `--overlay=${join(here, "fixtures/item-mechanics-etl-probe.ts")}`);

    // Counts rows whose bytes changed, not keys in the module.
    expect(stdout).toContain("rows changed by the overlay: 1 (1 lane(s): C7-probe)");

    const emitted = JSON.parse(readFileSync(out, "utf8")) as Array<{
      id: string;
      tags: string[];
      modifiers: unknown[];
    }>;
    expect(emitted).toHaveLength(268);
    const landed = emitted.filter((row) => row.tags.includes(PROBE_TAG));
    expect(landed.map((row) => row.id)).toEqual(["cloak-of-protection"]);
    // In the bundle's output form, materialised by the merge's re-parse.
    expect(landed[0].modifiers).toEqual([{ type: "armor-class", amount: -3, whileArmored: false, when: [] }]);
    // And the committed bundle is untouched by a run that wrote elsewhere.
    expect(readFileSync(BUNDLE, "utf8")).toBe(committed);
  });
});
