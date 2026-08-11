import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOMEBREW_PATHS } from "@vtt/api-contract";
import { InventoryItemSchema, type Actor, type ActorDefinition } from "@vtt/schemas";
import { ContentLibrary } from "../../../server/src/content-library.js";
import { deriveEquipment, weaponPropertiesOf } from "../../../server/src/equipment-derivation.js";
import { inventoryWeaponFrom } from "../encounter/equipment";
import { bootHomebrewApi, type ApiFixture } from "./api-parity-harness";
import { applyField, authored, publishVerdict, storedBody } from "./authoring-harness";

/**
 * **C3's far end: a GM-authored Finesse weapon swings off Dexterity.**
 *
 * The four data shapes landed in `36b5a1f` and the three readers had shipped for releases before
 * that, so `properties` worked end to end for every weapon in the SRD and for nothing a GM could
 * make: the editor's weapon block was five rows — kind, damage, damage type, range, long range —
 * with no way to say "Finesse". An SRD Rapier was Finesse; a GM's rapier could never be. This file
 * is the proof that the sixth row closed it, and it deliberately ends at a ROLLED NUMBER rather
 * than at the array: "the property survived the form" is exactly the vacuous shape the done bar
 * rules out, because it is what a green build looked like the whole time the bug was live.
 *
 * The whole GM gesture, no step simulated:
 *
 *   1. author the weapon through the REAL controls (`authored` throws on any key with no control —
 *      that is the control probe, and it is the mechanism, not a convenience);
 *   2. POST it over the REAL wire and publish it through the REAL four-tier gate;
 *   3. read it back out of the REAL merged catalog `ContentLibrary` hands the table;
 *   4. add it to a sheet through the browse-and-add picker's own projection, parsed by the SERVER's
 *      inventory schema — so a payload the server would refuse fails here;
 *   5. swing it.
 *
 * **The SRD Rapier beside it is the control group**, asserted in the same test on the same
 * character: it was already green at HEAD, so a number that moves for both is a broken character
 * fixture rather than a broken editor row, and the two failures cannot be confused.
 *
 * A `.mirror.test.ts`, so it runs in the node project and may import the server's own modules —
 * the same reason `api-parity.mirror.test.ts` and `catalog-add.mirror.test.ts` do.
 */

const GM = { authorization: "Bearer gm-token", "content-type": "application/json" };

/**
 * DEX 15 (+2) / STR 12 (+1), and both halves of that matter. The scores are ADJACENT rather than
 * far apart on purpose: `weaponAbilityModifier` takes `Math.max(str, dex)` for a Finesse weapon, so
 * a wide gap would let a test pass that had merely lost the Strength branch. One point of
 * separation means the Finesse weapon and the non-Finesse weapon differ by exactly one, and the
 * assertion can only be satisfied by picking the right ability. Proficiency bonus +2, and the
 * fighter is trained in martial weapons, so both weapons below are proficient.
 */
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

/** The sheet's browse-and-add picker, exactly: narrow the catalog block, parse it with the SERVER's
    schema, and equip it. A row the server would refuse throws here rather than swinging. */
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

    // The row is a real control, not a key the harness tolerated: `authored` above would have thrown.
    expect((draft.weapon as Record<string, unknown>).properties).toEqual(["finesse"]);
    // And the publish gate accepts it — the column is `z.array(...).max(12).optional()`, so this is
    // also the assertion that the editor's shape and the store's column agree.
    expect(publishVerdict("equipment", draft, "hb-c3-probe").why).toBe("");

    const id = await publishThroughApi(draft);
    const view = library.forAudience("gm");

    // Tier 1 of the far end: the merged catalog really carries it. Read off the record the server
    // hands the table, never off the draft.
    expect(view.equipmentRecord(id)?.weapon?.properties).toEqual(["finesse"]);

    const needle = carried(view, id);
    // The SRD control group, on the same sheet: green at HEAD, and it is what tells a later reader
    // whether a failure below is this row or the character fixture.
    const rapier = carried(view, "rapier");
    const maul = carried(view, "maul");
    const actor = {
      id: "actor-vane", name: "Vane", kind: "player-character", visibility: "public",
      hp: { current: 22, maximum: 22, temporary: 0 }, conditions: [], effects: [],
      inventory: [needle, rapier, maul]
    } as unknown as Actor;

    const derivation = deriveEquipment(actor, DUELLIST, { equipmentRecord: (key: string) => view.equipmentRecord(key) });
    const swing = (key: string) => derivation.actions.find((action) => action.id === `item-${key}`)!;

    /* ------------------------------------------------------------------ THE FAR END ---- */

    // STR 12 (+1), DEX 15 (+2), PB +2. The GM's weapon is Finesse, so it takes Dexterity: +4 to hit
    // and +2 on the damage string. Without this unit's row it is a plain martial weapon, takes
    // Strength, and reads +3 / `1d8 + 1` — the two numbers this test exists to separate.
    expect(swing(needle.id).attack!.bonus).toBe(4);
    expect(swing(needle.id).damage![0].formula).toBe("1d8 + 2");

    // The control group: the SRD's own Finesse weapon lands on the same two numbers, from the same
    // character, through the catalog path that already worked.
    expect(swing("rapier").attack!.bonus).toBe(4);
    expect(swing("rapier").damage![0].formula).toBe("1d8 + 2");

    // And the Strength baseline, so "+4" is demonstrably a CHOICE and not the only number this
    // character can roll: a Maul is not Finesse and falls back to STR 12.
    expect(swing("maul").attack!.bonus).toBe(3);
    expect(swing("maul").damage![0].formula).toBe("2d6 + 1");

    // The column those numbers came off, asserted last so a wrong number fails as a wrong number.
    expect(weaponPropertiesOf(needle.id, actor.inventory)).toEqual(["finesse"]);
  });

  it("carries an open slug the SRD never heard of, because the control is a suggestion list", async () => {
    // The other half of "keep it OPEN". `WEAPON_PROPERTY_IDS` is what the chooser SHOWS; the column
    // is an open slug, so a GM's own word publishes and reaches `weaponPropertiesOf` — which is the
    // whole point of a homebrew vocabulary and is where a closed enum would have failed silently.
    const draft = weaponDraft(["finesse", "duelling"]);
    const id = await publishThroughApi(draft);
    const view = library.forAudience("gm");
    expect(view.equipmentRecord(id)?.weapon?.properties).toEqual(["finesse", "duelling"]);

    const item = carried(view, id);
    expect(weaponPropertiesOf(item.id, [item])).toEqual(["finesse", "duelling"]);
  });

  it("a weapon whose properties row is never touched publishes with the key ABSENT, not empty", () => {
    // `defaults.ts` rule 1, "omit, never null", and the reason `character-build.ts` distinguishes
    // the two: absent means "not recorded", which is not the claim an empty list makes.
    const untouched = authored("equipment", "Plain Mace", [
      ["category", "weapon"],
      ["weapon.damageDice", "1d6"],
      ["weapon.damageType", "bludgeoning"]
    ]);
    expect("properties" in (untouched.weapon as Record<string, unknown>)).toBe(false);
    expect(publishVerdict("equipment", untouched, "hb-c3-probe").publishable).toBe(true);

    // Touching the row and then emptying it is a different gesture and stays an empty list — the GM
    // said "no properties" rather than never having been asked.
    const emptied = applyField("equipment", untouched, "weapon.properties", []);
    expect((emptied.weapon as Record<string, unknown>).properties).toEqual([]);
    expect(publishVerdict("equipment", emptied, "hb-c3-probe").publishable).toBe(true);
  });
});
