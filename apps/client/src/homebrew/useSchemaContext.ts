/**
 * Assembles the `SchemaContext` every option list is a function of.
 *
 * Two things are worth reading twice:
 *
 * 1. **Homebrew is merged into every option list, drafts included.** A subclass whose
 *    class is still a draft is a completely normal half-authored state, and hiding the
 *    class until it publishes would make the pair unauthorable in the obvious order.
 * 2. **`resolveCatalog` goes through `resolveCatalogChoice`** — the very function the
 *    server validates a submitted choice with. The count a GM reads while authoring is
 *    therefore the count the game will offer, and the client never becomes a second
 *    rules engine (CLAUDE.md rule 2).
 */

import { useMemo } from "react";
import {
  CONDITION_IDS, CREATURE_TYPE_IDS, DAMAGE_TYPE_IDS, MAGIC_SCHOOL_IDS, WEAPON_MASTERY_IDS, WEAPON_PROPERTY_IDS
} from "@vtt/content-srd-5.2.1/schemas";
import { CatalogChoiceError, resolveCatalogChoice } from "@vtt/domain";
import { useBackgroundCatalog, useBuilderCatalogs, useClassCatalog, useFeatCatalog, useSkillCatalog, useSpeciesCatalog } from "../content/catalogs";
import { useEquipmentReference } from "../encounter/equipment";
import { useSpellReference } from "../encounter/spells";
import type { HomebrewRecordSummary } from "./api";
import type { CatalogEntry, SchemaContext, SelectOption } from "./schema";
import type { SpellMembership } from "./SpellListContents";
import type { HomebrewType } from "./types";

const byLabel = (a: SelectOption, b: SelectOption) => a.label.localeCompare(b.label);

/** Properties and masteries in one list — the trigger that consumes it gates on either, and both
    families live in one id space in the bundle. Spelled once, at module scope, so the memo below
    does not rebuild an array that can never change. */
const WEAPON_SLUGS: readonly string[] = [...WEAPON_PROPERTY_IDS, ...WEAPON_MASTERY_IDS];

/** SRD rows plus every homebrew record of `type`, de-duplicated by id. Homebrew wins a
    clash, because a homebrew record with an SRD id is an override by construction. */
function merge(srd: readonly SelectOption[], records: readonly HomebrewRecordSummary[], type: HomebrewType): readonly SelectOption[] {
  const map = new Map<string, SelectOption>();
  for (const option of srd) map.set(option.value, option);
  for (const record of records) {
    if (record.type !== type || record.deletedAt) continue;
    map.set(record.id, { value: record.id, label: record.name });
  }
  return [...map.values()].sort(byLabel);
}

