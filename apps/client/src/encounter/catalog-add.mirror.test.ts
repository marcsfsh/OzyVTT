import { describe, expect, it } from "vitest";
import { loadEquipment } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema } from "@vtt/schemas";
import { deriveEquipment, weaponPropertiesOf } from "../../../server/src/equipment-derivation";
import type { ActorDefinition, Actor } from "@vtt/schemas";
import { inventoryWeaponFrom } from "./equipment";

/**
 * THE BROWSE-AND-ADD SEAM: the sheet's catalog picker and the server's inventory schema.
 *
 * The picker reads `content:equipment` summaries and posts one back as a `character.set-inventory`
 * item. Those are two shapes with two owners and nothing was checking that they agree - so when the
 * catalog record grew a browse-only `mastery` key, spreading the summary's weapon block wholesale
 * made the server refuse EVERY SRD weapon with *"Unrecognized key(s) in object: 'mastery'"* and a
 * GM could not add a sword. It shipped because no test drove a real catalog row through the real
 * schema; the far end here is that refusal, not the projection's return value.
 *
 * A `.mirror.test.ts`, so it runs in the node project and may import the server's own modules -
 * the same reason `vocabulary-parity.mirror.test.ts` does.
 */

const catalog = loadEquipment();
const weapons = catalog.filter((item) => item.weapon !== null);

/** Exactly what `addFromCatalog` posts, minus the ids and quantity the sheet fills in. */
const addPayload = (item: (typeof catalog)[number]) => ({
  id: item.id, name: item.name, quantity: 1, category: item.category,
  ...(item.weightLb != null ? { weightEach: item.weightLb } : {}),
  ...(item.description ? { description: item.description } : {}),
  ...(item.weapon ? { weapon: inventoryWeaponFrom(item.weapon) } : {}),
  ...(item.armor ? { armor: item.armor } : {})
});

describe("adding a catalog weapon to a sheet", () => {
  it("posts a payload the server's own inventory schema accepts, for every weapon in the catalog", () => {
    expect(weapons.length).toBeGreaterThanOrEqual(37);
    const refused: Array<{ id: string; message: string }> = [];
    for (const item of weapons) {
      const parsed = InventoryItemSchema.safeParse(addPayload(item));
      if (!parsed.success) refused.push({ id: item.id, message: parsed.error.issues[0].message });
    }
    expect(refused, "the sheet's add-from-catalog payload was refused").toEqual([]);
  });

  it("drops the browse-only mastery and keeps the properties the engine reads", () => {
    const longsword = catalog.find((item) => item.id === "longsword")!;
    // The catalog record really does carry both - this is not a synthetic fixture.
    expect(longsword.weapon).toMatchObject({ mastery: "sap", properties: ["versatile"] });
    const posted = inventoryWeaponFrom(longsword.weapon!);
    expect(Object.keys(posted).sort()).toEqual(["category", "damageDice", "damageType", "longRangeFeet", "properties", "rangeFeet"]);
    expect("mastery" in posted).toBe(false);

    // The negative control the bug needed: the unnarrowed block is refused, by name.
    const wholesale = InventoryItemSchema.safeParse({ id: "longsword", name: "Longsword", quantity: 1, weapon: longsword.weapon });
    expect(wholesale.success).toBe(false);
    expect(wholesale.success ? "" : wholesale.error.issues[0].message).toContain("mastery");
  });

  it("lands a Rapier that swings off Dexterity and a Glaive that threatens at ten feet", () => {
    // The far end. `properties` is not display data: these two numbers are read off the INVENTORY
    // row through `weaponPropertiesOf`, and both were wrong for every weapon in the game while the
    // column was empty - a Rapier rolled off Strength and every reach weapon threatened at five feet.
    const definition = {
      name: "Duellist", armorClass: 12, proficiencyBonus: 2,
      abilityScores: { str: 10, dex: 18, con: 12, int: 10, wis: 10, cha: 10 },
      hitPoints: { maximum: 20 }, actions: [], extensions: {},
      character: { classes: [{ id: "rogue", name: "Rogue", level: 1 }], feats: [] },
      proficiencies: { saves: [], skills: [] }
    } as unknown as ActorDefinition;
    const carry = (id: string) => InventoryItemSchema.parse({ ...addPayload(catalog.find((item) => item.id === id)!), equipped: true });
    const actor = {
      id: "a", name: "Duellist", kind: "player-character", visibility: "public",
      hp: { current: 20, maximum: 20, temporary: 0 }, conditions: [], effects: [],
      inventory: [carry("rapier"), carry("glaive"), carry("mace")]
    } as unknown as Actor;

    const derivation = deriveEquipment(actor, definition, {
      equipmentRecord: (id: string) => catalog.find((item) => item.id === id)
    });
    const swing = (id: string) => derivation.actions.find((action) => action.id === `item-${id}`)!;

    // STR 10 (+0) and DEX 18 (+4): a Finesse weapon takes the better, everything else takes Strength.
    // Rogue 1 is proficient with a Rapier (Simple + Martial with Finesse or Light) but not a Glaive.
    expect(swing("rapier").attack!.bonus).toBe(6);
    expect(swing("rapier").damage![0].formula).toBe("1d8 + 4");
    expect(swing("mace").attack!.bonus).toBe(2);
    expect(swing("mace").damage![0].formula).toBe("1d6");
    // Reach: a Glaive threatens at 10 feet, a Mace at 5.
    expect(swing("glaive").attack!.reachFeet).toBe(10);
    expect(swing("mace").attack!.reachFeet).toBe(5);
    // The column those five numbers came off, asserted last so a wrong number fails as a wrong
    // number rather than as a missing slug.
    expect(weaponPropertiesOf("rapier", actor.inventory)).toEqual(["finesse"]);
    expect(weaponPropertiesOf("glaive", actor.inventory)).toEqual(["heavy", "reach", "two-handed"]);
  });
});
