import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOMEBREW_PATHS } from "@vtt/api-contract";
import { InventoryItemSchema, type Actor, type ActorDefinition } from "@vtt/schemas";
import { ContentLibrary } from "../../../server/src/content-library.js";
import { deriveEquipment, weaponPropertiesOf } from "../../../server/src/equipment-derivation.js";
import { inventoryWeaponFrom } from "../encounter/equipment";
import { bootHomebrewApi, type ApiFixture } from "./api-parity-harness";
import { applyField, authored, publishVerdict, storedBody } from "./authoring-harness";

/**
 * A GM-authored Finesse weapon swings off Dexterity, end to end: authored through the real controls,
 * POSTed and published through the real gate, read from the merged catalog, added to a sheet through
 * the picker's projection (parsed by the server's inventory schema), and swung. Ends at a rolled
 * number, not the stored array. The SRD Rapier on the same character is the control group.
 */

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };

/** DEX 15 (+2) / STR 12 (+1): adjacent scores, so Finesse (`Math.max(str, dex)`) and non-Finesse
    weapons differ by exactly one and only the right ability satisfies the assertion. PB +2, and the
    fighter is proficient with both weapons. */
const DUELLIST = {
  name: "Vane", armorClass: 13, proficiencyBonus: 2,
  abilityScores: { str: 12, dex: 15, con: 12, int: 10, wis: 10, cha: 10 },
  hitPoints: { maximum: 22 }, actions: [], extensions: {},
  character: { classes: [{ id: "fighter", name: "Fighter", level: 1 }], feats: [] },
  proficiencies: { saves: [], skills: [] }
} as unknown as ActorDefinition;

/** The record the GM types, with `properties` as the one variable the probes move. */
const weaponDraft = (properties: readonly string[]) => authored("equipment", "Duellist's Needle", [
  ["description", "A needle-thin duelling blade, balanced for the wrist."],
  ["category", "weapon"],
  ["weapon.category", "martial"],
  ["weapon.damageDice", "1d8"],
  ["weapon.damageType", "piercing"],
  ["weapon.properties", [...properties]]
]);

let api: ApiFixture;
let library: ContentLibrary;

beforeAll(async () => {
  api = await bootHomebrewApi();
  library = new ContentLibrary(api.store);
});
afterAll(async () => { await api.close(); });

/** Publish a draft over the wire and hand back the id the catalog will know it by. */
async function publishThroughApi(draft: ReturnType<typeof weaponDraft>): Promise<string> {
  const created = await fetch(`${api.base}${HOMEBREW_PATHS.content}`, {
    method: "POST", headers: GM,
    body: JSON.stringify({ record: { type: "equipment", ...storedBody("equipment", draft, "hb-c3-probe") } })
  });
  expect(created.status, "create").toBe(201);
  const { id } = (await created.json()).data.record as { id: string };
  const published = await fetch(`${api.base}${HOMEBREW_PATHS.contentById.replace("{id}", id)}/publish`, {
    method: "POST", headers: GM
  });
  expect(published.status, `publish: ${await published.clone().text()}`).toBe(200);
  return id;
}

/** The sheet's browse-and-add picker: narrow the catalog block, parse it with the server's schema,
    and equip it. A row the server would refuse throws here. */
function carried(view: ReturnType<ContentLibrary["forAudience"]>, id: string) {
  const record = view.equipmentRecord(id);
  if (!record?.weapon) throw new Error(`"${id}" is not a weapon in the merged catalog.`);
  return InventoryItemSchema.parse({
    id: record.id, name: record.name, quantity: 1, equipped: true, category: record.category,
    weapon: inventoryWeaponFrom(record.weapon)
  });
}

describe("C3 — a homebrew weapon's properties reach the engine", () => {
  it("authors Finesse through the real control, publishes it, and swings it off Dexterity", async () => {
    const draft = weaponDraft(["finesse"]);

    // `authored` would have thrown if the row had no control.
    expect((draft.weapon as Record<string, unknown>).properties).toEqual(["finesse"]);
    // The publish gate accepts it, so the editor's shape matches the store's column.
    expect(publishVerdict("equipment", draft, "hb-c3-probe").why).toBe("");

    const id = await publishThroughApi(draft);
    const view = library.forAudience("gm");

    // The merged catalog carries it, read from the record the server hands the table.
    expect(view.equipmentRecord(id)?.weapon?.properties).toEqual(["finesse"]);

    const needle = carried(view, id);
    // SRD control group on the same sheet: separates a broken row from a broken character fixture.
    const rapier = carried(view, "rapier");
    const maul = carried(view, "maul");
    const actor = {
      id: "actor-vane", name: "Vane", kind: "player-character", visibility: "public",
      hp: { current: 22, maximum: 22, temporary: 0 }, conditions: [], effects: [],
      inventory: [needle, rapier, maul]
    } as unknown as Actor;

    const derivation = deriveEquipment(actor, DUELLIST, { equipmentRecord: (key: string) => view.equipmentRecord(key) });
    const swing = (key: string) => derivation.actions.find((action) => action.id === `item-${key}`)!;

    /* ------------------------------------------------------------------ far end ---- */

    // Finesse takes Dexterity: +4 to hit and +2 damage. Without the property it would read +3 /
    // `1d8 + 1`.
    expect(swing(needle.id).attack!.bonus).toBe(4);
    expect(swing(needle.id).damage![0].formula).toBe("1d8 + 2");

    // The SRD Finesse weapon lands on the same numbers.
    expect(swing("rapier").attack!.bonus).toBe(4);
    expect(swing("rapier").damage![0].formula).toBe("1d8 + 2");

    // Strength baseline: a Maul is not Finesse and gets +3.
    expect(swing("maul").attack!.bonus).toBe(3);
    expect(swing("maul").damage![0].formula).toBe("2d6 + 1");

    // The column the numbers came from, asserted last so a wrong number fails as a wrong number.
    expect(weaponPropertiesOf(needle.id, actor.inventory)).toEqual(["finesse"]);
  });

  it("carries an open slug the SRD never heard of, because the control is a suggestion list", async () => {
    // The column is an open slug: `WEAPON_PROPERTY_IDS` is only what the chooser shows, so a GM's own
    // word publishes and reaches `weaponPropertiesOf`.
    const draft = weaponDraft(["finesse", "duelling"]);
    const id = await publishThroughApi(draft);
    const view = library.forAudience("gm");
    expect(view.equipmentRecord(id)?.weapon?.properties).toEqual(["finesse", "duelling"]);

    const item = carried(view, id);
    expect(weaponPropertiesOf(item.id, [item])).toEqual(["finesse", "duelling"]);
  });

  it("a weapon whose properties row is never touched publishes with the key ABSENT, not empty", () => {
    // Omit, never null: absent means "not recorded", which differs from an empty list.
    const untouched = authored("equipment", "Plain Mace", [
      ["category", "weapon"],
      ["weapon.damageDice", "1d6"],
      ["weapon.damageType", "bludgeoning"]
    ]);
    expect("properties" in (untouched.weapon as Record<string, unknown>)).toBe(false);
    expect(publishVerdict("equipment", untouched, "hb-c3-probe").publishable).toBe(true);

    // Touching and then emptying the row stays an empty list: the GM said "no properties".
    const emptied = applyField("equipment", untouched, "weapon.properties", []);
    expect((emptied.weapon as Record<string, unknown>).properties).toEqual([]);
    expect(publishVerdict("equipment", emptied, "hb-c3-probe").publishable).toBe(true);
  });
});