export function useSchemaContext(
  recordId: string,
  type: HomebrewType,
  records: readonly HomebrewRecordSummary[]
): { ctx: SchemaContext; spells: readonly SpellMembership[] } {
  const classes = useClassCatalog();
  const species = useSpeciesCatalog();
  const backgrounds = useBackgroundCatalog();
  const feats = useFeatCatalog();
  const skills = useSkillCatalog();
  const spellRows = useSpellReference();
  const equipment = useEquipmentReference();
  const builder = useBuilderCatalogs();

  return useMemo(() => {
    const spells: readonly SpellMembership[] = spellRows.map((spell) => ({
      id: spell.id,
      name: spell.name,
      level: spell.level,
      classes: spell.classes ?? []
    }));

    /* `ContentSpellSummary` and `ContentEquipmentSummary` carry no `source`
       discriminator yet, so origin is decided by whether the GM's own homebrew list
       claims the id. When the wire gains the field this becomes a one-line read; until
       then this is the honest answer rather than a guess. */
    const mine = new Set(records.filter((record) => !record.deletedAt).map((record) => record.id));

    const spellEntries: readonly CatalogEntry[] = [
      ...spellRows.map((spell) => ({
        id: spell.id,
        name: spell.name,
        origin: (mine.has(spell.id) ? "homebrew" : "srd") as CatalogEntry["origin"],
        meta: spell.level === 0 ? `${spell.school} cantrip` : `Level ${spell.level} ${spell.school}`,
        keywords: spell.school
      })),
      // A homebrew spell the merged catalog hasn't picked up yet (it is still a draft)
      // is still a legitimate thing to point an item at.
      ...records
        .filter((record) => record.type === "spell" && !record.deletedAt && !spellRows.some((spell) => spell.id === record.id))
        .map((record) => ({ id: record.id, name: record.name, origin: "homebrew" as const, meta: "Draft" }))
    ];

    const equipmentEntries: readonly CatalogEntry[] = equipment.catalog.map((item) => ({
      id: item.id,
      name: item.name,
      origin: (mine.has(item.id) ? "homebrew" : "srd") as CatalogEntry["origin"],
      meta: item.category,
      keywords: item.category
    }));

    // Derived from the catalog, never a hardcoded literal: a homebrew category that is
    // not in a hardcoded array is invisible except under "All".
    const distinct = (values: readonly string[]): readonly SelectOption[] =>
      [...new Set(values.filter(Boolean))].sort().map((value) => ({ value, label: value.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) }));

    // A "spell list" is any id a spell tags itself with — that IS the identity, per
    // `resolveCatalogChoice`. Plus every homebrew list and class the GM has made.
    const listIds = new Set<string>();
    for (const spell of spells) for (const id of spell.classes) listIds.add(id);
    for (const record of records) {
      if (record.deletedAt) continue;
      if (record.type === "spell-list" || record.type === "class") listIds.add(record.id);
    }
    const nameOf = new Map(records.map((record) => [record.id, record.name]));
    const spellLists = [...listIds]
      .map((id) => ({ value: id, label: nameOf.get(id) ?? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) }))
      .sort(byLabel);

    const ctx: SchemaContext = {
      recordId,
      siblings: records.filter((record) => record.type === type && !record.deletedAt).map((record) => ({ id: record.id, name: record.name })),
      classes: merge(classes.items.map((row) => ({ value: row.id, label: row.name })), records, "class"),
      species: merge(species.items.map((row) => ({ value: row.id, label: row.name })), records, "species"),
      backgrounds: merge(backgrounds.items.map((row) => ({ value: row.id, label: row.name })), records, "background"),
      feats: merge(feats.items.map((row) => ({ value: row.id, label: row.name })), records, "feat"),
      featCategories: distinct([...feats.items.map((row) => row.category), "origin", "general", "fighting-style", "epic-boon"]),
      skills: skills.items.map((row) => ({ value: row.id, label: row.name })),
      spellLists,
      spells: spellEntries,
      equipment: equipmentEntries,
      equipmentCategories: distinct(equipment.catalog.map((item) => item.category)),
      /* Constants, not a fetch: these are the CANONICAL SRD vocabularies and they are compiled in
         from the same package the server validates with, under a bundle-drift test. Nothing here
         waits on a socket, so a damage-type list is complete on the first paint of the form rather
         than after the content catalogs land — which is the difference between a GM typing "fire"
         from memory and picking it. */
      damageTypes: DAMAGE_TYPE_IDS,
      conditions: CONDITION_IDS,
      schools: MAGIC_SCHOOL_IDS,
      creatureTypes: CREATURE_TYPE_IDS,
      weaponProperties: WEAPON_SLUGS,
      resolveCatalog: (slug) => {
        try {
          return { count: resolveCatalogChoice(slug, builder.choice).length };
        } catch (error) {
          return { error: error instanceof CatalogChoiceError ? error.message : "That catalog doesn't resolve." };
        }
      }
    };

    return { ctx, spells };
  }, [recordId, type, records, classes.items, species.items, backgrounds.items, feats.items, skills.items, spellRows, equipment.catalog, builder.choice]);
}
