/**
 * What the "Duplicate an existing …" route can copy from.
 *
 * `POST /content/{id}/duplicate` accepts an **SRD** id as well as a homebrew one —
 * the server reads the bundled record and mints a namespaced homebrew copy. That is
 * the endpoint that makes a 20-row class table tractable to author, so the picker
 * has to offer the bundled catalogs, not just what the GM has already made.
 *
 * Every catalog here is already module-cached by its own hook (one fetch per session,
 * shared with the builder / the encounter picker / the sheet), so mounting them
 * together costs nothing a GM who has opened those surfaces has not already paid.
 * The hooks are called unconditionally and the result is selected by type, because
 * that is the only shape React's rules of hooks allow.
 *
 * `spell-list` has no bundled catalog endpoint — the eight SRD lists are data inside
 * `@vtt/content-srd-5.2.1`, not an HTTP catalog — so its picker offers homebrew only.
 * That is a real, explainable gap, not a silent empty grid: the create modal says so in
 * the grid's own empty state, and a GM builds a list from `basedOn` in the editor
 * rather than by duplicating one.
 */

import { useEffect, useMemo, useState } from "react";
import type { ContentMonsterSummary } from "@vtt/domain";
import { socket } from "../socket";
import { registerContentCache } from "../content/invalidate";
import {
  useBackgroundCatalog,
  useClassCatalog,
  useFeatCatalog,
  useSpeciesCatalog,
  useSubclassCatalog
} from "../content/catalogs";
import { useEquipmentReference } from "../encounter/equipment";
import { useSpellReference } from "../encounter/spells";
import type { HomebrewRecordSummary } from "./api";
import type { HomebrewType } from "./types";

