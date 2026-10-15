import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ITEM_MECHANICS } from "../scripts/item-mechanics/items.js";
import {
  applyItemMechanics,
  CARRIER_RIDER_DISPOSITION_MIRROR,
  CHECKED_SLUG_KEYS,
  OPEN_BY_DESIGN
} from "../scripts/item-mechanics/overlay.js";
import type { ItemMechanics } from "../scripts/item-mechanics/overlay.js";
import { ITEM_REFUSED_MODIFIER_MESSAGE } from "../src/character-content.js";
import { loadMagicItems } from "../src/index.js";

/**
 * The item mechanics seam: the riders in `scripts/item-mechanics/items.ts` merged into the generated
 * bundle at build time. Assertions end at the bytes `build-magic-items.ts` writes or at a thrown
 * refusal; `content-pipeline.test.ts` runs the script itself. Runtime effects are covered in
 * `apps/server/test/item-riders.test.ts`.
 */

/** The exact string `build-magic-items.ts` writes, reproduced from a row list. */
const emit = (rows: readonly unknown[]): string => `${JSON.stringify(rows, null, 1)}\n`;

const rows = loadMagicItems();
const committed = readFileSync(fileURLToPath(new URL("../bundles/magic-items.v1.json", import.meta.url)), "utf8");

// Inference-budget guard, as in `bundle.test.ts`: `ItemMechanics` is a `Pick` off the schema's input
// type, and a truncated inference would silently drop compile-time checks on every authored rider.
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
  it("is inert when empty: the empty overlay re-emits the committed bundle byte for byte", () => {
    // `emit` is the script's own serialization, so an empty overlay must reproduce the file exactly.
    expect(emit(rows)).toBe(committed);
    expect(emit(applyItemMechanics(rows, {}))).toBe(committed);
  });

  it("ships exactly the authored riders: re-applying the map to the committed bundle changes no byte", () => {
    // Every entry is already on its row, and `magic-items.test.ts` holds every other row bare, so the set
    // of prose-only items is the bundle's ids minus the map's keys.
    expect(emit(applyItemMechanics(rows, ITEM_MECHANICS))).toBe(committed);
    const ids = new Set(rows.map((row) => row.id));
    expect(Object.keys(ITEM_MECHANICS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it("lands a rider on the real row, and on no other row, in the emitted bundle", () => {
    // These riders live only in this test and are deliberately implausible so the test stays meaningful
    // whatever the real map authors on this row.
    const merged = applyItemMechanics(rows, {
      "cloak-of-protection": { tags: ["overlay-probe"], modifiers: [{ type: "armor-class", amount: -3 }] }
    });

    const landed = merged.find((row) => row.id === "cloak-of-protection")!;
    expect(landed.modifiers).toEqual([{ type: "armor-class", amount: -3, whileArmored: false }]);
    // The merge re-parses the touched row, so it comes back in the bundle's output form.
    expect(landed.modifiers).not.toEqual(rows.find((row) => row.id === "cloak-of-protection")!.modifiers);

    // Compared against the inert emission rather than the committed file, which the real map also authors into.
    const inert = emit(applyItemMechanics(rows, {}));
    const emitted = emit(merged);
    expect(emitted).not.toBe(inert);
    expect(inert.split("overlay-probe")).toHaveLength(1);
    expect(emitted.split("overlay-probe")).toHaveLength(2);
    expect(merged.filter((row, index) => row !== rows[index]).map((row) => row.id)).toEqual(["cloak-of-protection"]);
  });

  it("fails closed on a key that matches no row, naming the key", () => {
    // A typo'd id would otherwise ship as a rider that does nothing.
    expect(() => applyItemMechanics(rows, { "cloak-of-protecton": { tags: ["typo"] } })).toThrow(
      "item-mechanics: 1 refusal across 1 entry; the bundle is NOT written.\n" +
        "  cloak-of-protecton - no row in magic-items.v1.json carries this id, so the riders keyed to it would author nothing at all\n" +
        "Fix it in scripts/item-mechanics/items.ts - a rider that cannot land is a rider that silently authors nothing, which is the failure this overlay exists to make loud."
    );
    // Several bad keys are reported together, so the map is fixed once, not once per run.
    expect(() => applyItemMechanics(rows, { "not-an-item": { tags: ["a"] }, "also-not": { tags: ["b"] } })).toThrow(
      /2 refusals across 2 entries[\s\S]*not-an-item[\s\S]*also-not/
    );
  });

  it("fails closed on an entry that names no rider at all, and on one whose riders are empty", () => {
    // An empty entry is indistinguishable from a forgotten one, and so is a present-but-empty rider list.
    expect(() => applyItemMechanics(rows, { "cloak-of-protection": {} })).toThrow(
      "cloak-of-protection - the entry names no rider; leave a prose-only item out of the map instead"
    );

    for (const empty of [{ modifiers: [] }, { tags: [] }, { casts: [] }, { grantsFeatIds: [] }] as ItemMechanics[]) {
      const key = Object.keys(empty)[0];
      expect(() => applyItemMechanics(rows, { "cloak-of-protection": empty }), key).toThrow(
        `cloak-of-protection - "${key}" is present but empty, which authors nothing. Drop the key, or author the rider you meant`
      );
    }
    // `grants: {}` and `cursed: false` also leave the row byte-identical.
    expect(() => applyItemMechanics(rows, { "cloak-of-protection": { grants: {} } })).toThrow(
      'cloak-of-protection - "grants" is present but empty, which authors nothing'
    );
    expect(() => applyItemMechanics(rows, { "cloak-of-protection": { cursed: false } })).toThrow(
      'cloak-of-protection - "cursed" is present but false, which is the default, which authors nothing'
    );
    expect(emit(applyItemMechanics(rows, {}))).toBe(committed);
  });

  it("refuses a top-level key it does not know, instead of silently dropping the typo", () => {
    // The merge picks the known rider keys out of an entry (so an entry cannot set ETL-owned columns like
    // `slot`), which means a misspelled key would never reach `.strict()`. It is refused explicitly.
    expect(() =>
      applyItemMechanics(rows, {
        "cloak-of-protection": {
          modifers: [{ type: "armor-class", amount: 1 }],
          modifiers: [{ type: "armor-class", amount: 1 }]
        } as unknown as ItemMechanics
      })
    ).toThrow('cloak-of-protection - "modifers" is not a rider key');

    // ETL-owned parsed columns are refused by the same check.
    for (const owned of ["slot", "rarity", "attunement", "category", "description"]) {
      expect(
        () =>
          applyItemMechanics(rows, {
            "cloak-of-protection": {
              modifiers: [{ type: "armor-class", amount: 1 }],
              [owned]: "anything"
            } as unknown as ItemMechanics
          }),
        owned
      ).toThrow(`"${owned}" is not a rider key`);
    }
  });

  it("refuses a rider type no consumer reads yet, pointing at the disposition table", () => {
    // The map may only author riders that a consumer reads today (`CARRIER_RIDER_DISPOSITION`).
    expect(CARRIER_RIDER_DISPOSITION_MIRROR["spell-attack-bonus"]).toBe("unread");
    expect(() =>
      applyItemMechanics(rows, {
        "cloak-of-protection": { modifiers: [{ type: "spell-attack-bonus", amount: 1 }] }
      })
    ).toThrow(
      'cloak-of-protection - modifiers.0 is "spell-attack-bonus", which CARRIER_RIDER_DISPOSITION (apps/server/src/character-build.ts) marks "unread": the rider reaches derivation and no consumer applies it yet, so it would change nothing at the table. Leave the item prose until a consumer reads it'
    );
    // Its readable sibling is not refused, so the check is about the disposition and not the family.
    expect(() =>
      applyItemMechanics(rows, {
        "cloak-of-protection": { modifiers: [{ type: "spell-save-dc", amount: 1 }] }
      })
    ).not.toThrow();
  });

  it("keeps the disposition mirror honest against the server's own table", () => {
    // `CARRIER_RIDER_DISPOSITION` is not exported and `apps/server` depends on this package, so
    // `overlay.ts` keeps a copy and this test reads the server file as text to hold the copy to it.
    const serverFile = readFileSync(
      fileURLToPath(new URL("../../../apps/server/src/character-build.ts", import.meta.url)),
      "utf8"
    );
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
        { grants: { conditionImmunities: ["cursed"] } },
        'grants.conditionImmunities.0 names "cursed", which is no condition this content ships (src/enums.ts CONDITION_IDS)'
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
      expect(() => applyItemMechanics(rows, { "cloak-of-protection": mechanics }), message).toThrow(message);
    }

    // Correctly spelled riders land, so the check is about resolution and not shape.
    expect(() =>
      applyItemMechanics(rows, {
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
    ).not.toThrow();
  });

  it("names the slugs it deliberately leaves open, so a gap in the walker is a decision", () => {
    // Checked and open-by-design slug keys are disjoint and both listed in `overlay.ts`.
    expect(CHECKED_SLUG_KEYS.filter((key) => OPEN_BY_DESIGN.includes(key))).toEqual([]);
    expect(CHECKED_SLUG_KEYS).toContain("spellId");
    expect(OPEN_BY_DESIGN).toContain("tags");
    // No bundle lists valid tags, so any tag is allowed.
    expect(() => applyItemMechanics(rows, { "cloak-of-protection": { tags: ["not-in-any-bundle"] } })).not.toThrow();
  });

  it("surfaces the schema's refusal of an item-carrier modifier instead of swallowing it", () => {
    // The schema refuses `ITEM_REFUSED_MODIFIER_TYPES` on items; the seam re-parses so the refusal names
    // the item.
    expect(() =>
      applyItemMechanics(rows, {
        "amulet-of-health": { modifiers: [{ type: "ability-score", ability: "con", amount: 4 }] }
      })
    ).toThrow(
      `amulet-of-health - the schema refuses the merged row. modifiers.0.type: ${ITEM_REFUSED_MODIFIER_MESSAGE}`
    );

    // A cursed item must require attunement; `boots-of-elvenkind` requires none.
    expect(rows.find((row) => row.id === "boots-of-elvenkind")!.attunement?.required).toBe(false);
    expect(() => applyItemMechanics(rows, { "boots-of-elvenkind": { cursed: true } })).toThrow(
      "boots-of-elvenkind - the schema refuses the merged row. cursed: A cursed item must require attunement - attunement is both what springs the curse and what reveals it."
    );

    // The bundle's own schema is the overlay's only validator.
    expect(() =>
      applyItemMechanics(rows, {
        "cloak-of-protection": { modifiers: [{ type: "armor-class", amount: 99 }] }
      })
    ).toThrow(/cloak-of-protection - the schema refuses the merged row\. modifiers\.0\.amount:/);
  });
});
