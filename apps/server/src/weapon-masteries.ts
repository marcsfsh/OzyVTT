import { loadWeaponProperties } from "@vtt/content-srd-5.2.1";
import type { ActionAvailability, DerivedWeaponMastery } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import type { EquipmentCatalog, EquipmentDerivation } from "./equipment-derivation.js";

/**
 * What the sheet says about Weapon Mastery: the property each mastered swing carries, and the weapon kinds the
 * character chose with what each property does. The rules themselves are in `weapon-mastery.ts`; this only names them.
 */

/** SRD 5.2.1 mastery properties by slug ("graze"), read once from the bundle. */
const MASTERIES: ReadonlyMap<string, DerivedWeaponMastery["mastery"]> = new Map(
  loadWeaponProperties()
    .filter((property) => property.kind === "mastery")
    .map((property) => {
      const id = property.id.replace(/-mastery$/, "");
      return [id, { id, name: property.name, description: property.description }];
    })
);

/** A mastery property by slug, or undefined for one the SRD doesn't print. */
export function masteryProperty(slug: string): DerivedWeaponMastery["mastery"] | undefined {
  return MASTERIES.get(slug);
}

/** The weapon kinds this character chose under Weapon Mastery, in ledger order, with the property each grants. A kind
 *  the catalog can't name, or whose property it doesn't know, is left out. */
export function weaponMasteriesOf(
  definition: ActorDefinition | undefined,
  equipmentRecord: EquipmentCatalog["equipmentRecord"] | undefined
): DerivedWeaponMastery[] {
  const chosen = (definition?.character?.choices ?? [])
    .filter((row) => row.kind === "weapon-mastery")
    .map((row) => row.id);
  return [...new Set(chosen)].flatMap((weaponId) => {
    const record = equipmentRecord?.(weaponId);
    const mastery = record?.weapon?.mastery ? masteryProperty(record.weapon.mastery) : undefined;
    return record && mastery ? [{ weaponId, weaponName: record.name, mastery: { ...mastery } }] : [];
  });
}

/** Each availability row with the mastery property its swing carries, when the character mastered that weapon. */
export function withMasteries(
  rows: readonly ActionAvailability[],
  derivation: Pick<EquipmentDerivation, "masteryByActionId">
): ActionAvailability[] {
  return rows.map((row) => {
    const inForce = derivation.masteryByActionId[row.id];
    const mastery = inForce ? masteryProperty(inForce.id) : undefined;
    return mastery ? { ...row, mastery: { id: mastery.id, name: mastery.name } } : row;
  });
}
