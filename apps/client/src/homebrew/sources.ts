/**
 * What "Duplicate an existing …" can copy from. The duplicate endpoint accepts SRD ids as well
 * as homebrew ones, so the bundled catalogs are offered too. The catalog hooks are module-cached
 * and called unconditionally (rules of hooks); the result is selected by type.
 *
 * `spell-list` has no bundled catalog endpoint, so it offers homebrew only.
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
  /** Short line under the title: hit die, spell level, challenge rating. */
  meta?: string;
  /** Extra searchable text beyond the name. */
  keywords?: string;
  /** Records copied along with this one so the copy can stand alone. A copied class's subclass
      pick is re-pointed to the copy's own `<newId>-subclasses` family, which matches nothing
      until a subclass names the copy, so the class's subclasses come too. */
  companions?: ReadonlyArray<Readonly<{ id: string; name: string }>>;
}>;

/* ---- SRD bestiary cache, same pattern as `encounter/spells.tsx`: one fetch per session, a
   shared in-flight promise, and a failed or empty ack is never cached so the next mount retries. ---- */
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
registerContentCache(() => {
  if (monsterCache) requestMonsterReference(true);
});

function useMonsterReference(): readonly ContentMonsterSummary[] {
  const [monsters, setMonsters] = useState<readonly ContentMonsterSummary[]>(monsterCache ?? []);
  useEffect(() => {
    // Subscribe even with a warm cache, or an invalidation refetches for no listener.
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

/** Every record of `type` the GM could copy: the SRD catalog then their own homebrew, each
    sorted by name. Soft-deleted homebrew is excluded so copying cannot resurrect it. */
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

    /** The GM's live record ids. Exclude by id, not by `source`: a homebrew record authored from
        blank has no `source` (it defaults to "srd"), and spell/equipment/monster summaries carry
        none at all, so filtering on `source` would list homebrew twice. */
    const mineIds = new Set(homebrew.filter((row) => !row.deletedAt).map((row) => row.id));

    const srd: DuplicateSource[] = [];
    const bundled = <T extends { id: string }>(items: readonly T[]) => items.filter((item) => !mineIds.has(item.id));

    switch (type) {
      case "class":
        for (const row of bundled(classes.items)) {
          // Subclasses from the merged catalog. Drafts are absent because nothing
          // player-facing may reach a draft.
          const children = subclasses.items.filter((entry) => entry.classId === row.id);
          srd.push({
            id: row.id,
            name: row.name,
            origin: "srd",
            meta: `Hit die ${row.hitDie}`,
            ...(children.length > 0
              ? { companions: children.map((entry) => ({ id: entry.id, name: entry.name })) }
              : {})
          });
        }
        break;
      case "subclass":
        for (const row of bundled(subclasses.items))
          srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.classId, keywords: row.classId });
        break;
      case "species":
        for (const row of bundled(species.items))
          srd.push({ id: row.id, name: row.name, origin: "srd", meta: `${row.speedFeet} ft` });
        break;
      case "background":
        for (const row of bundled(backgrounds.items)) srd.push({ id: row.id, name: row.name, origin: "srd" });
        break;
      case "feat":
        for (const row of bundled(feats.items))
          srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.category, keywords: row.category });
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
        for (const row of bundled(equipment.catalog))
          srd.push({ id: row.id, name: row.name, origin: "srd", meta: row.category, keywords: row.category });
        break;
      case "monster":
        for (const row of bundled(monsters))
          srd.push({
            id: row.id,
            name: row.name,
            origin: "srd",
            meta: `CR ${row.challengeRating}`,
            keywords: `${row.type} ${row.size}`
          });
        break;
      case "spell-list":
        // The SRD lists are bundle data, not an HTTP catalog.
        break;
    }

    const mine: DuplicateSource[] = homebrew
      .filter((row) => row.type === type && !row.deletedAt)
      .map((row) => {
        // A copy of the GM's own class needs its subclasses too.
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
  }, [
    type,
    classes.items,
    subclasses.items,
    species.items,
    backgrounds.items,
    feats.items,
    spells,
    equipment.catalog,
    monsters,
    homebrew
  ]);
}
