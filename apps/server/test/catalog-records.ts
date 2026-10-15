import {
  EquipmentReferenceSchema,
  FeatReferenceSchema,
  FeatureRecordSchema,
  SpellReferenceSchema,
  type EquipmentReference,
  type FeatReference,
  type FeatureRecord,
  type SpellReference
} from "@vtt/content-srd-5.2.1";
import type { EquipmentCatalog } from "../src/equipment-derivation.js";

/**
 * Catalog records for a test's own `EquipmentCatalog`, written as only the fields the test cares about. Every
 * record is parsed through the catalog's schema, so a test cannot hand the derivation a shape the catalog would
 * refuse; the fields it leaves out take the schema's defaults (an unpriced, weightless, undescribed row).
 */
type Fields = object;

export const equipmentRecord = (fields: Fields): EquipmentReference =>
  EquipmentReferenceSchema.parse({ source: "homebrew", costGp: null, weightLb: null, description: null, ...fields });

export const featureRecord = (fields: Fields): FeatureRecord =>
  FeatureRecordSchema.parse({ description: nameOf(fields), ...fields });

/** A feat; `feature` holds the rider block, and its own id, name and prose default to the feat's. */
export function featRecord(fields: Fields): FeatReference {
  const { id, name, feature } = fields as { id?: unknown; name?: unknown; feature?: object };
  return FeatReferenceSchema.parse({ source: "homebrew", ...fields, feature: featureRecord({ id, name, ...feature }) });
}

const nameOf = (fields: Fields): string => {
  const { id, name } = fields as { id?: unknown; name?: unknown };
  return String(name ?? id);
};

export const spellRecord = (fields: Fields): SpellReference =>
  SpellReferenceSchema.parse({
    source: "homebrew",
    school: "evocation",
    castingTime: "Action",
    reactionCondition: null,
    range: { distance: null, unit: null, text: null },
    components: { verbal: true, somatic: true, material: false, materialText: null, materialConsumed: false },
    duration: "Instantaneous",
    concentration: false,
    ritual: false,
    attackRoll: false,
    damage: { roll: null, types: [] },
    save: null,
    target: { type: null, count: null },
    shape: null,
    classes: [],
    description: nameOf(fields),
    higherLevel: null,
    castingOptions: [],
    ...fields
  });

/** A catalog over parsed test records, looked up by id (features by their own id alone). */
export function testCatalog(
  records: Readonly<{
    equipment?: readonly Fields[];
    feats?: readonly Fields[];
    features?: readonly Fields[];
    spells?: readonly Fields[];
  }>
): EquipmentCatalog {
  const equipment = (records.equipment ?? []).map(equipmentRecord);
  const feats = (records.feats ?? []).map(featRecord);
  const features = (records.features ?? []).map(featureRecord);
  const spells = (records.spells ?? []).map(spellRecord);
  return {
    equipmentRecord: (id) => equipment.find((record) => record.id === id),
    featRecord: (id) => feats.find((record) => record.id === id),
    featureRecord: (ref) => features.find((record) => record.id === ref.id),
    spellRecord: (id) => spells.find((record) => record.id === id)
  };
}