export type DuplicateSource = Readonly<{
  id: string;
  name: string;
  origin: "srd" | "homebrew";
  /** A short mono line under the title — hit die, spell level, challenge rating. */
  meta?: string;
  /** Extra searchable text beyond the name. */
  keywords?: string;
  /**
   * Records that must be copied WITH this one for the copy to stand up on its own.
   *
   * Exactly one case today and it is the headline route: a class's subclass pick is
   * re-pointed to the copy's own `<newId>-subclasses` family by the server
   * (`homebrew-srd-copy.ts` — keeping `fighter-subclasses` would make the copy behave as
   * Fighter and `character-build.ts` hard-rejects the build), and that family matches
   * nothing until a subclass names the copy. So duplicating Fighter without its
   * subclasses lands a class that cannot be published and a GM reading an error on a
   * record they have not touched. The copy takes them along.
   */
  companions?: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

/* ---- The SRD bestiary. Mirrors `encounter/spells.tsx`'s cache exactly: one fetch per
   session, a `??=` in-flight promise so two simultaneous mounts still cause one, and a
   failed or empty ack is NEVER cached (a transient miss must retry on the next mount,
   or the picker is permanently unable to offer a creature). ---- */
let monsterCache: readonly ContentMonsterSummary[] | null = null;
let monsterInFlight: Promise<void> | null = null;
const monsterListeners = new Set<(monsters: readonly ContentMonsterSummary[]) => void>();

function requestMonsterReference(force = false) {
  if (monsterCache && !force) return;
  monsterInFlight ??= new Promise<void>((resolve) => {
    socket.emit("content:monsters", {}, (result) => {
      monsterInFlight = null;
      if (result.ok && result.monsters && result.monsters.length > 0) {
        monsterCache = result.monsters;
        for (const listener of monsterListeners) listener(monsterCache);
      }
      resolve();
    });
  });
}

// A homebrew creature published mid-session must reach this picker without a reload.
registerContentCache(() => { if (monsterCache) requestMonsterReference(true); });

function useMonsterReference(): readonly ContentMonsterSummary[] {
  const [monsters, setMonsters] = useState<readonly ContentMonsterSummary[]>(monsterCache ?? []);
  useEffect(() => {
    // Subscribe unconditionally, warm cache or not — otherwise an invalidation refetches
    // for nobody and the picker keeps the list it read at page load.
    if (monsterCache) setMonsters(monsterCache);
    monsterListeners.add(setMonsters);
    requestMonsterReference();
    return () => {
      monsterListeners.delete(setMonsters);
    };
  }, []);
  return monsters;
}

const byName = (a: DuplicateSource, b: DuplicateSource) => a.name.localeCompare(b.name);

/**
 * Every record of `type` the GM could copy: the bundled SRD catalog plus their own
 * homebrew, one flat list, sorted by name within each origin so the two blocks read
 * as one list rather than two interleaved ones.
 *
 * Soft-deleted homebrew is excluded — copying a record the GM has removed from every
 * picker would resurrect it under a new id, which is not what "Removed" means.
 */
export function useDuplicateSources(
  type: HomebrewType | null,
  homebrew: readonly HomebrewRecordSummary[]
): readonly DuplicateSource[] {
  const classes = useClassCatalog();
  const subclasses = useSubclassCatalog();
  const species = useSpeciesCatalog();
  const backgrounds = useBackgroundCatalog();
  const feats = useFeatCatalog();
  const spells = useSpellReference();
  const equipment = useEquipmentReference();
  const monsters = useMonsterReference();

  return useMemo(() => {
    if (!type) return [];

    /**
     * The GM's own live records, by id. **Exclusion is by ID, never by an optional
     * `source` field**, and that is the whole fix: a homebrew record authored from blank
     * carries no `source` key at all, `ContentSourceSchema` defaults it to `"srd"`, and a
     * filter on `source !== "homebrew"` was therefore a no-op that let a published
     * homebrew class render twice — once unbadged inside the SRD block, once badged
     * Homebrew — with React logging a duplicate-key warning every time the grid drew.
     * An id is present on every row of every catalog, so this holds for all eight types
     * including `spell`, `equipment` and `monster`, whose wire shapes carry no `source`
     * at all and so could never have been filtered the old way.
     */
    const mineIds = new Set(homebrew.filter((row) => !row.deletedAt).map((row) => row.id));

    const srd: DuplicateSource[] = [];
    const bundled = <T extends { id: string }>(items: readonly T[]) => items.filter((item) => !mineIds.has(item.id));

    switch (type) {
      case "class":
        for (const row of bundled(classes.items)) {
          // Whatever the merged catalog knows about this class's subclasses, SRD or the
          // GM's own published ones. A draft subclass is not here and cannot be: nothing
          // player-facing may reach a draft. It is the right set anyway — the point is to
          // give the copy a subclass to offer, and a draft one already belongs to the GM.
          const children = subclasses.items.filter((entry) => entry.classId === row.id);
          srd.push({
            id: row.id,
            name: row.name,
            origin: "srd",
            meta: `Hit die ${row.hitDie}`,
            ...(children.length > 0 ? { companions: children.map((entry) => ({ id: entry.id, name: entry.name })) } : {})
          });
        }
        break;
      case "subclass":
        for (const row of bundled(subclasses.items)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.classId, keywords: row.classId });
        break;
      case "species":
        for (const row of bundled(species.items)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: `${row.speedFeet} ft` });
        break;
      case "background":
        for (const row of bundled(backgrounds.items)) srd.push({ id: row.id, name: row.name, origin: "srd" });
        break;
      case "feat":
        for (const row of bundled(feats.items)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.category, keywords: row.category });
        break;
      case "spell":
        for (const row of bundled(spells)) {
          srd.push({
            id: row.id,
            name: row.name,
            origin: "srd",
            meta: row.level === 0 ? `${row.school} cantrip` : `Level ${row.level} ${row.school}`,
            keywords: row.school
          });
        }
        break;
      case "equipment":
        for (const row of bundled(equipment.catalog)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.category, keywords: row.category });
        break;
      case "monster":
        for (const row of bundled(monsters)) srd.push({ id: row.id, name: row.name, origin: "srd", meta: `CR ${row.challengeRating}`, keywords: `${row.type} ${row.size}` });
        break;
      case "spell-list":
        // The eight SRD lists are bundle data, not an HTTP catalog. A GM starts a list
        // from `basedOn` in the editor rather than by duplicating one.
        break;
    }

    const mine: DuplicateSource[] = homebrew
      .filter((row) => row.type === type && !row.deletedAt)
      .map((row) => {
        // Same companion rule for the GM's own class: a copy of a copy needs subclasses too.
        const children = type === "class" ? subclasses.items.filter((entry) => entry.classId === row.id) : [];
        return {
          id: row.id,
          name: row.name,
          origin: "homebrew" as const,
          meta: row.state === "draft" ? "Draft" : "Published",
          ...(children.length > 0 ? { companions: children.map((entry) => ({ id: entry.id, name: entry.name })) } : {})
        };
      });

    return [...srd.sort(byName), ...mine.sort(byName)];
  }, [type, classes.items, subclasses.items, species.items, backgrounds.items, feats.items, spells, equipment.catalog, monsters, homebrew]);
}
